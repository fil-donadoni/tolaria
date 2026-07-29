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

    const db = {
        get: async (id: string) => {
            for (const rows of Object.values(tables)) {
                const found = rows.find((r) => r._id === id);
                if (found) return structuredClone(found);
            }
            return null;
        },
        query: (table: string) => ({
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
                    (tables[table] ?? [])
                        .filter((row) =>
                            filters.every(
                                ([field, value]) => row[field] === value
                            )
                        )
                        .map((r) => structuredClone(r));
                return {
                    unique: async () => matching()[0] ?? null,
                    collect: async () => matching(),
                    first: async () => matching()[0] ?? null,
                    take: async (n: number) => matching().slice(0, n),
                };
            },
        }),
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

    return { ctx: { db, auth } as unknown as MutationCtx, tables, writes };
}
