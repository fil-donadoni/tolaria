// The in-memory Verdict Store (issue #3576) — the fake every test in PRD #3574
// runs against, in place of the GCS transport.
//
// It honours the port's contract exactly (`verdictStore.ts`): `put` never
// overwrites, `get` of a missing name is `null`, `list` is sorted names under a
// prefix. Bytes are copied on the way in AND out, so a caller mutating a
// buffer it passed or received cannot reach into the store — which is the
// property a real bucket has, and the one a test of "the stored bytes did not
// change" silently depends on.
//
// `objects` is exposed on purpose: it is how a test plays the bucket going
// wrong (a tampered object, an upload that never landed) without the port
// growing a verb production must never have.

import type {
    VerdictStorePutOutcome,
    VerdictStoreWriter,
} from "./verdictStore";

export interface MemoryVerdictStore extends VerdictStoreWriter {
    /** The raw bucket, name → bytes. Tests tamper here; production never can. */
    readonly objects: Map<string, Uint8Array>;
}

export function createMemoryVerdictStore(): MemoryVerdictStore {
    const objects = new Map<string, Uint8Array>();
    return {
        objects,
        async get(name) {
            const bytes = objects.get(name);
            return bytes === undefined ? null : bytes.slice();
        },
        async put(name, bytes): Promise<VerdictStorePutOutcome> {
            if (objects.has(name)) return "exists";
            objects.set(name, bytes.slice());
            return "created";
        },
        async list(prefix) {
            return [...objects.keys()]
                .filter((name) => name.startsWith(prefix))
                .sort();
        },
    };
}
