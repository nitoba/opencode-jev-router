import { type ToolCatalog, type ToolDefinition } from "./types.ts";
export declare function describeTool(name: string, tool: ToolDefinition, maxChars: number): string;
export declare function toolCriteria(tools: ToolCatalog, maxChars: number): Readonly<Record<string, string>>;
export declare function toolCriteriaChars(tools: ToolCatalog, maxChars: number): number;
export declare function toolFamily(name: string): string;
export declare function groupToolsByFamily(tools: ToolCatalog): ReadonlyMap<string, Readonly<Record<string, ToolDefinition>>>;
export declare function describeFamily(family: string, tools: Readonly<Record<string, ToolDefinition>>, maxChars: number): string;
export declare function keepOnlyTools<T>(tools: Record<string, T>, allowed: readonly string[]): void;
export declare function clearTools<T>(tools: Record<string, T>): void;
export declare function mergeModelOptions(target: Record<string, unknown>, source: Readonly<Record<string, unknown>> | undefined): void;
//# sourceMappingURL=tools.d.ts.map