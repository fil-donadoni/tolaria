// CR 113.6b — "An ability that states which zones it functions in functions
// only from those zones." The seam is general: any characteristic-changing
// static effect may declare `zone: "graveyard"`, and every layer walk
// (layers 2-5, 6, 7) reads it from its owner's graveyard and never from the
// battlefield. Anger (`cards/sets/jud/red.cards.ts`) is the shipped layer-6
// declarer; these variants prove layers 4 and 7 take one with no engine
// change, through the real recompute and the wire projection.
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { checkStateBasedActions } from "../sba";
import { beginApplyingStaticEffects, type GameState } from "../state";
import { getEffectivePower, type LayerStateView } from "../layers";
import { projectPublicState } from "../../gameProjections";
import type { PermanentView } from "../../cards/types";

const yourCreatures = (target: PermanentView, source: PermanentView): boolean =>
    target.controllerId === source.controllerId &&
    target.types.includes("Creature");

/** "As long as this card is in your graveyard, creatures you control get
 *  +1/+0" and "... are Artifacts in addition to their other types" — a layer
 *  7c and a layer 4 graveyard-resident static on one test-only card. */
const graveyardAnthem: CardDefinition = {
    id: "test-graveyard-anthem",
    name: "Test Graveyard Anthem",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 2 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-buff",
            zone: "graveyard",
            applies: yourCreatures,
            power: 1,
            toughness: 0,
        },
        {
            kind: "type-add",
            zone: "graveyard",
            applies: yourCreatures,
            types: ["Artifact"],
        },
    ],
};

function boardWithAnthemIn(zone: "graveyard" | "battlefield"): GameState {
    const anthem = makeInstance(graveyardAnthem.id, {
        id: "anthem",
        zone,
    });
    const bears = makeInstance(grizzlyBears().id, { id: "bears" });
    const oppBears = makeInstance(grizzlyBears().id, {
        id: "opp-bears",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: zone === "battlefield" ? [anthem, bears] : [bears],
                graveyard: zone === "graveyard" ? [anthem] : [],
            }),
            makePlayer("p2", { battlefield: [oppBears] }),
        ],
    });
    if (zone === "battlefield") beginApplyingStaticEffects(state, anthem);
    checkStateBasedActions(state);
    return state;
}

const bf = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;

describe("graveyard-functioning static effects (CR 113.6b)", () => {
    it("layer 7c — a graveyard pt-buff applies to its owner's creatures", () => {
        withTemporaryDefinition(graveyardAnthem, () => {
            const state = boardWithAnthemIn("graveyard");
            const view = state as unknown as LayerStateView;
            expect(getEffectivePower(view, bf(state, "bears"))).toBe(3);
            expect(getEffectivePower(view, bf(state, "opp-bears"))).toBe(2);
        });
    });

    it("layer 7c — survives the public-state projection", () => {
        withTemporaryDefinition(graveyardAnthem, () => {
            const state = boardWithAnthemIn("graveyard");
            const projected = projectPublicState(state, 1, "p2");
            const view = projected as unknown as LayerStateView;
            const bears = projected.players[0].battlefield.find(
                (c) => c.id === "bears"
            )!;
            expect(
                getEffectivePower(view, bears as unknown as PermanentView)
            ).toBe(3);
        });
    });

    it("layer 4 — a graveyard type-add applies to its owner's creatures", () => {
        withTemporaryDefinition(graveyardAnthem, () => {
            const state = boardWithAnthemIn("graveyard");
            expect(bf(state, "bears").types).toContain("Artifact");
            expect(bf(state, "opp-bears").types).not.toContain("Artifact");
        });
    });

    it("on the battlefield the same effects contribute nothing", () => {
        withTemporaryDefinition(graveyardAnthem, () => {
            const state = boardWithAnthemIn("battlefield");
            const view = state as unknown as LayerStateView;
            expect(getEffectivePower(view, bf(state, "bears"))).toBe(2);
            expect(bf(state, "bears").types).not.toContain("Artifact");
        });
    });
});
