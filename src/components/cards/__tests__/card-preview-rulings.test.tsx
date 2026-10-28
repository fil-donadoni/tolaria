// Issue #4816 — the Rulings entry of the card preview toggle: gated on the
// print id the preview holds (never the definition id), zero network until
// selected, loading / loaded / empty / error + Retry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import CardPreviewBody from "../card-preview-body";
import { buildPreviewBody, type PreviewBodyContent } from "~/lib/preview-body";
import { resetPreviewPreferenceDefaultForTests } from "~/lib/preview-preference-store";
import { resetRulingsCacheForTests } from "~/lib/scryfallRulings";
import { getCardByName } from "@convex/cards";
import type { CardInstance } from "~/types/game";

const PRINT = "ab000000-0000-0000-0000-000000000000";
const CONTENT: PreviewBodyContent = {
    cardName: "Lightning Bolt",
    displayName: "Lightning Bolt",
    imageSrc: "https://cards.scryfall.io/art/front/a/b/bolt.webp",
    imageFallbackSrc: "https://cards.scryfall.io/art_crop/front/a/b/bolt.jpg",
    printedImageSrc: "https://cards.scryfall.io/normal/front/a/b/bolt.jpg",
    printedImageId: { id: PRINT, face: "front" },
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
    abilityWordCounters: null,
    isManualGame: false,
};

const BODY = {
    data: [
        { source: "wotc", published_at: "2019-01-01", comment: "Pay {R}." },
        { source: "scryfall", published_at: "2020-02-02", comment: "Note." },
    ],
};

function pick(container: HTMLElement) {
    fireEvent.click(container.querySelector('[data-preview-mode="rulings"]')!);
}

beforeEach(() => {
    resetPreviewPreferenceDefaultForTests();
    resetRulingsCacheForTests();
    localStorage.clear();
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("Rulings entry (issue #4816)", () => {
    it("makes zero requests until the entry is selected, then lists rulings", async () => {
        const f = vi.fn<(url: string) => Promise<unknown>>(async () => ({
            ok: true,
            status: 200,
            json: async () => BODY,
        }));
        vi.stubGlobal("fetch", f);
        const { container, findByText, getByText } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        expect(f).not.toHaveBeenCalled();
        pick(container);
        await findByText("Wizards");
        expect(f).toHaveBeenCalledTimes(1);
        expect(f.mock.calls[0][0]).toContain(`/cards/${PRINT}/rulings`);
        expect(getByText("Scryfall note")).toBeTruthy();
        expect(getByText("2019-01-01")).toBeTruthy();
        expect(container.querySelector('img[src$="R.svg"]')).toBeTruthy();
    });

    it("renders the empty state", async () => {
        vi.stubGlobal("fetch", async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
        }));
        const { container, findByText } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        pick(container);
        expect(await findByText("No rulings for this card.")).toBeTruthy();
    });

    it("renders error + Retry with no automatic retry", async () => {
        const f = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 429 })
            .mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => BODY,
            });
        vi.stubGlobal("fetch", f);
        const { container, findByText } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        pick(container);
        await findByText(/Rulings unavailable/);
        expect(f).toHaveBeenCalledTimes(1);
        fireEvent.click(await findByText("Retry"));
        await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
        await findByText("Wizards");
    });

    it("has no entry without a printedImageId (face-down anonymous face)", () => {
        const { container } = render(
            <CardPreviewBody {...CONTENT} printedImageId={null} size="sm" />
        );
        expect(
            container.querySelector('[data-preview-mode="rulings"]')
        ).toBeNull();
    });

    it("has no entry on a token", () => {
        const SERRA = getCardByName("Serra Angel");
        const card = {
            id: "i1",
            card: { id: SERRA.id },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isToken: true,
            types: SERRA.types,
            subtypes: SERRA.subtypes ?? [],
            staticAbilities: SERRA.staticAbilities ?? [],
        } as unknown as CardInstance;
        const body = buildPreviewBody(SERRA.id, card);
        const { container } = render(
            <CardPreviewBody
                {...body}
                printedImageSrc="x"
                printedImageId={{ id: PRINT, face: "front" }}
                size="sm"
            />
        );
        expect(
            container.querySelector('[data-preview-mode="printed"]')
        ).toBeTruthy();
        expect(
            container.querySelector('[data-preview-mode="rulings"]')
        ).toBeNull();
    });

    it("has the entry when the print id is present", () => {
        const { container } = render(
            <CardPreviewBody {...CONTENT} size="sm" />
        );
        expect(
            container.querySelector('[data-preview-mode="rulings"]')
        ).toBeTruthy();
    });
});
