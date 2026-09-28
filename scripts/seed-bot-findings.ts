/**
 * `bun run seed:bot-findings [--dry-run]` — write the Bot Findings admin
 * page's tables from the committed measurement (ADR 0141 § 4, issue #4176).
 *
 * Reads `data/bot-reach-findings.json` (the artifact `bun run bot:reach`
 * writes), `data/grammar-gaps.json` (the `gaps:sync` claims, for each class's
 * issue) and `data/card-index.json` (first prints; the hand-written set), and
 * hands one payload to the internal mutation `botFindings:seed` — the ONLY
 * writer of a measured field. Re-running it rewrites the measured fields and
 * leaves the human ones (note, reproducers, linked issue, snooze) untouched;
 * a card the artifact no longer carries is deactivated, never dropped.
 *
 * Same constraints as `seed:preset`, for the same reasons: the write runs in
 * the PRIMARY CHECKOUT (its `.env.local` names the deployment; a worktree has
 * none), and it is NOT a gate — the rows are deployment-local, the artifact
 * is the source of truth. `--dry-run` builds the payload and prints its
 * summary, touching no deployment.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllRawCards } from "../convex/cards/catalogue";
import {
    buildBotFindingsPayload,
    handWrittenPrintIds,
    type CardIndexEntry,
} from "./lib/bot-findings-seed";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { FINDINGS_PATH, parseFindings } from "./lib/oracle-bot-reach";
import { POOL_PROJECTION_SOURCE } from "./lib/oracle-lockfile";
import { resolveSeedTarget } from "./lib/seed-preset-run";
import type { ClaimRow } from "./lib/targets";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T;
}

const cardIndex = readJson<CardIndexEntry[]>(POOL_PROJECTION_SOURCE);
const payload = buildBotFindingsPayload({
    artifact: parseFindings(readFileSync(join(ROOT, FINDINGS_PATH), "utf8")),
    claims: readJson<{ claims: ClaimRow[] }>("data/grammar-gaps.json").claims,
    cardIndex,
    handWritten: new Set(
        handWrittenPrintIds(
            cardIndex,
            getAllRawCards().map((raw) => raw.id)
        ).keys()
    ),
});

const m = payload.measurement;
console.log(
    `bot findings: ${payload.findings.length} finding(s), ${payload.classes.length} class(es), ` +
        `${payload.played.length} played — measured ${m.measuredCount} of ${m.targetCardCount} ` +
        `Target card(s) (${m.targets.join(", ")}), ${m.unmeasuredHandWrittenCount} hand-written ` +
        `card(s) unmeasured; sha ${m.sha.slice(0, 9)}, measured ${m.measuredAt}`
);

if (process.argv.includes("--dry-run")) process.exit(0);

const plan = resolveSeedTarget("local");
if (plan.error || !plan.cwd) {
    console.error(`seed:bot-findings: ${plan.error ?? "no deployment"}`);
    process.exit(1);
}
const res = spawnSync(
    "npx",
    [
        "convex",
        "run",
        ...(plan.flags ?? []),
        "botFindings:seed",
        JSON.stringify({ payload }),
    ],
    { cwd: plan.cwd, encoding: "utf8", timeout: 120_000 }
);
if (res.error || res.status !== 0) {
    const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
    console.error(
        `seed:bot-findings: ${res.error?.message ?? convexRunErrorMessage(out)}`
    );
    process.exit(1);
}
console.log(`seed:bot-findings: ${(res.stdout ?? "").trim()}`);
