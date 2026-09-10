// aiEffects shadow-script guard (PRD #1423, issue #1431). Root-cause fix for
// the "AI-blind resolve() card" class: a `resolve()`/`resolveSteps` card with
// no `effects[]` script gives the bot's card-quality signal (`cardValueById`
// → `latentValue`, `convex/gre/cardValue.ts`) nothing to walk, so it silently
// falls back to the blind `base + MV` floor — a burn/removal spell scores the
// same as a do-nothing spell of equal mana value.
//
// The MECHANISM this ticket ships: `CardDefinition.aiEffects` (an
// `EffectOp[]` shadow script, NEVER executed, walked by the SAME
// `OP_VALUERS` a real `effects[]` script uses — `convex/gre/ai/opValuers.ts`
// via `dslSpellScriptValue`, `convex/gre/ai/cardScriptValue.ts`) or the
// scalar `aiValue` override plug the gap per card.
//
// This guard is the "stop the population from GROWING" half (the BACKFILL of
// the current residue is issue #1436, a separate ticket): every AI-blind site
// in the live catalogue MUST carry `aiEffects`, `aiValue`, or a row in the
// committed BASELINE, `data/ai-effects-allowlist.json`. It shipped with every
// then-current offender baselined (so CI was green day 1) — the guard's value
// is that a NEW resolve() card landing after it has no row to hide behind and
// must comply immediately.
//
// ── THE BASELINE IS A GENERATED ARTIFACT (issue #3017) ─────────────────────
//
// It was four hand-written literal arrays in THIS file until issue #3017, and
// issue #1431 claimed of them: "As migration drains FREE -> effects[], those
// cards leave the allowlist automatically."
//
// THAT CLAIM WAS FALSE, and it is corrected here rather than left standing.
// The arrays were keyed by a static `cardId` and nothing pruned them, so
// migrating a listed card did not remove its entry — it turned this guard RED
// until a human hand-deleted the block. Staleness was DETECTED, never
// REPAIRED, which made a 3.3k-line test fixture the serialization point of the
// whole resolve()→effects[] migration: every migration PR edited it, and any
// two concurrent ones collided in it.
//
// So the rows now live in `data/ai-effects-allowlist.json`, and a graduation
// is applied by running the prune, not by hand-editing a literal:
//
//   bun run ai:allowlist            # prune graduated rows and write
//   bun run ai:allowlist --check    # report only (exit 1 on drift)
//
// The prune is PRUNE-ONLY and cannot re-baseline: it deletes rows whose site
// stopped offending, never adds one, never writes a `note`, never repairs a
// drifted `name`. `scripts/lib/ai-effects-baseline.ts` carries the full
// rationale, including why this artifact takes a generator while Guard C's
// baseline (`compilerRoundTrip.baseline.ts`) deliberately refuses one.
//
// Growth still reds, and that is the #1431 invariant, undiminished: a live
// site with no baseline row fails the sweep below, and the prune refuses it
// too. A shrink that was not pruned also reds, so a retirement stays visible
// in the diff.
//
// The offender PREDICATES live in `scripts/lib/ai-effects-baseline.ts` too, so
// the guard and the prune can never disagree about what an offender is — a
// baseline pruned against a second, drifted definition would be worse than the
// hand-editing it replaced.
//
// SCOPE — originally narrow, matching issue #1431's literal "resolve()/
// resolveSteps CARD" wording; issue #1519 folds in the two sites #1431
// explicitly deferred. The four scopes are the baseline's four `class` values:
//   • `card` — the CARD-LEVEL (`CardDefinition.resolve`/`resolveSteps`) spell
//     resolution site (issue #1431).
//   • `effect-shorthand` — the declarative `effect` (`EffectShorthand`)
//     card-level site (issue #1519) — a card whose entire resolution is a
//     registered shorthand primitive (compiled into a resolve closure at
//     lookup time) is exactly as AI-blind as a bare `resolve()` card:
//     `dslSpellScriptValue`'s `effectiveScript` only reads
//     `effects`/`aiEffects`, never the shorthand.
//   • `ability` — ability-level (`ActivatedAbility`/`TriggeredAbility`)
//     `resolve()` / `resolveSteps` bodies with no `effects[]` (issue #1519),
//     walked per-ability (an offending ability is cleared by its OWN
//     `aiEffects` shadow script, or by the owning CARD's `aiValue` — a
//     card-level `aiValue` override wins outright over the WHOLE card's
//     computed worth, ability scripts included, per `gre/cardValue.ts`
//     `latentValue`, so it also plugs every ability gap on that card).
//   • `delayed-trigger` — `delayedTriggers[]` template bodies (issue #1436;
//     see the block comment above that describe below).
//   • Modal cards (`modes[]`) remain excluded from the CARD-LEVEL checks
//     above: the card-level `resolve`/`effect` is bypassed for those (each
//     mode supplies its own resolution), so a card-level "no effects[]"
//     reading would be meaningless. A modal card's OWN `activatedAbilities`/
//     `triggeredAbilities` (independent of its modes) are still walked by
//     the ability-level check.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import type { ActivatedAbility, CardDefinition } from "../types";
import {
    AI_EFFECTS_BASELINE_PATH,
    AI_EFFECTS_BASELINE_SCRIPT,
    abilitiesOf,
    abilityHasShadowScript,
    abilityOnlyOf,
    delayedTriggersOf,
    describeOffender,
    enumerateAiEffectsOffenders,
    isResolveOnlyAbility,
    offenderKey,
    serializeBaseline,
    type AiEffectsBaselineRow,
    type AiEffectsOffenderClass,
} from "../../../scripts/lib/ai-effects-baseline";

const baselineText = readFileSync(
    resolvePath(AI_EFFECTS_BASELINE_PATH),
    "utf8"
);
const BASELINE = JSON.parse(baselineText) as AiEffectsBaselineRow[];

/** The baseline rows of one class. */
function rowsOf(cls: AiEffectsOffenderClass): AiEffectsBaselineRow[] {
    return BASELINE.filter((row) => row.class === cls);
}

const CARDS = getAllCards();
const LIVE = enumerateAiEffectsOffenders(CARDS);

const REGENERATE = `bun run ${AI_EFFECTS_BASELINE_SCRIPT}`;

describe("aiEffects shadow-script guard — the baseline covers exactly the live residue", () => {
    // The GROWTH half — issue #1431's whole invariant. A live AI-blind site
    // with no baseline row fails here, in every class at once, because the
    // sweep and the prune read the same `enumerateAiEffectsOffenders`.
    it("no AI-blind site has landed without an aiEffects shadow script, an aiValue override, or a baseline row", () => {
        const baselined = new Set(BASELINE.map(offenderKey));
        const grown = LIVE.filter(
            (site) => !baselined.has(offenderKey(site))
        ).map(describeOffender);
        expect(
            grown,
            "resolve()/resolveSteps/effect-shorthand site(s) with no effects[] and no " +
                "aiEffects/aiValue — sketch an aiEffects shadow script (walked by the same " +
                "OP_VALUERS a real effects[] script uses), or set the card's aiValue. A NEW " +
                `site does NOT get a baseline row: ${REGENERATE} is prune-only and refuses ` +
                "to add one (issue #1431, #3017)."
        ).toEqual([]);
    });

    // The SHRINK half — what used to be four EXACT-count assertions plus four
    // "stale allowlist entry, remove it" assertions, all cleared by hand. Now
    // one command clears it, and the retirement is still visible in the diff
    // because leaving it un-pruned stays red.
    it("no baseline row outlives its site — a graduated card/ability is pruned, not hand-deleted", () => {
        const live = new Set(LIVE.map(offenderKey));
        const stale = BASELINE.filter((row) => !live.has(offenderKey(row))).map(
            describeOffender
        );
        expect(
            stale,
            `${AI_EFFECTS_BASELINE_PATH} row(s) whose card/ability is no longer AI-blind — ` +
                "it gained effects[], aiEffects or aiValue, or its id no longer exists. " +
                `Prune the baseline with: ${REGENERATE}`
        ).toEqual([]);
    });

    it("the committed baseline is in canonical form — sorted, deduplicated, byte-identical to what the prune writes", () => {
        // Guards the artifact's merge immunity (see
        // `scripts/lib/generated-artifacts.ts`): per-row, sorted by name, no
        // whole-file state. A hand-inserted row out of order would still pass
        // the two set comparisons above while making every later diff noisy.
        expect(
            baselineText,
            `${AI_EFFECTS_BASELINE_PATH} is not in canonical form — regenerate it with: ${REGENERATE}`
        ).toBe(serializeBaseline(BASELINE));
        expect(
            new Set(BASELINE.map(offenderKey)).size,
            `${AI_EFFECTS_BASELINE_PATH} carries duplicate rows for one site`
        ).toBe(BASELINE.length);
    });

    it("every baseline row is well-formed: a real card, its current name, a disposition, and (for a delayed trigger) a tracking issue", () => {
        const byId = new Map(CARDS.map((c) => [c.id, c]));
        for (const row of BASELINE) {
            const card = byId.get(row.cardId);
            expect(
                card,
                `no card with id ${row.cardId} (${row.name}) — stale baseline row, prune with ${REGENERATE}`
            ).toBeDefined();
            expect(
                card!.name,
                `baseline row name "${row.name}" no longer matches card ${row.cardId} (now "${card!.name}") — ` +
                    "a rebuilt or renumbered catalogue. The prune deliberately does NOT repair a " +
                    "drifted name; adjudicate it by hand."
            ).toBe(row.name);
            expect(
                row.note.length,
                `${describeOffender(row)} needs a non-empty disposition note`
            ).toBeGreaterThan(0);
            if (row.class === "ability") {
                expect(
                    row.abilityId,
                    `${describeOffender(row)} is class "ability" and must name an abilityId`
                ).toBeTruthy();
            }
            if (row.class === "delayed-trigger") {
                expect(
                    row.delayedTriggerId,
                    `${describeOffender(row)} is class "delayed-trigger" and must name a delayedTriggerId`
                ).toBeTruthy();
                expect(
                    row.issue,
                    `${describeOffender(row)} needs a real tracking issue number`
                ).toBeGreaterThan(0);
            }
        }
    });
});

// Every resolve()-only card in the catalogue AT THE TIME this guard landed
// (issue #1431). Do NOT hand-add a row for a NEW card: a new resolve() card
// must ship with a real `aiEffects` sketch or an `aiValue` override instead
// (that's the whole point of this guard), and `bun run ai:allowlist` refuses
// to write one. This class only shrinks, as the #1436 backfill (or the ongoing
// resolve()→effects[] migration) lands.
describe("aiEffects shadow-script guard — card-level resolve() (issue #1431)", () => {
    it("the card class covers exactly the current resolve()-only-with-no-shadow-script residue", () => {
        const live = LIVE.filter((o) => o.class === "card").map(offenderKey);
        expect(live.sort()).toEqual(rowsOf("card").map(offenderKey).sort());
    });
});

// Every card whose top-level spell resolution is the declarative `effect`
// shorthand (`EffectShorthand`) with no `effects[]`/`aiEffects`/`aiValue`, AT
// THE TIME this scope extension landed (issue #1519). Same emptying-out
// discipline as the `card` class above: do NOT hand-add a row for a NEW
// card — ship it with a real `aiEffects` sketch or an `aiValue` override
// instead.
describe("aiEffects shadow-script guard — effect-shorthand cards (issue #1519)", () => {
    it("the effect-shorthand class covers exactly the current shorthand-with-no-shadow-script residue", () => {
        const live = LIVE.filter((o) => o.class === "effect-shorthand").map(
            offenderKey
        );
        expect(live.sort()).toEqual(
            rowsOf("effect-shorthand").map(offenderKey).sort()
        );
    });
});

// Every activated/triggered ability whose own effect is a bare
// `resolve()`/`resolveSteps` closure with no `effects[]`/`aiEffects`, on a
// card with no `aiValue` override, AT THE TIME this scope extension landed
// (issue #1519). Same emptying-out discipline: do NOT hand-add a row for a NEW
// ability — ship it with a real `aiEffects` sketch on the ability, or an
// `aiValue` override on the owning card, instead.
describe("aiEffects shadow-script guard — ability-level resolve() (issue #1519)", () => {
    it("the ability class covers exactly the current ability-level resolve()-only-with-no-shadow-script residue", () => {
        const live = LIVE.filter((o) => o.class === "ability").map(offenderKey);
        expect(live.sort()).toEqual(rowsOf("ability").map(offenderKey).sort());
    });

    it("every ability row still names a real activated/triggered ability that is still bare", () => {
        const byId = new Map(CARDS.map((c) => [c.id, c]));
        for (const row of rowsOf("ability")) {
            const card = byId.get(row.cardId)!;
            const ability = abilityOnlyOf(card).find(
                (a) => a.id === row.abilityId
            );
            expect(
                ability,
                `${describeOffender(row)} names no activated/triggered ability — stale row, prune with ${REGENERATE}`
            ).toBeDefined();
            expect(
                isResolveOnlyAbility(ability!),
                `${describeOffender(row)} gained effects[] — stale row, prune with ${REGENERATE}`
            ).toBe(true);
            expect(
                abilityHasShadowScript(ability!),
                `${describeOffender(row)} now carries aiEffects — stale row, prune with ${REGENERATE}`
            ).toBe(false);
            expect(
                card.aiValue,
                `${describeOffender(row)} now carries a card-level aiValue, which already plugs every ability gap — stale row, prune with ${REGENERATE}`
            ).toBeUndefined();
        }
    });
});

// `abilitiesOf` now also walks `card.delayedTriggers[]` (PR #2010's review,
// MINOR 7 — a bare `resolve()` delayed-trigger body was previously invisible
// to this guard entirely, so it could ship with no `aiEffects` and no
// error). 25 of the 26 rows are every PRE-EXISTING delayed-trigger
// body that scope extension newly reached; none are new abilities. The 26th
// (Planeswalker's Mischief) is the one card that HAD passed the guard, via a
// `gainLife amount: 0` shadow whose own comment admitted it was "not a real
// valuation".
//
// Issue #2020 was filed to drain this list by writing an `aiEffects` shadow
// on each delayed trigger. That half is dead work and the issue is closed for
// it: **no valuer reads a delayed trigger.** The value model's ability walk is
// `activatedAbilities` + `triggeredAbilities` only
// (`gre/ai/cardScriptValue.ts`, `gre/ai/graveyardReach.ts`); the
// `delayedTrigger` Op's valuer recurses into the Op's own INLINE body (ADR
// 0048), never a named `cardDef.delayedTriggers[]` TEMPLATE like these; the
// one AI reader of that array, `gre/ai/searchDestination.ts`, documents that
// it deliberately does NOT consult `aiEffects` (it asks what the engine will
// really do, not what a thing is worth); the rest are debug views
// (`src/lib/engine-view-*.ts`, which DID render the deleted field as a chip —
// hence "no VALUER reads it", not "nothing"). `DelayedTriggerDef.aiEffects`
// was therefore deleted outright (`cards/types.ts`): `tsc` now refuses the
// placebo the way this test could only warn about it.
//
// The OTHER half of #2020's fix — set the owning card's `aiValue` — is
// perfectly implementable, and is what these rows still track. For 24 of the
// 26 that lands at #1436, the resolve()-residue backfill: their delayed
// trigger is scheduled from inside a `resolve()` body, so the OWNING CARD is
// what the value model cannot see, and each already carries a `card` or
// `ability` row for that same invisibility — fixing the card (real
// `effects[]`, else `aiValue`) closes its delayed-trigger row here as a side
// effect. #1436 already rules that a card the classifier reports
// FREE-migratable must be MIGRATED, not shadowed.
//
// TWO rows are NOT #1436's and are filed against issue #3383 instead, because
// nothing in the resolve()-residue backfill will ever reach them: Rainbow
// Vale, whose delayed trigger is armed DECLARATIVELY by
// `armsDelayedTriggerOnTap` (ADR 0040) from a mana ability with no `resolve()`
// at all, and Planeswalker's Mischief, whose scheduling ability already
// carries a really-walked `aiEffects`.
//
// Issue #3383 is the standing gap this list cannot close by itself: the value
// model walks `delayedTriggers[]` NOT AT ALL, so a real `effects[]` on a
// template is worth zero too (7 templates already carry one — Mishra's
// Bauble's whole point is its delayed `draw`, and the bot prices the card as
// if the draw did not exist). Until that reader exists, migrating a row here
// to `effects[]` is an engine improvement and a bot no-op.
//
// The guard's job is forward-looking: a NEW delayed trigger may not ship on a
// card the value model cannot see, and a row that stops matching reality
// (card fixed, id renamed) reds — cleared by the prune, never by hand, and
// never by adding a row for new work.
describe("aiEffects shadow-script guard — delayedTriggers[] residue (issue #1436)", () => {
    it("the delayed-trigger class covers exactly the current delayedTriggers[] resolve()-only residue — the list cannot silently grow", () => {
        // Deliberately NOT filtered by `abilityHasShadowScript`, unlike the
        // ability class: an `aiEffects` script on a `delayedTriggers[]`
        // template is read by no valuer, so letting it shrink this set would
        // make a placebo fix look like a fix (the exact trap issue #2020 walked
        // into). `enumerateAiEffectsOffenders` owns that asymmetry.
        const live = LIVE.filter((o) => o.class === "delayed-trigger").map(
            offenderKey
        );
        expect(live.sort()).toEqual(
            rowsOf("delayed-trigger").map(offenderKey).sort()
        );
    });

    it("every delayed-trigger row still names a real template that is still bare", () => {
        const byId = new Map(CARDS.map((c) => [c.id, c]));
        for (const row of rowsOf("delayed-trigger")) {
            const card = byId.get(row.cardId)!;
            const trigger = delayedTriggersOf(card).find(
                (t) => t.id === row.delayedTriggerId
            );
            expect(
                trigger,
                `${describeOffender(row)} names no delayedTriggers[] entry — stale row, prune with ${REGENERATE}`
            ).toBeDefined();
            // No "gained an aiEffects shadow ⇒ stale row" assertion here,
            // unlike the ability class above: `DelayedTriggerDef` has no such
            // field to gain (deleted as dead data, issue #2020), so `tsc`
            // rejects the shape before a test could. What DOES retire a row is
            // the assertion below (owning card gained an `aiValue`) or
            // `isResolveOnlyAbility` (template gained a real `effects[]` —
            // worth doing for the engine, though it buys the BOT nothing until
            // issue #3383).
            expect(
                isResolveOnlyAbility(trigger!),
                `${describeOffender(row)} gained effects[] — stale row, prune with ${REGENERATE}`
            ).toBe(true);
            expect(
                card.aiValue,
                `${describeOffender(row)} now carries a card-level aiValue, which already plugs every ability gap — stale row, prune with ${REGENERATE}`
            ).toBeUndefined();
        }
    });
});

describe("aiEffects shadow-script guard — predicate correctness (fixture, issue #1519)", () => {
    // A synthetic malformed activated ability: a bare resolve() with no
    // effects[]/aiEffects and no owning-card aiValue — the exact shape the
    // catalogue-wide sweep above must never let a NEW ability slip through
    // as (issue #1519 acceptance: "Guard fails on a fixture card whose
    // activated ability has resolve() and no descriptor"). Exercised against
    // the SAME predicates the catalogue sweep uses, not a hand-rolled
    // reimplementation — a fixture-only helper would prove nothing about the
    // real guard.
    const malformedAbility: ActivatedAbility = {
        id: "fixture-malformed-ability",
        cost: { tap: true },
        oracleText: "{T}: Fixture effect with no AI descriptor.",
        useStack: true,
        resolve: () => {
            /* imperative body — deliberately opaque to the DSL walker */
        },
    };

    const fixtureCard: CardDefinition = {
        id: "fixture-card-1519",
        name: "Fixture Ability Offender",
        rarity: "common",
        types: ["Artifact"],
        activatedAbilities: [malformedAbility],
    };

    it("flags a fixture card whose activated ability has resolve() and no aiEffects/aiValue descriptor", () => {
        expect(fixtureCard.aiValue).toBeUndefined();
        const offendingAbilities = abilitiesOf(fixtureCard).filter(
            (a) => isResolveOnlyAbility(a) && !abilityHasShadowScript(a)
        );
        expect(offendingAbilities.map((a) => a.id)).toEqual([
            "fixture-malformed-ability",
        ]);
    });

    it("the whole-catalogue sweep would report it as growth: it reaches enumerateAiEffectsOffenders and is absent from the baseline", () => {
        // The fixture proves the SWEEP, not just the predicates — a fixture
        // that only exercised `isResolveOnlyAbility` would stay green if
        // `enumerateAiEffectsOffenders` stopped visiting the ability class at
        // all, which is precisely the regression the baseline move could
        // introduce.
        const found = enumerateAiEffectsOffenders([fixtureCard]);
        expect(found.map(describeOffender)).toEqual([
            `[ability] ${fixtureCard.id} (${fixtureCard.name}) ability:${malformedAbility.id}`,
        ]);
        const baselined = new Set(BASELINE.map(offenderKey));
        expect(baselined.has(offenderKey(found[0]!))).toBe(false);
    });

    it("clears once the ability carries its own aiEffects shadow script", () => {
        const fixedCard: CardDefinition = {
            ...fixtureCard,
            activatedAbilities: [
                {
                    ...malformedAbility,
                    aiEffects: [
                        { op: "dealDamage", amount: 1, to: { target: 0 } },
                    ],
                },
            ],
        };
        expect(enumerateAiEffectsOffenders([fixedCard])).toEqual([]);
    });

    it("clears once the owning card carries an aiValue override", () => {
        const fixedCard: CardDefinition = { ...fixtureCard, aiValue: 3 };
        // The card-level aiValue override plugs every ability gap on the
        // card (see `abilityHasShadowScript` doc comment) — the sweep's
        // outer loop skips a card entirely once `card.aiValue !== undefined`.
        expect(fixedCard.aiValue).toBeDefined();
        const stillBare = abilitiesOf(fixedCard).some(
            (a) => isResolveOnlyAbility(a) && !abilityHasShadowScript(a)
        );
        // The ability itself is still "bare" in isolation...
        expect(stillBare).toBe(true);
        // ...but the sweep never reaches it because the card is skipped
        // outright once it carries an aiValue.
        expect(enumerateAiEffectsOffenders([fixedCard])).toEqual([]);
    });
});
