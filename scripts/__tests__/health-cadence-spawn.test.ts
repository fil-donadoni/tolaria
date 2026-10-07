import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 *
 * Why `nohup … &` is not enough is stated in `health-cadence.ts`'s header. It
 * used to be restated here as a CONTROL test that raced a 2 s `sleep` against
 * the group kill; that race lost under load often enough to red health and
 * `land` alone (issue #4961), so the hazard is documented, not executed.
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
    rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
    rmSync(lockRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
});

describe("health-cadence spawn — the decision outlives land's process group", () => {
    /** The marker the overridden decision writes after the gate is long gone. */
    const marker = () => join(root, "decided.marker");

    it("survives the gate's group kill", async () => {
        // The decision blocks on a file only the test creates, so "the landing
        // did not wait for it" is a fact about ordering, never a race between
        // a `sleep` and a loaded machine (issue #4961). It also stops once
        // `afterEach` removes `root`, so a red run leaves no immortal poller.
        const release = join(root, "release");
        const step =
            `(cd ${JSON.stringify(root)} && bun ${JSON.stringify(CADENCE)} spawn || ` +
            `echo "land: could not start the batch health decision" >&2; true)`;
        const r = spawnSync("bun", [GATE, "light", `echo merged && ${step}`], {
            encoding: "utf8",
            cwd: lockRoot,
            timeout: 60_000,
            env: env({
                TOLARIA_HEALTH_DETACH_CMD:
                    `while [ ! -e ${JSON.stringify(release)} ] && [ -d ${JSON.stringify(root)} ]; do sleep 0.05; done; ` +
                    `printf decided > ${JSON.stringify(marker())}`,
            }),
        });
        // The landing itself is green and did not wait for the decision.
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain("merged");
        expect(existsSync(marker())).toBe(false);

        // …and the decision, orphaned by the gate's exit, still runs.
        writeFileSync(release, "");
        expect(
            await waitFor(() => existsSync(marker())),
            "the detached decision was killed with land's process group"
        ).toBe(true);
        // Above the 60 s spawn bound plus the 20 s wait, so either of those
        // names the failure before vitest's own timeout does.
    }, 90_000);
});
