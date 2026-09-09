// #2919 — the alt-cost picker (Bestow/Dash/Evoke CR 118.9) must render the
// same {X} mana-symbol icons every other cast-time picker uses, not the raw
// oracle-text braces.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

    // CR 601.3c / 118.9b (issue #3280) — paying the PRINTED cost is one of the
    // picker's options, and off the caster's sorcery window under a board cast
    // permission (Aluren) it is an ILLEGAL one. The row used to be rendered
    // unconditionally, so a legal-looking click was a guaranteed `announceCast`
    // rejection.
    it('omits the "Pay mana cost" row when the printed-cost cast is not available', () => {
        const altCosts: AlternativeCost[] = [
            { id: "cast-permission:x", description: "Cast with Aluren" },
            { id: "evoke", description: "Evoke" },
        ];
        render(
            <AltCostPicker
                altCosts={altCosts}
                printedCostAvailable={false}
                cardName="Test Card"
                position={{ x: 0, y: 0 }}
                onSelect={() => {}}
                onCancel={() => {}}
            />
        );
        expect(
            screen.queryByRole("button", { name: "Pay mana cost" })
        ).toBeNull();
        // The alternatives themselves are untouched.
        expect(
            screen.getByRole("button", { name: /Cast with Aluren/ })
        ).toBeTruthy();
    });

    it("keeps the row when the printed-cost cast IS available", () => {
        const altCosts: AlternativeCost[] = [
            { id: "evoke", description: "Evoke" },
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
        expect(
            screen.getByRole("button", { name: "Pay mana cost" })
        ).toBeTruthy();
    });
});
