import { z } from "zod";
import { Answer, Duration, ProviderError, Question, Questions, TypeSafe } from "@nitoba/questions";
import { Plugin } from "@opencode/plugin";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as Vercel from "@nitoba/questions/providers/vercel";
//#region src/config.ts
const probability = z.number().finite().min(0).max(1);
const modelOptions = z.record(z.string().min(1), z.record(z.string().min(1), z.unknown()));
const environmentVariable = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "apiKeyEnv must be an environment variable name, not the API key value");
const optionsSchema = z.object({
	mode: z.enum([
		"observe",
		"shortlist",
		"strict"
	]).default("shortlist"),
	provider: z.enum(["typesafe", "vercel"]).default("typesafe"),
	apiKey: z.string().min(1).optional(),
	apiKeyEnv: environmentVariable.optional(),
	model: z.string().min(1).optional(),
	baseURL: z.string().url().optional(),
	timeout: z.union([z.string().min(1), z.number().int().positive()]).default("2 seconds"),
	retry: z.union([z.literal(false), z.number().int().min(0).max(10)]).default(false),
	hardThreshold: probability.default(.8),
	softThreshold: probability.default(.55),
	doneThreshold: probability.default(.7),
	topK: z.number().int().min(1).max(254).default(3),
	minTools: z.number().int().min(1).default(2),
	maxToolDescriptionChars: z.number().int().min(160).max(4e3).default(600),
	debug: z.boolean().default(false),
	modelOptions: modelOptions.default({})
}).strict().superRefine((value, context) => {
	if (value.apiKey !== void 0 && value.apiKeyEnv !== void 0) context.addIssue({
		code: "custom",
		path: ["apiKey"],
		message: "Use either apiKey or apiKeyEnv, not both"
	});
	if (value.softThreshold > value.hardThreshold) context.addIssue({
		code: "custom",
		path: ["softThreshold"],
		message: "softThreshold must be less than or equal to hardThreshold"
	});
	if (!value.baseURL) return;
	const url = new URL(value.baseURL);
	if (value.provider === "typesafe" && url.hostname === "ai-gateway.vercel.sh") context.addIssue({
		code: "custom",
		path: ["baseURL"],
		message: "Vercel AI Gateway is not a System One endpoint. Use provider: \"vercel\" instead of \"typesafe\"."
	});
	if (value.provider === "vercel" && url.hostname === "ai-gateway.vercel.sh" && /^\/v1\/?$/.test(url.pathname)) context.addIssue({
		code: "custom",
		path: ["baseURL"],
		message: "The Vercel Jev provider uses the Evaluation V4 endpoint, not the OpenAI-compatible /v1 endpoint. Omit baseURL or use \"https://ai-gateway.vercel.sh/v4/ai\"."
	});
});
const DEFAULT_CONFIG = Object.freeze({
	mode: "shortlist",
	provider: "typesafe",
	apiKeyEnv: "TYPESAFE_API_KEY",
	model: "jev-latest",
	timeout: "2 seconds",
	retry: false,
	hardThreshold: .8,
	softThreshold: .55,
	doneThreshold: .7,
	topK: 3,
	minTools: 2,
	maxToolDescriptionChars: 600,
	debug: false,
	modelOptions: {}
});
function parseConfig(input) {
	const parsed = optionsSchema.parse(input ?? {});
	const defaultApiKeyEnv = parsed.provider === "vercel" ? "AI_GATEWAY_API_KEY" : "TYPESAFE_API_KEY";
	const model = parsed.model ?? (parsed.provider === "vercel" ? "typesafe-ai/jev" : "jev-latest");
	return {
		mode: parsed.mode,
		provider: parsed.provider,
		...parsed.apiKey === void 0 ? {} : { apiKey: parsed.apiKey },
		...parsed.apiKey !== void 0 ? {} : { apiKeyEnv: parsed.apiKeyEnv ?? defaultApiKeyEnv },
		model,
		...parsed.baseURL === void 0 ? {} : { baseURL: parsed.baseURL },
		timeout: parsed.timeout,
		retry: parsed.retry,
		hardThreshold: parsed.hardThreshold,
		softThreshold: parsed.softThreshold,
		doneThreshold: parsed.doneThreshold,
		topK: parsed.topK,
		minTools: parsed.minTools,
		maxToolDescriptionChars: parsed.maxToolDescriptionChars,
		debug: parsed.debug,
		modelOptions: parsed.modelOptions
	};
}
//#endregion
//#region src/types.ts
const RESPOND_TO_USER = "__jev_router_respond_to_user__";
//#endregion
//#region src/policy.ts
function createRoutingPlan(evaluation, availableTools, config) {
	const available = new Set(availableTools);
	const confidence = evaluation.nextTool.confidence;
	const doneProbability = evaluation.done.probability;
	let selected = evaluation.nextTool.choice;
	if (selected === "__jev_router_respond_to_user__") {
		if (doneProbability >= config.doneThreshold) return {
			kind: "respond",
			selected: RESPOND_TO_USER,
			confidence,
			doneProbability,
			reason: "done"
		};
		selected = evaluation.ranked.find(({ name }) => name !== "__jev_router_respond_to_user__" && available.has(name))?.name ?? "";
	}
	if (!selected || !available.has(selected)) return {
		kind: "fallback",
		confidence,
		doneProbability,
		reason: "no-tool-candidate"
	};
	if (config.mode === "strict") return {
		kind: "tools",
		selected,
		tools: [selected],
		confidence,
		doneProbability,
		reason: "strict"
	};
	if (confidence >= config.hardThreshold) return {
		kind: "tools",
		selected,
		tools: [selected],
		confidence,
		doneProbability,
		reason: "high-confidence"
	};
	if (confidence >= config.softThreshold) {
		const tools = evaluation.ranked.filter(({ name }) => name !== "__jev_router_respond_to_user__" && available.has(name)).slice(0, config.topK).map(({ name }) => name);
		if (!tools.includes(selected)) tools.unshift(selected);
		return {
			kind: "tools",
			selected,
			tools: tools.slice(0, config.topK),
			confidence,
			doneProbability,
			reason: "shortlist"
		};
	}
	return {
		kind: "fallback",
		confidence,
		doneProbability,
		reason: "low-confidence"
	};
}
//#endregion
//#region src/rate-limit.ts
const INITIAL_COOLDOWN_MS = 6e4;
const MAX_COOLDOWN_MS = 3e5;
var RateLimitCircuitBreaker = class {
	blockedUntil = 0;
	cooldownMs = 0;
	consecutiveRateLimits = 0;
	probeInFlight = false;
	attempt(now = Date.now()) {
		if (this.blockedUntil === 0) return {
			allowed: true,
			probe: false,
			remainingMs: 0
		};
		if (now < this.blockedUntil) return {
			allowed: false,
			probe: false,
			remainingMs: this.blockedUntil - now
		};
		if (this.probeInFlight) return {
			allowed: false,
			probe: false,
			remainingMs: 0
		};
		this.probeInFlight = true;
		return {
			allowed: true,
			probe: true,
			remainingMs: 0
		};
	}
	rateLimited(now = Date.now()) {
		this.probeInFlight = false;
		this.consecutiveRateLimits += 1;
		this.cooldownMs = this.cooldownMs === 0 ? INITIAL_COOLDOWN_MS : Math.min(this.cooldownMs * 2, MAX_COOLDOWN_MS);
		this.blockedUntil = now + this.cooldownMs;
		return {
			cooldownMs: this.cooldownMs,
			blockedUntil: this.blockedUntil,
			consecutiveRateLimits: this.consecutiveRateLimits
		};
	}
	succeeded() {
		if (this.blockedUntil === 0 && !this.probeInFlight) return void 0;
		const recovered = {
			previousCooldownMs: this.cooldownMs,
			consecutiveRateLimits: this.consecutiveRateLimits
		};
		this.blockedUntil = 0;
		this.cooldownMs = 0;
		this.consecutiveRateLimits = 0;
		this.probeInFlight = false;
		return recovered;
	}
	failedProbe(now = Date.now()) {
		if (!this.probeInFlight) return;
		this.probeInFlight = false;
		this.blockedUntil = now + Math.max(this.cooldownMs, INITIAL_COOLDOWN_MS);
	}
};
//#endregion
//#region src/tools.ts
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clip$1(value, max) {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 14))}…[truncated]`;
}
function compact(value) {
	return value.replace(/\s+/g, " ").trim();
}
function schemaType(schema) {
	if (!isRecord$1(schema)) return "unknown";
	if (typeof schema.type === "string") return schema.type;
	if (Array.isArray(schema.type)) {
		const values = schema.type.filter((item) => typeof item === "string");
		if (values.length > 0) return values.join("|");
	}
	if (Array.isArray(schema.enum)) return `enum(${schema.enum.map(String).slice(0, 6).join("|")})`;
	if (Array.isArray(schema.oneOf)) return "oneOf";
	if (Array.isArray(schema.anyOf)) return "anyOf";
	return "unknown";
}
function summarizeInputSchema(input) {
	if (!isRecord$1(input)) return "unspecified input";
	const properties = isRecord$1(input.properties) ? input.properties : void 0;
	if (!properties) return `input type: ${schemaType(input)}`;
	const required = new Set(Array.isArray(input.required) ? input.required.filter((item) => typeof item === "string") : []);
	const fields = Object.entries(properties).slice(0, 16).map(([name, schema]) => `${name}:${schemaType(schema)}${required.has(name) ? "!" : ""}`);
	if (fields.length === 0) return "no input fields";
	const suffix = Object.keys(properties).length > fields.length ? ", …" : "";
	return `inputs: ${fields.join(", ")}${suffix}`;
}
function describeTool(name, tool, maxChars) {
	return clip$1(`${compact(tool.description) || `Tool ${name}.`} ${summarizeInputSchema(tool.input)}`, maxChars);
}
function toolCriteria(tools, maxChars) {
	if (Object.hasOwn(tools, "__jev_router_respond_to_user__")) throw new Error(`Tool name "${RESPOND_TO_USER}" is reserved by opencode-jev-router.`);
	return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, describeTool(name, tool, maxChars)]));
}
function toolCriteriaChars(tools, maxChars) {
	return JSON.stringify(toolCriteria(tools, maxChars)).length;
}
function toolFamily(name) {
	if (name.includes("__")) {
		const parts = name.split("__").filter(Boolean);
		if (parts.length >= 2) return `${parts[0]}__${parts[1]}`;
	}
	const scoped = name.split(/[.:/]/, 1)[0];
	if (scoped && scoped !== name) return scoped;
	const underscored = name.split("_", 1)[0];
	if (underscored && underscored !== name) return underscored;
	return name.split("-", 1)[0] || name;
}
function groupToolsByFamily(tools) {
	const groups = /* @__PURE__ */ new Map();
	for (const [name, tool] of Object.entries(tools)) {
		const family = toolFamily(name);
		const group = groups.get(family) ?? {};
		group[name] = tool;
		groups.set(family, group);
	}
	return groups;
}
function describeFamily(family, tools, maxChars) {
	const entries = Object.entries(tools);
	const sampleCount = Math.min(entries.length, 8);
	const perToolChars = Math.max(48, Math.floor(maxChars / Math.max(sampleCount, 1)) - 24);
	const sample = entries.slice(0, sampleCount).map(([name, tool]) => {
		return `${name}: ${clip$1(compact(tool.description) || "No description", perToolChars)}`;
	}).join(" | ");
	const suffix = entries.length > sampleCount ? ` | … ${entries.length - sampleCount} more` : "";
	return clip$1(`Family ${family}: ${entries.length} tool(s). ${sample}${suffix}`, maxChars);
}
function keepOnlyTools(tools, allowed) {
	const keep = new Set(allowed);
	for (const name of Object.keys(tools)) if (!keep.has(name)) delete tools[name];
}
function clearTools(tools) {
	for (const name of Object.keys(tools)) delete tools[name];
}
function mergeRecord(target, source) {
	for (const [key, value] of Object.entries(source)) {
		const current = target[key];
		if (isRecord$1(current) && isRecord$1(value)) {
			mergeRecord(current, value);
			continue;
		}
		target[key] = value;
	}
}
function mergeModelOptions(target, source) {
	if (source) mergeRecord(target, source);
}
//#endregion
//#region src/router.ts
const MAX_DIRECT_TOOLS = 254;
const MAX_SECOND_STAGE_TOOLS = 255;
const NEXT_TOOL_QUESTION = `
Choose the single tool the coding agent should call NEXT. Use the current request and recent tool
outcomes. Respect dependencies and avoid repeating successful actions. Retry a failed action only
when appropriate. Choose respond only when no further tool call is needed.
`.trim();
const DONE_QUESTION = `
Are all actions required by the current request already complete and successful? Return false when
any required lookup, edit, command, test, commit, push, message or recovery step is still missing.
`.trim();
const RESPOND_DESCRIPTION = "No tool call is needed: the current request is complete or no available tool applies.";
var RouterCapacityError = class extends Error {
	catalogSize;
	constructor(message, catalogSize) {
		super(message);
		this.name = "RouterCapacityError";
		this.catalogSize = catalogSize;
	}
};
function ranked(answer) {
	return Answer.rank(answer).map(({ value, probability }) => ({
		name: value,
		probability
	}));
}
function sumUsage(left, right) {
	const inputTokens = left.inputTokens === void 0 || right.inputTokens === void 0 ? void 0 : left.inputTokens + right.inputTokens;
	const outputTokens = left.outputTokens === void 0 || right.outputTokens === void 0 ? void 0 : left.outputTokens + right.outputTokens;
	return {
		...inputTokens === void 0 ? {} : { inputTokens },
		...outputTokens === void 0 ? {} : { outputTokens }
	};
}
function withRespond(criteria) {
	return {
		...criteria,
		[RESPOND_TO_USER]: RESPOND_DESCRIPTION
	};
}
function singleToolAnswer(name, family) {
	return {
		type: "choice",
		choice: name,
		probabilities: { [name]: 1 },
		confidence: family.confidence,
		probabilitySource: "custom",
		confidenceSource: "custom"
	};
}
function combinedToolAnswer(answer, family) {
	return {
		...answer,
		confidence: Math.min(answer.confidence, family.confidence),
		confidenceSource: "custom"
	};
}
function createJevRouter(model, config) {
	const questions = Questions.create({ model });
	async function direct(state, tools) {
		const started = performance.now();
		const evaluation = await questions.about(state).evidence({
			nextTool: Question.choice(NEXT_TOOL_QUESTION, withRespond(toolCriteria(tools, config.maxToolDescriptionChars))),
			done: Question.boolean(DONE_QUESTION, {
				true: "Every required action is complete and successful.",
				false: "At least one required action is missing, failed, or needs follow-up."
			})
		});
		return {
			nextTool: evaluation.answers.nextTool,
			done: evaluation.answers.done,
			ranked: ranked(evaluation.answers.nextTool),
			model: evaluation.model,
			usage: evaluation.usage,
			latencyMs: Math.round(performance.now() - started),
			calls: 1,
			catalogSize: Object.keys(tools).length
		};
	}
	async function hierarchical(state, tools) {
		const started = performance.now();
		const groups = groupToolsByFamily(tools);
		const catalogSize = Object.keys(tools).length;
		if (groups.size < 2 || groups.size > MAX_DIRECT_TOOLS) throw new RouterCapacityError(`Cannot safely reduce ${catalogSize} tools into at most ${MAX_DIRECT_TOOLS} semantic families.`, catalogSize);
		const familyCriteria = Object.fromEntries([...groups.entries()].map(([family, familyTools]) => [family, describeFamily(family, familyTools, config.maxToolDescriptionChars)]));
		const familyEvaluation = await questions.about(state).evidence({
			nextFamily: Question.choice("Which tool family contains the single best NEXT action for the coding agent?", withRespond(familyCriteria)),
			done: Question.boolean(DONE_QUESTION, {
				true: "Every required action is complete and successful.",
				false: "At least one required action is missing, failed, or needs follow-up."
			})
		});
		const familyAnswer = familyEvaluation.answers.nextFamily;
		const done = familyEvaluation.answers.done;
		let selectedFamily = familyAnswer.choice;
		if (selectedFamily === "__jev_router_respond_to_user__" && done.probability >= config.doneThreshold) return {
			nextTool: familyAnswer,
			done,
			ranked: ranked(familyAnswer),
			model: familyEvaluation.model,
			usage: familyEvaluation.usage,
			latencyMs: Math.round(performance.now() - started),
			calls: 1,
			catalogSize
		};
		if (selectedFamily === "__jev_router_respond_to_user__") selectedFamily = Answer.rank(familyAnswer).find(({ value }) => value !== "__jev_router_respond_to_user__")?.value ?? "";
		const selectedTools = groups.get(selectedFamily);
		if (!selectedTools) throw new RouterCapacityError("Jev did not return a usable tool family for the oversized catalog.", catalogSize);
		const entries = Object.entries(selectedTools);
		if (entries.length > MAX_SECOND_STAGE_TOOLS) throw new RouterCapacityError(`Tool family "${selectedFamily}" still contains ${entries.length} tools, above the second-stage limit.`, catalogSize);
		if (entries.length === 1) {
			const name = entries[0][0];
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
				selectedFamily
			};
		}
		const toolEvaluation = await questions.about(state).evidence({ nextTool: Question.choice(`Within the selected "${selectedFamily}" family, which tool should run NEXT?`, toolCriteria(selectedTools, config.maxToolDescriptionChars)) });
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
			selectedFamily
		};
	}
	return Object.freeze({ evaluate(state, tools) {
		return Object.keys(tools).length <= MAX_DIRECT_TOOLS ? direct(state, tools) : hierarchical(state, tools);
	} });
}
//#endregion
//#region src/state.ts
const MAX_USER_MESSAGES = 2;
const MAX_ASSISTANT_MESSAGES = 2;
const MAX_ACTIONS = 8;
const MAX_USER_TEXT_CHARS = 1200;
const MAX_ASSISTANT_TEXT_CHARS = 600;
const MAX_ACTION_INPUT_CHARS = 400;
const MAX_ACTION_RESULT_CHARS = 800;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clip(value, max) {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 14))}…[truncated]`;
}
function printable(value, max) {
	if (typeof value === "string") return clip(value, max);
	try {
		return clip(JSON.stringify(value) ?? String(value), max);
	} catch {
		return clip(String(value), max);
	}
}
function pushRecent(values, value, max) {
	values.push(value);
	if (values.length > max) values.splice(0, values.length - max);
}
function textParts(content) {
	if (!Array.isArray(content)) return "";
	return content.flatMap((part) => {
		if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return [];
		return [part.text];
	}).join("\n").trim();
}
function toolResultValue(result) {
	if (!isRecord(result)) return {
		status: "completed",
		value: result
	};
	return {
		status: result.type === "error" ? "error" : "completed",
		value: "value" in result ? result.value : result
	};
}
/**
* Convert OpenCode's assembled LLM messages into a small operational state for semantic routing.
* Only recent user intent, assistant progress and completed tool outcomes are retained.
* Reasoning, media, provider metadata and raw binary content are intentionally excluded.
*/
function buildRouterState(messages) {
	const userMessages = [];
	const assistantMessages = [];
	const actions = [];
	const pending = /* @__PURE__ */ new Map();
	let step = 0;
	for (const message of messages) {
		if (!isRecord(message) || typeof message.role !== "string") continue;
		const content = message.content;
		if (message.role === "user") {
			const text = textParts(content);
			if (text) pushRecent(userMessages, clip(text, MAX_USER_TEXT_CHARS), MAX_USER_MESSAGES);
			continue;
		}
		if (message.role === "assistant") {
			const text = textParts(content);
			if (text) pushRecent(assistantMessages, clip(text, MAX_ASSISTANT_TEXT_CHARS), MAX_ASSISTANT_MESSAGES);
			if (!Array.isArray(content)) continue;
			for (const part of content) {
				if (!isRecord(part) || part.type !== "tool-call" || typeof part.id !== "string" || typeof part.name !== "string") continue;
				step += 1;
				pending.set(part.id, {
					step,
					tool: part.name,
					input: printable(part.input, MAX_ACTION_INPUT_CHARS)
				});
			}
			continue;
		}
		if (message.role !== "tool" || !Array.isArray(content)) continue;
		for (const part of content) {
			if (!isRecord(part) || part.type !== "tool-result" || typeof part.id !== "string" || typeof part.name !== "string") continue;
			const call = pending.get(part.id) ?? {
				step: ++step,
				tool: part.name,
				input: ""
			};
			const result = toolResultValue(part.result);
			pushRecent(actions, {
				...call,
				status: result.status,
				result: printable(result.value, MAX_ACTION_RESULT_CHARS)
			}, MAX_ACTIONS);
			pending.delete(part.id);
		}
	}
	return {
		user_request: userMessages.at(-1) ?? "",
		prior_user_messages: userMessages.slice(0, -1),
		actions_taken: actions,
		assistant_said: assistantMessages
	};
}
//#endregion
//#region src/logger.ts
function createLogger(enabled, directory) {
	const warned = /* @__PURE__ */ new Set();
	const file = enabled ? join(directory, ".opencode", "opencode-jev-router.log") : void 0;
	if (file) try {
		mkdirSync(join(directory, ".opencode"), { recursive: true });
	} catch {}
	const write = (event, data = {}) => {
		if (!enabled) return;
		const record = {
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			event,
			...data
		};
		const line = JSON.stringify(record);
		console.info("[opencode-jev-router]", line);
		if (!file) return;
		try {
			appendFileSync(file, `${line}\n`, "utf8");
		} catch {}
	};
	return {
		...file === void 0 ? {} : { file },
		event: write,
		debug(trace) {
			write("router.decision", { ...trace });
		},
		warnOnce(key, message) {
			if (warned.has(key)) return;
			warned.add(key);
			console.warn(`[opencode-jev-router] ${message}`);
			write("router.warning", { message });
		}
	};
}
function errorMessage(error) {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return "Unknown routing error";
}
//#endregion
//#region src/provider.ts
function createDecisionModel(config, apiKey) {
	const common = {
		apiKey,
		model: config.model,
		...config.baseURL === void 0 ? {} : { baseURL: config.baseURL },
		timeout: Duration.parse(config.timeout),
		retry: config.retry
	};
	if (config.provider === "vercel") return Vercel.create(common);
	return TypeSafe.create(common);
}
//#endregion
//#region src/plugin.ts
function readEnvironment(name) {
	return globalThis.process?.env?.[name];
}
function isRateLimitError(error) {
	return error instanceof ProviderError && error.status === 429;
}
function routingTrace(event, mode, catalogSize, reason) {
	return {
		sessionID: event.sessionID,
		agent: event.agent,
		providerID: event.model.providerID,
		modelID: event.model.id,
		mode,
		catalogSize,
		reason
	};
}
function inputMetrics(state, tools, maxToolDescriptionChars) {
	return {
		stateChars: JSON.stringify(state).length,
		toolCriteriaChars: toolCriteriaChars(tools, maxToolDescriptionChars),
		actionsCount: state.actions_taken.length,
		userMessagesCount: state.prior_user_messages.length + (state.user_request.length === 0 ? 0 : 1),
		assistantMessagesCount: state.assistant_said.length
	};
}
function withTokenDensity(metrics, inputTokens, catalogSize) {
	if (inputTokens === void 0 || catalogSize === 0) return metrics;
	return {
		...metrics,
		inputTokensPerTool: Math.round(inputTokens / catalogSize * 100) / 100
	};
}
var plugin_default = Plugin.define({
	id: "opencode-jev-router",
	async setup(ctx) {
		const config = parseConfig(ctx.options);
		const logger = createLogger(config.debug, ctx.location.directory);
		const apiKey = config.apiKey ?? (config.apiKeyEnv ? readEnvironment(config.apiKeyEnv) : void 0);
		const credentialSource = config.apiKey === void 0 ? "environment" : "inline";
		logger.event("plugin.loaded", {
			provider: config.provider,
			model: config.model,
			mode: config.mode,
			credentialSource,
			...logger.file === void 0 ? {} : { logFile: logger.file }
		});
		if (!apiKey) {
			logger.warnOnce("missing-api-key", "Provider credentials are unavailable; Jev routing is disabled and OpenCode will keep its normal tool selection.");
			return;
		}
		const router = createJevRouter(createDecisionModel(config, apiKey), config);
		const rateLimit = new RateLimitCircuitBreaker();
		const registration = await ctx.session.hook("context", async (event) => {
			const catalogSize = Object.keys(event.tools).length;
			if (catalogSize < config.minTools) {
				logger.debug(routingTrace(event, config.mode, catalogSize, "too-few-tools"));
				return;
			}
			const attempt = rateLimit.attempt();
			if (!attempt.allowed) return;
			if (attempt.probe) logger.event("router.rate_limit.probe", {
				sessionID: event.sessionID,
				provider: config.provider,
				model: config.model
			});
			const tools = event.tools;
			const state = buildRouterState(event.messages);
			try {
				const metrics = inputMetrics(state, tools, config.maxToolDescriptionChars);
				logger.event("jev.request.started", {
					sessionID: event.sessionID,
					catalogSize,
					provider: config.provider,
					model: config.model,
					...metrics
				});
				const evaluation = await router.evaluate(state, tools);
				const recovered = rateLimit.succeeded();
				if (recovered) logger.event("router.rate_limit.recovered", {
					sessionID: event.sessionID,
					provider: config.provider,
					model: config.model,
					...recovered
				});
				const measured = withTokenDensity(metrics, evaluation.usage.inputTokens, catalogSize);
				const plan = createRoutingPlan(evaluation, Object.keys(event.tools), config);
				const trace = {
					...routingTrace(event, config.mode, catalogSize, plan.reason),
					...plan.kind === "fallback" ? {} : { selected: plan.selected },
					...plan.kind === "tools" ? { exposedTools: plan.tools } : {},
					confidence: evaluation.nextTool.confidence,
					...evaluation.nextTool.confidenceSource === void 0 ? {} : { confidenceSource: evaluation.nextTool.confidenceSource },
					...evaluation.nextTool.probabilitySource === void 0 ? {} : { probabilitySource: evaluation.nextTool.probabilitySource },
					doneProbability: evaluation.done.probability,
					latencyMs: evaluation.latencyMs,
					calls: evaluation.calls,
					usage: evaluation.usage,
					...measured,
					...evaluation.selectedFamily === void 0 ? {} : { selectedFamily: evaluation.selectedFamily }
				};
				logger.event("jev.request.completed", {
					sessionID: event.sessionID,
					latencyMs: evaluation.latencyMs,
					calls: evaluation.calls,
					confidence: evaluation.nextTool.confidence,
					doneProbability: evaluation.done.probability,
					...evaluation.usage.inputTokens === void 0 ? {} : { inputTokens: evaluation.usage.inputTokens },
					...evaluation.usage.outputTokens === void 0 ? {} : { outputTokens: evaluation.usage.outputTokens },
					...measured
				});
				logger.debug(trace);
				if (config.mode === "observe" || plan.kind === "fallback") return;
				if (plan.kind === "respond") {
					clearTools(event.tools);
					event.system.push({
						type: "text",
						text: "No further tool call is needed for this step. Answer the user from the completed work and available results."
					});
					logger.event("router.applied", {
						sessionID: event.sessionID,
						action: "respond"
					});
					return;
				}
				keepOnlyTools(event.tools, plan.tools);
				mergeModelOptions(event.options, config.modelOptions[event.model.providerID]);
				logger.event("router.applied", {
					sessionID: event.sessionID,
					action: "tools",
					exposedTools: plan.tools
				});
			} catch (error) {
				if (error instanceof RouterCapacityError) {
					if (attempt.probe) rateLimit.failedProbe();
					logger.debug(routingTrace(event, config.mode, catalogSize, "catalog-too-large"));
					return;
				}
				const message = errorMessage(error);
				logger.event("jev.request.failed", {
					sessionID: event.sessionID,
					error: message
				});
				if (isRateLimitError(error)) {
					const opened = rateLimit.rateLimited();
					logger.event("router.rate_limit", {
						sessionID: event.sessionID,
						provider: config.provider,
						model: config.model,
						status: error.status,
						...opened
					});
					logger.warnOnce(`rate-limit:${opened.consecutiveRateLimits}`, `Jev rate limited the router; routing is paused for ${Math.round(opened.cooldownMs / 1e3)}s and OpenCode will keep its normal tool selection.`);
					return;
				}
				if (attempt.probe) rateLimit.failedProbe();
				logger.warnOnce(`routing:${message}`, `Jev routing failed; falling back to OpenCode's normal tool selection. ${message}`);
			}
		});
		return () => registration.dispose();
	}
});
//#endregion
export { DEFAULT_CONFIG, DONE_QUESTION, NEXT_TOOL_QUESTION, RESPOND_TO_USER, RateLimitCircuitBreaker, RouterCapacityError, buildRouterState, createJevRouter, createRoutingPlan, plugin_default as default, describeFamily, describeTool, groupToolsByFamily, keepOnlyTools, mergeModelOptions, parseConfig, toolCriteria, toolCriteriaChars, toolFamily };

//# sourceMappingURL=index.js.map