import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PassRecord } from "../../../../scripts/lib/afk-dispatch";
import type { CockpitReading } from "../../../../scripts/lib/cockpit-reading";
import { runnerViews } from "../../../../scripts/lib/cockpit";
import {
    parseMachineReading,
    weeklyTrends,
    type HistoryNode,
    type PrTimeline,
} from "../../../../scripts/lib/workflow-trends";

/**
 * A reading built the way `scripts/cockpit.ts` builds one, over the recorded
 * GitHub answers `scripts/__tests__/workflow-trends.test.ts` uses — so the
 * page is tested on the trends the aggregation really produces, not on a
 * hand-written shape that could drift from it.
 */
const SCRIPT_FIXTURES = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "scripts",
    "__tests__",
    "fixtures"
);
const text = (dir: string, name: string) =>
    readFileSync(join(SCRIPT_FIXTURES, dir, name), "utf8");
const json = <T>(name: string) =>
    JSON.parse(text("workflow-trends", name)) as T;

export function fixtureReading(
    over: Partial<CockpitReading> = {}
): CockpitReading {
    const trends = weeklyTrends({
        window: { from: "2026-10-18T10:30:00Z", to: "2026-10-20T10:30:00Z" },
        prs: json<PrTimeline[]>("pr-timelines.json"),
        issuesOpened: 50,
        issuesClosed: 95,
        history: json<HistoryNode[]>("base-history.json"),
        escalations: ["RED ladder stopped @ 4db4ed91"],
        flakyIssues: ["Flaky test: scripts/__tests__/gate-run.test.ts"],
        queueRuns: [],
        passes: json<PassRecord[]>("pass-records.json"),
        passRecordsMissing: 1,
        machines: ["machine-macbook.json", "machine-huawei.json"].map(
            (n) => parseMachineReading(text("workflow-trends", n))!
        ),
        readyForAgent: 441,
        issueAreas: { 5651: "workflow" },
    });
    return {
        version: 1,
        readAt: "2026-10-20T10:30:00.000Z",
        host: "filippos-macbook-pro",
        trends,
        runners: runnerViews(JSON.parse(text("cockpit", "runners.json"))),
        errors: [],
        ...over,
    };
}
