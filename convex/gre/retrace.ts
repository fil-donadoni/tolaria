// Retrace (CR 702.81) — a keyword-cast capability that lets a card be cast from
// its owner's graveyard for its NORMAL cost plus one ADDITIONAL cost: discard a
// land card.
//
// 702.81a Retrace is a static ability that functions while the card with
//         retrace is in a player's graveyard. "Retrace" means "You may cast
//         this card from your graveyard by discarding a land card as an
//         additional cost to cast it." Casting a spell using its retrace
//         ability follows the rules for paying additional costs in rules 601.2b
//         and 601.2f–h.
//
// That single subrule is the WHOLE keyword (the section has no second
// subrule), and three things follow from it that separate retrace from the other graveyard-cast
// mechanisms already in the engine:
//
//   1. **ADDITIONAL, not alternative.** The spell's own mana cost is still paid
//      in full (contrast Escape, CR 702.138a, and Flashback, CR 702.34a, which
//      both REPLACE the mana cost). So there is no `castRawManaCost` override
//      for retrace — the printed cost is already right.
//   2. **No exile on resolution.** The whole rule text of retrace
//      (CR 702.81a, printed above) is silent about it, so the card resolves and
//      goes wherever it normally would: an instant or sorcery spell finishes
//      resolving (CR 608.2m) and is put into its owner's graveyard, a permanent
//      spell becomes a permanent (CR 608.3a). This is the key divergence from
//      flashback, whose CR 702.34a sends the card to exile instead:
//      `graveyardCastStackFlags` (convex/game.ts) must NOT set
//      `exileOnResolve` for a retrace cast — which is what makes a retraced
//      instant/sorcery recastable for as long as lands keep coming.
//   3. **The additional cost is a HAND cost with a filter**, which is exactly
//      the shipped `CostLegs.hand` vocabulary (ADR 0079, issue #1933):
//      `{ action: "discard", requirements: [{ filter: { type: "Land" }, count: 1 }] }`.
//      It is paid at commit through the cast's `alternativeCostHandChoice`
//      picker like every other hand-leg cost, so no new payment machinery
//      exists here.
//
// Retrace is engine/cost-system infrastructure, NOT an Effect Script Op — a
// card's on-resolution effect stays DSL; only the CAST permission and the
// additional cost live here.
import type { CardDefinition, CostLegs, RetraceGrant } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { tryGetEmblemDefinition } from "../cards/emblems";
import { canPayHandCost } from "./alternativeCost";
import { isLand } from "./constants";
import type { CardInstanceState, GameState, PlayerState } from "./state";

/** CR 702.81a — the retrace additional cost, as the shared `CostLegs` hand leg
 *  every other filtered give-up-from-hand cost already uses (ADR 0079). One
 *  land card, discarded (not exiled): the discard goes to the graveyard the
 *  ordinary way, so it can itself feed a later retrace. */
export const RETRACE_COST_LEGS: CostLegs = {
    hand: {
        action: "discard",
        requirements: [{ filter: { type: "Land" }, count: 1 }],
    },
};

/** The keyword string a card prints in `staticAbilities[]` to have retrace.
 *  Matches the Mechanics Registry row `retrace` (CR 702.81), so a card shipping
 *  the keyword is simultaneously live in the engine and covered by the
 *  registry's keyword-must-be-implemented guard. */
export const RETRACE_KEYWORD = "retrace";

function definitionOf(card: CardInstanceState): CardDefinition | undefined {
    const id = (card.card as { id?: string }).id;
    return (id ? tryGetDefinition(id) : undefined) ?? undefined;
}

/** CR 702.81a — retrace PRINTED on `card` ("Retrace" in its keyword line). Read
 *  from the INSTANCE's `staticAbilities` first (the live list, which is what a
 *  keyword grant would write) and from the definition as the fallback, so a
 *  card instance built without its keyword list still reports correctly. */
export function hasPrintedRetrace(card: CardInstanceState): boolean {
    if (card.staticAbilities?.includes(RETRACE_KEYWORD)) return true;
    return (
        definitionOf(card)?.staticAbilities?.includes(RETRACE_KEYWORD) === true
    );
}

/** CR 702.81 — every retrace GRANT currently reaching `ownerId`'s graveyard,
 *  from EVERY producer. This is the single sweep the whole mechanic funnels
 *  through: a new producer of "<cards> in your graveyard have retrace" adds a
 *  loop here and nothing else changes.
 *
 *  The ONE producer today is a command-zone EMBLEM the graveyard's owner owns
 *  (Wrenn and Six's −7, `EmblemDefinition.grantsRetraceToOwnGraveyard`). It is
 *  worth a sweep rather than an inline lookup precisely because of WHERE it
 *  lives: an emblem is NOT a permanent (CR 114.1) and never appears on a
 *  battlefield, so the battlefield-permanent scan that every other
 *  graveyard-cast grant in the engine uses (`getGrantedEscape`, `escape.ts`)
 *  structurally cannot see it. The next producer — an Underworld-Breach-shaped
 *  battlefield permanent (Six, BLB) — is a second loop here, reading
 *  `owner.battlefield` for the identical `RetraceGrant` shape.
 *
 *  An emblem is never removed from the command zone (CR 114.4), so once created
 *  its grant is live for the rest of the game; the sweep is still re-run per
 *  query rather than cached, so the emblem-created turn needs no invalidation. */
function collectRetraceGrants(
    state: GameState,
    ownerId: string
): RetraceGrant[] {
    const grants: RetraceGrant[] = [];
    for (const emblem of state.emblems ?? []) {
        if (emblem.ownerId !== ownerId) continue;
        const grant = tryGetEmblemDefinition(
            emblem.emblemId
        )?.grantsRetraceToOwnGraveyard;
        if (grant) grants.push(grant);
    }
    return grants;
}

/** Whether one {@link RetraceGrant} reaches `card` right now. Every clause is
 *  FAIL-CLOSED: an unmatched card type or an out-of-turn "during your turn"
 *  grant simply does not apply, so a new grant wording that this predicate does
 *  not understand withholds the permission rather than handing it out. */
function grantReaches(grant: RetraceGrant, card: CardInstanceState): boolean {
    // CR 305.1 — a land is played, never cast ("Since the land doesn't go on
    // the stack, it is never a spell"), so no retrace grant can ever reach one
    // however it is worded.
    if (isLand(card)) return false;
    if (
        grant.cardTypes &&
        !grant.cardTypes.some((t) =>
            (card.types as readonly string[]).includes(t)
        )
    ) {
        return false;
    }
    return true;
}

/** CR 702.81 — retrace GRANTED to `card` by any producer (battlefield permanent
 *  or emblem) reaching the graveyard it sits in. */
export function hasGrantedRetrace(
    state: GameState,
    card: CardInstanceState
): boolean {
    return collectRetraceGrants(state, card.ownerId).some((g) =>
        grantReaches(g, card)
    );
}

/** True iff `card` currently has retrace (printed or granted), CR 702.81a. A
 *  LAND never does: CR 305.1 makes a land un-castable, so the printed half is
 *  gated here for the same reason the granted half is gated in
 *  {@link grantReaches}. */
export function hasRetrace(state: GameState, card: CardInstanceState): boolean {
    if (isLand(card)) return false;
    return hasPrintedRetrace(card) || hasGrantedRetrace(state, card);
}

/** CR 702.81a — the card in `player`'s graveyard with `instanceId` that can be
 *  cast via retrace right now, or undefined. Only the graveyard zone is a legal
 *  retrace source. */
export function findRetraceCastable(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return hasRetrace(state, card) ? card : undefined;
}

/** CR 702.81a / 601.2f — whether `player` can actually pay the retrace
 *  additional cost right now: at least one LAND card in hand other than the
 *  card being cast (which is in the graveyard anyway, so the exclusion is
 *  defence in depth). Gates the `cast` action in `getLegalActions`, exactly as
 *  `hasPayableFlashbackAdditionalCost` gates a flashback cast.
 *
 *  It is also what BOUNDS the recast loop the no-exile rule opens up: every
 *  retrace cast destroys one land card from hand, so a graveyard instant with
 *  retrace can be recast only as many times as the caster has lands to throw
 *  away (and mana to pay the printed cost again). */
export function canPayRetraceDiscard(
    player: PlayerState,
    castInstanceId: string
): boolean {
    return canPayHandCost(player, RETRACE_COST_LEGS, castInstanceId);
}
