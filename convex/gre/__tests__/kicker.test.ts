// Kicker capability (CR 702.33 Kicker, CR 702.33e Multikicker) — the
// cost-system infra built once and reused by every kicker card (issue #692).
// The project has no convex-test harness for game.ts mutations (ADR 0001), so
// this drives the REAL exported pieces `announceCast` uses —
// `resolveKickerPayments` (validation), `finalizeTargetSelection` (cost fold +
// per-kicker payment snapshot on the stack item), and `getLegalTargets` (the
// kicked target-set swap) — over the real GRE state, in the same order the
// mutation would.
//
// Kicker is PLURAL (ADR 0079, issue #1937): a card declares `kickers[]`, each with
// its own id / description / `CostLegs`, and payment is recorded PER KICKER ID
// (`StackItem.kickerPayments`) with the total always DERIVED (`totalKickerCount`).

import { describe, it, expect } from "vitest";
import {
    finalizeTargetSelection,
    assertKickerAnnouncementLegal,
} from "../../game";
import {
    canPayKickerLegs,
    kickerLifeCost,
    kickerPaidCount,
    resolveKickerPayments,
    totalKickerCount,
} from "../kicker";
import {
    getLegalTargets,
    getLegalActions,
    NO_TARGETING_SOURCE,
} from "../rules";
import {
    getPlayer,
    resolveTopOfStack,
    type PendingTarget,
    type GameState,
    type CardInstanceState,
    type PlayerState,
} from "../state";
import { compactState, expandState } from "../serialize";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getDefinition, registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { bloodchiefsThirst } from "../../cards/sets/znr/black";
import { drought } from "../../cards/sets/ice/white";
import { tearAsunder } from "../../cards/sets/dmu/green";
import { burstLightning } from "../../cards/sets/zen/red";
import {
    serraAngel,
    grizzlyBears,
    blackLotus,
    forest,
    swamp,
} from "../../cards/sets/lea";

// A synthetic probe card carrying BOTH a Kicker (CR 702.33a — an ADDITIONAL
// mana cost) AND a pitch-style ALTERNATIVE cost (CR 118.9 — "pay 6 life
// instead"). No shipped card has both, so this is the only way to exercise the
// composed cast path: the alt cost zeroes the printed mana (`manaCost` → {}),
// the kicker mana folds ON TOP, and the alt cost's life leg is paid separately
// — neither clobbering the other (issue #692 ↔ PR #690 reconciliation).
const KICKER_ALT_PROBE_ID = "test:kicker-alt-cost-compose-probe";
const kickerAltProbe: CardDefinition = {
    id: KICKER_ALT_PROBE_ID,
    rarity: "common",
    name: "Kicker/Alt-Cost Probe",
    manaCost: { X: 3 }, // printed {3}, zeroed by the alternative cost
    types: ["Instant"],
    kickers: [{ id: "kicker", description: "Kicker {2}", mana: { X: 2 } }],
    alternativeCosts: [
        { id: "pitch", description: "Pay 6 life instead", life: 6 },
    ],
    effects: [],
};
registerTokenDefinition(kickerAltProbe);

describe("Kicker — cost validation (CR 702.33 / 702.33e)", () => {
    it("returns undefined for an absent / all-zero request", () => {
        expect(
            resolveKickerPayments(burstLightning, undefined)
        ).toBeUndefined();
        expect(resolveKickerPayments(burstLightning, {})).toBeUndefined();
        expect(
            resolveKickerPayments(burstLightning, { kicker: 0 })
        ).toBeUndefined();
    });

    it("accepts a single kick for a non-Multikicker card", () => {
        expect(resolveKickerPayments(burstLightning, { kicker: 1 })).toEqual({
            kicker: 1,
        });
    });

    it("rejects paying a single kicker more than once (CR 702.33 vs 702.33e)", () => {
        expect(() =>
            resolveKickerPayments(burstLightning, { kicker: 2 })
        ).toThrow();
    });

    it("accepts any count for a Multikicker card (CR 702.33e)", () => {
        const chalice = getDefinition("1fdcc0c3-4029-4fc3-a486-5d7f45c910bd");
        expect(resolveKickerPayments(chalice, { kicker: 3 })).toEqual({
            kicker: 3,
        });
    });

    it("rejects a positive count for a card with no kicker", () => {
        expect(() =>
            resolveKickerPayments(grizzlyBears, { kicker: 1 })
        ).toThrow();
    });

    it("rejects a kicker id the card does not declare (ADR 0079)", () => {
        expect(() =>
            resolveKickerPayments(burstLightning, { "kicker-nope": 1 })
        ).toThrow();
    });

    it("rejects a non-integer / negative count", () => {
        expect(() =>
            resolveKickerPayments(burstLightning, { kicker: 1.5 })
        ).toThrow();
        expect(() =>
            resolveKickerPayments(burstLightning, { kicker: -1 })
        ).toThrow();
    });
});

describe("Kicker — the total is DERIVED, never stored (ADR 0079)", () => {
    it("sums every paid kicker and reads back one by name", () => {
        const payments = { "kicker-u": 1, "kicker-r": 2 };
        expect(totalKickerCount(payments)).toBe(3);
        expect(kickerPaidCount(payments, "kicker-u")).toBe(1);
        expect(kickerPaidCount(payments, "kicker-r")).toBe(2);
        // Fail-closed on an unknown / absent id — the clause simply never fires.
        expect(kickerPaidCount(payments, "kicker-g")).toBe(0);
        expect(totalKickerCount(undefined)).toBe(0);
        expect(kickerPaidCount(undefined, "kicker")).toBe(0);
    });
});

describe("Kicker — cost fold + tally snapshot (CR 702.33a / 601.2f)", () => {
    it("folds the kicker cost into the paid mana and stamps kickerPayments on the stack item", () => {
        // Bloodchief's Thirst: {B}; Kicker {2}{B}. Kicked total = {2}{B}{B}.
        const thirst = makeInstance(bloodchiefsThirst.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "thirst1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "victim1",
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [thirst],
                    // 4 black covers {2}{B}{B} (2 generic + 2 coloured).
                    manaPool: { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "thirst1",
            targetType: ["Creature", "Planeswalker"],
            count: 1,
            selected: [{ type: "permanent", id: "victim1" }],
            kickerPayments: { kicker: 1 },
        };
        finalizeTargetSelection(state, pt, "p1");
        // All 4 black mana consumed (base {B} + kicker {2}{B}).
        expect(getPlayer(state, "p1").manaPool.B).toBe(0);
        // The spell is on the stack carrying the kicker tally.
        const onStack = state.stack.find((s) => s.id === "thirst1");
        expect(onStack?.kickerPayments).toEqual({ kicker: 1 });
    });

    it("pays only the base cost when not kicked", () => {
        const thirst = makeInstance(bloodchiefsThirst.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "thirst2",
        });
        const victim = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "victim2",
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [thirst],
                    manaPool: { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "thirst2",
            targetType: ["Creature", "Planeswalker"],
            count: 1,
            selected: [{ type: "permanent", id: "victim2" }],
        };
        finalizeTargetSelection(state, pt, "p1");
        // Only {B} paid → 3 black remain.
        expect(getPlayer(state, "p1").manaPool.B).toBe(3);
        const onStack = state.stack.find((s) => s.id === "thirst2");
        expect(onStack?.kickerPayments).toBeUndefined();
    });
});

describe("Kicker composes with an alternative cost (CR 702.33a additional + CR 118.9 alternative)", () => {
    function probeInHand(id: string) {
        return makeInstance(KICKER_ALT_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id,
        });
    }

    it("kicked AND alt-cast: pays the kicker's {2} mana on top of the {} alt-cost mana, plus the 6-life leg", () => {
        const probe = probeInHand("probe1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    life: 20,
                    // Exactly {2} — the kicker's mana; the printed {3} is
                    // replaced by the alternative cost, so only the kicker
                    // remains to be paid in mana.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
                makePlayer("p2"),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "probe1",
            targetType: "any",
            count: 0,
            selected: [],
            kickerPayments: { kicker: 1 },
            alternativeCostId: "pitch",
        };
        finalizeTargetSelection(state, pt, "p1");
        const p1 = getPlayer(state, "p1");
        // Kicker {2} was paid from mana (alt cost zeroed the printed {3}).
        expect(p1.manaPool.C).toBe(0);
        // The alternative cost's life leg (CR 118.9) was paid independently.
        expect(p1.life).toBe(14);
        // Spell reached the stack carrying the kicker tally — kicker
        // bookkeeping survived the alt-cost path.
        const onStack = state.stack.find((s) => s.id === "probe1");
        expect(onStack?.kickerPayments).toEqual({ kicker: 1 });
        expect(p1.hand.some((c) => c.id === "probe1")).toBe(false);
    });

    it("alt-cast WITHOUT kicker: pays no mana (alt cost zeroes it) and no kicker rides along", () => {
        const probe = probeInHand("probe2");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    life: 20,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
                makePlayer("p2"),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "probe2",
            targetType: "any",
            count: 0,
            selected: [],
            alternativeCostId: "pitch",
        };
        finalizeTargetSelection(state, pt, "p1");
        const p1 = getPlayer(state, "p1");
        // No mana spent — the alternative cost replaced the printed {3} and no
        // kicker was folded on.
        expect(p1.manaPool.C).toBe(2);
        expect(p1.life).toBe(14);
        const onStack = state.stack.find((s) => s.id === "probe2");
        expect(onStack?.kickerPayments).toBeUndefined();
    });
});

describe("Kicker — kickedTargetRequirement widens legal targets (CR 702.33)", () => {
    it("unkicked Bloodchief's Thirst can't target a mana-value-5 creature; kicked can", () => {
        // Serra Angel has mana value 5.
        const angel = makeInstance(serraAngel.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "angel1",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
        const unkicked = getLegalTargets(
            state,
            bloodchiefsThirst.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(unkicked.some((t) => t.id === "angel1")).toBe(false);
        const kicked = getLegalTargets(
            state,
            bloodchiefsThirst.kickedTargetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(kicked.some((t) => t.id === "angel1")).toBe(true);
    });
});

describe("Kicker — cast legality considers the kicked target set (CR 702.33 / 601.2c)", () => {
    // The kicker is chosen at announcement, AFTER the castability gate
    // (`hasEnoughLegalTargets`). A spell whose KICKED target requirement widens
    // the legal-target set must stay castable when only the wider set has a
    // legal target — paying the kicker reaches it. Regression: the gate used to
    // consider ONLY the base `targetRequirement` and wrongly judged such a
    // spell uncastable.
    const FULL_POOL = { W: 2, U: 2, B: 2, R: 2, G: 2, C: 2 };

    it("Bloodchief's Thirst is castable when only a mana-value-5 creature exists (kicked path)", () => {
        const thirst = makeInstance(bloodchiefsThirst.id, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
            id: "thirst1",
        });
        // Serra Angel has mana value 5 — outside the unkicked MV ≤ 2 set.
        const angel = makeInstance(serraAngel.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "angel1",
        });
        const p1 = makePlayer("p1", { hand: [thirst], manaPool: FULL_POOL });
        const p2 = makePlayer("p2", { battlefield: [angel] });
        const state = makeState({ players: [p1, p2] });
        expect(getLegalActions(state, p1, thirst)).toContain("cast");
    });

    it("Bloodchief's Thirst is castable with a mana-value-2 creature (base path, no regression)", () => {
        const thirst = makeInstance(bloodchiefsThirst.id, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
            id: "thirst2",
        });
        // Grizzly Bears has mana value 2 — inside the unkicked MV ≤ 2 set.
        const bears = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bears1",
        });
        const p1 = makePlayer("p1", { hand: [thirst], manaPool: FULL_POOL });
        const p2 = makePlayer("p2", { battlefield: [bears] });
        const state = makeState({ players: [p1, p2] });
        expect(getLegalActions(state, p1, thirst)).toContain("cast");
    });

    it("Bloodchief's Thirst is NOT castable with no creature/planeswalker anywhere (boundary)", () => {
        const thirst = makeInstance(bloodchiefsThirst.id, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
            id: "thirst3",
        });
        const p1 = makePlayer("p1", { hand: [thirst], manaPool: FULL_POOL });
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });
        // Neither base nor kicked requirement has a legal target — a mandatory
        // single-target sorcery with no legal target is uncastable.
        expect(getLegalActions(state, p1, thirst)).not.toContain("cast");
    });

    it("Tear Asunder is castable when only a creature exists (kicked nonland-permanent path)", () => {
        const tear = makeInstance(tearAsunder.id, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
            id: "tear1",
        });
        // Only a creature on the battlefield — outside the unkicked
        // artifact/enchantment set, but inside the kicked nonland-permanent set.
        const bears = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bears2",
        });
        const p1 = makePlayer("p1", { hand: [tear], manaPool: FULL_POOL });
        const p2 = makePlayer("p2", { battlefield: [bears] });
        const state = makeState({ players: [p1, p2] });
        expect(getLegalActions(state, p1, tear)).toContain("cast");
    });

    it("Tear Asunder is castable with an artifact present (base path, no regression)", () => {
        const tear = makeInstance(tearAsunder.id, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
            id: "tear2",
        });
        const lotus = makeInstance(blackLotus.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "lotus1",
        });
        const p1 = makePlayer("p1", { hand: [tear], manaPool: FULL_POOL });
        const p2 = makePlayer("p2", { battlefield: [lotus] });
        const state = makeState({ players: [p1, p2] });
        expect(getLegalActions(state, p1, tear)).toContain("cast");
    });
});

describe("Kicker — serialization round-trip (schema drift guard, CR 702.33)", () => {
    it("preserves a stack item's kickerPayments across compact/expand", () => {
        const state = makeState();
        const item = pushSpell(state, burstLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerPayments = { kicker: 1 };
        const round = expandState(compactState(state));
        const restored = round.stack.find((s) => s.id === item.id);
        expect(restored?.kickerPayments).toEqual({ kicker: 1 });
        // And the restored item resolves kicked (4 damage).
        resolveTopOfStack(round);
        expect(round.players[1].life).toBe(16);
    });
});

// --- Non-mana Kicker legs (CR 702.33a, ADR 0079) ------------------------------
//
// CR 702.33a: "a kicker cost is an additional cost", of ANY kind. Until #1937 a
// kicker cost was typed mana-only; it now carries the shared `CostLegs`
// vocabulary, so a Kicker can sacrifice/return a permanent, pay life, or
// discard/exile from hand. Two synthetic probes exercise every leg through the
// REAL commit path (`finalizeTargetSelection`), since no shipped card uses one
// yet — the Planeshift cards that will land afterwards ride these free.

const LEG_PROBE_ID = "test:kicker-nonmana-legs-probe";
const legProbe: CardDefinition = {
    id: LEG_PROBE_ID,
    rarity: "common",
    name: "Kicker Legs Probe",
    manaCost: { X: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker-sac",
            description: "Kicker — Sacrifice two lands",
            permanent: {
                action: "sacrifice",
                filter: { types: ["Land"] },
                count: 2,
            },
        },
        {
            id: "kicker-life",
            description: "Kicker — Pay 3 life",
            life: 3,
        },
    ],
    effects: [],
};
registerTokenDefinition(legProbe);

const HAND_LEG_PROBE_ID = "test:kicker-hand-leg-probe";
const handLegProbe: CardDefinition = {
    id: HAND_LEG_PROBE_ID,
    rarity: "common",
    name: "Kicker Hand Leg Probe",
    manaCost: { X: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {1} and discard a creature card",
            mana: { X: 1 },
            hand: {
                action: "discard",
                requirements: [{ filter: { type: "Creature" }, count: 1 }],
            },
        },
    ],
    effects: [],
};
registerTokenDefinition(handLegProbe);

const RETURN_LEG_PROBE_ID = "test:kicker-return-leg-probe";
const returnLegProbe: CardDefinition = {
    id: RETURN_LEG_PROBE_ID,
    rarity: "common",
    name: "Kicker Return Leg Probe",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    kickers: [
        {
            id: "kicker",
            description:
                "Kicker — Return a creature you control to its owner's hand",
            permanent: {
                action: "return",
                filter: { types: ["Creature"] },
                count: 1,
            },
        },
    ],
    effects: [],
};
registerTokenDefinition(returnLegProbe);

function land(id: string) {
    return makeInstance(forest.id, {
        controllerId: "p1",
        ownerId: "p1",
        id,
    });
}

function probePendingTarget(
    cardInstanceId: string,
    kickerPayments: Record<string, number> | undefined
): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId,
        targetType: "any",
        count: 0,
        selected: [],
        ...(kickerPayments ? { kickerPayments } : {}),
    };
}

describe("Kicker — LIFE leg (CR 702.33a / 118.4)", () => {
    it("prices the leg and pays it as the spell commits", () => {
        expect(kickerLifeCost(legProbe, { "kicker-life": 1 })).toBe(3);
        // A Multikicker-style repeat would owe N × the leg; a single kicker owes 1×.
        expect(kickerLifeCost(legProbe, undefined)).toBe(0);
        const probe = makeInstance(LEG_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "legs1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    life: 20,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        finalizeTargetSelection(
            state,
            probePendingTarget("legs1", { "kicker-life": 1 }),
            "p1"
        );
        const p1 = getPlayer(state, "p1");
        expect(p1.life).toBe(17);
        const onStack = state.stack.find((s) => s.id === "legs1");
        expect(onStack?.kickerPayments).toEqual({ "kicker-life": 1 });
    });

    it("is unaffordable below the life total (CR 119.4)", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 2 }), makePlayer("p2")],
        });
        expect(
            canPayKickerLegs(
                state,
                getPlayer(state, "p1"),
                legProbe,
                { "kicker-life": 1 },
                "legs-x"
            )
        ).toBe(false);
    });
});

describe("Kicker — PERMANENT leg is ALWAYS an explicit pick (CR 702.33a kicker / 701.21 sacrifice)", () => {
    it("parks the cast on a sacrifice selection even when exactly two lands are legal", () => {
        const probe = makeInstance(LEG_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "legs2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    // Exactly the two lands the leg demands — a FORCED choice,
                    // which is precisely the case ADR 0079 refuses to auto-pick.
                    battlefield: [land("l1"), land("l2")],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        finalizeTargetSelection(
            state,
            probePendingTarget("legs2", { "kicker-sac": 1 }),
            "p1"
        );
        // The spell has NOT reached the stack: it waits on the caster's pick.
        expect(state.stack.some((s) => s.id === "legs2")).toBe(false);
        const sel = state.pendingCast?.sacrificeSelection;
        expect(sel).toBeDefined();
        expect(sel?.action).toBe("sacrifice");
        expect(sel?.requirements).toEqual([
            { filter: { types: ["Land"] }, count: 2, explicit: true },
        ]);
        // Nothing pre-picked — the forced pick is still shown to the caster.
        expect(sel?.picked).toEqual([]);
        // Both lands are still on the battlefield until the pick is made.
        expect(getPlayer(state, "p1").battlefield).toHaveLength(2);
        // The per-kicker record rides along to the deferred commit.
        expect(state.pendingCast?.kickerPayments).toEqual({ "kicker-sac": 1 });
    });

    it("is unaffordable with too few matching permanents", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land("l1")] }),
                makePlayer("p2"),
            ],
        });
        expect(
            canPayKickerLegs(
                state,
                getPlayer(state, "p1"),
                legProbe,
                { "kicker-sac": 1 },
                "legs-x"
            )
        ).toBe(false);
    });

    it("carries a RETURN leg's terminal action onto the selection (CR 400.7)", () => {
        const probe = makeInstance(RETURN_LEG_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "ret1",
        });
        const bears = makeInstance(grizzlyBears.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "bears-own",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    battlefield: [bears],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        finalizeTargetSelection(
            state,
            probePendingTarget("ret1", { kicker: 1 }),
            "p1"
        );
        expect(state.pendingCast?.sacrificeSelection?.action).toBe("return");
        expect(state.pendingCast?.sacrificeSelection?.picked).toEqual([]);
    });
});

describe("Kicker — HAND leg (CR 702.33a kicker / 701.9 discard)", () => {
    it("opens the cast's hand-cost picker and pays the kicker mana alongside", () => {
        const probe = makeInstance(HAND_LEG_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "hand1",
        });
        const fodderA = makeInstance(grizzlyBears.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "fodderA",
        });
        const fodderB = makeInstance(serraAngel.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "fodderB",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe, fodderA, fodderB],
                    // {1} printed + {1} kicker.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
                makePlayer("p2"),
            ],
        });
        finalizeTargetSelection(
            state,
            probePendingTarget("hand1", { kicker: 1 }),
            "p1"
        );
        // TWO creature cards in hand for a one-card requirement → a REAL choice,
        // so the cast parks on the hand picker (CR 601.2f).
        expect(state.stack.some((s) => s.id === "hand1")).toBe(false);
        const choice = state.pendingCast?.alternativeCostHandChoice;
        expect(choice?.action).toBe("discard");
        expect(choice?.requirements).toEqual([
            { filter: { type: "Creature" }, count: 1 },
        ]);
        expect(choice?.pickedCardIds).toBeUndefined();
        expect(choice?.excludeInstanceId).toBe("hand1");
    });

    it("is unaffordable with no matching card in hand", () => {
        const probe = makeInstance(HAND_LEG_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "hand2",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [probe] }), makePlayer("p2")],
        });
        expect(
            canPayKickerLegs(
                state,
                getPlayer(state, "p1"),
                handLegProbe,
                { kicker: 1 },
                "hand2"
            )
        ).toBe(false);
    });
});

describe("Kicker — two kickers are paid independently (CR 702.33, ADR 0079)", () => {
    it("records both, and the total is their sum", () => {
        const probe = makeInstance(LEG_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "legs3",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    life: 20,
                    battlefield: [land("l1"), land("l2"), land("l3")],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        finalizeTargetSelection(
            state,
            probePendingTarget("legs3", { "kicker-sac": 1, "kicker-life": 1 }),
            "p1"
        );
        expect(state.pendingCast?.kickerPayments).toEqual({
            "kicker-sac": 1,
            "kicker-life": 1,
        });
        expect(totalKickerCount(state.pendingCast?.kickerPayments)).toBe(2);
        // Both legs are owed: the life at the deferred commit, the lands via the pick.
        expect(state.pendingCast?.payLife).toBe(3);
        expect(state.pendingCast?.sacrificeSelection?.requirements).toEqual([
            { filter: { types: ["Land"] }, count: 2, explicit: true },
        ]);
    });
});

describe("Kicker — the cast's OWN additional cost survives a kicked cast (CR 601.2f / 118.5)", () => {
    // REGRESSION (issue #1937 review). A mana-only Kicker still produces one
    // `kickerCostLegs` entry per payment, so gating the cast's permanent-cost
    // picker on "the kicker produced any leg" sent EVERY kicked cast down the
    // cost-legs branch — which returns `undefined` for a mana-only Kicker and
    // therefore silently DISCARDED the cast's own additional-cost sacrifice.
    // Drought (board-wide, CR 118.5: 'Spells cost an additional "Sacrifice a
    // Swamp" for each black mana symbol') × Bloodchief's Thirst ({B}, one black
    // pip) is the shipped-card reproduction: unkicked the Swamp goes, kicked it
    // used to survive while the spell still reached the stack.
    function thirstUnderDrought(kicked: boolean) {
        const thirst = makeInstance(bloodchiefsThirst.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "thirstD",
        });
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "drought1",
        });
        const swampInst = makeInstance(swamp.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "swamp1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "victimD",
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [thirst],
                    battlefield: [droughtInst, swampInst],
                    // 4 black covers the kicked total {2}{B}{B}.
                    manaPool: { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "thirstD",
            targetType: ["Creature", "Planeswalker"],
            count: 1,
            selected: [{ type: "permanent", id: "victimD" }],
            ...(kicked ? { kickerPayments: { kicker: 1 } } : {}),
        };
        finalizeTargetSelection(state, pt, "p1");
        return state;
    }

    it("sacrifices the Swamp on an UNKICKED cast (baseline)", () => {
        const state = thirstUnderDrought(false);
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.some((c) => c.id === "swamp1")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "swamp1")).toBe(true);
        expect(state.stack.some((s) => s.id === "thirstD")).toBe(true);
    });

    it("STILL sacrifices the Swamp on a KICKED cast", () => {
        const state = thirstUnderDrought(true);
        const p1 = getPlayer(state, "p1");
        // Before the fix the Swamp survived and the spell reached the stack
        // anyway — a spell resolving with an unpaid additional cost.
        expect(p1.battlefield.some((c) => c.id === "swamp1")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "swamp1")).toBe(true);
        const onStack = state.stack.find((s) => s.id === "thirstD");
        expect(onStack?.kickerPayments).toEqual({ kicker: 1 });
        // The kicker mana was folded on top: {B} printed + {2}{B} kicker = 4.
        expect(p1.manaPool.B).toBe(0);
    });
});

// A probe whose printed cost carries a BLACK pip (so Drought imposes its
// "Sacrifice a Swamp" additional cost, CR 118.5) AND whose Kicker owes a
// PERMANENT leg. No printed card has this shape — it is the only way to reach
// the one-slot collision the announcement guard fails closed on.
const PIP_SAC_PROBE_ID = "test:kicker-permleg-plus-additional-cost-probe";
const pipSacProbe: CardDefinition = {
    id: PIP_SAC_PROBE_ID,
    rarity: "common",
    name: "Kicker Permanent-Leg Probe",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker-sac",
            description: "Kicker — Sacrifice two lands",
            permanent: {
                action: "sacrifice",
                filter: { types: ["Land"] },
                count: 2,
            },
        },
    ],
    effects: [],
};
registerTokenDefinition(pipSacProbe);

describe("Kicker — a permanent leg colliding with another additional cost fails CLOSED (CR 601.2f)", () => {
    function pipSacState(kicked: boolean) {
        const probe = makeInstance(PIP_SAC_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "pipsac1",
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
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    battlefield: [
                        droughtInst,
                        swampInst,
                        land("pl1"),
                        land("pl2"),
                    ],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        return () =>
            finalizeTargetSelection(
                state,
                probePendingTarget(
                    "pipsac1",
                    kicked ? { "kicker-sac": 1 } : undefined
                ),
                "p1"
            );
    }

    it("throws rather than silently dropping the cast's own sacrifice", () => {
        // `?? ownSac` would have quietly paid the kicker's two lands and NOT
        // Drought's Swamp — a spell on the stack with an unpaid cost.
        expect(pipSacState(true)).toThrow(/kicker cost cannot be paid/i);
    });

    it("leaves the UNKICKED cast (no permanent leg owed) untouched", () => {
        expect(pipSacState(false)).not.toThrow();
    });
});

// Same collision as `pipSacProbe` above, but with a `targetRequirement` — so
// casting it goes through `announceCast`'s TARGETED branch, the one that
// writes `state.pendingTarget` at announcement (before target selection even
// starts) rather than committing directly. No printed card has this shape
// (see the header comment on `pipSacProbe`); it exists to reach the targeted
// announcement path the untargeted `pipSacProbe` above cannot.
const PIP_SAC_TARGETED_PROBE_ID =
    "test:kicker-permleg-plus-additional-cost-targeted-probe";
const pipSacTargetedProbe: CardDefinition = {
    id: PIP_SAC_TARGETED_PROBE_ID,
    rarity: "common",
    name: "Kicker Permanent-Leg Targeted Probe",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    kickers: [
        {
            id: "kicker-sac",
            description: "Kicker — Sacrifice two lands",
            permanent: {
                action: "sacrifice",
                filter: { types: ["Land"] },
                count: 2,
            },
        },
    ],
    effects: [],
};
registerTokenDefinition(pipSacTargetedProbe);

// issue #1986 — `assertKickerPermanentSlotFree` used to be checked ONLY from
// `finalizeTargetSelection` (the "throws rather than silently dropping the
// cast's own sacrifice" test above), which on a TARGETED cast runs in a
// SEPARATE, LATER mutation (`selectTarget`/`selectTargets`/`confirmTargets`)
// than the one that opens target selection (`announceCast`). By the time that
// later mutation threw, a PRIOR mutation had already persisted
// `state.pendingTarget` — the throw rolled back nothing (Convex mutations are
// transactional) but left the ALREADY-COMMITTED `pendingTarget` behind, and
// every subsequent attempt to finalize the same selection would throw again
// at the same spot: a soft-lock with no way out but `cancelTarget`.
//
// `assertKickerAnnouncementLegal` (game.ts) is the fix: `announceCast`'s
// SHARED prelude — the code that runs identically before either the targeted
// branch's `pendingTarget` write or the no-target branch's `pendingCast`
// write — now runs this exact check first. These tests drive the real
// exported piece the mutation calls, in the same order, mirroring the
// no-convex-test-harness pattern (`additional-cost-cast.test.ts`, ADR 0001).
describe("Kicker permanent-leg collision — rejected in announceCast's PRELUDE, before pendingTarget is ever persisted (issue #1986)", () => {
    function targetedAnnouncementState(kicked: boolean) {
        const probe = makeInstance(PIP_SAC_TARGETED_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "pipsacT1",
        });
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "droughtT",
        });
        const swampInst = makeInstance(swamp.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "swampT",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    battlefield: [
                        droughtInst,
                        swampInst,
                        land("plT1"),
                        land("plT2"),
                    ],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const cardInHand = player.hand.find((c) => c.id === "pipsacT1")!;
        const kickerPayments = kicked ? { "kicker-sac": 1 } : undefined;
        return { state, player, cardInHand, kickerPayments };
    }

    /** Mirrors `announceCast`'s targeted-branch control flow (game.ts): the
     *  prelude gate runs FIRST; only if it doesn't throw does the mutation go
     *  on to write `state.pendingTarget` and open target selection. Because
     *  this is a plain synchronous function call, a throw on the gate line
     *  makes the write below UNREACHABLE — the same guarantee the real
     *  mutation gets from running the two statements in this order. */
    function simulateTargetedAnnouncement(
        state: GameState,
        cardDef: CardDefinition,
        cardInHand: CardInstanceState,
        player: PlayerState,
        kickerPayments: Record<string, number> | undefined
    ): void {
        assertKickerAnnouncementLegal(
            state,
            cardDef,
            cardInHand,
            player,
            kickerPayments,
            "hand"
        );
        state.pendingTarget = {
            playerId: player.id,
            cardInstanceId: cardInHand.id,
            targetType: "any",
            count: 1,
            selected: [],
        };
    }

    it("throws at announcement, and pendingTarget is never persisted", () => {
        const { state, player, cardInHand, kickerPayments } =
            targetedAnnouncementState(true);
        expect(() =>
            simulateTargetedAnnouncement(
                state,
                pipSacTargetedProbe,
                cardInHand,
                player,
                kickerPayments
            )
        ).toThrow(/kicker cost cannot be paid/i);
        // The proof this issue asks for: no pendingTarget survives the
        // rejection — unlike the pre-fix shape, where a PRIOR mutation had
        // already committed it before this exact collision was discovered.
        expect(state.pendingTarget).toBeUndefined();
    });

    it("an unkicked targeted cast is unaffected — pendingTarget is written normally", () => {
        const { state, player, cardInHand, kickerPayments } =
            targetedAnnouncementState(false);
        expect(() =>
            simulateTargetedAnnouncement(
                state,
                pipSacTargetedProbe,
                cardInHand,
                player,
                kickerPayments
            )
        ).not.toThrow();
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget?.cardInstanceId).toBe("pipsacT1");
    });

    it("the untargeted probe's collision is ALSO caught by the same prelude gate (no path left ungated)", () => {
        // `pipSacProbe` (above) has no `targetRequirement`, so it reaches
        // `announceCast`'s no-target branch instead — already correctly
        // gated before this issue (site B in the issue's producer census).
        // Asserting `assertKickerAnnouncementLegal` also rejects it proves
        // BOTH announcement paths now share the one prelude gate.
        const probe = makeInstance(PIP_SAC_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "pipsacU1",
        });
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "droughtU",
        });
        const swampInst = makeInstance(swamp.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "swampU",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    battlefield: [
                        droughtInst,
                        swampInst,
                        land("plU1"),
                        land("plU2"),
                    ],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const cardInHand = player.hand.find((c) => c.id === "pipsacU1")!;
        expect(() =>
            assertKickerAnnouncementLegal(
                state,
                pipSacProbe,
                cardInHand,
                player,
                { "kicker-sac": 1 },
                "hand"
            )
        ).toThrow(/kicker cost cannot be paid/i);
    });
});
