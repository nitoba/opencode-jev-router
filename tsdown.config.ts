import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "neutral",
  target: "es2023",
  clean: true,
  sourcemap: true,
  // TypeScript 7 emits declarations directly; avoid the legacy declaration compiler path.
  dts: false,
});
