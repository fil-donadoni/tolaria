import { describe, expect, it } from "vitest";
import {
    COMBAT_PHASES,
    PHASE_GROUPS,
    phaseCompact,
    phaseGroupLabel,
    phaseGroupShort,
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

    it("derives a 3-letter group abbreviation from phaseGroupLabel for EVERY phase, not a hardcoded table (#1818 review fixup)", () => {
        // Ties phaseGroupShort's output DIRECTLY to phaseGroupLabel's (first
        // 3 letters, uppercased) for every phase in the catalogue, rather
        // than asserting a hand-maintained parallel table of expected
        // strings that could silently drift from the real derivation.
        const allSteps = PHASE_GROUPS.flatMap((g) => g.steps);
        for (const step of allSteps) {
            const expected = phaseGroupLabel(step.id)
                .replace(/[^A-Za-z]/g, "")
                .slice(0, 3)
                .toUpperCase();
            expect(phaseGroupShort(step.id)).toBe(expected);
        }

        // All six combat sub-steps share the same group short code — the
        // caption's job is "which broad group", not step disambiguation
        // (phaseCompact/phaseShort already own that).
        for (const step of [
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
        ] as const) {
            expect(phaseGroupShort(step)).toBe("COM");
        }
        // Main 1 and Main 2 share a group short (the digit is stripped by the
        // letters-only slice) — again, phaseCompact ("MAIN 1"/"MAIN 2") is
        // what disambiguates them, not this caption.
        expect(phaseGroupShort("PRECOMBAT_MAIN")).toBe("MAI");
        expect(phaseGroupShort("POSTCOMBAT_MAIN")).toBe("MAI");
        // Every group short is exactly 3 uppercase letters — the char/px
        // budget the portrait bottom bar's Phase tab caption relies on.
        for (const group of PHASE_GROUPS) {
            const short = phaseGroupShort(group.steps[0].id);
            expect(short).toMatch(/^[A-Z]{3}$/);
        }
    });

    it("maps every phase to a readable step word (compact), ≤7 chars and pairwise distinct (#1818 review fixup)", () => {
        expect(phaseCompact("DECLARE_ATTACKERS")).toBe("ATTACK");
        expect(phaseCompact("DECLARE_BLOCKERS")).toBe("BLOCK");
        expect(phaseCompact("FIRST_STRIKE_DAMAGE")).toBe("1ST DMG");
        expect(phaseCompact("COMBAT_DAMAGE")).toBe("DAMAGE");
        expect(phaseCompact("BEGINNING_OF_COMBAT")).toBe("BEGIN");
        expect(phaseCompact("END_OF_COMBAT")).toBe("END CMB");
        expect(phaseCompact("PRECOMBAT_MAIN")).toBe("MAIN 1");
        expect(phaseCompact("POSTCOMBAT_MAIN")).toBe("MAIN 2");
        expect(phaseCompact("END_STEP")).toBe("END");
        expect(phaseCompact("CLEANUP")).toBe("CLEANUP");

        const allSteps = PHASE_GROUPS.flatMap((g) => g.steps);
        const compacts = allSteps.map((s) => phaseCompact(s.id));
        // The tab's 12px value-row char/px budget once the Flag glyph was
        // dropped (~7 chars @320px — see `controller-phase-tab.tsx`'s doc
        // comment).
        for (const compact of compacts) {
            expect(compact.length).toBeLessThanOrEqual(7);
        }
        // Every phase's step word is pairwise distinct — a player must be
        // able to tell any two phases apart from the value row alone.
        expect(new Set(compacts).size).toBe(compacts.length);
    });

    it("falls back to a 7-char uppercased label for a compact word not in the table", () => {
        expect(phaseCompact("MULLIGAN" as never)).toBe("MULLIGA");
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

    // CR 500.8 (issue #2886) — `COMBAT_PHASES` is DERIVED from the Combat
    // group's own steps, so it cannot drift from the rail; the derivation
    // reads the group by its display label and would silently produce an
    // EMPTY set if that label were ever renamed, which is what this pins.
    it("COMBAT_PHASES is exactly the combat group's steps, and non-empty", () => {
        const combatGroup = PHASE_GROUPS.find((g) => g.label === "Combat");
        expect(combatGroup).toBeDefined();
        expect(COMBAT_PHASES.size).toBe(combatGroup!.steps.length);
        expect(COMBAT_PHASES.size).toBeGreaterThan(0);
        for (const step of combatGroup!.steps) {
            expect(COMBAT_PHASES.has(step.id)).toBe(true);
        }
        expect(COMBAT_PHASES.has("POSTCOMBAT_MAIN")).toBe(false);
        expect(COMBAT_PHASES.has("PRECOMBAT_MAIN")).toBe(false);
    });
});
