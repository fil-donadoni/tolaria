// Blocker marking must re-materialize `isBlocking`-conditioned statics
// BEFORE anything downstream reads `staticAbilities` (issue #1826 review).
//
// THE BUG THIS SUITE GUARDS. A `keyword-grant` static effect carrying a
// `condition` is MATERIALIZED into the affected permanent's `staticAbilities`
// array (`refreshCounterGatedStatics`, `gre/state.ts`) — it is NOT recomputed
// at read time the way a `pt-buff` is. So for a condition that reads
// `CardInstanceState.isBlocking` (Snow Devil's "enchanted creature has first
// strike as long as it's blocking and you control a snow land", CR 611.2c)
// the array is STALE for the whole window between the flag write and the next
// refresh.
//
// That window is not theoretical. `confirmBlockers` (`game.ts`) marks the
// blockers and then calls `drainAutoPasses` — and when both seats hold a
// standing Pass Turn intent (the exact flow `drainAutoPasses` documents as
// PRESERVED across the forced declare-blockers window, `gre/phases.ts`), the
// drain runs straight into `advancePhase`'s CR 510.5 decision
// ("skip the first-strike damage step when no combatant has first strike or
// double strike", `anyCombatantHasFirstOrDoubleStrike`) with no SBA pass
// anywhere in between. The granted first strike was invisible at exactly the
// moment it mattered: FIRST_STRIKE_DAMAGE was skipped and the two creatures
// traded simultaneously. `saveGameState`'s own refresh (issue #1379) does not
// help — it runs AFTER the drain has already decided.
//
// THE FIX. One chokepoint, `markDeclaredBlockers` (`gre/combat.ts`), the
// blocker-side counterpart of `markAttacking`: it sets `isBlocking` +
// `hasBlockedThisTurn` for every creature in `combat.blockerAssignments` AND
// refreshes the conditioned statics, so no site can do one without the other.
// All seven declaration sites route through it (see its doc comment).
//
// This file covers the two SERVER paths — the real `confirmBlockers` mutation
// and the camouflage auto-confirm in `advancePhase`. The two BOT sim paths
// (`search.ts`, `applyMove.ts`) are covered by the sibling
// `blockerMarkingRefresh.bot.test.ts`.
import { describe, it, expect } from "vitest";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { confirmBlockers } from "../../game";
import { advancePhase } from "../phases";
import { applySourceStaticEffects } from "../state";
import type { CardInstanceState, GameState } from "../state";
import { expandState } from "../serialize";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { vanilla, snowLand } from "../../cards/sets/ice/__tests__/helpers";
import { snowDevil, snowCoveredIsland } from "../../cards/sets/ice";
import { island } from "../../cards/sets/lea";

// ── Fixture ────────────────────────────────────────────────────────────────
//
// p1 (active) attacks with a 2/2 vanilla. p2 blocks with a 2/2 vanilla wearing
// Snow Devil, with a Snow-Covered Island in play — so the blocker has first
// strike ONLY once it is marked as blocking.
//
// The whole test turns on that 2/2-vs-2/2 symmetry:
//   - first strike SEEN  → the blocker kills the attacker in FIRST_STRIKE_DAMAGE
//                          and survives untouched;
//   - first strike STALE → CR 510.5 skips the step and both creatures trade.
// The two outcomes differ in the battlefield contents, so a single assertion
// distinguishes them.
function makeCombatState(): {
    state: GameState;
    attacker: CardInstanceState;
    blocker: CardInstanceState;
} {
    const attacker = vanilla("bear", 2, 2, {
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
    const blocker = vanilla("wall", 2, 2, {
        controllerId: "p2",
        ownerId: "p2",
    });
    const aura = makeInstance(snowDevil.id, {
        id: "devil",
        controllerId: "p2",
        ownerId: "p2",
        attachedTo: "wall",
    });
    const state = makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p2",
        combat: {
            attackerIds: ["bear"],
            confirmed: true,
            blockerAssignments: { wall: ["bear"] },
            blockersConfirmed: false,
            damageConfirmed: false,
        },
        players: [
            makePlayer("p1", {
                battlefield: [attacker],
                // Non-empty libraries: the auto-pass drain runs the rest of the
                // turn, and a draw from an empty library would end the game on
                // SBAs (CR 704.5b) before the assertions read the board.
                library: [
                    makeInstance(island.id, {
                        id: "p1-lib-1",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                    makeInstance(island.id, {
                        id: "p1-lib-2",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    blocker,
                    aura,
                    snowLand(snowCoveredIsland.id, "snow-isle", "p2"),
                ],
                library: [
                    makeInstance(island.id, {
                        id: "p2-lib-1",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    }),
                    makeInstance(island.id, {
                        id: "p2-lib-2",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    }),
                ],
            }),
        ],
    });
    // Aura attach materialization (the real permanent-entry path): flying only,
    // since nothing is blocking yet.
    applySourceStaticEffects(state, aura);
    expect(blocker.staticAbilities).toContain("flying");
    expect(blocker.staticAbilities).not.toContain("first strike");
    return { state, attacker, blocker };
}

// ── The real `confirmBlockers` mutation (finding 1) ─────────────────────────
//
// Drives the REGISTERED mutation's own `_handler` against an in-memory stub
// `MutationCtx`, same harness discipline as
// `gre/__tests__/keywordGrantHandSizeCondition.test.ts` /
// `convex/__tests__/gameTicks.test.ts` (this repo has no convex-test harness).
// NOTHING here calls `checkStateBasedActions` or `refreshCounterGatedStatics`:
// the only thing that can make the grant visible to the CR 510.5 decision is
// the mutation's own marking order.
type Row = Record<string, unknown>;

type MutationHandler<A, R> = {
    _handler: (ctx: MutationCtx, args: A) => Promise<R>;
};

const runConfirmBlockers = (ctx: MutationCtx, args: Row) =>
    (confirmBlockers as unknown as MutationHandler<Row, null>)._handler(
        ctx,
        args
    );

function makeCtx(userId: string, seeds: Row[]) {
    const docs = new Map<string, Row>();
    for (const seed of seeds) docs.set(seed._id as string, { ...seed });
    let nextIdBySeq = 0;

    const ctx = {
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Row) => {
                const id = `${table}-new-${nextIdBySeq++}`;
                docs.set(id, { ...doc, _id: id, __table: table });
                return id;
            },
            patch: async (id: string, patch: Row) => {
                docs.set(id, { ...docs.get(id), ...patch });
            },
            query: (table: string) => ({
                withIndex: (_name: string, fn?: (q: unknown) => unknown) => {
                    const eqs: [string, unknown][] = [];
                    const builder = {
                        eq: (field: string, value: unknown) => {
                            eqs.push([field, value]);
                            return builder;
                        },
                    };
                    fn?.(builder);
                    const rows = [...docs.values()].filter(
                        (d) =>
                            d.__table === table &&
                            eqs.every(([f, v]) => d[f] === v)
                    );
                    const ordered = { first: async () => rows[0] ?? null };
                    return {
                        collect: async () => rows,
                        first: async () => rows[0] ?? null,
                        order: () => ordered,
                    };
                },
            }),
        },
        scheduler: { runAfter: async () => undefined },
    };

    return {
        ctx: ctx as unknown as MutationCtx,
        doc: (id: string) => docs.get(id)!,
    };
}

describe("confirmBlockers refreshes isBlocking-conditioned statics before draining auto-passes (CR 509.1a / 510.5, issue #1826)", () => {
    it("both seats auto-passing: the granted first strike survives the drain, so FIRST_STRIKE_DAMAGE is not skipped and the blocker lives", async () => {
        const { state } = makeCombatState();
        // The standing Pass Turn intent on BOTH seats — preserved across the
        // forced declare-blockers window by design (`drainAutoPasses`,
        // `gre/phases.ts`), and never cleared by the blocking path
        // (`autoPassPlayers` is written only by `endTurn` / `cancelAutoPass`).
        state.autoPassPlayers = ["p1", "p2"];

        const stub = makeCtx("p2", [
            {
                _id: "game-1",
                __table: "games",
                name: "Game",
                status: "playing",
                players: [{ id: "p1" }, { id: "p2" }],
                createdAt: 0,
                updatedAt: 0,
            },
            {
                _id: "gs-1",
                __table: "gameStates",
                gameId: "game-1",
                seq: 1,
                state,
                updatedAt: 0,
            },
        ]);

        await runConfirmBlockers(stub.ctx, {
            gameId: "game-1" as unknown as Id<"games">,
            playerId: "p2",
        });

        const persisted = expandState(
            stub.doc("gs-1").state as Record<string, unknown>
        );
        const p1 = persisted.players.find((p) => p.id === "p1")!;
        const p2 = persisted.players.find((p) => p.id === "p2")!;

        // THE REGRESSION. Under the pre-fix order (mark → `drainAutoPasses` →
        // only then a refresh) `anyCombatantHasFirstOrDoubleStrike` saw a
        // blocker with no first strike, CR 510.5 skipped the step, and the two
        // 2/2s traded: p2's battlefield collapsed to just the snow land (the
        // Aura falls off with its host, CR 704.5m).
        expect(p2.battlefield.map((c) => c.id).sort()).toEqual([
            "devil",
            "snow-isle",
            "wall",
        ]);
        expect(p1.battlefield.map((c) => c.id)).toEqual([]);
        expect(p1.graveyard.map((c) => c.id)).toContain("bear");
    });
});

// ── The camouflage auto-confirm in `advancePhase` (finding 3) ───────────────
describe("camouflage auto-confirm refreshes isBlocking-conditioned statics (CR 509.1a / 510.5, issue #1826)", () => {
    it("advancePhase's forced pile blocks materialize the grant immediately, so its own CR 510.5 check does not skip FIRST_STRIKE_DAMAGE", () => {
        const { state, blocker } = makeCombatState();
        // Camouflage (ADR 0012) replaced the declare-blockers step: the piles
        // were locked into `blockerAssignments` at the spell's resolution and
        // the DECLARE_BLOCKERS phase entry confirms them with no priority
        // window — so no SBA pass runs between the marking and the CR 510.5
        // decision either.
        state.phase = "DECLARE_ATTACKERS";
        state.camouflageCombat = true;
        state.priorityPlayerId = "p1";

        // ONE call: `advancePhase` enters DECLARE_BLOCKERS, auto-confirms the
        // piles, and — with no blocking priority window to stop at — takes its
        // own CR 510.5 decision and recurses onward, all before any SBA pass.
        advancePhase(state);
        expect(state.combat?.blockersConfirmed).toBe(true);
        expect(blocker.isBlocking).toBe(true);
        // Materialized by the auto-confirm itself — nothing in this test has
        // run an SBA pass.
        expect(blocker.staticAbilities).toContain("first strike");
        // Pre-fix this landed on COMBAT_DAMAGE: the skip check read a stale
        // `staticAbilities` and CR 510.5 removed the first-strike step.
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
    });
});
