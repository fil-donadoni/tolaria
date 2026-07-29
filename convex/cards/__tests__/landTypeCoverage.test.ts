// Catalogue-wide guard (issue #1883 review finding): every registered LAND's
// printed `subtypes` must be fully covered by `LAND_TYPES`
// (`convex/gre/constants.ts`) — the CR 205.3i land-type list every CR 305.7
// "becomes a land type" narrowing (`applyLandTypeReplacement`, used by Blood
// Moon, Evil Presence, Phantasmal Terrain, Conversion, Glaciers, …) routes
// through.
//
// Why this guard exists: `LAND_TYPES` is a hand-maintained allowlist, not
// derived from the catalogue. A shipped land subtype missing from it doesn't
// error anywhere — it just silently fails to strip under a land-type-setting
// effect, so the land keeps BOTH its old subtype and its old (suppressed)
// abilities while also carrying the new type. This exact regression shipped
// once already in this PR's own predecessor: `LAND_TYPES` omitted "Town"
// (Starting Town, FIN) entirely, and stored the ATQ Urza-land trio's subtype
// as ONE compound string per land ("Urza's Mine") when `LAND_TYPES` (correctly,
// per CR 205.3i) models "Urza's" and "Mine"/"Power-Plant"/"Tower" as separate
// tokens — so `applyLandTypeReplacement` could never match the compound
// string and the Urza subtype (plus its now-invalid mana ability) survived a
// Blood-Moon-style reset undetected by any existing test.
//
// This sweep is the structural fix: it fails CI the moment ANY future land
// ships a subtype token `LAND_TYPES` doesn't know about, instead of relying on
// a human to remember to update the constant in lockstep with the catalogue.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import { LAND_TYPES } from "../../gre/constants";

/** Non-land subtypes that legitimately ride along on a MULTI-typed land
 *  (`types` includes "Land" plus another card type) and must NOT be flagged
 *  as an uncovered land type — they belong to the OTHER card type's own
 *  subtype vocabulary (Saga, CR 205.3h; Aura, CR 205.3g), which is exactly
 *  what CR 305.7 / `applyLandTypeReplacement` preserve on purpose. Empty
 *  today (no shipped card is `["Land", "Enchantment"]` yet — Urza's Saga is
 *  tracked separately, issue #1884); add a narrow `{ cardId, subtype }` row
 *  here, not a `LAND_TYPES` entry, the day a multi-typed land ships with one. */
const NON_LAND_SUBTYPE_ALLOWLIST: ReadonlySet<string> = new Set(
    // `${cardId}:${subtype}`
    []
);

describe("LAND_TYPES catalogue coverage (CR 205.3i, issue #1883)", () => {
    const lands = getAllCards().filter((card) => card.types.includes("Land"));

    it("has at least one registered land to check (sanity)", () => {
        expect(lands.length).toBeGreaterThan(0);
    });

    it("every land's printed subtypes are all known CR 205.3i land types", () => {
        const uncovered: { id: string; name: string; subtype: string }[] = [];
        for (const card of lands) {
            for (const subtype of card.subtypes ?? []) {
                if (LAND_TYPES.has(subtype)) continue;
                if (NON_LAND_SUBTYPE_ALLOWLIST.has(`${card.id}:${subtype}`))
                    continue;
                uncovered.push({ id: card.id, name: card.name, subtype });
            }
        }
        expect(
            uncovered,
            uncovered
                .map(
                    (u) =>
                        `${u.name} (${u.id}) carries subtype "${u.subtype}", not in LAND_TYPES ` +
                        `(and not in NON_LAND_SUBTYPE_ALLOWLIST) — a CR 305.7 land-type-setting ` +
                        `effect would silently fail to strip it. Add "${u.subtype}" to LAND_TYPES ` +
                        `if it's a land type (CR 205.3i), or to NON_LAND_SUBTYPE_ALLOWLIST if it ` +
                        `genuinely belongs to a different card type riding along on this land.`
                )
                .join("\n")
        ).toEqual([]);
    });
});
