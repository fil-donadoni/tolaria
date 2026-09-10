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
// Flip and meld cards are out of scope catalogue-wide (ADR 0041) and are
// never registered as CardDefinitions in the first place, so they cannot
// appear here.
//
// SPLIT left that bucket with ADR 0121 (issue #3307), and it is the one shape
// this join cannot take at face value: MTGJSON records one ROW PER FACE, and
// both rows of Stand // Deliver carry the SAME `identifiers.scryfallId`
// (one card, one printing, CR 709.2). Comparing the combined definition
// against whichever row won the map would fail on `manaCost` by construction
// — CR 709.4b says the card's cost is the SUM, and no printed face carries
// the sum. So a split card is compared HALF BY HALF, each half against the
// face row of the same name, through the very twin definitions the engine
// puts on the stack (CR 709.3b). The combined fields get their own guard
// below: they must equal `defineSplitCard`'s derivation, which is the only
// thing allowed to write them.
//
// ADVENTURE left that bucket with ADR 0120 (issue #3302): an adventurer card
// IS one `CardDefinition`, with its inset half on `insetSpell`, so Brazen
// Borrower can and does reach this comparison. It compares CLEANLY because
// CR 715.4 makes the card's characteristics in every zone but the stack the
// FRONT face's, which is what this definition's `types`/`subtypes`/`manaCost`/
// P/T carry — MTGJSON records the same face for the same reason. The inset
// half is not compared here at all: its characteristics belong to an object
// that exists only on the stack (CR 715.3b), and the twin definition that
// carries them is registry-only, never in `getAllCards()`.
//
// This is scoped, not vacuous: ELD is not among the vendored `data/json/` sets
// today, so Brazen Borrower is SKIPPED by the join below like every other
// non-vendored card. The comment states the rule that will hold the day ELD is
// vendored, rather than a claim about registration that stopped being true.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getAllCards } from "../index";
import { manaCostsEqual } from "../../gre/constants";
import type { CardDefinition, ManaCost } from "../types";
import {
    combineSplitManaCosts,
    combineSplitNames,
    combineSplitTypes,
    SPLIT_HALF_SIDES,
    splitHalfTwinDefinition,
} from "../splitCard";

const here = dirname(fileURLToPath(import.meta.url));
const jsonDir = join(here, "../../../data/json");

interface MtgJsonCard {
    identifiers?: { scryfallId?: string };
    name: string;
    /** MTGJSON's per-FACE name on a multi-face row ("Stand", "Deliver"). */
    faceName?: string;
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
function loadAllMtgJsonCards(): Map<string, MtgJsonCard[]> {
    const map = new Map<string, MtgJsonCard[]>();
    const files = readdirSync(jsonDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
        const raw = readFileSync(join(jsonDir, file), "utf8");
        const parsed = JSON.parse(raw) as { data: { cards: MtgJsonCard[] } };
        for (const card of parsed.data.cards) {
            const id = card.identifiers?.scryfallId;
            if (!id) continue;
            const rows = map.get(id);
            if (rows) rows.push(card);
            else map.set(id, [card]);
        }
    }
    return map;
}

/** The (definition, MTGJSON row) pairs a catalogue card contributes to the
 *  comparison.
 *
 *  One pair for an ordinary card. For a SPLIT card, one pair per half — the
 *  registered twin (CR 709.3b: the object the stack actually sees, carrying
 *  the half's own name, cost and type line) against the MTGJSON face row of
 *  the same name. Empty when a face has no matching row, which fails LOUDLY
 *  through the `faces match` guard below rather than silently here: a split
 *  card whose half names do not match the printed ones is a data bug, not an
 *  exemption. */
function comparablePairs(
    card: CardDefinition,
    rows: MtgJsonCard[]
): Array<{ def: CardDefinition; json: MtgJsonCard }> {
    if (!card.splitHalves) {
        return rows.length > 0 ? [{ def: card, json: rows[0] }] : [];
    }
    const pairs: Array<{ def: CardDefinition; json: MtgJsonCard }> = [];
    for (const side of SPLIT_HALF_SIDES) {
        const twin = splitHalfTwinDefinition(card, side);
        if (!twin) continue;
        const json = rows.find((r) => (r.faceName ?? r.name) === twin.name);
        if (json) pairs.push({ def: twin, json });
    }
    return pairs;
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
            const rows = mtgJsonCards.get(card.id);
            if (!rows) continue; // home set not vendored — out of guard scope
            if (isAllowlisted(card.id, field)) continue;
            for (const { def, json } of comparablePairs(card, rows)) {
                const { ok, expected, actual } = checkField(def, json);
                if (!ok) {
                    offenders.push({
                        name: def.name,
                        id: card.id,
                        field,
                        expected,
                        actual,
                    });
                }
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

describe("split cards are their halves COMBINED (CR 709.4, ADR 0121)", () => {
    const mtgJsonCards = loadAllMtgJsonCards();
    const splitCards = getAllCards().filter((c) => c.splitHalves);

    it("ships at least one, so the guards below are not vacuous", () => {
        expect(splitCards.length).toBeGreaterThan(0);
    });

    // CR 709.4a/709.4b/709.4c — the top-level `name`, `manaCost` and `types`
    // of a split card are a FUNCTION of its halves, and `defineSplitCard` is
    // the only thing allowed to write them (ADR 0121 §1). This is the guard
    // that makes that a rule rather than a convention: a set file that typed
    // its own combination — or a future edit that changed a half's cost and
    // forgot the sum — reds here.
    it("top-level name, mana cost and types ARE the derivation", () => {
        const offenders = splitCards
            .map((card) => {
                const halves = card.splitHalves!;
                const derivedName = combineSplitNames(halves);
                const derivedTypes = combineSplitTypes(halves);
                const derivedCost = combineSplitManaCosts(
                    halves[0].manaCost,
                    halves[1].manaCost
                );
                const nameOk = card.name === derivedName;
                const typesOk = sameSet(card.types, derivedTypes);
                const costOk = manaCostsEqual(
                    card.manaCost ?? {},
                    derivedCost ?? {}
                );
                return nameOk && typesOk && costOk
                    ? null
                    : {
                          id: card.id,
                          name: card.name,
                          derivedName,
                          types: card.types,
                          derivedTypes,
                          manaCost: card.manaCost,
                          derivedCost,
                      };
            })
            .filter((o) => o !== null);
        expect(offenders).toEqual([]);
    });

    // Every half must join to an MTGJSON face row of the same name, or
    // `comparablePairs` above silently compares NOTHING for that half and the
    // whole per-field sweep goes vacuous for this card.
    it("every half joins to an MTGJSON face row of the same name", () => {
        const offenders: Array<{ id: string; missing: string[] }> = [];
        for (const card of splitCards) {
            const rows = mtgJsonCards.get(card.id);
            if (!rows) continue; // home set not vendored
            const faceNames = new Set(rows.map((r) => r.faceName ?? r.name));
            const missing = card
                .splitHalves!.map((h) => h.name)
                .filter((n) => !faceNames.has(n));
            if (missing.length > 0) offenders.push({ id: card.id, missing });
        }
        expect(offenders).toEqual([]);
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
