// CR 603.7a (issue #3383) — the value model's reader for a card's own
// `delayedTriggers[]` TEMPLATES. Until this reader the array was walked by no
// valuer at all: a real `effects[]` on a template scored exactly zero, so
// Mishra's Bauble — whose whole point is its delayed `draw` — priced as if the
// draw did not exist.
//
// Three things are pinned here, and the third is the one that keeps the reader
// honest as the catalogue grows:
//   1. the INCLUDED shape is valued, at exactly its body's own script value;
//   2. that value is the SAME one the inline `delayedTrigger` Op (ADR 0048)
//      would produce for the identical body — no discount for the wait on
//      either path, so a body prices the same however it was scheduled;
//   3. every `delayedTriggers[]` template in the WHOLE catalogue that carries
//      an `effects[]` is either included or excluded WITH A STATED REASON, and
//      a new one lands in neither list until someone classifies it.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../../../cards/index";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { dslAbilityScriptOpValue } from "../cardScriptValue";
import { contextFreeGrounding } from "../grounding";
import { valueEffectScript } from "../opValuers";

const CARDS = getAllCards();

function cardNamed(name: string): CardDefinition {
    const def = CARDS.find((c) => c.name === name);
    if (!def) throw new Error(`no catalogue card named ${name}`);
    return def;
}

/** The next-upkeep cantrip rider (CR 603.7d) — the shipped INCLUDED shape:
 *  a body with no scheduling-time capture, armed unconditionally by the
 *  card's own resolution (Clairvoyance, Portent, Mishra's Bauble) or by its
 *  tap-mana rider (Barbed Sextant, `armsDelayedTriggerOnTap`, ADR 0040). */
const NEXT_UPKEEP_DRAW: EffectOp[] = [
    { op: "draw", player: "controller", count: 1 },
];

// --- The classification, pinned over the whole catalogue --------------------

/** Why an `effects[]`-carrying template is valued, per card. */
const INCLUDED: Record<string, string> = {
    "Mishra's Bauble":
        "capture-free `draw` body; the activated ability's resolution arms it unconditionally",
    Clairvoyance: "capture-free `draw` body; the spell's resolution arms it",
    Portent: "capture-free `draw` body; the spell's resolution arms it",
    "Barbed Sextant":
        "capture-free `draw` body armed declaratively on every tap for mana (ADR 0040)",
};

/** …and why one is not. Every reason is a PREDICATE over the shape, never a
 *  per-card exemption (ADR 0102) — the string states which predicate fires. */
const EXCLUDED: Record<string, string> = {
    "Dragon Whelp":
        "body reads `$targetId` (its own creature); also armed only at the fourth activation",
    "Stone Giant":
        "body reads `$targetId` — `destroy` on the controller's OWN creature would price as opponent removal",
    "Krovikan Elementalist":
        "body reads `$targetId` — charges an optional ability's cost while its `resolve()` benefit stays unseen",
};

/** Every catalogue template carrying a real `effects[]`, as `card → body`. */
function templatesWithScript(): { card: CardDefinition; body: EffectOp[] }[] {
    const out: { card: CardDefinition; body: EffectOp[] }[] = [];
    for (const card of CARDS) {
        for (const template of card.delayedTriggers ?? []) {
            if (template.effects && template.effects.length > 0) {
                out.push({ card, body: template.effects });
            }
        }
    }
    return out;
}

describe("delayed-trigger TEMPLATE valuation (CR 603.7a, issue #3383)", () => {
    it("values an included template at exactly its body's own script value, on top of the card's abilities", () => {
        const bauble = cardNamed("Mishra's Bauble");
        const ctx = contextFreeGrounding();
        // The card's only ability is a `resolve()` (no script to walk), so the
        // WHOLE ability-script value is the template — which is precisely the
        // "worth 0 to the bot" case the issue reports.
        const body = valueEffectScript(NEXT_UPKEEP_DRAW, ctx);
        expect(dslAbilityScriptOpValue(bauble, ctx)).toEqual(body);
        expect(body.points).toBeGreaterThan(0);
    });

    it("prices a template body identically to the SAME body scheduled inline by the `delayedTrigger` Op (no discount on either path)", () => {
        const ctx = contextFreeGrounding();
        const viaTemplate = dslAbilityScriptOpValue(
            cardNamed("Mishra's Bauble"),
            ctx
        );
        // ADR 0048's inline path: the Op's valuer recurses straight into
        // `op.effects`, so an ability carrying it must reach the same number.
        const inline: CardDefinition = {
            id: "test-inline-delayed",
            name: "Test Inline Delayed",
            rarity: "common",
            manaCost: {},
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "test-inline-delayed-ability",
                    oracleText: "{T}: Draw a card at the next upkeep.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "delayedTrigger",
                            timing: "next-upkeep",
                            effects: NEXT_UPKEEP_DRAW,
                        },
                    ],
                },
            ],
        } as CardDefinition;
        expect(viaTemplate).toEqual(dslAbilityScriptOpValue(inline, ctx));
    });

    it("an excluded template contributes exactly 0 — the card's value is its abilities alone", () => {
        const ctx = contextFreeGrounding();
        // Capture-reading bodies: `destroy`/`sacrifice` on `$targetId`.
        // Stone Giant and Dragon Whelp have no ability script at all, so the
        // `undefined` ("no script anywhere") convention must survive.
        expect(dslAbilityScriptOpValue(cardNamed("Stone Giant"), ctx)).toBe(
            undefined
        );
        expect(dslAbilityScriptOpValue(cardNamed("Dragon Whelp"), ctx)).toBe(
            undefined
        );
        // Krovikan Elementalist HAS one scripted ability (its `pump`); the
        // excluded template must leave that value untouched rather than
        // charging the -40 self-sacrifice of an ability the bot never sees the
        // benefit of.
        const krovikan = cardNamed("Krovikan Elementalist");
        const pump = krovikan.activatedAbilities?.find((a) => a.effects);
        expect(pump?.effects).toBeDefined();
        expect(dslAbilityScriptOpValue(krovikan, ctx)).toEqual(
            valueEffectScript(pump!.effects!, ctx)
        );
    });

    it("a card with an `aiEffects` shadow keeps the shadow's number — the template is not summed on top", () => {
        const ctx = contextFreeGrounding();
        const shadowed: CardDefinition = {
            id: "test-shadowed-delayed",
            name: "Test Shadowed Delayed",
            rarity: "common",
            manaCost: {},
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "test-shadowed-ability",
                    oracleText: "{T}: Draw a card at the next upkeep.",
                    cost: { tap: true },
                    useStack: true,
                    resolve: () => {
                        /* schedules the template below */
                    },
                    // The author's stand-in for the WHOLE resolution, delayed
                    // half included (issue #1431).
                    aiEffects: NEXT_UPKEEP_DRAW,
                },
            ],
            delayedTriggers: [
                {
                    id: "test-shadowed-template",
                    oracleText:
                        "At the beginning of the next turn's upkeep, draw a card.",
                    timing: "next-upkeep",
                    effects: NEXT_UPKEEP_DRAW,
                },
            ],
        } as CardDefinition;
        expect(dslAbilityScriptOpValue(shadowed, ctx)).toEqual(
            valueEffectScript(NEXT_UPKEEP_DRAW, ctx)
        );
    });

    it("every catalogue template with an effects[] body is classified — a new one is neither included nor excluded until it is", () => {
        const seen = templatesWithScript().map((t) => t.card.name);
        const classified = [
            ...Object.keys(INCLUDED),
            ...Object.keys(EXCLUDED),
        ].sort();
        expect(
            [...new Set(seen)].sort(),
            "a delayedTriggers[] template gained an effects[] body and is unclassified — decide included/excluded in this file, with the predicate that decides it"
        ).toEqual(classified);
    });

    it("the classification matches what the reader actually does, card by card", () => {
        const ctx = contextFreeGrounding();
        for (const { card, body } of templatesWithScript()) {
            const bodyValue = valueEffectScript(body, ctx);
            const withTemplate = dslAbilityScriptOpValue(card, ctx);
            if (INCLUDED[card.name] !== undefined) {
                // The template's points are IN the card's ability-script value
                // (a card may carry other scripted abilities too, so this is a
                // lower bound, never an equality for the whole catalogue).
                expect(
                    withTemplate?.points ?? 0,
                    `${card.name} is classified included (${INCLUDED[card.name]}) but its template's ${bodyValue.points} points are missing`
                ).toBeGreaterThanOrEqual(bodyValue.points);
            } else {
                const abilitiesOnly = dslAbilityScriptOpValue(
                    { ...card, delayedTriggers: [] } as CardDefinition,
                    ctx
                );
                expect(
                    withTemplate,
                    `${card.name} is classified excluded (${EXCLUDED[card.name]}) but its template moved the card's value`
                ).toEqual(abilitiesOnly);
            }
        }
    });
});
