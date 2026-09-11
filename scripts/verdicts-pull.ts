#!/usr/bin/env bun
// `bun run verdicts:pull` — the one-way door from the `verdicts` table into
// git (issue #3402, PRD #3397, ADR 0124 §1).
//
// Testers judge Bot decisions in a browser, where there is no filesystem, so
// the judgements land in a Convex table. The FIT never reads that table: ADR
// 0124 §3 requires a fit to be reproducible from a checkout, and a corpus
// living in one person's deployment is a corpus nobody can re-derive. This
// command is the bridge — one JSON file per verdict under `data/verdicts/`,
// which is what `verdictCorpus` (`convex/gre/ai/verdicts/fileSource.ts`)
// reads beside the blade-registry verdicts.
//
// IT PULLS, IT NEVER PRUNES. Hand-authored verdicts live in the same directory
// — a counter-example cut by hand is exactly as much a verdict as one given in
// play — so a sweep that deleted "files with no row behind them" would delete
// precisely the ones no deployment can reproduce. A file already on disk whose
// `source` is not `in-play` is left alone and REPORTED, never overwritten.
//
// HOW IT REACHES AN ADMIN-GATED QUERY: same mechanism as `bun run scenario:ls`
// (`scenario-admin.ts`) — a plain `convex run` carries no caller identity, so
// `assertIsAdmin` throws; `--identity` supplies one, resolved from the
// deployment's own first `isAdmin` user.
//
// IT PUSHES FIRST (`--push`), unlike `scenario:ls`, and the difference is not
// taste: `scenario:ls` calls functions the deployment has had for many
// releases, while `verdicts:list` is new here. Without a push, the first run
// on any checkout that has not deployed this branch fails with "Could not find
// function verdicts:list" — the same ordering trap `seed-scenario-run.ts`
// documents having cost 10 of 14 scenario specs. ~15s, once, deterministic.
//
// The DEPLOYMENT call runs in the primary checkout (that is where `.env.local`
// names a deployment); the FILES are written in the current working tree,
// which is the checkout being reviewed. Those are two different directories on
// purpose — `primaryCheckout()` is for deployment state only.
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { convexRunArgv } from "./lib/seed-scenario-run";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    identityPayload,
    selectAdminIdentity,
    type UserRow,
} from "./lib/scenario-cli";
import {
    serializeVerdict,
    verdictFileNameOfRow,
    verdictFromRow,
    VERDICT_DIR,
    type VerdictRow,
} from "./lib/verdicts-file";

/** Room for the bundle upload the push performs, not just the call. */
const CALL_TIMEOUT_MS = 120_000;

function run(argv: string[]): string {
    const res = spawnSync("npx", argv, {
        cwd: primaryCheckout(),
        encoding: "utf8",
        timeout: CALL_TIMEOUT_MS,
    });
    if (res.error) throw new Error(res.error.message);
    if (res.status !== 0) {
        const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
        throw new Error(convexRunErrorMessage(out));
    }
    return (res.stdout ?? "").trim();
}

function adminIdentity(): string {
    const raw = run([
        "convex",
        "data",
        "users",
        "--format",
        "json",
        "--limit",
        "1000",
    ]);
    const users = (raw === "" ? [] : JSON.parse(raw)) as UserRow[];
    const id = selectAdminIdentity(users);
    if (id === null) {
        throw new Error(
            "no admin user on this deployment — flag one with `isAdmin: true` " +
                "(`verdicts:list` is `assertIsAdmin`-gated)"
        );
    }
    return identityPayload(id);
}

function listVerdicts(): VerdictRow[] {
    const out = run(
        convexRunArgv("verdicts:list", "{}", {
            push: true,
            identity: adminIdentity(),
        })
    );
    return out === "" ? [] : (JSON.parse(out) as VerdictRow[]);
}

/** `source` of a file already on disk: the string it declares, `null` when it
 *  declares none, or `"unreadable"` when the file cannot be parsed at all.
 *
 *  The three are kept apart because only the middle one means "somebody else's
 *  file, leave it": an UNREADABLE file is a truncated or corrupted export, and
 *  treating it as foreign would mean a re-pull can never repair it while the
 *  console says it is not an `in-play` export — a message that is false for
 *  exactly that case. */
function existingSource(path: string): string | null | "unreadable" {
    try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as {
            source?: unknown;
        };
        return typeof raw.source === "string" ? raw.source : null;
    } catch {
        return "unreadable";
    }
}

function main(): void {
    const dir = join(process.cwd(), VERDICT_DIR);
    const rows = listVerdicts();

    mkdirSync(dir, { recursive: true });
    let written = 0;
    let unchanged = 0;
    const skipped: string[] = [];
    const repaired: string[] = [];

    // Sorted by file name so the console receipt reads the same way twice,
    // whatever order the query returned.
    const sorted = [...rows].sort((a, b) =>
        verdictFileNameOfRow(a) < verdictFileNameOfRow(b) ? -1 : 1
    );
    for (const row of sorted) {
        const name = verdictFileNameOfRow(row);
        const path = join(dir, name);
        if (existsSync(path)) {
            const source = existingSource(path);
            // An unreadable file is OURS and broken: overwrite it. Anything
            // that declares another source belongs to a hand-author.
            if (source !== "in-play" && source !== "unreadable") {
                skipped.push(name);
                continue;
            }
            if (source === "unreadable") repaired.push(name);
        }
        const next = serializeVerdict(verdictFromRow(row));
        if (existsSync(path) && readFileSync(path, "utf8") === next) {
            unchanged += 1;
            continue;
        }
        writeFileSync(path, next);
        written += 1;
    }

    const onDisk = readdirSync(dir).filter((f) => f.endsWith(".json")).length;
    console.log(
        `verdicts:pull — ${rows.length} row(s) on the deployment: ` +
            `${written} written, ${unchanged} unchanged`
    );
    for (const name of skipped) {
        console.log(
            `  skipped ${name} — the file on disk is not an \`in-play\` export, so it was NOT overwritten`
        );
    }
    for (const name of repaired) {
        console.log(`  rewrote ${name} — the file on disk did not parse`);
    }
    console.log(`${VERDICT_DIR}/ now holds ${onDisk} verdict file(s)`);
}

if (import.meta.main) main();
