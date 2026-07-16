// Damage-assignment panel uses EFFECTIVE power as the assignable budget
// (issue #366). A multi-blocked attacker buffed by a combat trick (e.g. Giant
// Growth, +3/+3) must show its effective power as the budget and let the +/-
// buttons assign up to that effective power — not the raw base power, which
// clamped the prompt too low and made the server reject legal assignments.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import type { CardInstance, Combat, Player } from "~/types/game";
import type { EmblemInstance } from "@convex/cards/types";
import { SORIN_LORD_OF_INNISTRAD_EMBLEM_ID } from "@convex/cards/emblems";

// --- Mutation capture ---
type MutArgs = Record<string, unknown>;
const setDamageAssignment = vi.fn((args?: MutArgs) => {
    void args;
    return Promise.resolve();
});

vi.mock("convex/react", () => ({
    useMutation: () => setDamageAssignment,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => ({
    api: { game: { setDamageAssignment: { _name: "setDamageAssignment" } } },
}));

const REGISTRY: Record<string, { id: string; name: string }> = {
    "def-archers": { id: "def-archers", name: "Elvish Archers" },
    "def-lions": { id: "def-lions", name: "Savannah Lions" },
    "def-unicorn": { id: "def-unicorn", name: "Pearled Unicorn" },
};
vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => REGISTRY[id] ?? { id, name: "Unknown" },
    tryGetDefinition: (id: string) => REGISTRY[id] ?? null,
}));

import DamageAssignmentPanel from "../damage-assignment-panel";

function creature(
    id: string,
    defId: string,
    power: number,
    toughness: number,
    controllerId: string,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: defId },
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
        ...overrides,
    } as CardInstance;
}

function makePlayer(id: string, battlefield: CardInstance[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as Player;
}

beforeEach(() => {
    setDamageAssignment.mockClear();
    cleanup();
});

// Repro scenario: Elvish Archers (base 2/1) buffed +3/+3 -> effective 5/4,
// blocked by Savannah Lions (2/1) and Pearled Unicorn (2/2). The attacker's
// controller is the active player and the damage assigner.
function buffedScenario(powerMod: number): {
    combat: Combat;
    allPlayers: Player[];
} {
    const archers = creature("archers", "def-archers", 2, 1, "p1", {
        temporaryPTMods: [{ power: powerMod, toughness: powerMod }],
        isAttacking: true,
    });
    const lions = creature("lions", "def-lions", 2, 1, "p2");
    const unicorn = creature("unicorn", "def-unicorn", 2, 2, "p2");
    const combat = {
        attackerIds: ["archers"],
        confirmed: true,
        blockersConfirmed: true,
        damageConfirmed: false,
        blockerAssignments: { lions: ["archers"], unicorn: ["archers"] },
        damageAssignerIds: { archers: "p1" },
        damageAssignments: {},
    } as Combat;
    return {
        combat,
        allPlayers: [
            makePlayer("p1", [archers]),
            makePlayer("p2", [lions, unicorn]),
        ],
    };
}

function renderPanel(
    combat: Combat,
    allPlayers: Player[],
    emblems?: EmblemInstance[]
) {
    return render(
        <DamageAssignmentPanel
            combat={combat}
            allPlayers={allPlayers}
            gameId={"game-id" as never}
            playerId="p1"
            defenderId="p2"
            emblems={emblems}
        />
    );
}

describe("DamageAssignmentPanel effective-power budget (issue #366)", () => {
    it("shows effective power (5) as the budget, not base power (2)", () => {
        const { combat, allPlayers } = buffedScenario(3);
        const { getByText } = renderPanel(combat, allPlayers);
        // Source label carries the effective budget.
        expect(getByText(/Elvish Archers \(5 dmg\)/)).toBeTruthy();
        // assigned/budget counter starts at 0/5.
        expect(getByText("0/5")).toBeTruthy();
    });

    it("+ button allows assigning up to effective power (5), not base power (2)", () => {
        // Already at base power (2) assigned to lions: the + button on the
        // unicorn must still be live because the effective budget is 5.
        const { combat, allPlayers } = buffedScenario(3);
        combat.damageAssignments = { archers: { lions: 2 } };
        const { getByText, getAllByText } = renderPanel(combat, allPlayers);
        // counter reflects 2 assigned out of 5.
        expect(getByText("2/5")).toBeTruthy();
        // Click + on the unicorn row.
        const plusButtons = getAllByText("+");
        // unicorn is the second target row.
        fireEvent.click(plusButtons[1]);
        expect(setDamageAssignment).toHaveBeenCalledWith(
            expect.objectContaining({
                attackerId: "archers",
                assignments: { lions: 2, unicorn: 1 },
            })
        );
    });

    it("+ button clamps at effective power (no dispatch once total === 5)", () => {
        const { combat, allPlayers } = buffedScenario(3);
        combat.damageAssignments = { archers: { lions: 5 } };
        const { getByText, getAllByText } = renderPanel(combat, allPlayers);
        expect(getByText("5/5")).toBeTruthy();
        const plusButtons = getAllByText("+");
        fireEvent.click(plusButtons[1]); // try to add to unicorn
        expect(setDamageAssignment).not.toHaveBeenCalled();
    });

    // CR 114 (issue #1221) — a command-zone emblem anthem is a source-less,
    // owner-scoped continuous static threaded into the panel via the `emblems`
    // prop (from CombatPanels' game context). It must raise the assignable
    // budget just like a temporary P/T mod.
    it("folds an emblem anthem (+1/+0) into the budget (2 -> 3)", () => {
        const sorinEmblem: EmblemInstance = {
            id: "emblem-1",
            ownerId: "p1",
            emblemId: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
            name: "Sorin, Lord of Innistrad emblem",
            text: "Creatures you control get +1/+0.",
        };
        // buffedScenario(0): base 2/1 attacker, no temporary mod.
        const { combat, allPlayers } = buffedScenario(0);
        const { getByText } = renderPanel(combat, allPlayers, [sorinEmblem]);
        // Emblem lifts the effective-power budget from base 2 to 3.
        expect(getByText(/Elvish Archers \(3 dmg\)/)).toBeTruthy();
        expect(getByText("0/3")).toBeTruthy();
    });

    it("lowers the budget for a negative temporary modifier (-1/-1 -> 1)", () => {
        const { combat, allPlayers } = buffedScenario(-1);
        const { getByText } = renderPanel(combat, allPlayers);
        expect(getByText(/Elvish Archers \(1 dmg\)/)).toBeTruthy();
        expect(getByText("0/1")).toBeTruthy();
        // First + is allowed; assign 1 to lions.
        combat.damageAssignments = { archers: { lions: 1 } };
        cleanup();
        const second = renderPanel(combat, allPlayers);
        expect(second.getByText("1/1")).toBeTruthy();
        const plusButtons = within(second.container).getAllByText("+");
        fireEvent.click(plusButtons[1]);
        expect(setDamageAssignment).not.toHaveBeenCalled();
    });
});
