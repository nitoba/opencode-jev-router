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

const INITIAL_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 300_000;

export class RateLimitCircuitBreaker {
  private blockedUntil = 0;
  private cooldownMs = 0;
  private consecutiveRateLimits = 0;
  private probeInFlight = false;

  attempt(now = Date.now()): RateLimitAttempt {
    if (this.blockedUntil === 0) {
      return { allowed: true, probe: false, remainingMs: 0 };
    }

    if (now < this.blockedUntil) {
      return {
        allowed: false,
        probe: false,
        remainingMs: this.blockedUntil - now,
      };
    }

    if (this.probeInFlight) {
      return { allowed: false, probe: false, remainingMs: 0 };
    }

    this.probeInFlight = true;
    return { allowed: true, probe: true, remainingMs: 0 };
  }

  rateLimited(now = Date.now()): RateLimitOpened {
    this.probeInFlight = false;
    this.consecutiveRateLimits += 1;
    this.cooldownMs =
      this.cooldownMs === 0
        ? INITIAL_COOLDOWN_MS
        : Math.min(this.cooldownMs * 2, MAX_COOLDOWN_MS);
    this.blockedUntil = now + this.cooldownMs;

    return {
      cooldownMs: this.cooldownMs,
      blockedUntil: this.blockedUntil,
      consecutiveRateLimits: this.consecutiveRateLimits,
    };
  }

  succeeded(): RateLimitRecovered | undefined {
    if (this.blockedUntil === 0 && !this.probeInFlight) return undefined;

    const recovered = {
      previousCooldownMs: this.cooldownMs,
      consecutiveRateLimits: this.consecutiveRateLimits,
    };
    this.blockedUntil = 0;
    this.cooldownMs = 0;
    this.consecutiveRateLimits = 0;
    this.probeInFlight = false;
    return recovered;
  }

  failedProbe(now = Date.now()): void {
    if (!this.probeInFlight) return;
    this.probeInFlight = false;
    this.blockedUntil = now + Math.max(this.cooldownMs, INITIAL_COOLDOWN_MS);
  }
}
