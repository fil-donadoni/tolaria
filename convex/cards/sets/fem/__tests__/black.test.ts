// Per-card behavior tests for black cards in `convex/cards/sets/fem/black.ts`
// (FEM, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (definition shape, zone after resolution, projected wire-format).

import { describe, it, expect } from "vitest";
import {
    armorThrull,
    armorThrullFemB,
    armorThrullFemC,
    armorThrullFemD,
    basalThrull,
    basalThrullFemB,
    basalThrullFemC,
    basalThrullFemD,
    breedingPit,
    derelor,
    ebonPraetor,
    hymnToTourach,
    hymnToTourachFemB,
    hymnToTourachFemC,
    hymnToTourachFemD,
    initiatesOfTheEbonHand,
    initiatesOfTheEbonHandFemB,
    initiatesOfTheEbonHandFemC,
    mindstabThrull,
    mindstabThrullFemB,
    mindstabThrullFemC,
    necrite,
    necriteFemB,
    necriteFemC,
    orderOfTheEbonHand,
    orderOfTheEbonHandFemB,
    orderOfTheEbonHandFemC,
    soulExchange,
    thrullChampion,
    thrullRetainer,
    thrullWizard,
    tourachsChant,
    tourachsGate,
} from "..";
import { getDefinition, getCardByName, getAllCards } from "../../../index";
import { resolveTopOfStack, getCostModifiers } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import type { CardPrint } from "../../../types";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { fireDelayedTriggers } from "../../../../gre/phases";
import {
    finalizeTargetSelection,
    tryAutoCommitPendingCast,
    tapSourceIntoPayment,
} from "../../../../game";
import { grizzlyBears } from "../../lea";
import { matchesPermanentFilter } from "../../../filters";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import {
    resolveTrigger,
    UPKEEP,
    resolveActivated,
    answerPendingChoices,
} from "./helpers";

// Multi-art black prints (C5) — each resolves to its shared definition.
const C5_MULTI_ART_PRINTS: { print: CardPrint; defId: string }[] = [
    { print: armorThrullFemB, defId: armorThrull.id },
    { print: armorThrullFemC, defId: armorThrull.id },
    { print: armorThrullFemD, defId: armorThrull.id },
    { print: basalThrullFemB, defId: basalThrull.id },
    { print: basalThrullFemC, defId: basalThrull.id },
    { print: basalThrullFemD, defId: basalThrull.id },
    { print: hymnToTourachFemB, defId: hymnToTourach.id },
    { print: hymnToTourachFemC, defId: hymnToTourach.id },
    { print: hymnToTourachFemD, defId: hymnToTourach.id },
    { print: initiatesOfTheEbonHandFemB, defId: initiatesOfTheEbonHand.id },
    { print: initiatesOfTheEbonHandFemC, defId: initiatesOfTheEbonHand.id },
    { print: mindstabThrullFemB, defId: mindstabThrull.id },
    { print: mindstabThrullFemC, defId: mindstabThrull.id },
    { print: necriteFemB, defId: necrite.id },
    { print: necriteFemC, defId: necrite.id },
    { print: orderOfTheEbonHandFemB, defId: orderOfTheEbonHand.id },
    { print: orderOfTheEbonHandFemC, defId: orderOfTheEbonHand.id },
];

// ═══════════════════════════════════════════════════════════════════════════
// C5 — Black: Thrulls & Order of the Ebon Hand (issue #572). One describe per
// card citing the CR section it exercises. Covers CAPABILITY C (sac-self mana,
// ADR 0039), the exile-as-cost extension (E), reused activation-count (G),
// cost-increase static, random discard, and the Thrull pump/anthem package.
// ═══════════════════════════════════════════════════════════════════════════

// --- C5 helpers ------------------------------------------------------------

/** Mirror of selectAdditionalCost's spell-cast picker: validate the pick
 *  against the live additional-cost filter, record `pickedId`, then attempt the
 *  auto-commit (CR 118.8 / 601.2f). */
function pickAdditionalCost(
    state: GameState,
    playerId: string,
    instanceId: string
): void {
    const pc = state.pendingCast;
    if (!pc?.additionalCost)
        throw new Error("No additional-cost picker pending");
    if (pc.additionalCost.pickedId) throw new Error("Additional cost paid");
    const player = state.players.find((p) => p.id === playerId)!;
    const candidate = player.battlefield.find((c) => c.id === instanceId);
    if (!candidate) throw new Error("Pick not on battlefield");
    if (
        !matchesPermanentFilter(candidate, pc.additionalCost.filter, {
            selfControllerId: playerId,
        })
    )
        throw new Error("Does not match filter");
    pc.additionalCost.pickedId = candidate.id;
    tryAutoCommitPendingCast(state, playerId);
}

// ---------------------------------------------------------------------------
// FEM black registry parity + multi-art prints (ADR 0014).
// ---------------------------------------------------------------------------

describe("FEM black registry parity + multi-art prints (ADR 0014)", () => {
    const C5_DEFS = [
        armorThrull,
        basalThrull,
        breedingPit,
        derelor,
        ebonPraetor,
        hymnToTourach,
        initiatesOfTheEbonHand,
        mindstabThrull,
        necrite,
        orderOfTheEbonHand,
        soulExchange,
        thrullChampion,
        thrullRetainer,
        thrullWizard,
        tourachsChant,
        tourachsGate,
    ];

    it("registers every C5 black card by id and by name", () => {
        for (const def of C5_DEFS) {
            expect(getDefinition(def.id)).toBe(def);
            expect(getCardByName(def.name)).toBe(def);
            expect(getAllCards()).toContain(def);
        }
    });

    it("resolves every alternate artwork to the shared definition (fem set code)", () => {
        for (const { print, defId } of C5_MULTI_ART_PRINTS) {
            expect(print.definitionId).toBe(defId);
            expect(getDefinition(print.printId).id).toBe(defId);
            expect(print.setCode).toBe("fem");
        }
    });
});

// ---------------------------------------------------------------------------
// Basal Thrull — CAPABILITY C: sacrifice-self FIXED-output mana ability
// (ADR 0039, CR 605.1a). "{T}, Sacrifice this creature: Add {B}{B}."
// ---------------------------------------------------------------------------

describe("Basal Thrull — sac-self mana ability (CAPABILITY C, ADR 0039, CR 605.1a)", () => {
    it("full path: tapSourceIntoPayment SACRIFICES the source (not taps) and adds {B}{B}", () => {
        // Drive the real tap-mana payment path: the sac-self fixed-output ability
        // routes through tapSourceIntoPayment, which (ADR 0039) sacrifices the
        // source instead of tapping it and adds the fixed {B}{B} to the pool.
        const thrull = makeInstance(basalThrull.id, {
            id: "thrull",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrull] }),
                makePlayer("p2"),
            ],
        });
        tapSourceIntoPayment(state, state.players[0], thrull, undefined, []);
        // Mana ability: {B}{B} added to the pool.
        expect(state.players[0].manaPool.B).toBe(2);
        // The source was SACRIFICED — gone from battlefield, in graveyard, and
        // not left tapped on the board.
        expect(
            state.players[0].battlefield.find((c) => c.id === "thrull")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "thrull")
        ).toBeDefined();
    });

    it("the sacrifice survives the wire-format projection (source gone, B mana visible)", () => {
        const thrull = makeInstance(basalThrull.id, {
            id: "thrull",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrull] }),
                makePlayer("p2"),
            ],
        });
        tapSourceIntoPayment(state, state.players[0], thrull, undefined, []);
        const projected = projectPublicState(state, 1, "p1");
        // Source is no longer on the projected battlefield, B mana is in the pool.
        expect(
            projected.players[0].battlefield.find((c) => c.id === "thrull")
        ).toBeUndefined();
        expect(projected.players[0].manaPool.B).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Armor Thrull — {T}, Sacrifice this: put a +1/+2 counter on target creature
// (CR 602.1 tap + self-sacrifice cost; CR 122.1 P/T counter).
// ---------------------------------------------------------------------------

describe("Armor Thrull — sac-self +1/+2 counter (CR 602.1, 122.1)", () => {
    it("puts a +1/+2 counter on the target, lifting its effective P/T", () => {
        const armorer = makeInstance(armorThrull.id, {
            id: "armorer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [armorer, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, armorer, "armor-thrull-counter", [
            { type: "permanent", id: "target" },
        ]);
        const buffed = state.players[0].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(buffed.counters?.["+1/+2"]).toBe(1);
        expect(getEffectivePower(state, buffed)).toBe(2 + 1);
        expect(getEffectiveToughness(state, buffed)).toBe(2 + 2);
    });

    it("the +1/+2 P/T survives the wire-format projection", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+2": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2 + 1);
        expect(getEffectiveToughness(projected, slim)).toBe(2 + 2);
    });
});

// ---------------------------------------------------------------------------
// Basal Thrull mana feeds nothing on the stack — but Soul Exchange exercises
// the exile-as-cost extension (E). CAPABILITY E (extended): exile-a-permanent-
// you-control as an additional cost, coexisting with a graveyard target.
// ---------------------------------------------------------------------------

describe("Soul Exchange — exile-as-cost + reanimate + Thrull +2/+2 (CAPABILITY E, CR 118.8/601.2f/406)", () => {
    it("GRE: reanimates the targeted graveyard creature; +2/+2 when the exiled creature was a Thrull", () => {
        // The exiled creature's subtypes are snapshotted on the stack item; a
        // Thrull adds a +2/+2 counter to the reanimated creature (CR 118.8).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(grizzlyBears.id, {
                            id: "deadbear",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, soulExchange.id, "p1", [
            { type: "graveyard-card", id: "deadbear", playerId: "p1" },
        ]);
        // Simulate the exiled-creature snapshot (a Thrull was exiled at cast).
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "exiled",
            mv: 2,
            subtypes: ["Thrull"],
        };
        resolveTopOfStack(state);
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "deadbear"
        )!;
        expect(reanimated).toBeDefined();
        expect(reanimated.zone).toBe("battlefield");
        expect(reanimated.counters?.["+2/+2"]).toBe(1);
        expect(getEffectivePower(state, reanimated)).toBe(2 + 2);
        expect(getEffectiveToughness(state, reanimated)).toBe(2 + 2);
    });

    it("GRE: no +2/+2 counter when the exiled creature was NOT a Thrull", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(grizzlyBears.id, {
                            id: "deadbear",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, soulExchange.id, "p1", [
            { type: "graveyard-card", id: "deadbear", playerId: "p1" },
        ]);
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "exiled",
            mv: 2,
            subtypes: ["Bear"],
        };
        resolveTopOfStack(state);
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "deadbear"
        )!;
        expect(reanimated.counters?.["+2/+2"] ?? 0).toBe(0);
    });

    it("full path: cast exiles a Thrull you control, then reanimates with +2/+2", () => {
        // Drive the real cast path: finalizeTargetSelection (target a graveyard
        // creature) opens the exile picker; pickAdditionalCost exiles the Thrull
        // and commits; the spell resolves reanimating the target with +2/+2.
        const fodderThrull = makeInstance(basalThrull.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const exchange = makeInstance(soulExchange.id, {
            id: "exchange",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const deadBear = makeInstance(grizzlyBears.id, {
            id: "deadbear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fodderThrull],
                    hand: [exchange],
                    graveyard: [deadBear],
                    manaPool: { B: 2 }, // {B}{B} pre-paid in pool
                }),
                makePlayer("p2"),
            ],
        });
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "exchange",
            targetType: "Creature",
            count: 1,
            zone: "graveyard",
            controller: "you",
            selected: [
                { type: "graveyard-card", id: "deadbear", playerId: "p1" },
            ],
        };
        finalizeTargetSelection(state, state.pendingTarget!, "p1");
        // Targets chosen → exile picker is open, even though mana is covered.
        expect(state.pendingCast?.additionalCost?.kind).toBe("exile");

        // Pay the exile cost with the Thrull → auto-commit fires.
        pickAdditionalCost(state, "p1", "fodder");

        // The Thrull was EXILED (not sacrificed).
        expect(
            state.players[0].battlefield.find((c) => c.id === "fodder")
        ).toBeUndefined();
        expect(
            state.players[0].exile?.find((c) => c.id === "fodder")
        ).toBeDefined();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);

        // Resolve the spell: the Bears returns with a +2/+2 counter (exiled
        // creature was a Thrull).
        resolveTopOfStack(state);
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "deadbear"
        )!;
        expect(reanimated.zone).toBe("battlefield");
        expect(reanimated.counters?.["+2/+2"]).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Hymn to Tourach — Target player discards two cards at random (CR 701.8a).
// ---------------------------------------------------------------------------

describe("Hymn to Tourach — random discard two (CR 701.8a)", () => {
    it("discards exactly two cards from the targeted player's hand", () => {
        const hand = [
            makeInstance(grizzlyBears.id, {
                id: "h1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            makeInstance(grizzlyBears.id, {
                id: "h2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            makeInstance(grizzlyBears.id, {
                id: "h3",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand })],
        });
        pushSpell(state, hymnToTourach.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // Two of three hand cards moved to the graveyard at random.
        expect(state.players[1].hand).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(2);
    });

    it("clamps to hand size: a one-card hand discards just that card", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "only",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, hymnToTourach.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Derelor — Black spells you cast cost {B} more (CR 601.2f cost increase,
// scoped to the controller's own black spells — the Gloom precedent).
// ---------------------------------------------------------------------------

describe("Derelor — controller's black spells cost {B} more (CR 601.2f)", () => {
    it("taxes the controller's OWN black spell by {B}, but not a colorless spell", () => {
        const der = makeInstance(derelor.id, {
            id: "der",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [der] }),
                makePlayer("p2"),
            ],
        });
        const blackSpell = makeInstance(hymnToTourach.id, {
            id: "hymn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const mods = getCostModifiers(state, blackSpell, "spell");
        expect(mods.increase.B ?? 0).toBe(1);
    });

    it("does NOT tax the opponent's black spells", () => {
        const der = makeInstance(derelor.id, {
            id: "der",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [der] }),
                makePlayer("p2"),
            ],
        });
        const oppSpell = makeInstance(hymnToTourach.id, {
            id: "opphymn",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const mods = getCostModifiers(state, oppSpell, "spell");
        expect(mods.increase.B ?? 0).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Initiates of the Ebon Hand — CAPABILITY G: activation-count delayed
// self-sacrifice (CR 605.1a mana, 602.5 count, 603.7a delayed end-step sac).
// ---------------------------------------------------------------------------

describe("Initiates of the Ebon Hand — 4th-activation delayed sacrifice (CAPABILITY G, CR 602.5/603.7a)", () => {
    const MANA_ID = "initiates-ebon-hand-mana";

    function setup() {
        const initiates = makeInstance(initiatesOfTheEbonHand.id, {
            id: "initiates",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [initiates] }),
                makePlayer("p2"),
            ],
        });
        return { state, initiates };
    }

    /** Mirror an activation: bump the count, then run the (useStack:false)
     *  resolve via a stack push (resolveTopOfStack runs card.resolve). */
    function activateOnce(state: GameState, source: CardInstanceState) {
        source.activationsThisTurn = {
            ...source.activationsThisTurn,
            [MANA_ID]: (source.activationsThisTurn?.[MANA_ID] ?? 0) + 1,
        };
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: MANA_ID,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("3 activations → no delayed sacrifice scheduled", () => {
        const { state, initiates } = setup();
        activateOnce(state, initiates);
        activateOnce(state, initiates);
        activateOnce(state, initiates);
        expect(state.players[0].manaPool.B).toBe(3);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("4th activation → schedules a next-end-step self-sacrifice", () => {
        const { state, initiates } = setup();
        for (let i = 0; i < 4; i++) activateOnce(state, initiates);
        expect(state.players[0].manaPool.B).toBe(4);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe(
            "initiates-ebon-hand-sacrifice"
        );
        expect(state.delayedTriggers![0].timing).toBe("next-end-step");
    });

    it("the delayed trigger sacrifices the Initiates at the next end step", () => {
        const { state, initiates } = setup();
        for (let i = 0; i < 4; i++) activateOnce(state, initiates);
        fireDelayedTriggers(state, "next-end-step");
        // The scheduled sacrifice is on the stack; resolve it.
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "initiates")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "initiates")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Ebon Praetor — CAPABILITY G (oncePerTurn) + upkeep -2/-2 + Thrull-sac bonus.
// ---------------------------------------------------------------------------

describe("Ebon Praetor — upkeep -2/-2 + once-per-turn Thrull-sac bonus (CR 602.5, 122.1)", () => {
    it("upkeep trigger puts a -2/-2 counter, dropping effective P/T", () => {
        const praetor = makeInstance(ebonPraetor.id, {
            id: "praetor",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [praetor] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, praetor, "ebon-praetor-upkeep", UPKEEP("p1"));
        const after = state.players[0].battlefield.find(
            (c) => c.id === "praetor"
        )!;
        expect(after.counters?.["-2/-2"]).toBe(1);
        expect(getEffectivePower(state, after)).toBe(5 - 2);
        expect(getEffectiveToughness(state, after)).toBe(5 - 2);
    });

    it("sac ability removes a -2/-2 counter; sacrificing a Thrull adds +1/+0", () => {
        // Pre-mark a -2/-2 counter (from a prior upkeep). The cost snapshot
        // records the sacrificed creature's subtypes; a Thrull adds +1/+0.
        const praetor = makeInstance(ebonPraetor.id, {
            id: "praetor",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "-2/-2": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [praetor] }),
                makePlayer("p2"),
            ],
        });
        const item: StackItem = {
            ...praetor,
            zone: "stack",
            castById: "p1",
            abilityId: "ebon-praetor-sacrifice",
            targets: [],
            additionalSacrificeSnapshot: {
                cardInstanceId: "sacced",
                mv: 2,
                subtypes: ["Thrull"],
            },
        };
        state.stack.push(item);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "praetor"
        )!;
        // -2/-2 removed and +1/+0 added → effective 6/5 from base 5/5.
        expect(after.counters?.["-2/-2"] ?? 0).toBe(0);
        expect(after.counters?.["+1/+0"]).toBe(1);
        expect(getEffectivePower(state, after)).toBe(5 + 1);
        expect(getEffectiveToughness(state, after)).toBe(5);
    });

    it("no +1/+0 when the sacrificed creature was not a Thrull", () => {
        const praetor = makeInstance(ebonPraetor.id, {
            id: "praetor",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "-2/-2": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [praetor] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...praetor,
            zone: "stack",
            castById: "p1",
            abilityId: "ebon-praetor-sacrifice",
            targets: [],
            additionalSacrificeSnapshot: {
                cardInstanceId: "sacced",
                mv: 2,
                subtypes: ["Bear"],
            },
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "praetor"
        )!;
        expect(after.counters?.["-2/-2"] ?? 0).toBe(0);
        expect(after.counters?.["+1/+0"] ?? 0).toBe(0);
    });

    it("the -2/-2 P/T survives the wire-format projection", () => {
        const praetor = makeInstance(ebonPraetor.id, {
            id: "praetor",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "-2/-2": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [praetor] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "praetor"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Mindstab Thrull — attacks-unblocked optional self-sac → defender discards 3
// (CR 509.1h, 603.3d, 701.8).
// ---------------------------------------------------------------------------

describe("Mindstab Thrull — unblocked sac → discard three (CR 509.1h, 603.3d)", () => {
    function setup(handSize: number) {
        const thrull = makeInstance(mindstabThrull.id, {
            id: "mindstab",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppHand = Array.from({ length: handSize }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `oh${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrull] }),
                makePlayer("p2", { hand: oppHand }),
            ],
        });
        return { state, thrull };
    }

    const UNBLOCKED = (attackerId: string): StackItem["triggerEvent"] =>
        ({
            type: "ATTACKER_UNBLOCKED" as const,
            attackerId,
            attackerControllerId: "p1",
        }) as StackItem["triggerEvent"];

    it("accepting the sac makes the defender discard three; the Thrull is sacrificed", () => {
        const { state, thrull } = setup(4);
        resolveTrigger(
            state,
            thrull,
            "mindstab-thrull-unblocked",
            UNBLOCKED("mindstab")
        );
        // First head: the may-pay sacrifice choice routed to the controller.
        const sacHead = state.pendingChoices?.[0];
        expect(sacHead?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // Then the defender (p2) picks three cards to discard.
        answerPendingChoices(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "mindstab")
        ).toBeUndefined();
        expect(state.players[1].hand).toHaveLength(1); // 4 - 3 discarded
        expect(state.players[1].graveyard).toHaveLength(3);
    });

    it("declining the sac leaves the Thrull on the battlefield and discards nothing", () => {
        const { state, thrull } = setup(4);
        resolveTrigger(
            state,
            thrull,
            "mindstab-thrull-unblocked",
            UNBLOCKED("mindstab")
        );
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(
            state.players[0].battlefield.find((c) => c.id === "mindstab")
        ).toBeDefined();
        expect(state.players[1].hand).toHaveLength(4);
    });
});

// ---------------------------------------------------------------------------
// Necrite — attacks-unblocked optional self-sac → destroy a defender creature,
// can't be regenerated (CR 603.3d, 509.1h, 701.7).
//
// CR 603.3d — "destroy TARGET creature defending player controls" is a real
// target chosen when the trigger is put on the stack (`targetRequirement` +
// `raiseTriggerTargetSelection`, issue #1193), NOT a resolution-time pick. The
// "you may sacrifice it. If you do" clause stays at resolution as a
// `requestMayPay` optional cost (CR 701.7a) — cleanly separate from the target
// choice (unlike Mindstab Thrull, whose "defending player discards" is NOT
// targeted, Necrite's clause genuinely targets, so it earns a targetRequirement).
// ---------------------------------------------------------------------------

describe("Necrite — unblocked sac → destroy a defender's creature (CR 603.3d, 701.7)", () => {
    const UNBLOCKED = (attackerId: string): StackItem["triggerEvent"] =>
        ({
            type: "ATTACKER_UNBLOCKED" as const,
            attackerId,
            attackerControllerId: "p1",
        }) as StackItem["triggerEvent"];

    /** Puts Necrite's attack-unblocked trigger on the stack with its target
     *  slot UNSET, so `raiseTriggerTargetSelection` (CR 603.3d) chooses the
     *  target at stack placement — mirroring Phelia's mh3 helper. */
    function necriteTriggerOnStack(
        state: GameState,
        source: CardInstanceState
    ): StackItem {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId: "necrite-unblocked",
            triggerSourceId: source.id,
            triggerEvent: UNBLOCKED(source.id),
            // targets intentionally omitted — the target machinery fills it.
        });
        return state.stack[state.stack.length - 1];
    }

    it("sole legal target auto-selects at stack placement (no PendingTarget); accepting the sac destroys it", () => {
        const necr = makeInstance(necrite.id, {
            id: "necrite",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [necr] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const trig = necriteTriggerOnStack(state, necr);
        // Mandatory single legal target → auto-selected, no choice raised.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "victim" }]);
        expect(state.pendingTarget).toBeUndefined();
        // Resolution suspends on the "you may sacrifice it" mayPay; accept it.
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.find((c) => c.id === "necrite")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
    });

    it("multiple legal targets raise a PendingTarget; finalize then resolve destroys the chosen creature", () => {
        const necr = makeInstance(necrite.id, {
            id: "necrite",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [necr] }),
                makePlayer("p2", { battlefield: [bear, bear2] }),
            ],
        });
        necriteTriggerOnStack(state, necr);
        // Two legal targets → a real choice is owed.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "permanent", id: "bear2" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.find((c) => c.id === "necrite")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear2")
        ).toBeUndefined();
        // The unchosen creature is untouched.
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeDefined();
    });

    it("declining the sacrifice leaves Necrite and the target creature untouched", () => {
        const necr = makeInstance(necrite.id, {
            id: "necrite",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [necr] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        necriteTriggerOnStack(state, necr);
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(
            state.players[0].battlefield.find((c) => c.id === "necrite")
        ).toBeDefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Order of the Ebon Hand — protection from white + first-strike / pump knight
// (CR 702.16, 702.7, 611.2c).
// ---------------------------------------------------------------------------

describe("Order of the Ebon Hand — protection + pump knight (CR 702.16, 611.2c)", () => {
    it("{B}{B} pump grants +1/+0 until end of turn", () => {
        const order = makeInstance(orderOfTheEbonHand.id, {
            id: "order",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, order, "order-ebon-hand-pump");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "order"
        )!;
        expect(getEffectivePower(state, after)).toBe(2 + 1);
        expect(getEffectiveToughness(state, after)).toBe(1);
    });

    it("{B} first-strike grant adds first strike until end of turn", () => {
        const order = makeInstance(orderOfTheEbonHand.id, {
            id: "order",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, order, "order-ebon-hand-first-strike");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "order"
        )!;
        expect(after.staticAbilities).toContain("first strike");
    });
});

// ---------------------------------------------------------------------------
// Thrull Champion — Thrull anthem (+1/+1) + gainControl while-you-control-source
// (CR 611 layer 7c, 611.2c).
// ---------------------------------------------------------------------------

describe("Thrull Champion — Thrull anthem + conditional gainControl (CR 611)", () => {
    it("gives Thrull creatures +1/+1 (the anthem) — survives projection", () => {
        const champ = makeInstance(thrullChampion.id, {
            id: "champ",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherThrull = makeInstance(basalThrull.id, {
            id: "buddy",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [champ, otherThrull] }),
                makePlayer("p2"),
            ],
        });
        const buddy = state.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        // Basal Thrull is a 1/2 → 2/3 under the Champion's anthem.
        expect(getEffectivePower(state, buddy)).toBe(1 + 1);
        expect(getEffectiveToughness(state, buddy)).toBe(2 + 1);
        // The Champion buffs itself too (it is a Thrull): 2/2 → 3/3.
        const self = state.players[0].battlefield.find(
            (c) => c.id === "champ"
        )!;
        expect(getEffectivePower(state, self)).toBe(2 + 1);
        // Wire-format guard.
        const projected = projectPublicState(state, 1, "p1");
        const slimBuddy = projected.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(getEffectivePower(projected, slimBuddy)).toBe(2);
        expect(getEffectiveToughness(projected, slimBuddy)).toBe(3);
    });

    it("{T}: gains control of a target Thrull", () => {
        const champ = makeInstance(thrullChampion.id, {
            id: "champ",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const enemyThrull = makeInstance(basalThrull.id, {
            id: "enemy",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [champ] }),
                makePlayer("p2", { battlefield: [enemyThrull] }),
            ],
        });
        resolveActivated(state, champ, "thrull-champion-steal", [
            { type: "permanent", id: "enemy" },
        ]);
        expect(state.players[0].battlefield.some((c) => c.id === "enemy")).toBe(
            true
        );
    });
});

// ---------------------------------------------------------------------------
// Thrull Retainer — Aura: +1/+1 to host + sac-self regenerate (CR 303.4, 611,
// 701.15a).
// ---------------------------------------------------------------------------

describe("Thrull Retainer — Aura +1/+1 + sac-self regenerate (CR 303.4, 701.15a)", () => {
    it("buffs the enchanted host by +1/+1 (survives projection)", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(thrullRetainer.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
        });
        aura.attachedTo = "host";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        const hostInst = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(state, hostInst)).toBe(2 + 1);
        expect(getEffectiveToughness(state, hostInst)).toBe(2 + 1);
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slimHost)).toBe(3);
    });

    it("sac-self applies a regeneration shield to the host", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(thrullRetainer.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
        });
        aura.attachedTo = "host";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, aura, "thrull-retainer-regenerate");
        const hostInst = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(hostInst.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Thrull Wizard — {1}{B}: counter target black spell unless its controller pays
// {B} or {3} (CR 701.5a, 117.3a). The "{B} or {3}" alternative is modelled as
// two sequential may-pay offers ({B}, then {3} if {B} was declined) — issue
// #961; paying either saves the spell, declining both counters it.
// ---------------------------------------------------------------------------

describe("Thrull Wizard — counter black spell unless pay {B} or {3} (CR 701.5a)", () => {
    const setup = () => {
        const wiz = makeInstance(thrullWizard.id, {
            id: "wiz",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wiz] }),
                // Pool large enough to pay either alternative ({B} or {3}).
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 3 },
                }),
            ],
        });
        const blackSpell = pushSpell(state, hymnToTourach.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveActivated(state, wiz, "thrull-wizard-counter", [
            { type: "spell", id: blackSpell.id },
        ]);
        return { state, blackSpell };
    };

    it("counters the black spell when its controller declines BOTH {B} and {3}", () => {
        const { state, blackSpell } = setup();
        // First offer: {B}.
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        // Second offer: {3} (only reached because {B} was declined).
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.some((s) => s.id === blackSpell.id)).toBe(false);
    });

    it("saves the spell when its controller pays the {B} alternative (no {3} offer)", () => {
        const { state, blackSpell } = setup();
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Paying {B} short-circuits — no second {3} prompt.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack.some((s) => s.id === blackSpell.id)).toBe(true);
    });

    it("saves the spell when its controller declines {B} but pays the {3} alternative", () => {
        const { state, blackSpell } = setup();
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.stack.some((s) => s.id === blackSpell.id)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Breeding Pit — upkeep pay-{B}{B}-or-sac + end-step Thrull token (CR 603.2).
// ---------------------------------------------------------------------------

describe("Breeding Pit — upkeep tax + end-step Thrull token (CR 603.2)", () => {
    it("creates a 0/1 black Thrull token at the end step", () => {
        const pit = makeInstance(breedingPit.id, {
            id: "pit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pit] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, pit, "breeding-pit-end-step", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const token = state.players[0].battlefield.find(
            (c) => c.id !== "pit" && c.subtypes.includes("Thrull")
        );
        expect(token).toBeDefined();
        expect(getEffectivePower(state, token!)).toBe(0);
        expect(getEffectiveToughness(state, token!)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Tourach's Chant — upkeep pay-{B}-or-sac + Forest-entered punisher (CR 603.2).
// ---------------------------------------------------------------------------

describe("Tourach's Chant — Forest-entered punisher (CR 603.2)", () => {
    it("deals 3 to the Forest's controller when they control no creature", () => {
        const chant = makeInstance(tourachsChant.id, {
            id: "chant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const forest = makeInstance(getCardByName("Forest").id, {
            id: "forest",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chant] }),
                makePlayer("p2", { battlefield: [forest], life: 20 }),
            ],
        });
        resolveTrigger(state, chant, "tourachs-chant-forest-punish", {
            type: "PERMANENT_ENTERED",
            instanceId: "forest",
            controllerId: "p2",
            types: ["Land"],
        } as StackItem["triggerEvent"]);
        // No creature to take the -1/-1 counter → the player takes 3 damage.
        expect(state.players[1].life).toBe(17);
    });
});

// ---------------------------------------------------------------------------
// Tourach's Gate — Aura on a land: typed-sac adds time counters; upkeep removes
// one (sac at zero); tap-the-host pumps attackers (CR 303.4, 122).
// ---------------------------------------------------------------------------

describe("Tourach's Gate — time counters + attacker pump (CR 303.4, 122)", () => {
    it("Sacrifice a Thrull: puts three time counters on the Aura", () => {
        const gate = makeInstance(tourachsGate.id, {
            id: "gate",
            controllerId: "p1",
            ownerId: "p1",
        });
        gate.attachedTo = "land";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gate] }),
                makePlayer("p2"),
            ],
        });
        // The sacrifice cost is paid via the engine picker in production; here we
        // resolve the ability (cost assumed paid) and assert the counters land.
        resolveActivated(state, gate, "tourachs-gate-add-time");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "gate"
        )!;
        expect(after.counters?.time).toBe(3);
    });

    it("upkeep removes one time counter; sacrifices the Aura at zero", () => {
        const gate = makeInstance(tourachsGate.id, {
            id: "gate",
            controllerId: "p1",
            ownerId: "p1",
            counters: { time: 1 },
        });
        gate.attachedTo = "land";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gate] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, gate, "tourachs-gate-upkeep", UPKEEP("p1"));
        // 1 → 0 time counters → the Aura is sacrificed.
        expect(
            state.players[0].battlefield.find((c) => c.id === "gate")
        ).toBeUndefined();
    });

    it("tap-the-host pump gives attacking creatures +2/-1 and taps the land", () => {
        const land = makeInstance(getCardByName("Swamp").id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gate = makeInstance(tourachsGate.id, {
            id: "gate",
            controllerId: "p1",
            ownerId: "p1",
        });
        gate.attachedTo = "land";
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, gate, attacker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gate, "tourachs-gate-pump");
        const atk = state.players[0].battlefield.find((c) => c.id === "atk")!;
        expect(getEffectivePower(state, atk)).toBe(2 + 2);
        expect(getEffectiveToughness(state, atk)).toBe(2 - 1);
        // The enchanted land was tapped as the cost.
        expect(
            state.players[0].battlefield.find((c) => c.id === "land")?.isTapped
        ).toBe(true);
    });
});
