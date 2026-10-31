// CR 701.42 / 712.4 / 712.8g / 712.21 (ADR 0161) — the melded permanent.
//
// CAPABILITY test for an engine feature no shipped card exposes yet: the
// `meld` Op and the Urza pair land in the next slice (the Mechanics Registry
// row stays `planned` until then). The pair below is a test-only meld pair
// shaped like The Mightstone and Weakstone + Urza, Lord Protector, registered
// through the real ADR 0120 §2 seam (`preloadDefinitions`), so its combined
// back face is a real `#meld` twin.
//
// Everything runs through the real funnels: `meldPermanents` (exile, then
// meld), `removePermanentTo` (the single battlefield-departure funnel that
// splits the permanent), the SBA sweep that raises `meld-arrange`, the
// pending-choice submit path, Flickerwisp's own Effect Script through
// `resolveTopOfStack` + `fireDelayedTriggers`, and `projectPublicState` for
// the surface assertions.

import { describe, it, expect } from "vitest";
import {
    getDefinition,
    getPermanentManaValueCost,
    preloadDefinitions,
} from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { meldResultDefinitionId } from "../../cards/meld";
import { manaValue } from "../constants";
import {
    buildSpellContext,
    exileWithAttachments,
    meldPermanents,
    removePermanentTo,
    returnExiledForSource,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import { checkStateBasedActions } from "../sba";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { stampBackFaceForEntry, transformPermanent } from "../transform";
import { applyCopy } from "../copy";
import { runEffectScript } from "../effects/interpreter";
import { raiseTriggerTargetSelection } from "../rules";
import { finalizeTargetSelection } from "../../game";
import { fireDelayedTriggers } from "../phases";
import { projectPublicState } from "../../gameProjections";

const HOLDER_ID = "test-meld-holder";
const PARTNER_ID = "test-meld-partner";
const BEARS_ID = "ef5297cb-e763-4871-9cd3-0e2dbcc52095"; // Balduvian Bears
const FLICKERWISP_ID = "5bb3cb5c-8d66-4f5e-a9a9-917e6045f024";

const combinedBack = {
    kind: "meld" as const,
    name: "Test Melded Walker",
    types: ["Planeswalker" as const],
    subtypes: ["Urza"],
    supertypes: ["Legendary" as const],
    loyalty: 7,
    colors: ["W" as const, "U" as const],
    imagePrintId: "test-melded-walker-print",
};

preloadDefinitions([
    {
        id: HOLDER_ID,
        name: "Test Meld Holder",
        rarity: "mythic",
        manaCost: { X: 1, W: 1, U: 1 },
        types: ["Creature"],
        subtypes: ["Human", "Artificer"],
        supertypes: ["Legendary"],
        power: 2,
        toughness: 4,
        backFace: combinedBack,
    },
    {
        id: PARTNER_ID,
        name: "Test Meld Partner",
        rarity: "rare",
        manaCost: { X: 5 },
        types: ["Artifact"],
        supertypes: ["Legendary"],
        backFace: combinedBack,
    },
] as CardDefinition[]);

const TWIN_ID = meldResultDefinitionId(HOLDER_ID);

function cardIdOf(card: CardInstanceState): string | undefined {
    return (card.card as { id?: string }).id;
}

/** p1 controls the holder; the partner belongs to `partnerOwner`. */
function board(partnerOwner: "p1" | "p2" = "p1", partnerToken = false) {
    const holder = makeInstance(HOLDER_ID, {
        id: "holder",
        controllerId: "p1",
        ownerId: "p1",
        imagePrintId: "holder-print",
    });
    const partner = makeInstance(PARTNER_ID, {
        id: "partner",
        controllerId: "p1",
        ownerId: partnerOwner,
        ...(partnerToken ? { isToken: true } : {}),
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [holder, partner] }),
            makePlayer("p2"),
        ],
    });
    return state;
}

function meld(state: GameState): CardInstanceState | null {
    return meldPermanents(state, "holder", "partner", "p1");
}

function everyCard(state: GameState): CardInstanceState[] {
    return state.players.flatMap((p) => [
        ...p.battlefield,
        ...p.graveyard,
        ...p.exile,
        ...p.hand,
        ...p.library,
    ]);
}

describe("meld (CR 701.42a / 712.4a / 712.14c) — two cards, ONE permanent", () => {
    it("puts both onto the battlefield as a single melded permanent presenting the combined back face", () => {
        const state = board();
        const melded = meld(state);
        expect(melded).not.toBeNull();
        const battlefield = state.players[0].battlefield;
        expect(battlefield).toHaveLength(1);
        expect(battlefield[0].id).toBe("holder");
        expect(cardIdOf(battlefield[0])).toBe(TWIN_ID);
        expect(battlefield[0].types).toEqual(["Planeswalker"]);
        // CR 306.5b — the combined back face's loyalty.
        expect(battlefield[0].counters?.loyalty).toBe(7);
        expect(battlefield[0].meldedFrom).toEqual([
            {
                cardId: HOLDER_ID,
                ownerId: "p1",
                instanceId: "holder",
                imagePrintId: "holder-print",
            },
            { cardId: PARTNER_ID, ownerId: "p1", instanceId: "partner" },
        ]);
        // The partner's instance exists nowhere: one object, not two.
        expect(everyCard(state).map((c) => c.id)).toEqual(["holder"]);
        // The front print pin is held aside; the twin's art shows — the
        // combined back face's own print, front image.
        expect(battlefield[0].imagePrintId).toBeUndefined();
        const twin = getDefinition(TWIN_ID);
        expect(twin.imagePrintId).toBe("test-melded-walker-print");
        expect(twin.imagePrintFace).toBeUndefined();
        expect(twin.manaCost).toBeUndefined();
    });

    it('CR 701.42a — "exile them" is ONE exile event naming both cards', () => {
        const state = board();
        state.pendingEvents = [];
        meld(state);
        const exiled = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARDS_EXILED"
        );
        expect(exiled).toHaveLength(1);
    });

    it("SURFACE: the projection ships ONE permanent with the twin id and both cards", () => {
        const state = board();
        meld(state);
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield;
        expect(slim).toHaveLength(1);
        expect(slim[0].card).toEqual({ id: TWIN_ID });
        expect(slim[0].meldedFrom?.map((c) => c.cardId)).toEqual([
            HOLDER_ID,
            PARTNER_ID,
        ]);
    });

    it("CR 701.42b / 701.42c — a token copy of the partner can't be melded: both stay exiled, the token ceases to exist", () => {
        const state = board("p1", true);
        expect(meld(state)).toBeNull();
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].exile.map((c) => c.id)).toEqual([
            "holder",
            "partner",
        ]);
        expect(cardIdOf(state.players[0].exile[0])).toBe(HOLDER_ID);
        checkStateBasedActions(state);
        // CR 704.5d — the token is gone; the holder card stays in exile.
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["holder"]);
    });

    it("CR 701.42b — a card that is not its meld counterpart can't be melded", () => {
        const state = board();
        state.players[0].battlefield[1] = makeInstance(BEARS_ID, {
            id: "partner",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(meld(state)).toBeNull();
        expect(state.players[0].exile.map((c) => c.id)).toEqual([
            "holder",
            "partner",
        ]);
    });
});

describe("melded permanent's mana value (CR 712.8g)", () => {
    it("is the SUM of its front faces' mana values (3 + 5 = 8)", () => {
        const state = board();
        const melded = meld(state)!;
        expect(manaValue(getPermanentManaValueCost(melded))).toBe(8);
    });

    it("is 0 for a permanent COPYING a melded permanent", () => {
        const state = board();
        const melded = meld(state)!;
        const clone = makeInstance(BEARS_ID, { id: "clone" });
        state.players[1].battlefield.push(clone);
        // The real copy effect (CR 707.2): it takes the presented twin's
        // copiable values, never `meldedFrom`.
        applyCopy(state, clone, melded);
        expect(cardIdOf(clone)).toBe(TWIN_ID);
        expect(clone.meldedFrom).toBeUndefined();
        expect(manaValue(getPermanentManaValueCost(clone))).toBe(0);
    });
});

describe("meld cards are never transformed (CR 712.4c)", () => {
    it("ignores a transform instruction aimed at a meld card", () => {
        const state = board();
        const holder = state.players[0].battlefield[0];
        transformPermanent(state, holder);
        expect(cardIdOf(holder)).toBe(HOLDER_ID);
        expect(holder.transformed).toBeUndefined();
    });

    it("puts a meld card onto the battlefield front face up when told to put it there transformed", () => {
        const holder = makeInstance(HOLDER_ID, { id: "holder", zone: "exile" });
        expect(stampBackFaceForEntry(board(), holder)).toBe(false);
        expect(cardIdOf(holder)).toBe(HOLDER_ID);
    });
});

describe("a melded permanent leaving the battlefield (CR 712.21)", () => {
    it("one permanent leaves, two cards arrive — each in ITS owner's graveyard (CR 712.21a)", () => {
        const state = board("p2");
        meld(state);
        state.pendingEvents = [];
        removePermanentTo(state, "holder", "graveyard");
        expect(state.players[0].battlefield).toHaveLength(0);
        const [p1Yard, p2Yard] = state.players.map((p) => p.graveyard);
        expect(p1Yard.map((c) => [c.id, cardIdOf(c)])).toEqual([
            ["holder", HOLDER_ID],
        ]);
        expect(p2Yard.map((c) => [c.id, cardIdOf(c)])).toEqual([
            ["partner", PARTNER_ID],
        ]);
        // Each card shows its own front face again (CR 712.8a).
        expect(p1Yard[0].types).toEqual(["Creature"]);
        expect(p2Yard[0].types).toEqual(["Artifact"]);
        expect(p1Yard[0].meldedFrom).toBeUndefined();
        expect(p1Yard[0].imagePrintId).toBe("holder-print");
        // ONE object left the battlefield.
        const left = (state.pendingEvents ?? []).filter(
            (e) => e.type === "PERMANENT_LEFT"
        );
        expect(left).toHaveLength(1);
        // Two owners, two zones: nothing to arrange.
        expect(state.pendingMeldArrangements).toBeUndefined();
    });

    it("CR 712.21a — the owner arranges two cards landing in their graveyard", () => {
        const state = board("p1");
        meld(state);
        removePermanentTo(state, "holder", "graveyard");
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "holder",
            "partner",
        ]);
        checkStateBasedActions(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("meld-arrange");
        expect(head?.playerId).toBe("p1");
        expect(head?.candidateIds).toEqual(["holder", "partner"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: ["holder"],
        });
        // The chosen card is on TOP (the end of the array).
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "partner",
            "holder",
        ]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.pendingMeldArrangements).toBeUndefined();
    });

    it("CR 712.21b — the EXILING player orders two exiled cards, even when they own neither", () => {
        const state = board("p1");
        meld(state);
        // p2's spell exiles p1's melded permanent through the real primitive.
        const ctx = buildSpellContext(state, pushSpell(state, BEARS_ID, "p2"));
        ctx.exile({ type: "permanent", id: "holder" });
        checkStateBasedActions(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("meld-arrange");
        expect(head?.playerId).toBe("p2");
        expect(head?.zoneOwnerId).toBe("p1");
    });

    it("CR 712.21a — a LIBRARY's top is its first card: the chosen card is drawn first", () => {
        const state = board("p1");
        meld(state);
        state.players[0].library = [makeInstance(BEARS_ID, { id: "old" })];
        const ctx = buildSpellContext(state, pushSpell(state, BEARS_ID, "p1"));
        ctx.putIntoLibraryFromBattlefield(
            { type: "permanent", id: "holder" },
            1
        );
        // Both cards on top, the pair adjacent.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "holder",
            "partner",
            "old",
        ]);
        checkStateBasedActions(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("meld-arrange");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["partner"],
        });
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "partner",
            "holder",
            "old",
        ]);
    });

    it("CR 712.21d — a replacement on the departure moves BOTH cards", () => {
        const state = board("p2");
        const melded = meld(state)!;
        melded.exileOnLeave = true;
        removePermanentTo(state, "holder", "graveyard");
        expect(state.players.map((p) => p.exile.map((c) => c.id))).toEqual([
            ["holder"],
            ["partner"],
        ]);
        expect(state.players.flatMap((p) => p.graveyard)).toHaveLength(0);
    });

    it("CR 712.21e — exiled from the battlefield it is two CARDS exiled", () => {
        const state = board("p2");
        meld(state);
        state.pendingEvents = [];
        const ctx = buildSpellContext(state, pushSpell(state, BEARS_ID, "p2"));
        ctx.exile({ type: "permanent", id: "holder" });
        const exiled = (state.pendingEvents ?? []).find(
            (e) => e.type === "CARDS_EXILED"
        );
        expect(
            exiled && "cards" in exiled
                ? exiled.cards.map((c) => c.cardInstanceId)
                : []
        ).toEqual(["holder", "partner"]);
    });

    it("CR 712.21e — tucked into the library it is two CARDS put there", () => {
        const state = board("p1");
        meld(state);
        state.pendingEvents = [];
        removePermanentTo(state, "holder", "library");
        const put = (state.pendingEvents ?? []).find(
            (e) => e.type === "CARDS_PUT_INTO_LIBRARY"
        );
        expect(
            put && "cards" in put ? put.cards.map((c) => c.cardInstanceId) : []
        ).toEqual(["holder", "partner"]);
    });
});

describe("an effect that finds the departed melded permanent finds BOTH cards (CR 712.21c)", () => {
    it('a "return that card" off the departure event returns both cards from their graveyards (the False Demise example)', () => {
        const state = board("p2");
        meld(state);
        state.pendingEvents = [];
        removePermanentTo(state, "holder", "graveyard");
        const left = state.pendingEvents!.find(
            (e) => e.type === "PERMANENT_LEFT"
        )!;
        const item = pushSpell(state, BEARS_ID, "p1");
        item.triggerEvent = left as StackItem["triggerEvent"];
        runEffectScript(buildSpellContext(state, item), [
            {
                op: "moveZone",
                target: { ref: "$event.card" },
                to: "hand",
            },
        ]);
        expect(state.players.map((p) => p.hand.map((c) => c.id))).toEqual([
            ["holder"],
            ["partner"],
        ]);
        expect(state.players.flatMap((p) => p.graveyard)).toHaveLength(0);
    });

    it('an "until this leaves" exile returns both cards when its source leaves', () => {
        const state = board("p2");
        meld(state);
        const ring = makeInstance(BEARS_ID, { id: "ring" });
        state.players[1].battlefield.push(ring);
        exileWithAttachments(state, "holder", {
            sourceId: "ring",
            returnTapped: false,
            includeAttachments: false,
        });
        expect(state.players.map((p) => p.exile.map((c) => c.id))).toEqual([
            ["holder"],
            ["partner"],
        ]);
        returnExiledForSource(state, "ring");
        const back = state.players
            .flatMap((p) => p.battlefield)
            .filter((c) => c.id === "holder" || c.id === "partner")
            .map((c) => [c.id, cardIdOf(c)])
            .sort();
        expect(back).toEqual([
            ["holder", HOLDER_ID],
            ["partner", PARTNER_ID],
        ]);
    });

    it("Flickerwisp returns both cards at the next end step, each front face up as its own permanent (CR 712.14)", () => {
        const state = board("p2");
        meld(state);
        const flickerwisp = getDefinition(FLICKERWISP_ID);
        const wisp = makeInstance(flickerwisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const decoy = makeInstance(BEARS_ID, { id: "decoy" });
        state.players[0].battlefield.push(wisp, decoy);
        state.stack.push({
            ...wisp,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "flickerwisp-etb",
            triggerSourceId: wisp.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: wisp.id,
                controllerId: "p1",
                types: ["Creature"],
            } as StackItem["triggerEvent"],
            targets: undefined,
        });
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "permanent", id: "holder" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players.map((p) => p.exile.map((c) => c.id))).toEqual([
            ["holder"],
            ["partner"],
        ]);
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);
        const returned = state.players
            .flatMap((p) => p.battlefield)
            .filter((c) => c.id === "holder" || c.id === "partner");
        expect(
            returned.map((c) => [c.id, cardIdOf(c), c.ownerId]).sort()
        ).toEqual([
            ["holder", HOLDER_ID, "p1"],
            ["partner", PARTNER_ID, "p2"],
        ]);
        // No re-meld, and no stale group stamp on the new permanents.
        expect(returned.every((c) => c.meldedFrom === undefined)).toBe(true);
        expect(returned.every((c) => c.meldGroupId === undefined)).toBe(true);
    });
});
