// Entered-trigger head: mana-value floor, usable from the graveyard zone
// (issue #6317).
//
// CR 202.3 — "a creature with mana value 6 or greater" reads the entering
// permanent's mana value; CR 202.3e — an {X} in the cost counts as 0 on the
// battlefield. CR 113.6b — an ability that functions from the
// graveyard fires when ANOTHER permanent enters (the scan in `collectTriggers`).
// Every entry goes through `emitPermanentEntered` — never a hand-built event —
// so a missing snapshot field shows up as a silent never-fires.

import { describe, it, expect } from "vitest";
import {
    createTokenPermanents,
    emitPermanentEntered,
    getPlayer,
    processPendingActionTriggers,
    type GameState,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import { matchesPermanentFilter } from "../../cards/filters";
import { effectivePermanentView, permanentManaValue } from "../permanentView";
import { applyCopy } from "../copy";
import { transformPermanent } from "../transform";
import { modalBackTwinDefinition } from "../../cards/modalDfc";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition, TokenSpec } from "../../cards/types";

/** A five-colour token: its registered definition carries one pip per colour. */
const FIVE_COLOUR_TOKEN: TokenSpec = {
    name: "Test Rainbow",
    types: ["Creature"],
    power: 1,
    toughness: 1,
    colors: ["W", "U", "B", "R", "G"],
};

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

    it("values a non-copy token at 0 (CR 111.3 / 202.3a), whatever its colours", () => {
        const state = board({});
        createTokenPermanents(state, FIVE_COLOUR_TOKEN, "p2", 1);
        expect(state.pendingEvents).toContainEqual(
            expect.objectContaining({
                type: "PERMANENT_ENTERED",
                manaValue: 0,
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
});

describe("enteredTrigger with zone: graveyard (CR 113.6b)", () => {
    it("refuses combinations the graveyard scan would ignore or never reach", () => {
        const base = {
            id: "x",
            oracleText: "x",
            effects: [],
            zone: "graveyard" as const,
        };
        expect(() => enteredTrigger({ ...base, scope: "self" })).toThrow();
        expect(() =>
            enteredTrigger({ ...base, scope: "any", oncePerEventBatch: true })
        ).toThrow();
        expect(() =>
            enteredTrigger({ ...base, scope: "any", maxTriggersPerTurn: 1 })
        ).toThrow();
    });

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

describe("effectivePermanentView supplies the battlefield mana value", () => {
    it("lets manaValueAtLeast match a permanent already on the battlefield (CR 202.3)", () => {
        const state = board({ battlefield: [SIX_DROP_ID, FIVE_DROP_ID] });
        const [six, five] = getPlayer(state, "p1").battlefield;
        const filter = { manaValueAtLeast: 6 };
        expect(
            matchesPermanentFilter(effectivePermanentView(state, six!), filter)
        ).toBe(true);
        expect(
            matchesPermanentFilter(effectivePermanentView(state, five!), filter)
        ).toBe(false);
    });
});

describe("permanentManaValue of a double-faced permanent (CR 712.8e / 202.3b)", () => {
    const NONMODAL_FRONT_ID = "test-6396-nonmodal-front";
    registerTokenDefinition({
        id: NONMODAL_FRONT_ID,
        name: "Test Nonmodal Front",
        rarity: "common",
        manaCost: { generic: 2, G: 2 },
        types: ["Creature"],
        subtypes: ["Human"],
        power: 2,
        toughness: 2,
        backFace: {
            name: "Test Nonmodal Back",
            types: ["Creature"],
            subtypes: ["Werewolf"],
            power: 4,
            toughness: 4,
            colors: ["G"],
        },
    });
    const modalFront: CardDefinition = {
        id: "test-6396-modal-front",
        name: "Test Modal Front",
        rarity: "common",
        manaCost: { generic: 1, U: 1 },
        types: ["Creature"],
        subtypes: ["Human"],
        power: 1,
        toughness: 1,
        backFace: {
            kind: "modal",
            name: "Test Modal Back",
            types: ["Creature"],
            subtypes: ["Elemental"],
            power: 3,
            toughness: 3,
        },
    };
    registerTokenDefinition(modalFront);
    // The twin carries no cost of its own today (modal back faces are lands);
    // a costed one is given here to pin that its OWN cost is read.
    registerTokenDefinition({
        ...modalBackTwinDefinition(modalFront)!,
        manaCost: { generic: 3, R: 1 },
    });

    it("reads the FRONT face's cost once transformed, not the colour-count artefact", () => {
        const state = board({ battlefield: [NONMODAL_FRONT_ID] });
        const [card] = getPlayer(state, "p1").battlefield;
        expect(permanentManaValue(card!)).toBe(4);
        transformPermanent(state, card!);
        expect(card!.transformed).toBe(true);
        expect(permanentManaValue(card!)).toBe(4);
        expect(effectivePermanentView(state, card!).manaValue).toBe(4);
    });

    it("values a copy of the nonmodal back face at 0 (CR 202.3b)", () => {
        const state = board({
            battlefield: [NONMODAL_FRONT_ID, FIVE_DROP_ID],
        });
        const [dfc, recipient] = getPlayer(state, "p1").battlefield;
        transformPermanent(state, dfc!);
        applyCopy(state, recipient!, dfc!);
        expect(recipient!.copiedFrom).toBe(FIVE_DROP_ID);
        expect(permanentManaValue(recipient!)).toBe(0);
    });

    it("keeps a MODAL back face's own cost (CR 712.8f)", () => {
        const state = board({ battlefield: [modalFront.id] });
        const [card] = getPlayer(state, "p1").battlefield;
        transformPermanent(state, card!);
        expect(card!.transformed).toBe(true);
        expect(permanentManaValue(card!)).toBe(4);
    });
});
