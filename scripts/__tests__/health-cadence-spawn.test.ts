import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The batch health decision must OUTLIVE the `land` that starts it
 * (ADR 0136 §6, issue #3780 review finding 1).
 *
 * `gate.ts` runs `land`'s locked command `detached`, so the `sh` around it
 * leads its own process GROUP, and every teardown path — the ordinary `exit`
 * handler after a CLEAN child exit included — SIGKILLs that whole group
 * (`killChildTree`, issue #3821). `nohup` ignores SIGHUP and redirects output;
 * it does NOT leave the process group, and neither does `&`. The first cut of
 * this feature backgrounded the decision that way and it was killed
 * milliseconds later, on every single landing, while `land` printed a green
 * landing — a feature that looks installed and does nothing.
 *
 * No string assertion can see that, so this runs the real `health-cadence.ts
 * spawn` through the real `gate.ts` and looks for what the grandchild left on
 * disk after the gate is gone. The decision itself is replaced by
 * `TOLARIA_HEALTH_DETACH_CMD` (a real one would fetch from origin); what is
 * under test is the process topology, not the decision.
 */
const GATE = resolve(__dirname, "..", "gate.ts");
const CADENCE = resolve(__dirname, "..", "health-cadence.ts");

let root: string;
let lockRoot: string;

/** Wait for `done`, bounded. Sized so only a killed child can exhaust it. */
async function waitFor(done: () => boolean, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (!done() && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
    return done();
}

function env(extra: Record<string, string> = {}) {
    const base = { ...process.env, TOLARIA_GATE_LOCK_ROOT: lockRoot };
    // This suite may itself be running under a heavy gate (`bun run test`),
    // which exports these to its whole tree.
    delete base.TOLARIA_GATE_HELD;
    delete base.TOLARIA_ALLOW_FULL_SUITE;
    delete base.TOLARIA_VITEST_WORKERS;
    return { ...base, ...extra };
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tolaria-cadence-spawn-"));
    lockRoot = mkdtempSync(join(tmpdir(), "tolaria-cadence-lock-"));
    // `spawnDetached` resolves the primary checkout from cwd; a repo with no
    // remote is enough, because the decision itself is overridden below.
    spawnSync("git", ["init", "-q"], { cwd: root });
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(lockRoot, { recursive: true, force: true });
});

describe("health-cadence spawn — the decision outlives land's process group", () => {
    /** The marker the overridden decision writes after the gate is long gone. */
    const marker = () => join(root, "decided.marker");

    it("survives the gate's group kill, which a backgrounded child does not", async () => {
        const step =
            `(cd ${JSON.stringify(root)} && bun ${JSON.stringify(CADENCE)} spawn || ` +
            `echo "land: could not start the batch health decision" >&2; true)`;
        const r = spawnSync("bun", [GATE, "light", `echo merged && ${step}`], {
            encoding: "utf8",
            cwd: lockRoot,
            env: env({
                TOLARIA_HEALTH_DETACH_CMD: `sleep 2; printf decided > ${JSON.stringify(marker())}`,
            }),
        });
        // The landing itself is green and did not wait for the decision.
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain("merged");
        expect(existsSync(marker())).toBe(false);

        // …and the decision, orphaned by the gate's exit, still runs.
        expect(
            await waitFor(() => existsSync(marker())),
            "the detached decision was killed with land's process group"
        ).toBe(true);
    });

    it("CONTROL — the same work merely backgrounded IS killed (why `nohup … &` is not enough)", async () => {
        // Not a test of our code: the executable statement of the hazard the
        // test above guards, so a future reader can see that `nohup … &` was
        // rejected for a measured reason rather than a stylistic one.
        const doomed = join(root, "backgrounded.marker");
        const r = spawnSync(
            "bun",
            [
                GATE,
                "light",
                `echo merged && ((cd ${JSON.stringify(root)} && nohup sh -c ${JSON.stringify(`sleep 2; printf x > ${doomed}`)} >/dev/null 2>&1 &) || true)`,
            ],
            { encoding: "utf8", cwd: lockRoot, env: env() }
        );
        expect(r.status).toBe(0);
        expect(await waitFor(() => existsSync(doomed), 5_000)).toBe(false);
    });
});
