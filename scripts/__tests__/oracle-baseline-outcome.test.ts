/**
 * `baselineOutcome` — the state-regression guard's git wrapper (issue #2696).
 *
 * This is where the guard was broken. The first cut wrapped every git call in
 * one `try { ... } catch { return null }`, so "there is no other commit to
 * compare against" and "the comparison itself failed" arrived as the same
 * value, and both printed a green skip line: with `git` absent from `PATH` the
 * check exited 0 while guarding nothing (review of PR #3150, finding 1).
 *
 * So the runner is injected and every branch has a fixture. A guard whose only
 * evidence is "it did not fire on the tree we happen to have" is a guard
 * nobody has ever seen work — and that applies to the wrapper exactly as much
 * as to the comparison it wraps.
 */

import { describe, it, expect } from "vitest";
import { ORIGIN_BASE } from "../lib/branches";
import {
    baselineOutcome,
    type GitResult,
    type GitRunner,
} from "../check-oracle-lockfile";

const ok = (out: string): GitResult => ({ ok: true, out });
const no = (error: string): GitResult => ({ ok: false, error });

const LOCKFILE = JSON.stringify({
    generator: "test",
    header: {},
    formats: {},
    fragments: [],
    cards: [{ oracleId: "id-a", name: "Smother", state: "ready" }],
});

/**
 * A runner that answers the happy path, with named steps overridable — so each
 * test states the ONE thing that went wrong and inherits the rest.
 */
function runner(overrides: Partial<Record<string, GitResult>> = {}): GitRunner {
    const seen: string[] = [];
    const fake: GitRunner = (args) => {
        const step = args[0] ?? "";
        seen.push(args.join(" "));
        const override = overrides[step];
        if (override !== undefined) return override;
        switch (step) {
            case "rev-parse":
                return ok("true\n");
            case "merge-base":
                return ok("abc123\n");
            case "cat-file":
                return ok("");
            case "show":
                return ok(LOCKFILE);
            default:
                return no(`unexpected git ${step}`);
        }
    };
    (fake as GitRunner & { seen: string[] }).seen = seen;
    return fake;
}

describe("baselineOutcome — the happy path", () => {
    it("returns the parsed baseline lockfile", () => {
        const outcome = baselineOutcome(runner());
        expect(outcome.kind).toBe("lockfile");
        if (outcome.kind !== "lockfile") return;
        expect(outcome.lock.cards.map((c) => c.name)).toEqual(["Smother"]);
    });

    it("reads the lockfile at the MERGE-BASE, not at the base tip", () => {
        // A branch behind the base branch must not be judged against commits it
        // has not merged: the merge-base is the last state both share, so work
        // that landed on the base since is not attributed to this PR.
        const git = runner();
        baselineOutcome(git);
        const calls = (git as GitRunner & { seen: string[] }).seen;
        expect(calls).toContain(`merge-base HEAD ${ORIGIN_BASE}`);
        expect(calls).toContain("show abc123:data/oracle-compiled.json");
    });
});

describe("baselineOutcome — legitimately nothing to compare (skip)", () => {
    it("is `unavailable` outside a git work tree", () => {
        const outcome = baselineOutcome(
            runner({ "rev-parse": no("not a git repository") })
        );
        expect(outcome.kind).toBe("unavailable");
    });

    it("is `unavailable` when the base ref was never fetched", () => {
        // Both probes are `rev-parse`; the second one is the ref check, so this
        // fixture answers the work-tree probe and fails the ref probe.
        let call = 0;
        const git: GitRunner = (args) => {
            if (args[0] === "rev-parse")
                return ++call === 1 ? ok("true\n") : no("");
            return ok("");
        };
        const outcome = baselineOutcome(git);
        expect(outcome.kind).toBe("unavailable");
        if (outcome.kind !== "unavailable") return;
        expect(outcome.why).toContain(ORIGIN_BASE);
    });

    it("is `unavailable` when the merge-base predates the lockfile", () => {
        const outcome = baselineOutcome(
            runner({ "cat-file": no("Not a valid object name") })
        );
        expect(outcome.kind).toBe("unavailable");
        if (outcome.kind !== "unavailable") return;
        expect(outcome.why).toContain("does not exist at the merge-base");
    });
});

describe("baselineOutcome — the comparison BROKE (red, never a skip)", () => {
    it("is `broken` when merge-base fails", () => {
        const outcome = baselineOutcome(
            runner({ "merge-base": no("fatal: refusing to work") })
        );
        expect(outcome.kind).toBe("broken");
        if (outcome.kind !== "broken") return;
        expect(outcome.detail).toContain("fatal: refusing to work");
    });

    it("is `broken` when `git show` fails even though the blob exists", () => {
        // `cat-file -e` said the path is there, so a failing `show` is a real
        // fault (a buffer overrun, a corrupt object) — not an absent baseline.
        const outcome = baselineOutcome(
            runner({ show: no("stdout maxBuffer length exceeded") })
        );
        expect(outcome.kind).toBe("broken");
        if (outcome.kind !== "broken") return;
        expect(outcome.detail).toContain("maxBuffer");
    });

    it("is `broken` when the baseline lockfile does not parse", () => {
        // The schema-rewrite moment: exactly when a real regression is most
        // likely, and exactly when the old code went green.
        const outcome = baselineOutcome(runner({ show: ok("{ not json") }));
        expect(outcome.kind).toBe("broken");
        if (outcome.kind !== "broken") return;
        expect(outcome.detail).toContain("does not parse");
    });

    it("never reports `unavailable` for a failure AFTER the ref probes", () => {
        for (const broken of ["merge-base", "show"] as const) {
            const outcome = baselineOutcome(runner({ [broken]: no("boom") }));
            expect(outcome.kind).not.toBe("unavailable");
        }
    });
});
