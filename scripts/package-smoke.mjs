import assert from "node:assert/strict";
import plugin, { DEFAULT_CONFIG, RESPOND_TO_USER, parseConfig } from "../dist/index.js";

assert.equal(plugin.id, "opencode-jev-router");
assert.equal(DEFAULT_CONFIG.mode, "shortlist");
assert.equal(parseConfig({}).doneThreshold, 0.7);
assert.equal(RESPOND_TO_USER, "__jev_router_respond_to_user__");

console.log("package smoke passed");
