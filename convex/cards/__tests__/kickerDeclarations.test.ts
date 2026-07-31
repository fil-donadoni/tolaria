// Catalogue-wide Kicker declaration guard (CR 702.33 / 702.33e, ADR 0079).
//
// Kicker went plural and leg-based in issue #1937: `CardDefinition.kickers` is an
// ARRAY of `CostLegs & { id, description, multi? }`, payment is recorded per id,
// and a DSL script reads one Kicker with `{ kickerPaid: "<id>" }`. Three failure
// modes that shape makes possible are SILENT at runtime, so they are guarded here
// once for the whole catalogue rather than per card:
//
//  1. **Duplicate / empty ids.** The payment record is keyed by id, so two
//     Kickers sharing one id collapse into a single entry — one of them becomes
//     unpayable and its intervening-if never fires. Nothing throws.
//  2. **A `{ kickerPaid: "<id>" }` naming no declared Kicker.** The value reads
//     FAIL-CLOSED (0) by design, so a typo makes the clause silently dead — the
//     card ships looking correct and simply never does the kicked thing. This is
//     the exact shape of the recurring "correct in the GRE, dead in play" bug,
//     and only a catalogue sweep can catch it.
//  3. **A leg the cast pipeline cannot pay.** `resolveKickerPayments` rejects an
//     energy leg and a mixed sacrifice/return composition at ANNOUNCEMENT — i.e.
//     only once a player tries to kick. Asserting it statically here means the
//     card never ships in that state.
//
// A new Kicker card is picked up automatically: zero per-card authoring.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
// The SHARED site enumeration (`effectSites.ts`) — not a second hand-rolled
// walker. A private one shipped omitting `modes[].effects` and `aiEffects`,
// which is exactly how a `{ kickerPaid }` inside a modal card's mode script
// would escape the fail-closed trap below.
import { allEffectScriptValues } from "./effectSites";
import type { KickerCost } from "../types";

const cardsWithKickers = getAllCards().filter(
    (c) => (c.kickers?.length ?? 0) > 0
);

/** Every `{ kickerPaid: "<id>" }` id reachable anywhere in a card's declaration —
 *  every site `allEffectScriptValues` enumerates (spell `effects`/`aiEffects`,
 *  activated / triggered / grant-template ability scripts, cast-time
 *  `modes[].effects`) and every nested structural construct within them (`if`
 *  branches, `forEach` bodies, `bind` values). Walks the raw JSON rather than
 *  the typed union so a value nested in a shape this test doesn't know about is
 *  still found. */
function kickerPaidIdsIn(value: unknown, out: Set<string>): void {
    if (Array.isArray(value)) {
        for (const v of value) kickerPaidIdsIn(v, out);
        return;
    }
    if (typeof value !== "object" || value === null) return;
    const rec = value as Record<string, unknown>;
    if (typeof rec.kickerPaid === "string") out.add(rec.kickerPaid);
    for (const v of Object.values(rec)) kickerPaidIdsIn(v, out);
}

function legCount(k: KickerCost): number {
    return [k.mana, k.permanent, k.life, k.hand, k.energy].filter(
        (l) => l !== undefined
    ).length;
}

describe("Kicker declarations (CR 702.33 / 702.33e, ADR 0079)", () => {
    it("the catalogue actually has kicker cards (guard is not vacuous)", () => {
        expect(cardsWithKickers.length).toBeGreaterThan(0);
    });

    it.each(cardsWithKickers.map((c) => [c.name ?? c.id, c] as const))(
        "%s — kicker ids are unique and non-empty",
        (_name, card) => {
            const ids = (card.kickers ?? []).map((k) => k.id);
            for (const id of ids) expect(id.length).toBeGreaterThan(0);
            expect(new Set(ids).size).toBe(ids.length);
        }
    );

    it.each(cardsWithKickers.map((c) => [c.name ?? c.id, c] as const))(
        "%s — every kicker has a description and at least one payable leg",
        (_name, card) => {
            for (const k of card.kickers ?? []) {
                expect(k.description.length).toBeGreaterThan(0);
                // CR 702.33a — an additional cost with no legs costs nothing, so
                // "kicking" it would be free: a declaration bug, never a card.
                expect(legCount(k)).toBeGreaterThan(0);
                // CR 122.1 — no cast-time energy payment step exists;
                // `resolveKickerPayments` rejects it, so it must never ship.
                expect(k.energy).toBeUndefined();
            }
        }
    );

    it.each(cardsWithKickers.map((c) => [c.name ?? c.id, c] as const))(
        "%s — a mana-only kicker's description matches its Oracle text",
        (_name, card) => {
            // The description is what the cast-cost dialog shows the caster, so
            // for the plain "Kicker {2}" / "Multikicker {2}" shape it must be the
            // Oracle wording verbatim — a drifted one mislabels the toggle (this
            // is how Everflowing Chalice's "Multikicker {2}" was caught reading
            // "Kicker {2}"). A NON-MANA leg has no Oracle prefix to match against
            // (its wording is prose), so only the mana-only case is asserted.
            //
            // "Kicker {A} and/or {B}" (two independently-payable Kickers on one
            // printed line, ADR 0079/#1937 — Stormscape Battlemage) joins BOTH
            // legs' wording into ONE Oracle sentence, so only the FIRST Kicker's
            // description is a strict PREFIX of the full Oracle text; a later
            // one's description is still checked, just as a substring anywhere
            // in that joined line — still catches a drifted/typo'd description
            // (it simply wouldn't appear in the Oracle text at all), while not
            // demanding an impossible second "starts with" on the same string.
            const oracle = card.oracleText ?? "";
            const manaOnlyKickers = (card.kickers ?? []).filter(
                (k) => legCount(k) === 1 && k.mana !== undefined
            );
            manaOnlyKickers.forEach((k, i) => {
                if (oracle.length === 0) return;
                if (i === 0) {
                    expect(oracle.startsWith(k.description)).toBe(true);
                } else {
                    expect(oracle.includes(k.description)).toBe(true);
                }
            });
        }
    );

    it.each(cardsWithKickers.map((c) => [c.name ?? c.id, c] as const))(
        "%s — permanent legs agree on one terminal action (one selection slot)",
        (_name, card) => {
            const actions = new Set(
                (card.kickers ?? [])
                    .map((k) => k.permanent?.action)
                    .filter((a) => a !== undefined)
            );
            expect(actions.size).toBeLessThanOrEqual(1);
        }
    );

    it.each(cardsWithKickers.map((c) => [c.name ?? c.id, c] as const))(
        "%s — every { kickerPaid } names a declared kicker (fail-closed trap)",
        (_name, card) => {
            const declared = new Set((card.kickers ?? []).map((k) => k.id));
            const referenced = new Set<string>();
            kickerPaidIdsIn(allEffectScriptValues(card), referenced);
            for (const id of referenced) expect(declared).toContain(id);
        }
    );

    it("no card outside `kickers` references a kicker by id", () => {
        // A `{ kickerPaid }` on a card with NO kickers always reads 0 — the
        // clause is dead. Catch it separately, since the per-card sweep above
        // only iterates cards that declare kickers.
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            if ((card.kickers?.length ?? 0) > 0) continue;
            const referenced = new Set<string>();
            kickerPaidIdsIn(allEffectScriptValues(card), referenced);
            if (referenced.size > 0) offenders.push(card.name ?? card.id);
        }
        expect(offenders).toEqual([]);
    });

    it("the trap reaches mode sites and aiEffects shadows (site enumeration is complete)", () => {
        // The sweep is only as good as its site list: a `{ kickerPaid }` hiding
        // in a modal card's `modes[].effects` or in an `aiEffects` shadow used
        // to walk right past it (the private walker this guard shipped with
        // knew only `effects` + activated/triggered abilities). Assert the
        // shared enumeration actually reaches both, so the sweep above cannot
        // go quietly vacuous over a whole site kind.
        const referenced = new Set<string>();
        kickerPaidIdsIn(
            allEffectScriptValues({
                id: "test:site-coverage",
                name: "Site Coverage Probe",
                rarity: "common",
                types: ["Instant"],
                manaCost: {},
                aiEffects: [
                    {
                        op: "if",
                        predicate: {
                            left: { kickerPaid: "from-ai-shadow" },
                            op: "ge",
                            right: 1,
                        },
                        then: [],
                    },
                ],
                modes: [
                    {
                        id: "m1",
                        label: "Mode",
                        oracleText: "Mode",
                        effects: [
                            {
                                op: "if",
                                predicate: {
                                    left: { kickerPaid: "from-mode" },
                                    op: "ge",
                                    right: 1,
                                },
                                then: [],
                            },
                        ],
                    },
                ],
            }),
            referenced
        );
        expect([...referenced].sort()).toEqual(["from-ai-shadow", "from-mode"]);
    });

    it("a card declaring kickedTargetRequirement also declares a kicker", () => {
        // CR 702.33 — the kicked target set is only reachable by kicking.
        const offenders = getAllCards()
            .filter(
                (c) =>
                    c.kickedTargetRequirement !== undefined &&
                    (c.kickers?.length ?? 0) === 0
            )
            .map((c) => c.name ?? c.id);
        expect(offenders).toEqual([]);
    });
});
