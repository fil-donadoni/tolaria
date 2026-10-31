// Self-animation windows and the expiring animated body (issue #7705).
//
// An `animatesSelf` activation buys a creature body for the rest of the turn
// and nothing else. Two seams read that fact:
//
//   1. The pointless-self-animation guardrail (`isDiscouragedRolloutMove`,
//      through `animationHasCombatWindow`): the animation is pointless EXCEPT
//      in a window where the body can still fight this turn and activating
//      later would lose that use.
//   2. The leaf evaluation: a body that reverts this turn (CR 514.2) is valued
//      as a creature only while it can still attack or block; outside such a
//      window it is the land it reverts to, and the mana the animation cost
//      stays spent.
//
// Cards are FIXTURES (Treetop Village: an `animatesSelf` land with no reach;
// Serra Angel: a flyer; Grizzly Bears: a ground attacker) — nothing under test
// reads a card name.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { isDiscouragedRolloutMove } from "../search";
import {
    animationHasCombatWindow,
    effectiveAbilityOf,
} from "../ai/abilityTiming";
import { evaluate } from "../evaluate";
import type { ManaTap, Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    animatePermanentAsCreature,
    type CardInstanceState,
    type GameState,
} from "../state";

const VILLAGE_DEF = getCardByName("Treetop Village");
const VILLAGE = VILLAGE_DEF.id;
const VILLAGE_ANIMATE = "treetop-village-animate";
const FOREST = getCardByName("Forest").id;
const ANGEL = getCardByName("Serra Angel").id;
const BEARS = getCardByName("Grizzly Bears").id;
const MIND_ROT = getCardByName("Mind Rot").id;

function mine(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        isSummoningSick: false,
        isTapped: false,
    });
}

function theirs(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: "p2",
        ownerId: "p2",
        id,
        isSummoningSick: false,
        isTapped: false,
    });
}

function myBoard(villageId = VILLAGE): CardInstanceState[] {
    return [
        mine(villageId, "village"),
        mine(FOREST, "forest-1"),
        mine(FOREST, "forest-2"),
    ];
}

function animate(villageId = VILLAGE): Move {
    return {
        kind: "activate-ability",
        cardInstanceId: "village",
        abilityId:
            villageId === VILLAGE ? VILLAGE_ANIMATE : `${villageId}-animate`,
        targets: [],
        confirmTargets: false,
        tapPlan: [
            { cardInstanceId: "forest-1" },
            { cardInstanceId: "forest-2" },
        ] satisfies ManaTap[],
    };
}

/** The bot (p1) defends: p2's turn, `attacker` declared, blockers not yet. */
function defendingAgainst(
    attacker: CardInstanceState,
    villageId = VILLAGE,
    combat: Partial<NonNullable<GameState["combat"]>> = {}
): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p2",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: myBoard(villageId) }),
            makePlayer("p2", { battlefield: [attacker] }),
        ],
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            ...combat,
        },
    });
}

/** p1's own turn or p2's, at `phase`, no combat. */
function at(
    phase: GameState["phase"],
    active: "p1" | "p2",
    extra: Partial<GameState> = {}
): GameState {
    return makeState({
        phase,
        activePlayerId: active,
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: myBoard() }),
            makePlayer("p2", { battlefield: [theirs(BEARS, "bears")] }),
        ],
        ...extra,
    });
}

function flagged(state: GameState, villageId = VILLAGE): boolean {
    return isDiscouragedRolloutMove(state, "p1", animate(villageId));
}

/** A Treetop Village whose animation also grants reach — synthetic. */
const REACH_VILLAGE_ID = "test-reach-village";
const REACH_VILLAGE: CardDefinition = {
    ...VILLAGE_DEF,
    id: REACH_VILLAGE_ID,
    name: "Test Reach Village",
    activatedAbilities: VILLAGE_DEF.activatedAbilities!.map((a) =>
        a.id === VILLAGE_ANIMATE
            ? {
                  ...a,
                  id: `${REACH_VILLAGE_ID}-animate`,
                  effects: a.effects!.map((op) =>
                      op.op === "animate"
                          ? {
                                ...op,
                                grantedAbilities: ["trample", "reach"],
                            }
                          : op
                  ),
              }
            : a
    ),
};

describe("self-animation guardrail — the opponent's declare-attackers window", () => {
    it("flags an animation whose body cannot block the lone flying attacker (CR 702.9b, CR 509.1b)", () => {
        expect(flagged(defendingAgainst(theirs(ANGEL, "angel")))).toBe(true);
    });

    it("does NOT flag it when the body can block a declared ground attacker (CR 509.1)", () => {
        expect(flagged(defendingAgainst(theirs(BEARS, "bears")))).toBe(false);
    });

    it("judges the body AFTER the animation: one granting reach can block the flyer (CR 702.17b)", () => {
        withTemporaryDefinition(REACH_VILLAGE, () => {
            expect(
                flagged(
                    defendingAgainst(theirs(ANGEL, "angel"), REACH_VILLAGE_ID),
                    REACH_VILLAGE_ID
                )
            ).toBe(false);
        });
    });

    it("flags it once blockers are declared — no body can become a blocker (CR 509.1)", () => {
        expect(
            flagged(
                defendingAgainst(theirs(BEARS, "bears"), VILLAGE, {
                    blockersConfirmed: true,
                })
            )
        ).toBe(true);
    });
});

describe("self-animation guardrail — the opponent's turn before attacks", () => {
    for (const phase of [
        "UPKEEP",
        "PRECOMBAT_MAIN",
        "BEGINNING_OF_COMBAT",
    ] as const) {
        it(`flags it in the opponent's ${phase}: priority comes again after attackers are declared (CR 117.3a)`, () => {
            expect(flagged(at(phase, "p2"))).toBe(true);
        });
    }

    it("flags it in response to a discard spell — the stack does not lift the clause", () => {
        const state = at("PRECOMBAT_MAIN", "p2");
        pushSpell(state, MIND_ROT, "p2", [{ type: "player", id: "p1" }]);
        expect(state.stack.length).toBe(1);
        expect(flagged(state)).toBe(true);
    });
});

describe("self-animation guardrail — the mover's own turn", () => {
    it("flags it in the mover's own upkeep: the main phase buys the same attack (CR 508.1a)", () => {
        expect(flagged(at("UPKEEP", "p1"))).toBe(true);
    });

    it("keeps the precombat main and beginning of combat as windows (CR 508.1a)", () => {
        for (const phase of [
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
        ] as const) {
            const state = at(phase, "p1");
            const village = state.players[0].battlefield[0];
            const ability = effectiveAbilityOf(village, VILLAGE_ANIMATE)!;
            expect(
                animationHasCombatWindow(state, "p1", village, ability),
                phase
            ).toBe(true);
        }
        expect(flagged(at("BEGINNING_OF_COMBAT", "p1"))).toBe(false);
    });

    it("keeps END_OF_COMBAT with an extra combat owed as a window (CR 500.8)", () => {
        expect(
            flagged(
                at("END_OF_COMBAT", "p1", {
                    extraPhases: [{ kind: "combat" }],
                })
            )
        ).toBe(false);
        expect(flagged(at("END_OF_COMBAT", "p1"))).toBe(true);
    });
});

/** `state` with the Village animated by its own `animate` Op, paid with both
 *  Forests (tapped). */
function animated(state: GameState): GameState {
    const [village, f1, f2] = state.players[0].battlefield;
    animatePermanentAsCreature(
        state,
        village,
        {
            power: 3,
            toughness: 3,
            subtype: "Ape",
            colors: ["G"],
            grantedAbilities: ["trample"],
            duration: { phase: "end-of-turn" },
        },
        "p1"
    );
    f1.isTapped = true;
    f2.isTapped = true;
    return state;
}

describe("evaluate — a body that reverts this turn (CR 514.2)", () => {
    it("does NOT score the animated land higher with no combat use left (own END_STEP)", () => {
        const plain = at("END_STEP", "p1");
        const anim = animated(at("END_STEP", "p1"));
        expect(evaluate(anim, "p1")).toBeLessThan(evaluate(plain, "p1"));
    });

    it("does NOT score it higher facing a flyer it cannot block (CR 702.9b)", () => {
        const plain = defendingAgainst(theirs(ANGEL, "angel"));
        const anim = animated(defendingAgainst(theirs(ANGEL, "angel")));
        expect(evaluate(anim, "p1")).toBeLessThan(evaluate(plain, "p1"));
    });

    it("may score it higher while an attack is still reachable (own BEGINNING_OF_COMBAT, CR 508.1a)", () => {
        const plain = at("BEGINNING_OF_COMBAT", "p1");
        const anim = animated(at("BEGINNING_OF_COMBAT", "p1"));
        expect(evaluate(anim, "p1")).toBeGreaterThan(evaluate(plain, "p1"));
    });
});
