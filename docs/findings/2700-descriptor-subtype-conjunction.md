---
title: DescriptorIR does not record whether stacked subtypes are AND or OR, and every consumer encodes them as OR
discoveredBy: 2700
status: draft
confidence: high
---

**What is wrong.** `DescriptorIR.subtypes` is a flat `readonly string[]` filled
from two grammatically OPPOSITE sources, and nothing records which one a given
array came from:

- an **or-list noun** — `readNoun` (`convex/oracle/grammar/shared/targetFilter.ts:451`)
  splits `"Goblins or Elves"` on `" or "` and pushes both. Genuinely OR.
- **stacked adjectives** — `readAdjective` pushes each recognised subtype token
  as the descriptor's split loop walks left to right, so `"Eldrazi Spawn
creatures"` also arrives as `["Eldrazi", "Spawn"]`. That is **AND** in
  English: an Eldrazi Spawn is one creature type line, not two alternatives.

Every consumer then encodes the array into `PermanentFilter.subtypes`, which
`matchesPermanentFilter` (`convex/cards/filters.ts:370`) resolves with
`.some()` — OR. So the second reading is silently wrong at every site that
takes it.

**Evidence.** Issue #2700's static slot shipped it as a `ready` row before the
review caught it:

```
Broodwarden — "Eldrazi Spawn creatures you control get +2/+1."
  {"kind":"pt-buff","filter":{"types":["Creature"],"subtypes":["Eldrazi","Spawn"],
   "controllerRelation":"you"},"power":2,"toughness":1}
```

Board state: control Broodwarden and Emrakul, the Progenitus. Emrakul is a bare
Eldrazi, matches the OR filter, and reads as a 17/15.

`readNoun`'s own comment already names the identical problem for card TYPES and
refuses it — `"artifact creature"` cannot be expressed because
`PermanentFilter.types` is OR too, so the noun reader errors with
`"…" modifies a noun that is not "card"`. The subtype path has no equivalent
guard.

**What #2700 did about it.** Refused the shape at the static site only —
`staticFilterFromDescriptor` fails a descriptor carrying more than one subtype,
since it cannot tell the two readings apart. That is fail-closed and correct,
but it is a patch at one of three consumers, and it also refuses the legitimate
or-list (`"Goblins or Elves get +1/+1"`) because the information needed to keep
it was thrown away upstream.

**Why it may not deserve its own issue.** The other two consumers may not be
reachable today: `targetRequirementFromDescriptor` feeds
`TargetRequirement.subtypeFilter` and `permanentFilterFromDescriptor` feeds a
cost filter, and neither is obviously fed a multi-subtype ADJECTIVE phrase by
any line the grammar currently accepts (a targeted `"Destroy target Eldrazi
Spawn creature"` would need the same adjective stacking). If a sweep shows zero
reachable cases at those two sites, this is a line on the compiler's backlog
rather than a ticket. If it shows any, the fix is one change with three
beneficiaries: give `DescriptorIR` a conjunction (`subtypes: { all: [...] }` vs
`{ any: [...] }`, or a sibling `subtypesAll`), teach `PermanentFilter` the AND
form, and let the static site drop its refusal.
