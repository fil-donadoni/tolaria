// Catalogue-wide guard: `cast-permission` ids are unique (CR 601.3, issue #2706).
//
// `collectCastPermissions` (`convex/gre/castPermissions.ts`) deduplicates by the
// BARE `effect.id` across every definition on BOTH battlefields — two Alurens
// must grant one permission, not two cast options (CR 118.9a). That dedup is
// global by construction, so two DIFFERENT cards sharing an id would silently
// suppress one another: whichever the scan reached first would win, and the
// other card's permission would simply never be offered. Nothing else notices —
// no type error, no failing card test, just a card that quietly stops working
// on boards where the other one is out.
//
// The id also travels on the wire (`cast-permission:<id>` as
// `announceCast.alternativeCostId`), so a collision is a client sending an id
// that resolves to the wrong permission's terms.

import { describe, expect, it } from "vitest";
import { registeredDefinitions } from "../registry";
import { declaredCastPermissions } from "../../gre/castPermissions";

describe("cast-permission ids (CR 601.3)", () => {
    it("no two definitions declare the same permission id", () => {
        const owners = new Map<string, string[]>();
        let scanned = 0;
        for (const def of registeredDefinitions()) {
            scanned += 1;
            for (const permission of declaredCastPermissions(def)) {
                const seen = owners.get(permission.id) ?? [];
                if (!seen.includes(def.name)) seen.push(def.name);
                owners.set(permission.id, seen);
            }
        }
        const collisions = [...owners.entries()]
            .filter(([, names]) => names.length > 1)
            .map(([id, names]) => `${id}: ${names.join(", ")}`);

        expect(collisions).toEqual([]);
        // Premise: a catalogue that failed to load would pass vacuously.
        expect(scanned).toBeGreaterThan(1000);
        expect([...owners.keys()]).toContain("aluren-creature-permission");
    });

    it("every declared permission grants at least one of the two terms", () => {
        // A permission that neither waives the cost nor widens the timing is
        // inert: it would be scanned, matched and then change nothing. Almost
        // certainly a dropped field rather than an intent.
        const inert: string[] = [];
        for (const def of registeredDefinitions()) {
            for (const permission of declaredCastPermissions(def)) {
                if (
                    !permission.withoutPayingManaCost &&
                    !permission.asThoughFlash
                ) {
                    inert.push(`${def.name} (${permission.id})`);
                }
            }
        }

        expect(inert).toEqual([]);
    });
});
