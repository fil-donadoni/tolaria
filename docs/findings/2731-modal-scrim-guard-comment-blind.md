---
title: modal-scrim.guard.test.ts's per-site check is comment-blind — a removed scrim can still pass
discoveredBy: 2731
status: draft
confidence: medium
---

**What is wrong.** The "every known full-screen overlay site uses the shared
utility" check in `src/components/__tests__/modal-scrim.guard.test.ts` asserts
`readFileSync(site).includes("modal-scrim")` for each file in its `SITES`
list. That is a raw substring match over the WHOLE file, including comments —
so a file whose actual scrim `className` is reverted to a bare `bg-black/50`
(or removed) still passes as long as a nearby comment happens to mention the
string `modal-scrim`.

**Evidence.** While adding `components/board/controller-phase-sheet.tsx` and
`components/ui/anchored-picker.tsx` to `SITES` (issue #2731), I proved the
positive case (the assertion fails when the string is absent entirely) but
also tried removing ONLY the `className`'s `modal-scrim` token while leaving
my own explanatory comment above it (which itself says
`` `modal-scrim` (ADR 0103 §5, issue #2731): this bespoke sheet adopts the
SAME scrim `` and similar). The guard still passed — 3/3 green — because the
comment carries the literal substring. A regression that silently drops the
scrim class while leaving the surrounding prose intact (a very plausible
future edit — e.g. someone "cleaning up" the className and forgetting the
comment references it) would ship undetected.

**Why it may not deserve its own issue.** The guard was already written this
way for every other site on the list (action-sheet.tsx, dialog.tsx,
card-preview.tsx, …), most of which also carry a comment naming `modal-scrim`
near their usage — so this is not a defect introduced by #2731, just an
existing weakness the sweep happened to touch. Tightening it (e.g. asserting
the string appears specifically inside a `className={...}` / template
literal, or stripping comments first the way `design-tokens.test.ts`'s
`stripComments` helper does for CSS) is a small, mechanical fix, but it is
change to a shared guard file whose blast radius is every site on the list,
not something this ticket's scope covers.
