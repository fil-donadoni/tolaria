// Round-2 review finding on PR #2620 (issue #2595): the card-preview wire
// has two halves — the PRODUCER (`UserPreferencesEffect`'s
// `setPreviewPreferenceDefault` effect) and the CONSUMER
// (`CardPreviewBody`'s `useState(getPreviewPreferenceDefault)` lazy
// initializer, see `card-preview-body.test.tsx`). The consumer half is
// guarded; the producer half was not — deleting the
// `useEffect(() => setPreviewPreferenceDefault(previewPreference), [...])`
// block in `user-preferences-effect.tsx` left all 2029 tests green (only
// ESLint's unused-symbol rule noticed). This test joins both halves through
// the REAL modules (no hand-built view): mock the Convex row
// `UserPreferencesEffect` reads, mount it (its effect publishes into the
// real `~/lib/preview-preference-store`), THEN mount the real
// `CardPreviewBody` fresh and assert it opens on the seeded face. Breaking
// EITHER half reds this test — see the PR receipt for the proof-of-failure
// transcript on both.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import UserPreferencesEffect from "../user-preferences-effect";
import CardPreviewBody from "~/components/cards/card-preview-body";
import { resetPreviewPreferenceDefaultForTests } from "~/lib/preview-preference-store";
import type { PreviewBodyContent } from "~/lib/preview-body";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

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

beforeEach(() => {
    vi.clearAllMocks();
    useMutationMock.mockReturnValue(vi.fn());
    resetPreviewPreferenceDefaultForTests();
});

afterEach(cleanup);

describe("Settings preview default reaches CardPreviewBody end to end (issue #2595, PR #2620 round-2 review)", () => {
    it("a saved previewPreference of 'printed' seeds a freshly-mounted CardPreviewBody onto the printed face", () => {
        useQueryMock.mockReturnValue({
            density: "roomy",
            motion: "system",
            previewPreference: "printed",
        });
        // Mount the producer first — its effect publishes into the shared
        // store synchronously (RTL's `render` flushes effects via `act`).
        render(<UserPreferencesEffect />);

        // Mount the consumer fresh, AFTER the store has been published to —
        // this is the real router-root ordering (`UserPreferencesEffect`
        // mounts once, ahead of any board/card surface that later renders a
        // `CardPreviewBody`).
        const { container } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        const img = container.querySelector("img")!;
        expect(img.getAttribute("alt")).toBe(
            `${CONTENT.displayName} (printed)`
        );
    });

    it("a saved previewPreference of 'computed' seeds a freshly-mounted CardPreviewBody onto the computed face", () => {
        useQueryMock.mockReturnValue({
            density: "roomy",
            motion: "system",
            previewPreference: "computed",
        });
        render(<UserPreferencesEffect />);

        const { container } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        const img = container.querySelector("img")!;
        expect(img.getAttribute("alt")).toBe(CONTENT.cardName);
    });
});
