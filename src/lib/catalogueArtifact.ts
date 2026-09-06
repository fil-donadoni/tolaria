// The client's half of ADR 0113 §2: the card catalogue arrives as ONE
// content-addressed, `immutable` asset, FETCHED once, instead of being
// imported into the bundle (issue #3053).
//
// WHY A FETCH AND NOT AN IMPORT. `src/main.tsx` imports
// `@convex/cards/catalogue`, which used to pull
// `data/oracle-compiled-pool.json` into the module graph — paid on every cold
// load, in BOTH the `card-catalogue` chunk and the `brain.worker` bundle,
// since a Worker gets its own graph. Issue #2702 shipped that as explicitly
// interim and budgeted it; the budget is nearly spent. The rows are data, and
// data belongs in an asset the browser caches for a year, not in a chunk that
// is re-downloaded whenever the app code changes.
//
// WHY THE WHOLE CORPUS AND NOT A PER-GAME SLICE — ADR 0113 §3. Measured, the
// whole thing is ~1 MB Brotli, ~100 ms to become resident and ~30 MB of heap
// at 34,890 rows. A slice would force every caller to distinguish "definitions
// present" from "not yet", which is exactly the correctness window #2702
// refused. `getDefinition`/`tryGetDefinition` stay SYNCHRONOUS (ADR 0113 §1):
// the registry is fully hydrated before any consumer runs.
//
// WHY `import.meta.glob` AND NOT A COMMITTED URL CONSTANT. The artifact's file
// name IS its content hash (`scripts/lib/catalogue-merge.ts`), so a hand- or
// script-written URL would be a second copy of that hash and a new staleness
// class needing its own guard. The glob resolves at BUILD to whatever single
// file `data/catalogue/` holds, Vite emits it as a hashed asset and hands back
// its URL; regenerating the artifact re-points it with nothing to keep in
// sync. Contrast `src/lib/fullCatalogue.ts`, whose stable unhashed
// `/data/full-catalogue.json.gz` URL cannot be cache-busted on regeneration —
// deliberately not copied here.
import type { CardDefinition } from "@convex/cards/types";
import { registerCompiledDefinitions } from "@convex/cards/catalogue";

/** Every artifact `data/catalogue/` holds, as an emitted asset URL. Eager, so
 *  the URL is a build-time constant and the fetch owes no extra round trip. */
const artifacts = import.meta.glob<string>(
    "../../data/catalogue/catalogue-*.json",
    { query: "?url", import: "default", eager: true }
);

/**
 * The one artifact's URL.
 *
 * `scripts/catalogue-artifact.ts` deletes the stale file when it writes a new
 * one and `scripts/__tests__/catalogue-artifact.test.ts` reds on a directory
 * holding anything but exactly one — so more than one here means a merge
 * brought in a second artifact (`scripts/lib/generated-artifacts.ts` names
 * that case), and picking one of them arbitrarily would ship a catalogue
 * nobody chose.
 *
 * A FUNCTION, not a module-level constant, so that failure surfaces through
 * `CatalogueGate`'s error panel with a name on it. `src/main.tsx` imports this
 * module ABOVE `Sentry.init(...)`: a module-load throw there is an unreported
 * white screen, which is the one outcome worse than a bad build.
 */
export function catalogueArtifactUrl(): string {
    const urls = Object.entries(artifacts).sort(([a], [b]) =>
        a.localeCompare(b)
    );
    if (urls.length !== 1) {
        throw new Error(
            `data/catalogue/ must hold exactly one artifact, found ${urls.length}` +
                (urls.length === 0
                    ? " — run: bun run catalogue:pack"
                    : `: ${urls.map(([p]) => p).join(", ")} — run: bun run catalogue:pack`)
        );
    }
    return urls[0]![1];
}

/**
 * How long one attempt may take before it becomes a REJECTION.
 *
 * `fetch` has no deadline of its own, and a request that never settles is the
 * worst shape this module can take: the gate would sit on "Loading cards..."
 * with no Retry (its error branch renders on a rejection, and a pending
 * promise is not one) and the Brain's Worker would post nothing for the rest
 * of the session — every consult expiring on `BRAIN_CONSULT_TIMEOUT_MS` and
 * resolving `move: null`, i.e. a bot that passes every window, which is
 * exactly the issue #2450 symptom. A stall is therefore turned into a
 * rejection, which the gate's Retry and the Worker's re-arm both already
 * handle. Generous on purpose — 1,461,663 B raw over a slow link is a real
 * download, and this bounds a STALL, not slowness.
 */
const FETCH_TIMEOUT_MS = 60_000;

let hydration: Promise<number> | null = null;

/**
 * Fetch the artifact and register it, once per document (or per Worker).
 *
 * Promise singleton: the app kicks it off at module load of `src/main.tsx` so
 * it overlaps the auth round trip, the loading gate awaits the SAME promise,
 * and the Brain's Worker awaits its own copy in its own graph. A rejection is
 * not memoised — the gate offers a retry, and a retried fetch must actually
 * re-fetch.
 *
 * Resolves with the number of rows registered: the artifact carries the
 * relocated hand-written definitions too (issue #3052) and those are dropped
 * in favour of the modules the engine runs, so this is smaller than the row
 * count and is the honest "did the fetch do anything" signal.
 */
export function hydrateCatalogue(): Promise<number> {
    if (hydration === null) {
        hydration = fetchCatalogue().catch((error: unknown) => {
            hydration = null;
            throw error;
        });
    }
    return hydration;
}

async function fetchCatalogue(): Promise<number> {
    const url = catalogueArtifactUrl();
    // An explicit controller rather than `AbortSignal.timeout`: the deadline
    // has to be an ordinary `setTimeout` so it is one thing a test can drive
    // and one thing every runtime this module loads in already has.
    const controller = new AbortController();
    const deadline = setTimeout(() => {
        controller.abort(
            new Error(
                `catalogue artifact ${url} — no response in ${FETCH_TIMEOUT_MS} ms`
            )
        );
    }, FETCH_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(deadline);
    }
    if (!response.ok) {
        throw new Error(
            `catalogue artifact ${url} — HTTP ${response.status} ${response.statusText}`
        );
    }
    const rows = (await response.json()) as CardDefinition[];
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(
            `catalogue artifact ${url} is not a non-empty array of definitions`
        );
    }
    return registerCompiledDefinitions(rows);
}

/** TEST-ONLY. Drops the memoised promise so a test can drive the fetch again.
 *  Production has exactly one hydration per graph and never needs this. */
export function resetCatalogueHydrationForTests(): void {
    hydration = null;
}
