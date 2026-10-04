// A token shows the Token Print of the edition that created it (ADR 0140 §4,
// issue #4120): `CardImage` resolves its art off the instance's
// `sourcePrintId` and the Game-load rows in `TokenPrintsContext`, with an
// explicit `imagePrintId` still winning and the placeholder as the last link.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { tokenDefinitionId } from "@convex/cards";
import type { TokenSpec } from "@convex/cards/types";
import type { CardInstance } from "~/types/game";
import { TokenPrintsContext } from "~/hooks/useTokenPrints";
import { indexTokenPrintRows } from "~/lib/tokenArt";

vi.mock("../card-preview", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CardImage from "../card-image";

const SPEC: TokenSpec = {
    name: "Elephant",
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 3,
    toughness: 3,
    colors: ["G"],
};
const DEF_ID = tokenDefinitionId(SPEC);

const CARD = "429a88cc-53db-4c5e-a061-f0f49a38c675";
const ODYSSEY = "11111111-1111-4111-8111-111111111111";
const ODYSSEY_TOKEN = "22222222-2222-4222-8222-222222222222";
const DEFAULT_TOKEN = "33333333-3333-4333-8333-333333333333";

const INDEX = indexTokenPrintRows([
    {
        printId: CARD,
        cardId: CARD,
        tokenPrints: [{ name: "Elephant", tokenPrintId: DEFAULT_TOKEN }],
    },
    {
        printId: ODYSSEY,
        cardId: CARD,
        tokenPrints: [{ name: "Elephant", tokenPrintId: ODYSSEY_TOKEN }],
    },
]);

function token(extra: Partial<CardInstance>): CardInstance {
    return {
        id: "token-1",
        isToken: true,
        card: { id: DEF_ID },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: ["Elephant"],
        staticAbilities: [],
        isTapped: false,
        ...extra,
    } as CardInstance;
}

function renderWithRows(instance: CardInstance, rows = INDEX) {
    return render(
        <TokenPrintsContext value={rows}>
            <CardImage card={instance} />
        </TokenPrintsContext>
    );
}

describe("CardImage token art (issue #4120)", () => {
    beforeEach(() => cleanup());

    it("paints the Token Print of the edition that created the token", () => {
        const { container } = renderWithRows(token({ sourcePrintId: ODYSSEY }));
        expect(container.querySelector("img")?.getAttribute("src")).toContain(
            ODYSSEY_TOKEN
        );
    });

    it("an unpinned source (its Card ID) paints the definition printing's Token Print", () => {
        const { container } = renderWithRows(token({ sourcePrintId: CARD }));
        expect(container.querySelector("img")?.getAttribute("src")).toContain(
            DEFAULT_TOKEN
        );
    });

    it("an explicit instance `imagePrintId` still wins over the edition", () => {
        const { container } = renderWithRows(
            token({ sourcePrintId: ODYSSEY, imagePrintId: DEFAULT_TOKEN })
        );
        expect(container.querySelector("img")?.getAttribute("src")).toContain(
            DEFAULT_TOKEN
        );
    });

    it("renders the placeholder, not a broken fetch, until the rows say otherwise", () => {
        const { container } = render(
            <CardImage card={token({ sourcePrintId: ODYSSEY })} />
        );
        expect(container.querySelector("img")).toBeNull();
    });

    it("renders the placeholder when the creating printing has no such Token Print", () => {
        const { container } = renderWithRows(
            token({ sourcePrintId: "44444444-4444-4444-8444-444444444444" })
        );
        expect(container.querySelector("img")).toBeNull();
    });
});
