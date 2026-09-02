// CR 613.1b-e — the layers 2-5 derivation (PRD #2064 S4, ADR 0082).
//
// The conformance suite for the slice that completes ADR 0082's "all CR 613
// layers, one model" bound. What it pins is the four things a migration from
// MATERIALISE-AT-APPLY to DERIVE-PER-READ can silently get wrong:
//
//  1. the CR 613.7 LAYER order (2 -> 3 -> 4 -> 5), which no comparator over a
//     single layer can express;
//  2. that each layer's answer is visible to the NEXT layer's predicates IN THE
//     SAME READ — the property the old three-walk model could not have, because
//     each walk read whatever the instance happened to hold;
//  3. that the one-shot layer-4 card-type SET (issue #2084) keeps its semantics
//     through the registry;
//  4. that the answer survives the wire projection, which is where a
//     server-only derivation silently diverges from the client.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
    applySourceStaticEffects,
    buildSpellContext,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
} from "../state";
import {
    clearLayers2to5Base,
    deriveLayers2to5,
    syncLayers2to5,
} from "../layers2to5";
import { checkStateBasedActions } from "../sba";
import { applyIndefiniteSupertypeMutation, hasSupertypeLive } from "../snow";
import { evilPresence } from "../../cards/sets/lea/black";
import type { PermanentView } from "../../cards/types";
import type { LayerStateView } from "../layers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { finalizeCleanup } from "../phases";
import { projectPublicState } from "../../gameProjections";
import { withTemporaryDefinition } from "../../cards/registry";
import { getDefinition } from "../../cards";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { mountain } from "../../cards/sets/lea/colorless";
import { blackLotus } from "../../cards/sets/lea/colorless";

const view = (state: GameState): LayerStateView =>
    state as unknown as LayerStateView;
const asView = (card: CardInstanceState): PermanentView =>
    card as unknown as PermanentView;

/** A source whose layer-4 `type-add` is scoped to the permanents ITS OWN
 *  CONTROLLER controls — the shape that can only answer correctly if layer 2
 *  has already been applied when the predicate runs (CR 613.7). */
function controllerScopedTypeAdder(id: string) {
    const base = getDefinition(blackLotus.id);
    return {
        ...base,
        id,
        name: "Controller-Scoped Type Adder",
        staticEffects: [
            {
                kind: "type-add" as const,
                applies: (target: PermanentView, source: PermanentView) =>
                    target.id !== source.id &&
                    target.controllerId === source.controllerId,
                types: ["Enchantment" as const],
            },
        ],
    };
}

describe("CR 613.7 — layer order and per-read composition (PRD #2064 S4)", () => {
    it("layer 2 is applied before layer 4 reads: a control change makes a controller-scoped type-add apply in the SAME read", () => {
        const adderId = "s4-controller-scoped-adder";
        withTemporaryDefinition(controllerScopedTypeAdder(adderId), () => {
            const bears = makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p2",
                ownerId: "p2",
            });
            const adder = makeInstance(adderId, {
                id: "adder",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [adder] }),
                    makePlayer("p2", { battlefield: [bears] }),
                ],
            });
            applySourceStaticEffects(state, adder);
            // p2 controls the bears, so the p1-scoped adder does not reach it.
            expect(bears.types).not.toContain("Enchantment");

            // A layer-2 entry hands control to p1. Nothing else changes, and
            // in particular nothing re-runs the layer-4 predicate by hand.
            state.continuousEffects = [
                {
                    id: "ce-steal",
                    layer: 2,
                    timestamp: 500,
                    expiry: { kind: "indefinite", controllerId: "p1" },
                    affected: { kind: "instances", instanceIds: ["bears"] },
                    payload: { kind: "control-change", controllerId: "p1" },
                    characteristicDefining: false,
                },
            ];

            // ONE derivation. Layer 2 runs first and its answer is in the view
            // layer 4's predicate is evaluated against (CR 613.7).
            const derived = deriveLayers2to5(view(state), asView(bears));
            expect(derived.controllerId).toBe("p1");
            expect(derived.types).toContain("Enchantment");
        });
    });

    it("CR 613.7 orders WITHIN layer 4 by timestamp: the later subtype SET overwrites the earlier one", () => {
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mtn] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        state.continuousEffects = [
            {
                id: "ce-late",
                layer: 4,
                timestamp: 200,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: ["mtn"] },
                payload: { kind: "subtype-change", set: ["Island"] },
                characteristicDefining: false,
            },
            {
                id: "ce-early",
                layer: 4,
                timestamp: 100,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: ["mtn"] },
                payload: { kind: "subtype-change", set: ["Swamp"] },
                characteristicDefining: false,
            },
        ];
        syncLayers2to5(state);
        // Later timestamp wins, whatever order the entries sit in the array.
        expect(mtn.subtypes).toEqual(["Island"]);
    });

    it("CR 613.7 orders BETWEEN layers, not by timestamp: a layer-2 entry stamped LATER than a layer-4 source still applies first", () => {
        // The discriminating case for the LAYER key in the ordering. The
        // control change has a strictly LATER timestamp than the type-adder's
        // `staticSeq`, so a sort by timestamp alone would run layer 4 first —
        // and layer 4's predicate would read the pre-change controller and
        // decline. CR 613.7 puts every layer-2 effect before every layer-4 one
        // regardless of stamp, which is the only order that answers correctly.
        const adderId = "s4-layer-key-adder";
        withTemporaryDefinition(controllerScopedTypeAdder(adderId), () => {
            const bears = makeInstance(grizzlyBears.id, {
                id: "bears",
                controllerId: "p2",
                ownerId: "p2",
            });
            const adder = makeInstance(adderId, {
                id: "adder",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [adder] }),
                    makePlayer("p2", { battlefield: [bears] }),
                ],
            });
            applySourceStaticEffects(state, adder);
            expect(adder.staticSeq).toBeLessThan(9_999);

            state.continuousEffects = [
                {
                    id: "ce-control",
                    layer: 2,
                    timestamp: 9_999,
                    expiry: { kind: "indefinite", controllerId: "p1" },
                    affected: { kind: "instances", instanceIds: ["bears"] },
                    payload: { kind: "control-change", controllerId: "p1" },
                    characteristicDefining: false,
                },
            ];

            const derived = deriveLayers2to5(view(state), asView(bears));
            expect(derived.controllerId).toBe("p1");
            expect(derived.types).toContain("Enchantment");

            // …and the sync actually MOVES it (CR 613.1b's output is placement).
            syncLayers2to5(state);
            expect(state.players[0].battlefield.map((c) => c.id)).toContain(
                "bears"
            );
            expect(bears.controllerId).toBe("p1");
        });
    });
});

describe("CR 205.1a — the one-shot card-type SET is a registry entry (issue #2084, PRD #2064 S4)", () => {
    /** `SpellContext.setCardTypes`' ledger, written the way the primitive
     *  writes it. */
    function withTypeLineHold(card: CardInstanceState, types: string[]): void {
        card.typeLineHolds = [
            ...(card.typeLineHolds ?? []),
            { types: types as CardInstanceState["types"], seq: 42 },
        ];
    }

    it("SETS the whole line: every type the object had and the entry does not name is suppressed (CR 205.1a)", () => {
        const lotus = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lotus] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        expect(lotus.types).toEqual(["Artifact"]);

        withTypeLineHold(lotus, ["Enchantment"]);
        syncLayers2to5(state);
        expect(lotus.types).toEqual(["Enchantment"]);
        // The provenance rows the pre-migration primitive wrote by hand are the
        // derivation's OUTPUT now, in the same shape.
        expect(lotus.grantedTypes).toEqual([
            { type: "Enchantment", auraId: "indefinite" },
        ]);
        expect(lotus.suppressedTypes).toEqual([
            { type: "Artifact", sourceId: "indefinite" },
        ]);
    });

    it("CR 400.7 — the SET dies with the object: a bounced permanent shows its PRINTED line", () => {
        const lotus = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lotus] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        withTypeLineHold(lotus, ["Enchantment"]);
        syncLayers2to5(state);
        expect(lotus.types).toEqual(["Enchantment"]);

        removePermanentTo(state, "lotus", "hand");
        const bounced = state.players[0].hand.find((c) => c?.id === "lotus")!;
        expect(bounced.types).toEqual(["Artifact"]);
        expect(bounced.typeLineHolds).toBeUndefined();
        expect(bounced.grantedTypes).toBeUndefined();
        expect(bounced.suppressedTypes).toBeUndefined();
    });
});

describe("wire format — the derived layer-4/5 answer survives projectPublicState (PRD #2064 S4)", () => {
    it("a derived type line, subtype line and colour grant all reach the client", () => {
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mtn] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        state.continuousEffects = [
            {
                id: "ce-type",
                layer: 4,
                timestamp: 10,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: ["mtn"] },
                payload: { kind: "type-change", add: ["Creature"] },
                characteristicDefining: false,
            },
            {
                id: "ce-subtype",
                layer: 4,
                timestamp: 20,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: ["mtn"] },
                payload: { kind: "subtype-change", set: ["Swamp"] },
                characteristicDefining: false,
            },
            {
                id: "ce-color",
                layer: 5,
                timestamp: 30,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: ["mtn"] },
                payload: { kind: "color-change", add: ["B"] },
                characteristicDefining: false,
            },
        ];
        syncLayers2to5(state);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "mtn"
        )!;
        expect(slim.types).toContain("Creature");
        expect(slim.subtypes).toEqual(["Swamp"]);
        expect(slim.grantedColors).toEqual([
            { color: "B", sourceId: "indefinite" },
        ]);
    });
});

describe("ADR 0082 — no CR 613 layer is derived outside the registry (PRD #2064 S4)", () => {
    it("gre/state.ts reads no `StaticEffect` kind at all: the three materialising walks are gone", () => {
        // The bound this slice completes. `applySourceStaticEffects`,
        // `applyExistingGrantsTo` and `unapplySourceStaticEffects` each used to
        // branch on `effect.kind` and write layer-2-to-6 records onto the
        // affected permanent; every one of those branches is now a registry
        // entry read by `gre/layers2to5.ts` or `gre/layer6.ts`. A new branch
        // reappearing in `gre/state.ts` is a second channel for a layer that
        // already has one, which is exactly the incoherence ADR 0082 exists to
        // remove — so the invariant is a scan, not a paragraph.
        const source = readFileSync(
            new URL("../state.ts", import.meta.url),
            "utf8"
        );
        expect(source).not.toMatch(/\beffect\.kind\s*===/);
    });
});

describe("CR 611.2b — the phase boundary re-derives layers 2-5 (PRD #2064 S4)", () => {
    it("a timed subtype replacement expiring at CLEANUP restores the derived line, and does NOT clobber a live SET that outlives it", () => {
        // The gap this pins: `tickAllDurations` drops the expired LEDGER rows,
        // and until PRD #2064 S4 nothing re-derived layers 2-5 afterwards — so
        // the boundary's effect was invisible until the next SBA pass. Worse,
        // the old restore wrote `restoreSubtypes` back onto `subtypes`
        // directly, which is the derivation's OUTPUT: with a longer-lived
        // `subtype-set` still applying, that array is not the answer.
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            // CR 514.2 — the boundary this test drives is the CLEANUP step.
            phase: "CLEANUP",
            players: [
                makePlayer("p1", { battlefield: [mtn] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        expect(mtn.subtypes).toEqual(["Mountain"]);

        // An INDEFINITE set that survives the boundary (a live Blood Moon-style
        // source's residue), plus a TIMED one stamped later that does not.
        state.continuousEffects = [
            {
                id: "ce-lasting",
                layer: 4,
                timestamp: 10,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: ["mtn"] },
                payload: { kind: "subtype-change", set: ["Island"] },
                characteristicDefining: false,
            },
        ];
        // Written the way `SpellContext.setSubtypesUntil` writes it: a CR
        // 613.7 stamp LATER than the indefinite set above, so the timed change
        // wins while it lasts.
        mtn.temporarySubtypeChange = {
            subtypes: ["Swamp"],
            restoreSubtypes: ["Mountain"],
            duration: { phase: "end-of-turn" },
            seq: 20,
        };
        syncLayers2to5(state);
        expect(mtn.subtypes).toEqual(["Swamp"]);

        finalizeCleanup(state);

        // The timed row is gone and the answer is RE-DERIVED: the indefinite
        // set is still applying, so the line is Island — not the `Mountain`
        // the expired row carried as its restore anchor.
        expect(mtn.temporarySubtypeChange).toBeUndefined();
        expect(mtn.subtypes).toEqual(["Island"]);
    });
});

describe("review findings — the shapes a materialise-to-derive migration loses (PRD #2064 S4)", () => {
    it("B1 CR 613.7 — a timed subtype change that resolves LATER beats a live subtype-set aura", () => {
        // `SpellContext.setSubtypesUntil` used to write `card.subtypes`
        // directly, which put its answer last by accident. As a derivation
        // input its ledger row needs a real minted stamp, or it sorts below
        // every `staticSeq` and the OLDER aura wins the CR 613.7 race.
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(evilPresence.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
        });
        aura.attachedTo = "land";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, aura] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, aura);
        expect(land.subtypes).toEqual(["Swamp"]);

        const item = pushSpell(state, grizzlyBears.id, "p1");
        buildSpellContext(state, item).setSubtypesUntil(
            { type: "permanent", id: "land" },
            ["Forest"],
            { phase: "end-of-turn" }
        );
        expect(land.subtypes).toEqual(["Forest"]);
        // …and it survives the next full recompute, which is where the missing
        // stamp used to show: an SBA pass handed the land back to the aura.
        checkStateBasedActions(state);
        expect(land.subtypes).toEqual(["Forest"]);
    });

    it("B2 CR 205.4a — a later supertype toggle cancels the earlier opposite one", () => {
        // `hasSupertypeLive` checks GRANTED before REMOVED, so a walk that
        // accumulates both lists answers `true` forever: Arcum's Weathervane
        // could make a land snow but never make it non-snow again.
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        applyIndefiniteSupertypeMutation(land, "Snow", true, 10);
        syncLayers2to5(state);
        expect(hasSupertypeLive(land, "Snow")).toBe(true);

        applyIndefiniteSupertypeMutation(land, "Snow", false, 20);
        syncLayers2to5(state);
        expect(hasSupertypeLive(land, "Snow")).toBe(false);
    });

    it("B3 CR 400.7 — a pre-S4 snapshot's ledgerless effects are promoted, not deleted, by the first derivation", () => {
        // `game_state` is a live per-game snapshot, so a deploy lands mid-game.
        // Every derived-output field is overwritten at the first sync; without
        // the promotion that overwrite is a DELETION.
        const lotus = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Exactly what the pre-S4 engine wrote for an Oko `+1`-style one-shot
        // SET, a Magical Hack rewrite and an Arcum's Weathervane toggle.
        lotus.types = ["Enchantment"];
        lotus.grantedTypes = [{ type: "Enchantment", auraId: "indefinite" }];
        lotus.suppressedTypes = [{ type: "Artifact", sourceId: "indefinite" }];
        lotus.textChanges = [
            { kind: "land-type", from: "Island", to: "Swamp" },
        ];
        lotus.grantedSupertypes = [
            { supertype: "Snow", sourceId: "indefinite" },
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lotus] }),
                makePlayer("p2"),
            ],
        });

        syncLayers2to5(state);

        expect(lotus.types).toEqual(["Enchantment"]);
        expect(lotus.textChanges).toEqual([
            { kind: "land-type", from: "Island", to: "Swamp" },
        ]);
        expect(hasSupertypeLive(lotus, "Snow")).toBe(true);

        // …and the promotion runs ONCE. The discriminating case is a CR 400.7
        // departure: it deletes all three bases and every ledger, but leaves
        // this engine's own derived-output rows on the instance. A migration
        // gated on "the bases are missing" would read those rows as a pre-S4
        // snapshot and promote them into permanent ledgers — the effect would
        // come back from the graveyard with the card it is supposed to have
        // died with.
        removePermanentTo(state, "lotus", "hand");
        const bounced = state.players[0].hand.find((c) => c?.id === "lotus")!;
        expect(bounced.typeLineHolds).toBeUndefined();
        expect(bounced.textChangeHolds).toBeUndefined();
        expect(bounced.supertypeHolds).toBeUndefined();

        state.players[0].hand = state.players[0].hand.filter(
            (c) => c?.id !== "lotus"
        );
        state.players[0].battlefield.push(bounced);
        syncLayers2to5(state);
        expect(bounced.typeLineHolds).toBeUndefined();
        expect(bounced.supertypeHolds).toBeUndefined();
        expect(bounced.types).toEqual(["Artifact"]);
        expect(hasSupertypeLive(bounced, "Snow")).toBe(false);
    });

    it("B4 CR 613.7 — the layer-4 subtype base excludes a subtype a live ADD put there (issue #1715)", () => {
        // A base that contained the add would make it IMMORTAL: it would
        // survive its own source leaving play, because the derivation replays
        // the add from its own record on top of a base that already has it.
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        land.subtypes = ["Mountain", "Swamp"];
        land.grantedSubtypesAdd = [
            { subtype: "Swamp", auraId: "indefinite", seq: 5 },
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        expect(land.baseSubtypes).toEqual(["Mountain"]);
    });

    it("B5 — clearing the layer-4 base clears the field that outranks it", () => {
        // `layer4SubtypeBase` falls back to `printedSubtypes` BEFORE `subtypes`,
        // so a stale one left behind would silently undo the very rewrite
        // `clearLayers2to5Base` exists to admit.
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        syncLayers2to5(state);
        expect(land.printedSubtypes).toEqual(["Mountain"]);

        // A CR 614.12c body choice rewriting the object's OWN subtype line.
        land.subtypes = [...land.subtypes, "Shapeshifter"];
        clearLayers2to5Base(land);
        syncLayers2to5(state);
        expect(land.subtypes).toEqual(["Mountain", "Shapeshifter"]);
    });
});
