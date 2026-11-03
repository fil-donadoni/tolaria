// Inert lane sources for tests that assert what `classifyLane` PLANS from a
// path set (issue #7884). `classifyLane`'s live defaults walk the whole tree's
// import graph (ADR 0154 §2): ~2 s standalone, ~40× that under batch-health
// contention — a deterministic cost the admission claims never needed.
//
// A test whose subject IS the live walk does not use this helper; it calls
// `classifyLane` bare AND carries the `live-walk:` marker comment (see
// `lane-sources-injected.guard.test.ts`).
import {
    classifyLane,
    type BotReachSource,
    type LanePlan,
    type PathClass,
    type RelatedTests,
    type SentinelSource,
} from "../check-lane";

export const NO_RELATED: RelatedTests = {
    "node-engine": [],
    "node-tooling": [],
    dom: [],
};

/** No test reached, in every project. */
export const inertRelated = (): RelatedTests => ({ ...NO_RELATED });

/** No bot file reached; a flat, in-budget cost model. */
export const INERT_BOT_REACH: BotReachSource = {
    total: () => 0,
    related: () => ({ "bot-node": [], "bot-dom": [] }),
    costs: () => ({}),
    budget: () => ({ perFileMs: 60_000, totalMs: 600_000 }),
};

/** An empty sentinel set. */
export const INERT_SENTINELS: SentinelSource = {
    read: () => ({
        $generated: "",
        version: 1,
        windowDays: 30,
        through: "2026-10-31",
        capS: 5,
        candidates: [],
        sentinels: [],
        overCap: [],
        unmeasured: [],
    }),
    projectOf: () => null,
};

/** `classifyLane` over fixture sources: no tree walk, no disk read. */
export function inertClassifyLane(
    changed: string[],
    present: string[] = changed,
    related: (paths: string[]) => RelatedTests = inertRelated,
    overrides: ReadonlyMap<string, PathClass> = new Map(),
    pureRevert: readonly string[] | null = null
): LanePlan {
    return classifyLane(
        changed,
        present,
        related,
        overrides,
        INERT_BOT_REACH,
        () => [],
        INERT_SENTINELS,
        pureRevert
    );
}
