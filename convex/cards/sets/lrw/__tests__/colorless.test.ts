// Lorwyn (LRW) — colorless behavior tests (ADR 0043 colour split).
//
// Shelldock Isle is the Hideaway (CR 702.75) proving card: the ETB keyword leg
// (look at the top four, exile one FACE DOWN, bottom the rest in a random
// order), the CR 607 / 406.6 LINK between that exile and the card's own later
// "you may play the exiled card" ability, and the CR 406.3 PER-VIEWER
// visibility (its controller may look; nobody else may) — the last asserted
// through `projectPublicState` from BOTH viewpoints, since a hand-built state
// would mask a dropped redaction entirely.

import { describe, it, expect } from "vitest";
import { shelldockIsle } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import {
    FACE_DOWN_CARD_ID,
    getDefinition,
    getCardByName,
} from "../../../index";

const BEAR_ID = getCardByName("Grizzly Bears").id;
const HIDEAWAY_TRIGGER_ID = "hideaway";
const PLAY_ABILITY_ID = "shelldock-isle-play-hidden";

/** Library of `n` distinct Grizzly Bears owned by `owner`. */
const libOf = (owner: string, n: number): CardInstanceState[] =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(BEAR_ID, {
            id: `${owner}-lib-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );

function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: ["Land"],
        },
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

/** Answers the suspended hideaway look-distribute pick with `pick`. */
function submitPick(state: GameState, pick: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [pick],
    });
}

/** Shelldock Isle on p1's battlefield, p1's library `own` cards deep and p2's
 *  `opp` deep. Returns the land instance plus the state. */
function setup(own: number, opp: number) {
    const isle = makeInstance(shelldockIsle.id, {
        id: "isle",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [isle],
                library: libOf("p1", own),
            }),
            makePlayer("p2", { library: libOf("p2", opp) }),
        ],
    });
    return { state, isle: state.players[0].battlefield[0] };
}

describe("Shelldock Isle — definition (CR 702.75 / 702.75b)", () => {
    it("is a colourless Land declaring only the `hideaway 4` keyword string", () => {
        expect(shelldockIsle.manaCost).toEqual({});
        expect(shelldockIsle.types).toEqual(["Land"]);
        expect(shelldockIsle.staticAbilities).toContain("hideaway 4");
    });

    it("CR 702.75b — the enters-tapped clause is its OWN ability, not part of hideaway", () => {
        expect(shelldockIsle.entersTapped).toBe(true);
        // Hideaway itself never taps: the keyword's injected trigger is only the
        // look/exile/bottom leg (asserted below), and nothing in the card's own
        // data folds tapping into it.
        expect(shelldockIsle.triggeredAbilities ?? []).toHaveLength(0);
    });

    it("ADR 0054 — the `getDefinition` seam injects the CR 702.75a ETB trigger from the keyword string alone", () => {
        const expanded = getDefinition(shelldockIsle.id);
        const trigger = expanded.triggeredAbilities?.find(
            (t) => t.id === HIDEAWAY_TRIGGER_ID
        );
        expect(trigger).toBeDefined();
        expect(trigger!.event).toBe("PERMANENT_ENTERED");
        expect(trigger!.oracleText).toContain("top four cards");
        // Declarative (ADR 0045) — an Effect Script, not a `resolve()` closure.
        expect(trigger!.effects).toEqual([
            { op: "hideaway", player: "controller", look: 4 },
        ]);
        // Expansion is idempotent — the seam memoizes, so a second read must not
        // stack a second copy (which would render the line twice on the stack).
        expect(
            getDefinition(shelldockIsle.id).triggeredAbilities?.filter(
                (t) => t.id === HIDEAWAY_TRIGGER_ID
            )
        ).toHaveLength(1);
    });

    it("prints a mana ability and the linked play ability, and the play ability uses the stack", () => {
        const mana = shelldockIsle.activatedAbilities?.[0];
        expect(mana?.useStack).toBe(false); // CR 605.3a
        const play = shelldockIsle.activatedAbilities?.find(
            (a) => a.id === PLAY_ABILITY_ID
        );
        expect(play?.cost).toEqual({ mana: { U: 1 }, tap: true });
        expect(play?.useStack).toBe(true);
    });
});

describe("Shelldock Isle — hideaway ETB leg (CR 702.75a / 406.3 / 607)", () => {
    it("looks at the top four, exiles the chosen card face down, bottoms the rest, and links it to the land", () => {
        const { state, isle } = setup(6, 40);
        resolveTrigger(state, isle, HIDEAWAY_TRIGGER_ID);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.candidateIds).toEqual([
            "p1-lib-0",
            "p1-lib-1",
            "p1-lib-2",
            "p1-lib-3",
        ]);
        expect(head.count).toEqual({ min: 1, max: 1 });

        submitPick(state, "p1-lib-2");
        const hidden = state.players[0].exile.find((c) => c.id === "p1-lib-2");
        expect(hidden).toBeDefined();
        // CR 406.3 — face down: only the land's controller may look.
        expect(hidden!.knownTo).toEqual(["p1"]);
        // CR 607 / 406.6 — linked to THIS land.
        expect(hidden!.exiledBySourceId).toBe("isle");
        // The three un-picked looked-at cards are on the true bottom; the fifth
        // and sixth cards are now on top.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "p1-lib-4",
            "p1-lib-5",
            "p1-lib-0",
            "p1-lib-1",
            "p1-lib-3",
        ]);
    });

    it("wire format — the controller sees the hidden card, the opponent sees a face-down placeholder pinned to the land", () => {
        const { state, isle } = setup(6, 40);
        resolveTrigger(state, isle, HIDEAWAY_TRIGGER_ID);
        submitPick(state, "p1-lib-0");

        const own = projectPublicState(state, 1, "p1");
        const ownHidden = own.players[0].exile.find(
            (c) => c.id === "p1-lib-0"
        )!;
        expect(ownHidden.card.id).toBe(BEAR_ID);

        const opp = projectPublicState(state, 1, "p2");
        const oppHidden = opp.players[0].exile.find(
            (c) => c.id === "p1-lib-0"
        )!;
        // Identity redacted…
        expect(oppHidden.card.id).toBe(FACE_DOWN_CARD_ID);
        // …but the ASSOCIATION with the land stays public (CR 406 — exile is an
        // open zone; only the identity of a face-down card is hidden).
        expect(oppHidden.exiledByPermanentId).toBe("isle");
    });
});

describe("Shelldock Isle — linked play ability (CR 607 / 601.3e / 305.9)", () => {
    /** ETB-exiles a card face down and returns its instance id. */
    function hideOne(state: GameState, isle: CardInstanceState): string {
        resolveTrigger(state, isle, HIDEAWAY_TRIGGER_ID);
        submitPick(state, "p1-lib-0");
        return "p1-lib-0";
    }

    it("grants a free PLAY permission on the linked card when a library has twenty or fewer cards", () => {
        // p1's own library is small after the hideaway (6 - 1 = 5 cards).
        const { state, isle } = setup(6, 40);
        const hidden = hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);

        const card = state.players[0].exile.find((c) => c.id === hidden)!;
        expect(card.castableFromExileBy).toBe("p1");
        // "without paying its mana cost" (CR 601.3e / 117.6).
        expect(card.castFromExileWithoutPayingManaCost).toBe(true);
        // "PLAY the exiled card" — a land under the grant is playable (CR 305.9).
        expect(card.castableFromExileIncludesLand).toBe(true);
    });

    it("fires off the OPPONENT's library too — the Oracle's 'a library' is any library", () => {
        // p1's library is huge; p2 is the one at/below the threshold.
        const { state, isle } = setup(40, 15);
        const hidden = hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        const card = state.players[0].exile.find((c) => c.id === hidden)!;
        expect(card.castableFromExileBy).toBe("p1");
    });

    it("grants nothing while EVERY library is above twenty cards (checked on resolution)", () => {
        const { state, isle } = setup(40, 40);
        const hidden = hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        const card = state.players[0].exile.find((c) => c.id === hidden)!;
        expect(card.castableFromExileBy).toBeUndefined();
        expect(card.castFromExileWithoutPayingManaCost).toBeUndefined();
        // The card stays exiled and face down either way.
        expect(card.knownTo).toEqual(["p1"]);
    });

    it("CR 607 — the grant reaches ONLY the card this land exiled, never another face-down exile", () => {
        const { state, isle } = setup(6, 15);
        const hidden = hideOne(state, isle);
        // A second face-down exile, linked to a DIFFERENT source.
        const other = makeInstance(BEAR_ID, {
            id: "other-hidden",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        other.knownTo = ["p1"];
        other.exiledBySourceId = "some-other-permanent";
        state.players[0].exile.push(other);

        resolveActivated(state, isle, PLAY_ABILITY_ID);
        expect(
            state.players[0].exile.find((c) => c.id === hidden)!
                .castableFromExileBy
        ).toBe("p1");
        expect(
            state.players[0].exile.find((c) => c.id === "other-hidden")!
                .castableFromExileBy
        ).toBeUndefined();
    });

    it("CR 608.2b — nothing hidden yet: activating the ability is a silent no-op", () => {
        const { state, isle } = setup(6, 15);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("wire format — once granted, the controller's exile entry carries the play affordance", () => {
        const { state, isle } = setup(6, 15);
        const hidden = hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        const own = projectPublicState(state, 1, "p1");
        const projected = own.players[0].exile.find((c) => c.id === hidden)!;
        // The grantee sees the real card AND the legal-action annotation the
        // projection only attaches when `castableFromExileBy === viewer`.
        expect(projected.card.id).toBe(BEAR_ID);
        expect(projected.legalActions).toBeDefined();
        // The opponent still sees nothing but a face-down placeholder.
        const opp = projectPublicState(state, 1, "p2");
        const oppView = opp.players[0].exile.find((c) => c.id === hidden)!;
        expect(oppView.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(oppView.legalActions).toBeUndefined();
    });
});
