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
 *
 * The seed also stamps the Bot's hash AT THIS CHECKOUT on the measurement, so
 * re-seeding after the Bot moved flags every row measured under the old hash
 * as stale — rows are marked, never hidden (issue #4181). The health batch
 * runs `bot:reach` then this, when — and only when — its diff touched the Bot
 * (`lib/health-bot-refresh.ts`).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllRawCards } from "../convex/cards/catalogue";
import { buildBotFindingsPayload } from "./lib/bot-findings-seed";
import {
    handWrittenPrintIds,
    type CardIndexEntry,
} from "./lib/hand-written-catalogue";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { botHash, FINDINGS_PATH, parseFindings } from "./lib/oracle-bot-reach";
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
    // Hashed HERE, at the checkout that seeds: a Bot that moved since the
    // artifact was measured marks its rows stale on the page (issue #4181).
    currentBotHash: botHash(ROOT),
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
        `card(s) unmeasured; sha ${m.sha.slice(0, 9)}, measured ${m.measuredAt}` +
        (m.botHash === m.currentBotHash ? "" : " — STALE: the Bot moved since")
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
