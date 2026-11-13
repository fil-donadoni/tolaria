// CR 601.2c (issue #9536) — a spell cast DURING a resolution (CR 608.2g)
// announces EVERY target it requires: each target group in order, each group
// filled to its count. The single `count: 1` pick cast "two target creatures"
// with one. Every case runs the real Op or the real card through
// `resolveTopOfStack` and answers the pending choices the client is shown.

import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import type { EffectOp } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";

const DEAD_RINGERS = getCardByName("Dead Ringers"); // two target nonblack creatures
const PLAGUE_SPORES = getCardByName("Plague Spores"); // target nonblack creature + target land
const BARRINS_SPITE = getCardByName("Barrin's Spite"); // two, same controller
const WORD_OF_COMMAND = getCardByName("Word of Command");

function card(
    name: string,
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(getCardByName(name).id, {
        id,
        controllerId: ownerId,
        ownerId,
        zone,
    });
}

/** "Exile the top card of your library. You may cast it without paying its
 *  mana cost." */
const FREE_TOP_CAST = (() => {
    const id = "test-cdr-targets-free-top";
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects: [
            {
                op: "castDuringResolution",
                fromTopOfLibrary: true,
                player: "controller",
                free: true,
            },
        ] as EffectOp[],
    });
    return id;
})();

/** "Destroy one or two target creatures." — an "up to" tail. */
const ONE_OR_TWO = (() => {
    const id = "test-cdr-targets-one-or-two";
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { B: 1 },
        types: ["Sorcery"],
        targetRequirement: { type: "Creature", count: { min: 1, max: 2 } },
        effects: [{ op: "destroy", target: { target: 0 } }],
    });
    return id;
})();

function freeCastOf(
    topDefId: string,
    p1Battlefield: CardInstanceState[],
    p2Battlefield: CardInstanceState[]
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: p1Battlefield,
                library: [
                    makeInstance(topDefId, {
                        id: "top",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
    pushSpell(state, FREE_TOP_CAST, "p1");
    resolveTopOfStack(state);
    // The offer: cast it or decline.
    submit(state, "cast");
    return state;
}

function submit(state: GameState, id: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [id],
    });
}

/** The head choice as the client receives it. */
function head(state: GameState, viewerId = "p1") {
    return projectPublicState(state, 1, viewerId).pendingChoices?.[0];
}

function targetsOf(state: GameState, id: string): string[] | undefined {
    return state.stack.find((s) => s.id === id)?.targets?.map((t) => t.id);
}

describe("castDuringResolution announces every target (CR 601.2c, issue #9536)", () => {
    it("a two-target spell asks two picks, never the same object twice (CR 115.3)", () => {
        const state = freeCastOf(
            DEAD_RINGERS.id,
            [],
            [
                card("Hill Giant", "a", "p2", "battlefield"),
                card("Grizzly Bears", "b", "p2", "battlefield"),
                card("Drudge Skeletons", "black", "p2", "battlefield"),
            ]
        );
        expect(head(state)?.kind).toBe("choose-damage-target");
        // "nonblack" — the black creature is never offered.
        expect(head(state)?.candidateIds).toEqual(["a", "b"]);
        submit(state, "a");
        expect(head(state)?.kind).toBe("choose-damage-target");
        expect(head(state)?.candidateIds).toEqual(["b"]);
        submit(state, "b");
        expect(targetsOf(state, "top")).toEqual(["a", "b"]);
    });

    it("a two-target spell with one legal creature is not cast (CR 601.2c)", () => {
        const state = freeCastOf(
            DEAD_RINGERS.id,
            [],
            [card("Hill Giant", "a", "p2", "battlefield")]
        );
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack.find((s) => s.id === "top")).toBeUndefined();
    });

    it("an additionalTargetRequirements spell announces one target per group, in order", () => {
        const state = freeCastOf(
            PLAGUE_SPORES.id,
            [card("Forest", "land", "p1", "battlefield")],
            [card("Hill Giant", "a", "p2", "battlefield")]
        );
        expect(head(state)?.candidateIds).toEqual(["a"]);
        submit(state, "a");
        // The second group is the land's: the creature is not offered there.
        expect(head(state)?.candidateIds).toEqual(["land"]);
        submit(state, "land");
        expect(targetsOf(state, "top")).toEqual(["a", "land"]);
    });

    it("a same-controller pair offers only creatures whose controller has a second one", () => {
        const state = freeCastOf(
            BARRINS_SPITE.id,
            [card("Grizzly Bears", "mine", "p1", "battlefield")],
            [
                card("Hill Giant", "a", "p2", "battlefield"),
                card("Hill Giant", "b", "p2", "battlefield"),
            ]
        );
        expect(head(state)?.candidateIds).toEqual(["a", "b"]);
        submit(state, "b");
        expect(head(state)?.candidateIds).toEqual(["a"]);
        submit(state, "a");
        expect(targetsOf(state, "top")).toEqual(["b", "a"]);
    });

    it("an 'up to' group announces how many targets first (CR 601.2c)", () => {
        const state = freeCastOf(
            ONE_OR_TWO,
            [],
            [
                card("Hill Giant", "a", "p2", "battlefield"),
                card("Grizzly Bears", "b", "p2", "battlefield"),
            ]
        );
        expect(head(state)?.kind).toBe("option-pick");
        expect(head(state)?.options?.map((o) => o.id)).toEqual(["1", "2"]);
        submit(state, "1");
        expect(head(state)?.candidateIds).toEqual(["a", "b"]);
        submit(state, "a");
        expect(targetsOf(state, "top")).toEqual(["a"]);
    });

    it("an 'up to' group announced at two takes two targets", () => {
        const state = freeCastOf(
            ONE_OR_TWO,
            [],
            [
                card("Hill Giant", "a", "p2", "battlefield"),
                card("Grizzly Bears", "b", "p2", "battlefield"),
            ]
        );
        submit(state, "2");
        submit(state, "a");
        expect(head(state)?.candidateIds).toEqual(["b"]);
        submit(state, "b");
        expect(targetsOf(state, "top")).toEqual(["a", "b"]);
    });

    it("an 'up to' group with one legal object asks no count (no real choice)", () => {
        const state = freeCastOf(
            ONE_OR_TWO,
            [],
            [card("Hill Giant", "a", "p2", "battlefield")]
        );
        expect(head(state)?.kind).toBe("choose-damage-target");
        submit(state, "a");
        expect(targetsOf(state, "top")).toEqual(["a"]);
    });
});

describe("Word of Command announces every target of the controlled spell (CR 601.2c, issue #9536)", () => {
    it("the controller picks both targets of a two-target spell", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        card("Hill Giant", "a", "p1", "battlefield"),
                        card("Grizzly Bears", "b", "p1", "battlefield"),
                    ],
                }),
                makePlayer("p2", {
                    hand: [card("Dead Ringers", "chosen", "p2", "hand")],
                    battlefield: Array.from({ length: 5 }, (_, i) =>
                        card("Swamp", `swamp-${i}`, "p2", "battlefield")
                    ),
                }),
            ],
        });
        pushSpell(state, WORD_OF_COMMAND.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        submit(state, "chosen");
        expect(head(state)?.kind).toBe("choose-damage-target");
        expect(state.pendingChoices![0].playerId).toBe("p1");
        expect(head(state)?.candidateIds).toEqual(["a", "b"]);
        submit(state, "a");
        expect(head(state)?.candidateIds).toEqual(["b"]);
        submit(state, "b");
        const spell = state.stack.find((s) => s.id === "chosen")!;
        expect(spell.castById).toBe("p2");
        expect(spell.targets?.map((t) => t.id)).toEqual(["a", "b"]);
    });
});
