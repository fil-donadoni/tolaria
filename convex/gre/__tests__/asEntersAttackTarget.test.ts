// CR 508.4 — a token put onto the battlefield attacking (issue #1865).
//
//   508.4 "If a creature is put onto the battlefield attacking, its controller
//   chooses which defending player, planeswalker a defending player controls,
//   or battle a defending player protects it's attacking as it enters the
//   battlefield (unless the effect that put it onto the battlefield specifies
//   what it's attacking)."
//
//   508.4a "… The same is true if a creature would be put onto the
//   battlefield attacking a planeswalker or battle and that permanent is no
//   longer on the battlefield, … or is a planeswalker that is no longer
//   controlled by a defending player."
//
// The choice is made AS the token enters, so it rides the ADR 0100 as-enters
// choice point (census row C): the token entry site owes an `attack-target`
// choice, auto-answered when the defending player controls no planeswalker.
// Every test below resolves through the REAL `resolveTopOfStack` → Effect
// Script path, so the park, the replay marker and the resume are exercised.
import { describe, expect, it } from "vitest";
import {
    createTokenPermanents,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { joinCombatAttacking } from "../combat";
import { projectPublicState } from "../../gameProjections";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { wrennAndSix } from "../../cards/sets/mh1/multicolor.cards";

// --- Harness ----------------------------------------------------------------

/** A synthetic DSL-only instant: "create N 1/1 tokens that are tapped and
 *  attacking". Registered through the registry injection seam so it resolves
 *  through the real `runOpList` path (suspend + re-entry of the Op). */
function registerAttackingTokenScript(id: string, count?: number): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Instant"],
        effects: [
            {
                op: "createToken",
                token: {
                    name: "Soldier",
                    types: ["Creature"],
                    subtypes: ["Soldier"],
                    colors: ["W"],
                    power: 1,
                    toughness: 1,
                    entersTapped: true,
                    entersAttacking: true,
                },
                controller: "controller",
                ...(count !== undefined ? { count } : {}),
            },
        ],
    });
    return id;
}

const MAKE_ONE = registerAttackingTokenScript("test-1865-attacking-one");
const MAKE_TWO = registerAttackingTokenScript("test-1865-attacking-two", 2);

/** The Satya shape: "create a tapped and attacking token that's a copy of
 *  target creature" — the `createTokenCopy` Op, with its own replay marker. */
const COPY_ATTACKING = "test-1865-copy-attacking";
registerTokenDefinition({
    id: COPY_ATTACKING,
    name: COPY_ATTACKING,
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Creature"], count: 1 },
    effects: [
        {
            op: "createTokenCopy",
            source: { target: 0 },
            controller: "controller",
            entersTapped: true,
            entersAttacking: true,
        },
    ],
});

function planeswalker(id: string, controllerId: string): CardInstanceState {
    return makeInstance(wrennAndSix().id, {
        id,
        controllerId,
        ownerId: controllerId,
        counters: { loyalty: 3 },
    });
}

/** p1 is attacking p2 with one declared creature; p2 controls `p2Walkers`.
 *  The token script is on the stack, cast by p1. */
function combatWithScript(
    scriptId: string,
    p2Walkers: CardInstanceState[] = []
): GameState {
    const attacker = makeInstance(grizzlyBears().id, {
        id: "atk1",
        controllerId: "p1",
        ownerId: "p1",
    });
    attacker.isAttacking = true;
    const state = makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2", { battlefield: p2Walkers }),
        ],
        combat: {
            attackerIds: ["atk1"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    pushSpell(state, scriptId, "p1");
    return state;
}

function head(state: GameState) {
    return (state.pendingChoices ?? [])[0];
}

function answer(state: GameState, ids: string[]): void {
    const h = head(state);
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

function tokensOf(state: GameState, playerId: string): CardInstanceState[] {
    return state.players
        .find((p) => p.id === playerId)!
        .battlefield.filter((c) => c.isToken);
}

// --- Tests ------------------------------------------------------------------

describe("CR 508.4 — a token entering attacking chooses what it attacks (issue #1865)", () => {
    it("no planeswalker: no prompt, the token attacks the defending player", () => {
        const state = combatWithScript(MAKE_ONE);
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        const [token] = tokensOf(state, "p1");
        expect(token.isAttacking).toBe(true);
        expect(token.isTapped).toBe(true);
        expect(state.combat!.attackerIds).toEqual(["atk1", token.id]);
        // The defending player is the ABSENT entry (`combat.attackTargets`).
        expect(state.combat!.attackTargets?.[token.id]).toBeUndefined();
        expect(state.stagedEntries).toBeUndefined();
    });

    it("a planeswalker: the controller is offered the defending player or the planeswalker, and the token is off every zone until it answers", () => {
        const state = combatWithScript(MAKE_ONE, [planeswalker("pw-1", "p2")]);
        resolveTopOfStack(state);

        const choice = head(state);
        expect(choice.kind).toBe("option-pick");
        expect(choice.asEntersKind).toBe("attack-target");
        expect(choice.playerId).toBe("p1");
        expect(choice.options?.map((o) => o.id)).toEqual(["p2", "pw-1"]);
        expect(state.priorityPlayerId).toBe("p1");
        // CR 508.4 — the choice is made AS it enters: nothing observes a
        // half-entered token (ADR 0100 D2).
        expect(tokensOf(state, "p1")).toHaveLength(0);
        expect(state.combat!.attackerIds).toEqual(["atk1"]);
        // The resolution is suspended, not finished.
        expect(state.stack).toHaveLength(1);

        // Wire: the chooser's projection carries the options the dialog renders.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.pendingChoices?.[0]?.options?.map((o) => o.id)
        ).toEqual(["p2", "pw-1"]);
    });

    it("answering the planeswalker: the token attacks it, and the suspended resolution completes in the same mutation", () => {
        const state = combatWithScript(MAKE_ONE, [planeswalker("pw-1", "p2")]);
        resolveTopOfStack(state);
        answer(state, ["pw-1"]);

        const tokens = tokensOf(state, "p1");
        // The createToken replay marker holds: the re-entered Op creates no
        // second token (ADR 0100 D5, row C).
        expect(tokens).toHaveLength(1);
        const [token] = tokens;
        expect(token.isAttacking).toBe(true);
        expect(state.combat!.attackerIds).toEqual(["atk1", token.id]);
        expect(state.combat!.attackTargets?.[token.id]).toBe("pw-1");
        // The stamp is consumed by the entry, never left on the permanent.
        expect(token.enterAttackingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.priorityPlayerId).toBe("p1");

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.combat?.attackTargets?.[token.id]).toBe("pw-1");
    });

    it("answering the defending player: the token attacks the player (no attackTargets entry)", () => {
        const state = combatWithScript(MAKE_ONE, [planeswalker("pw-1", "p2")]);
        resolveTopOfStack(state);
        answer(state, ["p2"]);

        const [token] = tokensOf(state, "p1");
        expect(token.isAttacking).toBe(true);
        expect(state.combat!.attackerIds).toContain(token.id);
        expect(state.combat!.attackTargets?.[token.id]).toBeUndefined();
        expect(state.stack).toHaveLength(0);
    });

    it("count 2: each token chooses on its own, and exactly two tokens are created", () => {
        const state = combatWithScript(MAKE_TWO, [planeswalker("pw-1", "p2")]);
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(2);
        answer(state, ["pw-1"]);
        expect(state.stack).toHaveLength(1);
        answer(state, ["p2"]);

        const tokens = tokensOf(state, "p1");
        expect(tokens).toHaveLength(2);
        const targets = tokens.map((t) => state.combat!.attackTargets?.[t.id]);
        expect(targets.sort()).toEqual([undefined, "pw-1"].sort());
        expect(tokens.every((t) => t.isAttacking)).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("no combat: the token enters, owes no choice and attacks nothing", () => {
        const state = combatWithScript(MAKE_ONE, [planeswalker("pw-1", "p2")]);
        state.combat = undefined;
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        const [token] = tokensOf(state, "p1");
        expect(token.isAttacking).toBeFalsy();
    });

    it("createTokenCopy (the Satya shape): the copy chooses too, and exactly one copy is created", () => {
        const state = combatWithScript(MAKE_ONE, [planeswalker("pw-1", "p2")]);
        state.stack = [];
        pushSpell(state, COPY_ATTACKING, "p1", [
            { type: "permanent", id: "atk1" },
        ]);
        resolveTopOfStack(state);
        expect(head(state).asEntersKind).toBe("attack-target");
        expect(tokensOf(state, "p1")).toHaveLength(0);
        answer(state, ["pw-1"]);

        const tokens = tokensOf(state, "p1");
        expect(tokens).toHaveLength(1);
        expect(tokens[0].isAttacking).toBe(true);
        expect(state.combat!.attackTargets?.[tokens[0].id]).toBe("pw-1");
        expect(state.stack).toHaveLength(0);
    });

    it("CR 508.4a: a planeswalker picked on the second prompt after it died leaves that token not attacking — never attacking the player instead", () => {
        const state = combatWithScript(MAKE_TWO, [planeswalker("pw-1", "p2")]);
        resolveTopOfStack(state);
        answer(state, ["p2"]);
        // The planeswalker leaves between the two batched prompts.
        state.players[1].battlefield = [];
        answer(state, ["pw-1"]);

        const tokens = tokensOf(state, "p1");
        expect(tokens).toHaveLength(2);
        const attacking = tokens.filter((t) => t.isAttacking);
        expect(attacking).toHaveLength(1);
        expect(state.combat!.attackerIds).toEqual(["atk1", attacking[0].id]);
        expect(state.combat!.attackTargets).toBeUndefined();
    });

    it("CR 506.3b: a token the attacking player does not control owes no choice and never attacks", () => {
        const state = combatWithScript(MAKE_ONE, [planeswalker("pw-1", "p2")]);
        // A planeswalker on the ATTACKING side too, so a choice owed by p2's
        // token would have two options and really be offered.
        state.players[0].battlefield.push(planeswalker("pw-p1", "p1"));
        state.stack = [];
        pushSpell(state, MAKE_ONE, "p2");
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        const [token] = tokensOf(state, "p2");
        expect(token.isAttacking).toBeFalsy();
        expect(state.combat!.attackerIds).toEqual(["atk1"]);
    });

    it("a debug board PLACING an attacking token owes no choice (placement)", () => {
        const state = combatWithScript(MAKE_ONE, [planeswalker("pw-1", "p2")]);
        createTokenPermanents(
            state,
            {
                name: "Soldier",
                types: ["Creature"],
                power: 1,
                toughness: 1,
                entersAttacking: true,
            },
            "p1",
            1,
            undefined,
            { placement: true }
        );
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
        expect(tokensOf(state, "p1")).toHaveLength(1);
    });
});

describe("CR 508.4a / 506.3c — joinCombatAttacking refuses a defender that is no longer legal", () => {
    function enteringToken(stamp: string): CardInstanceState {
        const token = makeInstance(grizzlyBears().id, {
            id: "entering",
            controllerId: "p1",
            ownerId: "p1",
        });
        token.enterAttackingTarget = stamp;
        return token;
    }

    function boardWith(
        p1: CardInstanceState[],
        p2: CardInstanceState[]
    ): GameState {
        return makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: p1 }),
                makePlayer("p2", { battlefield: p2 }),
            ],
            combat: {
                attackerIds: [],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    it("a live planeswalker the defending player controls: attacking it", () => {
        const token = enteringToken("pw-1");
        const state = boardWith([token], [planeswalker("pw-1", "p2")]);
        joinCombatAttacking(state, token);
        expect(token.isAttacking).toBe(true);
        expect(state.combat!.attackTargets?.[token.id]).toBe("pw-1");
        expect(token.enterAttackingTarget).toBeUndefined();
    });

    it("the planeswalker left the battlefield: enters, never attacking", () => {
        const token = enteringToken("pw-gone");
        const state = boardWith([token], []);
        joinCombatAttacking(state, token);
        expect(token.isAttacking).toBeFalsy();
        expect(state.combat!.attackerIds).not.toContain(token.id);
        expect(token.enterAttackingTarget).toBeUndefined();
    });

    it("the planeswalker is no longer controlled by a defending player: enters, never attacking", () => {
        const token = enteringToken("pw-1");
        const state = boardWith([token, planeswalker("pw-1", "p1")], []);
        joinCombatAttacking(state, token);
        expect(token.isAttacking).toBeFalsy();
        expect(state.combat!.attackerIds).not.toContain(token.id);
        expect(state.combat!.attackTargets).toBeUndefined();
    });

    it("CR 506.3b: controlled by a player who is not attacking: enters, never attacking", () => {
        const token = enteringToken("pw-1");
        token.controllerId = "p2";
        token.ownerId = "p2";
        const state = boardWith([planeswalker("pw-1", "p1")], [token]);
        joinCombatAttacking(state, token);
        expect(token.isAttacking).toBeFalsy();
        expect(state.combat!.attackerIds).not.toContain(token.id);
    });
});
