import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { BASE_BRANCH } from "../lib/branches";
import { INFRA_REMEDY, PREFLIGHT_CONVEX_STEP } from "../lib/health-verdict";

/**
 * The whole `health-main` run with the Convex deployment down (issue #4943):
 * it must end `infra` at `preflight:convex` in seconds — no RED marker, no
 * worktree, no gate — instead of paying ~40 minutes of gates to learn it at
 * `check:ui`. Driven for real: a scratch primary checkout whose `origin` is a
 * local bare repo carrying the base branch, and `VITE_CONVEX_URL` on a port
 * nothing listens on.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HEALTH_MAIN = path.join(REPO_ROOT, "scripts", "health-main.ts");

let tmp: string;
let primary: string;

const git = (args: string[], cwd: string): void => {
    const r = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 20_000,
    });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-health-preflight-"));
    const bare = path.join(tmp, "origin.git");
    primary = path.join(tmp, "primary");
    git(["init", "-q", "--bare", bare], tmp);
    git(["init", "-q", "-b", BASE_BRANCH, primary], tmp);
    git(
        [
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "tip",
        ],
        primary
    );
    git(["remote", "add", "origin", bare], primary);
    git(["push", "-q", "origin", BASE_BRANCH], primary);
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function closedPort(): Promise<number> {
    return await new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const p = (srv.address() as net.AddressInfo).port;
            srv.close(() => resolve(p));
        });
    });
}

describe("health-main — the Convex preflight (issue #4943)", () => {
    it("ends INFRA at preflight:convex in seconds, with no RED marker and no gate run", async () => {
        const port = await closedPort();
        const started = Date.now();
        const r = await new Promise<{ code: number | null; stderr: string }>(
            (resolve) => {
                const child = spawn("bun", [HEALTH_MAIN], {
                    cwd: primary,
                    env: {
                        ...process.env,
                        VITE_CONVEX_URL: `http://127.0.0.1:${port}`,
                        TOLARIA_GATE_HELD: "",
                    },
                    stdio: ["ignore", "ignore", "pipe"],
                });
                let stderr = "";
                child.stderr.on("data", (d) => (stderr += d));
                // A run that went on to the gates would far outlive this.
                const t = setTimeout(() => child.kill("SIGKILL"), 45_000);
                child.on("close", (code) => {
                    clearTimeout(t);
                    resolve({ code, stderr });
                });
            }
        );
        const elapsed = Date.now() - started;
        const dir = path.join(primary, ".claude", "telemetry", "health");

        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/INFRA @ \w+ at preflight:convex/);
        const last = JSON.parse(
            fs.readFileSync(path.join(dir, "last.json"), "utf8")
        ) as Record<string, unknown>;
        expect(last).toMatchObject({
            status: "infra",
            failedStep: PREFLIGHT_CONVEX_STEP,
            infraCause: "convex-down",
            reason: INFRA_REMEDY["convex-down"],
        });
        expect(fs.existsSync(path.join(dir, "RED"))).toBe(false);
        // No gate log: nothing ran.
        expect(fs.readdirSync(dir).filter((f) => f.endsWith(".log"))).toEqual(
            []
        );
        expect(elapsed).toBeLessThan(40_000);
    }, 60_000);
});
