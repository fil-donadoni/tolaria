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
import type { ActivatableAbility } from "./battlefield-card";

/** Shared activated-ability affordance UI for both the classic
 *  ({@link BattlefieldCard}) and the spatial ({@link BoardBattlefieldCard})
 *  battlefield cards (PRD #249, slice #278).
 *
 *  Owns the desktop right-click context menu and the mobile touch action-sheet
 *  listing a permanent's activatable abilities (from `useBattlefieldInteraction`'s
 *  `getActivatable`). Selecting an entry dispatches through `onActivate`, which
 *  the consumer wires to the hook's `handleActivateAbility` — so the X-cost
 *  prompt (CR 601.2b), the keep-priority modifier (Ctrl/Cmd) and the dual
 *  mana+stack mana entry / refund flip all flow through ONE code path on both
 *  boards.
 *
 *  Extracted from `BattlefieldCard` on its second consumer (the spatial card),
 *  per the CLAUDE.md "extract shared helper on the 2nd use" rule. The substantial
 *  duplicated part — the context-menu + action-sheet markup and the keep-priority
 *  modifier read — lives here; each card keeps the tiny touch-vs-click decision
 *  (a JSX `onTouchStart` + `onClick`) on its own clickable element, controlling
 *  the action-sheet via `sheetOpen` / `onSheetClose`.
 *
 *  The card passes its full clickable element as `children` (carrying its own
 *  `onClick` for the touch → ability / desktop no-op behavior and its
 *  `data-arrow-anchor-permanent`). When `abilities` is empty the children render
 *  untouched. */
export default function ActivatableAbilityMenu({
    abilities,
    onActivate,
    sheetOpen,
    onSheetClose,
    children,
}: {
    abilities: ActivatableAbility[];
    onActivate: (abilityId: string, keepPriority: boolean) => void;
    /** Whether the mobile action-sheet is open (controlled by the card, which
     *  owns the touch-tap detection). */
    sheetOpen: boolean;
    onSheetClose: () => void;
    children: React.ReactNode;
}) {
    if (abilities.length === 0) return <>{children}</>;

    const sheetItems: ActionSheetItem[] = abilities.map((a) => ({
        key: a.id,
        label: formatOracleText(a.oracleText),
        onSelect: (e: React.MouseEvent | React.TouchEvent) => {
            const keepPriority =
                "ctrlKey" in e ? e.ctrlKey || e.metaKey : false;
            onActivate(a.id, keepPriority);
        },
    }));

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger>{children}</ContextMenuTrigger>
                <ContextMenuContent className="w-72">
                    {abilities.map((a) => (
                        <ContextMenuItem
                            key={a.id}
                            // Override the shadcn default `flex items-center`:
                            // it splits the cost symbols and the effect text
                            // into separate flex children, pushing the cost
                            // into its own left column. `block` keeps the cost
                            // inline in the text flow (the mana symbols are
                            // 1em inline images), so it reads as one paragraph.
                            className="block leading-snug whitespace-normal"
                            onClick={(e) =>
                                onActivate(a.id, e.ctrlKey || e.metaKey)
                            }
                        >
                            {formatOracleText(a.oracleText)}
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
