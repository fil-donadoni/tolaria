// CR 700.5 — the ONE derivation of a player's devotion to a colour.
//
// Devotion is a per-PLAYER scalar: the number of mana symbols of a given colour
// among the mana costs of the permanents that player controls. It is NOT a
// colour read — a permanent's devotion contribution comes from the SYMBOLS in
// its cost, so Painter's Servant turning every card blue does not move anyone's
// devotion to blue, while a `{B/G}` permanent contributes to both black and
// green devotion whatever colour the permanent currently is.
//
// Lives under `convex/cards/` (NOT `convex/gre/`) for the same reason
// `effectiveColors.ts` does: it is a leaf over `./colors` + the card registry,
// importing nothing from `gre/`, so the React client can call it directly.
//
// Single authority from the start, so the shape that bit Domain — a scan
// hand-copied per consumer until `countDomain` centralized it — cannot recur.
// Today's only consumer is `SpellContext.getDevotion` (the `{ devotion: { of,
// color } }` EffectValue member, issue #2070); the static `countMode:
// "devotion"` twin a Nykthos / Gray Merchant card would want reuses THIS scan
// rather than growing a second one.

import { getInstanceManaCost } from ".";
import { devotionPipsFromCost } from "./colors";
import type { Color, StaticEffectStateView } from "./types";

/** CR 700.5 — `controllerId`'s devotion to `color`: the total number of `color`
 *  mana symbols among the mana costs of the permanents they control.
 *
 *  Counts SYMBOLS, not permanents, so a single `{U}{U}` permanent contributes
 *  2; hybrid and Phyrexian pips count per {@link devotionPipsFromCost} (CR
 *  105.2). A permanent with no mana cost (a token, a land) contributes 0, as
 *  does generic/`{X}`/`{C}` mana.
 *
 *  CR 700.5a says devotion is calculated after copy, control and text-changing
 *  effects but before any other effect that modifies characteristics — an
 *  exception to CR 613.10. Both clauses that matter here are honored by
 *  construction rather than by a layer pass:
 *    * CONTROL — the scan is by `controllerId` across every player's
 *      battlefield, so a stolen permanent counts for whoever controls it now
 *      (CR 110.4), exactly as `countDomain` scans.
 *    * COPY — the cost comes from `getInstanceManaCost`, whose `card` reference
 *      already presents the COPIED card's definition for a copy, and whose
 *      `manaCostOverride` outranks it for CR 707.2's "except it has no mana
 *      cost" (an Eternalize/Embalm token contributes 0).
 *  Nothing else in the engine modifies the mana symbols in a printed cost, so
 *  there is no later-layer read to exclude.
 *
 *  Takes the same `StaticEffectStateView` `countDomain` does — the live
 *  `GameState` structurally satisfies it — so the future static-ability twin
 *  and the SpellContext getter share ONE execution path. */
export function countDevotion(
    state: StaticEffectStateView,
    controllerId: string,
    color: Color
): number {
    let devotion = 0;
    for (const player of state.players) {
        for (const permanent of player.battlefield) {
            if (permanent.controllerId !== controllerId) continue;
            devotion += devotionPipsFromCost(
                getInstanceManaCost(permanent),
                color
            );
        }
    }
    return devotion;
}
