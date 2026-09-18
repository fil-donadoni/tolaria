---
title: Aura attachment legality reads only card types, not the rest of the enchant filter
discoveredBy: 3825
status: draft
confidence: high
---

**What is wrong.** CR 702.5a: the enchant ability restricts both what an Aura
spell can TARGET and what the Aura can ENCHANT. The engine honours the whole
printed filter at the first site only. `resolveEnchantRestriction`
(`convex/gre/state.ts`) normalises the Aura's `targetRequirement` down to its
card `types` (+ `players`), so the two attachment sites that read it —
`checkAuraAttachmentSBA` (CR 704.5m, `convex/gre/sba.ts`) and the CR 303.4f
non-cast host scan (`findAllLegalAuraHosts`) — ignore `controller`,
`subtypeFilter`, `excludeSubtypes`, `colorFilter`, `tappedFilter`,
`powerFilter`, `mvFilter`, `excludeAbility`, `supertypeFilter`, ….

Consequences, each a CR 704.5m divergence:

- "Enchant creature you control" (Cocoon, Cloak of Confusion; Emblem of the
  Warmind compiled) stays attached after the host changes control.
- "Enchant creature with power 3 or less" (Runner's Bane) stays attached after
  a pump; "Enchant tapped creature" (Entangling Vines) after an untap.
- An Aura put onto the battlefield without being cast (CR 303.4f) is offered
  hosts its filter excludes — an opponent's land for "Enchant land you
  control" (Earthlore, Tourach's Gate).

**Evidence.** `resolveEnchantRestriction` builds `{ types, players }` from
`req.type` alone; `hostMatchesEnchantRestriction` tests
`clause.types.some(t => host.types.includes(t))` and nothing else. The
target-filter single authority (`intrinsicPermanentTargetViolation`,
`convex/gre/rules.ts`) already evaluates every one of those fields.

**Why it deserves its own issue.** Defensible without any card: it is a
CR 702.5a / 704.5m rule gap across ~10 hand-written Auras today, and issue
#3825's `Enchant <descriptor>` grammar rule now compiles every such filter
(~40 corpus forms beyond the bare card types — `oracle:report`), all sharing
the gap. The compiler emits exactly the encoding hand-written Auras use, so
the fix belongs in the engine's attachment predicate, not in the grammar.
