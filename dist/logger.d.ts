import type { RoutingTrace } from "./types.ts";
export interface RouterLogger {
    readonly file?: string;
    event(name: string, data?: Readonly<Record<string, unknown>>): void;
    debug(trace: RoutingTrace): void;
    warnOnce(key: string, message: string): void;
}
export declare function createLogger(enabled: boolean, directory: string): RouterLogger;
export declare function errorMessage(error: unknown): string;
//# sourceMappingURL=logger.d.ts.map