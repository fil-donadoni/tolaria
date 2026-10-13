import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    REAL_BUN,
    tmp,
    queueFile,
    totalFile,
    greenShaFile,
    writeStub,
    planJson,
    CONVEX_ENSURE_UP,
    run,
} from "./loop-drain-harness";

installLoopDrainHarness();

/**
 * Issue #5564: a pass that leaves its issue unclaimed and still
 * `ready-for-agent` (owner-only work it cannot land) must not stop the run on
 * `no-progress` while the queue holds another eligible head — the issue is
 * excluded for the rest of the run, and the run stops only when nothing but
 * excluded issues is left.
 */
describe("loop-drain — excludes an issue a pass left untouched (issue #5564)", () => {
    const OWNER_ONLY = 5492;

    /** A plan whose batch is `numbers`, in order, every one on sonnet. */
    const stubPlan = (numbers: number[]): void => {
        const item = JSON.parse(planJson(0, "sonnet")).batch[0];
        const plan = {
            ...JSON.parse(planJson(0, "sonnet")),
            batch: numbers.map((number) => ({ ...item, number })),
        };
        writeStub(
            "bun",
            [
                CONVEX_ENSURE_UP,
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo "$ bun scripts/queue-plan.ts" >&2`,
                `  cat <<'PLANEOF'`,
                JSON.stringify(plan),
                `PLANEOF`,
                `  exit 0`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
    };

    /** `gh`: the two queue counts off their files, no handed-off PR, and the
     *  owner-only issue read as `OPEN`, unclaimed, `ready-for-agent`. */
    const stubGh = (): void => {
        fs.writeFileSync(queueFile, "5");
        fs.writeFileSync(totalFile, "5");
        writeStub(
            "gh",
            [
                `case "$*" in`,
                `  *"pr list"*) exit 0 ;;`,
                `  *"issue view ${OWNER_ONLY}"*) echo "OPEN false true" ;;`,
                `  *"issue view"*) echo "CLOSED false false" ;;`,
                `  *"-label:in-progress"*) cat "${queueFile}" ;;`,
                `  *) cat "${totalFile}" ;;`,
                `esac`,
            ].join("\n")
        );
    };

    /** `claude`: records each pass's prompt; the owner-only issue's pass does
     *  nothing (claims nothing, hands off nothing), any other lands. */
    const stubClaude = (): string => {
        const file = path.join(tmp, "claude-prompts");
        writeStub(
            "claude",
            [
                `p=""`,
                `while [ $# -gt 0 ]; do`,
                `  case "$1" in -p) p="$2"; shift ;; esac`,
                `  shift`,
                `done`,
                `echo "$p" >> "${file}"`,
                `case "$p" in *${OWNER_ONLY}*) exit 0 ;; esac`,
                `n=$(cat "${totalFile}")`,
                `n=$((n-1))`,
                `echo "$n" > "${totalFile}"`,
                `echo "$n" > "${queueFile}"`,
                `echo "sha-$n" > "${greenShaFile}"`,
                `exit 0`,
            ].join("\n")
        );
        return file;
    };

    const prompts = (file: string): string[] =>
        fs.readFileSync(file, "utf8").trim().split("\n");

    it("the next pass plans without the untouched issue, and the run goes on", () => {
        stubGh();
        stubPlan([OWNER_ONLY, 101]);
        const file = stubClaude();
        const r = run({ args: ["--max-passes", "3"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(prompts(file)).toEqual([
            `/next-ticket ${OWNER_ONLY}`,
            "/next-ticket 101",
            "/next-ticket 101",
        ]);
        expect(r.stdout).toMatch(/reason=max-passes/);
        expect(r.stderr).toMatch(
            new RegExp(`left issue #${OWNER_ONLY} unclaimed .* excluding it`)
        );
        expect(r.stderr).toMatch(
            new RegExp(`excluded this run .*: #${OWNER_ONLY}$`, "m")
        );
    });

    it("the excluded issue as the ONLY eligible head still stops the run on no-progress", () => {
        stubGh();
        stubPlan([OWNER_ONLY]);
        const file = stubClaude();
        const r = run({ args: ["--max-passes", "5"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(prompts(file)).toEqual([`/next-ticket ${OWNER_ONLY}`]);
        expect(r.stdout).toMatch(/reason=no-progress/);
        expect(r.stderr).toMatch(
            new RegExp(`excluded this run .*: #${OWNER_ONLY}$`, "m")
        );
    });
});
