// CR 508.1g / 702.154a — the optional-attack-cost affordance. With no button the
// human player can never pay the cost, and no server test reds.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { CardInstance, Combat } from "~/types/game";
import type { Id } from "@convex/_generated/dataModel";
import {
    grizzlyBears,
    llanowarElves,
} from "@convex/cards/sets/lea/green.cards";

const toggleEnlist = vi.fn(async () => {});
vi.mock("convex/react", () => ({
    useMutation: () => toggleEnlist,
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { toggleEnlist: {} } },
}));

const { default: EnlistChoicePanel } = await import("../enlist-choice-panel");

afterEach(() => {
    cleanup();
    toggleEnlist.mockClear();
});

function creature(
    defId: string,
    id: string,
    staticAbilities: string[] = []
): CardInstance {
    return {
        id,
        card: { id: defId },
        types: ["Creature"],
        subtypes: [],
        staticAbilities,
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
    } as unknown as CardInstance;
}

const combat = (over: Partial<Combat> = {}): Combat =>
    ({
        attackerIds: ["attacker"],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
        ...over,
    }) as Combat;

const board = () => [
    creature(grizzlyBears().id, "attacker", ["enlist"]),
    creature(llanowarElves().id, "partner"),
];

function renderPanel(battlefield: CardInstance[], c: Combat = combat()) {
    return render(
        <EnlistChoicePanel
            combat={c}
            battlefield={battlefield}
            gameId={"g1" as Id<"games">}
            playerId="me"
        />
    );
}

describe("EnlistChoicePanel (CR 508.1g / 702.154a)", () => {
    it("offers a creature the declared attacker could tap", () => {
        renderPanel(board());
        expect(
            screen.getByRole("button", { name: /Llanowar Elves/ })
        ).toBeTruthy();
    });

    it("renders nothing when there is no one to tap", () => {
        const { container } = renderPanel([
            creature(grizzlyBears().id, "attacker", ["enlist"]),
        ]);
        expect(container.firstChild).toBeNull();
    });

    it("fires toggleEnlist for the pair and reflects the current choice", () => {
        renderPanel(board());
        const button = screen.getByRole("button", { name: /Llanowar Elves/ });
        expect(button.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(button);
        expect(toggleEnlist).toHaveBeenCalledWith({
            gameId: "g1",
            playerId: "me",
            attackerId: "attacker",
            enlistedId: "partner",
        });

        cleanup();
        renderPanel(
            board(),
            combat({
                enlists: [{ attackerId: "attacker", enlistedId: "partner" }],
            })
        );
        expect(
            screen
                .getByRole("button", { name: /Llanowar Elves/ })
                .getAttribute("aria-pressed")
        ).toBe("true");
    });
});
