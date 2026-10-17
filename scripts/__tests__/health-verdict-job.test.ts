import { describe, expect, it } from "vitest";
import {
    earlyRunRefusal,
    healthRunMode,
    inJobWorktree,
    storesVerdict,
    unattendedSkip,
} from "../lib/health-verdict-job";

/**
 * Health inside a GitHub Actions job (issue #5645): the early hosted run
 * proves no GREEN, and an unattended run never re-gates a stored RED.
 */

const HOSTED = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" };
const TIP = "f".repeat(40);

describe("an early run writes only its RED to the store", () => {
    it("keeps GREEN, INFRA and AMBER out of the store", () => {
        expect(storesVerdict("early", "red")).toBe(true);
        expect(storesVerdict("early", "green")).toBe(false);
        expect(storesVerdict("early", "infra")).toBe(false);
    });
    it("writes every verdict of the other modes", () => {
        for (const mode of ["default", "scheduled"] as const)
            for (const s of ["red", "green", "infra"] as const)
                expect(storesVerdict(mode, s)).toBe(true);
    });
});

describe("an early run starts only on a hosted runner, corpus excluded", () => {
    it("is refused off a hosted runner", () => {
        expect(
            earlyRunRefusal(
                { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" },
                true
            )
        ).toMatch(/hosted/);
        expect(earlyRunRefusal({}, true)).toMatch(/hosted/);
    });
    it("is refused without the corpus exclusion", () => {
        expect(earlyRunRefusal(HOSTED, false)).toMatch(
            /TOLARIA_HOSTED_NO_VERDICT_CORPUS/
        );
    });
    it("starts on a hosted runner with it", () => {
        expect(earlyRunRefusal(HOSTED, true)).toBeNull();
    });
});

describe("modes", () => {
    it("reads --early over --scheduled", () => {
        expect(healthRunMode(["--early", "--scheduled"])).toBe("early");
        expect(healthRunMode(["--scheduled"])).toBe("scheduled");
        expect(healthRunMode([])).toBe("default");
    });
});

describe("an unattended run never re-gates a stored RED", () => {
    it("skips the tip the store holds a RED for", () => {
        expect(
            unattendedSkip("scheduled", TIP, { sha: TIP, status: "red" })
        ).toMatch(/already RED/);
        expect(
            unattendedSkip("early", TIP, { sha: TIP, status: "red" })
        ).toMatch(/already RED/);
    });
    it("gates any other tip, and a by-hand run always", () => {
        expect(
            unattendedSkip("scheduled", TIP, {
                sha: "e".repeat(40),
                status: "red",
            })
        ).toBeNull();
        expect(
            unattendedSkip("scheduled", TIP, { sha: TIP, status: "infra" })
        ).toBeNull();
        expect(
            unattendedSkip("default", TIP, { sha: TIP, status: "red" })
        ).toBeNull();
        expect(unattendedSkip("scheduled", TIP, null)).toBeNull();
    });
});

describe("a job's worktree is the one linked worktree health accepts", () => {
    it("is the job's workspace, inside Actions", () => {
        expect(
            inJobWorktree("/w/_work/t/t", {
                GITHUB_ACTIONS: "true",
                GITHUB_WORKSPACE: "/w/_work/t/t/",
            })
        ).toBe(true);
    });
    it("is nothing else", () => {
        expect(
            inJobWorktree("/code/tolaria-issue-1", {
                GITHUB_ACTIONS: "true",
                GITHUB_WORKSPACE: "/w/_work/t/t",
            })
        ).toBe(false);
        expect(
            inJobWorktree("/w/_work/t/t", { GITHUB_WORKSPACE: "/w/_work/t/t" })
        ).toBe(false);
        expect(inJobWorktree("/w", { GITHUB_ACTIONS: "true" })).toBe(false);
    });
});
