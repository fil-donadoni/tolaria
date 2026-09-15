// `check:ui`'s per-run lane account, the lane half (issue #3626). The server
// half — refusals, teardown completeness, sweep age — is
// `convex/__tests__/uiGateAccounts.test.ts`; this file proves the lane actually
// calls it: in the right order, exactly once, on every way a run can end.
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isLaneAccountEmail } from "../../convex/lib/uiGateLaneAccount";
import {
    convexRunArgv,
    createLaneLifecycle,
    installSignalTeardown,
    newLaneAccount,
    runScreenshotDir,
    SCREENSHOT_RETENTION_MS,
    withLaneAccount,
    type LaneLifecycleDeps,
    type SignalSource,
} from "../ui-gate/lane-account";

function harness(overrides: Partial<LaneLifecycleDeps> = {}) {
    const calls: string[] = [];
    const logs: string[] = [];
    const account = newLaneAccount();
    const lane = createLaneLifecycle({
        account,
        run: (fn, args) => {
            calls.push(`${fn} ${JSON.stringify(args)}`);
            return fn.endsWith("sweepStaleLaneAccounts") ? { swept: [] } : null;
        },
        signUp: async (a) => {
            calls.push(`signUp ${a.email}`);
        },
        keepUser: false,
        log: (m) => logs.push(m),
        ...overrides,
    });
    const destroys = () =>
        calls.filter((c) => c.startsWith("uiGateAccounts:destroyLaneAccount"))
            .length;
    return { lane, account, calls, logs, destroys };
}

describe("newLaneAccount", () => {
    it("mints a lane address the server-side pattern accepts, unique per run", () => {
        const a = newLaneAccount();
        const b = newLaneAccount();
        expect(isLaneAccountEmail(a.email)).toBe(true);
        expect(a.runId).not.toBe(b.runId);
        expect(a.password).not.toBe(b.password);
        // The Password provider's nickname bound (convex/auth.ts).
        expect(a.nickname.length).toBeLessThanOrEqual(32);
    });
});

describe("the lane account lifecycle (issue #3626)", () => {
    it("sweeps, signs up, grants, then seeds its run-scoped fixtures — in that order", async () => {
        const { lane, account, calls } = harness();
        await lane.bootstrap();
        expect(calls).toEqual([
            "uiGateAccounts:sweepStaleLaneAccounts {}",
            `signUp ${account.email}`,
            `uiGateAccounts:grantLaneRoles {"email":"${account.email}"}`,
            `limitedFixtures:seedUiGateFixtures {"email":"${account.email}","runId":"${account.runId}"}`,
            `verdictResolutions:seedUiGateContestedPosition {"email":"${account.email}"}`,
        ]);
        expect(lane.labels.open.startsWith(lane.labels.prefix)).toBe(true);
        expect(lane.labels.prefix).toBe(`ui-gate/${account.runId}/`);
    });

    it("tears down on the happy path", async () => {
        const h = harness();
        await withLaneAccount(h.lane, async () => 0);
        expect(h.destroys()).toBe(1);
    });

    it("tears down when a walk fails", async () => {
        const h = harness();
        await expect(
            withLaneAccount(h.lane, async () => {
                throw new Error("walk threw");
            })
        ).rejects.toThrow("walk threw");
        expect(h.destroys()).toBe(1);
    });

    it("tears down when bootstrap fails after the sign-up was attempted", async () => {
        const h = harness({
            signUp: async () => {
                throw new Error("response lost");
            },
        });
        await expect(withLaneAccount(h.lane, async () => 0)).rejects.toThrow(
            "response lost"
        );
        expect(h.destroys()).toBe(1);
    });

    it("tears down on SIGINT and exits 130, and never twice", async () => {
        const h = harness();
        const signals = new EventEmitter();
        const exits: number[] = [];
        installSignalTeardown(
            signals as unknown as SignalSource,
            () => h.lane.teardown(),
            (code) => exits.push(code)
        );
        await h.lane.bootstrap();
        signals.emit("SIGINT");
        // Asserted BEFORE anything else tears down: the handler alone must
        // have destroyed the account.
        expect(exits).toEqual([130]);
        expect(h.destroys()).toBe(1);
        // The `finally` a real run would also reach afterwards.
        h.lane.teardown();
        expect(h.destroys()).toBe(1);
    });

    it("--keep-user skips teardown and prints the credentials", async () => {
        const h = harness({ keepUser: true });
        await withLaneAccount(h.lane, async () => 0);
        expect(h.destroys()).toBe(0);
        const out = h.logs.join("\n");
        expect(out).toContain(h.account.email);
        expect(out).toContain(h.account.password);
    });

    it("a failed teardown is reported, not thrown — the sweep is the backstop", async () => {
        const h = harness({
            run: (fn) => {
                if (fn.endsWith("destroyLaneAccount")) {
                    throw new Error("deployment down");
                }
                return null;
            },
        });
        await withLaneAccount(h.lane, async () => 0);
        expect(h.logs.join("\n")).toMatch(/TEARDOWN FAILED.*deployment down/);
    });
});

describe("convexRunArgv", () => {
    it("passes the arguments as one JSON argument", () => {
        expect(
            convexRunArgv("uiGateAccounts:grantLaneRoles", { email: "e" })
        ).toEqual([
            "convex",
            "run",
            "uiGateAccounts:grantLaneRoles",
            '{"email":"e"}',
        ]);
    });
});

describe("runScreenshotDir", () => {
    it("gives each run its own directory and prunes only expired run directories", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-gate-shots-"));
        try {
            const now = Date.now();
            const old = path.join(root, "000000000001");
            const recent = path.join(root, "000000000002");
            const unrelated = path.join(root, "keep-me");
            for (const d of [old, recent, unrelated]) fs.mkdirSync(d);
            const past = (now - SCREENSHOT_RETENTION_MS - 60_000) / 1000;
            fs.utimesSync(old, past, past);
            fs.utimesSync(unrelated, past, past);

            const dir = runScreenshotDir(root, "abcdefabcdef", now);

            expect(dir).toBe(path.join(root, "abcdefabcdef"));
            expect(fs.readdirSync(root).sort()).toEqual([
                "000000000002",
                "abcdefabcdef",
                "keep-me",
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
