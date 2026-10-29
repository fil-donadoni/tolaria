#!/usr/bin/env bun
/**
 * `bun run bot:costs:refresh` — the daily bot test cost table refresh (issue
 * #6999, ADR 0154 §13), run by `.github/workflows/bot-costs-refresh.yml` in a
 * job worktree on the machine health gates on.
 *
 *   1. stop (exit 0) when a refresh PR is still open;
 *   2. `bot:costs --refresh` over the newest sealed health runs of the PRIMARY
 *      checkout (`lib/bot-test-costs.ts`); no changed row → stop (exit 0);
 *   3. commit `data/bot-test-costs.json` on `chore/bot-costs-refresh-<date>`,
 *      push, open the PR, `land:ready`.
 *
 * Like `corpus:repin`, the job worktree is cut at the release branch: the run
 * first detaches at `origin/<base>` and re-executes itself there (`--here`
 * skips that for a local run in a worktree whose HEAD must not move).
 */
import { spawnSync } from "node:child_process";
import { COSTS_PATH, REFRESH_BRANCH_PREFIX } from "./lib/bot-test-costs";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { gh } from "./lib/gh";
import { primaryCheckout } from "./lib/primary-checkout";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ON_BASE = "--on-base";
const say = (line: string): void => console.log(`bot:costs:refresh: ${line}`);

function fail(message: string): never {
    console.error(`✗ bot:costs:refresh: ${message}`);
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
        p.headRefName.startsWith(REFRESH_BRANCH_PREFIX)
    );
    return hit === undefined ? null : `PR #${hit.number} (${hit.headRefName})`;
}

function main(): void {
    if (primaryCheckout(ROOT) === ROOT)
        fail("refusing to run in the primary checkout — use a worktree");
    if (!process.argv.includes("--here") && !process.argv.includes(ON_BASE)) {
        run("git", ["fetch", "--quiet", "origin", BASE_BRANCH]);
        run("git", ["checkout", "--quiet", "--detach", ORIGIN_BASE]);
        run("bun", ["run", "worktree:init"], true);
        const again = spawnSync(
            "bun",
            [`${ROOT}/scripts/bot-costs-refresh.ts`, ON_BASE],
            { cwd: ROOT, stdio: "inherit" }
        );
        process.exit(again.status ?? 1);
    }

    const open = openRefreshPr();
    if (open !== null) {
        say(`${open} is still open — one refresh at a time; nothing to do`);
        return;
    }
    run("bun", ["scripts/bot-test-costs.ts", "--refresh"], true);
    if (run("git", ["status", "--porcelain", "--", COSTS_PATH]) === "") {
        say("the table is unchanged — nothing to do");
        return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const branch = `${REFRESH_BRANCH_PREFIX}${date}`;
    const title = `chore: refresh the bot test cost table ${date}`;
    run("git", ["checkout", "-b", branch]);
    run("git", ["add", "--", COSTS_PATH]);
    run("git", ["commit", "-m", `${title} (issue #6999)`]);
    run("git", ["push", "-u", "origin", branch]);
    const body = [
        "Daily refresh of `data/bot-test-costs.json` (issue #6999, ADR 0154 §13): the median of each bot file's passed wall over the newest sealed health runs, via `bun run bot:costs --refresh`.",
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

if (import.meta.main) main();
