// Deathtouch (CR 702.2b / CR 704.5h, issue #957).
//
// CR 702.2b — "Any nonzero amount of combat damage assigned to a creature by a
// source with deathtouch is considered to be lethal damage ..."
// CR 704.5h — "If a creature has been dealt damage this turn by a source with
// deathtouch since the last time state-based actions were checked, that
// creature is destroyed."
//
// The engine marks the recipient (`dealtDeathtouchDamage`) at every damage sink
// via `markDeathtouchDamage`, reading the source's EFFECTIVE static-ability set
// (the layer-6-materialized `staticAbilities` array — granted deathtouch
// present, ability-loss/removal-stripped deathtouch absent, so Humility is
// respected). `checkDeathtouchDestroySBA` then destroys any marked creature,
// respecting indestructible/regeneration via `destroyWithReplacements`. Combat
// deaths are additionally folded into the combat lethal scan so a deathtouch
// death is simultaneous with normal combat deaths (CR 510.4).
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardType } from "../../cards/types";
import { markDeathtouchDamage, resolveFight } from "../state";
import { applyAllCombatDamage } from "../phases";
import { checkDeathtouchDestroySBA, checkStateBasedActions } from "../sba";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";

function creature(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

/** p1 (active) attacks with `p1Field`; `p2Field` blocks. */
function combatState(
    p1Field: CardInstanceState[],
    p2Field: CardInstanceState[],
    combat: Partial<GameState["combat"]> & { attackerIds: string[] }
): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: p1Field }),
            makePlayer("p2", { battlefield: p2Field }),
        ],
        combat: {
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
            damageConfirmed: false,
            ...combat,
        } as GameState["combat"],
    });
}

function onBattlefield(state: GameState, id: string): boolean {
    return state.players.some((p) => p.battlefield.some((c) => c.id === id));
}

function inGraveyard(state: GameState, id: string): boolean {
    return state.players.some((p) => p.graveyard.some((c) => c.id === id));
}

describe("deathtouch combat: 1/1 deathtouch blocker destroys a 5/5 (CR 702.2b, AC1)", () => {
    it("the 5/5 attacker is destroyed by 1 combat damage from the deathtouch blocker", () => {
        const ogre = creature("ogre", 5, 5); // p1 attacker
        const strix = creature("strix", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying", "deathtouch"],
        });
        const state = combatState([ogre], [strix], {
            attackerIds: ["ogre"],
            blockerAssignments: { strix: ["ogre"] },
            blockedAttackerIds: ["ogre"],
        });

        applyAllCombatDamage(state, { ogre: { strix: 5 } });

        // The 5/5 took only 1 damage (< toughness) but deathtouch makes it
        // lethal: it is destroyed. The 1/1 dies to its own toughness.
        expect(onBattlefield(state, "ogre")).toBe(false);
        expect(inGraveyard(state, "ogre")).toBe(true);
        expect(onBattlefield(state, "strix")).toBe(false);
    });
});

describe("deathtouch creature dealt lethal damage still dies (no false immunity) (AC2)", () => {
    it("a 1/1 deathtouch that trades with a 1/1 vanilla — both die", () => {
        const bear = creature("bear", 1, 1); // p1 attacker, no deathtouch
        const strix = creature("strix", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["deathtouch"],
        });
        const state = combatState([bear], [strix], {
            attackerIds: ["bear"],
            blockerAssignments: { strix: ["bear"] },
            blockedAttackerIds: ["bear"],
        });

        applyAllCombatDamage(state, { bear: { strix: 1 } });

        // The deathtouch creature took 1 damage = its toughness → dies normally.
        expect(onBattlefield(state, "strix")).toBe(false);
        // The vanilla creature is destroyed by the deathtouch damage.
        expect(onBattlefield(state, "bear")).toBe(false);
    });
});

describe("deathtouch non-combat damage destroys the creature (CR 702.2b, AC3)", () => {
    it("a fight from a surviving deathtouch source destroys the other creature via SBA", () => {
        // 2/10 deathtouch fights a 5/5. The deathtoucher survives (5 < 10); the
        // 5/5 takes 2 (< its toughness) but is marked and destroyed by the SBA.
        const toucher = creature("toucher", 2, 10, {
            staticAbilities: ["deathtouch"],
        });
        const bear = creature("bear", 5, 5, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [toucher] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });

        resolveFight(state, "toucher", "bear");
        // resolveFight only destroys on toughness-lethal; the deathtouch mark is
        // set but the SBA is what destroys the 5/5.
        expect(onBattlefield(state, "bear")).toBe(true);
        expect(state.players[1].battlefield[0].dealtDeathtouchDamage).toBe(
            true
        );

        checkStateBasedActions(state);

        expect(onBattlefield(state, "bear")).toBe(false);
        expect(inGraveyard(state, "bear")).toBe(true);
        // The deathtouch source survived (only took 5 of its 10 toughness).
        expect(onBattlefield(state, "toucher")).toBe(true);
    });
});

describe("deathtouch does NOT destroy an indestructible creature (CR 702.12, AC4)", () => {
    it("an indestructible 5/5 blocked by a 1/1 deathtouch survives", () => {
        const ogre = creature("ogre", 5, 5, {
            staticAbilities: ["indestructible"],
        });
        const strix = creature("strix", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["deathtouch"],
        });
        const state = combatState([ogre], [strix], {
            attackerIds: ["ogre"],
            blockerAssignments: { strix: ["ogre"] },
            blockedAttackerIds: ["ogre"],
        });

        applyAllCombatDamage(state, { ogre: { strix: 5 } });
        checkStateBasedActions(state);

        // Indestructible survives the deathtouch destroy; the 1/1 still dies.
        expect(onBattlefield(state, "ogre")).toBe(true);
        expect(onBattlefield(state, "strix")).toBe(false);
    });
});

describe("deathtouch respects the effective ability set (CR 613 layer 6, AC5)", () => {
    it("deathtouch STRIPPED by Humility (empty staticAbilities) marks nothing", () => {
        // The printed definition would carry deathtouch, but an ability-loss
        // (Humility) has stripped the instance's array to empty. Reading the
        // effective set (not the printed def) means no deathtouch mark, so the
        // 5/5 survives 1 non-lethal damage.
        const ogre = creature("ogre", 5, 5); // p1 attacker
        const stripped = creature("stripped", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: [], // Humility has removed deathtouch
        });
        const state = combatState([ogre], [stripped], {
            attackerIds: ["ogre"],
            blockerAssignments: { stripped: ["ogre"] },
            blockedAttackerIds: ["ogre"],
        });

        applyAllCombatDamage(state, { ogre: { stripped: 5 } });
        checkStateBasedActions(state);

        // No deathtouch → the 5/5 survives its single point of damage.
        expect(onBattlefield(state, "ogre")).toBe(true);
        expect(onBattlefield(state, "stripped")).toBe(false);
    });

    it("deathtouch GRANTED by a continuous effect (materialized) marks the recipient", () => {
        const granted = creature("granted", 1, 1, {
            staticAbilities: ["deathtouch"], // layer-6 grant materialized
        });
        const bear = creature("bear", 5, 5);
        markDeathtouchDamage(bear, granted.staticAbilities, 1);
        expect(bear.dealtDeathtouchDamage).toBe(true);
    });
});

describe("markDeathtouchDamage helper edge cases", () => {
    it("does not mark on zero damage", () => {
        const bear = creature("bear", 5, 5);
        markDeathtouchDamage(bear, ["deathtouch"], 0);
        expect(bear.dealtDeathtouchDamage).toBeUndefined();
    });

    it("does not mark when the source lacks deathtouch", () => {
        const bear = creature("bear", 5, 5);
        markDeathtouchDamage(bear, ["flying"], 3);
        expect(bear.dealtDeathtouchDamage).toBeUndefined();
    });
});

describe("checkDeathtouchDestroySBA (CR 704.5h)", () => {
    it("destroys a marked creature and reports it", () => {
        const bear = creature("bear", 2, 2, { dealtDeathtouchDamage: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(checkDeathtouchDestroySBA(state)).toBe(true);
        expect(onBattlefield(state, "bear")).toBe(false);
    });

    it("leaves an indestructible marked creature in play without looping", () => {
        const bear = creature("bear", 2, 2, {
            dealtDeathtouchDamage: true,
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        // Returns false (nothing actually left play) and terminates.
        expect(checkDeathtouchDestroySBA(state)).toBe(false);
        expect(onBattlefield(state, "bear")).toBe(true);
        // The mark persists (CR 702.12 — dies if it loses indestructible later).
        expect(state.players[0].battlefield[0].dealtDeathtouchDamage).toBe(
            true
        );
    });

    it("a non-creature marked permanent is not destroyed", () => {
        const artifact = creature("art", 0, 0, {
            types: ["Artifact"] as CardType[],
            dealtDeathtouchDamage: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [artifact] }),
                makePlayer("p2"),
            ],
        });
        expect(checkDeathtouchDestroySBA(state)).toBe(false);
        expect(onBattlefield(state, "art")).toBe(true);
    });
});

describe("deathtouch destruction survives the wire projection (visible outcome)", () => {
    it("the destroyed 5/5 is absent from the projected battlefield", () => {
        const ogre = creature("ogre", 5, 5);
        const strix = creature("strix", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["deathtouch"],
        });
        const state = combatState([ogre], [strix], {
            attackerIds: ["ogre"],
            blockerAssignments: { strix: ["ogre"] },
            blockedAttackerIds: ["ogre"],
        });

        applyAllCombatDamage(state, { ogre: { strix: 5 } });
        checkStateBasedActions(state);

        // GRE: gone from the fat battlefield.
        expect(onBattlefield(state, "ogre")).toBe(false);
        // Wire: gone from the projected battlefield too.
        const projected = projectPublicState(state, 1, "p1");
        const stillThere = projected.players.some((p) =>
            p.battlefield.some((c) => c.id === "ogre")
        );
        expect(stillThere).toBe(false);
    });
});
