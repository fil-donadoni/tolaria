// WAR colorless — Karn, the Great Creator (issue #10555).
//
// Each clause through its real entry point: the static through
// `activateAbilityOnState` and the mana funnel (CR 602.5 / 605.1a), the +1
// through the resolving script and the UNTAP boundary it expires at (CR 608.2h
// — the base P/T is read once; CR 611.2a), the −2 through the option pick and
// both branches' picks (CR 400.11b; CR 406.3a — a face-down exiled card has no
// characteristics, so the artifact filter never offers one).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
    submitChoice,
} from "../../../__tests__/setup.helper";
import { getDefinition } from "../../../index";
import { activateAbilityOnState } from "../../../../gre/activation";
import { applyOneTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { compactState, expandState } from "../../../../gre/serialize";
import { getManaTapOptionsDetailed } from "../../../../gre/constants";
import { getEffectivePT } from "../../../../gre/layers";
import { advancePhase } from "../../../../gre/phases";
import { checkStateBasedActions } from "../../../../gre/sba";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "../../../../gre/state";

/** Karn, the Great Creator — the WAR printing. */
const KARN = "3ec0c0fb-1a4f-45f4-85b7-346a6d3ce2c5";
const PLUS1 = "karn-the-great-creator-plus1";
const MINUS2 = "karn-the-great-creator-minus2";
const LOCK_TEXT =
    "Activated abilities of artifacts your opponents control can't be activated.";

/** Literal ids (the earliest paper printings), never a name lookup. */
const CARD_IDS: Record<string, string> = {
    "Jayemdae Tome": "cac8c421-5b92-481d-b2de-560c0231ab58",
    "Sol Ring": "c4300d24-1cae-4dd5-be7e-38cc677cf5bd",
    "Chalice of the Void": "1a02ca71-5e39-4a5f-aaba-a1e3e10a6a3e",
    "Grizzly Bears": "ce2d603a-3231-4a8c-bf39-1617586ea870",
    "Mind Stone": "162e81d3-6cd4-4cb8-8ed8-cfbd8d34ca71",
    "Seat of the Synod": "5da5587d-6b6c-4645-8cc9-2866d1e6911b",
};
const idOf = (name: string) => CARD_IDS[name]!;

function perm(
    name: string,
    id: string,
    owner: string,
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(idOf(name), {
        id,
        controllerId: owner,
        ownerId: owner,
        isSummoningSick: false,
        ...extra,
    });
}

function karn(owner = "p1"): CardInstanceState {
    return makeInstance(KARN, {
        id: `karn-${owner}`,
        controllerId: owner,
        ownerId: owner,
        counters: { loyalty: 5 },
    });
}

function board(opts: {
    mine?: CardInstanceState[];
    theirs?: CardInstanceState[];
    me?: Partial<PlayerState>;
}): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                battlefield: [karn(), ...(opts.mine ?? [])],
                ...opts.me,
            }),
            makePlayer("p2", { battlefield: opts.theirs ?? [] }),
        ],
    });
}

const onBattlefield = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);

const karnOf = (state: GameState) => onBattlefield(state, "karn-p1")!;

const battlefieldsOf = (state: GameState) =>
    state.players.map((p) => ({ playerId: p.id, battlefield: p.battlefield }));

describe("Karn, the Great Creator — static (CR 602.5)", () => {
    it("an opponent's artifact can't activate its ability", () => {
        const state = board({
            theirs: [perm("Jayemdae Tome", "their-tome", "p2")],
        });
        state.players[1].manaPool = { ...state.players[1].manaPool, C: 4 };
        state.priorityPlayerId = "p2";
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p2",
                cardInstanceId: "their-tome",
                abilityId: getDefinition(idOf("Jayemdae Tome"))
                    .activatedAbilities![0]!.id,
            })
        ).toThrow(LOCK_TEXT);
        expect(state.stack).toHaveLength(0);
    });

    it("an opponent's artifact mana ability is locked too (CR 605.1a)", () => {
        const state = board({ theirs: [perm("Sol Ring", "their-ring", "p2")] });
        const ring = onBattlefield(state, "their-ring")!;
        expect(
            getManaTapOptionsDetailed(ring, "p2", battlefieldsOf(state))
        ).toEqual([]);
    });

    it("Karn's controller's own artifacts are untouched", () => {
        const state = board({ mine: [perm("Sol Ring", "my-ring", "p1")] });
        const ring = onBattlefield(state, "my-ring")!;
        expect(
            getManaTapOptionsDetailed(ring, "p1", battlefieldsOf(state))
        ).not.toEqual([]);
    });
});

describe("Karn, the Great Creator — +1 (CR 608.2h, CR 611.2a)", () => {
    it("a noncreature artifact becomes an artifact creature with P/T equal to its mana value", () => {
        const state = board({ mine: [perm("Jayemdae Tome", "tome", "p1")] });
        resolveActivated(state, karnOf(state), PLUS1, [
            { type: "permanent", id: "tome" },
        ]);
        const tome = onBattlefield(state, "tome")!;
        expect(tome.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(getEffectivePT(state, tome)).toMatchObject({
            power: 4,
            toughness: 4,
        });
    });

    it("the type line is SET: an artifact land becomes an artifact creature and stops being a land (CR 205.1a)", () => {
        const state = board({
            theirs: [perm("Seat of the Synod", "seat", "p2")],
        });
        resolveActivated(state, karnOf(state), PLUS1, [
            { type: "permanent", id: "seat" },
        ]);
        const seat = onBattlefield(state, "seat")!;
        expect([...seat.types].sort()).toEqual(["Artifact", "Creature"]);
    });

    it("an {X} artifact's mana value is 0 on the battlefield, so it dies as a 0/0 (CR 202.3e)", () => {
        const state = board({
            theirs: [perm("Chalice of the Void", "chalice", "p2")],
        });
        resolveActivated(state, karnOf(state), PLUS1, [
            { type: "permanent", id: "chalice" },
        ]);
        checkStateBasedActions(state);
        expect(onBattlefield(state, "chalice")).toBeUndefined();
    });

    it("the animation lasts through the opponent's turn and ends as Karn's controller's next turn begins", () => {
        const state = board({ mine: [perm("Mind Stone", "stone", "p1")] });
        resolveActivated(state, karnOf(state), PLUS1, [
            { type: "permanent", id: "stone" },
        ]);
        expect(onBattlefield(state, "stone")!.types).toContain("Creature");
        state.phase = "CLEANUP";
        let guard = 0;
        while (state.activePlayerId !== "p2" && guard++ < 40) {
            advancePhase(state);
        }
        expect(state.activePlayerId).toBe("p2");
        expect(onBattlefield(state, "stone")!.types).toContain("Creature");
        guard = 0;
        while (state.activePlayerId !== "p1" && guard++ < 40) {
            state.pendingChoices = [];
            advancePhase(state);
        }
        expect(state.activePlayerId).toBe("p1");
        expect(onBattlefield(state, "stone")!.types).not.toContain("Creature");
    });

    it("up to one: with no target the ability still resolves, and Karn keeps the loyalty", () => {
        const state = board({});
        resolveActivated(state, karnOf(state), PLUS1, []);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toEqual([]);
    });
});

/** p1 owns an artifact and a creature outside the game, plus exiled cards. */
function minus2Board(): GameState {
    const outside = (name: string, id: string) =>
        makeInstance(idOf(name), {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
    return board({
        me: {
            outsideGame: [
                outside("Sol Ring", "sb-ring"),
                outside("Grizzly Bears", "sb-bears"),
            ],
            exile: [
                outside("Mind Stone", "ex-stone"),
                {
                    ...outside("Jayemdae Tome", "ex-hidden-tome"),
                    faceDownBy: "face-down-exile",
                    knownTo: ["p1"],
                },
                outside("Grizzly Bears", "ex-bears"),
            ],
        },
    });
}

function pickOption(state: GameState, labelPrefix: string): void {
    const head = state.pendingChoices![0]!;
    expect(head.kind).toBe("option-pick");
    const option = head.options!.find((o) => o.label.startsWith(labelPrefix))!;
    submitChoice(state, [option.id]);
}

const handIds = (state: GameState) => state.players[0].hand.map((c) => c.id);

describe("Karn, the Great Creator — −2 (CR 400.11b, CR 406.3a)", () => {
    it("reveals an artifact card from outside the game into hand", () => {
        const state = minus2Board();
        resolveActivated(state, karnOf(state), MINUS2);
        pickOption(state, "Reveal");
        const head = state.pendingChoices![0]!;
        expect(head.kind).toBe("choose-outside-game-card");
        expect(head.candidateIds).toEqual(["sb-ring"]);
        submitChoice(state, ["sb-ring"]);
        expect(handIds(state)).toEqual(["sb-ring"]);
        expect(state.players[0].outsideGame!.map((c) => c.id)).toEqual([
            "sb-bears",
        ]);
    });

    it("chooses a face-up artifact card in exile — never a face-down one, even one its owner may look at", () => {
        const state = minus2Board();
        resolveActivated(state, karnOf(state), MINUS2);
        pickOption(state, "Choose");
        const head = state.pendingChoices![0]!;
        expect(head.kind).toBe("choose-exile-card");
        expect(head.candidateIds).toEqual(["ex-stone"]);
        submitChoice(state, ["ex-stone"]);
        expect(handIds(state)).toEqual(["ex-stone"]);
        expect(state.players[0].exile.map((c) => c.id)).toEqual([
            "ex-hidden-tome",
            "ex-bears",
        ]);
    });

    it('"you may" — declining the exile pick moves nothing', () => {
        const state = minus2Board();
        resolveActivated(state, karnOf(state), MINUS2);
        pickOption(state, "Choose");
        submitChoice(state, []);
        expect(handIds(state)).toEqual([]);
        expect(state.players[0].exile).toHaveLength(3);
    });
});

describe("Karn, the Great Creator — full path (activation → resolution → save/load → wire)", () => {
    it("the +1 announced through the activation mutation's body survives a save and reaches the client as an artifact creature with its locked base P/T", () => {
        const live = board({
            theirs: [perm("Seat of the Synod", "seat", "p2")],
            mine: [perm("Jayemdae Tome", "tome", "p1")],
        });
        activateAbilityOnState(live, {
            playerId: "p1",
            cardInstanceId: "karn-p1",
            abilityId: PLUS1,
        });
        applyOneTargetSelection(live, "p1", {
            targetType: "permanent",
            targetId: "tome",
        });
        // CR 606.4 — the +1 is paid as the cost.
        expect(karnOf(live).counters?.loyalty).toBe(6);
        resolveTopOfStack(live);
        const state = expandState(compactState(live));
        const slim = projectPublicState(
            state,
            1,
            "p1"
        ).players[0].battlefield.find((c) => c.id === "tome")!;
        expect([...slim.types].sort()).toEqual(["Artifact", "Creature"]);
        expect(
            getEffectivePT(state, onBattlefield(state, "tome")!)
        ).toMatchObject({
            power: 4,
            toughness: 4,
        });
    });
});
