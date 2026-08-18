// A minimal in-memory Convex `MutationCtx` for tests.
//
// The project has no convex-test harness (see `convex/__tests__/decks.test.ts`,
// `convex/__tests__/adminAuth.test.ts`), so a server module that genuinely
// needs a `ctx` — `convex/limitedSeatStore.ts`, or a mutation handler driven
// end-to-end — is driven against this instead: real module, real control flow,
// fake storage. It implements exactly the surface those callers use, no more:
// `get`/`insert`/`patch`/`replace`/`delete` plus
// `query(table).withIndex(name, q => q.eq(...)).unique()/.collect()/.take(n)`,
// and an `auth.getUserIdentity()` shaped the way `@convex-dev/auth` reads it.
//
// Deliberately NOT a Convex emulator: no schema validation (the schema is
// covered by its own validator-walking tests), no index-order semantics (every
// `withIndex` is an equality filter over the table), no transactions.
import type { MutationCtx } from "../../_generated/server";

export interface InMemoryRow {
    _id: string;
    [key: string]: unknown;
}

export interface InMemoryDb {
    /** Pass this where a `MutationCtx`/`QueryCtx` is expected. */
    ctx: MutationCtx;
    /** Live storage — read it to assert on what was persisted. */
    tables: Record<string, InMemoryRow[]>;
    /** Every insert/patch/replace, in order, so a test can assert that a
     *  dirty check actually SKIPPED a write rather than merely producing the
     *  right final state by luck. */
    writes: { table: string; id: string }[];
    /** Every executed query, in order, as the table plus the index-equality
     *  values it was narrowed by (`[]` for an unnarrowed scan).
     *
     *  For the assertions that are about a READ SET rather than a result: in
     *  Convex a query's read set is what its subscription re-executes on, so
     *  "this read touched only the viewer's own row" is a correctness property
     *  with no observable effect on the returned value — a widened read is
     *  invisible to every result-shaped assertion and shows up only as
     *  someone else's board re-rendering, or as a bill. */
    reads: { table: string; key: unknown[] }[];
    /** Every `ctx.db.get(id)`, in order — the read-set tracker for a POINT
     *  lookup, which `reads` cannot see (it records executed queries). Same
     *  purpose: a handler that fetches a document it does not need returns the
     *  right answer, is billed for the whole document, and joins that
     *  document's invalidation path. */
    gets: string[];
}

export interface InMemoryDbOptions {
    /** `ctx.auth.getUserIdentity()`'s `subject`. `@convex-dev/auth`'s
     *  `auth.getUserId` reads the user id as the part before the `|`, so
     *  `"user1|session1"` authenticates as `user1`. Omit for an unauthenticated
     *  ctx (identity `null`). */
    identitySubject?: string;
}

/** Builds a fresh in-memory ctx seeded with `initial` (deep-cloned, so a
 *  fixture object can be reused across tests). */
export function makeInMemoryDb(
    initial: Record<string, InMemoryRow[]> = {},
    options: InMemoryDbOptions = {}
): InMemoryDb {
    const tables: Record<string, InMemoryRow[]> = {};
    for (const [name, rows] of Object.entries(initial)) {
        tables[name] = rows.map((r) => structuredClone(r));
    }
    let nextId = 1000;
    const writes: { table: string; id: string }[] = [];
    const reads: { table: string; key: unknown[] }[] = [];
    const gets: string[] = [];

    const db = {
        get: async (id: string) => {
            gets.push(id);
            for (const rows of Object.values(tables)) {
                const found = rows.find((r) => r._id === id);
                if (found) return structuredClone(found);
            }
            return null;
        },
        query: (table: string) => {
            // Terminal methods shared by both the indexed path (below) and
            // the bare unindexed scan (`myLimitedEvents`,
            // `myCurrentLimitedEvents`: `ctx.db.query(table).order(...).take(n)`,
            // no `withIndex` at all — the whole reason this got added, issue
            // #2357). `order` is a no-op here (rows are read back in
            // insertion order, same as `.withIndex`'s `matching()`); nothing
            // in this project's test suite asserts ORDER through this
            // fixture, only membership.
            const terminal = (
                rows: () => InMemoryRow[],
                key: () => unknown[]
            ) => {
                // Recorded at EXECUTION, not at construction: an unexecuted
                // query builder reads nothing, and the read set is what the
                // terminal call actually resolved.
                const run = () => {
                    reads.push({ table, key: key() });
                    return rows();
                };
                return {
                    // `direction` is part of the real Convex signature
                    // (callers pass "desc") but this fixture reads rows back
                    // in insertion order regardless — see the comment above.
                    order: (direction: "asc" | "desc") => {
                        void direction;
                        return terminal(rows, key);
                    },
                    unique: async () => run()[0] ?? null,
                    collect: async () => run(),
                    first: async () => run()[0] ?? null,
                    take: async (n: number) => run().slice(0, n),
                };
            };
            const allRows = () =>
                (tables[table] ?? []).map((r) => structuredClone(r));
            return {
                ...terminal(allRows, () => []),
                withIndex: (
                    _name: string,
                    build?: (q: {
                        eq: (field: string, value: unknown) => unknown;
                    }) => unknown
                ) => {
                    const filters: [string, unknown][] = [];
                    if (build) {
                        const q = {
                            eq(field: string, value: unknown) {
                                filters.push([field, value]);
                                return q;
                            },
                        };
                        build(q);
                    }
                    const matching = () =>
                        allRows().filter((row) =>
                            filters.every(
                                ([field, value]) => row[field] === value
                            )
                        );
                    return terminal(matching, () =>
                        filters.map(([, value]) => value)
                    );
                },
            };
        },
        insert: async (table: string, doc: Record<string, unknown>) => {
            const _id = `${table}-${nextId++}`;
            (tables[table] ??= []).push(structuredClone({ ...doc, _id }));
            writes.push({ table, id: _id });
            return _id;
        },
        replace: async (id: string, doc: Record<string, unknown>) => {
            for (const [table, rows] of Object.entries(tables)) {
                const i = rows.findIndex((r) => r._id === id);
                if (i !== -1) {
                    rows[i] = structuredClone({ ...doc, _id: id });
                    writes.push({ table, id });
                    return;
                }
            }
            throw new Error(`replace: no row ${id}`);
        },
        patch: async (id: string, doc: Record<string, unknown>) => {
            for (const [table, rows] of Object.entries(tables)) {
                const i = rows.findIndex((r) => r._id === id);
                if (i !== -1) {
                    rows[i] = structuredClone({ ...rows[i], ...doc });
                    writes.push({ table, id });
                    return;
                }
            }
            throw new Error(`patch: no row ${id}`);
        },
        delete: async (id: string) => {
            for (const rows of Object.values(tables)) {
                const i = rows.findIndex((r) => r._id === id);
                if (i !== -1) {
                    rows.splice(i, 1);
                    return;
                }
            }
        },
    };

    const auth = {
        getUserIdentity: async () =>
            options.identitySubject === undefined
                ? null
                : {
                      subject: options.identitySubject,
                      issuer: "test",
                      tokenIdentifier: `test|${options.identitySubject}`,
                  },
    };

    return {
        ctx: { db, auth } as unknown as MutationCtx,
        tables,
        writes,
        reads,
        gets,
    };
}
