// Guard C -- draw-in-closure guard (issue #1264, closes #1250). Root-cause fix
// for the "silent interactive-replacement skip" class: a `resolve()`/
// `resolveSteps` closure that calls the raw synchronous `ctx.drawCards`
// primitive bypasses the unified draw-replacement seam (ADR 0061) -- under
// Zur's Weirding such a draw happens WITHOUT ever offering the pay-2-life
// option. The DSL `draw` Op is the suspend-capable, replacement-aware path
// (`convex/gre/effects/interpreter.ts`); a card whose effect is fully
// DSL-expressible MUST use it instead of the raw primitive. This guard makes
// sure a future card can never regress back onto the raw primitive silently.
//
// Sibling to Guard A / Guard B (`mechanicsRegistry.test.ts` /
// `divergenceMarkers.test.ts`): a source-text sweep over every `.ts` file
// under `convex/cards/sets/**` (excluding `__tests__`), counting
// `ctx.drawCards(` occurrences PER FILE against a narrow ALLOWLIST -- each
// entry names the blocked card(s), the specific engine/Op gap, and -- for a
// genuinely fixable gap -- a real open tracking issue. A handful of entries
// are NOT "planned-migratable": a genuine protocol card (no Op vocabulary
// gap at all, e.g. a private single-knower reveal) needs no issue, mirroring
// Guard A's "protocol" classification; and exactly one entry (Lich) is
// OUT-OF-SCOPE-STRUCTURAL -- its `ctx.drawCards` call lives inside a
// REPLACEMENT EFFECT's synchronous `replace` callback (CR 614), not a
// `resolve()`/`resolveSteps` closure at all, so it was never a candidate for
// migration to the DSL `draw` Op in the first place (that Op's suspend-
// capable seam is for spell/ability effect sites; replacement `replace`
// callbacks are a different, synchronous structural site -- ADR 0061).
//
// EXACT COUNT per file (not "at least"): the check also catches a STALE
// allowlist entry whose card has since been migrated away (actual count
// dropping below the allowlisted expectation fails too) -- keeping the
// allowlist honest as an emptying-out list, mirroring the KEYWORD_ALLOWLIST
// precedent (issue #962). A file with MORE occurrences than the allowlist
// expects -- a new card silently calling the raw primitive from a
// resolve()/resolveSteps closure -- is exactly the regression this guard
// exists to catch.
//
// This file scans SOURCE TEXT under Node's `fs`/`path` (same as its sibling
// guards `mechanicsRegistry.test.ts` / `divergenceMarkers.test.ts`) -- a
// `.test.ts` file, never bundled into the deployed Convex function set, so
// the V8-isolate "no Node builtins" runtime rule does not apply here.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SETS_DIR = path.resolve("convex/cards/sets");

/** Collect every `.ts` source file under sets/**, excluding `__tests__` and
 *  `*.test.ts` (mirrors `divergenceMarkers.test.ts`'s `collectSetFiles`). */
function collectSetFiles(root: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue;
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectSetFiles(full));
        } else if (
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".test.ts")
        ) {
            out.push(full);
        }
    }
    return out;
}

const DRAW_PRIMITIVE_CALL = /\bctx\.drawCards\(/g;

type Classification =
    | "planned-migratable" // a real Op/engine-capability gap -- needs an issue
    | "protocol" // no Op vocabulary gap -- a genuine protocol card, no issue
    | "out-of-scope-structural"; // not a resolve()/resolveSteps closure at all

interface AllowlistEntry {
    /** Path relative to `convex/cards/sets` (e.g. "ice/blue.ts"). */
    readonly file: string;
    /** How many `ctx.drawCards(` occurrences in this file this entry accounts
     *  for. Multiple entries may share a file (see ice/blue.ts below). */
    readonly count: number;
    readonly cards: string;
    readonly reason: string;
    readonly classification: Classification;
    /** Required when classification is "planned-migratable". */
    readonly issue?: number;
}

// Narrow, per-file exemptions for the ~1264-migration stragglers. Every entry
// here was individually assessed against the FULL current DSL Op vocabulary
// (not just the ADR 0045-era 11-Op table) and found genuinely non-migratable
// today. See each card's own in-source "NOT DSL-migratable" / "protocol card"
// comment for the full reasoning; this table is the enforcement mirror.
const DRAW_PRIMITIVE_ALLOWLIST: readonly AllowlistEntry[] = [
    {
        file: "arn/colorless.ts",
        count: 1,
        cards: "Bazaar of Baghdad",
        reason: 'DSL-expressible in principle (draw -> choice -> discard), but the per-card test pins the interpreter-internal choice id "bazaar-discard" -- migrating would force a test edit.',
        classification: "planned-migratable",
        issue: 1282,
    },
    {
        file: "atq/red.ts",
        count: 1,
        cards: "Goblin Artisans",
        reason: "the coinFlip Op's requestCoinFlip primitive always suspends on a random-reveal ack, unlike this card's synchronous ctx.flipCoin() -- migrating would change the test's resolution shape.",
        classification: "planned-migratable",
        issue: 1281,
    },
    {
        file: "csp/colorless.ts",
        count: 1,
        cards: "Mishra's Bauble (nextUpkeepDrawTrigger shared helper)",
        reason: "DelayedTriggerDef has no effects field, only resolve.",
        classification: "planned-migratable",
        issue: 1280,
    },
    {
        file: "drk/white.ts",
        count: 1,
        cards: "Martyr's Cry",
        reason: '"all white creatures" needs a colour filter (EffectCardFilter is type/subtype only), and the per-controller draw count is a snapshot the value grammar can\'t express.',
        classification: "planned-migratable",
        issue: 1283,
    },
    {
        file: "ice/black.ts",
        count: 1,
        cards: "Gravebind + nextUpkeepDrawTrigger shared helper",
        reason: "the card's own \"can't be regenerated\" clause has no standalone Op; the shared nextUpkeepDrawTrigger cantrip rider hits the same DelayedTriggerDef effects-field gap as csp/colorless.ts.",
        classification: "planned-migratable",
        issue: 1283,
    },
    {
        file: "ice/blue.ts",
        count: 1,
        cards: "nextUpkeepDrawTrigger shared helper (Clairvoyance, Force Void, Portent, Ray of Erasure)",
        reason: "DelayedTriggerDef has no effects field, only resolve; Clairvoyance additionally needs a private-look Op.",
        classification: "planned-migratable",
        issue: 1280,
    },
    {
        file: "ice/colorless.ts",
        count: 1,
        cards: "Barbed Sextant (nextUpkeepDrawTrigger via armsDelayedTriggerOnTap)",
        reason: "armsDelayedTriggerOnTap schedules a trigger BY ID with no inline effects/oracleText body counterpart.",
        classification: "planned-migratable",
        issue: 1280,
    },
    {
        file: "ice/green.ts",
        count: 1,
        cards: "nextUpkeepDrawTrigger shared helper",
        reason: "DelayedTriggerDef has no effects field, only resolve.",
        classification: "planned-migratable",
        issue: 1280,
    },
    {
        file: "ice/white.ts",
        count: 1,
        cards: "nextUpkeepDrawTrigger shared helper",
        reason: "DelayedTriggerDef has no effects field, only resolve.",
        classification: "planned-migratable",
        issue: 1280,
    },
    {
        file: "inv/green.ts",
        count: 1,
        cards: "Kavu Lair",
        reason: "enteredTrigger's effects site binds ctx.controller to the SOURCE's controller by design; this card needs the ENTERING creature's controller -- a documented, sanctioned resolve() escape, not a missing Op.",
        classification: "protocol",
    },
    {
        file: "inv/red.ts",
        count: 1,
        cards: "Stun",
        reason: "restrictCombat now covers the keyword shape, but the card has no per-card behavior test today -- ineligible for an AFK migration (no green-before baseline).",
        classification: "planned-migratable",
        issue: 1285,
    },
    {
        file: "inv/white.ts",
        count: 1,
        cards: "Restrain",
        reason: 'no preventDamage Op mode for a source-only "assigns no combat damage" mark.',
        classification: "planned-migratable",
        issue: 1283,
    },
    {
        file: "lea/black.ts",
        count: 1,
        cards: "Lich",
        reason: "this ctx.drawCards call lives in a REPLACEMENT EFFECT's synchronous replace callback (CR 614), not a resolve()/resolveSteps closure at all -- never a migration candidate.",
        classification: "out-of-scope-structural",
    },
    {
        file: "lea/white.ts",
        count: 1,
        cards: "Island Sanctuary",
        reason: "the skip branch sets a bespoke player-scoped combat-restriction flag (setIslandSanctuaryProtection) with no registered Op.",
        classification: "planned-migratable",
        issue: 1283,
    },
    {
        file: "leg/green.ts",
        count: 1,
        cards: "Sylvan Library",
        reason: 'a ranged topdeck selection (choose 0..N) with a per-card life cost ("4 for each NOT selected") is a choice-result-cardinality + pay-life composition the Op vocabulary can\'t express.',
        classification: "planned-migratable",
        issue: 1283,
    },
    {
        file: "leg/red.ts",
        count: 1,
        cards: "Winds of Change",
        reason: 'the whole-hand-zone-move gap (#1279) closed -- this card now needs a NARROWER, different gap: "draws THAT MANY cards" requires a dynamic count-of-cards-moved (each player\'s hand size captured before the shuffle) the moveZone bulk shape does not carry.',
        classification: "planned-migratable",
        issue: 1388,
    },
    {
        file: "mh3/multicolor.ts",
        count: 1,
        cards: "Psychic Frog (combat-damage trigger)",
        reason: "the effect (draw one) is trivially a draw Op, but the damageDealtTrigger factory only exposes a resolve callback.",
        classification: "planned-migratable",
        issue: 1280,
    },
    {
        file: "ncc/colorless.ts",
        count: 1,
        cards: "Currency Converter ({2},{T}: Draw a card, then discard a card)",
        reason: 'DSL-expressible in principle (draw -> choice -> discard), but the per-card test pins the interpreter-internal choice id "currency-converter-discard" -- migrating would force a test edit (same shape as Bazaar of Baghdad).',
        classification: "planned-migratable",
        issue: 791,
    },
    {
        file: "nph/blue.ts",
        count: 1,
        cards: "Gitaxian Probe",
        reason: '"look at target player\'s hand" is a PRIVATE look (one knower); the DSL reveal Op is all-players-only -- a genuine protocol card, not a missing Op.',
        classification: "protocol",
    },
    {
        file: "sos/multicolor.ts",
        count: 1,
        cards: "Witherbloom Charm (sacrifice-draw mode)",
        reason: "the effect (mayPay sacrifice -> draw two) is Op-expressible, but SpellMode only accepts a resolve callback, no effects field.",
        classification: "planned-migratable",
        issue: 1280,
    },
    {
        file: "tsp/colorless.ts",
        count: 1,
        cards: "Chromatic Star",
        reason: "the draw itself is trivially a draw Op, but the leftTrigger factory site only exposes a resolve callback.",
        classification: "planned-migratable",
        issue: 1280,
    },
    {
        file: "ulg/colorless.ts",
        count: 1,
        cards: "Memory Jar",
        reason: "compound protocol card (pre-existing): a WHOLE-hand exile now has an Op (issue #1279 moveZone bulk shape), but this is a FACE-DOWN exile, which that shape does not do; exileFaceDown has no Op skin, and the per-player list-valued delayedTrigger capture the return trigger needs has no capture shape.",
        classification: "protocol",
    },
    {
        file: "usg/blue.ts",
        count: 1,
        cards: "Time Spiral",
        reason: 'the SAME Timetwister-shape gap as lea/blue.ts: "shuffles hand and graveyard into library" is a bulk whole-zone move -- moveZone only moves an announced target or a choice-picked set, never an entire zone.',
        classification: "planned-migratable",
        issue: 1279,
    },
    {
        file: "voc/blue.ts",
        count: 1,
        cards: "Occult Epiphany",
        reason: "discard-count arithmetic (min(X, hand size)) and a distinct-card-types tally over discard picks have no EffectValue construct (pre-existing, issue #852).",
        classification: "planned-migratable",
        issue: 852,
    },
];

describe("Guard C -- draw-in-closure guard (issue #1264, closes #1250)", () => {
    it("every ctx.drawCards call in convex/cards/sets/** is accounted for by DRAW_PRIMITIVE_ALLOWLIST", () => {
        const actualCounts = new Map<string, number>();
        for (const file of collectSetFiles(SETS_DIR)) {
            const rel = path.relative(SETS_DIR, file);
            const contents = fs.readFileSync(file, "utf8");
            const matches = contents.match(DRAW_PRIMITIVE_CALL);
            if (matches && matches.length > 0) {
                actualCounts.set(rel, matches.length);
            }
        }

        const expectedCounts = new Map<string, number>();
        for (const entry of DRAW_PRIMITIVE_ALLOWLIST) {
            expectedCounts.set(
                entry.file,
                (expectedCounts.get(entry.file) ?? 0) + entry.count
            );
        }

        const offenders: string[] = [];
        for (const [file, actual] of actualCounts) {
            const expected = expectedCounts.get(file) ?? 0;
            if (actual !== expected) {
                offenders.push(
                    `${file}: found ${actual} ctx.drawCards call(s), DRAW_PRIMITIVE_ALLOWLIST expects ${expected}`
                );
            }
        }
        for (const [file, expected] of expectedCounts) {
            if (!actualCounts.has(file) && expected > 0) {
                offenders.push(
                    `${file}: DRAW_PRIMITIVE_ALLOWLIST expects ${expected} call(s) but none found -- stale entry, remove it`
                );
            }
        }

        expect(
            offenders,
            "a resolve()/resolveSteps closure in convex/cards/sets/** calls the raw synchronous " +
                "ctx.drawCards primitive outside DRAW_PRIMITIVE_ALLOWLIST. Migrate the card to the DSL " +
                "draw Op (replacement-aware, ADR 0061), or -- if genuinely non-migratable today -- add a " +
                "narrow allowlist entry in this file with a real open tracking issue " +
                "(see .claude/rules/gre-development.md section DSL-first authoring, issue #1264)."
        ).toEqual([]);
    });

    it("every planned-migratable DRAW_PRIMITIVE_ALLOWLIST entry carries a real open tracking issue", () => {
        for (const entry of DRAW_PRIMITIVE_ALLOWLIST) {
            if (entry.classification === "planned-migratable") {
                expect(
                    entry.issue,
                    `${entry.file} (${entry.cards}) is classified planned-migratable but has no issue number`
                ).toBeGreaterThan(0);
            } else {
                expect(
                    entry.issue,
                    `${entry.file} (${entry.cards}) is classified "${entry.classification}" and should not carry an issue number`
                ).toBeUndefined();
            }
        }
    });

    it("sanity: the scanner counts multiple occurrences in one file", () => {
        // Pure unit check of the counting logic (no disk I/O).
        const fixture = `
            resolve: (ctx) => {
                ctx.drawCards(ctx.controller, 1);
                if (x) ctx.drawCards(ctx.controller, 2);
            },
        `;
        const matches = fixture.match(DRAW_PRIMITIVE_CALL);
        expect(matches?.length).toBe(2);
    });
});
