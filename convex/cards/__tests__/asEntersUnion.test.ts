// Catalogue-wide guard — ADR 0100 slice 1 (#2492) declares the whole
// `AsEntersChoice` union and wires NO card to it.
//
// The engine capability ships first and the ten affected cards arrive in
// #2019 (`mode`), #2467 (`name` / `subtypes` / `body` / `payLife`), #2451
// (`copy`) and #1980 (`pay`) — "intermediate slices are engine capabilities
// with no card exposing them" (`.claude/rules/gre-development.md`). This guard
// is what makes that claim checkable rather than asserted: a card wired to a
// leg whose bot arm and UI affordance have not shipped yet would be a silently
// half-implemented mechanic, which is the exact failure mode #957/#958 named.
//
// WHEN A SLICE WIRES ITS CARDS, this guard is the thing it deletes (or narrows
// to the legs still unwired) — it is a slice boundary, not a permanent rule.
import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import type { AsEntersChoice, CardDefinition, TokenSpec } from "../types";

/** Every `asEnters` declaration reachable from a shipped card definition:
 *  directly on the card, and on any token spec it creates (a token's clause is
 *  a copiable value, CR 707.2, so it is just as much a shipped declaration). */
function declaredAsEnters(
    def: CardDefinition
): { where: string; choices: AsEntersChoice[] }[] {
    const found: { where: string; choices: AsEntersChoice[] }[] = [];
    const direct = def.entersWith?.asEnters;
    if (direct && direct.length > 0) {
        found.push({
            where: `${def.id} (entersWith.asEnters)`,
            choices: [...direct],
        });
    }
    // Token specs ride Effect Script Ops and `resolve()` closures alike; the
    // JSON-pure declarations are what a catalogue sweep can see, and they are
    // the only shape a slice would use to wire one.
    const walk = (value: unknown, path: string, depth: number): void => {
        if (depth > 8 || value === null || typeof value !== "object") return;
        if (Array.isArray(value)) {
            value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
            return;
        }
        const record = value as Record<string, unknown>;
        const entersWith = record.entersWith as
            | TokenSpec["entersWith"]
            | undefined;
        if (entersWith?.asEnters && entersWith.asEnters.length > 0) {
            found.push({
                where: `${def.id} ${path}.entersWith.asEnters`,
                choices: [...entersWith.asEnters],
            });
        }
        for (const [key, v] of Object.entries(record)) {
            if (typeof v === "function") continue;
            walk(v, `${path}.${key}`, depth + 1);
        }
    };
    if (def.effects) walk(def.effects, "effects", 0);
    return found;
}

describe("as-enters union is declared but unwired in slice 1 (ADR 0100, #2492)", () => {
    it("no shipped CardDefinition populates entersWith.asEnters", () => {
        const wired = getAllCards().flatMap(declaredAsEnters);
        expect(wired.map((w) => w.where)).toEqual([]);
    });

    it("the guard is not vacuous — the sweep does find a declaration when one exists", () => {
        const fixture = {
            id: "fixture",
            rarity: "common",
            name: "Fixture",
            manaCost: {},
            types: ["Creature"],
            entersWith: { asEnters: [{ kind: "mode" }] },
        } as unknown as CardDefinition;
        expect(declaredAsEnters(fixture)).toHaveLength(1);

        const tokenFixture = {
            id: "fixture-token",
            rarity: "common",
            name: "Fixture Token",
            manaCost: {},
            types: ["Sorcery"],
            effects: [
                {
                    op: "createToken",
                    controller: "controller",
                    token: {
                        name: "T",
                        types: ["Creature"],
                        entersWith: { asEnters: [{ kind: "aura-host" }] },
                    },
                },
            ],
        } as unknown as CardDefinition;
        expect(declaredAsEnters(tokenFixture)).toHaveLength(1);
    });
});
