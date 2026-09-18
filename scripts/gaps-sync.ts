#!/usr/bin/env bun
/**
 * `bun run gaps:sync` — idempotent Grammar Gap / Bot Gap → issue filing
 * (ADR 0137, PRD issue #3820, issue #3829). One issue per allowlist row of
 * `data/grammar-gaps.json`: creates it, links it under the current set
 * umbrella (or PRD #3820), and writes the new issue number back into the
 * row. A second run against unchanged inputs performs no `gh` writes at all
 * — see `lib/gap-issues.ts`'s header for the full idempotency contract and
 * why this command's scope is the Op census, not the unbounded per-fragment
 * backlog `oracle:report --gaps` prints.
 *
 * `land` runs this post-merge, non-gating, from the PRIMARY checkout — like
 * this command run by hand. It commits + pushes the allowlist update
 * straight to the base branch when it wrote one: the write is a single
 * `issue` field per row, computed offline from the lockfile and the
 * registry, at the same trust tier ADR 0137 already grants the issue
 * creation itself ("a deliberate exception to the loop drains the queue,
 * never fills it… these issues come from a computed gate… never a
 * subagent's judgement").
 *
 * Offline in its planning half (lockfile + registry + allowlist, no
 * network); the tracker half talks to GitHub through `lib/gh.ts`, which
 * strips `GITHUB_TOKEN` so it authenticates as the developer, never as the
 * app's bug-report PAT (same rule `queue:plan` follows).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALLOWLIST_PATH, LOCKFILE_PATH, parseAllowlist } from "./check-gaps";
import { BASE_BRANCH } from "./lib/branches";
import { gh } from "./lib/gh";
import {
    applyUpdatedIssues,
    buildGrammarGapFilings,
    GRAMMAR_GAP_LABELS,
    syncGaps,
    type GapTracker,
    type TrackedIssue,
} from "./lib/gap-issues";
import { parseLockfile } from "./lib/oracle-lockfile";
import { readTargetRegistry, resolveContext } from "./lib/targets";

/** The `gh`-backed `GapTracker` — the one place this module touches the
 *  network. Every other function here is pure over its inputs. */
export class GhGapTracker implements GapTracker {
    getIssue(number: number): TrackedIssue | null {
        try {
            const out = gh([
                "issue",
                "view",
                String(number),
                "--json",
                "state,body",
            ]);
            const parsed = JSON.parse(out) as { state: string; body: string };
            return {
                state: parsed.state === "CLOSED" ? "CLOSED" : "OPEN",
                body: parsed.body,
            };
        } catch {
            return null;
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

    /**
     * `gh issue edit --parent` is unreliable under rapid fire (issue-tracker
     * doc, `queue-lint.ts`): it can exit non-zero on success or no-op
     * silently. Read the edge back and retry rather than trust the exit
     * code; give up loudly after three attempts rather than mislink.
     */
    private setParent(child: number, parent: number): void {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                gh([
                    "issue",
                    "edit",
                    String(child),
                    "--parent",
                    String(parent),
                ]);
            } catch {
                // Read-back below is the real check either way.
            }
            const out = gh([
                "issue",
                "view",
                String(child),
                "--json",
                "parent",
            ]);
            const got = (JSON.parse(out) as { parent?: { number?: number } })
                .parent?.number;
            if (got === parent) return;
        }
        console.error(
            `gaps:sync: could not confirm issue #${child}'s parent is #${parent} after 3 attempts`
        );
    }
}

/** Commit + push the allowlist update straight to `origin/<base>`, from a
 *  clean primary checkout already on that branch. Never throws: a failure
 *  here must not turn a successful filing pass into a reported error, since
 *  `land`'s own step already treats this whole script as non-gating — but
 *  it still prints so a human notices the file drifted from the remote. */
export function commitAndPushAllowlist(root: string): void {
    const git = (args: string[]) =>
        spawnSync("git", args, { cwd: root, encoding: "utf8" });
    const add = git(["add", ALLOWLIST_PATH]);
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

function main(): void {
    const root = resolve(".");
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

    const filings = buildGrammarGapFilings(lock, allowlist, registry, ctx);
    const result = syncGaps(filings, new GhGapTracker(), GRAMMAR_GAP_LABELS);

    for (const action of result.actions) {
        console.log(
            `${action.kind.padEnd(11)} ${action.key} -> issue #${action.issue}`
        );
    }

    if (result.updatedRows.size === 0) {
        console.log("gaps:sync: no allowlist row changed");
        return;
    }
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

if (import.meta.main) main();
