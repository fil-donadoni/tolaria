// CR 601.2f — the Bot's activation enumeration must see a SELF-REDUCED
// activation cost (ADR 0096, issue #2288).
//
// `enumerateAbilityMoves` (gre/moves.ts) used to read `ability.cost.mana` raw
// and call no cost modifier at all, while its spell twin in the same module
// already folded `getCostModifiers`. That is an omission, not a design: a bot
// that believes an ability is unaffordable never activates it, so a reduction
// the SERVER honours was invisible to the search — the card would simply never
// be played.
//
// The discriminating pair is inside one enumeration: the same permanent
// carries two abilities with the identical printed {1}{G} cost, and only one
// declares the reduction. With a single Forest untapped, exactly the reduced
// one must be reachable.

import { describe, expect, it } from "vitest";
import { getCardByName, preloadDefinitions } from "../../cards";
import type { CardDefinition, ManaCost } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves } from "../moves";
import type { GameState } from "../state";

const FOREST = getCardByName("Forest").id;

const BOT_REDUCER_ID = "00000000-0000-4000-8000-000022881001";
const BOT_LEGEND_ID = "00000000-0000-4000-8000-000022881002";

const LEGENDARY_CREATURE_COUNT = {
    perCount: { X: 1 } as ManaCost,
    countFilter: { types: "Creature", supertypes: "Legendary" },
} as const;

preloadDefinitions([
    {
        id: BOT_REDUCER_ID,
        name: "Synthetic Bot-Facing Reducer",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "bot-reduced-gain",
                oracleText:
                    "{1}{G}: You gain 3 life. This ability costs {1} less to activate for each legendary creature you control.",
                cost: {
                    mana: { X: 1, G: 1 },
                    selfReduction: LEGENDARY_CREATURE_COUNT,
                },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
            {
                id: "bot-plain-gain",
                oracleText: "{1}{G}: You gain 1 life.",
                cost: { mana: { X: 1, G: 1 } },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ],
    } as CardDefinition,
    {
        id: BOT_LEGEND_ID,
        name: "Synthetic Bot-Facing Legend",
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Spirit"],
        power: 1,
        toughness: 1,
    } as CardDefinition,
]);

/** p1: the reducer, ONE untapped Forest, and `legends` legendary creatures. */
function boardWith(legends: number): GameState {
    const permanents = [
        makeInstance(BOT_REDUCER_ID, {
            id: "reducer",
            controllerId: "p1",
            ownerId: "p1",
        }),
        makeInstance(FOREST, {
            id: "forest",
            controllerId: "p1",
            ownerId: "p1",
        }),
        ...Array.from({ length: legends }, (_, i) =>
            makeInstance(BOT_LEGEND_ID, {
                id: `legend-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        ),
    ];
    return makeState({
        players: [
            makePlayer("p1", { battlefield: permanents }),
            makePlayer("p2"),
        ],
    });
}

function activatedAbilityIds(state: GameState): string[] {
    return enumerateMoves(state, "p1")
        .filter((m) => m.kind === "activate-ability")
        .map((m) => (m as { abilityId: string }).abilityId);
}

describe("enumerateAbilityMoves — cost.selfReduction (CR 601.2f, ADR 0096)", () => {
    it("offers the self-reducing ability when only the REDUCED cost is coverable", () => {
        // One Forest = {G}. Printed {1}{G} is unpayable; reduced {G} is exact.
        const ids = activatedAbilityIds(boardWith(1));
        expect(ids).toContain("bot-reduced-gain");
        // Same permanent, same printed cost, no reduction declared: still
        // unaffordable. The pair is what proves the fold is per ability rather
        // than a blanket discount on the source.
        expect(ids).not.toContain("bot-plain-gain");
    });

    it("offers neither ability when nothing matches the reduction's filter", () => {
        const ids = activatedAbilityIds(boardWith(0));
        expect(ids).not.toContain("bot-reduced-gain");
        expect(ids).not.toContain("bot-plain-gain");
    });

    it("offers both once the mana covers the printed cost too", () => {
        // Two legendary creatures is still {G} for the reduced ability, but the
        // second Forest is what makes the PLAIN {1}{G} payable — proving the
        // enumeration is gated on mana, not on the reduction's presence.
        const state = boardWith(1);
        state.players[0].battlefield.push(
            makeInstance(FOREST, {
                id: "forest-2",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const ids = activatedAbilityIds(state);
        expect(ids).toContain("bot-reduced-gain");
        expect(ids).toContain("bot-plain-gain");
    });
});
