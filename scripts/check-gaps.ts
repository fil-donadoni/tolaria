#!/usr/bin/env bun
/**
 * Derived Op census — the shrink-only Grammar Gap allowlist (ADR 0105 § 7.3,
 * ADR 0137, PRD issue #3820 stories 8 and 12).
 *
 * An Op of the Mechanics Registry is GRAMMAR-COVERED when at least one
 * Compiled Definition emits it. Coverage is DERIVED — read off the lockfile's
 * `opsUsed`, never declared — so the census cannot be talked into agreeing
 * with itself. `quarantine` counts alongside `ready`, because quarantine is a
 * trust gate on the CARD, not on the grammar that produced it.
 *
 * Every implemented Op nothing emits must carry a row in
 * `data/grammar-gaps.json` naming the issue that will close it. The allowlist
 * ONLY SHRINKS:
 *
 *   - a row whose Op became emitted must be removed (the rule landed);
 *   - a row whose Op left the implemented registry must be removed;
 *   - a NEW row is never legal. A newly implemented Op therefore has exactly
 *     one exit — the grammar rule that emits it (ADR 0137: "/new-op ends with
 *     the rule that emits the Op, or with the open gap"). Demanding a row and
 *     forbidding its addition is the same demand stated twice, deliberately:
 *     it is what stops the allowlist from becoming a parking lot.
 *
 * Shrink is proven against the allowlist's PREVIOUS REVISION in HEAD's own
 * history, not against a hand-kept count: a row this commit has and its
 * predecessor did not is a row that was added. Only the commit that introduces
 * the file has no predecessor, and there the shrink check is announced as
 * skipped rather than passed silently.
 *
 * ── Bot Gaps are filed (issue #4061, PRD issue #3820 story 12) ─────────
 *
 * Every Bot Gap key a RANKED Target card carries (`inScopeBotGapKeys` —
 * priority ∪ enforced, the same scope `gaps:sync` files by) must have its
 * `bot` claim row with an issue number. Not shrink-only — the sweep's verdicts
 * move with the Bot — just filed: the lockfile says a ranked card is not
 * played, and the allowlist must say which issue owns that. A key no ranked
 * card carries is reported in the lockfile's table and owed nothing here.
 *
 * ── Hand-tail markers name their claim (issue #4514, PRD issue #4509) ──
 *
 * A card carrying a `hand-tail:` marker AND a `hand-tail` claim row must name
 * the claim's issue in its marker: the marker names the claim, the writing PR
 * closes it. A card written by another issue (a C-cluster slice writing
 * several cards) otherwise leaves its claim open forever. Deliberately NOT a
 * PR-phase gate — the miss is caught within one `health` batch.
 *
 * Offline and ~1s: the committed lockfile, the registry, the Target Lists and
 * the card set sources, no network, no corpus. It runs in `health` ONLY — added to `scripts/lib/health-step.ts`'s
 * step list, never to `check:all` or `check:pr`, so a PR and `land` pay
 * nothing for it (ADR 0105 § 7.3, asserted by `check-gaps.test.ts`).
 *
 * Run: bun run check:gaps
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EFFECT_OP_REGISTRY } from "../convex/cards/mechanicsRegistry";
import {
    computedGapKeys,
    inScopeBotGapKeys,
    rankedCardIds,
} from "./lib/gap-kinds";
import { matchingClusterIssues, signatureMatches } from "./lib/gap-issues";
import { opGapKey } from "./lib/grammar-gaps";
import {
    handTailClaimMismatches,
    isExempting,
    scanFilesForCompilerGaps,
    type CompilerGapMarker,
    type HandTailClaimMismatch,
} from "./lib/compiler-gap-markers";
import { collectSetFiles } from "./lib/divergence-markers";
import {
    botHash,
    FINDINGS_PATH,
    mergeBotVerdicts,
    parseFindings,
    type BotGapVerdict,
} from "./lib/oracle-bot-reach";
import {
    claimId,
    CLUSTER_KINDS,
    parseClaimRows,
    parseClusterRows,
    readTargetRegistry,
    resolveContext,
    SET_FILE_COLOURS,
    type CardMatch,
    type ClaimRow,
    type ClusterKind,
    type ClusterRow,
    type CutRow,
    type SetFileColour,
} from "./lib/targets";
import { parseLockfile, type Lockfile } from "./lib/oracle-lockfile";

export const ALLOWLIST_PATH = "data/grammar-gaps.json";
export const LOCKFILE_PATH = "data/oracle-compiled.json";

/** A row of the allowlist, as committed. */
export interface GapRow {
    /** The gap's stable key — `opGapKey(op)`, shared with `gaps:sync`. */
    readonly key: string;
    readonly op: string;
    /** The open issue that closes the gap by landing the emitting rule. */
    readonly issue: number;
}

export interface Allowlist {
    readonly note?: string;
    readonly ops: readonly GapRow[];
    /**
     * The other five kinds `gaps:sync` files (issue #3869), each row the same
     * `{ key, issue }` shape as an `ops` row plus the `kind` that names its key
     * scheme. Read back by `parseClaimRows` / `parseClaims` (`lib/targets.ts`);
     * this census neither reads nor guards them — the shrink-only invariant is
     * about `ops` alone.
     */
    readonly claims?: readonly ClaimRow[];
    /**
     * The Cluster Signatures of the Gap Clusters (ADR 0146, issue #4677),
     * authored by `/cluster-gaps`, read by `gaps:sync` through
     * `parseClusterRows` (`lib/targets.ts`), which validates them fail-closed.
     */
    readonly clusters?: readonly ClusterRow[];
    /**
     * The standing Cluster Cut tickets (ADR 0146 § Decision 7, issue #4681),
     * one row per kind, authored by `gaps:sync` itself — the "clusters-adjacent
     * record" it finds its own ticket by, never written by `/cluster-gaps`.
     */
    readonly cuts?: readonly CutRow[];
}

export type Violation =
    | { kind: "missing"; op: string }
    | { kind: "covered"; op: string }
    | { kind: "unknown-op"; op: string }
    | { kind: "duplicate"; op: string }
    | { kind: "malformed"; op: string; detail: string }
    | { kind: "grown"; op: string };

export interface CensusInput {
    /** Ops the registry marks `implemented` — the only ones a card may use. */
    readonly implemented: readonly string[];
    /** Ops emitted by at least one `ready`/`quarantine` Compiled Definition. */
    readonly emitted: ReadonlySet<string>;
    readonly allowlist: Allowlist;
    /** The allowlist's previous revision, or null when there is none. */
    readonly baseline: Allowlist | null;
}

export interface CensusResult {
    readonly violations: readonly Violation[];
    readonly implementedCount: number;
    readonly emittedCount: number;
    readonly allowlistedCount: number;
    readonly baselineChecked: boolean;
}

/**
 * The whole verdict, pure over its four inputs. Violations come back sorted by
 * Op within a kind so two runs over one tree print one list.
 */
export function auditOpCensus(input: CensusInput): CensusResult {
    const { implemented, emitted, allowlist, baseline } = input;
    const violations: Violation[] = [];
    const implementedSet = new Set(implemented);
    const seen = new Set<string>();

    const opOf = (row: GapRow | null): string =>
        row !== null && typeof row.op === "string" ? row.op : "";

    for (const row of [...allowlist.ops].sort((a, b) => {
        const [x, y] = [opOf(a), opOf(b)];
        return x < y ? -1 : x > y ? 1 : 0;
    })) {
        if (opOf(row) === "") {
            violations.push({
                kind: "malformed",
                op: JSON.stringify(row?.op ?? null),
                detail: "row has no `op`",
            });
            continue;
        }
        if (seen.has(row.op)) {
            violations.push({ kind: "duplicate", op: row.op });
            continue;
        }
        seen.add(row.op);

        if (!Number.isInteger(row.issue) || row.issue <= 0) {
            violations.push({
                kind: "malformed",
                op: row.op,
                detail: `\`issue\` is ${JSON.stringify(row.issue)}, want a positive integer`,
            });
        }
        if (row.key !== opGapKey(row.op)) {
            violations.push({
                kind: "malformed",
                op: row.op,
                detail: `\`key\` is ${JSON.stringify(row.key)}, want ${JSON.stringify(opGapKey(row.op))}`,
            });
        }
        if (!implementedSet.has(row.op)) {
            violations.push({ kind: "unknown-op", op: row.op });
        } else if (emitted.has(row.op)) {
            violations.push({ kind: "covered", op: row.op });
        }
    }

    for (const op of [...implemented].sort()) {
        if (!emitted.has(op) && !seen.has(op)) {
            violations.push({ kind: "missing", op });
        }
    }

    if (baseline !== null) {
        const before = new Set(baseline.ops.map((r) => r.op));
        for (const op of [...seen].sort()) {
            if (!before.has(op)) violations.push({ kind: "grown", op });
        }
    }

    return {
        violations,
        implementedCount: implemented.length,
        emittedCount: emitted.size,
        allowlistedCount: allowlist.ops.length,
        baselineChecked: baseline !== null,
    };
}

/**
 * Ops emitted by at least one `ready` or `quarantine` Compiled Definition.
 *
 * `opsUsed` is optional on `CardRow` because an `unparsed` row has none.
 * Absent on a COMPILED row it would read as "emits nothing", which is a silent
 * false `missing` for whatever that card's definition really emits — and a
 * `missing` has no legal exit, since a row may not be added. So it throws: a
 * census that cannot see a compiled definition's Ops has not been taken.
 */
export function emittedOps(
    cards: readonly {
        readonly name?: string;
        readonly state: string;
        readonly opsUsed?: readonly string[];
    }[]
): Set<string> {
    const emitted = new Set<string>();
    for (const card of cards) {
        if (card.state !== "ready" && card.state !== "quarantine") continue;
        if (card.opsUsed === undefined) {
            throw new Error(
                `${LOCKFILE_PATH}: ${card.name ?? "a card"} is \`${card.state}\` with no \`opsUsed\` — regenerate with \`bun run oracle:compile\``
            );
        }
        for (const op of card.opsUsed) emitted.add(op);
    }
    return emitted;
}

export function parseAllowlist(text: string): Allowlist {
    const parsed = JSON.parse(text) as Allowlist;
    if (!Array.isArray(parsed.ops)) {
        throw new Error(`${ALLOWLIST_PATH}: no \`ops\` array`);
    }
    return parsed;
}

/**
 * The allowlist's PREVIOUS REVISION in HEAD's own history — the tree this one
 * must not have grown against. `null` when there is none, i.e. the commit that
 * introduced the file (or a history too shallow to reach its parent).
 *
 * NOT the merge-base with the base branch, which is what shipped first and was
 * structurally vacuous where it mattered: `check:gaps` runs ONLY in `health`,
 * and `health` gates a `git worktree add --detach <base tip>`. There
 * `merge-base(HEAD, origin/<base>)` IS `HEAD`, so the baseline was the very
 * file being audited, `grown` could never fire, and a branch that implemented
 * an Op and allowlisted it in the same commit landed green — the parking lot
 * this guard exists to prevent (review of PR #3878).
 *
 * Shrink-only is a PER-COMMIT invariant, so the file's own previous revision is
 * the right baseline and is well-defined on a branch, on the base tip, and in a
 * detached worktree alike.
 */
export function baselineAllowlist(root: string): Allowlist | null {
    const git = (args: string[]) =>
        spawnSync("git", args, { cwd: root, encoding: "utf8" });
    const prev = git([
        "log",
        "--format=%H",
        "--skip=1",
        "-1",
        "HEAD",
        "--",
        ALLOWLIST_PATH,
    ]);
    if (prev.status !== 0) return null;
    const at = prev.stdout.trim();
    if (at === "") return null;
    const show = git(["show", `${at}:${ALLOWLIST_PATH}`]);
    if (show.status !== 0) return null;
    return parseAllowlist(show.stdout);
}

/**
 * The in-scope Bot Gap keys with no `bot` claim row, sorted — the whole
 * verdict of the Bot Gap half (module header). Pure over its two inputs.
 */
export function unclaimedBotGaps(
    inScope: readonly string[],
    claims: readonly ClaimRow[]
): string[] {
    const claimed = new Set(
        claims.filter((row) => row.kind === "bot").map((row) => row.key)
    );
    return inScope.filter((key) => !claimed.has(key)).sort();
}

export function renderBotGaps(
    inScope: number,
    unclaimed: readonly string[]
): string {
    if (unclaimed.length === 0)
        return `✓ gaps: ${inScope} Bot Gap key(s) a ranked Target card carries — every one filed`;
    return [
        `✗ gaps: ${unclaimed.length} of ${inScope} in-scope Bot Gap key(s) have no \`bot\` claim row:\n`,
        ...unclaimed.map((key) => `  - ${key}`),
        "",
        `  A ranked Target card carries each key (${LOCKFILE_PATH} \`botGap\`), and`,
        `  ${ALLOWLIST_PATH} records no issue for it. Run \`bun run gaps:sync\` —`,
        "  it files the issue and writes the `bot` claim row (issue #4061).",
    ].join("\n");
}

export function renderHandTailClaims(
    mismatches: readonly HandTailClaimMismatch[]
): string {
    if (mismatches.length === 0)
        return "✓ gaps: every `hand-tail:` marker names its `hand-tail` claim's issue";
    return [
        `✗ gaps: ${mismatches.length} \`hand-tail:\` marker(s) name another issue than the card's \`hand-tail\` claim:\n`,
        ...mismatches.map(
            (m) =>
                `  - ${m.card}: marker names #${m.markerIssue}, claim is #${m.claimIssue}`
        ),
        "",
        "  Re-point the marker to the claim's issue (or close the claim with the",
        "  PR that wrote the card): the marker names the claim, the writing PR",
        "  closes it (issue #4514).",
    ].join("\n");
}

/** The three halves' combined verdict — pure, so the exit code is tested. */
export function gapsVerdict(
    census: CensusResult,
    inScopeBotGaps: number,
    unclaimed: readonly string[],
    mismatches: readonly HandTailClaimMismatch[]
): { ok: boolean; out: string } {
    return {
        ok:
            census.violations.length === 0 &&
            unclaimed.length === 0 &&
            mismatches.length === 0,
        out: [
            render(census),
            renderBotGaps(inScopeBotGaps, unclaimed),
            renderHandTailClaims(mismatches),
        ].join("\n"),
    };
}

// ── Gap Cluster census (ADR 0146 § Decision 8, issue #4682) ──────────────
//
// Informational, NEVER red — no gate reads it, `gapsVerdict.ok` never sees it
// (issue #4681 already ships `clusters` rows and their matcher; this only
// prints what they resolve to, so a cutter can tighten a signature). Pure
// over the LIVE keys this run computes (never a claim row's mere presence —
// a closed gap's row stays forever, and reporting it here would read a dead
// claim as a live ambiguity) and the `clusters` rows read off the allowlist.

/** One live gap, in the shape `signatureMatches` is asked about. */
export interface LiveGapKey {
    readonly kind: ClusterKind;
    readonly key: string;
    readonly card?: CardMatch;
}

const HAND_TAIL_SET_FILE = /(?:^|[\\/])sets[\\/]([a-z0-9]+)[\\/](\w+)\.ts$/i;

/** The `{ set, colour }` a `hand-tail:` marker's own file is written in — the
 *  file IS the card's set file (ADR 0043), so no catalogue lookup is owed.
 *  `undefined` for a legacy flat `sets/<code>.ts` or an unrecognised colour:
 *  such a card then matches no `hand-tail` Cluster Signature, same as a card
 *  the Full Catalogue does not know (`gaps-sync.ts`'s `readSetFileMatches`). */
export function handTailCardMatch(file: string): CardMatch | undefined {
    const m = HAND_TAIL_SET_FILE.exec(file);
    if (m === null) return undefined;
    const colour = m[2]!.toLowerCase();
    if (!(SET_FILE_COLOURS as readonly string[]).includes(colour))
        return undefined;
    return { set: m[1]!.toLowerCase(), colour: colour as SetFileColour };
}

/**
 * Every LIVE gap key this run computes, across the five signature-clustered
 * kinds (`migration` is out of scope, ADR 0146 § Decision 8) — pure over the
 * lockfile, the Bot Reach Findings report, and the `hand-tail:` markers
 * `handTailClaimMismatches` already scanned. `grammar` unions the derived Op
 * census (`(op) › …`, {@link opGapKey}) with the fragment-level Grammar Gaps
 * `computedGapKeys` reads off `lock.fragments` — the two key schemes the
 * module header's "ops rows are grammar rows" note describes.
 *
 * `bot` is the WHOLE-CORPUS set (`computedGapKeys`'s own `.bot`), never the
 * ranked slice `unclaimedBotGaps` is scoped to: a Bot Gap key whose cards fell
 * out of ranked scope while the Bot still cannot play them is "merely absent
 * from scope", not gone (`gap-kinds.ts`'s own docstring) — reading it as gone
 * here would print it as a dead signature or drop it from the residual count,
 * exactly the false "gone" the ranked scope exists to avoid drawing. `null`
 * (no report, or one that disagrees with the lockfile) reports no `bot` key
 * at all rather than risk a spurious one off the lockfile's own fallback.
 */
export function liveClusterKeys(
    lock: Pick<Lockfile, "cards" | "fragments">,
    implemented: readonly string[],
    emitted: ReadonlySet<string>,
    botFindings: ReadonlyMap<string, BotGapVerdict> | null,
    handTailMarkers: readonly (CompilerGapMarker & { readonly file: string })[]
): LiveGapKey[] {
    const computed = computedGapKeys(lock, botFindings);
    const keys: LiveGapKey[] = [];
    for (const op of implemented)
        if (!emitted.has(op)) keys.push({ kind: "grammar", key: opGapKey(op) });
    for (const key of computed.grammar) keys.push({ kind: "grammar", key });
    for (const key of computed.mechanic) keys.push({ kind: "mechanic", key });
    for (const key of computed.scenario) keys.push({ kind: "scenario", key });
    for (const key of computed.bot ?? []) keys.push({ kind: "bot", key });
    for (const marker of handTailMarkers) {
        if (marker.kind !== "hand-tail" || !isExempting(marker)) continue;
        keys.push({
            kind: "hand-tail",
            key: marker.card,
            card: handTailCardMatch(marker.file),
        });
    }
    return keys;
}

/** A live key two or more Cluster Signatures claim — the lowest issue number
 *  is the one `matchCluster` would adopt into first (ADR 0146 § Decision 3);
 *  offline, `check:gaps` cannot ask which is OPEN, so this names every match
 *  and the lowest as the would-be winner, never a verdict `gaps:sync` owes. */
export interface ClusterAmbiguity {
    readonly kind: ClusterKind;
    readonly key: string;
    /** Ascending; `issues[0]` is the lowest-numbered match. */
    readonly issues: readonly number[];
}

/** One kind's count of live, claimed keys no Cluster Signature matches — a
 *  forgotten single, ripe for `/cluster-gaps` once its kind crosses the
 *  threshold (ADR 0146 § Decision 7). Counted, never enumerated: the
 *  allowlist carries hundreds of claims and this runs on every `health`. */
export interface ResidualSingles {
    readonly kind: ClusterKind;
    readonly count: number;
}

export interface ClusterCensusResult {
    readonly ambiguities: readonly ClusterAmbiguity[];
    readonly residualSingles: readonly ResidualSingles[];
    /** Cluster issue numbers whose signature matches no live key. */
    readonly deadSignatures: readonly number[];
}

/**
 * The three halves of the census, pure over its inputs. `claims` is every
 * `(kind, key, issue)` row the allowlist carries (`ops` + `claims`,
 * {@link parseClaimRows}) — a claim whose key is not among `liveKeys` is a
 * closed or stale gap, never reported (its row stays forever; that is not
 * this census's business).
 */
export function censusClusters(
    liveKeys: readonly LiveGapKey[],
    claims: readonly ClaimRow[],
    clusters: readonly ClusterRow[]
): ClusterCensusResult {
    const ambiguities: ClusterAmbiguity[] = [];
    for (const key of liveKeys) {
        const issues = matchingClusterIssues(key, clusters);
        if (issues.length >= 2) ambiguities.push({ ...key, issues });
    }
    ambiguities.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const liveById = new Map(
        liveKeys.map((key) => [claimId(key.kind, key.key), key] as const)
    );
    const residualCounts = new Map<ClusterKind, number>();
    for (const kind of CLUSTER_KINDS) residualCounts.set(kind, 0);
    for (const row of claims) {
        if (!(CLUSTER_KINDS as readonly string[]).includes(row.kind)) continue;
        const kind = row.kind as ClusterKind;
        const live = liveById.get(claimId(kind, row.key));
        if (live === undefined) continue;
        if (matchingClusterIssues(live, clusters).length === 0)
            residualCounts.set(kind, (residualCounts.get(kind) ?? 0) + 1);
    }
    const residualSingles = CLUSTER_KINDS.map((kind) => ({
        kind,
        count: residualCounts.get(kind) ?? 0,
    }));

    const deadSignatures = clusters
        .filter((row) => !liveKeys.some((key) => signatureMatches(row, key)))
        .map((row) => row.issue)
        .sort((a, b) => a - b);

    return { ambiguities, residualSingles, deadSignatures };
}

export function renderClusterCensus(result: ClusterCensusResult): string {
    const clean =
        result.ambiguities.length === 0 &&
        result.residualSingles.every((r) => r.count === 0) &&
        result.deadSignatures.length === 0;
    if (clean)
        return (
            "✓ gaps: Gap Cluster census clean — no signature ambiguity, " +
            "no residual single, no dead signature (ADR 0146, informational)"
        );
    const lines = [
        "· gaps: Gap Cluster census (ADR 0146, informational — never red):",
        "",
    ];
    if (result.ambiguities.length === 0) {
        lines.push("  no live key matches two or more Cluster Signatures");
    } else {
        lines.push(
            `  ${result.ambiguities.length} live key(s) matched by two or more Cluster Signatures:`
        );
        for (const a of result.ambiguities)
            lines.push(
                `    - [${a.kind}] ${a.key}: #${a.issues.join(", #")} — #${a.issues[0]} would win (lowest)`
            );
    }
    lines.push(
        "",
        `  residual singles per kind: ${result.residualSingles.map((r) => `${r.kind} ${r.count}`).join(", ")}`
    );
    if (result.deadSignatures.length > 0)
        lines.push(
            "",
            `  ${result.deadSignatures.length} Cluster Signature(s) match no live key: #${result.deadSignatures.join(", #")}`
        );
    return lines.join("\n");
}

const EXITS: Record<Violation["kind"], string> = {
    missing:
        "implemented, emitted by no Compiled Definition, and NOT allowlisted.\n" +
        "    The allowlist is shrink-only — do not add a row. Land the grammar\n" +
        "    rule that emits the Op (ADR 0137, `/new-op` ends with it), or\n" +
        "    retire the Op.",
    covered:
        "now emitted by a Compiled Definition — its rule landed.\n" +
        "    Delete the row: the allowlist only shrinks.",
    "unknown-op":
        "allowlisted but not an `implemented` row of EFFECT_OP_REGISTRY.\n" +
        "    Delete the row (the Op was renamed, retired, or is `planned`).",
    duplicate: "allowlisted twice — one row per Op.",
    malformed: "malformed row.",
    grown:
        "added to the allowlist on this branch.\n" +
        "    The allowlist only shrinks (ADR 0105 § 7.3): a new Op never enters it.",
};

/** Whether `grown` was evaluated at all — printed on BOTH verdicts, so a green
 *  never hides an unrun check and a red says which checks ran. */
function baselineLine(result: CensusResult): string {
    return result.baselineChecked
        ? "shrink verified against the allowlist's previous revision"
        : "no previous revision of the allowlist — shrink check SKIPPED";
}

export function render(result: CensusResult): string {
    if (result.violations.length === 0) {
        return (
            `✓ gaps: ${result.implementedCount} implemented Ops — ` +
            `${result.emittedCount} grammar-covered, ` +
            `${result.allowlistedCount} allowlisted; ${baselineLine(result)}`
        );
    }
    const lines = [
        `✗ gaps: ${result.violations.length} violation(s) of the derived Op census:\n`,
    ];
    for (const v of result.violations) {
        const detail = v.kind === "malformed" ? ` ${v.detail}` : "";
        lines.push(`  - ${v.op}: ${EXITS[v.kind]}${detail}`);
    }
    lines.push(
        `\n  Coverage is DERIVED from \`opsUsed\` in ${LOCKFILE_PATH} ` +
            `(\`ready\` + \`quarantine\`);\n` +
            `  the allowlist is ${ALLOWLIST_PATH}; ${baselineLine(result)}.\n` +
            `  See ADR 0105 § 7.3.`
    );
    return lines.join("\n");
}

function main(): void {
    const root = resolve(".");
    const lock = parseLockfile(readFileSync(LOCKFILE_PATH, "utf8"));
    const allowlist = parseAllowlist(readFileSync(ALLOWLIST_PATH, "utf8"));
    const implemented = EFFECT_OP_REGISTRY.filter(
        (r) => r.status === "implemented"
    ).map((r) => r.op);
    const emitted = emittedOps(lock.cards);
    const result = auditOpCensus({
        implemented,
        emitted,
        allowlist,
        baseline: baselineAllowlist(root),
    });
    const findingsPath = join(root, FINDINGS_PATH);
    const findings = existsSync(findingsPath)
        ? parseFindings(readFileSync(findingsPath, "utf8"))
        : null;
    const botMerge = mergeBotVerdicts(findings, lock.cards, botHash(root));
    const inScope = inScopeBotGapKeys(
        lock.cards,
        rankedCardIds(readTargetRegistry(root), resolveContext(root, lock)),
        botMerge.merged
    );
    const claims = parseClaimRows(allowlist, ALLOWLIST_PATH);
    const unclaimed = unclaimedBotGaps(inScope, claims);
    const markers = scanFilesForCompilerGaps(
        collectSetFiles(join(root, "convex", "cards", "sets"))
    );
    const mismatches = handTailClaimMismatches(markers, claims);
    const { ok, out } = gapsVerdict(
        result,
        inScope.length,
        unclaimed,
        mismatches
    );
    const clusterCensus = renderClusterCensus(
        censusClusters(
            liveClusterKeys(
                lock,
                implemented,
                emitted,
                botMerge.merged,
                markers
            ),
            claims,
            parseClusterRows(allowlist, ALLOWLIST_PATH)
        )
    );
    if (ok) {
        console.log(`${out}\n\n${clusterCensus}`);
        return;
    }
    console.error(`${out}\n\n${clusterCensus}`);
    process.exit(1);
}

if (import.meta.main) main();
