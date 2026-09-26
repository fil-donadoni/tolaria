#!/usr/bin/env bun
/**
 * `bun run gaps:sync` — the ONE filer of every computed Gap (ADR 0137, PRD
 * issue #3820, issues #3829, #3974 and #3869). Six kinds, one allowlist
 * (`data/grammar-gaps.json`), one stable-key scheme per kind, idempotent,
 * ranked per Target:
 *
 *   grammar    a missing Grammar Rule — the derived Op census `ops` rows
 *   mechanic   a quarantine class the engine owes a mechanic
 *   scenario   a card-dependent smoke-skip class (ADR 0105 § 7.1)
 *   bot        a Bot Gap key a ranked card carries (issue #4061)
 *   hand-tail  a ranked Target card whose residual gaps ALL sit below the floor
 *   migration  graduates, clustered by the rule that unlocked them
 *
 * Each issue's number is written back — into its `ops` row for `grammar`, into
 * a `claims` row for every other kind. A second run against unchanged inputs
 * writes nothing; see `lib/gap-issues.ts`'s header for the idempotency
 * contract, the scope and the umbrella, and `lib/gap-kinds.ts`'s for the two
 * measures and the rank. It closes nothing: an issue closes through its PR.
 *
 * It parents three kinds by BAND (issue #4056): `grammar` under the Grammar
 * Rules umbrellas, `mechanic` under the Ops umbrellas, `bot` under the Bot
 * Gaps umbrellas, one per band — the band being `backlog:triage`'s cards
 * source over the cards the gap reaches (`lib/gap-issues.ts` § Parent). An
 * open issue whose band is recomputed is MOVED; residue is listed and keeps
 * its parent.
 *
 * It also wires the ONE dependency a gap can have that is not computed from the
 * corpus: an engine issue declares, in a `## Unlocks` section of its own body,
 * the gap keys it unblocks, and this writes both halves of that edge — the
 * native `blocked by` relationship the board draws, and the `## Blocked by`
 * body section `queue:plan` defers a pick on (issue #4052,
 * `lib/gap-issues.ts` § `## Unlocks`). A declared key matching no filed gap is
 * reported as residue, never dropped.
 *
 * An open `area:cards` issue naming only cards no registered Target requires
 * is never touched: it is labelled `ready-for-human` with one templated
 * comment, the two exits the owner chose (add a Target row, or `wontfix`).
 *
 * `--dry-run` prints the plan and performs no write of any kind.
 *
 * `--band <P0|P1|P2|P3>` is the ORIGIN band of the work that triggered the run
 * (issue #4158): `P0` files every partitioned gap it creates — and every
 * homeless one — under its family's P0 umbrella, the one place nothing computed
 * can reach (`lib/gap-issues.ts` § The ORIGIN band). Any other value changes
 * nothing. `land` derives it from the issue the landed branch names and passes
 * it; a P0 session running this by hand passes it itself.
 *
 * `land` runs this post-merge, non-gating, from the PRIMARY checkout — like
 * this command run by hand. It commits + pushes the allowlist update
 * straight to the base branch when it wrote one: the write is a single
 * `issue` field per row, at the same trust tier ADR 0137 already grants the
 * issue creation itself ("a deliberate exception to the loop drains the
 * queue, never fills it… these issues come from a computed gate… never a
 * subagent's judgement").
 *
 * ── Why a direct push, not a PR ───────────────────────────────────────────
 *
 * This is the one place in the repo a script commits a TRACKED file straight
 * to the base branch outside `land`'s gated merge. A gitignored ledger (like
 * `.claude/telemetry/board-priority.json`) was rejected: `check-gaps.ts`
 * quotes `row.issue` as "the open issue that closes the gap", so a session
 * picking up an Op gap reads THAT field, and a private cache the committed
 * file never saw would drift from what the allowlist claims. The write is
 * narrow: one `issue` integer per row, never the shrink-only `ops[]`
 * membership `check-gaps.ts` guards — a bad value can only point a reader at
 * the wrong issue, which the next run re-checks against the tracker.
 *
 * The tracker talks to GitHub through `lib/gh.ts`, which strips
 * `GITHUB_TOKEN` so it authenticates as the developer, never as the app's
 * bug-report PAT (same rule `queue:plan` follows). It reads a KIND's filed
 * issues in ONE list call keyed on the kind's title prefix, not one `gh issue
 * view` per row — this runs on every landing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALLOWLIST_PATH, parseAllowlist } from "./check-gaps";
import { BASE_BRANCH } from "./lib/branches";
import {
    gh,
    issueBlockedBy,
    setIssueParent,
    subIssueCount as sharedSubIssueCount,
} from "./lib/gh";
import {
    cardBandIndex,
    openCardIssueIndex,
    strongestCardBand,
} from "./lib/backlog-triage";
import {
    applyUpdatedIssues,
    bandUmbrellaOf,
    buildGrammarGapFilings,
    GAP_TITLE_PREFIX,
    OP_KEY_PREFIX,
    originUmbrellaOf,
    PARTITIONED_KINDS,
    partitionCardIndex,
    RETIRED_UMBRELLAS,
    planUnlockEdges,
    clusterIssues,
    isAdoptedFiling,
    syncGaps,
    syncUnlockEdges,
    withPartitionBands,
    withUnlockBlockers,
    type GapFiling,
    type GapTracker,
    type TrackedIssue,
    type TrackedIssueSummary,
    type UmbrellaBand,
    type UnlockSource,
} from "./lib/gap-issues";
import {
    buildGraduates,
    compilerGapCards,
    handTailMarkerIssues,
    opUserOracleIds,
} from "./lib/coverage-context";
import {
    buildBotGapFilings,
    buildFragmentGapFilings,
    buildHandTailFilings,
    buildMigrationFilings,
    buildQuarantineFilings,
    orphanCardActions,
    prioritySlices,
    enforcedCardIds,
    floorlessCardIds,
    rankedCardIds,
    registeredCardIds,
    type KindInputs,
} from "./lib/gap-kinds";
import { LOCKFILE_PATH } from "./check-gaps";
import {
    botHash,
    FINDINGS_PATH,
    mergeBotVerdicts,
    parseFindings,
    type BotGapVerdict,
} from "./lib/oracle-bot-reach";
import { parseLockfile } from "./lib/oracle-lockfile";
import {
    claimId,
    gapIndex,
    parseClaimRows,
    readTargetRegistry,
    resolveContext,
    resolveTarget,
    splitClaimId,
    type GapKind,
} from "./lib/targets";

/** Whether a failed `gh issue view` said the issue does not exist. */
export function isIssueNotFound(err: unknown): boolean {
    const e = err as { stderr?: unknown; message?: unknown };
    const text = `${String(e?.stderr ?? "")}\n${String(e?.message ?? "")}`;
    return /Could not resolve to an issue/i.test(text);
}

/** One issue as `gh issue list/view --json …,parent` returns it. */
interface GhIssueRow {
    readonly number: number;
    readonly state: string;
    readonly body: string;
    readonly parent?: { readonly number?: number } | null;
}

function trackedIssue(row: Omit<GhIssueRow, "number">): TrackedIssue {
    return {
        state: row.state === "CLOSED" ? "CLOSED" : "OPEN",
        body: row.body,
        parent: row.parent?.number ?? null,
    };
}

/** The `gh`-backed `GapTracker` — the one place this module touches the
 *  network. */
export class GhGapTracker implements GapTracker {
    private cache: Map<number, TrackedIssue> | null = null;

    /** The title prefixes to prefetch by — one list call each, set by the
     *  kinds this run actually files. */
    private readonly prefixes: readonly string[];

    constructor(prefixes: readonly string[]) {
        this.prefixes = prefixes;
    }

    /** Every issue of every filed kind, open and closed, in one call per kind.
     *  A number the lists miss falls back to a single `view`. */
    private prefetch(): Map<number, TrackedIssue> {
        if (this.cache !== null) return this.cache;
        const rows: GhIssueRow[] = [];
        for (const prefix of this.prefixes) {
            rows.push(...this.listByTitle(prefix));
        }
        this.cache = new Map(rows.map((r) => [r.number, trackedIssue(r)]));
        return this.cache;
    }

    private listByTitle(prefix: string): GhIssueRow[] {
        const out = gh([
            "issue",
            "list",
            "--search",
            `in:title "${prefix}"`,
            "--state",
            "all",
            "--limit",
            "500",
            "--json",
            "number,state,body,parent",
        ]);
        return JSON.parse(out) as GhIssueRow[];
    }

    getIssue(number: number): TrackedIssue | null {
        const hit = this.prefetch().get(number);
        if (hit !== undefined) return hit;
        try {
            const out = gh([
                "issue",
                "view",
                String(number),
                "--json",
                "state,body,parent",
            ]);
            return trackedIssue(JSON.parse(out) as Omit<GhIssueRow, "number">);
        } catch (err) {
            // Only "no such issue" means gone. Anything else — network, rate
            // limit, auth — rethrows: read as null it would file a duplicate
            // and orphan the real issue.
            if (isIssueNotFound(err)) return null;
            throw err;
        }
    }

    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
        parent: number;
    }): number {
        const args = [
            "issue",
            "create",
            "--title",
            input.title,
            "--body",
            input.body,
        ];
        for (const label of input.labels) args.push("--label", label);
        const url = gh(args).trim();
        const m = /\/issues\/(\d+)\s*$/.exec(url);
        if (m === null) {
            throw new Error(
                `gh issue create: could not read an issue number back from ${JSON.stringify(url)}`
            );
        }
        const number = Number(m[1]);
        this.setParent(number, input.parent);
        return number;
    }

    updateBody(number: number, body: string): void {
        gh(["issue", "edit", String(number), "--body", body]);
    }

    findSetUmbrella(setCode: string): number | null {
        const out = gh([
            "issue",
            "list",
            "--state",
            "open",
            "--label",
            "prd",
            "--search",
            `"[${setCode}]" in:title`,
            "--json",
            "number,title",
        ]);
        const rows = JSON.parse(out) as { number: number; title: string }[];
        const re = new RegExp(`^\\[${setCode}\\]`, "i");
        return rows.find((r) => re.test(r.title))?.number ?? null;
    }

    listOpen(label: string): readonly TrackedIssueSummary[] {
        const out = gh([
            "issue",
            "list",
            "--state",
            "open",
            "--label",
            label,
            "--limit",
            "500",
            "--json",
            "number,title,labels",
        ]);
        const rows = JSON.parse(out) as {
            number: number;
            title: string;
            labels: { name: string }[];
        }[];
        return rows.map((row) => ({
            number: row.number,
            title: row.title,
            labels: row.labels.map((l) => l.name),
        }));
    }

    addLabel(number: number, label: string): void {
        gh(["issue", "edit", String(number), "--add-label", label]);
    }

    comment(number: number, body: string): void {
        gh(["issue", "comment", String(number), "--body", body]);
    }

    /** One search call, not one read per open issue: the `## Unlocks` section
     *  is rare and the queue is hundreds of issues deep. Search tokenizes, so
     *  this over-fetches (any body saying "unlocks") and `parseUnlocks`
     *  decides — the other direction, a missed declaration, would silently
     *  drop an edge. */
    listUnlockSources(): readonly UnlockSource[] {
        const limit = 1000;
        const out = gh([
            "issue",
            "list",
            "--search",
            '"## Unlocks" in:body',
            "--state",
            "open",
            "--limit",
            String(limit),
            "--json",
            "number,body",
        ]);
        const rows = JSON.parse(out) as UnlockSource[];
        // FAIL CLOSED on a full page, like `subIssueCount`. This list is the
        // sole authority on what unlocks what, and the `## Blocked by` section
        // is composed INTO each gap body — so a TRUNCATED answer is not "fewer
        // edges", it is `syncGaps` stripping the section from every gap whose
        // declaration fell off the page while the native edge stays, leaving
        // the two halves out of parity and a body edit owed on every run.
        if (rows.length >= limit) {
            throw new Error(
                `gaps:sync: the \`## Unlocks\` search returned ${rows.length} issue(s), which is the whole page — raise the limit or paginate; a truncated list would strip the section from the gaps it missed`
            );
        }
        return rows;
    }

    /** Paginated (`issueBlockedBy`): this is both the idempotency check and
     *  `addBlockedBy`'s only proof that the write took, and `gh api` pages at
     *  30 — past that a freshly written edge falls off page one and the write
     *  reads as failed. Shared with the queue lint's parity rule since issue
     *  #3794; one reader, so the pagination rule cannot be re-learned. */
    blockedBy(issue: number): readonly number[] {
        return issueBlockedBy(issue);
    }

    /**
     * `gh issue edit --add-blocked-by` exits non-zero with `failed to update 1
     * issue` when SOME of the listed edges already exist, and the REST layer
     * answers `Target issue has already been taken` — so the exit code says
     * nothing in either direction and the read-back is the only check
     * (`/to-tickets`' own rule).
     *
     * A native edge cannot target a PR (`Could not resolve to an Issue`); every
     * blocker here comes from `gh issue list`, which never returns one.
     */
    addBlockedBy(issue: number, blocker: number): void {
        try {
            gh([
                "issue",
                "edit",
                String(issue),
                "--add-blocked-by",
                String(blocker),
            ]);
        } catch {
            // Read-back below is the real check either way.
        }
        if (!this.blockedBy(issue).includes(blocker)) {
            throw new Error(
                `gaps:sync: could not wire issue #${issue} blocked by issue #${blocker}`
            );
        }
    }

    subIssueCount(parent: number): number {
        // Fail closed: a missing field read as 0 would let the cap check pass.
        try {
            return sharedSubIssueCount(parent);
        } catch (err) {
            throw new Error(`gaps:sync: ${(err as Error).message}`);
        }
    }

    setParent(child: number, parent: number): void {
        if (!setIssueParent(child, parent)) {
            console.error(
                `gaps:sync: could not confirm issue #${child}'s parent is #${parent} after 3 attempts`
            );
        }
    }
}

/**
 * Every OPEN issue's number and body, for the `## Cards` adoption index (issue
 * #4515). FAILS CLOSED on a full page: a truncated list is not "fewer
 * adoptions", it is a duplicate filed for a card whose issue fell off the page.
 */
export function listOpenIssueBodies(): { number: number; body: string }[] {
    const limit = 2000;
    const rows = JSON.parse(
        gh([
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            String(limit),
            "--json",
            "number,body",
        ])
    ) as { number: number; body: string }[];
    if (rows.length >= limit) {
        throw new Error(
            `gaps:sync: the open-issue list returned ${rows.length} issue(s), which is the whole page — raise the limit or paginate; a truncated list would file a duplicate for a card whose issue it missed`
        );
    }
    return rows;
}

/** Commit + push the allowlist update straight to `origin/<base>`, from a
 *  clean primary checkout already on that branch. Never throws: `land`
 *  treats this whole script as non-gating — but it prints, so a human
 *  notices the file drifted from the remote. */
export function commitAndPushAllowlist(root: string): void {
    const git = (args: string[]) =>
        spawnSync("git", args, { cwd: root, encoding: "utf8" });
    const add = git(["add", "--", ALLOWLIST_PATH]);
    if (add.status !== 0) {
        console.error(
            `gaps:sync: could not stage ${ALLOWLIST_PATH}: ${add.stderr}`
        );
        return;
    }
    const commit = git([
        "commit",
        "-q",
        "-m",
        "gaps:sync — file per-gap issues, record them in the allowlist",
        // Pathspec, never a bare `git commit`: this runs in the PRIMARY
        // checkout and pushes straight to the base branch, so anything else
        // staged there would ride along (review of PR #3978).
        "--",
        ALLOWLIST_PATH,
    ]);
    if (commit.status !== 0) {
        console.error(
            `gaps:sync: could not commit ${ALLOWLIST_PATH}: ${commit.stderr}`
        );
        return;
    }
    const push = git(["push", "origin", `HEAD:${BASE_BRANCH}`]);
    if (push.status !== 0) {
        console.error(
            `gaps:sync: could not push the allowlist update to ${BASE_BRANCH}: ${push.stderr}`
        );
    }
}

/**
 * Every filing of every kind, in the order they are reported — the ONE place
 * the six kinds of issue #3869 are assembled. `hand-tail` is gated by the
 * registry's `handTailFiling` flag and files only for `enforced` Targets'
 * cards (issue #4219); the other kinds file from day one.
 */
export function buildAllFilings(
    root: string,
    lock: ReturnType<typeof parseLockfile>,
    allowlist: ReturnType<typeof parseAllowlist>,
    registry: ReturnType<typeof readTargetRegistry>,
    ctx: ReturnType<typeof resolveContext>,
    /** The Bot Reach Findings report merged over the lockfile (issue #4406) —
     *  absent exactly when `data/bot-reach-findings.json` is missing. */
    botFindings?: ReadonlyMap<string, BotGapVerdict>,
    /** Oracle id → the open issue naming the card in its `## Cards` section
     *  (issue #4515) — what a card-keyed claim adopts instead of filing. */
    openCardIssues?: ReadonlyMap<string, number>
): {
    filings: GapFiling[];
    handTailHeld: readonly GapFiling[];
    filed: ReadonlyMap<string, number>;
    settledHandTail: SettledHandTail;
} {
    const filed = new Map(
        parseClaimRows(allowlist, ALLOWLIST_PATH).map(
            (row) => [claimId(row.kind, row.key), row.issue] as const
        )
    );
    const slices = prioritySlices(registry, ctx);
    // priority ∪ enforced: `check:targets` reds an enforced Target's
    // below-floor card, so it needs a filer even with no priority.
    const ranked = rankedCardIds(registry, ctx, slices);
    const markerIssues = handTailMarkerIssues(root, ctx.byName);
    const inputs: KindInputs = {
        lock,
        slices,
        ranked,
        filed,
        floor: registry.handTailFloor,
        handTailFiling: registry.handTailFiling,
        enforced: enforcedCardIds(registry, ctx),
        floorless: floorlessCardIds(registry, ctx),
        handTail: new Set(markerIssues.keys()),
        botFindings,
        openCardIssues,
        ...gapIndex(lock),
    };
    const handTail = buildHandTailFilings(inputs);
    // The band partition (issue #4056): the triage's own cards source, over
    // EVERY registered Target — the same index `backlog:triage` builds.
    const index = cardBandIndex(
        registry.targets.map((row) => ({
            id: row.id,
            ids: resolveTarget(row, ctx).cards.map((c) => c.oracleId),
        }))
    );
    const reached = partitionCardIndex(
        lock,
        opUserOracleIds(ctx.byName),
        inputs.gapKeys
    );
    const filings = withPartitionBands(
        [
            ...buildGrammarGapFilings(allowlist),
            ...buildFragmentGapFilings(inputs),
            ...buildQuarantineFilings(inputs, "mechanic"),
            ...buildQuarantineFilings(inputs, "scenario"),
            ...buildBotGapFilings(inputs),
            ...handTail.filings,
            ...buildMigrationFilings(inputs, buildGraduates(root, ctx)),
        ],
        (filing) =>
            strongestCardBand(
                reached.get(claimId(filing.kind, filing.key)) ?? [],
                index
            )?.target ?? null
    );
    return {
        filings,
        handTailHeld: handTail.held,
        filed,
        settledHandTail: settledHandTailOf(lock, markerIssues, inputs.gapKeys),
    };
}

/**
 * What the stale report needs to tell a SETTLED `hand-tail` claim from a gone
 * one (issue #4513) — both keyed by the card's lockfile name, the claim key.
 * Offline: the markers already parsed and the lockfile, no issue-state lookup.
 */
export interface SettledHandTail {
    /** Card → the issue its well-formed `hand-tail:` marker names. */
    readonly markerIssue: Map<string, number>;
    /** Cards still `unparsed` with at least one residual Grammar Gap. */
    readonly residual: Set<string>;
}

/**
 * {@link SettledHandTail} from the lockfile and the `hand-tail:` markers
 * (oracle id → issue), re-keyed by card name.
 */
export function settledHandTailOf(
    lock: Pick<ReturnType<typeof parseLockfile>, "cards">,
    markerIssues: ReadonlyMap<string, number>,
    gapKeys: KindInputs["gapKeys"]
): SettledHandTail {
    const settled: SettledHandTail = {
        markerIssue: new Map(),
        residual: new Set(),
    };
    for (const row of lock.cards) {
        const issue = markerIssues.get(row.oracleId);
        if (issue !== undefined) settled.markerIssue.set(row.name, issue);
        if (row.state === "unparsed" && gapKeys(row).length > 0)
            settled.residual.add(row.name);
    }
    return settled;
}

/** One row of the stale-claims report. */
export type StaleClaim =
    | { kind: GapKind; key: string; issue: number }
    /** A `hand-tail` claim whose card is hand-written under ANOTHER issue's
     *  marker: the claim's own issue may be an open orphan. */
    | { kind: "hand-tail"; key: string; issue: number; settledBy: number };

/**
 * A `claims` row no filing referenced this run: the gap it names is gone, but
 * rows are never pruned (`applyUpdatedIssues`), so its issue is open and no
 * longer updated by anything. Printed, never acted on — closing it is a
 * human's call, and `gaps:sync` closes nothing.
 *
 * A `hand-tail` row is not filed again once its card is hand-written under a
 * `hand-tail:` marker, yet its gap is still there (issue #4513): while the
 * card keeps a residual gap, a marker naming the claim's own issue is silent,
 * and one naming ANOTHER issue comes back with `settledBy` — the claim's
 * issue is a possible open orphan. A card with no residual gap left is stale
 * whatever its marker says.
 */
export function staleClaims(
    filed: ReadonlyMap<string, number>,
    filings: readonly GapFiling[],
    settled: SettledHandTail = { markerIssue: new Map(), residual: new Set() }
): StaleClaim[] {
    const live = new Set(filings.map((f) => claimId(f.kind, f.key)));
    const out: StaleClaim[] = [];
    for (const [id, issue] of filed) {
        if (live.has(id)) continue;
        const { kind, key } = splitClaimId(id);
        if (kind === "grammar" && key.startsWith(OP_KEY_PREFIX)) continue; // `check:gaps` owns the ops rows.
        const marker = settled.markerIssue.get(key);
        if (
            kind === "hand-tail" &&
            marker !== undefined &&
            settled.residual.has(key)
        ) {
            if (marker !== issue)
                out.push({ kind, key, issue, settledBy: marker });
            continue;
        }
        out.push({ kind, key, issue });
    }
    return out;
}

/** The bands `--band` accepts — the board's whole `Priority` axis. */
const ORIGIN_BANDS: readonly UmbrellaBand[] = ["P0", "P1", "P2", "P3"];

/**
 * `--band <B>` / `--band=<B>` from `argv`, or `undefined` when absent. An
 * unknown value THROWS: the flag is the only channel that puts a gap into a
 * hand-set P0 umbrella, and a typo read as "no band" would file it one band
 * too low without a word (the failure this flag exists to end).
 */
export function parseOriginBand(
    argv: readonly string[]
): UmbrellaBand | undefined {
    const at = argv.findIndex((a) => a === "--band" || a.startsWith("--band="));
    if (at === -1) return undefined;
    const arg = argv[at]!;
    const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[at + 1];
    if (!ORIGIN_BANDS.includes(value as UmbrellaBand))
        throw new Error(
            `gaps:sync: --band takes one of ${ORIGIN_BANDS.join(", ")}, got ${value === undefined ? "nothing" : `"${value}"`}`
        );
    return value as UmbrellaBand;
}

function main(): void {
    const root = resolve(".");
    const dryRun = process.argv.includes("--dry-run");
    let originBand: UmbrellaBand | undefined;
    try {
        originBand = parseOriginBand(process.argv.slice(2));
    } catch (err) {
        console.error((err as Error).message);
        process.exit(2);
    }
    if (originBand !== undefined)
        console.log(
            originBand === "P0"
                ? "origin     band P0 — every gap created (or homeless) in this run files under its family's P0 umbrella"
                : `origin     band ${originBand} — no effect: only P0 overrides the computed band`
        );
    if (!existsSync(join(root, LOCKFILE_PATH))) {
        console.error(`${LOCKFILE_PATH} missing — run: bun run oracle:compile`);
        process.exit(1);
    }
    const lock = parseLockfile(readFileSync(join(root, LOCKFILE_PATH), "utf8"));
    const allowlist = parseAllowlist(
        readFileSync(join(root, ALLOWLIST_PATH), "utf8")
    );
    const registry = readTargetRegistry(root);
    const ctx = resolveContext(root, lock);

    // The Bot Reach Findings report (issue #4175) merged over the lockfile
    // (issue #4406) — the `bot` kind's second input, absent exactly when the
    // committed artifact is missing (a checkout that predates it, or a
    // narrowed local run that wrote its measurement elsewhere).
    const findingsPath = join(root, FINDINGS_PATH);
    const findings = existsSync(findingsPath)
        ? parseFindings(readFileSync(findingsPath, "utf8"))
        : null;
    // Freshly computed, never the lockfile's own header: that field only
    // catches up the next time `oracle:compile` REPLAYS a card, so it can
    // lag behind the Bot's actual source for arbitrarily long between full
    // compiler runs (`mergeBotVerdicts`'s own doc).
    const botMerge = mergeBotVerdicts(findings, lock.cards, botHash(root));
    if (botMerge.stale.length > 0) {
        const nameOf = new Map(lock.cards.map((c) => [c.oracleId, c.name]));
        const names = botMerge.stale
            .map((id) => nameOf.get(id) ?? id)
            .slice(0, 20);
        console.log(
            `stale      ${FINDINGS_PATH}: ${botMerge.stale.length} row(s) disagree with the lockfile ` +
                "(Bot hash or definition hash moved since `bot:reach` last ran) — falling back to the " +
                `lockfile's own verdict, filing nothing from them: ${names.join(", ")}` +
                (botMerge.stale.length > names.length ? ", …" : "") +
                " — re-run `bun run bot:reach` to refresh"
        );
    }

    // Read before anything is filed, and a failed read THROWS: a card-keyed
    // claim adopts the open issue already naming the card (issue #4515), so an
    // empty index read as authoritative would file the duplicate. A dry run
    // makes no network call, so it previews without adoption.
    const openCardIssues = dryRun
        ? undefined
        : openCardIssueIndex(
              listOpenIssueBodies(),
              (name) => ctx.byName.get(name)?.oracleId
          );

    const { filings, handTailHeld, filed, settledHandTail } = buildAllFilings(
        root,
        lock,
        allowlist,
        registry,
        ctx,
        botMerge.merged,
        openCardIssues
    );

    // Reported whether or not filing is on — but a SUMMARY, plus one line per
    // card that is actually news: a hand-WRITTEN card whose `compiler-gap:`
    // names a gap that has since fallen below the floor. Its marker claims a
    // debt the grammar no longer has; the closing PR flips it to `hand-tail:`.
    if (handTailHeld.length > 0) {
        console.log(
            `hand-tail  ${handTailHeld.length} ranked card(s) below the floor of ${registry.handTailFloor}; not filed ` +
                (registry.handTailFiling
                    ? "(outside every `enforced` Target, issue #4219)"
                    : "(data/targets.json `handTailFiling`: false)")
        );
    }
    // Held AND filed cards alike: an enforced card with a stale marker is in
    // `filings`, and the nudge is exactly what its closing PR needs.
    const marked = compilerGapCards(root);
    for (const f of [
        ...handTailHeld,
        ...filings.filter((f) => f.kind === "hand-tail"),
    ].filter((f) => marked.has(f.key))) {
        console.log(
            `hand-tail  ${f.key} — its \`compiler-gap:\` marker names a gap now below the floor; flip it to \`hand-tail:\``
        );
    }
    for (const stale of staleClaims(filed, filings, settledHandTail)) {
        console.log(
            "settledBy" in stale
                ? `settled    hand-tail claim \`${stale.key}\` -> issue #${stale.issue} — the card is settled by #${stale.settledBy}; close #${stale.issue} if still open`
                : `stale      ${stale.kind} claim \`${stale.key}\` -> issue #${stale.issue} — the gap is gone; the row stays, the issue is nobody's now`
        );
    }

    // Residue of the Target partition: no ranked Target among the cards it
    // reaches. Listed, never swept into an umbrella — it keeps its parent.
    const bandResidue = filings.filter(
        (f) =>
            PARTITIONED_KINDS[f.kind] !== undefined &&
            bandUmbrellaOf(f) === null
    );
    for (const f of bandResidue) {
        const at =
            f.currentIssue === null ? "unfiled" : `issue #${f.currentIssue}`;
        const why =
            f.target === undefined || f.target === null
                ? "no ranked Target among the cards it reaches"
                : `its Target \`${f.target}\` has no umbrella in BAND_UMBRELLAS — add the family's row (docs/agents/issue-tracker.md)`;
        console.log(
            `residue    ${f.kind} \`${f.key}\` (${at}) — ${why}; no Target umbrella: it keeps its parent (none, or a retired one: it moves to its family's lowest-ranked Target umbrella — or its P0 umbrella when this run has --band P0)`
        );
    }

    if (dryRun) {
        const clusters = clusterIssues(allowlist);
        for (const filing of filings) {
            const at =
                filing.currentIssue === null
                    ? "would CREATE"
                    : clusters.has(filing.currentIssue)
                      ? `would leave Grammar Cluster issue #${filing.currentIssue} alone`
                      : `would reconcile issue #${filing.currentIssue}`;
            const origin = originUmbrellaOf(filing, originBand);
            const umbrella = bandUmbrellaOf(filing);
            const band =
                origin !== null && filing.currentIssue === null
                    ? ` [origin P0 -> #${origin}]`
                    : umbrella === null
                      ? ""
                      : ` [${filing.target} -> #${umbrella}]`;
            console.log(
                `${filing.kind.padEnd(10)} ${at}${band}: ${filing.title}`
            );
        }
        console.log(
            "unlocks    skipped — reading the `## Unlocks` declarations is a network call, and --dry-run makes none"
        );
        console.log(
            `gaps:sync --dry-run: ${filings.length} filing(s), 0 writes`
        );
        return;
    }

    const prefixes = [...new Set(filings.map((f) => GAP_TITLE_PREFIX[f.kind]))];
    const tracker = new GhGapTracker(prefixes);

    // The `## Unlocks` pass reads BEFORE anything is written, and a failed read
    // throws rather than degrading to "nothing unlocks anything": the blockers
    // compose the `## Blocked by` section INTO each body, so an empty map read
    // as authoritative would have `syncGaps` strip every section it wrote last
    // run — one body edit per run, forever (`lib/gap-issues.ts` § `## Unlocks`).
    const { blockers, residue } = planUnlockEdges(
        tracker.listUnlockSources(),
        new Set(filings.map((f) => claimId(f.kind, f.key)))
    );
    for (const row of residue) {
        const why =
            row.reason === "unreadable"
                ? "no gap key could be read from it — a declaration is a key, never prose"
                : "matches no filed gap — check the key against `data/grammar-gaps.json`";
        console.log(
            `unlocks    residue issue #${row.issue}: \`${row.line}\` — ${why}`
        );
    }

    const result = syncGaps(
        withUnlockBlockers(filings, blockers),
        tracker,
        originBand,
        clusterIssues(allowlist)
    );

    const counts = new Map<string, number>();
    for (const action of result.actions) {
        counts.set(action.action, (counts.get(action.action) ?? 0) + 1);
        if (action.action !== "noop") {
            console.log(
                `${action.kind.padEnd(10)} ${action.action.padEnd(11)} ${action.key} -> issue #${action.issue}` +
                    (action.parent === undefined
                        ? ""
                        : ` (parent #${action.parent})`)
            );
        }
    }
    for (const move of result.moves) {
        console.log(
            `${move.kind.padEnd(10)} move        ${move.key} -> issue #${move.issue}: parent ${move.from === null ? "none" : `#${move.from}`} -> #${move.to}`
        );
    }
    console.log(
        `gaps:sync: ${[...counts].map(([k, n]) => `${n} ${k}`).join(", ") || "no gaps"}; ` +
            `${result.moves.length} re-parented (${result.moves.filter((m) => m.from !== null && RETIRED_UMBRELLAS.has(m.from)).length} out of a retired umbrella), ${bandResidue.length} partition residue`
    );

    // The write-back comes FIRST, before any further network step: `syncGaps`
    // may have created issues, and a throw between the create and the write
    // leaves the tracker holding issues the allowlist never recorded — the
    // next run would file every one of them again (review of PR #3978).
    if (result.updatedRows.size > 0) {
        const updated = applyUpdatedIssues(allowlist, result.updatedRows);
        writeFileSync(
            join(root, ALLOWLIST_PATH),
            `${JSON.stringify(updated, null, 4)}\n`
        );
        console.log(
            `gaps:sync: ${result.updatedRows.size} allowlist row(s) updated in ${ALLOWLIST_PATH}`
        );
        commitAndPushAllowlist(root);
    }

    // The NATIVE half of every `## Unlocks` edge, after the write-back: the
    // body half rode in on the filing above, and a gap created moments ago has
    // its number only now. Its own try/catch, like the orphan pass — every
    // filing is already recorded, and an unwired edge is re-tried next run.
    try {
        // An adopted issue's body is somebody else's and is never rewritten
        // (issue #4515), so it never gets the `## Blocked by` half of an edge:
        // wiring the native half alone would leave the two out of parity.
        const adopted = new Set(
            filings.filter(isAdoptedFiling).map((f) => claimId(f.kind, f.key))
        );
        const issueOf = new Map(
            result.actions
                .filter(
                    (a) =>
                        a.action !== "skip-closed" &&
                        !adopted.has(claimId(a.kind, a.key))
                )
                .map((a) => [claimId(a.kind, a.key), a.issue] as const)
        );
        const edges = syncUnlockEdges(blockers, issueOf, tracker);
        const count = (action: string) =>
            edges.filter((e) => e.action === action).length;
        for (const edge of edges) {
            if (edge.action === "link") {
                console.log(
                    `unlocks    link        issue #${edge.blocked} blocked by issue #${edge.blocker}`
                );
            } else if (edge.action === "skip-self") {
                console.log(
                    `unlocks    skip-self   issue #${edge.blocked} declares the gap it IS — no edge, an issue cannot block itself`
                );
            }
        }
        console.log(
            `gaps:sync: unlocks pass — ${count("link")} edge(s) wired, ` +
                `${count("noop")} already there, ${count("skip-self")} self-declared, ${residue.length} residue`
        );
    } catch (err) {
        console.error(
            `gaps:sync: the \`## Unlocks\` edge pass failed (${(err as Error).message}) — every filing above is already recorded`
        );
    }

    // Orphan card issues — the two exits the owner chose (issue #3869). Its
    // own try/catch: it labels and comments, it records nothing, so a failure
    // here must not look like a failed filing pass.
    try {
        const registered = registeredCardIds(registry, ctx);
        const open = tracker.listOpen("area:cards");
        const actions = orphanCardActions(
            open,
            (name) => ctx.byName.get(name)?.oracleId,
            registered
        );
        for (const orphan of actions) {
            tracker.addLabel(orphan.issue, "ready-for-human");
            tracker.comment(orphan.issue, orphan.comment);
            console.log(
                `orphan     ready-for-human issue #${orphan.issue} — ${orphan.cards.join(", ")} is required by no registered Target`
            );
        }
        console.log(
            `gaps:sync: orphan pass — ${open.length} open \`area:cards\` issue(s), ${actions.length} handed to ready-for-human ` +
                `(${registered.size} oracle ids are required by some registered Target)`
        );
    } catch (err) {
        console.error(
            `gaps:sync: the orphan-card pass failed (${(err as Error).message}) — every filing above is already recorded`
        );
    }
}

if (import.meta.main) main();
