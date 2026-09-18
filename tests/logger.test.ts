import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../src/logger.ts";

test("debug logging writes structured events to the project .opencode directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "opencode-jev-router-"));

  try {
    const logger = createLogger(true, directory);
    logger.event("plugin.loaded", {
      provider: "vercel",
      model: "typesafe-ai/jev",
    });

    expect(logger.file).toBe(join(directory, ".opencode", "opencode-jev-router.log"));
    const log = readFileSync(logger.file!, "utf8");
    expect(log).toContain('"event":"plugin.loaded"');
    expect(log).toContain('"provider":"vercel"');
    expect(log).toContain('"model":"typesafe-ai/jev"');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
