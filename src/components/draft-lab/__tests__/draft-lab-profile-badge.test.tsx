// Unreviewed Card Profile badge (issue #1612: "surface unreviewed profiles
// visibly — an LLM-seeded row that has not been checked should be obvious
// while reading a pick"). Assertions use plain DOM queries, not jest-dom's
// custom matchers (see `draft-lab-term-breakdown.test.tsx`'s header comment).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import DraftLabProfileBadge from "../draft-lab-profile-badge";
import type { CardProfile } from "@convex/limited/cardProfiles";

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
});
