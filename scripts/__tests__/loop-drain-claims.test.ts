import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    DRIVER,
    tmp,
    queueFile,
    totalFile,
    greenShaFile,
    writeStub,
    stubGhCountingFrom,
    stubGhTwoCounters,
    stubGhSucceedsPrePassFailsPostPass,
    stubClaudeProgress,
    stubClaudeNoProgress,
    run,
    logLines,
    passLogCount,
} from "./loop-drain-harness";

installLoopDrainHarness();

describe("progress is measured on the total open count, not the claim-adjusted unclaimed count", () => {
    it("reports claims-held, not no-progress, when a pass claims work and lands nothing (#2626)", () => {
        // Simulates a pass that claims work (adds `in-progress`, dropping
        // the UNCLAIMED count) but lands nothing (TOTAL open ready-for-agent
        // stays put, green-sha never moves) — the exact shape of a pass
        // forcibly terminated mid-batch (#2621): it exits 0, so from the
        // outside it is indistinguishable from a pass that genuinely found
        // nothing to do UNLESS the claim count itself is consulted.
        //
        // Historical note: BEFORE this behaviour existed, an earlier bug had
        // the no-progress check compare the UNCLAIMED count directly, which
        // dropped every pass here and read as "progress" — resetting the
        // streak forever, so a batch that claims-and-abandons could burn
        // through the whole queue without landing a single PR. That bug is
        // what `count_total_open` (deliberately distinct from
        // `count_unclaimed`) already guards against. This test asserts the
        // more specific diagnosis (#2626): claiming without landing is a
        // `claims-held` FAULT, never a generic `no-progress` streak.
        //
        // What changed in #3698 is only WHEN the run stops on it: the fault
        // is still recorded on the pass that produced it (`claims-held-retry`
        // here), but it takes MAX_CONSECUTIVE_CLAIMS_HELD of them in a row to
        // end the run — see the `--max-consecutive-claims-held` block below.
        stubGhTwoCounters(9, 9);
        writeStub(
            "claude",
            [
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `echo "claimed one issue, landed nothing"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=claims-held/);
        expect(r.stdout).not.toMatch(/reason=no-progress/);
        // The default bound, exhausted: three consecutive deaths, and the
        // run's own reason is still `claims-held` — "died holding claims",
        // never "nothing to do".
        expect(passLogCount()).toBe(3);
        expect(logLines().map((l) => l.split(" ").pop())).toEqual([
            "claims-held-retry",
            "claims-held-retry",
            "claims-held",
        ]);
    });

    it("DOES treat a real landing (total open count drops) as progress", () => {
        stubGhTwoCounters(3, 3);
        writeStub(
            "claude",
            [
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `t=$(cat "${totalFile}" 2>/dev/null || echo 0)`,
                `if [ "$t" -gt 0 ]; then t=$((t-1)); fi`,
                `echo "$t" > "${totalFile}"`,
                `echo "sha-$t" > "${greenShaFile}"`,
                `echo "landed a PR"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        expect(passLogCount()).toBe(3);
    });
});

describe("claims-held (#2626)", () => {
    it("consumes claimsHeld from lib/loop-status rather than re-implementing the comparison in shell", () => {
        // AC: "The predicate is imported from the verdict engine, not
        // re-implemented in shell or duplicated in TypeScript." A source
        // check rather than a behavioural one — the behavioural tests above
        // and below would pass just as well against a hand-rolled
        // `[ "$claims_after" -gt "$claims_before" ]` shell comparison, which
        // is exactly the drift this AC exists to prevent (this log and the
        // dashboard's `claims-held` alarm disagreeing about what happened).
        const source = fs.readFileSync(DRIVER, "utf8");
        expect(source).toMatch(/import\s*\{\s*claimsHeld\s*\}\s*from/);
        expect(source).toMatch(/lib\/loop-status/);
    });

    it("only counts claims taken during THIS pass's own window, not a prior pass's", () => {
        // Pass 1 is a real landing (total drops, green-sha moves) — ordinary
        // progress, no claim left outstanding from it. Pass 2 claims one
        // issue and lands nothing. If `claims_before`/`claims_after` were
        // measured cumulatively from the run's start (or from a stale
        // snapshot) rather than bracketing pass 2's own before/after, pass 1's
        // drop in `total` could pollute the comparison; bracketing per-pass
        // is what keeps a concurrent session's or an earlier pass's claims
        // from being attributed to a pass that didn't take them.
        stubGhTwoCounters(5, 5);
        writeStub(
            "claude",
            [
                `STATE="${path.join(tmp, "call-count")}"`,
                `c=$(cat "$STATE" 2>/dev/null || echo 0)`,
                `c=$((c+1))`,
                `echo "$c" > "$STATE"`,
                `if [ "$c" -eq 1 ]; then`,
                // Pass 1: a real landing.
                `  n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `  if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `  echo "$n" > "${queueFile}"`,
                `  t=$(cat "${totalFile}" 2>/dev/null || echo 0)`,
                `  if [ "$t" -gt 0 ]; then t=$((t-1)); fi`,
                `  echo "$t" > "${totalFile}"`,
                `  echo "sha-$t" > "${greenShaFile}"`,
                `  echo "landed a PR"`,
                `  exit 0`,
                `fi`,
                // Pass 2: claims one more, lands nothing.
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `echo "claimed one issue, landed nothing"`,
                `exit 0`,
            ].join("\n")
        );
        // Bound of 1 — this test is about WHICH window the claim counts are
        // bracketed to, not about the streak (#3698), and a bound of 1 keeps
        // it to the two passes it was written around.
        const r = run({
            args: ["--claude-args", "x", "--max-consecutive-claims-held", "1"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=claims-held/);
        expect(passLogCount()).toBe(2);
        // pass 1's own log line must NOT itself read claims-held/no-progress
        // — it made real progress, so it carries the "-" placeholder.
        const lines = logLines();
        expect(lines[0].split(" ").pop()).toBe("-");
        expect(lines[1].split(" ").pop()).toBe("claims-held");
    });

    it("does NOT flag claims-held when claims already standing from before the window stay flat (review finding, #2626)", () => {
        // The companion test above ("only counts claims taken during THIS
        // pass's own window") starts every window at claims_before=0 — its
        // own pass 1 decrements the unclaimed and total counters in
        // lockstep, so `claims_before` is always 0 by the time pass 2 (the
        // one that matters) runs. That leaves the window's LOWER bound
        // itself unexercised: `claims_held_check "0" "$claims_after" 0`
        // (hardcoding the bound away) still passes the whole suite green.
        //
        // This test starts with 2 claims ALREADY standing from a prior,
        // unmodeled pass (unclaimed=3, total=5) and a `claude` stub that
        // changes nothing. The correct reading is `claims_before=2`,
        // `claims_after=2` — flat, not a rise — so this is ordinary
        // no-progress, never claims-held. Under the mutation above,
        // `claims_before` is forced to "0" regardless of the real value, so
        // `claimsHeld({claimsBefore: 0, claimsAfter: 2, merges: 0})` reads
        // true and this test goes red on pass 1 with `reason=claims-held`
        // instead of the correct `reason=no-progress` — exactly the
        // every-pass-reports-claims-held noise the AC forbids.
        stubGhTwoCounters(3, 5);
        stubClaudeNoProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=no-progress/);
        expect(r.stdout).not.toMatch(/reason=claims-held/);
    });
});

describe("dying with claims held is a bounded STREAK, not an instant stop (#3698)", () => {
    /** `claude` stub that dies the #3698 way on every pass: it claims one
     *  issue (the unclaimed count drops) and lands nothing (the total open
     *  count and green-sha never move), then exits 0 — which is what a pass
     *  killed with its own turn looks like from the outside. */
    const stubClaudeClaimsAndDies = (): void => {
        writeStub(
            "claude",
            [
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `echo "claimed one issue, then died holding it"`,
                `exit 0`,
            ].join("\n")
        );
    };

    it("starts the NEXT pass after the first pass dies holding a claim", () => {
        // The regression this closes. Before #3698 the first claims-held pass
        // stopped the whole run — deliberately, as urgent evidence — and the
        // commonest cause of it (a pre-PR gate promoted past the Bash tool's
        // 600s cap and killed with the turn) made that an instant stop on a
        // routine event: across 23 recorded runs the drain never exceeded 8
        // passes, median 3. One dead pass is evidence; it is not a reason to
        // abandon a queue of 200 issues.
        stubGhTwoCounters(9, 9);
        stubClaudeClaimsAndDies();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(passLogCount()).toBeGreaterThan(1);
        expect(logLines()[0].split(" ").pop()).toBe("claims-held-retry");
        expect(r.stderr).toMatch(/died holding claims \(consecutive 1\/3\)/);
    });

    it("stops after N consecutive such passes, with the reason that says they DIED", () => {
        // A run whose every pass dies still terminates — and the stop reason
        // must still tell "died holding claims" apart from "nothing to do",
        // which is why the per-pass retry reason is a DIFFERENT string from
        // the run's stop reason.
        stubGhTwoCounters(9, 9);
        stubClaudeClaimsAndDies();
        const r = run({
            args: ["--claude-args", "x", "--max-consecutive-claims-held", "2"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=claims-held/);
        expect(r.stdout).not.toMatch(/reason=no-progress/);
        expect(passLogCount()).toBe(2);
        expect(logLines().map((l) => l.split(" ").pop())).toEqual([
            "claims-held-retry",
            "claims-held",
        ]);
    });

    it("counts CONSECUTIVE deaths only — a pass that lands clears the streak", () => {
        // Same discipline as the crash streak: a flaky environment that
        // alternates death and progress must not accumulate its way to a
        // stop. With a bound of 2 and every other pass landing, the run never
        // reaches two in a row and ends on its pass ceiling instead.
        stubGhTwoCounters(9, 9);
        writeStub(
            "claude",
            [
                `STATE="${path.join(tmp, "call-count")}"`,
                `c=$(cat "$STATE" 2>/dev/null || echo 0)`,
                `c=$((c+1))`,
                `echo "$c" > "$STATE"`,
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                // Odd passes claim and die; even passes land (total drops,
                // green-sha moves).
                `if [ $((c % 2)) -eq 0 ]; then`,
                `  t=$(cat "${totalFile}" 2>/dev/null || echo 0)`,
                `  if [ "$t" -gt 0 ]; then t=$((t-1)); fi`,
                `  echo "$t" > "${totalFile}"`,
                `  echo "sha-$t" > "${greenShaFile}"`,
                `  echo "landed a PR"`,
                `else`,
                `  echo "claimed one issue, then died holding it"`,
                `fi`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-consecutive-claims-held",
                "2",
                "--max-passes",
                "4",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
        expect(logLines().map((l) => l.split(" ").pop())).toEqual([
            "claims-held-retry",
            "-",
            "claims-held-retry",
            "-",
        ]);
    });

    it("still terminates when passes ALTERNATE crash and death-holding-claims", () => {
        // The shape a naive mirror of the crash streak creates: if any
        // non-death cleared the claims streak and any non-crash cleared the
        // error streak, crash / death / crash / death resets both every pass
        // and reaches neither bound — and MAX_PASSES defaults to unlimited, so
        // that run never ends. Only PROGRESS forgives a death.
        stubGhTwoCounters(9, 9);
        writeStub(
            "claude",
            [
                `STATE="${path.join(tmp, "call-count")}"`,
                `c=$(cat "$STATE" 2>/dev/null || echo 0)`,
                `c=$((c+1))`,
                `echo "$c" > "$STATE"`,
                `if [ $((c % 2)) -eq 1 ]; then`,
                `  echo "boom"`,
                `  exit 1`,
                `fi`,
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `echo "claimed one issue, then died holding it"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-consecutive-claims-held",
                "2",
                "--error-backoff-secs",
                "1",
                "--max-passes",
                "12",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        // It stops on the CLAIMS bound, not on the pass ceiling — reaching
        // `max-passes` here would mean neither streak ever bit.
        expect(r.stdout).toMatch(/reason=claims-held/);
        expect(r.stdout).not.toMatch(/reason=max-passes/);
    });

    it("rejects a non-numeric --max-consecutive-claims-held at startup", () => {
        // Same reason every other numeric guard here is validated: `[ "abc"
        // -ge 3 ]` does not error, it returns false — turning a typo into a
        // streak that never ends rather than a visible failure.
        const r = run({
            args: ["--claude-args", "x", "--max-consecutive-claims-held", "x"],
        });
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/max-consecutive-claims-held/);
    });
});

describe("--max-passes", () => {
    it("stops after exactly N passes even when the queue never empties", () => {
        stubGhCountingFrom(1000);
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x", "--max-passes", "3"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
        expect(passLogCount()).toBe(3);
        expect(logLines()).toHaveLength(3);
    });
});

describe("progress — draining the queue to zero", () => {
    it("runs several passes and stops on queue-empty once the stub drains it", () => {
        stubGhCountingFrom(3);
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        expect(passLogCount()).toBe(3);
        expect(logLines()).toHaveLength(3);
    });
});

describe("one log line per pass", () => {
    it("each line has 9 whitespace-separated fields: epoch pass exit pct before after spent budget reason", () => {
        stubGhCountingFrom(2);
        stubClaudeProgress();
        run({ args: ["--claude-args", "x"] });
        const lines = logLines();
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(line.split(/\s+/)).toHaveLength(9);
        }
    });

    it("still has 9 fields when gh fails AFTER the pass (queue_after unreadable)", () => {
        // Reproduces the hole a re-review found: `queue_after=$(count_unclaimed
        // 2>/dev/null) || queue_after=""` had no default, unlike
        // `claude_exit`, which DOES get `is_uint "$claude_exit" || claude_exit=1`.
        // 2 pre-pass gh calls succeed (queue_before, total_before) so the
        // pass actually runs; every gh call after that fails, so
        // queue_after/total_after both come back unreadable.
        stubGhSucceedsPrePassFailsPostPass(2, 3);
        stubClaudeNoProgress();
        const r = run({ args: ["--claude-args", "x"] });
        const lines = logLines();
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(line.split(/\s+/)).toHaveLength(9);
        }
        // field 6 (0-indexed 5) is queue_after — must be the `-` placeholder,
        // never empty, when gh couldn't be read post-pass.
        const fields = lines[0].split(/\s+/);
        expect(fields[5]).toBe("-");
        // The run's NEXT pre-pass gh call also fails (the stub never
        // recovers), so the driver stops with gh-error on pass 2 — confirms
        // this is a genuine post-pass-only failure, not a stub that never
        // worked at all.
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=gh-error/);
    });
});

describe("--claude-args warning", () => {
    it("warns when --claude-args is omitted", () => {
        stubGhCountingFrom(0);
        const r = run({});
        expect(r.stderr).toMatch(/WARNING.*--claude-args is empty/s);
    });

    it("does NOT warn when --claude-args is provided", () => {
        stubGhCountingFrom(0);
        const r = run({
            args: ["--claude-args", "--dangerously-skip-permissions"],
        });
        expect(r.stderr).not.toMatch(/--claude-args is empty/);
    });
});
