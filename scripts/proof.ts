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
    /** Run the test file; its exit code. */
    runTest: (test: string) => number;
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
    deps.write(args.file, broken);
    let brokenExit: number;
    try {
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
        deps.write(args.file, original);
    }
    if (deps.git(["status", "--porcelain"]).trim() !== "")
        return {
            ok: false,
            refusal: `the revert left the tree dirty — \`git status\`, then \`git checkout -- ${args.file}\``,
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
            refusal: `${args.test} is red without the break too (exit ${revertedExit}) — the red proves nothing`,
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
            }).status ?? 1,
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
