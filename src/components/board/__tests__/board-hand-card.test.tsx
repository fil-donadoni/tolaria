// Drag-commit parity (seam 3, PRD #249, issue #254). Click and drag-to-cast must
// flow through ONE shared commit pipeline (useHandCardCommit), so a committed
// drag dispatches the SAME mutation with the SAME arguments as a click, and a
// sub-threshold release dispatches nothing. These tests render the interactive
// spatial-board hand card, capture the dispatched mutation via a mocked
// useMutation, and compare drag vs click at the UI layer.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { COMMIT_LIFT_PX } from "~/hooks/useDragToCommit";
import { GameContext } from "~/hooks/useGameContext";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

// A no-op buffer so the hand card's unconditional `usePendingChoiceBuffer()`
// has a provider in these drag/cast tests (no choice is active here).
const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(() => Promise.resolve()),
    isPending: false,
    lastError: null,
    reportError: vi.fn(),
    dismissError: vi.fn(),
};

// Capture mutation dispatches. useMutation(api.game.playCard / announceCast)
// returns one of these spies keyed by the function reference's marker.
const playCard = vi.fn();
const announceCast = vi.fn();
const activateAbility = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard"
            ? playCard
            : ref._name === "activateAbility"
              ? activateAbility
              : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
            activateAbility: { _name: "activateAbility" },
        },
    },
}));

// Controllable card definition: default = vanilla (no X, no modes) so the simple
// parity path runs without a prompt or picker. Individual tests override.
let cardDef: {
    name: string;
    manaCost?: { X?: string };
    additionalCosts?: { payXLife?: boolean };
    modes?: unknown[];
    activatedAbilities?: unknown[];
} = {
    name: "Test Card",
};
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, () => cardDef),
    getDefinition: () => cardDef,
    // getHandStackAbilities (Cycling affordance, #689) resolves the card def via
    // tryGetDefinition; the default vanilla `cardDef` has no activatedAbilities,
    // so no Cycle button appears (preserving these tests' cast/play behavior).
    tryGetDefinition: () => cardDef,
}));

// Inert visuals / tilt / picker so the test sees only the gesture + dispatch.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// Real ModePicker uses variant="portal" → renders outside the card subtree.
// Mirror that with createPortal so the picker click is NOT inside the card's
// onClickCapture path (which would otherwise be swallowed after a drag).
vi.mock("../../cards/mode-picker", async () => {
    const { createPortal } = await import("react-dom");
    return {
        default: ({ onSelect }: { onSelect: (id: string) => void }) =>
            createPortal(
                <button
                    data-testid="mode-pick"
                    onClick={() => onSelect("mode-1")}
                >
                    pick
                </button>,
                document.body
            ),
    };
});

// The X / kicker cost dialog (replaces the old native prompt/confirm). Mirror
// it with a portal button that confirms a fixed chosen X (3) so the test drives
// the same downstream dispatch a real confirm would.
vi.mock("../../cards/cast-cost-dialog", async () => {
    const { createPortal } = await import("react-dom");
    return {
        default: ({
            askX,
            onConfirm,
        }: {
            askX: boolean;
            onConfirm: (v: { chosenX?: number; kickerCount?: number }) => void;
        }) =>
            createPortal(
                <button
                    data-testid="cost-confirm"
                    onClick={() => onConfirm({ chosenX: askX ? 3 : undefined })}
                >
                    confirm
                </button>,
                document.body
            ),
    };
});

import BoardHandCard from "../board-hand-card";

function makeCard(
    id: string,
    legalActions: CardInstance["legalActions"]
): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "hand",
        isTapped: false,
        legalActions,
    };
}

/** The card under its two required providers. `ctxOverrides` exists for the
 *  tap-stage tests (#1767), which need to move the game state under a staged
 *  card (a priority/turn change must drop the stage). `cardProps` forwards
 *  extra `BoardHandCard` props (e.g. `allowHorizontalPan`, issue #1994). */
function tree(
    card: CardInstance,
    ctxOverrides: Record<string, unknown> = {},
    cardProps: Record<string, unknown> = {}
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        ...ctxOverrides,
    } as React.ContextType<typeof GameContext>;
    return (
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <BoardHandCard card={card} {...cardProps} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function renderCard(
    card: CardInstance,
    ctxOverrides: Record<string, unknown> = {},
    cardProps: Record<string, unknown> = {}
) {
    return render(tree(card, ctxOverrides, cardProps));
}

function el() {
    return screen.getByTestId("card-image").closest("[data-board-hand-card]")!;
}

/** Simulate a drag that lifts the card UP by `lift` px (negative dy) and
 *  releases. past COMMIT_LIFT_PX commits (#271/#294 fix 3); below returns to hand. Mirrors the
 *  real pointer sequence: down → move (crosses drag-start) → up. */
function drag(lift: number) {
    const target = el();
    fireEvent.pointerDown(target, { button: 0, clientX: 100, clientY: 400 });
    fireEvent.pointerMove(target, { clientX: 100, clientY: 400 - lift });
    fireEvent.pointerUp(target, { clientX: 100, clientY: 400 - lift });
}

beforeEach(() => {
    playCard.mockClear();
    announceCast.mockClear();
    activateAbility.mockClear();
    cardDef = { name: "Test Card" };
    cleanup();
    resetPendingGameIntents();
});

// jsdom elements lack pointer-capture; stub so setPointerCapture is a no-op.
beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("BoardHandCard drag-commit parity (seam 3, #254)", () => {
    it("a committed land drag dispatches the SAME playCard args as a click", () => {
        const card = makeCard("land1", ["play"]);

        renderCard(card);
        fireEvent.click(el());
        const clickArgs = playCard.mock.calls[0][0];

        playCard.mockClear();
        cleanup();
        // The in-flight game-intent store is module-level and outlives the tree:
        // clear it so the NEXT phase of this test dispatches for real (the commit
        // pipeline drops a second dispatch while one is still round-tripping).
        resetPendingGameIntents();

        renderCard(card);
        drag(120); // well past the commit line
        const dragArgs = playCard.mock.calls[0][0];

        expect(announceCast).not.toHaveBeenCalled();
        expect(dragArgs).toEqual(clickArgs);
        expect(dragArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "land1",
        });
    });

    it("a committed spell drag dispatches the SAME announceCast args as a click", () => {
        const card = makeCard("spell1", ["cast"]);

        renderCard(card);
        fireEvent.click(el());
        const clickArgs = announceCast.mock.calls[0][0];

        announceCast.mockClear();
        cleanup();
        // The in-flight game-intent store is module-level and outlives the tree:
        // clear it so the NEXT phase of this test dispatches for real (the commit
        // pipeline drops a second dispatch while one is still round-tripping).
        resetPendingGameIntents();

        renderCard(card);
        drag(120);
        const dragArgs = announceCast.mock.calls[0][0];

        expect(playCard).not.toHaveBeenCalled();
        expect(dragArgs).toEqual(clickArgs);
        expect(dragArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "spell1",
        });
    });

    it("a sub-threshold release dispatches nothing (returns to hand)", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        drag(20); // below the commit line
        expect(playCard).not.toHaveBeenCalled();
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("issue #944: a card with no legal actions (e.g. an unpayable additional-cost spell) is inert on click AND drag", () => {
        // Mirrors the wire shape the server sends for a spell like Natural
        // Order when the additional-cost sacrifice is unpayable (CR 117.9 /
        // 601.2f, issue #944): `getLegalActions` omits "cast" entirely, so
        // `legalActions` is empty — the card must not be clickable OR
        // draggable-to-commit.
        const card = makeCard("unpayable1", []);
        renderCard(card);
        fireEvent.click(el());
        drag(120); // well past the commit line
        expect(playCard).not.toHaveBeenCalled();
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("a committed drag does NOT also fire the trailing click (single dispatch)", () => {
        const card = makeCard("land1", ["play"]);
        renderCard(card);
        // Full drag THEN the browser's synthetic click on the same element.
        drag(120);
        fireEvent.click(el());
        expect(playCard).toHaveBeenCalledTimes(1);
    });

    it("click still plays/casts a card exactly as before", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        fireEvent.click(el());
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "spell1",
        });
    });

    it("the X-cost dialog path passes the same chosen X for click and drag", () => {
        cardDef = { name: "X Spell", manaCost: { X: "X" } };
        const card = makeCard("xspell", ["cast"]);

        renderCard(card);
        fireEvent.click(el());
        expect(announceCast).not.toHaveBeenCalled(); // deferred to cost dialog
        fireEvent.click(screen.getByTestId("cost-confirm"));
        const clickArgs = announceCast.mock.calls[0][0];

        announceCast.mockClear();
        cleanup();
        // The in-flight game-intent store is module-level and outlives the tree:
        // clear it so the NEXT phase of this test dispatches for real (the commit
        // pipeline drops a second dispatch while one is still round-tripping).
        resetPendingGameIntents();

        renderCard(card);
        drag(120);
        expect(announceCast).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId("cost-confirm"));
        const dragArgs = announceCast.mock.calls[0][0];

        expect(dragArgs).toEqual(clickArgs);
        expect(dragArgs).toMatchObject({ chosenX: 3 });
    });

    it("a pay-X-life spell (no mana X) opens the cost dialog and sends chosenX (Toxic Deluge, Fire Covenant)", () => {
        // Regression: payXLife cards have no `manaCost.X`, so the old gate never
        // opened the dialog and announceCast fired without chosenX → server
        // "Must choose X (≥ 0) life to pay".
        cardDef = {
            name: "Toxic Deluge",
            additionalCosts: { payXLife: true },
        };
        const card = makeCard("toxic", ["cast"]);

        renderCard(card);
        fireEvent.click(el());
        expect(announceCast).not.toHaveBeenCalled(); // deferred to cost dialog
        fireEvent.click(screen.getByTestId("cost-confirm"));

        expect(announceCast.mock.calls[0][0]).toMatchObject({ chosenX: 3 });
    });

    it("a modal-spell drag opens the SAME mode picker as a click, dispatching the chosen mode", () => {
        cardDef = { name: "Modal Spell", modes: [{ id: "mode-1" }] };
        const card = makeCard("modal", ["cast"]);

        // Click → picker opens → choosing a mode dispatches with chosenModeId.
        renderCard(card);
        fireEvent.click(el());
        expect(announceCast).not.toHaveBeenCalled(); // deferred to mode pick
        fireEvent.click(screen.getByTestId("mode-pick"));
        const clickArgs = announceCast.mock.calls[0][0];

        announceCast.mockClear();
        cleanup();
        // The in-flight game-intent store is module-level and outlives the tree:
        // clear it so the NEXT phase of this test dispatches for real (the commit
        // pipeline drops a second dispatch while one is still round-tripping).
        resetPendingGameIntents();

        // Drag past the line → same picker → same dispatch shape.
        renderCard(card);
        drag(120);
        expect(announceCast).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId("mode-pick"));
        const dragArgs = announceCast.mock.calls[0][0];

        expect(dragArgs).toEqual(clickArgs);
        expect(dragArgs).toMatchObject({
            cardInstanceId: "modal",
            chosenModeId: "mode-1",
        });
    });

    it("a card with no legal play/cast action is inert (drag commits nothing)", () => {
        const card = makeCard("inert", []);
        renderCard(card);
        drag(120);
        fireEvent.click(el());
        expect(playCard).not.toHaveBeenCalled();
        expect(announceCast).not.toHaveBeenCalled();
    });
});

describe("BoardHandCard commit threshold (#271 fix 3, #294 fix 3)", () => {
    it("commits a modest upward flick just past the lowered threshold", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        drag(COMMIT_LIFT_PX + 6); // just past the (lowered) commit line
        expect(announceCast).toHaveBeenCalledTimes(1);
    });

    it("does NOT commit an accidental small nudge below the threshold", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        drag(COMMIT_LIFT_PX - 6); // past drag-start (6px) but below commit line
        expect(announceCast).not.toHaveBeenCalled();
        expect(playCard).not.toHaveBeenCalled();
    });
});

describe("BoardHandCard drag is up-only / gated (#294 fix 2-3)", () => {
    it("pins downward drag to 0 — the card never floats below its slot", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        const target = el() as HTMLElement;
        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 400,
        });
        // Drag DOWN 120px and sideways 40px.
        fireEvent.pointerMove(target, { clientX: 140, clientY: 520 });
        const m = target.style.transform.match(
            /translate\(([^,]+),\s*(-?\d+(?:\.\d+)?)px\)/
        );
        expect(m).toBeTruthy();
        // Horizontal tracks the pointer (reorder), vertical is pinned to 0.
        expect(Number(m![2])).toBe(0);
        fireEvent.pointerUp(target, { clientX: 140, clientY: 520 });
    });

    it("an unplayable card gets no lift and never arms", () => {
        const card = makeCard("dead1", []); // no legal play/cast
        renderCard(card);
        const target = el() as HTMLElement;
        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerMove(target, { clientX: 100, clientY: 400 - 200 });
        const m = target.style.transform?.match(
            /translate\([^,]+,\s*(-?\d+(?:\.\d+)?)px\)/
        );
        // No vertical lift even when yanked far up.
        if (m) expect(Number(m![1])).toBe(0);
        expect(target.getAttribute("data-drag-armed")).toBeNull();
        fireEvent.pointerUp(target, { clientX: 100, clientY: 200 });
        expect(announceCast).not.toHaveBeenCalled();
        expect(playCard).not.toHaveBeenCalled();
    });
});

describe("BoardHandCard hover-zoom preview (#271 fix 1)", () => {
    it("mounts the CardImage (hover-zoom vehicle) when idle", () => {
        renderCard(makeCard("spell1", ["cast"]));
        // CardImage owns CardPreview; its presence is the hover vehicle, same
        // as the battlefield card.
        expect(screen.getByTestId("card-image")).toBeTruthy();
    });

    it("keeps the CardImage mounted DURING a drag (preview never torn down)", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        const target = el();
        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerMove(target, { clientX: 100, clientY: 350 });
        // Mid-drag the same hover vehicle is still mounted (not swapped for a
        // plain image), so hover keeps working after the gesture ends.
        expect(screen.getByTestId("card-image")).toBeTruthy();
        fireEvent.pointerUp(target, { clientX: 100, clientY: 350 });
    });
});

describe("BoardHandCard drag containment (#271 fix 4)", () => {
    it("clamps the rendered upward lift so the card stays visible", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        const target = el() as HTMLElement;
        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 400,
        });
        // Yank the card 400px up — far past the band above the hand.
        fireEvent.pointerMove(target, { clientX: 100, clientY: 0 });
        const transform = target.style.transform;
        // Pull out the translate Y (px) from `translate(0px, -Npx) scale(...)`.
        const match = transform.match(/translate\([^,]+,\s*(-?\d+)px\)/);
        expect(match).toBeTruthy();
        const renderedLiftPx = Math.abs(Number(match![1]));
        // Clamped well below the raw 400px so it can't escape into the clipped
        // band above the hand (MAX_LIFT_PX = COMMIT_LIFT_PX + 18).
        expect(renderedLiftPx).toBeLessThanOrEqual(COMMIT_LIFT_PX + 18);
        // Still armed (the RAW lift past the commit line arms the commit
        // regardless of the visual clamp).
        expect(target.getAttribute("data-drag-armed")).toBe("true");
        fireEvent.pointerUp(target, { clientX: 100, clientY: 0 });
    });
});

// CR 113.6 / 702.29a — Cycling (#689) affordance on the viewer's OWN hand card
// through the real component gate (`hasPriority && noPendingInteraction`). The
// old bottom-anchored "Cycle" button was clipped below the low hand row's
// viewport; the affordance is now a left-click action menu (>1 option) or a
// direct click (a single option). These drive the real component so a dropped
// option or a wrong gate can't slip through.
describe("BoardHandCard Cycling affordance (CR 702.29a, #689)", () => {
    const cyclingAbility = {
        id: "cycling",
        oracleText: "Cycling {3} ({3}, Discard this card: Draw a card.)",
        cost: { mana: { generic: 3 }, discardThis: true },
        activateFromHand: true,
        useStack: true,
        effects: [{ op: "draw", player: "controller", count: 1 }],
    };

    it("cycling-only card (no legal play/cast): a left click activates cycling directly, no menu", () => {
        // Miscalculation at an empty stack — not castable, so Cycling is the
        // ONLY option and a click must cycle it directly (no one-item menu).
        cardDef = {
            name: "Miscalculation",
            activatedAbilities: [cyclingAbility],
        };
        const card = makeCard("miscalc", []); // no play/cast legal
        renderCard(card);
        fireEvent.click(el());
        expect(activateAbility).toHaveBeenCalledTimes(1);
        expect(activateAbility.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "miscalc",
            abilityId: "cycling",
        });
        expect(playCard).not.toHaveBeenCalled();
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("cycling + legal play (2 options): a plain left click opens the menu instead of acting directly", () => {
        // Raugrin Triome — a land (play) that can also be cycled. Two options,
        // so the click opens the menu; it must NOT immediately play the land or
        // fire cycling.
        cardDef = {
            name: "Raugrin Triome",
            activatedAbilities: [cyclingAbility],
        };
        const card = makeCard("triome", ["play"]);
        renderCard(card);
        fireEvent.click(el());
        expect(playCard).not.toHaveBeenCalled();
        expect(activateAbility).not.toHaveBeenCalled();
    });

    it("no cycling: an ordinary spell still casts directly on click (menu path untouched)", () => {
        cardDef = { name: "Lightning Bolt" };
        const card = makeCard("bolt", ["cast"]);
        renderCard(card);
        fireEvent.click(el());
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(activateAbility).not.toHaveBeenCalled();
    });
});

// ADR 0026 / PRD #338 (slice 3) — the eye icon renders per-card ONLY on the
// viewer's own hand cards that an opponent legitimately knows (derived
// `seenByOpponent` flag), never generically on the whole hand.
describe("BoardHandCard seenByOpponent eye icon (ADR 0026)", () => {
    it("renders the eye badge when the card is seenByOpponent", () => {
        const card = { ...makeCard("seen", ["cast"]), seenByOpponent: true };
        renderCard(card);
        expect(
            document.querySelector("[data-seen-by-opponent]")
        ).not.toBeNull();
    });

    it("does NOT render the eye badge when the card is not seenByOpponent", () => {
        const card = makeCard("secret", ["cast"]);
        renderCard(card);
        expect(document.querySelector("[data-seen-by-opponent]")).toBeNull();
    });
});

// Touch tap = stage + confirm (issue #1767, parent #1758). Driven through the
// REAL component with synthetic pointer events carrying a `pointerType`, because
// the whole feature is a discrimination on that field: a hand-built call to the
// hook would prove nothing about whether the card actually wires the pointer
// type through to the click that dispatches the mutation.
describe("BoardHandCard touch tap = stage + confirm (#1767)", () => {
    /** A full tap: the pointerdown that types the gesture, its release, and the
     *  click it produces. Below the drag-start deadzone, so it stays a click. */
    function tap(target: Element, pointerType: string) {
        fireEvent.pointerDown(target, {
            button: 0,
            pointerType,
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerUp(target, {
            button: 0,
            pointerType,
            clientX: 100,
            clientY: 400,
        });
        fireEvent.click(target);
    }
    function pill() {
        return document.querySelector("[data-hand-confirm-pill]");
    }

    it("a first touch tap on a land stages it — no playCard, card lifted", () => {
        renderCard(makeCard("land1", ["play"]));
        tap(el(), "touch");
        expect(playCard).not.toHaveBeenCalled();
        expect(el().getAttribute("data-tap-staged")).toBe("true");
        expect(pill()).not.toBeNull();
        expect(pill()!.textContent).toBe("Play");
    });

    it("a second touch tap on the card plays the land exactly once", () => {
        renderCard(makeCard("land1", ["play"]));
        tap(el(), "touch");
        tap(el(), "touch");
        expect(playCard).toHaveBeenCalledTimes(1);
        expect(playCard.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "land1",
        });
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(pill()).toBeNull();
    });

    it("tapping the confirm pill casts the staged spell exactly once", () => {
        renderCard(makeCard("bolt", ["cast"]));
        tap(el(), "touch");
        expect(pill()!.textContent).toBe("Cast");
        fireEvent.click(pill()!);
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "bolt",
        });
        expect(pill()).toBeNull();
    });

    it("tapping elsewhere un-stages and dispatches nothing", () => {
        renderCard(makeCard("bolt", ["cast"]));
        tap(el(), "touch");
        expect(el().getAttribute("data-tap-staged")).toBe("true");
        fireEvent.pointerDown(document.body, { pointerType: "touch" });
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(announceCast).not.toHaveBeenCalled();
        expect(pill()).toBeNull();
    });

    it("a mouse click still casts on the FIRST click and never stages", () => {
        renderCard(makeCard("bolt", ["cast"]));
        tap(el(), "mouse");
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(pill()).toBeNull();
    });

    it("a pen click still casts on the FIRST click and never stages", () => {
        renderCard(makeCard("bolt", ["cast"]));
        tap(el(), "pen");
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(pill()).toBeNull();
    });

    it("a touch DRAG past the commit line still commits directly (no stage)", () => {
        renderCard(makeCard("bolt", ["cast"]));
        const target = el();
        fireEvent.pointerDown(target, {
            button: 0,
            pointerType: "touch",
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerMove(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - (COMMIT_LIFT_PX + 4),
        });
        fireEvent.pointerUp(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - (COMMIT_LIFT_PX + 4),
        });
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(pill()).toBeNull();
    });

    // Issue #1832 review fixup (follow-up to #1820): a touch tap always carries
    // some jitter — up to ~8px is well within a real device's own touch slop
    // (Chrome Android ~8dp, Safari ~10px) and a finger never perceives it as a
    // drag. Before the touch-specific deadzone this 8px crossed the old flat
    // 6px `DRAG_START_PX`, so `onPointerMove` flipped `active` true,
    // `onPointerUp` read `wasDragging=true && !lifted` and armed
    // `swallowNextClick`, and the trailing click — the ONLY path that stages a
    // touch tap via `useTapStageConfirm.consumeClick` — was eaten by
    // `onClickCapture` before it ever reached the card's `onClick`. The tap did
    // NOTHING: no commit, no stage, no pill (AC#2 violation). With the wider
    // touch-only deadzone this same jitter never starts a drag at all, so the
    // click sails through untouched and stages exactly like a jitter-free tap.
    it("issue #1832: a touch tap with ~8px jitter still stages (AC#2)", () => {
        renderCard(makeCard("land1", ["play"]));
        const target = el();
        fireEvent.pointerDown(target, {
            button: 0,
            pointerType: "touch",
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerMove(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - 8, // jitter, below the touch drag-start deadzone (10)
        });
        fireEvent.pointerUp(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - 8,
        });
        fireEvent.click(target);

        expect(playCard).not.toHaveBeenCalled();
        expect(el().getAttribute("data-tap-staged")).toBe("true");
        expect(pill()).not.toBeNull();
        expect(pill()!.textContent).toBe("Play");
    });

    // Same regression, the other half of AC#3: a touch drag that DOES cross the
    // (now wider) drag-start deadzone but is released before the commit line
    // must still commit/stage NOTHING — it reads as an aborted drag, not a tap,
    // so the trailing click stays swallowed. This pins the 10..COMMIT_LIFT_PX
    // band as unchanged behavior; only the "is this a drag at all" cutoff moved.
    it("issue #1832: a touch drag past the deadzone but aborted below the commit line stages/commits nothing (AC#3)", () => {
        renderCard(makeCard("bolt", ["cast"]));
        const target = el();
        fireEvent.pointerDown(target, {
            button: 0,
            pointerType: "touch",
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerMove(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - 16, // past the 10px touch deadzone, well below COMMIT_LIFT_PX (26)
        });
        fireEvent.pointerUp(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - 16,
        });
        fireEvent.click(target);

        expect(announceCast).not.toHaveBeenCalled();
        expect(playCard).not.toHaveBeenCalled();
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(pill()).toBeNull();
    });

    // Regression (issue #1820): on a real touch device, swiping a hand card
    // up no longer cast/played it — only tap-with-confirm still worked. Root
    // cause: a touch `pointerdown` grants the deepest hit-tested DESCENDANT
    // under the card root (its tilt/preview/image subtree) IMPLICIT pointer
    // capture. `useDragToCommit.onPointerMove`'s first `setPointerCapture`
    // call — on the card ROOT, once the move crosses the drag-start deadzone
    // — transfers capture away from that descendant, which fires a BUBBLING
    // `lostpointercapture` that reaches the root's own handler. The unguarded
    // handler (pre-fix) read that bubble as "this card lost its capture mid
    // drag" and reset() the gesture on the spot — the very first qualifying
    // move — so the drag state was wiped before the swipe could ever reach
    // the commit threshold. Mouse never triggers this (no implicit capture
    // on pointerdown for a mouse pointer), matching the reported "tap still
    // works, mouse still works, only touch swipe is dead" shape. The EXACT
    // same trap was already found and fixed for `LibraryOrderPicker` /
    // `TriggerOrderPrompt` (issue #1772, same day) but missed here.
    it("issue #1820: a touch implicit-capture transfer bubble does not kill the swipe mid-drag", () => {
        renderCard(makeCard("bolt", ["cast"]));
        const target = el();
        // A real DOM descendant of the card root — where a real touch's
        // implicit capture actually lands (the deepest hit-tested element),
        // never the root itself.
        const descendant = screen.getByTestId("card-image");

        fireEvent.pointerDown(target, {
            button: 0,
            pointerType: "touch",
            clientX: 100,
            clientY: 400,
        });
        // Crosses DRAG_START_PX — this is the move whose `setPointerCapture`
        // call on the root triggers the transfer in a real browser.
        fireEvent.pointerMove(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - 10,
        });
        // The implicit-capture transfer: the browser fires
        // `lostpointercapture` on the DESCENDANT that held it, and it bubbles
        // up through the card root's own handler (target !== currentTarget).
        fireEvent.lostPointerCapture(descendant, { pointerType: "touch" });
        // The swipe continues past the commit line and releases — a real
        // finger never left the screen, so the gesture must still be alive.
        fireEvent.pointerMove(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - (COMMIT_LIFT_PX + 6),
        });
        fireEvent.pointerUp(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - (COMMIT_LIFT_PX + 6),
        });

        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(playCard).not.toHaveBeenCalled();
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(pill()).toBeNull();
    });

    // A `lostpointercapture` whose target IS the card root itself (the hand's
    // own drag-reorder re-keying the slot mid-drag, #294 fix 2) must still
    // reset the gesture — the guard added for #1820 only exempts a BUBBLED
    // event from a descendant, not a genuine loss on the root.
    it("a genuine capture loss ON THE ROOT still resets the drag (#294 fix 2 preserved)", () => {
        renderCard(makeCard("bolt", ["cast"]));
        const target = el();
        fireEvent.pointerDown(target, {
            button: 0,
            pointerType: "touch",
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerMove(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - (COMMIT_LIFT_PX + 4),
        });
        // The root itself loses capture (target === currentTarget) — the
        // gesture must reset, so a stray trailing pointerup commits nothing.
        fireEvent.lostPointerCapture(target, { pointerType: "touch" });
        fireEvent.pointerUp(target, {
            pointerType: "touch",
            clientX: 100,
            clientY: 400 - (COMMIT_LIFT_PX + 4),
        });
        expect(announceCast).not.toHaveBeenCalled();
        expect(playCard).not.toHaveBeenCalled();
    });

    it("a priority change drops the stage (no stale stage)", () => {
        const card = makeCard("bolt", ["cast"]);
        const { rerender } = renderCard(card);
        tap(el(), "touch");
        expect(el().getAttribute("data-tap-staged")).toBe("true");
        rerender(tree(card, { priorityPlayerId: "them", turn: 2 }));
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(announceCast).not.toHaveBeenCalled();
        expect(pill()).toBeNull();
    });

    it("losing the legal cast drops the stage", () => {
        const card = makeCard("bolt", ["cast"]);
        const { rerender } = renderCard(card);
        tap(el(), "touch");
        expect(el().getAttribute("data-tap-staged")).toBe("true");
        rerender(tree({ ...card, legalActions: [] }));
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(pill()).toBeNull();
    });

    // Review finding: every overlay the card opens (cost dialog, mode /
    // alt-cost / Phyrexian picker) is a PORTAL — outside the card in the DOM,
    // but still a CHILD of it in the React tree, so React bubbles its clicks
    // back into the card's own onClick. After a cast-with-dialog on touch, the
    // dialog's confirm therefore re-entered the commit path and RE-STAGED the
    // card that had just been cast (the touch pointer type from the tap is
    // still on record) — a stray floating "Cast" pill whose tap fired a SECOND
    // commit.
    it("confirming the portaled cost dialog does NOT re-stage the just-cast card", () => {
        cardDef = { name: "X Spell", manaCost: { X: "X" } };
        renderCard(makeCard("xspell", ["cast"]));
        tap(el(), "touch"); // stage
        tap(el(), "touch"); // confirm → opens the X cost dialog
        expect(announceCast).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId("cost-confirm"));

        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(pill()).toBeNull();
    });

    it("choosing a mode in the portaled picker does NOT re-stage the just-cast card", () => {
        cardDef = { name: "Modal Spell", modes: [{ id: "mode-1" }] };
        renderCard(makeCard("modal", ["cast"]));
        tap(el(), "touch"); // stage
        tap(el(), "touch"); // confirm → opens the mode picker
        expect(announceCast).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId("mode-pick"));

        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            chosenModeId: "mode-1",
        });
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(pill()).toBeNull();
    });

    it("an inert card (no legal action) never stages on a touch tap", () => {
        renderCard(makeCard("inert", []));
        tap(el(), "touch");
        expect(el().getAttribute("data-tap-staged")).toBeNull();
        expect(playCard).not.toHaveBeenCalled();
        expect(announceCast).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Double swipe-to-cast on mobile (the "Server Error" report).
//
// A swipe casts; the engine parks on the cast (payment / target selection) and
// the card STAYS in hand. Every commit surface must go inert for that whole
// window — both after the server state lands (`pendingCast` in context, and
// server-side `legalActions` drops "cast": see `getLegalActions`) and during
// the round trip before it does (the in-flight game-intent store). Otherwise
// the second swipe dispatches a doomed `announceCast` whose rejection reaches
// the player as a bare "Server Error" in production.
// ---------------------------------------------------------------------------
describe("commit gesture is inert while an interaction is pending", () => {
    it("a second swipe inside the first one's round trip dispatches nothing", () => {
        renderCard(makeCard("spell1", ["cast"]));

        drag(120);
        drag(120); // the mis-swipe, before the first cast has round-tripped

        expect(announceCast).toHaveBeenCalledTimes(1);
    });

    it("a second land drag inside the round trip dispatches nothing", () => {
        renderCard(makeCard("land1", ["play"]));

        drag(120);
        drag(120);

        expect(playCard).toHaveBeenCalledTimes(1);
    });

    it("a swipe dispatches nothing while a cast payment is parked", () => {
        renderCard(makeCard("spell1", ["cast"]), {
            pendingCast: {
                playerId: "me",
                cardInstanceId: "other-spell",
                manaCost: { R: 1 },
                tappedLandIds: [],
            },
        });

        drag(120);
        fireEvent.click(el());

        expect(announceCast).not.toHaveBeenCalled();
    });

    it("a swipe dispatches nothing while target selection is open", () => {
        renderCard(makeCard("spell1", ["cast"]), {
            pendingTarget: {
                playerId: "me",
                cardInstanceId: "other-spell",
                targetType: "Creature",
                count: 1,
                selected: [],
            },
        });

        drag(120);

        expect(announceCast).not.toHaveBeenCalled();
    });

    it("a swipe dispatches nothing while the viewer does not hold priority", () => {
        renderCard(makeCard("spell1", ["cast"]), {
            priorityPlayerId: "opponent",
        });

        drag(120);

        expect(announceCast).not.toHaveBeenCalled();
    });
});

// Issue #1994: with 10-12 cards in the portrait hand, cards past the right
// edge were unreachable. Root cause — the card root disabled ALL native touch
// gestures (`touch-action: none`, Tailwind `touch-none`) unconditionally, so a
// touch swipe starting on a card (almost all of the hand row's touch surface,
// given the fan overlap) could never be recognized by the browser as the
// portrait hand's own `overflow-x-auto` scroll (#336), regardless of any JS
// `preventDefault`. `allowHorizontalPan` (set by the portrait hand only) swaps
// `touch-none` for `touch-pan-x`: native Y-panning stays disabled (so the
// vertical drag-to-cast gesture still reaches JS), but a horizontal swipe is
// now handed to the browser's own scroll.
describe("BoardHandCard touch-action (issue #1994)", () => {
    it("disables ALL native touch panning by default (spatial/landscape hand, unchanged)", () => {
        renderCard(makeCard("land1", ["play"]));
        expect(el().className).toContain("touch-none");
        expect(el().className).not.toContain("touch-pan-x");
    });

    it("allows native horizontal panning when allowHorizontalPan is set (portrait hand)", () => {
        renderCard(
            makeCard("land1", ["play"]),
            {},
            { allowHorizontalPan: true }
        );
        expect(el().className).toContain("touch-pan-x");
        expect(el().className).not.toContain("touch-none");
    });

    it("keeps the pan opt-in even for an inert card (no legal action)", () => {
        renderCard(makeCard("inert", []), {}, { allowHorizontalPan: true });
        expect(el().className).toContain("touch-pan-x");
    });
});
