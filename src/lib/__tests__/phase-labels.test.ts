import { describe, expect, it } from "vitest";
import { PHASE_GROUPS, phaseGroupLabel, phaseLabel } from "~/lib/phase-labels";

describe("phase-labels (#331)", () => {
    it("maps every phase to a plain-language label", () => {
        expect(phaseLabel("DECLARE_ATTACKERS")).toBe("Declare Attackers");
        expect(phaseLabel("PRECOMBAT_MAIN")).toBe("Main Phase 1");
        expect(phaseLabel("COMBAT_DAMAGE")).toBe("Combat Damage");
    });

    it("falls back to a title-cased form for phases not in the table", () => {
        expect(phaseLabel("MULLIGAN" as never)).toBe("Mulligan");
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
