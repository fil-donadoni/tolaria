import type { PendingChoice, PendingChoiceKind } from "~/types/game";

/** Pending-choice kinds whose ONLY interactive surface is owned by a pile
 *  component — `PlayerLibrary`, `PlayerGraveyard` or `PlayerExile`.
 *
 *  These are the kinds for which `PendingChoicePrompt` renders nothing (or only
 *  a "waiting for X" line for the non-chooser): the pile itself raises the
 *  blocking UI, either the full-screen `LibraryOrderPicker` (`order-top` /
 *  `look-distribute` / `reorder-library`) or a `forceOpen` `CardsPile` grid
 *  (`search-library`, `look-top`, `draw-look-keep`, `choose-graveyard-card`,
 *  `choose-exile-card`). If the pile is not mounted, the chooser gets NO UI at
 *  all and the game softlocks — which is why the portrait Zones drawer mounts
 *  `BoardPileChips` unconditionally and only toggles visibility (#1759). */
const PILE_OWNED_CHOICE_KINDS: ReadonlySet<PendingChoiceKind> =
    new Set<PendingChoiceKind>([
        "search-library",
        "look-top",
        "draw-look-keep",
        "order-top",
        "look-distribute",
        "reorder-library",
        "choose-graveyard-card",
        "choose-exile-card",
    ]);

/** Whether the active pending choice's blocking surface is owned by one of the
 *  VIEWER's own piles, i.e. by the `BoardPileChips` row the portrait Zones
 *  drawer mounts.
 *
 *  True only when the viewer is the chooser AND the picked zone belongs to the
 *  viewer (`zoneOwnerId ?? playerId`) — a Word of Command style pick that
 *  searches the OPPONENT's library is surfaced by the opponent's chip row on
 *  the board overlay instead, which is always visible.
 *
 *  The portrait bar uses this to force the Zones drawer open, so a blocking
 *  choice is reachable even if the drawer's own hiding mechanism would clip a
 *  surface that does not portal out of it. */
export function pileChoiceNeedsViewerZones(
    choice: PendingChoice | undefined,
    viewerId: string
): boolean {
    if (!choice) return false;
    if (!PILE_OWNED_CHOICE_KINDS.has(choice.kind)) return false;
    if (choice.playerId !== viewerId) return false;
    return (choice.zoneOwnerId ?? choice.playerId) === viewerId;
}
