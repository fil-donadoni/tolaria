// The trigger-order picker's ability tile shows the source's art the way the
// board does (issue #4120): a token's trigger resolves the Token Print of the
// edition that made the token, off the Game-load rows.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { tokenDefinitionId } from "@convex/cards";
import type { TokenSpec } from "@convex/cards/types";
import { TokenPrintsContext } from "~/hooks/useTokenPrints";
import { indexTokenPrintRows } from "~/lib/tokenArt";
import StackAbilityTile from "../stack-ability-tile";

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
const TOKEN_PRINT = "22222222-2222-4222-8222-222222222222";
const rows = indexTokenPrintRows([
    {
        printId: CARD,
        cardId: CARD,
        tokenPrints: [{ name: "Elephant", tokenPrintId: TOKEN_PRINT }],
    },
]);

describe("StackAbilityTile art (issue #4120)", () => {
    beforeEach(() => cleanup());

    it("paints the edition's Token Print for a token's ability", () => {
        const { container } = render(
            <TokenPrintsContext value={rows}>
                <StackAbilityTile
                    cardId={DEF_ID}
                    abilityText="Do a thing."
                    kind="triggered"
                    source={{ sourcePrintId: CARD }}
                />
            </TokenPrintsContext>
        );
        expect(container.querySelector("img")?.getAttribute("src")).toContain(
            TOKEN_PRINT
        );
    });

    it("falls back to the placeholder with no source printing", () => {
        const { container } = render(
            <TokenPrintsContext value={rows}>
                <StackAbilityTile
                    cardId={DEF_ID}
                    abilityText="Do a thing."
                    kind="triggered"
                />
            </TokenPrintsContext>
        );
        expect(container.querySelector("img")).toBeNull();
    });
});
