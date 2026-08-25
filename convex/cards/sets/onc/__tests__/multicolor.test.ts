// ONC multicolor — per-colour card behaviour tests (ADR 0043 parallel test
// file). Otharri, Suns' Glory (issue #1969) earns a hand-written per-card test
// on two rows of the card-testing table (`.claude/rules/gre-development.md`):
// it has an `activatedAbilities[]` whose outcome is visible on the board, and
// its attack trigger's visible outcome (tokens) is projected to the client —
// so both the GRE assertion and the wire-format re-assertion are mandatory.
// Every block below drives a real engine entry point (`resolveTopOfStack`,
// `activateAbilityOnState`, `projectPublicState`); none reads definition
// fields back at itself.
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    activateAbilityOnState,
    selectActivationCostOnState,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { otharriSunsGlory } from "../multicolor";

/** Puts Otharri's attack trigger on the stack the way `ATTACKERS_DECLARED`
 *  would (the Satya harness shape, `m3c/__tests__/multicolor.test.ts`). */
function otharriAttackTriggerOnStack(
    state: GameState,
    otharri: CardInstanceState,
    seq: number
): StackItem {
    const trig: StackItem = {
        ...otharri,
        id: `otharri-attack-trig-${seq}`,
        zone: "stack",
        castById: otharri.controllerId,
        triggeredAbilityId: "otharri-suns-glory-attack",
        triggerSourceId: otharri.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: otharri.controllerId,
            attackerIds: [otharri.id],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Otharri attacking, alone on p1's battlefield, mid-combat. */
function attackingState(): { state: GameState; otharri: CardInstanceState } {
    const otharri = makeInstance(otharriSunsGlory.id, {
        id: "otharri",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [otharri] }),
            makePlayer("p2"),
        ],
        combat: {
            attackerIds: ["otharri"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    return { state, otharri };
}

const rebelsOf = (state: GameState) =>
    state.players[0].battlefield.filter((c) => c.id !== "otharri");

describe("Otharri, Suns' Glory — attack trigger (CR 122.1 experience counters + CR 508.4)", () => {
    it("first attack puts ONE experience counter on the player and makes ONE token", () => {
        const { state, otharri } = attackingState();
        otharriAttackTriggerOnStack(state, otharri, 1);
        resolveTopOfStack(state);

        // CR 122.1 — the counter sits on the PLAYER, not on Otharri.
        expect(state.players[0].experienceCounters).toBe(1);
        expect(otharri.counters?.experience).toBeUndefined();

        const rebels = rebelsOf(state);
        expect(rebels).toHaveLength(1);
        expect(rebels[0].isToken).toBe(true);
        expect(rebels[0].power).toBe(2);
        expect(rebels[0].toughness).toBe(2);
    });

    it("SCALES: the second attack makes TWO tokens (increment happens BEFORE the count is read)", () => {
        const { state, otharri } = attackingState();
        otharriAttackTriggerOnStack(state, otharri, 1);
        resolveTopOfStack(state);
        expect(rebelsOf(state)).toHaveLength(1);

        otharriAttackTriggerOnStack(state, otharri, 2);
        resolveTopOfStack(state);

        expect(state.players[0].experienceCounters).toBe(2);
        // 1 from the first attack + 2 from the second. If the count were read
        // BEFORE the increment ("Then" ignored) this would be 1 + 1 = 2.
        expect(rebelsOf(state)).toHaveLength(3);
    });

    it("the tokens enter TAPPED and ATTACKING, joining the current combat (CR 508.4)", () => {
        const { state, otharri } = attackingState();
        otharriAttackTriggerOnStack(state, otharri, 1);
        resolveTopOfStack(state);

        const rebel = rebelsOf(state)[0];
        expect(rebel.isTapped).toBe(true);
        // CR 508.4 — attacking by BOTH engine representations: combat
        // membership AND the per-permanent flag every `isAttacking`-keyed read
        // (layer statics, targeting filters, the frontend's blocker-assignment
        // affordance) consults (the #1195 review finding on Satya).
        expect(state.combat!.attackerIds).toContain(rebel.id);
        expect(rebel.isAttacking).toBe(true);
        // CR 508.4 — a token that ENTERS attacking was never DECLARED as an
        // attacker, so it fires no attack trigger of its own: exactly one
        // trigger resolved, and the stack is empty again.
        expect(state.stack).toHaveLength(0);
    });

    it("the experience total and the tokens survive projection (wire format)", () => {
        const { state, otharri } = attackingState();
        otharriAttackTriggerOnStack(state, otharri, 1);
        resolveTopOfStack(state);
        otharriAttackTriggerOnStack(state, otharri, 2);
        resolveTopOfStack(state);

        // Re-assert THROUGH the real projection: a hand-built view would not
        // catch a reducer dropping the scalar (the count is public info for
        // both players, so the OPPONENT's view must carry it too).
        const mine = projectPublicState(state, 1, "p1");
        expect(mine.players[0].experienceCounters).toBe(2);
        const theirs = projectPublicState(state, 1, "p2");
        expect(theirs.players[0].experienceCounters).toBe(2);
        expect(
            theirs.players[0].battlefield.filter((c) => c.id !== "otharri")
        ).toHaveLength(3);
    });
});

describe("Otharri, Suns' Glory — experience counters persist (CR 122.2 is object-scoped)", () => {
    it("the total survives Otharri leaving the battlefield and being reanimated", () => {
        const { state, otharri } = attackingState();
        otharriAttackTriggerOnStack(state, otharri, 1);
        resolveTopOfStack(state);
        otharriAttackTriggerOnStack(state, otharri, 2);
        resolveTopOfStack(state);
        expect(state.players[0].experienceCounters).toBe(2);

        // Otharri dies. CR 122.2 ("counters on an OBJECT are not retained if
        // that object moves from one zone to another") does not reach a
        // player's counters — a player never changes zones.
        const me = state.players[0];
        me.battlefield = me.battlefield.filter((c) => c.id !== "otharri");
        me.graveyard.push({ ...otharri, zone: "graveyard" });
        expect(me.experienceCounters).toBe(2);

        // Reanimated: the next attack reads THREE, not one.
        const returned = me.graveyard.find((c) => c.id === "otharri")!;
        me.graveyard = me.graveyard.filter((c) => c.id !== "otharri");
        const back: CardInstanceState = { ...returned, zone: "battlefield" };
        me.battlefield.push(back);
        state.combat!.attackerIds.push("otharri");
        const rebelsBefore = rebelsOf(state).length;
        otharriAttackTriggerOnStack(state, back, 3);
        resolveTopOfStack(state);
        expect(me.experienceCounters).toBe(3);
        expect(rebelsOf(state).length - rebelsBefore).toBe(3);
    });
});

describe("Otharri, Suns' Glory — graveyard reanimation ability (CR 602.1 / 118.8)", () => {
    /** Otharri in the graveyard, plus the given battlefield permanents, and
     *  enough mana floating to pay {2}{R}{W}. */
    function graveyardState(battlefield: CardInstanceState[]): GameState {
        const otharri = makeInstance(otharriSunsGlory.id, {
            id: "otharri",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [otharri],
                    battlefield,
                    manaPool: { W: 1, U: 0, B: 0, R: 1, G: 0, C: 2 },
                }),
                makePlayer("p2"),
            ],
            priorityPlayerId: "p1",
        });
    }

    function rebel(id: string, opts: { tapped?: boolean } = {}) {
        return makeInstance(otharriSunsGlory.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Rebel"],
            isTapped: opts.tapped ?? false,
        });
    }

    function nonRebel(id: string) {
        return makeInstance(otharriSunsGlory.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Phoenix"],
        });
    }

    const ability = otharriSunsGlory.activatedAbilities![0];

    /** Activate Otharri from the graveyard, leaving the tap-a-Rebel picker
     *  open on `state.pendingActivation`. */
    function beginActivation(state: GameState) {
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "otharri",
            abilityId: ability.id,
        });
    }

    it("opens the tap-a-Rebel picker from the GRAVEYARD (CR 113.6b, activateFromGraveyard)", () => {
        const state = graveyardState([rebel("rebel0")]);
        beginActivation(state);
        // The source is in the graveyard, so nothing can be paid or put on the
        // stack until the picker is answered.
        expect(state.pendingActivation).toBeDefined();
        expect(state.pendingActivation!.fromGraveyard).toBe(true);
        expect(state.pendingActivation!.tapOtherChoice).toBeDefined();
        expect(state.stack).toHaveLength(0);
    });

    it("an ALREADY TAPPED Rebel cannot pay the cost (CR 602.1 — 'an UNTAPPED Rebel')", () => {
        const state = graveyardState([rebel("rebel0", { tapped: true })]);
        // CR 602.1 — the activation is illegal outright when the candidate
        // pool cannot cover the cost; it never even opens the picker.
        expect(() => beginActivation(state)).toThrow(
            /Not enough untapped permanents/i
        );
    });

    it("a non-Rebel creature you control does not match the cost filter", () => {
        const state = graveyardState([nonRebel("phoenix0")]);
        expect(() => beginActivation(state)).toThrow(
            /Not enough untapped permanents/i
        );
    });

    it("an opponent's untapped Rebel does not match ('a Rebel YOU control')", () => {
        const theirs = makeInstance(otharriSunsGlory.id, {
            id: "theirRebel",
            controllerId: "p2",
            ownerId: "p2",
            subtypes: ["Rebel"],
        });
        const state = graveyardState([]);
        state.players[1].battlefield.push(theirs);
        expect(() => beginActivation(state)).toThrow(
            /Not enough untapped permanents/i
        );
    });

    it("taps a Rebel, and resolution returns Otharri from the graveyard TAPPED", () => {
        const state = graveyardState([rebel("rebel0")]);
        beginActivation(state);
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: "rebel0",
        });
        // Picker answered and the {2}{R}{W} paid from the floating pool ⇒ the
        // activation commits and the ability goes on the stack (CR 602.2a).
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        // The Rebel is tapped as part of the COST, before resolution.
        expect(
            state.players[0].battlefield.find((c) => c.id === "rebel0")!
                .isTapped
        ).toBe(true);

        resolveTopOfStack(state);
        const me = state.players[0];
        expect(me.graveyard.some((c) => c.id === "otharri")).toBe(false);
        const back = me.battlefield.find((c) => c.id === "otharri")!;
        expect(back).toBeDefined();
        // "… to the battlefield tapped."
        expect(back.isTapped).toBe(true);

        // Wire format: the reanimated permanent, tapped, is what the client
        // sees — re-assert through the real projection, not a hand-built view.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "otharri"
        )!;
        expect(slim.isTapped).toBe(true);
    });
});
