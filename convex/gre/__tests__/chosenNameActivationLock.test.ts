// The name-keyed `activation-restriction` static (CR 602.5 / 113.7 —
// "Activated abilities of sources with the chosen name can't be activated[
// unless they're mana abilities]"), shipped by the compiled Pithing Needle and
// Phyrexian Revoker. The lock reads the restricting permanent's own
// `chosenName` (CR 614.12a) and covers a SOURCE in any zone — a hand card's
// cycling included — unlike Cursed Totem's permanents-only `filter`.
//
// Driven through the real entry points (`activateAbilityOnState`,
// `activationPreconditionViolation`, `tapSourceIntoPayment`, the mana funnel
// `hasManaAbility`), never a hand-built verdict.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { tapSourceIntoPayment } from "../../game";
import { activateAbilityOnState } from "../activation";
import { activationPreconditionViolation } from "../activationPrecondition";
import { activationRestrictionViolation } from "../activationRestrictions";
import { hasManaAbility } from "../constants";
import type { CardInstanceState, GameState, PlayerState } from "../state";

const NEEDLE_TEXT =
    "Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.";
const REVOKER_TEXT =
    "Activated abilities of sources with the chosen name can't be activated.";

function perm(name: string, id: string, owner: string): CardInstanceState {
    return makeInstance(getCardByName(name).id, {
        id,
        controllerId: owner,
        ownerId: owner,
        isSummoningSick: false,
    });
}

/** p1 controls `mine` and holds `hand`; the lock (Needle or Revoker, naming
 *  `named` — absent: no choice made) sits on the OPPONENT's side, since it
 *  binds every player. */
function board(opts: {
    lock: "Pithing Needle" | "Phyrexian Revoker";
    named?: string;
    mine?: Array<[name: string, id: string]>;
    hand?: Array<[name: string, id: string]>;
}): { state: GameState; me: PlayerState } {
    const lock = perm(opts.lock, "lock", "p2");
    if (opts.named !== undefined) lock.chosenName = opts.named;
    const me = makePlayer("p1", {
        battlefield: (opts.mine ?? []).map(([n, id]) => perm(n, id, "p1")),
        hand: (opts.hand ?? []).map(([n, id]) => ({
            ...perm(n, id, "p1"),
            zone: "hand" as const,
        })),
    });
    me.manaPool = { ...me.manaPool, U: 5, C: 5 };
    const them = makePlayer("p2", { battlefield: [lock] });
    return {
        state: makeState({
            players: [me, them],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        }),
        me,
    };
}

function onBattlefield(me: PlayerState, id: string): CardInstanceState {
    return me.battlefield.find((c) => c.id === id)!;
}

describe("chosen-name activation lock: a permanent's abilities (CR 602.5)", () => {
    it("Pithing Needle naming Prodigal Sorcerer forbids its ping", () => {
        const { state, me } = board({
            lock: "Pithing Needle",
            named: "Prodigal Sorcerer",
            mine: [["Prodigal Sorcerer", "tim"]],
        });
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "tim",
                abilityId:
                    getCardByName("Prodigal Sorcerer").activatedAbilities![0]!
                        .id,
            })
        ).toThrow(NEEDLE_TEXT);
        expect(
            activationPreconditionViolation(
                state,
                onBattlefield(me, "tim"),
                getCardByName("Prodigal Sorcerer").activatedAbilities![0]!
            )
        ).toBe(NEEDLE_TEXT);
    });

    it("another name locks nothing", () => {
        const { state, me } = board({
            lock: "Pithing Needle",
            named: "Shivan Dragon",
            mine: [["Prodigal Sorcerer", "tim"]],
        });
        expect(
            activationPreconditionViolation(
                state,
                onBattlefield(me, "tim"),
                getCardByName("Prodigal Sorcerer").activatedAbilities![0]!
            )
        ).toBeNull();
    });

    it("no name chosen yet: nothing is locked (CR 614.12a)", () => {
        const { state, me } = board({
            lock: "Pithing Needle",
            mine: [["Prodigal Sorcerer", "tim"]],
        });
        expect(
            activationPreconditionViolation(
                state,
                onBattlefield(me, "tim"),
                getCardByName("Prodigal Sorcerer").activatedAbilities![0]!
            )
        ).toBeNull();
    });

    it("a lock that lost all its abilities locks nothing (CR 613.1f)", () => {
        const { state, me } = board({
            lock: "Pithing Needle",
            named: "Prodigal Sorcerer",
            mine: [["Prodigal Sorcerer", "tim"]],
        });
        state.players[1]!.battlefield[0]!.abilitiesSuppressedBy = [
            "test-humility",
        ] as never;
        expect(
            activationPreconditionViolation(
                state,
                onBattlefield(me, "tim"),
                getCardByName("Prodigal Sorcerer").activatedAbilities![0]!
            )
        ).toBeNull();
    });
});

describe("chosen-name activation lock: mana abilities (CR 605.1a)", () => {
    it("Pithing Needle's tail exempts Llanowar Elves' mana ability", () => {
        const { state, me } = board({
            lock: "Pithing Needle",
            named: "Llanowar Elves",
            mine: [["Llanowar Elves", "elves"]],
        });
        expect(hasManaAbility(onBattlefield(me, "elves"), state)).toBe(true);
        tapSourceIntoPayment(
            state,
            me,
            onBattlefield(me, "elves"),
            undefined,
            []
        );
        expect(me.manaPool.G).toBe(1);
    });

    it("Phyrexian Revoker, with no exemption, locks it", () => {
        const { state, me } = board({
            lock: "Phyrexian Revoker",
            named: "Llanowar Elves",
            mine: [["Llanowar Elves", "elves"]],
        });
        expect(hasManaAbility(onBattlefield(me, "elves"), state)).toBe(false);
        expect(activationRestrictionViolation(state, "elves", true)).toBe(
            REVOKER_TEXT
        );
    });
});

describe("chosen-name activation lock: sources in any zone (CR 113.7)", () => {
    const cycling = () =>
        getCardByName("Lonely Sandbar").activatedAbilities!.find(
            (a) => a.activateFromHand
        )!;

    it("locks a hand card's cycling, read off the view's own hand", () => {
        const { state } = board({
            lock: "Pithing Needle",
            named: "Lonely Sandbar",
            hand: [["Lonely Sandbar", "sandbar"]],
        });
        expect(activationRestrictionViolation(state, "sandbar", false)).toBe(
            NEEDLE_TEXT
        );
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "sandbar",
                abilityId: cycling().id,
            })
        ).toThrow(NEEDLE_TEXT);
    });

    it("…and leaves another hand card's cycling alone", () => {
        const { state, me } = board({
            lock: "Pithing Needle",
            named: "Barren Moor",
            hand: [["Lonely Sandbar", "sandbar"]],
        });
        expect(
            activationPreconditionViolation(state, me.hand[0]!, cycling())
        ).toBeNull();
    });
});
