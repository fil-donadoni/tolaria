// Per-card behavior tests for white cards in `convex/cards/sets/arn/white.ts`
// (ARN, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (effective P/T, damage, zone, combat outcome).

import { describe, it, expect } from "vitest";
import {
    abuJafar,
    armyOfAllah,
    camel,
    desert,
    eyeForAnEye,
    flyingMen,
    jihad,
    juzamDjinn,
    kingSuleiman,
    mijaeDjinn,
    piety,
    repentantBlacksmith,
} from "..";
import { grizzlyBears, prodigalSorcerer } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    type CardInstanceState,
    combatPartnerIds,
    removePermanentTo,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import type { Color } from "../../../types";
import { resolveActivated, resolveTrigger } from "./helpers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { buildStateView } from "../../../../gre/replacements";

describe("Army of Allah (attacking creatures +2/+0, CR 611.2)", () => {
    it("pumps only attacking creatures", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            isAttacking: true,
        });
        const idle = makeInstance(grizzlyBears.id, { id: "idle" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker, idle] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, armyOfAllah.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectivePower(state, attacker)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(state, attacker)).toBe(2);
        expect(getEffectivePower(state, idle)).toBe(2); // unaffected
    });
});

describe("Piety (blocking creatures +0/+3, CR 611.2 + isBlocking filter)", () => {
    it("pumps only blocking creatures", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const idle = makeInstance(grizzlyBears.id, {
            id: "idle",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [blocker, idle] }),
            ],
        });
        pushSpell(state, piety.id, "p2");
        resolveTopOfStack(state);
        expect(getEffectiveToughness(state, blocker)).toBe(5); // 2 + 3
        expect(getEffectivePower(state, blocker)).toBe(2);
        expect(getEffectiveToughness(state, idle)).toBe(2); // unaffected
    });
});

describe("King Suleiman ({T}: destroy target Djinn or Efreet)", () => {
    it("destroys a Djinn", () => {
        const king = makeInstance(kingSuleiman.id, { id: "king" });
        const djinn = makeInstance(juzamDjinn.id, {
            id: "djinn",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king] }),
                makePlayer("p2", { battlefield: [djinn] }),
            ],
        });
        resolveActivated(state, king, "king-suleiman-destroy", [
            { type: "permanent", id: "djinn" },
        ]);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

describe("Abu Ja'far (dies → destroy combat partners; no regen; CR 603.2/603.10)", () => {
    /** Build combat with Abu Ja'far in it and return the assembled state. When
     *  `abuIsAttacker` is true Abu is the attacker and `partner` is its
     *  blocker; otherwise Abu is a blocker and `partner` is the attacker it
     *  blocks. `partnerRegen` gives the partner a regeneration shield. */
    function combatState(opts: {
        abuIsAttacker: boolean;
        partnerRegen?: boolean;
    }) {
        const abu = makeInstance(abuJafar.id, {
            id: "abu",
            controllerId: "p1",
            ownerId: "p1",
        });
        const partner = makeInstance(grizzlyBears.id, {
            id: "partner",
            controllerId: "p2",
            ownerId: "p2",
        });
        if (opts.partnerRegen) partner.regenerationShields = 1;
        const blockerAssignments: Record<string, string[]> = opts.abuIsAttacker
            ? { partner: ["abu"] }
            : { abu: ["partner"] };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [abu] }),
                makePlayer("p2", { battlefield: [partner] }),
            ],
            combat: {
                attackerIds: [opts.abuIsAttacker ? "abu" : "partner"],
                confirmed: true,
                blockerAssignments,
                blockedAttackerIds: [opts.abuIsAttacker ? "abu" : "partner"],
                blockersConfirmed: true,
            },
        });
        return { state, abu, partner };
    }

    it("combatPartnerIds finds the creature blocking it (Abu attacking)", () => {
        const { state } = combatState({ abuIsAttacker: true });
        expect(combatPartnerIds(state, "abu")).toEqual(["partner"]);
    });

    it("combatPartnerIds finds the creature it blocks (Abu blocking)", () => {
        const { state } = combatState({ abuIsAttacker: false });
        expect(combatPartnerIds(state, "abu")).toEqual(["partner"]);
    });

    it("destroys the creature blocking Abu Ja'far when it dies", () => {
        const { state, abu } = combatState({ abuIsAttacker: true });
        // Death snapshots combatPartnerIds onto CREATURE_DIED.
        removePermanentTo(state, "abu", "graveyard");
        const died = (state.pendingEvents ?? []).find(
            (e) => e.type === "CREATURE_DIED"
        ) as { combatPartnerIds?: string[] } | undefined;
        expect(died?.combatPartnerIds).toEqual(["partner"]);
        // Resolve the death trigger with that captured event.
        resolveTrigger(state, abu, "abu-jafar-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "abu",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 1,
            combatPartnerIds: ["partner"],
        } as StackItem["triggerEvent"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "partner")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "partner")).toBe(
            true
        );
    });

    it("destroys the attacker Abu Ja'far was blocking when it dies", () => {
        const { state, abu } = combatState({ abuIsAttacker: false });
        removePermanentTo(state, "abu", "graveyard");
        resolveTrigger(state, abu, "abu-jafar-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "abu",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 1,
            combatPartnerIds: ["partner"],
        } as StackItem["triggerEvent"]);
        expect(state.players[1].graveyard.some((c) => c.id === "partner")).toBe(
            true
        );
    });

    it("partners can't be regenerated (regen shield does not save them)", () => {
        const { state, abu, partner } = combatState({
            abuIsAttacker: true,
            partnerRegen: true,
        });
        expect(partner.regenerationShields).toBe(1);
        removePermanentTo(state, "abu", "graveyard");
        resolveTrigger(state, abu, "abu-jafar-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "abu",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 1,
            combatPartnerIds: ["partner"],
        } as StackItem["triggerEvent"]);
        // cantBeRegenerated suppressed the shield (CR 701.19c).
        expect(state.players[1].graveyard.some((c) => c.id === "partner")).toBe(
            true
        );
    });

    it("does nothing when Abu Ja'far dies outside combat", () => {
        const abu = makeInstance(abuJafar.id, {
            id: "abu",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bystander = makeInstance(grizzlyBears.id, {
            id: "by",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [abu] }),
                makePlayer("p2", { battlefield: [bystander] }),
            ],
        });
        removePermanentTo(state, "abu", "graveyard");
        const died = (state.pendingEvents ?? []).find(
            (e) => e.type === "CREATURE_DIED"
        ) as { combatPartnerIds?: string[] } | undefined;
        expect(died?.combatPartnerIds ?? []).toEqual([]);
        resolveTrigger(state, abu, "abu-jafar-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "abu",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 1,
            combatPartnerIds: [],
        } as StackItem["triggerEvent"]);
        expect(state.players[1].battlefield.some((c) => c.id === "by")).toBe(
            true
        );
    });
});

describe("Eye for an Eye (reflect damage to source's controller, CR 614)", () => {
    it("reflects the chosen source's damage to its controller without reducing yours", () => {
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20, battlefield: [tim] }),
            ],
        });
        pushSpell(state, eyeForAnEye.id, "p1", [
            { type: "permanent", id: "tim" },
        ]);
        resolveTopOfStack(state);
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].life).toBe(19); // damage to you unchanged
        expect(state.players[1].life).toBe(19); // reflected to source's controller
    });

    it("is one-shot — a second hit from the source is not reflected", () => {
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tim2 = makeInstance(prodigalSorcerer.id, {
            id: "tim2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20, battlefield: [tim, tim2] }),
            ],
        });
        pushSpell(state, eyeForAnEye.id, "p1", [
            { type: "permanent", id: "tim" },
        ]);
        resolveTopOfStack(state);
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        // Second zap from the same source: shield consumed, no reflect.
        resolveActivated(state, tim2, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].life).toBe(18); // took both hits
        expect(state.players[1].life).toBe(19); // reflected only once
    });
});

describe("Camel (banding + Desert-damage prevention for its band while attacking)", () => {
    it("while attacking, prevents Desert damage to itself and band-mates", () => {
        // `isAttacking` (issue #1853 review) — Desert's own `combatRoleFilter`
        // is now re-checked at resolution too (`isTargetStillLegal`,
        // gre/state.ts), reading the SAME per-card flag the shield's own
        // `appliesTo` reads `combat.attackerIds` for; both must reflect
        // "attacking" for this scenario to be reachable through real play.
        const cam = makeInstance(camel.id, {
            id: "camel",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const ally = makeInstance(grizzlyBears.id, {
            id: "ally",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const des = makeInstance(desert.id, { id: "des" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [des] }),
                makePlayer("p2", { battlefield: [cam, ally] }),
            ],
            combat: {
                attackerIds: ["camel", "ally"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
                bands: [{ bandId: "b1", memberIds: ["camel", "ally"] }],
            },
        });
        // Desert damage to the band-mate is prevented (Camel attacking).
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "ally" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ally")
                ?.damageMarked ?? 0
        ).toBe(0);
        // And to Camel itself.
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "camel" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "camel")
                ?.damageMarked ?? 0
        ).toBe(0);
    });

    // CR 608.2b (issue #1853 review) — Desert's OWN `targetRequirement`
    // requires an ATTACKING creature (`combatRoleFilter`), so "deal Desert
    // damage to a non-attacking Camel" is not a state a real player can ever
    // reach through Desert — it was never a legal target to begin with, now
    // enforced at resolution too, same as at selection. Reformulated to probe
    // the shield's OWN "must be attacking" condition directly
    // (`camel-band-no-desert-damage`'s `appliesTo`) rather than through an
    // ability activation the CR itself rules out.
    it("the shield's appliesTo predicate does NOT fire while Camel is not attacking", () => {
        const cam = makeInstance(camel.id, {
            id: "camel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [cam] }),
            ],
            // No `combat` block at all — Camel is not attacking.
        });
        const shield = camel.replacementEffects!.find(
            (r) => r.id === "camel-band-no-desert-damage"
        )!;
        const applies = shield.appliesTo(
            {
                kind: "damage",
                sourceInstanceId: "des",
                sourceControllerId: "p1",
                sourceColors: [],
                sourceTypes: ["Land"],
                sourceSubtypes: ["Desert"],
                sourceStaticAbilities: [],
                target: { type: "permanent", id: "camel" },
                amount: 1,
                isCombat: false,
            },
            cam,
            buildStateView(state)
        );
        expect(applies).toBe(false);
    });
});

describe("Jihad (#188) — white anthem while chosen player controls the chosen color", () => {
    /** p1 controls a white creature (Repentant Blacksmith, 1/2) + Jihad (chosen
     *  color = the mode id); p2 is the opponent. `oppBattlefield` seeds p2. */
    function withJihad(modeColor: Color, oppBattlefield: CardInstanceState[]) {
        const whiteCreature = makeInstance(repentantBlacksmith.id, {
            id: "white-creature",
            controllerId: "p1",
        });
        const jihadInst = makeInstance(jihad.id, {
            id: "jihad",
            controllerId: "p1",
            chosenModeId: modeColor,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [whiteCreature, jihadInst],
                }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        return { state, whiteCreature, jihadInst };
    }

    it("buffs white creatures +2/+1 while the opponent controls a nontoken permanent of the chosen color", () => {
        // Chosen color red; opponent controls a red creature (Mijae Djinn).
        const redPermanent = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state, whiteCreature } = withJihad("R", [redPermanent]);
        // Repentant Blacksmith is 1/2 → +2/+1 = 3/3.
        expect(getEffectivePower(state, whiteCreature)).toBe(3);
        expect(getEffectiveToughness(state, whiteCreature)).toBe(3);
    });

    it("the anthem turns off when the opponent controls no nontoken permanent of the chosen color", () => {
        // Opponent controls a BLUE permanent — chosen color is red → no buff.
        const bluePermanent = makeInstance(flyingMen.id, {
            id: "blue-perm",
            controllerId: "p2",
        });
        const { state, whiteCreature } = withJihad("R", [bluePermanent]);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
        expect(getEffectiveToughness(state, whiteCreature)).toBe(2);
    });

    it("a token of the chosen color does NOT keep the anthem on (CR 111 nontoken)", () => {
        const redToken = makeInstance(mijaeDjinn.id, {
            id: "red-token",
            controllerId: "p2",
            isToken: true,
        });
        const { state, whiteCreature } = withJihad("R", [redToken]);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
    });

    it("a permanent the source's controller controls does NOT satisfy the clause (must be the opponent's)", () => {
        // p1 (Jihad's controller) controls the only red permanent; the
        // opponent has none → anthem off.
        const myRed = makeInstance(mijaeDjinn.id, {
            id: "my-red",
            controllerId: "p1",
        });
        const { state, whiteCreature } = withJihad("R", []);
        state.players[0].battlefield.push(myRed);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
    });

    it("sacrifices itself when the opponent controls no nontoken permanent of the chosen color (CR 603.8)", () => {
        const { state, jihadInst } = withJihad("R", []);
        resolveTrigger(state, jihadInst, "jihad-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "jihad")
        ).toBeUndefined();
    });

    it("survives the state-trigger while the opponent controls the chosen color (intervening-if)", () => {
        const redPermanent = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state, jihadInst } = withJihad("R", [redPermanent]);
        resolveTrigger(state, jihadInst, "jihad-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "jihad")
        ).toBeDefined();
    });

    it("the conditional anthem survives the wire projection (mandatory)", () => {
        const redPermanent = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state } = withJihad("R", [redPermanent]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "white-creature"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("CR 614.12a — a CAST Jihad is asked for its colour AS IT ENTERS, not at announcement (cast→resolve)", () => {
        const whiteCreature = makeInstance(repentantBlacksmith.id, {
            id: "white-creature",
            controllerId: "p1",
        });
        const redPermanent = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whiteCreature] }),
                makePlayer("p2", { battlefield: [redPermanent] }),
            ],
        });
        // Announced with NO mode: "As Jihad enters, choose a color" is a
        // CR 614.1c replacement, so `announceCast` rejects a `chosenModeId`
        // and the pick is raised at the CR 614 entry chokepoint instead
        // (ADR 0100 slice 2, issue #2019).
        state.stack.push({
            ...makeInstance(jihad.id, {
                id: "jihad",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            targets: [],
        });
        resolveTopOfStack(state);

        // Parked off every zone until the colour is chosen (CR 614.12a).
        expect(state.players[0].battlefield.some((c) => c.id === "jihad")).toBe(
            false
        );
        const choice = state.pendingChoices![0];
        expect(choice.asEntersCardId).toBe("jihad");
        expect(choice.asEntersKind).toBe("mode");
        applyPendingChoiceSubmit(state, {
            playerId: choice.playerId,
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: ["R"],
        });

        const onBattlefield = state.players[0].battlefield.find(
            (c) => c.id === "jihad"
        );
        expect(onBattlefield?.chosenModeId).toBe("R");
        // Asked exactly ONCE — nothing is still owed.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // The anthem is live now that Jihad is in play and p2 controls red.
        expect(getEffectivePower(state, whiteCreature)).toBe(3);
    });
});
