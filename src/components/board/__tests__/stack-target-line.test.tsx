// The stack row's Targets block (issue #9326, variant B — superseding the
// arrows-only desktop rule and the phone-only name line of issue #2727).
//
// An arrow into a graveyard lands on the PILE and cannot say which card; the
// phone panels cover the arrows' far end. So every viewport lists every target
// inside its row, WHERE it is included, and the block collapses to its header.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Player, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("~/hooks/useDraggable", () => ({
    useDraggable: () => ({ offset: { x: 0, y: 0 }, dragHandlers: {} }),
}));
vi.mock("../drag-handle", () => ({ default: () => null }));
vi.mock("../../cards/stack-card-image", () => ({
    default: () => <div data-testid="stack-card" />,
}));
vi.mock("~/components/cards/card-image", () => ({
    default: () => <span data-testid="card-image" />,
}));
vi.mock("@convex/cards", async (orig) => {
    const real = await orig<typeof import("@convex/cards")>();
    return {
        ...real,
        tryGetDefinition: (id: string) =>
            id.startsWith("def-")
                ? { name: id === "def-elf" ? "Llanowar Elves" : id.slice(4) }
                : real.tryGetDefinition(id),
    };
});

import GameStack from "../game-stack";
import StackRow from "../stack-row";

function makeStackItem(id: string, targets?: StackItem["targets"]): StackItem {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        castById: "me",
        zone: "stack",
        isTapped: false,
        targets,
    } as StackItem;
}

const ELF = { id: "elf-2", card: { id: "def-elf" } };
const RIVAL = {
    id: "opp",
    name: "Rival",
    battlefield: [],
    graveyard: [{ id: "elf-1", card: { id: "def-elf" } }, ELF],
};

const STACK = [
    makeStackItem("below"),
    makeStackItem("bolt", [
        { type: "player" as const, id: "opp" },
        { type: "spell" as const, id: "below" },
    ]),
];

function renderWith(
    stack: StackItem[],
    players: unknown[],
    props: { narrow?: boolean; landscape?: boolean } = {}
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: stack.length,
        stackItems: stack,
        allPlayers: players as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <GameStack stack={stack} {...props} />
        </GameContext>
    );
}

function renderStack(props: { narrow?: boolean; landscape?: boolean } = {}) {
    return renderWith(STACK, [RIVAL], props);
}

beforeEach(() => cleanup());

describe("Targets block — every viewport lists every target with WHERE it is", () => {
    for (const [label, props] of [
        ["desktop", {}],
        ["portrait", { narrow: true }],
        ["landscape-compact", { landscape: true }],
    ] as const) {
        it(`${label}: the row lists its player and spell targets`, () => {
            const { container } = renderStack(props);
            const lines = Array.from(
                container.querySelectorAll("[data-stack-target-line]")
            ).map((l) => l.textContent);
            expect(lines).toHaveLength(2);
            expect(lines[0]).toContain("Rival");
            expect(lines[0]).toContain("player");
            // `below` is the bottom of a 2-item stack: the panel's row #2.
            expect(lines[1]).toContain("#2 on the stack (spell)");
            expect(container.textContent).toContain("Targets · 2");
        });
    }

    it("collapses to its header — the lines go, the header anchor stays", () => {
        const { container } = renderStack();
        const toggle = container.querySelector<HTMLElement>(
            "[data-stack-targets-toggle]"
        )!;
        fireEvent.click(toggle);
        expect(container.querySelector("[data-stack-target-line]")).toBeNull();
        expect(toggle.getAttribute("data-arrow-anchor-stack-target")).toBe(
            "bolt|header"
        );
        fireEvent.click(toggle);
        expect(
            container.querySelectorAll("[data-stack-target-line]")
        ).toHaveLength(2);
    });

    it("toggling never selects the row (the toggle sits inside the row button)", () => {
        const onSelect = vi.fn();
        const { container } = render(
            <StackRow
                item={STACK[1]}
                order={1}
                isTop
                isTargetable
                onSelect={onSelect}
                onHoverSeed={() => {}}
                dimmed={false}
                arrived={false}
                allPlayers={[RIVAL] as unknown as Player[]}
                viewerId="me"
                stack={STACK}
            />
        );
        fireEvent.click(
            container.querySelector<HTMLElement>("[data-stack-targets-toggle]")!
        );
        expect(onSelect).not.toHaveBeenCalled();
        expect(container.querySelector("[data-stack-target-line]")).toBeNull();
    });
});

describe("Targets block — a graveyard card names its position in its zone", () => {
    it("the middle of three identical cards is #2 in Rival's graveyard", () => {
        const stack = [
            makeStackItem("reanimate", [
                {
                    type: "graveyard-card" as const,
                    id: "elf-2",
                    playerId: "opp",
                },
            ]),
        ];
        const rival = {
            ...RIVAL,
            graveyard: [
                { id: "elf-1", card: { id: "def-elf" } },
                ELF,
                { id: "elf-3", card: { id: "def-elf" } },
            ],
        };
        const { container } = renderWith(stack, [rival]);
        const line = container.querySelector("[data-stack-target-line]");
        expect(line?.textContent).toContain("#2 in Rival's graveyard");
        expect(line?.getAttribute("data-arrow-anchor-stack-target")).toBe(
            "reanimate|graveyard-card:elf-2"
        );
    });
});
