import type { AnyQuestion, EvaluationRequest, QuestionModel } from "@nitoba/questions";

export function fixture(
  answer: (question: AnyQuestion, key: string, request: EvaluationRequest) => unknown,
) {
  const calls: EvaluationRequest[] = [];
  const model: QuestionModel = {
    name: "fixture",
    async evaluate(request) {
      calls.push(request);
      return {
        model: "fixture-jev",
        usage: { inputTokens: 100, outputTokens: 2 },
        answers: Object.fromEntries(
          Object.entries(request.questions).map(([key, question]) => [
            key,
            answer(question, key, request),
          ]),
        ),
      };
    },
  };
  return { model, calls };
}

export function booleanEvidence(probability: number) {
  return { type: "boolean", probability } as const;
}

export function choiceEvidence(
  question: Extract<AnyQuestion, { type: "choice" }>,
  winner: string,
  confidence = 0.8,
) {
  const keys = Object.keys(question.criteria);
  if (!keys.includes(winner)) throw new Error(`Unknown fixture winner: ${winner}`);
  const rest = keys.filter((key) => key !== winner);
  const winnerProbability = rest.length === 0 ? 1 : 0.9;
  const remainder = rest.length === 0 ? 0 : (1 - winnerProbability) / rest.length;
  return {
    type: "choice",
    choice: winner,
    probabilities: Object.fromEntries(
      keys.map((key) => [key, key === winner ? winnerProbability : remainder]),
    ),
    confidence,
  };
}
