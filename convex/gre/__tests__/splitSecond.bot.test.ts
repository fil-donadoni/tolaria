// Split second (CR 702.61a, issue #4007) as the Bot's enumerator sees it: while
// the spell is on the stack the only moves left are passing and what CR 702.61b
// leaves alone, so the Bot can never pick a move the server refuses. Each refusal
// has a pair on a spell without the keyword. The mutations' side is
// `splitSecond.test.ts`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, registerTokenDefinition } from "../../cards";
import { enumerateMoves } from "../moves";
import { resolveTopOfStack, type GameState, type PlayerState } from "../state";

const SPLIT_SECOND_SPELL = "test:bot-split-second-instant";
registerTokenDefinition({
    id: SPLIT_SECOND_SPELL,
    rarity: "common",
    name: "Test Bot Split Second Instant",
    manaCost: {},
    types: ["Instant"],
    staticAbilities: ["split second"],
    resolve: () => {},
});
const PLAIN_SPELL = "test:bot-plain-instant";
registerTokenDefinition({
    id: PLAIN_SPELL,
    rarity: "common",
    name: "Test Bot Plain Instant",
    manaCost: {},
    types: ["Instant"],
    resolve: () => {},
});
/** A targetless stack ability on a life cost: the only shape
 *  `enumerateGrantedAbilityMoves` offers from a player-level grant. */
const STACK_GRANT_SOURCE = "test:bot-stack-grant-source";
registerTokenDefinition({
    id: STACK_GRANT_SOURCE,
    rarity: "common",
    name: "Test Bot Stack Grant Source",
    manaCost: {},
    types: ["Sorcery"],
    activatedAbilities: [
        {
            id: "stack-grant",
            oracleText: "Pay 1 life: Draw a card.",
            useStack: true,
            cost: { life: 1 },
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
});

const own = (name: string, id: string, zone: "hand" | "battlefield") =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
        isSummoningSick: false,
    });

/** p1 holds priority with `stacked`, cast by p2, on the stack. */
function board(
    stacked: string,
    extras: Partial<PlayerState>
): { state: GameState; kinds: string[] } {
    const state = makeState({
        players: [makePlayer("p1", extras), makePlayer("p2")],
    });
    pushSpell(state, stacked, "p2");
    return {
        state,
        kinds: enumerateMoves(state, "p1").map((m) => m.kind),
    };
}

const WITH_RESPONSES = (): Partial<PlayerState> => ({
    hand: [own("Lightning Bolt", "bolt", "hand")],
    battlefield: [
        own("Mountain", "mountain", "battlefield"),
        own("Shivan Dragon", "dragon", "battlefield"),
    ],
});

describe("the Bot's enumerator under split second (CR 702.61a)", () => {
    it("offers neither the cast nor the activation, only the pass", () => {
        const { kinds } = board(SPLIT_SECOND_SPELL, WITH_RESPONSES());
        expect(kinds).toEqual(["pass"]);
    });

    it("offers both over a spell without the keyword", () => {
        const { kinds } = board(PLAIN_SPELL, WITH_RESPONSES());
        expect(kinds).toContain("cast-spell");
        expect(kinds).toContain("activate-ability");
    });

    it("offers both again once the spell has left the stack", () => {
        const { state } = board(SPLIT_SECOND_SPELL, WITH_RESPONSES());
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        state.priorityPlayerId = "p1";
        const kinds = enumerateMoves(state, "p1").map((m) => m.kind);
        expect(kinds).toContain("cast-spell");
        expect(kinds).toContain("activate-ability");
    });

    const grant = (
        id: string,
        sourceCardId: string,
        abilityId: string
    ): NonNullable<PlayerState["grantedAbilities"]>[number] => ({
        id,
        sourceCardId,
        abilityId,
        duration: { phase: "end-of-turn" },
        grantedAtTurn: 1,
    });

    it("drops a player-level stack grant, which stays legal over a plain spell", () => {
        const extras = {
            grantedAbilities: [grant("g", STACK_GRANT_SOURCE, "stack-grant")],
        };
        expect(board(SPLIT_SECOND_SPELL, extras).kinds).toEqual(["pass"]);
        expect(board(PLAIN_SPELL, extras).kinds).toContain(
            "activate-granted-ability"
        );
    });

    it("keeps a player-level mana grant (CR 702.61b)", () => {
        const seed = makeState();
        pushSpell(seed, getCardByName("Channel").id, "p1");
        resolveTopOfStack(seed);
        const { kinds } = board(SPLIT_SECOND_SPELL, {
            grantedAbilities: seed.players[0].grantedAbilities,
        });
        expect(kinds).toContain("activate-granted-ability");
    });

    it("split second keeps a special action: foretelling (CR 702.61b)", () => {
        const { kinds } = board(SPLIT_SECOND_SPELL, {
            hand: [own("Behold the Multiverse", "omen", "hand")],
            battlefield: [
                own("Island", "land0", "battlefield"),
                own("Island", "land1", "battlefield"),
            ],
        });
        expect(kinds).toEqual(["pass", "foretell"]);
    });
});
