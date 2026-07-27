// Term-breakdown rendering, including the provenance line (issue #1612
// mandatory coverage: "component tests for the breakdown rendering, including
// the provenance line"). Assertions use plain `getByText`/DOM queries (not
// jest-dom's `toBeInTheDocument`/`toBeEmptyDOMElement` custom matchers) —
// `tsconfig.app.json`'s restricted `types` array doesn't pick up jest-dom's
// type augmentation, and `getByText` itself throws when nothing matches, so a
// bare call already proves presence.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import DraftLabTermBreakdown from "../draft-lab-term-breakdown";
import type { PickTerm } from "@convex/limited/botDrafter";

afterEach(cleanup);

describe("DraftLabTermBreakdown (issue #1612)", () => {
    it("renders every term with its value and its provenance sources", () => {
        const terms: PickTerm[] = [
            {
                term: "baseRating",
                value: 3.5,
                rawValue: 3.5,
                sources: [],
                note: "Pick Rating 3.50",
            },
            {
                term: "colourCommitment",
                value: 0.24,
                rawValue: 0.24,
                sources: [{ cardId: "island", reason: "shares {U}" }],
                note: "4 Pool card(s) already on {U}",
            },
        ];
        render(<DraftLabTermBreakdown terms={terms} />);

        expect(screen.getByText("baseRating")).not.toBeNull();
        expect(screen.getByText("+3.50")).not.toBeNull();
        expect(screen.getByText(/Pick Rating 3.50/)).not.toBeNull();

        expect(screen.getByText("colourCommitment")).not.toBeNull();
        expect(screen.getByText("+0.24")).not.toBeNull();
        expect(
            screen.getByText(/4 Pool card\(s\) already on \{U\}/)
        ).not.toBeNull();
        // the provenance line: the specific pool card + why it contributed
        expect(screen.getByText(/island \(shares \{U\}\)/)).not.toBeNull();
    });

    it("renders a negative term in the opponent-signal colour with a minus sign", () => {
        const terms: PickTerm[] = [
            {
                term: "curveFit",
                value: -0.5,
                rawValue: -0.5,
                sources: [],
                note: "hypothetical penalty term",
            },
        ];
        render(<DraftLabTermBreakdown terms={terms} />);
        const value = screen.getByText("-0.50");
        expect(value.className).toContain("text-signal-opponent");
    });

    it("renders a term with no provenance without a sources list", () => {
        const terms: PickTerm[] = [
            {
                term: "curveFit",
                value: 0,
                rawValue: 0,
                sources: [],
                note: "mana value 0 (land / free spell) — outside the curve model",
            },
        ];
        const { container } = render(<DraftLabTermBreakdown terms={terms} />);
        expect(screen.getByText("curveFit")).not.toBeNull();
        // No nested provenance <ul> when the term carries no sources.
        expect(container.querySelectorAll("ul ul").length).toBe(0);
    });

    it("renders a FUTURE, uncensused term generically — no hardcoded term list", () => {
        // The scorer's Capability term (PRD #1607 slice 4, issue #1611) isn't
        // wired into `convex/limited/botDrafter.ts` yet — this proves the
        // breakdown renders ANY term it's handed, so that term appears with
        // zero Draft Lab code change once it ships (issue #1612's
        // generic-rendering requirement, and the issue's own worked example:
        // "capabilityFit +0.8 ← provides value-on-death; required by Flash
        // (pick 4)").
        const terms = [
            {
                term: "capabilityFit",
                value: 0.8,
                rawValue: 0.8,
                sources: [
                    { cardId: "flash", reason: "requires value-on-death" },
                ],
                note: "provides value-on-death; required by Flash (pick 4)",
            },
        ] as unknown as PickTerm[];
        render(<DraftLabTermBreakdown terms={terms} />);
        expect(screen.getByText("capabilityFit")).not.toBeNull();
        expect(screen.getByText("+0.80")).not.toBeNull();
        expect(
            screen.getByText(
                /provides value-on-death; required by Flash \(pick 4\)/
            )
        ).not.toBeNull();
        expect(
            screen.getByText(/flash \(requires value-on-death\)/)
        ).not.toBeNull();
    });
});
