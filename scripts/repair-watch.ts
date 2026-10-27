#!/usr/bin/env bun
/**
 * `bun run repair:watch` — the stalled-repair alert (issue #7142): one tick
 * of `post-merge.yml`'s `repair-watch` job, pinned to a host that is NOT the
 * `lane` runner's, so the alert outlives the lane host asleep or offline.
 *
 * Reads the standing RED (verdict store), its declared repairs (the
 * `health-fix` pivot), each repair issue's closing PR, the `lane` runners;
 * `lib/repair-watch.ts` decides; a notice goes through `notifyOnce` (this
 * machine's marker under the primary checkout's
 * `.claude/telemetry/repair-watch/`). A fact that cannot be read ends the
 * tick with nothing sent and the marker kept: the next tick re-reads.
 *
 * Exit 0 always on a decided tick (an alert is a notice, not a red run);
 * 1 when a fact could not be read. `--dry-run` prints the decision only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gh } from "./lib/gh";
import { readPivotRepairOrigins } from "./lib/health-pivot";
import {
    originRepo,
    readVerdictLineage,
    verdictStore,
} from "./lib/health-verdict-store";
import { forgetNotice, notifyOnce } from "./lib/notify-owner";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    laneState,
    parseRepairWatchConfig,
    repairWatchDecision,
    type DeclaredRepair,
    type LaneRunnerRow,
    type RepairPr,
} from "./lib/repair-watch";

const dryRun = process.argv.includes("--dry-run");
const root = process.cwd();
const say = (line: string) => console.log(`repair:watch: ${line}`);

/** The PR that closes `issue`: a merged one first, else the newest open,
 *  else the newest; null when none is linked. */
function repairPr(slug: string, issue: number): RepairPr | null {
    const prs = gh([
        "issue",
        "view",
        String(issue),
        "--repo",
        slug,
        "--json",
        "closedByPullRequestsReferences",
        "--jq",
        ".closedByPullRequestsReferences[].number",
    ])
        .split("\n")
        .filter(Boolean)
        .map((n) => {
            const pr = JSON.parse(
                gh([
                    "pr",
                    "view",
                    n,
                    "--repo",
                    slug,
                    "--json",
                    "number,state,labels",
                    "--jq",
                    "{number, state, labels: [.labels[].name]}",
                ])
            ) as RepairPr;
            return pr;
        })
        .sort((a, b) => b.number - a.number);
    return (
        prs.find((p) => p.state === "MERGED") ??
        prs.find((p) => p.state === "OPEN") ??
        prs[0] ??
        null
    );
}

/** Every registered runner, or null when the API cannot be read. */
function runners(slug: string): LaneRunnerRow[] | null {
    try {
        return gh([
            "api",
            "--paginate",
            `repos/${slug}/actions/runners`,
            "--jq",
            ".runners[] | {name, status, busy, labels: [.labels[].name]} | @json",
        ])
            .split("\n")
            .filter((l) => l.trim() !== "")
            .map((l) => JSON.parse(l) as LaneRunnerRow);
    } catch (e) {
        say(`runners unreadable (${(e as Error).message.split("\n")[0]})`);
        return null;
    }
}

function main(): void {
    const primary = primaryCheckout();
    const marker = join(
        primary,
        ".claude",
        "telemetry",
        "repair-watch",
        "notice.json"
    );
    const config = parseRepairWatchConfig(
        JSON.parse(readFileSync(join(root, "tolaria.config.json"), "utf8"))
    );
    const lineage = readVerdictLineage(() => verdictStore(root));
    if (lineage.error) {
        say(`verdict store unreadable (${lineage.error}) — nothing decided`);
        process.exit(1);
    }
    const blocking = lineage.kind === "red" || lineage.kind === "second-red";
    let repairs: DeclaredRepair[] = [];
    let lane = laneState([]);
    if (blocking) {
        const slug = originRepo(root);
        try {
            const { ladder, foreign } = readPivotRepairOrigins(root);
            repairs = [...ladder, ...foreign]
                .sort((a, b) => a - b)
                .map((issue) => ({ issue, pr: repairPr(slug, issue) }));
        } catch (e) {
            say(
                `repairs unreadable (${(e as Error).message.split("\n")[0]}) — nothing decided`
            );
            process.exit(1);
        }
        lane = laneState(runners(slug));
    }
    const decision = repairWatchDecision({
        lineage: lineage.kind,
        redSha: blocking ? (lineage.verdict?.sha ?? null) : null,
        redAt: blocking ? (lineage.verdict?.at ?? null) : null,
        now: Date.now(),
        config,
        repairs,
        lane,
    });
    if (decision.action === "notify") {
        say(decision.message.replace(/\n/g, " | "));
        if (dryRun) return;
        const sent = notifyOnce(
            marker,
            decision.key,
            decision.message,
            "Tolaria: repair stalled"
        );
        say(sent ? "owner notified" : "same stall already notified");
        return;
    }
    say(decision.reason);
    if (decision.action === "clear" && !dryRun) forgetNotice(marker);
}

main();
