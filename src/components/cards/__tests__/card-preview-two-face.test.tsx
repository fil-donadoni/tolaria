// Two-face card preview — original face of a Permanent Copy (CR 707.2) and of a
// full-text effect (CR 612.6), in Live text AND Printed card (issue #9795).
//
// Driven through the REAL wire projection (`projectPublicState`): a hand-built
// instance would mask a `fullTextAnchor` / `preCopyImagePrintId` dropped by the
// reducer (`.claude/rules/gre-development.md` § Frontend wiring analysis).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import {
    makeState,
    makeInstance,
    makePlayer,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { applyCopy } from "@convex/gre/copy";
import { recomputeContinuousEffects } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import { GameContext } from "~/hooks/useGameContext";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance } from "~/types/game";
import CardImage from "../card-image";
import { resetPreviewSingleton } from "../card-preview-singleton";
import { resetPreviewPreferenceDefaultForTests } from "~/lib/preview-preference-store";
import { NO_BOARD_LAYER_VIEW } from "../../../../convex/gre/layers";

const CLONE = getCardByName("Clone");
const SERRA = getCardByName("Serra Angel");
const SHIFTER = getCardByName("Volrath's Shapeshifter");
const SHADE = getCardByName("Frozen Shade");
const BOLT = getCardByName("Lightning Bolt");

const PRINT_CLONE = "c1000000-0000-0000-0000-000000000001";
const PRINT_SERRA = "c2000000-0000-0000-0000-000000000002";
const PRINT_SHIFTER = "c3000000-0000-0000-0000-000000000003";
const PRINT_SHADE = "c4000000-0000-0000-0000-000000000004";

function ctxFor(allPlayers: unknown) {
    return {
        gameId: "g1" as Id<"games">,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN" as const,
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
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

function printedSrcs(): string[] {
    return Array.from(
        anchored()!.querySelectorAll('[data-card-face="printed"]')
    ).map((i) => i.getAttribute("src") ?? i.getAttribute("srcset") ?? "");
}

/** A resolved Clone presenting as Serra Angel, projected through the wire. */
function projectedClone(): CardInstance {
    const copy = makeInstance(CLONE.id, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        imagePrintId: PRINT_CLONE,
    });
    applyCopy(
        NO_BOARD_LAYER_VIEW,
        copy,
        makeInstance(SERRA.id, { imagePrintId: PRINT_SERRA })
    );
    const state = makeState({
        players: [
            { ...makeState().players[0], id: "p1", battlefield: [copy] },
            makeState().players[1],
        ],
    });
    const projected = projectPublicState(state, 1, "p1");
    return projected.players[0].battlefield[0] as CardInstance;
}

/** Volrath's Shapeshifter over `graveyardTop`, projected through the wire. */
function projectedShifter(graveyardTop: string): {
    card: CardInstance;
    players: unknown;
} {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(SHIFTER.id, {
                        id: "shifter",
                        imagePrintId: PRINT_SHIFTER,
                    }),
                ],
                graveyard: [
                    makeInstance(graveyardTop, {
                        id: "top",
                        zone: "graveyard",
                        imagePrintId: PRINT_SHADE,
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    recomputeContinuousEffects(state);
    const projected = projectPublicState(state, 1, "p1");
    return {
        card: projected.players[0].battlefield[0] as CardInstance,
        players: projected.players,
    };
}

function open(card: CardInstance, players: unknown) {
    const { container } = render(
        <GameContext value={ctxFor(players)}>
            <CardImage card={card} />
        </GameContext>
    );
    openPreview(container.firstElementChild as HTMLElement);
}

const pick = (mode: string) =>
    act(() => {
        fireEvent.click(
            anchored()!.querySelector(`[data-preview-mode="${mode}"]`)!
        );
    });

describe("Two-face preview — full-text effect (CR 612.6)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPreviewSingleton();
        resetPreviewPreferenceDefaultForTests();
        localStorage.clear();
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
    });

    it("Live text: the presented creature + Volrath's Shapeshifter, original labelled by mechanism", () => {
        const { card, players } = projectedShifter(SHADE.id);
        expect(card.fullTextAnchor?.underlyingDefId).toBe(SHIFTER.id); // survives the wire
        open(card, players);
        const text = anchored()!.textContent ?? "";
        expect(text).toContain("Current");
        expect(text).toContain("Frozen Shade");
        expect(text).toContain("Volrath's Shapeshifter");
        expect(text).toContain("Original — has the full text of Frozen Shade");
        // The retained `{2}: Discard a card.` rides the presented face.
        expect(text).toContain("Discard a card");
    });

    it("Printed card: the presented print and the Shapeshifter's own print", () => {
        const { card, players } = projectedShifter(SHADE.id);
        open(card, players);
        pick("printed");
        const srcs = printedSrcs();
        expect(srcs).toHaveLength(2);
        expect(srcs.some((s) => s.includes(PRINT_SHADE))).toBe(true);
        expect(srcs.some((s) => s.includes(PRINT_SHIFTER))).toBe(true);
    });

    it("has one face while the top card of the graveyard is not a creature", () => {
        const { card, players } = projectedShifter(BOLT.id);
        open(card, players);
        const text = anchored()!.textContent ?? "";
        expect(text).not.toContain("Original");
        expect(text).not.toContain("Current");
    });
});

describe("Two-face preview — Permanent Copy (CR 707.2)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPreviewSingleton();
        resetPreviewPreferenceDefaultForTests();
        localStorage.clear();
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
    });

    it("labels the original face with the copy mechanism and the presented card", () => {
        const slim = projectedClone();
        open(slim, [{ ...makeState().players[0], battlefield: [slim] }]);
        const text = anchored()!.textContent ?? "";
        expect(text).toContain("Original — copying Serra Angel");
    });

    it("offers Live text / Printed card, and Printed renders both prints", () => {
        const slim = projectedClone();
        open(slim, [{ ...makeState().players[0], battlefield: [slim] }]);
        expect(
            anchored()!.querySelector('[data-preview-mode="computed"]')
        ).toBeTruthy();
        pick("printed");
        const srcs = printedSrcs();
        expect(srcs).toHaveLength(2);
        expect(srcs.some((s) => s.includes(PRINT_SERRA))).toBe(true);
        expect(srcs.some((s) => s.includes(PRINT_CLONE))).toBe(true);
    });

    it("cycles views with the arrow keys; Rulings is the presented card's", async () => {
        const f = vi.fn<(url: string) => Promise<unknown>>(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
        }));
        vi.stubGlobal("fetch", f);
        const slim = projectedClone();
        open(slim, [{ ...makeState().players[0], battlefield: [slim] }]);
        const modeOf = () =>
            Array.from(anchored()!.querySelectorAll("[data-preview-mode]"))
                .find((b) => b.getAttribute("aria-selected") === "true")
                ?.getAttribute("data-preview-mode");
        expect(modeOf()).toBe("computed");
        act(() => {
            fireEvent.keyDown(document, { key: "ArrowRight" });
        });
        expect(modeOf()).toBe("printed");
        act(() => {
            fireEvent.keyDown(document, { key: "ArrowRight" });
        });
        expect(modeOf()).toBe("rulings");
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        // The presented card's print (Serra Angel), never the copier's.
        expect(f.mock.calls[0][0]).toContain(PRINT_SERRA);
        vi.unstubAllGlobals();
    });
});
