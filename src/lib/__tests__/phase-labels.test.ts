import { describe, expect, it } from "vitest";
import {
    PHASE_GROUPS,
    phaseGroupLabel,
    phaseLabel,
    phaseShort,
} from "~/lib/phase-labels";

describe("phase-labels (#331)", () => {
    it("maps every phase to a plain-language label", () => {
        expect(phaseLabel("DECLARE_ATTACKERS")).toBe("Declare Attackers");
        expect(phaseLabel("PRECOMBAT_MAIN")).toBe("Main Phase 1");
        expect(phaseLabel("COMBAT_DAMAGE")).toBe("Combat Damage");
    });

    it("falls back to a title-cased form for phases not in the table", () => {
        expect(phaseLabel("MULLIGAN" as never)).toBe("Mulligan");
    });

    it("maps every phase to its two-letter short code, distinguishing Main 1/2 and every combat sub-step (#1815 review fixup round 3)", () => {
        expect(phaseShort("PRECOMBAT_MAIN")).toBe("M1");
        expect(phaseShort("POSTCOMBAT_MAIN")).toBe("M2");
        expect(phaseShort("BEGINNING_OF_COMBAT")).toBe("BC");
        expect(phaseShort("DECLARE_ATTACKERS")).toBe("DA");
        expect(phaseShort("DECLARE_BLOCKERS")).toBe("DB");
        expect(phaseShort("FIRST_STRIKE_DAMAGE")).toBe("FD");
        expect(phaseShort("COMBAT_DAMAGE")).toBe("CD");
        expect(phaseShort("END_OF_COMBAT")).toBe("EC");
        // Main 1 vs Main 2 and all six combat sub-steps are pairwise distinct.
        const codes = [
            "PRECOMBAT_MAIN",
            "POSTCOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
        ].map((p) => phaseShort(p as never));
        expect(new Set(codes).size).toBe(codes.length);
    });

    it("falls back to the first two letters (uppercased) for a short code not in the table", () => {
        expect(phaseShort("MULLIGAN" as never)).toBe("MU");
    });

    it("groups combat steps under the Combat group", () => {
        expect(phaseGroupLabel("DECLARE_BLOCKERS")).toBe("Combat");
        expect(phaseGroupLabel("UPKEEP")).toBe("Beginning");
        expect(phaseGroupLabel("END_STEP")).toBe("Ending");
    });

    it("covers all turn phases across its groups", () => {
        const ids = PHASE_GROUPS.flatMap((g) => g.steps.map((s) => s.id));
        for (const id of [
            "UNTAP",
            "UPKEEP",
            "DRAW",
            "PRECOMBAT_MAIN",
            "DECLARE_ATTACKERS",
            "COMBAT_DAMAGE",
            "POSTCOMBAT_MAIN",
            "END_STEP",
            "CLEANUP",
        ] as const) {
            expect(ids).toContain(id);
        }
    });
});
