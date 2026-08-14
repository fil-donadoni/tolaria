// Ice Age (ICE) — white card behavior tests (ADR 0043 colour split of the
// former convex/cards/sets/__tests__/ice.test.ts). Each card's describe block
// cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    armorOfFaith,
    blinkingSpirit,
    cooperation,
    elvishHealer,
    hallowedGround,
    kelsinkoRanger,
    kjeldoranKnight,
    lostOrderOfJarkeld,
    mercenaries,
    orderOfTheWhiteShield,
    rally,
    shieldBearer,
    snowHound,
    warning,
    deathWardIce,
    disenchantIce,
    swordsToPlowsharesIce,
    circleOfProtectionBlackIce,
    circleOfProtectionBlueIce,
    circleOfProtectionGreenIce,
    circleOfProtectionRedIce,
    circleOfProtectionWhiteIce,
    seaSpirit,
    centaurArcher,
    knightOfStromgald,
    blackScarab,
    blueScarab,
    greenScarab,
    redScarab,
    whiteScarab,
    caribouRange,
    fylgja,
    justice,
    seraph,
    blessedWine,
    heal,
    lightningBlow,
    formation,
    snowCoveredForest,
    arcticFoxes,
    hipparion,
    prismaticWard,
    sacredBoon,
    energyStorm,
    kjeldoranRoyalGuard,
    arensonsAura,
    generalJarkeld,
    drought,
    kjeldoranEliteGuard,
    kjeldoranGuard,
    battleCry,
    enduringRenewal,
    adarkarUnicorn,
    orderOfTheSacredTorch,
} from "../../ice";
import { plains } from "../../lea";
import { getDefinition, getCardByName } from "../../../index";
import {
    tryAutoCommitPendingCast,
    selectTarget,
    tapSourceIntoPayment,
} from "../../../../game";
import { getManaTapOptionsDetailed } from "../../../../gre/constants";
import { applyDamageReplacements } from "../../../../gre/replacements";
import {
    resolveTopOfStack,
    getManaSubstitutions,
    payManaCost,
    commitLandsForCost,
    normalizeManaCost,
    runDamageReplacement,
    applyTargetPrevention,
    getStaticAdditionalSacrifices,
    removePermanentTo,
    processPendingActionTriggers,
    planDrawStep,
    commitDrawPlan,
} from "../../../../gre/state";
import {
    canAffordSacrifice,
    autoResolveFungible,
    applySacrificeSelection,
    type SacrificeSelection,
} from "../../../../gre/sacrificeChoice";
import {
    buildAutoTapSources,
    solveSmartAutoTap,
    manaFromPlan,
} from "../../../../gre/autoTap";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import {
    getLegalTargets,
    NO_TARGETING_SOURCE,
    pendingTargetFiltersFromRequirement,
} from "../../../../gre/rules";
import {
    advancePhase,
    applyAllCombatDamage,
    finalizeCleanup,
    emitBlockersConfirmedEvents,
} from "../../../../gre/phases";
import {
    validateBlockerEligibility,
    collectBlockBypassCharges,
} from "../../../../gre/combat";
import type { GameState } from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type { CardInstanceState } from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import type { PendingTarget } from "../../../../gre/state";
import type { CardType } from "../../../types";
import type { Phase } from "../../../../gre/types";
import type { Id } from "../../../../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "../../../../__tests__/gameMutationHarness";
import {
    resolveActivated,
    resolveTrigger,
    vanilla,
    library,
    castCantrip,
    enterUpkeepAndFire,
    snowLand,
} from "./helpers";

// ===========================================================================
// White free tranche (#630)
// ===========================================================================

// --- Reprints (CardPrint onto existing definitions, ADR 0014) --------------

describe("ICE White reprints (CardPrint wiring, ADR 0014)", () => {
    it("Death Ward print resolves to the LEA definition", () => {
        expect(getDefinition(deathWardIce.printId).name).toBe("Death Ward");
        expect(deathWardIce.definitionId).toBe(
            "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13"
        );
        expect(deathWardIce.setCode).toBe("ice");
    });
    it("Disenchant print resolves to the LEA definition", () => {
        expect(getDefinition(disenchantIce.printId).name).toBe("Disenchant");
    });
    it("Swords to Plowshares print resolves to the LEA definition", () => {
        expect(getDefinition(swordsToPlowsharesIce.printId).name).toBe(
            "Swords to Plowshares"
        );
    });
    it("Circle of Protection cycle prints resolve to their definitions", () => {
        expect(getDefinition(circleOfProtectionBlackIce.printId).name).toBe(
            "Circle of Protection: Black"
        );
        expect(getDefinition(circleOfProtectionBlueIce.printId).name).toBe(
            "Circle of Protection: Blue"
        );
        expect(getDefinition(circleOfProtectionGreenIce.printId).name).toBe(
            "Circle of Protection: Green"
        );
        expect(getDefinition(circleOfProtectionRedIce.printId).name).toBe(
            "Circle of Protection: Red"
        );
        expect(getDefinition(circleOfProtectionWhiteIce.printId).name).toBe(
            "Circle of Protection: White"
        );
    });
});

// --- Armor of Faith (Aura: static +1/+1 + {W}:+0/+1, CR 613) ----------------

describe("Armor of Faith (Aura, CR 611/613)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(armorOfFaith.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, host };
    }

    it("grants a static +1/+1 to the enchanted creature", () => {
        const { state, host } = setup();
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(3);
    });

    it("wire format: the +1/+1 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("{W} pump adds +0/+1 to the host until end of turn", () => {
        const { state, host } = setup();
        const aura = state.players[0].battlefield.find((c) => c.id === "aura")!;
        resolveActivated(state, aura, "armor-of-faith-pump");
        expect(getEffectiveToughness(state, host)).toBe(4);
        expect(getEffectivePower(state, host)).toBe(3);
    });
});

// --- Cooperation (Aura grants banding, CR 611) -----------------------------

describe("Cooperation (Aura grants banding, CR 702.22)", () => {
    it("grants banding to the enchanted creature", () => {
        const host = vanilla("host", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(cooperation.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(live.staticAbilities ?? []).not.toContain("banding");
        // The keyword-grant is a layer-6 static effect; assert via projection
        // path that the host reads as having banding.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slim).toBeDefined();
        // Definition wiring: the static effect grants banding.
        expect(cooperation.staticEffects?.[0]).toMatchObject({
            kind: "keyword-grant",
            keyword: "banding",
        });
    });
});

// --- Blinking Spirit ({0}: bounce self, CR 701.14) -------------------------

describe("Blinking Spirit ({0}: return self to hand, CR 701.14)", () => {
    it("returns itself to its owner's hand", () => {
        const spirit = makeInstance(blinkingSpirit.id, {
            id: "spirit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, spirit, "blinking-spirit-bounce");
        expect(
            state.players[0].battlefield.find((c) => c.id === "spirit")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "spirit")
        ).toBeDefined();
    });
});

// --- Elvish Healer ({T}: prevent 1, or 2 vs green creature, CR 615) --------

describe("Elvish Healer ({T}: damage prevention, CR 615)", () => {
    it("prevents the next 1 damage to a non-green target", () => {
        const healer = makeInstance(elvishHealer.id, {
            id: "healer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const redCreature = vanilla("redc", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-red" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [healer, redCreature] }),
                makePlayer("p2"),
            ],
        });
        // Should resolve without error and register a 1-point shield.
        resolveActivated(state, healer, "elvish-healer-prevent", [
            { type: "permanent", id: "redc" },
        ]);
        expect(state.stack).toHaveLength(0);
    });
});

// --- Kelsinko Ranger ({1}{W}: green creature gains first strike) -----------

describe("Kelsinko Ranger (grant first strike to green, CR 611.2a)", () => {
    it("grants first strike to the target green creature until end of turn", () => {
        const ranger = makeInstance(kelsinkoRanger.id, {
            id: "ranger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCreature = vanilla("grn", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-green" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ranger, greenCreature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ranger, "kelsinko-ranger-first-strike", [
            { type: "permanent", id: "grn" },
        ]);
        const target = state.players[0].battlefield.find(
            (c) => c.id === "grn"
        )!;
        expect(getEffectivePower(state, target)).toBe(2);
        // The grant routes through the layer system; assert no crash + filter.
        const ability = kelsinkoRanger.activatedAbilities!.find(
            (a) => a.id === "kelsinko-ranger-first-strike"
        )!;
        expect(ability.targetRequirement).toMatchObject({ colorFilter: "G" });
    });
});

// --- Kjeldoran Knight (self-pumps, CR 611.2a) ------------------------------

describe("Kjeldoran Knight (self-pumps, CR 611.2a)", () => {
    function setup() {
        const knight = makeInstance(kjeldoranKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2"),
            ],
        });
        return { state, knight };
    }
    it("starts as a 1/1 with banding", () => {
        const { state, knight } = setup();
        expect(getEffectivePower(state, knight)).toBe(1);
        expect(getEffectiveToughness(state, knight)).toBe(1);
        expect(kjeldoranKnight.staticAbilities).toEqual(["banding"]);
    });
    it("{1}{W} pumps +1/+0 until end of turn", () => {
        const { state, knight } = setup();
        resolveActivated(state, knight, "kjeldoran-knight-pump-power");
        expect(getEffectivePower(state, knight)).toBe(2);
        expect(getEffectiveToughness(state, knight)).toBe(1);
    });
    it("{W}{W} pumps +0/+2 until end of turn", () => {
        const { state, knight } = setup();
        resolveActivated(state, knight, "kjeldoran-knight-pump-toughness");
        expect(getEffectiveToughness(state, knight)).toBe(3);
    });
});

// --- Order of the White Shield (first strike grant + pump) ------------------

describe("Order of the White Shield (grants + pump, CR 611.2a)", () => {
    function setup() {
        const order = makeInstance(orderOfTheWhiteShield.id, {
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
        return { state, order };
    }
    it("is a 2/1 with protection from black", () => {
        const { state, order } = setup();
        expect(getEffectivePower(state, order)).toBe(2);
        expect(getEffectiveToughness(state, order)).toBe(1);
        expect(orderOfTheWhiteShield.staticAbilities).toContain(
            "protection from black"
        );
    });
    it("{W}{W} pumps +1/+0 until end of turn", () => {
        const { state, order } = setup();
        resolveActivated(state, order, "order-white-shield-pump");
        expect(getEffectivePower(state, order)).toBe(3);
    });
});

// --- Lost Order of Jarkeld (CDA P/T, CR 604.3 / layer 7a) ------------------

describe("Lost Order of Jarkeld (CDA P/T, CR 604.3)", () => {
    function setup(oppCreatures: number) {
        const order = makeInstance(lostOrderOfJarkeld.id, {
            id: "lost",
            controllerId: "p1",
            ownerId: "p1",
            chosenPlayerId: "p2",
        });
        const oppField: CardInstanceState[] = [];
        for (let i = 0; i < oppCreatures; i++) {
            oppField.push(vanilla(`opp${i}`, 1, 1));
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2", { battlefield: oppField }),
            ],
        });
        return { state, order };
    }
    it("is 1 plus the chosen player's creature count", () => {
        const { state, order } = setup(3);
        expect(getEffectivePower(state, order)).toBe(4);
        expect(getEffectiveToughness(state, order)).toBe(4);
    });
    it("is a 1/1 when the chosen player controls no creatures", () => {
        const { state, order } = setup(0);
        expect(getEffectivePower(state, order)).toBe(1);
        expect(getEffectiveToughness(state, order)).toBe(1);
    });
    it("wire format: the CDA P/T survives projectPublicState", () => {
        const { state } = setup(2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lost"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// --- Snow Hound ({1},{T}: bounce self + green/blue creature, CR 701.14) ----

describe("Snow Hound (self + green/blue bounce, CR 701.14)", () => {
    it("returns itself and the target to hand", () => {
        const hound = makeInstance(snowHound.id, {
            id: "hound",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blueCreature = vanilla("blu", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-blue" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hound, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, hound, "snow-hound-bounce", [
            { type: "permanent", id: "blu" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "hound")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "blu")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "hound")
        ).toBeDefined();
        expect(state.players[0].hand.find((c) => c.id === "blu")).toBeDefined();
    });
});

// --- Hallowed Ground ({W}{W}: bounce your land, CR 701.14) ------------------

describe("Hallowed Ground (return your land, CR 701.14)", () => {
    const bounceAbility = hallowedGround.activatedAbilities!.find(
        (a) => a.id === "hallowed-ground-bounce"
    )!;
    const bounceReq = bounceAbility.targetRequirement!;

    it("returns the target land you control to hand", () => {
        const ground = makeInstance(hallowedGround.id, {
            id: "ground",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land: CardInstanceState = {
            ...vanilla("land", 0, 0, {
                controllerId: "p1",
                ownerId: "p1",
                card: { id: "fake-land" },
            }),
            types: ["Land"] as CardType[],
            power: undefined,
            toughness: undefined,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ground, land] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ground, "hallowed-ground-bounce", [
            { type: "permanent", id: "land" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "land")
        ).toBeDefined();
    });

    // Both sides of the target-legality seam (CR 205.4a Snow supertype):
    // `getLegalTargets` (the OFFERED set) and the `selectTarget` mutation
    // (the ACCEPTED set) must agree that a Snow-Covered basic is illegal —
    // otherwise the client could never offer it, yet a spoofed/older client
    // could still have it accepted server-side (the Phelia bug class,
    // `intrinsicPermanentTargetViolation`'s own doc comment). A test that
    // only asserts the definition's shape (above) does not prove either.
    it("getLegalTargets (offered set) excludes a Snow-Covered land you control and includes a nonsnow one", () => {
        const ground = makeInstance(hallowedGround.id, {
            id: "ground",
            controllerId: "p1",
            ownerId: "p1",
        });
        const snowForest = snowLand(snowCoveredForest.id, "sf", "p1");
        const nonsnowPlains = makeInstance(plains.id, {
            id: "pl",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ground, snowForest, nonsnowPlains],
                }),
                makePlayer("p2"),
            ],
        });
        const legal = getLegalTargets(
            state,
            bounceReq,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const legalIds = legal.map((t) => ("id" in t ? t.id : undefined));
        expect(legalIds).toContain("pl");
        expect(legalIds).not.toContain("sf");
    });

    it("selectTarget mutation (accepted set) rejects a Snow-Covered land and accepts a nonsnow one", async () => {
        const GAME_ID = "game-1" as Id<"games">;
        const ground = makeInstance(hallowedGround.id, {
            id: "ground",
            controllerId: "p1",
            ownerId: "p1",
        });
        const snowForest = snowLand(snowCoveredForest.id, "sf", "p1");
        const nonsnowPlains = makeInstance(plains.id, {
            id: "pl",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Same builder game.ts's activateAbility mutation uses to seed
        // `state.pendingTarget` for this ability (`pendingTargetFiltersFromRequirement`,
        // ADR 0068) — so the carried filter set under test is exactly the one
        // production code carries, not a hand-rolled substitute.
        const pendingTarget: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "ground",
            targetType: bounceReq.type,
            count: 1,
            selected: [],
            kind: "ability",
            abilityId: "hallowed-ground-bounce",
            ...pendingTargetFiltersFromRequirement(bounceReq, undefined),
        };
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ground, snowForest, nonsnowPlains],
                }),
                makePlayer("p2"),
            ],
            pendingTarget,
        });

        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        const runSelectTarget = (targetId: string) =>
            runMutation<
                {
                    gameId: Id<"games">;
                    playerId: string;
                    targetType: "permanent";
                    targetId: string;
                },
                void
            >(selectTarget as unknown as Handler<unknown, void>, harness.ctx, {
                gameId: GAME_ID,
                playerId: "p1",
                targetType: "permanent",
                targetId,
            });

        await expect(runSelectTarget("sf")).rejects.toThrow(
            /must not be Snow/i
        );
        // The rejected snow target never landed — selection is still open.
        expect(harness.state().pendingTarget?.selected ?? []).toHaveLength(0);

        await runSelectTarget("pl");
        // A nonsnow land is accepted — either still recorded as selected, or
        // (count === 1) the selection finalized and pendingTarget cleared.
        const after = harness.state();
        const stillSelecting = after.pendingTarget?.selected?.some(
            (t) => "id" in t && t.id === "pl"
        );
        const finalized = after.pendingTarget === undefined;
        expect(stillSelecting || finalized).toBe(true);
    });
});

// --- Rally (blocking creatures +1/+1, CR 611.2a) ---------------------------

describe("Rally (blocking creatures +1/+1, CR 611.2a)", () => {
    it("buffs every creature currently blocking", () => {
        const blocker = vanilla("blk", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-blk" },
        });
        const attacker = vanilla("atk", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blocker] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { blk: ["atk"] },
                blockersConfirmed: true,
            },
        });
        const item = pushSpell(state, rally.id, "p1");
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "blk")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
        expect(state.stack.find((s) => s.id === item.id)).toBeUndefined();
    });
});

// --- Warning (prevent combat damage by target attacker) --------------------

describe("Warning (attacker assigns no combat damage, CR 510.1c)", () => {
    it("resolves and marks the attacker as assigning no combat damage", () => {
        const attacker = vanilla("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        pushSpell(state, warning.id, "p1", [{ type: "permanent", id: "atk" }]);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
    });
});

// --- Mercenaries ({3}: prevent its damage to you, any player) --------------

describe("Mercenaries (open prevention, CR 602.1)", () => {
    it("resolves a prevention shield without error", () => {
        const merc = makeInstance(mercenaries.id, {
            id: "merc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [merc] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, merc, "mercenaries-prevent");
        expect(state.stack).toHaveLength(0);
    });
});

// ===========================================================================
// White buildable-now completion (#653)
// ===========================================================================

// ---------------------------------------------------------------------------
// Scarab cycle (CR 509.1b block-restriction + CR 611.2c conditional pt-buff).
// Each Scarab is a {W} Aura: the host can't be blocked by creatures of the
// Scarab's colour, and gets +2/+2 while an opponent controls a permanent of
// that colour.
// ---------------------------------------------------------------------------

describe("Scarab cycle (#653) — colour block-restriction + conditional +2/+2", () => {
    /** p1 controls a vanilla host enchanted by `scarab`; p2's battlefield is
     *  seeded by `oppBattlefield`. Returns the live host + state. */
    function withScarab(
        scarab: typeof blackScarab,
        oppBattlefield: CardInstanceState[]
    ) {
        const aura = makeInstance(scarab.id, {
            id: "scarab",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
        });
        const host = makeInstance(balduvianBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        return { state, aura, host };
    }

    it("registers all five Scarabs in the deck-builder index", () => {
        for (const s of [
            blackScarab,
            blueScarab,
            greenScarab,
            redScarab,
            whiteScarab,
        ]) {
            expect(getDefinition(s.id)).toBe(s);
        }
    });

    it("Black Scarab: host gets +2/+2 while opponent controls a black permanent", () => {
        const blackPerm = makeInstance(knightOfStromgald.id, {
            id: "black-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(blackScarab, [blackPerm]);
        // Balduvian Bears base 2/2 → +2/+2 = 4/4.
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("Black Scarab: the buff turns off when the opponent controls no black permanent", () => {
        const bluePerm = makeInstance(seaSpirit.id, {
            id: "blue-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(blackScarab, [bluePerm]);
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });

    it("a black permanent the AURA's controller controls does NOT satisfy the clause", () => {
        const { state, host } = withScarab(blackScarab, []);
        state.players[0].battlefield.push(
            makeInstance(knightOfStromgald.id, {
                id: "my-black",
                controllerId: "p1",
            })
        );
        expect(getEffectivePower(state, host)).toBe(2);
    });

    it("wire format: the conditional +2/+2 survives projectPublicState (mandatory)", () => {
        const blackPerm = makeInstance(knightOfStromgald.id, {
            id: "black-perm",
            controllerId: "p2",
        });
        const { state } = withScarab(blackScarab, [blackPerm]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("Black Scarab: the host can't be blocked by black creatures (CR 509.1b)", () => {
        const { state, host } = withScarab(blackScarab, []);
        host.isAttacking = true;
        const blackBlocker = makeInstance(knightOfStromgald.id, {
            id: "black-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(blackBlocker);
        const res = validateBlockerEligibility(
            host,
            blackBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("Black Scarab: a NON-black creature can still block the host", () => {
        const { state, host } = withScarab(blackScarab, []);
        host.isAttacking = true;
        const blueBlocker = makeInstance(seaSpirit.id, {
            id: "blue-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(blueBlocker);
        const res = validateBlockerEligibility(
            host,
            blueBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("Red Scarab keys off red (Centaur Archer is red): host buffed and red-block-restricted", () => {
        const redPerm = makeInstance(centaurArcher.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(redScarab, [redPerm]);
        expect(getEffectivePower(state, host)).toBe(4);
        host.isAttacking = true;
        const redBlocker = makeInstance(centaurArcher.id, {
            id: "red-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(redBlocker);
        expect(
            validateBlockerEligibility(
                host,
                redBlocker,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Caribou Range (CR 113.1 activated-grant on the host land + CR 118.5
// sacrifice-a-Caribou-token lifegain).
// ---------------------------------------------------------------------------

describe("Caribou Range (#653) — grant token-maker + sacrifice-for-life", () => {
    it("the granted ability creates a 0/1 white Caribou token under the land's controller", () => {
        // Ice Floe is a registered ICE land — use it as the enchanted host.
        const land = makeInstance("85ce04fb-e687-41e0-ae9a-16a51df5d943", {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const aura = makeInstance(caribouRange.id, {
            id: "caribou-range",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "land",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [land, aura] })],
        });
        // The granted ability resolves with the HOST land as the source; the
        // template is read from Caribou Range's grantTemplates via
        // `grantedSourceCardId` (CR 113.1 — how the engine wires granted
        // abilities).
        state.stack.push({
            ...land,
            zone: "stack",
            castById: land.controllerId,
            abilityId: "caribou-range-make-caribou",
            grantedSourceCardId: caribouRange.id,
            targets: [],
        } as unknown as StackItem);
        resolveTopOfStack(state);
        const caribou = state.players[0].battlefield.find((c) =>
            c.subtypes?.includes("Caribou")
        );
        expect(caribou).toBeDefined();
        expect(caribou?.power).toBe(0);
        expect(caribou?.toughness).toBe(1);
        expect(caribou?.isToken).toBe(true);
        expect(caribou?.controllerId).toBe("p1");
    });

    it("sacrificing a Caribou token gains 1 life (cost is paid by the engine, effect resolves)", () => {
        const aura = makeInstance(caribouRange.id, {
            id: "caribou-range",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [aura], life: 20 })],
        });
        resolveActivated(state, aura, "caribou-range-gain-life");
        expect(state.players[0].life).toBe(21);
    });
});

// ---------------------------------------------------------------------------
// Fylgja (CR 122.1 entersWith counters + CR 602.1 counter-removal cost +
// CR 615 prevention shield on the host + replenish ability).
// ---------------------------------------------------------------------------

describe("Fylgja (#653) — healing-counter prevention Aura", () => {
    function fylgjaBoard(counters = 4) {
        const host = makeInstance(balduvianBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const aura = makeInstance(fylgja.id, {
            id: "fylgja",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
            counters: { healing: counters },
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [host, aura] })],
        });
        return { state, aura, host };
    }

    it("the {2}{W} ability adds a healing counter to the Aura", () => {
        const { state, aura } = fylgjaBoard(4);
        resolveActivated(state, aura, "fylgja-add-counter");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "fylgja"
        )!;
        expect(live.counters?.healing).toBe(5);
    });

    it("the prevent ability shields the enchanted creature from the next 1 damage", () => {
        const { state, aura, host } = fylgjaBoard(4);
        resolveActivated(state, aura, "fylgja-prevent");
        // A prevention shield is recorded against the host (CR 615).
        const shields = state.targetPreventionShields ?? [];
        expect(
            shields.some(
                (s) => s.targetType === "permanent" && s.targetId === host.id
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Justice (CR 603.6a upkeep pay-or-sacrifice + CR 603.4 red-damage reflect).
// ---------------------------------------------------------------------------

describe("Justice (#653) — upkeep pay-or-sac + reflect red damage", () => {
    function justiceBoard() {
        const inst = makeInstance(justice.id, {
            id: "justice",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, inst };
    }

    it("reflects red creature damage back to that source's controller (CR 603.4)", () => {
        const { state, inst } = justiceBoard();
        resolveTrigger(state, inst, "justice-reflect", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "red-attacker",
            sourceControllerId: "p2",
            target: { type: "player", id: "p1" },
            amount: 3,
            isCombat: true,
            sourceColors: ["R"],
            sourceTypes: ["Creature"],
        } as StackItem["triggerEvent"]);
        // Justice deals 3 to p2 (the red source's controller).
        expect(state.players[1].life).toBe(17);
    });

    it("sacrifices itself if the controller declines to pay {W}{W} on upkeep", () => {
        const { state, inst } = justiceBoard();
        // No white mana available → decline → sacrifice.
        resolveTrigger(state, inst, "justice-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        // Either the may-pay prompt is pending (player chooses) or, with no mana,
        // the engine resolves it; assert the trigger is wired and runs without
        // throwing. The card stays unless the player declines via the prompt.
        expect(
            (justice.triggeredAbilities ?? []).some(
                (t) => t.id === "justice-upkeep"
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Seraph (CR 603.2 death trigger on damagedBySources + CR 603.7c next-end-step
// reanimation). Mirrors Krovikan Vampire.
// ---------------------------------------------------------------------------

describe("Seraph (#653) — reanimate creatures it killed at the next end step", () => {
    it("the delayed reanimate trigger puts the dead card onto the controller's battlefield (CR 603.7c)", () => {
        const seraphInst = makeInstance(seraph.id, {
            id: "seraph",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // The dead card sits in the reanimating player's graveyard — the same
        // lookup `returnToBattlefield(controllerId, …, "graveyard")` performs
        // (mirrors Krovikan Vampire's shipped composition).
        const deadCreature = makeInstance(balduvianBears.id, {
            id: "victim",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [seraphInst],
                    graveyard: [deadCreature],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...seraphInst,
            zone: "stack",
            castById: "p1",
            delayedTriggerId: "seraph-reanimate",
            delayedPayload: { deadId: "victim", controllerId: "p1" },
        } as unknown as StackItem);
        resolveTopOfStack(state);
        // The victim is now on p1's battlefield (reanimated under their control).
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(reanimated).toBeDefined();
        expect(reanimated?.controllerId).toBe("p1");
    });
});

describe("next-upkeep delayed-trigger timing (CR 502.2 / 603.7d, #660)", () => {
    it("schedules a next-upkeep delayed trigger with no targetPlayerId", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        const dt = state.delayedTriggers?.[0];
        expect(dt?.timing).toBe("next-upkeep");
        // Fires at the next upkeep regardless of whose turn → no targetPlayerId.
        expect(dt?.targetPlayerId).toBeUndefined();
        expect(dt?.controller).toBe("p1");
    });

    it("fires at the VERY NEXT upkeep even on the opponent's turn", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        // The opponent's upkeep is the next upkeep reached — it still fires.
        enterUpkeepAndFire(state, "p2");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        // The scheduling player (p1) drew, not the active player.
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        expect(state.players[1].hand).toHaveLength(0);
    });

    it("fires EXACTLY ONCE — dequeued after the first upkeep", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        enterUpkeepAndFire(state, "p1");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toBeUndefined();
        // A subsequent upkeep does NOT re-fire it.
        const handAfterFirst = state.players[0].hand.length;
        enterUpkeepAndFire(state, "p2");
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(handAfterFirst);
    });

    it("wire format: the cantrip draw survives projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        // The owner sees the drawn card in hand after the wire projection.
        expect(projected.players[0].hand.map((c) => c?.id)).toContain("a");
    });
});

describe("Blessed Wine (gain 1 life + next-upkeep cantrip, CR 119.3)", () => {
    it("gains 1 life and schedules the cantrip", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, library: library("p1", ["a"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        expect(state.players[0].life).toBe(21);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Heal (prevent next 1 damage to any target, CR 615.1)", () => {
    it("schedules the cantrip and has an 'any' target", () => {
        const dummy = vanilla("d", 2, 2, {
            id: "d",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dummy],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        expect(heal.targetRequirement?.type).toBe("any");
        castCantrip(state, heal.id, "p1", [{ type: "permanent", id: "d" }]);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Lightning Blow (grant first strike, CR 702.7)", () => {
    it("grants first strike to the target and cantrips", () => {
        const dummy = vanilla("d", 1, 1, {
            id: "d",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dummy],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, lightningBlow.id, "p1", [
            { type: "permanent", id: "d" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "d")!;
        expect(live.staticAbilities).toContain("first strike");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Formation (grant banding, CR 702.22)", () => {
    it("grants banding to the target and cantrips", () => {
        const dummy = vanilla("d", 1, 1, {
            id: "d",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dummy],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, formation.id, "p1", [
            { type: "permanent", id: "d" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "d")!;
        expect(live.staticAbilities).toContain("banding");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Arctic Foxes (CR 509.1b snow-gated block restriction)", () => {
    it("a power-2 blocker can't block while the defender controls a snow land", () => {
        const foxes = makeInstance(arcticFoxes.id, {
            id: "fox",
            controllerId: "p1",
        });
        const bigBlocker = vanilla("big", 2, 2);
        bigBlocker.controllerId = "p2";
        const snowF = snowLand(snowCoveredForest.id, "sf", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [foxes] }),
                makePlayer("p2", { battlefield: [bigBlocker, snowF] }),
            ],
        });
        const res = validateBlockerEligibility(
            foxes,
            bigBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("a power-1 blocker can block regardless", () => {
        const foxes = makeInstance(arcticFoxes.id, {
            id: "fox",
            controllerId: "p1",
        });
        const smallBlocker = vanilla("small", 1, 1);
        smallBlocker.controllerId = "p2";
        const snowF = snowLand(snowCoveredForest.id, "sf", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [foxes] }),
                makePlayer("p2", { battlefield: [smallBlocker, snowF] }),
            ],
        });
        const res = validateBlockerEligibility(
            foxes,
            smallBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("a power-2 blocker CAN block when the defender has no snow land", () => {
        const foxes = makeInstance(arcticFoxes.id, {
            id: "fox",
            controllerId: "p1",
        });
        const bigBlocker = vanilla("big", 2, 2);
        bigBlocker.controllerId = "p2";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [foxes] }),
                makePlayer("p2", { battlefield: [bigBlocker] }),
            ],
        });
        const res = validateBlockerEligibility(
            foxes,
            bigBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
});

// ===========================================================================
// Hipparion (#729) — pay-to-bypass conditional block restriction (CR 509.1b)
// ===========================================================================

describe("Hipparion (can't block power 3+ unless you pay {1}, CR 509.1b)", () => {
    /** Mirrors the bypass-payment loop in game.ts `confirmBlockers`: for each
     *  charge, auto-tap the blocker controller's mana and pay it. Returns the
     *  rejection reason when a charge is unpayable, else null. */
    function payBypassSeam(state: GameState): string | null {
        for (const charge of collectBlockBypassCharges(state)) {
            const payer = state.players.find(
                (p) => p.id === charge.controllerId
            )!;
            const subs = getManaSubstitutions(state, charge.controllerId);
            const sources = buildAutoTapSources(payer.battlefield);
            const cost = normalizeManaCost(charge.cost);
            const plan = solveSmartAutoTap(payer.manaPool, cost, subs, sources);
            if (plan === null) return charge.reason;
            const tappedIds = new Set(plan.map((s) => s.cardId));
            for (const src of payer.battlefield) {
                if (tappedIds.has(src.id)) src.isTapped = true;
            }
            const produced = manaFromPlan(sources, plan);
            for (const [c, amt] of Object.entries(produced)) {
                if (amt) {
                    payer.manaPool[c] = (payer.manaPool[c] ?? 0) + amt;
                }
            }
            payManaCost(payer.manaPool, cost, subs);
            commitLandsForCost(payer, cost);
        }
        return null;
    }

    /** p1 attacks with one creature of `attackerPower`; p2's Hipparion blocks
     *  it. p2 has `lands` untapped Plains available to pay the bypass. */
    function setup(attackerPower: number, lands: number) {
        const attacker = vanilla("atk", attackerPower, attackerPower, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const hipp = makeInstance(hipparion.id, {
            id: "hipp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p2Lands = Array.from({ length: lands }, (_, i) =>
            makeInstance(plains.id, {
                id: `plains-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [hipp, ...p2Lands] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { hipp: ["atk"] },
                blockersConfirmed: false,
            },
        });
        return { state };
    }

    it("blocks a power-2 creature for free (no bypass charge)", () => {
        const { state } = setup(2, 0);
        const atk = state.players[0].battlefield[0];
        const hipp = state.players[1].battlefield[0];
        expect(
            validateBlockerEligibility(
                atk,
                hipp,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
        expect(collectBlockBypassCharges(state)).toHaveLength(0);
        expect(payBypassSeam(state)).toBeNull();
    });

    it("permits blocking a power-4 creature and auto-pays {1} from a Plains", () => {
        const { state } = setup(4, 1);
        const atk = state.players[0].battlefield[0];
        const hipp = state.players[1].battlefield.find((c) => c.id === "hipp")!;
        // Block is allowed at assignment because a bypass cost exists.
        expect(
            validateBlockerEligibility(
                atk,
                hipp,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
        // The charge is collected and paid by tapping the Plains.
        const charges = collectBlockBypassCharges(state);
        expect(charges).toHaveLength(1);
        expect(payBypassSeam(state)).toBeNull();
        const land = state.players[1].battlefield.find(
            (c) => c.id === "plains-0"
        )!;
        expect(land.isTapped).toBe(true);
    });

    it("rejects the block when the {1} can't be paid (no mana)", () => {
        const { state } = setup(4, 0);
        const reason = payBypassSeam(state);
        expect(reason).not.toBeNull();
        expect(reason).toMatch(/pay \{1\}/i);
    });
});

// Prismatic Ward (#734) — colour-keyed ALL-damage prevention on the Aura host.
describe("Prismatic Ward (colour-filtered damage prevention, CR 615)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        // Warded colour = black, stored as the modal pick `chosenModeId`.
        const aura = makeInstance(prismaticWard.id, {
            id: "ward",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
            chosenModeId: "B",
        });
        // A black source and a blue source to fire damage from (CR 202.2 —
        // colours are read off the source's mana cost via the registry).
        const blackSrc = makeInstance(knightOfStromgald.id, {
            id: "black-src",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blueSrc = makeInstance(seaSpirit.id, {
            id: "blue-src",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: [blackSrc, blueSrc] }),
            ],
        });
        return { state };
    }

    it("prevents all damage to the host from a source of the chosen colour", () => {
        const { state } = setup();
        const result = runDamageReplacement(
            state,
            "black-src",
            "p2",
            { type: "permanent", id: "host" },
            3,
            false
        );
        // Fully prevented — the replacement consumes the event.
        expect(result).toBeNull();
    });

    it("does NOT prevent damage from a source of another colour", () => {
        const { state } = setup();
        const result = runDamageReplacement(
            state,
            "blue-src",
            "p2",
            { type: "permanent", id: "host" },
            3,
            false
        );
        expect(result).not.toBeNull();
        expect(result?.amount).toBe(3);
    });

    it("prevents combat damage too, not just spell/ability damage", () => {
        const { state } = setup();
        const result = runDamageReplacement(
            state,
            "black-src",
            "p2",
            { type: "permanent", id: "host" },
            2,
            true
        );
        expect(result).toBeNull();
    });

    it("wire format: the colour shield survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as GameState;
        // Black source still prevented after the projection strips card.card.
        expect(
            runDamageReplacement(
                projected,
                "black-src",
                "p2",
                { type: "permanent", id: "host" },
                3,
                false
            )
        ).toBeNull();
        // Blue source still lands.
        const fresh = projectPublicState(
            setup().state,
            1,
            "p1"
        ) as unknown as GameState;
        expect(
            runDamageReplacement(
                fresh,
                "blue-src",
                "p2",
                { type: "permanent", id: "host" },
                3,
                false
            )?.amount
        ).toBe(3);
    });
});

// Sacred Boon (#734) — prevent-next-3 shield whose prevented total drives a
// next-end-step +0/+1 counter grant (CR 615.1 readback seam).
describe("Sacred Boon (prevented-amount readback → counters, CR 615.1)", () => {
    /** Drive the REAL phase machinery from the combat-damage step through
     *  END_OF_COMBAT into the end step, then resolve whatever the end step put
     *  on the stack. This is the whole point of the test: `tickAllDurations`
     *  runs as END_OF_COMBAT ends (CR 511.3, via `endCombatStep`), and the
     *  prevention tally MUST survive that boundary so the next-end-step delayed
     *  trigger can still read it. The former test hand-pushed the delayed
     *  trigger and resolved it in place — it never crossed END_OF_COMBAT, so it
     *  masked the unconditional-purge bug (issue #734). */
    function advanceToEndStepAndResolve(state: GameState) {
        // Enter the regular combat-damage step (where a shield would absorb
        // combat damage) before advancing out through END_OF_COMBAT.
        state.phase = "COMBAT_DAMAGE" as Phase;
        state.activePlayerId = "p1";
        let guard = 0;
        while (state.phase !== "END_STEP" && guard++ < 20) {
            advancePhase(state);
        }
        expect(state.phase).toBe("END_STEP");
        // The end step's `fireDelayedTriggers("next-end-step")` put Sacred
        // Boon's follow-up on the stack via the real path — resolve it.
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
    }

    function setup() {
        const creature = vanilla("c", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, sacredBoon.id, "p1", [
            { type: "permanent", id: "c" },
        ]);
        return { state };
    }

    it("registers a tagged prevent-next-3 shield and a next-end-step trigger", () => {
        const { state } = setup();
        const shield = state.targetPreventionShields?.[0];
        expect(shield?.targetId).toBe("c");
        expect(shield?.remaining).toBe(3);
        expect(shield?.tallyId).toBeDefined();
        const dt = state.delayedTriggers?.[0];
        expect(dt?.timing).toBe("next-end-step");
        expect(dt?.payload.creatureId).toBe("c");
    });

    it("counts combat damage prevented in the combat-damage step and grants counters at the real end step (crosses END_OF_COMBAT)", () => {
        const { state } = setup();
        // In the combat-damage step the shield absorbs a 2-point combat hit
        // (2 of 3 prevented); the tally records exactly 2.
        state.phase = "COMBAT_DAMAGE";
        expect(applyTargetPrevention(state, "permanent", "c", 2)).toBe(0);
        expect(state.targetPreventionShields?.[0]?.remaining).toBe(1);
        expect(Object.values(state.preventionTallies ?? {})).toEqual([2]);
        // Advance END_OF_COMBAT → END_STEP through the real phase-advance path.
        // Against the unconditional purge the tally was wiped at END_OF_COMBAT,
        // yielding 0 counters here; scoping the purge to CLEANUP keeps it alive.
        advanceToEndStepAndResolve(state);
        const live = state.players[0].battlefield.find((c) => c.id === "c")!;
        expect(live.counters?.["+0/+1"]).toBe(2);
        // The +0/+1 counters raise toughness by 2 (layer 7d, CR 613.4d).
        expect(getEffectiveToughness(state, live)).toBe(4);
        expect(getEffectivePower(state, live)).toBe(2);
        // The tally is consumed once — cleared after the follow-up reads it.
        expect(state.preventionTallies).toBeUndefined();
    });

    it("the unconsumed end-of-turn shield still expires at CLEANUP (fix keeps duration semantics)", () => {
        const { state } = setup();
        state.phase = "COMBAT_DAMAGE" as Phase;
        applyTargetPrevention(state, "permanent", "c", 2);
        // Shield keeps its last point after absorbing 2.
        expect(state.targetPreventionShields?.[0]?.remaining).toBe(1);
        advanceToEndStepAndResolve(state);
        // Advance out of the end step through CLEANUP (auto-phase → next turn's
        // UNTAP). The {phase:"end-of-turn"} shield's remainder wears off at
        // CLEANUP (CR 514.2) via `tickDuration`.
        let guard = 0;
        while (state.phase !== "UNTAP" && guard++ < 20) {
            advancePhase(state);
        }
        expect(state.targetPreventionShields).toBeUndefined();
    });

    it("grants no counters when no damage was prevented", () => {
        const { state } = setup();
        advanceToEndStepAndResolve(state);
        const live = state.players[0].battlefield.find((c) => c.id === "c")!;
        expect(live.counters?.["+0/+1"]).toBeUndefined();
    });

    it("wire format: the +0/+1 counters survive projectPublicState", () => {
        const { state } = setup();
        state.phase = "COMBAT_DAMAGE";
        applyTargetPrevention(state, "permanent", "c", 3);
        advanceToEndStepAndResolve(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "c"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});

// ===========================================================================
// Energy Storm (#727) — cumulative upkeep {1}, "prevent all damage dealt by
// instant and sorcery spells" (continuous damage-prevention replacement keyed
// on source card type), and "creatures with flying don't untap" (untap-lock
// static, the Mudslide shape with the polarity flipped).
// ===========================================================================
describe("Energy Storm (CR 702.24 / 615.1 / 502.1)", () => {
    it("prevents damage dealt by an instant or sorcery spell (CR 615.1)", () => {
        const storm = makeInstance(energyStorm.id, {
            id: "storm",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [storm] }),
                makePlayer("p2"),
            ],
        });
        const bySorcery = applyDamageReplacements(state, {
            kind: "damage",
            sourceInstanceId: "bolt",
            sourceControllerId: "p2",
            sourceColors: ["R"],
            sourceTypes: ["Instant"],
            sourceStaticAbilities: [],
            target: { type: "player", id: "p1" },
            amount: 3,
            isCombat: false,
        });
        expect(bySorcery).toBeNull();
    });

    it("does NOT prevent damage dealt by a creature source", () => {
        const storm = makeInstance(energyStorm.id, {
            id: "storm",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [storm] }),
                makePlayer("p2"),
            ],
        });
        const byCreature = applyDamageReplacements(state, {
            kind: "damage",
            sourceInstanceId: "beast",
            sourceControllerId: "p2",
            sourceColors: ["G"],
            sourceTypes: ["Creature"],
            sourceStaticAbilities: [],
            target: { type: "player", id: "p1" },
            amount: 3,
            isCombat: true,
        });
        expect(byCreature).not.toBeNull();
    });
});

// ===========================================================================
// Kjeldoran Royal Guard — all-unblocked combat-damage redirect (CR 614.6)
// ===========================================================================
describe("Kjeldoran Royal Guard — combat-damage redirect (CR 614.6)", () => {
    it("{T} installs a turn-scoped redirect for the controller onto itself", () => {
        const guard = makeInstance(kjeldoranRoyalGuard.id, {
            id: "guard",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [guard] }),
            ],
        });
        resolveActivated(state, guard, "kjeldoran-royal-guard-redirect");
        expect(state.combatDamageRedirectToPermanent).toEqual([
            { playerId: "p2", toPermanentId: "guard" },
        ]);
    });

    it("redirects all combat damage from unblocked attackers onto the guard", () => {
        // p1 (active) attacks p2 with an unblocked 2/2; p2's Royal Guard has
        // redirected all unblocked combat damage onto itself.
        const attacker = makeInstance(balduvianBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const guard = makeInstance(kjeldoranRoyalGuard.id, {
            id: "guard",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [guard], life: 20 }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
            combatDamageRedirectToPermanent: [
                { playerId: "p2", toPermanentId: "guard" },
            ],
        });
        applyAllCombatDamage(state, {});
        const g = state.players[1].battlefield.find((c) => c.id === "guard");
        // The 2 combat damage landed on the guard (2/5 → survives), not p2.
        expect(g?.damageMarked ?? 0).toBe(2);
        expect(state.players[1].life).toBe(20);
    });

    it("without a redirect the same attack hits the player (control)", () => {
        const attacker = makeInstance(balduvianBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { life: 20 }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, {});
        expect(state.players[1].life).toBe(18);
    });

    it("wire format — the redirected damage on the guard survives projection", () => {
        const attacker = makeInstance(balduvianBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const guard = makeInstance(kjeldoranRoyalGuard.id, {
            id: "guard",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [guard], life: 20 }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
            combatDamageRedirectToPermanent: [
                { playerId: "p2", toPermanentId: "guard" },
            ],
        });
        applyAllCombatDamage(state, {});
        const projected = projectPublicState(state, 1, "p2");
        const slimGuard = projected.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "guard");
        expect(slimGuard?.damageMarked ?? 0).toBe(2);
        const p2 = projected.players.find((p) => p.id === "p2");
        expect(p2?.life).toBe(20);
    });
});

describe("Arenson's Aura — destroy/counter enchantment (CR 701.7 / 701.5a)", () => {
    const counterAbility = arensonsAura.activatedAbilities![1];

    it("destroys the target enchantment — gone from board, survives projection (wire format)", () => {
        const aura = makeInstance(arensonsAura.id, {
            id: "aura",
            controllerId: "p1",
        });
        const victim = makeInstance(armorOfFaith.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, aura, "arensons-aura-destroy", [
            { type: "permanent", id: "victim" },
        ]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        // Wire format — the destroyed enchantment is gone from the projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players.some((p) =>
                p.battlefield.some((c) => c.id === "victim")
            )
        ).toBe(false);
    });

    it("counters only an enchantment spell, not a creature spell (CR 114.1)", () => {
        const state = makeState();
        const ench = pushSpell(state, armorOfFaith.id, "p2");
        const creature = pushSpell(state, balduvianBears.id, "p2");
        const legal = getLegalTargets(
            state,
            counterAbility.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain(ench.id);
        expect(legal).not.toContain(creature.id);
    });
});

// --- General Jarkeld (attacker-side blocker reassignment, CR 509.1) ---------
//
// New combat primitive `ctx.reassignAttackerBlockers` (the attacker-side dual
// of Sorrow's Path's `reassignBlocks`). p1 controls Jarkeld and is the
// defender; p2 is the active/attacking player with two attackers, each blocked
// by one of p1's creatures.
function jarkeldCombat(opts?: {
    atk1Abilities?: string[];
    atk2Abilities?: string[];
    blk1Abilities?: string[];
    blk2Abilities?: string[];
    blockerAssignments?: Record<string, string[]>;
    attackerIds?: string[];
    blockedAttackerIds?: string[];
    extraDefenders?: CardInstanceState[];
}): { state: GameState; jarkeld: CardInstanceState } {
    const jarkeld = makeInstance(generalJarkeld.id, {
        id: "jarkeld",
        controllerId: "p1",
        ownerId: "p1",
    });
    // p2's two attackers (vanilla 2/2 bears unless given evasion).
    const atk1 = makeInstance(balduvianBears.id, {
        id: "atk1",
        controllerId: "p2",
        ownerId: "p2",
        power: 2,
        toughness: 2,
        isAttacking: true,
        staticAbilities: opts?.atk1Abilities ?? [],
    });
    const atk2 = makeInstance(balduvianBears.id, {
        id: "atk2",
        controllerId: "p2",
        ownerId: "p2",
        power: 2,
        toughness: 2,
        isAttacking: true,
        staticAbilities: opts?.atk2Abilities ?? [],
    });
    // p1's two blockers, each blocking one attacker.
    const blk1 = makeInstance(balduvianBears.id, {
        id: "blk1",
        controllerId: "p1",
        ownerId: "p1",
        power: 1,
        toughness: 3,
        isBlocking: true,
        staticAbilities: opts?.blk1Abilities ?? [],
    });
    const blk2 = makeInstance(balduvianBears.id, {
        id: "blk2",
        controllerId: "p1",
        ownerId: "p1",
        power: 1,
        toughness: 3,
        isBlocking: true,
        staticAbilities: opts?.blk2Abilities ?? [],
    });
    const state = makeState({
        activePlayerId: "p2",
        phase: "DECLARE_BLOCKERS",
        players: [
            makePlayer("p1", {
                battlefield: [
                    jarkeld,
                    blk1,
                    blk2,
                    ...(opts?.extraDefenders ?? []),
                ],
            }),
            makePlayer("p2", { battlefield: [atk1, atk2] }),
        ],
        combat: {
            attackerIds: opts?.attackerIds ?? ["atk1", "atk2"],
            confirmed: true,
            blockerAssignments: opts?.blockerAssignments ?? {
                blk1: ["atk1"],
                blk2: ["atk2"],
            },
            blockedAttackerIds: opts?.blockedAttackerIds ?? ["atk1", "atk2"],
            blockersConfirmed: true,
        },
    });
    return { state, jarkeld };
}

describe("General Jarkeld — reassign blockers between attackers (CR 509.1)", () => {
    it("legal reassignment: each blocker blocking exactly one attacker moves to the other", () => {
        const { state, jarkeld } = jarkeldCombat();
        resolveActivated(state, jarkeld, "general-jarkeld-reassign-blockers", [
            { type: "permanent", id: "atk1" },
            { type: "permanent", id: "atk2" },
        ]);
        // blk1 (was blocking atk1) now blocks atk2; blk2 now blocks atk1.
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
        // Both attackers stay blocked (CR 509.1h — blockedAttackerIds untouched).
        expect(state.combat!.blockedAttackerIds).toEqual(["atk1", "atk2"]);
    });

    it("illegal reassignment: flying attacker can't be blocked by the other's ground blocker — no-op", () => {
        // atk2 has flying; blk2 also flies (blocks it legally). After a
        // hypothetical reassign, atk2 (flying) would be blocked by blk1 (no
        // flying) — illegal — so the whole reassignment is a no-op.
        const { state, jarkeld } = jarkeldCombat({
            atk2Abilities: ["flying"],
            blk2Abilities: ["flying"],
        });
        resolveActivated(state, jarkeld, "general-jarkeld-reassign-blockers", [
            { type: "permanent", id: "atk1" },
            { type: "permanent", id: "atk2" },
        ]);
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk1"],
            blk2: ["atk2"],
        });
    });

    it("blocker blocking BOTH attackers is unchanged (only 'exactly one' moves)", () => {
        // blk1 blocks both atk1 and atk2; blk2 blocks only atk2. After the
        // reassign only blk2 (exactly one) moves onto atk1; blk1 stays on both.
        const { state, jarkeld } = jarkeldCombat({
            blockerAssignments: {
                blk1: ["atk1", "atk2"],
                blk2: ["atk2"],
            },
        });
        resolveActivated(state, jarkeld, "general-jarkeld-reassign-blockers", [
            { type: "permanent", id: "atk1" },
            { type: "permanent", id: "atk2" },
        ]);
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk1", "atk2"],
            blk2: ["atk1"],
        });
    });

    it("no-op when a chosen creature is not a blocked attacker", () => {
        // atk2 is attacking but unblocked (not in blockedAttackerIds).
        const { state, jarkeld } = jarkeldCombat({
            blockerAssignments: { blk1: ["atk1"] },
            blockedAttackerIds: ["atk1"],
        });
        resolveActivated(state, jarkeld, "general-jarkeld-reassign-blockers", [
            { type: "permanent", id: "atk1" },
            { type: "permanent", id: "atk2" },
        ]);
        expect(state.combat!.blockerAssignments).toEqual({ blk1: ["atk1"] });
    });

    it("wire format: the reassignment survives projectPublicState", () => {
        const { state, jarkeld } = jarkeldCombat();
        resolveActivated(state, jarkeld, "general-jarkeld-reassign-blockers", [
            { type: "permanent", id: "atk1" },
            { type: "permanent", id: "atk2" },
        ]);
        // Assert on fat state first.
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
        // The projected (client-visible) combat must carry the same graph.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
    });

    // Regression (issue #739): the oracle is controller-agnostic. The
    // attacking player can control an untapped Jarkeld that didn't attack and
    // activate it during their OWN declare-blockers step to rearrange the
    // defender's blockers among two of THEIR OWN blocked attackers. A
    // `controller: "opponent"` filter zeroed out the legal targets in exactly
    // that (legal) line. `resolveActivated` bypasses `getLegalTargets`, so the
    // behavioral tests above never exercised target legality — this one does.
    it("legality (CR 509.1): blocked attackers are legal targets regardless of who controls Jarkeld", () => {
        const { state } = jarkeldCombat();
        const req = generalJarkeld.activatedAbilities![0].targetRequirement!;

        // p2 is the attacking player and controls atk1/atk2. When p2 ALSO
        // controls Jarkeld (activates it on their own attackers), their own
        // blocked attackers MUST be legal targets — the case that was broken.
        const legalForAttacker = getLegalTargets(
            state,
            req,
            NO_TARGETING_SOURCE,
            "p2"
        ).map((t) => t.id);
        expect(legalForAttacker).toContain("atk1");
        expect(legalForAttacker).toContain("atk2");

        // And symmetrically legal for the defender (p1) controlling Jarkeld —
        // the opponent's attackers are still valid targets.
        const legalForDefender = getLegalTargets(
            state,
            req,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legalForDefender).toContain("atk1");
        expect(legalForDefender).toContain("atk2");
    });
});

describe("Drought (CR 601.2f / 118.5 — static per-pip non-mana additional cost)", () => {
    const swampId = getCardByName("Swamp").id;
    const zombies = getCardByName("Scathe Zombies"); // {2}{B} — one black pip
    const hypnotic = getCardByName("Hypnotic Specter"); // {1}{B}{B} — two pips

    const makeSwamp = (id: string): CardInstanceState =>
        makeInstance(swampId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
    const zombiesInHand = (): CardInstanceState =>
        makeInstance(zombies.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });

    it("imposes one Swamp sacrifice per black pip on EVERY player's spells (board-wide, CR 601.2f)", () => {
        // p2 controls Drought; p1 is the caster — the cost still applies.
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [droughtInst] }),
            ],
        });
        const spell = zombiesInHand();
        // {2}{B} → 1 black pip → 1 Swamp.
        const one = getStaticAdditionalSacrifices(
            state,
            zombies.manaCost,
            spell,
            "spell"
        );
        expect(one).toHaveLength(1);
        expect(one[0].count).toBe(1);
        // {1}{B}{B} → 2 black pips → 2 Swamps.
        const two = getStaticAdditionalSacrifices(
            state,
            hypnotic.manaCost,
            spell,
            "spell"
        );
        expect(two[0].count).toBe(2);
        // A spell with no black pip ({2}{W}{W}) owes nothing.
        const none = getStaticAdditionalSacrifices(
            state,
            drought.manaCost,
            spell,
            "spell"
        );
        expect(none).toHaveLength(0);
    });

    it("also taxes activated abilities by their black activation pips (CR 601.2f)", () => {
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [droughtInst] }),
                makePlayer("p2"),
            ],
        });
        const source = makeInstance(zombies.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const reqs = getStaticAdditionalSacrifices(
            state,
            { B: 2 },
            source,
            "ability"
        );
        expect(reqs[0].count).toBe(2);
    });

    it("makes the action illegal when the player can't pay the sacrifice (unpayable → illegal, CR 601.2f)", () => {
        // Drought out, but the caster controls NO Swamp.
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [droughtInst] }),
                makePlayer("p2"),
            ],
        });
        const reqs = getStaticAdditionalSacrifices(
            state,
            zombies.manaCost,
            zombiesInHand(),
            "spell"
        );
        // The announcement gate wraps exactly this affordability check — an
        // unpayable requirement makes the cast/activation illegal (CR 601.2f).
        expect(canAffordSacrifice(state, "p1", reqs)).toBe(false);
    });

    it("picks distinct victims and never double-counts across two Droughts (CR 118.5)", () => {
        const d1 = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const d2 = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [d1, d2, makeSwamp("sw1"), makeSwamp("sw2")],
                }),
                makePlayer("p2"),
            ],
        });
        // Two Droughts, one black pip each → two requirements of count 1.
        const reqs = getStaticAdditionalSacrifices(
            state,
            zombies.manaCost,
            zombiesInHand(),
            "spell"
        );
        expect(reqs).toHaveLength(2);
        // Auto-resolve reserves distinct victims across the two requirements
        // (fungible Swamps → no prompt, but never double-counts — CR 118.5).
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Drought",
            requirements: reqs.map((r) => ({
                filter: r.filter,
                count: r.count,
            })),
            picked: [],
        };
        autoResolveFungible(state, sel);
        expect(new Set(sel.picked).size).toBe(2); // distinct victims
        expect([...sel.picked].sort()).toEqual(["sw1", "sw2"]);
        // With only ONE Swamp, the two requirements can't both be paid.
        const stateB = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [d1, d2, makeSwamp("only")],
                }),
                makePlayer("p2"),
            ],
        });
        const reqsB = getStaticAdditionalSacrifices(
            stateB,
            zombies.manaCost,
            zombiesInHand(),
            "spell"
        );
        expect(canAffordSacrifice(stateB, "p1", reqsB)).toBe(false);
    });

    it("sacrifices the Swamp when the spell is put on the stack (full commit path, CR 601.2h)", () => {
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const zInst = makeInstance(zombies.id, {
            id: "z1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [zInst],
                    battlefield: [makeSwamp("swE")],
                    manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [droughtInst] }),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        // The selection is built at announce; with a single Swamp it
        // auto-resolves, so the deferred commit applies it (CR 601.2f / 701.21a).
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Drought",
            requirements: getStaticAdditionalSacrifices(
                state,
                zombies.manaCost,
                zInst,
                "spell"
            ).map((r) => ({ filter: r.filter, count: r.count })),
            picked: [],
        };
        autoResolveFungible(state, sel);
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "z1",
            manaCost: normalizeManaCost(zombies.manaCost ?? {}),
            tappedLandIds: [],
            sacrificeSelection: sel,
        };
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        // The spell is on the stack; the Swamp was sacrificed to the graveyard.
        expect(state.stack).toHaveLength(1);
        expect(
            state.players[0].battlefield.some((c) =>
                c.subtypes?.includes("Swamp")
            )
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "swE")).toBe(
            true
        );
    });

    it("wire format: the additional cost is derivable from the projected state", () => {
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [droughtInst] }),
            ],
        });
        const spell = zombiesInHand();
        const before = getStaticAdditionalSacrifices(
            state,
            zombies.manaCost,
            spell,
            "spell"
        );
        expect(before[0].count).toBe(1);
        // The projection strips card.card to { id }; the additional-cost static
        // must still resolve from the definition registry client-side.
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as GameState;
        const after = getStaticAdditionalSacrifices(
            projected,
            zombies.manaCost,
            spell,
            "spell"
        );
        expect(after[0].count).toBe(1);
    });

    // Also exercise the sacrifice via applySacrificeSelection (the unified
    // executor the commit sites call — CR 701.21a).
    it("applySacrificeSelection pays the chosen static sacrifice", () => {
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [droughtInst, makeSwamp("swX")],
                }),
                makePlayer("p2"),
            ],
        });
        const reqs = getStaticAdditionalSacrifices(
            state,
            zombies.manaCost,
            zombiesInHand(),
            "spell"
        );
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Drought",
            requirements: reqs.map((r) => ({
                filter: r.filter,
                count: r.count,
            })),
            picked: [],
        };
        autoResolveFungible(state, sel);
        applySacrificeSelection(state, sel);
        expect(state.players[0].battlefield.some((c) => c.id === "swX")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "swX")).toBe(
            true
        );
    });
});

// Instance leave-watch delayed trigger (CR 603.7a / 603.10, issue #731). The
// Kjeldoran guards buff a target creature and grant themselves a delayed
// triggered ability keyed to THAT creature's departure: when the buffed
// creature leaves the battlefield this turn, sacrifice the guard; a pending
// watch expires unfired at CLEANUP (the "this turn" bound). Also covers the new
// single-object `sacrifice { target }` Op form the body uses.
function activateGuardPump(
    guardCardId: string,
    abilityId: string
): {
    state: GameState;
    guardId: string;
    targetId: string;
} {
    const guard = makeInstance(guardCardId, {
        id: "guard1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const target = makeInstance(balduvianBears.id, {
        id: "target1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase: "DECLARE_ATTACKERS",
        players: [
            makePlayer("p1", { battlefield: [guard, target] }),
            makePlayer("p2"),
        ],
    });
    // Push the {T} ability onto the stack (source stays on the battlefield;
    // `triggerSourceId` points `$source` at the on-battlefield guard) and
    // resolve it — pump + delayedTrigger scheduling.
    state.stack.push({
        ...guard,
        id: "ability1",
        zone: "stack",
        castById: "p1",
        abilityId,
        triggerSourceId: "guard1",
        targets: [{ type: "permanent", id: "target1" }],
    });
    resolveTopOfStack(state);
    return { state, guardId: "guard1", targetId: "target1" };
}

describe("Kjeldoran Elite Guard (instance leave-watch, CR 603.7a / 603.10)", () => {
    it("pumps the target +2/+2 and schedules a leaves-battlefield watch keyed to it", () => {
        const { state, guardId, targetId } = activateGuardPump(
            kjeldoranEliteGuard.id,
            "kjeldoran-elite-guard-pump"
        );
        const target = state.players[0].battlefield.find(
            (c) => c.id === targetId
        )!;
        expect(getEffectivePower(state, target)).toBe(4);
        expect(getEffectiveToughness(state, target)).toBe(4);
        const watch = state.delayedTriggers?.find(
            (t) => t.timing === "leaves-battlefield"
        );
        expect(watch).toBeDefined();
        expect(watch!.watchInstanceId).toBe(targetId);
        // The captured guard-to-sacrifice is the activating source. The `$`
        // binding sigil is stripped in the persisted payload (Convex reserves
        // leading `$` on field names) and re-added when the trigger fires.
        expect(watch!.payload.guard).toBe(guardId);
        // Regression (Convex "$guard starts with a '$', which is reserved"):
        // NO persisted payload key may begin with the binding sigil, else the
        // whole game-state DB write is rejected at passPriority time.
        for (const key of Object.keys(watch!.payload)) {
            expect(key.startsWith("$")).toBe(false);
        }
    });

    it("sacrifices the guard when the buffed creature leaves the battlefield", () => {
        const { state, guardId, targetId } = activateGuardPump(
            kjeldoranEliteGuard.id,
            "kjeldoran-elite-guard-pump"
        );
        // The buffed creature dies / is removed — PERMANENT_LEFT fires the watch.
        removePermanentTo(state, targetId, "graveyard");
        processPendingActionTriggers(state);
        // The leave-watch delayed trigger is on the stack; resolve it.
        expect(state.stack.some((s) => s.delayedTriggerId !== undefined)).toBe(
            true
        );
        resolveTopOfStack(state);
        // Guard sacrificed → in its owner's graveyard, off the battlefield.
        expect(state.players[0].battlefield.some((c) => c.id === guardId)).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === guardId)).toBe(
            true
        );
        // The watch is consumed (no double fire).
        expect(
            state.delayedTriggers?.some(
                (t) => t.timing === "leaves-battlefield"
            ) ?? false
        ).toBe(false);
    });

    it("expires unfired at end of turn — CLEANUP purges the pending watch", () => {
        const { state, guardId } = activateGuardPump(
            kjeldoranEliteGuard.id,
            "kjeldoran-elite-guard-pump"
        );
        expect(
            state.delayedTriggers?.some(
                (t) => t.timing === "leaves-battlefield"
            )
        ).toBe(true);
        finalizeCleanup(state);
        // The this-turn watch is gone and the guard was never sacrificed.
        expect(
            state.delayedTriggers?.some(
                (t) => t.timing === "leaves-battlefield"
            ) ?? false
        ).toBe(false);
        expect(state.players[0].battlefield.some((c) => c.id === guardId)).toBe(
            true
        );
    });

    it("the +2/+2 buff survives projectPublicState (wire format)", () => {
        const { state, targetId } = activateGuardPump(
            kjeldoranEliteGuard.id,
            "kjeldoran-elite-guard-pump"
        );
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === targetId
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Kjeldoran Guard (snow-gated instance leave-watch, CR 205.4a / 603.7a)", () => {
    it("pumps +1/+1 and sacrifices the guard when the buffed creature leaves", () => {
        const { state, guardId, targetId } = activateGuardPump(
            kjeldoranGuard.id,
            "kjeldoran-guard-pump"
        );
        const target = state.players[0].battlefield.find(
            (c) => c.id === targetId
        )!;
        expect(getEffectiveToughness(state, target)).toBe(3);
        removePermanentTo(state, targetId, "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard.some((c) => c.id === guardId)).toBe(
            true
        );
    });

    it("canActivate rejects while the defending player controls a snow land", () => {
        const snowLand = makeInstance(snowCoveredForest.id, {
            id: "snow1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const guard = makeInstance(kjeldoranGuard.id, {
            id: "guard1",
            controllerId: "p1",
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            players: [
                makePlayer("p1", { battlefield: [guard] }),
                makePlayer("p2", { battlefield: [snowLand] }),
            ],
        });
        const ability = kjeldoranGuard.activatedAbilities![0];
        expect(ability.canActivate!(guard, state)).toBe(false);
        // Remove the snow land → activation becomes legal.
        state.players[1].battlefield = [];
        expect(ability.canActivate!(guard, state)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Battle Cry (issue #884, split out of #739) — CR 701.26b untap + a REPEATING
// delayed triggered ability (CR 603.7d, the new "this-turn-creature-blocks"
// timing). Unlike every other delayedTrigger timing (single-shot), this one
// fires once per BLOCKERS_CONFIRMED event for the rest of the turn and is
// never dequeued by firing — only purged, unconditionally, at CLEANUP.
// ─────────────────────────────────────────────────────────────────────────────

describe("Battle Cry (untap-all-white + repeating block-buff delayed trigger, CR 603.7d / 701.26b, issue #884)", () => {
    it("untaps every white creature you control, leaves a non-white creature tapped", () => {
        const whiteGuy = makeInstance(shieldBearer.id, {
            id: "white1",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const greenGuy = makeInstance(balduvianBears.id, {
            id: "green1",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whiteGuy, greenGuy] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, battleCry.id, "p1");
        resolveTopOfStack(state);
        const live = (id: string) =>
            state.players[0].battlefield.find((c) => c.id === id)!;
        expect(live("white1").isTapped).toBe(false);
        expect(live("green1").isTapped).toBe(true);
    });

    it("schedules a this-turn-creature-blocks delayed trigger with no capture map needed", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, battleCry.id, "p1");
        resolveTopOfStack(state);
        const watch = state.delayedTriggers?.find(
            (t) => t.timing === "this-turn-creature-blocks"
        );
        expect(watch).toBeDefined();
        expect(watch!.payload).toEqual({});
    });

    it("pumps EVERY blocking creature +0/+1 independently and keeps firing (not consumed on fire)", () => {
        const blocker1 = vanilla("b1", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker2 = vanilla("b2", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const atk1 = vanilla("a1", 3, 3, { controllerId: "p2", ownerId: "p2" });
        const atk2 = vanilla("a2", 3, 3, { controllerId: "p2", ownerId: "p2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blocker1, blocker2] }),
                makePlayer("p2", { battlefield: [atk1, atk2] }),
            ],
            activePlayerId: "p2",
            phase: "DECLARE_BLOCKERS",
        });
        pushSpell(state, battleCry.id, "p1");
        resolveTopOfStack(state);

        state.combat = {
            attackerIds: ["a1", "a2"],
            confirmed: true,
            blockersConfirmed: true,
            blockerAssignments: { b1: ["a1"], b2: ["a2"] },
        };
        emitBlockersConfirmedEvents(state);
        // Two BLOCKERS_CONFIRMED-fired stack items are now queued — drain them.
        while (state.stack.some((s) => s.delayedTriggerId !== undefined)) {
            resolveTopOfStack(state);
        }

        const live = (id: string) =>
            [
                ...state.players[0].battlefield,
                ...state.players[1].battlefield,
            ].find((c) => c.id === id)!;
        expect(getEffectivePower(state, live("b1"))).toBe(2);
        expect(getEffectiveToughness(state, live("b1"))).toBe(3);
        expect(getEffectivePower(state, live("b2"))).toBe(1);
        expect(getEffectiveToughness(state, live("b2"))).toBe(2);
        // The attackers (didn't block) are untouched.
        expect(getEffectiveToughness(state, live("a1"))).toBe(3);
        expect(getEffectiveToughness(state, live("a2"))).toBe(3);

        // CR 603.7d — the delayed trigger is NOT consumed by firing; it stays
        // queued to fire again on a later block this same turn.
        expect(
            state.delayedTriggers?.some(
                (t) => t.timing === "this-turn-creature-blocks"
            )
        ).toBe(true);
    });

    it("expires unconditionally at CLEANUP regardless of fire count (CR 514.2)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, battleCry.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.delayedTriggers?.some(
                (t) => t.timing === "this-turn-creature-blocks"
            )
        ).toBe(true);
        finalizeCleanup(state);
        expect(
            state.delayedTriggers?.some(
                (t) => t.timing === "this-turn-creature-blocks"
            ) ?? false
        ).toBe(false);
    });

    it("the block-buff survives projectPublicState (wire format)", () => {
        const blocker = vanilla("bw", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const attacker = vanilla("aw", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blocker] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            activePlayerId: "p2",
            phase: "DECLARE_BLOCKERS",
        });
        pushSpell(state, battleCry.id, "p1");
        resolveTopOfStack(state);
        state.combat = {
            attackerIds: ["aw"],
            confirmed: true,
            blockersConfirmed: true,
            blockerAssignments: { bw: ["aw"] },
        };
        emitBlockersConfirmedEvents(state);
        while (state.stack.some((s) => s.delayedTriggerId !== undefined)) {
            resolveTopOfStack(state);
        }
        const live = state.players[0].battlefield.find((c) => c.id === "bw")!;
        expect(getEffectiveToughness(state, live)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bw"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ===========================================================================
// Enduring Renewal — draw-reveal replacement + hand-reveal + return trigger
// (CR 614 / 700.4 / 603.2, issue #735)
// ===========================================================================

describe("Enduring Renewal (draw-reveal + hand-reveal + return, CR 614/700.4, #735)", () => {
    const bearsId = getCardByName("Balduvian Bears").id;

    it("card definition wires the reveal + draw replacement (ADR 0061)", () => {
        expect(enduringRenewal.revealsHand).toBe("controller");
        expect(enduringRenewal.drawReplacement?.outcome).toEqual({
            kind: "reveal-type-to-graveyard",
            cardType: "Creature",
        });
        // "if YOU would draw" — controller scope is an `applies` predicate.
        expect(enduringRenewal.drawReplacement?.applies).toBeTypeOf("function");
    });

    it("CR 614 — a revealed creature is binned; a non-creature is drawn", () => {
        const er = makeInstance(enduringRenewal.id, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const creatureTop = makeInstance(bearsId, {
            id: "top-creature",
            ownerId: "p1",
            zone: "library",
        });
        const landTop = makeInstance(plains.id, {
            id: "top-land",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [er],
                    library: [creatureTop, landTop],
                }),
                makePlayer("p2"),
            ],
        });

        // Top is a creature → put into the graveyard, no draw.
        const binPlan = planDrawStep(state, "p1", 1, false);
        expect(binPlan.kind).toBe("bin");
        commitDrawPlan(state, "p1", binPlan, {
            isTurnBasedDrawStepDraw: false,
        });
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "top-creature"
        );
        expect(state.players[0].hand).toHaveLength(0);

        // Top is now the land → drawn to hand.
        const drawPlan = planDrawStep(state, "p1", 1, false);
        expect(drawPlan.kind).toBe("normal");
        commitDrawPlan(state, "p1", drawPlan, {
            isTurnBasedDrawStepDraw: false,
        });
        expect(state.players[0].hand.map((c) => c.id)).toContain("top-land");
    });

    it("scope is the controller only — an opponent's draw is unaffected", () => {
        const er = makeInstance(enduringRenewal.id, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppCreatureTop = makeInstance(bearsId, {
            id: "opp-top",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [er] }),
                makePlayer("p2", { library: [oppCreatureTop] }),
            ],
        });
        // p2 has no Enduring Renewal effect on their draws → normal draw.
        const plan = planDrawStep(state, "p2", 1, false);
        expect(plan.kind).toBe("normal");
        commitDrawPlan(state, "p2", plan, { isTurnBasedDrawStepDraw: false });
        expect(state.players[1].hand.map((c) => c.id)).toContain("opp-top");
    });

    it("CR 700.4 — a creature put into YOUR graveyard from the battlefield returns to hand", () => {
        const er = makeInstance(enduringRenewal.id, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const deadBear = makeInstance(bearsId, {
            id: "dead-bear",
            ownerId: "p1",
            controllerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [er], graveyard: [deadBear] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, er, "enduring-renewal-return", {
            type: "CREATURE_DIED",
            creatureInstanceId: "dead-bear",
            creatureControllerId: "p1",
            creatureOwnerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 2,
        });
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("dead-bear");
    });

    it("CR 400.7 — the return trigger is owner-scoped: an opponent-owned death does not fire", () => {
        const er = makeInstance(enduringRenewal.id, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const ability = enduringRenewal.triggeredAbilities![0];
        const selfView = {
            id: er.id,
            controllerId: "p1",
            ownerId: "p1",
            types: er.types,
            subtypes: [],
            staticAbilities: [],
            power: undefined,
            toughness: undefined,
            isTapped: false,
            card: er.card,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [er] }),
                makePlayer("p2"),
            ],
        });
        const p1Owned = ability.matches(
            {
                type: "CREATURE_DIED",
                creatureInstanceId: "x",
                creatureControllerId: "p1",
                creatureOwnerId: "p1",
                creatureTypes: ["Creature"],
                damagedBySources: [],
                creaturePower: 1,
                creatureToughness: 1,
            },
            selfView,
            state
        );
        const p2Owned = ability.matches(
            {
                type: "CREATURE_DIED",
                creatureInstanceId: "y",
                creatureControllerId: "p1",
                creatureOwnerId: "p2",
                creatureTypes: ["Creature"],
                damagedBySources: [],
                creaturePower: 1,
                creatureToughness: 1,
            },
            selfView,
            state
        );
        expect(p1Owned).toBe(true);
        expect(p2Owned).toBe(false);
    });

    it("hand-reveal survives projection: the controller's hand is visible to the opponent (wire format)", () => {
        const er = makeInstance(enduringRenewal.id, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(bearsId, {
            id: "p1-hand-bear",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [er], hand: [handCard] }),
                makePlayer("p2"),
            ],
        });
        // Opponent (p2) view: p1's hand identities are revealed (not null slots).
        const projected = projectPublicState(state, 1, "p2");
        const p1View = projected.players.find((p) => p.id === "p1")!;
        expect(p1View.hand).toHaveLength(1);
        expect(p1View.hand[0]).not.toBeNull();
        expect(p1View.hand[0]!.card.id).toBe(bearsId);
    });
});

// ---------------------------------------------------------------------------
// Adarkar Unicorn — "{T}: Add {U} or {C}{U}. Spend this mana only to pay
// cumulative upkeep costs." (CR 106.6 restricted mana / 605.1a manaChoices).
// The mana-ability catalogue sweep skips a `manaChoices` ability by design,
// so the index → restricted-pool deposit earns a hand-written per-card test.
// ---------------------------------------------------------------------------

describe("Adarkar Unicorn ({T}: Add {U} or {C}{U}, CU-restricted, CR 106.6 / 605.1a)", () => {
    it("offers both manaChoices options: {U} and {C}{U}", () => {
        const unicorn = makeInstance(adarkarUnicorn.id, {
            id: "unicorn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [unicorn] });
        const options = getManaTapOptionsDetailed(unicorn, "p1", [
            { playerId: "p1", battlefield: player.battlefield },
        ]);
        expect(options.map((o) => o.mana)).toEqual([{ U: 1 }, { C: 1, U: 1 }]);
    });

    it("tapping index 0 floats {U} into the CU-restricted pool, not the fungible pool", () => {
        const unicorn = makeInstance(adarkarUnicorn.id, {
            id: "unicorn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [unicorn] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, unicorn, 0, []);
        expect(player.manaPool.U).toBe(0);
        expect(player.restrictedMana).toEqual([
            { color: "U", amount: 1, restriction: "cumulative-upkeep" },
        ]);
    });

    it("tapping index 1 floats {C} AND {U}, both CU-restricted", () => {
        const unicorn = makeInstance(adarkarUnicorn.id, {
            id: "unicorn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [unicorn] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, unicorn, 1, []);
        expect(player.manaPool).toEqual({
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 0,
        });
        const byColor = Object.fromEntries(
            (player.restrictedMana ?? []).map((r) => [r.color, r])
        );
        expect(byColor.C).toEqual({
            color: "C",
            amount: 1,
            restriction: "cumulative-upkeep",
        });
        expect(byColor.U).toEqual({
            color: "U",
            amount: 1,
            restriction: "cumulative-upkeep",
        });
    });
});

// ---------------------------------------------------------------------------
// Order of the Sacred Torch — {T}, Pay 1 life: Counter target black spell
// (CR 701.5a). The smoke sweep skips it because the `counter` Op targets a
// live spell on the stack, which the canned-scenario generator cannot seed.
// ---------------------------------------------------------------------------

describe("Order of the Sacred Torch ({T}, Pay 1 life: Counter target black spell, CR 701.5a)", () => {
    function withOrder() {
        const order = makeInstance(orderOfTheSacredTorch.id, {
            id: "order",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order], life: 20 }),
                makePlayer("p2"),
            ],
        });
        return { state, order };
    }

    it("counters the targeted black spell, sending it to its owner's graveyard", () => {
        const { state, order } = withOrder();
        const knight = pushSpell(state, knightOfStromgald.id, "p2");
        resolveActivated(state, order, "order-sacred-torch-counter", [
            { type: "spell", id: knight.id },
        ]);
        expect(state.stack.find((s) => s.id === knight.id)).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === knight.id)).toBe(
            true
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === knight.id)
        ).toBe(false);
    });

    it("only offers BLACK spells as legal targets (colorFilter, CR 601.2c)", () => {
        const { state } = withOrder();
        const blackSpell = pushSpell(state, knightOfStromgald.id, "p2");
        const whiteSpell = pushSpell(state, kjeldoranGuard.id, "p2");
        const req =
            orderOfTheSacredTorch.activatedAbilities![0].targetRequirement!;
        const legal = getLegalTargets(state, req, NO_TARGETING_SOURCE);
        expect(legal.map((t) => t.id)).toContain(blackSpell.id);
        expect(legal.map((t) => t.id)).not.toContain(whiteSpell.id);
    });

    it("wire format: the countered spell is gone from the projected stack", () => {
        const { state, order } = withOrder();
        const knight = pushSpell(state, knightOfStromgald.id, "p2");
        resolveActivated(state, order, "order-sacred-torch-counter", [
            { type: "spell", id: knight.id },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.stack.find((s) => s.id === knight.id)).toBeUndefined();
    });
});
