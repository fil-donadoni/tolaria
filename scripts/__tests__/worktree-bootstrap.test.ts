import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    ESLINT_CACHE_FILE,
    TSBUILDINFO_DIR,
    seedWorktreeCaches,
} from "../lib/worktree-seed";

/**
 * Guards for the "a fresh worktree is not runnable" failure class.
 *
 * Three inputs this repo needs at runtime are gitignored (`node_modules`,
 * `convex/_generated`, `.env.local`) plus husky's generated `.husky/_`. The
 * rule for restoring them lived in prose and was measurably ignored twice:
 * once producing a phantom red baseline (~216 files failing at *import*, 0
 * tests failing), once letting prettier drift reach the merge-train because
 * the pre-commit hook was never in git at all.
 *
 * These assertions are cheap and offline; they guard the wiring, not the copy
 * itself (which is exercised every time an agent bootstraps a worktree).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readPkg(): { scripts: Record<string, string> } {
    return JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    );
}

describe("worktree bootstrap wiring", () => {
    it("exposes `worktree:init`, pointed at the bootstrap script", () => {
        expect(readPkg().scripts["worktree:init"]).toBe(
            "bun scripts/bootstrap-worktree.ts"
        );
    });

    it("bootstrap script imports node builtins only, transitively", () => {
        // It runs in a worktree that has no node_modules yet — a single
        // third-party import would make it unable to do its own job. A
        // RELATIVE import is allowed (bun resolves it without node_modules)
        // and is followed: the module it names is held to the same rule.
        // The `from` clause is optional in the pattern: a bare side-effect
        // `import "x";` loads x all the same, and the previous pattern let
        // one through (seen red-less under proof-of-failure, issue #3776).
        // The clause may span lines (a wrapped `{ a, b }`) but never a `;`:
        // a `[\s\S]*?` there backtracked across a bare import's terminator
        // and reported only the NEXT statement's specifier (PR #3790 review).
        const importsOf = (file: string): string[] =>
            [
                ...fs
                    .readFileSync(file, "utf8")
                    .matchAll(/^import (?:[^;]*? from )?"([^"]+)";$/gm),
            ].map((m) => m[1]);
        const seen = new Set<string>();
        const walk = (file: string) => {
            if (seen.has(file)) return;
            seen.add(file);
            const imports = importsOf(file);
            expect(imports.length, file).toBeGreaterThan(0);
            for (const spec of imports) {
                if (spec.startsWith(".")) {
                    const target = path.resolve(path.dirname(file), spec);
                    walk(fs.existsSync(target) ? target : `${target}.ts`);
                } else {
                    expect(spec, `${file} imports ${spec}`).toMatch(/^node:/);
                }
            }
        };
        walk(path.join(REPO_ROOT, "scripts", "bootstrap-worktree.ts"));
        // The seed helper is the one relative import today; the walk must
        // have reached it, or the transitive rule guards nothing.
        expect([...seen]).toContain(
            path.join(REPO_ROOT, "scripts", "lib", "worktree-seed.ts")
        );
    });
});

describe("pre-commit hook", () => {
    it("is tracked by git", () => {
        // The original bug: `.husky/pre-commit` existed nowhere, so husky's
        // shim (`.husky/_/h` does `[ ! -f "$s" ] && exit 0`) silently no-oped
        // in EVERY checkout — lint-staged never ran anywhere.
        const r = spawnSync(
            "git",
            ["ls-files", "--error-unmatch", ".husky/pre-commit"],
            {
                cwd: REPO_ROOT,
                encoding: "utf8",
            }
        );
        expect(r.status).toBe(0);
    });

    it("runs lint-staged", () => {
        const hook = fs.readFileSync(
            path.join(REPO_ROOT, ".husky", "pre-commit"),
            "utf8"
        );
        expect(hook).toMatch(/^\s*lint-staged\s*$/m);
    });
});

describe("pre-push hook", () => {
    const HOOK = path.join(REPO_ROOT, ".husky", "pre-push");

    it("is tracked by git", () => {
        // `.husky/pre-commit` was deleted on 2026-06-17 inside a MERGE commit
        // (3ca58ca6 / 5cdbf196) and nobody noticed for six weeks, because a
        // missing hook is silent by design. Same exposure here.
        const r = spawnSync("git", ["ls-files", "--error-unmatch", HOOK], {
            cwd: REPO_ROOT,
            encoding: "utf8",
        });
        expect(r.status).toBe(0);
    });

    it("checks only the pushed diff, never the whole repo", () => {
        // A full `format:check` costs ~43s. In front of every push that is a
        // gate people disable, so the hook must stay diff-scoped.
        const code = fs
            .readFileSync(HOOK, "utf8")
            .split("\n")
            .filter((l) => !/^\s*#/.test(l))
            .join("\n");
        expect(code).toMatch(/prettier --check/);
        expect(code).toMatch(/git diff --name-only/);
        expect(code).not.toMatch(/format:check/);
    });

    // Functional exercise in a throwaway repo. The hook is POSIX sh run as
    // `sh -e` by husky's shim, where an `&&` guard returning non-zero is an
    // easy way to abort the whole script by accident — the kind of bug that is
    // invisible until a push silently stops being checked.
    describe("run against a scratch repo", () => {
        let tmp: string;
        let base: string;
        let drifted: string;
        let clean: string;

        const git = (...args: string[]) => {
            const r = spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
            expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
            return r.stdout.trim();
        };

        /**
         * Feed the hook one ref line, exactly as git does on push.
         *
         * Defaults to a FEATURE ref: pushing the default branch now also runs
         * the full gate (issue #2203), which these formatting cases are not
         * about. The default-branch path has its own describe block below,
         * with `bun` stubbed.
         */
        const runHook = (
            remoteSha: string,
            localSha: string,
            opts: {
                ref?: string;
                extraPath?: string;
                env?: Record<string, string>;
            } = {}
        ) =>
            spawnSync("sh", ["-e", HOOK], {
                cwd: tmp,
                encoding: "utf8",
                input: `refs/heads/x ${localSha} ${opts.ref ?? "refs/heads/feature"} ${remoteSha}\n`,
                env: {
                    ...process.env,
                    // Hermetic: the escape hatch must not leak in from the
                    // developer's own shell and silently defuse the gate
                    // assertions below.
                    TOLARIA_SKIP_PUSH_GATE: "",
                    ...opts.env,
                    PATH: `${opts.extraPath ? `${opts.extraPath}:` : ""}${path.join(REPO_ROOT, "node_modules", ".bin")}:${process.env.PATH}`,
                },
            });

        beforeAll(() => {
            tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-prepush-"));
            git("init", "-q", "-b", "main");
            git("config", "user.email", "test@example.com");
            git("config", "user.name", "test");
            // No prettier config above a tmpdir, so prettier applies its
            // defaults — under which these two files are unambiguously
            // formatted / unformatted regardless of this repo's .prettierrc.
            fs.writeFileSync(path.join(tmp, "a.ts"), "const a = 1;\n");
            git("add", "-A");
            git("commit", "-qm", "base");
            base = git("rev-parse", "HEAD");

            fs.writeFileSync(path.join(tmp, "b.ts"), "const   b   =    2;\n");
            git("add", "-A");
            git("commit", "-qm", "drift");
            drifted = git("rev-parse", "HEAD");

            fs.writeFileSync(path.join(tmp, "c.ts"), "const c = 3;\n");
            git("add", "-A");
            git("commit", "-qm", "clean");
            clean = git("rev-parse", "HEAD");
        });

        afterAll(() => {
            fs.rmSync(tmp, { recursive: true, force: true });
        });

        it("rejects a push whose commits carry formatting drift", () => {
            const r = runHook(base, drifted);
            expect(r.status).toBe(1);
            expect(`${r.stdout}${r.stderr}`).toMatch(/bun run format/);
        });

        it("passes a push whose commits are clean", () => {
            // drifted..clean touches only c.ts — b.ts is already on the remote,
            // so this push is not the one that introduced it.
            const r = runHook(drifted, clean);
            expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        });

        it("passes a push that changes no checkable file", () => {
            const r = runHook(clean, clean);
            expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        });

        /**
         * The full gate on the default branch (issue #2203).
         *
         * The green-main invariant rests entirely on the gate, and there were
         * two routes to `main` on which no gate ran: a local merge commit (git
         * calls `pre-merge-commit`, not `pre-commit`) and a direct push.
         * Measured 22 Jul – 4 Aug: `test` went red on `main` 14 times, no
         * flakes, and TEN of the thirteen classifiable commits arrived by one
         * of those two routes.
         *
         * `bun` is stubbed so the assertions are about WHICH commands the hook
         * runs and whether it blocks, not about this repo's suite.
         */
        describe("full gate on the default branch", () => {
            let binDir: string;

            // The hook RECORDS a green sha after a successful gate, so a previous
            // test in this block would make the next one hit the dedup path and
            // silently stop exercising the gate at all.
            beforeEach(() => {
                fs.rmSync(path.join(tmp, ".claude"), {
                    recursive: true,
                    force: true,
                });
            });
            const calls = () =>
                fs.existsSync(path.join(binDir, "calls.log"))
                    ? fs.readFileSync(path.join(binDir, "calls.log"), "utf8")
                    : "";

            /** @param exitCode what the stubbed `bun run …` returns */
            const stubBun = (exitCode: number, failOn?: string) => {
                binDir = fs.mkdtempSync(path.join(os.tmpdir(), "prepush-bun-"));
                const script =
                    `#!/bin/sh\n` +
                    `echo "$@" >> "${path.join(binDir, "calls.log")}"\n` +
                    // The pattern MUST be quoted: an unquoted `*run test*` is a
                    // syntax error in sh (the space splits it), and a stub that
                    // dies on a syntax error still returns non-zero, so the
                    // test would look like it was exercising the red path while
                    // exercising a broken stub.
                    (failOn
                        ? `case "$*" in *"${failOn}"*) exit 1 ;; esac\n`
                        : "") +
                    `exit ${exitCode}\n`;
                fs.writeFileSync(path.join(binDir, "bun"), script, {
                    mode: 0o755,
                });
                return binDir;
            };

            it("runs check:all AND the full suite when the push updates the default branch", () => {
                const bin = stubBun(0);
                const r = runHook(drifted, clean, {
                    ref: "refs/heads/main",
                    extraPath: bin,
                });
                expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
                expect(calls()).toMatch(/run check:all/);
                expect(calls()).toMatch(/run test/);
            });

            it("blocks the push when the gate is red", () => {
                const bin = stubBun(0, "run test");
                const r = runHook(drifted, clean, {
                    ref: "refs/heads/main",
                    extraPath: bin,
                });
                expect(r.status).toBe(1);
                expect(`${r.stdout}${r.stderr}`).toMatch(/not pushing/);
            });

            it("does NOT run the gate for a feature-branch push", () => {
                // The direction that matters: required CI already gates those,
                // and paying the full suite on every feature push would make
                // the hook unusable — which is how gates get disabled.
                const bin = stubBun(0);
                const r = runHook(drifted, clean, { extraPath: bin });
                expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
                expect(calls()).not.toMatch(/run test/);
            });

            it("skips the gate when the pushed commit is already recorded green — dedup, not relaxation", () => {
                const bin = stubBun(0);
                fs.mkdirSync(path.join(tmp, ".claude", "telemetry"), {
                    recursive: true,
                });
                fs.writeFileSync(
                    path.join(tmp, ".claude", "telemetry", "green-sha"),
                    `${clean}\n`
                );
                const r = runHook(drifted, clean, {
                    ref: "refs/heads/main",
                    extraPath: bin,
                });
                expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
                expect(calls()).not.toMatch(/run test/);
                fs.rmSync(path.join(tmp, ".claude"), {
                    recursive: true,
                    force: true,
                });
            });

            // The explicit opt-out. Its whole justification is that the
            // alternative people actually reach for is `git push --no-verify`,
            // which ALSO drops the formatting check and records no intent.
            it("skips the gate when TOLARIA_SKIP_PUSH_GATE is set", () => {
                const bin = stubBun(0);
                const r = runHook(drifted, clean, {
                    ref: "refs/heads/main",
                    extraPath: bin,
                    env: { TOLARIA_SKIP_PUSH_GATE: "1" },
                });
                expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
                expect(calls()).not.toMatch(/run check:all/);
                expect(calls()).not.toMatch(/run test/);
            });

            it("says loudly that the gate was skipped", () => {
                // A silent bypass is indistinguishable from a gate that ran and
                // passed — the exact failure mode this hook exists to close.
                const bin = stubBun(0);
                const r = runHook(drifted, clean, {
                    ref: "refs/heads/main",
                    extraPath: bin,
                    env: { TOLARIA_SKIP_PUSH_GATE: "1" },
                });
                expect(`${r.stdout}${r.stderr}`).toMatch(
                    /TOLARIA_SKIP_PUSH_GATE set — full gate NOT run/
                );
            });

            it("records no green sha when the gate is skipped", () => {
                // Skipping is not verifying: writing the sha here would make the
                // dedup path treat an ungated commit as proven green forever.
                const bin = stubBun(0);
                runHook(drifted, clean, {
                    ref: "refs/heads/main",
                    extraPath: bin,
                    env: { TOLARIA_SKIP_PUSH_GATE: "1" },
                });
                expect(
                    fs.existsSync(
                        path.join(tmp, ".claude", "telemetry", "green-sha")
                    )
                ).toBe(false);
            });

            it("still runs the formatting check when the gate is skipped", () => {
                // Sub-second, and never the reason anyone wants out. The escape
                // hatch buys out of the SUITE, not out of the hook.
                const bin = stubBun(0);
                const r = runHook(base, drifted, {
                    ref: "refs/heads/main",
                    extraPath: bin,
                    env: { TOLARIA_SKIP_PUSH_GATE: "1" },
                });
                expect(r.status).toBe(1);
                expect(`${r.stdout}${r.stderr}`).toMatch(/bun run format/);
            });
        });
    });
});

describe("pre-merge-commit hook (issue #2203)", () => {
    // Git does not invoke `pre-commit` for a merge commit. Seven of the ten
    // ungated commits that broke `main` in the measured window were local merge
    // commits — the formatting pass every other commit gets never ran on them.
    it("is tracked in git", () => {
        const r = spawnSync(
            "git",
            ["ls-files", "--error-unmatch", ".husky/pre-merge-commit"],
            { cwd: REPO_ROOT, encoding: "utf8" }
        );
        expect(r.status, r.stderr).toBe(0);
    });

    it("runs the same formatting pass as pre-commit", () => {
        const merge = fs.readFileSync(
            path.join(REPO_ROOT, ".husky", "pre-merge-commit"),
            "utf8"
        );
        const commit = fs.readFileSync(
            path.join(REPO_ROOT, ".husky", "pre-commit"),
            "utf8"
        );
        expect(merge.trim()).toBe(commit.trim());
    });
});

describe("husky hooks are executable in git's index", () => {
    it("every tracked .husky hook has mode 100755", () => {
        // Tracked-and-present is NOT enough: git records the executable bit, so
        // a hook committed as 100644 arrives non-executable in every checkout
        // and every fresh worktree, and husky's shim skips it in silence —
        // indistinguishable from the hook being absent, which is the failure
        // #1821 was opened to fix. `.husky/pre-commit` was committed by #1821
        // itself as 100644 and was therefore inert everywhere for six days:
        // the fix for "the hook is missing" shipped "the hook is inert".
        //
        // git only ever warns (`hook was ignored because it's not set as
        // executable`), and only on the commit that would have run it — which
        // is exactly the commit whose output nobody reads.
        const listing = spawnSync("git", ["ls-files", "-s", ".husky/"], {
            cwd: REPO_ROOT,
            encoding: "utf8",
        });
        expect(listing.status, listing.stderr).toBe(0);

        const hooks = listing.stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [meta, file] = line.split("\t");
                return { mode: meta.split(" ")[0], file };
            })
            // `.husky/_` is husky's generated shim directory and is gitignored;
            // anything else tracked under .husky/ is a hook git must be able to
            // execute.
            .filter((h) => !h.file.startsWith(".husky/_"));

        expect(hooks.length).toBeGreaterThan(0);

        const nonExecutable = hooks
            .filter((h) => h.mode !== "100755")
            .map((h) => `${h.file} is ${h.mode}`);

        expect(
            nonExecutable,
            "fix with: git update-index --chmod=+x <file>\n" +
                nonExecutable.join("\n")
        ).toEqual([]);
    });
});

describe("light pre-PR gate", () => {
    it("`check:pr` runs every `check:all` check, plus the bot guards, without the mutex", () => {
        // check:index / check:stubs cost <0.2s each. Leaving them
        // out of the pre-PR gate saved nothing and cost a merge-train re-gate
        // on every card-shipping PR (the card-index lockfile drift guard).
        //
        // `check:guards` (issue #1912) is the pre-PR gate's ONE addition over
        // `check:all`: the catalogue-wide guards (aiEffectsGuard, pickRatings,
        // opValuerCoverage, the moves/cardProfile censuses) all live in the BOT
        // suite, which the light gate never ran — three consecutive card PRs
        // reached a green `check:pr` while red in the bot suite. `check:all`
        // does NOT need it: it is followed by the full `bun run test`, which
        // runs the bot suite in full.
        const scripts = readPkg().scripts;
        expect(scripts["check:pr"]).toBe(
            "bun scripts/gate.ts light 'bun run check:all:inner && bun run check:guards'"
        );
        expect(scripts["check:all"]).toBe(
            "bun scripts/gate.ts heavy 'bun run check:all:inner'"
        );
        // The lane must stay the FAST one — a plain `vitest run` over the bot
        // projects would drag `ai-diagnosis.bot.test.ts` (163s of the suite's
        // 188s) into every pre-PR gate.
        expect(scripts["check:guards"]).toContain("TOLARIA_BOT_FAST=1");
        // …and it must also cover the application suite's node project WHOLE —
        // `convex/**` + `scripts/**`, no path filter. It used to be filtered to
        // `scripts/__tests__` (the repo's own hygiene guards, including THIS
        // test): enough to catch a change to the gate's own wiring, but it left
        // every backend catalogue guard outside the light gate, and a branch
        // reached review with `convex/gre/effects/__tests__/validate.test.ts`
        // red under a `check:pr` that exited 0. The whole project is ~26s at 2
        // workers. Scope pinned in detail by `check-guards-scope.test.ts`.
        //
        // …and, since #2655, the dom project WHOLE too — every `src/`
        // component/layout guard (e.g. the shell-height census that killed
        // #2584) used to be invisible until the merge-train, because an
        // issue-worktree branch cannot run the full suite (`bun run test:app`)
        // that carried `--project dom`. Same segment, no path filter, same
        // reasoning as the node project above.
        //
        // The node/dom segment must be followed by nothing or by another `&&`
        // command — never by a positional token, which vitest reads as a path
        // filter. (Issue #2429 appended `&& bun run cr:lint` as a third lane.)
        expect(scripts["check:guards"]).toMatch(
            /vitest run --project node --project dom(?:\s*&&|\s*"?$)/
        );
    });
});

describe("build-cache seeding (issue #3776, ADR 0136 §9)", () => {
    // `tsc -b --noEmit` measured 56s over 365 runs a fortnight (5.7h) and
    // `eslint .` 69s over 42 runs, and all of it was the cold start: both
    // caches are gitignored and every worktree begins without them. The
    // bootstrap now seeds them from the primary. Both validate by content,
    // so a stale seed is safe; these cases pin the seeding itself.
    let tmp: string;
    let primary: string;
    let cwd: string;

    const write = (root: string, rel: string, content: string) => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    };

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-seed-"));
        primary = path.join(tmp, "tolaria");
        cwd = path.join(tmp, "tolaria-issue-1");
        fs.mkdirSync(primary);
        fs.mkdirSync(cwd);
    });

    afterAll(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("copies every tsbuildinfo the primary has and names each one in the receipt", () => {
        write(primary, `${TSBUILDINFO_DIR}/tsconfig.app.tsbuildinfo`, "app");
        write(primary, `${TSBUILDINFO_DIR}/tsconfig.convex.tsbuildinfo`, "cvx");
        write(primary, `${TSBUILDINFO_DIR}/unrelated.txt`, "no");

        const r = seedWorktreeCaches({ primary, cwd });

        expect(r.done).toContain(
            "tsbuildinfo seed (2 files from primary: tsconfig.app.tsbuildinfo, tsconfig.convex.tsbuildinfo)"
        );
        expect(
            fs.readFileSync(
                path.join(cwd, TSBUILDINFO_DIR, "tsconfig.app.tsbuildinfo"),
                "utf8"
            )
        ).toBe("app");
        expect(
            fs.existsSync(path.join(cwd, TSBUILDINFO_DIR, "unrelated.txt"))
        ).toBe(false);
    });

    it("skips cleanly when the primary has none — nothing created, nothing thrown", () => {
        const r = seedWorktreeCaches({ primary, cwd });

        expect(r.done).toEqual([]);
        expect(r.skipped).toEqual([
            "tsbuildinfo seed (primary has none — cold type-check)",
            "eslint cache (primary has none — cold run)",
        ]);
        expect(fs.existsSync(path.join(cwd, "node_modules"))).toBe(false);
    });

    it("rewrites the eslint cache's absolute keys from the primary's path to this worktree's", () => {
        // file-entry-cache keys every entry by ABSOLUTE path (and repeats it
        // in the cached result's `filePath`), so a byte copy could never hit.
        // The trailing separator is what keeps `…/tolaria/` from matching
        // inside a sibling `…/tolaria-issue-9/`.
        const foreign = `${tmp}/tolaria-issue-9/src/z.ts`;
        write(
            primary,
            ESLINT_CACHE_FILE,
            JSON.stringify([
                { [`${primary}/src/a.ts`]: "1", [foreign]: "2" },
                {
                    "1": {
                        meta: { results: { filePath: `${primary}/src/a.ts` } },
                    },
                    "2": { meta: { results: { filePath: foreign } } },
                },
            ])
        );

        const r = seedWorktreeCaches({ primary, cwd });

        expect(r.done).toContain(
            "eslint cache (seeded from primary, 2 paths rewritten)"
        );
        const seeded = JSON.parse(
            fs.readFileSync(path.join(cwd, ESLINT_CACHE_FILE), "utf8")
        );
        expect(Object.keys(seeded[0])).toEqual([`${cwd}/src/a.ts`, foreign]);
        expect(seeded[1]["1"].meta.results.filePath).toBe(`${cwd}/src/a.ts`);
        expect(seeded[1]["2"].meta.results.filePath).toBe(foreign);
    });

    it("keeps the JSON valid when a checkout path needs escaping", () => {
        // Rewriting inside the JSON TEXT means the prefixes must be matched
        // in their escaped form — a quote in a directory name is the cheapest
        // way to make the naive (unescaped) replace miss and leave a cold
        // cache behind, and it would be silent.
        const quoted = path.join(tmp, 'pri"mary');
        fs.mkdirSync(quoted);
        write(
            quoted,
            ESLINT_CACHE_FILE,
            JSON.stringify([{ [`${quoted}/src/a.ts`]: "1" }, {}])
        );

        const r = seedWorktreeCaches({ primary: quoted, cwd });

        expect(r.done).toContain(
            "eslint cache (seeded from primary, 1 paths rewritten)"
        );
        const seeded = JSON.parse(
            fs.readFileSync(path.join(cwd, ESLINT_CACHE_FILE), "utf8")
        );
        expect(Object.keys(seeded[0])).toEqual([`${cwd}/src/a.ts`]);
    });

    it("leaves a present cache alone unless forced", () => {
        write(primary, `${TSBUILDINFO_DIR}/tsconfig.app.tsbuildinfo`, "new");
        write(primary, ESLINT_CACHE_FILE, "[{},{}]");
        write(cwd, `${TSBUILDINFO_DIR}/tsconfig.app.tsbuildinfo`, "mine");
        write(cwd, ESLINT_CACHE_FILE, "[{},{}]");

        const r = seedWorktreeCaches({ primary, cwd });
        expect(r.done).toEqual([]);
        expect(r.skipped).toEqual([
            "tsbuildinfo seed (1 present: tsconfig.app.tsbuildinfo)",
            "eslint cache (present)",
        ]);
        expect(
            fs.readFileSync(
                path.join(cwd, TSBUILDINFO_DIR, "tsconfig.app.tsbuildinfo"),
                "utf8"
            )
        ).toBe("mine");

        const forced = seedWorktreeCaches({ primary, cwd, force: true });
        expect(forced.done).toHaveLength(2);
        expect(
            fs.readFileSync(
                path.join(cwd, TSBUILDINFO_DIR, "tsconfig.app.tsbuildinfo"),
                "utf8"
            )
        ).toBe("new");
    });

    it("`lint` writes the cache where the seed reads it, keyed by CONTENT, and never repairs", () => {
        // `metadata` (eslint's default strategy) keys on mtime+size: a fresh
        // checkout's mtimes differ from the primary's on every file, so the
        // seed would miss on all of them and look like it worked.
        const scripts = readPkg().scripts;
        const flags = `--cache --cache-location ${ESLINT_CACHE_FILE} --cache-strategy content`;
        expect(scripts.lint).toBe(`eslint . ${flags}`);
        expect(scripts["lint:fix"]).toBe(`eslint . --fix ${flags}`);
        // check:all VERIFIES, it does not repair (#1807): the inner script
        // runs `lint`, and `lint` carries no `--fix`.
        expect(scripts["check:all:inner"]).toMatch(/&& bun run lint &&/);
        expect(scripts.lint).not.toContain("--fix");
    });

    it("the eslint cache location is gitignored, and so is eslint's default one", () => {
        for (const file of [ESLINT_CACHE_FILE, ".eslintcache"]) {
            const r = spawnSync("git", ["check-ignore", "-q", file], {
                cwd: REPO_ROOT,
                encoding: "utf8",
            });
            expect(r.status, `${file} is not gitignored`).toBe(0);
        }
    });
});
