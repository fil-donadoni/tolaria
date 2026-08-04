# Action space — what this project offers a model, and what it deliberately doesn't

Issue #2189, PRD #2180.

Every agent type, plugin skill and MCP tool name available in a session sits in
the **resident prompt**. Two costs follow, and the second is the one that gets
underestimated:

1. **Token cost, paid per request.** Resident tokens are re-read on every single
   request for the life of the session. Measured on this project's telemetry,
   `cache_read` is **98.9%** of all input-side tokens — so a prefix token is not
   paid once, it is paid a few thousand times.
2. **Selection cost, paid per decision.** A crowded action space measurably
   degrades tool choice. A model working in an MTG rules engine written in
   TypeScript should not be choosing between a Laravel expert, a Terraform
   specialist and a Stripe Connect researcher.

The configuration lives in `~/.claude/`, **outside any git repository**, so this
document is the record rather than the mechanism. Its job is to make a future
re-addition a deliberate choice rather than silent drift back.

## Removed — user scope (`~/.claude/agents/`)

Moved to `~/.claude/agents-disabled/`, which carries its own README with restore
commands. **Nothing was deleted**; each is one `mv` and a restart from being back.

| Agent                      | Why it left                                 |
| -------------------------- | ------------------------------------------- |
| `api-architect`            | Laravel API specialist                      |
| `laravel-php-expert`       | Laravel 12 / Filament / Pest                |
| `performance-optimizer`    | framed as "Laravel + SPA"                   |
| `spa-coordinator`          | framed as "SPA consuming Laravel APIs"      |
| `gcp-devops-specialist`    | Docker / GCP deployment                     |
| `terraform-gcp-specialist` | Terraform IaC on GCP                        |
| `cavecrew-builder`         | **duplicate** of the caveman plugin's agent |
| `cavecrew-investigator`    | duplicate — byte-identical to the plugin's  |
| `cavecrew-reviewer`        | duplicate — byte-identical to the plugin's  |

> The user chose to prune at **user scope**, overriding #2189's original
> "nothing is removed at user scope" criterion. Claude Code offers no
> project-scoped way to hide a user-level agent, so the alternatives were
> user-scope pruning or no pruning at all. The parked directory plus the restore
> commands are what make that reversible.

**Kept:** `code-strategist`, `quality-auditor`, `typescript-expert`,
`frontend-specialist` — generic or directly relevant to a TypeScript/React
codebase.

### The duplicate is the interesting one

The three `cavecrew-*` agents were installed **twice**: once by hand under
`~/.claude/agents/`, once by the `caveman` plugin. Both were listed, both were
paid for, on every request — and the duplication was invisible because each copy
looked correct on its own.

It leaves one live consequence. The hand-installed `cavecrew-builder.md` pinned
`model: sonnet`; the plugin's copy pins **no** model, so it now inherits the
session tier (often Opus). The tier has to be passed at the call site:

```
Agent(subagent_type: "caveman:cavecrew-builder", model: "sonnet", …)
```

`scripts/__tests__/action-space.test.ts` fails if any agent-facing markdown in
this repo goes back to spawning a bare `cavecrew-<role>` — that name only ever
resolved through the duplicate.

## Removed — plugins (`~/.claude/settings.json`, `enabledPlugins`)

| Plugin                | Why it left                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `stripe`              | payments — no surface anywhere in this project                                                                       |
| `chrome-devtools-mcp` | a second browser automation stack, redundant with `claude-in-chrome`, which `.claude/rules/chrome-debug.md` mandates |

Both stay installed; flipping the flag back to `true` restores them.

## Removed — a duplicated hook registration

`~/.claude/settings.json` manually registered caveman's `SessionStart` and
`UserPromptSubmit` hooks, pointing at hand-installed copies under
`~/.claude/hooks/`. The **caveman plugin registers the same two hooks itself**.
Both fired: the full caveman preamble was injected **twice** into every session
and the tracker line twice into every turn.

The plugin's scripts are also the newer ones — they know about
`/caveman lite|full|ultra`, the hand-installed copies do not — so dropping the
manual registration keeps the better version and removes the duplicate.

This was the single largest item found, and it was not on anyone's list: the
pruning exercise was aimed at agents and plugins, and the duplicate hook only
surfaced because measuring the prompt meant reading what was actually in it.

## Kept deliberately

- **`superpowers`** — the user's chosen working method, not a stray install.
- **`caveman`** — same, and now registered exactly once.
- **`claude-in-chrome`** — the browser stack this project's rules mandate.
- The **`mcp__claude_ai_*` connector tools** (Asana, Box, Canva, Linear, Notion,
  …). These come from claude.ai account connectors, not from any file on this
  machine, so they cannot be pruned from the project side. Roughly 50 deferred
  tool names; each costs only its name, since schemas load on demand.

## When adding something back

Adding an agent, plugin or MCP server is not free and is not local: it is paid on
every request of every session in every project on this machine. Add it when
something in the rotation actually uses it, and add a row above when it is
project-relevant enough to be worth the record.
