import { describe, it, expect } from "vitest";
import {
    EMPTY_CADENCE,
    FIRE_DEDUP_MS,
    LANDINGS_PER_BATCH,
    MAX_BATCH_AGE_MS,
    afterFire,
    afterGreen,
    clearPending,
    closingIssueRefs,
    describeLastDecision,
    gateSkipReason,
    healthRunInFlight,
    healthTrigger,
    landingsSinceFire,
    parseCadence,
    pendingHealthRun,
    recordDecision,
    recordLanding,
    recordRepairIssue,
    reconcileHealthRun,
    redLandGate,
    serializeCadence,
    withPending,
    type CadenceState,
    type HealthRecord,
    type LandingKind,
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
                lastFiredAt: T0,
            }),
            tip: "tipF",
            // Inside the dedup window — its expiry is its own describe below.
            now: T0 + 30 * MIN,
        });
        expect(v.kind).toBe("hold");
        expect(v.reason).toContain("already started");
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
            "1".repeat(40),
            T0
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

describe("health cadence — the fire dedup expires (issue #3780 review, finding 9)", () => {
    const fired = () =>
        afterFire(
            state({ landings: landings(LANDINGS_PER_BATCH) }),
            "tipF",
            T0
        );

    it("suppresses a second fire on the same tip inside the window", () => {
        expect(
            healthTrigger({
                state: fired(),
                tip: "tipF",
                now: T0 + FIRE_DEDUP_MS - 1,
            }).kind
        ).toBe("hold");
    });

    it("fires again once the window passes — a run that died leaves no permanent wedge", () => {
        // A reboot, a `gate:who` reclaim, a machine asleep: the run never
        // wrote a verdict, so nothing clears the stamp. Without an expiry that
        // batch is never gated at all — the exposure ADR 0136 §6 bounds at
        // "≤ 5 landings or 2 h" becomes unbounded.
        expect(
            healthTrigger({
                state: fired(),
                tip: "tipF",
                now: T0 + FIRE_DEDUP_MS,
            }).kind
        ).toBe("fire");
    });

    it("a stamp with no timestamp behind it does not suppress anything", () => {
        // A ledger written by an older build carries `lastFiredSha` and no
        // `lastFiredAt`. Fail OPEN: gate once more rather than never again.
        expect(
            healthTrigger({
                state: state({
                    landings: landings(LANDINGS_PER_BATCH),
                    lastFiredSha: "tipF",
                    lastFiredAt: null,
                }),
                tip: "tipF",
                now: T0,
            }).kind
        ).toBe("fire");
    });
});

describe("health cadence — reconciling a finished run (issue #3780 review, finding 2)", () => {
    const FIRED_AT = T0 + 10 * MIN;

    function record(over: Partial<HealthRecord> = {}): HealthRecord {
        return {
            sha: "gated".padEnd(40, "0"),
            status: "green",
            startedAt: new Date(FIRED_AT + MIN).toISOString(),
            ...over,
        };
    }

    it("adopts the sha the RECORD names, not the one the fire snapshotted", () => {
        // THE defect this function exists for. `detach` snapshots the tip,
        // stamps it, then yields to queued lands — each of which advances the
        // tip — and `health-main` gates whatever is current when it finally
        // runs, which is what ADR 0136 §6 asks for. An equality check against
        // the snapshot rejects the verdict of the run it started: nothing is
        // pruned, `lastGreenSha` is never written, and every later landing
        // fires another ~10 min full gate — the ADR 0110 regime, silently.
        const s = state({ landings: landings(6) });
        const gated = s.landings[3].sha; // the tip moved on past the snapshot
        const action = reconcileHealthRun(s, {
            last: record({ sha: gated }),
            firedAt: FIRED_AT,
        });
        expect(action.kind).toBe("green");
        if (action.kind !== "green") return;
        expect(action.sha).toBe(gated);
        expect(action.state.lastGreenSha).toBe(gated);
        // …and it prunes exactly what that tip covers.
        expect(action.state.landings.map((l) => l.sha)).toEqual(
            s.landings.slice(4).map((l) => l.sha)
        );
    });

    it("adopts a GREEN whoever produced it, and reconciles it only once", () => {
        // `bun run release`, or a concurrent run, proving the tip is not a
        // reason to re-prove it.
        const s = state({ landings: landings(3) });
        const first = reconcileHealthRun(s, {
            last: record({ sha: "x".repeat(40) }),
            firedAt: FIRED_AT,
        });
        expect(first.kind).toBe("green");
        if (first.kind !== "green") return;
        expect(
            reconcileHealthRun(first.state, {
                last: record({ sha: "x".repeat(40) }),
                firedAt: FIRED_AT,
            }).kind
        ).toBe("none");
    });

    it("hands over a RED that started at or after the fire, and stamps the sha it gated", () => {
        const s = state({ landings: landings(LANDINGS_PER_BATCH) });
        const action = reconcileHealthRun(s, {
            last: record({ status: "red", failedStep: "test" }),
            firedAt: FIRED_AT,
        });
        expect(action.kind).toBe("red");
        if (action.kind !== "red") return;
        expect(action.reason).toContain("test");
        expect(action.state.lastFiredSha).toBe(action.sha);
        // The counter is NOT reset on RED — the fix-forward's landing is what
        // gets gated next.
        expect(action.state.landings).toHaveLength(LANDINGS_PER_BATCH);
    });

    it("never hands an INFRA record to the fixer — the machine slept, not the tree (issue #4938)", () => {
        // Any status that is not RUNNING or GREEN used to fall through to the
        // RED branch, so a gate cut by a closed lid spawned `health:fix` on a
        // tip with nothing to fix. The ledger stays put: the next landing
        // re-fires and the tip is gated again, awake.
        const s = state({ landings: landings(LANDINGS_PER_BATCH) });
        const action = reconcileHealthRun(s, {
            last: record({ status: "infra", failedStep: "test" }),
            firedAt: FIRED_AT,
        });
        expect(action).toEqual({
            kind: "none",
            reason: expect.stringMatching(/at test — the machine slept/),
        });
    });

    it("names the cause the INFRA record carries — a down backend is not a sleep (issue #4943)", () => {
        const action = reconcileHealthRun(
            state({ landings: landings(LANDINGS_PER_BATCH) }),
            {
                last: record({
                    status: "infra",
                    failedStep: "preflight:convex",
                    reason: "the local Convex backend did not answer",
                }),
                firedAt: FIRED_AT,
            }
        );
        expect(action).toEqual({
            kind: "none",
            reason: expect.stringMatching(
                /at preflight:convex — the local Convex backend did not answer$/
            ),
        });
    });

    it("does not re-hand-over a RED that predates this run", () => {
        expect(
            reconcileHealthRun(state({ landings: landings(2) }), {
                last: record({
                    status: "red",
                    startedAt: new Date(FIRED_AT - MIN).toISOString(),
                }),
                firedAt: FIRED_AT,
            }).kind
        ).toBe("none");
    });

    it("does nothing on a missing, unparseable or still-running record", () => {
        const at = { firedAt: FIRED_AT };
        expect(
            reconcileHealthRun(EMPTY_CADENCE, { last: null, ...at }).kind
        ).toBe("none");
        expect(
            reconcileHealthRun(EMPTY_CADENCE, {
                last: record({ startedAt: "not a date" }),
                ...at,
            }).kind
        ).toBe("none");
        expect(
            reconcileHealthRun(EMPTY_CADENCE, {
                last: record({ status: "running" }),
                ...at,
            }).kind
        ).toBe("none");
    });
});

describe("health cadence — one run in flight at a time (issue #3780 review, finding 10)", () => {
    const running = (startedAt: number): HealthRecord => ({
        sha: "r".repeat(40),
        status: "running",
        startedAt: new Date(startedAt).toISOString(),
    });

    it("holds while a run is in flight, whatever sha it is about", () => {
        // RED refuses the next PICK but not the next LAND, so the sessions
        // already mid-issue each land on a new tip — past both dedup checks.
        // Without this, each of those landings pays a full ~10 min gate.
        expect(healthRunInFlight(running(T0), T0 + MIN)).toContain("in flight");
    });

    it("ignores a `running` record too old to be a live run", () => {
        expect(healthRunInFlight(running(T0), T0 + FIRE_DEDUP_MS)).toBeNull();
    });

    it("says nothing about a terminal record or no record at all", () => {
        expect(healthRunInFlight(null, T0)).toBeNull();
        expect(
            healthRunInFlight(
                {
                    sha: "a",
                    status: "green",
                    startedAt: new Date(T0).toISOString(),
                },
                T0 + MIN
            )
        ).toBeNull();
    });
});

describe("health cadence — under RED, one coalesced run, never one per landing (issue #4964)", () => {
    /** RED was found on landing #5's tip by the run fired at T0. */
    function redAfterFire(extra = 0, kinds: (LandingKind | undefined)[] = []) {
        let st = afterFire(
            state({ landings: landings(5) }),
            landings(5)[4].sha,
            T0
        );
        for (let i = 0; i < extra; i++)
            st = recordLanding(
                st,
                `x${i}`.padEnd(40, "0"),
                T0 + (i + 1) * MIN,
                kinds[i]
            );
        return st;
    }

    it("three non-repair landings in a row fire at most once", () => {
        // The old trigger counted from the last GREEN, so under RED every
        // landing past the 5th cleared the per-tip dedup and fired again.
        let st = afterFire(
            state({ landings: landings(5) }),
            landings(5)[4].sha,
            T0
        );
        let fires = 0;
        for (let i = 0; i < 3; i++) {
            const tip = `n${i}`.padEnd(40, "0");
            const now = T0 + (i + 1) * 10 * MIN;
            st = recordLanding(st, tip, now);
            const v = healthTrigger({ state: st, tip, now, red: true });
            if (v.kind === "fire") {
                fires++;
                st = afterFire(st, tip, now);
            }
        }
        expect(fires).toBeLessThanOrEqual(1);
    });

    it("holds on non-repair landings until the batch refills, counted from the last FIRE", () => {
        const four = redAfterFire(LANDINGS_PER_BATCH - 1);
        const hold = healthTrigger({
            state: four,
            tip: "tip",
            now: T0 + 5 * MIN,
            red: true,
        });
        expect(hold.kind).toBe("hold");
        expect(hold.reason).toContain(`RED: 4/${LANDINGS_PER_BATCH}`);
        expect(
            healthTrigger({
                state: redAfterFire(LANDINGS_PER_BATCH),
                tip: "tip",
                now: T0 + 6 * MIN,
                red: true,
            })
        ).toMatchObject({ kind: "fire", trigger: "count" });
        expect(
            healthTrigger({
                state: redAfterFire(1),
                tip: "tip",
                now: T0 + MIN + MAX_BATCH_AGE_MS,
                red: true,
            })
        ).toMatchObject({ kind: "fire", trigger: "age" });
    });

    it("a repair landing fires once", () => {
        const st = redAfterFire(1, ["repair"]);
        const tip = st.landings[st.landings.length - 1].sha;
        const v = healthTrigger({
            state: st,
            tip,
            now: T0 + 2 * MIN,
            red: true,
        });
        expect(v).toMatchObject({ kind: "fire", trigger: "repair", sha: tip });
        // Fired: the repair is behind the last fire now, and the next
        // ordinary landing does not re-fire on its account.
        const after = recordLanding(
            afterFire(st, tip, T0 + 2 * MIN),
            "next".padEnd(40, "0"),
            T0 + 3 * MIN
        );
        expect(
            healthTrigger({
                state: after,
                tip: "next".padEnd(40, "0"),
                now: T0 + 3 * MIN,
                red: true,
            }).kind
        ).toBe("hold");
    });

    it("a red-ok landing is counted, never a reason to fire on its own", () => {
        const v = healthTrigger({
            state: redAfterFire(1, ["red-ok"]),
            tip: "tip",
            now: T0 + 2 * MIN,
            red: true,
        });
        expect(v.kind).toBe("hold");
    });

    it("a fire with a queued waiter holds — even for a repair, even past the batch", () => {
        const st = redAfterFire(LANDINGS_PER_BATCH, ["repair"]);
        const v = healthTrigger({
            state: st,
            tip: "tip",
            now: T0 + 10 * MIN,
            red: true,
            pending:
                "a health run fired 3m ago is still queued or running (pid 7)",
        });
        expect(v.kind).toBe("hold");
        expect(v.reason).toContain("covers this landing");
        // The same holds off RED: one run at a time is the invariant.
        expect(
            healthTrigger({
                state: state({ landings: landings(LANDINGS_PER_BATCH) }),
                tip: "tip",
                now: T0,
                pending: "queued",
            }).kind
        ).toBe("hold");
    });

    it("counts since the fire by the gated sha, else by the fire's time", () => {
        const rows = landings(4);
        const byShaSt = afterFire(state({ landings: rows }), rows[1].sha, T0);
        expect(landingsSinceFire(byShaSt)).toEqual(rows.slice(2));
        // The gated sha is no recorded landing: cut at the fire's time.
        const byTime = afterFire(state({ landings: rows }), "gone", rows[2].at);
        expect(landingsSinceFire(byTime)).toEqual(rows.slice(3));
    });
});

describe("health cadence — a queued or running run is pending (issue #4964)", () => {
    const alive = () => true;
    const dead = () => false;

    it("a fire waiting on the mutex is pending while its process lives", () => {
        const st = withPending(EMPTY_CADENCE, 4242, T0);
        expect(pendingHealthRun(st, null, T0 + 30 * MIN, alive)).toContain(
            "pid 4242"
        );
        expect(pendingHealthRun(st, null, T0 + 30 * MIN, dead)).toBeNull();
        expect(
            pendingHealthRun(clearPending(st), null, T0 + MIN, alive)
        ).toBeNull();
    });

    it("a pid older than any run is assumed reused", () => {
        const st = withPending(EMPTY_CADENCE, 4242, T0);
        expect(pendingHealthRun(st, null, T0 + 7 * 60 * MIN, alive)).toBeNull();
    });

    it("a running record is pending whatever the ledger says", () => {
        const running: HealthRecord = {
            sha: "r".repeat(40),
            status: "running",
            startedAt: new Date(T0).toISOString(),
        };
        expect(
            pendingHealthRun(EMPTY_CADENCE, running, T0 + MIN, dead)
        ).toContain("in flight");
    });

    it("the reconcile clears the pending fire, whatever the verdict", () => {
        const st = withPending(afterFire(EMPTY_CADENCE, "a", T0), 9, T0);
        for (const status of ["green", "red"] as const) {
            const action = reconcileHealthRun(st, {
                last: {
                    sha: "a",
                    status,
                    startedAt: new Date(T0 + MIN).toISOString(),
                },
                firedAt: T0,
            });
            expect(action.kind).toBe(status);
            if (action.kind !== "none")
                expect(action.state.pendingPid).toBeNull();
        }
    });
});

describe("health cadence — one live health waiter per checkout (issue #4960)", () => {
    // The 2026-10-02 shape: three lands, three `detach` decisions, each on a
    // new tip, the first fire still queued under `gate.ts yield`.
    it("three successive detach decisions leave exactly one waiter", () => {
        const alive = () => true;
        let st = state({ landings: landings(LANDINGS_PER_BATCH - 1) });
        let fires = 0;
        for (let i = 0; i < 3; i++) {
            const tip = `land${i}`.padEnd(40, "0");
            const now = T0 + (20 + 12 * i) * MIN;
            st = recordLanding(st, tip, now);
            const v = healthTrigger({
                state: st,
                tip,
                now,
                pending: pendingHealthRun(st, null, now, alive),
            });
            if (v.kind === "fire") {
                fires++;
                st = withPending(afterFire(st, tip, now), 1000 + i, now);
            } else {
                expect(v.reason).toContain("still queued or running");
            }
        }
        expect(fires).toBe(1);
    });
});

describe("health-main — a waiter never re-gates a concluded tip (issue #4960)", () => {
    const tip = "t".repeat(40);
    const at = (status: HealthRecord["status"], sha = tip): HealthRecord => ({
        sha,
        status,
        startedAt: new Date(T0).toISOString(),
        failedStep:
            status === "running" || status === "green"
                ? undefined
                : "check:ui --all",
    });
    const now = T0 + 50 * MIN;

    it("a waiter waking to a RED or INFRA verdict on the same tip exits, saying why", () => {
        for (const status of ["red", "infra"] as const) {
            const why = gateSkipReason({
                last: at(status),
                tip,
                now,
                retryTerminal: false,
            });
            expect(why).toContain(status.toUpperCase());
            expect(why).toContain("check:ui");
        }
    });

    it("`bun run health` by hand re-gates a RED or INFRA tip", () => {
        for (const status of ["red", "infra"] as const)
            expect(
                gateSkipReason({
                    last: at(status),
                    tip,
                    now,
                    retryTerminal: true,
                })
            ).toBeNull();
    });

    it("a tip that moved since the verdict is gated", () => {
        expect(
            gateSkipReason({
                last: at("infra", "o".repeat(40)),
                tip,
                now,
                retryTerminal: false,
            })
        ).toBeNull();
    });

    it("green and a live run skip either way; a stale run does not", () => {
        for (const retryTerminal of [true, false]) {
            expect(
                gateSkipReason({ last: at("green"), tip, now, retryTerminal })
            ).toContain("already green");
            expect(
                gateSkipReason({ last: at("running"), tip, now, retryTerminal })
            ).toContain("already being gated");
            expect(
                gateSkipReason({
                    last: at("running"),
                    tip,
                    now: T0 + FIRE_DEDUP_MS,
                    retryTerminal,
                })
            ).toBeNull();
        }
    });
});

describe("health cadence — land under RED (issue #4964)", () => {
    const base = {
        red: true,
        prBody: "",
        repairIssues: [4999],
        repairFlag: false,
        redOkFlag: false,
    };

    it("lands as before off RED", () => {
        expect(redLandGate({ ...base, red: false })).toEqual({
            kind: "proceed",
        });
    });

    it("lands the PR closing the /health-fix issue as a repair, with no flag", () => {
        expect(
            redLandGate({ ...base, prBody: "Fix the gate.\n\nCloses #4999" })
        ).toMatchObject({ kind: "proceed", landing: "repair" });
    });

    it("refuses any other PR unless --red-ok, which is counted", () => {
        const refused = redLandGate({ ...base, prBody: "Closes #1234" });
        expect(refused.kind).toBe("refuse");
        if (refused.kind === "refuse") {
            expect(refused.reason).toContain("--red-ok");
            expect(refused.reason).toContain("#4999");
        }
        expect(redLandGate({ ...base, redOkFlag: true })).toMatchObject({
            kind: "proceed",
            landing: "red-ok",
        });
        expect(redLandGate({ ...base, repairFlag: true })).toMatchObject({
            kind: "proceed",
            landing: "repair",
        });
    });

    it("reads closing refs as GitHub does — a bare #N only", () => {
        expect(
            closingIssueRefs(
                "Closes #1, fixes #2\nResolved: #3 and Closes issue #4"
            )
        ).toEqual([1, 2, 3]);
    });

    it("the repair issues live in the ledger until GREEN", () => {
        const st = recordRepairIssue(recordRepairIssue(EMPTY_CADENCE, 7), 7);
        expect(st.repairIssues).toEqual([7]);
        expect(parseCadence(serializeCadence(st)).repairIssues).toEqual([7]);
        expect(afterGreen(st, "a", T0).repairIssues).toEqual([]);
    });
});

describe("health cadence — health:status says why the last landing did or did not fire (issue #4964)", () => {
    it("names the decision, the tip and the landing's kind, through the file format", () => {
        const st = recordDecision(
            recordLanding(EMPTY_CADENCE, "f".repeat(40), T0, "repair"),
            {
                at: T0,
                tip: "f".repeat(40),
                kind: "fire",
                reason: "RED: ffffffff is a declared repair",
            }
        );
        const line = describeLastDecision(parseCadence(serializeCadence(st)));
        expect(line).toContain("FIRED");
        expect(line).toContain("(repair)");
        expect(line).toContain("declared repair");
        expect(describeLastDecision(EMPTY_CADENCE)).toContain("no cadence");
    });
});

/**
 * The 2026-09-30 → 2026-10-02 RED window, replayed (issue #4964). The landings
 * are the real ledger rows (`cadence.json`, sha prefixes); the first run fired
 * on 7b9ed220 and found RED, and every run after it found RED or INFRA. What
 * the replay cannot know is how long each run held the mutex, nor which
 * landings a `/health-fix` issue would have declared repairs — so it bounds
 * both: run lengths from 15 to 60 min, and either no repair or every PR that
 * fixed a red the window's runs reported.
 */
const RED_WINDOW: [string, number][] = [
    ["5f5a978d", 1790755082960],
    ["e1890249", 1790756643007],
    ["820001c8", 1790761991610],
    ["7b9ed220", 1790768963147],
    ["2e1e2c94", 1790771674643],
    ["02bd75cc", 1790779612424],
    ["d8077be9", 1790795721208],
    ["e1902d33", 1790796149241],
    ["d2b28195", 1790797936697],
    ["a124c930", 1790803582372],
    ["35ae12aa", 1790832067338],
    ["9033fac4", 1790839314990],
    ["8873c7a6", 1790840758015],
    ["44808a35", 1790845585536],
    ["b0b39155", 1790849172218],
    ["a15195d8", 1790852565476],
    ["7c96560a", 1790872796258],
    ["abbce2d1", 1790884863991],
    ["ec54045e", 1790886076438],
    ["ab6e7250", 1790919190314],
    ["c91ce048", 1790920218052],
    ["7abe7d9a", 1790921159035],
    ["a5a205ac", 1790921807038],
    ["c8c1aa46", 1790922409581],
    ["aa785cf0", 1790923375733],
    ["d0a9af03", 1790929392839],
    ["7bc59629", 1790934655957],
    ["66bdcf69", 1790941924285],
    ["f61bfddc", 1790942641503],
];
/** PRs #4950 and #4956 — each closes an issue a `/health-fix` session filed
 *  against one of the window's reds (issue #4949 "health RED @ ec54045",
 *  issue #4955 "health RED @ ab6e725"): the landings the new rule declares
 *  repairs. */
const WINDOW_REPAIRS = new Set(["ab6e7250", "aa785cf0"]);
/** Index of 7b9ed220, whose run opened the RED window. */
const FIRST_RED = 3;

/**
 * Drive the trigger over the window. `rules: "old"` is the pre-#4964 cadence:
 * no RED branch, only a RUNNING record holds, no re-decision after a run.
 */
function replayRedWindow(opts: {
    runMs: number;
    repairs: ReadonlySet<string>;
    rules: "new" | "old";
}): number {
    const rows = RED_WINDOW.map(([sha, at]) => ({
        sha: sha.padEnd(40, "0"),
        at,
    }));
    const first = rows[FIRST_RED];
    let st: CadenceState = afterFire(
        { ...EMPTY_CADENCE, landings: rows.slice(0, FIRST_RED + 1) },
        first.sha,
        first.at
    );
    let run: { sha: string; start: number; end: number } | null = {
        sha: first.sha,
        start: first.at,
        end: first.at + opts.runMs,
    };
    let fires = 0;
    let tip = first.sha;

    const decide = (now: number) => {
        const busy = run !== null && now < run.end;
        const v = healthTrigger({
            state: st,
            tip,
            now,
            red: opts.rules === "new",
            pending: busy ? "a run is queued or running" : null,
        });
        if (v.kind === "fire") {
            fires++;
            st = afterFire(st, tip, now);
            run = { sha: tip, start: now, end: now + opts.runMs };
        }
    };
    const finishRunsBefore = (t: number) => {
        while (run !== null && run.end <= t) {
            const done = run;
            run = null;
            const action = reconcileHealthRun(st, {
                last: {
                    sha: done.sha,
                    status: "red",
                    startedAt: new Date(done.start).toISOString(),
                },
                firedAt: done.start,
            });
            if (action.kind !== "none") st = action.state;
            if (opts.rules === "new") decide(done.end);
        }
    };

    for (const row of rows.slice(FIRST_RED + 1)) {
        finishRunsBefore(row.at);
        const short = row.sha.slice(0, 8);
        st = recordLanding(
            st,
            row.sha,
            row.at,
            opts.repairs.has(short) ? "repair" : undefined
        );
        tip = row.sha;
        decide(row.at);
    }
    finishRunsBefore(Number.POSITIVE_INFINITY);
    return fires;
}

describe("health cadence — the 2026-09-30 → 2026-10-02 RED window, replayed (issue #4964)", () => {
    const NONE = new Set<string>();
    it("the old trigger fires once per landing — the regime the issue measured", () => {
        // 25 landings after the first RED; the issue counted 22 runs, and so
        // does the replay at 15-min runs — the model reproduces the history.
        expect(
            replayRedWindow({ runMs: 15 * MIN, repairs: NONE, rules: "old" })
        ).toBe(22);
    });

    for (const runMin of [15, 30, 60])
        for (const [label, repairs] of [
            ["no repair", NONE],
            ["the two /health-fix repairs", WINDOW_REPAIRS],
        ] as const)
            it(`the new trigger fires at most 8 times (${runMin}-min runs, ${label})`, () => {
                expect(
                    replayRedWindow({
                        runMs: runMin * MIN,
                        repairs,
                        rules: "new",
                    })
                ).toBeLessThanOrEqual(8);
            });
});
