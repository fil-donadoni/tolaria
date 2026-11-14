import type { GenericId } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { recomputeContinuousEffects, type GameState } from "./gre/state";
import {
    computeOwedActingPlayerIds,
    refreshExpectedInput,
} from "./gre/expectedInput";
import {
    expandState,
    hasOpaqueLibraries,
    isSplitCompactState,
    OPAQUE_LIBRARIES,
    splitCompactState,
    type CompactLibraries,
} from "./gre/serialize";
import { actingPlayerFor, activeTurnControls } from "./gre/turnControl";
import { projectPublicState } from "./gameProjections";
import { internal } from "./_generated/api";
import { planBotDeadline, type BotDeadlineTick } from "./botDeadline";
import { botSeatId } from "./matches";
import { seedBotSkipPrefs } from "./gamePrefs";
import {
    advanceClock,
    clockExpiresAt,
    expiredPlayerId,
    initialTickClock,
    type TickClock,
} from "./matchClock";

/** A context that can persist a position: the database, plus the scheduler
 *  a clocked Match's expiry job is armed through (issue #2308). */
type SaveCtx = Pick<GenericMutationCtx<DataModel>, "db" | "scheduler">;

// The `gameStates` / `gameTicks` read and write seam. Lifted out of `game.ts`
// (issue #4855) so a second function module that persists a position —
// `debugBlade.ts` — shares the one writer instead of importing the mutation
// file that registers every gameplay endpoint.

/** A `gameStates` row as the loader hands it out: `state` expanded, plus the
 *  library companion it was expanded with (ADR 0179) so `saveGameState` can
 *  tell an untouched library from a changed one without reading it again.
 *  `null` = the game has no companion yet (a single-row document). */
export type LoadedGameState = Doc<"gameStates"> & {
    libraryRow?: Doc<"gameLibraries"> | null;
};

type ReadCtx = Pick<GenericQueryCtx<DataModel>, "db">;

async function readGameStateRow(
    ctx: ReadCtx,
    gameId: GenericId<"games">
): Promise<Doc<"gameStates"> | null> {
    return ctx.db
        .query("gameStates")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .order("desc")
        .first();
}

async function readLibraryRow(
    ctx: ReadCtx,
    gameId: GenericId<"games">
): Promise<Doc<"gameLibraries"> | null> {
    return ctx.db
        .query("gameLibraries")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .first();
}

/** The whole position: the hot row plus its library companion. Every
 *  mutation, and every reader that needs library contents, loads through
 *  here. */
export async function getLatestGameState(
    ctx: ReadCtx,
    gameId: GenericId<"games">
): Promise<LoadedGameState | null> {
    const doc = await readGameStateRow(ctx, gameId);
    if (!doc) return null;
    const stored = doc.state as Record<string, unknown>;
    if (!isSplitCompactState(stored)) {
        return { ...doc, state: expandState(stored), libraryRow: null };
    }
    const libraryRow = await readLibraryRow(ctx, gameId);
    if (!libraryRow) {
        throw new Error(`Game ${gameId} has no library companion row`);
    }
    return {
        ...doc,
        state: expandState(stored, libraryRow.payload as CompactLibraries),
        libraryRow,
    };
}

/** The position as the PUBLIC projection needs it (ADR 0179). When the writer
 *  proved that no seat's projection reads library contents
 *  (`publicViewNeedsLibrary === false`), only the hot row is read and the
 *  libraries come back as identity-less placeholders — `opaqueLibraries` says
 *  so, and such a state may be projected for a SEAT only, exactly what the
 *  proof covered. Every other case is the full `getLatestGameState` read. */
export async function getGameStateForPublicView(
    ctx: ReadCtx,
    gameId: GenericId<"games">
): Promise<(LoadedGameState & { opaqueLibraries: boolean }) | null> {
    const doc = await readGameStateRow(ctx, gameId);
    if (!doc) return null;
    const stored = doc.state as Record<string, unknown>;
    if (isSplitCompactState(stored) && doc.publicViewNeedsLibrary === false) {
        return {
            ...doc,
            state: expandState(stored, OPAQUE_LIBRARIES),
            opaqueLibraries: true,
        };
    }
    const full = await getLatestGameState(ctx, gameId);
    return full ? { ...full, opaqueLibraries: false } : null;
}

/** Whether any seat's public projection differs once the libraries are
 *  replaced by placeholders — decided by projecting both, never by a census
 *  of the projection's library readers (search and peek piles, the revealed
 *  or known top card, a play-from-top affordance, a characteristic a library
 *  card contributes). Both sides are the STORED document expanded, so the
 *  comparison is exactly what a reader will compute. A projection that
 *  throws on placeholders needs the libraries by definition. */
export function publicViewNeedsLibrary(
    hot: Record<string, unknown>,
    libraries: CompactLibraries,
    seq: number
): boolean {
    try {
        const full = expandState(hot, libraries);
        const opaque = expandState(hot, OPAQUE_LIBRARIES);
        return full.players.some(
            (p) =>
                JSON.stringify(projectPublicState(full, seq, p.id, false)) !==
                JSON.stringify(projectPublicState(opaque, seq, p.id, false))
        );
    } catch {
        return true;
    }
}

/** Save a game state. We keep exactly one hot row per game and patch it in
 *  place — there's no server-side undo history — plus one library companion
 *  row, written only on a save that changed a library (ADR 0179). Callers
 *  pass the doc `getLatestGameState` handed them as `existing` so neither row
 *  is re-queried. Pass `null` for first-time inserts (game creation paths). */
export async function saveGameState(
    ctx: SaveCtx,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState | Record<string, unknown>,
    existing: LoadedGameState | null
) {
    if (hasOpaqueLibraries(state as GameState)) {
        throw new Error(
            "saveGameState: refusing a state with opaque libraries"
        );
    }
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
    // A `retained` reveal has now reached a stable snapshot: drop the flag so
    // the next resolution's `pendingReveals` clear removes it.
    const pending = (state as GameState).pendingReveals;
    if (pending?.some((r) => r.retained)) {
        (state as GameState).pendingReveals = pending.map((r) => {
            const persisted = { ...r };
            delete persisted.retained;
            return persisted;
        });
    }
    // ADR 0047 — maintain the authoritative Expected Input at the persistence
    // seam. Every stable point flows through `saveGameState`, so recomputing
    // here keeps the persisted + projected field coherent with the settled
    // pending* / priority fields without touching every engine call site.
    refreshExpectedInput(state as GameState);
    const { hot: stored, libraries } = splitCompactState(state as GameState);
    await saveLibraryRow(ctx, gameId, libraries, existing);
    const needsLibrary = publicViewNeedsLibrary(stored, libraries, seq);
    // The owning `games` row, read only on the insert branch below (once per
    // Game) — the tick writer seeds a clocked Match's Game clock from it.
    let insertedGame: Doc<"games"> | null = null;
    // const _blobSize = JSON.stringify(stored).length;
    // console.log(
    //     `[BANDWIDTH] blob=${_blobSize} bytes, seq=${seq}, gameId=${gameId}`
    // );
    if (existing) {
        await ctx.db.patch(existing._id, {
            seq,
            state: stored,
            publicViewNeedsLibrary: needsLibrary,
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
        insertedGame = game;
        // A vs-AI Game's Bot seat gets its Phase Stop row here, the one
        // place every new Game passes through (ADR 0077 §4).
        const botId = game
            ? botSeatId({ vsAi: game.vsAi, players: game.players })
            : null;
        if (botId !== null) await seedBotSkipPrefs(ctx, gameId, botId);
        await ctx.db.insert("gameStates", {
            gameId,
            seq,
            state: stored,
            publicViewNeedsLibrary: needsLibrary,
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
    const vsAi = existing
        ? existing.vsAi === true
        : insertedGame?.vsAi === true;
    await saveGameTick(
        ctx,
        gameId,
        seq,
        state as GameState,
        insertedGame,
        vsAi
    );
}

/** Write the library companion row iff this save changed a library. The
 *  payload is a pure function of the libraries (`splitCompactState`), so an
 *  equal serialisation is an untouched library and costs no write. An
 *  `existing` that did not come from the loader carries no `libraryRow`, and
 *  the companion is then read here. */
async function saveLibraryRow(
    ctx: SaveCtx,
    gameId: GenericId<"games">,
    libraries: CompactLibraries,
    existing: LoadedGameState | null
) {
    const row =
        existing === null
            ? null
            : existing.libraryRow !== undefined
              ? existing.libraryRow
              : await readLibraryRow(ctx, gameId);
    if (!row) {
        await ctx.db.insert("gameLibraries", { gameId, payload: libraries });
        return;
    }
    if (JSON.stringify(row.payload) === JSON.stringify(libraries)) return;
    await ctx.db.patch(row._id, { payload: libraries });
}

/** Cheap wake-up-signal companion to `gameStates` (~150 bytes vs. 3-9 KB),
 *  written alongside every `gameStates` save from `saveGameState`. One row
 *  per game, patched in place. Exists so a subscriber that only needs to
 *  know "did anything change, and does it need to act" — the vs-AI driver —
 *  can hold this instead of a second full `getPublicState` subscription that
 *  gets discarded on every beat it doesn't own (`getGameTick` below). */
async function saveGameTick(
    ctx: SaveCtx,
    gameId: GenericId<"games">,
    seq: number,
    state: GameState,
    insertedGame: Doc<"games"> | null,
    vsAi: boolean
) {
    const existing = await ctx.db
        .query("gameTicks")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .first();
    // ADR 0181 — the players who must ANSWER, not the seats the rules name:
    // under Turn Control (CR 723.5) the driver, the Bot deadline and the
    // clock below wake, time and charge the controller.
    const owedPlayerIds = computeOwedActingPlayerIds(state);
    const previousClock =
        existing?.clock ??
        (existing ? undefined : await seedGameClock(ctx, insertedGame));
    const clock = previousClock
        ? await advanceGameClock(
              ctx,
              gameId,
              previousClock,
              awaitedPlayerId(state, owedPlayerIds),
              state.gameOver !== undefined
          )
        : undefined;
    const fields: Omit<Doc<"gameTicks">, "_id" | "_creationTime" | "gameId"> = {
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
        owedPlayerIds,
        gameOver: state.gameOver !== undefined,
        ...(clock ? { clock } : {}),
        // Explicitly `undefined` when none is active, so the patch below
        // REMOVES a mirror the previous save wrote.
        turnControls: activeTurnControls(state),
        updatedAt: Date.now(),
    };
    const botDeadlineAt = await armBotDeadline(ctx, gameId, state, vsAi, {
        ...fields,
        botDeadlineAt: existing?.botDeadlineAt,
    });
    if (botDeadlineAt !== undefined) fields.botDeadlineAt = botDeadlineAt;
    if (existing) {
        await ctx.db.patch(existing._id, fields);
        return;
    }
    await ctx.db.insert("gameTicks", { gameId, ...fields });
}

/** Arm the Bot server deadline for this save (issue #9004): in a vs-AI game
 *  whose Bot seat is owed and that has no check pending, schedule the ONE
 *  `botLiveness.checkDeadline` and return the instant to record on the tick.
 *  `undefined` when nothing was armed — the tick keeps whatever it had. */
async function armBotDeadline(
    ctx: SaveCtx,
    gameId: GenericId<"games">,
    state: GameState,
    vsAi: boolean,
    tick: BotDeadlineTick
): Promise<number | undefined> {
    const now = Date.now();
    const action = planBotDeadline({
        tick,
        botId: botSeatId({ vsAi, players: state.players }),
        trigger: { kind: "save" },
        now,
    });
    if (action.kind !== "arm") return undefined;
    await ctx.scheduler.runAfter(
        Math.max(0, action.at - now),
        internal.botLiveness.checkDeadline,
        { gameId, seq: action.seq }
    );
    return action.at;
}

/** The one player a Match Clock charges for this position (issue #2308): the
 *  player the game is waiting on — priority OR a pending decision without
 *  priority (`computeExpectedInput`, ADR 0047). When the combat-damage
 *  sub-flow owes exactly one assigner other than the priority holder
 *  (`computeOwedPlayerIds`), that assigner is the one being waited on. */
function awaitedPlayerId(
    state: GameState,
    owedPlayerIds: readonly string[]
): string | null {
    if (owedPlayerIds.length === 1) return owedPlayerIds[0];
    const seatId = state.expectedInput?.playerId;
    // CR 723.5 (ADR 0181) — the clock charges whoever is deciding.
    return seatId ? actingPlayerFor(state, seatId) : null;
}

/** A clocked Match's new Game: its clock starts from the Match's carried
 *  remainder (`initialTickClock`). Read once per Game, on the first save —
 *  `null` for every unclocked Match (one extra read, then never again: an
 *  absent `clock` on the tick row is never re-seeded). */
async function seedGameClock(
    ctx: SaveCtx,
    game: Doc<"games"> | null
): Promise<TickClock | undefined> {
    if (!game?.matchId) return undefined;
    const match = await ctx.db.get(game.matchId);
    if (!match?.clock) return undefined;
    return initialTickClock(
        match.clock,
        game.players.map((p) => p.id)
    );
}

/** Charge and restart the clock for this save, keeping exactly one expiry job
 *  armed for the running clock: a job whose instant still holds (the same
 *  player keeps running — its expiry instant does not move) is kept; any
 *  other is cancelled, and a fresh one armed for the new runner. The job
 *  itself re-checks the tick row (`expireMatchClock`), so a job that slips
 *  past a cancel is a no-op, never a wrong loss. */
async function advanceGameClock(
    ctx: SaveCtx,
    gameId: GenericId<"games">,
    previous: TickClock,
    awaited: string | null,
    gameOver: boolean
): Promise<TickClock> {
    const now = Date.now();
    // A clock that already ran out stays as it is: the action that reached
    // this save arrived after the flag fell, and the armed job is about to
    // end the Match. Cancelling it here (the runner changed) would let a
    // player act past zero and escape the loss. Once the game is over — the
    // expiry job's own forfeit, or anything that beat it — the clock just
    // stops; the job, if still pending, finds the game over and does nothing.
    if (expiredPlayerId(previous, now) !== null) {
        if (!gameOver) return previous;
        return withoutExpiryJob(advanceClock(previous, null, now, true));
    }
    const next = advanceClock(previous, awaited, now, gameOver);
    const before = clockExpiresAt(previous);
    const after = clockExpiresAt(next);
    const keepJob =
        previous.expiryJobId !== undefined &&
        after !== null &&
        before === after &&
        previous.runningPlayerId === next.runningPlayerId;
    if (keepJob) return next;
    if (previous.expiryJobId !== undefined)
        await ctx.scheduler.cancel(previous.expiryJobId);
    const rest = withoutExpiryJob(next);
    if (after === null || next.runningPlayerId === undefined) return rest;
    const expiryJobId = await ctx.scheduler.runAfter(
        Math.max(0, after - now),
        internal.game.expireMatchClock,
        { gameId, playerId: next.runningPlayerId }
    );
    return { ...rest, expiryJobId };
}

/** The clock with no armed job recorded on it. */
function withoutExpiryJob(clock: TickClock): TickClock {
    const copy = { ...clock };
    delete copy.expiryJobId;
    return copy;
}
