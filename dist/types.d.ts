import type { BooleanAnswer, ChoiceAnswer, ConfidenceSource, JsonObject, ProbabilitySource, Usage } from "@nitoba/questions";
export declare const RESPOND_TO_USER: "__jev_router_respond_to_user__";
export type RouterMode = "observe" | "shortlist" | "strict";
export type RouterProvider = "typesafe" | "vercel";
export interface ToolDefinition {
    readonly description: string;
    readonly input: unknown;
}
export type ToolCatalog = Readonly<Record<string, ToolDefinition>>;
export interface RouterAction extends JsonObject {
    readonly step: number;
    readonly tool: string;
    readonly input: string;
    readonly result: string;
    readonly status: "completed" | "error";
}
export interface RouterState extends JsonObject {
    readonly user_request: string;
    readonly prior_user_messages: readonly string[];
    readonly actions_taken: readonly RouterAction[];
    readonly assistant_said: readonly string[];
}
export interface RouterConfig {
    readonly mode: RouterMode;
    readonly provider: RouterProvider;
    readonly apiKey?: string;
    readonly apiKeyEnv?: string;
    readonly model: string;
    readonly baseURL?: string;
    readonly timeout: string | number;
    readonly retry: false | number;
    readonly hardThreshold: number;
    readonly softThreshold: number;
    readonly doneThreshold: number;
    readonly topK: number;
    readonly minTools: number;
    readonly maxToolDescriptionChars: number;
    readonly debug: boolean;
    readonly modelOptions: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
export interface RankedTool {
    readonly name: string;
    readonly probability: number;
}
export interface RoutingEvaluation {
    readonly nextTool: ChoiceAnswer<string>;
    readonly done: BooleanAnswer;
    readonly ranked: readonly RankedTool[];
    readonly model: string;
    readonly usage: Usage;
    readonly latencyMs: number;
    readonly calls: 1 | 2;
    readonly catalogSize: number;
    readonly selectedFamily?: string;
}
export type RoutingPlan = {
    readonly kind: "respond";
    readonly selected: typeof RESPOND_TO_USER;
    readonly confidence: number;
    readonly doneProbability: number;
    readonly reason: "done";
} | {
    readonly kind: "tools";
    readonly selected: string;
    readonly tools: readonly string[];
    readonly confidence: number;
    readonly doneProbability: number;
    readonly reason: "strict" | "high-confidence" | "shortlist";
} | {
    readonly kind: "fallback";
    readonly confidence: number;
    readonly doneProbability: number;
    readonly reason: "low-confidence" | "no-tool-candidate" | "catalog-too-large" | "too-few-tools";
};
export interface RoutingTrace {
    readonly sessionID: string;
    readonly agent: string;
    readonly providerID: string;
    readonly modelID: string;
    readonly mode: RouterMode;
    readonly catalogSize: number;
    readonly selected?: string;
    readonly exposedTools?: readonly string[];
    readonly confidence?: number;
    readonly confidenceSource?: ConfidenceSource;
    readonly probabilitySource?: ProbabilitySource;
    readonly doneProbability?: number;
    readonly reason: string;
    readonly latencyMs?: number;
    readonly calls?: 1 | 2;
    readonly usage?: Usage;
    readonly selectedFamily?: string;
}
//# sourceMappingURL=types.d.ts.map