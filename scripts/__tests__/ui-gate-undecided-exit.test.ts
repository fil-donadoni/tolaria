// `check:ui` on an UNDECIDED scope starts no browser and exits its own code
// (issue #6144). A real process over a real untracked file the scoper cannot
// place: the exit code, the banner and the absence of any walk are the claim.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
    renderScopeDecision,
    renderUiScope,
    scopeStopExit,
    UI_SCOPE_UNDECIDED_EXIT,
    type UiScope,
} from "../lib/ui-scope";

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
});

// The decision itself, in-process over an injected scope (issue #7884): no
// process, no import-graph walk. The real-process smoke above proves the wiring
// once; these prove the claim per case.
describe("check:ui — the pre-browser exit is decided from the scope alone (issue #6144)", () => {
    const undecided: UiScope = {
        kind: "undecided",
        reasons: ["src/components/zz-unplaced.svg is placed by no surface"],
    };
    const full: UiScope = { kind: "full", reason: "a stylesheet" };
    const scoped: UiScope = { kind: "scoped", surfaces: ["lobby"] };
    const plain = { scopeOnly: false, all: false, surfaces: false };

    it("an undecided or full scope nobody chose to walk exits UI_SCOPE_UNDECIDED_EXIT", () => {
        expect(scopeStopExit(undecided, plain)).toBe(UI_SCOPE_UNDECIDED_EXIT);
        expect(scopeStopExit(full, plain)).toBe(UI_SCOPE_UNDECIDED_EXIT);
    });

    it("--scope-only on the same scope still exits 0, and names it UNDECIDED", () => {
        expect(scopeStopExit(undecided, { ...plain, scopeOnly: true })).toBe(0);
        expect(renderUiScope(undecided, "origin/staging")).toContain(
            "UNDECIDED"
        );
    });

    it("--all or --surface= chooses a walk; a scoped diff proceeds", () => {
        expect(scopeStopExit(undecided, { ...plain, all: true })).toBeNull();
        expect(
            scopeStopExit(undecided, { ...plain, surfaces: true })
        ).toBeNull();
        expect(scopeStopExit(scoped, plain)).toBeNull();
    });

    it("the printed decision says no browser started and the impact", () => {
        const out = renderScopeDecision(undecided, ["lobby", "game"], 5, false);
        expect(out).toContain("UNDECIDED");
        expect(out).toContain("zz-unplaced");
        expect(out).toContain("no browser started");
        expect(out).toMatch(/\d+ cells, ~\d+ min/);
    });
});
