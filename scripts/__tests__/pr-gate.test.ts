/**
 * The merge queue's two gates (issue #5637, ADR 0156 §3 and §8):
 * `trusted-author` and `base-health`, as `pr-gate.yml` posts them. Pure —
 * `scripts/pr-gate.ts` is the I/O.
 */
import { describe, expect, it } from "vitest";
import type { Lineage } from "../lib/health-verdict-store";
import { requeuePostedSinceDequeue } from "../lib/land-requeue";
import {
    BASE_HEALTH_CONTEXT,
    baseHealthStatus,
    clipDescription,
    gatePrOf,
    healthAdmission,
    heldPrAction,
    isMergifyQueuePr,
    needsRequeue,
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
                pr: pr({ body: "" }),
                repairIssues: [],
            });
            expect(s.context).toBe(BASE_HEALTH_CONTEXT);
            expect(s.state).toBe("success");
        }
    });

    it("is green with no verdict yet", () => {
        const s = baseHealthStatus({
            lineage: lineage("none"),
            pr: pr({ body: "" }),
            repairIssues: [],
        });
        expect(s.state).toBe("success");
        expect(s.description).toMatch(/no health verdict/);
    });

    it("under RED is red for a non-repair PR and names the declared repairs", () => {
        const s = baseHealthStatus({
            lineage: lineage("red"),
            pr: pr({ body: "Closes #12" }),
            repairIssues: [777],
        });
        expect(s.state).toBe("failure");
        expect(s.description).toMatch(/RED @ bbbbbbbb/);
        expect(s.description).toMatch(/#777/);
    });

    it("under RED is green for the declared repair", () => {
        const s = baseHealthStatus({
            lineage: lineage("red"),
            pr: pr({ body: "Closes #777" }),
            repairIssues: [777],
        });
        expect(s.state).toBe("success");
        expect(s.description).toMatch(/closes issue #777/);
    });

    it("a second RED holds a non-repair PR too", () => {
        const s = baseHealthStatus({
            lineage: lineage("second-red"),
            pr: pr({ body: "" }),
            repairIssues: [],
        });
        expect(s.state).toBe("failure");
        expect(s.description).toMatch(/second RED/);
        expect(s.description).toMatch(/no repair issue declared/);
    });

    it("a GREEN after the RED flips the same held PR back", () => {
        const input = { pr: pr({ body: "Closes #12" }), repairIssues: [777] };
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
            pr: pr({ body: "" }),
            repairIssues: [],
        });
        expect(s.state).toBe("pending");
        expect(s.description).toMatch(/unreadable/);
    });

    it("a Mergify queue draft is green under RED, second RED and an unreadable store (issue #5978)", () => {
        // Through `gatePrOf`, as `pr-gate.ts` builds it from the REST payload.
        const draft = gatePrOf(
            rest({
                user: { login: "mergify[bot]" },
                head: {
                    sha: "d".repeat(40),
                    ref: "mergify/merge-queue/1dcc8ee081",
                    repo: { full_name: REPO },
                },
            }),
            []
        );
        const lineages = [
            lineage("red"),
            lineage("second-red"),
            { kind: "none" as const, verdict: null, error: "HTTP 502" },
        ];
        for (const l of lineages) {
            const s = baseHealthStatus({
                lineage: l,
                pr: draft,
                repairIssues: [777],
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
                pr: p,
                repairIssues: [],
            });
            expect(s.state).toBe("failure");
        }
    });

    it("every description fits GitHub's 140 characters", () => {
        const s = baseHealthStatus({
            lineage: lineage("red"),
            pr: pr({ body: "" }),
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

describe("needsRequeue — the GREEN that releases a held PR (issue #6110)", () => {
    const held = {
        labels: ["ready-to-land"],
        prior: "failure" as const,
        next: "success" as const,
        trustedAuthor: "success" as const,
    };

    it("requeues a ready-to-land PR whose base-health went red → green", () => {
        expect(needsRequeue(held)).toBe(true);
        expect(needsRequeue({ ...held, prior: "pending" })).toBe(true);
    });

    it("does not repeat on a PR that simply waits its turn", () => {
        expect(needsRequeue({ ...held, prior: "success" })).toBe(false);
        expect(needsRequeue({ ...held, prior: undefined })).toBe(false);
    });

    it("stays out while the RED stands", () => {
        expect(needsRequeue({ ...held, next: "failure" })).toBe(false);
        expect(needsRequeue({ ...held, next: "pending" })).toBe(false);
    });

    it("leaves a repair pick, a queued PR and an unqueueable one alone", () => {
        const labels = (...l: string[]) => ({ ...held, labels: l });
        expect(needsRequeue(labels("ready-to-land", "land-failed"))).toBe(
            false
        );
        expect(needsRequeue(labels("ready-to-land", "queued"))).toBe(false);
        expect(needsRequeue(labels("enhancement"))).toBe(false);
        expect(needsRequeue({ ...held, trustedAuthor: "failure" })).toBe(false);
    });
});

describe("heldPrAction — a queue:held PR off RED (issue #6957)", () => {
    const held = {
        labels: ["ready-to-land", "queue:held"],
        lineage: { kind: "green" as const },
        baseHealth: "success" as const,
        trustedAuthor: "success" as const,
        requeuedSinceDequeue: () => false,
    };

    it("requeues a held PR whose base-health was already green — no transition needed — and keeps the label", () => {
        expect(heldPrAction(held)).toBe("requeue");
        expect(heldPrAction({ ...held, lineage: { kind: "amber" } })).toBe(
            "requeue"
        );
    });

    it("removes the label once the PR is queued again", () => {
        expect(
            heldPrAction({
                ...held,
                labels: [...held.labels, "queued"],
            })
        ).toBe("release");
    });

    it("removes the label when a requeue was already posted since the dequeue, or the PR cannot enter", () => {
        expect(
            heldPrAction({ ...held, requeuedSinceDequeue: () => true })
        ).toBe("release");
        expect(heldPrAction({ ...held, trustedAuthor: "failure" })).toBe(
            "release"
        );
        expect(
            heldPrAction({ ...held, labels: [...held.labels, "land-failed"] })
        ).toBe("release");
    });

    it("does nothing while the lineage blocks or cannot be read, nor on a PR not held", () => {
        expect(heldPrAction({ ...held, lineage: { kind: "red" } })).toBe(
            "none"
        );
        expect(heldPrAction({ ...held, lineage: { kind: "second-red" } })).toBe(
            "none"
        );
        expect(
            heldPrAction({
                ...held,
                lineage: { kind: "none", error: "502" },
            })
        ).toBe("none");
        expect(heldPrAction({ ...held, baseHealth: "pending" })).toBe("none");
        expect(heldPrAction({ ...held, labels: ["ready-to-land"] })).toBe(
            "none"
        );
    });

    it("reads the comments only when the answer decides", () => {
        let reads = 0;
        const counted = {
            ...held,
            requeuedSinceDequeue: () => {
                reads++;
                return false;
            },
        };
        heldPrAction({ ...counted, lineage: { kind: "red" } });
        heldPrAction({ ...counted, labels: [...held.labels, "queued"] });
        expect(reads).toBe(0);
    });
});

describe("requeuePostedSinceDequeue — one requeue per dequeue (issue #6957)", () => {
    const c = (login: string, body: string, createdAt: string) => ({
        author: { login },
        body,
        createdAt,
    });
    const dequeue = c(
        "mergify[bot]",
        "**merge queue: dequeued (`checks-failed`)**",
        "2026-10-25T14:48:00Z"
    );

    it("counts a requeue posted after the last dequeue", () => {
        expect(
            requeuePostedSinceDequeue([
                dequeue,
                c(
                    "github-actions[bot]",
                    "@mergifyio requeue",
                    "2026-10-25T15:00:00Z"
                ),
            ])
        ).toBe(true);
    });

    it("ignores one older than the last dequeue", () => {
        expect(
            requeuePostedSinceDequeue([
                c(
                    "github-actions[bot]",
                    "@mergifyio requeue",
                    "2026-10-25T14:00:00Z"
                ),
                dequeue,
            ])
        ).toBe(false);
        expect(requeuePostedSinceDequeue([dequeue])).toBe(false);
    });
});
