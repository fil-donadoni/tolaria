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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evidenceMarker } from "../lib/health-evidence";
import {
    githubEvidenceStore,
    HEALTH_DIR_REL,
} from "../lib/health-verdict-store";
import { fakeGh, type FakeGh } from "./fake-gh";

/**
 * The class guard of issue #5589: the RED evidence `health:status` and
 * `/health-fix` consume comes from the STORE, never from a verdict's `log`
 * path — a path names a file on the machine that ran the gate, and the
 * incident was a fixer on the other machine with nothing to read.
 *
 * Behavioural for `health:status`: a `last.json` whose `log` points at a
 * readable file holding a perfectly good evidence body must NOT be printed;
 * only what the store holds is. Textual for the skill, whose § 0 is prose.
 */
const HEALTH_MAIN = resolve(__dirname, "..", "health-main.ts");
const SKILL = resolve(
    __dirname,
    "..",
    "..",
    ".claude",
    "skills",
    "health-fix",
    "SKILL.md"
);
let SHA: string;
let gh: FakeGh;

let root: string;
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "evidence-pivot-"));
    // A repository on the base branch, whose tip the fake GitHub holds a RED
    // commit status for.
    const git = (...a: string[]) =>
        spawnSync("git", a, { cwd: root, encoding: "utf8" });
    git("init", "-q", "-b", "staging");
    git(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "tip"
    );
    SHA = git("rev-parse", "HEAD").stdout.trim();
    gh = fakeGh(join(root, "fake-gh"));
    gh.seed(SHA, {
        state: "failure",
        context: "health",
        description: "RED · test · other-machine",
    });
    const dir = join(root, HEALTH_DIR_REL);
    mkdirSync(dir, { recursive: true });
    const log = join(dir, "c0ffee00c0ff.log");
    // A log that LOOKS like evidence: a reader of `log` would print it.
    writeFileSync(log, `${evidenceMarker(SHA)}\nREAD FROM THE LOG PATH\n`);
    writeFileSync(
        join(dir, "last.json"),
        JSON.stringify({ sha: SHA, status: "red", failedStep: "test", log })
    );
});
afterEach(() =>
    rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    })
);

const status = (...args: string[]) =>
    spawnSync("bun", [HEALTH_MAIN, "--status", ...args], {
        cwd: root,
        encoding: "utf8",
        env: {
            ...process.env,
            ...gh.env,
        },
    });

describe("health:status reads the RED evidence from the store (issue #5589)", () => {
    it("never prints the log path's content as evidence", () => {
        const r = status("--evidence");
        expect(r.status).toBe(1);
        expect(r.stdout + r.stderr).not.toContain("READ FROM THE LOG PATH");
        expect(r.stdout).toMatch(/evidence: none published/);
        expect(status().stdout).not.toContain("READ FROM THE LOG PATH");
    });

    it("prints what the store holds — whole with --evidence, a summary otherwise", () => {
        githubEvidenceStore({ repo: "owner/name", run: gh.run }).publish(
            SHA,
            `${evidenceMarker(SHA)}\n## Health RED\n\n- **failure:** crash — killed by SIGKILL\n\n### Failures\n\nFROM THE STORE\n`
        );
        const full = status("--evidence");
        expect(full.status).toBe(0);
        expect(full.stdout).toContain("FROM THE STORE");
        const summary = status().stdout;
        expect(summary).toMatch(/failure:\*\* crash/);
        expect(summary).not.toContain("FROM THE STORE");
        expect(summary).toMatch(
            new RegExp(
                `full evidence: bun run health:status --evidence ${SHA.slice(0, 12)}`
            )
        );
    });
});

describe("/health-fix § 0 reads the pivot, never the log path", () => {
    const skill = readFileSync(SKILL, "utf8");
    const section0 = skill.slice(
        skill.indexOf("## 0."),
        skill.indexOf("## 1.")
    );

    it("names `health:status --evidence` as THE read", () => {
        expect(section0).toMatch(/bun run health:status --evidence/);
    });

    it("never derives a file to read from last.json's `log`", () => {
        expect(section0).not.toMatch(
            /jq -r \.log|cat \.claude\/telemetry\/health\/last\.json/
        );
    });
});
