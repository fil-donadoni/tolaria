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
 *      a receipt) and settled (`settleAmbiguous`);
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
    formatBatchHead,
    parseBatchBanner,
    settleAmbiguous,
    withBatchReceipt,
    type BatchAttribution,
    type BatchHead,
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

/** Fetch PR `pr`'s head; null (with the reason logged) when it cannot ride. */
function fetchHead(
    pr: number,
    root: string,
    log: Log
): { pr: number; sha: string } | null {
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
        log(`batch: dropped #${pr} — ${(err as Error).message}`);
        return null;
    }
    if (info.state !== "OPEN" || info.baseRefName !== BASE_BRANCH) {
        log(
            `batch: dropped #${pr} — ${info.state}, base ${info.baseRefName} (a batch merges open PRs against ${BASE_BRANCH})`
        );
        return null;
    }
    if (!tryGit(["fetch", "--quiet", "origin", `pull/${pr}/head`], root)) {
        log(`batch: dropped #${pr} — could not fetch pull/${pr}/head`);
        return null;
    }
    if (!tryGit(["cat-file", "-e", `${info.headRefOid}^{commit}`], root)) {
        log(
            `batch: dropped #${pr} — head ${info.headRefOid} not present after the fetch (pushed mid-run?)`
        );
        return null;
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
 *  conflicting head is aborted and dropped. */
function buildTree(
    dir: string,
    baseSha: string,
    heads: readonly Merged[],
    root: string,
    log: Log
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
            log(
                `batch: dropped #${m.head.pr} — its head conflicts with the batch so far; walk it alone or in another batch`
            );
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

/** The red surfaces a solo `--surface=` re-walk printed. */
function redSurfacesOf(output: string): string[] {
    const { block } = extractVerdictBlock(output, LANE_VOCABULARY);
    if (!block) return [];
    const red = new Set<string>();
    for (const r of block.rows) if (r.verdict !== "PASS") red.add(r.surface);
    for (const a of block.assertRows)
        if (a.verdict !== "PASS") red.add(a.surface);
    return [...red];
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
            if (merged.length === 0) {
                solo.set(pr, surfaces); // cannot be walked alone: stays unproven
                continue;
            }
            initTree(dir, log);
            log(
                `batch: re-walking ${surfaces.join(", ")} on #${pr} alone (DIAGNOSTIC — attribution only)`
            );
            const { output } = await walk(
                dir,
                [
                    `--surface=${surfaces.join(",")}`,
                    "--no-publish",
                    ...passthrough,
                ],
                log
            );
            solo.set(pr, redSurfacesOf(output));
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
    log: Log
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
    const dropped: number[] = [];
    for (const pr of prs) {
        const h = fetchHead(pr, root, log);
        if (h) candidates.push(headIdentity(h.pr, h.sha, baseSha, root));
        else dropped.push(pr);
    }

    // Build, scope, and rebuild without any PR the batch cannot carry.
    let dir = "";
    let merged: Merged[] = [];
    let scopes = new Map<number, readonly string[]>();
    for (;;) {
        dir = newTreeDir("walk");
        merged = buildTree(dir, baseSha, candidates, root, log);
        for (const c of candidates) {
            if (!merged.includes(c)) dropped.push(c.head.pr);
        }
        scopes = new Map();
        const unscoped: Merged[] = [];
        for (const m of merged) {
            const scope = landingDiffScope(m.changed, dir);
            if (scope.kind === "scoped") scopes.set(m.head.pr, scope.surfaces);
            else {
                unscoped.push(m);
                log(
                    `batch: dropped #${m.head.pr} — its scope is ${scope.kind} (${scope.kind === "full" ? scope.reason : scope.reasons.join("; ")}); it cannot ride a SCOPED walk`
                );
            }
        }
        if (unscoped.length === 0) break;
        removeTree(dir, root);
        dropped.push(...unscoped.map((m) => m.head.pr));
        candidates = merged.filter((m) => !unscoped.includes(m));
    }

    try {
        if (merged.length === 0) {
            log("batch: no PR left to walk");
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

        log(
            "\n─── check:ui batch ─────────────────────────────────────────────"
        );
        const lines = batchReceiptLines(
            attribution.passSurfaces,
            baseSha,
            heads
        );
        const clean = attribution.clean.filter(
            (pr) => !attribution.red.has(pr)
        );
        for (const pr of clean) {
            log(`#${pr}: CLEAN — receipt:`);
            for (const l of lines) log(`    ${l}`);
            if (writeReceipts) writeReceipt(pr, lines, log);
        }
        for (const [pr, red] of attribution.red) {
            log(`#${pr}: RED`);
            for (const l of red) log(`    ${l}`);
        }
        for (const surface of attribution.orphan) {
            log(
                `orphan: ${surface} is red in the batch and owned by no single PR — it breaks only in combination, or no PR's own scope reaches it`
            );
        }
        for (const pr of dropped) log(`#${pr}: DROPPED — walk it alone`);
        const unproven = merged
            .map((m) => m.head.pr)
            .filter((pr) => !clean.includes(pr) && !attribution.red.has(pr));
        for (const pr of unproven) {
            log(
                `#${pr}: UNPROVEN — a red surface of its scope stays unattributed`
            );
        }
        return clean.length === prs.length ? 0 : 1;
    } finally {
        removeTree(dir, root);
    }
}
