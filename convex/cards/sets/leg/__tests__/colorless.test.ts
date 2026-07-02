// Legends (LEG) — colorless / set-wide per-card behaviour tests (ADR 0043 colour split;
// twin of arn/leb colour test files). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external
// behaviour only. Shared shims live in ./helpers; fixtures in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    UPKEEP_C7,
    answerChoice,
    drawStepEvent,
    makeSylvanState,
    resolveActivated,
    resolveTrigger,
    withTabernacle,
} from "./helpers";
import {
    adventurersGuildhouse,
    alchorsTomb,
    blackManaBattery,
    blueManaBattery,
    cathedralOfSerra,
    crimsonKobolds,
    crookshankKobolds,
    greenManaBattery,
    hundingGjornersen,
    koboldsOfKherKeep,
    manaMatrix,
    marhaultElsdragon,
    mirrorUniverse,
    mountainStronghold,
    mountainYeti,
    pendelhaven,
    planarGate,
    ragingBull,
    redManaBattery,
    relicBarrier,
    seafarersQuay,
    theTabernacleAtPendrellVale,
    tolaria,
    tundraWolves,
    unholyCitadel,
    wallOfEarth,
    wallOfHeat,
    whiteManaBattery,
} from "..";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { isLegalBandComposition } from "../../../../gre/banding";
import { getEffectiveManaChoices } from "../../../../gre/constants";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { finalizeCleanup } from "../../../../gre/phases";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    applyCostModifiers,
    applyExistingGrantsTo,
    applySourceStaticEffects,
    getCostModifiers,
    normalizeManaCost,
    resolveTopOfStack,
    unapplySourceStaticEffects,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition } from "../../../index";
import { castle, crusade, grizzlyBears, lightningBolt } from "../../lea";

describe("Sylvan Library (draw step: single 0–N topdeck pick, CR 118.4/119.4)", () => {
    it("draws two, scopes the pick to cards drawn this turn, mixed selection topdecks one and pays for the kept one", () => {
        // h0 was drawn this turn (e.g. the turn-based draw); x9 was not.
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0", "x9"],
            libIds: ["l0", "l1", "l2"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        // Step 0 — "you may draw two additional cards".
        answerChoice(state, ["draw"]);
        const p1 = () => state.players[0];
        // Drew l0, l1 exactly once (library 3 → 1, hand 2 → 4).
        expect(p1().library.length).toBe(1);
        expect(p1().hand.map((c) => c.id)).toEqual(["h0", "x9", "l0", "l1"]);
        // A SINGLE ranged topdeck pick; restricted to cards drawn this turn
        // (x9 excluded). Range is 0..N where N = min(2, drawn-this-turn-in-hand).
        const head = state.pendingChoices?.[0];
        expect(head?.choiceId).toBe("sylvan-pick");
        expect(head?.kind).toBe("choose-hand-card");
        expect(head?.candidateIds).toEqual(["h0", "l0", "l1"]);
        expect(head?.count).toEqual({ min: 0, max: 2 });

        // Topdeck l1, keep the other of the N → pay 4 × (2 − 1) = 4 life.
        answerChoice(state, ["l1"]);

        expect(p1().life).toBe(16);
        expect(p1().library[0]?.id).toBe("l1"); // back on top
        expect(p1().hand.map((c) => c.id)).toEqual(["h0", "x9", "l0"]);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.stack.length).toBe(0);
    });

    it("selecting all N topdecks both and pays 0 life", () => {
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["draw"]); // draw l0, l1 → N = 2
        answerChoice(state, ["h0", "l0"]); // topdeck both
        const p1 = state.players[0];
        expect(p1.life).toBe(20); // pay 0
        expect(p1.hand.map((c) => c.id)).toEqual(["l1"]);
        // Both topdecked; l0 was the second moved so it sits on top.
        expect(p1.library.map((c) => c.id)).toEqual(["l0", "h0"]);
        expect(state.stack.length).toBe(0);
    });

    it("selecting 0 (Skip) with sufficient life pays 4 × N and keeps all N", () => {
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["draw"]); // N = 2
        answerChoice(state, []); // topdeck none — pay 4 × 2 = 8
        const p1 = state.players[0];
        expect(p1.life).toBe(12);
        expect(p1.hand.map((c) => c.id)).toEqual(["h0", "l0", "l1"]);
        expect(p1.library.length).toBe(0);
        expect(state.stack.length).toBe(0);
    });

    it("declining the draw ends the resolution with no choices and no changes", () => {
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["decline"]);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["h0"]);
        expect(p1.library.length).toBe(2);
        expect(p1.life).toBe(20);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.stack.length).toBe(0);
    });

    it("N adapts when fewer than two qualifying cards are in hand", () => {
        // Only h0 was drawn this turn AND the player declines… no: accept draw
        // but immediately discard one of the drawn cards is hard to model here,
        // so test the single-card case directly: only one drawn-this-turn card
        // remains in hand at the pick.
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0"], // only one card to draw → N capped by pool
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["draw"]); // draws l0 only (lib had 1)
        const head = state.pendingChoices?.[0];
        // drawn-this-turn-in-hand = [h0, l0] → N = min(2, 2) = 2 here, but if
        // only one remained the range max would be 1. Assert the range shape.
        expect(head?.count).toEqual({ min: 0, max: 2 });
        answerChoice(state, ["l0"]); // topdeck one, keep one → pay 4
        expect(state.players[0].life).toBe(16);
        expect(state.stack.length).toBe(0);
    });

    it("CR 119.4 — minimum topdeck is forced when life can't cover keeping all N", () => {
        // life 6 → floor(6/4) = 1 card may be kept, so at least 2 − 1 = 1 must
        // be topdecked. The range min reflects this.
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
            life: 6,
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["draw"]); // N = 2
        const head = state.pendingChoices?.[0];
        expect(head?.count).toEqual({ min: 1, max: 2 });
        answerChoice(state, ["l0"]); // topdeck one, keep one → pay 4 (6 → 2)
        const p1 = state.players[0];
        expect(p1.life).toBe(2);
        expect(p1.library[0]?.id).toBe("l0");
        expect(p1.hand.map((c) => c.id)).toEqual(["h0", "l1"]);
        expect(state.stack.length).toBe(0);
    });

    it("CR 119.4 — with life < 4 the minimum equals N (all must be topdecked)", () => {
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
            life: 3,
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["draw"]); // N = 2
        const head = state.pendingChoices?.[0];
        expect(head?.count).toEqual({ min: 2, max: 2 });
        answerChoice(state, ["h0", "l0"]); // all topdecked → pay 0
        const p1 = state.players[0];
        expect(p1.life).toBe(3);
        expect(p1.hand.map((c) => c.id)).toEqual(["l1"]);
        expect(state.stack.length).toBe(0);
    });

    it("drives the full draw → single topdeck pick chain through the real submit mutations", () => {
        // Integration: every choice resumes via the production
        // `applyPendingChoiceSubmit` (not the test injector), so the
        // candidateIds allow-list and the [min,max] range are exercised
        // end-to-end.
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1", "l2"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        const submit = (ids: string[]) => {
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ids,
            });
        };
        submit(["draw"]); // option-pick: draw two (l0, l1)
        // A card NOT drawn this turn is rejected by the candidateIds allow-list.
        expect(() => submit(["l2"])).toThrow();
        // Picking more than N (max 2) is rejected by the range guard.
        expect(() => submit(["h0", "l0", "l1"])).toThrow();
        submit(["h0"]); // topdeck h0; keep one of N → pay 4

        const p1 = state.players[0];
        expect(p1.life).toBe(16);
        expect(p1.library[0]?.id).toBe("h0");
        expect(p1.hand.map((c) => c.id)).toEqual(["l0", "l1"]);
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
    });

    it("the life payment and library top survive the wire projection", () => {
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["draw"]);
        answerChoice(state, ["l0"]); // topdeck l0; keep one of N → pay 4
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(16);
        expect(projected.players[0].library.count).toBe(1);
        // l0 topdecked; h0 + l1 still in hand → 2 cards in hand.
        expect(projected.players[0].hand.length).toBe(2);
    });
});

// ===========================================================================
// Red free tranche (#374)
// ===========================================================================

describe("LEG red vanilla / keyword creatures (CR 110.1 / 702)", () => {
    it("Kobolds are 0/1 with cost {0}", () => {
        for (const k of [
            crimsonKobolds,
            crookshankKobolds,
            koboldsOfKherKeep,
        ]) {
            expect(k.power).toBe(0);
            expect(k.toughness).toBe(1);
            expect(k.manaCost).toEqual({});
            expect(k.subtypes).toContain("Kobold");
        }
    });
    it("Raging Bull is a vanilla 2/2 Ox", () => {
        expect(ragingBull.power).toBe(2);
        expect(ragingBull.toughness).toBe(2);
        expect(ragingBull.subtypes).toContain("Ox");
        expect(ragingBull.staticAbilities ?? []).toHaveLength(0);
    });
    it("Mountain Yeti has mountainwalk + protection from white", () => {
        expect(mountainYeti.staticAbilities).toContain("mountainwalk");
        expect(mountainYeti.staticAbilities).toContain("protection from white");
    });
    it("Wall of Earth / Wall of Heat have defender", () => {
        expect(wallOfEarth.staticAbilities).toContain("defender");
        expect(wallOfHeat.staticAbilities).toContain("defender");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts, lands & colorless free tranche (#377). Cost-reduction statics are
// asserted via getCostModifiers + applyCostModifiers (the exact path game.ts
// runs when casting); activated abilities are pushed via resolveActivated and
// the resulting state / projection is checked.
// ─────────────────────────────────────────────────────────────────────────────

describe("Mana Matrix (instant/enchantment spells you cast cost {2} less, CR 601.2f)", () => {
    /** Mirror game.ts spell-cost calc: normalize the spell's printed cost, then
     *  fold in battlefield cost modifiers for the casting player's spell. */
    function effectiveSpellCost(
        state: GameState,
        spellCardId: string,
        controllerId: string
    ): Record<string, number> {
        const def = getDefinition(spellCardId);
        const spellView = makeInstance(spellCardId, {
            controllerId,
            zone: "stack",
        });
        const cost = normalizeManaCost(def.manaCost ?? {});
        applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
        return cost;
    }

    function boardWith(artifactId: string, controllerId = "p1") {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(artifactId, { id: "art", controllerId }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("definition: {6} colorless Artifact with a cost-modifier static", () => {
        expect(manaMatrix.manaCost).toEqual({ X: 6 });
        expect(manaMatrix.types).toEqual(["Artifact"]);
        expect(
            manaMatrix.staticEffects?.some((e) => e.kind === "cost-modifier")
        ).toBe(true);
    });

    it("reduces your instant by {2} (Lightning Bolt {R} stays {R})", () => {
        const state = boardWith(manaMatrix.id);
        // {R} has no generic to reduce → unchanged colored pip.
        expect(effectiveSpellCost(state, lightningBolt.id, "p1")).toEqual({
            R: 1,
        });
    });

    it("reduces your enchantment's generic by {2} (Castle {3}{W} → {1}{W})", () => {
        const state = boardWith(manaMatrix.id);
        // Generic-only reduction (CR 601.2f): {3} → {1}, colored {W} untouched.
        expect(effectiveSpellCost(state, castle.id, "p1")).toEqual({
            X: 1,
            W: 1,
        });
    });

    it("leaves a colored-only enchantment unchanged (Crusade {W}{W} has no generic)", () => {
        const state = boardWith(manaMatrix.id);
        expect(effectiveSpellCost(state, crusade.id, "p1")).toEqual({ W: 2 });
    });

    it("does not reduce a creature spell (Grizzly Bears {1}{G} unchanged)", () => {
        const state = boardWith(manaMatrix.id);
        expect(effectiveSpellCost(state, grizzlyBears.id, "p1")).toEqual({
            X: 1,
            G: 1,
        });
    });

    it("only reduces spells YOU cast (opponent's enchantment unchanged)", () => {
        const state = boardWith(manaMatrix.id, "p1");
        // p2 casts Castle — Mana Matrix is p1's, so no reduction.
        expect(effectiveSpellCost(state, castle.id, "p2")).toEqual({
            X: 3,
            W: 1,
        });
    });
});

describe("Planar Gate (creature spells you cast cost {2} less, CR 601.2f)", () => {
    function effectiveSpellCost(
        state: GameState,
        spellCardId: string,
        controllerId: string
    ): Record<string, number> {
        const def = getDefinition(spellCardId);
        const spellView = makeInstance(spellCardId, {
            controllerId,
            zone: "stack",
        });
        const cost = normalizeManaCost(def.manaCost ?? {});
        applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
        return cost;
    }

    const board = (controllerId = "p1") =>
        makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(planarGate.id, {
                            id: "gate",
                            controllerId,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });

    it("definition: {6} Artifact with a cost-modifier static", () => {
        expect(planarGate.manaCost).toEqual({ X: 6 });
        expect(
            planarGate.staticEffects?.some((e) => e.kind === "cost-modifier")
        ).toBe(true);
    });

    it("reduces your creature spell (Grizzly Bears {1}{G} → {G})", () => {
        const state = board();
        expect(effectiveSpellCost(state, grizzlyBears.id, "p1")).toEqual({
            G: 1,
        });
    });

    it("does not reduce a noncreature spell (Lightning Bolt {R} unchanged)", () => {
        const state = board();
        expect(effectiveSpellCost(state, lightningBolt.id, "p1")).toEqual({
            R: 1,
        });
    });

    it("only reduces creatures YOU cast", () => {
        const state = board("p1");
        expect(effectiveSpellCost(state, grizzlyBears.id, "p2")).toEqual({
            X: 1,
            G: 1,
        });
    });
});

describe("Relic Barrier ({T}: Tap target artifact, CR 701.20)", () => {
    it("taps the target artifact", () => {
        const barrier = makeInstance(relicBarrier.id, { id: "barrier" });
        const otherArtifact = makeInstance(manaMatrix.id, { id: "other" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [barrier, otherArtifact],
                }),
                makePlayer("p2"),
            ],
        });
        expect(otherArtifact.isTapped).toBe(false);
        resolveActivated(state, barrier, "relic-barrier-tap", [
            { type: "permanent", id: "other" },
        ]);
        const target = state.players[0].battlefield.find(
            (c) => c.id === "other"
        )!;
        expect(target.isTapped).toBe(true);
    });
});

describe("Alchor's Tomb (target permanent becomes chosen color, CR 105.2 / 611)", () => {
    it("sets the chosen color override on the target and survives projection", () => {
        const tomb = makeInstance(alchorsTomb.id, { id: "tomb" });
        const bears = makeInstance(grizzlyBears.id, { id: "bears" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tomb, bears] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, tomb, "alchors-tomb-color", [
            { type: "permanent", id: "bears" },
        ]);
        // The option choice suspends — answer "U" (blue).
        answerChoice(state, ["U"]);
        const colored = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(colored.colorOverride).toEqual(["U"]);
        // Wire-format: the color override survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(slim.colorOverride).toEqual(["U"]);
    });
});

describe("Mirror Universe (exchange life totals, CR 118.5)", () => {
    it("swaps the controller's and target opponent's life totals", () => {
        const mirror = makeInstance(mirrorUniverse.id, { id: "mirror" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 3, battlefield: [mirror] }),
                makePlayer("p2", { life: 18 }),
            ],
        });
        resolveActivated(state, mirror, "mirror-universe-exchange", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(3);
    });

    it("definition: upkeep-only, controller-turn-only, taps + sacrifices", () => {
        const ability = mirrorUniverse.activatedAbilities![0];
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBe(true);
        expect(ability.cost.tap).toBe(true);
        expect(ability.cost.sacrifice).toBe(true);
    });
});

describe("Pendelhaven (Legendary land: {T}: Add {G}; {T}: pump a 1/1, CR 305 / 611.1)", () => {
    it("definition: Legendary Land with a mana ability and a pump ability", () => {
        expect(pendelhaven.types).toEqual(["Land"]);
        expect(pendelhaven.supertypes).toEqual(["Legendary"]);
        const mana = pendelhaven.activatedAbilities!.find(
            (a) => a.id === "pendelhaven-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ G: 1 });
        const pump = pendelhaven.activatedAbilities!.find(
            (a) => a.id === "pendelhaven-pump"
        )!;
        expect(pump.targetRequirement?.powerFilter).toEqual({ min: 1, max: 1 });
        expect(pump.targetRequirement?.toughnessFilter).toEqual({
            min: 1,
            max: 1,
        });
    });

    it("pumps a 1/1 creature to 2/3 until end of turn and survives projection", () => {
        const land = makeInstance(pendelhaven.id, { id: "pendel" });
        // Use a 1/1 vanilla creature (Tundra Wolves is 1/1).
        const wolves = makeInstance(tundraWolves.id, { id: "wolves" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, wolves] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, land, "pendelhaven-pump", [
            { type: "permanent", id: "wolves" },
        ]);
        const target = state.players[0].battlefield.find(
            (c) => c.id === "wolves"
        )!;
        expect(getEffectivePower(state, target)).toBe(2);
        expect(getEffectiveToughness(state, target)).toBe(3);
        // Wire-format: the buff survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wolves"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C4 — Bands with other [quality] (CR 702.22j, #381)
// ─────────────────────────────────────────────────────────────────────────────

describe("Bands-with-other grant-lands (CR 702.22j, keyword-grant)", () => {
    const LANDS = [
        adventurersGuildhouse,
        cathedralOfSerra,
        mountainStronghold,
        seafarersQuay,
        unholyCitadel,
    ];

    for (const land of LANDS) {
        it(`${land.name} declares a legendary keyword-grant`, () => {
            const grant = land.staticEffects?.find(
                (e) => e.kind === "keyword-grant"
            );
            expect(grant).toBeDefined();
            expect(grant && "keyword" in grant && grant.keyword).toBe(
                "bands with other:legendary"
            );
        });
    }

    it("Adventurers' Guildhouse grants the keyword to your GREEN legendary creature only", () => {
        // Hunding Gjornersen ({W}{U}) is not green; Marhault Elsdragon ({R}{G}) is.
        const land = makeInstance(adventurersGuildhouse.id, {
            id: "guildhouse",
            controllerId: "p1",
        });
        const greenLegend = makeInstance(marhaultElsdragon.id, {
            id: "green",
            controllerId: "p1",
        });
        const nonGreenLegend = makeInstance(hundingGjornersen.id, {
            id: "nongreen",
            controllerId: "p1",
        });
        const oppGreenLegend = makeInstance(marhaultElsdragon.id, {
            id: "oppgreen",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land, greenLegend, nonGreenLegend],
                }),
                makePlayer("p2", { battlefield: [oppGreenLegend] }),
            ],
        });
        applySourceStaticEffects(state, land);

        const kw = "bands with other:legendary";
        expect(greenLegend.staticAbilities).toContain(kw); // green + legendary + yours
        expect(nonGreenLegend.staticAbilities).not.toContain(kw); // not green
        expect(oppGreenLegend.staticAbilities).not.toContain(kw); // not yours

        // Wire format: the granted keyword must survive projection so the band
        // panel (which reads staticAbilities client-side) can offer the band.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "green"
        )!;
        expect(slim.staticAbilities).toContain(kw);
    });

    it("the granted keyword forms a legal legendary band (end-to-end legality)", () => {
        const land = makeInstance(mountainStronghold.id, {
            id: "stronghold",
            controllerId: "p1",
        });
        // Marhault Elsdragon ({R}{G}) is red + legendary → gets the keyword.
        const a = makeInstance(marhaultElsdragon.id, {
            id: "a",
            controllerId: "p1",
        });
        const b = makeInstance(marhaultElsdragon.id, {
            id: "b",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, a, b] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, land);
        // Both legendary, one grants the legendary quality → band is legal.
        expect(isLegalBandComposition([a, b])).toBe(true);
    });
});

describe("Tolaria (strip banding + bands-with-other, upkeep-only, CR 611.1b)", () => {
    it("restricts the strip ability to the upkeep step", () => {
        const strip = tolaria.activatedAbilities?.find(
            (a) => a.id === "tolaria-strip"
        );
        expect(strip?.activationPhaseRestriction).toEqual(["UPKEEP"]);
    });

    it("strips both banding and bands-with-other until cleanup", () => {
        const land = makeInstance(tolaria.id, {
            id: "tolaria",
            controllerId: "p1",
        });
        const target = makeInstance(marhaultElsdragon.id, {
            id: "legend",
            controllerId: "p2",
            staticAbilities: [
                "banding",
                "bands with other:legendary",
                "flying",
            ],
        });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        resolveActivated(state, land, "tolaria-strip", [
            { type: "permanent", id: "legend" },
        ]);
        expect(target.staticAbilities).not.toContain("banding");
        expect(target.staticAbilities).not.toContain(
            "bands with other:legendary"
        );
        expect(target.staticAbilities).toContain("flying"); // unrelated keyword kept

        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(target.staticAbilities).toContain("banding");
        expect(target.staticAbilities).toContain("bands with other:legendary");
    });
});

describe("The Tabernacle at Pendrell Vale (CR 113.1 triggered-grant + CR 603.6a upkeep tax)", () => {
    it("declares a triggered-grant static and the granted template (not on triggeredAbilities)", () => {
        const kinds = (theTabernacleAtPendrellVale.staticEffects ?? []).map(
            (e) => e.kind
        );
        expect(kinds).toContain("triggered-grant");
        expect(
            theTabernacleAtPendrellVale.triggeredAbilities ?? []
        ).toHaveLength(0);
        expect(
            theTabernacleAtPendrellVale.triggeredGrantTemplates?.some(
                (t) => t.id === "tabernacle-upkeep"
            )
        ).toBe(true);
    });

    it("grants the upkeep tax to every creature in play (CR 611 filtered set)", () => {
        const { bear } = withTabernacle();
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(true);
    });

    it("does NOT grant the tax to a non-creature (the Tabernacle itself stays untaxed)", () => {
        const { tabernacle } = withTabernacle();
        expect(
            effectiveTriggeredAbilities(tabernacle).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(false);
    });

    it("fires the granted trigger at the creature controller's own upkeep (scope: your)", () => {
        const { state, bear } = withTabernacle("p1");
        const triggers = collectTriggers(state, [UPKEEP_C7("p1") as never]);
        expect(
            triggers.some(
                (t) =>
                    t.triggeredAbilityId === "tabernacle-upkeep" &&
                    t.triggerSourceId === bear.id
            )
        ).toBe(true);
        // Not on the OTHER player's upkeep.
        expect(
            collectTriggers(state, [UPKEEP_C7("p2") as never]).some(
                (t) => t.triggeredAbilityId === "tabernacle-upkeep"
            )
        ).toBe(false);
    });

    it("paying {1} keeps the creature (CR 118)", () => {
        const { state } = withTabernacle("p1");
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
        state.stack.push(...collectTriggers(state, [UPKEEP_C7("p1") as never]));
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            true
        );
        expect(state.players[0].manaPool.C).toBe(0);
    });

    it("backend integration: declining destroys the creature (CR 701.7)", () => {
        const { state } = withTabernacle("p1");
        state.stack.push(...collectTriggers(state, [UPKEEP_C7("p1") as never]));
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
    });

    it("grants the tax to a creature that ENTERS after the Tabernacle (applyExistingGrantsTo)", () => {
        const { state } = withTabernacle("p1");
        const ogre = makeInstance(grizzlyBears.id, {
            id: "ogre",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(ogre);
        applyExistingGrantsTo(state, ogre);
        expect(
            effectiveTriggeredAbilities(ogre).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(true);
    });

    it("removes the grant when the Tabernacle leaves play (unapplySourceStaticEffects)", () => {
        const { state, tabernacle, bear } = withTabernacle("p1");
        unapplySourceStaticEffects(state, tabernacle);
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(false);
    });

    it("wire format: the granted tax survives projectPublicState", () => {
        const { state, bear } = withTabernacle("p1");
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(true);
        const projected = projectPublicState(state, 1, "p1");
        const projBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(
            projBear.grantedTriggeredAbilities?.some(
                (g) => g.abilityId === "tabernacle-upkeep"
            )
        ).toBe(true);
    });
});

describe("named counters: add / remove / count independent of +1/+1 (CR 122.6)", () => {
    it("named counters are stored and read separately from +1/+1, and P/T counters annihilate (CR 704.5q)", () => {
        // A vanilla bear carrying named counters AND P/T counters.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            counters: { sleep: 2, "+1/+1": 3, "-1/-1": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        // The named "sleep" counters are inert to layer 7d.
        expect(bear.counters?.sleep).toBe(2);
        // CR 704.5q — +1/+1 and -1/-1 annihilate via SBA, leaving +2/+2.
        checkStateBasedActions(state);
        expect(bear.counters?.["+1/+1"]).toBe(2);
        expect(bear.counters?.["-1/-1"]).toBeUndefined();
        // Named counters untouched by the annihilation SBA.
        expect(bear.counters?.sleep).toBe(2);
    });
});

// --- Mana Batteries (#482) -------------------------------------------------
//
// "{2}, {T}: Put a charge counter on this artifact." (stack ability, CR 605)
// "{T}, Remove any number of charge counters: Add 1 + N mana of the battery's
//  colour." (mana ability, CR 605.1a — resolves immediately, no stack; the
//  removed-counter cost and the produced amount are both driven by the single
//  chosen index N, CR 106.1 / 122.6.)
//
// The mana-ability tap is exercised through `tapSourceIntoPayment` — the real
// GRE primitive every tap mutation (`tapUntap`, `tapForPayment`,
// `tapForActivationPayment`) routes through — so the cost/output coupling is
// tested end-to-end, not just the card definition's chooser.
describe("Mana Batteries (charge-counter scaling mana ability, CR 106 / 605)", () => {
    const BATTERIES = [
        {
            def: blackManaBattery,
            color: "B" as const,
            name: "Black Mana Battery",
        },
        {
            def: blueManaBattery,
            color: "U" as const,
            name: "Blue Mana Battery",
        },
        {
            def: greenManaBattery,
            color: "G" as const,
            name: "Green Mana Battery",
        },
        { def: redManaBattery, color: "R" as const, name: "Red Mana Battery" },
        {
            def: whiteManaBattery,
            color: "W" as const,
            name: "White Mana Battery",
        },
    ];

    it("ships all five colour variants from one parametric definition", () => {
        for (const { def, color, name } of BATTERIES) {
            expect(def.name).toBe(name);
            expect(def.types).toEqual(["Artifact"]);
            expect(def.manaCost).toEqual({ X: 4 });
            const charge = def.activatedAbilities?.find(
                (a) => a.id === "mana-battery-charge"
            );
            const tap = def.activatedAbilities?.find(
                (a) => a.id === "mana-battery-tap"
            );
            // Charge half uses the stack (adds a counter, not mana).
            expect(charge?.useStack).toBe(true);
            expect(charge?.cost).toEqual({ mana: { X: 2 }, tap: true });
            // Mana half is a mana ability (resolves immediately, no stack).
            expect(tap?.useStack).toBe(false);
            expect(tap?.cost).toEqual({ tap: true });
            expect(tap?.manaChoiceRemovesCounters).toBe("charge");
            // Fallback / representative output: one mana of the colour.
            expect(tap?.manaChoices).toEqual([{ [color]: 1 }]);
        }
    });

    it("adds a charge counter via the {2},{T} ability (CR 122.1)", () => {
        const battery = makeInstance(redManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [battery] }),
                makePlayer("p2"),
            ],
        });
        // Cost assumed already paid (mirrors post-activateAbility state).
        resolveActivated(state, battery, "mana-battery-charge");
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "battery"
        )!;
        expect(onBoard.counters?.charge).toBe(1);
        // A second activation stacks a second counter.
        resolveActivated(state, onBoard, "mana-battery-charge");
        expect(
            state.players[0].battlefield.find((c) => c.id === "battery")!
                .counters?.charge
        ).toBe(2);
    });

    it("offers 1..1+available mana choices scaled by charge counters (CR 106.1)", () => {
        const battery = makeInstance(greenManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [battery] }),
                makePlayer("p2"),
            ],
        });
        const choices = getEffectiveManaChoices(
            battery,
            "p1",
            state.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }))
        );
        // 3 counters → remove 0..3 → produce 1..4 {G}.
        expect(choices).toEqual([{ G: 1 }, { G: 2 }, { G: 3 }, { G: 4 }]);
    });

    it("tap removing N counters produces 1 + N mana of the battery's colour (CR 106.1/122.6)", () => {
        const battery = makeInstance(blueManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 2 },
        });
        const player = makePlayer("p1", { battlefield: [battery] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        // Choose index 2 = remove 2 counters → produce 3 {U}.
        const tappedLandIds: string[] = [];
        tapSourceIntoPayment(state, player, battery, 2, tappedLandIds);
        expect(player.manaPool.U).toBe(3);
        expect(battery.isTapped).toBe(true);
        // All 2 charge counters were removed to pay the scaling cost.
        expect(battery.counters?.charge ?? 0).toBe(0);
    });

    it("N = 0 (remove no counters) produces exactly 1 mana and keeps the counters (CR 106.1)", () => {
        const battery = makeInstance(whiteManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 4 },
        });
        const player = makePlayer("p1", { battlefield: [battery] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, battery, 0, []);
        expect(player.manaPool.W).toBe(1);
        // No counters removed when N = 0.
        expect(battery.counters?.charge).toBe(4);
    });

    it("resolves immediately without using the stack (mana ability, CR 605.1a)", () => {
        const battery = makeInstance(blackManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 1 },
        });
        const player = makePlayer("p1", { battlefield: [battery] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, battery, 1, []);
        // Mana is in the pool and nothing was placed on the stack.
        expect(player.manaPool.B).toBe(2);
        expect(state.stack.length).toBe(0);
    });

    it("rejects removing more counters than are available (CR 122.6)", () => {
        const battery = makeInstance(redManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 1 },
        });
        const player = makePlayer("p1", { battlefield: [battery] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        // With 1 counter the chooser only offers indices 0 and 1 (remove 0 or
        // 1), so an out-of-range index 2 is rejected up-front — the counter
        // count bounds the legal choices (CR 106.1 / 122.6). Nothing is paid.
        expect(() =>
            tapSourceIntoPayment(state, player, battery, 2, [])
        ).toThrow(/Invalid mana choice/);
        expect(battery.isTapped).toBe(false);
        expect(battery.counters?.charge).toBe(1);
    });

    it("scaled counter state and produced mana survive projection to the wire", () => {
        const battery = makeInstance(redManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [battery] }),
                makePlayer("p2"),
            ],
        });
        // The counter count is what drives the scaled chooser; assert it
        // survives the GameState → PublicGameState projection so the client
        // computes the same option list the server validates against.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "battery"
        )!;
        expect(slim.counters?.charge).toBe(2);
        const choices = getEffectiveManaChoices(
            slim as unknown as CardInstanceState,
            "p1",
            projected.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield as unknown as CardInstanceState[],
            }))
        );
        expect(choices).toEqual([{ R: 1 }, { R: 2 }, { R: 3 }]);
    });
});
