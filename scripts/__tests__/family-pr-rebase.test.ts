// Two PRs of one family meet on the same committed list (issue #6648): two
// Grammar PRs that each add one gold-incomparable card, two card PRs that each
// insert one card-index row, two Grammar PRs that each graduate one
// round-trip-baseline row — at ADJACENT places, the shape that conflicts as
// text. A real `git rebase` in a scratch repo, under the repo's own
// `.gitattributes` and merge drivers, must replay one over the other cleanly
// and land the union of both changes.
//
// Each fixture is first replayed WITHOUT the drivers and must conflict: that
// is what makes it a fixture of the bug and not of two edits git would merge
// anyway.

import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_BRANCH } from "../lib/branches";
import {
    APPEND_ONLY_MERGE_DRIVER_NAME,
    KEY_SET_MERGE_DRIVER_NAME,
} from "../lib/generated-artifacts";
import { serializeKeys, serializeRows } from "../lib/key-set-merge";

const REPO_ROOT = resolve(__dirname, "..", "..");

const GOLD = "data/gold-incomparable.json";
const INDEX = "data/card-index.json";
const BASELINE = "convex/cards/__tests__/compilerRoundTrip.baseline.ts";

const card = (name: string) => ({
    name,
    scryfallId: `s-${name}`,
    oracleId: `o-${name}`,
    source: "compiled",
});

const baseline = (...names: string[]) =>
    [
        "// Guard C's BASELINE (fixture).",
        "export const COMPILER_GAP_ROWS: readonly string[] = [",
        ...names.map((n) => `    ${JSON.stringify(n)},`),
        "];",
        "",
    ].join("\n");

interface Case {
    readonly path: string;
    readonly base: string;
    readonly branch: string;
    readonly main: string;
    readonly merged: string;
}

const CASES: Record<string, Case> = {
    "each adds one incomparable card": {
        path: GOLD,
        base: serializeKeys(["Ball Lightning", "Crystal Rod", "Onulet"]),
        branch: serializeKeys([
            "Ball Lightning",
            "Crystal Rod",
            "Damnation",
            "Onulet",
        ]),
        main: serializeKeys([
            "Ball Lightning",
            "Crystal Rod",
            "Curse of Marit Lage",
            "Onulet",
        ]),
        merged: serializeKeys([
            "Ball Lightning",
            "Crystal Rod",
            "Curse of Marit Lage",
            "Damnation",
            "Onulet",
        ]),
    },
    "each inserts one card-index row": {
        path: INDEX,
        base: serializeRows([card("Island"), card("Swamp")]),
        branch: serializeRows([
            card("Island"),
            card("Spectral Force"),
            card("Swamp"),
        ]),
        main: serializeRows([
            card("Island"),
            card("Spectral Bears"),
            card("Swamp"),
        ]),
        merged: serializeRows([
            card("Island"),
            card("Spectral Bears"),
            card("Spectral Force"),
            card("Swamp"),
        ]),
    },
    "each graduates one round-trip baseline row": {
        path: BASELINE,
        base: baseline("Black Vise", "Blaze of Glory", "Blight", "Blizzard"),
        branch: baseline("Black Vise", "Blight", "Blizzard"),
        main: baseline("Black Vise", "Blaze of Glory", "Blizzard"),
        merged: baseline("Black Vise", "Blizzard"),
    },
};

describe("family PRs rebase over each other (real git, real drivers)", () => {
    let dir: string;
    let repo: string;

    function git(args: string[]): string {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        return r.stdout.trim();
    }
    const write = (path: string, text: string) => {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), text);
    };
    const commit = (message: string) => {
        git(["add", "-A"]);
        git(["commit", "-q", "-m", message]);
    };

    /** The two drivers, registered as `worktree:init` registers them. */
    function registerDrivers(): void {
        for (const [name, script] of [
            [KEY_SET_MERGE_DRIVER_NAME, "merge-driver-key-set.ts"],
            [APPEND_ONLY_MERGE_DRIVER_NAME, "merge-driver-append-only.ts"],
        ] as const) {
            git(["config", `merge.${name}.name`, name]);
            git([
                "config",
                `merge.${name}.driver`,
                `bun ${join(REPO_ROOT, "scripts", script)} %O %A %B %P`,
            ]);
        }
    }

    /** The branch's commit replayed onto the base's: exit status + output. */
    function rebase(c: Case) {
        write(c.path, c.base);
        commit("base");
        git(["checkout", "-q", "-b", "branch"]);
        write(c.path, c.branch);
        commit("branch");
        git(["checkout", "-q", BASE_BRANCH]);
        write(c.path, c.main);
        commit("main");
        git(["checkout", "-q", "branch"]);
        const r = spawnSync("git", ["rebase", BASE_BRANCH], {
            cwd: repo,
            encoding: "utf8",
        });
        return { status: r.status, output: r.stdout + r.stderr };
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-family-rebase-"));
        repo = join(dir, "repo");
        mkdirSync(repo, { recursive: true });
        spawnSync("git", ["init", "-q", "-b", BASE_BRANCH, repo], { cwd: dir });
        git(["config", "user.email", "test@example.com"]);
        git(["config", "user.name", "Test"]);
        // The repo's OWN attributes: a row dropped from it reds this test.
        copyFileSync(
            join(REPO_ROOT, ".gitattributes"),
            join(repo, ".gitattributes")
        );
        commit("gitattributes");
    });

    afterEach(() => {
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    });

    for (const [title, c] of Object.entries(CASES)) {
        it(`${title} — WITHOUT the drivers the rebase conflicts`, () => {
            const r = rebase(c);
            expect(r.status, r.output).not.toBe(0);
            spawnSync("git", ["rebase", "--abort"], { cwd: repo });
        });

        it(`${title} — with them it is clean and keeps both changes`, () => {
            registerDrivers();
            const r = rebase(c);
            expect(r.status, r.output).toBe(0);
            expect(readFileSync(join(repo, c.path), "utf8")).toBe(c.merged);
        });
    }

    it("a card-index row both sides changed differently stays a conflict", () => {
        registerDrivers();
        const r = rebase({
            path: INDEX,
            base: serializeRows([card("Island")]),
            branch: serializeRows([{ ...card("Island"), source: "hand" }]),
            main: serializeRows([{ ...card("Island"), rarity: "common" }]),
            merged: "",
        });
        expect(r.status).not.toBe(0);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });
});
