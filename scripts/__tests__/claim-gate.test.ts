import { describe, it, expect, vi } from "vitest";
import { checkClaimGate, type ClaimGateDeps } from "../lib/claim-gate";
import {
    buildClaimRow,
    buildPrOpenRow,
    buildReleaseRow,
    claimOwnership,
    UNCLAIMED_OK_ENV,
} from "../lib/queue-claim";

/**
 * `wt:new` / `land:ready` ownership check (issue #5996): a pass that never
 * claimed an issue — or whose claim another session holds — is refused before
 * a worktree or a label is touched. One decision, `claimOwnership`, shared.
 */

const ME = "sess-me";
const OTHER = "sess-other";

const claim = (session: string, issue = 5) =>
    JSON.stringify(
        buildClaimRow({
            now: 1,
            session,
            issue,
            planId: null,
            planned: null,
            owner: null,
            host: "h",
        })
    );
const ledger = (...rows: string[]) => rows.join("\n") + "\n";

const decide = (text: string, hasClaimLabel = true, session = ME) =>
    claimOwnership({
        issue: 5,
        session,
        hasClaimLabel,
        ledgerText: text,
        verb: "land:ready 9",
    });

describe("claimOwnership — the shared decision (issue #5996)", () => {
    it("refuses an issue with no live claim label", () => {
        const r = decide(ledger(claim(ME)), false);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toBe("no-claim");
            expect(r.message).toMatch(/queue:claim 5/);
            expect(r.message).toMatch(/--resume/);
            expect(r.message).toContain(`${UNCLAIMED_OK_ENV}=1`);
        }
    });

    it("refuses a claim the journal says was released", () => {
        const released = JSON.stringify(
            buildReleaseRow({ now: 2, session: ME, issue: 5 })
        );
        const r = decide(ledger(claim(ME), released));
        expect(r.ok === false && r.reason).toBe("no-claim");
    });

    it("refuses a live claim owned by another session", () => {
        const r = decide(ledger(claim(OTHER)));
        expect(r.ok === false && r.reason).toBe("foreign-owner");
    });

    it("refuses a label with no journal row on this machine", () => {
        const r = decide("");
        expect(r.ok === false && r.reason).toBe("foreign-owner");
    });

    it("never lets an empty session own", () => {
        const r = decide(ledger(claim("")), true, "");
        expect(r.ok).toBe(false);
    });

    it("admits this session's fresh claim", () => {
        expect(decide(ledger(claim(ME))).ok).toBe(true);
    });

    it("admits a takeover: a later claim row by this session moves the owner", () => {
        expect(decide(ledger(claim(OTHER), claim(ME))).ok).toBe(true);
    });

    it("keeps the owner through a pr-open row (repair re-run)", () => {
        const prOpen = JSON.stringify(
            buildPrOpenRow({ now: 3, session: ME, issue: 5, pr: 9, host: "h" })
        );
        expect(decide(ledger(claim(ME), prOpen)).ok).toBe(true);
        expect(decide(ledger(claim(OTHER), prOpen)).ok).toBe(false);
    });

    it("ignores other issues' rows and torn lines", () => {
        expect(decide(ledger(claim(OTHER, 6), "{torn", claim(ME))).ok).toBe(
            true
        );
    });
});

describe("checkClaimGate — the I/O wrapper", () => {
    const deps = (labels: string[], text: string): ClaimGateDeps => ({
        labels: () => labels,
        ledger: () => text,
        log: vi.fn(),
    });

    it("refuses with the message and writes nothing else", () => {
        const d = deps([], "");
        const r = checkClaimGate(
            5,
            "wt:new 5",
            { CLAUDE_CODE_SESSION_ID: ME },
            d
        );
        expect(r).toMatch(/no live claim/);
        expect(d.log).not.toHaveBeenCalled();
    });

    it("passes this session's claim", () => {
        const d = deps(["in-progress"], ledger(claim(ME)));
        expect(
            checkClaimGate(5, "wt:new 5", { CLAUDE_CODE_SESSION_ID: ME }, d)
        ).toBeNull();
    });

    it("the escape proceeds and is logged", () => {
        const d = deps(["in-progress"], ledger(claim(OTHER)));
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const r = checkClaimGate(
            5,
            "wt:new 5",
            { CLAUDE_CODE_SESSION_ID: ME, [UNCLAIMED_OK_ENV]: "1" },
            d
        );
        err.mockRestore();
        expect(r).toBeNull();
        expect(d.log).toHaveBeenCalledWith("wt:new 5", 5, ME, "foreign-owner");
    });

    it("an afk-pass job is outside the check", () => {
        const d = deps([], "");
        expect(
            checkClaimGate(5, "land:ready 9", { GITHUB_ACTIONS: "true" }, d)
        ).toBeNull();
    });
});
