import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import {
    convexPreflight,
    INFRA_REMEDY,
    infraCause,
    infraNotice,
    infraRecordToKeep,
    parseKernSleeptime,
    PREFLIGHT_CONVEX_STEP,
    readLastSleepAt,
    recordInfra,
    stepVerdict,
} from "../lib/health-verdict";
import { DEPLOYMENT_DOWN_EXIT } from "../lib/convex-reachable";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * A gate step cut by system sleep is INFRA, not a RED tip (issue #4938).
 *
 * The RED on a15195d8 was four `test:bot` timeouts, one per worker, each
 * ~900 s — the length of the clamshell sleep `pmset` logged. The tip passed
 * untouched in a repro worktree. These pin the classifier that tells the two
 * apart; the downstream half (no fixer, no release) is in
 * `health-cadence.test.ts` and `release.test.ts`.
 */
const STEP_START = Date.parse("2026-10-01T11:13:16.000Z");

describe("health verdict — a step cut by system sleep (issue #4938)", () => {
    it("is INFRA when the machine entered sleep during the failed step", () => {
        expect(
            stepVerdict({
                ok: false,
                startedAt: STEP_START,
                lastSleepAt: STEP_START + 21_000,
            })
        ).toBe("infra");
    });

    it("is RED when the last sleep predates the step", () => {
        expect(
            stepVerdict({
                ok: false,
                startedAt: STEP_START,
                lastSleepAt: STEP_START - 1,
            })
        ).toBe("red");
    });

    it("is RED when no sleep can be read — the reading only ever downgrades", () => {
        expect(
            stepVerdict({ ok: false, startedAt: STEP_START, lastSleepAt: null })
        ).toBe("red");
    });

    it("is GREEN for a step that passed, whatever the machine did", () => {
        expect(
            stepVerdict({
                ok: true,
                startedAt: STEP_START,
                lastSleepAt: STEP_START + 1,
            })
        ).toBe("green");
    });
});

describe("health verdict — reading kern.sleeptime", () => {
    it("parses sysctl's struct timeval to epoch ms", () => {
        expect(
            parseKernSleeptime(
                "{ sec = 1790866381, usec = 538510 } Thu Oct  1 16:53:01 2026\n"
            )
        ).toBe(1790866381538);
    });

    it("is null for a machine that never slept, or unreadable output", () => {
        expect(parseKernSleeptime("{ sec = 0, usec = 0 }\n")).toBeNull();
        expect(parseKernSleeptime("")).toBeNull();
    });

    it("reads a real past instant on darwin, null elsewhere", () => {
        const at = readLastSleepAt();
        if (process.platform !== "darwin") {
            expect(at).toBeNull();
            return;
        }
        // A machine up since boot without sleeping reads null, also fine.
        if (at !== null) expect(at).toBeLessThanOrEqual(Date.now());
    });
});

describe("health verdict — an INFRA run never erases a standing RED (issue #4938 review)", () => {
    const red = { sha: "r".repeat(40), status: "red" as const };
    const infra = { sha: "i".repeat(40), status: "infra" as const };

    it("keeps the red record the standing marker names", () => {
        expect(
            infraRecordToKeep({ infra, previous: red, redMarkerStanding: true })
        ).toBe(red);
    });

    it("writes its own record when no RED marker stands", () => {
        expect(
            infraRecordToKeep({
                infra,
                previous: red,
                redMarkerStanding: false,
            })
        ).toBe(infra);
        expect(
            infraRecordToKeep({
                infra,
                previous: null,
                redMarkerStanding: true,
            })
        ).toBe(infra);
    });
});

/**
 * A Convex backend that does not answer is INFRA, not a RED tip (issue
 * #4943). 7 of 12 REDs after issue #4913 were `check:ui` finding the local
 * deployment down — exit 2, a RED marker, `health:fix` spawned, the AFK loop
 * stopped — with nothing wrong in the tree.
 */
describe("health verdict — the Convex deployment is down (issue #4943)", () => {
    const failed = (step: string, exitCode: number | null) =>
        stepVerdict({
            ok: false,
            startedAt: STEP_START,
            lastSleepAt: null,
            step,
            exitCode,
        });

    it("is INFRA when check:ui exits DEPLOYMENT_DOWN_EXIT", () => {
        expect(failed("check:ui --all", DEPLOYMENT_DOWN_EXIT)).toBe("infra");
        expect(
            infraCause({
                ok: false,
                startedAt: STEP_START,
                lastSleepAt: null,
                step: "check:ui --all",
                exitCode: DEPLOYMENT_DOWN_EXIT,
            })
        ).toBe("convex-down");
    });

    it("is RED for a genuine check:ui failure — a non-PASS verdict it cannot attribute, or a signal", () => {
        expect(failed("check:ui --all", 1)).toBe("red");
        expect(failed("check:ui --all", null)).toBe("red");
    });

    it("is RED when another step exits with the same code", () => {
        expect(failed("test", DEPLOYMENT_DOWN_EXIT)).toBe("red");
    });

    it("names the cause: sleep and a down backend read differently", () => {
        expect(
            infraCause({
                ok: false,
                startedAt: STEP_START,
                lastSleepAt: STEP_START + 1,
                step: "test",
                exitCode: 1,
            })
        ).toBe("sleep");
        expect(
            infraCause({
                ok: true,
                startedAt: STEP_START,
                lastSleepAt: STEP_START + 1,
                step: "check:ui --all",
                exitCode: 0,
            })
        ).toBeNull();
    });
});

describe("health verdict — the Convex preflight (issue #4943)", () => {
    const GATES = ["check:all", "test", "check:ui --all"];
    const probeAnswering = (answers: boolean) => {
        const asked: string[] = [];
        return {
            asked,
            probe: async (url: string) => {
                asked.push(url);
                return answers;
            },
        };
    };

    it("is convex-down when the URL does not answer", async () => {
        const p = probeAnswering(false);
        expect(
            await convexPreflight({
                gates: GATES,
                url: "http://127.0.0.1:3210",
                probe: p.probe,
            })
        ).toBe("convex-down");
        expect(p.asked).toEqual(["http://127.0.0.1:3210"]);
    });

    it("lets the gates run when the URL answers", async () => {
        const p = probeAnswering(true);
        expect(
            await convexPreflight({
                gates: GATES,
                url: "http://x",
                probe: p.probe,
            })
        ).toBeNull();
    });

    it("asks nothing for a run with no check:ui step, or no URL configured", async () => {
        const p = probeAnswering(false);
        expect(
            await convexPreflight({
                gates: ["check:all", "test"],
                url: "http://x",
                probe: p.probe,
            })
        ).toBeNull();
        expect(
            await convexPreflight({
                gates: GATES,
                url: undefined,
                probe: p.probe,
            })
        ).toBeNull();
        expect(p.asked).toEqual([]);
    });
});

describe("health verdict — recording an INFRA run (issue #4943)", () => {
    const withDir = (fn: (dir: string) => void) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-infra-"));
        try {
            fn(dir);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
    const infra = {
        sha: "abc123",
        status: "infra" as const,
        failedStep: PREFLIGHT_CONVEX_STEP,
        reason: INFRA_REMEDY["convex-down"],
    };

    it("writes its record and no RED marker", () => {
        withDir((dir) => {
            recordInfra({
                dir,
                infra,
                previous: null,
                redMarkerStanding: false,
            });
            expect(
                JSON.parse(fs.readFileSync(path.join(dir, "last.json"), "utf8"))
            ).toEqual(infra);
            expect(fs.existsSync(path.join(dir, "RED"))).toBe(false);
        });
    });

    it("leaves a standing RED marker and its red record in place", () => {
        withDir((dir) => {
            fs.writeFileSync(path.join(dir, "RED"), "staging @ old red\n");
            const red = { sha: "old", status: "red" as const };
            recordInfra({ dir, infra, previous: red, redMarkerStanding: true });
            expect(
                JSON.parse(fs.readFileSync(path.join(dir, "last.json"), "utf8"))
            ).toEqual(red);
            expect(fs.readFileSync(path.join(dir, "RED"), "utf8")).toBe(
                "staging @ old red\n"
            );
        });
    });

    it("prints one notice naming the step and the remedy", () => {
        expect(infraNotice(infra)).toBe(
            `release health is INFRA @ abc123 (at preflight:convex) — the tip is unproven, not red: ${INFRA_REMEDY["convex-down"]}`
        );
    });
});

describe("check:ui — a deployment that does not answer exits DEPLOYMENT_DOWN_EXIT (issue #4943)", () => {
    it("exits 3, not 2, on a closed port", async () => {
        const port = await new Promise<number>((resolve) => {
            const srv = net.createServer();
            srv.listen(0, "127.0.0.1", () => {
                const p = (srv.address() as net.AddressInfo).port;
                srv.close(() => resolve(p));
            });
        });
        const r = await new Promise<{ code: number | null; stderr: string }>(
            (resolve) => {
                const child = spawn(
                    "bun",
                    [path.join(REPO_ROOT, "scripts/ui-gate/index.ts"), "--all"],
                    {
                        cwd: REPO_ROOT,
                        env: {
                            ...process.env,
                            VITE_CONVEX_URL: `http://127.0.0.1:${port}`,
                        },
                        stdio: ["ignore", "ignore", "pipe"],
                    }
                );
                let stderr = "";
                child.stderr.on("data", (d) => (stderr += d));
                const t = setTimeout(() => child.kill("SIGKILL"), 50_000);
                child.on("close", (code) => {
                    clearTimeout(t);
                    resolve({ code, stderr });
                });
            }
        );
        expect(r.stderr).toMatch(/did not answer/);
        expect(r.code).toBe(DEPLOYMENT_DOWN_EXIT);
    }, 60_000);
});
