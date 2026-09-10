// CR 508.1g / 701.43d — the optional-attack-cost affordance. A card that is
// correct in the GRE can be dead in the UI (`convex/CLAUDE.md` § Frontend
// wiring analysis), and for exert the whole mechanic is a button: with no
// affordance the human player can NEVER pay the cost, and no server test reds.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { CardInstance, Combat } from "~/types/game";
import type { Id } from "@convex/_generated/dataModel";
import { glorybringer } from "@convex/cards/sets/akh/red";
import { grizzlyBears } from "@convex/cards/sets/lea/green";

const toggleExert = vi.fn(async () => {});
vi.mock("convex/react", () => ({
    useMutation: () => toggleExert,
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { toggleExert: {} } },
}));

const { default: ExertChoicePanel } = await import("../exert-choice-panel");

afterEach(() => {
    cleanup();
    toggleExert.mockClear();
});

function attacker(defId: string, id: string): CardInstance {
    return {
        id,
        card: { id: defId },
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
    } as unknown as CardInstance;
}

const combat = (over: Partial<Combat> = {}): Combat =>
    ({
        attackerIds: ["glory"],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
        ...over,
    }) as Combat;

function renderPanel(attackers: CardInstance[], c: Combat = combat()) {
    return render(
        <ExertChoicePanel
            combat={c}
            attackers={attackers}
            gameId={"g1" as Id<"games">}
            playerId="me"
        />
    );
}

describe("ExertChoicePanel (CR 508.1g / 701.43d)", () => {
    it("offers the choice for a declared attacker whose card declares it", () => {
        renderPanel([attacker(glorybringer.id, "glory")]);
        expect(
            screen.getByRole("button", { name: /Glorybringer/ })
        ).toBeTruthy();
    });

    it("renders nothing when no declared attacker offers exert", () => {
        const { container } = renderPanel(
            [attacker(grizzlyBears.id, "bears")],
            combat({ attackerIds: ["bears"] })
        );
        expect(container.firstChild).toBeNull();
    });

    it("fires toggleExert for the clicked attacker and reflects the current choice", () => {
        renderPanel([attacker(glorybringer.id, "glory")]);
        const button = screen.getByRole("button", { name: /Glorybringer/ });
        expect(button.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(button);
        expect(toggleExert).toHaveBeenCalledWith({
            gameId: "g1",
            playerId: "me",
            cardInstanceId: "glory",
        });

        cleanup();
        renderPanel(
            [attacker(glorybringer.id, "glory")],
            combat({ exertedIds: ["glory"] })
        );
        expect(
            screen
                .getByRole("button", { name: /Glorybringer/ })
                .getAttribute("aria-pressed")
        ).toBe("true");
    });
});
