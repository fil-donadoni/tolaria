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
import { getCardByName } from "@convex/cards";
import { buildPreviewBody, type PreviewBodyContent } from "~/lib/preview-body";
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
    // The id the printed face builds its RESPONSIVE srcset from (issue
    // #3553) — null together with `printedImageSrc` by construction, so a
    // fixture that sets one and not the other renders no printed face at all.
    printedImageId: {
        id: "ab000000-0000-0000-0000-000000000000",
        face: "front",
    },
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

// CR 715.2 (issue #3303) — the inset half reaches the DOM. `buildPreviewBody`'s
// own suite pins the derivation; what is asserted here is the half a player can
// actually READ, in the surface every preview host composes: before this, the
// live-text face of an adventurer card rendered only the creature half and the
// Adventure the player is being offered appeared nowhere.
describe("CardPreviewBody renders the inset half of a two-part frame (CR 715.2)", () => {
    const WITH_INSET: PreviewBodyContent = {
        ...CONTENT,
        cardName: "Brazen Borrower",
        displayName: "Brazen Borrower",
        typeLine: "Creature — Faerie Rogue",
        oracleParagraphs: ["Flash", "Flying"],
        insetHalf: {
            role: "inset",
            label: "Adventure",
            name: "Petty Theft",
            manaCost: "{1}{U}",
            typeLine: "Instant — Adventure",
            oracleParagraphs: [
                "Return target nonland permanent an opponent controls to its owner's hand.",
            ],
        },
    };

    it("prints the half's label, name, cost, type line and text", () => {
        const { container } = render(
            <CardPreviewBody {...WITH_INSET} size="sm" />
        );
        const text = container.textContent ?? "";
        expect(text).toContain("Adventure");
        expect(text).toContain("Petty Theft");
        expect(text).toContain("Instant — Adventure");
        // Mana costs render as symbol images (`formatOracleText`), so the cost
        // is asserted through their alts rather than through text content.
        const symbolAlts = Array.from(container.querySelectorAll("img")).map(
            (img) => img.getAttribute("alt")
        );
        expect(symbolAlts).toContain("{1}");
        expect(symbolAlts).toContain("{U}");
        expect(text).toContain("Return target nonland permanent");
        // The card's own half is still the primary block, not replaced.
        expect(text).toContain("Brazen Borrower");
        expect(text).toContain("Flying");
    });

    it("renders nothing extra for an ordinary card", () => {
        const { container } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        expect(container.textContent ?? "").not.toContain("Adventure");
    });
});

// CR 712 (issue #3552) — the back face reaches the DOM of the composition every
// preview host renders, built through the REAL `buildPreviewBody`, in both
// preview modes.
describe("CardPreviewBody renders the back face of a double-faced card (CR 712)", () => {
    const SINK = getCardByName("Sink into Stupor");
    const SERRA = getCardByName("Serra Angel");
    const backFace = (root: ParentNode) =>
        root.querySelector("[data-card-preview-back-face]");

    it("prints the back face's label, name, type line, text and BACK art without a click", () => {
        const { container } = render(
            <CardPreviewBody {...buildPreviewBody(SINK.id)} size="sm" />
        );
        const section = backFace(container);
        expect(section).toBeTruthy();
        const text = section!.textContent ?? "";
        expect(text).toContain("Back face");
        expect(text).toContain("Soporific Springs");
        expect(text).toContain("Land");
        expect(text).toContain("you may pay 3 life");
        const art = section!.querySelector(
            'img[alt="Soporific Springs"]'
        ) as HTMLImageElement;
        expect(art.src).toContain("/art/back/");
        expect(art.src).toContain(SINK.id);
        // The front block is still the primary face.
        expect(container.textContent).toContain("Sink into Stupor");
    });

    it("shows the printed BACK image beside the front in the printed mode", () => {
        setPreviewPreferenceDefault("printed");
        const { container } = render(
            <CardPreviewBody {...buildPreviewBody(SINK.id)} size="sm" />
        );
        const front = container.querySelector(
            'img[alt="Sink into Stupor (printed)"]'
        ) as HTMLImageElement;
        const back = container.querySelector(
            "img[data-card-preview-back-face-printed]"
        ) as HTMLImageElement;
        expect(front.src).toContain("/grid/front/");
        expect(back.src).toContain("/grid/back/");
        expect(back.src).toContain(SINK.id);
        expect(back.getAttribute("alt")).toBe(
            "Soporific Springs (printed back face)"
        );
    });

    it("renders a card with no back face exactly as a body without the field, in both modes", () => {
        const body = buildPreviewBody(SERRA.id);
        expect(body.backFaceHalf).toBeNull();
        const today: PreviewBodyContent = { ...body };
        delete today.backFaceHalf;
        for (const mode of ["computed", "printed"] as const) {
            setPreviewPreferenceDefault(mode);
            const withField = render(<CardPreviewBody {...body} size="sm" />)
                .container.innerHTML;
            cleanup();
            const withoutField = render(
                <CardPreviewBody {...today} size="sm" />
            ).container.innerHTML;
            cleanup();
            expect(withField).toBe(withoutField);
            expect(withField).not.toContain("data-card-preview-back-face");
            expect(withField).not.toContain("Back face");
        }
    });
});
