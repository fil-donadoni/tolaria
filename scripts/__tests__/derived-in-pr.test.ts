/**
 * ADR 0157 § Option 1b, issue #6248 — a PR carries rows, never derived state:
 * `lib/derived-in-pr.ts` (the split, the restore) and the
 * `check:derived-in-diff` guard over a real repository.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
    DERIVED_PATHS,
    DERIVE_SYNC_COMMIT_SUBJECT,
    LOCKFILE_PATH,
} from "../lib/derive-sync";
import {
    CATALOGUE_DERIVED_PATHS,
    carriesNothing,
    derivedCarried,
    derivedInDiffProblems,
    HEADER_HASH_KEYS,
    headerHashes,
    headerHashesDiffering,
    RESTORE_COMMIT_SUBJECT,
    restoreHeaderHashes,
} from "../lib/derived-in-pr";
import { restoreDerivedState, type RestoreGit } from "../land-ready";

/** A lockfile text in the committed shape: header block, then the row arrays. */
function lockfile(
    hashes: Partial<Record<(typeof HEADER_HASH_KEYS)[number], string>>,
    rows: string[]
): string {
    const h = {
        compilerHash: "sha256:c1",
        registryHash: "sha256:r1",
        botHash: "sha256:b1",
        poolHash: "sha256:p1",
        ...hashes,
    };
    return [
        "{",
        '    "generator": "generated",',
        '    "header": {',
        '        "grammarVersion": "v0",',
        `        "compilerHash": "${h.compilerHash}",`,
        `        "registryHash": "${h.registryHash}",`,
        `        "botHash": "${h.botHash}",`,
        `        "poolHash": "${h.poolHash}",`,
        '        "corpus": {',
        '            "sha256": "fe91"',
        "        }",
        "    },",
        '    "fragments": [',
        "    ],",
        '    "botGaps": [',
        "    ],",
        '    "cards": [',
        ...rows.map((r, i) => `        ${r}${i === rows.length - 1 ? "" : ","}`),
        "    ]",
        "}",
        "",
    ].join("\n");
}

describe("derived-in-pr — the lockfile split: header lines are the base's, rows the PR's", () => {
    it("the catalogue paths are every derived path but the lockfile", () => {
        expect(CATALOGUE_DERIVED_PATHS).toEqual(
            DERIVED_PATHS.filter((p) => p !== LOCKFILE_PATH)
        );
        expect(CATALOGUE_DERIVED_PATHS).toHaveLength(4);
    });

    it("reads the four header hashes, and names the ones that differ", () => {
        const base = lockfile({}, ['{"name":"A"}']);
        const head = lockfile(
            { compilerHash: "sha256:c2", botHash: "sha256:b2" },
            ['{"name":"A"}']
        );
        expect(headerHashes(base)).toEqual({
            compilerHash: "sha256:c1",
            registryHash: "sha256:r1",
            poolHash: "sha256:p1",
            botHash: "sha256:b1",
        });
        expect(headerHashesDiffering(head, base)).toEqual([
            "compilerHash",
            "botHash",
        ]);
        expect(headerHashesDiffering(base, base)).toEqual([]);
    });

    it("a hash-looking value inside a ROW is never read as the header's", () => {
        const text = lockfile({}, ['{"compilerHash":"sha256:row"}']);
        expect(headerHashes(text).compilerHash).toBe("sha256:c1");
    });

    it("restoreHeaderHashes rewrites the four lines to the base's and leaves every other byte", () => {
        const base = lockfile({}, ['{"name":"A"}']);
        const head = lockfile(
            {
                compilerHash: "sha256:c2",
                registryHash: "sha256:r2",
                poolHash: "sha256:p2",
                botHash: "sha256:b2",
            },
            ['{"name":"A"}', '{"name":"B"}']
        );
        const restored = restoreHeaderHashes(head, base);
        expect(headerHashes(restored)).toEqual(headerHashes(base));
        // The rows — the PR's — survive untouched.
        expect(restored).toContain('{"name":"B"}');
        expect(restored.split("\n").length).toBe(head.split("\n").length);
        // Byte-equal to the same lockfile written with the base's hashes.
        expect(restored).toBe(lockfile({}, ['{"name":"A"}', '{"name":"B"}']));
    });

    it("restoreHeaderHashes leaves a key the base lacks as it is", () => {
        const head = lockfile({ compilerHash: "sha256:c2" }, ["{}"]);
        const base = head.replace(/^\s*"compilerHash".*\n/m, "");
        expect(headerHashes(restoreHeaderHashes(head, base)).compilerHash).toBe(
            "sha256:c2"
        );
    });
});

describe("derivedCarried — what a diff carries of the derived state", () => {
    const rowsOnly = () => ({
        head: lockfile({}, ['{"name":"A"}', '{"name":"B"}']),
        base: lockfile({}, ['{"name":"A"}']),
    });

    it("rows only: nothing carried, the lockfile texts read but the header equal", () => {
        const c = derivedCarried({ changed: [LOCKFILE_PATH], lockfile: rowsOnly });
        expect(carriesNothing(c)).toBe(true);
        expect(derivedInDiffProblems(c)).toEqual([]);
    });

    it("a changed catalogue file and a moved header hash are each a problem line", () => {
        const c = derivedCarried({
            changed: [LOCKFILE_PATH, CATALOGUE_DERIVED_PATHS[1]!, "src/a.ts"],
            lockfile: () => ({
                head: lockfile({ poolHash: "sha256:p2" }, ["{}"]),
                base: lockfile({}, ["{}"]),
            }),
        });
        expect(c).toEqual({
            catalogue: [CATALOGUE_DERIVED_PATHS[1]],
            headerKeys: ["poolHash"],
        });
        const problems = derivedInDiffProblems(c);
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain(CATALOGUE_DERIVED_PATHS[1]!);
        expect(problems[1]).toContain("poolHash");
    });

    it("the lockfile texts are not read when the lockfile is not in the diff", () => {
        let read = 0;
        const c = derivedCarried({
            changed: ["src/a.ts"],
            lockfile: () => {
                read += 1;
                return rowsOnly();
            },
        });
        expect(read).toBe(0);
        expect(carriesNothing(c)).toBe(true);
    });

    it("a path moved only by derive:sync commits is the base's, not carried", () => {
        const subjects: Record<string, string[]> = {
            [CATALOGUE_DERIVED_PATHS[0]!]: [DERIVE_SYNC_COMMIT_SUBJECT],
            [CATALOGUE_DERIVED_PATHS[1]!]: [
                DERIVE_SYNC_COMMIT_SUBJECT,
                "feat: a card",
            ],
            [LOCKFILE_PATH]: [DERIVE_SYNC_COMMIT_SUBJECT],
        };
        const c = derivedCarried({
            changed: [
                LOCKFILE_PATH,
                CATALOGUE_DERIVED_PATHS[0]!,
                CATALOGUE_DERIVED_PATHS[1]!,
            ],
            lockfile: () => ({
                head: lockfile({ compilerHash: "sha256:c2" }, ["{}"]),
                base: lockfile({}, ["{}"]),
            }),
            subjectsTouching: (p) => subjects[p] ?? [],
        });
        expect(c).toEqual({
            catalogue: [CATALOGUE_DERIVED_PATHS[1]],
            headerKeys: [],
        });
    });
});

describe("check:derived-in-diff — over a real repository", () => {
    const SCRIPT = resolve(__dirname, "..", "check-derived-in-diff.ts");
    let repo: string;
    const git = (...args: string[]): string => {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout.trim();
    };
    const write = (path: string, text: string): void => {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), text);
    };
    const commit = (subject: string): void => {
        git("add", "-A");
        git("commit", "-q", "-m", subject);
    };
    const run = (): { status: number | null; out: string } => {
        const r = spawnSync("bun", [SCRIPT, "--base=base"], {
            cwd: repo,
            encoding: "utf8",
        });
        return { status: r.status, out: `${r.stdout}${r.stderr}` };
    };

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "derived-in-diff-"));
        git("init", "-q", "-b", "base");
        git("config", "user.email", "t@t");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
        write(LOCKFILE_PATH, lockfile({}, ['{"name":"A"}']));
        for (const p of CATALOGUE_DERIVED_PATHS) write(p, `${p} v1\n`);
        write("src/a.ts", "export const a = 1;\n");
        commit("base");
        git("switch", "-q", "-c", "pr");
    });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    it("a rows-only lockfile change is green", () => {
        write(LOCKFILE_PATH, lockfile({}, ['{"name":"A"}', '{"name":"B"}']));
        commit("feat: card B");
        const r = run();
        expect(r.out).toContain("rows only");
        expect(r.status).toBe(0);
    });

    it("a diff outside the derived paths is green without reading the lockfile", () => {
        write("src/a.ts", "export const a = 2;\n");
        commit("fix");
        const r = run();
        expect(r.out).toContain("no derived path changed");
        expect(r.status).toBe(0);
    });

    it("a moved header hash is red, naming the key", () => {
        write(
            LOCKFILE_PATH,
            lockfile({ compilerHash: "sha256:c2" }, ['{"name":"A"}', "{}"])
        );
        commit("feat: card + regenerated header");
        const r = run();
        expect(r.status).toBe(1);
        expect(r.out).toContain("header compilerHash changed");
        expect(r.out).toContain("land:ready");
    });

    it("a changed catalogue file is red, naming the path", () => {
        write(CATALOGUE_DERIVED_PATHS[2]!, "v2\n");
        commit("feat: repacked");
        const r = run();
        expect(r.status).toBe(1);
        expect(r.out).toContain(`${CATALOGUE_DERIVED_PATHS[2]!} changed`);
    });

    it("a derive:sync commit in the range is the base's — exempt", () => {
        write(CATALOGUE_DERIVED_PATHS[2]!, "v2\n");
        write(LOCKFILE_PATH, lockfile({ compilerHash: "sha256:c2" }, ['{"name":"A"}']));
        commit(DERIVE_SYNC_COMMIT_SUBJECT);
        write("src/a.ts", "export const a = 3;\n");
        commit("fix");
        expect(run().status).toBe(0);
    });

    it("on the base tip itself there is nothing to compare — green", () => {
        git("switch", "-q", "base");
        expect(run().status).toBe(0);
    });
});

describe("land:ready restoreDerivedState — the hand-off puts the derived state back (real git)", () => {
    let repo: string;
    const git = (...args: string[]): string => {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout;
    };
    const restoreGit: RestoreGit = {
        run: (args) => git(...args),
        show: (ref, path) => {
            const r = spawnSync("git", ["show", `${ref}:${path}`], {
                cwd: repo,
                encoding: "utf8",
            });
            return r.status === 0 ? r.stdout : null;
        },
    };
    const write = (path: string, text: string): void => {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), text);
    };
    const commit = (subject: string): void => {
        git("add", "-A");
        git("commit", "-q", "-m", subject);
    };
    const baseLock = lockfile({}, ['{"name":"A"}']);

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "land-ready-restore-"));
        git("init", "-q", "-b", "base");
        git("config", "user.email", "t@t");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
        write(LOCKFILE_PATH, baseLock);
        for (const p of CATALOGUE_DERIVED_PATHS) write(p, `${p} v1\n`);
        commit("base");
        git("switch", "-q", "-c", "pr");
    });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    it("restores the catalogue whole and the header lines over the PR's rows, in ONE commit, and the diff is then rows only", () => {
        write(
            LOCKFILE_PATH,
            lockfile(
                { compilerHash: "sha256:c2", poolHash: "sha256:p2" },
                ['{"name":"A"}', '{"name":"B"}']
            )
        );
        write(CATALOGUE_DERIVED_PATHS[0]!, "v2\n");
        write(CATALOGUE_DERIVED_PATHS[3]!, "v2\n");
        commit("feat: card B, regenerated");
        const before = git("rev-parse", "HEAD").trim();
        const lines: string[] = [];
        const carried = restoreDerivedState(repo, "base", restoreGit, (l) =>
            lines.push(l)
        );
        expect(carried).toEqual({
            catalogue: [CATALOGUE_DERIVED_PATHS[0], CATALOGUE_DERIVED_PATHS[3]],
            headerKeys: ["compilerHash", "poolHash"],
        });
        const head = git("rev-parse", "HEAD").trim();
        expect(head).not.toBe(before);
        expect(git("log", "-1", "--format=%s").trim()).toBe(
            RESTORE_COMMIT_SUBJECT
        );
        expect(git("log", "-1", "--format=%P").trim()).toBe(before);
        expect(git("status", "--porcelain").trim()).toBe("");
        // Against the base: the two catalogue files are gone from the diff,
        // the lockfile differs by its new row only.
        expect(git("diff", "--name-only", "base", "HEAD").trim()).toBe(
            LOCKFILE_PATH
        );
        expect(
            git("show", `HEAD:${LOCKFILE_PATH}`)
        ).toBe(lockfile({}, ['{"name":"A"}', '{"name":"B"}']));
        expect(lines.join("\n")).toContain("restoring derived state");
        // The guard agrees: nothing carried now.
        expect(
            spawnSync("bun", [resolve(__dirname, "..", "check-derived-in-diff.ts"), "--base=base"], {
                cwd: repo,
            }).status
        ).toBe(0);
    });

    it("a PR carrying nothing gets no commit", () => {
        write(LOCKFILE_PATH, lockfile({}, ['{"name":"A"}', '{"name":"B"}']));
        commit("feat: card B");
        const before = git("rev-parse", "HEAD").trim();
        const lines: string[] = [];
        expect(
            carriesNothing(
                restoreDerivedState(repo, "base", restoreGit, (l) =>
                    lines.push(l)
                )
            )
        ).toBe(true);
        expect(git("rev-parse", "HEAD").trim()).toBe(before);
        expect(lines[0]).toContain("carries no derived state");
    });
});
