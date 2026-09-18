import {
  Answer,
  Question,
  Questions,
  type ChoiceAnswer,
  type QuestionModel,
  type Usage,
} from "@nitoba/questions";
import { describeFamily, groupToolsByFamily, toolCriteria } from "./tools.ts";
import {
  RESPOND_TO_USER,
  type RouterConfig,
  type RouterState,
  type RoutingEvaluation,
  type ToolCatalog,
} from "./types.ts";

const MAX_DIRECT_TOOLS = 254;
const MAX_SECOND_STAGE_TOOLS = 255;

export const NEXT_TOOL_QUESTION = `
Choose the single tool the coding agent should call NEXT to make progress on the user's current request.

Use the current request, actions already taken and their results. Respect dependencies: inspect or look
things up before a mutation when needed. Do not repeat an action that already completed successfully.
A failed action may be retried only when that is the appropriate next step. Choose the respond option
only when no further tool call is needed.
`.trim();

export const DONE_QUESTION = `
Has every action required to satisfy the user's current request already been completed successfully?
Return false when any required lookup, edit, command, test, commit, push, pull request, message or other
action is still missing, or when a required action failed and still needs recovery.
`.trim();

const RESPOND_DESCRIPTION =
  "No tool call is needed now: the user's current request is complete, or none of the available tools applies. The assistant should answer the user.";

export class RouterCapacityError extends Error {
  readonly catalogSize: number;

  constructor(message: string, catalogSize: number) {
    super(message);
    this.name = "RouterCapacityError";
    this.catalogSize = catalogSize;
  }
}

function ranked(answer: ChoiceAnswer<string>) {
  return Answer.rank(answer).map(({ value, probability }) => ({ name: value, probability }));
}

function sumUsage(left: Usage, right: Usage): Usage {
  const inputTokens =
    left.inputTokens === undefined || right.inputTokens === undefined
      ? undefined
      : left.inputTokens + right.inputTokens;
  const outputTokens =
    left.outputTokens === undefined || right.outputTokens === undefined
      ? undefined
      : left.outputTokens + right.outputTokens;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

function withRespond(criteria: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return {
    ...criteria,
    [RESPOND_TO_USER]: RESPOND_DESCRIPTION,
  };
}

function singleToolAnswer(name: string, family: ChoiceAnswer<string>): ChoiceAnswer<string> {
  return {
    type: "choice",
    choice: name,
    probabilities: { [name]: 1 },
    confidence: family.confidence,
    probabilitySource: "custom",
    confidenceSource: "custom",
  };
}

function combinedToolAnswer(
  answer: ChoiceAnswer<string>,
  family: ChoiceAnswer<string>,
): ChoiceAnswer<string> {
  return {
    ...answer,
    confidence: Math.min(answer.confidence, family.confidence),
    confidenceSource: "custom",
  };
}

export interface JevRouter {
  evaluate(state: RouterState, tools: ToolCatalog): Promise<RoutingEvaluation>;
}

export function createJevRouter(model: QuestionModel, config: RouterConfig): JevRouter {
  const questions = Questions.create({ model });

  async function direct(state: RouterState, tools: ToolCatalog): Promise<RoutingEvaluation> {
    const started = performance.now();
    const evaluation = await questions.about(state).evidence({
      nextTool: Question.choice(
        NEXT_TOOL_QUESTION,
        withRespond(toolCriteria(tools, config.maxToolDescriptionChars)),
      ),
      done: Question.boolean(DONE_QUESTION, {
        true: "Every required action is already complete and successful.",
        false: "At least one required action is missing, failed, or still needs follow-up.",
      }),
    });

    return {
      nextTool: evaluation.answers.nextTool,
      done: evaluation.answers.done,
      ranked: ranked(evaluation.answers.nextTool),
      model: evaluation.model,
      usage: evaluation.usage,
      latencyMs: Math.round(performance.now() - started),
      calls: 1,
      catalogSize: Object.keys(tools).length,
    };
  }

  async function hierarchical(state: RouterState, tools: ToolCatalog): Promise<RoutingEvaluation> {
    const started = performance.now();
    const groups = groupToolsByFamily(tools);
    const catalogSize = Object.keys(tools).length;

    if (groups.size < 2 || groups.size > MAX_DIRECT_TOOLS) {
      throw new RouterCapacityError(
        `Cannot safely reduce ${catalogSize} tools into at most ${MAX_DIRECT_TOOLS} semantic families.`,
        catalogSize,
      );
    }

    const familyCriteria = Object.fromEntries(
      [...groups.entries()].map(([family, familyTools]) => [
        family,
        describeFamily(family, familyTools, config.maxToolDescriptionChars),
      ]),
    );

    const familyEvaluation = await questions.about(state).evidence({
      nextFamily: Question.choice(
        "Which tool family contains the single best NEXT action for the coding agent?",
        withRespond(familyCriteria),
      ),
      done: Question.boolean(DONE_QUESTION, {
        true: "Every required action is already complete and successful.",
        false: "At least one required action is missing, failed, or still needs follow-up.",
      }),
    });

    const familyAnswer = familyEvaluation.answers.nextFamily;
    const done = familyEvaluation.answers.done;
    let selectedFamily = familyAnswer.choice;

    if (selectedFamily === RESPOND_TO_USER && done.probability >= config.doneThreshold) {
      return {
        nextTool: familyAnswer,
        done,
        ranked: ranked(familyAnswer),
        model: familyEvaluation.model,
        usage: familyEvaluation.usage,
        latencyMs: Math.round(performance.now() - started),
        calls: 1,
        catalogSize,
      };
    }

    if (selectedFamily === RESPOND_TO_USER) {
      selectedFamily =
        Answer.rank(familyAnswer).find(({ value }) => value !== RESPOND_TO_USER)?.value ?? "";
    }

    const selectedTools = groups.get(selectedFamily);
    if (!selectedTools) {
      throw new RouterCapacityError(
        "Jev did not return a usable tool family for the oversized catalog.",
        catalogSize,
      );
    }

    const entries = Object.entries(selectedTools);
    if (entries.length > MAX_SECOND_STAGE_TOOLS) {
      throw new RouterCapacityError(
        `Tool family "${selectedFamily}" still contains ${entries.length} tools, above the second-stage limit.`,
        catalogSize,
      );
    }

    if (entries.length === 1) {
      const name = entries[0]![0];
      const nextTool = singleToolAnswer(name, familyAnswer);
      return {
        nextTool,
        done,
        ranked: ranked(nextTool),
        model: familyEvaluation.model,
        usage: familyEvaluation.usage,
        latencyMs: Math.round(performance.now() - started),
        calls: 1,
        catalogSize,
        selectedFamily,
      };
    }

    const toolEvaluation = await questions.about(state).evidence({
      nextTool: Question.choice(
        `Within the already selected "${selectedFamily}" family, which tool should the coding agent call NEXT?`,
        toolCriteria(selectedTools, config.maxToolDescriptionChars),
      ),
    });
    const nextTool = combinedToolAnswer(toolEvaluation.answers.nextTool, familyAnswer);

    return {
      nextTool,
      done,
      ranked: ranked(nextTool),
      model: toolEvaluation.model,
      usage: sumUsage(familyEvaluation.usage, toolEvaluation.usage),
      latencyMs: Math.round(performance.now() - started),
      calls: 2,
      catalogSize,
      selectedFamily,
    };
  }

  return Object.freeze({
    evaluate(state: RouterState, tools: ToolCatalog) {
      const size = Object.keys(tools).length;
      return size <= MAX_DIRECT_TOOLS ? direct(state, tools) : hierarchical(state, tools);
    },
  });
}
