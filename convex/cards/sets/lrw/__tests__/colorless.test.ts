// Lorwyn (LRW) — colorless behavior tests (ADR 0043 colour split).
//
// Shelldock Isle is the Hideaway (CR 702.75) proving card: the ETB keyword leg
// (look at the top four, exile one FACE DOWN, bottom the rest in a random
// order), the CR 607 / 406.6 LINK between that exile and the card's own later
// "you may play the exiled card" ability, and the CR 406.3 PER-VIEWER
// visibility (its controller may look; nobody else may) — the last asserted
// through `projectPublicState` from BOTH viewpoints, since a hand-built state
// would mask a dropped redaction entirely.
//
// The play half is a CR 608.2g play-during-resolution (issue #1961): the
// permission has no stated duration, so it exists ONLY while the ability
// resolves — playable immediately and ONLY immediately, ignoring card-type
// timing (a creature on the OPPONENT's turn, the card's whole point), with the
// land branch stayed narrow by CR 305.2a / 305.3 / 305.2b.

import { describe, it, expect } from "vitest";
import { shelldockIsle } from "../colorless";
import { steamVents } from "../../gpt/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    applyPendingChoiceSubmit,
    applyLandEntrySubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { applyPlayLand } from "../../../../gre/playLand";
import {
    FACE_DOWN_CARD_ID,
    getDefinition,
    getCardByName,
} from "../../../index";

const BEAR_ID = getCardByName("Grizzly Bears").id;
const ISLAND_ID = getCardByName("Island").id;
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

/** Answers the CR 608.2g Cast/Play-or-Decline `option-pick` the play ability
 *  raises mid-resolution. `option` is the accept token `"cast"` (the shared
 *  accept id for both the cast and the land-play branch) or `"decline"`. */
function answerOffer(state: GameState, option: "cast" | "decline"): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [option],
    });
}

/** Shelldock Isle on p1's battlefield, p1's library `own` cards deep and p2's
 *  `opp` deep. Returns the land instance plus the state. `topCardId` overrides
 *  the printed card of p1's TOP library card (`p1-lib-0`) so a test can hide a
 *  LAND instead of a creature (CR 305.9 — "play", not "cast"). */
function setup(own: number, opp: number, topCardId?: string) {
    const isle = makeInstance(shelldockIsle.id, {
        id: "isle",
        controllerId: "p1",
        ownerId: "p1",
    });
    const ownLibrary = libOf("p1", own);
    if (topCardId !== undefined && ownLibrary.length > 0) {
        ownLibrary[0] = makeInstance(topCardId, {
            id: "p1-lib-0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
    }
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [isle],
                library: ownLibrary,
            }),
            makePlayer("p2", { library: libOf("p2", opp) }),
        ],
    });
    return { state, isle: state.players[0].battlefield[0] };
}

describe("Shelldock Isle — definition (CR 702.75 / 702.75b)", () => {
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

describe("Shelldock Isle — linked play ability (CR 607 / 608.2g / 305)", () => {
    /** ETB-exiles a card face down and returns its instance id. */
    function hideOne(state: GameState, isle: CardInstanceState): string {
        resolveTrigger(state, isle, HIDEAWAY_TRIGGER_ID);
        submitPick(state, "p1-lib-0");
        return "p1-lib-0";
    }

    /** Hands the turn to the opponent — the case the card exists for. */
    function passTurnToOpponent(state: GameState): void {
        state.turn += 1;
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
    }

    it("CR 608.2g — offers the play DURING the ability's own resolution, and the offer is a resolution choice, not priority", () => {
        // p1's own library is small after the hideaway (6 - 1 = 5 cards).
        const { state, isle } = setup(6, 40);
        hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);

        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("option-pick");
        expect(offer.playerId).toBe("p1");
        expect(offer.options?.map((o) => o.id)).toEqual(["cast", "decline"]);
        // CR 608.2g — the ability is STILL resolving (suspended on the offer),
        // so no player has received priority: the opponent cannot respond here.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe(PLAY_ABILITY_ID);
    });

    it("CR 608.2g / 302.1 — a hidden CREATURE is playable on the OPPONENT's turn (the card's defining function)", () => {
        // Grizzly Bears is a plain creature: at sorcery timing only, on p1's own
        // turn, under normal permissions. Casting during a resolution happens
        // OUTSIDE priority, so CR 302.1's "any time they have priority … during
        // their main phase" simply does not gate it (CR 608.2g).
        const { state, isle } = setup(6, 40);
        const hidden = hideOne(state, isle);
        passTurnToOpponent(state);

        resolveActivated(state, isle, PLAY_ABILITY_ID);
        expect(state.pendingChoices![0].kind).toBe("option-pick");

        answerOffer(state, "cast");
        // CR 608.2g — the spell became the TOPMOST object on the stack and the
        // granting ability finished resolving (it is gone), with no priority in
        // between.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[state.stack.length - 1].id).toBe(hidden);
        expect(state.stack[0].castById).toBe("p1");
        expect(state.players[0].exile.some((c) => c.id === hidden)).toBe(false);

        // It is a real spell afterwards — resolving it puts the creature onto
        // p1's battlefield on the OPPONENT's turn.
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.some((c) => c.id === hidden)).toBe(
            true
        );
    });

    it("CR 608.2g — the window CLOSES with the resolution: no this-turn impulse permission is left behind", () => {
        // The other half of the reported bug. Declining must NOT leave the card
        // playable later in the turn — the permission has no stated duration, so
        // it dies with the resolution.
        const { state, isle } = setup(6, 40);
        const hidden = hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        answerOffer(state, "decline");

        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        const card = state.players[0].exile.find((c) => c.id === hidden)!;
        // CR 702.88c-style: the card just stays exiled — and still face down,
        // still visible only to its controller (CR 406.3).
        expect(card).toBeDefined();
        expect(card.knownTo).toEqual(["p1"]);
        // No impulse window of ANY kind was stamped (this is what
        // `grantCastFromExile` used to do, and what made the card playable
        // later in the turn).
        expect(card.castableFromExileBy).toBeUndefined();
        expect(card.castFromExileWithoutPayingManaCost).toBeUndefined();
        expect(card.castableFromExileIncludesLand).toBeUndefined();
        expect(card.castableFromExileUntilTurn).toBeUndefined();
    });

    it("fires off the OPPONENT's library too — the Oracle's 'a library' is any library", () => {
        // p1's library is huge; p2 is the one at/below the threshold.
        const { state, isle } = setup(40, 15);
        hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        expect(state.pendingChoices![0].kind).toBe("option-pick");
    });

    it("offers nothing while EVERY library is above twenty cards (checked on resolution)", () => {
        const { state, isle } = setup(40, 40);
        const hidden = hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        const card = state.players[0].exile.find((c) => c.id === hidden)!;
        // The card stays exiled and face down.
        expect(card.knownTo).toEqual(["p1"]);
        expect(card.castableFromExileBy).toBeUndefined();
    });

    it("CR 607 — the offer plays ONLY the card this land exiled, never another face-down exile", () => {
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
        answerOffer(state, "cast");
        expect(state.stack[state.stack.length - 1].id).toBe(hidden);
        // The unlinked card never moved and gained no permission at all.
        const untouched = state.players[0].exile.find(
            (c) => c.id === "other-hidden"
        )!;
        expect(untouched).toBeDefined();
        expect(untouched.castableFromExileBy).toBeUndefined();
    });

    it("CR 608.2b — nothing hidden yet: activating the ability is a silent no-op", () => {
        const { state, isle } = setup(6, 15);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("wire format — the Cast/Decline offer survives the projection for the caster, and the hidden card stays redacted for the opponent", () => {
        const { state, isle } = setup(6, 15);
        const hidden = hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);

        // SURFACE assertion driven THROUGH the reducer: the client renders the
        // generic option-pick prompt straight off the projected `pendingChoices`.
        const own = projectPublicState(state, 1, "p1");
        expect(own.pendingChoices?.[0]?.kind).toBe("option-pick");
        expect(own.pendingChoices?.[0]?.options?.map((o) => o.id)).toEqual([
            "cast",
            "decline",
        ]);
        // CR 406.3 — the card being offered is still face down on the wire for
        // the opponent. The prompt deliberately carries no card identity (no
        // `subjectCardId`, no name in the text), because `pendingChoices`
        // crosses to BOTH viewers unredacted.
        expect(own.pendingChoices?.[0]?.subjectCardId).toBeUndefined();
        expect(own.players[0].exile.find((c) => c.id === hidden)!.card.id).toBe(
            BEAR_ID
        );
        const opp = projectPublicState(state, 1, "p2");
        expect(opp.players[0].exile.find((c) => c.id === hidden)!.card.id).toBe(
            FACE_DOWN_CARD_ID
        );
        // …and the OFFER crosses to the opponent too: `pendingChoices` rides the
        // projection unredacted and `<PendingChoicePrompt>` renders `prompt`
        // verbatim to the NON-chooser ("Waiting for P1 — …"). So the prompt and
        // the option labels must carry nothing derived from the hidden card's
        // characteristics — no name, no type, no "cast" vs "play" tell.
        const oppOffer = opp.pendingChoices?.[0];
        expect(oppOffer?.subjectCardId).toBeUndefined();
        expect(oppOffer?.prompt).not.toMatch(
            /grizzly|bears|island|land|creature|instant|sorcery|cast/i
        );
        expect(oppOffer?.options?.map((o) => o.label).join(" ")).not.toMatch(
            /cast/i
        );
    });

    it("CR 406.3 — the offer is BYTE-IDENTICAL for a hidden land and a hidden nonland on the opponent's projection", () => {
        // The leak this pins shut: the land branch and the cast branch used to
        // send different prompt text and different option labels, so the
        // opponent's screen said "You may play the exiled card" exactly when the
        // face-down card was a land and "You may cast the card" when it wasn't.
        // Both branches must now be indistinguishable to any observer.
        const offerAsSeenByOpponent = (topCardId?: string) => {
            const { state, isle } = setup(6, 15, topCardId);
            hideOne(state, isle);
            resolveActivated(state, isle, PLAY_ABILITY_ID);
            // Driven THROUGH the reducer — a hand-built view would mask exactly
            // the field the client renders.
            const offer = projectPublicState(state, 1, "p2")
                .pendingChoices?.[0];
            expect(offer?.kind).toBe("option-pick");
            return {
                prompt: offer?.prompt,
                options: offer?.options,
                subjectCardId: offer?.subjectCardId,
            };
        };

        const nonland = offerAsSeenByOpponent(); // Grizzly Bears (cast branch)
        const land = offerAsSeenByOpponent(ISLAND_ID); // Island (land branch)
        expect(land).toEqual(nonland);
        expect(land.subjectCardId).toBeUndefined();
    });

    it("CR 305.2a — a hidden LAND is played on your own turn and CONSUMES the land drop", () => {
        // "You may PLAY the exiled card" (not "cast"), so the land branch is
        // live: playing a land during a resolution still counts against the
        // per-turn drop (CR 305.2a).
        const { state, isle } = setup(6, 15, ISLAND_ID);
        const hidden = hideOne(state, isle);
        expect(
            state.players[0].exile.find((c) => c.id === hidden)!.types
        ).toContain("Land");

        resolveActivated(state, isle, PLAY_ABILITY_ID);
        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("option-pick");
        // CR 116.2a / 116.1 — a land is never CAST, so the button says Play. It
        // says Play on the SPELL branch of this same grant too (asserted
        // separately): the label is chosen by the grant's `includesLand`, never
        // by the hidden card's actual type, or it would leak it (CR 406.3).
        expect(offer.options?.map((o) => o.label)).toEqual(["Play", "Decline"]);

        answerOffer(state, "cast");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0); // a land never uses the stack
        expect(state.players[0].battlefield.some((c) => c.id === hidden)).toBe(
            true
        );
        expect(state.players[0].landsPlayedThisTurn).toBe(1);
    });

    // issue #1980 — the full path the bug was reported on: hideaway (CR 702.75)
    // can exile ANY card off the top four of your own library, a shock land
    // included, and the play half routes through `applyPlayLandFromExile`.
    // That function used to skip the CR 614.12 pay-choice entirely, so this
    // exact sequence let the land in UNTAPPED, with no prompt and no life
    // paid. A hand-played copy has always offered the choice; the two origins
    // must not differ.
    it("CR 614.12 — a hidden SHOCK LAND played through the exile link still offers the pay-choice", () => {
        const { state, isle } = setup(6, 15, steamVents.id);
        const hidden = hideOne(state, isle);
        const lifeBefore = state.players[0].life;

        resolveActivated(state, isle, PLAY_ABILITY_ID);
        answerOffer(state, "cast");

        // The ability's own resolution has finished (a land never uses the
        // stack), but the land has NOT entered: it waits in exile on the
        // stackless pay-choice, exactly like a hand-played shock land waits in
        // hand.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].battlefield.some((c) => c.id === hidden)).toBe(
            false
        );
        expect(state.players[0].exile.some((c) => c.id === hidden)).toBe(true);
        expect(state.players[0].landsPlayedThisTurn ?? 0).toBe(0);

        const suspended = state.pendingChoices![0];
        expect(suspended.kind).toBe("land-entry-tapped");
        expect(suspended.landInstanceId).toBe(hidden);
        expect(suspended.landSourceZone).toBe("exile");
        expect(suspended.cost).toEqual({ life: 2 });
        // CR 406.3 — the card is still face down here and `pendingChoices`
        // reach BOTH viewers unredacted, so the prompt must not name it.
        expect(suspended.prompt).not.toMatch(/steam vents/i);

        applyLandEntrySubmit(state, { playerId: "p1", accept: true });
        const land = state.players[0].battlefield.find((c) => c.id === hidden);
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(false);
        expect(state.players[0].life).toBe(lifeBefore - 2);
        expect(state.players[0].landsPlayedThisTurn).toBe(1);
        expect(state.players[0].exile.some((c) => c.id === hidden)).toBe(false);
        // CR 406.3 — it left exile face up: the opponent's projection shows
        // the real card, not the face-down placeholder.
        const opp = projectPublicState(state, 1, "p2");
        expect(
            opp.players[0].battlefield.find((c) => c.id === hidden)!.card.id
        ).toBe(steamVents.id);
    });

    it("CR 614.12 — declining the pay-choice on the exile-link play enters it TAPPED", () => {
        const { state, isle } = setup(6, 15, steamVents.id);
        const hidden = hideOne(state, isle);
        const lifeBefore = state.players[0].life;

        resolveActivated(state, isle, PLAY_ABILITY_ID);
        answerOffer(state, "cast");
        applyLandEntrySubmit(state, { playerId: "p1", accept: false });

        const land = state.players[0].battlefield.find((c) => c.id === hidden);
        expect(land!.isTapped).toBe(true);
        expect(state.players[0].life).toBe(lifeBefore);
        expect(state.players[0].landsPlayedThisTurn).toBe(1);
    });

    it("CR 305.3 — a hidden LAND is NOT offered on the opponent's turn, and the resolution completes cleanly", () => {
        // The asymmetry the fix must preserve: a creature flashes in on the
        // opponent's turn, a LAND does not ("ignore any part of an effect" that
        // says to play a land when it isn't your turn).
        const { state, isle } = setup(6, 15, ISLAND_ID);
        const hidden = hideOne(state, isle);
        passTurnToOpponent(state);

        expect(() =>
            resolveActivated(state, isle, PLAY_ABILITY_ID)
        ).not.toThrow();
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        // The land stayed exiled, face down, with no lingering permission.
        const card = state.players[0].exile.find((c) => c.id === hidden)!;
        expect(card).toBeDefined();
        expect(card.knownTo).toEqual(["p1"]);
        expect(card.castableFromExileBy).toBeUndefined();
        expect(state.players[0].landsPlayedThisTurn ?? 0).toBe(0);
    });

    it("CR 305.2b — a hidden LAND is NOT offered once the land drop is spent, and the resolution completes cleanly", () => {
        const { state, isle } = setup(6, 15, ISLAND_ID);
        const hidden = hideOne(state, isle);
        state.players[0].landsPlayedThisTurn = 1;

        expect(() =>
            resolveActivated(state, isle, PLAY_ABILITY_ID)
        ).not.toThrow();
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].exile.some((c) => c.id === hidden)).toBe(true);
        expect(state.players[0].landsPlayedThisTurn).toBe(1);
    });

    it("declining the LAND play leaves it exiled and face down (CR 406.3)", () => {
        const { state, isle } = setup(6, 15, ISLAND_ID);
        const hidden = hideOne(state, isle);
        resolveActivated(state, isle, PLAY_ABILITY_ID);
        answerOffer(state, "decline");

        const card = state.players[0].exile.find((c) => c.id === hidden)!;
        expect(card).toBeDefined();
        expect(card.knownTo).toEqual(["p1"]);
        expect(state.players[0].landsPlayedThisTurn ?? 0).toBe(0);
        expect(state.players[0].battlefield.some((c) => c.id === hidden)).toBe(
            false
        );
    });

    it("CR 400.7 / 607 / 608.2b — a bounced-and-replayed land offers ONLY its own hidden card, not the previous incarnation's (issue #2001)", () => {
        // Instance ids survive zone changes. Before issue #2001's fix,
        // `exiledBySourceId` was cleared the moment the SOURCE departed the
        // battlefield — which broke CR 608.2b (an ability already on the
        // stack referencing the pile at departure time). The clear now runs
        // at the source's NEXT battlefield ENTRY instead, so the link must
        // survive the bounce and only die when this same instance id is a
        // new object again.
        const { state, isle } = setup(8, 15);
        const first = hideOne(state, isle);

        // Bounce the land — CR 608.2b: the link SURVIVES the departure.
        removePermanentTo(state, "isle", "hand");
        expect(
            state.players[0].exile.find((c) => c.id === first)!.exiledBySourceId
        ).toBe("isle");

        // Replay it (same instance id) through the REAL entry funnel
        // (`applyPlayLand` → `settleEnteredLand` →
        // `clearExileLinksToEnteringSource`) rather than a raw splice, so this
        // test actually exercises the funnel the fix wires the clear into.
        const returned = applyPlayLand(state, state.players[0], "isle")!;

        // CR 400.7 — the re-entering land is a NEW object: the stale link
        // from its PREVIOUS battlefield existence is gone.
        expect(
            state.players[0].exile.find((c) => c.id === first)!.exiledBySourceId
        ).toBeUndefined();

        // `applyPlayLand`'s own PERMANENT_ENTERED emission already queued
        // Shelldock Isle's hideaway ETB trigger onto the stack (triggers never
        // auto-resolve) — resolve it now instead of `resolveTrigger`'s manual
        // push, which would double up the trigger.
        resolveTopOfStack(state);
        const second = state.pendingChoices![0].candidateIds![0];
        submitPick(state, second);
        expect(second).not.toBe(first);

        resolveActivated(state, returned, PLAY_ABILITY_ID);
        answerOffer(state, "cast");
        // Only the card THIS incarnation hid was played.
        expect(state.stack[state.stack.length - 1].id).toBe(second);
        expect(state.players[0].exile.some((c) => c.id === first)).toBe(true);
    });
});
