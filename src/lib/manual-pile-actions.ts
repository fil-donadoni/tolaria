// Manual pile verbs (PRD #2162, issue #2169) — the value injected into the
// seam `usePileActionsContext` opened.
//
// The GRE piles hardcode `api.game.drawCard` / `mill` / `exileFromLibrary`,
// which have no `gameStates` row to land in behind a manual game. This source
// replaces the library tile's menu with the manual library verbs the deleted
// `LibraryPile` carried, and gives the graveyard and exile tiles the
// "move a card out" verbs they never had (their `browse the full pile` half is
// inherited for free from `CardsPile`).
//
// The three N-parameterised verbs and Shuffle's confirmation collect their
// input through the shared anchored popover (`runtime.requestVerbInput`,
// issue #2170) instead of `window.prompt`/`window.confirm` — the popover is
// anchored to THIS pile tile (`pileAnchorSelector`), so the board stays
// visible behind it.

import type {
    PileAction,
    PileActionsSource,
    PileZone,
} from "~/hooks/usePileActionsContext";
import type { ProjectedManualCard } from "@convex/manual";
import type { ManualRuntime } from "./manual-runtime";
import { findManualAnchor, pileAnchorSelector } from "./manual-verb-anchor";

/** The topmost card of a graveyard / exile pile, i.e. the one a "move out"
 *  verb acts on. Both zones are appended to, so the last entry is the top. */
function topOf(cards: ProjectedManualCard[]): ProjectedManualCard | undefined {
    return cards.length > 0 ? cards[cards.length - 1] : undefined;
}

export function makeManualPileActions(
    runtime: ManualRuntime
): PileActionsSource {
    const { state, dispatch, requestVerbInput } = runtime;
    return (player, zone: PileZone): PileAction[] => {
        const seat = state.players.find((p) => p.id === player.id);
        if (!seat) return [];

        if (zone === "library") {
            // Every N-parameterised verb anchors its popover to THIS pile
            // tile — resolved fresh at click time, never cached, since the
            // tile is a stable, always-mounted element even while the
            // context menu that dispatched the click is unmounting.
            const anchor = () =>
                findManualAnchor(pileAnchorSelector("library", seat.id));
            return [
                {
                    key: "draw-1",
                    label: "Draw 1",
                    onSelect: () => dispatch.draw({ playerId: seat.id, n: 1 }),
                },
                {
                    key: "draw-n",
                    label: "Draw N…",
                    onSelect: () =>
                        requestVerbInput(anchor(), {
                            kind: "number",
                            title: "Draw how many?",
                            defaultValue: 1,
                            onConfirm: (n) =>
                                dispatch.draw({ playerId: seat.id, n }),
                        }),
                },
                {
                    key: "mill-1",
                    label: "Mill 1",
                    onSelect: () => dispatch.mill({ playerId: seat.id, n: 1 }),
                },
                {
                    key: "mill-n",
                    label: "Mill N…",
                    onSelect: () =>
                        requestVerbInput(anchor(), {
                            kind: "number",
                            title: "Mill how many?",
                            defaultValue: 1,
                            onConfirm: (n) =>
                                dispatch.mill({ playerId: seat.id, n }),
                        }),
                },
                {
                    key: "exile-top-1",
                    label: "Exile top 1",
                    onSelect: () =>
                        dispatch.exileTop({ playerId: seat.id, n: 1 }),
                },
                {
                    key: "exile-top-n",
                    label: "Exile top N…",
                    onSelect: () =>
                        requestVerbInput(anchor(), {
                            kind: "number",
                            title: "Exile how many?",
                            defaultValue: 1,
                            onConfirm: (n) =>
                                dispatch.exileTop({ playerId: seat.id, n }),
                        }),
                },
                {
                    key: "peek",
                    label: "Peek top N…",
                    onSelect: () =>
                        requestVerbInput(anchor(), {
                            kind: "number",
                            title: "Peek how many?",
                            defaultValue: 3,
                            onConfirm: (n) =>
                                dispatch.peek({ playerId: seat.id, n }),
                        }),
                },
                {
                    key: "shuffle",
                    label: "Shuffle",
                    onSelect: () =>
                        requestVerbInput(anchor(), {
                            kind: "confirm",
                            title: "Shuffle library?",
                            description: "This cannot be undone.",
                            onConfirm: () =>
                                dispatch.shuffle({ playerId: seat.id }),
                        }),
                },
            ];
        }

        // Graveyard / exile: the pile's OWN browse dialog already shows every
        // card (inherited from `CardsPile`); what it has no way to express is
        // "take the top one back out", so that is exactly what these add.
        const top = topOf(zone === "graveyard" ? seat.graveyard : seat.exile);
        if (!top) return [];
        return [
            {
                key: "top-to-hand",
                label: "Move top card to hand",
                onSelect: () =>
                    dispatch.moveCard({ instanceId: top.id, toZone: "hand" }),
            },
            {
                key: "top-to-battlefield",
                label: "Move top card to battlefield",
                onSelect: () =>
                    dispatch.moveCard({
                        instanceId: top.id,
                        toZone: "battlefield",
                    }),
            },
            {
                key: "top-to-library",
                label: "Move top card to library",
                onSelect: () =>
                    dispatch.moveCard({
                        instanceId: top.id,
                        toZone: "library",
                    }),
            },
        ];
    };
}
