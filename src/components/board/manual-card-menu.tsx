import type { CardInstance } from "~/types/game";
import { useAbilityCardClick } from "~/hooks/useAbilityCardClick";
import { useManualCardInteraction } from "~/lib/manual-card-verbs";
import ActivatableAbilityMenu from "./activatable-ability-menu";

/**
 * Wraps a card rendered OUTSIDE the battlefield and the hand — a pile browse
 * dialog tile, a library peek tile — in the Manual Game's verb menu
 * (manual-mode QA round 3).
 *
 * Those cards were inert art. The only way to act on a card in a graveyard,
 * an exile pile or the library was the pile TILE's own "Move top card to …",
 * which reaches exactly one card and only the top one; anything buried needed
 * repeated milling or a shuffle. With this, every card in the dialog carries
 * the same left-click menu the battlefield and the hand already had, its move
 * list computed for the zone it is actually in (`manualVerbsForZone`).
 *
 * A passthrough everywhere else: with no `ManualCardInteractionProvider` above
 * it — every GRE board — or with an empty verb list, it renders `children`
 * untouched and binds nothing. The two hooks below run unconditionally either
 * way, so the rules of hooks hold whichever branch is live.
 */
export default function ManualCardMenu({
    card,
    children,
}: {
    card: CardInstance;
    children: React.ReactNode;
}) {
    const interaction = useManualCardInteraction();
    const abilities = interaction?.getVerbs(card) ?? [];
    const activate = (abilityId: string, keepPriority: boolean) => {
        // Manual verbs never pay a cost — `keepPriority` exists only to match
        // `useAbilityCardClick`'s shared contract with the board cards.
        void keepPriority;
        interaction?.activate(card, abilityId);
    };
    const click = useAbilityCardClick(abilities, activate);

    if (abilities.length === 0) return <>{children}</>;

    return (
        <ActivatableAbilityMenu
            abilities={abilities}
            onActivate={activate}
            sheetOpen={click.sheetOpen}
            onSheetClose={click.onSheetClose}
        >
            <div
                data-manual-card-menu={card.id}
                className="h-full w-full cursor-pointer"
                onClick={click.onClick}
                onTouchStart={click.onTouchStart}
            >
                {children}
            </div>
        </ActivatableAbilityMenu>
    );
}
