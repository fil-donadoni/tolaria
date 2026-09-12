---
title: The browser stack journal sees only the Bot's moves, so almost no live window is judgeable
discoveredBy: 3480
status: draft
confidence: high
---

**What is wrong.** Issue #3480 shipped the stack journal on the reasoning that
"the client drives both seats and already knows every move it sends". It does
know them — but not in one place. `useVsAiDriver` submits the BOT's moves and is
where the journal is fed; a human's move reaches the server through ~233
`api.game.*` call sites across the board components, with no shared chokepoint,
and none of them records a ply.

That is not a fidelity problem — the lowering fails closed on it
(`stack-not-journalled`, via the stack-shape comparison) — but it is a coverage
one, and a near-total one in the browser: this engine hands priority to the
NON-caster after a cast commits (`gre/activation.ts:1191/1869/2941`, and the
same in `applyMoveInSearch`), so the Bot never holds priority over its own
just-cast spell. Every window a live vs-AI game actually produces therefore
contains at least one human move — a cast to respond to, or the pass that
resolves the object whose trigger the Bot is now looking at.

**Evidence.** `src/lib/ai/stack-journal.ts` is fed from exactly one call site
(`src/hooks/useVsAiDriver.ts`, at `executeMove`). The engine-side journal is
fully exercised by the headless self-play loop, which drives both seats through
one loop and therefore records everything — which is why the lowering sweep
measures the real improvement and the browser does not see it.

**Why it may not deserve its own issue.** The fix is not one call site: it is
either a recorder threaded through the human's gesture hooks (`passPriority`
alone is two sites — `useControllerActions.ts:275`, `useAutoPassPhases.ts:61` —
and would already unlock the resolve-then-trigger window, but casts and
activations are many more), or a different shape entirely: derive the walk by
replaying `candidateMoves` against consecutive observed projections until one
reproduces the next state. The second is the complete answer and is a design
decision, not a wiring task — so this is a line on PRD #3397 rather than a
ticket until someone picks between them.
