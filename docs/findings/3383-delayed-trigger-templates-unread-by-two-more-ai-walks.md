---
title: choiceDepth and graveyardReach still walk abilities only, so a delayed-trigger template is invisible to both
discoveredBy: 3383
status: draft
confidence: medium
---

**What is wrong.** Issue #3383 gave the VALUE model a reader for
`CardDefinition.delayedTriggers[]`. Two other AI walks over the same definition
were left as they were, and both carry the same "an array no reader walks"
shape the issue closed for valuation:

- `convex/gre/ai/choiceDepth.ts` walks `modes` + `activatedAbilities` +
  `triggeredAbilities`. A template body containing a `choice` Op therefore
  contributes nothing to `catalogueChoiceDepth`, so the `MAX_CHOICE_DEPTH`
  bound is computed over a strict subset of the scripts the interpreter can
  actually run.
- `convex/gre/ai/graveyardReach.ts` reads spell + modes + abilities only. A
  template that returned a card from a graveyard would be invisible to
  `latentGraveyardValue`.

**Evidence.** Both walks enumerate the ability arrays literally and never read
`def.delayedTriggers`; compare `convex/gre/ai/cardScriptValue.ts`
(`delayedTriggerTemplateOpValue`), which now does. The catalogue's seven
`effects[]`-carrying templates are today a `draw`, a `destroy` and a
`sacrifice` — none is a `choice`, and none touches a graveyard — so neither
walk is wrong on any shipped card.

**Why it may not deserve its own issue.** The defect is entirely latent: it
needs a template body that no card has yet. The choiceDepth half is the more
defensible of the two — it bounds a search parameter, so a body it cannot see
is an under-count of a real bound rather than a missing valuation — but even
there the honest ticket may be "walk the array wherever a definition is walked"
as one sweep, rather than two narrow fixes.
