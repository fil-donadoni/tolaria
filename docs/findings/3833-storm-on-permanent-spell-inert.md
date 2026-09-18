---
title: Storm on a permanent spell compiles `ready` and copies nothing
discoveredBy: 3833
status: draft
confidence: high
---

**What is wrong.** Krosan Adaptation (a Mystery Booster playtest Aura:
"Enchant creature / Storm / Enchanted creature gets +1/+0 and has vigilance.")
compiles `ready` since issue #3833 read its host line. Its Storm keyword is
accepted by the keyword-line slot. But `cloneSpellOntoStack`
(`convex/gre/state.ts`, ~15590) returns `null` for anything that is not an
instant or sorcery, so storm on a permanent spell creates zero copies and says
nothing. The card ships with one keyword that does nothing.

**Evidence.** The `data/oracle-compiled.json` row for oracle id
`6121d856-2dc9-4a43-b2b3-16af889eaa1f` is `ready` with
`staticAbilities: ["storm"]` on an Aura. CR 702.40a says the copies of a
permanent spell "enter as tokens" (CR 707.10f), and the engine has no path
for that.

**Why it may not deserve its own issue.** The card has an empty `poolIn`
(it is legal in no format), so no deck the app builds can reach it. The fix
at the compiler seam is small: quarantine Storm or Replicate on a
non-instant/sorcery in `lower.ts`, as a planned-mechanic reason. It could be
a line on the grammar PRD (#3820) rather than a ticket.
