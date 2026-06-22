// enumerateMoves + planManaPayment (issue #110, ADR 0001).
//
// The bot's candidate move list must be COMPLETE for crafted positions and the
// mana planner must produce a payable tap sequence. These are pure-function
// tests; the GRE→game.ts executor contract is covered separately by the
// integration test.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";
import { enumerateMoves, planManaPayment, type Move } from "../moves";

const FOREST = getCardByName("Forest").id;
const MOUNTAIN = getCardByName("Mountain").id;
const BEARS = getCardByName("Grizzly Bears").id; // 1G 2/2
const BOLT = getCardByName("Lightning Bolt").id; // R, target any
const FIREBALL = getCardByName("Fireball").id; // XR, target any (min 1)
const BAYOU = getCardByName("Bayou").id; // dual: {T}: Add {B} or {G}

function land(cardId: string, controllerId: string): CardInstanceState {
    return makeInstance(cardId, { controllerId, ownerId: controllerId });
}

function kinds(moves: Move[]): string[] {
    return moves.map((m) => m.kind);
}

describe("enumerateMoves — priority window (issue #110)", () => {
    it("always offers pass when the player has priority", () => {
        const state = makeState();
        const moves = enumerateMoves(state, "p1");
        expect(moves).toContainEqual({ kind: "pass" });
    });

    it("returns nothing when the player does not hold priority", () => {
        const state = makeState({ priorityPlayerId: "p2" });
        expect(enumerateMoves(state, "p1")).toEqual([]);
    });

    it("returns nothing once the game is over", () => {
        const state = makeState({
            gameOver: { winnerId: "p2", loserId: "p1", reason: "life" },
        });
        expect(enumerateMoves(state, "p1")).toEqual([]);
    });

    it("offers a play-land move for a land in hand at sorcery timing", () => {
        const mountain = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", { hand: [mountain] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const moves = enumerateMoves(state, "p1");
        expect(moves).toContainEqual({
            kind: "play-land",
            cardInstanceId: mountain.id,
        });
    });

    it("does not offer play-land after the land drop is spent", () => {
        const mountain = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [mountain],
            landsPlayedThisTurn: 1,
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(kinds(enumerateMoves(state, "p1"))).not.toContain("play-land");
    });
});

describe("enumerateMoves — casting + mana (issue #110)", () => {
    it("offers a cast with a tap plan covering the cost when affordable", () => {
        const bears = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bears],
            battlefield: [land(FOREST, "p1"), land(FOREST, "p1")],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const casts = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell"
        );
        expect(casts).toHaveLength(1);
        const cast = casts[0];
        expect(cast.kind === "cast-spell" && cast.targets).toEqual([]);
        // 1G → two taps (one Forest for G, one Forest for the generic).
        expect(cast.kind === "cast-spell" && cast.tapPlan).toHaveLength(2);
    });

    it("omits a cast the player cannot pay for", () => {
        const bears = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bears],
            battlefield: [land(FOREST, "p1")], // only one source, needs two
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(kinds(enumerateMoves(state, "p1"))).not.toContain("cast-spell");
    });

    it("expands one cast per legal target for a targeted spell", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const dummy = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            battlefield: [land(MOUNTAIN, "p1")],
        });
        const p2 = makePlayer("p2", { battlefield: [dummy] });
        const state = makeState({ players: [p1, p2] });
        const casts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );
        // "any" target: the opponent creature + both players = 3 legal targets.
        expect(casts).toHaveLength(3);
        for (const c of casts) {
            expect(c.targets).toHaveLength(1);
            expect(c.tapPlan).toHaveLength(1);
        }
        const targetIds = casts.map((c) => c.targets[0].id);
        expect(targetIds).toContain(dummy.id);
        expect(targetIds).toContain("p1");
        expect(targetIds).toContain("p2");
    });

    it("expands X = 0..maxAffordable for an X spell", () => {
        const fireball = makeInstance(FIREBALL, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [fireball],
            // R + 2 extra generic available → X can be 0, 1, or 2.
            battlefield: [
                land(MOUNTAIN, "p1"),
                land(MOUNTAIN, "p1"),
                land(MOUNTAIN, "p1"),
            ],
        });
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });
        const casts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );
        const xs = new Set(casts.map((c) => c.chosenX));
        expect(xs).toEqual(new Set([0, 1, 2]));
    });
});

describe("planManaPayment (issue #110)", () => {
    it("returns an empty plan for a zero cost", () => {
        const p = makePlayer("p1");
        expect(planManaPayment(p, {})).toEqual([]);
    });

    it("plans colored then generic from untapped lands", () => {
        const p = makePlayer("p1", {
            battlefield: [land(FOREST, "p1"), land(FOREST, "p1")],
        });
        const plan = planManaPayment(p, { G: 1, X: 1 });
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(2);
    });

    it("uses pool mana before tapping (fewer taps)", () => {
        const p = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
            battlefield: [land(FOREST, "p1")],
        });
        // Need GG: one from pool (no tap), one from the Forest.
        const plan = planManaPayment(p, { G: 2 });
        expect(plan).toHaveLength(1);
    });

    it("returns null when sources cannot cover the cost", () => {
        const p = makePlayer("p1", { battlefield: [land(FOREST, "p1")] });
        expect(planManaPayment(p, { R: 1 })).toBeNull();
    });

    it("skips tapped sources", () => {
        const tapped = makeInstance(FOREST, {
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const p = makePlayer("p1", { battlefield: [tapped] });
        expect(planManaPayment(p, { G: 1 })).toBeNull();
    });

    // Regression: a dual land (Bayou) carries both basic land subtypes
    // (Swamp, Forest) AND a manaChoices ability. `tapForPayment` pays it via
    // the choice ability and requires a `manaChoiceIndex`; the plan must
    // supply one. Before the fix the intrinsic-subtype path claimed B/G with
    // no index, so the plan emitted a choice-less tap and the mutation threw
    // "Must choose a mana color".
    it("emits a manaChoiceIndex for dual-land choice sources", () => {
        const p = makePlayer("p1", { battlefield: [land(BAYOU, "p1")] });

        const planB = planManaPayment(p, { B: 1 });
        expect(planB).toHaveLength(1);
        expect(planB![0].manaChoiceIndex).toBeTypeOf("number");

        const planG = planManaPayment(p, { G: 1 });
        expect(planG).toHaveLength(1);
        expect(planG![0].manaChoiceIndex).toBeTypeOf("number");
    });
});

describe("enumerateMoves — combat (issue #110)", () => {
    function attackingSetup() {
        const a1 = makeInstance(BEARS, { controllerId: "p1", ownerId: "p1" });
        const a2 = makeInstance(BEARS, { controllerId: "p1", ownerId: "p1" });
        const p1 = makePlayer("p1", { battlefield: [a1, a2] });
        const p2 = makePlayer("p2");
        const state = makeState({
            players: [p1, p2],
            phase: "DECLARE_ATTACKERS",
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        return { state, a1, a2 };
    }

    it("enumerates the power set of eligible attackers", () => {
        const { state, a1, a2 } = attackingSetup();
        const moves = enumerateMoves(state, "p1");
        expect(moves.every((m) => m.kind === "declare-attackers")).toBe(true);
        const sets = moves
            .filter(
                (m): m is Extract<Move, { kind: "declare-attackers" }> =>
                    m.kind === "declare-attackers"
            )
            .map((m) => [...m.attackerIds].sort());
        // {}, {a1}, {a2}, {a1,a2}
        expect(sets).toHaveLength(4);
        expect(sets).toContainEqual([]);
        expect(sets).toContainEqual([a1.id, a2.id].sort());
    });

    it("enumerates blocker assignments for the defender", () => {
        const attacker = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [attacker] });
        const p2 = makePlayer("p2", { battlefield: [blocker] });
        const state = makeState({
            players: [p1, p2],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: [attacker.id],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const moves = enumerateMoves(state, "p2");
        expect(moves.every((m) => m.kind === "declare-blockers")).toBe(true);
        // no-block + block-the-attacker = 2 assignments.
        expect(moves).toHaveLength(2);
        expect(moves).toContainEqual({
            kind: "declare-blockers",
            assignments: [],
        });
        expect(moves).toContainEqual({
            kind: "declare-blockers",
            assignments: [{ blockerId: blocker.id, attackerId: attacker.id }],
        });
    });
});

describe("enumerateMoves — mulligan (issue #110)", () => {
    it("offers keep/mull only to the declaring player", () => {
        const state = makeState({
            phase: "MULLIGAN",
            mulligan: {
                mulligansTaken: [0, 0],
                declarations: [null, null],
                locked: [false, false],
                declaringPlayerId: "p1",
                bottoming: false,
            },
        });
        expect(enumerateMoves(state, "p1")).toEqual([
            { kind: "mulligan", decision: "keep" },
            { kind: "mulligan", decision: "mull" },
        ]);
        expect(enumerateMoves(state, "p2")).toEqual([]);
    });
});

describe("enumerateMoves — any-player abilities on opponents (CR 113.3c)", () => {
    const IFH_BIFF = getCardByName("Ifh-Bíff Efreet").id;

    it("offers the opponent's Ifh-Bíff {G} ability when the bot can pay", () => {
        // p1 (the bot) controls a Forest for {G}; p2 controls Ifh-Bíff Efreet.
        const efreet = makeInstance(IFH_BIFF, {
            id: "efreet",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land(FOREST, "p1")] }),
                makePlayer("p2", { battlefield: [efreet] }),
            ],
        });
        const moves = enumerateMoves(state, "p1");
        const activate = moves.find(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === "efreet" &&
                m.abilityId === "ifh-biff-efreet-rain"
        );
        expect(activate).toBeDefined();
    });

    it("does not offer the opponent's controller-only abilities", () => {
        // Sorceress Queen's {T} set-power ability is NOT any-player; the bot
        // must not see it on the opponent's permanent.
        const queen = makeInstance(getCardByName("Sorceress Queen").id, {
            id: "queen",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land(FOREST, "p1")] }),
                makePlayer("p2", { battlefield: [queen] }),
            ],
        });
        const moves = enumerateMoves(state, "p1");
        const onOpponent = moves.filter(
            (m) => m.kind === "activate-ability" && m.cardInstanceId === "queen"
        );
        expect(onOpponent).toEqual([]);
    });
});

// Issue #546 — the bot must not pay an animate ability's cost while the source
// is already animated this turn (CR 611.1, one animation at a time). The
// animate primitive (`state.ts` `animateAsCreature`) returns early when
// `card.animation` is set, so a re-activation wastes mana for no effect; the
// enumerator must not produce the redundant `activate-ability` macro-move.
describe("enumerateMoves — self-animate guard (issue #546, CR 611.1)", () => {
    const FACTORY = getCardByName("Mishra's Factory").id;

    function animatedFactory(): CardInstanceState {
        return makeInstance(FACTORY, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
            // Already a 2/2 Assembly-Worker creature land this turn.
            animation: {
                savedPower: undefined,
                savedToughness: undefined,
                addedCreatureType: true,
                addedSubtype: "Assembly-Worker",
                duration: { phase: "end-of-turn" },
            },
        });
    }

    function plainFactory(): CardInstanceState {
        return makeInstance(FACTORY, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
        });
    }

    function animateMoves(state: GameState): Move[] {
        return enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === "factory" &&
                m.abilityId === "mishras-factory-animate"
        );
    }

    it("does not offer the animate ability while already animated", () => {
        // Factory is animated; a spare Forest can fund the {1} cost, so the
        // ONLY reason the move is absent must be the self-animate guard.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [animatedFactory(), land(FOREST, "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        expect(animateMoves(state)).toEqual([]);
    });

    it("still offers the animate ability when not yet animated (control)", () => {
        // Same board, Factory NOT animated — the move must be present and carry
        // a tap plan (proving the prior absence is the guard, not lack of mana).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [plainFactory(), land(FOREST, "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        const moves = animateMoves(state);
        expect(moves).toHaveLength(1);
        expect(moves[0].kind).toBe("activate-ability");
    });
});
