# ADR 0016 — Bot resolves interactive choices with a legal default; smart selection deferred to eval work

**Status:** Accepted (2026-06-16)

**Relates to:** [ADR 0001](0001-ai-opponent-client-side-ismcts.md) (the vs-AI
opponent). Smart selection is gated on the evaluation enrichment from the Forge
comparison effort.

## Context

The vs-AI bot freezes whenever a card resolution creates an **interactive
choice** that is not a mulligan bottom. Concretely: casting **Demonic Tutor**
enqueues a `search-library` `PendingChoice` for the bot, and the game hangs.

Root cause (confirmed via the diagnosis harness,
`convex/gre/__tests__/ai-diagnosis.test.ts`, and static trace):

- On a pending choice, `enumerateMoves` deliberately returns `[]`
  (`moves.ts`) — "a resolution choice is a continuation the executor drives
  atomically … surface nothing so the driver waits." `decidingPlayer` likewise
  returns `null` while `pendingChoices.length > 0`. So the **search produces no
  move**.
- The comment assumes the executor drives the choice. That is true only for the
  **human** (the UI renders the prompt). For the **bot** there is no policy to
  _make_ the choice — `decideBotAction` (`src/lib/ai/brain.ts`) handles only
  `mulligan-bottom`; every other `PendingChoice.kind` falls through to the
  ordinary priority window and returns `pass`, which the server rejects/no-ops →
  the state never advances → **freeze (P0)**.

This is a whole class: `search-library` (tutors), `scry`, discard selection,
modal spells (`charm`), `reorder-library`, reveal, etc.

## Decision

Give the bot a general resolution-choice path, in two layers mirroring the
existing mulligan handling:

1. **Surface the owed choice.** Generalise `buildBotView` (and the executor's
   `submitResolutionChoice` path) beyond `mulligan-bottom` so the bot recognises
   any `pendingChoices[0]` whose `playerId` is the bot.
2. **Default per-`kind` selection policy that always yields a LEGAL choice.**
   The point of this ADR is to **unfreeze**, so the selection is intentionally
   dumb for now — e.g. `search-library`: pick the required count by a trivial
   material heuristic; discard: shed the worst cards by material; modal: the
   first legal mode; reorder/scry: keep current order. The game always proceeds.

### Deferred (explicit)

**Smart selection is out of scope here and will be fixed as a follow-up to the
evaluation improvements** (the Forge-comparison eval enrichment: card-quality
valuation, keyword-weighted creature eval, threat assessment). Tutoring for the
_best_ card, optimal scry/discard/modal choices all require a real card-value
function the engine does not yet have. Until that lands, the bot makes **weak
but legal** choices on purpose. This ADR ships the P0 unfreeze, not the final
behaviour.

## Consequences

- **+** No more hangs on any choice-producing card — the entire class is
  unblocked with one plumbing change.
- **+** The plumbing (surface choice → submit choice) is built once; only the
  per-`kind` default policy grows over time.
- **−** The bot makes **suboptimal choices** (e.g. tutors a mediocre card) until
  the eval work lands. The weakness is bounded — choices stay legal and the game
  always advances; it is a quality gap, not a correctness one.
- **Validation:** an integration scenario per choice kind asserting the bot
  produces a _legal_ choice and the game advances (no freeze) — the tracer for
  `search-library` lives in
  `src/lib/ai/__tests__/resolution-choice-integration.test.ts`, which also pins
  the GRE boundary (search surfaces no move while a choice is pending). When the
  eval work lands, tighten these to assert choice _quality_ (e.g. Demonic Tutor
  fetches the highest-value card).

## Alternatives rejected

- **Build smart selection now.** Higher value, but entangles a P0 freeze with
  the large, open evaluation problem — it would delay the unfreeze for every
  choice-card behind eval work. Rejected: ship the unfreeze, defer the quality.
- **Make the human resolve the bot's choices / auto-pick server-side blindly.**
  Leaks control across seats or hides the decision from the AI layer entirely;
  the bot must own its own choices for the trace/debug story to hold.
