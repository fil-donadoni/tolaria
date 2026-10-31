import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProofArgs, runProof, type ProofDeps } from "../proof";
import { scrubGitRepoEnv } from "../lib/git-repo-env";
import {
    formatReceipt,
    parseReceipts,
    patternHash,
    proofNoneOwedLine,
    proofReceiptRefusal,
    PROOF_FENCE,
    type ProofReceipt,
} from "../lib/proof-receipt";

// The proof-of-failure receipt (issue #7655): `bun run proof` on a fixture
// repository, its test runner injected (a predicate over the guarded file),
// and `land:ready`'s refusal of a code-lane PR body without one.

const GUARDED = "src/guarded.ts";
const GUARD = "return a + b;";
const TEST = "src/guarded.test.ts";

describe("proof — on a fixture repository", () => {
    let repo: string;
    const git = (args: string[]): string => {
        const env = { ...process.env };
        scrubGitRepoEnv(env);
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", env });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout;
    };
    const read = (p: string): string => readFileSync(join(repo, p), "utf8");
    /** A runner that is red iff the guarded line is missing (a real guard),
     *  and records each run. */
    let runs: string[];
    const deps = (over: Partial<ProofDeps> = {}): ProofDeps => ({
        git,
        read,
        write: (p, text) => writeFileSync(join(repo, p), text),
        runTest: (test) => {
            runs.push(read(GUARDED));
            return read(GUARDED).includes(GUARD) && test === TEST ? 0 : 1;
        },
        log: () => undefined,
        ...over,
    });
    const args = { file: GUARDED, pattern: GUARD, replacement: "", test: TEST };

    beforeEach(() => {
        runs = [];
        repo = mkdtempSync(join(tmpdir(), "proof-"));
        git(["init", "-q", "-b", "main"]);
        git(["config", "user.email", "t@example.com"]);
        git(["config", "user.name", "t"]);
        git(["config", "commit.gpgsign", "false"]);
        spawnSync("mkdir", ["-p", join(repo, "src")]);
        writeFileSync(
            join(repo, GUARDED),
            `export function add(a, b) {\n    ${GUARD}\n}\n`
        );
        writeFileSync(join(repo, TEST), "// the guard\n");
        git(["add", "."]);
        git(["commit", "-q", "-m", "seed"]);
    });
    afterEach(() =>
        rmSync(repo, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("refuses a dirty tree and runs nothing", () => {
        writeFileSync(join(repo, "wip.ts"), "x\n");
        const r = runProof(args, deps());
        expect(r).toMatchObject({ ok: false });
        expect(!r.ok && r.refusal).toContain("dirty");
        expect(runs).toEqual([]);
    });

    it("refuses when the pattern is not in the file — the patch not applied", () => {
        const r = runProof({ ...args, pattern: "return a - b;" }, deps());
        expect(!r.ok && r.refusal).toContain("not applied");
        expect(runs).toEqual([]);
    });

    it("refuses when the bytes read back are not the broken ones", () => {
        const r = runProof(args, deps({ write: () => undefined }));
        expect(!r.ok && r.refusal).toContain("did not apply");
        expect(runs).toEqual([]);
    });

    it("refuses a test green while broken — and reverts the break", () => {
        const r = runProof(args, deps({ runTest: () => 0 }));
        expect(!r.ok && r.refusal).toContain(
            "the test does not guard the break"
        );
        expect(read(GUARDED)).toContain(GUARD);
        expect(git(["status", "--porcelain"])).toBe("");
    });

    it("refuses a test red without the break too", () => {
        const r = runProof(args, deps({ runTest: () => 1 }));
        expect(!r.ok && r.refusal).toContain("without the break too");
    });

    it("a test killed while broken is no red — refused, break reverted", () => {
        const r = runProof(args, deps({ runTest: () => null }));
        expect(!r.ok && r.refusal).toContain("never exited on its own");
        expect(read(GUARDED)).toContain(GUARD);
    });

    it("a runner that throws still reverts the break", () => {
        expect(() =>
            runProof(
                args,
                deps({
                    runTest: () => {
                        throw new Error("spawn failed");
                    },
                })
            )
        ).toThrow("spawn failed");
        expect(read(GUARDED)).toContain(GUARD);
        expect(git(["status", "--porcelain"])).toBe("");
    });

    it("a test run that writes files is refused, the paths named", () => {
        const r = runProof(
            args,
            deps({
                runTest: (t) => {
                    writeFileSync(join(repo, "out.snap"), "x\n");
                    return read(GUARDED).includes(GUARD) && t === TEST ? 0 : 1;
                },
            })
        );
        expect(!r.ok && r.refusal).toContain("out.snap");
    });

    it("the happy path: red broken, green reverted, receipt names the head", () => {
        const head = git(["rev-parse", "HEAD"]).trim();
        const r = runProof(args, deps());
        if (!r.ok) throw new Error(r.refusal);
        expect(runs).toHaveLength(2);
        expect(runs[0]).not.toContain(GUARD);
        expect(runs[1]).toContain(GUARD);
        expect(git(["status", "--porcelain"])).toBe("");
        expect(r.receipt).toEqual({
            head,
            file: GUARDED,
            patternSha256: patternHash(GUARD),
            test: TEST,
            brokenExit: 1,
            revertedExit: 0,
        });
        const block = formatReceipt(r.receipt);
        expect(block.startsWith("```" + PROOF_FENCE)).toBe(true);
        expect(block).toContain(`head: ${head}`);
        expect(parseReceipts(`text\n\n${block}\n`).receipts).toEqual([
            r.receipt,
        ]);
    });
});

describe("parseProofArgs", () => {
    it("splits --break on the first colon; the pattern keeps the rest", () => {
        expect(
            parseProofArgs(["--break", "a.ts:x: y", "--test", "t.ts"])
        ).toEqual({
            file: "a.ts",
            pattern: "x: y",
            replacement: "",
            test: "t.ts",
        });
        expect(
            parseProofArgs(["--break", "a.ts", "--test", "t.ts"])
        ).toBeNull();
        expect(parseProofArgs(["--break", "a.ts:x"])).toBeNull();
    });
});

describe("land:ready — proofReceiptRefusal", () => {
    const HEAD = "1".repeat(40);
    const OLD = "2".repeat(40);
    const receipt = (over: Partial<ProofReceipt> = {}): string =>
        formatReceipt({
            head: HEAD,
            file: GUARDED,
            patternSha256: patternHash(GUARD),
            test: TEST,
            brokenExit: 1,
            revertedExit: 0,
            ...over,
        });
    const refuse = (prBody: string, lane = "engine" as const) =>
        proofReceiptRefusal({ lane, prBody, heads: [HEAD] });

    it("passes a code-lane PR carrying a receipt for its head", () => {
        for (const lane of ["engine", "skin", "full"] as const)
            expect(
                proofReceiptRefusal({
                    lane,
                    prBody: `## Tests\n\n${receipt()}\n`,
                    heads: [HEAD],
                })
            ).toBeNull();
    });

    it("refuses a code-lane PR without one, naming the command", () => {
        expect(refuse("Closes #1")).toContain(
            "bun run proof --break <file>:<pattern> --test <path>"
        );
    });

    it("cards and docs lanes owe none", () => {
        for (const lane of ["cards", "docs"] as const)
            expect(
                proofReceiptRefusal({ lane, prBody: "", heads: [HEAD] })
            ).toBeNull();
    });

    it("refuses a stale sha (amended head) with the re-run line", () => {
        const r = refuse(receipt({ head: OLD }));
        expect(r).toContain("not the PR's head 1111111111");
        expect(r).toContain("re-run");
        // A stale block beside a fresh one is still refused.
        expect(refuse(`${receipt()}\n\n${receipt({ head: OLD })}`)).toContain(
            OLD.slice(0, 10)
        );
    });

    it("accepts a receipt for the head the session pushed when land:ready rebased", () => {
        expect(
            proofReceiptRefusal({
                lane: "engine",
                prBody: receipt({ head: OLD }),
                heads: [HEAD, OLD],
            })
        ).toBeNull();
    });

    it("refuses a malformed block and one recording no red→green", () => {
        expect(refuse(receipt().replace(/^test: .*$/m, "test:"))).toContain(
            "field `test`"
        );
        expect(refuse(receipt({ brokenExit: 0 }))).toContain("no red→green");
        expect(refuse(receipt({ revertedExit: 1 }))).toContain("no red→green");
    });

    it("reads a CRLF body as GitHub returns it", () => {
        expect(
            refuse(`text\r\n\r\n${receipt().replace(/\n/g, "\r\n")}\r\n`)
        ).toBeNull();
    });

    it("a declared `proof: none owed (<reason>)` line passes; an empty reason does not", () => {
        expect(
            refuse(`body\n\n${proofNoneOwedLine("a data refresh")}\n`)
        ).toBeNull();
        expect(refuse("proof: none owed ()")).toContain("carries none");
        expect(refuse("proof: none owed")).toContain("carries none");
        // A stale receipt beside the declaration is still refused.
        expect(
            refuse(`${proofNoneOwedLine("x")}\n\n${receipt({ head: OLD })}`)
        ).toContain("re-run");
    });
});
