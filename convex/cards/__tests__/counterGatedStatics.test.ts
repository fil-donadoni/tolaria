// Catalogue-wide guard for counter-gated MATERIALIZED static effects
// (CR 613.5 / 122.1, issue #1711).
//
// The engine reaches game state with a static effect in one of two ways:
//
//   - RECOMPUTED kinds (`pt-buff`, `pt-cda`, and the restriction/guard
//     predicates) are evaluated at every read, so a counter-gated predicate is
//     live for free. Homarid's tide counters need nothing.
//   - MATERIALIZED kinds (`keyword-grant`, `activated-grant`,
//     `triggered-grant`, `type-add`/`type-remove`, `subtype-set`/`subtype-add`,
//     `supertype-set`, `color-grant`, `keyword-remove`, `ability-loss`) are
//     WRITTEN ONTO the target instance once, by `applySourceStaticEffects`,
//     when the source or the target enters the battlefield. Nothing re-runs
//     them afterwards.
//
// A materialized predicate reading COUNTERS therefore freezes at its
// entering-the-battlefield answer: the untap step and
// `getEffectiveActivatedAbilities` both read the materialized arrays, so the
// grant is silently absent (or silently stuck on) for the rest of the game.
// Dread Wight, Venarian Gold, Cocoon, Cyclopean Tomb and Gaea's Liege all
// shipped inert this way.
//
// The one legitimate exception is a predicate whose counter read is a PROXY
// for a fact that is itself one-shot — see `KICKER_PROXY_ALLOWLIST` below.
//
// The fix is `refreshCounterGatedStatics` (`gre/state.ts`), which re-runs the
// materialization for every battlefield source whose static effects DECLARE
// `dependsOnCounters: true` (`CounterGatedStatic`, `cards/types.ts`). The
// declaration is the only thing an author must remember — this guard is what
// makes forgetting it a CI failure rather than a shipped-inert card.
//
// Detection is a SOURCE scan of the effect's closures
// (`Function.prototype.toString`): any mention of `counters` or
// `getCounterCount` inside ANY function-valued slot of a materialized effect
// demands the flag. Test-time only — no production code reads function source.
import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import type { CardDefinition, StaticEffect } from "../types";

/** How each `StaticEffect` kind reaches game state. Typed as an EXHAUSTIVE
 *  `Record` over `StaticEffect["kind"]` so the classification is DERIVED from
 *  the union rather than hand-listed: adding a new kind to `StaticEffect`
 *  (`cards/types.ts`) fails to compile until it is classified here, and a
 *  misspelt kind (the `"color"` vs `"color-grant"` slip this guard shipped
 *  with) is a type error rather than a silent hole.
 *
 *   - `recomputed` — evaluated at every read (`getEffectivePower`, the
 *     restriction/requirement/guard checks, cost modifiers). A counter-gated
 *     predicate is live for free; no declaration needed.
 *   - `materialized` — WRITTEN ONTO the target instance by
 *     `applySourceStaticEffects` and spliced back out by
 *     `unapplySourceStaticEffects` (`gre/state.ts`). These are exactly the
 *     kinds `refreshCounterGatedStatics` can re-run, so a counter-gated
 *     predicate MUST declare `dependsOnCounters: true`.
 *   - `materialized-unrefreshable` — written onto state by a DIFFERENT path
 *     that `refreshCounterGatedStatics` does not re-run (`control-change` is
 *     materialized by `applyAuraControlChange`, which pushes onto the host's
 *     `controlChanges` stack; `applySourceStaticEffects` has no branch for
 *     it). Declaring `dependsOnCounters` on one of these would be a no-op, so
 *     a counter-gated instance is an engine gap, not an authoring slip — see
 *     the dedicated test below. */
const KIND_MATERIALIZATION: Record<
    StaticEffect["kind"],
    "recomputed" | "materialized" | "materialized-unrefreshable"
> = {
    // --- recomputed at read time ---------------------------------------
    "pt-buff": "recomputed",
    "pt-cda": "recomputed",
    "untap-restriction": "recomputed",
    "block-restriction": "recomputed",
    "attack-restriction": "recomputed",
    "declared-attack-restriction": "recomputed",
    "declared-block-restriction": "recomputed",
    "global-attack-restriction": "recomputed",
    "attack-sacrifice-tax": "recomputed",
    "attack-mana-tax": "recomputed",
    "landwalk-negation": "recomputed",
    "enters-tapped-restriction": "recomputed",
    "attack-requirement": "recomputed",
    "block-requirement": "recomputed",
    "hand-size-override": "recomputed",
    "cost-modifier": "recomputed",
    "additional-cost": "recomputed",
    "mana-substitution": "recomputed",
    "permanent-guard": "recomputed",
    "player-guard": "recomputed",
    "combat-damage-prevention": "recomputed",
    "cast-restriction": "recomputed",
    "cast-timing-lock": "recomputed",
    // --- materialized by applySourceStaticEffects -----------------------
    "keyword-grant": "materialized",
    "activated-grant": "materialized",
    "triggered-grant": "materialized",
    "type-add": "materialized",
    "type-remove": "materialized",
    "subtype-set": "materialized",
    "subtype-add": "materialized",
    "supertype-set": "materialized",
    "color-grant": "materialized",
    "keyword-remove": "materialized",
    "ability-loss": "materialized",
    // --- materialized elsewhere, NOT reachable by the refresh -----------
    "control-change": "materialized-unrefreshable",
};

/** The kinds `refreshCounterGatedStatics` can actually re-run. Derived from
 *  the exhaustive census above — never hand-listed. */
const MATERIALIZED_KINDS: ReadonlySet<string> = new Set(
    Object.entries(KIND_MATERIALIZATION)
        .filter(([, how]) => how === "materialized")
        .map(([kind]) => kind)
);

/** Source text of EVERY function-valued slot on the effect. `applies` is the
 *  per-target predicate and `condition` the per-source CR 611.2c gate, but a
 *  materialized kind can also gate through a COMPUTED slot — `subtype-set`'s
 *  `subtypesFor(target, source, ctx)` (the Illusionary Terrain shape) is
 *  materialized identically to `applies`. Scanning every function-valued key
 *  rather than a hand-listed pair means the next computed slot added to
 *  `StaticEffect` is covered automatically. */
function predicateSources(effect: StaticEffect): string[] {
    const out: string[] = [];
    for (const value of Object.values(
        effect as unknown as Record<string, unknown>
    )) {
        if (typeof value === "function")
            out.push(Function.prototype.toString.call(value));
    }
    return out;
}

/** True when the predicate source reads counters on either the target or the
 *  source — `target.counters?.x`, `source.counters["y"]`, or the
 *  `PermanentView` accessor `ctx.getCounterCount(...)`. */
function readsCounters(src: string): boolean {
    return /\bcounters\b/.test(src) || /getCounterCount/.test(src);
}

function staticEffectsOf(card: CardDefinition): StaticEffect[] {
    const own = card.staticEffects ?? [];
    const modal = (card.modes ?? []).flatMap((m) => m.staticEffects ?? []);
    return [...own, ...modal];
}

/** Narrow, per-(card, kind) exemption for a materialized static effect whose
 *  counter read is a **proxy for a one-shot fact**, not a live condition.
 *
 *  Formerly held Pouncing Kavu and Duskwalker (`cards/sets/inv/red.ts` /
 *  `cards/sets/inv/black.ts`): Kicker (CR 702.33) is fixed as the spell
 *  resolves, and the "if this creature was kicked …" clause applies as a CR
 *  614.1c ETB replacement, but `kickerCount` used to live only on the STACK
 *  ITEM (`gre/state.ts`) — gone by the time the permanent was on the
 *  battlefield — so both cards read the two `+1/+1` counters their own
 *  `entersWith` had just placed as an exact-at-that-instant proxy. Issue
 *  #1716 closed the gap: `CardInstanceState.wasKicked` now snapshots the
 *  one-shot fact directly onto the permanent at ETB
 *  (`finalizeSpellResolution`, `gre/state.ts`), so both `keyword-grant`
 *  predicates gate on `target.wasKicked` instead of a counter count — no
 *  longer reading counters at all, so this guard has nothing to allowlist for
 *  them. Empty and meant to STAY empty: like `KEYWORD_ALLOWLIST`
 *  (`mechanicsRegistry.test.ts`), a new row here is a fresh proxy an author
 *  should reach for only as a last resort, never a standing convenience. */
const KICKER_PROXY_ALLOWLIST: ReadonlyArray<{
    readonly cardId: string;
    readonly cardName: string;
    readonly kind: StaticEffect["kind"];
    readonly reason: string;
    readonly issue: number;
}> = [];

/** The detector itself, factored out of the catalogue sweep so it can be
 *  NEGATIVE-tested against synthetic cards below — a guard nobody has ever
 *  seen fail is a guard nobody knows works. `allowlist` is a parameter (not a
 *  closed-over constant) so the well-formedness test can re-run the detector
 *  with an EMPTY allowlist and prove each row is still load-bearing. */
function findUndeclaredOffenders(
    cards: readonly CardDefinition[],
    allowlist: typeof KICKER_PROXY_ALLOWLIST = KICKER_PROXY_ALLOWLIST
): string[] {
    const offenders: string[] = [];
    for (const card of cards) {
        for (const effect of staticEffectsOf(card)) {
            if (!MATERIALIZED_KINDS.has(effect.kind)) continue;
            if (effect.dependsOnCounters === true) continue;
            if (!predicateSources(effect).some(readsCounters)) continue;
            if (
                allowlist.some(
                    (a) => a.cardId === card.id && a.kind === effect.kind
                )
            ) {
                continue;
            }
            offenders.push(
                `${card.name} (${card.id}) — "${effect.kind}" predicate reads counters ` +
                    `but does not declare \`dependsOnCounters: true\`. Without it ` +
                    `\`refreshCounterGatedStatics\` never re-evaluates the grant and the ` +
                    `clause ships inert.`
            );
        }
    }
    return offenders;
}

/** Minimal card-shaped fixture carrying a single static effect. */
function fakeCard(name: string, effect: unknown): CardDefinition {
    return {
        id: `fake-${name}`,
        name,
        staticEffects: [effect],
    } as unknown as CardDefinition;
}

describe("counter-gated materialized statics must declare dependsOnCounters (CR 613.5, issue #1711)", () => {
    it("no materialized static reads counters without the declaration", () => {
        const offenders = findUndeclaredOffenders(getAllCards());
        expect(offenders, offenders.join("\n")).toEqual([]);
    });

    it("catches an undeclared counter-gated `color-grant` (the kind the first guard misspelt)", () => {
        // `color-grant`, not `color` — the kind string the guard originally
        // listed did not exist, so every counter-gated colour grant walked
        // straight through. Materialized via `grantedColors` in
        // `applySourceStaticEffects` / `unapplySourceStaticEffects`.
        const card = fakeCard("Chromatic Chrysalis", {
            kind: "color-grant",
            colors: ["blue"],
            applies: (target: { counters?: Record<string, number> }) =>
                (target.counters?.["paralysis"] ?? 0) > 0,
        });
        expect(findUndeclaredOffenders([card])).toHaveLength(1);
        // …and stays silent once the declaration is present.
        const declared = fakeCard("Chromatic Chrysalis", {
            kind: "color-grant",
            colors: ["blue"],
            dependsOnCounters: true,
            applies: (target: { counters?: Record<string, number> }) =>
                (target.counters?.["paralysis"] ?? 0) > 0,
        });
        expect(findUndeclaredOffenders([declared])).toEqual([]);
    });

    it("catches a counter-gated computed slot (`subtypesFor`, the Illusionary Terrain shape)", () => {
        // The gate need not live on `applies`: `subtype-set` also materializes
        // through `subtypesFor(target, source, ctx)`. Scanning only
        // `applies`/`condition` let that slot evade the guard entirely.
        const card = fakeCard("Miring Mesa", {
            kind: "subtype-set",
            applies: () => true,
            subtypesFor: (target: { counters?: Record<string, number> }) =>
                (target.counters?.["mire"] ?? 0) > 0 ? ["Swamp"] : [],
        });
        expect(findUndeclaredOffenders([card])).toHaveLength(1);
    });

    it("leaves recomputed kinds alone even when they read counters", () => {
        // `pt-buff` is evaluated at every read, so a counter-gated predicate is
        // live for free (Homarid). Demanding the flag here would be noise.
        const card = fakeCard("Tidal Homarid", {
            kind: "pt-buff",
            power: 1,
            toughness: 1,
            applies: (target: { counters?: Record<string, number> }) =>
                (target.counters?.["tide"] ?? 0) > 2,
        });
        expect(findUndeclaredOffenders([card])).toEqual([]);
    });

    it("every declared dependency is on a static effect that actually reads counters", () => {
        // The reverse direction: a stray `dependsOnCounters: true` on a
        // predicate that reads no counters costs a needless unapply/re-apply of
        // that source on every counter change and every SBA sweep. Keep the
        // declaration honest.
        const stray: string[] = [];

        for (const card of getAllCards()) {
            for (const effect of staticEffectsOf(card)) {
                if (effect.dependsOnCounters !== true) continue;
                const sources = predicateSources(effect);
                if (sources.some(readsCounters)) continue;
                stray.push(
                    `${card.name} (${card.id}) — "${effect.kind}" declares ` +
                        `\`dependsOnCounters\` but no predicate reads counters.`
                );
            }
        }

        expect(stray, stray.join("\n")).toEqual([]);
    });

    it("every KICKER_PROXY_ALLOWLIST entry is well-formed: a real card, a real undeclared counter-gated effect of that kind, a real tracking issue", () => {
        const cards = getAllCards();
        for (const a of KICKER_PROXY_ALLOWLIST) {
            expect(
                a.issue,
                `${a.cardName} allowlist entry needs a real tracking issue number`
            ).toBeGreaterThan(0);
            expect(
                a.reason.length,
                `${a.cardName} allowlist entry needs a reason`
            ).toBeGreaterThan(0);

            const card = cards.find((c) => c.id === a.cardId);
            expect(card, `no card with id ${a.cardId}`).toBeDefined();
            expect(
                card!.name,
                `allowlist row names "${a.cardName}" but ${a.cardId} is "${card!.name}"`
            ).toBe(a.cardName);

            // Load-bearing: re-run the detector on this card alone with an
            // EMPTY allowlist. If it reports nothing, the row is stale (the
            // card was fixed / the effect removed) and must be deleted.
            const raw = findUndeclaredOffenders([card!], []);
            expect(
                raw.filter((o) => o.includes(`"${a.kind}"`)),
                `${a.cardName}: allowlist row for "${a.kind}" no longer suppresses anything — stale, delete it`
            ).not.toEqual([]);
        }
    });

    it("the known counter-gated cards are all enrolled", () => {
        // Regression pin for the five cards the issue-#1711 sweep found that
        // are genuinely counter-CONDITIONED ("for as long as it has a …
        // counter"). A future refactor that drops the declaration from any of
        // them must fail here even if the source-scan heuristic above is ever
        // relaxed. Pouncing Kavu and Duskwalker are deliberately NOT here —
        // since issue #1716 their `keyword-grant` gates on the permanent's
        // own `wasKicked` flag, not a counter count, so they don't read
        // counters at all anymore and never needed `dependsOnCounters`.
        const expected = [
            "65d332e2-4b2d-4131-84f7-862cb138c477", // Dread Wight (ICE)
            "11fb92c0-bb1e-463a-a6b6-887a5d0cb873", // Venarian Gold (LEG)
            "a82c87b1-de37-4423-a1a4-533a1d8108b2", // Cocoon (LEG)
            "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d", // Cyclopean Tomb (LEA)
            "e2b15221-c8b0-4861-9f8b-8a65834ad499", // Gaea's Liege (LEA)
        ];

        const enrolled = new Set(
            getAllCards()
                .filter((c) =>
                    staticEffectsOf(c).some((e) => e.dependsOnCounters === true)
                )
                .map((c) => c.id)
        );

        for (const id of expected) expect(enrolled).toContain(id);
    });

    it("no card counter-gates a `control-change` (the refresh cannot reach it)", () => {
        // `control-change` is materialized by `applyAuraControlChange`, NOT by
        // `applySourceStaticEffects` — so `refreshCounterGatedStatics`
        // (unapply + re-apply) has no branch that would re-evaluate it and
        // `dependsOnCounters` on one would be a silent no-op. Nothing in the
        // catalogue does this today; if a card ever needs it, the refresh has
        // to learn control changes first rather than the author reaching for a
        // flag that does nothing.
        const gated = getAllCards().flatMap((card) =>
            staticEffectsOf(card)
                .filter(
                    (e) =>
                        KIND_MATERIALIZATION[e.kind] ===
                            "materialized-unrefreshable" &&
                        predicateSources(e).some(readsCounters)
                )
                .map((e) => `${card.name} (${card.id}) — "${e.kind}"`)
        );

        expect(gated, gated.join("\n")).toEqual([]);
    });
});
