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
    beginApplyingStaticEffects,
    buildSpellContext,
    recomputeContinuousEffects,
    removePermanentTo,
    stopApplyingStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import { finalizeCleanup } from "../phases";
import { continuousEffectsInLayer } from "../continuousEffects";
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
import {
    grantedKeywordRows,
    removedKeywordRows,
} from "../../cards/__tests__/setup";

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

/** CR 400.7 / 613.1f — a source STOPS applying by LEAVING the battlefield.
 *  Layer 6 is derived from the live board (PRD #2064 S3), so calling the
 *  teardown while the permanent is still in the array proves nothing: it keeps
 *  applying. Production splices it out immediately after
 *  (`removePermanentTo`); so does this. */
function leaveBattlefield(state: GameState, card: CardInstanceState): void {
    stopApplyingStaticEffects(state, card);
    for (const player of state.players) {
        player.battlefield = player.battlefield.filter((c) => c.id !== card.id);
    }
    recomputeContinuousEffects(state);
}

/** Drives the real CR 514.2 cleanup purge (not a hand-rolled tick). */
/** The expiry KIND of every live layer-6 registry entry on `id`, which
 *  is where a grant's provenance lives since PRD #2064 S6b — `duration`
 *  for an until-EOT grant, `counter` for a keyword counter's,
 *  `indefinite` for one that outlives everything but the permanent. */
function layer6ExpiriesOn(state: GameState, id: string): string[] {
    return continuousEffectsInLayer(state, 6)
        .filter(
            (e) =>
                e.affected.kind === "instances" &&
                e.affected.instanceIds.includes(id)
        )
        .map((e) => e.expiry.kind);
}

/** The live duration-scoped `keyword-remove` entries on `id`
 *  (PRD #2064 S6b — what `temporaryRemovedKeywords` used to hold). */
function durationRemovalsOn(state: GameState, id: string) {
    return continuousEffectsInLayer(state, 6).filter(
        (e) =>
            e.expiry.kind === "duration" &&
            e.payload.kind === "keyword-remove" &&
            e.affected.kind === "instances" &&
            e.affected.instanceIds.includes(id)
    );
}

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
            // PRD #2064 S6b — the provenance is the registry ENTRY's expiry.
            expect(layer6ExpiriesOn(state, "bear-1")).toEqual(["duration"]);

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
            expect(layer6ExpiriesOn(state, "bear-2")).toEqual(["counter"]);
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
            expect(layer6ExpiriesOn(state, bear.id)).toEqual(["indefinite"]);
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
            expect(layer6ExpiriesOn(state, bear.id)).toEqual(["indefinite"]);
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
            // through `removeCounter` or `stopApplyingStaticEffects`.
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
            beginApplyingStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);
            expect(removedKeywordRows(state, bear)).toHaveLength(1);

            // The grant expires while the Sphere is still on the battlefield:
            // the purge releases the grant's occupancy from the HOLD, since
            // that is where the occurrence it owns currently sits.
            runCleanup(state);
            expect(layer6ExpiriesOn(state, bear.id)).toEqual([]);
            expect(removedKeywordRows(state, bear)).toEqual([]);

            // Sphere leaves — there is nothing left to restore. Without the
            // reclaim the restore resurrects an occurrence whose owner expired
            // at end of turn: phantom flying.
            stopApplyingStaticEffects(state, sphere);
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
            beginApplyingStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);
            expect(removedKeywordRows(state, bear)).toHaveLength(1);

            // The counter runs out while the Sphere is still on the
            // battlefield: the grant's occupancy is released from the HOLD.
            ctx.removeCounter({ type: "permanent", id: "bear-6" }, "flying", 1);
            expect(grantedKeywordRows(state, bear)).toHaveLength(0);
            expect(removedKeywordRows(state, bear)).toEqual([]);

            // Sphere leaves — there is no longer anything to restore.
            stopApplyingStaticEffects(state, sphere);
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

            beginApplyingStaticEffects(state, sphere);
            // Occupancy BOOKKEEPING only — deliberately not "how many
            // occurrences survive". Layer-6 `keyword-remove` takes ONE
            // occurrence and records one hold, so a doubled keyword still reads
            // as present under "all creatures lose flying": a live CR 613.1f
            // defect, pre-existing and outside this fix's release-side model.
            // Asserting the survivor count here would lock that defect in.
            // tracked-by: #2198
            expect(removedKeywordRows(state, elemental)).toHaveLength(1);

            ctx.removeCounter({ type: "permanent", id: "ae-2" }, "flying", 1);
            // The live occurrence belongs to the counter grant and is the one
            // released; the Sphere keeps holding the printed one.
            expect(count(elemental, "flying")).toBe(0);
            expect(removedKeywordRows(state, elemental)).toHaveLength(1);

            stopApplyingStaticEffects(state, sphere);
            expect(count(elemental, "flying")).toBe(1);
        });

        it("an aura grant that leaves under Gravity Sphere does not come back when the Sphere leaves", () => {
            // The `stopApplyingStaticEffects` row of the census, FINAL
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

            beginApplyingStaticEffects(state, aura);
            expect(count(bear, "flying")).toBe(1);
            beginApplyingStaticEffects(state, sphere);
            expect(count(bear, "flying")).toBe(0);
            expect(removedKeywordRows(state, bear)).toHaveLength(1);

            leaveBattlefield(state, aura);
            expect(count(bear, "flying")).toBe(0);
            // Nothing is being held down any more — the grant that was being
            // stripped is simply no longer derived.
            expect(removedKeywordRows(state, bear)).toEqual([]);

            leaveBattlefield(state, sphere);
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
            expect(durationRemovalsOn(state, "bear-7")).toHaveLength(1);

            ctx.removeCounter({ type: "permanent", id: "bear-7" }, "flying", 1);
            // The duration-scoped removal is still on record — nothing was
            // ever taken from anyone, so there is no hold to cancel — and the
            // counter's grant has simply stopped being derived (CR 122.1b).
            expect(count(bear, "flying")).toBe(0);

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
            expect(durationRemovalsOn(state, "ae-4")).toHaveLength(1);

            removePermanentTo(state, "ae-4", "hand");
            const bounced = state.players[0].hand.find((c) => c.id === "ae-4")!;
            expect(count(bounced, "flying")).toBe(1);
            // PRD #2064 S6b — the hold is a REGISTRY entry now, and the release
            // is CR 400.7's `purgeContinuousEffectsForInstance` (S6a) rather
            // than a `delete` on the instance. Same fact, one owner.
            expect(durationRemovalsOn(state, "ae-4")).toHaveLength(0);

            // And the purge that would have expired it never sees the card
            // again, so the restore above is the only one there is.
            runCleanup(state);
            expect(count(bounced, "flying")).toBe(1);
        });
    });

    // PRD #2064 S6b — "a suppressed grant owns nothing and releases nothing
    // (CR 613.1f)" stood here, pinning that the CLEANUP purge did not splice a
    // `staticAbilities` occurrence for a grant recorded `suppressed`. Its
    // subject is gone in both halves: the purge loop it exercised was deleted
    // with the instance ledger it ticked (`gre/phases.ts` — the registry's own
    // `tickContinuousEffectDurations` counts CR 611.2a boundaries now), and the
    // row it had to construct by hand — `duration` plus `suppressed` — can no
    // longer be built, because `duration` is an ENTRY's expiry and `suppressed`
    // is written only on the derived aura path.
    //
    // The invariant survives structurally rather than by accounting: an expired
    // entry is spliced from the registry and the derivation simply stops
    // composing it, so there is no give-back step for a suppressed grant to be
    // wrongly credited by. That is the same reason the four ESCROW tests below
    // were replaced by a direct statement of what they protected.

    // ────────────────────────────────────────────────────────────────────
    // What replaced the ESCROW model (issues #1706 / #1750, PRD #2064 S3).
    //
    // Layer 6 used to materialise grants and removals onto the instance, so a
    // grant outranked at apply time had to be recorded `suppressed`, the
    // stripper's `removedKeywords` entry had to be treated as a DEBT owed back,
    // and every teardown had to decide which grant to credit it to — by lowest
    // `seq`, never by array position. Four tests guarded that accounting, and
    // two shipped bugs came out of it.
    //
    // There is no accounting left to guard. `deriveLayer6` walks the entries in
    // CR 613.7 order once, per read: a grant that a later stripper outranks is
    // simply not in the result, and nothing has to remember that it wasn't. The
    // INVARIANT those tests protected is still worth a guard, so it is stated
    // here directly, in both departure orders, through real sources.
    // ────────────────────────────────────────────────────────────────────
    describe("a grant outranked by a later stripper (CR 613.1f / 613.7)", () => {
        function outrankedBoard(bearId: string) {
            // A Grizzly Bear prints no flying, so every occurrence in play is
            // accounted for by a live source — the scenario issue #1750 needed
            // and could only fake.
            const bear = makeInstance(grizzlyBears.id, { id: bearId });
            const aura = makeInstance(flight.id, {
                id: `${bearId}-flight`,
                attachedTo: bearId,
            });
            const sphere = makeInstance(gravitySphere.id, {
                id: `${bearId}-sphere`,
            });
            const state = makeBoard(bear, [aura, sphere]);
            beginApplyingStaticEffects(state, aura); // earlier timestamp
            beginApplyingStaticEffects(state, sphere); // later — outranks it
            return { bear, state, aura, sphere };
        }

        it("does not apply while both are live", () => {
            const { bear } = outrankedBoard("bear-10");
            expect(count(bear, "flying")).toBe(0);
        });

        it("the GRANT's source leaving first leaves no phantom when the stripper leaves later", () => {
            const { bear, state, aura, sphere } = outrankedBoard("bear-11");

            leaveBattlefield(state, aura);
            expect(count(bear, "flying")).toBe(0);

            // The half issue #1750 got wrong: the stripper's own departure must
            // not hand an occurrence to the printed card, because the Bear
            // never had one.
            leaveBattlefield(state, sphere);
            expect(count(bear, "flying")).toBe(0);

            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "bear-11"
            )!;
            expect(slim.staticAbilities).not.toContain("flying");
        });

        it("the STRIPPER leaving first restores the grant, and the grant's own departure takes it away again", () => {
            const { bear, state, aura, sphere } = outrankedBoard("bear-12");

            leaveBattlefield(state, sphere);
            expect(count(bear, "flying")).toBe(1);

            leaveBattlefield(state, aura);
            expect(count(bear, "flying")).toBe(0);
        });

        it("a recompute tick does not resurrect the outranked grant, however many times it runs", () => {
            // The `transient` teardown flag existed for exactly this: a
            // counter-gated refresh tore a source down and re-applied it, and
            // the re-apply had to re-read a hold to re-decide suppression. The
            // derivation re-decides everything from the board every time, so
            // the flag — and the way it could be forgotten — is gone.
            const { bear, state } = outrankedBoard("bear-13");
            for (let i = 0; i < 5; i++) recomputeContinuousEffects(state);
            expect(count(bear, "flying")).toBe(0);
        });

        it("a source that both grants and strips the same keyword never outranks itself", () => {
            // Issue #1750 round 2, finding 3. It used to be a rule the release
            // primitive had to encode (`r.sourceId === grant.auraId` -> skip);
            // it is now arithmetic — one source has ONE timestamp, and CR 613.7
            // ordering is strict, so its own removal can never be later than
            // its own grant.
            const bear = makeInstance(grizzlyBears.id, { id: "bear-14" });
            const aura = makeInstance(flight.id, {
                id: "bear-14-flight",
                attachedTo: "bear-14",
            });
            const state = makeBoard(bear, [aura]);
            beginApplyingStaticEffects(state, aura);
            expect(count(bear, "flying")).toBe(1);
        });
    });

    // CR 611.2a — "a continuous effect generated by the resolution of a spell
    // or ability lasts as long as stated by the spell or ability creating it
    // … if no duration is stated, it lasts until the end of the game." An
    // `animate` effect's `grantedAbilities` are part of the SAME clause as its
    // P/T and type line ("becomes a 3/3 green Ape creature WITH TRAMPLE until
    // end of turn", Treetop Village), so the grant carries that ability's own
    // duration — and an animate with no stated duration (Earthbend's haste,
    // Badgermole Cub) grants indefinitely.
    //
    // The re-application pair below is the whole point: the grant loop runs
    // even when the permanent is ALREADY animated, so a grant whose duration
    // is read off the LIVE animation record inherits the EARLIER effect's
    // boundary in both directions.
    describe("animate's granted keywords take THEIR OWN duration (CR 611.2a)", () => {
        it("an until-EOT animate grant expires at cleanup; an unbounded one does not", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-anim-1" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            ctx.animateAsCreature(
                { type: "permanent", id: "bear-anim-1" },
                {
                    power: 3,
                    toughness: 3,
                    grantedAbilities: ["trample"],
                    duration: UNTIL_EOT,
                }
            );
            expect(count(bear, "trample")).toBe(1);
            expect(layer6ExpiriesOn(state, "bear-anim-1")).toEqual([
                "duration",
            ]);

            runCleanup(state);
            expect(count(bear, "trample")).toBe(0);
        });

        it("an animate with NO stated duration still grants indefinitely", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-anim-2" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            ctx.animateAsCreature(
                { type: "permanent", id: "bear-anim-2" },
                { power: 0, toughness: 0, grantedAbilities: ["haste"] }
            );
            expect(layer6ExpiriesOn(state, "bear-anim-2")).toEqual([
                "indefinite",
            ]);

            runCleanup(state);
            expect(count(bear, "haste")).toBe(1);
        });

        it("a bounded grant onto an ALREADY indefinitely-animated permanent still ends at cleanup", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-anim-3" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            // Earthbend first: an INDEFINITE animation is now live, and its
            // record is the one a duration read off `card.animation` would find.
            ctx.animateAsCreature(
                { type: "permanent", id: "bear-anim-3" },
                { power: 0, toughness: 0, grantedAbilities: ["haste"] }
            );
            // Then the manland's until-end-of-turn clause.
            ctx.animateAsCreature(
                { type: "permanent", id: "bear-anim-3" },
                {
                    power: 3,
                    toughness: 3,
                    grantedAbilities: ["trample"],
                    duration: UNTIL_EOT,
                }
            );
            expect(layer6ExpiriesOn(state, "bear-anim-3").sort()).toEqual([
                "duration",
                "indefinite",
            ]);

            runCleanup(state);
            // The stated "until end of turn" governs its own grant …
            expect(count(bear, "trample")).toBe(0);
            // … and takes nothing else with it.
            expect(count(bear, "haste")).toBe(1);
        });

        it("an unbounded grant onto an ALREADY until-EOT-animated permanent survives cleanup", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear-anim-4" });
            const state = makeBoard(bear);
            const ctx = ctxFor(state);

            // The mirror ordering: the live record is now the BOUNDED one, and
            // an inherited duration would destroy the unbounded grant at 514.2.
            ctx.animateAsCreature(
                { type: "permanent", id: "bear-anim-4" },
                {
                    power: 3,
                    toughness: 3,
                    grantedAbilities: ["trample"],
                    duration: UNTIL_EOT,
                }
            );
            ctx.animateAsCreature(
                { type: "permanent", id: "bear-anim-4" },
                { power: 0, toughness: 0, grantedAbilities: ["haste"] }
            );

            runCleanup(state);
            expect(count(bear, "trample")).toBe(0);
            expect(count(bear, "haste")).toBe(1);
        });
    });
});
