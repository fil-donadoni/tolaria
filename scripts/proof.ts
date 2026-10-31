#!/usr/bin/env bun
/**
 * `bun run proof --break <file>:<pattern> --test <path> [--with <text>]` —
 * proof-of-failure as a receipt, not a sentence (issue #7655).
 *
 *   1. refuses on a dirty tree: the break is reverted by writing the
 *      committed bytes back, and the receipt names the commit it ran on;
 *   2. replaces the FIRST occurrence of `<pattern>` in `<file>` with `<text>`
 *      (default: nothing) and asserts the patch applied — the pattern was
 *      counted in the file (a `grep -c`) and the bytes read back are the
 *      broken ones; a pattern absent from the file refuses;
 *   3. runs the test expecting red — green means the test does not guard the
 *      break: refused, after the revert;
 *   4. reverts, asserts the tree is clean, runs the test expecting green;
 *   5. prints the fenced receipt (`lib/proof-receipt.ts`) for the PR body,
 *      which `land:ready` reads on a code-lane PR.
 *
 * The test runs as `bunx vitest run <path> --passWithNoTests`: a filter that
 * matches nothing exits 0, so it reads as "does not guard", never as a red.
 * Exit 0 = receipt printed, 1 = refused (one line naming why), 2 = usage.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    formatReceipt,
    patternHash,
    type ProofReceipt,
} from "./lib/proof-receipt";

export interface ProofArgs {
    file: string;
    pattern: string;
    replacement: string;
    test: string;
}

/** The I/O `runProof` needs — a seam for the fixture-repo test. */
export interface ProofDeps {
    /** `git <args>` in the repo; its stdout. Throws on failure. */
    git: (args: string[]) => string;
    read: (path: string) => string;
    write: (path: string, text: string) => void;
    /** Run the test file; its exit code — null when it never exited on its
     *  own (killed, timed out, not spawned): that is no red. */
    runTest: (test: string) => number | null;
    log: (line: string) => void;
}

export type ProofResult =
    | { ok: true; receipt: ProofReceipt }
    | { ok: false; refusal: string };

/** `--break <file>:<pattern> --test <path> [--with <text>]`; null = usage. */
export function parseProofArgs(argv: readonly string[]): ProofArgs | null {
    const flag = (name: string): string | undefined => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const brk = flag("--break");
    const test = flag("--test");
    if (brk === undefined || test === undefined) return null;
    const colon = brk.indexOf(":");
    if (colon <= 0 || colon === brk.length - 1) return null;
    return {
        file: brk.slice(0, colon),
        pattern: brk.slice(colon + 1),
        replacement: flag("--with") ?? "",
        test,
    };
}

function count(text: string, pattern: string): number {
    return text.split(pattern).length - 1;
}

export function runProof(args: ProofArgs, deps: ProofDeps): ProofResult {
    const dirty = deps.git(["status", "--porcelain"]).trim();
    if (dirty !== "")
        return {
            ok: false,
            refusal: `the working tree is dirty — commit first: the break is reverted to the committed bytes and the receipt names the commit (${dirty.split("\n").length} path(s) changed)`,
        };
    const head = deps.git(["rev-parse", "HEAD"]).trim();
    const original = deps.read(args.file);
    const before = count(original, args.pattern);
    if (before === 0)
        return {
            ok: false,
            refusal: `the pattern is not in ${args.file} — the break was not applied, nothing ran`,
        };
    const broken = original.replace(args.pattern, () => args.replacement);
    if (broken === original)
        return {
            ok: false,
            refusal: `the replacement equals the pattern — the break changes nothing in ${args.file}, nothing ran`,
        };
    let brokenExit: number | null;
    let revertFailed: string | null = null;
    try {
        deps.write(args.file, broken);
        const reread = deps.read(args.file);
        const after = count(reread, args.pattern);
        if (reread !== broken)
            return {
                ok: false,
                refusal: `the break did not apply to ${args.file} (the bytes read back are not the broken ones; pattern count ${before} → ${after}) — nothing ran`,
            };
        deps.log(
            `proof: break applied to ${args.file} (${before} → ${after} occurrence(s)); running ${args.test}, expecting red`
        );
        brokenExit = deps.runTest(args.test);
    } finally {
        // Never a throw out of `finally`: it would replace the runner's own
        // error. A failed revert is logged here and thrown below.
        try {
            deps.write(args.file, original);
        } catch (err) {
            revertFailed = `the revert of ${args.file} failed (${(err as Error).message}) — the break is still in it: \`git checkout -- ${args.file}\``;
            deps.log(`proof: ${revertFailed}`);
        }
    }
    if (revertFailed !== null) throw new Error(revertFailed);
    const after = deps.git(["status", "--porcelain"]).trim();
    if (after !== "")
        return {
            ok: false,
            refusal: `the tree is dirty after the revert (${after.split("\n").join(", ")}) — the test run wrote files, or the revert missed: \`git status\` before anything else`,
        };
    if (brokenExit === null)
        return {
            ok: false,
            refusal: `${args.test} never exited on its own with the break applied (killed or timed out) — that is no red; re-run`,
        };
    if (brokenExit === 0)
        return {
            ok: false,
            refusal: `${args.test} is green with the break applied — the test does not guard the break`,
        };
    deps.log(
        `proof: red with the break (exit ${brokenExit}); reverted, running ${args.test}, expecting green`
    );
    const revertedExit = deps.runTest(args.test);
    if (revertedExit !== 0)
        return {
            ok: false,
            refusal: `${args.test} is ${revertedExit === null ? "killed or timed out" : `red (exit ${revertedExit})`} without the break too — the red proves nothing`,
        };
    return {
        ok: true,
        receipt: {
            head,
            file: args.file,
            patternSha256: patternHash(args.pattern),
            test: args.test,
            brokenExit,
            revertedExit,
        },
    };
}

/** Under the Bash tool's 600 s cap, so the revert runs before a kill. */
const TEST_TIMEOUT_MS = 540_000;

function realDeps(cwd: string): ProofDeps {
    return {
        git: (args) => {
            const r = spawnSync("git", args, { cwd, encoding: "utf8" });
            if (r.status !== 0)
                throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
            return r.stdout;
        },
        read: (p) => readFileSync(resolve(cwd, p), "utf8"),
        write: (p, text) => writeFileSync(resolve(cwd, p), text),
        runTest: (test) =>
            spawnSync("bunx", ["vitest", "run", test, "--passWithNoTests"], {
                cwd,
                stdio: "inherit",
                timeout: TEST_TIMEOUT_MS,
            }).status,
        log: console.log,
    };
}

if (import.meta.main) {
    const args = parseProofArgs(process.argv.slice(2));
    if (args === null) {
        console.error(
            "usage: bun run proof --break <file>:<pattern> --test <path> [--with <text>]"
        );
        process.exit(2);
    }
    // A listener defers SIGINT/SIGTERM until the blocking run returns, so
    // `runProof`'s revert runs before the exit — without one, a Ctrl-C
    // mid-run would leave the break in the file. The killed test exits on a
    // signal, which `runProof` refuses: no receipt follows a signal.
    for (const sig of ["SIGINT", "SIGTERM"] as const)
        process.on(sig, () => {
            console.error(`✗ proof: ${sig} — the break is reverted`);
            process.exit(130);
        });
    try {
        const r = runProof(args, realDeps(process.cwd()));
        if (!r.ok) {
            console.error(`✗ proof: refusing — ${r.refusal}`);
            process.exit(1);
        }
        console.log(formatReceipt(r.receipt));
    } catch (err) {
        console.error(`✗ proof: ${(err as Error).message}`);
        process.exit(1);
    }
}
