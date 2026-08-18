// Catalogue guard — `ReplacementEffect.appliesFromAnyZone` is meaningful
// ONLY for `eventKind: "graveyard-bound"` (CR 614.1a self-referential "would
// be put into a graveyard from anywhere ... instead" clauses, issue #2106).
//
// `collectReplacements` (`gre/replacements.ts`) only ever reads
// `appliesFromAnyZone` inside its `kind === "graveyard-bound"` zone-agnostic
// self-lookup — an effect that set the flag on any OTHER `eventKind` (e.g.
// `"damage"`, `"draw"`) would be silently inert: no code path consults the
// flag for a non-graveyard-bound event, so the card author's intent is
// dropped with no error, no warning, and no test failure until someone
// notices the effect never fires (round 1 review, #2106).
//
// This sweep is the "explicit guard" the review asked for, cheaper than a
// discriminated-union rewrite of `ReplacementEffect` (which would touch every
// one of the catalogue's `replacementEffects[]` construction sites): it
// fails CI the moment a future card sets `appliesFromAnyZone: true` on a
// non-`"graveyard-bound"` effect, catching the mistake at definition time
// instead of leaving it to silently do nothing.
import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";

describe("ReplacementEffect.appliesFromAnyZone catalogue guard (issue #2106)", () => {
    it("is set only on graveyard-bound replacement effects", () => {
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            for (const effect of card.replacementEffects ?? []) {
                if (
                    effect.appliesFromAnyZone &&
                    effect.eventKind !== "graveyard-bound"
                ) {
                    offenders.push(
                        `${card.name} (${card.id}) — replacementEffects["${effect.id}"] sets appliesFromAnyZone on eventKind "${effect.eventKind}"`
                    );
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
