import { describe, it, expect } from "vitest";
import {
    EMPTY_CADENCE,
    LANDINGS_PER_BATCH,
    MAX_BATCH_AGE_MS,
    afterFire,
    afterGreen,
    healthTrigger,
    parseCadence,
    recordLanding,
    serializeCadence,
    type CadenceState,
} from "../lib/health-cadence";

/**
 * The per-batch health CADENCE decision (ADR 0136 §6, issue #3780).
 *
 * Pure, and asserted pure on purpose: the alternative — driving five real
 * landings and a two-hour clock through `land` — is exactly the shape issue
 * #3792 took out of `gate.test.ts`, where a verdict became a property of the
 * machine's load rather than of the code. Here every input is hand-built: a
 * count, a clock, two shas.
 *
 * The scenarios these rules exist to satisfy are A/B/C in
 * `docs/guides/next-issue-flow.md` § 2.
 */

const T0 = Date.parse("2026-09-17T09:00:00.000Z");
const MIN = 60_000;

/** `n` landings, one every `everyMs`, the first at `T0`. */
function landings(n: number, everyMs = 5 * MIN) {
    return Array.from({ length: n }, (_, i) => ({
        sha: `${String(i + 1).padStart(40, "0")}`,
        at: T0 + i * everyMs,
    }));
}

function state(over: Partial<CadenceState> = {}): CadenceState {
    return { ...EMPTY_CADENCE, ...over };
}

describe("health cadence — the batch trigger (ADR 0136 §6)", () => {
    it("holds while the batch is neither full nor old", () => {
        const v = healthTrigger({
            state: state({ landings: landings(4) }),
            tip: "tip",
            now: T0 + 20 * MIN,
        });
        expect(v.kind).toBe("hold");
        expect(v.reason).toContain(`4/${LANDINGS_PER_BATCH}`);
    });

    it("fires on the FIFTH landing since the last GREEN", () => {
        const v = healthTrigger({
            state: state({ landings: landings(LANDINGS_PER_BATCH) }),
            tip: "tip5",
            now: T0 + 20 * MIN,
        });
        expect(v).toMatchObject({
            kind: "fire",
            trigger: "count",
            sha: "tip5",
        });
    });

    it("fires 2 h after the FIRST un-healthed landing even with one landing", () => {
        // The count threshold alone would leave a lone landing un-gated
        // indefinitely on a quiet afternoon — the exposure window ADR 0136 §6
        // bounds at "≤ 5 landings or 2 h".
        const v = healthTrigger({
            state: state({ landings: landings(1) }),
            tip: "tip1",
            now: T0 + MAX_BATCH_AGE_MS,
        });
        expect(v).toMatchObject({ kind: "fire", trigger: "age", sha: "tip1" });
        expect(
            healthTrigger({
                state: state({ landings: landings(1) }),
                tip: "tip1",
                now: T0 + MAX_BATCH_AGE_MS - 1,
            }).kind
        ).toBe("hold");
    });

    it("ages from the OLDEST landing, not the newest", () => {
        // Four landings spread over two hours: the batch is old even though
        // the last one merged a minute ago.
        const v = healthTrigger({
            state: state({ landings: landings(4, 40 * MIN) }),
            tip: "tip4",
            now: T0 + 121 * MIN,
        });
        expect(v).toMatchObject({ kind: "fire", trigger: "age" });
    });

    it("reports `count` when both thresholds are tripped", () => {
        const v = healthTrigger({
            state: state({ landings: landings(LANDINGS_PER_BATCH, 40 * MIN) }),
            tip: "tip",
            now: T0 + MAX_BATCH_AGE_MS * 2,
        });
        expect(v).toMatchObject({ kind: "fire", trigger: "count" });
    });

    it("holds with nothing landed since the last health run", () => {
        expect(
            healthTrigger({ state: state(), tip: "tip", now: T0 + 1e9 }).kind
        ).toBe("hold");
    });

    it("dedups a tip that is already GREEN, however many landings are behind it", () => {
        const v = healthTrigger({
            state: state({
                landings: landings(LANDINGS_PER_BATCH),
                lastGreenSha: "tipG",
            }),
            tip: "tipG",
            now: T0 + MAX_BATCH_AGE_MS,
        });
        expect(v.kind).toBe("hold");
        expect(v.reason).toContain("already GREEN");
    });

    it("dedups a tip health has already been STARTED for", () => {
        // Scenario B: a second landing detaches a second decision while the
        // first run is still going. One run per sha, or five quick landings
        // cost five full gates — the ADR 0116 regime this replaces.
        const v = healthTrigger({
            state: state({
                landings: landings(LANDINGS_PER_BATCH),
                lastFiredSha: "tipF",
            }),
            tip: "tipF",
            now: T0 + MAX_BATCH_AGE_MS,
        });
        expect(v.kind).toBe("hold");
        expect(v.reason).toContain("already started");
    });

    it("fires again on the NEXT tip after a RED — the fix-forward is gated at once", () => {
        // RED leaves the counter alone deliberately: it refuses the next PICK,
        // not the next LAND, so the landing carrying the repair moves the tip
        // past the dedup and re-gates immediately (scenario C).
        const after = afterFire(
            state({ landings: landings(LANDINGS_PER_BATCH) }),
            "tipRed"
        );
        expect(
            healthTrigger({ state: after, tip: "tipRed", now: T0 }).kind
        ).toBe("hold");
        expect(
            healthTrigger({ state: after, tip: "tipFix", now: T0 }).kind
        ).toBe("fire");
    });

    it("honours injected thresholds (the defaults are a policy, not a constant the test re-states)", () => {
        expect(
            healthTrigger({
                state: state({ landings: landings(2) }),
                tip: "tip",
                now: T0,
                landingsPerBatch: 2,
            })
        ).toMatchObject({ kind: "fire", trigger: "count" });
    });
});

describe("health cadence — the ledger", () => {
    it("counts a landing", () => {
        const s = recordLanding(EMPTY_CADENCE, "a".repeat(40), T0);
        expect(s.landings).toEqual([{ sha: "a".repeat(40), at: T0 }]);
    });

    it("is idempotent on the tip already at the tail — a retried `land` is not a second landing", () => {
        // ADR 0136 §2 makes a retried `land` cheap (the lane is skipped on an
        // unchanged sha); its post-merge steps run again against the SAME base
        // tip, and counting that twice fires the batch a landing early.
        const once = recordLanding(EMPTY_CADENCE, "a".repeat(40), T0);
        const twice = recordLanding(once, "a".repeat(40), T0 + MIN);
        expect(twice.landings).toHaveLength(1);
    });

    it("GREEN resets the counter — everything up to the gated tip is covered", () => {
        const s = state({ landings: landings(LANDINGS_PER_BATCH) });
        const gated = s.landings[LANDINGS_PER_BATCH - 1].sha;
        const after = afterGreen(s, gated, T0 + 30 * MIN);
        expect(after.landings).toEqual([]);
        expect(after.lastGreenSha).toBe(gated);
        expect(
            healthTrigger({ state: after, tip: gated, now: T0 + 1e9 }).kind
        ).toBe("hold");
    });

    it("GREEN covers only up to the tip it gated — landings that merged DURING the run stay un-healthed (scenario B)", () => {
        // Health gates the tip CURRENT at its start, so one run covers #6–#11;
        // a landing that merges after that snapshot is a DESCENDANT of the
        // gated tip and nothing has proven it.
        const s = state({ landings: landings(6) });
        const gatedIdx = 3;
        const after = afterGreen(
            s,
            s.landings[gatedIdx].sha,
            s.landings[gatedIdx].at
        );
        expect(after.landings.map((l) => l.sha)).toEqual(
            s.landings.slice(gatedIdx + 1).map((l) => l.sha)
        );
    });

    it("falls back to the run's start time when the gated tip was never a recorded landing", () => {
        // A push straight to the base branch, or a landing from another
        // machine: the tip health gated is real but not in this ledger.
        const s = state({ landings: landings(4, 10 * MIN) });
        const after = afterGreen(s, "f".repeat(40), T0 + 15 * MIN);
        expect(after.landings.map((l) => l.at)).toEqual([
            T0 + 20 * MIN,
            T0 + 30 * MIN,
        ]);
    });

    it("round-trips through the file format", () => {
        const s = afterFire(
            afterGreen(state({ landings: landings(3) }), "0".repeat(40), T0),
            "1".repeat(40)
        );
        expect(parseCadence(serializeCadence(s))).toEqual(s);
    });

    it("reads an absent, truncated or foreign ledger as EMPTY — a cadence is never a correctness barrier", () => {
        expect(parseCadence(null)).toEqual(EMPTY_CADENCE);
        expect(parseCadence("{ not json")).toEqual(EMPTY_CADENCE);
        expect(parseCadence("[]")).toEqual(EMPTY_CADENCE);
        expect(parseCadence('{"landings":"five"}')).toEqual(EMPTY_CADENCE);
        // Malformed ENTRIES are dropped one by one, not the whole ledger.
        expect(
            parseCadence(
                '{"landings":[{"sha":"a","at":1},{"sha":2,"at":3},{"at":4}]}'
            ).landings
        ).toEqual([{ sha: "a", at: 1 }]);
    });
});
