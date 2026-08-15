// "Cast off sorcery timing" instance-flag tests (CR 307.1 / 117.1a / 601.3a,
// issue #2473, PRD #1975 slice 3 of 3). Engine capability only in this
// slice — no shipped card reads the flag yet (Necromancy, issue #2392, will).
// Mirrors `dash.test.ts` / `evoke.test.ts`'s structure and their "no shipped
// consumer yet" precedent: a SYNTHETIC probe card exercises the capability
// end-to-end.
//
// This is a PRODUCER CENSUS, not a single-seam feature: the flag is derived
// ONCE from `wasCastOffSorceryTiming` (`convex/gre/phases.ts`) but stamped at
// EVERY site that pushes a spell onto the stack — a missed site is silently
// absent, passes every other test, and reads as done. Covers:
//   - `finalizeTargetSelection`'s targeted immediate-commit branch (normal
//     cast, `convex/game.ts`)
//   - `tryAutoCommitPendingCast`, the shared deferred-commit choke point
//     (`convex/game.ts`) — exercised with an alternative-cost cast (a
//     Dash-shaped mana leg) AND a cast from a non-hand zone (an Ice-
//     Cauldron-style exile permission)
//   - the bot search-tree `cast-spell` Move executor (`convex/gre/applyMove.ts`)
//     — a WHOLESALE reimplementation that does not call into `game.ts` at all
//     and already silently omitted `evoked`/`dashed`/`escaped` before this
//     change
//   - the CR 601.3a / 608.2g cast-during-resolution primitives
//     (`castChosenSpell` / `castFaceDown`, `convex/gre/state.ts`), reached
//     from Word of Command's `resolve()` and the DSL `castDuringResolution`
//     Op — near-always `true` by construction (the resolving spell/ability is
//     still on the stack), but still a COMPUTED snapshot, never a hardcoded
//     literal
//   - inheritance onto the resolving permanent for free (a stack item IS its
//     CardInstanceState, the `escaped`/`evoked`/`dashed` precedent)
//   - both transient-clear sites (`resetStackTransientState` /
//     `resetBattlefieldTransientState`) so a countered-then-recast or
//     bounced-then-recast spell never leaks a stale snapshot
//   - serialization round-trip
//   - the frontend wiring SURFACE: `projectPublicState` carries the field
import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    getPlayer,
    moveCard,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import { tryAutoCommitPendingCast, finalizeTargetSelection } from "../../game";
import { applyMoveForSearch } from "../applyMove";
import type { Move } from "../moves";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";

// A free vanilla creature — cost is irrelevant to every test here (the
// payment machinery is already covered by dash.test.ts / evoke.test.ts); a
// zero mana cost keeps each scenario focused on the timing snapshot alone.
const TIMING_PROBE_ID = "test:timing-probe";
const timingProbe: CardDefinition = {
    id: TIMING_PROBE_ID,
    rarity: "common",
    name: "Timing Probe",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 1,
    toughness: 1,
};
registerTokenDefinition(timingProbe);

// A steep-printed-cost creature with a cheap Dash leg — the vehicle for the
// "cast with an alternative/additional cost" producer. Dash's OWN second
// half (haste grant / end-step return) is irrelevant here; no `dashTrigger`
// is attached.
const TIMING_ALT_COST_PROBE_ID = "test:timing-alt-cost-probe";
const timingAltCostProbe: CardDefinition = {
    id: TIMING_ALT_COST_PROBE_ID,
    rarity: "common",
    name: "Timing Alt Cost Probe",
    manaCost: { X: 5, R: 1 },
    dash: { id: "dash", description: "Dash {R}", mana: { R: 1 } },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 1,
    toughness: 1,
};
registerTokenDefinition(timingAltCostProbe);

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

function exileCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "exile",
        castableFromExileBy: controllerId,
    });
}

describe("cast off sorcery timing — producer census, ≥3 distinct entry paths (CR 307.1 / 117.1a / 601.3a)", () => {
    describe("producer 1: finalizeTargetSelection (targeted immediate-commit branch, normal cast)", () => {
        it("stamps the flag when committed at INSTANT timing (stack empty, but not a main phase)", () => {
            const probeInst = handCard(TIMING_PROBE_ID, "probe");
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [probeInst] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                phase: "DECLARE_ATTACKERS",
            });
            finalizeTargetSelection(
                state,
                {
                    playerId: "p1",
                    cardInstanceId: "probe",
                    targetType: "any",
                    count: 0,
                    selected: [],
                },
                "p1"
            );
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(true);
        });

        it("omits the flag when committed at SORCERY timing", () => {
            const probeInst = handCard(TIMING_PROBE_ID, "probe");
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [probeInst] }),
                    makePlayer("p2"),
                ],
                // makeState's defaults ARE sorcery timing: PRECOMBAT_MAIN,
                // empty stack, active === priority === "p1".
            });
            finalizeTargetSelection(
                state,
                {
                    playerId: "p1",
                    cardInstanceId: "probe",
                    targetType: "any",
                    count: 0,
                    selected: [],
                },
                "p1"
            );
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(
                undefined
            );
        });
    });

    describe("producer 2: tryAutoCommitPendingCast (shared deferred-commit choke point) — a cast with an alternative cost", () => {
        function altCostParkedCast(): GameState {
            const probeInst = handCard(TIMING_ALT_COST_PROBE_ID, "probe");
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [probeInst] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                phase: "DECLARE_ATTACKERS",
            });
            state.players[0].manaPool.R = 1;
            state.pendingCast = {
                playerId: "p1",
                cardInstanceId: "probe",
                manaCost: { R: 1 },
                tappedLandIds: [],
                dashed: true,
            };
            return state;
        }

        it("stamps the flag when committed at INSTANT timing", () => {
            const state = altCostParkedCast();
            const committed = tryAutoCommitPendingCast(state, "p1");
            expect(committed).not.toBeNull();
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(true);
        });

        it("omits the flag when committed at SORCERY timing", () => {
            const state = altCostParkedCast();
            state.phase = "PRECOMBAT_MAIN";
            const committed = tryAutoCommitPendingCast(state, "p1");
            expect(committed).not.toBeNull();
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(
                undefined
            );
        });
    });

    describe("producer 3: tryAutoCommitPendingCast — a cast from a non-hand zone (Ice-Cauldron-style exile permission)", () => {
        function exileParkedCast(): GameState {
            const probeInst = exileCard(TIMING_PROBE_ID, "probe");
            const state = makeState({
                players: [
                    makePlayer("p1", { exile: [probeInst] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                phase: "DECLARE_ATTACKERS",
            });
            state.pendingCast = {
                playerId: "p1",
                cardInstanceId: "probe",
                manaCost: {},
                tappedLandIds: [],
            };
            return state;
        }

        it("stamps the flag when committed at INSTANT timing", () => {
            const state = exileParkedCast();
            const committed = tryAutoCommitPendingCast(state, "p1");
            expect(committed).not.toBeNull();
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(true);
        });

        it("omits the flag when committed at SORCERY timing", () => {
            const state = exileParkedCast();
            state.phase = "PRECOMBAT_MAIN";
            const committed = tryAutoCommitPendingCast(state, "p1");
            expect(committed).not.toBeNull();
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(
                undefined
            );
        });
    });
});

describe("cast off sorcery timing — bot search-tree cast-spell executor (convex/gre/applyMove.ts, issue #2473)", () => {
    // Highest-value producer: this leaf is a WHOLESALE reimplementation of
    // "build a StackItem from a cast" — it never calls into `game.ts` — and
    // already silently omitted `evoked`/`dashed`/`escaped` before this change.
    // Missing it under-fires the flag for every bot self-play game.
    it("stamps the flag on the resulting permanent when cast at INSTANT timing", () => {
        const probeInst = handCard(TIMING_PROBE_ID, "botprobe");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
        });
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "botprobe",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };
        const next = applyMoveForSearch(state, "p1", move);
        const onBoard = next.players[0].battlefield.find(
            (c) => c.id === "botprobe"
        );
        expect(onBoard).toBeDefined();
        expect(onBoard?.castOffSorceryTiming).toBe(true);
    });

    it("omits the flag when cast at SORCERY timing", () => {
        const probeInst = handCard(TIMING_PROBE_ID, "botprobe");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
        });
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "botprobe",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };
        const next = applyMoveForSearch(state, "p1", move);
        const onBoard = next.players[0].battlefield.find(
            (c) => c.id === "botprobe"
        );
        expect(onBoard).toBeDefined();
        expect(onBoard?.castOffSorceryTiming).toBe(undefined);
    });
});

describe("cast off sorcery timing — cast-during-resolution primitives (CR 601.3a / 608.2g, convex/gre/state.ts)", () => {
    // `castChosenSpell` / `castFaceDown` waive only the sorcery-TIMING
    // LEGALITY check (state.ts:16482-16491-ish doc) — that is a legality
    // decision, not a licence to skip the FACTUAL snapshot this flag is.
    // Both sites are reached ONLY mid-resolution (the resolving spell/
    // ability is still on the stack when they run), so the stack is
    // provably non-empty and the flag is near-always `true` by
    // construction — there is no meaningful "sorcery timing" counterpart
    // to assert here (unlike the three producers above, which the issue's
    // acceptance criteria explicitly names); the point of these two tests
    // is that the value is COMPUTED, not hardcoded, and is not skipped just
    // because the timing LEGALITY check next to it is.
    it("castChosenSpell (Word of Command's controlled cast / the DSL castDuringResolution Op) stamps the flag", () => {
        const target = handCard(TIMING_PROBE_ID, "wocTarget", "p2");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [target] })],
        });
        // Stand-in for the resolving Word-of-Command-shaped spell/ability —
        // still on `state.stack` while `castChosenSpell` runs.
        const resolvingItem = pushSpell(state, TIMING_PROBE_ID, "p1");
        const ctx = buildSpellContext(state, resolvingItem);
        const ok = ctx.castChosenSpell("p2", "wocTarget", "p1", {
            free: true,
        });
        expect(ok).toBe(true);
        const newItem = state.stack.find((s) => s.id === "wocTarget");
        expect(newItem).toBeDefined();
        expect((newItem as StackItem).castOffSorceryTiming).toBe(true);
    });

    it("castFaceDown (Illusionary Mask, CR 708.2) stamps the flag", () => {
        const target = handCard(TIMING_PROBE_ID, "faceDownTarget", "p1");
        const state = makeState({
            players: [makePlayer("p1", { hand: [target] }), makePlayer("p2")],
        });
        const resolvingItem = pushSpell(state, TIMING_PROBE_ID, "p1");
        const ctx = buildSpellContext(state, resolvingItem);
        ctx.castFaceDown("faceDownTarget");
        const newItem = state.stack.find((s) => s.id === "faceDownTarget");
        expect(newItem).toBeDefined();
        expect((newItem as StackItem).castOffSorceryTiming).toBe(true);
    });
});

describe("cast off sorcery timing — inheritance onto the resolving permanent (CR 400.7)", () => {
    it("rides from the stack item onto the battlefield permanent for free", () => {
        const stackItem: StackItem = {
            ...handCard(TIMING_PROBE_ID, "probe"),
            zone: "stack",
            castById: "p1",
            castOffSorceryTiming: true,
        };
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(stackItem);
        resolveTopOfStack(state);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(onBoard).toBeDefined();
        expect(onBoard?.castOffSorceryTiming).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Both transient-clear sites, mirroring `evoke.test.ts`'s countered→recast
// regression (issue #2412 fixup round 2) and `dash.test.ts`'s
// battlefield-side leak regression (round 3) exactly: this flag is a
// one-shot fact about the OBJECT that was cast, and every OTHER member of
// this family (`evoked`/`dashed`/`escaped`) already proved this leak shape
// is real on shipped cards (Ragavan, Nimble Pilferer). The same two clear
// sites must cover the new field or the same bug recurs.
// ---------------------------------------------------------------------------
describe("cast off sorcery timing — clear site: resetStackTransientState (countered → recast does not leak, CR 400.7)", () => {
    it("a countered off-timing cast reaches the graveyard with no memory of the flag, and a later sorcery-timing recast does not inherit it", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // 1. Cast off-timing — stamp directly (the stamping itself is
        //    covered by the producer census above; this test is about the
        //    EXIT).
        const probeStack = pushSpell(state, TIMING_PROBE_ID, "p1");
        probeStack.castOffSorceryTiming = true;

        // 2. Counter it — SpellContext.counter()'s default "graveyard"
        //    destination.
        const counterItem = pushSpell(state, TIMING_PROBE_ID, "p2");
        const ctx = buildSpellContext(state, counterItem);
        ctx.counter({ type: "spell", id: probeStack.id });

        const inGraveyard = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === probeStack.id
        );
        expect(inGraveyard).toBeDefined();
        expect(
            (inGraveyard as { castOffSorceryTiming?: boolean })
                .castOffSorceryTiming
        ).toBe(undefined);
        // The countering spell itself has now resolved and left the stack —
        // pop the stand-in so the stack is genuinely empty again for the
        // SORCERY-timing recast below (this stand-in is a bare `pushSpell`
        // fixture, not a real counterspell whose own resolve() pops itself).
        state.stack = state.stack.filter((s) => s.id !== counterItem.id);

        // 3. Return it to hand directly (the production zone-mover a
        //    Regrowth-shaped resolve() would call).
        moveCard(getPlayer(state, "p1"), probeStack.id, "graveyard", "hand");

        // 4. Hard recast, at SORCERY timing (makeState's default), through
        //    the real production cast-commit path.
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: probeStack.id,
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        const recast = state.stack.find((s) => s.id === probeStack.id);
        expect(recast).toBeDefined();
        expect((recast as StackItem).castOffSorceryTiming).toBe(undefined);
    });
});

describe("cast off sorcery timing — clear site: resetBattlefieldTransientState (bounce → recast does not leak, CR 400.7)", () => {
    it("a permanent bounced directly off the battlefield does not carry the flag into a later sorcery-timing recast", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const stackItem: StackItem = {
            ...handCard(TIMING_PROBE_ID, "probe"),
            zone: "stack",
            castById: "p1",
            castOffSorceryTiming: true,
        };
        state.stack.push(stackItem);
        resolveTopOfStack(state);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(onBoard?.castOffSorceryTiming).toBe(true);

        // Direct battlefield -> hand bounce, never re-entering the stack —
        // the SIBLING gap `resetBattlefieldTransientState` exists to close
        // (issue #2412 fixup round 3's `evoked`/`dashed`/`escaped` trio;
        // same shape).
        removePermanentTo(state, "probe", "hand");
        const inHand = state.players[0].hand.find((c) => c.id === "probe");
        expect(inHand).toBeDefined();
        expect(
            (inHand as { castOffSorceryTiming?: boolean }).castOffSorceryTiming
        ).toBe(undefined);

        // Hard recast, at SORCERY timing.
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "probe",
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        const recast = state.stack.find((s) => s.id === "probe");
        expect(recast).toBeDefined();
        expect((recast as StackItem).castOffSorceryTiming).toBe(undefined);
    });
});

describe("cast off sorcery timing — serialization (CR 307.1 / 117.1a / 601.3a)", () => {
    it("round-trips the flag on a battlefield permanent", () => {
        const probePermanent = makeInstance(TIMING_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            castOffSorceryTiming: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [probePermanent] }),
                makePlayer("p2"),
            ],
        });
        const restored = expandState(compactState(state));
        const back = restored.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(back?.castOffSorceryTiming).toBe(true);
    });
});

describe("cast off sorcery timing — frontend wiring SURFACE (projectPublicState)", () => {
    it("survives the wire projection", () => {
        const probePermanent = makeInstance(TIMING_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            castOffSorceryTiming: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [probePermanent] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(slim?.castOffSorceryTiming).toBe(true);
    });
});
