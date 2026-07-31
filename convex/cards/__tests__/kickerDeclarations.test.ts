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

// Minimal, LOCAL mana-cost -> symbol-string serializer (generic + WUBRG pips
// only — every Kicker cost in the catalogue today is one of those two
// shapes: "{2}", "{1}{U}", "{G}"). Deliberately NOT a reuse of the frontend's
// full `manaCostToString` (`src/lib/card-utils.ts`) — this is a `convex/`
// test, and the project boundary is one-directional (the frontend may import
// pure `convex/gre`/`convex/limited` modules per ADR 0074; the reverse never
// happens). If a Kicker cost ever needs Phyrexian/hybrid/X pips this helper
// will need extending — an unhandled shape falls through to an incomplete
// string and fails the comparison below loudly, never a silent pass.
function manaCostToString(mana: KickerCost["mana"]): string {
    if (!mana) return "";
    const parts: string[] = [];
    const generic = typeof mana.X === "number" ? mana.X : 0;
    if (generic > 0) parts.push(`{${generic}}`);
    for (const c of ["W", "U", "B", "R", "G"] as const) {
        const n = mana[c] ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${c}}`);
    }
    return parts.join("");
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
        "%s — kicker description matches its own cost, an Oracle prefix anchor catches a forgotten leg, and multi matches the Oracle label (issue #962 Everflowing Chalice class)",
        (_name, card) => {
            const oracle = card.oracleText ?? "";
            const kickers = card.kickers ?? [];
            if (kickers.length === 0) return;

            // 2. Oracle PREFIX anchor on the FIRST declared Kicker. Runs
            // regardless of leg shape (mana or not) — Magma Burst's
            // "Kicker—Sacrifice two lands" needs this exactly as much as a
            // mana-only leg. This is what catches a FORGOTTEN leg: a card
            // whose real Oracle is "Kicker {1}{B} and/or {G} (…)" but that
            // declares only ONE Kicker (`{ description: "Kicker {G}", mana:
            // { G: 1 } }`, the {1}{B} leg dropped) passes an exact
            // cost<->description check (its lone entry is internally
            // consistent) — the Oracle does NOT start with "Kicker {G}", so
            // this anchor is what actually fails.
            if (oracle.length > 0) {
                expect(oracle.startsWith(kickers[0].description)).toBe(true);
            }

            kickers.forEach((k) => {
                // 1. Exact description <-> cost restatement for a mana-only
                // leg — a drifted one mislabels the cast-cost dialog's
                // toggle (this is how Everflowing Chalice's "Multikicker
                // {2}" was caught reading "Kicker {2}"). A NON-MANA leg has
                // no fixed cost string to compare against (its wording is
                // prose), so only the mana-only case is asserted here.
                if (legCount(k) === 1 && k.mana !== undefined) {
                    expect(k.description).toBe(
                        `${k.multi ? "Multikicker" : "Kicker"} ${manaCostToString(k.mana)}`
                    );
                }
            });

            // 3. `multi` cross-check, newline-tolerant (CR 702.33e — `multi`
            // is what actually makes a Kicker repeatable; check 1 above
            // derives its expected LABEL from `k.multi` itself, so it can
            // never catch `multi` being wrong in the first place). A card
            // printed "Multikicker {2}" but declared with `multi` omitted
            // (or vice versa) is the Everflowing Chalice bug class this
            // guard exists to prevent. Restricted to a SINGLE-Kicker card —
            // no printed "and/or" card has ever paired Multikicker with a
            // second Kicker, so a two-Kicker Oracle line never reads
            // "Multikicker" and this assertion would be vacuous there.
            if (kickers.length === 1 && oracle.length > 0) {
                expect(kickers[0].multi === true).toBe(
                    /(^|\n)Multikicker\b/.test(oracle)
                );
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
