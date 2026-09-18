export interface RateLimitAttempt {
    readonly allowed: boolean;
    readonly probe: boolean;
    readonly remainingMs: number;
}
export interface RateLimitOpened {
    readonly cooldownMs: number;
    readonly blockedUntil: number;
    readonly consecutiveRateLimits: number;
}
export interface RateLimitRecovered {
    readonly previousCooldownMs: number;
    readonly consecutiveRateLimits: number;
}
export declare class RateLimitCircuitBreaker {
    private blockedUntil;
    private cooldownMs;
    private consecutiveRateLimits;
    private probeInFlight;
    attempt(now?: number): RateLimitAttempt;
    rateLimited(now?: number): RateLimitOpened;
    succeeded(): RateLimitRecovered | undefined;
    failedProbe(now?: number): void;
}
//# sourceMappingURL=rate-limit.d.ts.map