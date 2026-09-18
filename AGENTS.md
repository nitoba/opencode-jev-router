# Working on opencode-jev-router

- Target the OpenCode 2 plugin API. Tool selection belongs in `ctx.session.hook("context")`, before model dispatch; `tool.execute.before` is for already-selected tools and must not become the router.
- Keep `@nitoba/questions` as the semantic decision boundary. Production code must not call the TypeSafe/Jev SDK directly.
- The router replaces only tool-selection reasoning. The primary model still interprets context, fills tool arguments, consumes results and writes the final answer.
- Preserve fail-open behavior. Provider errors, timeouts, uncertain decisions and unsupported oversized catalogs must leave the original OpenCode tool set intact.
- Keep `nextTool` and `done` in one Questions batch for normal catalogs. Do not add a second paid inference when one evaluation can answer both.
- `respond_to_user` requires independent `done` evidence. Never end a task merely because it is the top choice when `done` is below the configured threshold.
- Do not send chain-of-thought, reasoning parts, provider metadata, credentials or binary content to the routing model. Keep state compact and action-oriented.
- Never log API keys, prompts, raw tool inputs/results or provider metadata. Debug traces contain only routing metadata, distributions reduced to the selected decision, usage and latency.
- For more than 254 tools, use the semantic family path only when it reduces the choice set safely. Otherwise fail open; do not invent arbitrary routing certainty.
- `observe` must never mutate tools or model options. `shortlist` uses confidence gates. `strict` narrows to one tool but still fails open on provider/runtime errors.
- Provider-specific primary-model options are opt-in and only apply after a successful tool-routing decision.
- Use Bun 1.4.2, TypeScript 7, Oxlint, Oxfmt and tsdown. Run `bun run check` before delivery.
- Public APIs require tests. Keep pure routing/state/policy logic independent from the OpenCode host so it can be tested without network calls.
- Do not publish to npm without explicit authorization.
