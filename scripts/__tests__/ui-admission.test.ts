// `check:ui` machine-wide admission (issue #4687). The decisions run in-process
// against a temp lock root; the EXIT PATHS run in real child processes, because
// "released on every exit path, including interruption" is a claim about
// process death that no in-process call can witness. Every child waits on an
// observable event (a printed line, an exit), never a wall-clock window.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    acquireUiLane,
    readUiLaneOwner,
    uiLaneWhoLines,
} from "../lib/ui-admission";

let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-admission-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const lockDir = () => path.join(root, "ui.lock");

const inProcess = (
    extra: Partial<Parameters<typeof acquireUiLane>[0]> = {}
) => ({
    root,
    label: "check:ui test",
    announce: () => {},
    installExitHandlers: false,
    sleep: () => Promise.resolve(),
    ...extra,
});

describe("acquireUiLane — in process", () => {
    it("takes the lane, names its holder, and frees it on release", async () => {
        const hold = await acquireUiLane(inProcess({ pid: 4242, cwd: "/wt" }));
        expect(readUiLaneOwner(root)).toMatchObject({
            pid: 4242,
            cwd: "/wt",
            label: "check:ui test",
        });
        hold.release();
        expect(fs.existsSync(lockDir())).toBe(false);
        hold.release(); // idempotent
    });

    it("a second run waits, names the holder, and takes the lane once it is released", async () => {
        const first = await acquireUiLane(inProcess({ pid: 1001 }));
        const lines: string[] = [];
        let polls = 0;
        const second = await acquireUiLane(
            inProcess({
                pid: 1002,
                isAlive: () => true,
                announce: (l) => lines.push(l),
                sleep: async () => {
                    if (++polls === 2) first.release();
                },
            })
        );
        expect(polls).toBe(2);
        expect(lines[0]).toMatch(/waiting .* for the check:ui lane — pid 1001/);
        expect(lines.at(-1)).toMatch(/acquired the check:ui lane/);
        expect(readUiLaneOwner(root)?.pid).toBe(1002);
        second.release();
    });

    it("reclaims a lane whose holder is dead", async () => {
        await acquireUiLane(inProcess({ pid: 1001 }));
        const lines: string[] = [];
        const hold = await acquireUiLane(
            inProcess({
                pid: 1002,
                isAlive: () => false,
                announce: (l) => lines.push(l),
            })
        );
        expect(lines[0]).toMatch(/reclaiming the lane — holder is gone/);
        expect(readUiLaneOwner(root)?.pid).toBe(1002);
        hold.release();
    });

    it("reclaims a live holder that stopped heartbeating", async () => {
        let t = 1_000_000;
        await acquireUiLane(inProcess({ pid: 1001, now: () => t }));
        t += 60 * 60 * 1000;
        const lines: string[] = [];
        const hold = await acquireUiLane(
            inProcess({
                pid: 1002,
                now: () => t,
                isAlive: () => true,
                staleMs: 45 * 60 * 1000,
                announce: (l) => lines.push(l),
            })
        );
        expect(lines[0]).toMatch(/pid 1001 is alive but has not heartbeated/);
        hold.release();
    });

    it("never releases a lane another pid holds", async () => {
        const mine = await acquireUiLane(inProcess({ pid: 1001 }));
        fs.writeFileSync(
            path.join(lockDir(), "owner.json"),
            JSON.stringify({ ...readUiLaneOwner(root), pid: 9999 })
        );
        mine.release();
        expect(readUiLaneOwner(root)?.pid).toBe(9999);
    });
});

describe("uiLaneWhoLines", () => {
    it("says free when nobody holds it", () => {
        expect(uiLaneWhoLines(root)).toEqual(["[gate] check:ui lane is free"]);
    });

    it("names a live holder, and a dead one", async () => {
        await acquireUiLane(inProcess({ pid: 1001, cwd: "/wt-a" }));
        const live = uiLaneWhoLines(root, Date.now(), () => true).join("\n");
        expect(live).toMatch(/check:ui lane — pid 1001 .* \/wt-a/);
        expect(live).toMatch(/holder pid alive/);
        const dead = uiLaneWhoLines(root, Date.now(), () => false).join("\n");
        expect(dead).toMatch(/holder is dead/);
    });
});

// ── real processes: every exit path frees the lane ─────────────────────────
const LIB = path.resolve(__dirname, "../lib/ui-admission.ts");

function child(body: string) {
    const script = path.join(
        root,
        `child-${Math.random().toString(36).slice(2)}.ts`
    );
    fs.writeFileSync(
        script,
        `import { acquireUiLane } from ${JSON.stringify(LIB)};
await acquireUiLane({ root: ${JSON.stringify(root)}, label: "child", announce: () => {} });
console.log("HELD");
${body}
`
    );
    const proc = spawn("bun", [script], { stdio: ["ignore", "pipe", "pipe"] });
    const held = new Promise<void>((resolve, reject) => {
        let out = "";
        proc.stdout.on("data", (d) => {
            out += d;
            if (out.includes("HELD")) resolve();
        });
        proc.on("exit", () =>
            reject(new Error(`child exited before HELD: ${out}`))
        );
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) =>
            proc.on("exit", (code, signal) => resolve({ code, signal }))
    );
    return { proc, held, exited };
}

describe("acquireUiLane — every exit path frees the lane", () => {
    it.each([
        ["falling off the end", "", 0],
        ["process.exit(3)", "process.exit(3);", 3],
        ["an uncaught throw", 'throw new Error("boom");', 1],
    ])(
        "%s",
        async (_name, body, code) => {
            const c = child(body);
            expect((await c.exited).code).toBe(code);
            expect(fs.existsSync(lockDir())).toBe(false);
        },
        30_000
    );

    it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
        "%s while holding",
        async (sig) => {
            const c = child("await new Promise(() => {});");
            await c.held;
            expect(readUiLaneOwner(root)?.pid).toBe(c.proc.pid);
            c.proc.kill(sig);
            await c.exited;
            expect(fs.existsSync(lockDir())).toBe(false);
        },
        30_000
    );
});
