// Issue #1221 follow-up — the command-zone emblem UI. Emblems reach the client
// correctly (GRE + wire, covered by interpreter.test.ts) and already drive the
// P/T anthem math, but nothing RENDERED them. These tests assert the visual
// surface, driven THROUGH the real reducer (useGameContext) per the frontend
// wiring rule: a hand-built view masks a dropped field, so the emblems list is
// provided via GameContext exactly as board.tsx threads it.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { EmblemInstance } from "@convex/cards/types";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import PlayerEmblems from "../player-emblems";

const SORIN_ART = "327ddaaf-b6a7-4c80-9b38-5ab68181b3d6";

function makePlayer(id: string): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function renderEmblems(player: Player, emblems: EmblemInstance[]) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [player],
        emblems,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PlayerEmblems player={player} />
        </GameContext>
    );
}

const sorin = (over: Partial<EmblemInstance> = {}): EmblemInstance => ({
    id: "emblem-1",
    ownerId: "me",
    emblemId: "sorin-lord-of-innistrad-emblem",
    name: "Sorin, Lord of Innistrad emblem",
    text: "Creatures you control get +1/+0.",
    imagePrintId: SORIN_ART,
    ...over,
});

beforeEach(() => cleanup());

describe("PlayerEmblems (command-zone emblem UI, issue #1221)", () => {
    it("renders the owner's emblem as its Scryfall art (src built from imagePrintId)", () => {
        const me = makePlayer("me");
        renderEmblems(me, [sorin()]);

        const slot = screen.getByTestId("emblems-me");
        const img = within(slot).getByRole("img");
        // The shared image helper builds the CDN URL from the print id.
        expect(img.getAttribute("src")).toContain(SORIN_ART);
        expect(img.getAttribute("alt")).toBe("Sorin, Lord of Innistrad emblem");
    });

    it("is owner-scoped: an emblem owned by another player is not shown", () => {
        const me = makePlayer("me");
        // Only the opponent owns the emblem — nothing renders for `me`.
        renderEmblems(me, [sorin({ ownerId: "opp" })]);
        expect(screen.queryByTestId("emblems-me")).toBeNull();
    });

    it("renders nothing when the player controls no emblem", () => {
        const me = makePlayer("me");
        renderEmblems(me, []);
        expect(screen.queryByTestId("emblems-me")).toBeNull();
    });

    it("falls back to a text placeholder (name + oracle text) when the def has no art", () => {
        const me = makePlayer("me");
        renderEmblems(me, [sorin({ imagePrintId: undefined })]);

        const slot = screen.getByTestId("emblems-me");
        // No <img> when there is no print id — the in-app placeholder instead.
        expect(within(slot).queryByRole("img")).toBeNull();
        expect(
            within(slot).getByText("Creatures you control get +1/+0.")
        ).toBeTruthy();
        expect(
            within(slot).getByText("Sorin, Lord of Innistrad emblem")
        ).toBeTruthy();
    });

    it("fans identical emblems (same emblemId) into one stacked slot (CR 114.4)", () => {
        const me = makePlayer("me");
        renderEmblems(me, [
            sorin({ id: "emblem-1" }),
            sorin({ id: "emblem-2" }),
        ]);
        const slot = screen.getByTestId("emblems-me");
        // One fanned stack, both members rendered (each a readable tile).
        const stack = slot.querySelector("[data-emblem-stack]");
        expect(stack).toBeTruthy();
        expect(stack!.getAttribute("data-stack-size")).toBe("2");
        expect(within(slot).getAllByRole("img")).toHaveLength(2);
        // A small fan shows every member — no count badge yet.
        expect(slot.querySelector("[data-emblem-count]")).toBeNull();
    });

    it("keeps distinct emblems (different emblemId) in separate slots", () => {
        const me = makePlayer("me");
        renderEmblems(me, [
            sorin({
                id: "emblem-1",
                emblemId: "sorin-lord-of-innistrad-emblem",
            }),
            sorin({
                id: "emblem-2",
                emblemId: "some-other-planeswalker-emblem",
                name: "Other emblem",
            }),
        ]);
        const slot = screen.getByTestId("emblems-me");
        // Two distinct groups → not fanned together.
        expect(slot.querySelectorAll("[data-emblem-stack]").length).toBe(0);
        expect(within(slot).getAllByRole("img")).toHaveLength(2);
    });

    it("shows a ×N count badge once a fan is dense (>= 5 identical)", () => {
        const me = makePlayer("me");
        renderEmblems(
            me,
            Array.from({ length: 5 }, (_, i) => sorin({ id: `emblem-${i}` }))
        );
        const slot = screen.getByTestId("emblems-me");
        const badge = slot.querySelector("[data-emblem-count]");
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toBe("×5");
    });

    // #1770 follow-up from #1802's re-review: the landscape-compact pile rail
    // (`LANDSCAPE_*_PILES_ANCHOR`) that hosts this stack is `overflow-y-auto`,
    // which the CSS overflow spec computes an implied `overflow-x: auto` for
    // too — a badge poking PAST the fan's own box clips instead of scrolling
    // into view there. The badge must sit fully inside the box.
    it("keeps the ×N badge inside the fan's own box, not poking past it", () => {
        const me = makePlayer("me");
        renderEmblems(
            me,
            Array.from({ length: 5 }, (_, i) => sorin({ id: `emblem-${i}` }))
        );
        const badge = screen
            .getByTestId("emblems-me")
            .querySelector("[data-emblem-count]") as HTMLElement;
        expect(badge.className).not.toMatch(/-right-\d/);
        expect(badge.className).toMatch(/\bright-0/);
    });
});

// A fan is wider than one card but exactly ONE CARD TALL. Deriving the
// wrapper's height from its full fan width (`aspect-5/7`) made the slot taller
// than the cards inside it — and in the stretch-aligned pile row that re-shaped
// every neighbouring tile, cropping the companion card's `object-cover` art.
describe("an emblem fan stays one card tall", () => {
    it("sizes the fan slot's height from ONE card width, not the fan width", () => {
        const me = makePlayer("me");
        renderEmblems(
            me,
            Array.from({ length: 3 }, (_, i) => sorin({ id: `emblem-${i}` }))
        );
        const stack = screen
            .getByTestId("emblems-me")
            .querySelector<HTMLElement>("[data-emblem-stack]")!;
        expect(stack.style.height).toBe("calc(var(--card-w-sm) * 7 / 5)");
        expect(stack.style.width).toContain("var(--card-w-sm) +");
        // The aspect utility must NOT also be applied, or it would fight the
        // explicit height.
        expect(stack.className).not.toContain("aspect-");
    });
});
