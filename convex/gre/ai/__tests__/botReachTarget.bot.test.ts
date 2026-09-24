// Bot-play sweep position for targeted spells (issue #4259). A spell whose
// target requirement narrows the creature, or whose cost needs more than the
// position's lands, was refused by the ENGINE for a human too — the verdict
// `position-unmodelled` was a fact about the harness. One case per class of
// pose, each asserting the very affordance a human's client gates the cast on
// (`getLegalActions`), plus a full sweep play for the combat shapes.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type {
    CardDefinition,
    EffectOp,
    TargetRequirement,
} from "../../../cards/types";
import { getLegalActions } from "../../rules";
import { buildBotReachState, playBotReach } from "../botReach";

const DESTROY: EffectOp[] = [{ op: "destroy", target: { target: 0 } }];
const PUMP: EffectOp[] = [
    {
        op: "pump",
        target: { target: 0 },
        power: 2,
        toughness: 2,
        duration: { phase: "end-of-turn" },
    },
];

function instant(
    slug: string,
    requirement: Partial<TargetRequirement>,
    extra: Partial<CardDefinition> = {}
): CardDefinition {
    return {
        id: `bot-reach-target-test:${slug}`,
        name: `Bot Reach Target ${slug}`,
        rarity: "common",
        manaCost: { W: 1, generic: 1 },
        types: ["Instant"],
        targetRequirement: { type: "Creature", count: 1, ...requirement },
        effects: DESTROY,
        ...extra,
    };
}

/** CR 117.1 — does the engine offer the holder this card's cast? */
function castable(def: CardDefinition): boolean {
    return withTemporaryDefinition(def, () => {
        const { state, holderId, instanceId } = buildBotReachState(def, 0);
        const player = state.players.find((p) => p.id === holderId)!;
        const card = player.hand.find((c) => c.id === instanceId)!;
        return getLegalActions(state, player, card).includes("cast");
    });
}

describe("the generated position poses a narrowed creature target (CR 115.1)", () => {
    const shapes: ReadonlyArray<readonly [string, CardDefinition]> = [
        ["power N or greater", instant("power", { powerFilter: { min: 4 } })],
        [
            "toughness N or less (no toughness boost)",
            instant("toughness", { toughnessFilter: { max: 3 } }),
        ],
        ["a colour", instant("colour", { colorFilter: "W" })],
        ["a subtype", instant("subtype", { subtypeFilter: ["Human"] })],
        [
            "a subtype only defenders carry",
            instant("wall", { subtypeFilter: "Wall" }),
        ],
        ["a supertype", instant("legend", { supertypeFilter: ["Legendary"] })],
        ["tapped", instant("tapped", { tappedFilter: "tapped" })],
    ];
    it.each(shapes)("%s", (_label, def) => {
        expect(castable(def)).toBe(true);
    });
});

describe("the generated position poses a declared combat (CR 508.1, 509.1)", () => {
    it("attacking creature (CR 508.1)", () => {
        const def = instant("attacking", { combatRoleFilter: ["attacking"] });
        expect(castable(def)).toBe(true);
        expect(withTemporaryDefinition(def, () => playBotReach(def))).toEqual({
            outcome: "played",
        });
    });

    it("blocking creature of the opponent (CR 509.1)", () => {
        const def = instant("blocking-removal", {
            combatRoleFilter: ["blocking"],
        });
        expect(castable(def)).toBe(true);
    });

    it("blocking creature of the holder, for a pump (CR 509.1)", () => {
        const def = instant(
            "blocking-pump",
            { combatRoleFilter: ["blocking"] },
            { effects: PUMP }
        );
        expect(castable(def)).toBe(true);
        expect(withTemporaryDefinition(def, () => playBotReach(def))).toEqual({
            outcome: "played",
        });
    });
});

describe("the generated position pays a cost its lands cannot (CR 601.2h)", () => {
    it("an additional discard cost needs a real card to discard", () => {
        const def = instant(
            "discard",
            {},
            { additionalCosts: { discard: { filter: {}, count: 1 } } }
        );
        expect(castable(def)).toBe(true);
    });

    it("a colourless mana symbol needs colourless mana (CR 106.1b)", () => {
        const def = instant(
            "colourless",
            {},
            { manaCost: { C: 1, generic: 1 } }
        );
        expect(castable(def)).toBe(true);
    });
});

describe("a requirement no plain creature satisfies stays unmodelled", () => {
    it("is refused the cast, not posed with something else", () => {
        const def = instant("nothing", {
            subtypeFilter: ["Bot Reach Nonexistent Type"],
        });
        expect(castable(def)).toBe(false);
    });
});
