import type { CardInstanceState, GameState } from "./state";
import { getPlayer, getOpponentId, untapPermanent } from "./state";
import { tryGetDefinition } from "../cards";

/**
 * Banding combat helpers (CR 702.22).
 *
 * Banding has two mechanical effects this module models:
 *  1. **Block as a group (CR 702.22h):** an attacking band is blocked as a
 *     unit. Blocking any one member blocks every member — so the effective
 *     block graph expands each blocked attacker to its full band.
 *  2. **Damage-assignment authority (CR 702.22j-k):** if a creature is in
 *     combat with one or more creatures with banding, the controller of those
 *     banding creature(s) — not the creature's own controller — chooses how
 *     that creature assigns its combat damage. This flips the assigner for
 *     both attacker sources (blocked by a banding blocker → defender assigns)
 *     and blocker sources (blocking a banding attacker → attacker assigns).
 */

/** True if the instance currently has the banding keyword (printed or granted
 *  via Helm of Chatzuk, CR 611.2a — both land in `staticAbilities`). */
export function hasBanding(card: CardInstanceState): boolean {
    return card.staticAbilities.includes("banding");
}

/**
 * "Bands with other [quality]" (CR 702.22j). The restricted banding variant is
 * encoded as a parametric keyword string on `staticAbilities`:
 *
 *   - `"bands with other:legendary"`               — the [quality] is "legendary"
 *   - `"bands with other:name=Wolves of the Hunt"` — the [quality] is "creatures
 *                                                     named Wolves of the Hunt"
 *
 * Only those two quality shapes appear in Legends, so the matcher handles
 * exactly them. A creature may carry several such keywords at once (e.g. a
 * grant-land plus a printed one); each is an independent band-eligibility lane.
 */
export const BANDS_WITH_OTHER_PREFIX = "bands with other:";

/** Quality required of every band member by a "bands with other [Q]" keyword. */
export type BandQuality =
    | { kind: "legendary" }
    | { kind: "name"; name: string };

/** Parse the [quality] out of a single `staticAbilities` entry, or undefined if
 *  the entry is not a bands-with-other keyword. */
export function parseBandsWithOtherQuality(
    keyword: string
): BandQuality | undefined {
    if (!keyword.startsWith(BANDS_WITH_OTHER_PREFIX)) return undefined;
    const q = keyword.slice(BANDS_WITH_OTHER_PREFIX.length);
    if (q === "legendary") return { kind: "legendary" };
    if (q.startsWith("name=")) return { kind: "name", name: q.slice(5) };
    return undefined;
}

/** Every "bands with other [Q]" quality currently on `card`. */
export function getBandsWithOtherQualities(
    card: CardInstanceState
): BandQuality[] {
    const out: BandQuality[] = [];
    for (const kw of card.staticAbilities) {
        const q = parseBandsWithOtherQuality(kw);
        if (q) out.push(q);
    }
    return out;
}

/** True if `card` has at least one "bands with other [Q]" keyword (CR 702.22j).
 *  For damage-assignment authority (CR 702.22j-k) a creature with this variant
 *  counts as a banding creature, exactly like plain banding. */
export function hasBandsWithOther(card: CardInstanceState): boolean {
    return card.staticAbilities.some((kw) =>
        kw.startsWith(BANDS_WITH_OTHER_PREFIX)
    );
}

/** A creature whose presence in a combat gives its controller damage-assignment
 *  authority (CR 702.22j-k): plain banding OR any bands-with-other variant. */
export function grantsDamageAssignment(card: CardInstanceState): boolean {
    return hasBanding(card) || hasBandsWithOther(card);
}

/** Resolve a permanent's (possibly copied / tokenized) card definition for
 *  reading the supertype / name a band quality keys off (CR 707.2). Tokens
 *  carry these on their synthesized def, so the registry lookup covers them. */
function bandDefinition(card: CardInstanceState) {
    const cardId = (card.card as { id?: string }).id;
    return cardId ? tryGetDefinition(cardId) : null;
}

/** True if `card` satisfies the band `quality` (CR 702.22j). "legendary" reads
 *  the Legendary supertype; "name=X" reads the (copied) printed name. */
export function matchesBandQuality(
    card: CardInstanceState,
    quality: BandQuality
): boolean {
    const def = bandDefinition(card);
    if (quality.kind === "legendary") {
        return def?.supertypes?.includes("Legendary") ?? false;
    }
    return def?.name === quality.name;
}

/** The member ids of the band `attackerId` belongs to, or undefined if it is
 *  not part of a declared band. */
export function getBandMembers(
    combat: NonNullable<GameState["combat"]>,
    attackerId: string
): string[] | undefined {
    return combat.bands?.find((b) => b.memberIds.includes(attackerId))
        ?.memberIds;
}

/** True if `members` form a legal band (CR 702.22c / 702.22j). Two lanes:
 *
 *  - **Plain banding (CR 702.22c):** 2+ creatures, at least one with banding and
 *    at most one without banding.
 *  - **Bands with other [quality] (CR 702.22j):** 2+ creatures where some
 *    member has "bands with other [Q]" and EVERY member satisfies that same
 *    quality [Q]. Unlike plain banding there is no "at most one without"
 *    relaxation — all members must share the quality.
 *
 *  A band is legal if it satisfies either lane. Shared by the createBand
 *  mutation and its tests. */
export function isLegalBandComposition(members: CardInstanceState[]): boolean {
    if (members.length < 2) return false;
    // CR 702.22c — plain banding.
    const banding = members.filter(hasBanding).length;
    if (banding >= 1 && members.length - banding <= 1) return true;
    // CR 702.22j — bands with other [quality]: some member grants the variant
    // and every member satisfies that member's quality.
    for (const member of members) {
        for (const quality of getBandsWithOtherQualities(member)) {
            if (members.every((m) => matchesBandQuality(m, quality))) {
                return true;
            }
        }
    }
    return false;
}

export type BlockGraph = {
    /** attackerId → blocker ids blocking it (band-expanded). */
    blockersByAttacker: Record<string, string[]>;
    /** blockerId → attacker ids it is blocking (band-expanded). */
    attackersByBlocker: Record<string, string[]>;
};

/**
 * Builds the effective block graph, expanding band membership (CR 702.22h):
 * a blocker assigned to any band member is treated as blocking every member,
 * and every member is treated as blocked. With no bands declared this reduces
 * to a plain inversion of `combat.blockerAssignments`.
 */
export function getEffectiveBlockGraph(state: GameState): BlockGraph {
    const blockersByAttacker: Record<string, string[]> = {};
    const attackersByBlocker: Record<string, string[]> = {};
    const combat = state.combat;
    if (!combat) return { blockersByAttacker, attackersByBlocker };

    for (const [blockerId, attackerIds] of Object.entries(
        combat.blockerAssignments
    )) {
        const expanded = new Set<string>();
        for (const attackerId of attackerIds) {
            const band = getBandMembers(combat, attackerId);
            if (band) {
                for (const m of band) expanded.add(m);
            } else {
                expanded.add(attackerId);
            }
        }
        attackersByBlocker[blockerId] = [...expanded];
        for (const attackerId of expanded) {
            (blockersByAttacker[attackerId] ??= []).push(blockerId);
        }
    }
    return { blockersByAttacker, attackersByBlocker };
}

/**
 * Records which attackers became blocked this combat (CR 509.1h). Call once
 * blockers are locked in: an attacker counts as blocked iff it has at least
 * one blocker in the band-expanded block graph at that moment. The result is
 * stored on `combat.blockedAttackerIds` and read at the damage step, so an
 * attacker that later loses every blocker still deals no combat damage to the
 * defender without trample (CR 510.1c) — its blocked status no longer depends
 * on the live blocker count.
 */
export function recordBlockedAttackers(state: GameState): void {
    if (!state.combat) return;
    state.combat.blockedAttackerIds = Object.keys(
        getEffectiveBlockGraph(state).blockersByAttacker
    );
}

/**
 * Melee's untap-unblocked rider (CR 509.1 variant, #669): "Whenever a creature
 * attacks and isn't blocked this combat, untap it and remove it from combat."
 *
 * Called once at blocker confirmation, after `recordBlockedAttackers` has
 * populated `combat.blockedAttackerIds`. Every declared attacker NOT in the
 * blocked set is untapped and removed from combat (cleared `isAttacking`,
 * dropped from `attackerIds`). Pure over game state and idempotent — a
 * re-invocation after the attackers are already removed is a no-op. Only runs
 * while `state.meleeCombat` is set; a normal combat leaves attackers untouched.
 */
export function applyMeleeUnblockedRider(state: GameState): void {
    if (!state.meleeCombat || !state.combat) return;
    const activePlayer = getPlayer(state, state.activePlayerId);
    const blocked = new Set(state.combat.blockedAttackerIds ?? []);
    const unblocked = state.combat.attackerIds.filter((id) => !blocked.has(id));
    for (const attackerId of unblocked) {
        const card = activePlayer.battlefield.find((c) => c.id === attackerId);
        if (card) {
            // CR 701.26 — untap, then CR 506.4 — remove from combat.
            untapPermanent(state, card);
            card.isAttacking = undefined;
        }
    }
    state.combat.attackerIds = state.combat.attackerIds.filter((id) =>
        blocked.has(id)
    );
}

/**
 * Determines which player assigns `source`'s combat damage among
 * `targetCreatureIds` (CR 702.22j-k). If any target is a creature
 * with banding OR "bands with other [quality]", authority shifts to that
 * target's controller (the opponent of the source); otherwise the source's own
 * controller assigns. Returns `source`'s controller when there is no shift.
 */
export function getDamageAssignerId(
    state: GameState,
    source: CardInstanceState,
    targetCreatureIds: string[]
): string {
    const opponentId = getOpponentId(state, source.controllerId);
    const opponent = getPlayer(state, opponentId);
    const anyBandingTarget = targetCreatureIds.some((id) => {
        const target = opponent.battlefield.find((c) => c.id === id);
        return target ? grantsDamageAssignment(target) : false;
    });
    return anyBandingTarget ? opponentId : source.controllerId;
}

/**
 * The next player still owing a damage-assignment choice this step, or
 * undefined if every distinct assigner has confirmed. Pure over the combat
 * shape so the frontend can mirror it (see `src/lib/priority.ts`).
 */
export function outstandingDamageAssigner(combat: {
    damageAssignerIds?: Record<string, string>;
    damageAssignmentConfirmedBy?: string[];
}): string | undefined {
    const assigners = combat.damageAssignerIds;
    if (!assigners) return undefined;
    const confirmed = new Set(combat.damageAssignmentConfirmedBy ?? []);
    for (const playerId of Object.values(assigners)) {
        if (!confirmed.has(playerId)) return playerId;
    }
    return undefined;
}
