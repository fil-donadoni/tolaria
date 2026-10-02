import { describe, it, expect } from "vitest";
import { pickResumeBranch } from "../lib/issue-worktree";

/**
 * `wt:new N --resume` (issue #4763): the worktree of a STRANDED claim is the
 * dead pass's own branch, never a fresh one from base.
 */
describe("pickResumeBranch (issue #4763)", () => {
    it("prefers the LOCAL branch — a dead pass can leave commits it never pushed", () => {
        expect(
            pickResumeBranch(
                4761,
                ["staging", "feat/issue-4761"],
                ["feat/issue-4761"]
            )
        ).toEqual({ branch: "feat/issue-4761", from: "local" });
    });

    it("falls back to the remote branch, fix/ as well as feat/", () => {
        expect(pickResumeBranch(4506, ["staging"], ["fix/issue-4506"])).toEqual(
            { branch: "fix/issue-4506", from: "remote" }
        );
    });

    it("matches the whole issue number, never a prefix of another one", () => {
        expect(
            pickResumeBranch(450, ["feat/issue-4506"], ["fix/issue-4506"])
        ).toBeNull();
    });
});
