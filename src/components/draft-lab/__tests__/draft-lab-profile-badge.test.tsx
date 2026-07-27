// Unreviewed Card Profile badge (issue #1612: "surface unreviewed profiles
// visibly — an LLM-seeded row that has not been checked should be obvious
// while reading a pick"). Assertions use plain DOM queries, not jest-dom's
// custom matchers (see `draft-lab-term-breakdown.test.tsx`'s header comment).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import DraftLabProfileBadge from "../draft-lab-profile-badge";
import type {
    CardProfile,
    GetDbProfile,
} from "@convex/limited/cardProfilesCore";
import { buildDraftLabCardProfile } from "@/lib/limited/draftLabEngine";

afterEach(cleanup);

const unreviewedProfile: CardProfile = {
    archetypes: ["reanimator"],
    provides: ["reanimatable"],
    requires: [],
    reviewed: false,
};

const reviewedProfile: CardProfile = {
    ...unreviewedProfile,
    reviewed: true,
};

describe("DraftLabProfileBadge (issue #1612)", () => {
    it("renders an obvious badge for an unreviewed profile", () => {
        render(<DraftLabProfileBadge profile={unreviewedProfile} />);
        expect(screen.getByText(/unreviewed/i)).not.toBeNull();
    });

    it("renders nothing once the profile is reviewed", () => {
        const { container } = render(
            <DraftLabProfileBadge profile={reviewedProfile} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing when the card has no profile at all", () => {
        const { container } = render(<DraftLabProfileBadge profile={null} />);
        expect(container.firstChild).toBeNull();
    });

    // Pre-merge review (issue #1612 fixup): the ONLY coverage above hands a
    // hand-built `CardProfile` straight to the component — exactly the
    // "hand-built view masks a dropped field" shape the frontend-wiring rule
    // forbids. Nothing exercised the REAL production path,
    // `buildDraftLabCardProfile` (`src/lib/limited/draftLabEngine.ts`),
    // which is what a live `useDraftLab.ts` actually calls. This test drives
    // the badge through that real layering function with a fake DB-read
    // closure standing in for a live `useQuery` result — proving the
    // DB-row -> seed -> null layering the blocking finding required actually
    // reaches the badge, not just that the badge itself renders correctly in
    // isolation.
    it("renders the unreviewed badge from a real DB-layer row via buildDraftLabCardProfile", () => {
        const packSlots = ["lea"];
        const fakeDbRead: GetDbProfile = (scope, cardId) =>
            scope === "lea" && cardId === "lightning-bolt"
                ? {
                      archetypes: ["burn"],
                      provides: ["removal"],
                      requires: [],
                      reviewed: false,
                  }
                : null;
        const getCardProfile = buildDraftLabCardProfile(packSlots, fakeDbRead);

        render(
            <DraftLabProfileBadge profile={getCardProfile("lightning-bolt")} />
        );
        expect(screen.getByText(/unreviewed/i)).not.toBeNull();
    });

    it("renders nothing when buildDraftLabCardProfile's DB layer has no row for the card", () => {
        const packSlots = ["lea"];
        const getCardProfile = buildDraftLabCardProfile(packSlots, () => null);

        const { container } = render(
            <DraftLabProfileBadge profile={getCardProfile("counterspell")} />
        );
        expect(container.firstChild).toBeNull();
    });
});
