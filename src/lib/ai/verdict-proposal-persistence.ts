// Best-effort client storage for the Verdict Proposal path (issue #8889): the
// human seat's captured decisions and the finished game's proposal list
// survive a page reload, so a reload during or after a vs-Bot game no longer
// empties the post-game review.
//
// BEST-EFFORT, NEVER IN THE WAY. Every call resolves — a missing, full or
// throwing storage reads as "nothing stored" and a failed write is dropped, so
// the capture falls back to its in-memory behaviour and never costs a move or
// surfaces an error during play.
//
// IndexedDB, not `sessionStorage`: a game keeps up to `captureLimit` (200)
// projections, past `sessionStorage`'s quota. Two object stores, each bounded
// by construction:
//   - `capture`   — ONE game's decisions (a `meta` row plus a row per kept
//                   slot and the open decision); a capture for another game
//                   clears it before writing.
//   - `proposals` — ONE row, the most recent finished game's list.
//
// Client-side and non-authoritative (ADR 0074): proposals are questions, not
// game state; nothing here reaches the server.

/** The two logical stores. */
export type ProposalStoreName = "capture" | "proposals";

/** The storage seam: an IndexedDB database in the browser, a fake in tests. */
export type ProposalStorage = {
    /** Every row of `store`, by key. */
    readAll(store: ProposalStoreName): Promise<Record<string, unknown>>;
    /** Write `entries` into `store` in one transaction — after clearing it
     *  first when `clear` is set. */
    write(
        store: ProposalStoreName,
        entries: Record<string, unknown>,
        clear?: boolean
    ): Promise<void>;
};

const DB_NAME = "tolaria-verdict-proposals";
const DB_VERSION = 1;
const STORES: readonly ProposalStoreName[] = ["capture", "proposals"];

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function indexedDbStorage(factory: IDBFactory): ProposalStorage {
    let db: Promise<IDBDatabase> | null = null;
    const open = (): Promise<IDBDatabase> => {
        db ??= new Promise<IDBDatabase>((resolve, reject) => {
            const req = factory.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                for (const name of STORES) {
                    if (!req.result.objectStoreNames.contains(name)) {
                        req.result.createObjectStore(name);
                    }
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error("indexedDB open blocked"));
        });
        return db;
    };
    return {
        async readAll(store) {
            const tx = (await open()).transaction(store, "readonly");
            const os = tx.objectStore(store);
            const [keys, values] = await Promise.all([
                request(os.getAllKeys()),
                request(os.getAll()),
            ]);
            const out: Record<string, unknown> = {};
            keys.forEach((k, i) => {
                out[String(k)] = values[i];
            });
            return out;
        },
        async write(store, entries, clear) {
            const tx = (await open()).transaction(store, "readwrite");
            const done = new Promise<void>((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
            const os = tx.objectStore(store);
            if (clear) os.clear();
            for (const [key, value] of Object.entries(entries)) {
                os.put(value, key);
            }
            await done;
        },
    };
}

let override: ProposalStorage | null | undefined;
let browserDefault: ProposalStorage | null | undefined;

function storage(): ProposalStorage | null {
    if (override !== undefined) return override;
    if (browserDefault === undefined) {
        try {
            browserDefault =
                typeof indexedDB === "undefined"
                    ? null
                    : indexedDbStorage(indexedDB);
        } catch {
            browserDefault = null;
        }
    }
    return browserDefault;
}

/** Whether anything can be persisted at all — `false` keeps the capture on
 *  its in-memory path with no async step. */
export function proposalStorageAvailable(): boolean {
    return storage() !== null;
}

/** Every row of `store`; `{}` when storage is missing or fails. */
export async function readProposalStore(
    store: ProposalStoreName
): Promise<Record<string, unknown>> {
    const s = storage();
    if (!s) return {};
    try {
        return (await s.readAll(store)) ?? {};
    } catch {
        return {};
    }
}

/** Write `entries` into `store`; a failure is dropped, never thrown. */
export async function writeProposalStore(
    store: ProposalStoreName,
    entries: Record<string, unknown>,
    clear = false
): Promise<void> {
    const s = storage();
    if (!s) return;
    try {
        await s.write(store, entries, clear);
    } catch {
        // Best-effort: the in-memory copy is still whole.
    }
}

/** Tests only: replace the storage (`null` = none), or `undefined` to go back
 *  to the browser's IndexedDB. */
export function setProposalStorageForTest(
    next: ProposalStorage | null | undefined
): void {
    override = next;
}
