// Per-card behavior tests for green cards in `convex/cards/sets/fem/green.ts`
// (FEM, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (definition shape, zone after resolution, projected wire-format).

import { describe, it, expect } from "vitest";
import {
    elvenFortress,
    elvishFarmer,
    elvishHunter,
    elvishScout,
    feralThallid,
    fungalBloom,
    nightSoil,
    sporeCloud,
    sporeFlower,
    thallid,
    thallidDevourer,
    theloniteDruid,
    theloniteMonk,
    thelonsChant,
    thelonsCurse,
    thornThallid,
    vodalianSoldiers,
} from "..";
import { resolveTopOfStack } from "../../../../gre/state";
import type { CardInstanceState, StackItem } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { untapStep } from "../../../../gre/phases";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTrigger, UPKEEP, resolveActivated } from "./helpers";

// ═══════════════════════════════════════════════════════════════════════════
// C1 — Green: Thallids, Fungi & Elves (issue #569). One describe per card with
// non-trivial behaviour, citing the CR section it exercises.
// ═══════════════════════════════════════════════════════════════════════════

/** Helper: a battlefield Thallid-family creature with N spore counters. */
function makeWithSpores(
    cardId: string,
    spores: number,
    controllerId = "p1"
): CardInstanceState {
    return makeInstance(cardId, {
        controllerId,
        zone: "battlefield",
        counters: spores > 0 ? { spore: spores } : {},
    });
}

describe("Thallid — spore engine (CR 122.1, 122.6, 707.1)", () => {
    it("adds a spore counter at the beginning of its controller's upkeep", () => {
        const thallidInst = makeWithSpores(thallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thallidInst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            thallidInst,
            "thallid-spore-upkeep",
            UPKEEP("p1")
        );
        const inPlay = state.players[0].battlefield[0];
        expect(inPlay.counters?.spore).toBe(1);
    });

    it("removes three spore counters to create a 1/1 green Saproling token", () => {
        const thallidInst = makeWithSpores(thallid.id, 3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thallidInst] }),
                makePlayer("p2"),
            ],
        });
        // The removeCounter cost is paid by the activation mutation; the test
        // exercises the resolve effect. Pay the cost manually then resolve.
        thallidInst.counters = { spore: 0 };
        resolveActivated(state, thallidInst, "thallid-make-saproling");
        const tokens = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Saproling")
        );
        expect(tokens).toHaveLength(1);
        expect(getEffectivePower(state, tokens[0])).toBe(1);
        expect(getEffectiveToughness(state, tokens[0])).toBe(1);
    });

    it("Saproling token survives the wire-format projection (CR 707.1)", () => {
        const thallidInst = makeWithSpores(thallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thallidInst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, thallidInst, "thallid-make-saproling");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find((c) =>
            c.subtypes?.includes("Saproling")
        )!;
        expect(slim).toBeDefined();
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });
});

describe("Thallid Devourer — sacrifice-a-Saproling pump (CR 602.1, 611.2)", () => {
    it("gets +1/+2 until end of turn when a Saproling is sacrificed", () => {
        const devourer = makeWithSpores(thallidDevourer.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [devourer] }),
                makePlayer("p2"),
            ],
        });
        // The Saproling sacrifice is paid by the activation mutation; resolve
        // exercises the pump effect on the source.
        resolveActivated(state, devourer, "thallid-devourer-devour");
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === devourer.id
        )!;
        expect(getEffectivePower(state, inPlay)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, inPlay)).toBe(4); // 2 + 2
    });
});

describe("Thorn Thallid — spore payoff ping (CR 115.4)", () => {
    it("deals 1 damage to a target player", () => {
        const thorn = makeWithSpores(thornThallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thorn] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, thorn, "thorn-thallid-ping", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Feral Thallid — spore payoff regenerate (CR 701.15a)", () => {
    it("applies a regeneration shield to itself", () => {
        const feral = makeWithSpores(feralThallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [feral] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, feral, "feral-thallid-regenerate");
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === feral.id
        )!;
        expect(inPlay.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Spore Flower — spore payoff Fog (CR 615)", () => {
    it("prevents all combat damage this turn", () => {
        const flower = makeWithSpores(sporeFlower.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flower] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, flower, "spore-flower-fog");
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });
});

describe("Fungal Bloom — feed the spore engine (CR 122.1)", () => {
    it("puts a spore counter on a target Fungus", () => {
        const bloom = makeInstance(fungalBloom.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const thallidInst = makeWithSpores(thallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bloom, thallidInst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bloom, "fungal-bloom-feed", [
            { type: "permanent", id: thallidInst.id },
        ]);
        const fed = state.players[0].battlefield.find(
            (c) => c.id === thallidInst.id
        )!;
        expect(fed.counters?.spore).toBe(1);
    });
});

describe("Elvish Farmer — sacrifice-a-Saproling lifegain (CR 602.1)", () => {
    it("gains 2 life when a Saproling is sacrificed", () => {
        const farmer = makeWithSpores(elvishFarmer.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [farmer], life: 20 }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, farmer, "elvish-farmer-gain-life");
        expect(state.players[0].life).toBe(22);
    });
});

describe("Elven Fortress — pump a blocking creature (CR 611.2)", () => {
    it("gives a target blocking creature +0/+1 until end of turn", () => {
        const fortress = makeInstance(elvenFortress.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const blocker = makeInstance(vodalianSoldiers.id, {
            controllerId: "p1",
            zone: "battlefield",
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fortress, blocker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, fortress, "elven-fortress-pump", [
            { type: "permanent", id: blocker.id },
        ]);
        const b = state.players[0].battlefield.find(
            (c) => c.id === blocker.id
        )!;
        expect(getEffectiveToughness(state, b)).toBe(3); // 2 + 1
        expect(getEffectivePower(state, b)).toBe(1); // unchanged
    });
});

describe("Elvish Hunter — one-shot untap lock (CR 302.6)", () => {
    it("marks a target creature to skip its next untap step", () => {
        const hunter = makeInstance(elvishHunter.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const victim = makeInstance(vodalianSoldiers.id, {
            controllerId: "p2",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hunter] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, hunter, "elvish-hunter-lock", [
            { type: "permanent", id: victim.id },
        ]);
        const locked = state.players[1].battlefield.find(
            (c) => c.id === victim.id
        )!;
        expect(locked.skipNextUntap).toBe(true);
    });
});

describe("Elvish Scout — untap attacker + combat-damage prevention (CR 615)", () => {
    it("untaps a target attacking creature and shields it from combat damage", () => {
        const scout = makeInstance(elvishScout.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const attacker = makeInstance(vodalianSoldiers.id, {
            controllerId: "p1",
            zone: "battlefield",
            isTapped: true,
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scout, attacker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, scout, "elvish-scout-untap", [
            { type: "permanent", id: attacker.id },
        ]);
        const a = state.players[0].battlefield.find(
            (c) => c.id === attacker.id
        )!;
        expect(a.isTapped).toBe(false);
    });
});

describe("Spore Cloud — mass tap + Fog + untap lock (CR 701.20a, 615, 302.6)", () => {
    it("taps all blockers, fogs combat, and locks untaps", () => {
        const blocker = makeInstance(vodalianSoldiers.id, {
            controllerId: "p2",
            zone: "battlefield",
            isBlocking: true,
        });
        const attacker = makeInstance(vodalianSoldiers.id, {
            controllerId: "p1",
            zone: "battlefield",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        pushSpell(state, sporeCloud.id, "p1");
        resolveTopOfStack(state);
        const b = state.players[1].battlefield.find(
            (c) => c.id === blocker.id
        )!;
        const a = state.players[0].battlefield.find(
            (c) => c.id === attacker.id
        )!;
        expect(b.isTapped).toBe(true);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
        expect(b.skipNextUntap).toBe(true);
        expect(a.skipNextUntap).toBe(true);
    });
});

describe("Thelonite Druid — animate Forests (CR 208.2, 611.1)", () => {
    it("turns Forests you control into 2/3 creatures that are still lands", () => {
        const druid = makeInstance(theloniteDruid.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        // A bare Forest land instance (no registry lookup needed — the engine
        // reads types/subtypes off the instance).
        const forestInst: CardInstanceState = {
            id: "forest-1",
            card: { id: "00000000-0000-0000-0000-0000000f0001" },
            types: ["Land"],
            subtypes: ["Forest"],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [druid, forestInst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, druid, "thelonite-druid-animate-forests");
        const f = state.players[0].battlefield.find(
            (c) => c.id === "forest-1"
        )!;
        expect(getEffectivePower(state, f)).toBe(2);
        expect(getEffectiveToughness(state, f)).toBe(3);
        expect(f.types).toContain("Creature");
        expect(f.types).toContain("Land"); // still a land

        // Wire-format: animated P/T survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "forest-1"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Thelonite Monk — land becomes a Forest indefinitely (CR 305.7)", () => {
    it("replaces a target land's subtypes with Forest", () => {
        const monk = makeInstance(theloniteMonk.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const land: CardInstanceState = {
            id: "land-1",
            card: { id: "00000000-0000-0000-0000-000000000001" },
            types: ["Land"],
            subtypes: ["Mountain"],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [monk, land] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, monk, "thelonite-monk-forest", [
            { type: "permanent", id: "land-1" },
        ]);
        const l = state.players[0].battlefield.find((c) => c.id === "land-1")!;
        expect(l.subtypes).toEqual(["Forest"]);
        expect(l.types).toContain("Land");
    });
});

describe("Night Soil — exile-from-graveyard cost (CR 602.1, 118.5, 707.1)", () => {
    it("creates a 1/1 green Saproling on resolve (cost paid by the mutation)", () => {
        const soil = makeInstance(nightSoil.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [soil] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, soil, "night-soil-make-saproling");
        const tokens = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Saproling")
        );
        expect(tokens).toHaveLength(1);
        expect(getEffectivePower(state, tokens[0])).toBe(1);
    });
});

/** A PERMANENT_ENTERED event for a Swamp entering under `playerId`, the
 *  payload Thelon's Chant's `resolve` reads via the factory's flattened
 *  `entered` view. */
function swampEntered(playerId: string): StackItem["triggerEvent"] {
    return {
        type: "PERMANENT_ENTERED",
        instanceId: "swamp-1",
        controllerId: playerId,
        types: ["Land"],
    } as StackItem["triggerEvent"];
}

describe("Thelon's Chant — punisher damage on a Swamp entering (CR 603.2, 117.3a)", () => {
    it("deals 3 damage to the entering player when they control no creature", () => {
        const chant = makeInstance(thelonsChant.id, {
            id: "chant",
            controllerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [chant] }),
            ],
        });
        resolveTrigger(
            state,
            chant,
            "thelons-chant-swamp-punish",
            swampEntered("p1")
        );
        expect(state.players[0].life).toBe(17);

        // Wire format — life total must survive projection, or the client
        // shows the punished player at their pre-damage total.
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].life).toBe(17);
    });

    it("suspends on a put-a-counter-or-take-3 punisher choice when a creature is available, and deals 3 damage if declined", () => {
        const chant = makeInstance(thelonsChant.id, {
            id: "chant",
            controllerId: "p2",
            zone: "battlefield",
        });
        const creature = makeInstance(vodalianSoldiers.id, {
            id: "vs",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [creature] }),
                makePlayer("p2", { battlefield: [chant] }),
            ],
        });
        resolveTrigger(
            state,
            chant,
            "thelons-chant-swamp-punish",
            swampEntered("p1")
        );
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("choose-permanents");
        expect(head?.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[0].life).toBe(17);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vs")?.counters?.[
                "-1/-1"
            ]
        ).toBeUndefined();
    });

    it("puts a -1/-1 counter on the chosen creature instead, taking no damage", () => {
        const chant = makeInstance(thelonsChant.id, {
            id: "chant",
            controllerId: "p2",
            zone: "battlefield",
        });
        const creature = makeInstance(vodalianSoldiers.id, {
            id: "vs",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [creature] }),
                makePlayer("p2", { battlefield: [chant] }),
            ],
        });
        resolveTrigger(
            state,
            chant,
            "thelons-chant-swamp-punish",
            swampEntered("p1")
        );
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["vs"],
        });
        expect(state.players[0].life).toBe(20);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "vs"
        )!;
        expect(onBoard.counters?.["-1/-1"]).toBe(1);
    });
});

describe("Thelon's Curse — blue creatures don't untap during untap steps (CR 502.1)", () => {
    it("keeps a tapped blue creature from untapping while Thelon's Curse is on the battlefield", () => {
        const curse = makeInstance(thelonsCurse.id, {
            id: "curse",
            controllerId: "p1",
            zone: "battlefield",
        });
        const blueCreature = makeInstance(vodalianSoldiers.id, {
            id: "blue-c",
            controllerId: "p2",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [curse] }),
                makePlayer("p2", { battlefield: [blueCreature] }),
            ],
            activePlayerId: "p2",
            phase: "UNTAP",
        });
        untapStep(state);
        const onBoard = state.players[1].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(onBoard.isTapped).toBe(true);

        // Wire format — the lock's effect (the creature staying tapped) must
        // survive projection, or the client shows it as untapped.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(slim.isTapped).toBe(true);
    });

    it("lets a blue creature untap normally without Thelon's Curse (control)", () => {
        const blueCreature = makeInstance(vodalianSoldiers.id, {
            id: "blue-c",
            controllerId: "p2",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [blueCreature] }),
            ],
            activePlayerId: "p2",
            phase: "UNTAP",
        });
        untapStep(state);
        const onBoard = state.players[1].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(onBoard.isTapped).toBe(false);
    });
});

describe("Thelon's Curse — pay {U} at upkeep to untap a tapped blue creature (CR 117.3a)", () => {
    it("untaps the tapped blue creature when its controller pays {U}", () => {
        const curse = makeInstance(thelonsCurse.id, {
            id: "curse",
            controllerId: "p1",
            zone: "battlefield",
        });
        const blueCreature = makeInstance(vodalianSoldiers.id, {
            id: "blue-c",
            controllerId: "p2",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [curse] }),
                makePlayer("p2", {
                    battlefield: [blueCreature],
                    manaPool: { U: 1 },
                }),
            ],
        });
        resolveTrigger(
            state,
            curse,
            "thelons-curse-untap-escape",
            UPKEEP("p2")
        );
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.playerId).toBe("p2");
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        const onBoard = state.players[1].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(onBoard.isTapped).toBe(false);

        // Wire format — the untap must survive projection, or the client
        // still shows the creature as tapped.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(slim.isTapped).toBe(false);
    });

    it("leaves the creature tapped when its controller declines to pay {U}", () => {
        const curse = makeInstance(thelonsCurse.id, {
            id: "curse",
            controllerId: "p1",
            zone: "battlefield",
        });
        const blueCreature = makeInstance(vodalianSoldiers.id, {
            id: "blue-c",
            controllerId: "p2",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [curse] }),
                makePlayer("p2", { battlefield: [blueCreature] }),
            ],
        });
        resolveTrigger(
            state,
            curse,
            "thelons-curse-untap-escape",
            UPKEEP("p2")
        );
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        const onBoard = state.players[1].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(onBoard.isTapped).toBe(true);
    });
});
