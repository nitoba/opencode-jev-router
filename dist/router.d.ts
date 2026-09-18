import { type QuestionModel } from "@nitoba/questions";
import { type RouterConfig, type RouterState, type RoutingEvaluation, type ToolCatalog } from "./types.ts";
export declare const NEXT_TOOL_QUESTION: string;
export declare const DONE_QUESTION: string;
export declare class RouterCapacityError extends Error {
    readonly catalogSize: number;
    constructor(message: string, catalogSize: number);
}
export interface JevRouter {
    evaluate(state: RouterState, tools: ToolCatalog): Promise<RoutingEvaluation>;
}
export declare function createJevRouter(model: QuestionModel, config: RouterConfig): JevRouter;
//# sourceMappingURL=router.d.ts.map