// Detach a landed issue from its band umbrella (issue #4235). The decision is
// pure over an injected edge reader/remover, so every branch runs without `gh`.

import { describe, expect, it } from "vitest";
import {
    censusedUmbrellas,
    describeOutcome,
    describeSweepResult,
    detachFromUmbrella,
    makeDetachDeps,
    sweepUmbrellas,
    type DetachDeps,
    type IssueEdge,
    type SweepDeps,
} from "../lib/umbrella-detach";

const P0_GRAMMAR = 4091;

/** A fake tracker: one issue whose edge the removal really mutates. */
function tracker(initial: IssueEdge, opts: { removeIsNoop?: boolean } = {}) {
    let edge = initial;
    const removed: Array<[number, number]> = [];
    const deps: DetachDeps = {
        readIssue: () => edge,
        removeSubIssue: (parent, childId) => {
            removed.push([parent, childId]);
            if (!opts.removeIsNoop) edge = { ...edge, parent: null };
        },
    };
    return { deps, removed };
}

describe("censusedUmbrellas — the live partition", () => {
    it("holds every band umbrella and every kind fallback, nothing else", () => {
        const census = censusedUmbrellas();
        for (const n of [
            4091, 4094, 4095, 4098, 4099, 4102, 4241, 4242, 4243, 4244, 4111,
            4112,
        ])
            expect(census.has(n)).toBe(true);
        // Retired umbrellas are being emptied by `gaps:sync`, not by this step.
        expect(census.has(3972)).toBe(false);
        expect(census.has(3820)).toBe(false);
        expect(census.has(4113)).toBe(false);
        // Four families of four umbrellas (P0 + three Targets), plus the two
        // kinds with no family.
        expect(census.size).toBe(16 + 2);
    });
});

describe("detachFromUmbrella (issue #4235)", () => {
    it("removes a CLOSED child of a censused umbrella, by its database id", () => {
        const { deps, removed } = tracker({
            id: 5506,
            state: "closed",
            parent: P0_GRAMMAR,
        });
        expect(detachFromUmbrella(4140, deps)).toEqual({
            kind: "detached",
            parent: P0_GRAMMAR,
        });
        expect(removed).toEqual([[P0_GRAMMAR, 5506]]);
    });

    it("never detaches an OPEN issue — a failed `Closes` keyword must not drop live work", () => {
        const { deps, removed } = tracker({
            id: 1,
            state: "open",
            parent: P0_GRAMMAR,
        });
        expect(detachFromUmbrella(4140, deps)).toEqual({
            kind: "open",
            parent: P0_GRAMMAR,
        });
        expect(removed).toEqual([]);
    });

    it("leaves a closed child of a NON-censused parent alone", () => {
        const { deps, removed } = tracker({
            id: 1,
            state: "closed",
            parent: 3791,
        });
        expect(detachFromUmbrella(4140, deps)).toEqual({
            kind: "not-censused",
            parent: 3791,
        });
        expect(removed).toEqual([]);
    });

    it("leaves a closed issue with no parent alone", () => {
        const { deps, removed } = tracker({
            id: 1,
            state: "closed",
            parent: null,
        });
        expect(detachFromUmbrella(4140, deps)).toEqual({ kind: "no-parent" });
        expect(removed).toEqual([]);
    });

    it("is idempotent: the second run finds no parent and removes nothing", () => {
        const { deps, removed } = tracker({
            id: 9,
            state: "closed",
            parent: P0_GRAMMAR,
        });
        detachFromUmbrella(4140, deps);
        expect(detachFromUmbrella(4140, deps)).toEqual({ kind: "no-parent" });
        expect(removed).toHaveLength(1);
    });

    it("reads the edge back: a removal that changed nothing is a failure, not a success", () => {
        const { deps } = tracker(
            { id: 9, state: "closed", parent: P0_GRAMMAR },
            { removeIsNoop: true }
        );
        const outcome = detachFromUmbrella(4140, deps);
        expect(outcome.kind).toBe("failed");
        expect(describeOutcome(4140, outcome)).toMatch(/still under #4091/);
    });

    it("is non-gating: a throwing read or write is an outcome, never a throw", () => {
        const reads: DetachDeps = {
            readIssue: () => {
                throw new Error("HTTP 502");
            },
            removeSubIssue: () => {},
        };
        expect(detachFromUmbrella(4140, reads).kind).toBe("failed");
        const writes: DetachDeps = {
            readIssue: () => ({ id: 1, state: "closed", parent: P0_GRAMMAR }),
            removeSubIssue: () => {
                throw new Error("HTTP 403");
            },
        };
        const outcome = detachFromUmbrella(4140, writes);
        expect(outcome.kind).toBe("failed");
        expect(describeOutcome(4140, outcome)).toMatch(/HTTP 403/);
    });

    it("names the command to re-run for an issue still open", () => {
        expect(
            describeOutcome(4140, { kind: "open", parent: P0_GRAMMAR })
        ).toContain("bun run umbrella:detach 4140");
    });
});

/** A fake tracker of many issues, keyed by number; database id = number + 1e6. */
function board(
    edges: Record<number, { state: "open" | "closed"; parent: number | null }>
) {
    const state = new Map(
        Object.entries(edges).map(([n, e]) => [Number(n), { ...e }])
    );
    const removed: Array<[number, number]> = [];
    const deps: SweepDeps = {
        listChildren: (umbrella) =>
            [...state]
                .filter(([, e]) => e.parent === umbrella)
                .map(([number, e]) => ({ number, state: e.state })),
        readIssue: (issue) => {
            const e = state.get(issue)!;
            return { id: issue + 1e6, state: e.state, parent: e.parent };
        },
        removeSubIssue: (parent, childId) => {
            removed.push([parent, childId]);
            state.get(childId - 1e6)!.parent = null;
        },
    };
    return { deps, removed, state };
}

describe("sweepUmbrellas (issue #5081)", () => {
    const census = new Set([4099, 4241]);

    it("detaches every CLOSED child of every censused umbrella, leaving open ones listed", () => {
        // The shape measured 2026-10-05: gaps:sync closed these, no branch named them.
        const { deps, removed, state } = board({
            4836: { state: "closed", parent: 4099 },
            4837: { state: "closed", parent: 4099 },
            4825: { state: "open", parent: 4099 },
            4321: { state: "closed", parent: 4241 },
        });
        const results = sweepUmbrellas(deps, census);
        expect(removed).toEqual([
            [4099, 4836 + 1e6],
            [4099, 4837 + 1e6],
            [4241, 4321 + 1e6],
        ]);
        expect(
            results.map((r) => ("issue" in r ? r.outcome.kind : "list"))
        ).toEqual(["detached", "detached", "detached"]);
        expect(state.get(4825)!.parent).toBe(4099);
    });

    it("never touches a child of a parent outside the census", () => {
        const { deps, removed } = board({
            100: { state: "closed", parent: 3791 },
        });
        expect(sweepUmbrellas(deps, census)).toEqual([]);
        expect(removed).toEqual([]);
    });

    it("re-reads each nominee: a child listed closed but read open is not detached", () => {
        const { deps, removed } = board({ 7: { state: "open", parent: 4099 } });
        const lying: SweepDeps = {
            ...deps,
            listChildren: () => [{ number: 7, state: "closed" }],
        };
        const results = sweepUmbrellas(lying, new Set([4099]));
        expect(results).toEqual([
            {
                umbrella: 4099,
                issue: 7,
                outcome: { kind: "open", parent: 4099 },
            },
        ]);
        expect(removed).toEqual([]);
    });

    it("is non-gating: an umbrella whose listing throws is a result, and the sweep moves on", () => {
        const { deps, removed } = board({
            4321: { state: "closed", parent: 4241 },
        });
        const flaky: SweepDeps = {
            ...deps,
            listChildren: (u) => {
                if (u === 4099) throw new Error("HTTP 502");
                return deps.listChildren(u);
            },
        };
        const results = sweepUmbrellas(flaky, census);
        expect(describeSweepResult(results[0]!)).toMatch(/#4099.*HTTP 502/);
        expect(removed).toEqual([[4241, 4321 + 1e6]]);
    });

    it("is idempotent: a second sweep finds nothing closed left to detach", () => {
        const { deps, removed } = board({
            4321: { state: "closed", parent: 4241 },
        });
        sweepUmbrellas(deps, census);
        expect(sweepUmbrellas(deps, census)).toEqual([]);
        expect(removed).toHaveLength(1);
    });
});

describe("makeDetachDeps — the shape of the real gh calls (issue #4235)", () => {
    /** A `gh` that records its argv and answers with a canned payload. */
    function fakeGh(answer: string) {
        const calls: string[][] = [];
        return {
            calls,
            gh: (args: string[]) => {
                calls.push(args);
                return answer;
            },
        };
    }

    it("reads id, state and the parent NUMBER off parent_issue_url", () => {
        const { gh, calls } = fakeGh(
            JSON.stringify({
                id: 5506076630,
                state: "closed",
                parent_issue_url:
                    "https://api.github.com/repos/fil-donadoni/tolaria/issues/4099",
            })
        );
        expect(makeDetachDeps(gh).readIssue(4157)).toEqual({
            id: 5506076630,
            state: "closed",
            parent: 4099,
        });
        expect(calls[0]).toEqual([
            "api",
            "repos/{owner}/{repo}/issues/4157",
            "--jq",
            "{id, state, parent_issue_url}",
        ]);
    });

    it("reads a null parent_issue_url as no parent", () => {
        const { gh } = fakeGh(
            JSON.stringify({ id: 1, state: "open", parent_issue_url: null })
        );
        expect(makeDetachDeps(gh).readIssue(1).parent).toBeNull();
    });

    it("refuses a payload it does not understand rather than reading it as closed", () => {
        const { gh } = fakeGh(JSON.stringify({ id: 1, state: "merged" }));
        expect(() => makeDetachDeps(gh).readIssue(1)).toThrow(
            /unexpected issue payload/
        );
    });

    it("lists an umbrella's children over every page, one JSON object per line", () => {
        const { gh, calls } = fakeGh(
            '{"number":4836,"state":"closed"}\n{"number":4825,"state":"open"}\n'
        );
        expect(makeDetachDeps(gh).listChildren(4099)).toEqual([
            { number: 4836, state: "closed" },
            { number: 4825, state: "open" },
        ]);
        expect(calls[0]).toEqual([
            "api",
            "--paginate",
            "repos/{owner}/{repo}/issues/4099/sub_issues?per_page=100",
            "--jq",
            ".[] | {number, state}",
        ]);
    });

    it("refuses a sub-issue row it does not understand rather than skipping it", () => {
        const { gh } = fakeGh('{"number":1,"state":"merged"}\n');
        expect(() => makeDetachDeps(gh).listChildren(4099)).toThrow(
            /unexpected sub-issue payload/
        );
    });

    it("removes by DELETE on the PARENT's sub_issue endpoint with the child's database id", () => {
        const { gh, calls } = fakeGh("");
        makeDetachDeps(gh).removeSubIssue(4099, 5506076630);
        expect(calls[0]).toEqual([
            "api",
            "--method",
            "DELETE",
            "repos/{owner}/{repo}/issues/4099/sub_issue",
            "-F",
            "sub_issue_id=5506076630",
        ]);
    });
});
