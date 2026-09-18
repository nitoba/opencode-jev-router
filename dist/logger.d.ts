import type { RoutingTrace } from "./types.ts";
export interface RouterLogger {
    debug(trace: RoutingTrace): void;
    warnOnce(key: string, message: string): void;
}
export declare function createLogger(enabled: boolean): RouterLogger;
export declare function errorMessage(error: unknown): string;
//# sourceMappingURL=logger.d.ts.map