// Zone-pick eligibility — the ONE enumeration mirror of
// `applyPendingChoiceSubmit`'s per-id validation (issue #3545).
//
// Lived module-private in `legalActions.ts` with a single caller until the
// `choose-permanents` candidate generator (`ai/choiceCandidates.ts`) needed the
// same pool. It is its own module rather than an export of `legalActions.ts`
// because that module imports `moves.ts`, which imports `choiceCandidates.ts`
// back: exporting it from there would have made a THIRD leg of the cycle
// `choiceCandidates` already carries deliberately (issue #2983). Nothing here
// reaches the search.

import type { CardInstanceState, GameState, PendingChoice } from "./state";
import { getPlayer, matchesPermanentFilter } from "./state";
import { computeHardSkipFilters } from "./phases";
import { effectivePermanentView } from "./permanentView";
import { damageSourceChoicePool } from "./damageSourceChoice";
import { outsideGamePool } from "./outsideGame";

/** The cards the chooser may legally include in a zone-pick submission — the
 *  enumeration mirror of `applyPendingChoiceSubmit`'s per-id validation: zone
 *  membership (of `zoneOwnerId ?? playerId`, or every battlefield for
 *  `allControllers`), the `filter` (against the effective permanent view), the `candidateIds` allow-list, and the `untap-pick` extra
 *  constraints (CR 502.3: tapped, not "does-not-untap", not vetoed by a
 *  hard-skip filter like Winter Orb's). A candidate outside this set is not a
 *  worse answer, it is one the submit path THROWS on. */
export function eligibleZonePickCards(
    state: GameState,
    head: PendingChoice
): CardInstanceState[] {
    const zoneOwner = getPlayer(state, head.zoneOwnerId ?? head.playerId);
    // CR 400.11 — outside the game is no zone; the pick carries none, and its
    // allow-list is mandatory (`submitOutsideGamePick` fails closed without).
    if (head.kind === "choose-outside-game-card") {
        return outsideGamePool(zoneOwner).filter(
            (c) => head.candidateIds?.includes(c.id) ?? false
        );
    }
    let pool: CardInstanceState[];
    switch (head.zone) {
        case "battlefield":
            pool = head.allControllers
                ? state.players.flatMap((p) => p.battlefield)
                : zoneOwner.battlefield;
            break;
        case "hand":
            pool = zoneOwner.hand;
            break;
        case "library":
            pool = zoneOwner.library;
            break;
        case "graveyard":
            pool = zoneOwner.graveyard;
            break;
        case "battlefield-or-stack":
            // CR 609.7a (issue #5601) — the source pool; the raise's
            // `candidateIds` (applied below) carries its filter.
            pool = damageSourceChoicePool(state);
            break;
        default:
            pool = [];
    }
    let cards = pool;
    if (head.zone === "battlefield" && head.filter) {
        cards = cards.filter((c) =>
            matchesPermanentFilter(
                effectivePermanentView(state, c),
                head.filter!
            )
        );
    }
    if (head.candidateIds) {
        cards = cards.filter((c) => head.candidateIds!.includes(c.id));
    } else if (head.zone === "battlefield-or-stack") {
        // Mirrors the submit validator: no allow-list admits nothing.
        cards = [];
    }
    if (head.kind === "untap-pick") {
        // CR 502.3 — only tapped permanents that are allowed to untap.
        const vetoFilters = computeHardSkipFilters(state);
        cards = cards.filter(
            (c) =>
                c.isTapped &&
                !c.staticAbilities.includes("does-not-untap") &&
                !vetoFilters.some((f) =>
                    matchesPermanentFilter(effectivePermanentView(state, c), f)
                )
        );
    }
    return cards;
}
