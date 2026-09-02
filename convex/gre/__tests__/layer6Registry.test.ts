// Layer 6 derived from the Continuous Effects Registry (CR 613.1f / 613.7,
// ADR 0082, PRD #2064 S3).
//
// What this file guards is the SHAPE of the migration, not one card's rules
// text: that every ability grant, keyword removal and ability-loss effect is a
// registry entry differing only in EXPIRY, that ordering goes through the S1
// query rather than a per-site `staticSeq` comparison, that a grant's PARAMETER
// is recomputed per read instead of frozen into a string at materialisation
// time, and that the one channel none of the pre-registry channels could be —
// source-independent AND condition-gated at once — now exists.
//
// The CR 613.7 timestamp regressions of #1715 (Gravity Sphere -> Flight,
// Humility -> Fire Whip) stay where they were written, unedited:
// `staticEffectRefresh.test.ts` and `identitySwap.test.ts`.
import { describe, it, expect } from "vitest";
import {
    applySourceStaticEffects,
    buildSpellContext,
    refreshCounterGatedStatics,
    payRemoveCounterCost,
    removePermanentTo,
    unapplySourceStaticEffects,
    type CardInstanceState,
    type GameState,
} from "../state";
import { deriveLayer6, recomposeLayer6ForInstance } from "../layer6";
import {
    outrankedBy,
    renderKeyword,
    type ContinuousEffect,
} from "../continuousEffects";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { finalizeCleanup, untapStep } from "../phases";
import { withTemporaryDefinition } from "../../cards";
import { withTemporaryEmblemDefinition } from "../../cards/emblems";
import type {
    CardDefinition,
    PermanentView,
    StaticEffectContext,
} from "../../cards/types";
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
import { titaniasSong } from "../../cards/sets/atq/green";
import { ashnodsBattleGear } from "../../cards/sets/atq/colorless";
import { dreadWight } from "../../cards/sets/ice/black";
import {
    PHASE_EVENT_EOC,
    resolveTrigger,
} from "../../cards/sets/ice/__tests__/helpers";

const UNTIL_EOT = { phase: "end-of-turn" } as const;

function boardOf(...cards: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield: cards }), makePlayer("p2")],
    });
}

function ctxFor(state: GameState) {
    return buildSpellContext(state, pushSpell(state, grizzlyBears.id, "p1"));
}

function count(card: CardInstanceState, keyword: string): number {
    return card.staticAbilities.filter((a) => a === keyword).length;
}

/** The layer-6 entries the derivation builds for `card`, read back through the
 *  same walk production uses. Asserting on EXPIRY here is the point: the three
 *  provenances that used to be three different record shapes on the instance
 *  are one entry type that differs only by this. */
function expiriesOn(
    state: GameState,
    card: CardInstanceState
): ContinuousEffect["expiry"]["kind"][] {
    // `deriveLayer6` returns the composed result, not the entries; the expiry
    // census is taken from what actually applied, which is what a consumer can
    // observe. Kept as a helper so each test below reads one line.
    const seen: ContinuousEffect["expiry"]["kind"][] = [];
    for (const entry of state.continuousEffects ?? []) {
        if (entry.layer !== 6) continue;
        if (
            entry.affected.kind === "instances" &&
            !entry.affected.instanceIds.includes(card.id)
        ) {
            continue;
        }
        seen.push(entry.expiry.kind);
    }
    return seen;
}

describe("layer 6 derives from the registry (CR 613.1f, PRD #2064 S3)", () => {
    describe("the three grant provenances differ only in EXPIRY (CR 611.2)", () => {
        it("a SOURCE grant ends when its source leaves, and nothing revokes it", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear" });
            const aura = makeInstance(flight.id, {
                id: "aura",
                attachedTo: "bear",
            });
            const state = boardOf(bear, aura);
            applySourceStaticEffects(state, aura);
            expect(count(bear, "flying")).toBe(1);

            removePermanentTo(state, "aura", "graveyard");
            refreshCounterGatedStatics(state);
            expect(count(bear, "flying")).toBe(0);
        });

        it("a DURATION grant survives its source leaving and ends at its boundary", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear" });
            const state = boardOf(bear);
            const ctx = ctxFor(state);
            ctx.grantStaticAbility(
                { type: "permanent", id: "bear" },
                "flying",
                UNTIL_EOT
            );
            expect(count(bear, "flying")).toBe(1);

            // The spell that granted it has LEFT — the provenance a board walk
            // cannot reproduce, and the reason the registry exists at all.
            expect(bear.grantedStaticAbilities).toEqual([
                expect.objectContaining({ duration: { phase: "end-of-turn" } }),
            ]);
            refreshCounterGatedStatics(state);
            expect(count(bear, "flying")).toBe(1);
        });

        it("a COUNTER grant is gated on the counter and needs no unapply", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear" });
            const state = boardOf(bear);
            const ctx = ctxFor(state);
            ctx.addCounter({ type: "permanent", id: "bear" }, "flying", 1);
            expect(count(bear, "flying")).toBe(1);

            // Take the counter off WITHOUT going through any teardown — the
            // gate is the counter, so the derivation simply stops producing
            // the entry (CR 122.1b). "Revocation is not an operation."
            bear.counters = undefined;
            refreshCounterGatedStatics(state);
            expect(count(bear, "flying")).toBe(0);
        });

        it("a keyword REMOVAL splits the same way — source-keyed and duration-keyed", () => {
            const elemental = makeInstance(airElemental.id, { id: "ae" });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere" });
            const state = boardOf(elemental, sphere);

            // Source-keyed: Gravity Sphere, live on the battlefield.
            applySourceStaticEffects(state, sphere);
            expect(count(elemental, "flying")).toBe(0);
            removePermanentTo(state, "sphere", "graveyard");
            refreshCounterGatedStatics(state);
            expect(count(elemental, "flying")).toBe(1);

            // Duration-keyed: the same removal from a resolved spell.
            const ctx = ctxFor(state);
            ctx.removeStaticAbilities(
                { type: "permanent", id: "ae" },
                (kw) => kw === "flying",
                UNTIL_EOT
            );
            expect(count(elemental, "flying")).toBe(0);
        });
    });

    describe("ordering goes through the S1 query (CR 613.7)", () => {
        it("`outrankedBy` is STRICT, so an equal timestamp survives", () => {
            // The single comparison every layer-6 site now defers to. #1715 had
            // to harden four sites that each wrote `(a ?? 0) < b` inline.
            expect(outrankedBy(5, 5)).toBe(false);
            expect(outrankedBy(4, 5)).toBe(true);
            expect(outrankedBy(undefined, 5)).toBe(true);
            expect(outrankedBy(5, null)).toBe(false);
        });

        it("a resolving ability's grant carries a real timestamp, so it survives an earlier strip", () => {
            const bear = makeInstance(grizzlyBears.id, { id: "bear" });
            const state = boardOf(bear);
            const ctx = ctxFor(state);
            // Oko's `+1` shape: strip everything, indefinitely.
            ctx.loseAllAbilities({ type: "permanent", id: "bear" });
            // …then a LATER grant (CR 613.7 — Humility, then Fire Whip).
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: "bear" },
                "flying"
            );
            expect(count(bear, "flying")).toBe(1);

            // …and a strip AFTER the grant takes it back.
            ctx.loseAllAbilities({ type: "permanent", id: "bear" });
            expect(count(bear, "flying")).toBe(0);
        });
    });

    describe("a grant's PARAMETER is recomputed per read (CR 702.16a)", () => {
        /** A Bear variant whose static ability grants protection from the
         *  colour of the FIRST creature its controller's opponent controls —
         *  a parameter that only a live board read can produce. Under the
         *  pre-registry model the string was rendered once, at materialisation
         *  time, and nothing ever recomputed it. */
        const ADAPTIVE: CardDefinition = {
            ...grizzlyBears,
            staticEffects: [
                {
                    kind: "keyword-grant",
                    applies: (target: PermanentView, source: PermanentView) =>
                        target.id === source.id,
                    keyword: "protection from red",
                    keywordFor: (
                        _target: PermanentView,
                        source: PermanentView,
                        ctx: StaticEffectContext
                    ) => {
                        void ctx;
                        return source.subtypes.includes("Wizard")
                            ? "protection from blue"
                            : "protection from red";
                    },
                },
            ],
        };

        it("tracks a board change made AFTER the grant, with no re-application", () => {
            withTemporaryDefinition(ADAPTIVE, () => {
                const bear = makeInstance(ADAPTIVE.id, { id: "bear" });
                const state = boardOf(bear);
                applySourceStaticEffects(state, bear);
                expect(bear.staticAbilities).toContain("protection from red");

                // A layer-4 subtype change flips what the parameter computes
                // to. NOTHING re-applies the grant — the only thing that runs
                // is the recompute tick, exactly as it would after any board
                // change.
                // PRD #2064 S4 — `subtypes` is layer 4's DERIVED OUTPUT now, so
                // a hand-written change to the object's OWN line goes in the
                // base beside it; a bare assignment is overwritten by the very
                // recompute this test then triggers. Same shape as the
                // `baseStaticAbilities` half S3 introduced.
                bear.subtypes = [...bear.subtypes, "Wizard"];
                bear.baseSubtypes = [...bear.subtypes];
                refreshCounterGatedStatics(state);

                expect(bear.staticAbilities).toContain("protection from blue");
                expect(bear.staticAbilities).not.toContain(
                    "protection from red"
                );
            });
        });

        it("renders a STRUCTURED parameter rather than carrying a pre-rendered string", () => {
            // The inline payload half of the same property: an entry created by
            // a resolving ability carries the parameter, and the string every
            // consult site reads is produced from it at read time.
            expect(
                renderKeyword({
                    keyword: "protection",
                    parameter: { kind: "protection", qualities: ["red"] },
                })
            ).toBe("protection from red");
            expect(
                renderKeyword({
                    keyword: "protection",
                    parameter: {
                        kind: "protection",
                        qualities: ["red", "black"],
                    },
                })
            ).toBe("protection from red and from black");
            expect(
                renderKeyword({
                    keyword: "landwalk",
                    parameter: { kind: "landwalk", subtype: "Island" },
                })
            ).toBe("islandwalk");
            expect(
                renderKeyword({
                    keyword: "rampage",
                    parameter: { kind: "count", count: 2 },
                })
            ).toBe("rampage 2");
            // Total: no parameter means the keyword is already the whole thing.
            expect(renderKeyword({ keyword: "flying" })).toBe("flying");
        });
    });

    describe("Dread Wight — source-independent AND condition-gated (CR 611.2c)", () => {
        /** Dread Wight blocks a 5/5 and its end-of-combat trigger resolves, so
         *  the partner carries a paralyzation counter and the two continuous
         *  effects the trigger created. */
        function paralyzed(): {
            state: GameState;
            wight: CardInstanceState;
            victim: CardInstanceState;
        } {
            const wight = makeInstance(dreadWight.id, {
                id: "wight",
                controllerId: "p1",
                ownerId: "p1",
            });
            const victim = makeInstance(grizzlyBears.id, {
                id: "victim",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [wight] }),
                    makePlayer("p2", { battlefield: [victim] }),
                ],
                combat: {
                    attackerIds: ["victim"],
                    confirmed: true,
                    blockerAssignments: { victim: ["wight"] },
                    blockedAttackerIds: ["victim"],
                    blockersConfirmed: true,
                },
            });
            applySourceStaticEffects(state, wight);
            // The REAL trigger path (`resolveTrigger` pushes the ability onto
            // the stack with its firing event and resolves it), not a hand call
            // into `resolve`: the entries this slice adds are created by the
            // resolution, so a shortcut around it would prove nothing.
            resolveTrigger(
                state,
                wight,
                "dread-wight-end-of-combat",
                PHASE_EVENT_EOC("p1")
            );
            refreshCounterGatedStatics(state);
            return { state, wight, victim };
        }

        it("both clauses apply while the counter is there", () => {
            const { victim } = paralyzed();
            expect(victim.counters?.paralyzation).toBe(1);
            expect(victim.staticAbilities).toContain("does-not-untap");
            expect(
                getEffectiveActivatedAbilities(victim).map((g) => g.ability.id)
            ).toContain("dread-wight-remove-paralyzation");
        });

        it("BOTH persist when Dread Wight leaves while the counters remain", () => {
            const { state, victim } = paralyzed();

            removePermanentTo(state, "wight", "graveyard");
            refreshCounterGatedStatics(state);

            // The clause the DIVERGENCE marker confessed: the effects were
            // sourced from Dread Wight's own `staticEffects[]`, so both ended
            // with it. CR 611.2c — a continuous effect from a RESOLVING ability
            // does not depend on its source.
            expect(victim.counters?.paralyzation).toBe(1);
            expect(victim.staticAbilities).toContain("does-not-untap");
            expect(
                getEffectiveActivatedAbilities(victim).map((g) => g.ability.id)
            ).toContain("dread-wight-remove-paralyzation");

            // …and the untap lock is honoured by the real untap step, not just
            // present as a string.
            victim.isTapped = true;
            state.activePlayerId = "p2";
            state.priorityPlayerId = "p2";
            untapStep(state);
            expect(victim.isTapped).toBe(true);
        });

        it("BOTH stop the moment the last counter is removed, with Dread Wight gone", () => {
            const { state, victim } = paralyzed();
            removePermanentTo(state, "wight", "graveyard");
            refreshCounterGatedStatics(state);

            const ctx = ctxFor(state);
            ctx.removeCounter(
                { type: "permanent", id: "victim" },
                "paralyzation",
                1
            );

            expect(victim.staticAbilities).not.toContain("does-not-untap");
            expect(getEffectiveActivatedAbilities(victim)).toEqual([]);
            // No revoke primitive was called — the entries are still on the
            // registry, they simply no longer apply.
            expect(expiriesOn(state, victim)).toEqual(["counter", "counter"]);

            victim.isTapped = true;
            state.activePlayerId = "p2";
            state.priorityPlayerId = "p2";
            untapStep(state);
            expect(victim.isTapped).toBe(false);
        });

        it("wire format: the client sees the lock and the granted ability", () => {
            // The projection strips fat fields, so a GRE-only assertion passes
            // while the client breaks silently. `continuousEffects` is not on
            // the wire until PRD #2064 S5 — which is exactly why the DERIVED
            // `staticAbilities` must still carry the answer.
            const { state, victim } = paralyzed();
            removePermanentTo(state, "wight", "graveyard");
            refreshCounterGatedStatics(state);

            const projected = projectPublicState(state, 1, "p2");
            const slim = projected.players[1].battlefield.find(
                (c) => c.id === victim.id
            )!;
            expect(slim.staticAbilities).toContain("does-not-untap");
            expect(
                getEffectiveActivatedAbilities(
                    slim as unknown as CardInstanceState
                ).map((g) => g.ability.id)
            ).toContain("dread-wight-remove-paralyzation");
        });
    });

    describe("no consumer treats a materialised staticAbilities[] as input", () => {
        it("a hand-poisoned staticAbilities is overwritten by the next derivation", () => {
            // The property the whole slice rests on: the field is OUTPUT. A
            // value nothing in the registry accounts for cannot survive a
            // recompute, so no consumer can be reading an authority.
            const bear = makeInstance(grizzlyBears.id, { id: "bear" });
            const state = boardOf(bear);
            refreshCounterGatedStatics(state);
            bear.staticAbilities = [...bear.staticAbilities, "flying"];

            refreshCounterGatedStatics(state);
            expect(bear.staticAbilities).not.toContain("flying");
        });

        it("the derivation reads the BASE, never its own previous output", () => {
            const elemental = makeInstance(airElemental.id, { id: "ae" });
            const state = boardOf(elemental);
            refreshCounterGatedStatics(state);
            expect(elemental.baseStaticAbilities).toEqual(["flying"]);

            // Idempotent over any number of recomputes — a derivation that fed
            // its own output back in would accumulate.
            for (let i = 0; i < 5; i++) refreshCounterGatedStatics(state);
            expect(count(elemental, "flying")).toBe(1);
        });

        it("unapplying a source is visible immediately, before the array catches up", () => {
            // `unapplySourceStaticEffects` runs BEFORE the permanent is spliced
            // out of the battlefield, so board presence and "is applying"
            // disagree for exactly that instant.
            const elemental = makeInstance(airElemental.id, { id: "ae" });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere" });
            const state = boardOf(elemental, sphere);
            applySourceStaticEffects(state, sphere);
            expect(count(elemental, "flying")).toBe(0);

            unapplySourceStaticEffects(state, sphere);
            expect(count(elemental, "flying")).toBe(1);
        });
    });
});

describe("review round 1 — the holes the derivation opened (PR #3032)", () => {
    describe("the base capture is layer 6's INVERSE, not half of it", () => {
        /** A permanent as a state PERSISTED BEFORE this slice holds it: the
         *  strip already materialised onto `staticAbilities`, its record on the
         *  instance, and no `baseStaticAbilities` — the tell for the migration
         *  window. */
        function legacyStrippedElemental(
            record: Partial<CardInstanceState>
        ): CardInstanceState {
            const elemental = makeInstance(airElemental.id, { id: "ae" });
            elemental.staticAbilities = [];
            Object.assign(elemental, record);
            return elemental;
        }

        it("gives back a keyword a source-keyed removal had taken", () => {
            // base = staticAbilities + removals - grants. Subtracting the
            // grants alone captured this Elemental's base as [] and it never
            // flew again, however long after the Sphere died.
            const elemental = legacyStrippedElemental({
                removedKeywords: [
                    { keyword: "flying", sourceId: "sphere", seq: 1 },
                ],
            });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere" });
            const state = boardOf(elemental, sphere);
            applySourceStaticEffects(state, sphere);

            expect(elemental.baseStaticAbilities).toEqual(["flying"]);
            expect(count(elemental, "flying")).toBe(0);
            removePermanentTo(state, "sphere", "graveyard");
            refreshCounterGatedStatics(state);
            expect(count(elemental, "flying")).toBe(1);
        });

        it("gives back a keyword a DURATION-scoped removal had taken", () => {
            const elemental = legacyStrippedElemental({
                temporaryRemovedKeywords: [
                    { keyword: "flying", duration: { phase: "end-of-turn" } },
                ],
            });
            const state = boardOf(elemental);
            refreshCounterGatedStatics(state);

            expect(elemental.baseStaticAbilities).toEqual(["flying"]);
            expect(count(elemental, "flying")).toBe(0);
            state.phase = "CLEANUP";
            finalizeCleanup(state);
            expect(count(elemental, "flying")).toBe(1);
        });

        it("gives back a keyword a continuous ABILITY-LOSS had cleared", () => {
            // Titania's Song strips NONCREATURE ARTIFACTS (CR 613.1f), so the
            // subject is one that prints a keyword.
            const gear = makeInstance(ashnodsBattleGear.id, { id: "gear" });
            gear.staticAbilities = [];
            gear.removedKeywords = [
                {
                    keyword: "may-choose-not-to-untap",
                    sourceId: "song",
                    seq: 1,
                },
            ];
            gear.abilitiesSuppressedBy = [{ sourceId: "song", seq: 1 }];
            const song = makeInstance(titaniasSong.id, { id: "song" });
            const state = boardOf(gear, song);
            applySourceStaticEffects(state, song);

            expect(gear.baseStaticAbilities).toEqual([
                "may-choose-not-to-untap",
            ]);
            // Titania's Song is LIVE and declares the `ability-loss`, so the
            // derivation reproduces the strip on its own — the legacy ledger
            // must NOT be seeded, or the strip would outlive its own predicate
            // (the Song makes the Gear a CREATURE, at which point its own
            // `applies` stops matching).
            expect(gear.abilityLossHolds).toBeUndefined();
            expect(count(gear, "may-choose-not-to-untap")).toBe(0);

            removePermanentTo(state, "song", "graveyard");
            refreshCounterGatedStatics(state);
            expect(count(gear, "may-choose-not-to-untap")).toBe(1);
        });

        it("SEEDS the ledger for a hold no live source reproduces", () => {
            // The resolving arm (CR 611.2b — Tishana's Tidebinder keys its hold
            // to a permanent that declares no `ability-loss` static ability).
            // Nothing re-derives it, so the legacy row is the only record and
            // must survive the migration.
            const elemental = legacyStrippedElemental({
                removedKeywords: [
                    { keyword: "flying", sourceId: "binder", seq: 1 },
                ],
                abilitiesSuppressedBy: [{ sourceId: "binder", seq: 1 }],
            });
            const binder = makeInstance(grizzlyBears.id, { id: "binder" });
            const state = boardOf(elemental, binder);
            applySourceStaticEffects(state, binder);
            refreshCounterGatedStatics(state);

            expect(elemental.abilityLossHolds).toEqual([
                { sourceId: "binder", seq: 1 },
            ]);
            expect(count(elemental, "flying")).toBe(0);
        });

        it("survives a base CLEAR while a grant and a strip are both live", () => {
            // The same arithmetic on a FRESH state: an identity swap or a
            // CR 614.12c body choice drops the base, and the re-capture reads
            // this module's own output back the other way.
            const elemental = makeInstance(airElemental.id, { id: "ae" });
            const state = boardOf(elemental);
            const ctx = ctxFor(state);
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: "ae" },
                "trample"
            );
            ctx.loseAllAbilities({ type: "permanent", id: "ae" });
            expect(elemental.staticAbilities).toEqual([]);

            delete elemental.baseStaticAbilities;
            refreshCounterGatedStatics(state);

            expect(elemental.baseStaticAbilities).toEqual(["flying"]);
        });
    });

    it("an identity swap keeps the board's grants and its ability-loss", () => {
        // `recomposeLayer6ForInstance` runs on a SYNTHETIC one-card board (the
        // swap sites carry no GameState), so it cannot re-walk to a live
        // source. It must therefore PRESERVE what it cannot re-derive rather
        // than clearing it: the window between the swap and the next sync is
        // one the search's `turn-face-up` leaf and a mana ability's
        // `payRemoveCounterCost` both read in.
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const aura = makeInstance(flight.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const state = boardOf(bear, aura);
        applySourceStaticEffects(state, aura);
        expect(count(bear, "flying")).toBe(1);

        recomposeLayer6ForInstance(bear);
        expect(count(bear, "flying")).toBe(1);
        expect(bear.grantedStaticAbilities).toEqual([
            expect.objectContaining({ ability: "flying", auraId: "aura" }),
        ]);
    });

    it("an identity swap keeps a live ability-loss it cannot re-walk to", () => {
        // The other half of the same window, and the more dangerous one:
        // clearing `abilitiesSuppressedBy` would silently END a Titania's Song
        // strip mid-resolution, handing the permanent every ability back.
        const gear = makeInstance(ashnodsBattleGear.id, { id: "gear" });
        const song = makeInstance(titaniasSong.id, { id: "song" });
        const state = boardOf(gear, song);
        applySourceStaticEffects(state, song);
        expect(gear.staticAbilities).toEqual([]);
        expect(gear.abilitiesSuppressedBy).toEqual([
            expect.objectContaining({ sourceId: "song" }),
        ]);

        recomposeLayer6ForInstance(gear);
        expect(gear.staticAbilities).toEqual([]);
        expect(gear.abilitiesSuppressedBy).toEqual([
            expect.objectContaining({ sourceId: "song" }),
        ]);
    });

    it("paying a removeCounter COST does not drop the board's grants", () => {
        // Proven regression: `payRemoveCounterCost` takes no GameState, so it
        // goes through the instance recompose — which used to clear every
        // `auraId` row on the way past.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            counters: { fade: 1 },
        });
        const aura = makeInstance(flight.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const state = boardOf(bear, aura);
        applySourceStaticEffects(state, aura);

        payRemoveCounterCost(bear, { type: "fade", count: 1 });
        expect(count(bear, "flying")).toBe(1);
    });

    it("a command-zone emblem's keyword grant applies (CR 114.3)", () => {
        // An emblem is not a permanent and is minted no `staticSeq`, so the
        // unstamped-source gate skipped it and every emblem-granted keyword
        // would have shipped inert with no test red. No catalogue emblem
        // declares one today, so the guard is a probe definition.
        const EMBLEM_ID = "layer6-registry-test-emblem";
        withTemporaryEmblemDefinition(
            {
                id: EMBLEM_ID,
                name: "Layer 6 Probe Emblem",
                text: "Creatures you control have flying.",
                staticEffects: [
                    {
                        kind: "keyword-grant",
                        applies: (
                            target: PermanentView,
                            source: PermanentView
                        ) =>
                            target.controllerId === source.controllerId &&
                            target.types.includes("Creature"),
                        keyword: "flying",
                    },
                ],
            },
            () => {
                const bear = makeInstance(grizzlyBears.id, { id: "bear" });
                const state = boardOf(bear);
                state.emblems = [
                    {
                        id: "emblem-1",
                        emblemId: EMBLEM_ID,
                        ownerId: "p1",
                        name: "Layer 6 Probe Emblem",
                        text: "Creatures you control have flying.",
                    },
                ];
                refreshCounterGatedStatics(state);

                expect(count(bear, "flying")).toBe(1);
            }
        );
    });

    it("`keywordFor` returning null grants NOTHING, not the fixed keyword", () => {
        const DECLINING: CardDefinition = {
            ...grizzlyBears,
            staticEffects: [
                {
                    kind: "keyword-grant",
                    applies: (target: PermanentView, source: PermanentView) =>
                        target.id === source.id,
                    keyword: "flying",
                    keywordFor: () => null,
                },
            ],
        };
        withTemporaryDefinition(DECLINING, () => {
            const bear = makeInstance(DECLINING.id, { id: "bear" });
            const state = boardOf(bear);
            applySourceStaticEffects(state, bear);
            // The WHOLE multiset, not just the absence of "flying": a
            // fall-through that grants `null` leaves no "flying" either, and
            // would push a junk occurrence every consult site then reads.
            expect(bear.staticAbilities).toEqual([]);
        });
    });

    it("a duration-scoped registry entry is REFUSED — nothing ticks one yet", () => {
        // Fail-closed: the phase-boundary purge ticks the instance-borne
        // records, never `state.continuousEffects`, so an entry created with a
        // duration expiry would apply for the rest of the game (PRD #2064 S6
        // moves the countdown in).
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = boardOf(bear);
        const ctx = ctxFor(state);
        expect(() =>
            ctx.addContinuousEffect({
                layer: 6,
                affected: { kind: "instances", instanceIds: ["bear"] },
                expiry: {
                    kind: "duration",
                    duration: { phase: "end-of-turn" },
                    controllerId: "p1",
                },
                payload: { kind: "keyword-grant", keyword: "flying" },
                characteristicDefining: false,
            })
        ).toThrow(/not ticked yet/);
    });

    it("entry ids do not collide once an entry is removed", () => {
        // `ce-N` is the documented removal handle, so a LENGTH-derived suffix
        // would re-issue a live id and a removal would take the wrong effect.
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = boardOf(bear);
        const ctx = ctxFor(state);
        const add = (keyword: string) =>
            ctx.addContinuousEffect({
                layer: 6,
                affected: { kind: "instances", instanceIds: ["bear"] },
                expiry: { kind: "indefinite", controllerId: "p1" },
                payload: { kind: "keyword-grant", keyword },
                characteristicDefining: false,
            });
        add("flying");
        add("trample");
        // Something removes the FIRST entry (PRD #2064 S6 does this).
        state.continuousEffects = state.continuousEffects!.slice(1);
        add("vigilance");

        const ids = (state.continuousEffects ?? []).map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

// Keeps `deriveLayer6`'s export honest: the tests above go through the engine's
// own recompute, and this is the one direct call, so a signature change reds
// here rather than silently leaving the module unreferenced.
describe("deriveLayer6 is the single layer-6 authority", () => {
    it("returns the composed multiset for one permanent", () => {
        const elemental = makeInstance(airElemental.id, { id: "ae" });
        const state = boardOf(elemental);
        refreshCounterGatedStatics(state);
        const derived = deriveLayer6(
            state as never,
            elemental as unknown as PermanentView
        );
        expect(derived.staticAbilities).toEqual(["flying"]);
        expect(derived.abilitiesSuppressedBy).toEqual([]);
    });
});
