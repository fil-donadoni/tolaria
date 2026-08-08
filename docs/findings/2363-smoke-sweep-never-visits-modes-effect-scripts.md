---
title: The DSL smoke sweep never visits modes[] Effect Scripts, so a modal card gets neither a smoke run nor a skip line
discoveredBy: 2363
status: draft
confidence: medium
---

**What is wrong.** `collectDslSites()` in
`convex/cards/__tests__/effectScriptSmoke.test.ts:50-74` enumerates a card's DSL
sites from exactly five places: `card.effects`, `card.activatedAbilities`,
`card.grantTemplates`, `card.triggeredAbilities` and
`card.triggeredGrantTemplates`. It never reads `card.modes[].effects`. A modal
card (CR 700.2) whose per-mode scripts are the whole of its behaviour therefore
contributes **zero** sites to the sweep — it is not run, and, because a site
that is never collected can never be planned, it does not appear in the sweep's
skip list either.

That second half is the load-bearing part. The per-Op test regime
(`.claude/rules/gre-development.md` § Per-Op test regime) makes an explicit
promise: a DSL card reusing exercised Ops needs no hand-written test because
"an un-scenarioizable script surfaces as an explicit skip — the signal to
hand-write a test after all". For a mode-site script that signal does not
exist. The card reads as covered by the automatic regime and is silently
outside it.

**Evidence.**

- `convex/cards/__tests__/effectScriptSmoke.test.ts:50-74` — the five-site
  collection, no `modes` branch. The consumer at `:170-182` iterates only what
  `collectDslSites()` returned, so a skip line can only exist for a collected
  site.
- `convex/cards/sets/ice/blue.ts:729` (Hydroblast) is the concrete instance: a
  modal instant with two single-Op mode scripts
  (`{ op: "counter", target: { target: 0 } }` at `:745`,
  `{ op: "destroy", target: { target: 0 } }` at `:752`) and **no** top-level
  `effects`, no activated/triggered abilities. The static validator does see it
  — `convex/cards/__tests__/effectScripts.test.ts:46` has a dedicated
  "every cast-time mode-site Effect Script passes validation (CR 700.2
  `modes[]`, issue #1274)" case — so schema, ref-check and Op vocabulary are
  covered; only the _resolution_ half is missing.
- This is how Hydroblast came to be mis-bucketed as "vanilla / pure data —
  nothing to test" in this PR's coverage split (corrected in the PR body): the
  split was computed from the sweep's own ran/skipped sets, and a card the
  sweep cannot see is absent from both.

**Why it may not deserve its own issue.** The blast pair is genuinely covered in
practice — Pyroblast's behaviour block (`convex/cards/sets/ice/__tests__/red.test.ts:304`)
exercises the mirror card, and the cast-time mode framework has its own tests
(`convex/cards/__tests__/modalSpells.test.ts`) — so no shipped card is actually
unproven today, and the population of pure-modal DSL cards is small enough to
enumerate by hand. The counter-argument is that the gap is in the _signal_, not
in today's coverage: the regime's whole claim is that silence means covered, and
here silence means invisible. The fix is small and local (add a `modes[]` branch
to `collectDslSites`, giving mode sites a synthetic label and letting
`planSmokeTest` decide run-or-skip), but it is a change to a catalogue sweep and
would land its own new skip lines, so it was deliberately kept out of #2363.
