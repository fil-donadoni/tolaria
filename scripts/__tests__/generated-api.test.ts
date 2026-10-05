import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    convexCodegen,
    convexModules,
    GENERATED_API,
    generatedApiDrift,
    generatedApiModules,
    refreshGeneratedApi,
    type Codegen,
} from "../lib/generated-api";
import {
    buildLockedCommand,
    rebaseStep,
    refreshGeneratedApiStep,
} from "../land";

/**
 * Issue #5077: a worktree's `convex/_generated/` is COPIED from the primary
 * checkout, whose copy nothing refreshes when a PR lands. After PR #5069 added
 * four Convex modules, a health run copied a generated API without them and
 * recorded RED on 58 `check:ts` errors in a tree with nothing wrong in it.
 *
 * These tests build that state — a generated API missing one module of the
 * tree — in a throwaway project wired to the repo's own Convex CLI, and run
 * the REAL offline generator over it.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MODULE =
    'import { query } from "./_generated/server";\nexport const q = query({ handler: async () => 1 });\n';

let root: string;

function write(rel: string, body = MODULE): void {
    const file = path.join(root, "convex", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
}

function api(): string {
    return fs.readFileSync(path.join(root, GENERATED_API), "utf8");
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "generated-api-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "fx", dependencies: { convex: "*" } })
    );
    fs.symlinkSync(
        path.join(REPO_ROOT, "node_modules"),
        path.join(root, "node_modules")
    );
    write("alpha.ts");
    write("nested/beta.ts");
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("refreshGeneratedApi (issue #5077)", () => {
    it("regenerates a copy that lacks a module of the tree, offline", () => {
        expect(convexCodegen(root).ok).toBe(true);
        // The landing: a module the copied API has never heard of.
        write("gameReads.ts");
        expect(generatedApiDrift(root)).toEqual({
            missing: ["gameReads"],
            extra: [],
        });

        const outcome = refreshGeneratedApi(root);

        expect(outcome).toEqual({
            kind: "regenerated",
            drift: { missing: ["gameReads"], extra: [] },
        });
        expect(generatedApiModules(api())).toEqual([
            "alpha",
            "gameReads",
            "nested/beta",
        ]);
    });

    it("regenerates a copy that names a module the tree no longer has", () => {
        write("gone.ts");
        expect(convexCodegen(root).ok).toBe(true);
        fs.rmSync(path.join(root, "convex", "gone.ts"));

        expect(refreshGeneratedApi(root).kind).toBe("regenerated");
        expect(generatedApiModules(api())).toEqual(["alpha", "nested/beta"]);
    });

    it("produces the API when there is no copy at all", () => {
        expect(refreshGeneratedApi(root)).toEqual({
            kind: "regenerated",
            drift: null,
        });
        expect(generatedApiModules(api())).toEqual(["alpha", "nested/beta"]);
    });

    it("keeps a matching copy byte-for-byte and never runs the generator", () => {
        expect(convexCodegen(root).ok).toBe(true);
        const marked = `${api()}\n// the primary's own copy\n`;
        fs.writeFileSync(path.join(root, GENERATED_API), marked);
        let ran = 0;
        const spy: Codegen = () => {
            ran++;
            return { ok: true, detail: "" };
        };

        expect(refreshGeneratedApi(root, spy)).toEqual({ kind: "fresh" });
        expect(ran).toBe(0);
        expect(api()).toBe(marked);
    });

    it("fails, naming the drift, when the generator fails", () => {
        const broken: Codegen = () => ({ ok: false, detail: "boom" });
        const outcome = refreshGeneratedApi(root, broken);
        expect(outcome.kind).toBe("failed");
        expect(outcome.kind === "failed" && outcome.reason).toContain("boom");
    });

    it("fails when the generator leaves the drift in place", () => {
        expect(convexCodegen(root).ok).toBe(true);
        write("gameTable.ts");
        const noop: Codegen = () => ({ ok: true, detail: "" });
        const outcome = refreshGeneratedApi(root, noop);
        expect(outcome.kind === "failed" && outcome.reason).toContain(
            "gameTable"
        );
    });

    it("refuses to regenerate a tree with components (offline codegen would drop them)", () => {
        write("convex.config.ts", "export default {};\n");
        let ran = 0;
        const spy: Codegen = () => {
            ran++;
            return { ok: true, detail: "" };
        };
        expect(refreshGeneratedApi(root, spy).kind).toBe("failed");
        expect(ran).toBe(0);
    });
});

describe("convexModules agrees with the Convex CLI's own generator", () => {
    it("on every exclusion the CLI applies", () => {
        // Each of these is a file the CLI does NOT turn into a module; a
        // Convex upgrade that changes one shows up here as a key mismatch.
        write("schema.ts", "export default {};\n");
        write("two.dots.ts");
        write("__tests__/thing.test.ts");
        write("noModule.ts", "const x = 1;\n");
        write(".hidden.ts");
        write("plain.js", "export const y = 1;\n");

        expect(convexCodegen(root).ok).toBe(true);
        expect(convexModules(path.join(root, "convex"))).toEqual(
            generatedApiModules(api())
        );
    });
});

describe("land refreshes the generated API on the rebased tree", () => {
    it("between the rebase and the lane gate", () => {
        const cmd = buildLockedCommand({
            branch: "fix/issue-5077",
            gatedGreen: [],
            laneRecordDir: null,
            pr: 1,
            primaryCheckout: "/repo",
            worktree: "/repo/wt",
            merge: true,
            teardown: true,
        });
        const rebaseAt = cmd.indexOf(rebaseStep());
        const refreshAt = cmd.indexOf(refreshGeneratedApiStep());
        const gateAt = cmd.indexOf("bun run check:lane");
        expect(rebaseAt).toBeGreaterThanOrEqual(0);
        expect(refreshAt).toBeGreaterThan(rebaseAt);
        expect(gateAt).toBeGreaterThan(refreshAt);
    });
});
