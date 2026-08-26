// The corner peek-stack's pile title ("Attached to X") for an aura host is
// computed IN `board-battlefield.tsx`'s own `renderHostWithAuras` — issue
// #1735 review round 2 finding 5 found this had NO test at all despite the
// landing commit's message, because `attached-cards-cluster.test.tsx` passes
// `pileTitle` in as a literal prop and never exercises the computation that
// derives it. This file renders the REAL `BoardBattlefield` so the host-name
// derivation actually runs, with a FACE-DOWN host (issue #1735's own case:
// `card.card.id` stays the CR 708.2 sentinel for every viewer, including the
// controller, so the title must resolve through `displayCardId` — exactly
// what `attachmentHostName` (`~/lib/attachment.ts`) does, which this site was
// deduped onto).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: 900, height: 400 },
    }),
}));

vi.mock("convex/react", () => ({
    useQuery: () => undefined,
    useMutation: () => async () => {},
    useAction: () => async () => {},
}));

const DEFS: Record<string, { id: string; name: string }> = {
    "face-down-sentinel": {
        id: "face-down-sentinel",
        name: "Face-down creature",
    },
    "def-djinn": { id: "def-djinn", name: "Mahamoti Djinn" },
    "def-aura": { id: "def-aura", name: "Holy Strength" },
};
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, (id: string) => DEFS[id] ?? null),
    getDefinition: (id: string) => DEFS[id] ?? { id, name: id },
    tryGetDefinition: (id: string) => DEFS[id],
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));

vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("~/hooks/useInertialScroll", () => ({
    useInertialScroll: () => ({ current: null }),
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../combat-panels", () => ({ default: () => null }));

import BoardBattlefield from "../board-battlefield";

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

function renderBattlefield(battlefield: CardInstance[]) {
    const player = makePlayer(battlefield);
    return render(
        <GameContext
            value={
                {
                    gameId: "game-id" as never,
                    playerId: "me",
                    activePlayerId: "me",
                    priorityPlayerId: "me",
                    phase: "PRECOMBAT_MAIN",
                    turn: 1,
                    engineTurn: 1,
                    stackCount: 0,
                    stackItems: [],
                    allPlayers: [player],
                    showAllCards: false,
                    debugAllActions: false,
                    onSwitchGame: () => {},
                } as React.ContextType<typeof GameContext>
            }
        >
            <BoardBattlefield player={player} />
        </GameContext>
    );
}

describe("board-battlefield's aura-cluster pile title (issue #1735 review round 2 finding 5)", () => {
    it("names a FACE-DOWN host by its real known card, not the sentinel or the bare fallback", () => {
        const host: CardInstance = {
            id: "host-1",
            card: { id: "face-down-sentinel" },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            isTapped: false,
            types: ["Creature"],
            faceDown: true,
            knownCardId: "def-djinn",
            power: 2,
            toughness: 2,
        } as CardInstance;
        const aura: CardInstance = {
            id: "aura-1",
            card: { id: "def-aura" },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            isTapped: false,
            types: ["Enchantment"],
            subtypes: ["Aura"],
            attachedTo: "host-1",
        } as CardInstance;

        const { getByText, baseElement } = renderBattlefield([host, aura]);
        const badge = getByText("×1");
        fireEvent.click(badge);
        expect(
            baseElement.textContent?.includes("Attached to Mahamoti Djinn")
        ).toBe(true);
        expect(baseElement.textContent?.includes("permanent")).toBe(false);
    });
});
