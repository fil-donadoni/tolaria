// Occurrence ownership of granted keywords (CR 113.1 / 611.2a / 611.2c /
// 613.1f, issue #1706).
//
// `CardInstanceState.staticAbilities` is a flat MULTISET of keyword strings
// with no provenance on the entries themselves — provenance lives beside it on
// `grantedStaticAbilities`. Every teardown therefore removes an occurrence by
// `indexOf` + splice, and the entries being indistinguishable means WHICH index
// is spliced is never the question. The question is whether the COUNT stays
// right, and that holds exactly when the ownership accounting is exact:
//
//   * a grant pushes its OWN occurrence on apply — it never piggybacks on one
//     another source (or the printed card) already put there, so idempotence
//     keys on the grant's own `grantedStaticAbilities` record and never on
//     `staticAbilities.includes(...)`;
//   * a `suppressed` grant (CR 613.1f) owns ZERO LIVE occurrences and never
//     splices `staticAbilities` — but the `removedKeywords` entry that
//     outranked it at apply time is still on record, and a FINAL (not
//     transient) release must cancel that specific hold, or the stripper's
//     own later unapply hands the occurrence to nobody once the grant is
//     gone (issue #1750 part b — see "a suppressed grant releases its debt"
//     below);
//   * a STRIPPER (`removedKeywords` / `temporaryRemovedKeywords`) TAKES one
//     occurrence and holds it until it restores it — so a grant released while
//     a stripper holds its occurrence must cancel that hold, or the restore
//     resurrects an occurrence whose owner is long gone.
//
// One test per producer row of the issue's census, including the must-NOT rows
// (a differently-sourced grant that must SURVIVE another grant's teardown).
import { describe, it, expect } from "vitest";
import {
    applySourceStaticEffects,
    buildSpellContext,
    releaseGrantedKeywordOccurrence,
    removePermanentTo,
    unapplySourceStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import { finalizeCleanup } from "../phases";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { airElemental, flight } from "../../cards/sets/lea/blue";
import { gravitySphere } from "../../cards/sets/leg/red";

const UNTIL_EOT = { phase: "end-of-turn" } as const;

function makeBoard(bear: CardInstanceState, extra: CardInstanceState[] = []) {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [bear, ...extra] }),
            makePlayer("p2"),
        ],
    });
}

function ctxFor(state: GameState) {
    const item: StackItem = pushSpell(state, grizzlyBears.id, "p1");
    return buildSpellContext(state, item);
}

/** How many occurrences of `keyword` the permanent currently carries — the
 *  only quantity the multiset model cares about. */
function count(card: CardInstanceState, keyword: string): number {
    return card.staticAbilities.filter((a) => a === keyword).length;
}

/** Drives the real CR 514.2 cleanup purge (not a hand-rolled tick). */
function runCleanup(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
}

describe("granted keyword occurrence ownership (CR 113.1, issue #1706)", () => {
    describe("keyword counter vs. until-end-of-turn grant", () => {
        it("removing the counter keeps the until-EOT grant's flying (CR 122.1c)", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-1" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            ctx.addCounter({ type: "permanent", id: "bear-1" }, "flying", 1);
            ctx.grantStaticAbility(
                { type: "permanent", id: "bear-1" },
                "flying",
                UNTIL_EOT
            );
            // Two owners, two occurrences.
            expect(count(bear, "flying")).toBe(2);

            ctx.removeCounter({ type: "permanent", id: "bear-1" }, "flying", 1);

            // Exactly the counter's occurrence went; the until-EOT grant's
            // survives, and its provenance record is untouched.
            expect(count(bear, "flying")).toBe(1);
            expect(bear.counters?.flying).toBeUndefined();
            expect(bear.grantedStaticAbilities).toEqual([
                { ability: "flying", duration: { phase: "end-of-turn" } },
            ]);

            // Wire format — evasion is board-visible, so the surviving grant
            // must still read as flying after the projection.
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "bear-1"
            )!;
            expect(slim.staticAbilities).toContain("flying");
        });

        it("the CLEANUP purge keeps the counter grant's flying (CR 514.2)", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-2" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            ctx.grantStaticAbility(
                { type: "permanent", id: "bear-2" },
                "flying",
                UNTIL_EOT
            );
            ctx.addCounter({ type: "permanent", id: "bear-2" }, "flying", 1);
            expect(count(bear, "flying")).toBe(2);

            runCleanup(state);

            // The duration grant expired; the counter grant persists (CR
            // 122.1c — it lasts as long as a counter of the type remains).
            expect(count(bear, "flying")).toBe(1);
            expect(bear.grantedStaticAbilities).toEqual([
                { ability: "flying", counterType: "flying" },
            ]);
        });

        it("a natively-printed keyword survives a counter grant's teardown (CR 113.1)", () => {
            const elemental = makeInstance(airElemental.id, { id: "ae-1" });
            const state = makeBoard(elemental);
            const ctx = ctxFor(state);
            expect(count(elemental, "flying")).toBe(1);

            ctx.addCounter({ type: "permanent", id: "ae-1" }, "flying", 1);
            expect(count(elemental, "flying")).toBe(2);
            ctx.removeCounter({ type: "permanent", id: "ae-1" }, "flying", 1);

            expect(count(elemental, "flying")).toBe(1);
        });
    });

    describe("an add must own its occurrence, never piggyback (CR 611.2c)", () => {
        it("an indefinite grant survives the CLEANUP purge of an until-EOT grant of the same keyword", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-3" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            ctx.grantStaticAbility(
                { type: "permanent", id: "bear-3" },
                "flying",
                UNTIL_EOT
            );
            // Cocoon's "that creature gains flying" — no duration, no source
            // dependency. It must record its own occupancy even though flying
            // is already on the array.
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: "bear-3" },
                "flying"
            );
            expect(count(bear, "flying")).toBe(2);

            runCleanup(state);

            expect(count(bear, "flying")).toBe(1);
            expect(bear.grantedStaticAbilities).toEqual([
                { ability: "flying" },
            ]);
        });

        it("a second indefinite grant of the same keyword stays idempotent", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-4" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: "bear-4" },
                "flying"
            );
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: "bear-4" },
                "flying"
            );

            expect(count(bear, "flying")).toBe(1);
            expect(bear.grantedStaticAbilities).toEqual([
                { ability: "flying" },
            ]);
        });

        it("an animate-granted keyword survives an until-EOT grant's purge", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-5" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            ctx.grantStaticAbility(
                { type: "permanent", id: "bear-5" },
                "haste",
                UNTIL_EOT
            );
            // Earthbend N's "becomes a 0/0 creature with haste" — indefinite
            // (CR 611.2c), cleared only when the permanent leaves play.
            ctx.animateAsCreature({ type: "permanent", id: "bear-5" }, {
                power: 0,
                toughness: 0,
                grantedAbilities: ["haste"],
            } as Parameters<typeof ctx.animateAsCreature>[1]);
            expect(count(bear, "haste")).toBe(2);

            runCleanup(state);

            expect(count(bear, "haste")).toBe(1);
        });
    });

    describe("a release must reclaim its occurrence from a stripper (CR 613.1f)", () => {
        it("an until-EOT grant purged at CLEANUP under Gravity Sphere does not come back when the Sphere leaves", () => {
            // The CLEANUP duration purge (`gre/phases.ts`) is the site issue
            // #1706 names by line number, and the stripper-hold reclaim is the
            // half of it nothing else reaches: every other reclaim test enters
            // through `removeCounter` or `unapplySourceStaticEffects`.
            const bear = makeInstance(grizzlyBears.id, { id: "bear-9" });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere-4" });
            const state = makeBoard(bear, [sphere]);
            const ctx = ctxFor(state);

            ctx.grantStaticAbility(
                { type: "permanent", id: "bear-9" },
                "flying",
                UNTIL_EOT
            );
            expect(count(bear, "flying")).toBe(1);

            // "All creatures lose flying" takes the occurrence and holds it.
            applySourceStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);
            expect(bear.removedKeywords).toHaveLength(1);

            // The grant expires while the Sphere is still on the battlefield:
            // the purge releases the grant's occupancy from the HOLD, since
            // that is where the occurrence it owns currently sits.
            runCleanup(state);
            expect(bear.grantedStaticAbilities).toBeUndefined();
            expect(bear.removedKeywords).toBeUndefined();

            // Sphere leaves — there is nothing left to restore. Without the
            // reclaim the restore resurrects an occurrence whose owner expired
            // at end of turn: phantom flying.
            unapplySourceStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);

            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "bear-9"
            )!;
            expect(slim.staticAbilities).not.toContain("flying");
        });

        it("a counter grant removed under Gravity Sphere does not come back when the Sphere leaves", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-6" });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere-1" });
            const state = makeBoard(bear, [sphere]);
            const ctx = ctxFor(state);

            ctx.addCounter({ type: "permanent", id: "bear-6" }, "flying", 1);
            expect(count(bear, "flying")).toBe(1);

            // "All creatures lose flying" takes the occurrence and holds it.
            applySourceStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);
            expect(bear.removedKeywords).toHaveLength(1);

            // The counter runs out while the Sphere is still on the
            // battlefield: the grant's occupancy is released from the HOLD.
            ctx.removeCounter({ type: "permanent", id: "bear-6" }, "flying", 1);
            expect(bear.grantedStaticAbilities ?? []).toHaveLength(0);
            expect(bear.removedKeywords).toBeUndefined();

            // Sphere leaves — there is no longer anything to restore.
            unapplySourceStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);

            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "bear-6"
            )!;
            expect(slim.staticAbilities).not.toContain("flying");
        });

        it("Gravity Sphere still restores the PRINTED flying it took", () => {
            const elemental = makeInstance(airElemental.id, { id: "ae-2" });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere-2" });
            const state = makeBoard(elemental, [sphere]);
            const ctx = ctxFor(state);

            ctx.addCounter({ type: "permanent", id: "ae-2" }, "flying", 1);
            expect(count(elemental, "flying")).toBe(2);

            applySourceStaticEffects(state, sphere);
            // Occupancy BOOKKEEPING only — deliberately not "how many
            // occurrences survive". Layer-6 `keyword-remove` takes ONE
            // occurrence and records one hold, so a doubled keyword still reads
            // as present under "all creatures lose flying": a live CR 613.1f
            // defect, pre-existing and outside this fix's release-side model.
            // Asserting the survivor count here would lock that defect in.
            // tracked-by: #2198
            expect(elemental.removedKeywords).toHaveLength(1);

            ctx.removeCounter({ type: "permanent", id: "ae-2" }, "flying", 1);
            // The live occurrence belongs to the counter grant and is the one
            // released; the Sphere keeps holding the printed one.
            expect(count(elemental, "flying")).toBe(0);
            expect(elemental.removedKeywords).toHaveLength(1);

            unapplySourceStaticEffects(state, sphere);
            expect(count(elemental, "flying")).toBe(1);
        });

        it("an aura grant that leaves under Gravity Sphere does not come back when the Sphere leaves", () => {
            // The `unapplySourceStaticEffects` row of the census, FINAL
            // flavour: Flight is destroyed while the Sphere holds the
            // occurrence it granted. (The TRANSIENT flavour — the counter-gated
            // refresh, which must NOT cancel the hold — is guarded by
            // `staticEffectRefresh.test.ts`.)
            const bear = makeInstance(grizzlyBears.id, { id: "bear-8" });
            const aura = makeInstance(flight.id, {
                id: "flight-1",
                attachedTo: "bear-8",
            });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere-3" });
            const state = makeBoard(bear, [aura, sphere]);

            applySourceStaticEffects(state, aura);
            expect(count(bear, "flying")).toBe(1);
            applySourceStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);
            expect(bear.removedKeywords).toHaveLength(1);

            unapplySourceStaticEffects(state, aura);
            expect(bear.removedKeywords).toBeUndefined();

            unapplySourceStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);
        });

        it("a counter grant removed under a duration-scoped strip does not come back at CLEANUP", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-7" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            ctx.addCounter({ type: "permanent", id: "bear-7" }, "flying", 1);
            // Shelkin Brownie shape: "loses <keyword> until end of turn".
            ctx.removeStaticAbilities(
                { type: "permanent", id: "bear-7" },
                (kw) => kw === "flying",
                UNTIL_EOT
            );
            expect(count(bear, "flying")).toBe(0);
            expect(bear.temporaryRemovedKeywords).toHaveLength(1);

            ctx.removeCounter({ type: "permanent", id: "bear-7" }, "flying", 1);
            expect(bear.temporaryRemovedKeywords).toBeUndefined();

            runCleanup(state);
            expect(count(bear, "flying")).toBe(0);
        });

        it("a duration-scoped strip does NOT survive a bounce — the keyword is back in hand (CR 400.7)", () => {
            // CR 400.7 — the card that leaves the battlefield is a new object
            // with no memory of its previous existence, so it cannot still be
            // missing a printed keyword. The duration-scoped hold is the half
            // nothing else can release: the expiry purge (`phases.ts`
            // `finalizeCleanup`) scans the BATTLEFIELD only, so a hold that
            // leaves play with the card is otherwise held forever, and the
            // permanent stays flightless in every later zone.
            const elemental = makeInstance(airElemental.id, { id: "ae-4" });
            const state = makeBoard(elemental);
            const ctx = ctxFor(state);

            // Shelkin Brownie / Tolaria shape: "loses <keyword> until end of
            // turn", on the printed keyword this time (not a counter grant).
            ctx.removeStaticAbilities(
                { type: "permanent", id: "ae-4" },
                (kw) => kw === "flying",
                UNTIL_EOT
            );
            expect(count(elemental, "flying")).toBe(0);
            expect(elemental.temporaryRemovedKeywords).toHaveLength(1);

            removePermanentTo(state, "ae-4", "hand");
            const bounced = state.players[0].hand.find((c) => c.id === "ae-4")!;
            expect(count(bounced, "flying")).toBe(1);
            expect(bounced.temporaryRemovedKeywords).toBeUndefined();

            // And the purge that would have expired it never sees the card
            // again, so the restore above is the only one there is.
            runCleanup(state);
            expect(count(bounced, "flying")).toBe(1);
        });
    });

    describe("a suppressed grant owns nothing and releases nothing (CR 613.1f)", () => {
        it("the CLEANUP purge does not splice for a suppressed duration grant", () => {
            // Constructed directly: no shipped card currently produces a
            // SUPPRESSED grant that also carries a duration, which is exactly
            // why the purge's correctness here was accidental rather than
            // structural. The invariant must hold regardless of which producer
            // writes the record.
            const elemental = makeInstance(airElemental.id, { id: "ae-3" });
            elemental.grantedStaticAbilities = [
                {
                    ability: "flying",
                    duration: { phase: "end-of-turn" },
                    suppressed: true,
                },
            ];
            const state = makeBoard(elemental);
            expect(count(elemental, "flying")).toBe(1);

            runCleanup(state);

            // The printed flying is untouched — the expired grant never had an
            // occurrence of its own to give back.
            expect(count(elemental, "flying")).toBe(1);
            expect(elemental.grantedStaticAbilities).toBeUndefined();
        });
    });

    describe("a suppressed grant releases its debt when its source leaves before the stripper does (CR 613.1f, issue #1750 part b)", () => {
        // Constructed directly, same precedent as the block above: no shipped
        // card produces a condition- or counter-gated `keyword-grant` that
        // ALSO gets outranked by a stripper (the only way a grant is ever
        // marked `suppressed` is `refreshCounterGatedStatics`'s preserve-
        // timestamp reapply — Kavu Runner is the one shipped condition-gated
        // `keyword-grant`, and nothing strips its self-granted haste). The
        // shape below is exactly what that mechanism leaves behind: a
        // `suppressed` grant record, and the stripper's `removedKeywords`
        // hold that outranked it (taken from the grant's own occurrence
        // BEFORE the refresh that suppressed it — issue #1750's own scenario
        // has no printed keyword and no other live source in the mix, so the
        // hold is UNAMBIGUOUSLY the departing grant's own escrowed unit; a
        // hold shared with a printed keyword or another still-live source is
        // a deeper, separate model limitation — tracked-by:
        // docs/findings/1750-shared-hold-cross-contamination.md, out of
        // scope here).
        function suppressedScenario(bearId: string) {
            const bear = makeInstance(grizzlyBears.id, { id: bearId });
            bear.grantedStaticAbilities = [
                {
                    ability: "flying",
                    auraId: "grant-src",
                    seq: 1,
                    suppressed: true,
                },
            ];
            bear.removedKeywords = [
                { keyword: "flying", sourceId: "stripper-src", seq: 2 },
            ];
            const state = makeBoard(bear);
            const grantSrc = makeInstance(grizzlyBears.id, { id: "grant-src" });
            const stripperSrc = makeInstance(grizzlyBears.id, {
                id: "stripper-src",
            });
            return { bear, state, grantSrc, stripperSrc };
        }

        it("the grant's source leaving cancels the outranking hold — no phantom when the stripper leaves later", () => {
            const { bear, state, grantSrc, stripperSrc } =
                suppressedScenario("bear-10");
            expect(count(bear, "flying")).toBe(0);

            unapplySourceStaticEffects(state, grantSrc);

            // The debt is CANCELLED, not merely dropped: `grantedStaticAbilities`
            // loses its entry (as before the fix) AND the hold it was
            // outranked by is gone too.
            expect(bear.grantedStaticAbilities).toBeUndefined();
            expect(bear.removedKeywords).toBeUndefined();
            expect(count(bear, "flying")).toBe(0);

            unapplySourceStaticEffects(state, stripperSrc);

            // Exact inverses in THIS direction too (issue #1750 falsified
            // #1730's commit-message claim specifically here): the stripper's
            // later departure does not hand an occurrence to the printed
            // card — there is nothing left to restore.
            expect(count(bear, "flying")).toBe(0);

            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "bear-10"
            )!;
            expect(slim.staticAbilities).not.toContain("flying");
        });

        it("a TRANSIENT release does not cancel the hold — the immediate reapply still needs it on record", () => {
            const { bear, state, grantSrc } = suppressedScenario("bear-11");

            unapplySourceStaticEffects(state, grantSrc, { transient: true });

            // A refresh round trip's teardown half must leave the hold
            // exactly as it found it, or the immediate reapply can no longer
            // see it and re-decide suppression (CR 613.1f).
            expect(bear.removedKeywords).toEqual([
                { keyword: "flying", sourceId: "stripper-src", seq: 2 },
            ]);
        });

        it("the stripper leaving FIRST still restores normally — this fix only changes the OTHER order", () => {
            const { bear, state, grantSrc, stripperSrc } =
                suppressedScenario("bear-12");

            // Stripper leaves first: restores the occurrence and un-suppresses
            // the grant (pre-existing behavior, unchanged by this fix).
            unapplySourceStaticEffects(state, stripperSrc);
            expect(count(bear, "flying")).toBe(1);
            expect(bear.grantedStaticAbilities).toEqual([
                { ability: "flying", auraId: "grant-src", seq: 1 },
            ]);
            expect(bear.removedKeywords).toBeUndefined();

            // Grant's source leaves second, now un-suppressed: releases its
            // own live occurrence normally.
            unapplySourceStaticEffects(state, grantSrc);
            expect(count(bear, "flying")).toBe(0);
        });

        it("2+ suppressed grants of the same keyword: the restore credits the LOWEST seq, not array position", () => {
            // Issue #1750's second `.find` finding, same site: with multiple
            // suppressed grants referencing the same hold, the stripper's
            // restore must hand the occurrence to the EARLIEST (lowest-seq)
            // one — the one CR 613.7 layer order would actually reapply
            // first — not whichever happens to sit first in the array.
            const bear = makeInstance(grizzlyBears.id, { id: "bear-13" });
            // Deliberately array-ordered so the HIGHER-seq grant sits FIRST —
            // a `.find` picking by array position would credit the wrong one.
            bear.grantedStaticAbilities = [
                {
                    ability: "flying",
                    auraId: "grant-b",
                    seq: 3,
                    suppressed: true,
                },
                {
                    ability: "flying",
                    auraId: "grant-a",
                    seq: 1,
                    suppressed: true,
                },
            ];
            bear.removedKeywords = [
                { keyword: "flying", sourceId: "stripper-src", seq: 5 },
            ];
            const state = makeBoard(bear);
            const stripperSrc = makeInstance(grizzlyBears.id, {
                id: "stripper-src",
            });

            unapplySourceStaticEffects(state, stripperSrc);

            expect(count(bear, "flying")).toBe(1);
            expect(bear.grantedStaticAbilities).toEqual([
                {
                    ability: "flying",
                    auraId: "grant-b",
                    seq: 3,
                    suppressed: true,
                },
                { ability: "flying", auraId: "grant-a", seq: 1 },
            ]);
        });

        it("a source's own removedKeywords entry is never mistaken for its debt (issue #1750, round 2 finding 3)", () => {
            // CR 613.1f layer order makes a source outranking its OWN grant
            // impossible — the apply-time `outrankedBy` check already
            // excludes `r.sourceId !== source.id` — so a `removedKeywords`
            // entry sharing the departing grant's `auraId` can only be an
            // unrelated record that happens to name the same id in this
            // constructed scenario. It must never be picked as the debt this
            // release cancels, and the REAL outranking hold (from a
            // different source) must still be the one that IS cancelled.
            //
            // Calls `releaseGrantedKeywordOccurrence` directly rather than
            // through `unapplySourceStaticEffects`: that wrapper has its OWN
            // separate `removedKeywords` restore block, keyed on `r.sourceId
            // === source.id`, which would legitimately also touch a
            // same-id entry and mask what this test is isolating.
            const bear = makeInstance(grizzlyBears.id, { id: "bear-14" });
            bear.staticAbilities = [];
            bear.removedKeywords = [
                // Shares the grant's own source id. The LOWER seq means an
                // unguarded scan (picking the lowest QUALIFYING seq) would
                // wrongly prefer this entry over the real hold below.
                { keyword: "flying", sourceId: "self-src", seq: 2 },
                // The real outranking hold, from an unrelated stripper.
                { keyword: "flying", sourceId: "other-stripper", seq: 3 },
            ];
            const grant = {
                ability: "flying",
                auraId: "self-src",
                seq: 1,
                suppressed: true,
            };

            releaseGrantedKeywordOccurrence(bear, grant);

            // The self-sourced entry survives untouched; the unrelated
            // stripper's hold is the one actually cancelled.
            expect(bear.removedKeywords).toEqual([
                { keyword: "flying", sourceId: "self-src", seq: 2 },
            ]);
        });
    });
});
