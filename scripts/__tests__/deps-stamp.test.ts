/**
 * `land` reinstalls dependencies after a rebase that changed the manifests
 * (issue #6000): PR #5932 rebased onto a base that added `@mergifyio/vitest`,
 * nothing reinstalled, and `tsc` redded the lane on a module the worktree
 * lacked.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    DEPS_STAMP,
    depsFingerprint,
    depsInstallNeeded,
    ensureDeps,
    readDepsState,
    writeDepsStamp,
} from "../lib/deps-stamp";
import { buildLockedCommand } from "../land";
import { ensureDepsStep, rebaseStep } from "../lib/rebase-resolve";

describe("depsInstallNeeded — the pure decision", () => {
    const lock = depsFingerprint({ "package.json": "{}", "bun.lock": "a" });
    it("installs when the stamp names other manifests, or there is none", () => {
        const moved = depsFingerprint({
            "package.json": "{}",
            "bun.lock": "b",
        });
        expect(moved).not.toBe(lock);
        expect(depsInstallNeeded(lock, moved)).toBe(true);
        expect(depsInstallNeeded(null, lock)).toBe(true);
    });
    it("does not when the stamp names exactly these manifests", () => {
        expect(depsInstallNeeded(`${lock}\n`, lock)).toBe(false);
    });
    it("a package.json change alone moves the fingerprint", () => {
        expect(
            depsFingerprint({ "package.json": '{"a":1}', "bun.lock": "a" })
        ).not.toBe(lock);
    });
});

describe("ensureDeps on a tree whose bun.lock a rebase moved", () => {
    let root: string;
    let installs: number;
    const install = (): boolean => {
        installs++;
        return true;
    };
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "deps-stamp-"));
        fs.mkdirSync(path.join(root, "node_modules"));
        fs.writeFileSync(path.join(root, "package.json"), "{}");
        fs.writeFileSync(path.join(root, "bun.lock"), "lock v1");
        writeDepsStamp(root);
        installs = 0;
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("does not install when the rebase left the manifests alone", () => {
        expect(ensureDeps(root, install)).toBe("fresh");
        expect(installs).toBe(0);
    });

    it("installs once when bun.lock changed, then stamps", () => {
        fs.writeFileSync(path.join(root, "bun.lock"), "lock v2");
        expect(ensureDeps(root, install)).toBe("installed");
        expect(installs).toBe(1);
        const { stamp, fingerprint } = readDepsState(root);
        expect(stamp?.trim()).toBe(fingerprint);
        expect(ensureDeps(root, install)).toBe("fresh");
        expect(installs).toBe(1);
    });

    it("a reused worktree with no stamp installs", () => {
        fs.rmSync(path.join(root, DEPS_STAMP));
        expect(ensureDeps(root, install)).toBe("installed");
        expect(installs).toBe(1);
    });

    it("a failed install leaves the old stamp, so the retry installs again", () => {
        fs.writeFileSync(path.join(root, "bun.lock"), "lock v2");
        expect(ensureDeps(root, () => false)).toBe("failed");
        expect(ensureDeps(root, install)).toBe("installed");
    });
});

describe("land installs between the rebase and every later step", () => {
    it("ensure-deps runs right after the rebase, before the lane", () => {
        const cmd = buildLockedCommand({
            branch: "fix/issue-6000",
            gatedGreen: [],
            laneRecordDir: null,
            pr: 1,
            primaryCheckout: "/repo",
            worktree: "/repo/wt",
            merge: true,
            teardown: true,
        });
        const rebaseAt = cmd.indexOf(rebaseStep());
        const depsAt = cmd.indexOf(ensureDepsStep());
        expect(rebaseAt).toBeGreaterThanOrEqual(0);
        expect(depsAt).toBe(rebaseAt + rebaseStep().length + " && ".length);
        expect(cmd.indexOf("bun run check:lane")).toBeGreaterThan(depsAt);
    });
});
