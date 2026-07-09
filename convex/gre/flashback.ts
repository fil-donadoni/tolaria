// Flashback (CR 702.34) — a keyword-cast capability that lets an instant or
// sorcery card be cast from its owner's graveyard for an alternative mana cost,
// then exiles the card as it resolves or leaves the stack.
//
// 702.34a "Flashback [cost]" means "You may cast this card from your graveyard
//         by paying [cost] rather than paying its mana cost" and "If the
//         flashback cost was paid, exile this card as it resolves or as it
//         otherwise leaves the stack."
// 702.34c Casting a spell using its flashback ability follows the normal cast
//         timing rules for that card type (a sorcery flashback is sorcery-speed).
//
// Flashback is engine/cost-system infrastructure, NOT an Effect Script Op — a
// card's on-resolution effect stays DSL/`resolve()`; only the CAST permission
// and cost live here. The flashback cost is either printed on the card
// (`CardDefinition.flashback`) or granted at the instance level until end of
// turn (`CardInstanceState.grantedFlashback` — Snapcaster Mage).
import type { ManaCost } from "../cards/types";
import { tryGetDefinition } from "../cards";
import type { CardInstanceState, PlayerState } from "./state";

/** The Flashback cost currently available on a card, or `undefined` when the
 *  card has no flashback (CR 702.34a). An instance-level grant (Snapcaster
 *  Mage's `grantedFlashback`) overrides / supplies the printed
 *  `CardDefinition.flashback`. */
export function getFlashbackCost(
    card: CardInstanceState
): ManaCost | undefined {
    if (card.grantedFlashback) return card.grantedFlashback;
    const id = (card.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.flashback ?? undefined) : undefined;
}

/** True iff `card` currently has a Flashback cost (printed or granted). */
export function hasFlashback(card: CardInstanceState): boolean {
    return getFlashbackCost(card) !== undefined;
}

/** CR 702.34a — the card in `player`'s graveyard with `instanceId` that can be
 *  cast via Flashback right now (it carries a flashback cost), or `undefined`.
 *  Only the graveyard zone is a legal flashback source; a card being flashed
 *  back is located here by the cast path, mirroring `findCastableExileCard`. */
export function findFlashbackCastable(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return hasFlashback(card) ? card : undefined;
}
