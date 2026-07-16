// Catalogue guard — modal spells pick their mode at CAST, not resolution
// (issue #1274, CR 601.2b–c / 700.2c).
//
// The bug this guard freezes out: a "Choose one —" / "Choose two —" modal spell
// (CR 700.2) implemented as a card-level `resolve()` / `resolveSteps` closure
// that picks its mode at RESOLUTION via `ctx.requestOptionChoice(...)`. That
// lets the spell go on the stack with no announced mode or target, so the
// opponent can't respond with full information (the Vision Charm bug). The fix
// is the cast-time `modes` / `SpellMode` framework: the mode is locked and the
// chosen mode's target announced BEFORE the spell hits the stack.
//
// A catalogue audit (issue #1274) confirmed Vision Charm was the ONLY card with
// this shape; every other `requestOptionChoice` call site is a legitimate
// resolution-time sub-choice (land/basic-land type — CR 608.2, colour, a
// number/count, a yes/no "may", a mana split, or a controlled foreign spell's
// cast decisions), which correctly stays as-is.
//
// This guard encodes the invariant catalogue-wide so a regression (re-adding a
// resolution-time mode pick to a modal spell) fails CI: every card whose oracle
// text is a CR 700.2 modal MUST resolve its mode declaratively — the cast-time
// `modes` framework, or the `optionChoice` DSL Op in `effects[]` (the accepted
// same-target modal, explicitly out of scope for #1274) — never a bare
// card-level `resolve()` / `resolveSteps`.

import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import type { CardDefinition } from "../types";

/** A CR 700.2 modal spell is one whose oracle text OPENS with a "Choose one —"
 *  / "Choose two —" / "Choose one or more —" (etc.) instruction. Matching the
 *  first line only avoids false positives from an activated/triggered ability
 *  that happens to contain "choose one" lower in the text. */
function isModalSpell(card: CardDefinition): boolean {
    if (!card.oracleText) return false;
    const firstLine = card.oracleText.split("\n")[0].trim();
    return /^Choose (one|two|three|one or more|two or more)\b/.test(firstLine);
}

describe("modal spells choose their mode at cast (issue #1274, CR 601.2b–c / 700.2)", () => {
    const modalCards = getAllCards().filter(isModalSpell);

    it("finds the known modal spells (sanity — the catalogue isn't empty)", () => {
        const names = modalCards.map((c) => c.name);
        expect(names).toContain("Vision Charm");
        expect(names).toContain("Pyroblast");
        expect(modalCards.length).toBeGreaterThan(5);
    });

    it("no modal spell picks its mode via a resolution-time closure — it uses `modes` or the `optionChoice` DSL Op", () => {
        const offenders = modalCards.filter((c) => {
            const hasModes = Array.isArray(c.modes) && c.modes.length > 0;
            const hasEffects = Array.isArray(c.effects) && c.effects.length > 0;
            // A modal spell resolved declaratively (cast-time modes, or the
            // optionChoice DSL Op in effects) is fine. A bare card-level
            // resolve()/resolveSteps on a modal spell IS the bug — its only way
            // to branch on a mode is a resolution-time requestOptionChoice.
            return !hasModes && !hasEffects;
        });
        expect(
            offenders.map((c) => c.name),
            "modal spells must declare `modes` (cast-time, CR 601.2c) or use the optionChoice DSL Op — never a card-level resolve() that picks the mode at resolution"
        ).toEqual([]);
    });

    it("every `modes`-framework modal spell ships a per-mode oracle line + stable id for the stack display (CR 700.2c)", () => {
        for (const card of modalCards) {
            if (!card.modes || card.modes.length === 0) continue;
            const ids = new Set<string>();
            for (const mode of card.modes) {
                expect(mode.id, `${card.name} mode id`).toBeTruthy();
                expect(ids.has(mode.id), `${card.name} duplicate mode id`).toBe(
                    false
                );
                ids.add(mode.id);
                expect(
                    mode.oracleText,
                    `${card.name} mode "${mode.id}" oracleText`
                ).toBeTruthy();
            }
        }
    });

    it("Vision Charm specifically is migrated off the resolution-time mode pick (the #1274 fix)", () => {
        const vc = modalCards.find((c) => c.name === "Vision Charm")!;
        expect(vc.resolve).toBeUndefined();
        expect(vc.resolveSteps).toBeUndefined();
        expect(vc.modes?.map((m) => m.id)).toEqual([
            "mill",
            "land-type",
            "phase",
        ]);
    });
});
