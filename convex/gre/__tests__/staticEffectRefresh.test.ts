// Round-trip semantics of the materialized-static pair (issue #1715).
//
// `applySourceStaticEffects` / `unapplySourceStaticEffects` (`gre/state.ts`)
// MATERIALIZE a source's layer-4/6 contributions onto every target instance.
// `refreshCounterGatedStatics` re-runs the pair for every `dependsOnCounters`
// source on EVERY SBA pass (issue #1711), so the pair must be idempotent and
// composition-preserving: round-tripping a source may not change any OTHER
// source's contribution, nor the source's own CR 613.7 timestamp position.
//
// Three defects this suite pins, each on a board reachable with shipped cards:
//   1. CR 613.1f — a keyword a live `ability-loss` / `keyword-remove` already
//      stripped must stay stripped across any number of refreshes.
//   2. CR 613.7 — co-applying `subtype-set` sources keep their timestamp
//      order across a refresh (a refresh is not a new timestamp; only an Aura
//      becoming attached is, CR 613.7d).
//   3. CR 613 composition — a `subtype-add` contribution survives a
//      co-located `subtype-set` refresh.
//
// The ordering itself is carried by an explicit layer TIMESTAMP: every source
// is stamped with `staticSeq` when its continuous effects are applied afresh
// (ETB / aura attach, CR 613.7d) and every layer-4/6 record it writes copies
// that stamp, so grants, strippers, subtype sets and subtype adds all sort on
// ONE axis. A counter-gated re-evaluation preserves the stamp — re-running a
// predicate is not a new timestamp — which is what makes the refresh
// idempotent instead of "whoever was re-applied last wins".
import { describe, it, expect } from "vitest";
import {
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    refreshCounterGatedStatics,
} from "../state";
import type { GameState, CardInstanceState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { venarianGold } from "../../cards/sets/leg/blue";
import { bloodMoon } from "../../cards/sets/drk/red";
import { cyclopeanTomb } from "../../cards/sets/lea/colorless";
import { yavimayaCradleOfGrowth } from "../../cards/sets/mh2/colorless";
import { mishrasFactory } from "../../cards/sets/atq/colorless";
import { gravitySphere } from "../../cards/sets/leg/red";
import { flight, airElemental } from "../../cards/sets/lea/blue";

/** Mishra's Factory — a nonbasic land with NO printed land types, so every
 *  subtype seen below comes from a layer-4 source and nothing else. */
function makeBoard(
    landCounters: Record<string, number>,
    sourceCardIds: { id: string; instanceId: string; attachedTo?: string }[]
): { state: GameState; land: CardInstanceState; sources: CardInstanceState[] } {
    const land = makeInstance(mishrasFactory.id, {
        id: "land-1",
        counters: { ...landCounters },
    });
    const sources = sourceCardIds.map((s) =>
        makeInstance(s.id, {
            id: s.instanceId,
            // An Aura source needs its host: Venarian Gold's counter-gated
            // `keyword-grant` predicate is `target.id === source.attachedTo`.
            ...(s.attachedTo ? { attachedTo: s.attachedTo } : {}),
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [land, ...sources] }),
            makePlayer("p2"),
        ],
    });
    return { state, land, sources };
}

describe("materialized static refresh — round-trip semantics (issue #1715)", () => {
    describe("defect 1 — keyword-grant may not resurrect a stripped keyword (CR 613.1f)", () => {
        it("keeps the keyword stripped across any number of refreshes", () => {
            // Venarian Gold grants its host `does-not-untap` while the host
            // carries a sleep counter (counter-gated, CR 502.3); Blood Moon's
            // `ability-loss` strips every ability off a nonbasic land with a
            // LATER timestamp, so the loss wins (CR 613.1f).
            const { state, land, sources } = makeBoard({ sleep: 1 }, [
                {
                    id: venarianGold.id,
                    instanceId: "wight-1",
                    attachedTo: "land-1",
                },
                { id: bloodMoon.id, instanceId: "moon-1" },
            ]);
            const [wight, moon] = sources;

            applySourceStaticEffects(state, wight);
            expect(land.staticAbilities).toContain("does-not-untap");
            applySourceStaticEffects(state, moon);
            expect(land.staticAbilities).not.toContain("does-not-untap");

            for (let i = 0; i < 3; i++) refreshCounterGatedStatics(state);
            expect(land.staticAbilities).not.toContain("does-not-untap");

            // …and the grant is restored exactly ONCE when the stripper leaves.
            unapplySourceStaticEffects(state, moon);
            expect(
                land.staticAbilities.filter((k) => k === "does-not-untap")
            ).toHaveLength(1);
        });

        it("still grants when no live stripper removed that keyword", () => {
            const { state, land, sources } = makeBoard({ sleep: 1 }, [
                {
                    id: venarianGold.id,
                    instanceId: "wight-1",
                    attachedTo: "land-1",
                },
            ]);
            const [wight] = sources;
            applySourceStaticEffects(state, wight);
            for (let i = 0; i < 3; i++) refreshCounterGatedStatics(state);
            expect(
                land.staticAbilities.filter((k) => k === "does-not-untap")
            ).toHaveLength(1);
        });
    });

    describe("defect 2 — subtype-set refresh keeps its timestamp position (CR 613.7)", () => {
        it("does not re-stamp a refreshed subtype-set source last", () => {
            // Cyclopean Tomb mires the land (Swamp, counter-gated) FIRST; Blood
            // Moon's subtype-set (Mountain) has the later timestamp and wins.
            const { state, land, sources } = makeBoard({ mire: 1 }, [
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
                { id: bloodMoon.id, instanceId: "moon-1" },
            ]);
            const [tomb, moon] = sources;

            applySourceStaticEffects(state, tomb);
            expect(land.subtypes).toEqual(["Swamp"]);
            applySourceStaticEffects(state, moon);
            expect(land.subtypes).toEqual(["Mountain"]);

            refreshCounterGatedStatics(state);
            const afterOne = [...land.subtypes];
            for (let i = 0; i < 3; i++) refreshCounterGatedStatics(state);
            expect(land.subtypes).toEqual(["Mountain"]);
            // …and the answer does not depend on how many SBA passes have run.
            expect(land.subtypes).toEqual(afterOne);
        });
    });

    describe("defect 3 — subtype-add survives a co-located subtype-set refresh (CR 613)", () => {
        it("replays every live subtype-add contribution on unapply", () => {
            // Cyclopean Tomb sets the land to Swamp; Yavimaya then ADDS Forest
            // "in addition to its other land types" (later timestamp).
            const { state, land, sources } = makeBoard({ mire: 1 }, [
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
                { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
            ]);
            const [tomb, yavimaya] = sources;

            applySourceStaticEffects(state, tomb);
            applySourceStaticEffects(state, yavimaya);
            expect(land.subtypes).toEqual(["Swamp", "Forest"]);

            for (let i = 0; i < 3; i++) refreshCounterGatedStatics(state);
            expect([...land.subtypes].sort()).toEqual(["Forest", "Swamp"]);
        });
    });

    describe("idempotence — one refresh equals N refreshes on a combined board", () => {
        it("is stable with a grant, a stripper, a subtype-set and a subtype-add live at once", () => {
            const { state, land, sources } = makeBoard({ sleep: 1, mire: 1 }, [
                {
                    id: venarianGold.id,
                    instanceId: "wight-1",
                    attachedTo: "land-1",
                },
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
                { id: bloodMoon.id, instanceId: "moon-1" },
                { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
            ]);
            const [wight, tomb, moon, yavimaya] = sources;
            applySourceStaticEffects(state, wight);
            applySourceStaticEffects(state, tomb);
            applySourceStaticEffects(state, moon);
            applySourceStaticEffects(state, yavimaya);

            const baseline = {
                subtypes: [...land.subtypes],
                staticAbilities: [...land.staticAbilities],
            };
            // Blood Moon (later timestamp) wins the subtype-set race; Yavimaya
            // adds Forest on top; the ability-loss keeps the lock stripped.
            expect(baseline.subtypes).toEqual(["Mountain", "Forest"]);
            expect(baseline.staticAbilities).not.toContain("does-not-untap");

            refreshCounterGatedStatics(state);
            const afterOne = {
                subtypes: [...land.subtypes],
                staticAbilities: [...land.staticAbilities],
            };
            expect(afterOne).toEqual(baseline);

            for (let i = 0; i < 5; i++) refreshCounterGatedStatics(state);
            expect({
                subtypes: [...land.subtypes],
                staticAbilities: [...land.staticAbilities],
            }).toEqual(baseline);

            // Wire format — the materialized answer the client renders is the
            // corrected one (`.claude/rules/gre-development.md`).
            const projected = projectPublicState(state, 1, "p1");
            const slimLand = projected.players[0].battlefield.find(
                (c) => c.id === land.id
            )!;
            expect(slimLand.subtypes).toEqual(["Mountain", "Forest"]);
            expect(slimLand.staticAbilities).not.toContain("does-not-untap");
        });
    });

    // ─────────────────────────────────────────────────────────────────────
    // The ordering invariant the first cut of this fix got backwards: it
    // treated the mere EXISTENCE of a `removedKeywords` entry as proof the
    // stripper was later. It is not — that entry is written whenever the
    // keyword happened to be present when the stripper applied, which is
    // equally true of a stripper that ran FIRST.
    // ─────────────────────────────────────────────────────────────────────
    describe("layer 6 ordering — a grant applied AFTER a live stripper wins (CR 613.1f)", () => {
        /** Air Elemental (natively flying) with Flight attached, plus a
         *  Gravity Sphere ("all creatures lose flying"). Sources are applied
         *  in the order given, so the caller controls the timestamps. */
        function makeFlyingBoard(): {
            state: GameState;
            elemental: CardInstanceState;
            aura: CardInstanceState;
            sphere: CardInstanceState;
        } {
            const elemental = makeInstance(airElemental.id, { id: "elem-1" });
            const aura = makeInstance(flight.id, {
                id: "flight-1",
                attachedTo: "elem-1",
            });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere-1" });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [elemental, aura, sphere],
                    }),
                    makePlayer("p2"),
                ],
            });
            return { state, elemental, aura, sphere };
        }

        it("Gravity Sphere then Flight: the creature flies (native flier)", () => {
            const { state, elemental, aura, sphere } = makeFlyingBoard();
            expect(elemental.staticAbilities).toEqual(["flying"]);

            // Gravity Sphere lands FIRST and strips the native flying…
            applySourceStaticEffects(state, sphere);
            expect(elemental.staticAbilities).toEqual([]);
            // …then Flight resolves with the LATER timestamp and wins.
            applySourceStaticEffects(state, aura);
            expect(elemental.staticAbilities).toEqual(["flying"]);
        });

        it("Flight, Gravity Sphere, Flight: the later grant still wins (no native flier)", () => {
            const grizzly = makeInstance(airElemental.id, { id: "elem-1" });
            grizzly.staticAbilities = [];
            const aura1 = makeInstance(flight.id, {
                id: "flight-1",
                attachedTo: "elem-1",
            });
            const aura2 = makeInstance(flight.id, {
                id: "flight-2",
                attachedTo: "elem-1",
            });
            const sphere = makeInstance(gravitySphere.id, { id: "sphere-1" });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [grizzly, aura1, aura2, sphere],
                    }),
                    makePlayer("p2"),
                ],
            });

            applySourceStaticEffects(state, aura1);
            applySourceStaticEffects(state, sphere);
            applySourceStaticEffects(state, aura2);
            expect(grizzly.staticAbilities).toContain("flying");
        });

        it("Flight then Gravity Sphere: the LATER stripper wins", () => {
            const { state, elemental, aura, sphere } = makeFlyingBoard();
            applySourceStaticEffects(state, aura);
            // native + granted
            expect(elemental.staticAbilities).toEqual(["flying", "flying"]);
            applySourceStaticEffects(state, sphere);
            expect(elemental.staticAbilities).toEqual(["flying"]);
        });

        it("an unapply/re-apply round trip of the aura is a no-op (apply and unapply are exact inverses)", () => {
            // Reachable in production via `reattachAura`, reanimation and the
            // counter-gated refresh: the pair must not EAT an occurrence.
            const { state, elemental, aura, sphere } = makeFlyingBoard();
            applySourceStaticEffects(state, aura);
            applySourceStaticEffects(state, sphere);
            const before = [...elemental.staticAbilities];
            expect(before).toEqual(["flying"]);

            for (let i = 0; i < 3; i++) {
                unapplySourceStaticEffects(state, aura);
                applySourceStaticEffects(state, aura);
            }
            expect(elemental.staticAbilities).toEqual(before);
        });

        it("a round trip of the STRIPPER is a no-op too", () => {
            const { state, elemental, aura, sphere } = makeFlyingBoard();
            applySourceStaticEffects(state, aura);
            applySourceStaticEffects(state, sphere);
            const before = [...elemental.staticAbilities];

            for (let i = 0; i < 3; i++) {
                unapplySourceStaticEffects(state, sphere);
                applySourceStaticEffects(state, sphere);
            }
            expect(elemental.staticAbilities).toEqual(before);
        });
    });

    describe("layer 4 ordering — sets and adds replay on ONE timestamp axis (CR 613.7)", () => {
        it("set-then-add: the later add survives", () => {
            const { state, land, sources } = makeBoard({ mire: 1 }, [
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
                { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
            ]);
            const [tomb, yavimaya] = sources;
            applySourceStaticEffects(state, tomb);
            applySourceStaticEffects(state, yavimaya);
            expect(land.subtypes).toEqual(["Swamp", "Forest"]);

            const afterZero = [...land.subtypes];
            for (let i = 0; i < 7; i++) refreshCounterGatedStatics(state);
            expect(land.subtypes).toEqual(afterZero);
        });

        it("add-then-set: the later SET overwrites the earlier add", () => {
            // The reverse of the case above, and the one the first cut of the
            // composer got wrong: it replayed every add on top of the newest
            // set unconditionally, so the answer flipped on the first SBA pass.
            const { state, land, sources } = makeBoard({ mire: 1 }, [
                { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
            ]);
            const [yavimaya, tomb] = sources;
            applySourceStaticEffects(state, yavimaya);
            expect(land.subtypes).toEqual(["Forest"]);
            applySourceStaticEffects(state, tomb);
            expect(land.subtypes).toEqual(["Swamp"]);

            const afterZero = [...land.subtypes];
            for (let i = 0; i < 7; i++) refreshCounterGatedStatics(state);
            expect(land.subtypes).toEqual(afterZero);
            expect(land.subtypes).toEqual(["Swamp"]);
        });

        it("add, set, set: every entry replays in timestamp order, pass-count independent", () => {
            const { state, land, sources } = makeBoard({ mire: 1 }, [
                { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
                { id: bloodMoon.id, instanceId: "moon-1" },
            ]);
            const [yavimaya, tomb, moon] = sources;
            applySourceStaticEffects(state, yavimaya);
            applySourceStaticEffects(state, tomb);
            applySourceStaticEffects(state, moon);
            // Forest (add) → Swamp (set) → Mountain (set): the newest set wins
            // outright and the earlier add does NOT come back.
            expect(land.subtypes).toEqual(["Mountain"]);

            const afterZero = [...land.subtypes];
            for (let i = 0; i < 7; i++) refreshCounterGatedStatics(state);
            expect(land.subtypes).toEqual(afterZero);
        });
    });

    describe("a counter-gated subtype-set that NEWLY starts applying composes with a live add", () => {
        it("keeps a later add when the set's source has the earlier timestamp", () => {
            // Cyclopean Tomb is on the battlefield with NO mire counter yet, so
            // its `subtype-set` is stamped (its ETB timestamp) but applies to
            // nothing. Yavimaya enters after it. Placing the mire counter makes
            // the set START applying — and because a counter re-evaluation is
            // not a new timestamp (CR 613.7d), the set stays EARLIER than the
            // add, so the Forest survives.
            const { state, land, sources } = makeBoard({}, [
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
                { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
            ]);
            const [tomb, yavimaya] = sources;
            applySourceStaticEffects(state, tomb);
            applySourceStaticEffects(state, yavimaya);
            expect(land.subtypes).toEqual(["Forest"]);

            land.counters = { ...(land.counters ?? {}), mire: 1 };
            refreshCounterGatedStatics(state);
            expect(land.subtypes).toEqual(["Swamp", "Forest"]);

            const afterOne = [...land.subtypes];
            for (let i = 0; i < 7; i++) refreshCounterGatedStatics(state);
            expect(land.subtypes).toEqual(afterOne);
        });

        it("overwrites an earlier add when the set's source has the later timestamp", () => {
            const { state, land, sources } = makeBoard({}, [
                { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
            ]);
            const [yavimaya, tomb] = sources;
            applySourceStaticEffects(state, yavimaya);
            applySourceStaticEffects(state, tomb);
            expect(land.subtypes).toEqual(["Forest"]);

            land.counters = { ...(land.counters ?? {}), mire: 1 };
            refreshCounterGatedStatics(state);
            expect(land.subtypes).toEqual(["Swamp"]);

            const afterOne = [...land.subtypes];
            for (let i = 0; i < 7; i++) refreshCounterGatedStatics(state);
            expect(land.subtypes).toEqual(afterOne);
        });

        it("releases the add cleanly when the ADD's source leaves play", () => {
            // The composer must not make an add immortal: `printedSubtypes` is
            // snapshotted WITHOUT the live add contributions.
            const { state, land, sources } = makeBoard({ mire: 1 }, [
                { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
                { id: cyclopeanTomb.id, instanceId: "tomb-1" },
            ]);
            const [yavimaya, tomb] = sources;
            applySourceStaticEffects(state, tomb);
            applySourceStaticEffects(state, yavimaya);
            expect(land.subtypes).toEqual(["Swamp", "Forest"]);

            unapplySourceStaticEffects(state, yavimaya);
            expect(land.subtypes).toEqual(["Swamp"]);
            unapplySourceStaticEffects(state, tomb);
            expect(land.subtypes).toEqual([]);
        });
    });
});
