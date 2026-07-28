// enumerateMoves + planManaPayment (issue #110, ADR 0001).
//
// The bot's candidate move list must be COMPLETE for crafted positions and the
// mana planner must produce a payable tap sequence. These are pure-function
// tests; the GRE→game.ts executor contract is covered separately by the
// integration test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllCards, getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";
import * as stateModule from "../state";
import { enumerateMoves, planManaPayment, type Move } from "../moves";
import { getLegalActions } from "../rules";

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

    // CR 508.1a (issue #1220) — the bot must be able to attack a planeswalker
    // the defender controls, not just the defending player. The enumerator adds
    // per-planeswalker variants that direct the declared attack at it.
    it("offers attacking a defending planeswalker (attackTargets variant)", () => {
        const a1 = makeInstance(BEARS, { controllerId: "p1", ownerId: "p1" });
        const pw = makeInstance(getCardByName("Liliana of the Veil").id, {
            id: "pw",
            controllerId: "p2",
            ownerId: "p2",
            counters: { loyalty: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a1] }),
                makePlayer("p2", { battlefield: [pw] }),
            ],
            phase: "DECLARE_ATTACKERS",
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const attackMoves = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "declare-attackers" }> =>
                m.kind === "declare-attackers"
        );
        // At least one move directs a1 at the planeswalker.
        const pwMove = attackMoves.find(
            (m) => m.attackTargets?.[a1.id] === "pw"
        );
        expect(pwMove).toBeDefined();
        expect(pwMove!.attackerIds).toContain(a1.id);
        // The default (attack-the-player) variant is still present.
        expect(
            attackMoves.some(
                (m) => m.attackerIds.includes(a1.id) && !m.attackTargets
            )
        ).toBe(true);
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

    // ADR 0038 — the bot's blocker enumeration must honour the menace
    // minimum-blocker threshold the server enforces at confirmBlockers, or it
    // would propose a block the mutation then rejects (CR 509.1b/c).
    it("does NOT offer blocking a menace attacker with a single blocker", () => {
        const attacker = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            staticAbilities: ["menace"], // granted by e.g. Goblin War Drums
        });
        const blocker = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: [attacker.id],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const moves = enumerateMoves(state, "p2");
        // Only the no-block move survives: a lone blocker on a menace attacker
        // is illegal, so the bot must not consider it.
        expect(moves).toEqual([{ kind: "declare-blockers", assignments: [] }]);
    });

    it("DOES offer blocking a menace attacker with two blockers", () => {
        const attacker = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            staticAbilities: ["menace"],
        });
        const b1 = makeInstance(BEARS, {
            id: "blk-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b2 = makeInstance(BEARS, {
            id: "blk-2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [b1, b2] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: [attacker.id],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const moves = enumerateMoves(state, "p2");
        const blockBoth = moves.find(
            (m) =>
                m.kind === "declare-blockers" &&
                m.assignments.length === 2 &&
                m.assignments.every((a) => a.attackerId === attacker.id)
        );
        expect(blockBoth).toBeDefined();
        // The illegal single-blocker combos must be absent.
        const hasSingle = moves.some(
            (m) => m.kind === "declare-blockers" && m.assignments.length === 1
        );
        expect(hasSingle).toBe(false);
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

// ---------------------------------------------------------------------------
// Copy-on-ETB cast prune (issue #938)
// ---------------------------------------------------------------------------
//
// A "copy-on-ETB" spell (Clone, Copy Artifact, Vesuvan Doppelganger, Dance of
// Many) enters as / makes a token copy of a permanent already in play. Casting
// one with no permanent it could copy is legal but strictly wasteful — it
// resolves into a do-nothing permanent while spending mana + a card. The Bot's
// move enumerator must not offer that cast. CR legality is unchanged; only Bot
// enumeration is constrained. The guard is keyed off the declarative
// `copySourceFilter`, so the whole class inherits it (no card-id allowlist).

const ISLAND = getCardByName("Island").id; // {T}: Add {U}
const COPY_ARTIFACT = getCardByName("Copy Artifact").id; // {1}{U} enchantment
const CLONE = getCardByName("Clone").id; // {3}{U} creature
const ANKH = getCardByName("Ankh of Mishra").id; // pure Artifact (noncreature)

function castsFor(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): Move[] {
    return enumerateMoves(state, playerId).filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === cardInstanceId
    );
}

describe("enumerateMoves — copy-on-ETB cast prune (issue #938)", () => {
    it("does NOT offer Copy Artifact when no artifact is on the battlefield", () => {
        const copyArtifact = makeInstance(COPY_ARTIFACT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [copyArtifact],
            battlefield: [land(ISLAND, "p1"), land(ISLAND, "p1")], // {1}{U} payable
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(castsFor(state, "p1", copyArtifact.id)).toHaveLength(0);
    });

    it("DOES offer Copy Artifact when an artifact is in play (no regression)", () => {
        const copyArtifact = makeInstance(COPY_ARTIFACT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [copyArtifact],
            battlefield: [
                land(ISLAND, "p1"),
                land(ISLAND, "p1"),
                makeInstance(ANKH, { controllerId: "p1", ownerId: "p1" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(castsFor(state, "p1", copyArtifact.id)).toHaveLength(1);
    });

    it("does NOT offer Clone when no creature is on the battlefield", () => {
        const clone = makeInstance(CLONE, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [clone],
            // {3}{U} payable — four Islands, still no creature to copy.
            battlefield: [
                land(ISLAND, "p1"),
                land(ISLAND, "p1"),
                land(ISLAND, "p1"),
                land(ISLAND, "p1"),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(castsFor(state, "p1", clone.id)).toHaveLength(0);
    });

    it("DOES offer Clone when a creature is in play, even an opponent's", () => {
        const clone = makeInstance(CLONE, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [clone],
            battlefield: [
                land(ISLAND, "p1"),
                land(ISLAND, "p1"),
                land(ISLAND, "p1"),
                land(ISLAND, "p1"),
            ],
        });
        // "any creature on the battlefield" (allControllers) — opponent's counts.
        const p2 = makePlayer("p2", {
            battlefield: [
                makeInstance(BEARS, { controllerId: "p2", ownerId: "p2" }),
            ],
        });
        const state = makeState({ players: [p1, p2] });
        expect(castsFor(state, "p1", clone.id)).toHaveLength(1);
    });
});

describe("copy-on-ETB class — declarative copySourceFilter (issue #938)", () => {
    it("marks exactly the copy-on-ETB catalogue with a copySourceFilter", () => {
        const flagged = getAllCards()
            .filter((c) => c.copySourceFilter !== undefined)
            .map((c) => c.name)
            .sort();
        expect(flagged).toEqual(
            [
                "Clone",
                "Copy Artifact",
                "Dance of Many",
                "Phyrexian Metamorph",
                "Vesuvan Doppelganger",
            ].sort()
        );
    });

    it("keys each guard off the copiable source type (not a card-id list)", () => {
        const byName = (name: string) =>
            getAllCards().find((c) => c.name === name)!;
        expect(byName("Copy Artifact").copySourceFilter).toEqual({
            types: "Artifact",
        });
        expect(byName("Clone").copySourceFilter).toEqual({ types: "Creature" });
        expect(byName("Vesuvan Doppelganger").copySourceFilter).toEqual({
            types: "Creature",
        });
        expect(byName("Dance of Many").copySourceFilter).toEqual({
            types: "Creature",
            isToken: false,
        });
    });
});

// ---------------------------------------------------------------------------
// Gate ↔ enumerator cost-modifier parity (CR 601.2f, ADR 0063, issue #1337
// pre-merge review finding).
// ---------------------------------------------------------------------------
//
// `getLegalActions` (rules.ts) folds battlefield cost-modifier static effects
// AND a spell's own `selfCostReduction` into its "cast" affordability check.
// `enumerateCastMoves` (moves.ts) MUST agree — its `normCost`/tap plan is built
// from the same reduced cost — or the human UI offers "cast" while the Bot's
// move enumerator silently yields zero cast moves for that exact card. Both
// assertions below run against the SAME state so a divergence between the two
// single-authority call sites fails loudly.

const EMRY = getCardByName("Emry, Lurker of the Loch").id; // {2}{U}, affinity for artifacts
const ORNITHOPTER = getCardByName("Ornithopter").id; // {0} Artifact Creature
const STONE_CALENDAR = getCardByName("Stone Calendar").id; // "Spells you cast cost {1} less"

function legalActionsFor(
    state: GameState,
    playerId: string,
    card: CardInstanceState
) {
    const player = state.players.find((p) => p.id === playerId)!;
    return getLegalActions(state, player, card);
}

describe("gate ↔ enumerator cost-modifier parity (CR 601.2f, issue #1337)", () => {
    it("Emry: getLegalActions offers cast AND enumerateMoves yields a cast move (1 Island + 2 Ornithopters)", () => {
        const emry = makeInstance(EMRY, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [emry],
            battlefield: [
                land(ISLAND, "p1"),
                makeInstance(ORNITHOPTER, {
                    controllerId: "p1",
                    ownerId: "p1",
                }),
                makeInstance(ORNITHOPTER, {
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        // The gate: unreduced {2}{U} isn't payable with one Island, but the
        // 2 artifacts reduce it to {U} — "cast" must be offered.
        expect(legalActionsFor(state, "p1", emry)).toContain("cast");

        // The enumerator must agree: at least one cast-spell move for Emry,
        // with a tap plan the Island alone can cover.
        const casts = castsFor(state, "p1", emry.id);
        expect(casts).toHaveLength(1);
        const cast = casts[0];
        expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([
            { cardInstanceId: expect.any(String) },
        ]);
    });

    it("does NOT offer an Emry cast move with no artifacts and only one Island (unreduced {2}{U} unaffordable)", () => {
        const emry = makeInstance(EMRY, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [emry],
            battlefield: [land(ISLAND, "p1")],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(legalActionsFor(state, "p1", emry)).not.toContain("cast");
        expect(castsFor(state, "p1", emry.id)).toHaveLength(0);
    });

    it("Stone Calendar (fixed-literal reducer): gate and enumerator agree a {1}{G} spell is castable off a single Forest", () => {
        const bears = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bears],
            battlefield: [
                land(FOREST, "p1"),
                makeInstance(STONE_CALENDAR, {
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        // Unreduced {1}{G} needs two mana sources; Stone Calendar's {1}
        // reduction drops it to {G} alone, payable off the single Forest.
        expect(legalActionsFor(state, "p1", bears)).toContain("cast");
        expect(castsFor(state, "p1", bears.id)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Gate ↔ planner board-dependent mana-source parity (issue #1751 finding 4).
// ---------------------------------------------------------------------------
//
// `getLegalActions` (rules.ts) threads the real board into `coloredCostLeftover`
// / `getProducibleManaUnits`, so a board-dependent mana ability (Mox Opal's
// Metalcraft) is visible to the human castability gate. Before this fix,
// `getProducibleManaOptions` — the Bot's `planManaPayment` (moves.ts) relies on
// it — was ALWAYS called with no board at all (`getManaTapOptionsDetailed(card,
// undefined, undefined, …)`), so `canActivate` saw `minimalManaGateView(undefined)`
// = `{ players: [] }` and Mox Opal's Metalcraft-gated ability was permanently
// unavailable to the planner: `options.size === 0` → the source is skipped →
// `planManaPayment` returns `null` → `enumerateCastMoves` drops the cast
// entirely, even on a board where `getLegalActions` correctly offers "cast".
// The Bot could never cast a spell funded only by a board-dependent source.

const MOX_OPAL = getCardByName("Mox Opal").id; // {T}: Add one mana of any colour. Metalcraft.

describe("gate ↔ planner board-dependent mana-source parity (issue #1751 finding 4)", () => {
    it("Mox Opal (Metalcraft satisfied): getLegalActions offers cast AND enumerateMoves yields a cast move for Lightning Bolt", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            battlefield: [
                makeInstance(MOX_OPAL, { controllerId: "p1", ownerId: "p1" }),
                makeInstance(ANKH, { controllerId: "p1", ownerId: "p1" }),
                makeInstance(ANKH, { controllerId: "p1", ownerId: "p1" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        // The gate: Mox Opal + 2 Ankh of Mishra = 3 artifacts, Metalcraft
        // satisfied, Mox Opal's any-colour ability alone pays Bolt's {R}.
        expect(legalActionsFor(state, "p1", bolt)).toContain("cast");

        // The planner must agree: at least one cast-spell move for Bolt
        // (Bolt's "any target" requirement yields one move per legal target —
        // p1 and p2 are both legal, hence 2), each with a tap plan that taps
        // Mox Opal (a choice-based source, so its tap carries a
        // `manaChoiceIndex`).
        const casts = castsFor(state, "p1", bolt.id);
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([
                {
                    cardInstanceId: expect.any(String),
                    manaChoiceIndex: expect.any(Number),
                },
            ]);
        }
    });

    it("does NOT offer a Bolt cast move when Metalcraft is unsatisfied (Mox Opal alone, only 1 artifact)", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            battlefield: [
                makeInstance(MOX_OPAL, { controllerId: "p1", ownerId: "p1" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(legalActionsFor(state, "p1", bolt)).not.toContain("cast");
        expect(castsFor(state, "p1", bolt.id)).toHaveLength(0);
    });
});

describe("enumerateCastMoves — getCostModifiers hoisted out of the mode×X loop (issue #1663)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("calls getCostModifiers exactly once per candidate card, not once per (mode, X) combination", () => {
        const fireball = makeInstance(FIREBALL, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [fireball],
            // R + 2 extra generic available -> X can be 0, 1, or 2 (3 values),
            // each with 2 legal "any" targets (both players, no creatures) —
            // several (mode, X) combinations from ONE candidate card.
            battlefield: [
                land(MOUNTAIN, "p1"),
                land(MOUNTAIN, "p1"),
                land(MOUNTAIN, "p1"),
            ],
        });
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });

        const spy = vi.spyOn(stateModule, "getCostModifiers");
        const casts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );

        // Sanity: the enumeration actually walked multiple (mode, X)
        // combinations for this single card — otherwise the call-count
        // assertion below would be vacuously true.
        expect(casts.length).toBeGreaterThan(1);
        expect(new Set(casts.map((c) => c.chosenX)).size).toBe(3);

        // The hoist under test: exactly TWO getCostModifiers calls total for
        // this single candidate card — one from the `getLegalActions` gate
        // (`canPotentiallyPayCost`, rules.ts) that `enumerateMoves` consults
        // before enumerating, plus ONE hoisted call inside
        // `enumerateCastMoves` — regardless of how many (mode, X)
        // combinations were enumerated. Before the fix the enumerator alone
        // called it once per combination (3 here), for 1 (gate) + 3
        // (per-combination) = 4 total.
        expect(spy).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------
// Sorcery-speed activated abilities (CR 602.3b / 307.5)
// ---------------------------------------------------------------------------

describe("enumerateAbilityMoves — zone-restricted abilities (CR 113.6 / 702.29a)", () => {
    const TRIOME = getCardByName("Raugrin Triome").id;
    const GHOUL = getCardByName("Ashen Ghoul").id;

    it("does NOT offer Cycling off a Triome already on the battlefield", () => {
        // Cycling is `activateFromHand` — it functions ONLY from the hand. The
        // human UI hides it on a battlefield permanent (`getStackAbilities`)
        // and the server rejects it (`activateAbility`); the bot enumerator
        // must mirror both, or the Brain burns a move the server refuses.
        const triome = makeInstance(TRIOME, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [
                triome,
                land(FOREST, "p1"),
                land(FOREST, "p1"),
                land(MOUNTAIN, "p1"),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const cycling = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "activate-ability" && m.abilityId === "cycling"
        );
        expect(cycling).toHaveLength(0);
    });

    it("does NOT offer an activateFromGraveyard ability off the battlefield", () => {
        const ghoul = makeInstance(GHOUL, {
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const p1 = makePlayer("p1", {
            battlefield: [ghoul, land(FOREST, "p1"), land(FOREST, "p1")],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const fromGrave = enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === ghoul.id &&
                m.abilityId !== undefined
        );
        expect(fromGrave).toHaveLength(0);
    });
});

describe("enumerateAbilityMoves — sorcerySpeedOnly timing (CR 602.3b)", () => {
    const SKULLCLAMP = getCardByName("Skullclamp").id;

    function clampBoard(): GameState {
        const clamp = makeInstance(SKULLCLAMP, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const bears = makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const p1 = makePlayer("p1", {
            battlefield: [clamp, bears, land(FOREST, "p1")],
        });
        return makeState({ players: [p1, makePlayer("p2")] });
    }

    function equipMoves(state: GameState): Move[] {
        return enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "skullclamp-equip"
        );
    }

    it("offers Equip at sorcery timing (own main phase, empty stack)", () => {
        expect(equipMoves(clampBoard())).toHaveLength(1);
    });

    it("does NOT offer Equip in DECLARE_ATTACKERS once attackers are confirmed", () => {
        // The exact live-game shape that softlocked the board: attackers
        // confirmed, so the enumerator falls through to the ordinary priority
        // window and the bot could reach a sorcery-speed Equip. Because Equip
        // is TARGETED, activating it opened a `pendingTarget` the downstream
        // timing check then refused to finalize — the game sat forever on
        // `expectedInput.kind === "target"`.
        const state = clampBoard();
        state.phase = "DECLARE_ATTACKERS";
        state.combat = {
            attackerIds: [],
            blockerAssignments: {},
            blockersConfirmed: false,
            confirmed: true,
        };
        expect(equipMoves(state)).toHaveLength(0);
    });

    it("does NOT offer Equip while something is on the stack in a main phase", () => {
        const state = clampBoard();
        pushSpell(state, BOLT, "p2");
        state.priorityPlayerId = "p1";
        expect(equipMoves(state)).toHaveLength(0);
    });
});
