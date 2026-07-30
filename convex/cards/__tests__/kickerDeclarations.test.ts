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
import type { CardDefinition, EffectOp, KickerCost } from "../types";

const cardsWithKickers = getAllCards().filter(
    (c) => (c.kickers?.length ?? 0) > 0
);

/** Every `{ kickerPaid: "<id>" }` id reachable anywhere in a card's declaration —
 *  spell `effects`, activated / triggered ability `effects`, and every nested
 *  structural construct (`if` branches, `forEach` bodies, `bind` values). Walks
 *  the raw JSON rather than the typed union so a value nested in a shape this
 *  test doesn't know about is still found. */
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

function allEffectSites(card: CardDefinition): unknown[] {
    const sites: unknown[] = [];
    const push = (e: EffectOp[] | undefined) => {
        if (e) sites.push(e);
    };
    push(card.effects);
    for (const a of card.activatedAbilities ?? []) push(a.effects);
    for (const t of card.triggeredAbilities ?? []) push(t.effects);
    return sites;
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
            const oracle = card.oracleText ?? "";
            for (const k of card.kickers ?? []) {
                if (legCount(k) !== 1 || k.mana === undefined) continue;
                if (oracle.length === 0) continue;
                expect(oracle.startsWith(k.description)).toBe(true);
            }
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
            kickerPaidIdsIn(allEffectSites(card), referenced);
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
            kickerPaidIdsIn(allEffectSites(card), referenced);
            if (referenced.size > 0) offenders.push(card.name ?? card.id);
        }
        expect(offenders).toEqual([]);
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
