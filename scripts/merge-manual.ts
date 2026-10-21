#!/usr/bin/env bun
/**
 * `bun run merge:manual <PR#>` — the owner's merge of a `merge:manual` PR
 * (one the Mergify queue refuses). Refuses unless `lib/merge-manual.ts`
 * admits it — advisory lane green on the up-to-date head — then merges
 * through `scripts/pr-merge.ts`. The web UI's merge button bypasses this;
 * use the command.
 */
import { spawnSync } from "node:child_process";
import { BASE_BRANCH } from "./lib/branches";
import { gh } from "./lib/gh";
import { manualMergeVerdict, type CheckRunView } from "./lib/merge-manual";

function fail(message: string): never {
    console.error(`merge:manual: ${message}`);
    process.exit(1);
}

const pr = Number((process.argv[2] ?? "").replace(/^#/, ""));
if (!Number.isInteger(pr) || pr <= 0) fail("usage: bun run merge:manual <PR#>");

const view = JSON.parse(
    gh([
        "pr",
        "view",
        String(pr),
        "--json",
        "state,labels,headRefOid,baseRefName",
    ])
) as {
    state: string;
    labels: { name: string }[];
    headRefOid: string;
    baseRefName: string;
};
if (view.baseRefName !== BASE_BRANCH)
    fail(`PR #${pr} targets ${view.baseRefName}, not ${BASE_BRANCH}`);

const behindBy = Number(
    gh([
        "api",
        `repos/{owner}/{repo}/compare/${BASE_BRANCH}...${view.headRefOid}`,
        "--jq",
        ".behind_by",
    ]).trim()
);
// One JSON object per line: `--paginate` concatenates pages.
const checkRuns = gh([
    "api",
    "--paginate",
    `repos/{owner}/{repo}/commits/${view.headRefOid}/check-runs?per_page=100`,
    "--jq",
    ".check_runs[] | {id, name, headSha: .head_sha, status, conclusion} | tojson",
])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CheckRunView);

const verdict = manualMergeVerdict({
    state: view.state,
    labels: view.labels.map((l) => l.name),
    headSha: view.headRefOid,
    behindBy,
    checkRuns,
});
if (verdict.kind === "refuse") fail(`PR #${pr} refused: ${verdict.reason}`);

console.log(`merge:manual: PR #${pr} admitted — merging`);
const merged = spawnSync(
    "bun",
    ["scripts/pr-merge.ts", String(pr), `--head=${view.headRefOid}`, "--admin"],
    {
        stdio: "inherit",
    }
);
process.exit(merged.status ?? 1);
