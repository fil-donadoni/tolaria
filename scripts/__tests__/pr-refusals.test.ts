import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    computeSkinReceiptInvalid,
    safeSkinReceiptInvalid,
    skinReceiptInvalidForDiff,
    isTestOnlySrcDiff,
} from "../lib/pr-refusals";
import { BASE_BRANCH, ORIGIN_BASE } from "../lib/branches";
import { inertClassifyLane } from "./lane-inert-sources.helper";
import type { UiScope } from "../lib/ui-scope";
import {
    classifyScenarioSection,
    owesScenario,
    scenarioRefusal,
} from "../lib/scenario-block";
import { UNWALKED_SURFACES, type Readings } from "../ui-gate/floors.ts";
import {
    DIAGNOSTIC_SEPARATOR,
    diagnosticLines,
    evaluateRun,
    verdictBlockLines,
    zeroReadings,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import { SURFACES, SURFACE_IDS } from "../ui-gate/surfaces.ts";
import { assertLabelsBySurface } from "../ui-gate/assertions.ts";
import { VIEWPORT_IDS } from "../ui-gate/viewports.ts";
import {
    LANE_VOCABULARY,
    landingDiffScope,
    landingWalkOwed,
} from "../ui-gate/verify-receipt.ts";
import { revertPrBody } from "../lib/health-ladder";

/** The Named Assertions the real surface table declares (issue #3649). */
const PROMISED = assertLabelsBySurface(SURFACES);

/** The viewports each surface owes — the lane's own rule (ADR 0168). */
const viewportsOf = (surface: string): readonly string[] =>
    LANE_VOCABULARY.viewportsOf?.(surface) ?? VIEWPORT_IDS;

/**
 * What `check:ui` prints for `surfaces` (null = every surface, a full RECEIPT;
 * otherwise the SCOPED run of that scope) over the REAL surface table, viewport
 * matrix and declared-unwalked list, rendered by the real evaluator exactly as
 * the lane renders it — verdict block, separator, diagnostic block. `at` sets
 * one cell's readings; `facts` stands in for the run's own diagnostic lines.
 *
 * The cells are the ones the lane WALKS (ADR 0168, issue #8321): the DPR 1
 * desktop viewport is owed only by a surface that draws printed card faces,
 * so the fixture reads the per-surface viewport list from the same
 * `LANE_VOCABULARY` the re-derivation reads — a row for every viewport on
 * every surface is a receipt no run can print.
 *
 * Every Named Assertion the real table declares is reported kept (issue
 * #3649): these receipts stand for GREEN runs, and a green run keeps its
 * promises. A cell that simply omitted them would be a receipt `land` refuses
 * for missing the lines its scope owes — which is the point of that check, not
 * a property of the lane being modelled here.
 */
function laneReceipt(
    surfaces: readonly string[] | null,
    opts: {
        at?: (surface: string, viewport: string) => Readings | undefined;
        facts?: string[];
    } = {}
): string {
    const known = surfaces ?? SURFACE_IDS;
    const unwalked = new Set(UNWALKED_SURFACES.map((u) => u.surface));
    const walks: SurfaceWalk[] = known
        .filter((surface) => !unwalked.has(surface))
        .map((surface) => ({
            surface,
            status: "measured",
            measurements: viewportsOf(surface).map((viewport) => ({
                viewport,
                readings: opts.at?.(surface, viewport) ?? zeroReadings(),
                asserts: (PROMISED[surface] ?? []).map((label) => ({
                    label,
                    ok: true,
                    detail: "",
                })),
            })),
        }));
    const ev = evaluateRun({
        knownSurfaceIds: known,
        walks,
        definedSurfaceIds: SURFACE_IDS,
        viewportIds: VIEWPORT_IDS,
        viewportsOf,
        unwalked: UNWALKED_SURFACES,
        diffScope: surfaces ? { base: ORIGIN_BASE, surfaces } : null,
        assertsBySurface: PROMISED,
    });
    return [
        "```",
        ...verdictBlockLines(ev),
        DIAGNOSTIC_SEPARATOR,
        ...diagnosticLines(ev),
        ...(opts.facts ?? []),
        "```",
    ].join("\n");
}

describe("pr-refusals — computeSkinReceiptInvalid (issue #2760 review, finding 3)", () => {
    // The PR that introduced this function claimed it was "tested directly"
    // — it was not: `grep -rn computeSkinReceiptInvalid scripts/` returned
    // only the definition and its one call site. Deleting the
    // `lane === "skin" &&` guard left the receipt check firing on every
    // lane, which would make `land` refuse EVERY engine/full landing (the
    // merge-train dies). These tests exercise the function directly, per
    // this file's own convention.

    it("is false for a non-skin lane, regardless of the receipt body", () => {
        expect(
            computeSkinReceiptInvalid("engine", "garbage, not a receipt")
        ).toBe(false);
        expect(
            computeSkinReceiptInvalid("full", "garbage, not a receipt")
        ).toBe(false);
    });

    it("is true for a skin lane whose receipt is garbage/invalid", () => {
        expect(
            computeSkinReceiptInvalid("skin", "garbage, not a receipt")
        ).toBe(true);
    });

    it("is false for a skin lane whose receipt actually verifies clean", () => {
        // A REAL full walk over the real surface table and viewport matrix,
        // every Floor at zero, rendered through the real functions exactly as
        // `check:ui` would — under `verifyReceiptText`'s defaults, which
        // `computeSkinReceiptInvalid` uses.
        expect(
            computeSkinReceiptInvalid(
                "skin",
                `Closes #2760\n\n${laneReceipt(null)}`
            )
        ).toBe(false);
    });

    it("refuses a skin PR whose receipt carries a FAIL line (ADR 0132 §6)", () => {
        const [first] = SURFACE_IDS.filter(
            (id) => !UNWALKED_SURFACES.some((u) => u.surface === id)
        );
        const body = laneReceipt(null, {
            at: (surface, viewport) =>
                surface === first && viewport === VIEWPORT_IDS[1]
                    ? { ...zeroReadings(), cardsZero: 1 }
                    : undefined,
        });
        expect(body).toMatch(/^FAIL {5}/m);
        expect(computeSkinReceiptInvalid("skin", body)).toBe(true);
    });

    it("accepts a receipt whose diagnostic block differs from a re-run — land never reads it", () => {
        const run1 = laneReceipt(null, {
            at: () => ({ ...zeroReadings(), cardsOcc: 1, small: 24 }),
            facts: ["machine load: start 3.1, end 4.0", "wall time: 212s"],
        });
        const run2 = laneReceipt(null, {
            at: () => ({ ...zeroReadings(), cardsOcc: 5, starved: 2 }),
            facts: ["machine load: start 19.7, end 22.3", "wall time: 388s"],
        });
        expect(run1).not.toBe(run2);
        expect(computeSkinReceiptInvalid("skin", run1)).toBe(false);
        expect(computeSkinReceiptInvalid("skin", run2)).toBe(false);
    });

    // Proof-of-failure (not a permanent test): deleted the
    // `lane === "skin" &&` guard in `computeSkinReceiptInvalid` — "is false
    // for a non-skin lane…" went red (`true` instead of `false` for both
    // "engine" and "full", on garbage input that always fails
    // `verifyReceiptText`). Reverted after confirming red; recorded in the
    // PR receipt's `proofOfFailure` list.
});

describe("pr-refusals — a skin PR's SCOPED receipt must match the scope of its own diff (issue #3628)", () => {
    // ONE live import-graph walk for the whole describe (issue #7884): the
    // scope a real diff derives on this tree is derived once, in `beforeAll`,
    // from the same `landingDiffScope` the refusal calls. Every receipt
    // DECISION below injects a scope instead of walking again.
    const REPO_ROOT = resolve(__dirname, "..", "..");
    const DETAIL_DIFF = ["src/routes/deck-detail.route.tsx"];
    const LOBBY_DIFF = ["src/routes/lobby.route.tsx"];
    let detail: string[];

    beforeAll(() => {
        // live-walk: the claim is the scope a real diff derives on this tree.
        const scope = landingDiffScope(DETAIL_DIFF, REPO_ROOT);
        if (scope.kind !== "scoped") {
            throw new Error(
                `expected a scoped diff, got FULL: ${scope.reason}`
            );
        }
        detail = scope.surfaces;
    });

    const receiptBody = (surfaces: readonly string[] | null) =>
        laneReceipt(surfaces);
    const scopedTo = (surfaces: string[]) => (): UiScope => ({
        kind: "scoped",
        surfaces,
    });
    // The scope the lobby diff would derive: surfaces other than the detail's.
    const OTHER = ["lobby"];

    it("accepts the SCOPED receipt of its own diff, and refuses it for a diff reaching other surfaces", () => {
        expect(detail.length).toBeGreaterThan(0);
        const body = receiptBody(detail);
        expect(body).toContain(`SCOPED — diff base ${ORIGIN_BASE}`);
        expect(
            skinReceiptInvalidForDiff(
                DETAIL_DIFF,
                REPO_ROOT,
                body,
                scopedTo(detail)
            )
        ).toBe(false);
        expect(
            skinReceiptInvalidForDiff(
                LOBBY_DIFF,
                REPO_ROOT,
                body,
                scopedTo(OTHER)
            )
        ).toBe(true);
    });

    it("refuses a SCOPED receipt for a skin diff that also forces the full run", () => {
        const body = receiptBody(detail);
        expect(
            skinReceiptInvalidForDiff(
                ["src/index.css", ...DETAIL_DIFF],
                REPO_ROOT,
                body,
                () => ({ kind: "full", reason: "a stylesheet forces the run" })
            )
        ).toBe(true);
    });

    it("demands the full RECEIPT when the scope cannot be derived — never 'no receipt owed'", () => {
        const throwing = () => {
            throw new Error("import graph unreadable");
        };
        const scopedBody = receiptBody(detail);
        expect(
            skinReceiptInvalidForDiff(
                DETAIL_DIFF,
                REPO_ROOT,
                scopedBody,
                throwing
            )
        ).toBe(true);
        expect(
            skinReceiptInvalidForDiff(
                DETAIL_DIFF,
                REPO_ROOT,
                receiptBody(null),
                throwing
            )
        ).toBe(false);
    });

    it("accepts a full RECEIPT for a diff the scoper narrows", () => {
        expect(
            skinReceiptInvalidForDiff(
                DETAIL_DIFF,
                REPO_ROOT,
                receiptBody(null),
                scopedTo(detail)
            )
        ).toBe(false);
    });
});

describe("pr-refusals — the check:ui receipt is owed by the owed predicate, whatever the lane (issue #5459, absorbs issue #5380)", () => {
    const REPO_ROOT = resolve(__dirname, "..", "..");
    const OWED = {
        owed: true,
        rule: "a stylesheet",
        path: "src/index.css",
    } as const;
    const NOT_OWED = { owed: false, reason: "only leaf components" } as const;
    const LEAF_DIFF = ["src/components/lobby/deck-count.tsx"];
    const NO_WALK = "check:ui: no walk owed (leaf copy edit)";
    const noScope = (): UiScope => ({ kind: "full", reason: "stub" });
    const invalid = (
        paths: string[],
        body: string,
        owed: typeof OWED | typeof NOT_OWED
    ) => skinReceiptInvalidForDiff(paths, REPO_ROOT, body, noScope, () => owed);

    it("owed + no receipt → refused, even with the 'no walk owed' line", () => {
        expect(invalid(["src/index.css"], "no receipt here", OWED)).toBe(true);
        expect(invalid(["src/index.css"], NO_WALK, OWED)).toBe(true);
    });

    it("not owed + the 'no walk owed' line → accepted; not owed + nothing → refused", () => {
        expect(invalid(LEAF_DIFF, `Summary\n\n${NO_WALK}\n`, NOT_OWED)).toBe(
            false
        );
        expect(invalid(LEAF_DIFF, "Summary only", NOT_OWED)).toBe(true);
    });

    it("owed + a receipt → accepted as today", () => {
        expect(invalid(["src/index.css"], laneReceipt(null), OWED)).toBe(false);
    });

    describe("the undecided line (issue #6144)", () => {
        const UNDECIDED_LINE =
            "check:ui: scope undecided, not walked (src/x.tsx is in no surface's closure)";
        const undecidedScope = (): UiScope => ({
            kind: "undecided",
            reasons: ["src/x.tsx is unplaced"],
        });
        const scopedScope = (): UiScope => ({
            kind: "scoped",
            surfaces: ["lobby"],
        });
        const withScope = (scopeOf: () => UiScope, body: string) =>
            skinReceiptInvalidForDiff(
                ["src/index.css"],
                REPO_ROOT,
                body,
                scopeOf,
                () => OWED
            );

        it("is accepted when the re-derived scope is undecided", () => {
            expect(withScope(undecidedScope, UNDECIDED_LINE)).toBe(false);
            expect(withScope(undecidedScope, "no receipt")).toBe(true);
        });

        it("is accepted when the scope cannot be derived at all (undecided, not full)", () => {
            expect(
                skinReceiptInvalidForDiff(
                    ["src/index.css"],
                    REPO_ROOT,
                    UNDECIDED_LINE,
                    () => {
                        throw new Error("no base ref");
                    },
                    () => OWED
                )
            ).toBe(false);
        });

        it("is accepted for a certain-global full scope an AFK pass may not walk", () => {
            expect(withScope(noScope, UNDECIDED_LINE)).toBe(false);
        });

        it("is REFUSED when the re-derived scope is decided and owes a walk", () => {
            expect(withScope(scopedScope, UNDECIDED_LINE)).toBe(true);
        });
    });

    it("a mixed diff (src + convex, engine since issue #6989) touching an owed glob with no receipt is refused", () => {
        const diff = ["convex/gre/state.ts", "src/index.css"];
        expect(inertClassifyLane(diff).lane).toBe("engine");
        expect(
            skinReceiptInvalidForDiff(diff, REPO_ROOT, "no receipt", noScope)
        ).toBe(true);
        expect(
            skinReceiptInvalidForDiff(
                diff,
                REPO_ROOT,
                laneReceipt(null),
                noScope
            )
        ).toBe(false);
    });

    it("a mixed diff whose src paths are test-only lands without a receipt", () => {
        const diff = ["convex/gre/state.ts", "src/lib/__tests__/state.test.ts"];
        expect(inertClassifyLane(diff).lane).toBe("engine");
        expect(
            skinReceiptInvalidForDiff(diff, REPO_ROOT, "no receipt", noScope)
        ).toBe(false);
    });

    it("an owed verdict that cannot be derived stays owed", () => {
        expect(
            skinReceiptInvalidForDiff(
                LEAF_DIFF,
                REPO_ROOT,
                NO_WALK,
                noScope,
                () => {
                    throw new Error("unreadable");
                }
            )
        ).toBe(true);
    });
});

describe("pr-refusals — safeSkinReceiptInvalid tolerates a diff-classification failure (issue #2760 review, finding 6)", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-land-safe-test-"));
        const r = spawnSync("git", ["init", "-q", "-b", "main", dir], {
            encoding: "utf8",
        });
        if (r.status !== 0) {
            throw new Error(`git init failed: ${r.stderr}`);
        }
    });

    afterEach(() => {
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    });

    it("returns false instead of throwing when origin/main does not exist (no remote at all)", () => {
        // `changedPaths` shells out to `git diff … origin/main...HEAD` —
        // with no remote configured at all, that is an unresolvable
        // revision and `check-lane.ts`'s `git()` throws. This used to run
        // BEFORE any of `land`'s refusal checks, on every lane.
        expect(() =>
            safeSkinReceiptInvalid(dir, "irrelevant body")
        ).not.toThrow();
        expect(safeSkinReceiptInvalid(dir, "irrelevant body")).toBe(false);
    });

    // Proof-of-failure (not a permanent test): removed the try/catch from
    // `safeSkinReceiptInvalid` (called `classifyLane(changedPaths(...))`
    // directly, unguarded) — the test above went red with an UNCAUGHT
    // exception ("git diff … failed: fatal: ambiguous argument
    // 'origin/main...HEAD': unknown revision…") instead of returning `false`
    // cleanly. Reverted after confirming red; recorded in the PR receipt's
    // `proofOfFailure` list.
});

describe("pr-refusals — isTestOnlySrcDiff (ADR 0110 §4)", () => {
    // A src/** diff made only of test files cannot reach the DOM, so it owes
    // no check:ui receipt. The incident: a one-line test-constant green-main
    // repair (2026-08-27) was refused over a receipt for a diff with no
    // rendered surface.
    it("is true for a diff whose only src files are tests", () => {
        expect(isTestOnlySrcDiff(["src/__tests__/design-tokens.test.ts"])).toBe(
            true
        );
        expect(
            isTestOnlySrcDiff([
                "src/lib/__tests__/card-utils.test.ts",
                "src/components/board/Stack.test.tsx",
                "scripts/land-ready.ts",
            ])
        ).toBe(true);
    });

    it("is false as soon as ONE non-test src file is in the diff", () => {
        expect(
            isTestOnlySrcDiff([
                "src/__tests__/design-tokens.test.ts",
                "src/components/board/Stack.tsx",
            ])
        ).toBe(false);
    });

    it("is false for a diff with no src files at all (not this exemption's business)", () => {
        expect(isTestOnlySrcDiff(["convex/gre/stack.ts"])).toBe(false);
        expect(isTestOnlySrcDiff([])).toBe(false);
    });

    it("does not treat a non-test file under a test-ish name as a test", () => {
        // `contest.ts` / `latest.tsx` must not match a sloppy substring
        // check — the regex anchors on `.test.` and `__tests__/`.
        expect(isTestOnlySrcDiff(["src/lib/contest.ts"])).toBe(false);
        expect(isTestOnlySrcDiff(["src/lib/latest.tsx"])).toBe(false);
    });
});

describe("pr-refusals — a cards-lane landing is treated like engine (ADR 0136 §4, issue #3778)", () => {
    // The two lane-aware decisions `land` makes are the `check:ui` receipt
    // (skin only) and the preset-scenario refusal (path-based, ADR 0044). A
    // card PR used to classify `engine`; it now classifies `cards`, and
    // neither decision may change with it: no receipt owed, scenario owed.
    const CARD_DIFF = [
        "convex/cards/sets/lea/red.cards.ts",
        "data/card-index.json",
        "data/cr/citations-ledger.json",
    ];

    it("the card diff really is the cards lane (else the rest proves nothing)", () => {
        expect(inertClassifyLane(CARD_DIFF).lane).toBe("cards");
    });

    it("owes no check:ui receipt — garbage in the body never refuses, and no scope is derived", () => {
        expect(
            computeSkinReceiptInvalid("cards", "garbage, not a receipt")
        ).toBe(false);
        expect(
            skinReceiptInvalidForDiff(
                CARD_DIFF,
                "/nonexistent",
                "garbage, not a receipt",
                () => {
                    throw new Error("scope derived for a non-skin landing");
                }
            )
        ).toBe(false);
    });

    it("owes a preset scenario — a body without one is refused", () => {
        expect(owesScenario(CARD_DIFF)).toBe(true);
        expect(
            scenarioRefusal(
                classifyScenarioSection("## Summary\n\nno scenario here\n"),
                owesScenario(CARD_DIFF)
            )
        ).not.toBeNull();
    });
});
describe("pr-refusals — a RED-ladder revert lands without a walk only when it restores its culprit's parent (issue #6071)", () => {
    // The incident (issue #6066): the culprit added an overlay and edited a
    // detail view; its revert deletes the overlay, so the walk is owed, and
    // the old body's bare "no walk owed" line was refused.
    const DIALOG = "src/components/limited/limited-start-unseated-dialog.tsx";
    const DETAIL = "src/components/limited/limited-event-detail.tsx";
    const PATHS = [DIALOG, DETAIL];
    const noScope = (): UiScope => ({ kind: "full", reason: "stub" });
    let repo: string;
    const git = (...args: string[]) => {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr);
        return r.stdout.trim();
    };
    const write = (path: string, text: string) => {
        mkdirSync(join(repo, path, ".."), { recursive: true });
        writeFileSync(join(repo, path), text);
    };
    const commitAll = (subject: string) => {
        git("add", "-A");
        git("commit", "-q", "-m", subject);
        return git("rev-parse", "HEAD");
    };
    const bodyFor = (sha: string) =>
        revertPrBody({
            issue: 6070,
            red: "a".repeat(40),
            culprits: [{ sha: sha.slice(0, 12), pr: 6050, full: sha }],
            culpritIssues: [],
        });
    const invalid = (body: string) =>
        skinReceiptInvalidForDiff(PATHS, repo, body, noScope);
    let culprit: string;

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "tolaria-land-revert-"));
        git("init", "-q", "-b", BASE_BRANCH);
        git("config", "user.email", "test@example.com");
        git("config", "user.name", "Test");
        write(DETAIL, "export const Detail = () => null;\n");
        commitAll("base");
        write(DIALOG, "export const Dialog = () => null;\n");
        write(DETAIL, "export const Detail = () => <Dialog />;\n");
        culprit = commitAll("culprit (#6050)");
        write("src/lib/later.ts", "export const later = 1;\n");
        commitAll("a later landing");
        git("revert", "--no-edit", culprit);
    });
    afterEach(() =>
        rmSync(repo, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("the diff owes a walk, and the ladder's body is accepted as is", () => {
        expect(landingWalkOwed(PATHS, repo).owed).toBe(true);
        expect(invalid(bodyFor(culprit))).toBe(false);
    });

    it("a path that differs from the culprit's parent loses the exemption", () => {
        write(
            DETAIL,
            "export const Detail = () => <div className='fixed' />;\n"
        );
        commitAll("a hand edit on the revert branch");
        expect(invalid(bodyFor(culprit))).toBe(true);
    });

    it("a DOM path the culprit never touched grants nothing, even when unchanged since its parent", () => {
        const other = "src/components/limited/limited-other-dialog.tsx";
        expect(
            skinReceiptInvalidForDiff(
                [...PATHS, other],
                repo,
                bodyFor(culprit),
                noScope
            )
        ).toBe(true);
    });

    it("a commit outside the tree's history grants nothing", () => {
        git("checkout", "-q", "-b", "elsewhere", `${culprit}^`);
        // The culprit's twin: same paths, same parent, so only the history
        // check stands between it and the exemption.
        write(DIALOG, "export const Dialog = () => 1;\n");
        write(DETAIL, "export const Detail = () => 1;\n");
        const foreign = commitAll("never landed");
        git("checkout", "-q", BASE_BRANCH);
        expect(invalid(bodyFor(foreign))).toBe(true);
        expect(invalid(bodyFor("f".repeat(40)))).toBe(true);
    });

    it("no revert line → the owed walk still wants a receipt", () => {
        expect(invalid("check:ui: no walk owed (an automated revert)")).toBe(
            true
        );
    });
});
