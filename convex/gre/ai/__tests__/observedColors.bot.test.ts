// `observedOpponentColors` (issue #2306) — the opponent's OBSERVABLE colour
// footprint, the shared derivation `colorModePrior` (`choicePriors.ts`) and
// the `colorModeTiebreak` (`search.ts`) both read. Each `describe` pins one
// row of the evidence-boundary table from the module's own header comment.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import { grizzlyBears } from "../../../cards/sets/lea/green";
import { lightningBolt } from "../../../cards/sets/lea/red";
import { island, mountain } from "../../../cards/sets/lea/colorless";
import { lotusPetal } from "../../../cards/sets/tmp/colorless";
import { observedOpponentColors } from "../observedColors";

describe("observedOpponentColors — evidence weighting (issue #2306)", () => {
    it("a battlefield permanent's effective colour is evidence", () => {
        const p1 = makePlayer("p1", {
            battlefield: [grizzlyBears, grizzlyBears].map((def, i) =>
                makeInstance(def.id, { id: `bear-${i}`, controllerId: "p1" })
            ),
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(observedOpponentColors(state, "p1")).toEqual({ G: 6 });
    });

    it("a graveyard card's STATIC colour is evidence, even with no matching permanent", () => {
        const p1 = makePlayer("p1", {
            graveyard: [
                makeInstance(lightningBolt.id, {
                    id: "bolt-gy",
                    controllerId: "p1",
                    zone: "graveyard",
                }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(observedOpponentColors(state, "p1")).toEqual({ R: 3 });
    });

    it("a spell on the stack CAST BY the opponent is evidence, keyed on castById not controllerId", () => {
        const p1 = makePlayer("p1");
        const state = makeState({ players: [p1, makePlayer("p2")] });
        pushSpell(state, lightningBolt.id, "p1");
        expect(observedOpponentColors(state, "p1")).toEqual({ R: 3 });
    });

    it("a spell on the stack cast by someone ELSE is not this player's evidence", () => {
        const p1 = makePlayer("p1");
        const state = makeState({ players: [p1, makePlayer("p2")] });
        pushSpell(state, lightningBolt.id, "p2");
        expect(observedOpponentColors(state, "p1")).toEqual({});
    });

    it("acceptance criterion 3 — an UNTAPPED colour-producing land counts as a threat with ZERO matching permanents", () => {
        const p1 = makePlayer("p1", {
            battlefield: [
                makeInstance(island.id, {
                    id: "isle-1",
                    controllerId: "p1",
                    isTapped: false,
                }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(observedOpponentColors(state, "p1")).toEqual({ U: 1 });
    });

    it("a TAPPED land contributes nothing — spent mana is not a shown threat", () => {
        const p1 = makePlayer("p1", {
            battlefield: [
                makeInstance(island.id, {
                    id: "isle-1",
                    controllerId: "p1",
                    isTapped: true,
                }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(observedOpponentColors(state, "p1")).toEqual({});
    });

    it("a SACRIFICE-gated mana source (Lotus Petal) is excluded — spending it is a decision not yet made", () => {
        const p1 = makePlayer("p1", {
            battlefield: [
                makeInstance(lotusPetal.id, {
                    id: "petal-1",
                    controllerId: "p1",
                    isTapped: false,
                }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(observedOpponentColors(state, "p1")).toEqual({});
    });

    it("a REAL permanent on board is WEIGHTED STRONGER than a merely-producible mana source", () => {
        const p1 = makePlayer("p1", {
            battlefield: [
                makeInstance(grizzlyBears.id, {
                    id: "bear-1",
                    controllerId: "p1",
                }),
                makeInstance(mountain.id, {
                    id: "mtn-1",
                    controllerId: "p1",
                    isTapped: false,
                }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const evidence = observedOpponentColors(state, "p1");
        expect(evidence.G).toBeGreaterThan(evidence.R!);
    });

    it("acceptance criterion 6 — never reads the opponent's hand (hidden-info-safe by construction)", () => {
        const base = makePlayer("p1", {
            battlefield: [
                makeInstance(island.id, {
                    id: "isle-1",
                    controllerId: "p1",
                    isTapped: false,
                }),
            ],
        });
        const stateWithSecretHand = makeState({
            players: [
                {
                    ...base,
                    hand: [
                        makeInstance(lightningBolt.id, {
                            id: "hidden-1",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                },
                makePlayer("p2"),
            ],
        });
        const stateWithDifferentHand = makeState({
            players: [
                {
                    ...base,
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "hidden-2",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                },
                makePlayer("p2"),
            ],
        });
        expect(observedOpponentColors(stateWithSecretHand, "p1")).toEqual(
            observedOpponentColors(stateWithDifferentHand, "p1")
        );
    });

    it("no evidence at all — empty object, not a crash (acceptance criterion 4's engine-side half)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        expect(observedOpponentColors(state, "p1")).toEqual({});
    });
});
