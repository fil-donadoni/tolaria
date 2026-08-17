// "Cast off sorcery timing" instance-flag tests (CR 307.1 / 117.1a / 601.3a,
// issue #2473, PRD #1975 slice 3 of 3). Engine capability only in this
// slice — no shipped card reads the flag yet (Necromancy, issue #2392, will).
// Mirrors `dash.test.ts` / `evoke.test.ts`'s structure and their "no shipped
// consumer yet" precedent: a SYNTHETIC probe card exercises the capability
// end-to-end.
//
// This is a PRODUCER CENSUS, not a single-seam feature: the flag is derived
// from `wasCastOffSorceryTiming` (`convex/gre/phases.ts`) but must reach EVERY
// site that puts a spell on the stack — a missed site is silently absent,
// passes every other test, and reads as done. The snapshot is taken at
// ANNOUNCEMENT (CR 601.2a) and threaded to the commit on
// `PendingTarget`/`PendingCast`, the `evoked`/`dashed` shape. Covers:
//   - `finalizeTargetSelection`'s targeted immediate-commit branch (normal
//     cast, `convex/game.ts`) — asserted with the commit board set OPPOSITE
//     to the announcement snapshot, so a commit-time re-derivation reddens
//   - `tryAutoCommitPendingCast`, the shared deferred-commit choke point
//     (`convex/game.ts`) — same divergence shape, exercised with an
//     alternative-cost cast (a Dash-shaped mana leg) AND a cast from a
//     non-hand zone (an Ice-Cauldron-style exile permission)
//   - the FERTILE GROUND regression (CR 601.2g / 605.4a): a suspended
//     triggered mana ability left on the stack by paying for the spell must
//     not turn a textbook sorcery-speed cast into a false positive
//   - the bot search-tree `cast-spell` Move executor (`convex/gre/applyMove.ts`)
//     — a WHOLESALE reimplementation that does not call into `game.ts` at all
//     and already silently omitted `evoked`/`dashed`/`escaped` before this
//     change. Its ISMCTS sibling `applyMoveInSearch` (`convex/gre/search.ts`)
//     is covered in `castOffSorceryTiming.bot.test.ts` (bot-suite boundary)
//   - the CR 601.3a / 608.2g cast-during-resolution primitives
//     (`castChosenSpell` / `castFaceDown`, `convex/gre/state.ts`), reached
//     from Word of Command's `resolve()` and the DSL `castDuringResolution`
//     Op — including a pair that pins the `controllerId` (the coerced caster)
//     vs `actingPlayerId` KEYING
//   - CR 707.10: a COPY is put on the stack, not cast, so
//     `cloneSpellOntoStack` clears the flag
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
import {
    tryAutoCommitPendingCast,
    finalizeTargetSelection,
    tapSourceIntoPayment,
} from "../../game";
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

// A {G} creature — the payload of the Fertile Ground counterexample, where the
// point is that a mana ability had to be activated (CR 601.2g) to pay for it.
const TIMING_GREEN_PROBE_ID = "test:timing-green-probe";
const timingGreenProbe: CardDefinition = {
    id: TIMING_GREEN_PROBE_ID,
    rarity: "common",
    name: "Timing Green Probe",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 1,
    toughness: 1,
};
registerTokenDefinition(timingGreenProbe);

// A free creature carrying an "exile a creature you control" ADDITIONAL cost
// (CR 601.2f / 118.8). The vehicle for `finalizeTargetSelection`'s PICK-park
// branch: `exilePicker` alone makes `parkForSacrifice` true, and that branch is
// taken BEFORE the mana-coverage check, so a zero mana cost keeps the scenario
// to the one hop under test.
const TIMING_EXILE_COST_PROBE_ID = "test:timing-exile-cost-probe";
const timingExileCostProbe: CardDefinition = {
    id: TIMING_EXILE_COST_PROBE_ID,
    rarity: "common",
    name: "Timing Exile Cost Probe",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 1,
    toughness: 1,
    additionalCosts: {
        exileFilter: { types: "Creature", controllerRelation: "you" },
    },
};
registerTokenDefinition(timingExileCostProbe);

// An INSTANT — `cloneSpellOntoStack` (CR 707.10) refuses anything that is not
// an Instant or a Sorcery, so the copy-clear test needs one.
const TIMING_INSTANT_PROBE_ID = "test:timing-instant-probe";
const timingInstantProbe: CardDefinition = {
    id: TIMING_INSTANT_PROBE_ID,
    rarity: "common",
    name: "Timing Instant Probe",
    manaCost: { X: 1 },
    types: ["Instant"],
};
registerTokenDefinition(timingInstantProbe);

// Shipped cards — LEA Forest and USG Fertile Ground (`convex/cards/sets/`).
const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
const FERTILE_GROUND_ID = "091dda35-59e5-456d-8804-61513a610aed";

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
        // Both tests are DIVERGENCE tests, not tautologies: the board the
        // commit runs on is deliberately set to the OPPOSITE of the
        // announcement snapshot, so a commit-time re-derivation (the round-1
        // shape) flips both assertions.
        it("propagates the ANNOUNCEMENT snapshot even though the board is NOW at sorcery timing", () => {
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
                    // Announced during combat / with something on the stack;
                    // the board has since drained.
                    castOffSorceryTiming: true,
                },
                "p1"
            );
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(true);
        });

        it("omits the flag when the announcement snapshot is absent, even though the board is NOW off sorcery timing", () => {
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
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(
                undefined
            );
        });
    });

    // `finalizeTargetSelection` has THREE exits, and only the first one above
    // pushes a stack item directly. The other two hand the snapshot to
    // `pendingCast` — one more hop before `tryAutoCommitPendingCast` (producers
    // 2/3) can carry it to the stack — and each is a separate literal, so a
    // dropped `...(castOffSorceryTiming ? … )` in either is invisible to the
    // immediate-commit tests above. Both tests below assert the FIRST hop only
    // (`state.pendingCast.castOffSorceryTiming`), so each reddens for exactly
    // its own branch: the mana-park test is the shape a real targeted spell
    // that has to tap for mana takes, i.e. the Fertile Ground counterexample's
    // own path (that test hand-builds `pendingCast` and never comes through
    // here).
    describe("producer 1, park branch A: finalizeTargetSelection parks on a cost PICK before mana (CR 601.2f / 118.8)", () => {
        /** A targeted zero-cost spell with an "exile a creature you control"
         *  additional cost, plus a creature on the board to pay it with — so
         *  the commit parks on the picker instead of pushing to the stack. */
        function exileCostParkBoard(announcedOffTiming: boolean): GameState {
            const probeInst = handCard(TIMING_EXILE_COST_PROBE_ID, "probe");
            const fodder = makeInstance(TIMING_PROBE_ID, {
                id: "fodder",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [probeInst],
                        battlefield: [fodder],
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                // Sorcery timing (makeState's defaults) unless a test moves it.
            });
            finalizeTargetSelection(
                state,
                {
                    playerId: "p1",
                    cardInstanceId: "probe",
                    targetType: "any",
                    count: 0,
                    selected: [],
                    ...(announcedOffTiming
                        ? { castOffSorceryTiming: true as const }
                        : {}),
                },
                "p1"
            );
            return state;
        }

        it("forwards the ANNOUNCEMENT snapshot onto pendingCast even though the board is NOW at sorcery timing", () => {
            const state = exileCostParkBoard(true);
            // Parked, not committed — the picker is still owed.
            expect(state.stack).toHaveLength(0);
            expect(state.pendingCast).toBeDefined();
            expect(state.pendingCast?.additionalCost).toBeDefined();
            expect(state.pendingCast?.castOffSorceryTiming).toBe(true);
        });

        it("omits it when the announcement snapshot is absent, even though the board is NOW off sorcery timing", () => {
            const probeInst = handCard(TIMING_EXILE_COST_PROBE_ID, "probe");
            const fodder = makeInstance(TIMING_PROBE_ID, {
                id: "fodder",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [probeInst],
                        battlefield: [fodder],
                    }),
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
            expect(state.pendingCast).toBeDefined();
            expect(state.pendingCast?.castOffSorceryTiming).toBe(undefined);
        });
    });

    describe("producer 1, park branch B: finalizeTargetSelection parks for MANA payment (CR 601.2g)", () => {
        /** A targeted {G} spell with an EMPTY mana pool: the commit cannot cover
         *  the cost, so it parks for `tapForPayment`. This is the only path a
         *  real targeted spell that has to tap for mana takes. */
        function manaParkBoard(
            announcedOffTiming: boolean,
            phase: "PRECOMBAT_MAIN" | "DECLARE_ATTACKERS"
        ): GameState {
            const probeInst = handCard(TIMING_GREEN_PROBE_ID, "greenprobe");
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [probeInst] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                phase,
            });
            finalizeTargetSelection(
                state,
                {
                    playerId: "p1",
                    cardInstanceId: "greenprobe",
                    targetType: "any",
                    count: 0,
                    selected: [],
                    ...(announcedOffTiming
                        ? { castOffSorceryTiming: true as const }
                        : {}),
                },
                "p1"
            );
            return state;
        }

        it("forwards the ANNOUNCEMENT snapshot onto pendingCast even though the board is NOW at sorcery timing", () => {
            const state = manaParkBoard(true, "PRECOMBAT_MAIN");
            // Parked for payment, not committed.
            expect(state.stack).toHaveLength(0);
            expect(state.pendingCast).toBeDefined();
            expect(state.pendingCast?.manaCost).toEqual({ G: 1 });
            expect(state.pendingCast?.castOffSorceryTiming).toBe(true);
        });

        it("omits it when the announcement snapshot is absent, even though the board is NOW off sorcery timing", () => {
            const state = manaParkBoard(false, "DECLARE_ATTACKERS");
            expect(state.pendingCast).toBeDefined();
            expect(state.pendingCast?.castOffSorceryTiming).toBe(undefined);
        });
    });

    describe("producer 2: tryAutoCommitPendingCast (shared deferred-commit choke point) — a cast with an alternative cost", () => {
        function altCostParkedCast(announcedOffTiming: boolean): GameState {
            const probeInst = handCard(TIMING_ALT_COST_PROBE_ID, "probe");
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [probeInst] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            state.players[0].manaPool.R = 1;
            state.pendingCast = {
                playerId: "p1",
                cardInstanceId: "probe",
                manaCost: { R: 1 },
                tappedLandIds: [],
                dashed: true,
                ...(announcedOffTiming
                    ? { castOffSorceryTiming: true as const }
                    : {}),
            };
            return state;
        }

        it("propagates the ANNOUNCEMENT snapshot even though the commit board is at sorcery timing", () => {
            // PRECOMBAT_MAIN, empty stack, active === priority: a commit-time
            // re-derivation would read `undefined` here.
            const state = altCostParkedCast(true);
            const committed = tryAutoCommitPendingCast(state, "p1");
            expect(committed).not.toBeNull();
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(true);
        });

        it("omits the flag when the announcement snapshot is absent, even though the commit board is off sorcery timing", () => {
            const state = altCostParkedCast(false);
            state.phase = "DECLARE_ATTACKERS";
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
        function exileParkedCast(announcedOffTiming: boolean): GameState {
            const probeInst = exileCard(TIMING_PROBE_ID, "probe");
            const state = makeState({
                players: [
                    makePlayer("p1", { exile: [probeInst] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            state.pendingCast = {
                playerId: "p1",
                cardInstanceId: "probe",
                manaCost: {},
                tappedLandIds: [],
                ...(announcedOffTiming
                    ? { castOffSorceryTiming: true as const }
                    : {}),
            };
            return state;
        }

        it("propagates the ANNOUNCEMENT snapshot even though the commit board is at sorcery timing", () => {
            const state = exileParkedCast(true);
            const committed = tryAutoCommitPendingCast(state, "p1");
            expect(committed).not.toBeNull();
            const stackItem = state.stack.find((s) => s.id === "probe");
            expect(stackItem).toBeDefined();
            expect((stackItem as StackItem).castOffSorceryTiming).toBe(true);
        });

        it("omits the flag when the announcement snapshot is absent, even though the commit board is off sorcery timing", () => {
            const state = exileParkedCast(false);
            state.phase = "DECLARE_ATTACKERS";
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

// ---------------------------------------------------------------------------
// The counterexample that forced the announcement-time snapshot (round-1
// review BLOCKER 2). Reproduced with a SHIPPED card, through the exact call
// sequence the `tapForPayment` mutation body runs.
// ---------------------------------------------------------------------------
describe("cast off sorcery timing — a suspended triggered mana ability must not fake off-timing (CR 601.2g / 605.4a)", () => {
    /** Forest enchanted by Fertile Ground, a {G} spell parked for payment, at
     *  textbook SORCERY timing: p1's own precombat main phase, empty stack,
     *  active === priority. */
    function fertileGroundPaymentBoard(): GameState {
        const forest = makeInstance(FOREST_ID, {
            id: "forest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(FERTILE_GROUND_ID, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "forest",
        });
        const spell = handCard(TIMING_GREEN_PROBE_ID, "greenprobe");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [spell],
                    battlefield: [forest, aura],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "greenprobe",
            manaCost: { G: 1 },
            tappedLandIds: [],
            // Announced at sorcery timing → no snapshot.
        };
        return state;
    }

    it("Fertile Ground's parked colour pick sits on the stack at commit, and the spell is still recorded as cast at SORCERY timing", () => {
        const state = fertileGroundPaymentBoard();
        const player = getPlayer(state, "p1");
        const forest = player.battlefield.find((c) => c.id === "forest")!;

        // The two calls `tapForPayment`'s handler makes per payment entry.
        tapSourceIntoPayment(
            state,
            player,
            forest,
            undefined,
            state.pendingCast!.tappedLandIds
        );
        // CR 605.4a — the triggered mana ability resolved immediately, but its
        // colour pick suspended, so its item is STILL on the stack here.
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fertile-ground-extra-mana"
            )
        ).toBe(true);

        tryAutoCommitPendingCast(state, "p1");

        const stackItem = state.stack.find((s) => s.id === "greenprobe");
        expect(stackItem).toBeDefined();
        // The cast was proposed in p1's own main phase with an empty stack: a
        // sorcery COULD have been cast. Re-deriving at commit reads the
        // suspended mana trigger and answers `true` — the shipped-card false
        // positive this regression pins.
        expect((stackItem as StackItem).castOffSorceryTiming).toBe(undefined);
    });

    it("the same board with an off-timing announcement still commits the flag", () => {
        const state = fertileGroundPaymentBoard();
        state.pendingCast!.castOffSorceryTiming = true;
        const player = getPlayer(state, "p1");
        const forest = player.battlefield.find((c) => c.id === "forest")!;
        tapSourceIntoPayment(
            state,
            player,
            forest,
            undefined,
            state.pendingCast!.tappedLandIds
        );
        tryAutoCommitPendingCast(state, "p1");
        const stackItem = state.stack.find((s) => s.id === "greenprobe");
        expect(stackItem).toBeDefined();
        expect((stackItem as StackItem).castOffSorceryTiming).toBe(true);
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

    // The `controllerId`-vs-`actingPlayerId` KEYING (round-1 review finding
    // 5). Mid-resolution the two are indistinguishable — the stack is
    // non-empty, so the predicate answers `true` for EVERY player and the two
    // tests above cannot tell the keying apart. Forcing the stack empty makes
    // the two answers differ: at p1's own main phase with an empty stack,
    // `wasCastOffSorceryTiming` is `false` for p1 (active + priority) and
    // `true` for p2. The pair below therefore flips in BOTH directions if the
    // stamp is keyed on the Acting Player instead of the spell's caster.
    describe("castChosenSpell keys the snapshot on the spell's CASTER, not the Acting Player (ADR 0037 / CR 608.2f)", () => {
        function coercedCast(
            casterId: string,
            actingPlayerId: string
        ): StackItem | undefined {
            const victim = handCard(TIMING_PROBE_ID, "coerced", casterId);
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: casterId === "p1" ? [victim] : [],
                    }),
                    makePlayer("p2", {
                        hand: casterId === "p2" ? [victim] : [],
                    }),
                ],
                // p1's own precombat main phase: sorcery timing FOR P1 ONLY.
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            const resolvingItem = pushSpell(state, TIMING_PROBE_ID, "p1");
            const ctx = buildSpellContext(state, resolvingItem);
            // Force the stack empty so the predicate's answer depends on WHICH
            // player it is asked about (see the block comment above). The
            // `castChosenSpell` insert handles an absent resolving item
            // (`idx === -1` → plain push).
            state.stack = [];
            ctx.castChosenSpell(casterId, "coerced", actingPlayerId, {
                free: true,
            });
            return state.stack.find((s) => s.id === "coerced");
        }

        it("stamps when the COERCED CASTER (p2) could not have cast a sorcery, though the Acting Player (p1) could", () => {
            const item = coercedCast("p2", "p1");
            expect(item).toBeDefined();
            expect((item as StackItem).castOffSorceryTiming).toBe(true);
        });

        it("omits when the COERCED CASTER (p1) could have cast a sorcery, though the Acting Player (p2) could not", () => {
            const item = coercedCast("p1", "p2");
            expect(item).toBeDefined();
            expect((item as StackItem).castOffSorceryTiming).toBe(undefined);
        });
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

describe("cast off sorcery timing — a COPY is not cast, so it clears the flag (CR 707.10)", () => {
    // CR 707.10: "To copy a spell ... means to put a copy of it onto the
    // stack; a copy of a spell isn't cast." The flag is cast provenance by
    // definition, so `cloneSpellOntoStack` must delete it exactly as it
    // already deletes `escaped` / `castFromGraveyard` (round-1 review finding
    // 3).
    it("a Fork/storm copy of an off-timing instant does not inherit the flag", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // The copier (Fork-shaped) is the current top of the stack.
        const original = pushSpell(state, TIMING_INSTANT_PROBE_ID, "p1");
        original.castOffSorceryTiming = true;
        original.escaped = true;
        const creator = pushSpell(state, TIMING_INSTANT_PROBE_ID, "p1");
        const ctx = buildSpellContext(state, creator);
        const copy = ctx.copyStackItem(original.id);
        expect(copy).not.toBeNull();
        const copyItem = state.stack.find(
            (s) => s.id !== original.id && s.id !== creator.id
        );
        expect(copyItem).toBeDefined();
        expect((copyItem as StackItem).isCopy).toBe(true);
        // Sanity: the sibling cast-provenance flag is cleared here too, so a
        // green assertion below is about THIS field, not about the copy
        // failing to be created.
        expect((copyItem as StackItem).escaped).toBe(undefined);
        expect((copyItem as StackItem).castOffSorceryTiming).toBe(undefined);
        // The ORIGINAL keeps its own snapshot — it really was cast.
        expect(
            state.stack.find((s) => s.id === original.id)?.castOffSorceryTiming
        ).toBe(true);
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

    it("round-trips the ANNOUNCEMENT snapshot parked on pendingCast, and the restored cast still commits it", () => {
        // A cast parked for mana payment IS a stable save point (CLAUDE.md
        // § Data model), so the announcement snapshot crosses a DB round-trip
        // between announcement and commit in every real deferred cast.
        const probeInst = handCard(TIMING_PROBE_ID, "probe");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "probe",
            manaCost: {},
            tappedLandIds: [],
            castOffSorceryTiming: true,
        };
        const restored = expandState(compactState(state));
        expect(restored.pendingCast?.castOffSorceryTiming).toBe(true);
        tryAutoCommitPendingCast(restored, "p1");
        const stackItem = restored.stack.find((s) => s.id === "probe");
        expect(stackItem).toBeDefined();
        expect((stackItem as StackItem).castOffSorceryTiming).toBe(true);
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
