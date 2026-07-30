// Kicker capability (CR 702.33 Kicker, CR 702.33e Multikicker) — the
// cost-system infra built once and reused by every kicker card (issue #692).
// The project has no convex-test harness for game.ts mutations (ADR 0001), so
// this drives the REAL exported pieces `announceCast` uses — `resolveKickerCount`
// (validation), `finalizeTargetSelection` (cost fold + kickerCount snapshot on
// the stack item), and `getLegalTargets` (the kicked target-set swap) — over
// the real GRE state, in the same order the mutation would.

import { describe, it, expect } from "vitest";
import { resolveKickerCount, finalizeTargetSelection } from "../../game";
import { getLegalTargets, getLegalActions } from "../rules";
import { getPlayer, resolveTopOfStack, type PendingTarget } from "../state";
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
import { tearAsunder } from "../../cards/sets/dmu/green";
import { burstLightning } from "../../cards/sets/zen/red";
import { serraAngel, grizzlyBears, blackLotus } from "../../cards/sets/lea";

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
    kicker: { cost: { X: 2 } }, // Kicker {2}
    alternativeCosts: [
        { id: "pitch", description: "Pay 6 life instead", life: 6 },
    ],
    effects: [],
};
registerTokenDefinition(kickerAltProbe);

describe("Kicker — cost validation (CR 702.33 / 702.33e)", () => {
    it("returns 0 for an absent/zero request", () => {
        expect(resolveKickerCount(burstLightning, undefined)).toBe(0);
        expect(resolveKickerCount(burstLightning, 0)).toBe(0);
    });

    it("accepts a single kick (1) for a non-Multikicker card", () => {
        expect(resolveKickerCount(burstLightning, 1)).toBe(1);
    });

    it("rejects paying a single kicker more than once (CR 702.33 vs 702.33e)", () => {
        expect(() => resolveKickerCount(burstLightning, 2)).toThrow();
    });

    it("accepts any count for a Multikicker card (CR 702.33e)", () => {
        const chalice = getDefinition("1fdcc0c3-4029-4fc3-a486-5d7f45c910bd");
        expect(resolveKickerCount(chalice, 3)).toBe(3);
    });

    it("rejects a positive count for a card with no kicker", () => {
        expect(() => resolveKickerCount(grizzlyBears, 1)).toThrow();
    });
});

describe("Kicker — cost fold + tally snapshot (CR 702.33a / 601.2f)", () => {
    it("folds the kicker cost into the paid mana and stamps kickerCount on the stack item", () => {
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
            kickerCount: 1,
        };
        finalizeTargetSelection(state, pt, "p1");
        // All 4 black mana consumed (base {B} + kicker {2}{B}).
        expect(getPlayer(state, "p1").manaPool.B).toBe(0);
        // The spell is on the stack carrying the kicker tally.
        const onStack = state.stack.find((s) => s.id === "thirst1");
        expect(onStack?.kickerCount).toBe(1);
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
        expect(onStack?.kickerCount).toBeUndefined();
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
            kickerCount: 1,
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
        expect(onStack?.kickerCount).toBe(1);
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
        expect(onStack?.kickerCount).toBeUndefined();
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
            [],
            "p1"
        );
        expect(unkicked.some((t) => t.id === "angel1")).toBe(false);
        const kicked = getLegalTargets(
            state,
            bloodchiefsThirst.kickedTargetRequirement!,
            [],
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
    it("preserves a stack item's kickerCount across compact/expand", () => {
        const state = makeState();
        const item = pushSpell(state, burstLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerCount = 1;
        const round = expandState(compactState(state));
        const restored = round.stack.find((s) => s.id === item.id);
        expect(restored?.kickerCount).toBe(1);
        // And the restored item resolves kicked (4 damage).
        resolveTopOfStack(round);
        expect(round.players[1].life).toBe(16);
    });
});
