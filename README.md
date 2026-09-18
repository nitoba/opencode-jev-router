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

## Install

Set the TypeSafe API key in the environment:

```sh
export TYPESAFE_API_KEY="..."
```

For development from this repository:

```sh
git clone https://github.com/nitoba/opencode-jev-router
cd opencode-jev-router
bun install
bun run build
```

Then reference the local package from `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-jev-router",
      "options": {
        "mode": "shortlist"
      }
    }
  ]
}
```

OpenCode 2 also accepts Git package specifications. After cloning/installing dependencies, a Git
install runs this package's `prepare` script and builds `dist`:

```sh
opencode plugin add github:nitoba/opencode-jev-router
```

## Configuration

A practical starting point:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:nitoba/opencode-jev-router",
      "options": {
        "mode": "shortlist",

        "hardThreshold": 0.8,
        "softThreshold": 0.55,
        "doneThreshold": 0.7,
        "topK": 3,

        "model": "jev-latest",
        "timeout": "2 seconds",
        "retry": false,

        "modelOptions": {
          "openai": {
            "reasoningEffort": "low"
          }
        }
      }
    }
  ]
}
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `"shortlist"` | `observe`, `shortlist`, or `strict` |
| `apiKeyEnv` | `"TYPESAFE_API_KEY"` | Environment variable containing the TypeSafe key |
| `model` | `"jev-latest"` | TypeSafe System One model |
| `baseURL` | TypeSafe default | Optional compatible TypeSafe/System One base URL |
| `timeout` | `"2 seconds"` | Total Questions/TypeSafe request budget |
| `retry` | `false` | HTTP retries; `0..10` means additional retry count policy |
| `hardThreshold` | `0.8` | At or above this confidence, expose only the selected tool |
| `softThreshold` | `0.55` | At or above this confidence, expose the top-K tools |
| `doneThreshold` | `0.7` | Independent probability required before removing all tools |
| `topK` | `3` | Shortlist size in the medium-confidence band |
| `minTools` | `2` | Skip Jev when the catalog is already smaller than this |
| `maxToolDescriptionChars` | `900` | Bound the description/schema summary sent per tool |
| `debug` | `false` | Emit routing metadata without prompts, args, results, or credentials |
| `modelOptions` | `{}` | Provider-ID keyed OpenCode options applied only after successful routing |

`softThreshold` must be less than or equal to `hardThreshold`. Unknown configuration keys are
rejected so typos do not silently change routing behavior.

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
      "reasoningEffort": "low"
    }
  }
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
bun run build
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
