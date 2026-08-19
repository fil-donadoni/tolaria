// Issue #2551 — full-path guard: the battlefield card is the ONLY caller that
// can be rotated, and it is the seam where the tap rotation and the tilt
// frame have to agree. A `CardTilt3D`-only test cannot catch the failure that
// actually ships here — the component being correct while the board forgets
// to tell it the rotation, or telling it a rotation that does not match the
// one `[data-tap-visual]` applies.
//
// So these assertions run through the REAL `BoardBattlefieldCard` (CardTilt3D
// unmocked, same harness as the sibling tap-inert-layer file) and compare the
// glare box against the rotated layer's own transform rather than against a
// hard-coded string.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import type { CardVisualState } from "../battlefield-card";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));

vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: CardInstance | { id: string } }) => (
        <div
            data-testid="card-image"
            data-card-id={"id" in card ? card.id : "?"}
        />
    ),
}));

import BoardBattlefieldCard from "../board-battlefield-card";

const CREATURE_DEF_ID = "5c1ba0b9-db01-447f-90cc-a2fc2c24146e";

function makeCreature(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "c1",
        card: { id: CREATURE_DEF_ID },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
        ...overrides,
    } as CardInstance;
}

function makePlayer(battlefield: CardInstance[]): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

const NEUTRAL_VS: CardVisualState = {
    interactive: false,
    enabled: false,
    dimmed: false,
    combatOffset: "",
    ringClass: "",
    badge: null,
};

function renderCard(card: CardInstance) {
    const me = makePlayer([card]);
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
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <BoardBattlefieldCard card={card} vs={NEUTRAL_VS} />
        </GameContext>
    );
}

/** jsdom returns a 0×0 box for everything; give the tilt root a real portrait
 *  surface so the pointer math has something to normalise against. */
function stubRect(el: HTMLElement, width: number, height: number) {
    el.getBoundingClientRect = () =>
        ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: width,
            bottom: height,
            width,
            height,
            toJSON: () => ({}),
        }) as DOMRect;
}

function parts(container: HTMLElement) {
    return {
        root: container.querySelector<HTMLElement>("[data-card-tilt-root]")!,
        inner: container.querySelector<HTMLElement>("[data-card-tilt]")!,
        tapVisual: container.querySelector<HTMLElement>("[data-tap-visual]")!,
        glare: container.querySelector<HTMLElement>("[data-card-glare]")!,
    };
}

function rotations(transform: string) {
    const rx = transform.match(/rotateX\(([-\d.]+)deg\)/);
    const ry = transform.match(/rotateY\(([-\d.]+)deg\)/);
    return { rx: Number(rx?.[1]), ry: Number(ry?.[1]) };
}

beforeEach(() => cleanup());

describe("BoardBattlefieldCard hover frame follows the tap rotation (#2551)", () => {
    it("gives the glare box the SAME rotation the visual layer carries while tapped", () => {
        const { container } = renderCard(makeCreature({ isTapped: true }));
        const { tapVisual, glare } = parts(container);
        // Both start from the same `w-full h-full` box inside
        // `[data-card-tilt]`, so an identical transform makes them coincide
        // exactly — the glare's rounded corners land on the card's corners and
        // it covers the long-side overhang instead of the portrait slot strip.
        expect(tapVisual.style.transform).toBe("rotate(90deg)");
        expect(glare.style.transform).toBe(tapVisual.style.transform);
    });

    it("leaves both unrotated on an UNTAPPED permanent", () => {
        const { container } = renderCard(makeCreature({ isTapped: false }));
        const { tapVisual, glare } = parts(container);
        expect(tapVisual.style.transform).toBe("");
        expect(glare.style.transform).toBe("");
    });

    it("tilts and lights a TAPPED permanent in the card's own frame end to end", () => {
        const { container } = renderCard(makeCreature({ isTapped: true }));
        const { root, inner, glare } = parts(container);
        stubRect(root, 200, 280);
        // Slot (184, 180) is card-frame (0.2, -0.3) once the face is rotated
        // 90° clockwise — see `card-tilt-frame.test.ts` for the derivation.
        fireEvent.pointerMove(root, { clientX: 184, clientY: 180 });
        const t = rotations(inner.style.transform);
        expect(t.rx).toBeCloseTo(-2.8, 2);
        expect(t.ry).toBeCloseTo(4.2, 2);
        expect(glare.style.background).toContain("70.00% 20.00%");
    });

    it("keeps an UNTAPPED permanent on the legacy slot-frame mapping", () => {
        const { container } = renderCard(makeCreature({ isTapped: false }));
        const { root, inner, glare } = parts(container);
        stubRect(root, 200, 280);
        fireEvent.pointerMove(root, { clientX: 150, clientY: 210 });
        expect(inner.style.transform).toBe(
            "rotateX(-3.50deg) rotateY(3.50deg) translateZ(28px) scale(1.07)"
        );
        expect(glare.style.background).toContain("75.00% 75.00%");
    });
});
