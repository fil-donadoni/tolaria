// Storm count chip in the card preview (CR 702.40a; display only). Runs the
// REAL `buildPreviewBody` into the REAL `CardPreviewFace` (oracle paragraph +
// chip), never a hand-built content object.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CardPreviewFace from "../card-preview-face";
import { buildPreviewBody } from "~/lib/preview-body";
import { grizzlyBears } from "@convex/cards/sets/lea/index.cards";
import { grapeshot } from "@convex/cards/sets/tsp/index.cards";
import type { CardInstance, Player } from "~/types/game";

const STORM = grapeshot();

function player(id: string): Player {
    return {
        id,
        nickname: id,
        life: 20,
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        library: { count: 0 },
    } as unknown as Player;
}

function ctx(spellsCastThisTurn: number | undefined) {
    return {
        allPlayers: [player("p1"), player("p2")],
        playerId: "p1",
        spellsCastThisTurn,
    };
}

function stormInstance(overrides: Partial<CardInstance>): CardInstance {
    return {
        id: "storm-1",
        card: { id: STORM.id },
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        isTapped: false,
        types: STORM.types,
        subtypes: [],
        staticAbilities: STORM.staticAbilities ?? [],
        ...overrides,
    } as CardInstance;
}

function chipText(
    card: CardInstance,
    gameCtx: ReturnType<typeof ctx> | null
): string | null {
    const body = buildPreviewBody(card.card.id, card, gameCtx);
    const { container } = render(<CardPreviewFace {...body} size="md" />);
    return (
        container.querySelector('[data-ability-word="storm"]')?.textContent ??
        null
    );
}

describe("Storm count chip (CR 702.40a)", () => {
    beforeEach(() => cleanup());

    it("a storm card in hand shows the LIVE global tally", () => {
        expect(chipText(stormInstance({}), ctx(3))).toBe("3");
        cleanup();
        expect(chipText(stormInstance({}), ctx(4))).toBe("4");
    });

    it("no spell cast yet shows 0", () => {
        expect(chipText(stormInstance({}), ctx(undefined))).toBe("0");
    });

    it("a storm spell on the stack shows its cast-time tally, not the live one", () => {
        const onStack = stormInstance({
            zone: "stack",
            spellsCastBefore: 2,
        } as Partial<CardInstance>);
        expect(chipText(onStack, ctx(2))).toBe("2");
        cleanup();
        // Two more spells cast while it waits: the chip must not move.
        expect(chipText(onStack, ctx(4))).toBe("2");
    });

    it("a storm-created copy on the stack renders no chip (CR 707.10)", () => {
        const copy = stormInstance({ zone: "stack", isCopy: true });
        expect(chipText(copy, ctx(5))).toBeNull();
    });

    it("no game context (deck builder) renders the printed text, no chip", () => {
        const card = stormInstance({});
        const body = buildPreviewBody(card.card.id, card, null);
        const { container } = render(<CardPreviewFace {...body} size="md" />);
        expect(container.querySelector("[data-ability-word]")).toBeNull();
        expect(container.textContent).toContain(
            "copy it for each spell cast before it this turn"
        );
    });

    it("a runtime-granted storm (no printed storm text) chips the keyword row", () => {
        const bears = grizzlyBears();
        const card = {
            id: "bears-1",
            card: { id: bears.id },
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            isTapped: false,
            types: bears.types,
            subtypes: bears.subtypes ?? [],
            staticAbilities: ["storm"],
        } as unknown as CardInstance;
        expect(chipText(card, ctx(6))).toBe("6");
    });
});
