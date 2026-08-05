#!/bin/sh
# PreToolUse deny policy for `Agent` spawns — the model tier and the role are
# declared, never inherited or guessed.
#
# Both rules replace a paragraph that demonstrably did not hold, and both are
# now MEASURED rather than asserted (`bun run loop:scorecard`):
#
#   * CLAUDE.md has said "Never omit the `model` parameter" for months. Over the
#     last 30 days of telemetry, **243 of 1,979 Agent spawns (12%) passed no
#     model** and therefore ran at whatever tier the parent session happened to
#     be — in an Opus/Fable session, the most expensive one, for work that was
#     often a read-only grep.
#   * **55% of agent tokens could not be attributed to a role**, because the
#     spawn declared neither a role in its description nor a specific type. That
#     is not an analysis problem to fix downstream: the information was never
#     recorded, so no report can recover it.
#
# The role lives in the DESCRIPTION, not in a dedicated agent definition. A new
# agent definition costs resident prompt tokens on every single request — the
# exact weight issue #2189 just removed — and would buy nothing here, because
# the role is per-spawn metadata, not a capability: an implement subagent's
# behaviour comes from the brief it reads, not from a system prompt.
#
# Contract: hook JSON on stdin, exit 0 to allow, exit 2 to BLOCK with stderr fed
# back to the model. Every denial names the fix — a policy that blocks without
# redirecting just produces a retry loop.

set -u

payload=$(cat)
tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""')

[ "$tool" = "Agent" ] || exit 0

model=$(printf '%s' "$payload" | jq -r '.tool_input.model // ""')
desc=$(printf '%s' "$payload" | jq -r '.tool_input.description // ""')
subtype=$(printf '%s' "$payload" | jq -r '.tool_input.subagent_type // ""')

deny() {
    printf '%s\n' "$1" >&2
    exit 2
}

# ─────────────────────────────────────────────────────────────────────────────
# Rule 1 — an explicit model tier.
#
# `fork` is exempt BY DESIGN, not by oversight: a fork always inherits the
# parent model and the `model` parameter is ignored for it, so requiring one
# would deny a spawn that cannot honour the requirement.
# ─────────────────────────────────────────────────────────────────────────────

if [ "$subtype" != "fork" ] && [ -z "$model" ]; then
    deny "Agent spawn has no \`model\`.

An omitted model inherits THIS session's tier — measured at 12% of spawns, and
in an Opus/Fable session that is the most expensive tier, often for a read-only
sweep. Pass it explicitly:

  model: sonnet   read-only work — locate, map, survey, research, mechanical edits
  model: opus     genuinely hard implementation, reasoning, or review
  model: haiku    trivial mechanical work

For an issue in a /process-gh-issues batch, take the tier from the plan
(\`bun run queue:plan\`) verbatim — never re-decide it per run."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Rule 2 — a role-prefixed description.
#
# Matched case-insensitively at the START of the description, so the role is
# machine-readable without constraining the rest of the sentence. The vocabulary
# is deliberately small and closed: a long list of near-synonyms would classify
# nothing, which is the state this rule exists to leave.
# ─────────────────────────────────────────────────────────────────────────────

if [ -z "$desc" ]; then
    deny "Agent spawn has no \`description\`.

The description is how every downstream report attributes the spawn's tokens to
a role. Start it with one of: implement, review, fixup, investigate, research,
verify, migrate, audit."
fi

case "$(printf '%s' "$desc" | tr '[:upper:]' '[:lower:]')" in
implement* | review* | fixup* | investigate* | research* | verify* | migrate* | audit*) ;;
*)
    deny "Agent spawn description does not start with a role.

  got: \"$desc\"

Start it with one of: implement, review, fixup, investigate, research, verify,
migrate, audit — then the rest of the sentence as you like:

  \"implement #2187 — loop scorecard\"
  \"investigate where pendingChoices is projected\"
  \"review PR #2211\"

Without a role, the spawn's tokens land in the scorecard's \`unclassified\`
bucket (measured at 55% of all agent tokens), and no later report can recover
what the spawn was for."
    ;;
esac

exit 0
