// Cost-system tests for ALTERNATIVE casting costs (CR 118.9) — the
// return-N-lands / sacrifice-N-lands variants that replace a spell's mana
// cost. Exercises the pure helpers in `convex/gre/alternativeCost.ts`:
// affordability (`canPayAlternativeCost`) and the player-chosen give-up
// (`buildAlternativeCostChoice`), which routes through the unified
// permanent-cost choice layer (`sacrificeChoice.ts`) so WHICH permanents pay is
// the caster's explicit choice — never a silent first-N slice (#983 follow-up).
// See per-card behaviour in the mmq (Gush/Thwart) and vis (Fireblast) set tests.

import { describe, it, expect } from "vitest";
import type {
    AlternativeCost,
    CardDefinition,
    CostLegs,
} from "../../cards/types";
import {
    canPayAlternativeCost,
    buildAlternativeCostChoice,
    buildCostLegsHandChoice,
    buildCostLegsPermanentChoice,
    getAlternativeCost,
    matchingPermanentsForAltCost,
} from "../alternativeCost";
import {
    applySacrificeSelection,
    isSacrificeSelectionComplete,
} from "../sacrificeChoice";
import {
    assertKickerPermanentSlotFree,
    buildCastPermanentCostChoice,
    resolveCastPermanentSelection,
} from "../kicker";
import {
    finalizeTargetSelection,
    assertStaticAdditionalCostAffordable,
    buildCastSacrificeSelection,
    castRawManaCost,
} from "../../game";
import { getPlayer, type GameState, type PendingTarget } from "../state";
import { registerTokenDefinition } from "../../cards";
import {
    island,
    mountain,
    forest,
    swamp,
    grizzlyBears,
} from "../../cards/sets/lea";
import { snuffOut } from "../../cards/sets/mmq/black";
import { drought } from "../../cards/sets/ice/white";
import { onceUponATime } from "../../cards/sets/eld/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const returnTwoIslands: AlternativeCost = {
    id: "return-two-islands",
    description: "Return two Islands you control to their owner's hand",
    permanent: { action: "return", count: 2, filter: { subtypes: "Island" } },
};

const sacrificeTwoMountains: AlternativeCost = {
    id: "sacrifice-two-mountains",
    description: "Sacrifice two Mountains",
    permanent: {
        action: "sacrifice",
        count: 2,
        filter: { subtypes: "Mountain" },
    },
};

function islandsFor(playerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(island.id, {
            id: `${playerId}-island-${i}`,
            controllerId: playerId,
            ownerId: playerId,
        })
    );
}

function mountainsFor(playerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(mountain.id, {
            id: `${playerId}-mountain-${i}`,
            controllerId: playerId,
            ownerId: playerId,
        })
    );
}

describe("alternative cost — matching permanents (CR 118.9)", () => {
    it("counts only the caster's permanents matching the filter", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 3) }),
                // An opponent's Island must NOT count toward the caster's cost.
                makePlayer("p2", { battlefield: islandsFor("p2", 5) }),
            ],
        });
        const matches = matchingPermanentsForAltCost(
            state.players[0],
            returnTwoIslands
        );
        expect(matches).toHaveLength(3);
        expect(matches.every((c) => c.controllerId === "p1")).toBe(true);
    });
});

describe("canPayAlternativeCost (CR 118.9)", () => {
    it("is payable when the caster controls enough matching permanents", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        expect(canPayAlternativeCost(state, "p1", returnTwoIslands)).toBe(true);
    });

    it("is NOT payable with too few matching permanents", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 1) }),
                makePlayer("p2"),
            ],
        });
        expect(canPayAlternativeCost(state, "p1", returnTwoIslands)).toBe(
            false
        );
    });
});

describe("buildAlternativeCostChoice — forced/fungible auto-resolves (CR 118.9 / 701.21a)", () => {
    it("pre-fills the picks when the caster controls exactly the required count", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            returnTwoIslands,
            "Gush"
        )!;
        // No real choice (2 Islands, must return 2) → auto-resolved + complete.
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
        expect(sel.picked).toHaveLength(2);
        expect(sel.action).toBe("return");
    });

    it("auto-resolves indistinguishable extras (fungible basics)", () => {
        // Three untapped, counter-free, unenchanted Islands returning 2 are
        // indistinguishable — the choice is not meaningful, so it auto-resolves.
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 3) }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            returnTwoIslands,
            "Gush"
        )!;
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
        expect(sel.picked).toHaveLength(2);
    });
});

describe("buildAlternativeCostChoice — real choice parks (CR 118.9 / 701.21a)", () => {
    it("leaves the choice incomplete when a distinguishable extra exists", () => {
        // Three Mountains, one tapped → the two untapped and the tapped one are
        // NOT indistinguishable, so which two to sacrifice is a real choice.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        ...mountainsFor("p1", 2),
                        makeInstance(mountain.id, {
                            id: "p1-mtn-tapped",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            sacrificeTwoMountains,
            "Fireblast"
        )!;
        // A real choice remains — no auto-pick; the caller parks the cast.
        expect(isSacrificeSelectionComplete(sel)).toBe(false);
        expect(sel.picked).toHaveLength(0);
        expect(sel.action).toBe("sacrifice");
    });
});

describe("applySacrificeSelection — alternative-cost terminal actions (CR 118.9)", () => {
    it("returns the picked permanents to their owner's hand (return)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: islandsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            returnTwoIslands,
            "Gush"
        )!;
        applySacrificeSelection(state, sel);
        const p1 = state.players[0];
        expect(p1.battlefield).toHaveLength(0);
        expect(p1.hand).toHaveLength(2);
        expect(p1.hand.every((c) => c.subtypes.includes("Island"))).toBe(true);
    });

    it("sacrifices the picked permanents to the graveyard (sacrifice)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: mountainsFor("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        const sel = buildAlternativeCostChoice(
            state,
            "p1",
            sacrificeTwoMountains,
            "Fireblast"
        )!;
        applySacrificeSelection(state, sel);
        const p1 = state.players[0];
        expect(p1.battlefield).toHaveLength(0);
        expect(p1.graveyard).toHaveLength(2);
    });
});

describe("merged cost legs must agree on their terminal action (CR 601.2f, issue #1937)", () => {
    // `buildCostLegs*Choice` is the point where an ALTERNATIVE cost's leg and a
    // paid KICKER's leg (CR 702.33a) become ONE selection/picker. The action
    // rides on that selection, not per requirement, so two legs disagreeing on
    // it cannot both be honoured. `resolveKickerPayments` reconciles
    // kicker-vs-kicker only and never sees this pairing — letting the first
    // leg's action win would silently bounce a permanent that should have been
    // sacrificed (or discard a card that should have been exiled).
    const returnLeg: CostLegs = {
        permanent: {
            action: "return" as const,
            filter: { subtypes: ["Island"] },
            count: 1,
        },
    };
    const sacrificeLeg: CostLegs = {
        permanent: {
            action: "sacrifice" as const,
            filter: { subtypes: ["Mountain"] },
            count: 1,
        },
    };

    it("throws on a return leg merged with a sacrifice leg", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(island.id, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "i1",
                        }),
                        makeInstance(mountain.id, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(() =>
            buildCostLegsPermanentChoice(
                state,
                "p1",
                [{ legs: returnLeg }, { legs: sacrificeLeg, explicit: true }],
                "Probe"
            )
        ).toThrow(/cannot be paid together/i);
        // Agreeing legs still merge into one selection.
        const ok = buildCostLegsPermanentChoice(
            state,
            "p1",
            [{ legs: sacrificeLeg }, { legs: sacrificeLeg, explicit: true }],
            "Probe"
        );
        expect(ok?.action).toBe("sacrifice");
        expect(ok?.requirements).toHaveLength(2);
    });

    it("throws on an exile hand leg merged with a discard hand leg", () => {
        const player = makePlayer("p1");
        const exileLeg: CostLegs = {
            hand: {
                action: "exile" as const,
                requirements: [{ filter: { type: "Creature" }, count: 1 }],
            },
        };
        const discardLeg: CostLegs = {
            hand: {
                action: "discard" as const,
                requirements: [{ filter: { type: "Land" }, count: 1 }],
            },
        };
        expect(() =>
            buildCostLegsHandChoice(player, [exileLeg, discardLeg], "x1")
        ).toThrow(/cannot be paid together/i);
        expect(
            buildCostLegsHandChoice(player, [exileLeg, exileLeg], "x1")?.action
        ).toBe("exile");
    });
});

describe("Alternative cost — the board-wide additional-cost sacrifice survives an alt-cost cast, targeted path (CR 601.2f / 118.5 / 118.9, issue #1985)", () => {
    // REGRESSION (issue #1985). `finalizeTargetSelection`'s single
    // permanent-cost slot used to gate on `chosenAltCost` and unconditionally
    // drop `additionalSac` whenever an alternative cost was chosen, on the
    // premise (recorded in PR #1979 / issue #1937) that "alt-cost cards carry
    // no additional cost of their own" — true, but Drought's is a BOARD-WIDE
    // cost (CR 118.5), not a card-owned one, so it applies to an alt-cost
    // cast exactly as CR 118.9d says any additional cost does: "any
    // additional costs … that affect that spell are applied to that
    // alternative cost." Snuff Out (`mmq/black.ts`, printed {X:3}{B}, one
    // black pip) cast under Drought while paying its "pay 4 life" pitch cost
    // is the shipped repro: the Swamp used to survive the alt-cost cast and
    // the spell still reached the stack unpaid.
    function snuffOutUnderDrought(useAltCost: boolean) {
        const snuff = makeInstance(snuffOut.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "snuffD",
        });
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "drought2",
        });
        const swampInst = makeInstance(swamp.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "swamp2",
        });
        const victim = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "victimSnuff",
            power: 2,
            toughness: 2,
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [snuff],
                    battlefield: [droughtInst, swampInst],
                    life: 20,
                    // 4 black covers the un-pitched {X:3}{B}; unused when the
                    // alt cost (4 life, no mana) is chosen instead.
                    manaPool: { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "snuffD",
            targetType: ["Creature"],
            count: 1,
            selected: [{ type: "permanent", id: "victimSnuff" }],
            ...(useAltCost ? { alternativeCostId: "pitch-pay-4-life" } : {}),
        };
        finalizeTargetSelection(state, pt, "p1");
        return state;
    }

    it("sacrifices the Swamp on a MANA-paid cast (baseline, byte-identical)", () => {
        const state = snuffOutUnderDrought(false);
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.some((c) => c.id === "swamp2")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "swamp2")).toBe(true);
        expect(state.stack.some((s) => s.id === "snuffD")).toBe(true);
    });

    it("STILL sacrifices the Swamp on an ALT-COST (pitch) cast", () => {
        const state = snuffOutUnderDrought(true);
        const p1 = getPlayer(state, "p1");
        // Before the fix the Swamp survived and the spell reached the stack
        // anyway — an alt-cost cast resolving with an unpaid additional cost.
        expect(p1.battlefield.some((c) => c.id === "swamp2")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "swamp2")).toBe(true);
        expect(state.stack.some((s) => s.id === "snuffD")).toBe(true);
        // The alt cost itself was still paid too (4 life, no mana spent).
        expect(p1.life).toBe(16);
        expect(p1.manaPool.B).toBe(4);
    });
});

describe("Alternative cost — the no-target commit branch pays the board-wide sacrifice too (CR 601.2f / 118.5, issue #1985)", () => {
    // REGRESSION (issue #1985, site B). `announceCast`'s no-target ALT-COST
    // branch never built the board-wide/own additional-cost sacrifice
    // (`ownSac`) at all — not even the affordability check
    // (`assertStaticAdditionalCostAffordable`) ran — and committed
    // `pendingCast.sacrificeSelection` from the alt cost's own permanent leg
    // ALONE. No shipped alt-cost card carries a black pip (Drought's key), so
    // this drives the REAL exported pieces `announceCast`'s alt-cost branch
    // now runs, in the SAME order, against a synthetic green-pip
    // "Drought-shaped" static-additional-cost source (mirrors
    // `kicker.test.ts`'s `kickerAltProbe` precedent: a composition no shipped
    // card combines, testing the MECHANISM `StaticAdditionalCost` generically
    // rather than the literal Drought card) paired with the REAL Once Upon a
    // Time — a no-target spell whose alt cost is entirely leg-free (no
    // mana/permanent/life/hand leg at all), so `buildCastPermanentCostChoice`
    // always returns `undefined` for it: EVERY alt-cost cast of this shape
    // dropped the board-wide sacrifice 100% of the time before the fix.
    const GREEN_DROUGHT_PROBE_ID =
        "test:board-wide-additional-cost-green-probe";
    const greenDroughtProbe: CardDefinition = {
        id: GREEN_DROUGHT_PROBE_ID,
        rarity: "common",
        name: "Green Drought Probe",
        manaCost: { W: 2 },
        types: ["Enchantment"],
        staticEffects: [
            {
                kind: "additional-cost",
                appliesToSpell: () => true,
                appliesToAbility: () => true,
                perPipColor: "G",
                sacrificeFilter: { subtypes: ["Forest"] },
            },
        ],
    };
    registerTokenDefinition(greenDroughtProbe);

    /** Drives the EXACT composition `announceCast`'s no-target alt-cost
     *  branch now runs, in the same order, over the given state — the
     *  ADR-0001 pattern (no convex-test mutation harness) `kicker.test.ts`
     *  and `additional-cost-cast.test.ts` already use. */
    function buildOnceUponATimeCastSac(state: GameState, instanceId: string) {
        const player = getPlayer(state, "p1");
        const cardInHand = player.hand.find((c) => c.id === instanceId)!;
        const rawCost = castRawManaCost(state, cardInHand, "hand");
        assertStaticAdditionalCostAffordable(
            state,
            rawCost,
            cardInHand,
            player,
            "spell"
        );
        const { selection: ownSac } = buildCastSacrificeSelection(
            state,
            rawCost,
            cardInHand,
            player,
            undefined,
            onceUponATime.name ?? "Sacrifice",
            "hand"
        );
        const chosenAltCost = getAlternativeCost(
            onceUponATime,
            "free-first-spell"
        );
        assertKickerPermanentSlotFree(
            onceUponATime,
            undefined,
            ownSac,
            chosenAltCost
        );
        const altChoice = buildCastPermanentCostChoice(
            state,
            "p1",
            chosenAltCost,
            onceUponATime,
            undefined,
            "Alternative cost"
        );
        return resolveCastPermanentSelection(altChoice, ownSac);
    }

    it("builds and applies the board-wide Forest sacrifice for a leg-free alt-cost cast", () => {
        const onceInst = makeInstance(onceUponATime.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "onceD",
        });
        const probeInst = makeInstance(GREEN_DROUGHT_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "probe1",
        });
        const forestInst = makeInstance(forest.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "forest1",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [onceInst],
                    battlefield: [probeInst, forestInst],
                }),
                makePlayer("p2"),
            ],
        });
        const castSac = buildOnceUponATimeCastSac(state, "onceD");
        // Before the fix `altChoice` alone (always `undefined` for a
        // leg-free alt cost) was committed, so `castSac` was `undefined` and
        // this Forest was never at risk.
        expect(castSac?.requirements).toEqual([
            { filter: { subtypes: ["Forest"] }, count: 1 },
        ]);
        expect(castSac?.picked).toEqual(["forest1"]);
        // Apply through the REAL sacrifice-application function — proves the
        // Forest actually leaves the battlefield, not just that the
        // selection object looks right.
        applySacrificeSelection(state, castSac!);
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.some((c) => c.id === "forest1")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "forest1")).toBe(true);
    });

    it("rejects announcement when the board-wide sacrifice is unaffordable (no Forest)", () => {
        const onceInst = makeInstance(onceUponATime.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "onceD2",
        });
        const probeInst = makeInstance(GREEN_DROUGHT_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "probe2",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [onceInst],
                    battlefield: [probeInst], // no Forest to sacrifice
                }),
                makePlayer("p2"),
            ],
        });
        // Before the fix this affordability check never ran on the no-target
        // alt-cost branch at all, so an unpayable board-wide sacrifice
        // slipped straight through to a committed cast.
        expect(() => buildOnceUponATimeCastSac(state, "onceD2")).toThrow(
            /additional cost/i
        );
    });
});
