// Born of the Gods (BNG) — multicolor behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import {
    type CardInstanceState,
    type GameState,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { syncLayers2to5 } from "../../../../gre/layers2to5";
import { projectPublicState } from "../../../../gameProjections";
import { getCardByName, getDefinition } from "../../../index";

const xenagos = getDefinition("3184b138-1109-4195-9d96-4f190164e98b");
const grizzlyBears = getCardByName("Grizzly Bears")!; // {1}{G}
const kirdApe = getCardByName("Kird Ape")!; // {R}
const ballLightning = getCardByName("Ball Lightning")!; // {R}{R}{R}
const boggartRamGang = getCardByName("Boggart Ram-Gang")!; // {R/G}{R/G}{R/G}

function permanent(
    defId: string,
    id: string,
    controller = "p1"
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: controller,
        ownerId: controller,
    });
}

function board(mine: CardInstanceState[], theirs: CardInstanceState[] = []) {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: mine }),
            makePlayer("p2", { battlefield: theirs }),
        ],
        activePlayerId: "p1",
    });
}

/** Xenagos's types as the engine writes them AND as the wire carries them —
 *  the type line is derived (layer 4), so both readers must agree. */
function xenagosTypes(state: GameState) {
    syncLayers2to5(state);
    const live = state.players[0].battlefield.find((c) => c.id === "xen")!;
    const projected = projectPublicState(state, 1, "p1");
    const slim = projected.players[0].battlefield.find((c) => c.id === "xen")!;
    return { engine: live.types, wire: slim.types };
}

describe("Xenagos, God of Revels — devotion to red and green (CR 700.5, CR 611.3a)", () => {
    it("isn't a creature while devotion to red and green is below seven (its own {R}{G} = 2)", () => {
        const { engine, wire } = xenagosTypes(
            board([permanent(xenagos.id, "xen")])
        );
        expect(engine).toEqual(["Enchantment"]);
        expect(wire).toEqual(["Enchantment"]);
    });

    it("is a creature at exactly seven: {R}{G} + {R}{R}{R} + {G} + {R}", () => {
        const { engine, wire } = xenagosTypes(
            board([
                permanent(xenagos.id, "xen"),
                permanent(ballLightning.id, "bolt"),
                permanent(grizzlyBears.id, "bear"),
                permanent(kirdApe.id, "ape"),
            ])
        );
        expect(engine).toContain("Creature");
        expect(wire).toContain("Creature");
    });

    it("counts a red/green hybrid symbol ONCE (2 + 3 hybrid + 1 = 6, not a creature)", () => {
        const { engine, wire } = xenagosTypes(
            board([
                permanent(xenagos.id, "xen"),
                permanent(boggartRamGang.id, "gang"),
                permanent(grizzlyBears.id, "bear"),
            ])
        );
        expect(engine).not.toContain("Creature");
        expect(wire).not.toContain("Creature");
    });

    it("ignores the opponent's permanents", () => {
        const { engine } = xenagosTypes(
            board(
                [permanent(xenagos.id, "xen")],
                [
                    permanent(ballLightning.id, "bolt", "p2"),
                    permanent(ballLightning.id, "bolt2", "p2"),
                ]
            )
        );
        expect(engine).not.toContain("Creature");
    });
});

describe("Xenagos, God of Revels — beginning-of-combat pump (CR 608.2h X fixed once)", () => {
    function fire(state: GameState) {
        state.phase = "BEGINNING_OF_COMBAT";
        const items = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "BEGINNING_OF_COMBAT",
                activePlayerId: "p1",
            },
        ]);
        return items;
    }

    it("gives another target creature you control haste and +X/+X, X = its power", () => {
        const state = board([
            permanent(xenagos.id, "xen"),
            makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: true,
            }),
        ]);
        const items = fire(state);
        expect(items).toHaveLength(1);
        items[0].targets = [{ type: "permanent", id: "bear" }];
        state.stack.push(...items);
        resolveTopOfStack(state);
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(4);
        expect(bear.staticAbilities).toContain("haste");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(slim.staticAbilities).toContain("haste");
    });

    it("does not fire on the opponent's turn", () => {
        const state = board([
            permanent(xenagos.id, "xen"),
            permanent(grizzlyBears.id, "bear"),
        ]);
        state.activePlayerId = "p2";
        state.phase = "BEGINNING_OF_COMBAT";
        const items = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "BEGINNING_OF_COMBAT",
                activePlayerId: "p2",
            },
        ]);
        expect(items).toHaveLength(0);
    });
});
