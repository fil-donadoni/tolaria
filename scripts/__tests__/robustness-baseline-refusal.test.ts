import { describe, expect, it } from "vitest";
import { closingIssueRefs } from "../lib/health-cadence";
import { robustnessBaselineRefusal } from "../lib/robustness-baseline-refusal";

// Issue #4980: PR #4933 closed issue #4917 — the owner of the "Discard
// sorcery" baseline row — and left the row; the next health run went RED on
// "is robust now — delete its baseline row". `land` now refuses that shape.
const DISCARD = {
    label: "Discard sorcery with a sacrifice cost: casts it into a full hand",
    issue: 4917,
};
const GRAPESHOT = {
    label: "storm: Grapeshot is lethal because the search counts the spell cast before it",
    issue: 4893,
};

function refusal(rows: (typeof DISCARD)[], body: string): string | null {
    return robustnessBaselineRefusal(rows, closingIssueRefs(body));
}

describe("robustnessBaselineRefusal", () => {
    it("refuses PR #4933's shape: closes a row's owner, row still in the tree", () => {
        const reason = refusal(
            [DISCARD, GRAPESHOT],
            "Bot: tree walk and rollout answer a mandatory discard\n\nCloses #4917"
        );
        expect(reason).toContain(DISCARD.label);
        expect(reason).toContain("issue #4917");
        expect(reason).not.toContain(GRAPESHOT.label);
    });

    it("names every row whose owner the PR closes", () => {
        const reason = refusal(
            [DISCARD, GRAPESHOT],
            "Fixes #4917, closes #4893"
        );
        expect(reason).toContain(DISCARD.label);
        expect(reason).toContain(GRAPESHOT.label);
    });

    it("proceeds once the row is deleted", () => {
        expect(refusal([GRAPESHOT], "Closes #4917")).toBeNull();
    });

    it("proceeds once the row is re-pointed to its next owner", () => {
        expect(
            refusal([{ ...DISCARD, issue: 5001 }], "Closes #4917")
        ).toBeNull();
    });

    it("proceeds for a PR that closes no owner, or only mentions one", () => {
        expect(refusal([DISCARD], "Closes #4980")).toBeNull();
        expect(refusal([DISCARD], "Follow-up of issue #4917")).toBeNull();
    });
});
