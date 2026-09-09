// Catalogue-wide guard: a `cast-permission` id IS its clause (CR 601.3,
// issues #2706 / #3268).
//
// `collectCastPermissions` (`convex/gre/castPermissions.ts`) deduplicates by the
// BARE `effect.id` across every definition on BOTH battlefields — two Alurens
// must grant one permission, not two cast options (CR 118.9a). That dedup is
// global by construction, which cuts both ways:
//
//  - two DIFFERENT permissions sharing an id silently SUPPRESS one another.
//    Whichever the scan reached first wins and the other card's permission is
//    simply never offered. Nothing else notices — no type error, no failing
//    card test, just a card that quietly stops working on boards where the
//    other one is out. The id also travels on the wire
//    (`cast-permission:<id>` as `announceCast.alternativeCostId`), so a
//    collision is a client sending an id that resolves to the wrong terms.
//
//  - two cards printing the SAME permission must share one id, or the cast
//    picker shows the same option twice and the Bot enumerates two identical
//    branches. Three cards print "You may cast creature spells as though they
//    had flash."
//
// Both are one property: the id is DERIVED FROM THE CLAUSE
// (`convex/oracle/castPermissionId.ts`). So this file asserts the derivation
// rather than bare uniqueness — bare uniqueness is FALSE by construction under
// a content-derived id, and asserting it would red the day a second card
// prints an already-shipped permission.
//
// A card still writes its id as a LITERAL (cards are DATA, ADR 0045): a
// definition that called the derivation would make the compiler round trip a
// tautology, both sides computing the same value and neither proving the
// sentence was read. This test is what closes that loop instead.

import { describe, expect, it } from "vitest";
import { registeredDefinitions } from "../registry";
import { declaredCastPermissions } from "../../gre/castPermissions";
import {
    castPermissionClause,
    deriveCastPermissionId,
} from "../../oracle/castPermissionId";

describe("cast-permission ids (CR 601.3)", () => {
    it("every declared id is the derivation of its own clause", () => {
        const wrong: string[] = [];
        let scanned = 0;
        let permissions = 0;
        for (const def of registeredDefinitions()) {
            scanned += 1;
            for (const permission of declaredCastPermissions(def)) {
                permissions += 1;
                const expected = deriveCastPermissionId(
                    castPermissionClause(permission)
                );
                if (permission.id !== expected)
                    wrong.push(
                        `${def.name}: declares "${permission.id}", clause derives "${expected}"`
                    );
            }
        }

        expect(wrong).toEqual([]);
        // Premise: a catalogue that failed to load would pass vacuously, and
        // so would one where nothing declares a permission at all.
        expect(scanned).toBeGreaterThan(1000);
        expect(permissions).toBeGreaterThan(0);
    });

    it("two permissions sharing an id have the same clause", () => {
        // The replacement for the old bare-uniqueness assertion. A shared id
        // is now LEGAL — it is what makes two cards printing one sentence
        // collapse to one cast option — but only when the clauses agree; a
        // shared id over differing clauses is the silent-suppression bug.
        const clauses = new Map<string, { owner: string; json: string }>();
        const collisions: string[] = [];
        for (const def of registeredDefinitions()) {
            for (const permission of declaredCastPermissions(def)) {
                const json = JSON.stringify(
                    castPermissionClause(permission),
                    Object.keys(castPermissionClause(permission)).sort()
                );
                const seen = clauses.get(permission.id);
                if (seen === undefined) {
                    clauses.set(permission.id, { owner: def.name, json });
                    continue;
                }
                if (seen.json !== json)
                    collisions.push(
                        `${permission.id}: ${seen.owner} vs ${def.name}`
                    );
            }
        }

        expect(collisions).toEqual([]);
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
