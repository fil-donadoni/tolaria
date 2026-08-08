// Per-card behavior tests for red cards in `convex/cards/sets/arn/red.ts`
// (ARN, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (effective P/T, damage, zone, combat outcome).

import { describe, it, expect } from "vitest";
import {
    aladdin,
    aliBaba,
    aliFromCairo,
    brassMan,
    desert,
    desertNomads,
    flyingMen,
    kirdApe,
    magneticMountain,
    mijaeDjinn,
    rukhEgg,
    ydwenEfreet,
} from "..";
import {
    forest,
    grizzlyBears,
    prodigalSorcerer,
    psionicBlast,
} from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { validateBlockerEligibility } from "../../../../gre/combat";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import { applyRandomRevealAck } from "../../../../gre/pendingChoiceSubmit";
import { applyAllCombatDamage, untapStep } from "../../../../gre/phases";
import { applyDamageReplacements } from "../../../../gre/replacements";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    type GameState,
    getPlayer,
    removePermanentTo,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import { matchesPermanentFilter } from "../../../filters";
import type { Color } from "../../../types";
import {
    resolveActivated,
    resolveTrigger,
    answerChoice,
    upkeepEvent,
    WIN_SEED,
    LOSE_SEED,
} from "./helpers";

describe("Ali Baba ({R}: tap target Wall)", () => {
    it("taps a Wall", () => {
        const ali = makeInstance(aliBaba.id, { id: "ali" });
        // Synthetic Wall (no Wall card in lea registry needed — minimal view).
        const wall = makeInstance(grizzlyBears.id, {
            id: "wall",
            subtypes: ["Wall"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ali] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        resolveActivated(state, ali, "ali-baba-tap-wall", [
            { type: "permanent", id: "wall" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "wall")!.isTapped
        ).toBe(true);
    });
});

describe("Rukh Egg (dies → 4/4 flying Bird at next end step)", () => {
    it("schedules a delayed token on death", () => {
        const egg = makeInstance(rukhEgg.id, { id: "egg" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [egg] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, egg, "rukh-egg-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "egg",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 3,
        } as StackItem["triggerEvent"]);
        expect((state.delayedTriggers ?? []).length).toBe(1);
    });
});

describe("Kird Ape (+1/+2 while you control a Forest, CR 613)", () => {
    it("is 1/1 without a Forest and 2/3 with one (GRE + wire)", () => {
        const ape = makeInstance(kirdApe.id, { id: "ape" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ape] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, ape)).toBe(1);
        expect(getEffectiveToughness(state, ape)).toBe(1);

        state.players[0].battlefield.push(
            makeInstance(forest.id, { id: "forest" })
        );
        expect(getEffectivePower(state, ape)).toBe(2);
        expect(getEffectiveToughness(state, ape)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ape"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Ali from Cairo (clamp life >= 1, CR 614)", () => {
    it("keeps life >= 1 against otherwise-lethal damage", () => {
        const ali = makeInstance(aliFromCairo.id, { id: "ali" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 3, battlefield: [ali] }),
                makePlayer("p2"),
            ],
        });
        // p2 casts a 4-damage burn at p1 (life 3) — would be lethal.
        pushSpell(state, psionicBlast.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(1);
    });

    it("is repeatable across multiple damage events", () => {
        const ali = makeInstance(aliFromCairo.id, { id: "ali" });
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
                makePlayer("p1", { life: 1, battlefield: [ali] }),
                makePlayer("p2", { battlefield: [tim, tim2] }),
            ],
        });
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].life).toBe(1);
        resolveActivated(state, tim2, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].life).toBe(1);
    });

    it("the replacement fires through the public projection (wire format)", () => {
        const ali = makeInstance(aliFromCairo.id, { id: "ali" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 3, battlefield: [ali] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        // The projection strips card.card to { id }; the replacement is looked
        // up from the registry by that id, so it must still fire (wire format).
        const ev = applyDamageReplacements(projected as unknown as GameState, {
            kind: "damage",
            sourceInstanceId: "x",
            sourceControllerId: "p2",
            sourceColors: [],
            sourceTypes: [],
            sourceStaticAbilities: [],
            target: { type: "player", id: "p1" },
            amount: 9,
            isCombat: false,
        });
        // Clamped so the resulting life total would be exactly 1 (3 - 2).
        expect(ev?.amount).toBe(2);
    });
});

describe("Aladdin ({1}{R}{R},{T}: gain control of an artifact while you control it)", () => {
    it("takes an artifact's control, reverting when Aladdin leaves", () => {
        const al = makeInstance(aladdin.id, {
            id: "aladdin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const art = makeInstance(brassMan.id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [al] }),
                makePlayer("p2", { battlefield: [art] }),
            ],
        });
        resolveActivated(state, al, "aladdin-steal-artifact", [
            { type: "permanent", id: "art" },
        ]);
        checkStateBasedActions(state);
        // Artifact now under p1, physically in p1's battlefield array.
        expect(
            state.players[0].battlefield.find((c) => c.id === "art")
                ?.controllerId
        ).toBe("p1");
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();

        // Aladdin leaves → "for as long as you control Aladdin" lapses → revert.
        removePermanentTo(state, "aladdin", "graveyard");
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
                ?.controllerId
        ).toBe("p2");
    });

    it("the control change survives the public projection (wire format)", () => {
        const al = makeInstance(aladdin.id, {
            id: "aladdin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const art = makeInstance(brassMan.id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [al] }),
                makePlayer("p2", { battlefield: [art] }),
            ],
        });
        resolveActivated(state, al, "aladdin-steal-artifact", [
            { type: "permanent", id: "art" },
        ]);
        checkStateBasedActions(state);
        const projected = projectPublicState(state, 1, "p1");
        // The stolen artifact projects under p1 (the new controller).
        expect(
            projected.players[0].battlefield.find((c) => c.id === "art")
                ?.controllerId
        ).toBe("p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();
    });
});

describe("Desert Nomads (desertwalk + prevent damage from Deserts)", () => {
    it("has desertwalk and is unblockable when the defender controls a Desert", () => {
        expect(desertNomads.staticAbilities).toContain("desertwalk");
        const nomads = makeInstance(desertNomads.id, { id: "nomads" });
        const blocker = makeInstance(grizzlyBears.id, { id: "blk" });
        const des = makeInstance(desert.id, { id: "des" });

        // Defender controls a Desert → desertwalk makes Nomads unblockable.
        expect(
            validateBlockerEligibility(nomads, blocker, [blocker, des]).eligible
        ).toBe(false);
        // No Desert → blockable normally.
        expect(
            validateBlockerEligibility(nomads, blocker, [blocker]).eligible
        ).toBe(true);
    });

    it("prevents Desert damage to itself but takes non-Desert damage", () => {
        const nomads = makeInstance(desertNomads.id, {
            id: "nomads",
            controllerId: "p2",
            ownerId: "p2",
        });
        const des = makeInstance(desert.id, { id: "des" });
        const tim = makeInstance(prodigalSorcerer.id, { id: "tim" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [des, tim] }),
                makePlayer("p2", { battlefield: [nomads] }),
            ],
        });
        // Desert ping → prevented (source is a Desert).
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "nomads" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "nomads")
                ?.damageMarked ?? 0
        ).toBe(0);
        // A non-Desert source still hits it.
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "permanent", id: "nomads" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "nomads")
                ?.damageMarked
        ).toBe(1);
    });

    it("the Desert-damage prevention fires through the public projection (wire format)", () => {
        const nomads = makeInstance(desertNomads.id, {
            id: "nomads",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [nomads] }),
            ],
        });
        const projected = projectPublicState(state, 2, "p2");
        // The projection strips card.card to { id }; the replacement is looked
        // up from the registry by that id, so it must still consume the event.
        const ev = applyDamageReplacements(projected as unknown as GameState, {
            kind: "damage",
            sourceInstanceId: "des",
            sourceControllerId: "p1",
            sourceColors: [],
            sourceTypes: ["Land"],
            sourceSubtypes: ["Desert"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "nomads" },
            amount: 1,
            isCombat: false,
        });
        expect(ev).toBeNull();
    });
});

describe("Magnetic Mountain (CR 502.1 untap restriction + upkeep untap)", () => {
    // --- Static untap restriction (CR 502.1) -------------------------------
    it("blue creatures don't untap during the untap step; non-blue ones do", () => {
        const mm = makeInstance(magneticMountain.id, { id: "mm" });
        const blueCreature = makeInstance(flyingMen.id, {
            id: "blue",
            controllerId: "p1",
            isTapped: true,
        });
        const greenCreature = makeInstance(grizzlyBears.id, {
            id: "green",
            controllerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mm, blueCreature, greenCreature],
                }),
                makePlayer("p2"),
            ],
        });
        untapStep(state);
        // maxUntap 0 hard-skip auto-resolves: no prompt, blue stays tapped.
        expect(state.pendingChoices ?? []).toEqual([]);
        const blue = state.players[0].battlefield.find((c) => c.id === "blue")!;
        const green = state.players[0].battlefield.find(
            (c) => c.id === "green"
        )!;
        expect(blue.isTapped).toBe(true);
        expect(green.isTapped).toBe(false);
    });

    it("the no-untap filter matches a blue creature on the projected wire state (CR 202.2)", () => {
        const mm = makeInstance(magneticMountain.id, { id: "mm" });
        const blueCreature = makeInstance(flyingMen.id, {
            id: "blue",
            controllerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mm, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        const filter = { types: "Creature" as const, colors: ["U"] as Color[] };
        // GRE-side: colors derived via STATIC_EFFECT_CTX.getColors.
        expect(
            matchesPermanentFilter(
                {
                    ...blueCreature,
                    colors: STATIC_EFFECT_CTX.getColors(blueCreature),
                },
                filter
            )
        ).toBe(true);
        // Wire-format: the assertion survives the projection (colors derived
        // the same way client-side from the slim card's def).
        const projected = projectPublicState(state, 1, "p1");
        const slimBlue = projected.players[0].battlefield.find(
            (c) => c.id === "blue"
        )!;
        expect(
            matchesPermanentFilter(
                {
                    ...slimBlue,
                    colors: STATIC_EFFECT_CTX.getColors(
                        slimBlue as unknown as Parameters<
                            typeof STATIC_EFFECT_CTX.getColors
                        >[0]
                    ),
                },
                filter
            )
        ).toBe(true);
    });

    // --- Filter unit: colors + tapped ---------------------------------------
    it("matchesPermanentFilter gates on colors + tapped together", () => {
        const f = {
            types: "Creature" as const,
            colors: ["U"] as Color[],
            tapped: true,
        };
        const tappedBlue = {
            ...makeInstance(flyingMen.id, { id: "tb", isTapped: true }),
            colors: ["U"] as Color[],
        };
        const untappedBlue = {
            ...makeInstance(flyingMen.id, { id: "ub", isTapped: false }),
            colors: ["U"] as Color[],
        };
        const tappedGreen = {
            ...makeInstance(grizzlyBears.id, { id: "tg", isTapped: true }),
            colors: ["G"] as Color[],
        };
        expect(matchesPermanentFilter(tappedBlue, f)).toBe(true);
        expect(matchesPermanentFilter(untappedBlue, f)).toBe(false);
        expect(matchesPermanentFilter(tappedGreen, f)).toBe(false);
    });

    // --- Upkeep trigger: choose + pay + untap (CR 603.6a / 118) -------------
    function setupUpkeep() {
        const mm = makeInstance(magneticMountain.id, { id: "mm" });
        const b1 = makeInstance(flyingMen.id, {
            id: "b1",
            controllerId: "p1",
            isTapped: true,
        });
        const b2 = makeInstance(flyingMen.id, {
            id: "b2",
            controllerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mm, b1, b2],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 8 },
                }),
                makePlayer("p2"),
            ],
        });
        return { state, mm };
    }

    it("pays {4} each and untaps the chosen blue creatures", () => {
        const { state, mm } = setupUpkeep();
        resolveTrigger(
            state,
            mm,
            "magnetic-mountain-upkeep",
            upkeepEvent("p1")
        );
        // First suspension: the choose-permanents pick.
        answerChoice(state, ["b1", "b2"]);
        // Second suspension: the may-pay (accept).
        answerChoice(state, ["yes"]);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "b1")!.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "b2")!.isTapped).toBe(false);
    });

    it("declining the payment leaves the creatures tapped", () => {
        const { state, mm } = setupUpkeep();
        resolveTrigger(
            state,
            mm,
            "magnetic-mountain-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["b1", "b2"]);
        answerChoice(state, ["decline"]);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "b1")!.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "b2")!.isTapped).toBe(true);
    });

    it("choosing none asks for no payment and untaps nothing", () => {
        const { state, mm } = setupUpkeep();
        resolveTrigger(
            state,
            mm,
            "magnetic-mountain-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, []);
        // No may-pay was enqueued (chose zero creatures).
        expect(state.pendingChoices ?? []).toEqual([]);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "b1")!.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "b2")!.isTapped).toBe(true);
    });

    it("no trigger effect when the upkeep player controls no tapped blue creatures", () => {
        const mm = makeInstance(magneticMountain.id, { id: "mm" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mm] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            mm,
            "magnetic-mountain-upkeep",
            upkeepEvent("p1")
        );
        expect(state.pendingChoices ?? []).toEqual([]);
    });
});

describe("Mijae Djinn (random-reveal attack flip, CR 705 / ADR 0023 + CR 508)", () => {
    /** Build a fresh combat with Mijae attacking, seeded for a known first
     *  flip, and push+resolve its attack trigger (which suspends on the
     *  random-reveal). Returns the suspended state. */
    function attackingMijae(seed: number) {
        const mijae = makeInstance(mijaeDjinn.id, {
            id: "mijae",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            rngSeed: seed,
            players: [
                makePlayer("p1", { battlefield: [mijae] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["mijae"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const event: StackItem["triggerEvent"] = {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: ["mijae"],
        };
        resolveTrigger(state, mijae, "mijae-djinn-attack-flip", event);
        return { state, mijae };
    }

    /** Acknowledge the head random-reveal choice to resume the trigger. */
    function ack(state: GameState) {
        const head = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    const mijaeOf = (state: GameState) =>
        state.players[0].battlefield.find((c) => c.id === "mijae")!;

    it("suspends on a random-reveal choice BEFORE applying the consequence", () => {
        const { state } = attackingMijae(LOSE_SEED);
        // Trigger is suspended on a random-reveal pending choice.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.playerId).toBe("p1");
        expect(head.randomKind).toBe("coin");
        expect(head.sides).toBe(2);
        // LOSE seed → result 0 (tails), realized LOSE face + consequence.
        expect(head.result).toBe(0);
        expect(head.realized).toEqual({
            face: "LOSE",
            consequence: "Remove Mijae Djinn from combat and tap it",
        });
        // The consequence has NOT been applied yet (reveal precedes apply):
        // Mijae is still attacking and untapped.
        const m = mijaeOf(state);
        expect(m.isAttacking).toBe(true);
        expect(m.isTapped).toBe(false);
        expect(state.combat!.attackerIds).toContain("mijae");
    });

    it("won flip → stays attacking, untapped (flipCoin once across resume)", () => {
        const { state } = attackingMijae(WIN_SEED);
        const before = state.rngCounter;
        // WIN seed → result 1 (heads), realized WIN face.
        const head = state.pendingChoices![0];
        expect(head.result).toBe(1);
        expect(head.realized).toEqual({
            face: "WIN",
            consequence: "Mijae Djinn stays attacking",
        });
        ack(state);
        // Resume reads the persisted outcome — no re-roll.
        expect(state.rngCounter).toBe(before);
        const m = mijaeOf(state);
        expect(m.isAttacking).toBe(true);
        expect(m.isTapped).toBe(false);
        expect(state.combat!.attackerIds).toContain("mijae");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });

    it("lost flip → removed from combat and tapped (flipCoin once across resume)", () => {
        const { state } = attackingMijae(LOSE_SEED);
        const before = state.rngCounter;
        ack(state);
        // Resume reads the persisted outcome — no re-roll.
        expect(state.rngCounter).toBe(before);
        const m = mijaeOf(state);
        expect(m.isAttacking).toBeFalsy();
        expect(m.isTapped).toBe(true);
        expect(state.combat!.attackerIds).not.toContain("mijae");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });

    it("flipCoin runs exactly once: rngCounter advances by 1 on suspend, then 0 on resume", () => {
        const { state } = attackingMijae(LOSE_SEED);
        const afterSuspend = state.rngCounter;
        // The bit was drawn once when the trigger suspended.
        expect(afterSuspend).toBe(1);
        ack(state);
        // Resume does NOT re-roll.
        expect(state.rngCounter).toBe(afterSuspend);
    });

    it("wire format: random-reveal fields survive projection for BOTH viewers", () => {
        const { state } = attackingMijae(LOSE_SEED);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const head = projected.pendingChoices![0];
            expect(head.kind).toBe("random-reveal");
            expect(head.randomKind).toBe("coin");
            expect(head.result).toBe(0);
            // The result is public (CR 705) — both the flipper and the
            // opponent see the realized face + consequence before the apply.
            expect(head.realized).toEqual({
                face: "LOSE",
                consequence: "Remove Mijae Djinn from combat and tap it",
            });
        }
    });

    it("ack mutation rejects a mismatched head (stack item id)", () => {
        const { state } = attackingMijae(LOSE_SEED);
        const head = state.pendingChoices![0];
        expect(() =>
            applyRandomRevealAck(state, {
                playerId: head.playerId,
                stackItemId: "wrong",
                choiceId: head.choiceId,
            })
        ).toThrow();
        // Unchanged: still suspended, consequence not applied.
        expect(state.pendingChoices![0].kind).toBe("random-reveal");
        expect(mijaeOf(state).isTapped).toBe(false);
        // Sanity: ack resumes only on the correct identity.
        ack(state);
        expect(mijaeOf(state).isTapped).toBe(true);
    });
});

describe("Ydwen Efreet (block flip via requestCoinFlip, CR 705 / 509.1h / ADR 0023)", () => {
    /** p1 attacks with a bear; p2's Ydwen is its only blocker. When
     *  `secondBlocker` is set, a 2/2 bear ("blk2") also blocks "atk", so
     *  Ydwen is no longer the SOLE blocker — leaving combat must NOT unblock
     *  the attacker (CR 509.1h). Resolving the trigger suspends on the flip. */
    function blockingYdwen(seed: number, secondBlocker = false) {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const ydwen = makeInstance(ydwenEfreet.id, {
            id: "ydwen",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const blk2 = makeInstance(grizzlyBears.id, {
            id: "blk2",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const blockerAssignments: Record<string, string[]> = secondBlocker
            ? { ydwen: ["atk"], blk2: ["atk"] }
            : { ydwen: ["atk"] };
        const state = makeState({
            rngSeed: seed,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { life: 20, battlefield: [attacker] }),
                makePlayer("p2", {
                    life: 20,
                    battlefield: secondBlocker ? [ydwen, blk2] : [ydwen],
                }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments,
                blockedAttackerIds: ["atk"],
                blockersConfirmed: true,
            },
        });
        const event: StackItem["triggerEvent"] = {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "atk",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId: "ydwen",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: ["Efreet"],
        };
        resolveTrigger(state, ydwen, "ydwen-efreet-block-flip", event);
        return state;
    }

    /** Acknowledge the head random-reveal choice to resume resolution. */
    function ack(state: GameState) {
        const head = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    it("suspends on a random-reveal choice BEFORE applying the consequence (LOSE)", () => {
        const state = blockingYdwen(LOSE_SEED);
        // Suspended on a random-reveal pending choice owned by Ydwen's
        // controller — the flipping player is the blocker's controller.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.playerId).toBe("p2");
        expect(head.randomKind).toBe("coin");
        expect(head.sides).toBe(2);
        // LOSE seed → result 0 (tails), realized LOSE face + consequence.
        expect(head.result).toBe(0);
        expect(head.realized?.face).toBe("LOSE");
        // Consequence NOT applied yet: Ydwen still blocking, attacker blocked.
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        expect(y.isBlocking).toBe(true);
        expect(y.cantBlockThisTurn).toBeFalsy();
        expect(state.combat!.blockedAttackerIds).toContain("atk");
    });

    it("won flip → stays blocking, attacker stays blocked (only after ack)", () => {
        const state = blockingYdwen(WIN_SEED);
        const head = state.pendingChoices![0];
        expect(head.realized?.face).toBe("WIN");
        ack(state);
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        expect(y.isBlocking).toBe(true);
        expect(y.cantBlockThisTurn).toBeFalsy();
        expect(state.combat!.blockedAttackerIds).toContain("atk");
        expect(state.combat!.blockerAssignments.ydwen).toEqual(["atk"]);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("lost flip → removed from combat, can't block, solely-blocked attacker becomes unblocked and hits defender (only after ack)", () => {
        const state = blockingYdwen(LOSE_SEED);
        ack(state);
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        expect(y.isBlocking).toBeFalsy();
        expect(y.cantBlockThisTurn).toBe(true);
        // The bear it solely blocked is unblocked again (CR 509.1h).
        expect(state.combat!.blockedAttackerIds).not.toContain("atk");
        expect(state.combat!.blockerAssignments.ydwen ?? []).not.toContain(
            "atk"
        );
        // Damage step: the now-unblocked bear (2 power) hits the defender (p2).
        applyAllCombatDamage(state, { atk: { p2: 2 } });
        expect(state.players[1].life).toBe(18);
    });

    it("lost flip but NOT solely blocked → attacker stays blocked (CR 509.1h)", () => {
        const state = blockingYdwen(LOSE_SEED, /* secondBlocker */ true);
        ack(state);
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        // Ydwen leaves combat and can't block again...
        expect(y.isBlocking).toBeFalsy();
        expect(y.cantBlockThisTurn).toBe(true);
        // ...but a second creature still blocks "atk", so it stays blocked.
        expect(state.combat!.blockedAttackerIds).toContain("atk");
        expect(state.combat!.blockerAssignments.ydwen ?? []).not.toContain(
            "atk"
        );
        expect(state.combat!.blockerAssignments.blk2).toEqual(["atk"]);
    });

    it("flipCoin runs exactly once: rngCounter advances by 1 across suspend/resume", () => {
        const state = blockingYdwen(LOSE_SEED);
        // The bit was drawn once on suspend; ack resumes without a re-roll.
        const afterSuspend = state.rngCounter;
        ack(state);
        expect(state.rngCounter).toBe(afterSuspend);
    });

    it("wire format: random-reveal fields survive projection for BOTH viewers", () => {
        const state = blockingYdwen(LOSE_SEED);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const head = projected.pendingChoices![0];
            expect(head.kind).toBe("random-reveal");
            expect(head.randomKind).toBe("coin");
            // The result is public (CR 705) — both flipper and opponent see the
            // realized LOSE face.
            expect(head.result).toBe(0);
            expect(head.realized?.face).toBe("LOSE");
        }
    });

    it("ack mutation rejects a mismatched head (stack item / choice id)", () => {
        const state = blockingYdwen(LOSE_SEED);
        const head = state.pendingChoices![0];
        expect(() =>
            applyRandomRevealAck(state, {
                playerId: head.playerId,
                stackItemId: "wrong",
                choiceId: head.choiceId,
            })
        ).toThrow();
        // Unchanged: still suspended.
        expect(state.pendingChoices![0].kind).toBe("random-reveal");
        // Sanity: ack resumes only on the correct identity.
        ack(state);
        const y = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "ydwen"
        )!;
        expect(y.isBlocking).toBeFalsy();
    });

    it("can't block this turn is enforced by validateBlockerEligibility (CR 509.1b)", () => {
        const state = blockingYdwen(LOSE_SEED);
        ack(state);
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        const newAttacker = makeInstance(grizzlyBears.id, {
            id: "atk2",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const result = validateBlockerEligibility(
            newAttacker,
            y,
            state.players[1].battlefield,
            state
        );
        expect(result.eligible).toBe(false);
    });
});
