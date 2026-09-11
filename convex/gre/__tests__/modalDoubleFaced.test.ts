// CR 712.3 / 712.8a / 712.8f / 712.12 / 712.14b / 712.19 — the MODAL
// double-faced card (ADR 0122).
//
// Subject: Sink into Stupor // Soporific Springs (an INSTANT front face, so
// CR 712.14b has a live subject) and Witch Enchanter // Witch-Blessed Meadow
// (a CREATURE front face — the control for the same clause).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { buildSpellContext } from "../state";
import { tryGetDefinition } from "../../cards";
import { getAllCards } from "../../cards/catalogue";
import { chooseableNamesOf } from "../../cards/cardNames";
import {
    isModalDoubleFaced,
    modalBackFaceDefinitionId,
} from "../../cards/modalDfc";
import { getLegalActions } from "../rules";
import { landPlayFaces } from "../modalLandPlay";
import {
    applyPlayLand,
    applyPlayLandFromAnyZone,
    finalizeLandEntry,
    resolvePlayLandSourceZone,
} from "../playLand";
import { transformPermanent } from "../transform";
import { projectPublicState } from "../../gameProjections";
import type { GameState, PlayerState } from "../state";

const SINK_INTO_STUPOR = "5358b87a-1a29-426d-b165-40c97da2c14d";
const WITCH_ENCHANTER = "62061e7c-cf19-4f03-b8fa-2bdba62d6b0b";
const CRUCIBLE_OF_WORLDS = "312a6058-de08-487d-95bd-b3c56807fdd6";

/** A main phase, empty stack, `p1` active with priority and a land drop left —
 *  the window CR 116.2a gives a land play, with `card` in `p1`'s hand. */
function handState(cardId: string): {
    state: GameState;
    player: PlayerState;
    instanceId: string;
} {
    const card = makeInstance(cardId, { controllerId: "p1", zone: "hand" });
    const state = makeState({
        players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
    });
    return { state, player: state.players[0], instanceId: card.id };
}

describe("modal double-faced cards (CR 712.3)", () => {
    it("registers the back face as a twin definition and hides it from every enumerator (CR 712.8a/712.8f)", () => {
        const front = tryGetDefinition(SINK_INTO_STUPOR);
        expect(front?.name).toBe("Sink into Stupor");
        expect(isModalDoubleFaced(front ?? undefined)).toBe(true);

        const twin = tryGetDefinition(
            modalBackFaceDefinitionId(SINK_INTO_STUPOR)
        );
        expect(twin?.name).toBe("Soporific Springs");
        expect(twin?.types).toEqual(["Land"]);
        // CR 614.12 — the shock clause reaches the twin, which is the whole
        // reason a modal face is a module-registered twin rather than
        // transform's content-derived id codec (a `MayPayCost` cannot ride an
        // id).
        expect(twin?.entersTappedUnlessPay).toEqual({ life: 3 });
        expect(twin?.activatedAbilities?.[0]?.useStack).toBe(false);

        // CR 712.8a — one card is one card: outside the battlefield and the
        // stack there is only the front face, so no enumerator may see the
        // twin. `allCards` is what deck legality, the Limited pool and
        // `check:index` read.
        expect(getAllCards().some((c) => c.id.includes("#"))).toBe(false);
    });

    it("offers a land play for the BACK face of a card whose front face is an instant (CR 712.12)", () => {
        const { state, player, instanceId } = handState(SINK_INTO_STUPOR);
        const card = player.hand[0];

        // The card in hand is an Instant (CR 712.8a) …
        expect(card.types).toEqual(["Instant"]);
        // … and it is still a legal land play, because 712.12 asks about a
        // FACE.
        expect(landPlayFaces(card)).toEqual(["back"]);
        expect(getLegalActions(state, player, card)).toContain("play");
        void instanceId;
        // The Move ENUMERATION half of this — one `play-land` Move per land
        // face — lives in `modalDoubleFaced.bot.test.ts`: `gre/moves.ts` is a
        // bot-only module and `bot-suite-boundary.test.ts` keeps application
        // tests out of it.
    });

    it("puts the chosen face onto the battlefield, and it enters through its own CR 614.12 pay-choice", () => {
        const { state, player, instanceId } = handState(SINK_INTO_STUPOR);

        // The entry suspends on the back face's own shock clause — read off
        // the FACE, not off the instant in hand.
        expect(applyPlayLand(state, player, instanceId, "back")).toBeNull();
        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("land-entry-tapped");
        expect(choice?.landEntryFace).toBe("back");
        expect(choice?.prompt).toContain("Soporific Springs");
        // CR 712.8a — the card is still in HAND for the choice window, and it
        // is still its front face there.
        expect(player.hand[0].types).toEqual(["Instant"]);

        finalizeLandEntry(
            state,
            "p1",
            instanceId,
            { life: 3 },
            true,
            choice?.landSourceZone,
            choice?.landEntryFace
        );

        const entered = player.battlefield.find((c) => c.id === instanceId);
        expect(entered?.types).toEqual(["Land"]);
        expect((entered?.card as { id: string }).id).toBe(
            modalBackFaceDefinitionId(SINK_INTO_STUPOR)
        );
        // CR 614.12 — three life paid, so it enters untapped.
        expect(entered?.isTapped).toBeFalsy();
        expect(player.life).toBe(17);
        // CR 305.2 — the land drop is spent by the play.
        expect(player.landsPlayedThisTurn).toBe(1);
    });

    it("SURFACE: the entered permanent projects as the back face (CR 712.8f)", () => {
        const { state, player, instanceId } = handState(WITCH_ENCHANTER);
        applyPlayLand(state, player, instanceId, "back");
        finalizeLandEntry(
            state,
            "p1",
            instanceId,
            { life: 3 },
            false,
            state.pendingChoices?.[0]?.landSourceZone,
            state.pendingChoices?.[0]?.landEntryFace
        );

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === instanceId
        );
        expect(slim?.types).toEqual(["Land"]);
        // Declining the pay leaves it tapped (CR 614.12).
        expect(slim?.isTapped).toBe(true);
        // The projection strips `card` to `{ id }`, so the client resolves the
        // face through the SAME registry module — that id has to be the twin's
        // or the board renders the instant's art and name.
        expect((slim?.card as { id: string }).id).toBe(
            modalBackFaceDefinitionId(WITCH_ENCHANTER)
        );
    });

    it("refuses a face that is not a land on that card (CR 712.12)", () => {
        const { state, player } = handState(WITCH_ENCHANTER);
        // The FRONT face is a creature, not a land: `landPlayFaces` names only
        // the back, and the mutation's own gate reads the same list.
        expect(landPlayFaces(player.hand[0])).toEqual(["back"]);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("CR 712.10: an effect cannot transform a modal land back into its instant front face", () => {
        const { state, player, instanceId } = handState(SINK_INTO_STUPOR);
        applyPlayLand(state, player, instanceId, "back");
        finalizeLandEntry(
            state,
            "p1",
            instanceId,
            { life: 3 },
            true,
            state.pendingChoices?.[0]?.landSourceZone,
            state.pendingChoices?.[0]?.landEntryFace
        );
        const land = player.battlefield.find((c) => c.id === instanceId)!;
        expect(land.types).toEqual(["Land"]);

        // "…and the face that permanent would transform into is an instant or
        // sorcery card face … nothing happens." Without the clause the modal
        // play's reuse of the `transformed` markers would let an Instant sit
        // on the battlefield.
        transformPermanent(state, land);

        expect(land.types).toEqual(["Land"]);
        expect((land.card as { id: string }).id).toBe(
            modalBackFaceDefinitionId(SINK_INTO_STUPOR)
        );
    });

    it("CR 305.9 / 712.12: a play-from-graveyard permission reaches the LAND FACE, and one resolver answers for both the offer and the commit", () => {
        // PR #3412 review, BLOCKING: `getLegalActions` and `enumerateMoves`
        // both offered this play while `playCard`'s own local finder filtered
        // candidates on the FRONT face's type line — an instant — and threw
        // "Card not in hand" on the Move it had just offered. The fix deleted
        // that second authority, so the guard is that the SHARED resolver
        // (`resolvePlayLandSourceZone`, which the mutation now calls) and the
        // offering surface agree.
        const card = makeInstance(SINK_INTO_STUPOR, {
            id: "gy-mdfc",
            controllerId: "p1",
            zone: "graveyard",
        });
        const crucible = makeInstance(CRUCIBLE_OF_WORLDS, {
            id: "crucible",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [card],
                    battlefield: [crucible],
                }),
                makePlayer("p2"),
            ],
        });
        const player = state.players[0];

        expect(getLegalActions(state, player, card)).toContain("play");
        expect(resolvePlayLandSourceZone(state, player, card.id)).toBe(
            "graveyard"
        );

        applyPlayLandFromAnyZone(state, player, card.id, "back");
        finalizeLandEntry(
            state,
            "p1",
            card.id,
            { life: 3 },
            false,
            state.pendingChoices?.[0]?.landSourceZone,
            state.pendingChoices?.[0]?.landEntryFace
        );
        const entered = player.battlefield.find((c) => c.id === card.id);
        expect(entered?.types).toEqual(["Land"]);
        expect(player.graveyard).toHaveLength(0);
    });

    it("CR 305.9 / 712.12: a land-inclusive EXILE grant reaches the land face too", () => {
        // The sibling of the finding above, on the origin whose own guard was
        // `!exileLand.types.includes("Land")` — a throw that fired for exactly
        // the card the grant was meant to let you play.
        const card = makeInstance(SINK_INTO_STUPOR, {
            id: "ex-mdfc",
            controllerId: "p1",
            zone: "exile",
            castableFromExileBy: "p1",
            castableFromExileIncludesLand: true,
        });
        const state = makeState({
            players: [makePlayer("p1", { exile: [card] }), makePlayer("p2")],
        });
        const player = state.players[0];

        expect(getLegalActions(state, player, card)).toContain("play");
        expect(resolvePlayLandSourceZone(state, player, card.id)).toBe("exile");
    });

    it("CR 712.19: the name-choice list offers both face names, and the card's name is the front face's", () => {
        const front = tryGetDefinition(SINK_INTO_STUPOR)!;
        expect(front.name).toBe("Sink into Stupor");
        expect(chooseableNamesOf(front)).toEqual([
            "Sink into Stupor",
            "Soporific Springs",
        ]);
    });

    it("CR 712.14b: an effect that puts the card onto the battlefield leaves it where it is", () => {
        const card = makeInstance(SINK_INTO_STUPOR, {
            controllerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [card] }),
                makePlayer("p2"),
            ],
        });
        const player = state.players[0];

        // `returnToBattlefield` is the shared put-onto-battlefield chokepoint
        // every "put it onto the battlefield" effect funnels through.
        const item = pushSpell(state, WITCH_ENCHANTER, "p1");
        const ctx = buildSpellContext(state, item);
        expect(ctx.returnToBattlefield("p1", card.id, "graveyard")).toBe(false);
        expect(player.battlefield).toHaveLength(0);
        expect(player.graveyard.map((c) => c.id)).toEqual([card.id]);
    });

    it("CR 712.14b does NOT block a card whose front face IS a permanent card", () => {
        const card = makeInstance(WITCH_ENCHANTER, {
            controllerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [card] }),
                makePlayer("p2"),
            ],
        });
        const player = state.players[0];

        const item = pushSpell(state, SINK_INTO_STUPOR, "p1");
        const ctx = buildSpellContext(state, item);
        expect(ctx.returnToBattlefield("p1", card.id, "graveyard")).toBe(true);
        // CR 712.14 — it enters with its FRONT face up: the 2/2 creature.
        const entered = player.battlefield.find((c) => c.id === card.id);
        expect(entered?.types).toEqual(["Creature"]);
    });
});
