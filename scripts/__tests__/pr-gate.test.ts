/**
 * The merge queue's two gates (issue #5637, ADR 0156 §3 and §8):
 * `trusted-author` and `base-health`, as `pr-gate.yml` posts them. Pure —
 * `scripts/pr-gate.ts` is the I/O.
 */
import { describe, expect, it } from "vitest";
import type { Lineage } from "../lib/health-verdict-store";
import {
    BASE_HEALTH_CONTEXT,
    baseHealthStatus,
    clipDescription,
    gatePrOf,
    healthAdmission,
    isMergifyQueuePr,
    parseTrustedAuthors,
    protectedPaths,
    queuedPrs,
    TRUSTED_AUTHOR_CONTEXT,
    trustedAuthorStatus,
    type GatePr,
    type RestPr,
} from "../lib/pr-gate";

const REPO = "fil-donadoni/tolaria";

const pr = (over: Partial<GatePr> = {}): GatePr => ({
    number: 42,
    author: "fil-donadoni",
    body: "",
    headSha: "a".repeat(40),
    headRef: "feat/issue-42",
    headRepo: REPO,
    baseRepo: REPO,
    files: ["scripts/lib/x.ts"],
    ...over,
});

const TRUSTED = ["fil-donadoni"];

describe("parseTrustedAuthors — the TRUSTED_AUTHORS repository variable", () => {
    it("splits on commas and whitespace, drops `@`, lowercases", () => {
        expect(parseTrustedAuthors(" Fil-Donadoni, @other\nthird ")).toEqual([
            "fil-donadoni",
            "other",
            "third",
        ]);
    });

    it("an unset or empty variable trusts nobody", () => {
        expect(parseTrustedAuthors(undefined)).toEqual([]);
        expect(parseTrustedAuthors(" , ")).toEqual([]);
    });
});

describe("trusted-author", () => {
    it("is green for a trusted author, case-insensitively", () => {
        const s = trustedAuthorStatus(pr({ author: "Fil-Donadoni" }), TRUSTED);
        expect(s.context).toBe(TRUSTED_AUTHOR_CONTEXT);
        expect(s.state).toBe("success");
    });

    it("is red for an author outside TRUSTED_AUTHORS", () => {
        const s = trustedAuthorStatus(pr({ author: "outsider" }), TRUSTED);
        expect(s.state).toBe("failure");
        expect(s.description).toMatch(/@outsider is not in TRUSTED_AUTHORS/);
    });

    it("is red for everyone when the variable is empty", () => {
        expect(trustedAuthorStatus(pr(), []).state).toBe("failure");
    });

    it("is red for a trusted author whose PR touches .github/", () => {
        const s = trustedAuthorStatus(
            pr({ files: ["src/a.ts", ".github/workflows/pr-gate.yml"] }),
            TRUSTED
        );
        expect(s.state).toBe("failure");
        expect(s.description).toMatch(/\.github\/workflows\/pr-gate\.yml/);
        expect(
            trustedAuthorStatus(
                pr({
                    files: [".github/a.yml", ".github/b.yml", ".mergify.yml"],
                }),
                TRUSTED
            ).description
        ).toMatch(/\.github\/a\.yml \(\+2 more\)/);
        expect(s.description).toMatch(/owner merges it by hand/);
    });

    it("is red for a PR touching Mergify's other config directory", () => {
        expect(
            trustedAuthorStatus(pr({ files: [".mergify/config.yml"] }), TRUSTED)
                .state
        ).toBe("failure");
    });

    it("is red when the file list is truncated — it proves nothing", () => {
        const s = trustedAuthorStatus(
            pr({ files: ["a.ts"], changedFiles: 3500 }),
            TRUSTED
        );
        expect(s.state).toBe("failure");
        expect(s.description).toMatch(/truncated \(1 of 3500\)/);
        expect(
            trustedAuthorStatus(
                pr({ files: ["a.ts"], changedFiles: 1 }),
                TRUSTED
            ).state
        ).toBe("success");
    });

    it("never echoes a control character from a path", () => {
        const s = trustedAuthorStatus(
            pr({ files: [".github/x\n::error::forged"] }),
            TRUSTED
        );
        expect(s.description).not.toMatch(/[\n\r]/);
    });

    it("is red for a PR touching .mergify.yml", () => {
        const s = trustedAuthorStatus(pr({ files: [".mergify.yml"] }), TRUSTED);
        expect(s.state).toBe("failure");
    });

    it("exempts Mergify's own queue PR, which is no trusted author", () => {
        const queue = pr({
            author: "mergify[bot]",
            headRef: "mergify/merge-queue/0123abcd",
        });
        expect(trustedAuthorStatus(queue, TRUSTED).state).toBe("success");
    });

    it("never exempts a lookalike: a fork's branch, or a human on the queue's prefix", () => {
        expect(
            isMergifyQueuePr(
                pr({
                    author: "mergify[bot]",
                    headRef: "mergify/merge-queue/x",
                    headRepo: "outsider/tolaria",
                })
            )
        ).toBe(false);
        expect(
            trustedAuthorStatus(
                pr({ author: "outsider", headRef: "mergify/merge-queue/x" }),
                TRUSTED
            ).state
        ).toBe("failure");
    });
});

describe("protectedPaths", () => {
    it("names .github/ and .mergify.yml paths only — never a lookalike", () => {
        expect(
            protectedPaths([
                ".github/actions/job-setup/action.yml",
                "src/.github/notes.ts",
                ".mergify.yml",
                "a/.mergify.yml",
                ".github-like/x",
            ])
        ).toEqual([".github/actions/job-setup/action.yml", ".mergify.yml"]);
    });
});

const RED_SHA = "b".repeat(40);
const lineage = (kind: Lineage["kind"]): Lineage => ({
    kind,
    verdict:
        kind === "none"
            ? null
            : { sha: RED_SHA, status: kind === "second-red" ? "red" : kind },
});

describe("healthAdmission — the land-runner's RED rule, extracted", () => {
    it("admits everything off RED", () => {
        expect(
            healthAdmission({ red: false, prBody: "", repairIssues: [] })
        ).toEqual({ admit: true, repairOf: null });
    });

    it("under RED admits only a PR closing a declared repair issue", () => {
        expect(
            healthAdmission({
                red: true,
                prBody: "Fixes #777",
                repairIssues: [777],
            })
        ).toEqual({ admit: true, repairOf: 777 });
        expect(
            healthAdmission({
                red: true,
                prBody: "Closes #12",
                repairIssues: [777],
            })
        ).toEqual({ admit: false });
    });
});

describe("base-health", () => {
    it("is green on a GREEN or AMBER lineage, whatever the PR", () => {
        for (const kind of ["green", "amber"] as const) {
            const s = baseHealthStatus({
                lineage: lineage(kind),
                prBody: "",
                repairIssues: [],
            });
            expect(s.context).toBe(BASE_HEALTH_CONTEXT);
            expect(s.state).toBe("success");
        }
    });

    it("is green with no verdict yet", () => {
        const s = baseHealthStatus({
            lineage: lineage("none"),
            prBody: "",
            repairIssues: [],
        });
        expect(s.state).toBe("success");
        expect(s.description).toMatch(/no health verdict/);
    });

    it("under RED is red for a non-repair PR and names the declared repairs", () => {
        const s = baseHealthStatus({
            lineage: lineage("red"),
            prBody: "Closes #12",
            repairIssues: [777],
        });
        expect(s.state).toBe("failure");
        expect(s.description).toMatch(/RED @ bbbbbbbb/);
        expect(s.description).toMatch(/#777/);
    });

    it("under RED is green for the declared repair", () => {
        const s = baseHealthStatus({
            lineage: lineage("red"),
            prBody: "Closes #777",
            repairIssues: [777],
        });
        expect(s.state).toBe("success");
        expect(s.description).toMatch(/closes issue #777/);
    });

    it("a second RED holds a non-repair PR too", () => {
        const s = baseHealthStatus({
            lineage: lineage("second-red"),
            prBody: "",
            repairIssues: [],
        });
        expect(s.state).toBe("failure");
        expect(s.description).toMatch(/second RED/);
        expect(s.description).toMatch(/no repair issue declared/);
    });

    it("a GREEN after the RED flips the same held PR back", () => {
        const input = { prBody: "Closes #12", repairIssues: [777] };
        expect(
            baseHealthStatus({ ...input, lineage: lineage("red") }).state
        ).toBe("failure");
        expect(
            baseHealthStatus({ ...input, lineage: lineage("green") }).state
        ).toBe("success");
    });

    it("an unreadable store holds the PR pending — never a green that outlives the outage", () => {
        const s = baseHealthStatus({
            lineage: { kind: "none", verdict: null, error: "HTTP 502" },
            prBody: "",
            repairIssues: [],
        });
        expect(s.state).toBe("pending");
        expect(s.description).toMatch(/unreadable/);
    });

    it("a Mergify queue draft is green under RED, second RED and an unreadable store (issue #5978)", () => {
        const draft = pr({
            author: "mergify[bot]",
            headRef: "mergify/merge-queue/1dcc8ee081",
            body: "",
        });
        const lineages = [
            lineage("red"),
            lineage("second-red"),
            { kind: "none" as const, verdict: null, error: "HTTP 502" },
        ];
        for (const l of lineages) {
            const s = baseHealthStatus({
                lineage: l,
                prBody: draft.body,
                repairIssues: [777],
                queuePr: isMergifyQueuePr(draft),
            });
            expect(s.state).toBe("success");
            expect(s.description).toMatch(/Mergify queue PR/);
        }
    });

    it("a queue-draft lookalike is still judged on health", () => {
        const lookalikes = [
            pr({ headRef: "mergify/merge-queue/x" }),
            pr({ author: "mergify[bot]", headRef: "feat/x" }),
            pr({
                author: "mergify[bot]",
                headRef: "mergify/merge-queue/x",
                headRepo: "someone/tolaria",
            }),
        ];
        for (const p of lookalikes) {
            const s = baseHealthStatus({
                lineage: lineage("red"),
                prBody: "",
                repairIssues: [],
                queuePr: isMergifyQueuePr(p),
            });
            expect(s.state).toBe("failure");
        }
    });

    it("every description fits GitHub's 140 characters", () => {
        const s = baseHealthStatus({
            lineage: lineage("red"),
            prBody: "",
            repairIssues: Array.from({ length: 40 }, (_, i) => 1000 + i),
        });
        expect(s.description.length).toBeLessThanOrEqual(140);
        expect(clipDescription("x".repeat(200))).toHaveLength(140);
    });
});

const rest = (over: Partial<RestPr> = {}): RestPr => ({
    number: 7,
    user: { login: "fil-donadoni" },
    body: null,
    head: { sha: "c".repeat(40), ref: "feat/x", repo: { full_name: REPO } },
    base: { repo: { full_name: REPO } },
    labels: [],
    ...over,
});

describe("the REST pull_request, read", () => {
    it("gatePrOf maps the payload; a null body is empty, a deleted fork no repo", () => {
        const g = gatePrOf(
            rest({ head: { sha: "d".repeat(40), ref: "x", repo: null } }),
            ["a.ts"]
        );
        expect(g).toMatchObject({
            number: 7,
            author: "fil-donadoni",
            body: "",
            headSha: "d".repeat(40),
            headRepo: "",
            baseRepo: REPO,
            files: ["a.ts"],
        });
        expect(isMergifyQueuePr(g)).toBe(false);
    });

    it("queuedPrs keeps only the ready-to-land PRs a re-gate covers", () => {
        const prs = [
            rest({ number: 1, labels: [{ name: "ready-to-land" }] }),
            rest({ number: 2, labels: [{ name: "land-failed" }] }),
            rest({ number: 3, labels: undefined }),
        ];
        expect(queuedPrs(prs).map((p) => p.number)).toEqual([1]);
    });
});
