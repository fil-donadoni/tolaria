// CR 613.1e layer 5 — a card whose CURRENT colours differ from its printed
// ones (`colorOverride` / `grantedColors`) is ringed in its colour wherever it
// is drawn, and in the card preview (issue #7459).
//
// Since issue #7208 an every-zone colour grant (Painter's Servant) writes
// `grantedColors` onto hand, library, graveyard and exile cards too, so the
// ring is drawn by `CardImage` — the one face every zone renders — and by the
// preview over its art, never by a per-surface copy.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { getCardByName } from "@convex/cards";
import { makeInstance } from "@convex/cards/__tests__/setup.helper";
import { turnFaceDown } from "@convex/gre/faceDown";
import type { CardInstance } from "~/types/game";
import { buildPreviewBody } from "~/lib/preview-body";
import CardPreviewFace from "../card-preview-face";

vi.mock("../card-preview", () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
}));

import CardImage from "../card-image";
import { NO_BOARD_LAYER_VIEW } from "../../../../convex/gre/layers";

afterEach(cleanup);

const BOLT = getCardByName("Lightning Bolt");

function bolt(zone: string, granted?: string[]): CardInstance {
    return makeInstance(BOLT.id, {
        id: `bolt-${zone}`,
        controllerId: "p1",
        ownerId: "p1",
        zone: zone as never,
        ...(granted
            ? {
                  grantedColors: granted.map((color) => ({
                      color,
                      sourceId: "painter",
                  })),
              }
            : {}),
    }) as unknown as CardInstance;
}

const ringOf = (container: HTMLElement) =>
    container.querySelector<HTMLElement>("[data-color-ring]");

describe("layer-5 colour ring on the card face (CR 613.1e)", () => {
    for (const zone of ["hand", "graveyard", "exile", "stack", "battlefield"]) {
        it(`rings a granted colour on a card in the ${zone}`, () => {
            const { container } = render(
                <CardImage card={bolt(zone, ["U"])} />
            );
            expect(ringOf(container)?.dataset.colorRing).toBe("Red / Blue");
        });
    }

    it("draws no ring on a card still in its printed colours", () => {
        const { container } = render(<CardImage card={bolt("hand")} />);
        expect(ringOf(container)).toBeNull();
    });

    it("draws no ring on a face-down card — its face shows nothing of the hidden card (CR 708.2)", () => {
        const card = bolt("exile", ["U"]);
        turnFaceDown(NO_BOARD_LAYER_VIEW, card as never, "morph");
        const { container } = render(<CardImage card={card} />);
        expect(ringOf(container)).toBeNull();
    });
});

describe("layer-5 colour ring in the card preview (CR 613.1e)", () => {
    it("rings the preview art and names the colours for a granted card", () => {
        const card = bolt("hand", ["U"]);
        const body = buildPreviewBody(BOLT.id, card, undefined, BOLT.name);
        const { container, getByText } = render(
            <CardPreviewFace {...body} size="sm" />
        );
        const ring = ringOf(container)!;
        expect(ring.dataset.colorRing).toBe("Red / Blue");
        // The art crop is not a card: square corners.
        expect(ring.className).not.toContain("card-corner");
        expect(getByText("Color: Red / Blue")).toBeTruthy();
    });

    it("draws no preview ring for a card in its printed colours", () => {
        const body = buildPreviewBody(
            BOLT.id,
            bolt("hand"),
            undefined,
            BOLT.name
        );
        const { container } = render(<CardPreviewFace {...body} size="sm" />);
        expect(ringOf(container)).toBeNull();
    });
});
