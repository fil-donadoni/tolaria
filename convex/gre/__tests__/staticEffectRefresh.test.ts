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
import { dreadWight } from "../../cards/sets/ice/black";
import { bloodMoon } from "../../cards/sets/drk/red";
import { cyclopeanTomb } from "../../cards/sets/lea/colorless";
import { yavimayaCradleOfGrowth } from "../../cards/sets/mh2/colorless";
import { mishrasFactory } from "../../cards/sets/atq/colorless";

/** Mishra's Factory — a nonbasic land with NO printed land types, so every
 *  subtype seen below comes from a layer-4 source and nothing else. */
function makeBoard(
    landCounters: Record<string, number>,
    sourceCardIds: { id: string; instanceId: string }[]
): { state: GameState; land: CardInstanceState; sources: CardInstanceState[] } {
    const land = makeInstance(mishrasFactory.id, {
        id: "land-1",
        counters: { ...landCounters },
    });
    const sources = sourceCardIds.map((s) =>
        makeInstance(s.id, { id: s.instanceId })
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
            // Dread Wight grants `does-not-untap` to every permanent carrying a
            // paralyzation counter (counter-gated); Blood Moon's `ability-loss`
            // strips every ability off a nonbasic land with a LATER timestamp,
            // so the loss wins (CR 613.1f).
            const { state, land, sources } = makeBoard({ paralyzation: 1 }, [
                { id: dreadWight.id, instanceId: "wight-1" },
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
            const { state, land, sources } = makeBoard({ paralyzation: 1 }, [
                { id: dreadWight.id, instanceId: "wight-1" },
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
            const { state, land, sources } = makeBoard(
                { paralyzation: 1, mire: 1 },
                [
                    { id: dreadWight.id, instanceId: "wight-1" },
                    { id: cyclopeanTomb.id, instanceId: "tomb-1" },
                    { id: bloodMoon.id, instanceId: "moon-1" },
                    { id: yavimayaCradleOfGrowth.id, instanceId: "yavimaya-1" },
                ]
            );
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
});
