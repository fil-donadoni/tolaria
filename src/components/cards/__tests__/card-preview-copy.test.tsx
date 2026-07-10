// Copy card preview — two-face permanent + spell-copy badge (CR 707.2, 707.10).
//
// Driven through the REAL wire projection (`projectPublicState`), per
// `.claude/rules/gre-development.md` § Frontend wiring analysis: a hand-built
// fat state would mask a `copiedFrom` / `isCopy` field dropped by the reducer,
// so both are asserted on the slim projected instance.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { makeState, makeInstance } from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { applyCopy } from "@convex/gre/copy";
import { projectPublicState } from "@convex/gameProjections";
import { GameContext } from "~/hooks/useGameContext";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance } from "~/types/game";
import CardImage from "../card-image";
import { resetPreviewSingleton } from "../card-preview-singleton";

const CLONE = getCardByName("Clone");
const SERRA = getCardByName("Serra Angel");

function ctxFor(allPlayers: unknown) {
    return {
        gameId: "g1" as Id<"games">,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN" as const,
        turn: 1,
        stackCount: 0,
        allPlayers: allPlayers as never,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    };
}

function openPreview(root: HTMLElement) {
    act(() => {
        fireEvent.pointerDown(root, { button: 2 });
    });
    act(() => {
        fireEvent(window, new Event("pointerup"));
    });
}

const anchored = () =>
    document.querySelector(
        "[data-card-preview-anchored]"
    ) as HTMLElement | null;

describe("Copy card preview (CR 707.2 / 707.10)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPreviewSingleton();
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
    });

    it("renders two labeled faces for a copy permanent, through the projection", () => {
        // A resolved Clone presenting as Serra Angel on p1's battlefield.
        const copy = makeInstance(CLONE.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        applyCopy(copy, makeInstance(SERRA.id));
        expect(copy.copiedFrom).toBe(CLONE.id); // sanity: printed id preserved

        const state = makeState({
            players: [
                { ...makeState().players[0], id: "p1", battlefield: [copy] },
                makeState().players[1],
            ],
        });

        // Slim it through the wire — this is the class of bug the rule targets.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield[0] as CardInstance;
        expect(slim.copiedFrom).toBe(CLONE.id); // survives projection

        const { container } = render(
            <GameContext value={ctxFor(projected.players)}>
                <CardImage card={slim} />
            </GameContext>
        );
        openPreview(container.firstElementChild as HTMLElement);

        const panel = anchored();
        expect(panel).toBeTruthy();
        const text = panel!.textContent ?? "";
        expect(text).toContain("Current");
        expect(text).toContain("Original");
        // Current = presented (Serra Angel); Original = printed (Clone).
        expect(text).toContain("Serra Angel");
        expect(text).toContain("Clone");
    });

    it("shows a Copy badge on a spell copy and none otherwise", () => {
        const bolt = makeInstance(getCardByName("Lightning Bolt").id, {
            controllerId: "p1",
            zone: "hand",
        }) as CardInstance;

        // With the badge on.
        const withBadge = render(
            <GameContext value={ctxFor([])}>
                <CardImage card={bolt} showCopyBadge />
            </GameContext>
        );
        openPreview(withBadge.container.firstElementChild as HTMLElement);
        expect(anchored()!.textContent).toContain("Copy");
        cleanup();
        resetPreviewSingleton();

        // With the badge off (default).
        const noBadge = render(
            <GameContext value={ctxFor([])}>
                <CardImage card={bolt} />
            </GameContext>
        );
        openPreview(noBadge.container.firstElementChild as HTMLElement);
        expect(anchored()!.textContent).not.toContain("Copy");
    });

    it("keeps StackItem.isCopy across the projection (spell-copy source)", () => {
        const copySpell = {
            ...makeInstance(getCardByName("Lightning Bolt").id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
            castById: "p1",
            isCopy: true,
        };
        const state = makeState({ stack: [copySpell] });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.stack[0].isCopy).toBe(true);
    });
});
