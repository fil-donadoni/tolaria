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
    createLaneFleet,
    installSignalTeardown,
    newLaneAccount,
    runScreenshotDir,
    SCREENSHOT_RETENTION_MS,
    withLaneFleet,
    type LaneFleetDeps,
    type ConvexRunner,
    type SignalSource,
} from "../ui-gate/lane-account";

function harness(overrides: Partial<LaneFleetDeps> = {}) {
    const calls: string[] = [];
    const logs: string[] = [];
    const accounts = overrides.accounts ?? [newLaneAccount()];
    const account = accounts[0];
    // The RECORDING is the harness's and is never overridden: a test that makes
    // one call throw is still asserting on what the fleet ATTEMPTED, and an
    // override that swallowed the recording would leave `destroys()` at zero
    // while the fleet did exactly the right thing.
    const answer: ConvexRunner =
        overrides.run ??
        ((fn) =>
            fn.endsWith("sweepStaleLaneAccounts") ? { swept: [] } : null);
    const lane = createLaneFleet({
        accounts,
        signUp: async (a) => {
            calls.push(`signUp ${a.email}`);
            return `token-of-${a.runId}`;
        },
        seedDeck: async (a, token) => {
            calls.push(`seedDeck ${a.email} ${token}`);
            return `deck-of-${a.runId}`;
        },
        keepUser: false,
        log: (m) => logs.push(m),
        ...overrides,
        run: (fn, args) => {
            calls.push(`${fn} ${JSON.stringify(args)}`);
            return answer(fn, args);
        },
    });
    const destroys = () =>
        calls.filter((c) => c.startsWith("uiGateAccounts:destroyLaneAccount"))
            .length;
    return { lane, account, accounts, calls, logs, destroys };
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
        expect(calls.slice(0, 6)).toEqual([
            "uiGateAccounts:sweepStaleLaneAccounts {}",
            `signUp ${account.email}`,
            `uiGateAccounts:grantLaneRoles {"email":"${account.email}"}`,
            `limitedFixtures:seedUiGateFixtures {"email":"${account.email}","runId":"${account.runId}"}`,
            `verdictResolutions:seedUiGateContestedPosition {"email":"${account.email}"}`,
            // With the session the sign-up issued — never a second sign-in.
            `seedDeck ${account.email} token-of-${account.runId}`,
        ]);
        // The deck the three delete confirms open over (issue #4421), handed
        // to that account's walks — never another lane's.
        expect(lane.members[0].deckId).toBe(`deck-of-${account.runId}`);
        // Then the declared positions (issue #3652) — the payloads, not the
        // account, so they are the tail of the bootstrap and not part of the
        // run-scoped block above. WHICH positions is the next test's job.
        expect(calls.slice(6).length).toBeGreaterThan(0);
        expect(
            calls
                .slice(6)
                .every((c) =>
                    c.startsWith("debugScenarios:seedScenarioDirect ")
                )
        ).toBe(true);
        const labels = lane.members[0].labels;
        expect(labels.open.startsWith(labels.prefix)).toBe(true);
        expect(labels.prefix).toBe(`ui-gate/${account.runId}/`);
    });

    it("seeds every scenario label the walks will search for (issue #3652)", async () => {
        // THE ORACLE IS THE RUNNER, not `laneScenarioSeeds()`. Comparing the
        // bootstrap's calls against the very list that produced them is a test
        // that cannot fail — proved: dropping a payload from `SCENARIO_FILES`
        // left the first draft of this assertion green.
        //
        // What is independent is the label each WALK types into the Scenarios
        // search box (`ensureScenarioBoard`), declared as a
        // `*_SCENARIO_LABEL` constant in `scripts/ui-gate/index.ts` and handed
        // to the walks on `WalkContext`. A position that stops being seeded
        // reds here while its surface still goes looking for the row — which
        // is the failure this guards: `debug scenario "…" is absent from this
        // deployment`, an UNWALKED surface and a coverage hole.
        //
        // Read as TEXT, like `ui-gate-stress-scenario.test.ts` does: the
        // runner owns a live browser and a Vite server at module scope.
        const runner = fs.readFileSync(
            path.join(__dirname, "../ui-gate/index.ts"),
            "utf8"
        );
        const wanted = [
            ...runner.matchAll(/const \w*SCENARIO_LABEL\s*=\s*("[^"]*")/g),
        ].map((m) => JSON.parse(m[1]) as string);
        expect(wanted.length).toBeGreaterThan(0);

        const { lane, calls } = harness();
        await lane.bootstrap();
        const seeded = calls
            .filter((c) => c.startsWith("debugScenarios:seedScenarioDirect "))
            .map(
                (c) =>
                    (
                        JSON.parse(
                            c.slice("debugScenarios:seedScenarioDirect ".length)
                        ) as { label: string }
                    ).label
            );
        expect([...seeded].sort()).toEqual([...wanted].sort());
    });

    it("tears down on the happy path", async () => {
        const h = harness();
        await withLaneFleet(h.lane, async () => 0);
        expect(h.destroys()).toBe(1);
    });

    it("tears down when a walk fails", async () => {
        const h = harness();
        await expect(
            withLaneFleet(h.lane, async () => {
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
        await expect(withLaneFleet(h.lane, async () => 0)).rejects.toThrow(
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
        await withLaneFleet(h.lane, async () => 0);
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
        await withLaneFleet(h.lane, async () => 0);
        expect(h.logs.join("\n")).toMatch(/TEARDOWN FAILED.*deployment down/);
    });
});

describe("a fleet of N accounts (issue #3653)", () => {
    const fleetOf = (n: number, overrides: Partial<LaneFleetDeps> = {}) =>
        harness({
            accounts: Array.from({ length: n }, () => newLaneAccount()),
            ...overrides,
        });

    it("registers, grants and seeds ONCE PER ACCOUNT", async () => {
        const h = fleetOf(3);
        await h.lane.bootstrap();
        for (const account of h.accounts) {
            expect(h.calls).toContain(`signUp ${account.email}`);
            expect(h.calls).toContain(
                `uiGateAccounts:grantLaneRoles {"email":"${account.email}"}`
            );
            expect(h.calls).toContain(
                `limitedFixtures:seedUiGateFixtures {"email":"${account.email}","runId":"${account.runId}"}`
            );
            expect(h.calls).toContain(
                `verdictResolutions:seedUiGateContestedPosition {"email":"${account.email}"}`
            );
            expect(h.calls).toContain(
                `seedDeck ${account.email} token-of-${account.runId}`
            );
        }
        // Each account walks over its OWN deck (issue #4421): a lane that
        // opened another lane's deck would race that lane's walks for it.
        expect(h.lane.members.map((m) => m.deckId)).toEqual(
            h.accounts.map((a) => `deck-of-${a.runId}`)
        );
        // Each lane walks under its own labels — two contexts listing one
        // `/limited?label=…` would see each other's fixtures.
        expect(new Set(h.lane.members.map((m) => m.labels.prefix)).size).toBe(
            3
        );
    });

    it("sweeps and seeds the declared positions ONCE PER RUN", async () => {
        const one = fleetOf(1);
        const many = fleetOf(4);
        await one.lane.bootstrap();
        await many.lane.bootstrap();
        const count = (calls: string[], fn: string) =>
            calls.filter((c) => c.startsWith(fn)).length;
        expect(count(many.calls, "uiGateAccounts:sweepStaleLaneAccounts")).toBe(
            1
        );
        // The positions upsert by label and are owned by no account
        // (issue #3652) — a fleet of four owes exactly what a fleet of one does.
        expect(count(many.calls, "debugScenarios:seedScenarioDirect")).toBe(
            count(one.calls, "debugScenarios:seedScenarioDirect")
        );
    });

    it("destroys EVERY account, once, however the run ends", async () => {
        const h = fleetOf(5);
        await withLaneFleet(h.lane, async () => 0);
        expect(h.destroys()).toBe(5);
        for (const account of h.accounts) {
            expect(h.calls).toContain(
                `uiGateAccounts:destroyLaneAccount {"email":"${account.email}"}`
            );
        }
        h.lane.teardown();
        expect(h.destroys()).toBe(5);
    });

    it("destroys the rest when one account's destroy throws", async () => {
        const accounts = Array.from({ length: 3 }, () => newLaneAccount());
        const doomed = accounts[1].email;
        const h = harness({
            accounts,
            run: (fn, args) => {
                if (
                    fn.endsWith("destroyLaneAccount") &&
                    (args as { email: string }).email === doomed
                ) {
                    throw new Error("deployment down");
                }
                return fn.endsWith("sweepStaleLaneAccounts")
                    ? { swept: [] }
                    : null;
            },
        });
        await withLaneFleet(h.lane, async () => 0);
        expect(h.destroys()).toBe(3);
        expect(h.logs.join("\n")).toContain(`TEARDOWN FAILED for ${doomed}`);
        expect(h.logs.join("\n")).toContain(`${accounts[2].email} destroyed`);
    });

    it("a SIGINT mid-run takes every account with it", async () => {
        const h = fleetOf(4);
        const signals = new EventEmitter();
        const exits: number[] = [];
        installSignalTeardown(
            signals as unknown as SignalSource,
            () => h.lane.teardown(),
            (code) => exits.push(code)
        );
        await h.lane.bootstrap();
        signals.emit("SIGINT");
        expect(exits).toEqual([130]);
        expect(h.destroys()).toBe(4);
    });

    it("refuses a fleet with no accounts rather than walking signed out", () => {
        expect(() => fleetOf(0)).toThrow(/at least one account/);
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
