// `check:ui` on an UNDECIDED scope starts no browser and exits its own code
// (issue #6144). A real process over a real untracked file the scoper cannot
// place: the exit code, the banner and the absence of any walk are the claim.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { UI_SCOPE_UNDECIDED_EXIT } from "../lib/ui-scope";

// An `.svg`: no surface's closure places it (UNDECIDED), and no source walk of
// `src/` lists it. A `.tsx` here raced vite-card-sets-dev-bundle.test.ts's
// importer walk (list, then read after the `finally`) into ENOENT (issue #6654).
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const UNPLACED = path.join(
    REPO_ROOT,
    "src/components/zz-unplaced-issue-6144.svg"
);

const SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg"/>\n';

function checkUi(...args: string[]) {
    return spawnSync(
        "bun",
        ["scripts/ui-gate/index.ts", "--base=HEAD", ...args],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 }
    );
}

describe("check:ui — undecided scope exits without a walk (issue #6144)", () => {
    it("prints UNDECIDED, the impact, and exits UI_SCOPE_UNDECIDED_EXIT", () => {
        fs.writeFileSync(UNPLACED, SVG_BODY);
        try {
            const r = checkUi();
            const out = `${r.stdout}${r.stderr}`;
            expect(r.status).toBe(UI_SCOPE_UNDECIDED_EXIT);
            expect(out).toContain("UNDECIDED");
            expect(out).toContain("zz-unplaced-issue-6144.svg");
            expect(out).toContain("no browser started");
            expect(out).toMatch(/\d+ cells, ~\d+ min/);
        } finally {
            fs.rmSync(UNPLACED, { force: true });
        }
    });

    it("--scope-only on the same diff still exits 0", () => {
        fs.writeFileSync(UNPLACED, SVG_BODY);
        try {
            const r = checkUi("--scope-only");
            expect(r.status).toBe(0);
            expect(r.stdout).toContain("UNDECIDED");
        } finally {
            fs.rmSync(UNPLACED, { force: true });
        }
    });
});
