// The AFK terminal's live status line (issue #4722): the pure fold over the
// driver's tags and the one-line format. The TTY-only drawing and the
// never-in-the-log guarantee are the wrapper's and the handoff's, proven in
// `loop-handoff.test.ts`.
import { describe, it, expect } from "vitest";
import { visibleLength, type RenderEnv } from "../lib/loop-render";
import {
    INITIAL_STATUS_LINE_STATE,
    SPINNER,
    formatStatusLines,
    observeStatusLine,
    type StatusLineState,
} from "../lib/loop-status-line";
import type { PassActivity } from "../lib/pass-activity";

const PLAIN: RenderEnv = { width: 200, color: false };
const S = "2026-09-27 10:00:00 ";
const SESSION = "0f8c2a4e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const T0 = 1_000_000;

const fold = (lines: string[], nowMs = T0): StatusLineState =>
    lines.reduce(
        (st, l) => observeStatusLine(st, l, nowMs),
        INITIAL_STATUS_LINE_STATE
    );
const PASS = `${S}loop-drain[pass]: pass 3 — issue #4722 on tier opus. session=${SESSION}`;
const END = `${S}loop-drain[end]: pass=3 exit=0 reason=- pct=1 queue_before=5 queue_after=4 spent=1200000 budget=9000000 ceiling=5000000 duration=60 retry=0`;

describe("observeStatusLine — only tags move it", () => {
    it("opens a pass on the start tag, bound to its session", () => {
        expect(fold([PASS]).inFlight).toEqual([
            {
                pass: "3",
                lane: null,
                label: "#4722 · opus",
                session: SESSION,
                startMs: T0,
            },
        ]);
    });

    it("names an override pass by its prompt", () => {
        const st = fold([
            `${S}loop-drain[pass]: pass 1 — prompt "/x y". session=${SESSION}`,
        ]);
        expect(st.inFlight[0]?.label).toBe('prompt "/x y"');
    });

    it("closes the pass on the end tag and keeps the run's spend and ceiling", () => {
        const st = fold([PASS, END]);
        expect(st.inFlight).toEqual([]);
        expect(st.spent).toBe(1_200_000);
        expect(st.ceiling).toBe(5_000_000);
    });

    it("ignores body text that merely looks like a tag's message", () => {
        expect(fold([`${S}pass 3 — issue #4722 on tier opus.`])).toEqual(
            INITIAL_STATUS_LINE_STATE
        );
    });

    it("clears the pass on the run summary", () => {
        expect(
            fold([PASS, `${S}loop-drain[summary]: passes=1 reason=budget`])
                .inFlight
        ).toEqual([]);
    });
});

const LANE_PASS = (pass: number, lane: number, issue: number, s: string) =>
    `${S}loop-drain[pass]: pass ${pass} — lane ${lane} — issue #${issue} on tier sonnet. session=${s}`;
const LANE_END = (pass: number, lane: number) =>
    `${S}loop-drain[end]: pass=${pass} lane=${lane} exit=0 reason=- pct=1 queue_before=5 queue_after=4 spent=1200000 budget=9000000 ceiling=5000000 duration=60 retry=0`;
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

describe("observeStatusLine — every lane in flight (issue #5546)", () => {
    it("keeps both lanes' passes, each with its lane and issue", () => {
        const st = fold([LANE_PASS(1, 1, 4500, S1), LANE_PASS(2, 2, 4568, S2)]);
        expect(
            st.inFlight.map((q) => [q.pass, q.lane, q.label, q.session])
        ).toEqual([
            ["1", "1", "#4500 · sonnet", S1],
            ["2", "2", "#4568 · sonnet", S2],
        ]);
    });

    it("an END closes only the pass it names; the other lane keeps running", () => {
        const st = fold([
            LANE_PASS(1, 1, 4500, S1),
            LANE_PASS(2, 2, 4568, S2),
            LANE_END(1, 1),
        ]);
        expect(st.inFlight.map((q) => q.pass)).toEqual(["2"]);
        expect(st.spent).toBe(1_200_000);
    });

    it("a lane's next pass replaces a row whose END was lost", () => {
        const st = fold([LANE_PASS(1, 1, 4500, S1), LANE_PASS(3, 1, 4600, S2)]);
        expect(st.inFlight.map((q) => q.pass)).toEqual(["3"]);
    });
});

describe("formatStatusLines", () => {
    const running = fold([END, PASS]);
    const none = () => null;

    it("draws nothing when no pass is in flight", () => {
        expect(formatStatusLines(fold([END]), none, T0, 0, PLAIN)).toEqual([]);
    });

    it("one row per lane, in lane order, run spend once, each with its own activity", () => {
        const st = fold([
            END,
            LANE_PASS(4, 2, 4568, S2),
            LANE_PASS(5, 1, 4500, S1),
        ]);
        const activity: PassActivity = {
            lastTool: { name: "Read", target: "x.ts" },
            activeSubagents: 0,
            tokens: 1000,
        };
        expect(
            formatStatusLines(
                st,
                (s) => (s === S2 ? activity : null),
                T0 + 5_000,
                0,
                PLAIN
            )
        ).toEqual([
            `${SPINNER[0]} · pass 5 · lane 1 · #4500 · sonnet · 5s · run 1.2M/5M`,
            `${SPINNER[0]} · pass 4 · lane 2 · #4568 · sonnet · 5s · Read x.ts · 0 subagents · pass 1k`,
        ]);
    });

    it("level A: spinner · pass · issue · tier · elapsed · run spend", () => {
        expect(
            formatStatusLines(running, none, T0 + 125_000, 0, PLAIN)
        ).toEqual([
            `${SPINNER[0]} · pass 3 · #4722 · opus · 2m05s · run 1.2M/5M`,
        ]);
    });

    it("says so when the run's spend is not known yet", () => {
        expect(formatStatusLines(fold([PASS]), none, T0, 1, PLAIN)).toEqual([
            `${SPINNER[1]} · pass 3 · #4722 · opus · 0s · run spend n/a`,
        ]);
    });

    it("level B adds the last tool, the active subagents and the pass tokens", () => {
        const activity: PassActivity = {
            lastTool: { name: "Bash", target: "bunx vitest run\n  x.test.ts" },
            activeSubagents: 2,
            tokens: 340_000,
        };
        expect(
            formatStatusLines(running, () => activity, T0, 0, PLAIN)
        ).toEqual([
            `${SPINNER[0]} · pass 3 · #4722 · opus · 0s · run 1.2M/5M · Bash bunx vitest run x.test.ts · 2 subagents · pass 340k`,
        ]);
    });

    it("truncates a long tool target and never exceeds width - 1 columns", () => {
        const activity: PassActivity = {
            lastTool: { name: "Bash", target: "x".repeat(500) },
            activeSubagents: 1,
            tokens: 1,
        };
        const [wide] = formatStatusLines(running, () => activity, T0, 0, PLAIN);
        expect(wide).toMatch(/Bash x{47}… · 1 subagent · pass 1$/);
        for (const color of [false, true]) {
            const env = { width: 40, color };
            const [line] = formatStatusLines(
                running,
                () => activity,
                T0,
                0,
                env
            );
            expect(visibleLength(line)).toBe(39);
        }
    });
});
