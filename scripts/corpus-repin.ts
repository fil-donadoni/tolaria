#!/usr/bin/env bun
/**
 * `bun run corpus:repin` — the weekly corpus re-pin (issue #6387), run by
 * `.github/workflows/corpus-repin.yml` in a job worktree at the base tip.
 *
 *   1. stop (exit 0) when a re-pin PR is still open, or when Scryfall's
 *      `oracle_cards` bulk is the one already pinned;
 *   2. `oracle:corpus --repin`, then everything that follows from the pin:
 *      `oracle:compile` (the Bot sweep, under the heavy mutex — exit 77 is
 *      passed through as INFRA), `oracle:legality`, `oracle:index`,
 *      `oracle:pool`, `catalogue:build`;
 *   3. settle what blocks the merge (`lib/corpus-repin.ts`): `ready` losses
 *      acknowledged, enforced-Target claims written — both pointing at ONE
 *      roll-up issue filed for the run when anything needs one — and the
 *      `## Retired rows` lines composed;
 *   4. `check:oracle`, `check:targets`, `check:index`; commit on
 *      `chore/corpus-repin-<date>`, push, open the PR, `land:ready`.
 *
 * Per-gap issues for the gaps the new corpus introduces are `gaps:sync`'s,
 * in post-merge `housekeeping`, as for any merge.
 *
 * Refuses to run in the PRIMARY checkout: a re-pin there hands its corpus
 * cache to every worktree still on the old pin (issue #6367).
 *
 * `--dry-run` does steps 1–2 and prints step 3's plan: no issue, no ledger or
 * allowlist write, no commit, push or PR.
 *
 * A scheduled workflow's job worktree is cut at the DEFAULT branch (the
 * release branch), not the base: the run first detaches at `origin/<base>`,
 * re-bootstraps and re-executes itself there, so every step is the base's
 * code on the base's tree. `--here` skips that (a local dry run in a
 * worktree whose HEAD must not move).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALLOWLIST_PATH, parseAllowlist } from "./check-gaps";
import { renderAllowlist } from "./gaps-sync";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import {
    corpusDate,
    needsRollup,
    planAcknowledgements,
    planClaims,
    repinBranch,
    settleClaims,
    repinPrBody,
    REPIN_BRANCH_PREFIX,
    retiredRowLines,
    rollupIssueBody,
    trackedLosses,
    type RepinFacts,
    type UnclaimedCard,
} from "./lib/corpus-repin";
import { buildCoverageContext } from "./lib/coverage-context";
import { applyUpdatedIssues } from "./lib/gap-issues";
import { gh } from "./lib/gh";
import { parseLockfile, type Lockfile } from "./lib/oracle-lockfile";
import {
    parseRegressionLedger,
    readyRegressions,
    REGRESSION_LEDGER_PATH,
    renderRegressionLedger,
    withAcknowledgement,
} from "./lib/oracle-state-regressions";
import { deriveCounts } from "./lib/oracle-tally";
import { primaryCheckout } from "./lib/primary-checkout";
import { changedRetiredRows } from "./lib/retirement-ack";
import {
    readTargetRegistry,
    resolveContext,
    resolveTarget,
    targetCoverage,
} from "./lib/targets";

const ROOT = resolve(import.meta.dirname, "..");
const LOCKFILE = "data/oracle-compiled.json";
const PIN = "data/oracle-corpus.pin.json";
/** The heavy gate's "machine saturated, nothing ran" (scripts/gate.ts). */
const INFRA = 77;
/** Set on the re-execution at the base tip (see the header). */
const ON_BASE = "--on-base";

const say = (line: string): void => console.log(`corpus:repin: ${line}`);

function fail(message: string, code = 1): never {
    console.error(`✗ corpus:repin: ${message}`);
    process.exit(code);
}

/** `maxBuffer` well over the ~20 MB lockfile `lockfileAt("HEAD")` shows: the
 *  1 MB default ENOBUFS it mid-blob (issue #6642). */
function git(args: string[]): string {
    const r = spawnSync("git", args, {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
    });
    if (r.status !== 0)
        fail(
            `git ${args.join(" ")} failed: ${r.error?.message ?? (r.stderr ?? "").trim()}`
        );
    return r.stdout.trim();
}

/** One step, its output inherited as the job log. */
function step(label: string, argv: string[]): void {
    say(`▶ ${label}`);
    const r = spawnSync("bun", argv, { cwd: ROOT, stdio: "inherit" });
    if (r.status === INFRA)
        fail(`${label} — machine saturated, nothing ran (re-dispatch)`, INFRA);
    if (r.status !== 0) fail(`${label} failed (exit ${r.status ?? r.signal})`);
}

const readPinSha = (): { sha256: string; updatedAt: string } =>
    JSON.parse(readFileSync(join(ROOT, PIN), "utf8")) as {
        sha256: string;
        updatedAt: string;
    };

const lockfileAt = (rev: string | null): Lockfile =>
    parseLockfile(
        rev === null
            ? readFileSync(join(ROOT, LOCKFILE), "utf8")
            : git(["show", `${rev}:${LOCKFILE}`])
    );

/** Every unclaimed card of an ENFORCED Target, as `check:targets` sees them. */
function enforcedUnclaimed(lock: Lockfile): UnclaimedCard[] {
    const registry = readTargetRegistry(ROOT);
    const ctxResolve = resolveContext(ROOT, lock);
    const ctx = buildCoverageContext(ROOT, lock, registry, ctxResolve);
    return registry.targets
        .map((row) => targetCoverage(resolveTarget(row, ctxResolve), ctx))
        .filter((c) => c.enforced)
        .flatMap((c) =>
            c.unclaimed.map((u) => ({
                target: c.id,
                name: u.name,
                why: u.why,
                ...(u.missing && { missing: u.missing }),
            }))
        );
}

function openRepinPr(): string | null {
    const open = JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--base",
            BASE_BRANCH,
            "--limit",
            "200",
            "--json",
            "number,headRefName",
        ])
    ) as { number: number; headRefName: string }[];
    const hit = open.find((p) => p.headRefName.startsWith(REPIN_BRANCH_PREFIX));
    return hit === undefined ? null : `PR #${hit.number} (${hit.headRefName})`;
}

/** An open issue already titled `title` — a roll-up a failed earlier run of
 *  the same corpus date filed — or null. Reused, never filed twice. */
function openIssueTitled(title: string): number | null {
    const hits = JSON.parse(
        gh([
            "issue",
            "list",
            "--state",
            "open",
            "--search",
            `in:title "${title}"`,
            "--json",
            "number,title",
        ])
    ) as { number: number; title: string }[];
    return hits.find((h) => h.title === title)?.number ?? null;
}

function writeIssueBody(issue: number, body: string): void {
    const path = join(ROOT, ".corpus-repin-issue.md");
    writeFileSync(path, body);
    gh(["issue", "edit", String(issue), "--body-file", path]);
    spawnSync("rm", ["-f", path]);
}

/** The paths a re-pin commits — never `git add -A`, so a stray artefact of a
 *  generator or of `worktree:init` cannot ride along. `data/catalogue/*` and
 *  the header hashes are restored to the merge-base by `land:ready` (ADR 0157). */
const REPIN_PATHS = [
    PIN,
    LOCKFILE,
    "data/oracle-legality.json",
    "data/card-index.json",
    "data/catalogue",
    "data/full-catalogue",
    "data/oracle-state-regressions.json",
    ALLOWLIST_PATH,
];

function fileIssue(title: string, body: string, labels: string[]): number {
    const path = join(ROOT, ".corpus-repin-issue.md");
    writeFileSync(path, body);
    const url = gh([
        "issue",
        "create",
        "--title",
        title,
        "--body-file",
        path,
        ...labels.flatMap((l) => ["--label", l]),
    ]).trim();
    spawnSync("rm", ["-f", path]);
    const n = Number(/\/issues\/(\d+)$/.exec(url)?.[1]);
    if (!Number.isInteger(n) || n <= 0)
        fail(`gh issue create returned no issue number: ${url}`);
    return n;
}

function main(): void {
    const dryRun = process.argv.includes("--dry-run");
    if (primaryCheckout(ROOT) === ROOT)
        fail(
            "refusing to re-pin in the primary checkout — its corpus cache is copied into other worktrees (issue #6367); run it in a worktree"
        );

    if (!process.argv.includes("--here") && !process.argv.includes(ON_BASE)) {
        git(["fetch", "--quiet", "origin", BASE_BRANCH]);
        git(["checkout", "--quiet", "--detach", ORIGIN_BASE]);
        say(`on ${ORIGIN_BASE} ${git(["rev-parse", "--short", "HEAD"])}`);
        step("worktree:init", ["run", "worktree:init"]);
        const again = spawnSync(
            "bun",
            [
                join(ROOT, "scripts", "corpus-repin.ts"),
                ON_BASE,
                ...process.argv.slice(2),
            ],
            { cwd: ROOT, stdio: "inherit" }
        );
        process.exit(again.status ?? 1);
    }

    const open = openRepinPr();
    if (open !== null) {
        say(`${open} is still open — one re-pin at a time; nothing to do`);
        return;
    }

    const before = readPinSha();
    step("oracle:corpus --repin", ["scripts/oracle-corpus.ts", "--repin"]);
    const after = readPinSha();
    if (after.sha256 === before.sha256) {
        say(
            `Scryfall's bulk is the pinned one (${corpusDate(after.updatedAt)}) — nothing to do`
        );
        return;
    }
    const date = corpusDate(after.updatedAt);
    const fromDate = corpusDate(before.updatedAt);
    say(`re-pinned ${fromDate} → ${date}`);

    step("oracle:compile", ["scripts/oracle-compile.ts"]);
    step("oracle:legality", ["scripts/oracle-legality.ts"]);
    step("oracle:index", ["scripts/oracle-index-backfill.ts"]);
    step("oracle:pool", ["scripts/catalogue-artifact.ts"]);
    step("catalogue:build", ["run", "catalogue:build"]);

    const base = lockfileAt("HEAD");
    const current = lockfileAt(null);
    const regressions = readyRegressions(base.cards, current.cards);
    const unclaimed = enforcedUnclaimed(current);
    const byId = new Map(current.cards.map((c) => [c.oracleId, c] as const));
    const facts: RepinFacts = {
        date,
        fromDate,
        counts: deriveCounts(current.cards),
        fromCounts: deriveCounts(base.cards),
        regressions,
        lossGaps: new Map(
            trackedLosses(regressions).map((r) => [
                r.oracleId,
                byId.get(r.oracleId)?.gaps ?? [],
            ])
        ),
        unclaimed,
    };
    const diff = git(["diff", "HEAD", "--", LOCKFILE]);
    const retired = retiredRowLines(
        changedRetiredRows(diff),
        new Map(base.cards.map((c) => [c.oracleId, c] as const)),
        byId,
        date
    );

    if (dryRun) {
        say(
            `dry run — ${regressions.length} ready loss(es), ${unclaimed.length} unclaimed enforced card(s), ${retired.length} retired row(s) moved`
        );
        for (const r of regressions) say(`  loss: ${r.name} → ${r.to}`);
        for (const u of unclaimed)
            say(
                `  unclaimed: ${u.target}: ${u.name} — ${u.missing ? `${u.missing.kind} ${u.missing.key}` : `UNSETTLEABLE (${u.why})`}`
            );
        for (const line of retired) say(`  retired ${line}`);
        return;
    }

    // A card no claim can settle fails the run BEFORE anything is filed.
    const unsettled = planClaims(unclaimed, 0).unsettled;
    if (unsettled.length > 0)
        fail(
            `no claim settles ${unsettled.map((u) => `${u.target}: ${u.name} (${u.why})`).join("; ")} — a person is owed`
        );

    const rollupTitle = `[Re-pin] ready losses and claims of the ${date} corpus re-pin`;
    let rollup: number | null = null;
    if (needsRollup(regressions, unclaimed)) {
        rollup = openIssueTitled(rollupTitle);
        if (rollup !== null) say(`roll-up issue #${rollup} reused`);
        else {
            rollup = fileIssue(rollupTitle, rollupIssueBody(facts), [
                "enhancement",
                "area:mechanics",
                "ready-for-agent",
            ]);
            say(`roll-up issue #${rollup} filed`);
        }
    }

    let ledger = parseRegressionLedger(
        readFileSync(join(ROOT, REGRESSION_LEDGER_PATH), "utf8")
    );
    for (const entry of planAcknowledgements(regressions, rollup, date))
        ledger = withAcknowledgement(ledger, entry);
    writeFileSync(
        join(ROOT, REGRESSION_LEDGER_PATH),
        renderRegressionLedger(ledger)
    );

    let claims = 0;
    if (rollup !== null && unclaimed.length > 0) {
        const allowlistPath = join(ROOT, ALLOWLIST_PATH);
        const settled = settleClaims(
            unclaimed,
            rollup,
            (rows) => {
                const before = parseAllowlist(
                    readFileSync(allowlistPath, "utf8")
                );
                const next = applyUpdatedIssues(before, rows);
                writeFileSync(allowlistPath, renderAllowlist(next));
                return (
                    (next.claims ?? []).length - (before.claims ?? []).length
                );
            },
            () => enforcedUnclaimed(current)
        );
        if (!settled.ok) fail(settled.why);
        claims = settled.rows;
        // Claims from later passes join the roll-up's list.
        if (settled.claimed.length > unclaimed.length)
            writeIssueBody(
                rollup,
                rollupIssueBody({ ...facts, unclaimed: settled.claimed })
            );
    }

    step("check:oracle", ["scripts/check-oracle-lockfile.ts"]);
    step("check:targets", ["scripts/check-targets.ts"]);
    step("check:index", ["scripts/check-card-index.ts"]);

    const branch = repinBranch(date);
    git(["checkout", "-b", branch]);
    git(["add", "-A", "--", ...REPIN_PATHS]);
    git([
        "commit",
        "-m",
        `chore: weekly corpus re-pin ${fromDate} → ${date} (issue #6387)`,
    ]);
    git(["push", "-u", "origin", branch]);
    const bodyPath = join(ROOT, ".corpus-repin-pr.md");
    writeFileSync(bodyPath, repinPrBody(facts, rollup, retired, claims));
    const url = gh([
        "pr",
        "create",
        "--base",
        BASE_BRANCH,
        "--head",
        branch,
        "--title",
        `chore: weekly corpus re-pin ${fromDate} → ${date}`,
        "--body-file",
        bodyPath,
    ]).trim();
    spawnSync("rm", ["-f", bodyPath]);
    const pr = Number(/\/pull\/(\d+)$/.exec(url)?.[1]);
    if (!Number.isInteger(pr) || pr <= 0)
        fail(`gh pr create returned no PR number: ${url}`);
    say(`PR #${pr} opened`);
    step("land:ready", ["scripts/land-ready.ts", String(pr)]);
}

if (import.meta.main) main();
