import type { CardInstance, Player } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { globalAttackProhibitionReason } from "@convex/cards/attackRestrictions";
import { isCreature } from "~/lib/card-utils";

/** Client-side attacker-eligibility predicate (CR 508.1a). Mirrors the server
 *  gate in `convex/gre/combat.ts` `validateAttackerEligibility` using ONLY
 *  card-layer + projected fields — no GRE engine import, consistent with the
 *  wire-format rule in CLAUDE.md. Extracted from
 *  `useBattlefieldVisualState`'s `canInteract` branch (#937/#481) so the "Attack
 *  with all" button (this file's `eligibleAttackerIds`) declares the SAME set
 *  the board grays in/out — a single authority for "can this creature attack".
 *
 *  Does NOT account for the global attacker cap (Caverns of Despair) or the
 *  must-attack forcing — the former is rejected server-side on the surplus
 *  toggle, the latter only adds creatures the eligibility already admits.
 *
 *  `opponentBattlefield` is the DEFENDING player's battlefield (feeds card-level
 *  attack restrictions); `allPlayers` feeds the board-scanned global
 *  prohibition (Moat, Akron Legionnaire). */
export function isEligibleAttacker(
    card: CardInstance,
    opponentBattlefield: CardInstance[],
    allPlayers: Player[]
): boolean {
    if (!isCreature(card)) return false;
    // CR 702.3b — a creature with defender can't attack.
    if (card.staticAbilities?.includes("defender")) return false;
    if (card.isTapped) return false;
    // CR 702.10b — haste ignores summoning sickness.
    const hasHaste = card.staticAbilities?.includes("haste") ?? false;
    if (card.isSummoningSick && !hasHaste) return false;

    // CR 508.1c — card-level attack restrictions from staticEffects[].
    const def = getDefinition(card.card.id);
    if (def.staticEffects) {
        for (const eff of def.staticEffects) {
            if (eff.kind !== "attack-restriction") continue;
            if (!eff.predicate(card as never, opponentBattlefield as never)) {
                return false;
            }
        }
    }

    // CR 508.1c — board-scanned global attack restrictions declared by OTHER
    // permanents (Moat, Akron Legionnaire).
    if (
        globalAttackProhibitionReason(card as never, {
            players: allPlayers as never,
        }) !== undefined
    ) {
        return false;
    }
    return true;
}

/** Every creature the active player could legally declare as an attacker right
 *  now (CR 508.1a) — the "Attack with all" set. `activePlayer` is the declaring
 *  player; the opponent is the sole other seat (2-player engine). */
export function eligibleAttackerIds(
    activePlayer: Player,
    opponent: Player,
    allPlayers: Player[]
): string[] {
    return activePlayer.battlefield
        .filter((c) => isEligibleAttacker(c, opponent.battlefield, allPlayers))
        .map((c) => c.id);
}
