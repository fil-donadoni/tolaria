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

/** The cards the chooser may legally include in a zone-pick submission — the
 *  enumeration mirror of `applyPendingChoiceSubmit`'s per-id validation: zone
 *  membership (of `zoneOwnerId ?? playerId`, or every battlefield for
 *  `allControllers` — CR 707), the `filter` (against the effective permanent
 *  view, CR 202.2), the `candidateIds` allow-list, and the `untap-pick` extra
 *  constraints (CR 502.1: tapped, not "does-not-untap", not vetoed by a
 *  hard-skip filter like Winter Orb's). A candidate outside this set is not a
 *  worse answer, it is one the submit path THROWS on. */
export function eligibleZonePickCards(
    state: GameState,
    head: PendingChoice
): CardInstanceState[] {
    const zoneOwner = getPlayer(state, head.zoneOwnerId ?? head.playerId);
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
    }
    if (head.kind === "untap-pick") {
        // CR 502.1 — only tapped permanents that are allowed to untap.
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
