// Outside the game (CR 400.11) and the `bringFromOutsideGame` Op (CR 400.11b
// + CR 701.20a — the Wish cards, issue #6523): the Op's permanent test.
//
//   CR 400.11   An object is outside the game if it isn't in any of the
//               game's zones. Outside the game is not a zone.
//   CR 400.11a  Cards in a player's sideboard are outside the game.
//   CR 400.11b  Some effects bring cards into a game from outside the game.
//   CR 701.20a  To reveal a card, show that card to all players.
//
// Driven through the real interpreter (`resolveTopOfStack`) and the real
// submit path (`applyPendingChoiceSubmit`); the surface assertions traverse
// `projectPublicState`, and the persistence one `compactState`/`expandState`.
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { getCardByName } from "../../cards";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { getPlayer, resolveTopOfStack, type GameState } from "../state";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { validateEffectScript } from "../effects/validate";

const MIND_TWIST = getCardByName("Mind Twist").id;
const CRAW_WURM = getCardByName("Craw Wurm").id;
const LURRUS = getCardByName("Lurrus of the Dream-Den").id;
const STONE_RAIN = getCardByName("Stone Rain").id;

const SORCERY_WISH: EffectOp[] = [
    {
        op: "bringFromOutsideGame",
        player: "controller",
        filter: { type: "Sorcery" },
        prompt: "Reveal a sorcery card you own from outside the game.",
    },
    { op: "exileSelf" },
];

function withWish<T>(effects: EffectOp[], fn: (id: string) => T): T {
    const def: CardDefinition = {
        id: "t6523-wish",
        name: "t6523-wish",
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    };
    return withTemporaryDefinition(def, () => fn(def.id));
}

const outside = (defId: string, id: string, owner = "p1") =>
    makeInstance(defId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "exile",
    });

/** p1 owns a sorcery and a creature outside the game; p2 another sorcery. */
function board(): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                outsideGame: [
                    outside(MIND_TWIST, "sb-twist"),
                    outside(CRAW_WURM, "sb-wurm"),
                ],
            }),
            makePlayer("p2", {
                outsideGame: [outside(STONE_RAIN, "sb-opp-rain", "p2")],
            }),
        ],
    });
}

function cast(state: GameState, id: string) {
    pushSpell(state, id, "p1");
    return resolveTopOfStack(state);
}

function submit(state: GameState, ids: string[], as = "p1") {
    const head = state.pendingChoices![0]!;
    applyPendingChoiceSubmit(state, {
        playerId: as,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

describe("bringFromOutsideGame — the Effect Op (CR 400.11b, CR 701.20a)", () => {
    it("validates as a script", () => {
        expect(
            validateEffectScript({
                id: "t6523-v",
                name: "t6523-v",
                effects: SORCERY_WISH,
            })
        ).toEqual([]);
    });

    it("raises an optional, zoneless pick over the matching cards the caster owns", () => {
        withWish(SORCERY_WISH, (id) => {
            const state = board();
            expect(cast(state, id)).toBeNull();
            expect(state.pendingChoices).toHaveLength(1);
            const head = state.pendingChoices![0]!;
            expect(head.kind).toBe("choose-outside-game-card");
            expect(head.playerId).toBe("p1");
            expect(head.zone).toBeUndefined();
            expect(head.count).toEqual({ min: 0, max: 1 });
            // The creature does not match; the opponent's sorcery is not p1's.
            expect(head.candidateIds).toEqual(["sb-twist"]);
        });
    });

    it("the picked card leaves the holder for the hand, revealed to every player", () => {
        withWish(SORCERY_WISH, (id) => {
            const state = board();
            cast(state, id);
            submit(state, ["sb-twist"]);
            const p1 = getPlayer(state, "p1");
            const card = p1.hand.find((c) => c.id === "sb-twist");
            expect(card?.zone).toBe("hand");
            expect([...(card?.knownTo ?? [])].sort()).toEqual(["p1", "p2"]);
            expect(p1.outsideGame?.map((c) => c.id)).toEqual(["sb-wurm"]);
            // The rest of the script ran: the wish exiled itself.
            expect(state.stack).toHaveLength(0);
            expect(p1.exile.map((c) => c.card.id)).toContain(id);
        });
    });

    it('"you may" — an empty submission moves nothing', () => {
        withWish(SORCERY_WISH, (id) => {
            const state = board();
            cast(state, id);
            submit(state, []);
            const p1 = getPlayer(state, "p1");
            expect(p1.hand).toHaveLength(0);
            expect(p1.outsideGame).toHaveLength(2);
            expect(state.stack).toHaveLength(0);
        });
    });

    it("a pool with no matching card still raises the pick — empty, so its presence reveals nothing", () => {
        withWish(SORCERY_WISH, (id) => {
            const state = board();
            getPlayer(state, "p1").outsideGame = [
                outside(CRAW_WURM, "sb-wurm"),
            ];
            expect(cast(state, id)).toBeNull();
            expect(state.pendingChoices![0]!.candidateIds).toEqual([]);
            // CR 609.3 — the only answer is the empty one, and it moves nothing.
            submit(state, []);
            expect(getPlayer(state, "p1").hand).toHaveLength(0);
            expect(state.stack).toHaveLength(0);
        });
    });

    it("the submit path refuses a card off the allow-list and a card not outside the game", () => {
        withWish(SORCERY_WISH, (id) => {
            const state = board();
            cast(state, id);
            expect(() => submit(state, ["sb-wurm"])).toThrow(
                "Card is not an eligible choice"
            );
            expect(() => submit(state, ["sb-opp-rain"])).toThrow(
                "Card is not outside the game"
            );
        });
    });

    it("an unspent companion is outside the game too; taking it spends the slot", () => {
        const anyCard: EffectOp[] = [
            {
                op: "bringFromOutsideGame",
                player: "controller",
                prompt: "Reveal a card you own from outside the game.",
            },
        ];
        withWish(anyCard, (id) => {
            const state = board();
            getPlayer(state, "p1").companion = {
                instance: outside(LURRUS, "lurrus"),
                used: false,
            };
            cast(state, id);
            expect(state.pendingChoices![0]!.candidateIds).toEqual([
                "sb-twist",
                "sb-wurm",
                "lurrus",
            ]);
            submit(state, ["lurrus"]);
            const p1 = getPlayer(state, "p1");
            expect(p1.hand.map((c) => c.id)).toEqual(["lurrus"]);
            expect(p1.companion?.used).toBe(true);
            expect(p1.outsideGame).toHaveLength(2);
        });
    });
});

describe("outside the game on the wire (CR 400.11a — hidden information)", () => {
    it("the holder reaches its owner only; the pick's candidates reach its chooser", () => {
        withWish(SORCERY_WISH, (id) => {
            const state = board();
            cast(state, id);
            const asOwner = projectPublicState(state, 1, "p1");
            const asOpponent = projectPublicState(state, 1, "p2");
            const ownerP1 = asOwner.players.find((p) => p.id === "p1")!;
            const oppP1 = asOpponent.players.find((p) => p.id === "p1")!;
            expect(ownerP1.outsideGame?.map((c) => c.id)).toEqual([
                "sb-twist",
                "sb-wurm",
            ]);
            expect(ownerP1.outsideGamePeek?.map((c) => c.id)).toEqual([
                "sb-twist",
            ]);
            // The owner never sees the OPPONENT's holder.
            expect(
                asOwner.players.find((p) => p.id === "p2")!.outsideGame
            ).toBeUndefined();
            expect(oppP1.outsideGame).toBeUndefined();
            expect(oppP1.outsideGamePeek).toBeUndefined();
            // The allow-list counts the owner's matching sideboard cards: the
            // chooser gets it, the opponent gets the pick without it.
            expect(asOwner.pendingChoices?.[0]?.candidateIds).toEqual([
                "sb-twist",
            ]);
            expect(asOpponent.pendingChoices?.[0]?.kind).toBe(
                "choose-outside-game-card"
            );
            expect(
                asOpponent.pendingChoices?.[0]?.candidateIds
            ).toBeUndefined();
            // The pending-choice wire discipline: `pendingChoices` crosses
            // unredacted (opaque instance ids), so what must never reach the
            // opponent is a holder card's IDENTITY.
            const wire = JSON.stringify(asOpponent);
            expect(wire).not.toContain(MIND_TWIST);
            expect(wire).not.toContain(CRAW_WURM);
        });
    });

    it("once brought in and revealed, the card shows in the owner's hand to the opponent", () => {
        withWish(SORCERY_WISH, (id) => {
            const state = board();
            cast(state, id);
            submit(state, ["sb-twist"]);
            const oppView = projectPublicState(state, 1, "p2");
            const hand = oppView.players.find((p) => p.id === "p1")!.hand;
            expect(hand.map((c) => c?.card.id)).toEqual([MIND_TWIST]);
        });
    });
});

describe("outside the game across the DB boundary", () => {
    it("compactState / expandState round-trip the holder", () => {
        const state = board();
        const back = expandState(
            JSON.parse(JSON.stringify(compactState(state)))
        );
        for (const id of ["p1", "p2"]) {
            const before = getPlayer(state, id).outsideGame!;
            const after = getPlayer(back, id).outsideGame!;
            expect(after.map((c) => [c.id, c.card.id, c.zone])).toEqual(
                before.map((c) => [c.id, c.card.id, "exile"])
            );
        }
    });
});
