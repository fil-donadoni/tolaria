/**
 * The refusals a PR's body and diff answer before it merges (issue #5639,
 * #5956): `pr-checks` runs one job per check on the PR, `land:ready` runs them
 * before it queues the PR. The `check:ui` receipt, the preset scenario, the
 * retirement acknowledgement. Moved out of `land` when it retired (issue
 * #7990).
 */
import { spawnSync } from "node:child_process";
import { changedPaths, type Lane } from "../check-lane";
import {
    landingDiffScope,
    landingDomDigest,
    landingRestoresParent,
    landingWalkOwed,
    verifyReceiptText,
    type ExpectedScope,
} from "../ui-gate/verify-receipt.ts";
import { ORIGIN_BASE } from "./branches";
import {
    draftAuditRefusal,
    owesDraftAuditReceipt,
} from "./draft-audit-receipt";
import { changedRetiredRows, retirementRefusal } from "./retirement-ack";
import {
    classifyScenarioSection,
    owesScenario,
    scenarioRefusal,
} from "./scenario-block";
import {
    hasNoWalkOwedLine,
    hasScopeUndecidedLine,
    isNonDomPath,
    revertedCommitsOf,
    type UiScope,
    type WalkOwed,
} from "./ui-scope.ts";

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0)
        throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

/**
 * The one DECISION about a `check:ui` receipt (issue #2760), a pure function:
 * the caller supplies the two impure inputs (the classified lane, the PR body
 * text).
 *
 * `expected` is the scope re-derived from the landing diff (issue #3628): a
 * `SCOPED` receipt is valid only against it, a full `RECEIPT` against any.
 */
export function computeSkinReceiptInvalid(
    lane: Lane,
    prBody: string,
    expected: ExpectedScope | null = null
): boolean {
    return lane === "skin" && !verifyReceiptText(prBody, expected).ok;
}

/**
 * The receipt decision for a landing diff given as paths, with `root` the
 * tree those paths live in. The scope is derived only for a `skin` diff that
 * owes a receipt — the import graph costs nothing on any other landing.
 */
export function skinReceiptInvalidForDiff(
    paths: string[],
    root: string,
    prBody: string,
    scopeOf: (changed: string[], root: string) => UiScope = landingDiffScope,
    owedOf: (changed: string[], root: string) => WalkOwed = landingWalkOwed,
    restoresOf: (
        reverted: readonly string[],
        changed: string[],
        root: string
    ) => boolean = landingRestoresParent,
    domOf: (changed: string[], root: string) => string = landingDomDigest
): boolean {
    // WHATEVER the lane (issue #5459, absorbing issue #5380): a `full` diff
    // (`src/**` + `convex/**`) reaches the DOM through its `src/**` paths just
    // as a `skin` one does. Only a `src/**` path that can reach the DOM owes
    // anything; a test-only `src/**` diff or a prose one never does.
    const reachesDom = paths.some(
        (p) => p.startsWith("src/") && !isNonDomPath(p)
    );
    if (!reachesDom || isTestOnlySrcDiff(paths)) return false;
    // A scope that cannot be derived demands the FULL receipt. It must never
    // read as "not a skin diff" and demand no receipt at all (issue #3628
    // review).
    let scope: UiScope;
    try {
        scope = scopeOf(paths, root);
    } catch (err) {
        scope = {
            kind: "undecided",
            reasons: [`scope unavailable: ${(err as Error).message}`],
        };
    }
    // A BATCH receipt (issue #9106) is matched to this tree by the content of
    // its DOM-reachable paths; computed only when the body carries one. A
    // digest that cannot be computed leaves it unset, and the receipt refused.
    let dom: string | undefined;
    if (/^\s*BATCH —/m.test(prBody)) {
        try {
            dom = domOf(paths, root);
        } catch {
            dom = undefined;
        }
    }
    const receiptOk = verifyReceiptText(prBody, {
        base: ORIGIN_BASE,
        scope,
        ...(dom !== undefined ? { dom } : {}),
    }).ok;
    if (receiptOk) return false;
    // The RED ladder's revert (issue #6071, ADR 0156 Amendment II): no walk
    // is owed when every DOM-reachable path is back to the reverted commit's
    // parent — checked here, never taken on the body's word.
    const reverted = revertedCommitsOf(prBody);
    if (reverted.length > 0 && restoresOf(reverted, paths, root)) return false;
    // Owed: only a receipt satisfies. An owed verdict that cannot be derived
    // stays owed — fail closed.
    let owed: WalkOwed;
    try {
        owed = owedOf(paths, root);
    } catch {
        owed = { owed: true, rule: "owed verdict unavailable", path: "" };
    }
    // The undecided line (issue #6144) covers a scope nobody could place, or a
    // certain-global one an AFK pass may not walk — NEVER a decided, scoped
    // diff, which owes its receipt however the line is worded.
    if (scope.kind !== "scoped" && hasScopeUndecidedLine(prBody)) return false;
    if (owed.owed) return true;
    return !hasNoWalkOwedLine(prBody);
}

/** The refusal text for `skinReceiptInvalid` — `land:ready` and the
 *  `pr-checks` receipt check (issue #5639) print the same words. */
export const SKIN_RECEIPT_REFUSAL =
    "landing diff reaches the DOM and its pasted check:ui receipt failed verification " +
    "— every verdict line must be PASS and the verdict block must match the one re-derived from the diff's scope; " +
    "`bun run verify:ui-receipt <PR#>` names the problem. A diff that owes no walk " +
    "(`bun run check:ui -- --scope-only` says `not owed`) states `check:ui: no walk owed (<reason>)` instead; " +
    "an undecided or global-input scope an AFK pass did not walk states `check:ui: scope undecided, not walked (<reasons>)`; " +
    "a RED-ladder revert states `check:ui: revert of <sha> restores its parent on every DOM path`, which holds only when every DOM-reachable changed path equals that commit's parent";

/**
 * A `src/**` diff made ONLY of test files cannot reach the DOM, so it owes
 * no `check:ui` receipt (ADR 0110 §4; `.claude/rules/chrome-debug.md`
 * already said nothing is owed — this makes the classifier agree). The
 * incident that forced it: a one-line test-constant green-main repair was
 * refused over a receipt for a diff with no rendered surface (2026-08-27).
 * Pure, so it is testable without git.
 */
export function isTestOnlySrcDiff(paths: string[]): boolean {
    const src = paths.filter((p) => p.startsWith("src/"));
    if (src.length === 0) return false;
    return src.every(
        (p) => /(^|\/)__tests__\//.test(p) || /\.test\.[tj]sx?$/.test(p)
    );
}

/**
 * `classifyLane(changedPaths(ORIGIN_BASE, cwd, true))` plus
 * `computeSkinReceiptInvalid`, tolerating a failure in the diff computation
 * (issue #2760 review, finding 6). `changedPaths` shells out to
 * `git diff … origin/main...HEAD` (`check-lane.ts`'s `git()` throws on
 * non-zero status), and this call ran BEFORE any of `refusalReason`'s
 * refusal checks — so a checkout whose `origin/main` was never fetched
 * crashed with an unhandled stack trace instead of a refusal message, on
 * EVERY lane, including an engine/full landing this feature owes nothing to.
 *
 * On failure: warn and treat the diff as not-skin; a genuine problem
 * resurfaces at the rebase the queue's draft owes.
 */
export function safeSkinReceiptInvalid(cwd: string, prBody: string): boolean {
    try {
        const paths = changedPaths(ORIGIN_BASE, cwd, true);
        return skinReceiptInvalidForDiff(paths, cwd, prBody);
    } catch (err) {
        console.warn(
            `pr-refusals: could not classify the landing diff to check the check:ui receipt (${(err as Error).message}) — proceeding as if it is not a skin diff`
        );
        return false;
    }
}

/**
 * The preset-scenario refusal (ADR 0044), computed the same tolerant way
 * `safeSkinReceiptInvalid` is: a diff-classification failure must not crash
 * the check, so it degrades to "allow" and says so.
 *
 * WHY THIS IS A GATE AT ALL. CLAUDE.md § Development cycle step 7 has always
 * required one scenario per new card/gameplay feature, and routed the insert
 * to "the orchestrator, post-merge". ADR 0110 retired the orchestrator and
 * `/next-ticket` never inherited the step, so the requirement survived only as
 * prose — and prose is not where invariants live (CLAUDE.md § Skills). Over
 * the 200 merged PRs before this landed, 42 carried a spec that was never
 * registered anywhere and 17 shipped a gameplay diff with no block and no
 * decline. Both halves are what this refusal and `seed:scenario` close.
 */
export function safeScenarioRefusal(
    cwd: string,
    prBody: string
): string | null {
    const verdict = classifyScenarioSection(prBody);
    let owes = false;
    try {
        owes = owesScenario(changedPaths(ORIGIN_BASE, cwd, true));
    } catch (err) {
        console.warn(
            `pr-refusals: could not classify the landing diff to check the preset scenario (${(err as Error).message}) — only a malformed block can refuse`
        );
    }
    return scenarioRefusal(verdict, owes);
}

/**
 * The retirement-marker refusal (issue #3049, ADR 0114 §1), computed the same
 * tolerant way the two above are: a git failure must not crash the check.
 *
 * WHY THIS IS A GATE. A retired card's lockfile row is the only copy of its
 * behaviour — the hand-written module is gone, and nobody reads a file that no
 * longer exists. `check:oracle` proves the row is what the compiler produces
 * and that the marker is not a lie; neither it nor Guard C asks whether a human
 * LOOKED at a marked row changing, which is the one thing that cannot be
 * derived offline. So the PR body carries it, exactly as it carries the preset
 * scenario and the `check:ui` receipt.
 *
 * `-U0` and `origin/main...HEAD` match `changedPaths`: the lockfile's one-row-
 * per-line serializer is what makes a line-oriented scan exact.
 */
export function safeRetirementRefusal(
    cwd: string,
    prBody: string
): string | null {
    let diff = "";
    try {
        diff = git(
            [
                "diff",
                "-U0",
                `${ORIGIN_BASE}...HEAD`,
                "--",
                "data/oracle-compiled.json",
            ],
            cwd
        );
    } catch (err) {
        console.warn(
            `pr-refusals: could not diff the lockfile to check retirement markers (${(err as Error).message}) — proceeding as if it touches none`
        );
        return null;
    }
    return retirementRefusal(changedRetiredRows(diff), prBody);
}

/** The receipt line the audit prints for `scope` on this tree. A child
 *  process, never an import: the audit's module closure must stay out of this
 *  file's (`fileReadsCorpus`, issue #8895 review). */
export function deriveDraftAuditLine(scope: string, cwd = "."): string {
    const r = spawnSync(
        "bun",
        ["scripts/draft-audit.ts", "--scope", scope, "--quiet"],
        { cwd, encoding: "utf8", maxBuffer: 1 << 24 }
    );
    const line = r.stdout
        .split(/\r?\n/)
        .find((l) => l.startsWith("draft:audit: "));
    return line ?? "";
}

/**
 * The `draft:audit:` receipt refusal (issue #8895), tolerant like the others:
 * a diff that cannot be classified degrades to "owes nothing" and says so; the
 * audit itself (about 20 s, `PR_RECEIPT_GUARDS`) runs only for an owing diff.
 */
export function safeDraftAuditRefusal(
    cwd: string,
    prBody: string,
    derive: (scope: string) => string = (scope) =>
        deriveDraftAuditLine(scope, cwd)
): string | null {
    let owes = false;
    try {
        owes = owesDraftAuditReceipt(changedPaths(ORIGIN_BASE, cwd, true));
    } catch (err) {
        console.warn(
            `pr-refusals: could not classify the landing diff to check the draft:audit receipt (${(err as Error).message}) — proceeding as if it owes none`
        );
    }
    return draftAuditRefusal(owes, prBody, derive);
}
