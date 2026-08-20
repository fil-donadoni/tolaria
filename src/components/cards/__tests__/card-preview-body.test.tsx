// The Card preview default Settings knob (issue #2595) is a SEED, not a live
// binding: `CardPreviewBody`'s initial Oracle/Printed toggle reads
// `~/lib/preview-preference-store` (published by `UserPreferencesEffect` at
// the router root) via a `useState` lazy initializer — once, at mount. Before
// this fix `toggledMode` was hard-coded to `useState("computed")`, so the
// Settings section persisted `previewPreference` to Convex but nothing ever
// read it back (review finding, PR #2620): breaking the wire under test
// (reverting to the hard-coded literal) reds every assertion below.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import CardPreviewBody from "../card-preview-body";
import type { PreviewBodyContent } from "~/lib/preview-body";
import {
    setPreviewPreferenceDefault,
    resetPreviewPreferenceDefaultForTests,
} from "~/lib/preview-preference-store";

const CONTENT: PreviewBodyContent = {
    cardName: "Lightning Bolt",
    displayName: "Lightning Bolt",
    imageSrc: "https://cards.scryfall.io/art/front/a/b/bolt.webp",
    imageFallbackSrc: "https://cards.scryfall.io/art_crop/front/a/b/bolt.jpg",
    printedImageSrc: "https://cards.scryfall.io/normal/front/a/b/bolt.jpg",
    types: ["Instant"],
    subtypes: [],
    staticAbilities: [],
    manaCost: "{R}",
    typeLine: "Instant",
    oracleParagraphs: ["Lightning Bolt deals 3 damage to any target."],
    bodyAbilities: { keywords: [], activated: [], triggered: [] },
    hasBody: false,
    hasPT: false,
    ptModified: false,
    counterDisplays: [],
    colorName: "Red",
    ownerName: null,
    attachedToName: null,
    milestones: null,
    isManualGame: false,
};

afterEach(cleanup);
beforeEach(resetPreviewPreferenceDefaultForTests);

describe("CardPreviewBody seeds its toggle from the saved preview default (issue #2595)", () => {
    it("opens on the computed (Oracle) face when no preference is saved", () => {
        const { container } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        // The computed face renders through CardPreviewFace, whose image alt
        // is the bare card name (no "(printed)" suffix — see
        // card-preview-face.tsx).
        const img = container.querySelector("img")!;
        expect(img.getAttribute("alt")).toBe(CONTENT.cardName);
    });

    it("opens on the printed face when the user's saved default is 'printed'", () => {
        setPreviewPreferenceDefault("printed");
        const { container } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        const img = container.querySelector("img")!;
        expect(img.getAttribute("alt")).toBe(
            `${CONTENT.displayName} (printed)`
        );
    });

    it("still lets the viewer toggle away from the seeded default", () => {
        setPreviewPreferenceDefault("printed");
        const { container, getByRole } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        fireEvent.click(getByRole("button", { name: /live text/i }));
        const img = container.querySelector("img")!;
        expect(img.getAttribute("alt")).toBe(CONTENT.cardName);
    });
});
