import { useCallback, useRef, useState } from "react";
import type { ActivatableAbility } from "~/components/board/battlefield-card";

/** Touch-vs-click decision for a battlefield card that carries activatable
 *  abilities (PRD #249, slice #278). Shared by the classic
 *  ({@link BattlefieldCard}) and spatial ({@link BoardBattlefieldCard})
 *  cards so both surface abilities identically; the menu/action-sheet MARKUP
 *  lives in {@link ActivatableAbilityMenu}, this owns the gesture.
 *
 *  Returns handlers the card spreads onto its own clickable element and the
 *  controlled action-sheet state:
 *  - `onTouchStart` flags the next click as a touch tap;
 *  - `onClick`: on TOUCH, opens the ability affordance instead of the card's
 *    tap/pay — a single ability fires immediately, multiple open the
 *    action-sheet. On DESKTOP, the left click bubbles to the ContextMenuTrigger
 *    (which synthesizes a `contextmenu` to open the ability menu) — the LEFT
 *    click is the desktop path; a genuine right-click / long-press is reserved
 *    for the card preview. The card's own tap/pay is intentionally not bound
 *    here so a permanent with both a tap and an ability is never tapped by a
 *    stray click;
 *  - `sheetOpen` / `onSheetClose` drive the {@link ActivatableAbilityMenu}.
 *
 *  When the permanent has no abilities the caller skips this entirely and binds
 *  its own tap/pay `onClick`. */
export function useAbilityCardClick(
    abilities: ActivatableAbility[],
    onActivate: (abilityId: string, keepPriority: boolean) => void
) {
    const [sheetOpen, setSheetOpen] = useState(false);
    const isTouchRef = useRef(false);

    const onTouchStart = useCallback(() => {
        isTouchRef.current = true;
    }, []);

    const onClick = useCallback(
        (e: React.MouseEvent) => {
            // DESKTOP: let the click bubble to the ContextMenuTrigger (which
            // synthesizes a `contextmenu` from a left click), so a left click
            // opens the ability menu. A genuine right-click / long-press is left
            // to the card preview (see ui/context-menu.tsx). The card's
            // tap/pay is intentionally NOT bound here: it is reached via the
            // explicit mana-ability menu entry, so a permanent that has both a
            // tap and an ability is never tapped by a stray click.
            if (!isTouchRef.current) return;
            // TOUCH: divert the tap to the ability affordance and suppress the
            // synthesized context menu.
            e.preventDefault();
            e.stopPropagation();
            if (abilities.length === 1) {
                // Single ability fires immediately on tap; keep-priority is
                // unavailable on touch (no modifier), matching the classic card.
                onActivate(abilities[0].id, false);
            } else {
                setSheetOpen(true);
            }
        },
        [abilities, onActivate]
    );

    const onSheetClose = useCallback(() => setSheetOpen(false), []);

    return { onClick, onTouchStart, sheetOpen, onSheetClose };
}
