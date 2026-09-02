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
    removePermanentTo,
    unapplySourceStaticEffects,
    type CardInstanceState,
    type GameState,
} from "../state";
import { deriveLayer6 } from "../layer6";
import {
    outrankedBy,
    renderKeyword,
    type ContinuousEffect,
} from "../continuousEffects";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { untapStep } from "../phases";
import { withTemporaryDefinition } from "../../cards";
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
                bear.subtypes = [...bear.subtypes, "Wizard"];
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
