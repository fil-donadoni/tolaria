// #2919 — defensive fix: the additional-cost picker (CR 601.2b) routes its
// leg label through the same oracle-text symbol converter as every other
// cast-time picker, so a future leg with a mana amount doesn't regress to
// raw {X} braces.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { AdditionalCostLeg } from "@convex/cards/types";
import AdditionalCostPicker from "../additional-cost-picker";

describe("AdditionalCostPicker (#2919, CR 601.2b)", () => {
    beforeEach(() => cleanup());

    it("renders a {X} mana symbol in the label as an icon, not raw braces", () => {
        const legs: AdditionalCostLeg[] = [
            { id: "pay-mana", label: "Pay {2}{R}" },
        ];
        render(
            <AdditionalCostPicker
                legs={legs}
                cardName="Test Card"
                position={{ x: 0, y: 0 }}
                onSelect={() => {}}
                onCancel={() => {}}
            />
        );
        const img = document.body.querySelector(
            'img[src="/img/symbols/R.svg"]'
        );
        expect(img).not.toBeNull();
        expect(document.body.textContent).not.toContain("{R}");
    });
});
