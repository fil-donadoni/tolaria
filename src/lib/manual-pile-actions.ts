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
// The three N-parameterised verbs keep the native `window.prompt` the
// hand-written manual board used, and Shuffle keeps its `window.confirm` —
// today's behaviour verbatim; issue #2170 replaces them.

import type {
    PileAction,
    PileActionsSource,
    PileZone,
} from "~/hooks/usePileActionsContext";
import type { ProjectedManualCard } from "@convex/manual";
import type { ManualRuntime } from "./manual-runtime";

/** Reads a positive count from a native prompt; `null` when the player
 *  cancelled or typed something that isn't a positive integer. */
function promptCount(message: string, fallback: string): number | null {
    const raw = window.prompt(message, fallback);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** The topmost card of a graveyard / exile pile, i.e. the one a "move out"
 *  verb acts on. Both zones are appended to, so the last entry is the top. */
function topOf(cards: ProjectedManualCard[]): ProjectedManualCard | undefined {
    return cards.length > 0 ? cards[cards.length - 1] : undefined;
}

export function makeManualPileActions(
    runtime: ManualRuntime
): PileActionsSource {
    const { state, dispatch } = runtime;
    return (player, zone: PileZone): PileAction[] => {
        const seat = state.players.find((p) => p.id === player.id);
        if (!seat) return [];

        if (zone === "library") {
            return [
                {
                    key: "draw-1",
                    label: "Draw 1",
                    onSelect: () => dispatch.draw({ playerId: seat.id, n: 1 }),
                },
                {
                    key: "draw-n",
                    label: "Draw N…",
                    onSelect: () => {
                        const n = promptCount("Draw how many?", "1");
                        if (n) dispatch.draw({ playerId: seat.id, n });
                    },
                },
                {
                    key: "mill-1",
                    label: "Mill 1",
                    onSelect: () => dispatch.mill({ playerId: seat.id, n: 1 }),
                },
                {
                    key: "mill-n",
                    label: "Mill N…",
                    onSelect: () => {
                        const n = promptCount("Mill how many?", "1");
                        if (n) dispatch.mill({ playerId: seat.id, n });
                    },
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
                    onSelect: () => {
                        const n = promptCount("Exile how many?", "1");
                        if (n) dispatch.exileTop({ playerId: seat.id, n });
                    },
                },
                {
                    key: "peek",
                    label: "Peek top N…",
                    onSelect: () => {
                        const n = promptCount("Peek how many?", "3");
                        if (n) dispatch.peek({ playerId: seat.id, n });
                    },
                },
                {
                    key: "shuffle",
                    label: "Shuffle",
                    onSelect: () => {
                        if (
                            window.confirm(
                                "Shuffle library? This cannot be undone."
                            )
                        ) {
                            dispatch.shuffle({ playerId: seat.id });
                        }
                    },
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
