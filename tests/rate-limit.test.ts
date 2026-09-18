import { expect, test } from "bun:test";
import { RateLimitCircuitBreaker } from "../src/rate-limit.ts";

test("429 opens a 60 second cooldown and skips calls inside the window", () => {
  const breaker = new RateLimitCircuitBreaker();

  const opened = breaker.rateLimited(1_000);
  expect(opened.cooldownMs).toBe(60_000);
  expect(opened.blockedUntil).toBe(61_000);

  expect(breaker.attempt(30_000)).toEqual({
    allowed: false,
    probe: false,
    remainingMs: 31_000,
  });
});

test("the first call after cooldown is the only probe allowed concurrently", () => {
  const breaker = new RateLimitCircuitBreaker();
  breaker.rateLimited(0);

  expect(breaker.attempt(60_000)).toEqual({
    allowed: true,
    probe: true,
    remainingMs: 0,
  });
  expect(breaker.attempt(60_000)).toEqual({
    allowed: false,
    probe: false,
    remainingMs: 0,
  });
});

test("another 429 doubles cooldown up to five minutes", () => {
  const breaker = new RateLimitCircuitBreaker();

  expect(breaker.rateLimited(0).cooldownMs).toBe(60_000);
  expect(breaker.attempt(60_000).probe).toBe(true);
  expect(breaker.rateLimited(60_000).cooldownMs).toBe(120_000);

  expect(breaker.attempt(180_000).probe).toBe(true);
  expect(breaker.rateLimited(180_000).cooldownMs).toBe(240_000);

  expect(breaker.attempt(420_000).probe).toBe(true);
  expect(breaker.rateLimited(420_000).cooldownMs).toBe(300_000);

  expect(breaker.attempt(720_000).probe).toBe(true);
  expect(breaker.rateLimited(720_000).cooldownMs).toBe(300_000);
});

test("successful probe closes the circuit and resets backoff", () => {
  const breaker = new RateLimitCircuitBreaker();
  breaker.rateLimited(0);
  breaker.attempt(60_000);

  expect(breaker.succeeded()).toEqual({
    previousCooldownMs: 60_000,
    consecutiveRateLimits: 1,
  });
  expect(breaker.attempt(60_001)).toEqual({
    allowed: true,
    probe: false,
    remainingMs: 0,
  });
  expect(breaker.rateLimited(60_001).cooldownMs).toBe(60_000);
});

test("a non-429 probe failure keeps the circuit open without increasing backoff", () => {
  const breaker = new RateLimitCircuitBreaker();
  breaker.rateLimited(0);
  breaker.attempt(60_000);

  breaker.failedProbe(60_100);

  expect(breaker.attempt(61_000).allowed).toBe(false);
  expect(breaker.attempt(120_100)).toEqual({
    allowed: true,
    probe: true,
    remainingMs: 0,
  });
});
