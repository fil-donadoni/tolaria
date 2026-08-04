// Shared stub `MutationCtx` for driving REGISTERED `game.ts` mutation
// `_handler`s directly against an in-memory document store (issue #1779
// review findings 2-6). Same harness discipline as `seatOwnership.test.ts` /
// `limitedPairingMatch.test.ts`: this project has no convex-test harness, so
// the established seam for `game.ts` integration coverage is a stub
// `MutationCtx` over a `Map`, driving the mutation's own `_handler` — NOT a
// hand-rolled reimplementation of the mutation's loop body (the gap the
// review flagged: a reimplementation can silently diverge from what's
// actually deployed and never drives `saveGameState`, so the seq-bump / no-
// partial-write contract goes untested).
import type { MutationCtx } from "../_generated/server";
import type { GameState } from "../gre/state";
import { expandState } from "../gre/serialize";

export type Row = Record<string, unknown>;

export interface MutationStub {
    ctx: MutationCtx;
    /** Read back a seeded/mutated document by id. */
    doc: (id: string) => Row;
    /** Convenience accessor for the single `gameStates` row every scenario
     *  here seeds as `gs-1`. */
    state: () => GameState;
}

/** A stub `MutationCtx`, authenticated as `userId` (or unauthenticated when
 *  `userId` is `null`), over an in-memory document store seeded with
 *  `seeds`. Mirrors `seatOwnership.test.ts`'s `makeCtx`. */
export function makeMutationCtx(
    userId: string | null,
    seeds: Row[]
): MutationStub {
    const docs = new Map<string, Row>();
    for (const seed of seeds) docs.set(seed._id as string, { ...seed });

    const ctx = {
        auth: {
            getUserIdentity: async () =>
                userId === null ? null : { subject: `${userId}|session1` },
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Row) => {
                const id = `${table}-${docs.size + 1}`;
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
        doc: (id) => docs.get(id)!,
        // `saveGameState` persists the COMPACT form (`compactState`) — read
        // it back the same way the mutation's own `getLatestGameState` does
        // (`expandState`), or fields the compactor drops when falsy/default
        // (e.g. `isTapped: false`) read back as `undefined` instead of their
        // real default. `expandState` round-trips a never-compacted fixture
        // fine too (falls back to the card registry for anything absent),
        // so this is safe to call both before and after a mutation runs.
        state: () =>
            expandState(docs.get("gs-1")!.state as Record<string, unknown>),
    };
}

/** The registered-mutation shape (`convex/server`'s `mutation()` wrapper) —
 *  same cast `seatOwnership.test.ts` uses to reach `_handler` directly. */
export type Handler<A, R> = {
    _handler: (ctx: MutationCtx, args: A) => Promise<R>;
};

/** Drive a registered `game.ts` mutation's `_handler` against a stub ctx. */
export function runMutation<A, R>(
    fn: unknown,
    ctx: MutationCtx,
    args: A
): Promise<R> {
    return (fn as Handler<A, R>)._handler(ctx, args);
}

/** A minimal `gameStates` row seed — the only table these mutations read
 *  (`getLatestGameState`) or write (`saveGameState`); no `games` row lookup
 *  is on the `tapForPayment` / `selectTargets` path. */
export function gameStateSeed(state: GameState, seq = 1): Row {
    return {
        _id: "gs-1",
        __table: "gameStates",
        gameId: "game-1",
        seq,
        state,
        updatedAt: 0,
    };
}
