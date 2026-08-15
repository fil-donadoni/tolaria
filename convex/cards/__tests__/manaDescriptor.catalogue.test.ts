// GLOBAL regression guard — every `useStack: false` ability, ANYWHERE in the
// catalogue, must declare a mana DESCRIPTOR (CR 605.1a).
//
// ── The rule ────────────────────────────────────────────────────────────────
// `useStack: false` means "mana ability" (CR 605.3a): it never uses the stack,
// so the engine deposits its mana structurally at activation time instead of
// resolving a script. Every authority that has to answer "does this permanent
// produce mana?" answers it by looking for a DESCRIPTOR field, never by reading
// an `effect` / `effects` body:
//
//   • `getActivatedManaAbility` / `getManaTapOptionsDetailed` / `hasManaAbility`
//     / `isUntappedManaSource` / `hasNonManaActivatedAbility`
//     (`convex/gre/constants.ts`) — the tap mutation, the auto-tap solver and
//     the bot's mana census.
//   • `findClientManaAbility` (`src/lib/card-utils.ts`) — the board's
//     tap-for-mana affordance, the coloured tap cue, and the ability menu.
//
// The descriptor set is `manaProduced | manaChoices | manaColorSource |
// getManaChoices`. An ability declaring NONE of them is invisible to ALL of
// them at once: it is a mana ability nothing can recognise as one, so the
// permanent is not a mana source on any surface — no affordance, no tap option,
// not counted by the bot — while its definition, its Effect Script and its
// oracle text all look perfectly correct.
//
// ── The shipped failure this guard exists for ───────────────────────────────
// Shelldock Isle (issue #1959) declared "{T}: Add {U}." as `useStack: false` +
// `effect: (ctx) => ctx.addMana({ U: 1 })` and no descriptor. A fixed-output tap
// ability never executes that closure — the mana comes from `manaProduced` — so
// the land tapped for nothing, and because its OTHER ability ({U},{T}: play the
// hidden card) does use the stack, the ability menu showed only that one: a
// land whose only visible ability required mana the land could not make.
//
// Nothing caught it. `manaAbility.catalogue.test.ts` sweeps the ENGINE side but
// selects on `manaProduced !== undefined`, so the descriptor-less shape is
// filtered OUT of the sweep for exactly the reason it is broken. This guard
// closes that hole by asking the complementary question — not "does the
// declared output match what the engine offers?" but "is there anything to
// declare at all?".
//
// ── Why the walk is a deep walk ─────────────────────────────────────────────
// Abilities are not only in `CardDefinition.activatedAbilities`. They also ride
// on `grantTemplates` (CR 611.2a), on TOKEN specs (`sharedTokens.ts`, and specs
// written inline in a `createToken` Op's `token` field), and on emblems
// (CR 114 / 113.2). A field-name-driven walker covers only the sites its author
// remembered — the shape this guard is about was itself a site nobody swept —
// so every reachable object is visited and anything carrying `useStack: false`
// is checked, whatever field or nesting depth it arrived through.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import { listTokenCatalogue } from "../tokenCatalogue";
import { getAllEmblemDefinitions } from "../emblems";

/** The descriptors that make a non-stack ability recognisable as a mana
 *  ability. Keep in lockstep with `getActivatedManaAbility`
 *  (`convex/gre/constants.ts`) and `findClientManaAbility`
 *  (`src/lib/card-utils.ts`) — they ARE this list. */
const MANA_DESCRIPTORS = [
    "manaProduced",
    "manaChoices",
    "manaColorSource",
    "getManaChoices",
] as const;

interface Violation {
    where: string;
    detail: string;
}

/** Visits every object reachable from `root` and reports the ones that declare
 *  `useStack: false`. Cycle-safe; functions and primitives are skipped. */
function forEachNonStackAbility(
    root: unknown,
    origin: string,
    visit: (ability: Record<string, unknown>, path: string) => void
): void {
    const seen = new WeakSet<object>();
    const queue: { value: unknown; path: string }[] = [
        { value: root, path: origin },
    ];
    while (queue.length > 0) {
        const { value, path } = queue.pop()!;
        if (value === null || typeof value !== "object") continue;
        if (seen.has(value)) continue;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach((entry, i) =>
                queue.push({ value: entry, path: `${path}[${i}]` })
            );
            continue;
        }
        const obj = value as Record<string, unknown>;
        if (obj.useStack === false) visit(obj, path);
        for (const [key, child] of Object.entries(obj)) {
            queue.push({ value: child, path: `${path}.${key}` });
        }
    }
}

interface Sweep {
    seen: number;
    violations: Violation[];
}

function sweep(): Sweep {
    const result: Sweep = { seen: 0, violations: [] };

    const check = (
        ability: Record<string, unknown>,
        path: string,
        origin: string
    ) => {
        result.seen++;
        if (MANA_DESCRIPTORS.some((d) => ability[d] !== undefined)) return;
        result.violations.push({
            where: `${origin} → ${path}`,
            detail:
                `ability "${String(ability.id ?? "<no id>")}" ` +
                `("${String(ability.oracleText ?? "")}") is useStack: false but ` +
                `declares none of ${MANA_DESCRIPTORS.join(" / ")}. No mana ` +
                `authority can see it produce mana: no tap-for-mana affordance ` +
                `on the board, no entry in getManaTapOptionsDetailed, not ` +
                `counted by the bot. An \`effect\`/\`effects\` body is NOT a ` +
                `substitute — a fixed-output mana ability never runs one.`,
        });
    };

    // Card definitions — reaches activatedAbilities, grantTemplates, ability
    // modes, and any token spec written inline in a `createToken` Op.
    for (const def of getAllCards()) {
        const origin = `card ${def.name} (${def.id})`;
        forEachNonStackAbility(def, origin, (a, p) => check(a, p, origin));
    }
    // Token specs — the shared ones (`sharedTokens.ts`) plus every spec any card
    // creates, including those only a `resolve()` closure reaches, which the
    // card walk above cannot see.
    for (const entry of listTokenCatalogue()) {
        const origin = `token ${entry.key} (from ${entry.producedBy})`;
        forEachNonStackAbility(entry.spec, origin, (a, p) =>
            check(a, p, origin)
        );
    }
    // Emblems (CR 113.2) — an emblem can carry abilities of its own.
    for (const emblem of getAllEmblemDefinitions()) {
        const origin = `emblem ${emblem.id}`;
        forEachNonStackAbility(emblem, origin, (a, p) => check(a, p, origin));
    }
    return result;
}

const RESULT = sweep();

describe("every non-stack ability declares a mana descriptor (CR 605.1a)", () => {
    it("no ability anywhere in the catalogue is a mana ability nothing can recognise", () => {
        const report = RESULT.violations
            .map((v) => `${v.where}: ${v.detail}`)
            .join("\n\n");
        expect(RESULT.violations, report).toEqual([]);
    }, 120_000);

    it("the sweep is not vacuous — it visited a substantial number of abilities", () => {
        // A traversal bug (an early `continue`, a wrong field name) would turn
        // the assertion above into a permanent green no-op. The floor sits well
        // under the current count so it tracks a broken walk, not catalogue
        // churn.
        expect(RESULT.seen).toBeGreaterThan(100);
    });
});
