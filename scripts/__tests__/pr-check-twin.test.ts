import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
    cancelledTwinRuns,
    healQueueTwins,
    healTwinBeforeLabel,
    nonGreenPrCheckJobs,
    parseTwinCheckRuns,
    PR_CHECK_JOB_NAMES,
    requeueRefusedComment,
    TWIN_FLIP_TIMEOUT_MS,
    twinHoldComment,
    twinHoldSaid,
    type TwinCheckRun,
} from "../lib/pr-check-twin";
import {
    heldPrAction,
    LANE_CHECK_NAME,
    REQUEUE_GRACE_MS,
} from "../lib/pr-gate";

const LANE = LANE_CHECK_NAME;
const url = (runId: number) =>
    `https://github.com/o/r/actions/runs/${runId}/job/1`;
const check = (over: Partial<TwinCheckRun>): TwinCheckRun => ({
    id: 1,
    name: LANE,
    status: "completed",
    conclusion: "success",
    suiteId: 100,
    detailsUrl: url(9),
    ...over,
});

/** PR #8266 before the hand re-run: the cancelled run holds the older id and
 *  the HIGHER suite, so neither id nor `started_at` names it. */
const INVERTED = [
    check({
        id: 127271628016,
        conclusion: "cancelled",
        suiteId: 113902978674,
        detailsUrl: url(42035261058),
    }),
    check({
        id: 127271641019,
        suiteId: 113902978401,
        detailsUrl: url(42035261007),
    }),
];
/** The ordinary twin (PR #8290): cancelled in the LOWER suite; it landed. */
const ORDINARY = [
    check({
        id: 127354897244,
        conclusion: "cancelled",
        suiteId: 113969254331,
        detailsUrl: url(42058935863),
    }),
    check({
        id: 127354915580,
        suiteId: 113969258909,
        detailsUrl: url(42058937655),
    }),
];

describe("cancelledTwinRuns — the twin the queue reads as red (issue #8291)", () => {
    it("re-runs a cancelled run in the higher suite over a green twin", () => {
        expect(cancelledTwinRuns(INVERTED)).toEqual([42035261058]);
    });

    it("leaves a cancelled run in the lower suite alone: the queue ignores it", () => {
        expect(cancelledTwinRuns(ORDINARY)).toEqual([]);
    });

    it("re-runs over a twin still going: the re-run replaces it, one suite up", () => {
        expect(
            cancelledTwinRuns([
                INVERTED[0]!,
                { ...INVERTED[1]!, status: "in_progress", conclusion: null },
            ])
        ).toEqual([42035261058]);
    });

    it("never touches a real red: a failure on either side is a repair pick", () => {
        expect(
            cancelledTwinRuns([
                INVERTED[0]!,
                { ...INVERTED[1]!, conclusion: "failure" },
            ])
        ).toEqual([]);
        expect(
            cancelledTwinRuns([
                { ...INVERTED[0]!, conclusion: "failure" },
                INVERTED[1]!,
            ])
        ).toEqual([]);
    });

    it("needs a twin: a lone cancelled run says nothing about a superseded one", () => {
        expect(cancelledTwinRuns([INVERTED[0]!])).toEqual([]);
    });

    it("is done once re-run: the suite's newest run stands, even read unfiltered", () => {
        const rerun = check({
            id: 127310296556,
            status: "in_progress",
            conclusion: null,
            suiteId: 113902978674,
            detailsUrl: url(42035261058),
        });
        expect(cancelledTwinRuns([...INVERTED, rerun])).toEqual([]);
    });

    it("sees a refusal job's twin, and one run however many jobs it cancelled", () => {
        const receipt = INVERTED.map((c) => ({ ...c, name: "ui-receipt" }));
        expect(cancelledTwinRuns(receipt)).toEqual([42035261058]);
        expect(cancelledTwinRuns([...INVERTED, ...receipt])).toEqual([
            42035261058,
        ]);
    });

    it("ignores a job pr-check does not post, and a check off Actions", () => {
        expect(
            cancelledTwinRuns(INVERTED.map((c) => ({ ...c, name: "other" })))
        ).toEqual([]);
        expect(
            cancelledTwinRuns([
                { ...INVERTED[0]!, detailsUrl: null },
                INVERTED[1]!,
            ])
        ).toEqual([]);
    });
});

describe("PR_CHECK_JOB_NAMES — the jobs pr-check.yml posts", () => {
    it("names exactly the lane and the refusal matrix", () => {
        const wf = parse(
            readFileSync(
                join(
                    import.meta.dirname,
                    "../../.github/workflows/pr-check.yml"
                ),
                "utf8"
            )
        ) as {
            jobs: {
                lane: { name: string };
                refusals: { strategy: { matrix: { check: string[] } } };
            };
        };
        expect([...PR_CHECK_JOB_NAMES].sort()).toEqual(
            [
                wf.jobs.lane.name,
                ...wf.jobs.refusals.strategy.matrix.check,
            ].sort()
        );
    });
});

describe("heldPrAction — a held PR with a cancelled twin (issue #8291)", () => {
    const NOW = Date.parse("2026-11-05T15:00:00Z");
    const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
    const held = {
        labels: ["ready-to-land", "queue:held"],
        lineage: { kind: "green" as const },
        baseHealth: "success" as const,
        trustedAuthor: "success" as const,
        lastRequeueAt: (): string | null => null,
        laneRedStale: () => false,
        twinHolds: () => false,
        now: NOW,
    };
    const onHead = (runs: TwinCheckRun[]) => ({
        ...held,
        twinHolds: () => cancelledTwinRuns(runs).length > 0,
    });

    it("holds on the inverted twin: no requeue that cannot take", () => {
        expect(heldPrAction(onHead(INVERTED))).toBe("twin");
    });

    it("never releases it, however old the requeue: release is the false land-failed", () => {
        expect(
            heldPrAction({
                ...onHead(INVERTED),
                lastRequeueAt: () => ago(REQUEUE_GRACE_MS / 60_000 + 60),
            })
        ).toBe("twin");
    });

    it("treats the ordinary twin as no twin: requeue, then the grace", () => {
        expect(heldPrAction(onHead(ORDINARY))).toBe("requeue");
        expect(
            heldPrAction({
                ...onHead(ORDINARY),
                lastRequeueAt: () => ago(REQUEUE_GRACE_MS / 60_000 + 1),
            })
        ).toBe("release-refused");
    });

    it("lets a real lane failure reach the repair-pick rules", () => {
        const red = [
            check({ conclusion: "failure", suiteId: 200 }),
            check({ conclusion: "cancelled", suiteId: 100 }),
        ];
        expect(heldPrAction(onHead(red))).toBe("requeue");
        expect(
            heldPrAction({
                ...onHead(red),
                lastRequeueAt: () => ago(REQUEUE_GRACE_MS / 60_000 + 1),
            })
        ).toBe("release-refused");
    });

    it("releases once queued, without reading the twin", () => {
        expect(
            heldPrAction({
                ...held,
                labels: [...held.labels, "queued"],
                twinHolds: () => {
                    throw new Error("read");
                },
            })
        ).toBe("release");
    });
});

describe("healQueueTwins — the sweep with the owner's credentials", () => {
    const pr = (number: number, labels: string[]) => ({
        number,
        headRefOid: `sha${number}`,
        labels,
    });

    it("re-runs only a PR the queue would take", () => {
        const rerun: number[] = [];
        const read: string[] = [];
        const healed = healQueueTwins({
            prs: [
                pr(1, ["ready-to-land"]),
                pr(2, ["ready-to-land", "queue:held"]),
                pr(3, ["ready-to-land", "queued"]),
                pr(4, ["ready-to-land", "land-failed"]),
                pr(5, []),
            ],
            read: (sha) => {
                read.push(sha);
                return INVERTED;
            },
            rerun: (id) => rerun.push(id),
            say: () => {},
        });
        expect(healed).toEqual([1, 2]);
        expect(read).toEqual(["sha1", "sha2"]);
        expect(rerun).toEqual([42035261058, 42035261058]);
    });

    it("re-runs nothing for an ordinary twin", () => {
        const rerun: number[] = [];
        expect(
            healQueueTwins({
                prs: [pr(1, ["ready-to-land"])],
                read: () => ORDINARY,
                rerun: (id) => rerun.push(id),
                say: () => {},
            })
        ).toEqual([]);
        expect(rerun).toEqual([]);
    });

    it("passes over one PR's failure and heals the next", () => {
        const said: string[] = [];
        const healed = healQueueTwins({
            prs: [pr(1, ["ready-to-land"]), pr(2, ["ready-to-land"])],
            read: (sha) => {
                if (sha === "sha1") throw new Error("HTTP 502\ndetail");
                return INVERTED;
            },
            rerun: () => {},
            say: (l) => said.push(l),
        });
        expect(healed).toEqual([2]);
        expect(said).toContain("PR #1: twin not healed (HTTP 502)");
    });
});

describe("healTwinBeforeLabel — the label waits for the check to flip", () => {
    const clock = () => {
        let t = 0;
        return {
            now: () => t,
            sleep: (ms: number) => {
                t += ms;
            },
        };
    };

    it("does nothing on a head with no such twin", () => {
        const rerun: number[] = [];
        expect(
            healTwinBeforeLabel({
                read: () => ORDINARY,
                rerun: (id) => rerun.push(id),
                ...clock(),
                say: () => {},
            })
        ).toBe(true);
        expect(rerun).toEqual([]);
    });

    it("re-runs once, then answers only when the cancelled check is gone", () => {
        const rerun: number[] = [];
        let reads = 0;
        expect(
            healTwinBeforeLabel({
                read: () => (++reads < 3 ? INVERTED : ORDINARY),
                rerun: (id) => rerun.push(id),
                ...clock(),
                say: () => {},
            })
        ).toBe(true);
        expect(rerun).toEqual([42035261058]);
        expect(reads).toBe(3);
    });

    it("answers false past the deadline, so the label never goes on", () => {
        const c = clock();
        expect(
            healTwinBeforeLabel({
                read: () => INVERTED,
                rerun: () => {},
                ...c,
                say: () => {},
            })
        ).toBe(false);
        expect(c.now()).toBeGreaterThanOrEqual(TWIN_FLIP_TIMEOUT_MS);
    });
});

describe("what the PR says (issue #8291)", () => {
    it("says the twin hold once per head", () => {
        const body = twinHoldComment("4b0eaa42f696", [42035261058]);
        expect(body).toContain("`gh run rerun 42035261058`");
        expect(twinHoldSaid([{ body }], "4b0eaa42f696")).toBe(true);
        expect(twinHoldSaid([{ body }], "aaaaaaaaaaaa")).toBe(false);
        expect(twinHoldSaid([], "4b0eaa42f696")).toBe(false);
    });

    it("names what the queue still refuses after the grace", () => {
        const body = requeueRefusedComment({
            requeuedAt: "2026-11-05T13:38:36Z",
            graceMinutes: 10,
            nonGreen: nonGreenPrCheckJobs([
                check({ conclusion: "failure" }),
                check({ name: "scenario", conclusion: null, status: "queued" }),
                check({ name: "ui-receipt" }),
                check({ name: "retired-rows", conclusion: "skipped" }),
            ]),
        });
        expect(body).toContain("2026-11-05T13:38:36Z");
        expect(body).toContain(`\`${LANE} (failure)\``);
        expect(body).toContain("`scenario (queued)`");
        expect(body).not.toContain("ui-receipt");
        expect(body).not.toContain("retired-rows");
    });

    it("says so when no job is red, or none could be read", () => {
        const say = (nonGreen: string[] | null) =>
            requeueRefusedComment({
                requeuedAt: null,
                graceMinutes: 10,
                nonGreen,
            });
        expect(say([])).toContain("green or still running");
        expect(say(null)).toContain("could not be read");
    });
});

describe("parseTwinCheckRuns", () => {
    it("reads the NDJSON the jq prints, blank lines aside", () => {
        const row = check({});
        expect(parseTwinCheckRuns(`${JSON.stringify(row)}\n\n`)).toEqual([row]);
    });
});
