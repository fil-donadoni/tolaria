// The browser walk inside batch health (issue #4962): an environment failure
// is INFRA, never RED; a walk the tree failed is RED only once the walk has
// served its probation; and the walk is cut away from the offline gates so it
// can run off the heavy mutex.
import { describe, expect, it } from "vitest";
import { DEPLOYMENT_DOWN_EXIT } from "../lib/convex-reachable";
import { healthRunInFlight } from "../lib/health-cadence";
import {
    BOT_HEALTH_SCRIPTS,
    HEALTH_SCRIPTS,
    healthGates,
    splitHealthGates,
} from "../lib/health-step";
import {
    infraCause,
    nextUiWalkLedger,
    parseUiWalkLedger,
    UI_WALK_PROBATION_RUNS,
    uiWalkArmed,
    uiWalkStateOf,
    walkFailureCause,
} from "../lib/health-verdict";
import { walkRunVerdict } from "../ui-gate/infra-verdict";

/** Rows in the exact shapes `receipt.ts` prints them, lifted from the health
 *  logs of aa785cf0 (all machine) and e1902d33 (one surface the walk could
 *  not explain). */
const BANNER =
    "RECEIPT — full lane run, 82 surface(s) in scope (57 measured, 2 declared unwalked)";
const PASS_ROW =
    "PASS     auth-sign-in         1440x900x2   every floor at zero";
const INFRA_ROW = "INFRA    dlg-exile-cost       820x1180x2   unsettled";
const UNWALKED_MACHINE_ROW =
    "UNWALKED dlg-mana-choice      —            unreachable";
const UNWALKED_MACHINE_LINE =
    "unwalked dlg-mana-choice      —            walk threw: screen did not settle within 30s on /admin/design-system — no [data-surface-ready] marker (unsettled, load 5.5, under the retry threshold: the walk itself failed)";
const UNWALKED_TREE_ROW =
    "UNWALKED limited-table-ring   —            unreachable";
const UNWALKED_TREE_LINE =
    "unwalked limited-table-ring   —            `View Table` did not open the Table Ring dialog (no `[data-slot=table-ring]` in a dialog)";
const FLOOR_FAIL_ROW =
    "FAIL     lobby                390x844x3    broken floor: stranded 1";
const ASSERT_PASS_ROW =
    "assert   auth-sign-in         1440x900x2   PASS email field";
const ASSERT_FAIL_ROW =
    "assert   admin-card-profiles  1440x900x2   FAIL editor Save";
/** A progress line the walk prints while it runs — indented, never a row. */
const PROGRESS_ASSERT_FAIL =
    '  admin-card-profiles  1440x900x2   ASSERT FAIL editor Save — reachable `role=button name="Save"` — no element matches it';

const run = (...lines: string[]) => lines.join("\n");

describe("walkRunVerdict — the walk's own receipt says whose failure it was (issue #4962)", () => {
    it("exit 0 is a pass", () => {
        expect(walkRunVerdict(0, run(BANNER, PASS_ROW))).toBe("pass");
    });

    it("exit 2 — a fatal before any surface was judged (the sign-in on aa785cf0) — is infra", () => {
        expect(
            walkRunVerdict(2, "sign-in failed for the run's lane account")
        ).toBe("infra");
    });

    it("exit 3 — the deployment did not answer — is infra", () => {
        expect(walkRunVerdict(DEPLOYMENT_DOWN_EXIT, "")).toBe("infra");
    });

    it("exit 1 with every failing row INFRA is infra", () => {
        expect(
            walkRunVerdict(1, run(BANNER, PASS_ROW, INFRA_ROW, ASSERT_PASS_ROW))
        ).toBe("infra");
    });

    it("exit 1 whose UNWALKED surface the walk attributed to a machine signature is infra", () => {
        expect(
            walkRunVerdict(
                1,
                run(
                    BANNER,
                    INFRA_ROW,
                    UNWALKED_MACHINE_ROW,
                    PROGRESS_ASSERT_FAIL,
                    UNWALKED_MACHINE_LINE
                )
            )
        ).toBe("infra");
    });

    it("one real ASSERT FAIL row is red, however many INFRA rows sit beside it", () => {
        expect(
            walkRunVerdict(1, run(BANNER, INFRA_ROW, PASS_ROW, ASSERT_FAIL_ROW))
        ).toBe("red");
    });

    it("a broken Floor on a cell that settled is red", () => {
        expect(walkRunVerdict(1, run(BANNER, INFRA_ROW, FLOOR_FAIL_ROW))).toBe(
            "red"
        );
    });

    it("an UNWALKED surface with no machine signature (e1902d33) is red", () => {
        expect(
            walkRunVerdict(
                1,
                run(BANNER, INFRA_ROW, UNWALKED_TREE_ROW, UNWALKED_TREE_LINE)
            )
        ).toBe("red");
    });

    it("fails closed: exit 1 with no failing row to read, a signal, an unknown code", () => {
        expect(walkRunVerdict(1, run(BANNER, PASS_ROW))).toBe("red");
        expect(walkRunVerdict(1, "")).toBe("red");
        expect(walkRunVerdict(null, run(INFRA_ROW))).toBe("red");
        expect(walkRunVerdict(4, run(INFRA_ROW))).toBe("red");
    });
});

describe("infraCause reads the walk's verdict on the check:ui step only", () => {
    const failedWalk = (exitCode: number | null, output: string) =>
        infraCause({
            ok: false,
            startedAt: 1_000,
            lastSleepAt: null,
            step: "check:ui --all",
            exitCode,
            output,
        });

    it("exit 2 → ui-walk", () => {
        expect(failedWalk(2, "")).toBe("ui-walk");
    });

    it("all-INFRA rows → ui-walk", () => {
        expect(failedWalk(1, run(BANNER, INFRA_ROW))).toBe("ui-walk");
    });

    it("one real ASSERT FAIL → no cause (the tree's)", () => {
        expect(
            failedWalk(1, run(BANNER, INFRA_ROW, ASSERT_FAIL_ROW))
        ).toBeNull();
    });

    it("another step printing INFRA rows is still the tree's", () => {
        expect(
            infraCause({
                ok: false,
                startedAt: 1_000,
                lastSleepAt: null,
                step: "test",
                exitCode: 2,
                output: run(INFRA_ROW),
            })
        ).toBeNull();
    });
});

describe("the walk's probation — RED only after five non-infra walks", () => {
    it("a walk the tree failed is ui-unproven until the walk is armed", () => {
        for (let streak = 0; streak < UI_WALK_PROBATION_RUNS; streak++)
            expect(walkFailureCause(null, { streak })).toBe("ui-unproven");
        expect(
            walkFailureCause(null, { streak: UI_WALK_PROBATION_RUNS })
        ).toBeNull();
    });

    it("an environment failure stays its own cause, armed or not", () => {
        expect(walkFailureCause("ui-walk", { streak: 9 })).toBe("ui-walk");
        expect(walkFailureCause("convex-down", { streak: 0 })).toBe(
            "convex-down"
        );
    });

    it("infra restarts the count; a pass or a tree failure extends it", () => {
        expect(nextUiWalkLedger({ streak: 4 }, "infra")).toEqual({ streak: 0 });
        expect(nextUiWalkLedger({ streak: 4 }, "green")).toEqual({ streak: 5 });
        expect(nextUiWalkLedger({ streak: 4 }, "red")).toEqual({ streak: 5 });
        expect(uiWalkArmed({ streak: 5 })).toBe(true);
        expect(uiWalkArmed({ streak: 4 })).toBe(false);
    });

    it("a missing or unreadable ledger is a walk with no record", () => {
        expect(parseUiWalkLedger(null)).toEqual({ streak: 0 });
        expect(parseUiWalkLedger("{")).toEqual({ streak: 0 });
        expect(parseUiWalkLedger('{"streak":-2}')).toEqual({ streak: 0 });
        expect(parseUiWalkLedger('{"streak":3}')).toEqual({ streak: 3 });
    });

    it("names the walk's state for health:status", () => {
        expect(uiWalkStateOf("green", null)).toBe("green");
        expect(uiWalkStateOf("red", "ui-unproven")).toBe("unproven");
        expect(uiWalkStateOf("red", null)).toBe("red");
        expect(uiWalkStateOf("infra", "ui-walk")).toBe("infra");
    });
});

describe("splitHealthGates — the walk is cut away from the offline gates", () => {
    it("offline keeps every other gate in order, the Bot gates included", () => {
        const { offline, walk } = splitHealthGates(
            healthGates(HEALTH_SCRIPTS, true)
        );
        expect(walk).toEqual(["check:ui --all"]);
        expect(offline).toEqual([
            ...HEALTH_SCRIPTS.filter((g) => g !== "check:ui --all"),
            ...BOT_HEALTH_SCRIPTS,
        ]);
    });
});

describe("healthRunInFlight counts from the current phase", () => {
    const T0 = Date.parse("2026-10-02T10:00:00Z");
    const HOUR = 60 * 60 * 1000;

    it("a walk that began after a long offline phase is still in flight", () => {
        expect(
            healthRunInFlight(
                {
                    sha: "abc",
                    status: "running",
                    startedAt: new Date(T0).toISOString(),
                    phaseStartedAt: new Date(T0 + HOUR).toISOString(),
                },
                T0 + 2 * HOUR
            )
        ).toContain("in flight");
    });
});
