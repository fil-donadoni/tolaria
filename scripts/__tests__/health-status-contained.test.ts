import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fakeGh } from "./fake-gh";

const HEALTH_MAIN = resolve(__dirname, "..", "health-main.ts");
const TIP = "c".repeat(40);

/** `health:status` as a subprocess over a fake `gh`: what the owner reads
 *  (ADR 0163 §1, issue #8074). */
describe("health:status over a RED", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "health-status-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const status = (description: string): string => {
        const gh = fakeGh(dir);
        gh.setHistory([TIP]);
        gh.seed(TIP, { state: "failure", context: "health", description });
        const r = spawnSync("bun", [HEALTH_MAIN, "--status"], {
            cwd: dir,
            encoding: "utf8",
            timeout: 30_000,
            env: { ...process.env, ...gh.env },
        });
        // A Contained RED stays a RED: exit 1, as under any RED.
        expect(r.status).toBe(1);
        return r.stdout;
    };

    it("prints RED (contained), with the RED's own line under it", () => {
        const out = status(
            "RED · test:bot · huawei · contained · tests: scripts/__tests__/a.test.ts"
        );
        expect(out).toContain("verdict store: RED (contained) @ cccccccc");
        expect(out).toContain("RED: test:bot — assertion");
    });

    it("a RED with no class prints RED", () => {
        const out = status("RED · test:bot · huawei · failure: assertion");
        expect(out).toContain("verdict store: RED @ cccccccc");
        expect(out).not.toContain("contained");
    });
});
