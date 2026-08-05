// Catalogue-wide guard: a CardDefinition's printed CHARACTERISTICS —
// supertypes, card types, subtypes, mana cost, and power/toughness — must
// match its source-of-truth entry in `data/json/<SET>.json` (MTGJSON).
//
// Motivating bug (PR #2047): Questing Phelddagrif (pls/multicolor.ts) shipped
// with `supertypes: ["Legendary"]`. It is NOT legendary — both
// `data/json/PLS.json` (`supertypes: []`) and Scryfall agree. The only
// existing definition/data-json comparison, `rarity.test.ts`, checks rarity
// ONLY, so a wrong type line on any other field (supertype, type, subtype,
// mana cost, P/T) sails through untested. This test widens the comparison to
// every characteristic MTGJSON records, catalogue-wide, on the "card id ==
// identifiers.scryfallId" join (a CardDefinition's `id` IS the home printing's
// Scryfall id — the invariant `check:index` enforces catalogue-wide against
// the lockfile).
//
// Scope: only sets that ship a vendored MTGJSON file under `data/json/` can
// be checked at all — a definition whose id isn't in ANY vendored file is
// silently skipped (its home set isn't vendored, not a conformance failure).
// Split/flip/adventure/meld cards are out of scope catalogue-wide (ADR
// 0010/0041) and are never registered as CardDefinitions in the first place,
// so they cannot appear here — see inv/white.ts's own "out of scope" note for
// Stand // Deliver / Wax // Wane.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getAllCards } from "../index";
import { manaCostsEqual } from "../../gre/constants";
import type { CardDefinition, ManaCost } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const jsonDir = join(here, "../../../data/json");

interface MtgJsonCard {
    identifiers?: { scryfallId?: string };
    name: string;
    types?: string[];
    supertypes?: string[];
    subtypes?: string[];
    manaCost?: string;
    power?: string;
    toughness?: string;
}

/** Every vendored MTGJSON set file, merged into one scryfallId → card map.
 *  A definition's `id` matches at most one entry across all files (each
 *  printing carries its own distinct scryfallId), so merging is safe. */
function loadAllMtgJsonCards(): Map<string, MtgJsonCard> {
    const map = new Map<string, MtgJsonCard>();
    const files = readdirSync(jsonDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
        const raw = readFileSync(join(jsonDir, file), "utf8");
        const parsed = JSON.parse(raw) as { data: { cards: MtgJsonCard[] } };
        for (const card of parsed.data.cards) {
            const id = card.identifiers?.scryfallId;
            if (id) map.set(id, card);
        }
    }
    return map;
}

/** Parses an MTGJSON printed mana-cost string (e.g. `"{1}{G}{W}{U}"`,
 *  `"{X}{X}{U}"`) into a `ManaCost`. None of the vendored sets (LEA–PLS era,
 *  pre-Ravnica/pre-New-Phyrexia) print hybrid or Phyrexian pips — verified
 *  empirically across every vendored file — so this parser only needs to
 *  handle plain colour pips, generic numerals, and `{X}`. Returns `undefined`
 *  on an unrecognized symbol so the caller can skip rather than false-fail. */
function parseMtgJsonManaCost(cost: string | undefined): ManaCost | undefined {
    if (!cost) return {};
    const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const result: ManaCost = {};
    let generic = 0;
    let xCount = 0;
    for (const sym of symbols) {
        if (sym === "X") {
            xCount += 1;
        } else if (/^\d+$/.test(sym)) {
            generic += Number(sym);
        } else if (
            sym === "W" ||
            sym === "U" ||
            sym === "B" ||
            sym === "R" ||
            sym === "G" ||
            sym === "C"
        ) {
            result[sym] = (result[sym] ?? 0) + 1;
        } else {
            // Hybrid/Phyrexian or otherwise unrecognized — bail, caller skips.
            return undefined;
        }
    }
    if (xCount > 0) {
        result.X = "X";
        if (xCount > 1) result.xFactor = xCount;
        if (generic > 0) result.generic = generic;
    } else if (generic > 0) {
        result.X = generic;
    }
    return result;
}

/** Parses an MTGJSON printed power/toughness field. Several vendored cards
 *  print a variable formula (`"*"`, `"2+*"`, `"7-*"` — Nightmare, Angry Mob,
 *  Shapeshifter, Dakkon Blackblade, …): the engine represents these via a
 *  computed/static effect, not a literal base number, so a formula string
 *  is NOT comparable to `CardDefinition.power/toughness` and must be
 *  skipped rather than compared. Returns `undefined` for both "absent" and
 *  "formula, not comparable". */
function parseFixedNumber(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!/^-?\d+$/.test(value)) return undefined;
    return Number(value);
}

function sameSet(
    a: readonly string[] | undefined,
    b: readonly string[] | undefined
): boolean {
    const as = new Set(a ?? []);
    const bs = new Set(b ?? []);
    if (as.size !== bs.size) return false;
    for (const v of as) if (!bs.has(v)) return false;
    return true;
}

interface Offender {
    name: string;
    id: string;
    field: string;
    expected: unknown;
    actual: unknown;
}

/** Narrow, per-(card,field) exemption — same shape and intent as
 *  `mechanicsRegistry.test.ts`'s `KEYWORD_ALLOWLIST`: a real card, a real
 *  divergence the JSON side gets wrong or that is a deliberate engine
 *  simplification, and a real open tracking issue. NOT a blanket escape
 *  hatch — every entry here should be closed out by its issue eventually. */
const CONFORMANCE_ALLOWLIST: ReadonlyArray<{
    readonly cardId: string;
    readonly field: string;
    readonly issue: number;
    readonly reason: string;
}> = [];

function isAllowlisted(cardId: string, field: string): boolean {
    return CONFORMANCE_ALLOWLIST.some(
        (a) => a.cardId === cardId && a.field === field
    );
}

describe("card definition conforms to data/json/<SET>.json (guard gap, PR #2047)", () => {
    const mtgJsonCards = loadAllMtgJsonCards();

    function collectOffenders(
        checkField: (
            card: CardDefinition,
            json: MtgJsonCard
        ) => { ok: boolean; expected: unknown; actual: unknown },
        field: string
    ): Offender[] {
        const offenders: Offender[] = [];
        for (const card of getAllCards()) {
            const json = mtgJsonCards.get(card.id);
            if (!json) continue; // home set not vendored — out of guard scope
            if (isAllowlisted(card.id, field)) continue;
            const { ok, expected, actual } = checkField(card, json);
            if (!ok) {
                offenders.push({
                    name: card.name,
                    id: card.id,
                    field,
                    expected,
                    actual,
                });
            }
        }
        return offenders;
    }

    it("supertypes match (Basic/Legendary/Ongoing/Snow/World)", () => {
        const offenders = collectOffenders((card, json) => {
            const expected = json.supertypes ?? [];
            const actual = card.supertypes ?? [];
            return { ok: sameSet(expected, actual), expected, actual };
        }, "supertypes");
        expect(
            offenders.map(
                (o) =>
                    `${o.name} (${o.id}): expected ${JSON.stringify(o.expected)}, got ${JSON.stringify(o.actual)}`
            )
        ).toEqual([]);
    });

    it("card types match", () => {
        const offenders = collectOffenders((card, json) => {
            const expected = json.types ?? [];
            const actual = card.types;
            return { ok: sameSet(expected, actual), expected, actual };
        }, "types");
        expect(
            offenders.map(
                (o) =>
                    `${o.name} (${o.id}): expected ${JSON.stringify(o.expected)}, got ${JSON.stringify(o.actual)}`
            )
        ).toEqual([]);
    });

    it("subtypes match", () => {
        const offenders = collectOffenders((card, json) => {
            const expected = json.subtypes ?? [];
            const actual = card.subtypes ?? [];
            return { ok: sameSet(expected, actual), expected, actual };
        }, "subtypes");
        expect(
            offenders.map(
                (o) =>
                    `${o.name} (${o.id}): expected ${JSON.stringify(o.expected)}, got ${JSON.stringify(o.actual)}`
            )
        ).toEqual([]);
    });

    it("mana cost matches (structural, CR 202)", () => {
        const offenders = collectOffenders((card, json) => {
            const expected = parseMtgJsonManaCost(json.manaCost);
            if (expected === undefined)
                return { ok: true, expected: undefined, actual: undefined }; // unparseable — skip, not a failure
            const actual = card.manaCost ?? {};
            return {
                ok: manaCostsEqual(expected, actual),
                expected: json.manaCost ?? "",
                actual,
            };
        }, "manaCost");
        expect(
            offenders.map(
                (o) =>
                    `${o.name} (${o.id}): expected ${JSON.stringify(o.expected)}, got ${JSON.stringify(o.actual)}`
            )
        ).toEqual([]);
    });

    it("power/toughness match (numeric only — variable-P/T formulas skipped)", () => {
        const offenders = collectOffenders((card, json) => {
            const expectedPower = parseFixedNumber(json.power);
            const expectedToughness = parseFixedNumber(json.toughness);
            // A formula ("*", "2+*", "7-*") isn't comparable to a base number —
            // skip the whole card rather than false-fail on it.
            if (
                (json.power !== undefined && expectedPower === undefined) ||
                (json.toughness !== undefined &&
                    expectedToughness === undefined)
            ) {
                return { ok: true, expected: undefined, actual: undefined };
            }
            const powerOk = expectedPower === card.power;
            const toughnessOk = expectedToughness === card.toughness;
            return {
                ok: powerOk && toughnessOk,
                expected: `${expectedPower ?? "-"}/${expectedToughness ?? "-"}`,
                actual: `${card.power ?? "-"}/${card.toughness ?? "-"}`,
            };
        }, "power/toughness");
        expect(
            offenders.map(
                (o) =>
                    `${o.name} (${o.id}): expected ${JSON.stringify(o.expected)}, got ${JSON.stringify(o.actual)}`
            )
        ).toEqual([]);
    });
});

describe("regression — Questing Phelddagrif is NOT legendary (PR #2047 fix)", () => {
    const QUESTING_PHELDDAGRIF_ID = "cea4cfef-6736-42a5-9f3e-10de8d0cd8d3"; // PLS 119

    it("carries no Legendary supertype", () => {
        const card = getAllCards().find(
            (c) => c.id === QUESTING_PHELDDAGRIF_ID
        );
        expect(card).toBeDefined();
        expect(card!.supertypes ?? []).not.toContain("Legendary");
    });

    it("matches data/json/PLS.json exactly (supertypes: [])", () => {
        const raw = readFileSync(join(jsonDir, "PLS.json"), "utf8");
        const parsed = JSON.parse(raw) as { data: { cards: MtgJsonCard[] } };
        const json = parsed.data.cards.find(
            (c) => c.identifiers?.scryfallId === QUESTING_PHELDDAGRIF_ID
        );
        expect(json).toBeDefined();
        expect(json!.supertypes ?? []).toEqual([]);

        const card = getAllCards().find(
            (c) => c.id === QUESTING_PHELDDAGRIF_ID
        )!;
        expect(card.supertypes ?? []).toEqual(json!.supertypes ?? []);
    });
});
