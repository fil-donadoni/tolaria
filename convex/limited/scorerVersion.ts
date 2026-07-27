// Bot Drafter scorer version (issue #1613, ADR 0074 "Draft Lab: replay
// mode"). A plain integer, bumped by hand whenever the Pick Heuristic's
// scoring model changes in a way that could move picks (a new term, a
// reweight, ADR 0073's rescale, a Capability/Archetype addition — PRD #1607).
// Stamped onto a `limitedEvents` row once, at `startLimitedEvent`, so a
// completed event carries the version that ACTUALLY drafted it — never
// recomputed after the fact, since the whole point is to compare it against
// whatever `SCORER_VERSION` is today.
//
// Deliberately its OWN module rather than living in `botDrafter.ts`: this
// constant is metadata ABOUT the scorer (when did picking behaviour last
// change), not part of the scoring model itself, so it can be bumped by
// whoever changes `botDrafter.ts`/`cardProfiles.ts`/`capabilityRegistry.ts`
// without editing those files' own diffs — and the Draft Lab replay surface
// (`src/lib/limited/draftReplayEngine.ts`) imports it too, to show "drafted
// under vN, current is vM" beside the historical-vs-recomputed diff.
export const SCORER_VERSION = 1;
