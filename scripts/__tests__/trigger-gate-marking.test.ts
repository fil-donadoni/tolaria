// Hygiene guard (issue #1936): every trigger factory that accepts a CR 603.4
// check-time `condition` must record that gate on the ability it builds.
//
// The gate is folded into `matches`, where it is an opaque closure — a reader
// that is not the engine (the bot's Effect Script value model) cannot tell a
// conditional ability from an unconditional one and therefore values every
// gated ability as if it always fires. `withTriggerGate`
// (`convex/cards/abilities/triggers/shared.ts`) is the single place that
// records it; a factory that forgets the call reintroduces the blind spot
// silently, for every card built on it.
//
// A source-level check rather than a behavioural one on purpose: it covers a
// factory the moment it is written, without each of the ~17 factories needing
// a hand-built valid-args fixture (which is exactly the per-site authoring
// cost that lets a new factory slip through).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TRIGGERS_DIR = join(process.cwd(), "convex/cards/abilities/triggers");

/** Files that are not trigger factories. */
const NOT_A_FACTORY = new Set(["shared.ts"]);

function factoryFiles(): string[] {
    return readdirSync(TRIGGERS_DIR)
        .filter((f) => f.endsWith(".ts") && !NOT_A_FACTORY.has(f))
        .filter((f) => {
            const src = readFileSync(join(TRIGGERS_DIR, f), "utf8");
            return /\bcondition\??:/.test(src);
        });
}

describe("trigger-gate marking (CR 603.4, issue #1936)", () => {
    it("finds the condition-accepting factories", () => {
        // Sanity: the guard is worthless if the discovery predicate matches
        // nothing (a directory move, a rename of the `condition` arg).
        expect(factoryFiles().length).toBeGreaterThanOrEqual(15);
    });

    it("routes every condition-accepting factory through withTriggerGate", () => {
        const offenders = factoryFiles().filter((f) => {
            const src = readFileSync(join(TRIGGERS_DIR, f), "utf8");
            // Either the factory stamps the gate itself, or it delegates to
            // another factory that does — `landfallTrigger` forwards its
            // `condition` straight into `enteredTrigger`.
            const stamps = src.includes("withTriggerGate");
            const delegates = /condition:\s*args\.condition/.test(src);
            return !stamps && !delegates;
        });
        expect(
            offenders,
            "these trigger factories accept a `condition` but never record it as a TriggerGate — " +
                "return through `withTriggerGate(ability, args)` (convex/cards/abilities/triggers/shared.ts)"
        ).toEqual([]);
    });
});
