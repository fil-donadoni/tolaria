// PRD #2064 S5 (#3094) — the wire projection derives every characteristic from
// the Continuous Effects Registry (CR 613), not from the fields
// `syncLayers2to5` / `syncLayer6` cache on each instance.
//
// The two halves of that claim need opposite fixtures, and both are here:
//
//  * a registry entry that has NEVER been materialised must still reach the
//    wire — the projection derives rather than echoes;
//  * a materialised field the registry does NOT produce must NOT reach the
//    wire — the projection stops trusting the cache, which is the whole point
//    of the slice (PRD #2064 S6 deletes those fields, and a projection that
//    read them would then ship nothing).
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectFullState, projectPublicState } from "../../gameProjections";
import { syncLayer6 } from "../layer6";
import { syncLayers2to5 } from "../layers2to5";
import type { ContinuousEffect } from "../continuousEffects";
import type { GameState } from "../state";
import { deriveWireCharacteristics } from "../wireCharacteristics";

const WAR_MAMMOTH = getCardByName("War Mammoth")!.id;

/** A stored, source-independent registry entry aimed at one instance — the
 *  shape `SpellContext.addContinuousEffect` writes (`gre/state.ts`) and the one
 *  PRD #2064 S6's producers will write for a resolved spell's residue. */
function indefiniteEntry(
    id: string,
    timestamp: number,
    instanceId: string,
    slot: Pick<ContinuousEffect, "layer" | "sublayer">,
    payload: Extract<
        ContinuousEffect,
        { affected: { kind: "instances" } }
    >["payload"]
): ContinuousEffect {
    return {
        ...slot,
        id,
        timestamp,
        characteristicDefining: false,
        expiry: { kind: "indefinite", controllerId: "p1" },
        affected: { kind: "instances", instanceIds: [instanceId] },
        payload,
    } as ContinuousEffect;
}

function stateWith(
    card: ReturnType<typeof makeInstance>,
    continuousEffects: ContinuousEffect[]
): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield: [card] }), makePlayer("p2")],
        continuousEffects,
    });
}

function projectedCard(state: GameState) {
    const projected = projectPublicState(state, 1, "p1");
    return projected.players.find((p) => p.id === "p1")!.battlefield[0];
}

describe("wire projection derives layer 6 from the registry (CR 613.1f)", () => {
    it("ships a granted keyword no sync ever materialised", () => {
        // Deliberately NOT synced: the instance's `staticAbilities` still holds
        // only the printed keyword, so anything reading the field ships
        // ["trample"]. The registry says otherwise, and the wire follows the
        // registry.
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        expect(mammoth.staticAbilities).toEqual(["trample"]);
        const state = stateWith(mammoth, [
            indefiniteEntry(
                "ce-1",
                10,
                "m1",
                { layer: 6 },
                {
                    kind: "keyword-grant",
                    keyword: "flying",
                }
            ),
        ]);

        expect(projectedCard(state).staticAbilities).toEqual([
            "trample",
            "flying",
        ]);
        // The instance itself is untouched — the projection is a pure read.
        expect(mammoth.staticAbilities).toEqual(["trample"]);
    });

    it("ships a resolved-ability grant as a `grantedStaticAbilities` ROW, so the client can tell the permanent is altered (PRD #2064 S6b)", () => {
        // The client never re-derives layer 6 to answer "is this permanent
        // altered?" — two reducers read the flat array instead: `isAltered`
        // (`src/lib/battlefield-stacks.ts`, whether the card may collapse into
        // a stack of identical creatures) and `src/lib/preview-body.ts`.
        //
        // S6b moved the three non-aura provenances OUT of that array and into
        // the registry, so without the wire rebuilding them a creature whose
        // only alteration is "gains flying until end of turn" stacks back in
        // with plain copies of itself and the player cannot see which one
        // flies. Nothing in the client suite can catch that: its fixtures
        // hand-build the row the projection stopped producing.
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const state = stateWith(mammoth, [
            indefiniteEntry(
                "ce-1",
                10,
                "m1",
                { layer: 6 },
                { kind: "keyword-grant", keyword: "flying" }
            ),
        ]);

        const wire = projectedCard(state);
        expect(wire.staticAbilities).toEqual(["trample", "flying"]);
        expect(wire.grantedStaticAbilities).toEqual([
            { ability: "flying", seq: 10 },
        ]);
    });

    it("does NOT ship an aura-sourced grant twice", () => {
        // The aura half is layer 6's own derived output and already reaches the
        // wire through `layer6DerivedFields`; a `source`-expiry entry must not
        // be rebuilt on top of it.
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const state = stateWith(mammoth, [
            {
                id: "ce-src",
                layer: 6,
                timestamp: 4,
                characteristicDefining: false,
                expiry: { kind: "source", sourceId: "nobody" },
                affected: { kind: "instances", instanceIds: ["m1"] },
                payload: { kind: "keyword-grant", keyword: "flying" },
            } as ContinuousEffect,
        ]);

        expect(projectedCard(state).grantedStaticAbilities).toBeUndefined();
    });

    it("ships a printed keyword the registry removes", () => {
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const state = stateWith(mammoth, [
            indefiniteEntry(
                "ce-1",
                10,
                "m1",
                { layer: 6 },
                {
                    kind: "keyword-remove",
                    keyword: "trample",
                }
            ),
        ]);

        expect(projectedCard(state).staticAbilities).toEqual([]);
    });

    it("does NOT ship a grant the registry does not produce", () => {
        // The stale-cache shape S6b-part-2 deleted outright: a permanent whose
        // `staticAbilities` still holds a keyword no live effect grants. There
        // is no instance field for the provenance to be carried in any more, so
        // the wire's only source is the derivation — and the derivation says
        // the Mammoth has trample and nothing else.
        const mammoth = makeInstance(WAR_MAMMOTH, {
            id: "m1",
            staticAbilities: ["trample", "flying"],
            baseStaticAbilities: ["trample"],
        });
        const state = stateWith(mammoth, []);

        const card = projectedCard(state);
        expect(card.staticAbilities).toEqual(["trample"]);
        expect(card.grantedStaticAbilities).toBeUndefined();
    });
});

describe("wire projection derives layers 2-5 from the registry (CR 613.1b-e)", () => {
    it("ships a subtype the registry adds", () => {
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const state = stateWith(mammoth, [
            indefiniteEntry(
                "ce-1",
                10,
                "m1",
                { layer: 4 },
                {
                    kind: "subtype-change",
                    add: ["Zombie"],
                }
            ),
        ]);

        expect(projectedCard(state).subtypes).toContain("Zombie");
        expect(mammoth.subtypes).not.toContain("Zombie");
    });

    it("ships a type the registry adds", () => {
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const state = stateWith(mammoth, [
            indefiniteEntry(
                "ce-1",
                10,
                "m1",
                { layer: 4 },
                {
                    kind: "type-change",
                    add: ["Artifact"],
                }
            ),
        ]);

        expect(projectedCard(state).types).toContain("Artifact");
    });

    it("feeds the layers 2-5 answer into layer 6's derivation", () => {
        // CR 613.1 composes each layer over the OUTPUT of the ones below.
        // Goblin King grants mountainwalk to "other Goblins", and War Mammoth
        // is a Beast until a layer-4 entry makes it a Goblin — so the grant
        // exists only if layer 6 reads the type line layer 4 produced in the
        // SAME projection. Derive layer 6 first and the multiset is just
        // ["trample"], which is what pins the pass order (and the write-back
        // between them) in `deriveWireCharacteristics`.
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const king = makeInstance(getCardByName("Goblin King")!.id, {
            id: "k1",
            // CR 613.7a — see the note on the aura fixture below.
            staticSeq: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mammoth, king] }),
                makePlayer("p2"),
            ],
            continuousEffects: [
                indefiniteEntry(
                    "ce-1",
                    10,
                    "m1",
                    { layer: 4 },
                    {
                        kind: "subtype-change",
                        add: ["Goblin"],
                    }
                ),
            ],
        });

        const card = projectedCard(state);
        expect(card.subtypes).toContain("Goblin");
        expect(card.staticAbilities).toEqual(["trample", "mountainwalk"]);
    });
});

describe("the registry itself is on the wire", () => {
    it("carries `continuousEffects` on the public projection", () => {
        // Wire-format test (`.claude/rules/gre-development.md`): the projection
        // strips fat fields, so an engine-only assertion passes while the
        // client silently loses the field the client-side engine run (ADR 0074)
        // is defined against.
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const entries = [
            indefiniteEntry(
                "ce-1",
                10,
                "m1",
                { layer: 6 },
                {
                    kind: "keyword-grant",
                    keyword: "flying",
                }
            ),
        ];
        const projected = projectPublicState(
            stateWith(mammoth, entries),
            1,
            "p1"
        );
        expect(projected.continuousEffects).toEqual(entries);
    });

    it("projects the same characteristics in the full debug view", () => {
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const state = stateWith(mammoth, [
            indefiniteEntry(
                "ce-1",
                10,
                "m1",
                { layer: 6 },
                {
                    kind: "keyword-grant",
                    keyword: "flying",
                }
            ),
        ]);
        const full = projectFullState(state, 1);
        const card = full.players.find((p) => p.id === "p1")!.battlefield[0];
        expect(card.staticAbilities).toEqual(["trample", "flying"]);
    });
});

describe("provenance changes, shape does not (PRD #2064 S5 AC 3)", () => {
    // The slice's acceptance criterion is that the 53 client call sites reading
    // `card.staticAbilities` / `card.types` / `card.subtypes` are untouched. The
    // evidence is this: on a state the engine has ALREADY synced — every state
    // `getPublicState` ever sees, since a save point is downstream of a sync —
    // the derived projection is field-for-field what the materialised
    // projection was. If the derivation and the sync could disagree on a synced
    // board, that difference would land on a client call site, and it lands
    // here first.
    const FLIGHT = getCardByName("Flight")!.id;

    it("projects exactly what a synced board already holds", () => {
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        // CR 613.7a — a static ability's effect is stamped when the object
        // BEGINS applying (`beginApplyingStaticEffects`). A hand-built fixture
        // never went through that path, and an unstamped source is skipped.
        const flight = makeInstance(FLIGHT, {
            id: "a1",
            attachedTo: "m1",
            staticSeq: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mammoth, flight] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        syncLayer6(state);
        // The aura actually did something, or this asserts nothing.
        expect(mammoth.staticAbilities).toEqual(["trample", "flying"]);

        const projected = projectPublicState(state, 1, "p1");
        const cards = projected.players.find((p) => p.id === "p1")!.battlefield;
        for (const card of cards) {
            const instance = state.players[0].battlefield.find(
                (c) => c.id === card.id
            )!;
            expect(card.staticAbilities).toEqual(instance.staticAbilities);
            expect(card.types).toEqual(instance.types);
            expect(card.subtypes).toEqual(instance.subtypes);
            expect(card.controllerId).toEqual(instance.controllerId);
            // Derived output with no instance field behind it since PRD #2064
            // S6b-part-2 — asserted against the derivation the wire is built
            // from, which is the only place the answer exists.
            expect(card.grantedStaticAbilities).toEqual(
                deriveWireCharacteristics(state).get(card.id)
                    ?.grantedStaticAbilities
            );
            expect(card.baseStaticAbilities).toEqual(
                instance.baseStaticAbilities
            );
        }
    });

    it("leaves the live state untouched — the projection is a pure read", () => {
        const mammoth = makeInstance(WAR_MAMMOTH, { id: "m1" });
        const state = stateWith(mammoth, [
            indefiniteEntry(
                "ce-1",
                10,
                "m1",
                { layer: 6 },
                {
                    kind: "keyword-grant",
                    keyword: "flying",
                }
            ),
        ]);
        const before = JSON.stringify(state);
        projectPublicState(state, 1, "p1");
        // The derivation passes carry one-shot base capture and the pre-S3/S4
        // legacy migrations, which are correct exactly once. A query that ran
        // either on live state would arm them to run a SECOND time in the
        // mutation path — "the effect applies twice, forever"
        // (`ensureLayers2to5Base`). The clone is what makes this hold.
        expect(JSON.stringify(state)).toBe(before);
    });
});
