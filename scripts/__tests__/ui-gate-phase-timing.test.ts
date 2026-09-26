// Per-cell phase timing for `check:ui` (issue #4687): the ruler every
// affordability lever is ranked on. Pure arithmetic over the numbers `timed`
// collected — no browser here.
import { describe, expect, it } from "vitest";
import {
    cellTimingSuffix,
    emptyTimings,
    PHASES,
    phaseSummaryLines,
    timed,
    totalMs,
    type CellTiming,
} from "../ui-gate/phase-timing";

describe("timed — charges a phase whether the step resolved or threw", () => {
    it("adds the step's wall time to its phase and returns the value", async () => {
        const t = emptyTimings();
        let clock = 1000;
        const now = () => clock;
        const value = await timed(
            t,
            "probe",
            async () => {
                clock += 250;
                return "probed";
            },
            now
        );
        expect(value).toBe("probed");
        expect(t.probe).toBe(250);
        expect(totalMs(t)).toBe(250);
    });

    it("accumulates across attempts of the same phase", async () => {
        const t = emptyTimings();
        let clock = 0;
        const now = () => clock;
        const walk = async () => {
            clock += 100;
        };
        await timed(t, "walk", walk, now);
        await timed(t, "walk", walk, now);
        expect(t.walk).toBe(200);
    });

    it("charges a step that threw — a failed walk still cost what it cost", async () => {
        const t = emptyTimings();
        let clock = 0;
        const now = () => clock;
        await expect(
            timed(
                t,
                "walk",
                async () => {
                    clock += 700;
                    throw new Error("navigation timed out");
                },
                now
            )
        ).rejects.toThrow("navigation timed out");
        expect(t.walk).toBe(700);
    });
});

describe("cellTimingSuffix — the cell line's timing column", () => {
    it("prints every phase in lane order, in seconds to one decimal, then the sum", () => {
        const t = emptyTimings();
        t.walk = 1234;
        t.settle = 310;
        t.probe = 450;
        t.axe = 905;
        t.screenshot = 160;
        t.assertions = 80;
        t.cleanup = 20;
        expect(cellTimingSuffix(t)).toBe(
            " | t walk1.2 settle0.3 probe0.5 axe0.9 shot0.2 assert0.1 clean0.0 =3.2s"
        );
    });

    it("names every phase exactly once", () => {
        const suffix = cellTimingSuffix(emptyTimings());
        for (const p of PHASES) {
            const short =
                p === "screenshot"
                    ? "shot"
                    : p === "assertions"
                      ? "assert"
                      : p === "cleanup"
                        ? "clean"
                        : p;
            expect(
                suffix.split(` ${short}`).length - 1,
                `${p} in "${suffix}"`
            ).toBe(1);
        }
    });
});

function cell(
    surface: string,
    viewport: string,
    ms: Partial<Record<(typeof PHASES)[number], number>>
): CellTiming {
    return { surface, viewport, ms: { ...emptyTimings(), ...ms } };
}

describe("phaseSummaryLines — where the run's time went", () => {
    it("totals each phase, shares it against the phases' sum, and names the worst cell", () => {
        const cells = [
            cell("lobby", "1440x900x2", { walk: 2000, axe: 1000 }),
            cell("lobby", "390x844x3", { walk: 4000, axe: 1000 }),
            cell("board", "1440x900x2", { walk: 1000, axe: 1000, probe: 2000 }),
        ];
        const lines = phaseSummaryLines(cells, 20_000);
        expect(lines[0]).toBe(
            "phase timing: 3 cell(s), phases sum 12.0s of 20.0s wall — the rest is sign-in, self-check, warm-up, INFRA waits and the pool's serial tail"
        );
        // walk: 7000 of 12000 = 58%, mean 2333, max the phone lobby cell.
        expect(lines[1]).toBe(
            "  walk        total     7.0s   58%  mean   2.3s  max   4.0s (lobby @ 390x844x3)"
        );
        // axe: 3000 = 25%; ties keep the FIRST cell in walk order.
        expect(lines[4]).toBe(
            "  axe         total     3.0s   25%  mean   1.0s  max   1.0s (lobby @ 1440x900x2)"
        );
        // probe: only the board cell.
        expect(lines[3]).toBe(
            "  probe       total     2.0s   17%  mean   0.7s  max   2.0s (board @ 1440x900x2)"
        );
        expect(lines).toHaveLength(1 + PHASES.length);
    });

    it("says so when no cell was measured, instead of dividing by zero", () => {
        expect(phaseSummaryLines([], 5_000)).toEqual([
            "phase timing: no cell was measured",
        ]);
    });
});
