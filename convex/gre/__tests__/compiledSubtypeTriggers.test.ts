// Compiled subtype-narrowed trigger heads reach the engine as REAL triggers
// (issue #10345): "whenever another [nontoken] <subtypes> you control enters"
// (CR 603.6a + CR 205.3) and "whenever you cast a <creature type> spell"
// (CR 603.2 + CR 205.3m).
//
// `oracle/__tests__/subtypeTriggerHeads.test.ts` proves the Oracle text lowers
// to the right descriptor. It cannot prove the rebuilt ability fires on the
// right permanent or spell, so each test compiles a real Oracle row, registers
// it, and drives the real emitter into the real trigger scan.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, GameEvent } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { emitPermanentEntered, type GameState } from "../state";
import { collectTriggers } from "../triggers";

function register(
    name: string,
    typeLine: string,
    oracleText: string
): CardDefinition {
    const outcome = compileCard(
        oracleCard({
            name,
            manaCost: "{G}",
            typeLine,
            oracleText,
            power: "1",
            toughness: "1",
        })
    );
    if (outcome.state === "unparsed")
        throw new Error(`${name} unparsed: ${JSON.stringify(outcome.gaps)}`);
    const definition = {
        ...outcome.definition,
        id: `test-10345-${name}`,
        rarity: "common" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const KNIGHTFISHER = register(
    "Knightfisher",
    "Creature — Bird Knight",
    "Whenever another nontoken Bird you control enters, create a 1/1 blue Fish creature token."
);
const DREYLEADER = register(
    "Honored Dreyleader",
    "Creature — Squirrel Warrior",
    "Whenever another Squirrel or Food you control enters, put a +1/+1 counter on this creature."
);
const HUNTMASTER = register(
    "Lys Alana Huntmaster",
    "Creature — Elf Warrior",
    "Whenever you cast an Elf spell, you may create a 1/1 green Elf Warrior creature token."
);
// CR 205.3i — the land-subtype head that shipped before the event carried
// subtypes, and so could never fire.
const FOREST_WATCHER = register(
    "Test Forest Watcher",
    "Creature — Treefolk",
    "Whenever a Forest you control enters, you gain 1 life."
);

function plain(id: string, types: CardDefinition["types"], subtypes: string[]) {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types,
        subtypes,
        power: 1,
        toughness: 1,
    } satisfies CardDefinition);
    return id;
}
const BIRD = plain("test-10345-bird", ["Creature"], ["Bird"]);
const BEAR = plain("test-10345-bear", ["Creature"], ["Bear"]);
const FOOD = plain("test-10345-food", ["Artifact"], ["Food"]);
const FOREST = plain("test-10345-forest", ["Land"], ["Forest"]);

/** `watcher` on p1's side; `entering` put onto `controllerId`'s battlefield
 *  and announced by the real emitter. Returns the triggers the scan finds. */
function enters(
    watcher: CardDefinition,
    entering: string,
    controllerId: "p1" | "p2",
    extra: { isToken?: true } = {}
): number {
    const source = makeInstance(watcher.id, {
        id: "watcher",
        controllerId: "p1",
        ownerId: "p1",
    });
    const arrival = makeInstance(entering, {
        id: "arrival",
        controllerId,
        ownerId: controllerId,
        ...extra,
    });
    const state: GameState = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    source,
                    ...(controllerId === "p1" ? [arrival] : []),
                ],
            }),
            makePlayer("p2", {
                battlefield: controllerId === "p2" ? [arrival] : [],
            }),
        ],
    });
    emitPermanentEntered(state, arrival);
    return collectTriggers(state, state.pendingEvents ?? []).length;
}

describe("another [nontoken] <subtypes> you control enters (CR 603.6a, CR 205.3)", () => {
    it("fires on another nontoken Bird of yours", () => {
        expect(enters(KNIGHTFISHER, BIRD, "p1")).toBe(1);
    });
    it("does not fire on a Bird token (CR 111.1)", () => {
        expect(enters(KNIGHTFISHER, BIRD, "p1", { isToken: true })).toBe(0);
    });
    it("does not fire on a creature of another type", () => {
        expect(enters(KNIGHTFISHER, BEAR, "p1")).toBe(0);
    });
    it("does not fire on an opponent's Bird", () => {
        expect(enters(KNIGHTFISHER, BIRD, "p2")).toBe(0);
    });
    it("fires on an artifact subtype of the list — a Food token (CR 205.3g)", () => {
        expect(enters(DREYLEADER, FOOD, "p1", { isToken: true })).toBe(1);
    });
    it("does not fire on a permanent of no listed subtype", () => {
        expect(enters(DREYLEADER, BEAR, "p1")).toBe(0);
    });
    it("a Forest you control entering fires the land-subtype head (CR 205.3i)", () => {
        expect(enters(FOREST_WATCHER, FOREST, "p1")).toBe(1);
        expect(enters(FOREST_WATCHER, BEAR, "p1")).toBe(0);
    });
});

describe("you cast a <creature type> spell (CR 603.2, CR 205.3m)", () => {
    function cast(casterId: string, subtypes: string[]): number {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(HUNTMASTER.id, {
                            id: "watcher",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const event: GameEvent = {
            type: "SPELL_CAST",
            casterId,
            spellInstanceId: "spell",
            spellCardId: BEAR,
            spellTypes: ["Creature"],
            spellSubtypes: subtypes,
            spellColors: ["G"],
        };
        return collectTriggers(state, [event]).length;
    }
    it("fires on an Elf spell you cast", () => {
        expect(cast("p1", ["Elf", "Warrior"])).toBe(1);
    });
    it("does not fire on a spell of another creature type", () => {
        expect(cast("p1", ["Bear"])).toBe(0);
    });
    it("does not fire on an opponent's Elf spell", () => {
        expect(cast("p2", ["Elf"])).toBe(0);
    });
});
