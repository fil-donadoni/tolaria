// Issue #5572 — the claim labels left on CLOSED issues are released, by a
// sweep `housekeeping` runs every run. The decision is pure; this pins it.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    CLAIM_LABEL,
    PR_OPEN_LABEL,
    closedClaimsToRelease,
    closedWithLabelArgs,
    releaseEditArgs,
} from "../lib/claim-labels";
import { CLOSED_CLAIMS_STEP } from "../housekeeping";

const issue = (number: number, ...names: string[]) => ({
    number,
    labels: names.map((name) => ({ name })),
});

describe("claims on closed issues (issue #5572)", () => {
    it("releases a closed issue still wearing in-progress or pr-open", () => {
        expect(
            closedClaimsToRelease([
                issue(5564, PR_OPEN_LABEL, "bug"),
                issue(5495, CLAIM_LABEL, "area:game-bot"),
                issue(5000, "bug"),
            ])
        ).toEqual([5495, 5564]);
    });

    it("lists an issue wearing both labels once", () => {
        // The sweep reads one list per label, so such an issue arrives twice.
        const both = issue(5163, CLAIM_LABEL, PR_OPEN_LABEL);
        expect(closedClaimsToRelease([both, both])).toEqual([5163]);
    });

    it("reads CLOSED issues, one label per read", () => {
        const args = closedWithLabelArgs(PR_OPEN_LABEL);
        expect(args.slice(0, 2)).toEqual(["issue", "list"]);
        expect(args[args.indexOf("--state") + 1]).toBe("closed");
        expect(args[args.indexOf("--label") + 1]).toBe(PR_OPEN_LABEL);
    });

    it("the release removes BOTH labels", () => {
        const args = releaseEditArgs(5564);
        const removed = args.flatMap((a, i) =>
            args[i - 1] === "--remove-label" ? [a] : []
        );
        expect(removed.sort()).toEqual([CLAIM_LABEL, PR_OPEN_LABEL].sort());
    });

    it("housekeeping's step runs a script that exists", () => {
        const script = CLOSED_CLAIMS_STEP.argv[1]!;
        expect(existsSync(join(__dirname, "..", "..", script))).toBe(true);
    });
});
