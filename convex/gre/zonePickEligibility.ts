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

/** Whether a battlefield pick draws from EVERY player's battlefield rather
 *  than `zoneOwnerId ?? playerId`'s. `allControllers` says so explicitly; a
 *  `choose-damage-target` pick ("any target", CR 115.4 / CR 601.2c) always does:
 *  its submit validator (`submitDamageTargetPick`) trusts `candidateIds` alone,
 *  so a producer that omits `allControllers` (cast-during-resolution target,
 *  Word of Command) must not shrink the pool to the chooser's own battlefield.
 *  The ONE reader of this scope — the server enumerator, the live Bot view and
 *  the self-play lister all call it. */
export function choiceSpansAllBattlefields(head: PendingChoice): boolean {
    return head.allControllers === true || head.kind === "choose-damage-target";
}

/** Whether a graveyard pick draws from EVERY player's graveyard (an as-enters
 *  copy "of any creature card in a graveyard", CR 707.2). The ONE reader of
 *  this scope, like {@link choiceSpansAllBattlefields}. */
export function choiceSpansAllGraveyards(head: PendingChoice): boolean {
    return head.zone === "graveyard" && head.allControllers === true;
}

/** The public zones an "any target" pick may name an object in — the shape
 *  both the server `GameState` and the Bot's projected `PublicGameState`
 *  share, so ONE resolver serves the enumerator, the live Bot view and the
 *  self-play lister. */
export type AnyTargetZones<C extends { id: string }> = {
    players: readonly {
        battlefield: readonly C[];
        graveyard: readonly C[];
        exile: readonly C[];
    }[];
    stack: readonly C[];
};

/** CR 115.1 / CR 601.2c (issue #9148) — the OBJECTS a `choose-damage-target`
 *  pick may name, resolved from its `candidateIds` allow-list across every
 *  public zone: a permanent, a card in a graveyard or exile, a spell on the
 *  stack. Id-driven like its submit validator (`submitDamageTargetPick`
 *  trusts `candidateIds` alone, whatever `zone` the raise was labelled with):
 *  a free cast during resolution (`castDuringResolution`'s target step) or
 *  Word of Command's pick lists every non-player legal target of the cast
 *  spell, and a pool read from battlefields alone left the Bot an EMPTY
 *  answer for a graveyard or stack target. Allow-list order; an id found on
 *  a battlefield wins over the activated-ability stack item that borrows its
 *  source's id (CR 113.7a), as `getLegalTargets` lists permanents first. */
export function anyTargetChoicePool<C extends { id: string }>(
    zones: AnyTargetZones<C>,
    candidateIds: readonly string[] | undefined
): C[] {
    if (!candidateIds || candidateIds.length === 0) return [];
    const byId = new Map<string, C>();
    const add = (c: C) => {
        if (!byId.has(c.id)) byId.set(c.id, c);
    };
    for (const p of zones.players) p.battlefield.forEach(add);
    zones.stack.forEach(add);
    for (const p of zones.players) p.graveyard.forEach(add);
    for (const p of zones.players) p.exile.forEach(add);
    return candidateIds.flatMap((id) => {
        const c = byId.get(id);
        return c ? [c] : [];
    });
}

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
    // CR 115.1 / 601.2c (issue #9148) — "any target": id-driven across every
    // public zone, never the `zone` label.
    if (head.kind === "choose-damage-target") {
        return anyTargetChoicePool(state, head.candidateIds);
    }
    let pool: CardInstanceState[];
    switch (head.zone) {
        case "battlefield":
            pool = choiceSpansAllBattlefields(head)
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
            pool = choiceSpansAllGraveyards(head)
                ? state.players.flatMap((p) => p.graveyard)
                : zoneOwner.graveyard;
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
