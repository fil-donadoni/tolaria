import type { PendingChoice } from "~/types/game";

/** Whether `card` in the viewer's hand is selectable for the active
 *  mid-resolution choice (CR 608.2). True only when the viewer is the chooser,
 *  the choice picks from the hand, the card is the viewer's own, and — when the
 *  choice carries a precomputed eligibility allow-list (`candidateIds`, e.g.
 *  Illusionary Mask) — the card is on that list. Centralized so the engine's
 *  candidate restriction is enforced identically wherever hand cards render. */
export function isSelectableHandChoiceCard(
    choice: PendingChoice | undefined,
    card: { id: string; ownerId: string },
    viewerId: string
): boolean {
    if (!choice) return false;
    if (choice.playerId !== viewerId) return false;
    if (choice.zone !== "hand") return false;
    if (card.ownerId !== viewerId) return false;
    if (choice.candidateIds && !choice.candidateIds.includes(card.id)) {
        return false;
    }
    return true;
}
