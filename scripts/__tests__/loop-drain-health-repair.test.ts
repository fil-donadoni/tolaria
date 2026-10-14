import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    tmp,
    stubGhCountingFrom,
    stubClaudeProgress,
    run,
    passLogCount,
    writeStub,
    stubBunDefaultBody,
} from "./loop-drain-harness";

installLoopDrainHarness();

/**
 * `loop:afk` repairs a RED tip unattended (issue #5589, step 2b): it asks
 * `health:fix --plan` what to do, runs ONE `health:fix --headless` per tip,
 * resumes after `landed`, waits while a landed repair awaits health, and
 * stops + notifies on `stuck` or a plan that says stop.
 *
 * `health:fix` is stubbed here — its decision is `health-fix-headless.test.ts`'s
 * — and the verdict is the REAL reader over a file-backend RED.
 */
const SHA = "deadbeef".repeat(5);
const healthDir = (): string =>
    path.join(tmp, ".claude", "telemetry", "health");

const writeRed = (): void => {
    fs.mkdirSync(healthDir(), { recursive: true });
    fs.writeFileSync(
        path.join(healthDir(), "RED"),
        `staging @ ${SHA} red at test\n`
    );
    fs.writeFileSync(
        path.join(healthDir(), "last.json"),
        JSON.stringify({ sha: SHA, status: "red", failedStep: "test" })
    );
};

/** A `bun` whose `health:fix` runs `plan` on `--plan` and `fix` on
 *  `--headless` (each owns its output and exit code); every call is logged
 *  to `fixlog`. */
const stubHealthFix = (plan: string, fix: string): string => {
    const fixlog = path.join(tmp, "fixlog");
    writeStub(
        "bun",
        [
            `if [ "$1" = "run" ] && [ "$3" = "health:fix" ]; then`,
            `  echo "$*" >> "${fixlog}"`,
            `  case "$*" in`,
            `    *--plan*) ${plan}; exit 0 ;;`,
            `    *--headless*) ${fix} ;;`,
            `  esac`,
            `  exit 1`,
            `fi`,
            stubBunDefaultBody(),
        ].join("\n")
    );
    return fixlog;
};

const clearRed = (): string => `rm -f "${path.join(healthDir(), "RED")}"`;

describe("loop-drain — the unattended repair of a RED tip (issue #5589)", () => {
    it("attempt → headless fix lands → the loop resumes and runs the pass", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        writeRed();
        // The landed repair: health on the repair's tip clears the RED.
        const fixlog = stubHealthFix(`echo attempt`, `${clearRed()}; exit 0`);
        const r = run({
            args: ["--max-passes", "1", "--claude-args", "--permission-mode x"],
            env: { TOLARIA_VERDICT_STORE: "file" },
        });
        const calls = fs.readFileSync(fixlog, "utf8").trim().split("\n");
        expect(calls[0]).toBe(
            `run --silent health:fix --plan ${SHA} --attempts 0`
        );
        // The loop's own claude flags ride as ONE argument.
        expect(calls[1]).toBe(
            "run --silent health:fix --headless --claude-args=--permission-mode x"
        );
        expect(r.stderr).toMatch(/attempting an unattended repair, 1 this run/);
        expect(r.stderr).toMatch(
            /LANDED — health confirms on its tip; resuming/
        );
        expect(r.stdout).toMatch(/reason=max-passes /);
        expect(passLogCount()).toBe(1);
    });

    it("attempt → the fixer is stuck → stop as health-red and notify", () => {
        stubGhCountingFrom(5);
        stubClaudeProgress();
        writeRed();
        stubHealthFix(`echo attempt`, "exit 1");
        const notified = path.join(tmp, "notified");
        const r = run({
            args: ["--claude-args", "x"],
            env: {
                TOLARIA_VERDICT_STORE: "file",
                TOLARIA_NOTIFY_CMD: `printf '%s' "$1" > "${notified}"`,
            },
        });
        expect(r.stdout).toMatch(/reason=health-red/);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/unattended repair did not land \(stuck\)/);
        expect(passLogCount()).toBe(0);
        expect(fs.readFileSync(notified, "utf8")).toMatch(
            /RED base \(deadbeef, test\) — unattended repair stuck, loop stopped/
        );
    });

    it("a plan that says stop → no fixer, stop, the reason on stderr", () => {
        stubGhCountingFrom(5);
        stubClaudeProgress();
        writeRed();
        const fixlog = stubHealthFix(
            `echo "stop: the fixer on MacBook was STUCK: no repro"`,
            "exit 0"
        );
        const r = run({
            args: ["--claude-args", "x"],
            env: { TOLARIA_VERDICT_STORE: "file" },
        });
        expect(r.stdout).toMatch(/reason=health-red/);
        expect(r.stderr).toMatch(
            /no unattended repair: the fixer on MacBook was STUCK: no repro/
        );
        expect(fs.readFileSync(fixlog, "utf8")).not.toMatch(/--headless/);
        expect(passLogCount()).toBe(0);
    });

    it("a plan that says wait → no pass, no stop, until health answers", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        writeRed();
        // Health answers while the loop waits: the next look finds no RED.
        const fixlog = stubHealthFix(
            `${clearRed()}; echo "wait: a repair landed on MacBook (PR #7)"`,
            "exit 1"
        );
        const r = run({
            args: ["--max-passes", "1", "--claude-args", "x"],
            env: { TOLARIA_VERDICT_STORE: "file" },
        });
        expect(r.stderr).toMatch(
            /a repair landed on MacBook \(PR #7\); no pass until health answers/
        );
        expect(fs.readFileSync(fixlog, "utf8")).not.toMatch(/--headless/);
        expect(r.stdout).toMatch(/reason=max-passes /);
        expect(passLogCount()).toBe(1);
    });

    it("a plan that answers nothing stops — never a fixer on an unknown record", () => {
        stubGhCountingFrom(5);
        stubClaudeProgress();
        writeRed();
        stubHealthFix("true", "exit 0");
        const r = run({
            args: ["--claude-args", "x"],
            env: { TOLARIA_VERDICT_STORE: "file" },
        });
        expect(r.stdout).toMatch(/reason=health-red/);
        expect(r.stderr).toMatch(
            /no unattended repair: 'bun run health:fix --plan' gave no answer/
        );
    });
});
