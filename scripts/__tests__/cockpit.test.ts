import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    buildIsStale,
    cockpitArtifactCache,
    cockpitDir,
    cockpitReadingPath,
    machinesToReport,
    runnerViews,
} from "../lib/cockpit";
import { parseCockpitReading } from "../lib/cockpit-reading";
import {
    parseMachineReading,
    type MachineReading,
} from "../lib/workflow-trends";
import type { RunnerRow } from "../lib/afk-dispatch";

/**
 * The cockpit's pure decisions (issue #5652). `runners.json` is GitHub's own
 * answer to `repos/…/actions/runners` through `scripts/cockpit.ts`'s jq,
 * recorded 2026-10-21 (names kept, nothing else is in it); the machine
 * readings are `workflow-trends.test.ts`'s.
 */

const FIXTURES = join(__dirname, "fixtures");
const machine = (name: string): MachineReading =>
    parseMachineReading(
        readFileSync(join(FIXTURES, "workflow-trends", name), "utf8")
    )!;

describe("runnerViews — GitHub's runner list as the page shows it", () => {
    const rows = JSON.parse(
        readFileSync(join(FIXTURES, "cockpit", "runners.json"), "utf8")
    ) as RunnerRow[];

    it("reads each runner's host, roles and state, by host then name", () => {
        expect(
            runnerViews(rows).map((v) => [v.name, v.host, v.roles, v.state])
        ).toEqual([
            ["huawei-lane-1", "huawei", ["lane"], "busy"],
            ["huawei-pass-1", "huawei", ["pass"], "busy"],
            ["huawei-pass-2", "huawei", ["pass"], "busy"],
            ["macbook-lane-1", "macbook", ["lane"], "busy"],
            ["macbook-pass-1", "macbook", ["pass"], "busy"],
            ["macbook-pass-2", "macbook", ["pass"], "busy"],
            ["macbook-seed-1", "macbook", ["seed"], "idle"],
        ]);
    });

    it("an offline runner is offline even mid-job; GitHub's own labels are not roles", () => {
        expect(
            runnerViews([
                {
                    name: "huawei-pass-1",
                    status: "offline",
                    busy: true,
                    labels: [
                        "self-hosted",
                        "Linux",
                        "X64",
                        "pass",
                        "host:huawei",
                    ],
                },
                {
                    name: "orphan",
                    status: "online",
                    busy: false,
                    labels: ["self-hosted"],
                },
            ])
        ).toEqual([
            { name: "orphan", host: null, roles: [], state: "idle" },
            {
                name: "huawei-pass-1",
                host: "huawei",
                roles: ["pass"],
                state: "offline",
            },
        ]);
    });
});

describe("machinesToReport — this machine fresh, every other host's newest", () => {
    it("drops this machine's stored reading and keeps one per other host", () => {
        const fresh = { ...machine("machine-macbook.json"), host: "macbook" };
        const stale = { ...fresh, budget: null };
        const huawei = { ...machine("machine-huawei.json"), host: "huawei" };
        const older = { ...huawei, latency: null };
        expect(machinesToReport(fresh, [stale, huawei, older])).toEqual([
            fresh,
            huawei,
        ]);
        expect(machinesToReport(fresh, [])).toEqual([fresh]);
    });
});

describe("where the reading lives", () => {
    it("under the machine's cache, never a checkout — or where TOLARIA_COCKPIT_DIR says", () => {
        expect(cockpitDir({}, "/home/u")).toBe(
            "/home/u/.cache/tolaria/cockpit"
        );
        const env = { TOLARIA_COCKPIT_DIR: "/tmp/c" };
        expect(cockpitDir(env)).toBe("/tmp/c");
        expect(cockpitReadingPath(env)).toBe("/tmp/c/cockpit.json");
        expect(cockpitArtifactCache(env)).toBe("/tmp/c/artifacts");
    });
});

describe("buildIsStale — the page is rebuilt when a source moved", () => {
    it("builds with no build, and when a source is newer than it", () => {
        expect(buildIsStale(null, 0)).toBe(true);
        expect(buildIsStale(2_000, 3_000)).toBe(true);
        expect(buildIsStale(3_000, 3_000)).toBe(false);
        expect(buildIsStale(3_000, 2_000)).toBe(false);
    });
});

describe("parseCockpitReading — a reading this page can render, or none", () => {
    const reading = {
        version: 1,
        readAt: "2026-10-21T12:00:00.000Z",
        host: "macbook",
        trends: null,
        runners: null,
        errors: ["GitHub could not be read: HTTP 502"],
    };

    it("takes a reading of its version, with or without trends", () => {
        expect(parseCockpitReading(JSON.stringify(reading))).toEqual(reading);
        const withTrends = { ...reading, trends: { version: 2 } };
        expect(parseCockpitReading(JSON.stringify(withTrends))).toEqual(
            withTrends
        );
    });

    it("refuses another version of the reading or of its trends, and junk", () => {
        expect(
            parseCockpitReading(JSON.stringify({ ...reading, version: 2 }))
        ).toBeNull();
        expect(
            parseCockpitReading(
                JSON.stringify({ ...reading, trends: { version: 1 } })
            )
        ).toBeNull();
        expect(parseCockpitReading("{not json")).toBeNull();
        expect(parseCockpitReading("null")).toBeNull();
    });
});
