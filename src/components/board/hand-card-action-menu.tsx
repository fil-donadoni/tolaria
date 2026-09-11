import {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
} from "~/components/ui/context-menu";
import ActionSheet, {
    type ActionSheetItem,
} from "~/components/ui/action-sheet";
import { formatOracleText } from "~/lib/oracle-text";

/** A hand-activatable ability (Cycling, CR 702.29a) surfaced in the menu. */
export type HandCardMenuAbility = { id: string; oracleText: string };

/** The primary hand action for the card — play a land (CR 305) or cast a spell
 *  (CR 601) — shown as the last menu entry when currently legal. */
export type HandCardPrimaryAction = {
    label: string;
    onSelect: (e: React.MouseEvent | React.TouchEvent) => void;
};

/** Left-click / touch affordance for a card in the viewer's OWN hand that has a
 *  hand-activatable ability (today only Cycling — "{cost}, Discard this card:
 *  Draw a card", CR 702.29a). Mirrors {@link ActivatableAbilityMenu} for the
 *  battlefield, but the hand card's menu ALSO lists its primary play/cast action
 *  so a single left-click surfaces every legal choice for that card (the user's
 *  requested UX). The old bottom-anchored "Cycle" button was clipped below the
 *  viewport on the low hand row — a menu can never be off-screen.
 *
 *  Desktop: {@link ContextMenuTrigger} synthesizes a `contextmenu` from the
 *  left-click to open the menu. Mobile: the card owns the tap detection and
 *  toggles `sheetOpen`, driving the {@link ActionSheet} with the same items.
 *
 *  Rendered ONLY when the card offers MORE THAN ONE option — a hand ability
 *  plus its play/cast, or (CR 712.12, ADR 0122) two options of its own: a
 *  modal double-faced card offers a cast of its front face AND a play of its
 *  land back face, with independent legality windows. A card with a single
 *  option keeps its direct click-to-cast / drag-to-cast behaviour, so this
 *  never adds a one-item menu to ordinary hand cards. The server
 *  (`activateAbility` / `announceCast` / `playCard`) is authoritative for
 *  every entry. */
export default function HandCardActionMenu({
    abilities,
    onActivate,
    primaryActions,
    sheetOpen,
    onSheetClose,
    children,
}: {
    abilities: HandCardMenuAbility[];
    onActivate: (abilityId: string, keepPriority: boolean) => void;
    /** Play/cast entries, empty when neither is currently legal (e.g. a
     *  Cycling-only card with no mana to cast it — cycling still shows).
     *
     *  A LIST rather than one entry because CR 712.12 makes it one: a modal
     *  double-faced card in hand offers a cast of its front face and a play of
     *  its land back face, and CR 712.11c / 712.12 evaluate each against the
     *  face it names, so the two windows open and close independently. Every
     *  other card contributes at most one. */
    primaryActions: HandCardPrimaryAction[];
    /** Whether the mobile action-sheet is open (owned by the card, which detects
     *  the touch tap). */
    sheetOpen: boolean;
    onSheetClose: () => void;
    children: React.ReactNode;
}) {
    if (abilities.length + primaryActions.length <= 1) return <>{children}</>;

    const sheetItems: ActionSheetItem[] = [
        ...abilities.map((a) => ({
            key: a.id,
            label: formatOracleText(a.oracleText),
            onSelect: (e: React.MouseEvent | React.TouchEvent) => {
                const keepPriority =
                    "ctrlKey" in e ? e.ctrlKey || e.metaKey : false;
                onActivate(a.id, keepPriority);
            },
        })),
        ...primaryActions.map((a, index) => ({
            key: `primary-${index}`,
            label: a.label,
            onSelect: a.onSelect,
        })),
    ];

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger>{children}</ContextMenuTrigger>
                <ContextMenuContent className="w-72">
                    {abilities.map((a) => (
                        <ContextMenuItem
                            key={a.id}
                            // Match the battlefield menu: `block` keeps the mana
                            // cost inline with the effect text (the symbols are
                            // 1em inline images) instead of the shadcn default
                            // `flex` splitting them into columns.
                            className="block leading-snug whitespace-normal"
                            onClick={(e) =>
                                onActivate(a.id, e.ctrlKey || e.metaKey)
                            }
                        >
                            {formatOracleText(a.oracleText)}
                        </ContextMenuItem>
                    ))}
                    {primaryActions.map((a, index) => (
                        <ContextMenuItem
                            key={`primary-${index}`}
                            className="block leading-snug whitespace-normal"
                            onClick={(e) => a.onSelect(e)}
                        >
                            {a.label}
                        </ContextMenuItem>
                    ))}
                </ContextMenuContent>
            </ContextMenu>
            <ActionSheet
                open={sheetOpen}
                onClose={onSheetClose}
                items={sheetItems}
            />
        </>
    );
}
