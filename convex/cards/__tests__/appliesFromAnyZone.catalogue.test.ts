// Catalogue guard — `ReplacementEffect.appliesFromAnyZone` is meaningful
// ONLY for the event kinds in `SELF_LOOKUP_EVENT_KINDS`: `"graveyard-bound"`
// (CR 614.1a self-referential "would be put into a graveyard from anywhere ...
// instead" clauses, issue #2106) and `"discard"` (a card's own "if … causes you
// to discard this card … instead", read from the hand — issue #3814).
//
// `collectReplacements` (`gre/replacements.ts`) only ever reads
// `appliesFromAnyZone` inside its zone-agnostic self-lookup for those kinds —
// an effect that set the flag on any OTHER `eventKind` (e.g.
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
import { SELF_LOOKUP_EVENT_KINDS } from "../../gre/replacements";

describe("ReplacementEffect.appliesFromAnyZone catalogue guard (issue #2106)", () => {
    it("is set only on graveyard-bound / discard replacement effects", () => {
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            for (const effect of card.replacementEffects ?? []) {
                if (
                    effect.appliesFromAnyZone &&
                    !SELF_LOOKUP_EVENT_KINDS.has(effect.eventKind)
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
