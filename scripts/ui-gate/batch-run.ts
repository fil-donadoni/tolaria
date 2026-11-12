/**
 * `bun run check:ui -- --batch=<PR#,…> [--write-receipts]` — ONE walk for
 * several UI PRs (issue #9106). The receipt's grammar and the attribution are
 * pure and live in `batch-receipt.ts`; this file is the git/gh/process glue.
 *
 *   1. fetch every PR's head; a PR that is not open against the base branch
 *      is dropped and said so;
 *   2. build a DETACHED worktree: the base tip, then each head merged with
 *      `git merge --no-ff` in the order given; a conflict aborts that merge,
 *      drops that PR and says so — the batch goes on without it;
 *   3. derive each merged PR's own scope (`landingDiffScope` over its own
 *      diff, placed in the merged tree's import graph); a PR whose scope is
 *      FULL or undecided cannot ride a SCOPED walk — dropped, and the tree is
 *      rebuilt without it;
 *   4. `worktree:init` the tree and run `check:ui` INSIDE it with
 *      `--base=<base sha> --batch-heads=…`: a SCOPED walk of the union whose
 *      banner reads `BATCH` and names every head with its content digest;
 *   5. attribute every red surface to the PRs whose scope holds it
 *      (`attributeBatch`); a surface several PRs reach is re-walked on each
 *      candidate ALONE (base + that head, `--surface=` — a DIAGNOSTIC, never
 *      a receipt) and settled (`settleAmbiguous`); a surface still owned
 *      by no PR (an orphan) is walked on merge-order prefixes — the base,
 *      base + head₁, … — and the first prefix measuring `FAIL` blames its
 *      last head (`settleOrphans`, issue #9265);
 *   6. every clean PR gets the BATCH receipt for the surfaces that passed —
 *      printed, and written into its body between the batch-receipt markers
 *      with `--write-receipts`; every red PR is named with its red lines.
 *
 * Exit: 0 every PR clean · 1 a PR red, dropped, or unproven · 2 usage · the
 * walk's own infra codes (3 deployment down, 4 skew) pass through unchanged.
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "../lib/branches.ts";
import { gh } from "../lib/gh.ts";
import { domReachablePaths } from "../lib/ui-scope.ts";
import {
    attributeBatch,
    domDigest,
    settleOrphans,
    formatBatchHead,
    parseBatchBanner,
    settleAmbiguous,
    withBatchReceipt,
    type BatchAttribution,
    type BatchHead,
    type CombinationBreak,
    type PrefixProbe,
    type DomEntry,
} from "./batch-receipt.ts";
import { verdictDigestLines } from "./receipt.ts";
import {
    extractVerdictBlock,
    landableEvaluation,
    landingDiffScope,
    LANE_VOCABULARY,
    type ReceiptVocabulary,
} from "./verify-receipt.ts";

/** Flags the batch hands through to the walk unchanged. Everything that
 *  picks the scope (`--all`, `--surface=`, `--viewport=`, `--base=`,
 *  `--scope-only`) contradicts a batch: the batch IS the scope. */
const PASSTHROUGH = [
    /^--parallel=/,
    /^--serve=/,
    /^--headed$/,
    /^--keep-user$/,
    /^--raster-dump=/,
];

/** The walk's flags for the merged tree, from the batch's own argv. Throws
 *  on a flag a batch cannot honour. Pure. */
export function batchPassthrough(argv: readonly string[]): string[] {
    const out: string[] = [];
    for (const arg of argv) {
        if (arg.startsWith("--batch=") || arg === "--write-receipts") continue;
        if (arg === "--no-publish") continue; // always set on the walk
        if (PASSTHROUGH.some((re) => re.test(arg))) {
            out.push(arg);
            continue;
        }
        throw new Error(
            `${arg} cannot ride a --batch walk: the batch derives its own scope from the PRs it merges`
        );
    }
    return out;
}

/**
 * The three digest lines a clean PR carries (`receipt.ts`
 * `verdictDigestLines`), for the surfaces the batch walk passed — the exact
 * lines `verify-receipt` re-derives from the same banner. When every surface
 * passed they are the lines the walk printed. Pure.
 */
export function batchReceiptLines(
    surfaces: readonly string[],
    base: string,
    heads: readonly BatchHead[],
    vocab: ReceiptVocabulary = LANE_VOCABULARY
): string[] {
    return verdictDigestLines(
        landableEvaluation(surfaces, vocab, {
            base,
            surfaces,
            batch: heads,
        })
    );
}

type Log = (message: string) => void;

/** What one batch settled, per PR — the collector's input (issue #9122). */
export interface BatchOutcome {
    /** Receipt-bearing PRs (written with `--write-receipts`). */
    clean: number[];
    /** PR → its red lines. */
    red: Map<number, string[]>;
    /** PRs the batch could not carry, each with the reason it logged (not
     *  open against the base, a merge conflict, a FULL / undecided scope). */
    dropped: DroppedPr[];
    /** PRs whose scope holds a red surface no PR owns, and the PRs merged
     *  after a combination break's culprit. */
    unproven: number[];
    /** The base sha the batch merged onto (issue #9264: a transient hold is
     *  retried once the base moves). */
    base: string;
    /** Surfaces red only in combination, each with the head that completes
     *  the break (issue #9265). */
    combination?: CombinationBreak[];
    /** Orphans green on every merge-order prefix (issue #9265). */
    nonReproducible?: string[];
}

/** A PR the batch could not carry, and why (issue #9210). */
export interface DroppedPr {
    pr: number;
    reason: string;
    /** A property of the head itself (not open against the base, a FULL /
     *  undecided scope) — true until a new push; otherwise (a fetch error, a
     *  conflict with a sibling) the next base may carry it (issue #9264). */
    intrinsic?: boolean;
}

interface Merged {
    head: BatchHead;
    /** The PR's own changed paths, base…head. */
    changed: string[];
}

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed: ${(r.stderr || "").trim()}`
        );
    }
    return r.stdout;
}

function tryGit(args: string[], cwd: string): boolean {
    return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
}

/** Fetch PR `pr`'s head, or the reason (logged) it cannot ride. */
function fetchHead(
    pr: number,
    root: string,
    log: Log
): { pr: number; sha: string } | DroppedPr {
    const drop = (reason: string): DroppedPr => {
        log(`batch: dropped #${pr} — ${reason}`);
        return { pr, reason };
    };
    let info: { state: string; baseRefName: string; headRefOid: string };
    try {
        info = JSON.parse(
            gh([
                "pr",
                "view",
                String(pr),
                "--json",
                "state,baseRefName,headRefOid",
            ])
        );
    } catch (err) {
        return drop((err as Error).message);
    }
    if (info.state !== "OPEN" || info.baseRefName !== BASE_BRANCH) {
        return {
            ...drop(
                `${info.state}, base ${info.baseRefName} (a batch merges open PRs against ${BASE_BRANCH})`
            ),
            intrinsic: true,
        };
    }
    if (!tryGit(["fetch", "--quiet", "origin", `pull/${pr}/head`], root)) {
        return drop(`could not fetch pull/${pr}/head`);
    }
    if (!tryGit(["cat-file", "-e", `${info.headRefOid}^{commit}`], root)) {
        return drop(
            `head ${info.headRefOid} not present after the fetch (pushed mid-run?)`
        );
    }
    return { pr, sha: info.headRefOid };
}

/** The PR's own changed paths and its content digest at the head. The same
 *  digest `verify-receipt`'s `landingDomDigest` computes over a landing tree. */
function headIdentity(
    pr: number,
    sha: string,
    baseSha: string,
    root: string
): Merged {
    const changed = git(
        ["diff", "-z", "--name-only", `${baseSha}...${sha}`],
        root
    )
        .split("\0")
        .filter(Boolean);
    const entries: DomEntry[] = domReachablePaths(changed).map((p) => {
        const line = git(["ls-tree", sha, "--", p], root).trim();
        // `<mode> blob <id>\t<path>`; absent = the head deletes it.
        const blob = line === "" ? null : line.split(/\s+/)[2];
        return { path: p, blob };
    });
    return { head: { pr, sha, dom: domDigest(entries) }, changed };
}

/** A detached worktree at `baseSha` with each head merged, in order. A
 *  conflicting head is aborted and dropped (into `dropped`, when given). */
function buildTree(
    dir: string,
    baseSha: string,
    heads: readonly Merged[],
    root: string,
    log: Log,
    dropped?: DroppedPr[]
): Merged[] {
    git(["worktree", "add", "--quiet", "--detach", dir, baseSha], root);
    const merged: Merged[] = [];
    for (const m of heads) {
        const ok = tryGit(
            [
                "-c",
                "user.name=check:ui batch",
                "-c",
                "user.email=check-ui-batch@localhost",
                "merge",
                "--no-ff",
                "--quiet",
                "-m",
                `check:ui batch: merge #${m.head.pr}`,
                m.head.sha,
            ],
            dir
        );
        if (!ok) {
            tryGit(["merge", "--abort"], dir);
            const reason =
                "its head conflicts with the batch so far; walk it alone or in another batch";
            log(`batch: dropped #${m.head.pr} — ${reason}`);
            dropped?.push({ pr: m.head.pr, reason });
            continue;
        }
        merged.push(m);
    }
    return merged;
}

function removeTree(dir: string, root: string): void {
    tryGit(["worktree", "remove", "--force", dir], root);
    fs.rmSync(dir, { recursive: true, force: true });
}

/** Run the walk inside `dir`, streaming it to `log`, and keep its output. */
function walk(
    dir: string,
    args: readonly string[],
    log: Log
): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
        const child = spawn(
            "bun",
            [path.join("scripts", "ui-gate", "index.ts"), ...args],
            { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }
        );
        let output = "";
        const take = (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            output += text;
            process.stdout.write(text);
        };
        child.stdout.on("data", take);
        child.stderr.on("data", take);
        child.on("error", (err) => {
            log(`batch: the walk in ${dir} could not start — ${err.message}`);
            resolve({ code: 2, output });
        });
        child.on("close", (code) => {
            log(`batch: walk in ${dir} exited ${code}`);
            resolve({ code: code ?? 2, output });
        });
    });
}

function initTree(dir: string, log: Log): void {
    const r = spawnSync("bun", ["run", "--silent", "worktree:init"], {
        cwd: dir,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) {
        throw new Error(
            `worktree:init failed in ${dir}: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" / ")}`
        );
    }
    log(`batch: ${dir} initialised`);
}

function newTreeDir(label: string): string {
    return path.join(
        os.tmpdir(),
        `tolaria-ui-batch-${label}-${process.pid}-${Date.now().toString(36)}`
    );
}

/**
 * The surfaces a solo `--surface=` re-walk MEASURED red (issue #9210): a
 * `FAIL` row or a failed assertion. An `UNWALKED` or `INFRA` row measured
 * nothing — the solo walk could not reach the surface, or the machine cut it
 * short — so it attributes nothing: the surface stays an orphan and the PR
 * ends UNPROVEN, never RED. Pure.
 */
export function redSurfacesOf(output: string): string[] {
    const { block } = extractVerdictBlock(output, LANE_VOCABULARY);
    if (!block) return [];
    const red = new Set<string>();
    for (const r of block.rows) if (r.verdict === "FAIL") red.add(r.surface);
    for (const a of block.assertRows)
        if (a.verdict === "FAIL") red.add(a.surface);
    return [...red];
}

/**
 * Each surface of `surfaces` as one prefix walk measured it (issue #9265):
 * `fail` with its red lines on a measured `FAIL` row or failed assertion;
 * `pass` when it has rows and every one passed; `unsettled` otherwise (an
 * `UNWALKED` / `INFRA` row, no row, no verdict block). Pure.
 */
export function prefixProbesOf(
    output: string,
    surfaces: readonly string[]
): Map<string, PrefixProbe> {
    const { block } = extractVerdictBlock(output, LANE_VOCABULARY);
    const out = new Map<string, PrefixProbe>();
    for (const surface of surfaces) {
        if (!block) {
            out.set(surface, { verdict: "unsettled" });
            continue;
        }
        const rows = block.rows.filter((r) => r.surface === surface);
        const asserts = block.assertRows.filter((a) => a.surface === surface);
        const lines = [
            ...rows
                .filter((r) => r.verdict === "FAIL")
                .map(
                    (r) =>
                        `FAIL ${r.surface} @ ${r.viewport ?? "—"}: ${r.detail}`
                ),
            ...asserts
                .filter((a) => a.verdict === "FAIL")
                .map(
                    (a) =>
                        `FAIL ${a.surface} @ ${a.viewport}: assertion ${JSON.stringify(a.label)}`
                ),
        ];
        if (lines.length > 0) out.set(surface, { verdict: "fail", lines });
        else if (
            rows.length > 0 &&
            rows.every((r) => r.verdict === "PASS") &&
            asserts.every((a) => a.verdict === "PASS")
        )
            out.set(surface, { verdict: "pass" });
        else out.set(surface, { verdict: "unsettled" });
    }
    return out;
}

/**
 * Walk the orphan surfaces on merge-order prefixes (issue #9265): base alone,
 * then base + head₁, base + head₁ + head₂, … — linear, every still-open
 * orphan in ONE `--surface=` DIAGNOSTIC walk per prefix, so at most
 * `merged.length + 1` walks. A surface leaves the walk at its first prefix
 * that is not `pass`: `settleOrphans` reads no further.
 */
async function prefixRewalks(
    orphans: readonly string[],
    merged: readonly Merged[],
    baseSha: string,
    passthrough: readonly string[],
    root: string,
    log: Log
): Promise<Map<string, PrefixProbe[]>> {
    const probes = new Map<string, PrefixProbe[]>(orphans.map((s) => [s, []]));
    let open = [...orphans];
    for (let k = 0; k <= merged.length && open.length > 0; k++) {
        const prefix = merged.slice(0, k);
        const dir = newTreeDir(`prefix-${k}`);
        let measured = new Map<string, PrefixProbe>();
        try {
            const built = buildTree(dir, baseSha, prefix, root, log);
            if (built.length === prefix.length) {
                initTree(dir, log);
                const label =
                    k === 0
                        ? "the base alone"
                        : `base + ${prefix.map((m) => `#${m.head.pr}`).join(" + ")}`;
                log(
                    `batch: re-walking ${open.join(", ")} on ${label} (DIAGNOSTIC — combination attribution only)`
                );
                const { code, output } = await walk(
                    dir,
                    [
                        `--surface=${open.join(",")}`,
                        "--no-publish",
                        ...passthrough,
                    ],
                    log
                );
                if (code === 0 || code === 1)
                    measured = prefixProbesOf(output, open);
                else
                    log(
                        `batch: prefix walk ${k} exited ${code} — it settles nothing`
                    );
            }
        } finally {
            removeTree(dir, root);
        }
        for (const s of open)
            probes.get(s)!.push(measured.get(s) ?? { verdict: "unsettled" });
        open = open.filter((s) => probes.get(s)!.at(-1)!.verdict === "pass");
    }
    return probes;
}

/** Settle each ambiguous surface by walking its candidates alone. */
async function soloRewalks(
    attribution: BatchAttribution,
    byPr: ReadonlyMap<number, Merged>,
    baseSha: string,
    passthrough: readonly string[],
    root: string,
    log: Log
): Promise<Map<number, string[]>> {
    const surfacesOf = new Map<number, string[]>();
    for (const { surface, candidates } of attribution.ambiguous) {
        for (const pr of candidates) {
            surfacesOf.set(pr, [...(surfacesOf.get(pr) ?? []), surface]);
        }
    }
    const solo = new Map<number, string[]>();
    for (const [pr, surfaces] of surfacesOf) {
        const m = byPr.get(pr)!;
        const dir = newTreeDir(`solo-${pr}`);
        try {
            const merged = buildTree(dir, baseSha, [m], root, log);
            // A head that merged in the batch merges alone on the same base;
            // if it somehow does not, it owns nothing and the surface stays
            // an orphan — unproven, never blamed.
            if (merged.length === 0) continue;
            initTree(dir, log);
            log(
                `batch: re-walking ${surfaces.join(", ")} on #${pr} alone (DIAGNOSTIC — attribution only)`
            );
            const { code, output } = await walk(
                dir,
                [
                    `--surface=${surfaces.join(",")}`,
                    "--no-publish",
                    ...passthrough,
                ],
                log
            );
            // A solo walk the machine cut short (exit 3/4/77…) judged nothing:
            // the candidate owns nothing, the surface stays an orphan.
            if (code === 0 || code === 1) solo.set(pr, redSurfacesOf(output));
            else
                log(
                    `batch: solo walk of #${pr} exited ${code} — no attribution from it`
                );
        } finally {
            removeTree(dir, root);
        }
    }
    return solo;
}

function writeReceipt(pr: number, lines: readonly string[], log: Log): void {
    const body = (
        JSON.parse(gh(["pr", "view", String(pr), "--json", "body"])) as {
            body: string;
        }
    ).body;
    const file = path.join(
        os.tmpdir(),
        `ui-batch-body-${pr}-${process.pid}.md`
    );
    fs.writeFileSync(file, withBatchReceipt(body, lines));
    try {
        gh(["pr", "edit", String(pr), "--body-file", file]);
        log(`batch: #${pr} — receipt written into the PR body`);
    } finally {
        fs.rmSync(file, { force: true });
    }
}

export async function runBatch(
    prs: readonly number[],
    argv: readonly string[],
    root: string,
    log: Log,
    onOutcome?: (outcome: BatchOutcome) => void
): Promise<number> {
    let passthrough: string[];
    try {
        passthrough = batchPassthrough(argv);
    } catch (err) {
        log(`batch: ${(err as Error).message}`);
        return 2;
    }
    const writeReceipts = argv.includes("--write-receipts");

    git(["fetch", "--quiet", "origin", BASE_BRANCH], root);
    const baseSha = git(["rev-parse", ORIGIN_BASE], root).trim();
    log(`batch: base ${ORIGIN_BASE} @ ${baseSha}`);

    let candidates: Merged[] = [];
    const dropped: DroppedPr[] = [];
    for (const pr of prs) {
        const h = fetchHead(pr, root, log);
        if ("sha" in h)
            candidates.push(headIdentity(h.pr, h.sha, baseSha, root));
        else dropped.push(h);
    }

    // Build, scope, and rebuild without any PR the batch cannot carry. The
    // tree is removed however the run ends — a throw, or Ctrl-C / SIGTERM.
    let dir = "";
    const onSignal = (signal: NodeJS.Signals) => {
        if (dir) removeTree(dir, root);
        process.exit(signal === "SIGINT" ? 130 : 143);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
        return await walkBatch();
    } finally {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        if (dir) removeTree(dir, root);
    }

    async function walkBatch(): Promise<number> {
        let merged: Merged[] = [];
        let scopes = new Map<number, readonly string[]>();
        for (;;) {
            dir = newTreeDir("walk");
            merged = buildTree(dir, baseSha, candidates, root, log, dropped);
            scopes = new Map();
            const unscoped: Merged[] = [];
            for (const m of merged) {
                const scope = landingDiffScope(m.changed, dir);
                if (scope.kind === "scoped")
                    scopes.set(m.head.pr, scope.surfaces);
                else {
                    unscoped.push(m);
                    const reason = `its scope is ${scope.kind} (${scope.kind === "full" ? scope.reason : scope.reasons.join("; ")}); it cannot ride a SCOPED walk`;
                    log(`batch: dropped #${m.head.pr} — ${reason}`);
                    dropped.push({ pr: m.head.pr, reason, intrinsic: true });
                }
            }
            if (unscoped.length === 0) break;
            removeTree(dir, root);
            dir = "";
            candidates = merged.filter((m) => !unscoped.includes(m));
        }

        if (merged.length === 0) {
            log("batch: no PR left to walk");
            for (const d of dropped) log(`#${d.pr}: DROPPED — ${d.reason}`);
            // Every PR dropped is still a settled batch: each is held with
            // its reason, never left to be re-dropped silently on every
            // scheduled run (issue #9264).
            onOutcome?.({
                clean: [],
                red: new Map(),
                dropped: dropped.map((d) => ({ ...d })),
                unproven: [],
                base: baseSha,
            });
            return 1;
        }
        const heads = merged.map((m) => m.head);
        log(`batch: walking ${heads.map(formatBatchHead).join(" ")}`);
        initTree(dir, log);
        const { code, output } = await walk(
            dir,
            [
                `--base=${baseSha}`,
                `--batch-heads=${heads.map(formatBatchHead).join(",")}`,
                "--no-publish",
                ...passthrough,
            ],
            log
        );
        if (code !== 0 && code !== 1) {
            log(
                `batch: the walk exited ${code} — no cell judged, no PR attributed (the walk's own exit code stands)`
            );
            return code;
        }
        const { block, problems } = extractVerdictBlock(
            output,
            LANE_VOCABULARY
        );
        if (!block) {
            log(
                `batch: could not read the walk's verdict block — ${problems.join("; ")}`
            );
            return 1;
        }
        // The walk's own scope (the union diff's), read off the banner it
        // printed; a union that reached every surface printed a RECEIPT.
        const walked =
            parseBatchBanner(block.bannerLine)?.surfaces ??
            LANE_VOCABULARY.surfaceIds;
        let attribution = attributeBatch(
            walked,
            block.rows,
            block.assertRows,
            scopes
        );
        if (attribution.ambiguous.length > 0) {
            const solo = await soloRewalks(
                attribution,
                new Map(merged.map((m) => [m.head.pr, m])),
                baseSha,
                passthrough,
                root,
                log
            );
            attribution = settleAmbiguous(attribution, solo);
        }
        let combination: CombinationBreak[] = [];
        let nonReproducible: string[] = [];
        let baseRed: string[] = [];
        let cleared = new Map<number, string[]>();
        if (attribution.orphan.length > 0) {
            const probes = await prefixRewalks(
                attribution.orphan,
                merged,
                baseSha,
                passthrough,
                root,
                log
            );
            const settle = settleOrphans(
                attribution,
                merged.map((m) => m.head.pr),
                scopes,
                probes
            );
            ({ attribution, combination, nonReproducible, baseRed, cleared } =
                settle);
        }

        log(
            "\n─── check:ui batch ─────────────────────────────────────────────"
        );
        const clean = attribution.clean.filter(
            (pr) => !attribution.red.has(pr)
        );
        for (const pr of clean) {
            // A PR cleared of a combination surface (its prefix passed it)
            // carries that surface in its receipt too (issue #9265).
            const extra = cleared.get(pr) ?? [];
            const surfaces = walked.filter(
                (s) => attribution.passSurfaces.includes(s) || extra.includes(s)
            );
            const lines = batchReceiptLines(surfaces, baseSha, heads);
            if (surfaces.length === 0) {
                // A PR with an empty scope owes no walk: no receipt to write.
                log(
                    `#${pr}: CLEAN — its scope is empty: \`check:ui: no walk owed\``
                );
                continue;
            }
            log(`#${pr}: CLEAN — receipt:`);
            for (const l of lines) log(`    ${l}`);
            if (writeReceipts) writeReceipt(pr, lines, log);
        }
        for (const [pr, red] of attribution.red) {
            log(`#${pr}: RED`);
            for (const l of red) log(`    ${l}`);
        }
        for (const c of combination) {
            log(
                `combination: ${c.surface} — #${c.culprit} completes the break${c.partners.length ? ` with ${c.partners.map((p) => `#${p}`).join(", ")}` : ""}${c.after.length ? `; ${c.after.map((p) => `#${p}`).join(", ")} ride the next batch` : ""}`
            );
        }
        for (const surface of baseRed)
            log(
                `orphan: ${surface} is red on the base alone — no head owns it`
            );
        for (const surface of nonReproducible)
            log(
                `orphan: ${surface} is non-reproducible — green on every merge-order prefix, the full set included`
            );
        for (const surface of attribution.orphan) {
            log(
                `orphan: ${surface} is red in the batch and owned by no single PR — it breaks only in combination, or no PR's own scope reaches it`
            );
        }
        for (const d of dropped) log(`#${d.pr}: DROPPED — ${d.reason}`);
        const unproven = merged
            .map((m) => m.head.pr)
            .filter((pr) => !clean.includes(pr) && !attribution.red.has(pr));
        for (const pr of unproven) {
            log(
                `#${pr}: UNPROVEN — a red surface of its scope stays unattributed`
            );
        }
        onOutcome?.({
            clean: [...clean],
            red: new Map(attribution.red),
            dropped: dropped.map((d) => ({ ...d })),
            unproven,
            base: baseSha,
            combination: combination.map((c) => ({ ...c })),
            nonReproducible: [...nonReproducible],
        });
        return clean.length === prs.length ? 0 : 1;
    }
}
