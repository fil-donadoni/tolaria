import { describe, expect, it } from "vitest";
import {
    DEFAULT_STALL_MINUTES,
    laneState,
    parseRepairWatchConfig,
    queueState,
    repairWatchDecision,
    type RepairWatchInput,
} from "../lib/repair-watch";

const SHA = "5ab0781a" + "0".repeat(32);
const RED_AT = "2026-10-27T06:00:00Z";
const at = (min: number) => Date.parse(RED_AT) + min * 60_000;

function input(over: Partial<RepairWatchInput> = {}): RepairWatchInput {
    return {
        lineage: "red",
        redSha: SHA,
        redAt: RED_AT,
        now: at(45),
        config: { stallMinutes: 30 },
        repairs: [
            {
                issue: 7135,
                pr: {
                    number: 7136,
                    state: "OPEN",
                    labels: ["ready-to-land", "queue:held"],
                },
            },
        ],
        lane: "offline",
        ...over,
    };
}

describe("repairWatchDecision (issue #7142)", () => {
    it("a RED past the bound with a held repair PR notifies with every field", () => {
        const d = repairWatchDecision(input());
        expect(d.action).toBe("notify");
        if (d.action !== "notify") return;
        expect(d.message).toContain("RED 5ab0781a stands 45 min");
        expect(d.message).toContain("repair issue #7135: PR #7136 — held");
        expect(d.message).toContain("lane runner: offline");
    });

    it("a RED under the bound sends nothing", () => {
        expect(repairWatchDecision(input({ now: at(29) })).action).toBe("none");
    });

    it("a RED past the bound with no declared repair says so", () => {
        const d = repairWatchDecision(input({ repairs: [] }));
        expect(d.action).toBe("notify");
        if (d.action !== "notify") return;
        expect(d.message).toContain("No declared repair at all");
    });

    it("a merged repair sends nothing: health settles the RED", () => {
        const d = repairWatchDecision(
            input({
                repairs: [
                    {
                        issue: 7135,
                        pr: { number: 7136, state: "MERGED", labels: [] },
                    },
                ],
            })
        );
        expect(d.action).toBe("none");
    });

    it("the same state on a later tick keeps the key; a changed state moves it", () => {
        const key = (over: Partial<RepairWatchInput>) => {
            const d = repairWatchDecision(input(over));
            return d.action === "notify" ? d.key : null;
        };
        const first = key({});
        expect(first).not.toBeNull();
        expect(key({ now: at(90) })).toBe(first);
        expect(key({ lane: "online" })).not.toBe(first);
        expect(key({ redSha: "f".repeat(40) })).not.toBe(first);
        expect(
            key({
                repairs: [
                    {
                        issue: 7135,
                        pr: {
                            number: 7136,
                            state: "OPEN",
                            labels: ["ready-to-land", "queued"],
                        },
                    },
                ],
            })
        ).not.toBe(first);
    });

    it("a lane runner flapping between busy and idle is not news", () => {
        const a = repairWatchDecision(input({ lane: "busy" }));
        const b = repairWatchDecision(input({ lane: "online" }));
        expect(a.action === "notify" && b.action === "notify").toBe(true);
        if (a.action !== "notify" || b.action !== "notify") return;
        expect(a.key).toBe(b.key);
    });

    it("a GREEN or AMBER base clears the dedupe and sends nothing", () => {
        expect(repairWatchDecision(input({ lineage: "green" })).action).toBe(
            "clear"
        );
        expect(repairWatchDecision(input({ lineage: "amber" })).action).toBe(
            "clear"
        );
    });

    it("an unreadable lineage neither sends nor clears", () => {
        expect(repairWatchDecision(input({ lineage: "none" })).action).toBe(
            "none"
        );
        expect(repairWatchDecision(input({ lineage: "infra" })).action).toBe(
            "none"
        );
    });
});

describe("queueState", () => {
    const open = (labels: string[]) => ({ number: 1, state: "OPEN", labels });
    it("reads the queue off the labels", () => {
        expect(queueState(null)).toBe("no PR");
        expect(queueState({ number: 1, state: "MERGED", labels: [] })).toBe(
            "merged"
        );
        expect(queueState({ number: 1, state: "CLOSED", labels: [] })).toBe(
            "closed"
        );
        expect(queueState(open(["ready-to-land", "land-failed"]))).toBe(
            "land-failed"
        );
        expect(
            queueState(open(["ready-to-land", "queue:held", "queued"]))
        ).toBe("held");
        expect(queueState(open(["ready-to-land", "queued"]))).toBe("queued");
        expect(queueState(open(["ready-to-land"]))).toBe("dequeued");
        expect(queueState(open([]))).toBe("not handed off");
    });
});

describe("laneState", () => {
    const row = (status: string, busy: boolean, labels = ["lane"]) => ({
        name: "r",
        status,
        busy,
        labels,
    });
    it("names the lane runners' state", () => {
        expect(laneState(null)).toBe("unknown");
        expect(laneState([])).toBe("offline");
        expect(laneState([row("offline", false)])).toBe("offline");
        expect(laneState([row("online", false, ["maint"])])).toBe("offline");
        expect(laneState([row("online", true)])).toBe("busy");
        expect(laneState([row("online", true), row("online", false)])).toBe(
            "online"
        );
    });
});

describe("parseRepairWatchConfig", () => {
    it("reads the bound, falling back on a missing or bad value", () => {
        expect(
            parseRepairWatchConfig({ repairWatch: { stallMinutes: 45 } })
        ).toEqual({ stallMinutes: 45 });
        expect(parseRepairWatchConfig(null).stallMinutes).toBe(
            DEFAULT_STALL_MINUTES
        );
        expect(
            parseRepairWatchConfig({ repairWatch: { stallMinutes: -1 } })
                .stallMinutes
        ).toBe(DEFAULT_STALL_MINUTES);
    });
});
