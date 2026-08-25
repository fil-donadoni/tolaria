// Catalogue guard: every CR 614 damage replacement declares which CR chapter it
// belongs to (issue #2231).
//
// The anti-prevention / anti-redirection locks (CR 615.12 / 614.9) suppress a
// damage replacement by CLASS, not wholesale — a prevention lock must still let
// a redirect redirect, and neither lock touches an amount rewrite that never
// says "prevent". That classification is a judgment about the card's Oracle
// text (CR 615.1a: "effects that use the word prevent are prevention effects")
// which nothing in the code can infer: `{ kind: "consumed" }` is returned by
// prevention AND by nothing else, while an amount rewrite is used by prevention
// (Rock Hydra's counter-scaled partial) AND by effects that are neither (Divine
// Presence's clamp).
//
// So it is a REQUIRED authored field, and this sweep is what makes it required:
// a new `eventKind: "damage"` replacement that forgets it fails here rather
// than failing open (unclassified is treated as suppressed at runtime, which is
// the conservative side but is not a substitute for classifying it).

import { describe, expect, it } from "vitest";
import { getAllCards } from "../index";
import type { DamageEffectKind } from "../types";

const VALID: readonly DamageEffectKind[] = [
    "prevention",
    "redirection",
    "other",
];

/** Every `eventKind: "damage"` replacement in the shipped catalogue, keyed by
 *  card name + effect id so a failure names the card to fix. */
function allDamageReplacements() {
    const out: {
        card: string;
        effectId: string;
        kind: DamageEffectKind | undefined;
    }[] = [];
    for (const card of getAllCards()) {
        for (const r of card.replacementEffects ?? []) {
            if (r.eventKind !== "damage") continue;
            out.push({
                card: card.name,
                effectId: r.id,
                kind: r.damageEffectKind,
            });
        }
    }
    return out;
}

describe("damage replacement classification (CR 614.9 / 615.1a, issue #2231)", () => {
    it("the catalogue actually contains damage replacements to classify", () => {
        // Guards the guard: an import/registry regression that emptied
        // `getAllCards()` would make every assertion below vacuously pass.
        expect(allDamageReplacements().length).toBeGreaterThan(15);
    });

    it("every damage replacement declares a damageEffectKind", () => {
        const missing = allDamageReplacements()
            .filter((r) => r.kind === undefined)
            .map((r) => `${r.card} (${r.effectId})`);
        expect(missing).toEqual([]);
    });

    it("every declared damageEffectKind is a known class", () => {
        const bad = allDamageReplacements()
            .filter((r) => r.kind !== undefined && !VALID.includes(r.kind))
            .map((r) => `${r.card} (${r.effectId}): ${r.kind}`);
        expect(bad).toEqual([]);
    });

    it("a card whose Oracle text says 'prevent' is classified as prevention", () => {
        // CR 615.1a is the dividing line, and it is mechanically checkable in
        // one direction: an effect whose own `oracleText` uses the word
        // "prevent" IS a prevention effect. (The converse is not checkable —
        // "deals … instead" appears in both redirection and `"other"`.)
        const wrong: string[] = [];
        for (const card of getAllCards()) {
            for (const r of card.replacementEffects ?? []) {
                if (r.eventKind !== "damage") continue;
                if (!/\bprevent\b/i.test(r.oracleText)) continue;
                if (r.damageEffectKind !== "prevention") {
                    wrong.push(
                        `${card.name} (${r.id}): says "prevent" but is ${r.damageEffectKind}`
                    );
                }
            }
        }
        expect(wrong).toEqual([]);
    });
});
