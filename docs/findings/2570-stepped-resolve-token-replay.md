---
title: A stepped resolveSteps body that creates a token in a parking step mints a second one on resume
discoveredBy: 2570
status: draft
confidence: medium
---

**What is wrong.** ADR 0100 D5 row C says a `createToken` that parks needs a
done-marker or the re-run creates a second token, and the Effect Script
executors carry one (`convex/gre/effects/interpreter.ts`, `createToken` and
`createTokenCopy`). The marker lives in the **Op executor**, so it protects the
Effect Script shape only. A stepped `resolveSteps` body that calls
`ctx.createToken` / `ctx.createTokenCopyOf` **directly** re-runs its parking step
from the beginning on resume — `top.resolutionStep = i` is committed before step
`i`, so step `i` replays whole — and mints a second permanent, which parks
again, and so on. Same bug class as #2570, different shape: here the resolution
genuinely has work left, so "do not suspend" is not the fix; the step needs its
own `recallChoice`/`noteChoice` commit marker (keyed by step, which is exactly
what `collectedChoices` gives it).

**Evidence.** `convex/gre/__tests__/asEntersPlainResolve.test.ts` registers
`test-2570-spell-stepped`, whose step 1 is a bare `ctx.createToken` of a spec
declaring `entersWith.asEnters`. Answering the park leaves the stack item still
present with a second staged entry pending — the assertion the test deliberately
stops short of, because pinning it would be pinning the bug. Reproduce by
extending that test past `answer(state, ["1"])`.

**Why it may not deserve its own issue.** No shipped card reaches it. The census
run for #2570 found exactly two `resolveSteps` bodies that touch a
battlefield-entry primitive — Sevinne's Reclamation
(`convex/cards/sets/c19/white.ts:41`) and Transmute Artifact
(`convex/cards/sets/atq/blue.ts:436`) — and both isolate the entry as the sole
content of its own step, which makes the replay harmless (the source zone no
longer holds the card, so the primitive fizzles). Both say so in their own
comments, i.e. the safe pattern is already the convention. So this is a latent
trap for the next author rather than a live defect; the cheapest form may be a
sentence in `.claude/rules/gre-development.md` plus the guarding test above,
not a ticket.
