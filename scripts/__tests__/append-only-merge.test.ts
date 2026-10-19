import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    APPEND_ONLY_MARKER_SIZE,
    resolveAppendOnly,
} from "../lib/append-only-merge";
import { APPEND_ONLY_MERGE_DRIVER_NAME } from "../lib/generated-artifacts";
import { BASE_BRANCH } from "../lib/branches";

/**
 * Guards for issue #5942 — the hand-written append-only lists merge two
 * appends at the same end without a conflict.
 *
 * The real-git block is the one that matters. It proves the conflict exists
 * without the driver, that git's built-in `union` does NOT fix it (it fuses
 * the two entries into one object — the trap this driver exists to avoid),
 * that the driver keeps both entries whole, and that a hunk editing an
 * existing line still conflicts.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const DRIVER = join(REPO_ROOT, "scripts", "merge-driver-append-only.ts");
const LIST = "list.ts";

const m = (c: string) => c.repeat(APPEND_ONLY_MARKER_SIZE);

describe("resolveAppendOnly — pure insertions concatenate, edits conflict", () => {
    it("concatenates ours then theirs when the base section is empty", () => {
        const diff3 = [
            "head",
            `${m("<")} ours`,
            "a1",
            "a2",
            `${m("|")} base`,
            m("="),
            "b1",
            `${m(">")} theirs`,
            "tail",
        ].join("\n");
        expect(resolveAppendOnly(diff3)).toEqual({
            text: ["head", "a1", "a2", "b1", "tail"].join("\n"),
            unresolved: 0,
        });
    });

    it("leaves a hunk with a non-empty base as a conflict, verbatim", () => {
        const hunk = [
            `${m("<")} ours`,
            "x = 1",
            `${m("|")} base`,
            "x = 0",
            m("="),
            "x = 2",
            `${m(">")} theirs`,
        ];
        expect(resolveAppendOnly(["head", ...hunk].join("\n"))).toEqual({
            text: ["head", ...hunk].join("\n"),
            unresolved: 1,
        });
    });

    it("never reads a short marker run in file content as a marker", () => {
        const text = [
            "<<<<<<< not a marker",
            "=======",
            ">>>>>>> nor this",
        ].join("\n");
        expect(resolveAppendOnly(text)).toEqual({ text, unresolved: 0 });
    });
});

describe("append-only merge driver (real git)", () => {
    let dir: string;
    let repo: string;

    function git(args: string[], cwd = repo): string {
        const r = spawnSync("git", args, { cwd, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
        return r.stdout.trim();
    }

    function commit(message: string): void {
        git(["add", "-A"]);
        git(["commit", "-m", message]);
    }

    /** One blade-shaped entry: braces and `tier` lines every entry shares,
     *  which is exactly what `union` folds together. */
    const entry = (label: string, tier = "must") =>
        `    {\n        label: "${label}",\n        tier: "${tier}",\n    },\n`;
    const list = (...entries: string[]) =>
        `export const LIST = [\n${entries.join("")}];\n`;

    function useAttribute(driver: string): void {
        writeFileSync(
            join(repo, ".gitattributes"),
            `${LIST} merge=${driver}\n`
        );
        commit("gitattributes");
        if (driver !== APPEND_ONLY_MERGE_DRIVER_NAME) return;
        git(["config", `merge.${driver}.name`, "append-only"]);
        git(["config", `merge.${driver}.driver`, `bun ${DRIVER} %O %A %B %P`]);
    }

    /** The branch writes `branch`, main writes `main`, then the branch rebases. */
    function divergeAndRebase(
        branch: string,
        main: string
    ): { status: number | null; output: string } {
        git(["checkout", "-q", "-b", "branch"]);
        writeFileSync(join(repo, LIST), branch);
        commit("branch appends");
        git(["checkout", "-q", BASE_BRANCH]);
        writeFileSync(join(repo, LIST), main);
        commit("main appends");
        git(["checkout", "-q", "branch"]);
        const r = spawnSync("git", ["rebase", BASE_BRANCH], {
            cwd: repo,
            encoding: "utf8",
        });
        return { status: r.status, output: r.stdout + r.stderr };
    }

    const read = () => readFileSync(join(repo, LIST), "utf8");

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-append-only-merge-"));
        repo = join(dir, "repo");
        mkdirSync(repo, { recursive: true });
        spawnSync("git", ["init", "-b", BASE_BRANCH, repo], { cwd: dir });
        git(["config", "user.email", "test@example.com"]);
        git(["config", "user.name", "Test"]);
        writeFileSync(join(repo, LIST), list(entry("X")));
        commit("base list");
    });

    afterEach(() => {
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    });

    it("WITHOUT a driver, two appends at the same end conflict (the bug)", () => {
        const r = divergeAndRebase(
            list(entry("X"), entry("B")),
            list(entry("X"), entry("A"))
        );
        expect(r.status).not.toBe(0);
        expect(r.output).toContain(LIST);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });

    it("git's built-in union FUSES the two entries into one object (why not union)", () => {
        useAttribute("union");
        const r = divergeAndRebase(
            list(entry("X"), entry("B")),
            list(entry("X"), entry("A"))
        );
        expect(r.status, r.output).toBe(0);
        expect(read()).not.toBe(list(entry("X"), entry("A"), entry("B")));
    });

    it("with the driver, both appends rebase clean and survive WHOLE, main's first", () => {
        useAttribute(APPEND_ONLY_MERGE_DRIVER_NAME);
        const r = divergeAndRebase(
            list(entry("X"), entry("B")),
            list(entry("X"), entry("A"))
        );
        expect(r.status, r.output).toBe(0);
        expect(git(["status", "--porcelain"])).toBe("");
        expect(read()).toBe(list(entry("X"), entry("A"), entry("B")));
    });

    it("with the driver, two edits of one existing line still conflict", () => {
        useAttribute(APPEND_ONLY_MERGE_DRIVER_NAME);
        const r = divergeAndRebase(
            list(entry("X", "stretch")),
            list(entry("X", "must-not"))
        );
        expect(r.status).not.toBe(0);
        expect(r.output).toContain(LIST);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });
});
