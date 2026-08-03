// Printed-line ordering (CR 100.6): activated/triggered ability rows must
// render in the card's OWN printed oracle-text order, not a fixed
// activated-then-triggered block order. Skyship Weatherlight (PLS) prints its
// ETB search trigger BEFORE its {4},{T} activated ability — a fixed block
// order swapped them in the preview.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { DisplayAbilities } from "~/lib/card-utils";
import CardPreviewAbilities from "../card-preview-abilities";

afterEach(cleanup);

describe("CardPreviewAbilities — printed-line order", () => {
    it("renders the triggered row before the activated row when its order is lower", () => {
        const abilities: DisplayAbilities = {
            keywords: [],
            activated: [
                {
                    id: "act",
                    oracleText: "{4}, {T}: Choose a card at random.",
                    state: "native",
                    order: 1,
                },
            ],
            triggered: [
                {
                    id: "tr",
                    oracleText: "When this enters, search your library.",
                    state: "native",
                    order: 0,
                },
            ],
        };
        const { container } = render(
            <CardPreviewAbilities abilities={abilities} />
        );
        const text = container.textContent ?? "";
        expect(text.indexOf("search your library")).toBeLessThan(
            text.indexOf("Choose a card at random")
        );
    });

    it("falls back to activated-then-triggered when no order is present (legacy/grant rows)", () => {
        const abilities: DisplayAbilities = {
            keywords: [],
            activated: [
                {
                    id: "act",
                    oracleText: "{T}: activated text",
                    state: "native",
                },
            ],
            triggered: [
                {
                    id: "tr",
                    oracleText: "When ..., triggered text",
                    state: "native",
                },
            ],
        };
        const { container } = render(
            <CardPreviewAbilities abilities={abilities} />
        );
        const text = container.textContent ?? "";
        expect(text.indexOf("activated text")).toBeLessThan(
            text.indexOf("triggered text")
        );
    });
});
