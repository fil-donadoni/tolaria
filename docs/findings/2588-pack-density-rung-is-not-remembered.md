---
title: The Booster grid's phone density rung resets on every visit to the Draft Room
discoveredBy: 2588
status: draft
confidence: low
---

**What is wrong.** The desktop Booster's zoom is a persisted per-user
preference (`useCardZoom({ zone: "limited-booster" })`, which reads and writes
its own storage key). The phone density toggle that replaces it on a phone is
plain component state, so a player who prefers `4×4` gets `3×5` again on every
mount — after a reload, after a rotation between the two phone regimes, and
after any navigation out of the room and back.

**Evidence.** `src/components/limited/limited-draft-table.tsx` —
`const [density, setDensity] = useState<DraftPackDensity>("fit")`, beside the
`boosterZoom` it stands in for, which comes from `useCardZoom` two lines
below. `src/components/limited/draft-room/draftPackGrid.ts` holds the rungs.

**Why it may not deserve its own issue.** A draft is one sitting: the rung
survives every pick of every Booster, which is the whole session it is meant
to serve, and one tap restores it. Persisting it also raises a question this
slice did not have to answer — whether portrait and landscape share one rung
or keep two, since `3×5` and `8×2` are different shapes of the same "fit".
That decision belongs with the settings surface (PRD #2405's density /
motion / stops track), which is where it would land anyway.
