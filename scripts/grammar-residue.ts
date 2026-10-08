/**
 * `bun run grammar:residue <cluster issue> --pr <PR#>` — the residue ledger of
 * a landed Grammar Cluster (issue #5222).
 *
 * Which cards did the ticket consider, which are still not `ready`, and does
 * every gap that still refuses them have an OPEN issue? A residual gap with
 * none is a HOLE: `gaps:sync` (the filer) runs once to close it, and a hole
 * that survives is reported and exits 1 — cards must never stay incomplete
 * without a ticket that will finish them.
 *
 * Runs from the PRIMARY checkout after `land`'s `gaps:sync` step (the claims
 * it reads are the ones `gaps:sync` just wrote). Non-gating inside `land`.
 *
 *   --pr <N>        the merged PR; "before" = its merge commit's parent
 *   --before <ref>  override "before" (replay)
 *   --dry-run       no `gaps:sync`, no comment: print the ledger only
 *
 * Not a Grammar Cluster (no `## Grammar Gaps` table in the issue) → exit 0.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NO_FILE_BOT_FLAG } from "./lib/gap-issues";
import {
    buildResidue,
    LEDGER_MARKER,
    parseClusterKeys,
    renderLedger,
    type ResidueReport,
} from "./lib/grammar-residue";
import { parseLockfile, type Lockfile } from "./lib/oracle-lockfile";
import {
    parseClaimRows,
    parseClusterRows,
    readTargetRegistry,
    resolveContext,
    resolveTarget,
} from "./lib/targets";

const ROOT = resolve(import.meta.dirname, "..");
const MAX = 256 * 1024 * 1024;

function run(cmd: string, args: string[]): string {
    return execFileSync(cmd, args, {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: MAX,
    });
}

function flag(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function lockAt(ref: string): Lockfile {
    return parseLockfile(
        run("git", ["show", `${ref}:data/oracle-compiled.json`])
    );
}

function lockNow(): Lockfile {
    return parseLockfile(
        readFileSync(resolve(ROOT, "data/oracle-compiled.json"), "utf8")
    );
}

function allowlistNow(): {
    claims: ReturnType<typeof parseClaimRows>;
    clusters: ReturnType<typeof parseClusterRows>;
} {
    const doc = JSON.parse(
        readFileSync(resolve(ROOT, "data/grammar-gaps.json"), "utf8")
    );
    return { claims: parseClaimRows(doc), clusters: parseClusterRows(doc) };
}

const openCache = new Map<number, boolean>();
function isOpen(issue: number): boolean {
    let open = openCache.get(issue);
    if (open === undefined) {
        try {
            open =
                run("gh", [
                    "issue",
                    "view",
                    String(issue),
                    "--json",
                    "state",
                    "--jq",
                    ".state",
                ]).trim() === "OPEN";
        } catch {
            // Unknown liveness is not a pass: fail closed, the hole is reported.
            open = false;
        }
        openCache.set(issue, open);
    }
    return open;
}

function evaluate(
    keys: readonly string[],
    before: Lockfile,
    after: Lockfile
): ResidueReport {
    const { claims, clusters } = allowlistNow();
    // Enforced Targets only: their cards are the ones a hole is red for.
    const registry = readTargetRegistry(ROOT);
    const ctx = resolveContext(ROOT, after);
    const target = new Set<string>();
    for (const row of registry.targets.filter((t) => t.enforced))
        for (const card of resolveTarget(row, ctx).cards)
            target.add(card.oracleId);
    return buildResidue({
        before,
        after,
        keys,
        claims,
        clusters,
        isOpen,
        target,
    });
}

function postLedger(issue: number, body: string): void {
    const comments = JSON.parse(
        run("gh", ["issue", "view", String(issue), "--json", "comments"])
    ).comments as { body: string; url: string }[];
    const prior = comments.find((c) => c.body.includes(LEDGER_MARKER));
    const id =
        prior === undefined ? null : /issuecomment-(\d+)/.exec(prior.url)?.[1];
    if (id) {
        run("gh", [
            "api",
            "-X",
            "PATCH",
            `repos/{owner}/{repo}/issues/comments/${id}`,
            "-f",
            `body=${body}`,
        ]);
    } else {
        run("gh", ["issue", "comment", String(issue), "--body", body]);
    }
}

function main(): void {
    const issue = Number(process.argv[2]);
    const pr = Number(flag("--pr"));
    const dryRun = process.argv.includes("--dry-run");
    if (
        !Number.isInteger(issue) ||
        issue <= 0 ||
        !Number.isInteger(pr) ||
        pr <= 0
    ) {
        process.stderr.write(
            "usage: bun run grammar:residue <cluster issue> --pr <PR#> [--before <ref>] [--dry-run]\n"
        );
        process.exit(2);
    }

    const body = run("gh", [
        "issue",
        "view",
        String(issue),
        "--json",
        "body",
        "--jq",
        ".body",
    ]);
    const keys = parseClusterKeys(body);
    if (keys.length === 0) {
        process.stdout.write(
            `grammar:residue — issue #${issue} has no \`## Grammar Gaps\` table: not a Grammar Cluster, nothing to trace\n`
        );
        return;
    }

    const merge = JSON.parse(
        run("gh", ["pr", "view", String(pr), "--json", "mergeCommit"])
    ).mergeCommit?.oid as string | undefined;
    const beforeRef = flag("--before") ?? (merge ? `${merge}^` : null);
    if (beforeRef === null) {
        process.stderr.write(
            `grammar:residue — PR #${pr} has no merge commit yet\n`
        );
        process.exit(2);
    }
    const before = lockAt(beforeRef);
    const after = lockNow();

    let report = evaluate(keys, before, after);
    if (report.holes.length > 0 && !dryRun) {
        process.stdout.write(
            `grammar:residue — ${report.holes.length} hole(s); running gaps:sync once to file them\n`
        );
        spawnSync(
            "bun",
            [resolve(ROOT, "scripts/gaps-sync.ts"), NO_FILE_BOT_FLAG],
            {
                cwd: ROOT,
                stdio: "inherit",
            }
        );
        openCache.clear();
        report = evaluate(keys, before, lockNow());
    }

    const ledger = renderLedger(report, issue, pr);
    process.stdout.write(`${ledger}\n`);
    if (!dryRun) postLedger(issue, ledger);

    if (report.holes.length > 0) {
        process.stderr.write(
            `\ngrammar:residue — ${report.holes.length} residual gap(s) with NO open issue:\n` +
                report.holes
                    .map((h) => `  ${h.key}  (${h.cards.join(", ")})`)
                    .join("\n") +
                "\n\nFile each with /create-ticket (area:cards, `## Band` inherited via issue:inherit-band) " +
                "and add its claim to data/grammar-gaps.json — a card must never stay incomplete untracked.\n"
        );
        process.exit(1);
    }
}

main();
