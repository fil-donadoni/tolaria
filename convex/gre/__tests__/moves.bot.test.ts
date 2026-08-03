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
import type { CardInstanceState, GameState, PlayerState } from "../state";
import * as stateModule from "../state";
import { enumerateMoves, planManaPayment, type Move } from "../moves";
import { getLegalActions, maxAffordableX } from "../rules";
import {
    getAttackerCap,
    getRequiredAttackerIds,
    foldAttackRequirements,
} from "../combat";

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
    // Issue #1754 — `planManaPayment` now takes the full `GameState` (not
    // just `player`) so it can build a both-players `battlefields` view for
    // `getProducibleManaOptions`. These fixture-only tests don't care about
    // an opponent board, so a bare two-player `makeState` with `p` as one
    // side is enough plumbing.
    function stateWith(p: PlayerState): GameState {
        return makeState({ players: [p, makePlayer("p2")] });
    }

    it("returns an empty plan for a zero cost", () => {
        const p = makePlayer("p1");
        expect(planManaPayment(stateWith(p), p, {})).toEqual([]);
    });

    it("plans colored then generic from untapped lands", () => {
        const p = makePlayer("p1", {
            battlefield: [land(FOREST, "p1"), land(FOREST, "p1")],
        });
        const plan = planManaPayment(stateWith(p), p, { G: 1, X: 1 });
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(2);
    });

    it("uses pool mana before tapping (fewer taps)", () => {
        const p = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
            battlefield: [land(FOREST, "p1")],
        });
        // Need GG: one from pool (no tap), one from the Forest.
        const plan = planManaPayment(stateWith(p), p, { G: 2 });
        expect(plan).toHaveLength(1);
    });

    it("returns null when sources cannot cover the cost", () => {
        const p = makePlayer("p1", { battlefield: [land(FOREST, "p1")] });
        expect(planManaPayment(stateWith(p), p, { R: 1 })).toBeNull();
    });

    it("skips tapped sources", () => {
        const tapped = makeInstance(FOREST, {
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const p = makePlayer("p1", { battlefield: [tapped] });
        expect(planManaPayment(stateWith(p), p, { G: 1 })).toBeNull();
    });

    // Regression: a dual land (Bayou) carries both basic land subtypes
    // (Swamp, Forest) AND a manaChoices ability. `tapForPayment` pays it via
    // the choice ability and requires a `manaChoiceIndex`; the plan must
    // supply one. Before the fix the intrinsic-subtype path claimed B/G with
    // no index, so the plan emitted a choice-less tap and the mutation threw
    // "Must choose a mana color".
    it("emits a manaChoiceIndex for dual-land choice sources", () => {
        const p = makePlayer("p1", { battlefield: [land(BAYOU, "p1")] });
        const state = stateWith(p);

        const planB = planManaPayment(state, p, { B: 1 });
        expect(planB).toHaveLength(1);
        expect(planB![0].manaChoiceIndex).toBeTypeOf("number");

        const planG = planManaPayment(state, p, { G: 1 });
        expect(planG).toHaveLength(1);
        expect(planG![0].manaChoiceIndex).toBeTypeOf("number");
    });

    // Issue #1754 — gate↔enumerator parity for an OPPONENT-SCANNING mana
    // chooser. Fellwar Stone's `getManaChoices` walks every OTHER player's
    // battlefield and explicitly skips entries matching `controllerId`
    // (`convex/cards/sets/drk/colorless.ts`); a self-only `battlefields` view
    // (own controllerId + own battlefield alone) makes it see zero opponents
    // and return `[]`, so the OLD self-only planner dropped this source even
    // though the human castability gate (which gets the full board via
    // `opts.state`) offered the cast. Passing the full `state` here is what
    // this issue fixes — this test is a regression guard for that specific
    // gap, not covered by the pre-existing Mox Opal parity test below (a
    // self-referential ability, satisfiable from a self-only view).
    it("sees a Fellwar Stone funded by an OPPONENT's land (opponent-scanning chooser)", () => {
        const fellwar = makeInstance(getCardByName("Fellwar Stone").id, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", { battlefield: [fellwar] });
        const p2 = makePlayer("p2", { battlefield: [land(FOREST, "p2")] });
        const state = makeState({ players: [p1, p2] });

        const plan = planManaPayment(state, p1, { G: 1 });
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(1);
        expect(plan![0].cardInstanceId).toBe(fellwar.id);
        expect(plan![0].manaChoiceIndex).toBeTypeOf("number");
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
                "Phantasmal Image",
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
const DRACO = getCardByName("Draco").id; // {16}, {2} less per basic land type
const SOL_RING = getCardByName("Sol Ring").id; // {T}: Add {C}{C}
const PLAINS = getCardByName("Plains").id;
const SWAMP = getCardByName("Swamp").id;

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

    // Domain-driven reducer (issue #1958). Draco is printed at {16}: without
    // the reduction folded into the enumerator the Bot can NEVER cast it on any
    // realistic board, so a server-only fix would leave it a dead card for the
    // Bot (and for the client-side Brain, which runs this same enumerator).
    it("Draco (Domain reducer): gate and enumerator agree it is castable off five basic land types + a Sol Ring", () => {
        const dracoCard = makeInstance(DRACO, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const basics = [PLAINS, ISLAND, SWAMP, MOUNTAIN, FOREST].map((id) =>
            land(id, "p1")
        );
        const p1 = makePlayer("p1", {
            hand: [dracoCard],
            // Domain 5 → {16} - 5 × {2} = {6}. Five basics give five mana; the
            // Sol Ring's {C}{C} completes exactly {6}.
            battlefield: [
                ...basics,
                makeInstance(SOL_RING, { controllerId: "p1", ownerId: "p1" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(legalActionsFor(state, "p1", dracoCard)).toContain("cast");
        expect(castsFor(state, "p1", dracoCard.id)).toHaveLength(1);
    });

    it("does NOT offer a Draco cast move at Domain 1 — six mana is nowhere near the {14} price", () => {
        const dracoCard = makeInstance(DRACO, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        // Five Forests: five LANDS but Domain 1, so the reduction is only {2}.
        const p1 = makePlayer("p1", {
            hand: [dracoCard],
            battlefield: [
                ...[0, 1, 2, 3, 4].map(() => land(FOREST, "p1")),
                makeInstance(SOL_RING, { controllerId: "p1", ownerId: "p1" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(legalActionsFor(state, "p1", dracoCard)).not.toContain("cast");
        expect(castsFor(state, "p1", dracoCard.id)).toHaveLength(0);
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
        const moxOpal = makeInstance(MOX_OPAL, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            battlefield: [
                moxOpal,
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
        // p1's OWN Mox Opal (a choice-based source, so its tap carries a
        // `manaChoiceIndex`) — asserting the concrete instance id, not just
        // "some string", is what would catch the wider board view letting the
        // planner tap the wrong permanent (issue #1754 finding 5; verified by
        // temporarily widening the source loop to every player's battlefield
        // and confirming this exact assertion catches the resulting
        // wrong-permanent tap while a loose `expect.any(String)` does not).
        const casts = castsFor(state, "p1", bolt.id);
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([
                {
                    cardInstanceId: moxOpal.id,
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

// Issue #1754 — residual gap from #1751/#1752: `planManaPayment` (moves.ts)
// was given a real, if SELF-ONLY, board view (own controllerId + own
// battlefield) so a self-referential board-dependent source (Mox Opal above)
// agreed with the gate. That self-only view does NOT extend to an
// OPPONENT-SCANNING chooser: Fellwar Stone's `getManaChoices`
// (`convex/cards/sets/drk/colorless.ts`) walks every OTHER player's
// battlefield and explicitly skips entries matching `controllerId` — with a
// self-only view it sees zero opponents and returns `[]`, so
// `getProducibleManaOptions` reports no options, the source is skipped, and
// `planManaPayment` drops the cast even though `getLegalActions` — which
// gets the FULL both-players board via `coloredCostLeftover`'s `opts.state`
// — correctly offers "cast". This describe block is the parity guard for
// exactly that gap: `planManaPayment` now takes `state` and builds the same
// both-players view the gate does.
const FELLWAR_STONE = getCardByName("Fellwar Stone").id; // {T}: Add one mana of any color an opponent's land could produce.

describe("gate ↔ planner opponent-scanning mana-source parity (issue #1754)", () => {
    it("Fellwar Stone funded by an opponent's Mountain: getLegalActions offers cast AND enumerateMoves yields a cast move for Lightning Bolt", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const fellwar = makeInstance(FELLWAR_STONE, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            battlefield: [fellwar],
        });
        // p1 has NO mana source of its own — Bolt's {R} can only come from
        // Fellwar Stone reading p2's Mountain (opponent-scanning).
        const p2 = makePlayer("p2", {
            battlefield: [land(MOUNTAIN, "p2")],
        });
        const state = makeState({ players: [p1, p2] });

        // The gate: `coloredCostLeftover` sees p2's Mountain via `opts.state`,
        // so Fellwar Stone's `getManaChoices` offers {R} and Bolt is castable.
        expect(legalActionsFor(state, "p1", bolt)).toContain("cast");

        // The planner must agree: at least one cast-spell move for Bolt, each
        // tapping p1's OWN Fellwar Stone (a choice-based source, so its tap
        // carries a `manaChoiceIndex`). Asserting the concrete instance id
        // (not `expect.any(String)`) is the point of this test: the PR's
        // central risk is the wider board view letting the planner tap an
        // OPPONENT's permanent instead, which a loose `any(String)` match
        // would not catch (issue #1754 finding 5; verified by temporarily
        // widening the source loop to every player's battlefield — with a
        // second opposing land breaking the greedy tie — and confirming this
        // exact assertion catches the resulting wrong-permanent tap while a
        // loose `expect.any(String)` does not).
        const casts = castsFor(state, "p1", bolt.id);
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([
                {
                    cardInstanceId: fellwar.id,
                    manaChoiceIndex: expect.any(Number),
                },
            ]);
        }
    });

    it("does NOT offer a Bolt cast move when the opponent controls no mana-producing land (Fellwar Stone alone, empty opposing board)", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            battlefield: [
                makeInstance(FELLWAR_STONE, {
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(legalActionsFor(state, "p1", bolt)).not.toContain("cast");
        expect(castsFor(state, "p1", bolt.id)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Board-derived restricted-colour mana sources (CR 605.1a, issue #1941).
// The three PLS C6 cards declare a DECLARATIVE `manaColorSource` descriptor
// instead of a `getManaChoices` closure. The bot reads their output through the
// same `getManaTapOptionsDetailed` authority as everything else, so this is the
// parity guard that the descriptor is visible to the planner (available-mana
// assessment) and not only to the human castability gate.
// ---------------------------------------------------------------------------
const QUIRION_EXPLORER = getCardByName("Quirion Explorer").id;
const STAR_COMPASS = getCardByName("Star Compass").id;
const METEOR_CRATER = getCardByName("Meteor Crater").id;
const CRAW_WURM = getCardByName("Craw Wurm").id; // {3}{G} — a green permanent
const FOG = getCardByName("Fog").id; // {G} instant, no targets

describe("board-derived mana descriptors: gate ↔ planner parity (issue #1941)", () => {
    it("Quirion Explorer funded by an opponent's Mountain: cast is offered AND planned", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const elf = makeInstance(QUIRION_EXPLORER, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bolt], battlefield: [elf] }),
                makePlayer("p2", { battlefield: [land(MOUNTAIN, "p2")] }),
            ],
        });
        expect(legalActionsFor(state, "p1", bolt)).toContain("cast");
        const casts = castsFor(state, "p1", bolt.id);
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([
                {
                    cardInstanceId: elf.id,
                    manaChoiceIndex: expect.any(Number),
                },
            ]);
        }
    });

    it("Star Compass funded by the controller's own basic Mountain: cast is offered AND planned", () => {
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const compass = makeInstance(STAR_COMPASS, {
            controllerId: "p1",
            ownerId: "p1",
        });
        // The Mountain is TAPPED, so the compass is the only AVAILABLE source —
        // but a tapped land still "could produce" {R} (CR 106.4).
        const tappedMountain = land(MOUNTAIN, "p1");
        tappedMountain.isTapped = true;
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [bolt],
                    battlefield: [compass, tappedMountain],
                }),
                makePlayer("p2"),
            ],
        });
        expect(legalActionsFor(state, "p1", bolt)).toContain("cast");
        const casts = castsFor(state, "p1", bolt.id);
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([
                {
                    cardInstanceId: compass.id,
                    manaChoiceIndex: expect.any(Number),
                },
            ]);
        }
    });

    it("Meteor Crater reads a permanent's COLOUR, not what it produces (no green permanent → no cast)", () => {
        // Fog is {G} with no targets, so this isolates the mana question.
        const fogInHand = makeInstance(FOG, {
            id: "fog-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const crater = makeInstance(METEOR_CRATER, {
            id: "crater-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A Mountain taps for {R} but is a COLOURLESS land (CR 202.2), so
        // Meteor Crater's "isColor" read finds nothing on this board.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [fogInHand],
                    battlefield: [crater, land(MOUNTAIN, "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        expect(legalActionsFor(state, "p1", fogInHand)).not.toContain("cast");
        expect(castsFor(state, "p1", fogInHand.id)).toHaveLength(0);

        // A GREEN permanent enters — the crater now offers {G} and both the
        // gate and the planner pick it up.
        state.players[0].battlefield.push(
            makeInstance(CRAW_WURM, {
                id: "wurm-1",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(legalActionsFor(state, "p1", fogInHand)).toContain("cast");
        const casts = castsFor(state, "p1", fogInHand.id);
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([
                {
                    cardInstanceId: crater.id,
                    manaChoiceIndex: expect.any(Number),
                },
            ]);
        }
    });
});

// ---------------------------------------------------------------------------
// Gate ↔ enumerator {X}-ceiling parity for a board-dependent mana source
// (issue #1757 — last link in the #1695 → #1751 → #1754 → #1756 chain).
// ---------------------------------------------------------------------------
//
// `enumerateCastMoves` derives an {X} spell's X ceiling from
// `maxAffordableX(player, card)` with NO `state`, while `hasEnoughLegalTargets`
// (rules.ts) calls the SAME helper WITH `state`. `maxAffordableX` only forwards
// board-dependent mana visibility (Mox Opal's Metalcraft, CR 602.5b) into
// `coloredCostLeftover` when handed a `state` — so before this fix the Bot's
// {X} ceiling for Fireball was computed as if Mox Opal produced nothing at
// all (Metalcraft's `canActivate` sees `{ players: [] }` and reports false),
// one lower than the ceiling the human castability gate (and the real
// `planManaPayment` tap plan, which DOES get a board) can actually reach.
// Under-offer only: the Bot never proposes the higher, still-legal X.
describe("gate ↔ enumerator X-ceiling parity for a board-dependent mana source (issue #1757)", () => {
    it("Fireball ({X}{R}) funded by a Metalcraft-satisfied Mox Opal: maxAffordableX and the enumerator's highest chosenX agree, and the extra X pip taps Mox Opal", () => {
        const fireball = makeInstance(FIREBALL, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const mountain = land(MOUNTAIN, "p1");
        const moxOpal = makeInstance(MOX_OPAL, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            hand: [fireball],
            battlefield: [
                mountain,
                moxOpal,
                makeInstance(ANKH, { controllerId: "p1", ownerId: "p1" }),
                makeInstance(ANKH, { controllerId: "p1", ownerId: "p1" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players.find((p) => p.id === "p1")!;

        // The gate: Mox Opal + 2 Ankh of Mishra = 3 artifacts, Metalcraft
        // satisfied. One Mountain pays Fireball's {R}; the leftover source is
        // Mox Opal's any-colour mana, which funds exactly one more X — so
        // `maxAffordableX` (board-aware) reaches X = 1, not X = 0.
        expect(maxAffordableX(player, fireball, state)).toBe(1);

        // The enumerator must agree: its highest offered `chosenX` for
        // Fireball is 1, not 0 — the board-blind bug capped it at 0 (a
        // Mountain alone pays only the fixed {R}, leaving nothing for X).
        const casts = castsFor(state, "p1", fireball.id).filter(
            (m): m is Move & { kind: "cast-spell" } => m.kind === "cast-spell"
        );
        expect(casts.length).toBeGreaterThan(0);
        const chosenXValues = new Set(casts.map((c) => c.chosenX ?? 0));
        expect(Math.max(...chosenXValues)).toBe(1);

        // Every X = 1 move's tap plan must tap the SPECIFIC Mox Opal instance
        // (not `expect.any(String)` — a loose assertion here was recently
        // shown to pass under the exact fault it exists to catch, issue
        // #1757's test requirement): the Mountain pays the coloured {R} pip,
        // Mox Opal's choice-based any-colour ability pays the one generic
        // pip X = 1 draws from.
        const x1Casts = casts.filter((c) => (c.chosenX ?? 0) === 1);
        expect(x1Casts.length).toBeGreaterThan(0);
        for (const cast of x1Casts) {
            expect(cast.tapPlan).toEqual([
                { cardInstanceId: mountain.id },
                {
                    cardInstanceId: moxOpal.id,
                    manaChoiceIndex: expect.any(Number),
                },
            ]);
        }

        // No X = 2 move is ever offered: only one leftover source (Mox Opal)
        // exists once the Mountain pays {R}, so X = 2 is genuinely unaffordable
        // — the fix must not OVER-offer either.
        expect(chosenXValues.has(2)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Gate ↔ enumerator Phyrexian-split (CR 107.4f) board-dependent mana-source
// parity (issue #1757 finding 1) — a FIFTH board-blind holdout in the same
// #1695 → #1751 → #1754 → #1756 → #1757 chain, ten lines below the delve fix
// this PR otherwise closes out.
// ---------------------------------------------------------------------------
//
// `enumerateCastMoves` called `solvePhyrexianSplit(player, card, rawCost,
// x ?? 0)` with NO `state` — its 5th, optional param — so the split solver's
// `canPayNormalizedCost` → `coloredCostLeftover` probe ran board-blind
// (`getProducibleManaUnits`'s `{ players: [] }` fallback), while
// `getLegalActions` (rules.ts) forwards its own `state` into the SAME
// `solvePhyrexianSplit` at its `canPotentiallyPayCost` call site. Gitaxian
// Probe ({U/P}) with the caster at 1 life (so the life-pip branch is
// unaffordable — `Math.floor(1 / 2) === 0`) can ONLY be cast by paying the
// pip with mana; a Metalcraft-satisfied Mox Opal is that mana, and it is
// invisible to the board-blind solver — `split === null` for every mode/X —
// so the enumerator silently dropped the cast the gate legally offered.
const GITAXIAN_PROBE = getCardByName("Gitaxian Probe").id; // {U/P} Sorcery, target player

describe("gate ↔ enumerator Phyrexian-split board-dependent mana-source parity (issue #1757 finding 1)", () => {
    it("Gitaxian Probe ({U/P}), p1 at 1 life, Mox Opal (Metalcraft satisfied): getLegalActions offers cast AND enumerateMoves yields a cast move", () => {
        const probe = makeInstance(GITAXIAN_PROBE, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const moxOpal = makeInstance(MOX_OPAL, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            life: 1,
            hand: [probe],
            battlefield: [
                moxOpal,
                makeInstance(ANKH, { controllerId: "p1", ownerId: "p1" }),
                makeInstance(ANKH, { controllerId: "p1", ownerId: "p1" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        // The gate: at 1 life, the life-pip branch of the {U/P} split can pay
        // 0 pips (floor(1/2) = 0), so the ONLY affordable split pays the pip
        // with mana — Mox Opal (Metalcraft satisfied: itself + 2 Ankh of
        // Mishra = 3 artifacts) supplies it.
        expect(legalActionsFor(state, "p1", probe)).toContain("cast");

        // The planner must agree: at least one cast-spell move for Gitaxian
        // Probe, each tapping p1's OWN Mox Opal (a choice-based source, hence
        // `manaChoiceIndex`) for the {U/P} pip's mana leg — before the fix
        // this was an empty array (every mode/X candidate's
        // `solvePhyrexianSplit` returned `null` board-blind, so the loop
        // `continue`d past every one).
        const casts = castsFor(state, "p1", probe.id).filter(
            (m): m is Move & { kind: "cast-spell" } => m.kind === "cast-spell"
        );
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.tapPlan).toEqual([
                {
                    cardInstanceId: moxOpal.id,
                    manaChoiceIndex: expect.any(Number),
                },
            ]);
        }
    });

    it("does NOT offer a Gitaxian Probe cast move when Metalcraft is unsatisfied (Mox Opal alone, only 1 artifact, p1 at 1 life)", () => {
        const probe = makeInstance(GITAXIAN_PROBE, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            life: 1,
            hand: [probe],
            battlefield: [
                makeInstance(MOX_OPAL, { controllerId: "p1", ownerId: "p1" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        // No source can pay the {U/P} pip (Mox Opal inert, life too low for
        // the life-pip branch): both the gate and the enumerator agree it is
        // uncastable.
        expect(legalActionsFor(state, "p1", probe)).not.toContain("cast");
        expect(castsFor(state, "p1", probe.id)).toHaveLength(0);
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
// Sorcery-speed activated abilities (CR 602.5d / 307.5)
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

describe("enumerateAbilityMoves — sorcerySpeedOnly timing (CR 602.5d)", () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Declared-attacker / declared-blocker count cap in the bot's enumeration
// (CR 508.1a / 509.1a, issue #1127)
// ─────────────────────────────────────────────────────────────────────────────

describe("combat declaration cap in move enumeration (CR 508.1a / 509.1a)", () => {
    const DUELING_GROUNDS = getCardByName("Dueling Grounds").id;
    const JUGGERNAUT = getCardByName("Juggernaut").id; // attacks each combat if able

    function attackerMoves(state: GameState): Move[] {
        return enumerateMoves(state, "p1").filter(
            (m) => m.kind === "declare-attackers"
        );
    }

    /** p1 declaring attackers with `creatureIds` worth of `defId`; the cap sits
     *  on p2's battlefield (symmetric — it binds the attacker regardless). */
    function board(defId: string, count: number, withCap: boolean): GameState {
        const creatures = Array.from({ length: count }, (_, i) =>
            makeInstance(defId, {
                id: `c${i}`,
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false,
            })
        );
        const p2Battlefield = withCap
            ? [makeInstance(DUELING_GROUNDS, { id: "dg", controllerId: "p2" })]
            : [];
        return makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: creatures }),
                makePlayer("p2", { battlefield: p2Battlefield }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    it("never enumerates a declaration over the cap", () => {
        const moves = attackerMoves(board(BEARS, 3, true));
        expect(moves.length).toBeGreaterThan(0);
        for (const m of moves) {
            if (m.kind !== "declare-attackers") continue;
            expect(m.attackerIds.length).toBeLessThanOrEqual(1);
        }
        // Without the cap the 3-attacker declaration IS offered — proving the
        // filter above is the cap and not an unrelated limit.
        const uncapped = attackerMoves(board(BEARS, 3, false));
        expect(
            uncapped.some(
                (m) =>
                    m.kind === "declare-attackers" && m.attackerIds.length === 3
            )
        ).toBe(true);
    });

    it("still offers a legal declaration when MORE creatures must attack than the cap allows (CR 508.1d)", () => {
        // Two Juggernauts, cap of one. The required set alone exceeds the cap,
        // so every "required ∪ subset" candidate is over the cap — before the
        // fix that left the bot with NO declare-attackers move at all.
        const moves = attackerMoves(board(JUGGERNAUT, 2, true));
        expect(moves.length).toBeGreaterThan(0);
        const declared = moves
            .filter((m) => m.kind === "declare-attackers")
            .map((m) => (m.kind === "declare-attackers" ? m.attackerIds : []));
        for (const ids of declared) {
            expect(ids).toHaveLength(1);
        }
        // Both choices of WHICH required creature attacks are offered — the bot
        // picks, rather than the engine silently taking the first.
        expect(new Set(declared.flat())).toEqual(new Set(["c0", "c1"]));
    });
});

describe("bot enumeration and the confirm mutation agree on legality (CR 508.1d, issue #1127)", () => {
    const DUELING_GROUNDS_2 = getCardByName("Dueling Grounds").id;
    const JUGGERNAUT_2 = getCardByName("Juggernaut").id;

    /** Dueling Grounds (cap 1) + a must-attack Juggernaut + a voluntary
     *  Grizzly Bears — the board where the mutation and the enumerator used to
     *  disagree: the enumerator refused `["bear"]`, the mutation accepted it. */
    function crowdOutBoard(): GameState {
        return makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(JUGGERNAUT_2, {
                            id: "j1",
                            controllerId: "p1",
                            ownerId: "p1",
                            isSummoningSick: false,
                        }),
                        makeInstance(BEARS, {
                            id: "bear",
                            controllerId: "p1",
                            ownerId: "p1",
                            isSummoningSick: false,
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(DUELING_GROUNDS_2, {
                            id: "dg",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    function declarations(state: GameState): string[][] {
        return enumerateMoves(state, "p1")
            .filter((m) => m.kind === "declare-attackers")
            .map((m) => (m.kind === "declare-attackers" ? m.attackerIds : []));
    }

    it("every declaration the mutation would produce from ANY player selection is an enumerated move", () => {
        const state = crowdOutBoard();
        const defenderBattlefield = state.players[1].battlefield;
        const required = getRequiredAttackerIds(
            state.players[0].battlefield,
            state,
            defenderBattlefield,
            undefined
        );
        const cap = getAttackerCap(state);
        const enumerated = new Set(
            declarations(state).map((ids) => [...ids].sort().join(","))
        );

        // Every subset of the board is a selection the player can toggle into;
        // `foldAttackRequirements` is what `confirmAttackers` turns it into.
        const ids = ["j1", "bear"];
        const selections = [[], ["j1"], ["bear"], ["j1", "bear"]];
        for (const selection of selections) {
            const folded = foldAttackRequirements(selection, required, cap);
            expect(ids).toEqual(expect.arrayContaining(folded));
            expect(enumerated).toContain([...folded].sort().join(","));
        }
    });

    it("the voluntary-only declaration the mutation refuses is never enumerated either", () => {
        expect(declarations(crowdOutBoard())).toEqual([["j1"]]);
    });
});
