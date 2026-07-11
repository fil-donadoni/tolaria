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
 *  Rendered ONLY when the card has ≥1 hand ability — a card with no cycling
 *  ability keeps its direct click-to-cast / drag-to-cast behaviour, so this
 *  never adds a one-item menu to ordinary hand cards (matching the
 *  `abilities.length === 0 → children untouched` contract of the battlefield
 *  menu). The server (`activateAbility` / `announceCast` / `playCard`) is
 *  authoritative for every entry. */
export default function HandCardActionMenu({
    abilities,
    onActivate,
    primaryAction,
    sheetOpen,
    onSheetClose,
    children,
}: {
    abilities: HandCardMenuAbility[];
    onActivate: (abilityId: string, keepPriority: boolean) => void;
    /** Play/cast entry, or undefined when neither is currently legal (e.g. a
     *  Cycling-only card with no mana to cast it — cycling still shows). */
    primaryAction?: HandCardPrimaryAction;
    /** Whether the mobile action-sheet is open (owned by the card, which detects
     *  the touch tap). */
    sheetOpen: boolean;
    onSheetClose: () => void;
    children: React.ReactNode;
}) {
    if (abilities.length === 0) return <>{children}</>;

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
        ...(primaryAction
            ? [
                  {
                      key: "primary",
                      label: primaryAction.label,
                      onSelect: primaryAction.onSelect,
                  },
              ]
            : []),
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
                    {primaryAction && (
                        <ContextMenuItem
                            className="block leading-snug whitespace-normal"
                            onClick={(e) => primaryAction.onSelect(e)}
                        >
                            {primaryAction.label}
                        </ContextMenuItem>
                    )}
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
