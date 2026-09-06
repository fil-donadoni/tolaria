// Damage-assignment panel uses EFFECTIVE power as the assignable budget
// (issue #366). A multi-blocked attacker buffed by a combat trick (e.g. Giant
// Growth, +3/+3) must show its effective power as the budget and let the +/-
// buttons assign up to that effective power — not the raw base power, which
// clamped the prompt too low and made the server reject legal assignments.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContinuousEffect } from "@convex/gre/continuousEffects";
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
    "def-mammoth": { id: "def-mammoth", name: "War Mammoth" },
    "def-wall": { id: "def-wall", name: "Wall of Stone" },
    "def-liliana": { id: "def-liliana", name: "Liliana of the Veil" },
};
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, (id: string) => REGISTRY[id] ?? null),
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
    continuousEffects: ContinuousEffect[];
} {
    const archers = creature("archers", "def-archers", 2, 1, "p1", {
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
        // CR 613.4c (ADR 0082, PRD #2064 S6) — the combat trick is a
        // Continuous Effects Registry entry the panel must be handed, exactly
        // as it must be handed `emblems`. Without it the budget clamps back to
        // base power, which is the regression this suite guards.
        continuousEffects: [
            {
                id: "ce-1",
                layer: 7,
                sublayer: "7c",
                timestamp: 1,
                expiry: {
                    kind: "duration",
                    duration: { phase: "end-of-turn" },
                    controllerId: "p1",
                },
                affected: { kind: "instances", instanceIds: ["archers"] },
                payload: {
                    kind: "pt-modify",
                    power: powerMod,
                    toughness: powerMod,
                },
                characteristicDefining: false,
            },
        ],
    };
}

function renderPanel(
    combat: Combat,
    allPlayers: Player[],
    emblems?: EmblemInstance[],
    continuousEffects?: ContinuousEffect[]
) {
    return render(
        <DamageAssignmentPanel
            combat={combat}
            allPlayers={allPlayers}
            gameId={"game-id" as never}
            playerId="p1"
            defenderId="p2"
            emblems={emblems}
            continuousEffects={continuousEffects}
        />
    );
}

describe("DamageAssignmentPanel effective-power budget (issue #366)", () => {
    it("shows effective power (5) as the budget, not base power (2)", () => {
        const { combat, allPlayers, continuousEffects } = buffedScenario(3);
        const { getByText } = renderPanel(combat, allPlayers, undefined, continuousEffects);
        // Source label carries the effective budget.
        expect(getByText(/Elvish Archers \(5 dmg\)/)).toBeTruthy();
        // assigned/budget counter starts at 0/5.
        expect(getByText("0/5")).toBeTruthy();
    });

    it("+ button allows assigning up to effective power (5), not base power (2)", () => {
        // Already at base power (2) assigned to lions: the + button on the
        // unicorn must still be live because the effective budget is 5.
        const { combat, allPlayers, continuousEffects } = buffedScenario(3);
        combat.damageAssignments = { archers: { lions: 2 } };
        const { getByText, getAllByText } = renderPanel(combat, allPlayers, undefined, continuousEffects);
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
        const { combat, allPlayers, continuousEffects } = buffedScenario(3);
        combat.damageAssignments = { archers: { lions: 5 } };
        const { getByText, getAllByText } = renderPanel(combat, allPlayers, undefined, continuousEffects);
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
        const { combat, allPlayers, continuousEffects } = buffedScenario(0);
        const { getByText } = renderPanel(combat, allPlayers, [sorinEmblem]);
        // Emblem lifts the effective-power budget from base 2 to 3.
        expect(getByText(/Elvish Archers \(3 dmg\)/)).toBeTruthy();
        expect(getByText("0/3")).toBeTruthy();
    });

    it("lowers the budget for a negative temporary modifier (-1/-1 -> 1)", () => {
        const { combat, allPlayers, continuousEffects } = buffedScenario(-1);
        const { getByText } = renderPanel(combat, allPlayers, undefined, continuousEffects);
        expect(getByText(/Elvish Archers \(1 dmg\)/)).toBeTruthy();
        expect(getByText("0/1")).toBeTruthy();
        // First + is allowed; assign 1 to lions.
        combat.damageAssignments = { archers: { lions: 1 } };
        cleanup();
        const second = renderPanel(combat, allPlayers, undefined, continuousEffects);
        expect(second.getByText("1/1")).toBeTruthy();
        const plusButtons = within(second.container).getAllByText("+");
        fireEvent.click(plusButtons[1]);
        expect(setDamageAssignment).not.toHaveBeenCalled();
    });

    // #1770 mobile QA sweep touch-target audit: the +/- steppers rendered at
    // `w-6 h-6` (24px) — well under the 44px floor every other bar/pill
    // control in the mobile controls meets.
    it("sizes the +/- steppers to the 44px touch-target floor", () => {
        const { combat, allPlayers, continuousEffects } = buffedScenario(0);
        const { getAllByText } = renderPanel(combat, allPlayers, undefined, continuousEffects);
        for (const btn of [...getAllByText("-"), ...getAllByText("+")]) {
            expect(btn.className).toContain("w-11");
            expect(btn.className).toContain("h-11");
        }
    });
});

// ---------------------------------------------------------------------------
// CR 702.19b / CR 702.2c lethal-minimum gating (issue #2444; review finding on
// PR #2483 — the `{...rowGating(...)}` spreads shipped with no test at all,
// so deleting both of them left the whole suite green).
//
// `bun run cr 702.19b`: "The attacking creature's controller need not assign
// lethal damage to all those blocking creatures but in that case can't assign
// any damage to the player or planeswalker it's attacking."
//
// `setDamageAssignment` refuses exactly that pair, so the modal must never
// OFFER it: a click the server rejects surfaces as an unexplained mutation
// error. These tests render the real panel and read the buttons' `disabled`
// state, i.e. they run through the same `damageAssignmentPlan` /
// `assignmentIsRejected` path the component uses.
// ---------------------------------------------------------------------------

/** A 4/4 trampler blocked by a 3/3 wall; `p2` is the defending player. */
function trampleScenario(
    attackerAbilities: string[] = ["trample"],
    damageAssignments: Record<string, Record<string, number>> = {},
    withPlaneswalker = false
): { combat: Combat; allPlayers: Player[] } {
    const mammoth = creature("mammoth", "def-mammoth", 4, 4, "p1", {
        isAttacking: true,
        staticAbilities: attackerAbilities,
    });
    const wall = creature("wall", "def-wall", 0, 3, "p2", {
        isBlocking: true,
    });
    const liliana = creature("liliana", "def-liliana", 0, 0, "p2", {
        types: ["Planeswalker"],
        counters: { loyalty: 3 },
    });
    const combat = {
        attackerIds: ["mammoth"],
        confirmed: true,
        blockersConfirmed: true,
        damageConfirmed: false,
        blockerAssignments: { wall: ["mammoth"] },
        damageAssignerIds: { mammoth: "p1" },
        damageAssignments,
        ...(withPlaneswalker ? { attackTargets: { mammoth: "liliana" } } : {}),
    } as Combat;
    return {
        combat,
        allPlayers: [
            makePlayer("p1", [mammoth]),
            makePlayer("p2", withPlaneswalker ? [wall, liliana] : [wall]),
        ],
    };
}

/** `[blockerRowButton, sinkRowButton]` — the sink row renders last. */
const steppers = (getAllByText: (t: string) => HTMLElement[], glyph: string) =>
    getAllByText(glyph) as HTMLButtonElement[];

describe("DamageAssignmentPanel lethal-minimum gating (CR 702.19b / CR 702.2c, issue #2444)", () => {
    it("disables + on the Defending Player row while the blocker is under-assigned", () => {
        const { combat, allPlayers } = trampleScenario();
        const { getAllByText, getByText } = renderPanel(combat, allPlayers);
        expect(getByText("Defending Player")).toBeTruthy();

        const plus = steppers(getAllByText, "+");
        // Blocker row stays live — assigning to the blocker is always legal.
        expect(plus[0].disabled).toBe(false);
        // Sink row is closed: 0 of the required 3 is on the blocker.
        expect(plus[1].disabled).toBe(true);
    });

    it("a disabled sink + dispatches nothing when clicked", () => {
        const { combat, allPlayers } = trampleScenario();
        const { getAllByText } = renderPanel(combat, allPlayers);
        fireEvent.click(steppers(getAllByText, "+")[1]);
        expect(setDamageAssignment).not.toHaveBeenCalled();
    });

    it("opens the Defending Player row once the blocker has lethal damage", () => {
        const { combat, allPlayers } = trampleScenario(["trample"], {
            mammoth: { wall: 3 },
        });
        const { getAllByText } = renderPanel(combat, allPlayers);

        const plus = steppers(getAllByText, "+");
        expect(plus[1].disabled).toBe(false);
        fireEvent.click(plus[1]);
        expect(setDamageAssignment).toHaveBeenCalledWith(
            expect.objectContaining({
                attackerId: "mammoth",
                assignments: { wall: 3, p2: 1 },
            })
        );
    });

    it("disables - on the blocker row when the decrement would strand damage on the player", () => {
        // 3 on the blocker (lethal) + 1 through. Stepping the blocker down to 2
        // while a point sits on the player is the illegal pair, so the server
        // would refuse it and the button must be dead.
        const { combat, allPlayers } = trampleScenario(["trample"], {
            mammoth: { wall: 3, p2: 1 },
        });
        const { getAllByText } = renderPanel(combat, allPlayers);

        const minus = steppers(getAllByText, "-");
        expect(minus[0].disabled).toBe(true);
        // The sink row's own - stays live: taking damage OFF the player is
        // always legal.
        expect(minus[1].disabled).toBe(false);
    });

    it("a deathtouch trampler opens the sink at 1 on the blocker (CR 702.2c)", () => {
        const withDeathtouch = trampleScenario(["trample", "deathtouch"], {
            mammoth: { wall: 1 },
        });
        const dt = renderPanel(
            withDeathtouch.combat,
            withDeathtouch.allPlayers
        );
        expect(steppers(dt.getAllByText, "+")[1].disabled).toBe(false);

        cleanup();

        // Control: the same 1-on-the-blocker board WITHOUT deathtouch still
        // needs 3, so the sink stays closed. This is what proves the pass above
        // is CR 702.2c and not a blanket permission.
        const plain = trampleScenario(["trample"], { mammoth: { wall: 1 } });
        const p = renderPanel(plain.combat, plain.allPlayers);
        expect(steppers(p.getAllByText, "+")[1].disabled).toBe(true);
    });

    it("switches the sink row to the attacked planeswalker (CR 702.19f)", () => {
        const { combat, allPlayers } = trampleScenario(
            ["trample"],
            { mammoth: { wall: 3 } },
            true
        );
        const { getAllByText, getByText, queryByText } = renderPanel(
            combat,
            allPlayers
        );

        // The row is labelled for the planeswalker, not the player: a creature
        // without trample-over-planeswalkers may assign NONE of its damage to
        // the defending player while attacking a planeswalker.
        expect(getByText("Liliana of the Veil")).toBeTruthy();
        expect(queryByText("Defending Player")).toBeNull();

        const plus = steppers(getAllByText, "+");
        expect(plus[1].disabled).toBe(false);
        fireEvent.click(plus[1]);
        expect(setDamageAssignment).toHaveBeenCalledWith(
            expect.objectContaining({
                attackerId: "mammoth",
                assignments: { wall: 3, liliana: 1 },
            })
        );
    });

    it("gates the planeswalker sink row on the same lethal minimum", () => {
        const { combat, allPlayers } = trampleScenario(["trample"], {}, true);
        const { getAllByText } = renderPanel(combat, allPlayers);
        expect(steppers(getAllByText, "+")[1].disabled).toBe(true);
    });
});

// Issue #1735 review round 2 finding 4 — round 1 excluded this file on the
// (wrong) premise that it only ever labels the OPPONENT's creatures. The
// file's own doc block says otherwise (CR 702.22j-k banding lets a defending
// player assign an attacker's damage, or an attacking player assign a
// blocker's, among the ASSIGNER's OWN creatures), and `target`/`sinkCard`
// were left on raw `card.card.id` after `source` was repointed for exactly
// that reason. These pin both repointed reads with a face-down creature
// standing in for "the assigner's own hidden card" (banding proper is a
// heavier scenario to build; the display bug is identical either way — a
// raw `card.card.id` read on any battlefield object, not one specific to
// banding).
describe("DamageAssignmentPanel — face-down target names (issue #1735 review round 2 finding 4)", () => {
    it("labels a face-down blocker with its real known name, not the sentinel", () => {
        const mammoth = creature("mammoth", "def-mammoth", 4, 4, "p1", {
            isAttacking: true,
            staticAbilities: ["trample"],
        });
        const morph = creature("morph", "face-down-sentinel", 2, 2, "p2", {
            isBlocking: true,
            knownCardId: "def-wall",
        });
        const combat = {
            attackerIds: ["mammoth"],
            confirmed: true,
            blockersConfirmed: true,
            damageConfirmed: false,
            blockerAssignments: { morph: ["mammoth"] },
            damageAssignerIds: { mammoth: "p1" },
            damageAssignments: {},
        } as Combat;
        const allPlayers = [
            makePlayer("p1", [mammoth]),
            makePlayer("p2", [morph]),
        ];
        const { getByText, queryByText } = renderPanel(combat, allPlayers);
        expect(getByText("Wall of Stone")).toBeTruthy();
        expect(queryByText("Unknown")).toBeNull();
    });

    it("labels a face-down planeswalker sink with its real known name (CR 702.19f)", () => {
        const mammoth = creature("mammoth", "def-mammoth", 4, 4, "p1", {
            isAttacking: true,
            staticAbilities: ["trample"],
        });
        const wall = creature("wall", "def-wall", 0, 3, "p2", {
            isBlocking: true,
        });
        const morphWalker = creature(
            "morph-pw",
            "face-down-sentinel",
            0,
            0,
            "p2",
            {
                types: ["Planeswalker"],
                counters: { loyalty: 3 },
                knownCardId: "def-liliana",
            }
        );
        const combat = {
            attackerIds: ["mammoth"],
            confirmed: true,
            blockersConfirmed: true,
            damageConfirmed: false,
            blockerAssignments: { wall: ["mammoth"] },
            damageAssignerIds: { mammoth: "p1" },
            damageAssignments: { mammoth: { wall: 3 } },
            attackTargets: { mammoth: "morph-pw" },
        } as Combat;
        const allPlayers = [
            makePlayer("p1", [mammoth]),
            makePlayer("p2", [wall, morphWalker]),
        ];
        const { getByText, queryByText } = renderPanel(combat, allPlayers);
        expect(getByText("Liliana of the Veil")).toBeTruthy();
        expect(queryByText("Unknown")).toBeNull();
    });
});
