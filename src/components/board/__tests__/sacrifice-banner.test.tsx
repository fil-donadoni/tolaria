// Attack-declaration land tax prompt (CR 508.1c/1g / 701.21a — Flooded
// Woodlands). The declaration suspends server-side on
// combat.pendingAttackSacrifice; without this banner the board looks frozen
// because the cost has no on-screen explanation. The banner must name the
// outstanding sacrifice and surface the imposing card's oracle text.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { SacrificeSelection } from "~/types/game";

import SacrificeBanner from "../sacrifice-banner";

afterEach(cleanup);

function selection(over: Partial<SacrificeSelection> = {}): SacrificeSelection {
    return {
        playerId: "me",
        reason: "Green creatures can't attack unless their controller sacrifices a land",
        requirements: [{ filter: { types: "Land" }, count: 1 }],
        picked: [],
        ...over,
    };
}

describe("SacrificeBanner (CR 508.1c/1g attack tax)", () => {
    it("names the outstanding sacrifice so the board doesn't look frozen", () => {
        render(<SacrificeBanner selection={selection()} />);
        expect(screen.getByText("Attack cost")).toBeTruthy();
        expect(screen.getByText("sacrifice a land to attack")).toBeTruthy();
    });

    it("surfaces the imposing card's oracle text as the explanation", () => {
        render(<SacrificeBanner selection={selection()} />);
        expect(screen.getByText(/Green creatures can't attack/)).toBeTruthy();
    });

    it("shows progress when more than one land is owed (multi-attacker tax)", () => {
        render(
            <SacrificeBanner
                selection={selection({
                    requirements: [{ filter: { types: "Land" }, count: 2 }],
                    picked: ["land1"],
                })}
            />
        );
        expect(
            screen.getByText("sacrifice a land (1/2) to attack")
        ).toBeTruthy();
    });
});
