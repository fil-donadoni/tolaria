// #2919 — the alt-cost picker (Bestow/Dash/Evoke CR 118.9) must render the
// same {X} mana-symbol icons every other cast-time picker uses, not the raw
// oracle-text braces.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { AlternativeCost } from "@convex/cards/types";
import AltCostPicker from "../alt-cost-picker";

describe("AltCostPicker (#2919, CR 118.9)", () => {
    beforeEach(() => cleanup());

    it("renders a {X} mana symbol in the description as an icon, not raw braces", () => {
        const altCosts: AlternativeCost[] = [
            { id: "dash", description: "Dash {1}{G}" },
        ];
        render(
            <AltCostPicker
                altCosts={altCosts}
                printedCostAvailable
                cardName="Test Card"
                position={{ x: 0, y: 0 }}
                onSelect={() => {}}
                onCancel={() => {}}
            />
        );
        const img = document.body.querySelector(
            'img[src="/img/symbols/G.svg"]'
        );
        expect(img).not.toBeNull();
        expect(document.body.textContent).not.toContain("{G}");
    });
});
