// The fixed protection-quality strings (CR 702.16) — a DEPENDENCY-FREE LEAF.
//
// Card modules read these while their object literals are built, i.e. at
// module-evaluation time. `gre/protection.ts`, which parses them, sits in an
// import cycle with the card registry, so a card that took them from there
// saw `undefined` whenever the bundle entered the cycle at `gre/protection`
// (Figure of Fable shipped a `grantAbility` with no `ability`:
// `docs/findings/1969-figure-of-fable-import-cycle.md`, issue #4452). This
// module imports nothing, so it is fully evaluated before anything can read
// it; `gre/protection.ts` imports it first and re-exports it.

/** CR 702.16k — the PLAYER-quality protection string. The quality is "each of
 *  your opponents", i.e. every player other than the protected permanent's own
 *  controller, re-derived live so a control-change effect moves the protection
 *  with the permanent (CR 109.4 / 702.16). Figure of Fable's final stage. */
export const PROTECTION_FROM_EACH_OPPONENT =
    "protection from each of your opponents";

/** CR 702.16a — the SPELL-RESTRICTED ANY-COLOUR protection string (issue
 *  #2296). Matched EXACTLY (after lowercasing/trimming) rather than by a
 *  loose "spells" + "colors" heuristic: the parser's whole contract is to
 *  fail closed on a phrase it cannot name, and a near-miss phrasing must
 *  reach the catalogue guard as an unparseable string, not be silently
 *  approximated by this one. */
export const PROTECTION_FROM_COLORED_SPELLS =
    "protection from spells that are one or more colors";

/** CR 702.16j — the PERMANENT-scoped "protection from everything" string
 *  (issue #2386, Hexdrinker's LEVEL 8+ band). Matched EXACTLY like the other
 *  fixed-phrase families, so a near-miss phrasing reaches the catalogue guard
 *  as an unparseable string rather than being silently approximated.
 *
 *  The PLAYER-scoped variant of the same rule is a separate authority
 *  (`playerHasProtectionFromEverything`) — CR 702.16j names both scopes,
 *  and a player is not a card: it carries no `staticAbilities[]` to parse. */
export const PROTECTION_FROM_EVERYTHING = "protection from everything";
