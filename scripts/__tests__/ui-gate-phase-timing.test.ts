// Per-cell phase timing for `check:ui` (issue #4687): the ruler every
// affordability lever is ranked on. Pure arithmetic over the numbers `timed`
// collected — no browser here.
import { describe, expect, it } from "vitest";
import {
    bindWalkLedger,
    cellTimingSuffix,
    chargeSub,
    emptyTimings,
    emptyWalkSplit,
    floorLines,
    newWalkLedger,
    PHASES,
    phaseSummaryLines,
    presence,
    timed,
    timedWalk,
    totalMs,
    unbindWalkLedger,
    WALK_SUBPHASES,
    walkLedgerOf,
    walkSplitSuffix,
    walkSplitSummaryLines,
    type CellTiming,
    type WalkLedger,
    type WalkSplit,
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
            "phase timing: 3 cell(s), phases sum 12.0s of 20.0s wall — the rest is the fixed floor (measured below), INFRA waits and the pool's serial tail"
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

// Walk sub-phases (issue #9268): `walk` split into goto / position /
// absentWait / interact, exclusive by nesting, summing to `walk` exactly.

/** A fake clock and a ledger over it: `tick(ms)` is the only way time passes. */
function clocked(): {
    t: ReturnType<typeof emptyTimings>;
    split: WalkSplit;
    ledger: WalkLedger;
    tick: (ms: number) => Promise<void>;
} {
    let clock = 0;
    const t = emptyTimings();
    const split = emptyWalkSplit();
    const ledger = newWalkLedger(split, () => clock);
    return {
        t,
        split,
        ledger,
        tick: async (ms) => {
            clock += ms;
        },
    };
}

function sumSplit(split: WalkSplit): number {
    return WALK_SUBPHASES.reduce((n, s) => n + split[s], 0);
}

describe("presence — a conditional click's miss is absentWait, a hit is not", () => {
    it("charges a probe that came back false to absentWait", async () => {
        const { t, split, ledger, tick } = clocked();
        await timedWalk(t, ledger, async () => {
            // `clickIfVisible(page, MULLIGAN_KEEP, 6000)` on a game already
            // past its mulligan: the probe waits out its timeout, then misses.
            const found = await presence(ledger, async () => {
                await tick(6000);
                return false;
            });
            expect(found).toBe(false);
        });
        expect(split.absentWait).toBe(6000);
        expect(split.interact).toBe(0);
        expect(t.walk).toBe(6000);
    });

    it("leaves a probe that found its element with the walk, not absentWait", async () => {
        const { t, split, ledger, tick } = clocked();
        await timedWalk(t, ledger, async () => {
            const found = await presence(ledger, async () => {
                await tick(400);
                return true;
            });
            expect(found).toBe(true);
        });
        expect(split.absentWait).toBe(0);
        expect(split.interact).toBe(400);
    });

    it("does not count a probe that threw as a miss", async () => {
        const { t, split, ledger, tick } = clocked();
        await expect(
            timedWalk(t, ledger, () =>
                presence(ledger, async () => {
                    await tick(300);
                    throw new Error("page closed");
                })
            )
        ).rejects.toThrow("page closed");
        expect(split.absentWait).toBe(0);
        expect(split.interact).toBe(300);
    });
});

describe("timedWalk + chargeSub — exclusive buckets that sum to walk", () => {
    it("charges the innermost bucket: a goto and a miss inside a position load", async () => {
        const { t, split, ledger, tick } = clocked();
        await timedWalk(t, ledger, async () => {
            await chargeSub(ledger, "goto", () => tick(1000)); // the lobby
            await tick(200); // a click
            await chargeSub(ledger, "position", async () => {
                await tick(500); // open the debug sheet
                await chargeSub(ledger, "goto", () => tick(800));
                await presence(ledger, async () => {
                    await tick(6000);
                    return false;
                });
                await tick(300); // the scenario row
            });
            await presence(ledger, async () => {
                await tick(100);
                return true;
            });
        });
        expect(split).toEqual({
            goto: 1800,
            position: 800,
            absentWait: 6000,
            interact: 300,
        });
        expect(t.walk).toBe(8900);
        expect(sumSplit(split)).toBe(t.walk);
    });

    it("keeps the sum across a walk that threw and its retry", async () => {
        const { t, split, ledger, tick } = clocked();
        await expect(
            timedWalk(t, ledger, async () => {
                await chargeSub(ledger, "goto", () => tick(700));
                await tick(50);
                throw new Error("navigation timed out");
            })
        ).rejects.toThrow("navigation timed out");
        await timedWalk(t, ledger, async () => {
            await chargeSub(ledger, "position", () => tick(900));
        });
        expect(split).toEqual({
            goto: 700,
            position: 900,
            absentWait: 0,
            interact: 50,
        });
        expect(sumSplit(split)).toBe(t.walk);
    });

    it("charges nothing outside a walk: no ledger, just the step", async () => {
        expect(await chargeSub(undefined, "goto", async () => 7)).toBe(7);
        expect(await presence(undefined, async () => false)).toBe(false);
    });
});

describe("bindWalkLedger — the helpers find the ledger through the page", () => {
    it("binds while the walk runs and unbinds after", () => {
        const page = {};
        const { ledger } = clocked();
        expect(walkLedgerOf(page)).toBeUndefined();
        bindWalkLedger(page, ledger);
        expect(walkLedgerOf(page)).toBe(ledger);
        unbindWalkLedger(page, ledger);
        expect(walkLedgerOf(page)).toBeUndefined();
    });

    it("never unbinds a newer attempt's ledger from the same page", () => {
        const page = {};
        const older = clocked().ledger;
        const newer = clocked().ledger;
        bindWalkLedger(page, older);
        bindWalkLedger(page, newer);
        unbindWalkLedger(page, older);
        expect(walkLedgerOf(page)).toBe(newer);
    });
});

describe("walkSplitSuffix / walkSplitSummaryLines — the walk's account", () => {
    it("appends the split to the cell line in sub-phase order", () => {
        expect(
            walkSplitSuffix({
                goto: 1040,
                position: 3110,
                absentWait: 6000,
                interact: 2250,
            })
        ).toBe(" [goto1.0 pos3.1 absent6.0 act2.3]");
    });

    it("totals each sub-phase, shares it against the walk, names the worst cell", () => {
        const cells: CellTiming[] = [
            {
                ...cell("game-board", "1440x900x2", { walk: 10_000 }),
                walk: {
                    goto: 2000,
                    position: 4000,
                    absentWait: 3000,
                    interact: 1000,
                },
            },
            {
                ...cell("lobby", "390x844x3", { walk: 6000 }),
                walk: {
                    goto: 3000,
                    position: 0,
                    absentWait: 0,
                    interact: 3000,
                },
            },
            // Measured before the split existed: left out, never read as zero.
            cell("legacy", "1440x900x2", { walk: 9999 }),
        ];
        const lines = walkSplitSummaryLines(cells);
        expect(lines[0]).toBe("walk sub-phases: 2 cell(s), walk 16.0s");
        expect(lines[1]).toBe(
            "  goto        total     5.0s   31%  mean   2.5s  max   3.0s (lobby @ 390x844x3)"
        );
        expect(lines[3]).toBe(
            "  absentWait  total     3.0s   19%  mean   1.5s  max   3.0s (game-board @ 1440x900x2)"
        );
        expect(lines).toHaveLength(1 + WALK_SUBPHASES.length);
    });

    it("says so when no walk was split", () => {
        expect(walkSplitSummaryLines([])).toEqual([
            "walk sub-phases: no walk was split",
        ]);
    });
});

describe("floorLines — the fixed per-run floor, measured", () => {
    it("prints each step on its own line under their measured sum", () => {
        expect(
            floorLines([
                { label: "serve", ms: 12_300, detail: "vite build" },
                { label: "settle self-check", ms: 2_150, detail: "proof" },
            ])
        ).toEqual([
            "fixed floor: 14.4s measured over 2 step(s)",
            "  serve                 12.3s  vite build",
            "  settle self-check      2.1s  proof",
        ]);
    });
});
