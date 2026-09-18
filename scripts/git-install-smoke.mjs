import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "opencode-jev-router-git-"));
const source = join(temp, "source");
const consumer = join(temp, "consumer");

const withoutBun = (process.env.PATH ?? "")
  .split(delimiter)
  .filter((entry) => !entry.toLowerCase().includes("bun"))
  .join(delimiter);

const env = {
  ...process.env,
  PATH: withoutBun,
};

try {
  execFileSync("git", ["clone", "--local", root, source], {
    env,
    stdio: "inherit",
  });

  mkdirSync(consumer, { recursive: true });
  execFileSync("npm", ["init", "-y"], {
    cwd: consumer,
    env,
    stdio: "ignore",
  });

  execFileSync("npm", ["install", `git+file://${source}`], {
    cwd: consumer,
    env,
    stdio: "inherit",
  });

  const installed = join(consumer, "node_modules", "opencode-jev-router", "dist", "index.js");
  await import(pathToFileURL(installed).href);

  console.log("git dependency install smoke passed without Bun in PATH");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
