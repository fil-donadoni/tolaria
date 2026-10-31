#!/usr/bin/env bun
/**
 * `bun run lane:sentinels` — regenerate `data/lane-sentinels.json`, the test
 * files every scoped code lane runs because they recently produced a base RED
 * or a PR lane red (issue #7651, `lib/lane-sentinels.ts`).
 *
 *   bun run lane:sentinels            # read GitHub, write THIS checkout's file
 *   bun run lane:sentinels --recap    # offline: re-apply `laneSentinels.capS`
 *                                     # to the committed candidates
 *   bun run lane:sentinels --pr       # the weekly job's mode: detach at
 *                                     # `origin/<base>`, regenerate, and when
 *                                     # the set changed open the data PR and
 *                                     # `land:ready` it (the bot cost
 *                                     # refresh's shape, issue #6999)
 *
 * GitHub is read for the window `laneSentinels.windowDays` ending now: the
 * base's `health` commit statuses (a RED's `tests`) and the red `queue-lane`
 * runs' `lane.json` artifacts (their failing files). A file is a candidate
 * when it is still a test of a lane project in this tree. `--pr` exits 0
 * without a PR when a refresh PR is open or the set is unchanged.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBotTestCosts } from "./lib/bot-test-costs";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { gh } from "./lib/gh";
import { decodeStatus, originRepo } from "./lib/health-verdict-store";
import {
    SENTINELS_BRANCH_PREFIX,
    SENTINELS_PATH,
    buildLaneSentinels,
    collectCandidates,
    laneRedFiles,
    readLaneSentinels,
    readSentinelConfig,
    renderSentinels,
    sameSentinels,
    type LaneSentinels,
} from "./lib/lane-sentinels";
import { primaryCheckout } from "./lib/primary-checkout";
import { botTests, generalTests } from "./lib/test-reach";
import { laneRecord } from "./lib/workflow-trends";
import {
    DOWNLOADS_AT_ONCE,
    QUEUE_LANE_ARTIFACT,
    QUEUE_WORKFLOW,
    artifactText,
    baseHistory,
    pooled,
} from "./weekly-report";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ON_BASE = "--on-base";
const say = (line: string): void => console.log(`lane:sentinels: ${line}`);

function fail(message: string): never {
    console.error(`✗ lane:sentinels: ${message}`);
    process.exit(1);
}

function run(cmd: string, args: string[], inherit = false): string {
    const r = spawnSync(cmd, args, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: inherit ? "inherit" : undefined,
    });
    if (r.status !== 0)
        fail(`${cmd} ${args.join(" ")} failed (exit ${r.status ?? r.signal})`);
    return (r.stdout ?? "").trim();
}

const isoSeconds = (t: number) =>
    new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The RED verdicts' `tests` on the base since `since`. */
function redTests(repo: string, since: string): string[][] {
    const out: string[][] = [];
    for (const node of baseHistory(repo, since)) {
        const ctx = node.status?.context;
        if (!ctx) continue;
        const v = decodeStatus({
            sha: node.oid,
            state: ctx.state,
            description: ctx.description,
            targetUrl: null,
            createdAt: ctx.createdAt,
        });
        if (v?.status === "red" && v.tests && v.tests.length > 0)
            out.push(v.tests);
    }
    return out;
}

/** The failing files of every red `queue-lane` run created since `fromDay`. */
async function laneReds(fromDay: string): Promise<string[][]> {
    const rows = JSON.parse(
        gh([
            "run",
            "list",
            "--workflow",
            QUEUE_WORKFLOW,
            "--status",
            "failure",
            "--created",
            `>=${fromDay}`,
            "--limit",
            "1000",
            "--json",
            "databaseId",
        ])
    ) as { databaseId: number }[];
    const dir = mkdtempSync(join(tmpdir(), "lane-sentinels-"));
    try {
        const texts = await pooled(rows, DOWNLOADS_AT_ONCE, (r) =>
            artifactText(dir, r.databaseId, QUEUE_LANE_ARTIFACT, "lane.json")
        );
        // A stale generated artefact (`regenerable`, `pr:fixup`'s rows) is
        // no regression: only a `red` record names sentinels.
        return texts
            .filter((t) => laneRecord(t).lane === "red")
            .map(laneRedFiles)
            .filter((fs) => fs.length > 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function derive(): Promise<LaneSentinels> {
    const config = readSentinelConfig(ROOT);
    const now = Date.now();
    const since = isoSeconds(now - config.windowDays * 86_400_000);
    const repo = originRepo(primaryCheckout(ROOT));
    const reds = redTests(repo, since);
    const lanes = await laneReds(since.slice(0, 10));
    const tests = new Set([
        ...generalTests(ROOT).keys(),
        ...botTests(ROOT).keys(),
    ]);
    const candidates = collectCandidates(
        reds,
        lanes,
        readBotTestCosts(ROOT),
        (f) => tests.has(f)
    );
    say(
        `${reds.length} RED verdict(s) and ${lanes.length} red lane run(s) with failing files over ${config.windowDays} days → ${candidates.length} candidate(s)`
    );
    return buildLaneSentinels(candidates, config, isoSeconds(now).slice(0, 10));
}

function write(s: LaneSentinels): void {
    writeFileSync(join(ROOT, SENTINELS_PATH), renderSentinels(s));
    const seconds = s.sentinels.reduce((n, x) => n + x.ms, 0) / 1000;
    say(
        `${s.sentinels.length} sentinel(s), ${seconds.toFixed(1)} s of ${s.capS} s; ${s.overCap.length} over the cap, ${s.unmeasured.length} unmeasured → ${SENTINELS_PATH}`
    );
}

function recap(): void {
    const committed = readLaneSentinels(ROOT);
    if (committed === null)
        fail(`${SENTINELS_PATH} is missing — run without --recap`);
    write(
        buildLaneSentinels(
            committed.candidates,
            readSentinelConfig(ROOT),
            committed.through
        )
    );
}

function openRefreshPr(): string | null {
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
    const hit = open.find((p) =>
        p.headRefName.startsWith(SENTINELS_BRANCH_PREFIX)
    );
    return hit === undefined ? null : `PR #${hit.number} (${hit.headRefName})`;
}

async function refreshPr(): Promise<void> {
    if (primaryCheckout(ROOT) === ROOT)
        fail("refusing to run in the primary checkout — use a worktree");
    if (!process.argv.includes(ON_BASE)) {
        run("git", ["fetch", "--quiet", "origin", BASE_BRANCH]);
        run("git", ["checkout", "--quiet", "--detach", ORIGIN_BASE]);
        run("bun", ["run", "worktree:init"], true);
        const again = spawnSync(
            "bun",
            [`${ROOT}/scripts/lane-sentinels-refresh.ts`, "--pr", ON_BASE],
            { cwd: ROOT, stdio: "inherit" }
        );
        process.exit(again.status ?? 1);
    }
    const open = openRefreshPr();
    if (open !== null) {
        say(`${open} is still open — one refresh at a time; nothing to do`);
        return;
    }
    const next = await derive();
    if (sameSentinels(next, readLaneSentinels(ROOT))) {
        say("the set is unchanged — nothing to do");
        return;
    }
    write(next);
    const date = next.through;
    const branch = `${SENTINELS_BRANCH_PREFIX}${date}`;
    const title = `chore: refresh the lane sentinel set ${date}`;
    run("git", ["checkout", "-b", branch]);
    run("git", ["add", "--", SENTINELS_PATH]);
    run("git", ["commit", "-m", `${title} (issue #7651)`]);
    run("git", ["push", "-u", "origin", branch]);
    const seconds = next.sentinels.reduce((n, x) => n + x.ms, 0) / 1000;
    const body = [
        `Weekly refresh of \`${SENTINELS_PATH}\` (issue #7651): the test files that produced a base RED or a PR lane red over the last ${next.windowDays} days, under \`laneSentinels.capS\` (${next.capS} s), via \`bun run lane:sentinels --pr\`.`,
        "",
        `${next.sentinels.length} sentinel(s), ${seconds.toFixed(1)} s measured on the lane; ${next.overCap.length} over the cap, ${next.unmeasured.length} unmeasured.`,
        "",
        "## Preset scenario",
        "",
        "none owed — a data refresh, no card or gameplay change.",
    ].join("\n");
    const url = gh([
        "pr",
        "create",
        "--base",
        BASE_BRANCH,
        "--head",
        branch,
        "--title",
        title,
        "--body",
        body,
    ]).trim();
    const pr = Number(/\/pull\/(\d+)$/.exec(url)?.[1]);
    if (!Number.isInteger(pr) || pr <= 0)
        fail(`gh pr create returned no PR number: ${url}`);
    say(`PR #${pr} opened`);
    run("bun", ["scripts/land-ready.ts", String(pr)], true);
}

async function main(argv: string[]): Promise<void> {
    if (argv.includes("--recap")) return recap();
    if (argv.includes("--pr")) return refreshPr();
    write(await derive());
}

if (import.meta.main)
    main(process.argv.slice(2)).catch((e: unknown) =>
        fail((e as Error).message.split("\n")[0])
    );
