#!/usr/bin/env bun
/**
 * `bun scripts/owner-merge.ts` — the I/O of `.github/workflows/owner-merge.yml`
 * (issue #6188): on a `labeled` event, decides whether the PR needs a hand
 * merge (`lib/owner-merge.ts`), writes the job summary, and exits 1 when it
 * does — the failed run is the owner's email. The PR is data: the event's
 * payload and its file list through the API, never its tree.
 *
 * Env: `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY` (else the origin remote),
 * `TRUSTED_AUTHORS`, `GH_TOKEN`, `GITHUB_STEP_SUMMARY` (else stdout).
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { originRepo, realGh } from "./lib/health-verdict-store";
import { ownerMergeDecision, ownerMergeSummary } from "./lib/owner-merge";
import {
    gatePrOf,
    parseTrustedAuthors,
    PR_FILES_JQ,
    prFilesApiPath,
    type RestPr,
} from "./lib/pr-gate";

function main(): number {
    const path = process.env.GITHUB_EVENT_PATH;
    if (!path) throw new Error("GITHUB_EVENT_PATH is unset");
    const event = JSON.parse(readFileSync(path, "utf8")) as {
        label?: { name?: string };
        pull_request: RestPr & { title: string; html_url: string };
    };
    const raw = event.pull_request;
    const label = event.label?.name ?? "";
    const repo =
        process.env.GITHUB_REPOSITORY ||
        originRepo(join(import.meta.dir, ".."));
    const r = realGh([
        "api",
        "--paginate",
        prFilesApiPath(repo, raw.number),
        "--jq",
        PR_FILES_JQ,
    ]);
    if (r.status !== 0)
        throw new Error(
            `gh api files failed (exit ${r.status}): ${r.stderr.trim()}`
        );
    const files = r.stdout
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as string);
    const decision = ownerMergeDecision({
        label,
        pr: gatePrOf(raw, files),
        trusted: parseTrustedAuthors(process.env.TRUSTED_AUTHORS),
    });
    if (!decision.notify) {
        console.log(
            `owner-merge: PR #${raw.number}: no notification (${decision.reason})`
        );
        return 0;
    }
    const summary = ownerMergeSummary({
        prNumber: raw.number,
        prUrl: raw.html_url,
        title: raw.title,
        description: decision.description,
    });
    if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    else console.log(summary);
    console.error(
        `owner-merge: PR #${raw.number} needs a hand merge — failing on purpose`
    );
    return 1;
}

process.exit(main());
