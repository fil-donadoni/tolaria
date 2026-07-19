// Companion framework (CR 702.139, ADR 0064) — pure module tests for
// convex/gre/companion.ts: the Singleton condition (Lutri), the permanent-
// MV<=2 condition (Lurrus, issue #1392), the sideboard -> slot selector, and
// the summon-companion special-action legality predicate.
import { describe, expect, it } from "vitest";
import {
    canSummonCompanion,
    everyPermanent,
    permanentManaValueAtMost2,
    selectCompanion,
    singleton,
} from "../companion";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { PlayerState } from "../state";
import {
    lightningBolt,
    mountain,
    plains,
    savannahLions,
    serraAngel,
} from "../../cards/sets/lea";
import { lutri, lurrus } from "../../cards/sets/iko/multicolor";

describe("companion.ts — Singleton (CR 702.139b, Lutri, the Spellchaser)", () => {
    it("passes a deck with duplicate LANDS but no duplicate nonland names", () => {
        const deck = [
            mountain,
            mountain,
            mountain,
            plains,
            lightningBolt,
            savannahLions,
        ];
        expect(singleton(deck)).toBe(true);
    });

    it("fails a deck with a duplicated nonland card name", () => {
        const deck = [lightningBolt, lightningBolt, savannahLions];
        expect(singleton(deck)).toBe(false);
    });

    it("passes an all-land deck regardless of copy count", () => {
        const deck = [mountain, mountain, mountain, mountain, plains, plains];
        expect(singleton(deck)).toBe(true);
    });

    it("passes an empty deck vacuously", () => {
        expect(singleton([])).toBe(true);
    });
});

describe("companion.ts — everyPermanent / permanentManaValueAtMost2 (CR 702.139a, Lurrus, issue #1392)", () => {
    it("passes a deck where every PERMANENT card has mana value <= 2", () => {
        // Savannah Lions is MV 1; Lightning Bolt (an instant, non-permanent)
        // is exempt regardless of its own MV.
        const deck = [mountain, plains, savannahLions, lightningBolt];
        expect(permanentManaValueAtMost2(deck)).toBe(true);
    });

    it("fails when a PERMANENT card exceeds mana value 2", () => {
        // Serra Angel is {2}{W}{W}, MV 4.
        const deck = [mountain, savannahLions, serraAngel];
        expect(permanentManaValueAtMost2(deck)).toBe(false);
    });

    it("exempts non-permanent cards (instants/sorceries) regardless of their own mana value", () => {
        const deck = [lightningBolt, lightningBolt];
        expect(permanentManaValueAtMost2(deck)).toBe(true);
    });

    it("passes an empty deck vacuously", () => {
        expect(permanentManaValueAtMost2([])).toBe(true);
    });

    it("everyPermanent is a reusable combinator over an arbitrary predicate — a LAND is itself a CR 300.1 permanent type, so it's constrained too", () => {
        const hasSubtypeCat = everyPermanent((def) =>
            (def.subtypes ?? []).includes("Cat")
        );
        expect(hasSubtypeCat([savannahLions])).toBe(true);
        // Mountain has no "Cat" subtype and, unlike a non-permanent card, is
        // NOT exempt (Land IS one of the CR 300.1 permanent types) — fails.
        expect(hasSubtypeCat([savannahLions, mountain])).toBe(false);
    });
});

describe("companion.ts — selectCompanion (CR 702.139c, auto-declare)", () => {
    it("auto-declares Lutri when the sideboard carries it and the maindeck is singleton", () => {
        const maindeckIds = [
            mountain.id,
            plains.id,
            lightningBolt.id,
            savannahLions.id,
        ];
        const selected = selectCompanion([lutri.id], maindeckIds);
        expect(selected?.id).toBe(lutri.id);
    });

    it("does not declare Lutri when the maindeck fails its Singleton condition", () => {
        const maindeckIds = [lightningBolt.id, lightningBolt.id];
        expect(selectCompanion([lutri.id], maindeckIds)).toBeUndefined();
    });

    it("auto-declares Lurrus when the sideboard carries it and every permanent in the maindeck is MV <= 2 (issue #1392)", () => {
        const maindeckIds = [
            mountain.id,
            plains.id,
            lightningBolt.id, // instant, exempt regardless of MV
            savannahLions.id, // MV 1 permanent
        ];
        const selected = selectCompanion([lurrus.id], maindeckIds);
        expect(selected?.id).toBe(lurrus.id);
    });

    it("does not declare Lurrus when the maindeck has a permanent above MV 2", () => {
        const maindeckIds = [mountain.id, serraAngel.id]; // Serra Angel is MV 4
        expect(selectCompanion([lurrus.id], maindeckIds)).toBeUndefined();
    });

    it("ignores a sideboard card without the companion keyword", () => {
        expect(
            selectCompanion([savannahLions.id], [mountain.id])
        ).toBeUndefined();
    });

    it("returns undefined for an empty sideboard", () => {
        expect(selectCompanion([], [mountain.id])).toBeUndefined();
    });

    it("skips an unregistered sideboard card id without throwing", () => {
        expect(
            selectCompanion(["not-a-real-card-id"], [mountain.id])
        ).toBeUndefined();
    });
});

describe("companion.ts — canSummonCompanion (CR 116.2 / 702.139f)", () => {
    function stateWithCompanion(overrides: Partial<PlayerState> = {}) {
        const p1 = makePlayer("p1", {
            battlefield: [
                makeInstance(mountain.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                }),
                makeInstance(mountain.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                }),
                makeInstance(mountain.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                }),
            ],
            companion: {
                instance: makeInstance(lutri.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                }),
                used: false,
            },
            ...overrides,
        });
        return makeState({ players: [p1, makePlayer("p2")] });
    }

    it("is legal at sorcery timing with an unused, affordable companion", () => {
        const state = stateWithCompanion();
        expect(canSummonCompanion(state, state.players[0])).toBe(true);
    });

    it("is false with no companion in the slot", () => {
        const state = makeState();
        expect(canSummonCompanion(state, state.players[0])).toBe(false);
    });

    it("is false once the companion has been used", () => {
        const state = stateWithCompanion({
            companion: {
                instance: makeInstance(lutri.id, {
                    controllerId: "p1",
                    ownerId: "p1",
                }),
                used: true,
            },
        });
        expect(canSummonCompanion(state, state.players[0])).toBe(false);
    });

    it("is false without priority", () => {
        const state = stateWithCompanion();
        state.priorityPlayerId = "p2";
        expect(canSummonCompanion(state, state.players[0])).toBe(false);
    });

    it("is false outside a main phase", () => {
        const state = stateWithCompanion();
        state.phase = "DECLARE_ATTACKERS";
        expect(canSummonCompanion(state, state.players[0])).toBe(false);
    });

    it("is false with a non-empty stack", () => {
        const state = stateWithCompanion();
        pushSpell(state, lightningBolt.id, "p1");
        expect(canSummonCompanion(state, state.players[0])).toBe(false);
    });

    it("is false during an opponent's turn even if this player somehow held priority", () => {
        const state = stateWithCompanion();
        state.activePlayerId = "p2";
        expect(canSummonCompanion(state, state.players[0])).toBe(false);
    });

    it("is false when {3} is unaffordable", () => {
        const state = stateWithCompanion({ battlefield: [] });
        expect(canSummonCompanion(state, state.players[0])).toBe(false);
    });

    it("is false while another payment is already in progress", () => {
        const state = stateWithCompanion();
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "x",
            manaCost: {},
            tappedLandIds: [],
        };
        expect(canSummonCompanion(state, state.players[0])).toBe(false);
    });
});
