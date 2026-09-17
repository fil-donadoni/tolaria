// Catalogue-wide Splice declaration guard (CR 702.47, issue #2394).
//
// `gre/splice.ts` fails CLOSED on two shapes it cannot honour end to end: a
// spell whose body is not an Effect Script, and a splice card that announces
// targets (see that module's header for the CR reasoning on each). Failing
// closed is the right runtime behaviour — a half-honoured reveal would put text
// on a spell and then not run it — but on its own it is INVISIBLE: the card
// ships reading "Splice onto Arcane" and the option is simply never offered, in
// exactly the silent way a `planned` keyword ships inert (Guard A, issue #962).
//
// So the acceptance set is asserted here, once, over the whole catalogue. A
// future Arcane spell with an imperative body, or a targeting splice card
// (Glacial Ray), reds THIS file rather than shipping as a dead keyword — which
// makes the gap a scoping decision someone has to make, not a discovery someone
// has to happen upon.
//
// A new splice or Arcane card is picked up automatically: zero per-card
// authoring.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import {
    SPLICE_COST_ID_PREFIX,
    spliceAcceptsSpell,
    spliceCardIsSupported,
    spliceMergedEffects,
} from "../../gre/splice";
import { validateEffectScript } from "../../gre/effects/validate";

const allCards = getAllCards();
const spliceCards = allCards.filter((c) => c.splice !== undefined);
/** Every subtype some shipped card's splice ability is gated on ("Arcane"). */
const splicedOntoSubtypes = new Set(spliceCards.map((c) => c.splice!.subtype));

describe("Splice declarations (CR 702.47, issue #2394)", () => {
    it("the mechanic has at least one shipped card, so the guards below are not vacuous", () => {
        expect(spliceCards.map((c) => c.name)).toContain("Through the Breach");
    });

    it("every splice card's text is a shape a reveal can actually add (CR 702.47a/b)", () => {
        // CR 702.47a adds the card's RULES TEXT verbatim, which this engine
        // reads as its `effects`; CR 702.47b refuses the reveal when the
        // caster cannot make its choices, and the cast flow announces only the
        // MAIN spell's one `targetRequirement`. A card failing this would be
        // offered by nothing and do nothing.
        const bad = spliceCards
            .filter((c) => !spliceCardIsSupported(c))
            .map((c) => `${c.name} (${c.id})`);
        expect(
            bad,
            "splice cards whose text `gre/splice.ts` cannot add to a spell — see its header; a targeting splice card needs a heterogeneous target-slot list first"
        ).toEqual([]);
    });

    it("every spell a shipped splice ability names is a spell the merge can extend (CR 702.47c)", () => {
        // The other half of the pairing. A spell with the spliced-onto subtype
        // and an imperative body is one whose "Splice onto <subtype>" cards
        // silently offer nothing when it is cast.
        const bad = allCards
            .filter((c) =>
                (c.subtypes ?? []).some((s) => splicedOntoSubtypes.has(s))
            )
            .filter((c) => !spliceAcceptsSpell(c))
            .map((c) => `${c.name} (${c.id})`);
        expect(
            bad,
            `spells with a spliced-onto subtype (${[...splicedOntoSubtypes].join(", ")}) whose body is not an Effect Script — a reveal onto them would be offered by nothing`
        ).toEqual([]);
    });

    it("declares a real cost — a free reveal is a mis-declared card (CR 702.47a)", () => {
        const free = spliceCards
            .filter((c) => Object.keys(c.splice!.cost).length === 0)
            .map((c) => c.name);
        expect(free, "splice abilities with no cost at all").toEqual([]);
        const unlabelled = spliceCards
            .filter((c) => c.splice!.description.trim().length === 0)
            .map((c) => c.name);
        expect(
            unlabelled,
            "splice abilities with no dialog label — the caster would toggle a blank row"
        ).toEqual([]);
    });

    it("no card hand-authors a splice cost entry — they are SYNTHESIZED only", () => {
        // `keyword: "splice"` and `splicedCardId` on a `kickers[]` entry are
        // `enumerateSpliceOptions`' output, never a card's input: a declared
        // one would be validated and paid as a cost of the card DECLARING it,
        // which is the opposite of CR 702.47a (the cost prices a card revealed
        // from hand as a DIFFERENT spell is cast).
        const declared = allCards
            .filter((c) =>
                (c.kickers ?? []).some(
                    (k) =>
                        k.keyword === "splice" ||
                        k.splicedCardId !== undefined ||
                        k.id.startsWith(SPLICE_COST_ID_PREFIX)
                )
            )
            .map((c) => `${c.name} (${c.id})`);
        expect(
            declared,
            "cards declaring a splice cost entry by hand — declare `splice: { subtype, cost, description }` instead"
        ).toEqual([]);
    });

    it("every reachable MERGE validates — no duplicate binding in the spell the caster actually resolves", () => {
        // The merged script is synthesized, so no authoring-time sweep sees it:
        // `effectScripts.test.ts` validates each card's own `effects`, and the
        // one thing merging can break is the invariant `validateEffectScript`
        // states out loud — "binding names must be unique within a script …
        // the persisted store keys by name". `recallChoice` returns the FIRST
        // key matching a name, so a duplicate makes a later copy silently read
        // an earlier one's snapshot: the caster is prompted, answers, and
        // nothing happens. Proven over every pairing a board can reach —
        // every spliced-onto spell × up to two reveals of every splice card,
        // which is the shape (two copies of ONE card) that collides.
        const spells = allCards.filter(
            (c) =>
                (c.subtypes ?? []).some((t) => splicedOntoSubtypes.has(t)) &&
                spliceAcceptsSpell(c)
        );
        expect(spells.length).toBeGreaterThan(0);
        const failures: string[] = [];
        for (const spell of spells) {
            for (const card of spliceCards) {
                for (const reveals of [[card.id], [card.id, card.id]]) {
                    const merged = spliceMergedEffects(spell, reveals);
                    if (!merged) {
                        failures.push(
                            `${spell.name} + ${reveals.length}× ${card.name}: merged to nothing`
                        );
                        continue;
                    }
                    const errors = validateEffectScript({
                        id: `${spell.id}+splice`,
                        name: `${spell.name} + ${reveals.length}× ${card.name}`,
                        effects: merged,
                    } as Parameters<typeof validateEffectScript>[0]);
                    failures.push(...errors);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it("the splice ability's subtype is one the card's own type line could ever meet", () => {
        // CR 702.47a's "[quality]" is a subtype, and every printed splice card
        // is itself a spell of that subtype (Arcane) — the reveal and the cast
        // are two uses of one card. A splice card that is not itself of the
        // subtype it splices onto is not illegal by the CR, but it has never
        // been printed, so it is far more likely a typo in the subtype string.
        const mismatched = spliceCards
            .filter((c) => !(c.subtypes ?? []).includes(c.splice!.subtype))
            .map((c) => `${c.name}: splices onto ${c.splice!.subtype}`);
        expect(mismatched).toEqual([]);
    });
});
