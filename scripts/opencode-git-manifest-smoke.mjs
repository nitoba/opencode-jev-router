import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const forbidden = ["build", "prepare", "prepack"].filter((name) => pkg.scripts?.[name]);

if (forbidden.length > 0) {
  throw new Error(
    `OpenCode Git plugins must not define lifecycle-sensitive scripts: ${forbidden.join(", ")}`,
  );
}

console.log("OpenCode Git package manifest smoke passed");
