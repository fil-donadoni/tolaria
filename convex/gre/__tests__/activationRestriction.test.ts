// The `activation-restriction` static (CR 602.5 — "A player can't begin to
// activate an ability that's prohibited from being activated"), shipped by
// Cursed Totem: "Activated abilities of creatures can't be activated."
//
// Driven through the real entry points — `activateAbilityOnState` (the stack
// ability mutation's body), `tapSourceIntoPayment` (the tap primitive the mana
// mutations share), the mana funnels the auto-tap planner and the castability
// census read, and the Bot's `enumerateMoves` — never a hand-built verdict.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import { tapSourceIntoPayment } from "../../game";
import { activateAbilityOnState } from "../activation";
import { activationPreconditionViolation } from "../activationPrecondition";
import { activationRestrictionViolation } from "../activationRestrictions";
import { getManaTapOptionsDetailed, hasManaAbility } from "../constants";
import { enumerateMoves } from "../moves";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "../state";

const TOTEM_TEXT = "Activated abilities of creatures can't be activated.";

/** p1 controls `mine` (and the Totem unless `totem: false`); p2 controls
 *  `theirs`. Every permanent has been under its controller's control since the
 *  turn began, so summoning sickness never masks the restriction. */
function board(opts: {
    mine: Array<[name: string, id: string]>;
    theirs?: Array<[name: string, id: string]>;
    totem?: false | "mine" | "theirs";
    pool?: Record<string, number>;
    totemOverrides?: Partial<CardInstanceState>;
}): { state: GameState; me: PlayerState } {
    const perm = (name: string, id: string, owner: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: owner,
            ownerId: owner,
            isSummoningSick: false,
        });
    const totemSide = opts.totem ?? "mine";
    const totem = (owner: string) =>
        totemSide !== false &&
        totemSide === (owner === "p1" ? "mine" : "theirs")
            ? [
                  {
                      ...perm("Cursed Totem", `totem-${owner}`, owner),
                      ...opts.totemOverrides,
                  },
              ]
            : [];
    const me = makePlayer("p1", {
        battlefield: [
            ...opts.mine.map(([n, id]) => perm(n, id, "p1")),
            ...totem("p1"),
        ],
    });
    me.manaPool = { ...me.manaPool, ...opts.pool };
    const them = makePlayer("p2", {
        battlefield: [
            ...(opts.theirs ?? []).map(([n, id]) => perm(n, id, "p2")),
            ...totem("p2"),
        ],
    });
    const state = makeState({ players: [me, them] });
    return { state, me };
}

function card(me: PlayerState, id: string): CardInstanceState {
    return me.battlefield.find((c) => c.id === id)!;
}

function battlefieldsOf(state: GameState) {
    return state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
}

describe("activation-restriction: non-mana activated abilities (CR 602.5)", () => {
    it("Cursed Totem forbids a creature's stack ability", () => {
        const { state } = board({
            mine: [["Shivan Dragon", "dragon"]],
            pool: { R: 1 },
        });
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "dragon",
                abilityId: "shivan-dragon-pump",
            })
        ).toThrow(TOTEM_TEXT);
        expect(state.stack).toHaveLength(0);
    });

    it("the same activation is legal with no Totem on the battlefield", () => {
        const { state } = board({
            mine: [["Shivan Dragon", "dragon"]],
            pool: { R: 1 },
            totem: false,
        });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "dragon",
            abilityId: "shivan-dragon-pump",
        });
        expect(state.stack).toHaveLength(1);
    });

    it("binds every player: an opponent's Totem locks my creature (no controller scope)", () => {
        const { state } = board({
            mine: [["Shivan Dragon", "dragon"]],
            pool: { R: 1 },
            totem: "theirs",
        });
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "dragon",
                abilityId: "shivan-dragon-pump",
            })
        ).toThrow(TOTEM_TEXT);
    });

    it("a Totem that lost all its abilities locks nothing (CR 613.1f)", () => {
        const { state } = board({
            mine: [["Shivan Dragon", "dragon"]],
            pool: { R: 1 },
            totemOverrides: {
                abilitiesSuppressedBy: [{ sourceId: "x", seq: 1 }],
            },
        });
        expect(
            activationRestrictionViolation(state, "dragon", false)
        ).toBeNull();
    });

    it("the Bot never enumerates the locked activation", () => {
        const locked = board({
            mine: [["Shivan Dragon", "dragon"]],
            pool: { R: 1 },
        }).state;
        const free = board({
            mine: [["Shivan Dragon", "dragon"]],
            pool: { R: 1 },
            totem: false,
        }).state;
        const pumps = (s: GameState) =>
            enumerateMoves(s, "p1").filter(
                (m) =>
                    m.kind === "activate-ability" &&
                    m.abilityId === "shivan-dragon-pump"
            );
        expect(pumps(free).length).toBeGreaterThan(0);
        expect(pumps(locked)).toHaveLength(0);
    });
});

describe("activation-restriction: mana abilities are activated abilities (CR 605.1a)", () => {
    it("Llanowar Elves can't tap for mana under the Totem", () => {
        const { state, me } = board({ mine: [["Llanowar Elves", "elves"]] });
        expect(() =>
            tapSourceIntoPayment(state, me, card(me, "elves"), undefined, [])
        ).toThrow(TOTEM_TEXT);
        expect(me.manaPool.G ?? 0).toBe(0);
        expect(card(me, "elves").isTapped).toBe(false);
    });

    it("…and taps normally once the Totem is gone (a live query, CR 611.2)", () => {
        const { state, me } = board({ mine: [["Llanowar Elves", "elves"]] });
        me.battlefield = me.battlefield.filter((c) => c.id !== "totem-p1");
        tapSourceIntoPayment(state, me, card(me, "elves"), undefined, []);
        expect(me.manaPool.G).toBe(1);
    });

    it("a sacrifice-only mana ability is locked too (the sickness carve-out does not spare it)", () => {
        const { state, me } = board({ mine: [["Tinder Wall", "wall"]] });
        expect(() =>
            tapSourceIntoPayment(state, me, card(me, "wall"), undefined, [])
        ).toThrow(TOTEM_TEXT);
        expect(card(me, "wall")).toBeDefined();
    });

    it("no tap option and no mana ability for the planner and the census", () => {
        const { state, me } = board({ mine: [["Llanowar Elves", "elves"]] });
        const elves = card(me, "elves");
        expect(
            getManaTapOptionsDetailed(elves, "p1", battlefieldsOf(state))
        ).toEqual([]);
        expect(hasManaAbility(elves, state)).toBe(false);
    });

    it("intrinsic basic-land mana of a land creature is locked (CR 305.6)", () => {
        const { state, me } = board({ mine: [["Forest", "forest"]] });
        const forest = card(me, "forest");
        forest.types = ["Land", "Creature"];
        expect(hasManaAbility(forest, state)).toBe(false);
        expect(
            getManaTapOptionsDetailed(forest, "p1", battlefieldsOf(state))
        ).toEqual([]);
        expect(() =>
            tapSourceIntoPayment(state, me, forest, undefined, [])
        ).toThrow(TOTEM_TEXT);
    });

    it("a noncreature mana source is untouched (Sol Ring, a plain Forest)", () => {
        const { state, me } = board({
            mine: [
                ["Sol Ring", "ring"],
                ["Forest", "forest"],
            ],
        });
        expect(hasManaAbility(card(me, "ring"), state)).toBe(true);
        expect(hasManaAbility(card(me, "forest"), state)).toBe(true);
        tapSourceIntoPayment(state, me, card(me, "ring"), undefined, []);
        expect(me.manaPool.C).toBe(2);
    });
});

describe("activation-restriction: exemptManaAbilities (CR 605.1a — '…unless they're mana abilities')", () => {
    const exemptTotem: CardDefinition = {
        ...getCardByName("Cursed Totem"),
        staticEffects: [
            {
                kind: "activation-restriction",
                id: "test-exempt-lock",
                filter: { types: "Creature" },
                exemptManaAbilities: true,
                oracleText:
                    "Activated abilities of creatures can't be activated unless they're mana abilities.",
            },
        ],
    };

    it("leaves mana abilities activatable and still locks the rest", () => {
        withTemporaryDefinition(exemptTotem, () => {
            const { state, me } = board({
                mine: [
                    ["Llanowar Elves", "elves"],
                    ["Shivan Dragon", "dragon"],
                ],
            });
            tapSourceIntoPayment(state, me, card(me, "elves"), undefined, []);
            expect(me.manaPool.G).toBe(1);
            expect(
                activationPreconditionViolation(
                    state,
                    card(me, "dragon"),
                    getCardByName("Shivan Dragon").activatedAbilities![0]
                )
            ).toBe(
                "Activated abilities of creatures can't be activated unless they're mana abilities."
            );
        });
    });
});
