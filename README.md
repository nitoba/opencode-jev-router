# opencode-jev-router

Jev-powered **tool-selection routing** for OpenCode 2, built on
[`@nitoba/questions`](https://github.com/nitoba/questions).

Instead of asking the primary LLM to compare every available tool on every agent step, the plugin
uses Jev immediately before model dispatch to decide which tool is most likely to be useful next.
The primary model then sees either one tool, a small shortlist, or the original catalog depending on
Jev's confidence.

This plugin does **not** replace the model's general reasoning. It only moves the decision
"which tool should I use next?" into a fast typed decision layer.

> Alpha: the repository currently targets the OpenCode 2 plugin API and `@nitoba/questions`
> `0.1.0-rc.3`. It has not been published to npm from this repository.

## How it works

OpenCode 2 runs the `context` hook immediately before each primary model call, including
tool-driven continuations. The hook exposes the assembled messages and a mutable tool catalog.

```text
user request
    |
    v
OpenCode agent loop
    |
    v
session context hook
    |
    +--> compact state
    |      - current request
    |      - previous successful/failed actions
    |      - tool results
    |      - recent assistant text
    |      - no reasoning / chain-of-thought
    |
    v
@nitoba/questions
    |
    +--> nextTool: choice(...)
    +--> done: boolean(...)
    |
    v
TypeSafe / Jev
    |
    v
routing policy
    |
    +-- high confidence --> expose one tool
    +-- medium          --> expose top-K
    +-- low             --> keep all tools
    +-- done            --> expose no tools
    |
    v
primary model
```

Normal catalogs use **one Jev evaluation** for both `nextTool` and `done`.

### Why `done` is separate

A top-ranked `respond_to_user` decision is not enough to end an agent loop. The plugin also asks
whether all requested work is already complete. If `respond_to_user` wins while `done` is below the
configured threshold, the router uses the next-best real tool instead.

### Oversized catalogs

A System One choice has a finite criteria limit. Up to 254 OpenCode tools are routed directly,
leaving one extra criterion for the internal `respond_to_user` option.

For larger catalogs the plugin first groups tools by semantic namespace/family, for example:

```text
mcp__GitHub__create_issue
mcp__GitHub__search
mcp__Linear__create_issue
calendar_create_event
calendar_find_slot
```

becomes roughly:

```text
mcp__GitHub
mcp__Linear
calendar
```

If the selected family is small enough, a second Jev evaluation chooses the concrete tool. If a
catalog cannot be reduced safely, routing fails open and the model receives the untouched tool set.

## Requirements

This plugin requires **OpenCode 2.x**. It uses the V2 plugin API and the pre-model context hook that can
mutate the tool catalog before each model dispatch. OpenCode 1.x does not expose an equivalent hook.

Check your version:

```sh
opencode --version
```

If it prints `1.x`, install OpenCode 2 before using this plugin.

## Install

Choose the decision provider first.

### Direct TypeSafe

```sh
export TYPESAFE_API_KEY="..."
```

### Vercel AI Gateway

```sh
export AI_GATEWAY_API_KEY="..."
```

Install the plugin:

```sh
opencode plugin add github:nitoba/opencode-jev-router
```

## Configuration

OpenCode 2 uses `plugins` and the `{ package, options }` form.

### TypeSafe / System One

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:nitoba/opencode-jev-router",
      "options": {
        "provider": "typesafe",
        "apiKeyEnv": "TYPESAFE_API_KEY",
        "model": "jev-latest",
        "mode": "shortlist",
        "debug": true
      }
    }
  ]
}
```

### Vercel AI Gateway / Jev

The Vercel integration uses the Gateway Evaluation V4 protocol, not the OpenAI-compatible `/v1`
route.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:nitoba/opencode-jev-router",
      "options": {
        "provider": "vercel",
        "apiKeyEnv": "AI_GATEWAY_API_KEY",
        "baseURL": "https://ai-gateway.vercel.sh/v4/ai",
        "model": "typesafe-ai/jev",
        "mode": "observe",
        "debug": true
      }
    }
  ]
}
```

For Vercel, `baseURL` and `model` can be omitted; those values are the defaults.

`apiKeyEnv` is the name of an environment variable, never the API key itself.

### Debugging

With `debug: true`, the plugin writes JSON Lines to:

```text
<project>/.opencode/opencode-jev-router.log
```

A healthy run contains `plugin.loaded`, then `jev.request.started`, followed by
`jev.request.completed` or `jev.request.failed`.

```sh
tail -f .opencode/opencode-jev-router.log
```

The debug log does not include the API key, raw prompts, complete tool arguments, or raw tool
results.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `provider` | `"typesafe"` | `typesafe` for System One or `vercel` for Vercel Evaluation V4 |
| `apiKeyEnv` | provider-specific | TypeSafe: `TYPESAFE_API_KEY`; Vercel: `AI_GATEWAY_API_KEY` |
| `model` | provider-specific | TypeSafe: `jev-latest`; Vercel: `typesafe-ai/jev` |
| `baseURL` | provider default | Custom endpoint using the selected provider protocol |
| `mode` | `"shortlist"` | `observe`, `shortlist`, or `strict` |
| `timeout` | `"2 seconds"` | Total Questions/provider request budget |
| `retry` | `false` | HTTP retry policy |
| `hardThreshold` | `0.8` | Expose only the selected tool at or above this confidence |
| `softThreshold` | `0.55` | Expose the top-K tools at or above this confidence |
| `doneThreshold` | `0.7` | Evidence required before removing all tools |
| `topK` | `3` | Medium-confidence shortlist size |
| `minTools` | `2` | Skip Jev when the catalog is already smaller |
| `debug` | `false` | Write sanitized routing events to the project debug log |

## Modes

### `observe`

Jev evaluates every eligible agent step, but the plugin does not mutate `event.tools` or primary
model options. Use this first to collect traces and compare the decisions with the model's normal
behavior.

### `shortlist`

Default production mode:

```text
confidence >= hardThreshold
    -> one tool

softThreshold <= confidence < hardThreshold
    -> top-K tools

confidence < softThreshold
    -> all original tools
```

### `strict`

Exposes only Jev's selected tool regardless of confidence. Provider errors and unsupported catalog
shapes still fail open.

## Primary-model reasoning options

The plugin never guesses provider-specific options. If you want to reduce the primary model's
tool-selection reasoning after successful routing, opt in explicitly per provider:

```jsonc
{
  "modelOptions": {
    "openai": {
      "reasoningEffort": "low",
    },
  },
}
```

The object is merged into OpenCode's existing request options only when the router actually narrows
the tool set. Fallback steps keep the model's normal settings.

## Fail-open guarantees

The original tool catalog is left untouched when:

- the TypeSafe key is missing;
- Jev/TypeSafe times out or returns an error;
- validated evidence cannot be produced;
- confidence is below `softThreshold` in `shortlist` mode;
- an oversized catalog cannot be reduced into a safe semantic family;
- fewer than `minTools` are available.

Routing is an optimization layer, not a new availability dependency for the agent.

## `@nitoba/questions`

The plugin deliberately does not call `@typesafe-ai/sdk` directly.

The normal decision is represented as one provider-neutral Questions batch:

```ts
const evidence = await questions.about(state).evidence({
  nextTool: Question.choice("Which tool should run next?", criteria),
  done: Question.boolean("Is every requested action already complete?"),
});
```

This keeps TypeSafe transport, validation, evidence provenance, confidence semantics, timeout and
retry behavior inside `@nitoba/questions`.

## Development

The tooling mirrors the `nitoba/questions` package:

```sh
bun install
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build:dist
bun run check
```

The project uses:

- Bun 1.4.2
- TypeScript 7
- tsdown
- Oxlint
- Oxfmt
- publint

Tests use deterministic `QuestionModel` fixtures; no live Jev key or paid inference is required.

## License

MIT
