// Entered-trigger head: mana-value floor, usable from the graveyard zone
// (issue #6317).
//
// CR 202.3 — "a creature with mana value 6 or greater" reads the entering
// permanent's mana value; CR 202.3e — an {X} in the cost counts as 0 on the
// battlefield. CR 113.6b / 603.6e — an ability that functions from the
// graveyard fires when ANOTHER permanent enters (the scan in `collectTriggers`).
// Every entry goes through `emitPermanentEntered` — never a hand-built event —
// so a missing snapshot field shows up as a silent never-fires.

import { describe, it, expect } from "vitest";
import {
    emitPermanentEntered,
    getPlayer,
    processPendingActionTriggers,
    type GameState,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import { matchesPermanentFilter } from "../../cards/filters";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";

const SIX_DROP_ID = "test-6317-six-drop";
registerTokenDefinition({
    id: SIX_DROP_ID,
    name: "Test Six Drop",
    rarity: "common",
    manaCost: { generic: 4, G: 2 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 6,
    toughness: 6,
} satisfies CardDefinition);

const FIVE_DROP_ID = "test-6317-five-drop";
registerTokenDefinition({
    id: FIVE_DROP_ID,
    name: "Test Five Drop",
    rarity: "common",
    manaCost: { generic: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 5,
    toughness: 5,
} satisfies CardDefinition);

/** `{X}{X}{G}` — mana value 1 on the battlefield (CR 202.3e), however big the
 *  X it was cast for. A numeric `X` would be read as its value; the string
 *  placeholder is the variable-X encoding. */
const X_CREATURE_ID = "test-6317-x-creature";
registerTokenDefinition({
    id: X_CREATURE_ID,
    name: "Test X Creature",
    rarity: "common",
    manaCost: { X: "X", G: 1 } as unknown as CardDefinition["manaCost"],
    types: ["Creature"],
    power: 0,
    toughness: 0,
} satisfies CardDefinition);

const SIX_DROP_NONCREATURE_ID = "test-6317-six-drop-artifact";
registerTokenDefinition({
    id: SIX_DROP_NONCREATURE_ID,
    name: "Test Six Drop Artifact",
    rarity: "common",
    manaCost: { generic: 6 },
    types: ["Artifact"],
} satisfies CardDefinition);

/** Source on the BATTLEFIELD: "When a creature with mana value 6 or greater
 *  enters, you gain 1 life." Scope any, creature, floor 6. */
const BF_WATCHER_ID = "test-6317-bf-watcher";
registerTokenDefinition({
    id: BF_WATCHER_ID,
    name: "Test Battlefield Watcher",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "test-6317-bf-watcher-trigger",
            oracleText:
                "When a creature with mana value 6 or greater enters, you gain 1 life.",
            scope: "any",
            filter: { types: "Creature", manaValueAtLeast: 6 },
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ],
} satisfies CardDefinition);

/** Source in the GRAVEYARD with the same head (CR 113.6b). */
const GY_WATCHER_ID = "test-6317-gy-watcher";
registerTokenDefinition({
    id: GY_WATCHER_ID,
    name: "Test Graveyard Watcher",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "test-6317-gy-watcher-trigger",
            oracleText:
                "When a creature with mana value 6 or greater enters, you gain 1 life.",
            scope: "any",
            zone: "graveyard",
            filter: { types: "Creature", manaValueAtLeast: 6 },
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ],
} satisfies CardDefinition);

function board(opts: {
    battlefield?: string[];
    graveyard?: string[];
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: (opts.battlefield ?? []).map((id, i) =>
                    makeInstance(id, {
                        id: `p1-bf-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
                graveyard: (opts.graveyard ?? []).map((id, i) =>
                    makeInstance(id, {
                        id: `p1-gy-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

/** Puts a creature onto `playerId`'s battlefield through the real emit
 *  chokepoint and returns the ids of the triggers that reach the stack. */
function enter(state: GameState, defId: string, playerId = "p2"): string[] {
    emitEntry(state, defId, playerId);
    processPendingActionTriggers(state);
    return state.stack.map((s) => s.triggeredAbilityId as string);
}

/** Emits the entry and leaves the event pending (unconsumed) for inspection. */
function emitEntry(state: GameState, defId: string, playerId = "p2"): void {
    const card = makeInstance(defId, {
        id: `entering-${defId}`,
        controllerId: playerId,
        ownerId: playerId,
        zone: "battlefield",
    });
    getPlayer(state, playerId).battlefield.push(card);
    emitPermanentEntered(state, card);
}

describe("PermanentFilter.manaValueAtLeast (CR 202.3)", () => {
    const base = {
        id: "x",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
    };

    it("matches at and above the floor, not below", () => {
        const f = { manaValueAtLeast: 6 };
        expect(matchesPermanentFilter({ ...base, manaValue: 6 }, f)).toBe(true);
        expect(matchesPermanentFilter({ ...base, manaValue: 9 }, f)).toBe(true);
        expect(matchesPermanentFilter({ ...base, manaValue: 5 }, f)).toBe(
            false
        );
    });

    it("fails CLOSED on a subject that carries no mana value", () => {
        expect(matchesPermanentFilter(base, { manaValueAtLeast: 0 })).toBe(
            false
        );
    });
});

describe("PERMANENT_ENTERED carries the entering permanent's mana value (CR 202.3)", () => {
    it("snapshots the printed mana value", () => {
        const state = board({});
        emitEntry(state, SIX_DROP_ID);
        expect(state.pendingEvents).toContainEqual(
            expect.objectContaining({
                type: "PERMANENT_ENTERED",
                manaValue: 6,
            })
        );
    });

    it("values {X} at 0 on the battlefield (CR 202.3e)", () => {
        const state = board({});
        emitEntry(state, X_CREATURE_ID);
        expect(state.pendingEvents).toContainEqual(
            expect.objectContaining({
                type: "PERMANENT_ENTERED",
                manaValue: 1,
            })
        );
    });
});

describe("enteredTrigger with a mana-value floor, from the battlefield", () => {
    it("fires on a mana value 6 creature", () => {
        const state = board({ battlefield: [BF_WATCHER_ID] });
        expect(enter(state, SIX_DROP_ID)).toEqual([
            "test-6317-bf-watcher-trigger",
        ]);
    });

    it("does NOT fire on mana value 5", () => {
        const state = board({ battlefield: [BF_WATCHER_ID] });
        expect(enter(state, FIVE_DROP_ID)).toEqual([]);
    });

    it("does NOT fire on a big noncreature permanent", () => {
        const state = board({ battlefield: [BF_WATCHER_ID] });
        expect(enter(state, SIX_DROP_NONCREATURE_ID)).toEqual([]);
    });

    it("does NOT fire on an {X} creature, whose mana value is 1 off the stack", () => {
        const state = board({ battlefield: [BF_WATCHER_ID] });
        expect(enter(state, X_CREATURE_ID)).toEqual([]);
    });
});

describe("enteredTrigger with zone: graveyard (CR 113.6b / 603.6e)", () => {
    it("fires from the graveyard when ANOTHER creature of mana value 6 enters", () => {
        const state = board({ graveyard: [GY_WATCHER_ID] });
        expect(enter(state, SIX_DROP_ID)).toEqual([
            "test-6317-gy-watcher-trigger",
        ]);
    });

    it("does not fire from the graveyard below the floor", () => {
        const state = board({ graveyard: [GY_WATCHER_ID] });
        expect(enter(state, FIVE_DROP_ID)).toEqual([]);
    });

    it("a battlefield-zone copy of the same head does NOT fire from the graveyard", () => {
        const state = board({ graveyard: [BF_WATCHER_ID] });
        expect(enter(state, SIX_DROP_ID)).toEqual([]);
    });

    it("the graveyard-zone ability is dormant on the battlefield (CR 113.6b)", () => {
        const state = board({ battlefield: [GY_WATCHER_ID] });
        expect(enter(state, SIX_DROP_ID)).toEqual([]);
    });

    it("reaches the wire: the projected stack names the graveyard source", () => {
        const state = board({ graveyard: [GY_WATCHER_ID] });
        enter(state, SIX_DROP_ID);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.stack).toHaveLength(1);
        expect(projected.stack[0]).toMatchObject({
            triggeredAbilityId: "test-6317-gy-watcher-trigger",
            card: { id: GY_WATCHER_ID },
        });
    });
});
