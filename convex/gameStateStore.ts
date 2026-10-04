import type { GenericId } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { recomputeContinuousEffects, type GameState } from "./gre/state";
import {
    computeOwedPlayerIds,
    refreshExpectedInput,
} from "./gre/expectedInput";
import { compactState, expandState } from "./gre/serialize";

// The `gameStates` / `gameTicks` read and write seam. Lifted out of `game.ts`
// (issue #4855) so a second function module that persists a position —
// `debugBlade.ts` — shares the one writer instead of importing the mutation
// file that registers every gameplay endpoint.

export async function getLatestGameState(
    ctx: Pick<GenericQueryCtx<DataModel>, "db">,
    gameId: GenericId<"games">
): Promise<Doc<"gameStates"> | null> {
    const doc = await ctx.db
        .query("gameStates")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .order("desc")
        .first();
    if (!doc) return null;
    return {
        ...doc,
        state: expandState(doc.state as Record<string, unknown>),
    };
}

/** Save a game state. We keep exactly one row per game and patch it in
 *  place — there's no server-side undo history. Convex read bandwidth was
 *  dominated by snapshot reads, so collapsing to a single row plus a patch
 *  cuts per-mutation cost to 1 read (the handler's `getLatestGameState`) +
 *  1 write. Callers pass that already-fetched doc as `existing` so we don't
 *  re-query. Pass `null` for first-time inserts (game creation paths). */
export async function saveGameState(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState | Record<string, unknown>,
    existing: Doc<"gameStates"> | null
) {
    // Issue #1379 review finding — `checkStateBasedActions` is NOT on every
    // path that reaches here: `announceCast`/`tryAutoCommitPendingCast` move a
    // card hand→stack, `summonCompanion` pushes one into hand, and
    // `declareMulligan` redraws a hand, all with ZERO SBA pass before
    // `saveGameState`. A `keyword-grant.condition` gated on non-battlefield
    // state (hand size, CR 611.2c "as long as ...", issue #1095's mechanism)
    // is materialized into `staticAbilities` only when re-swept — so a
    // persisted, priority-awaiting state could carry a STALE keyword for the
    // entire window a spell sits on the stack, which is exactly the window
    // the opponent responds in. `saveGameState` is the SOLE writer of the
    // `gameStates` row (every other write in this file is `gameTicks`/other
    // tables), so it is the one choke point every stable position must pass
    // through regardless of which caller reached it. Re-running the sweep
    // here — NOT `checkStateBasedActions` itself, just the static-effect
    // re-materialization it already runs unconditionally on every pass —
    // makes "a persisted state always has freshly-materialized conditional
    // statics" an invariant of persistence itself, not of any particular
    // caller remembering to call SBAs first. `recomputeContinuousEffects`
    // performs no state-based actions, moves no cards, and is idempotent
    // (documented at its definition, `gre/state.ts`) — a no-op sweep of the
    // battlefield for every board where no source declares
    // `dependsOnCounters` or a conditioned `keyword-grant`, so this adds no
    // duplicate/skipped SBA behavior and is cheap on the common case.
    recomputeContinuousEffects(state as GameState);
    // ADR 0047 — maintain the authoritative Expected Input at the persistence
    // seam. Every stable point flows through `saveGameState`, so recomputing
    // here keeps the persisted + projected field coherent with the settled
    // pending* / priority fields without touching every engine call site.
    refreshExpectedInput(state as GameState);
    const stored = compactState(state as GameState);
    // const _blobSize = JSON.stringify(stored).length;
    // console.log(
    //     `[BANDWIDTH] blob=${_blobSize} bytes, seq=${seq}, gameId=${gameId}`
    // );
    if (existing) {
        await ctx.db.patch(existing._id, {
            seq,
            state: stored,
            updatedAt: Date.now(),
        });
    } else {
        // Mirror the owning Game's mode flags onto the row (see `gameStates`
        // in `convex/schema.ts`). This is the ONE place the fat `games` row is
        // read for them — once per game, at insert — so that `getPublicState`
        // never has to. Both are written explicitly, `false` included, so the
        // reader can tell "not solo" from "row predates the field".
        // The one later writer is `debugLoadBladeScenario`'s solo → vs-AI
        // conversion (issue #3443), which re-stamps them on an EXISTING row
        // precisely because this branch never runs again.
        const game = await ctx.db.get(gameId);
        await ctx.db.insert("gameStates", {
            gameId,
            seq,
            state: stored,
            solo: game?.solo === true,
            vsAi: game?.vsAi === true,
            updatedAt: Date.now(),
        });
    }

    // Companion tick row (PRD #1776 T3, issue #1778): every stable point
    // flows through this function, so this is the single seam to keep the
    // cheap wake-up signal coherent with what was just persisted. `state` is
    // already past `refreshExpectedInput` above, so `expectedInput` is the
    // settled, authoritative value for this save.
    await saveGameTick(ctx, gameId, seq, state as GameState);
}

/** Cheap wake-up-signal companion to `gameStates` (~150 bytes vs. 3-9 KB),
 *  written alongside every `gameStates` save from `saveGameState`. One row
 *  per game, patched in place. Exists so a subscriber that only needs to
 *  know "did anything change, and does it need to act" — the vs-AI driver —
 *  can hold this instead of a second full `getPublicState` subscription that
 *  gets discarded on every beat it doesn't own (`getGameTick` below). */
async function saveGameTick(
    ctx: Pick<GenericMutationCtx<DataModel>, "db">,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState
) {
    const existing = await ctx.db
        .query("gameTicks")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .first();
    const fields = {
        seq,
        priorityPlayerId: state.priorityPlayerId,
        phase: state.phase,
        expectedInputKind: state.expectedInput?.kind,
        // issue #1778 review finding 1: NOT `state.expectedInput?.playerId` —
        // that single id missed the non-active combat-damage assigner
        // (banding, CR 702.22j-k) and could deadlock a subscriber gating on
        // it. `computeOwedPlayerIds` folds in the `damageAssignerIds`
        // sub-flow so every player who genuinely owes input this tick is
        // named, even when it's not `priorityPlayerId`.
        owedPlayerIds: computeOwedPlayerIds(state),
        gameOver: state.gameOver !== undefined,
        updatedAt: Date.now(),
    };
    if (existing) {
        await ctx.db.patch(existing._id, fields);
        return;
    }
    await ctx.db.insert("gameTicks", { gameId, ...fields });
}
