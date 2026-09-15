import { useMemo } from "react";
import { tryGetDefinition } from "@convex/cards";
import type { ActionSheetItem } from "~/components/ui/action-sheet";
import type { CardInstance } from "~/types/game";
import { useSeatYields } from "~/hooks/useYieldPreferences";
import { yieldCardIdentityForDefinition } from "~/lib/yields";

/** The card's own **Yield** reset — "Turn off auto-yield for Noble Hierarch"
 *  (issue #3556, owner comment).
 *
 *  Offered only while the viewing seat actually holds a **Yield** on some
 *  ability of this card: the entry exists to UNDO one, so on every other card
 *  it would be a no-op cluttering the surface.
 *
 *  Never a left-click entry (issue #3616): a left click is for acting. The
 *  entries feed the right-click menu and the touch long-press preview overlay
 *  (`card-preview.tsx`), which is also why `card` may be absent — a preview of
 *  something that is not a card instance offers nothing.
 *
 *  Per CARD, never per instance: the identity is the definition id — the same
 *  `card:<id>` fragment the stack row's key is minted from
 *  (`yieldKeyForStackItem`) — so clearing from any Noble Hierarch on the
 *  battlefield clears the yield for every Noble Hierarch, present and future,
 *  and leaves Ignoble Hierarch's identically-worded Exalted trigger alone. */
export function useCardYieldMenuItems(
    card: CardInstance | undefined
): ActionSheetItem[] {
    const seat = useSeatYields();
    const cardId = card?.card.id;
    const identity = cardId ? yieldCardIdentityForDefinition(cardId) : "";
    const held = cardId !== undefined && seat.hasCardYield(identity);
    const name = cardId ? (tryGetDefinition(cardId)?.name ?? cardId) : "";
    const clearCard = seat.clearCard;

    return useMemo(() => {
        if (!held) return [];
        return [
            {
                key: `yield-off-${identity}`,
                label: `Turn off auto-yield for ${name}`,
                onSelect: () => clearCard(identity),
            },
        ];
    }, [held, identity, name, clearCard]);
}
