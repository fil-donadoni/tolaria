// Empower Jace N (CR 701.71) — the keyword action, driven through the real
// interpreter (`resolveTopOfStack`) on a sorcery whose whole Effect Script is
// `empowerJaceOps(n)`, and the Jace planeswalker token it creates, activated
// through the real CR 606 path (`activateAbilityOnState`). Issue #7198.

import { describe, it, expect } from "vitest";
import {
    empowerJaceOps,
    JACE_PLANESWALKER_TOKEN,
} from "../../cards/abilities/empowerJace";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import {
    tokenDefinitionId,
    tryGetDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import type { TokenSpec } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { activateAbilityOnState } from "../activation";
import { refreshExpectedInput } from "../expectedInput";
import { checkStateBasedActions } from "../sba";
import { hasColor } from "../targetFilters";
import { currentLoyalty } from "../loyalty";
import { validateEffectScript } from "../effects/validate";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

/** Ancestral Recall's id, borrowed as the sorcery that carries the script. */
const ANCESTRAL_RECALL = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";
const JACE_THE_MIND_SCULPTOR = "0e606072-a3aa-4300-ba90-ec92a721fa76";

function empowerSpell(n: number) {
    const base = getDefinition(ANCESTRAL_RECALL);
    return {
        ...base,
        oracleText: `Empower Jace ${n}.`,
        types: ["Sorcery" as const],
        targetRequirement: undefined,
        effects: empowerJaceOps(n),
    };
}

function libraryOf(n: number, owner: string): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(ANCESTRAL_RECALL, {
            id: `${owner}-lib-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", { library: libraryOf(5, "p1") }),
            makePlayer("p2", { library: libraryOf(5, "p2") }),
        ],
    });
}

/** Casts and resolves "Empower Jace n" for p1. */
function empower(state: GameState, n: number): void {
    withTemporaryDefinition(empowerSpell(n), () => {
        pushSpell(state, ANCESTRAL_RECALL, "p1");
        resolveTopOfStack(state);
    });
}

function jaceTokens(state: GameState, playerIdx = 0): CardInstanceState[] {
    return state.players[playerIdx].battlefield.filter(
        (c) => c.isToken && c.subtypes.includes("Jace")
    );
}

describe("Empower Jace N (CR 701.71a)", () => {
    it("with no Jace token, creates a blue Jace planeswalker token and puts N loyalty counters on it", () => {
        const state = board();
        empower(state, 2);
        const tokens = jaceTokens(state);
        expect(tokens).toHaveLength(1);
        const jace = tokens[0];
        expect(jace.types).toEqual(["Planeswalker"]);
        expect(hasColor(jace, "U")).toBe(true);
        expect(currentLoyalty(jace)).toBe(2);
        // CR 704.5i — it survives the SBA check: the counters landed in the
        // same resolution as the 0-loyalty token.
        expect(state.players[0].graveyard.some((c) => c.id === jace.id)).toBe(
            false
        );
    });

    it("Empower Jace 0 creates the 0-loyalty token, which the SBA then removes (CR 704.5i)", () => {
        const state = board();
        withTemporaryDefinition(
            {
                ...empowerSpell(1),
                effects: empowerJaceOps({
                    count: { zone: "hand", controller: "controller" },
                }),
            },
            () => {
                pushSpell(state, ANCESTRAL_RECALL, "p1");
                resolveTopOfStack(state);
            }
        );
        // p1's hand is empty: N resolves to 0.
        expect(jaceTokens(state)).toHaveLength(1);
        expect(currentLoyalty(jaceTokens(state)[0])).toBe(0);
        checkStateBasedActions(state);
        expect(jaceTokens(state)).toHaveLength(0);
    });

    it("with a Jace token already controlled, creates none and grows it", () => {
        const state = board();
        empower(state, 2);
        empower(state, 3);
        const tokens = jaceTokens(state);
        expect(tokens).toHaveLength(1);
        expect(currentLoyalty(tokens[0])).toBe(5);
    });

    it("a Jace planeswalker CARD is not a Jace planeswalker token: a token is still created", () => {
        const state = board();
        const mindSculptor = makeInstance(JACE_THE_MIND_SCULPTOR, {
            id: "jtms",
            counters: { loyalty: 3 },
        });
        state.players[0].battlefield.push(mindSculptor);
        empower(state, 1);
        expect(jaceTokens(state)).toHaveLength(1);
        expect(currentLoyalty(jaceTokens(state)[0])).toBe(1);
        expect(currentLoyalty(mindSculptor)).toBe(3);
    });

    it("an opponent's Jace token is not yours: you create your own", () => {
        const state = board();
        empower(state, 1);
        const mine = jaceTokens(state)[0];
        // Hand the token to p2.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== mine.id
        );
        state.players[1].battlefield.push({
            ...mine,
            controllerId: "p2",
            baseControllerId: "p2",
            ownerId: "p2",
        });
        empower(state, 2);
        expect(jaceTokens(state, 0)).toHaveLength(1);
        expect(currentLoyalty(jaceTokens(state, 0)[0])).toBe(2);
        expect(currentLoyalty(jaceTokens(state, 1)[0])).toBe(1);
    });

    it("with 2+ Jace tokens the controller CHOOSES which one is empowered", () => {
        const state = board();
        empower(state, 1);
        const first = jaceTokens(state)[0];
        state.players[0].battlefield.push({
            ...first,
            id: "jace-two",
            counters: { loyalty: 1 },
        });
        withTemporaryDefinition(empowerSpell(4), () => {
            pushSpell(state, ANCESTRAL_RECALL, "p1");
            resolveTopOfStack(state);
            const choice = state.pendingChoices?.[0];
            expect(choice?.kind).toBe("choose-permanents");
            expect(choice?.playerId).toBe("p1");
            submitChoice(state, ["jace-two"]);
        });
        const byId = new Map(jaceTokens(state).map((c) => [c.id, c]));
        expect(byId.size).toBe(2);
        expect(currentLoyalty(byId.get("jace-two")!)).toBe(5);
        expect(currentLoyalty(byId.get(first.id)!)).toBe(1);
    });

    it("the empower script is a valid Effect Script of already-shipped Ops (no new Op)", () => {
        const spell = empowerSpell(3);
        expect(validateEffectScript(spell)).toEqual([]);
        expect(spell.effects.map((o) => o.op)).toEqual(["if", "if"]);
    });
});

describe("the Jace planeswalker token's loyalty abilities (CR 606, CR 701.71a)", () => {
    it("−3: Draw a card — pays the loyalty cost, draws, and the 0-loyalty token dies (CR 606.4, 704.5i)", () => {
        const state = board();
        empower(state, 3);
        const jace = jaceTokens(state)[0];
        const handBefore = state.players[0].hand.length;
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: jace.id,
            abilityId: "jace-token-draw",
        });
        // CR 606.4 — the cost is removing the three loyalty counters.
        expect(currentLoyalty(jaceTokens(state)[0] ?? jace)).toBe(0);
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(handBefore + 1);
        checkStateBasedActions(state);
        // CR 704.5i — a planeswalker with loyalty 0 goes; a token then ceases
        // to exist (CR 704.5d).
        expect(jaceTokens(state)).toHaveLength(0);
    });

    it("CR 606.6 — a −3 ability can't be activated with fewer than 3 loyalty", () => {
        const state = board();
        empower(state, 2);
        const jace = jaceTokens(state)[0];
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: jace.id,
                abilityId: "jace-token-draw",
            })
        ).toThrow("Not enough loyalty to activate this ability");
    });

    it("CR 606.3 — only one loyalty ability of the token per turn", () => {
        const state = board();
        empower(state, 5);
        const jace = jaceTokens(state)[0];
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: jace.id,
            abilityId: "jace-token-surveil",
        });
        expect(currentLoyalty(jaceTokens(state)[0])).toBe(4);
        // Empty the stack (the ability is not under test here), then try again.
        state.stack = [];
        state.priorityPlayerId = "p1";
        refreshExpectedInput(state);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: jace.id,
                abilityId: "jace-token-surveil",
            })
        ).toThrow(
            "A loyalty ability of this permanent has already been activated this turn"
        );
    });
});

describe("wire format — the Jace token on the projected board", () => {
    it("projectPublicState carries the token's loyalty, type line and loyalty abilities", () => {
        const state = board();
        empower(state, 2);
        const jace = jaceTokens(state)[0];
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === jace.id
        )!;
        expect(slim).toBeDefined();
        expect(slim.types).toEqual(["Planeswalker"]);
        expect(slim.subtypes).toEqual(["Jace"]);
        expect(currentLoyalty(slim)).toBe(2);
        // The client hydrates the token's abilities from its content-derived
        // definition id — the same synthesized definition the engine reads.
        const def = tryGetDefinition(slim.card.id);
        expect(def?.name).toBe(JACE_PLANESWALKER_TOKEN.name);
        expect(def?.imagePrintId).toBe(JACE_PLANESWALKER_TOKEN.imagePrintId);
        expect(
            def?.activatedAbilities?.map((a) => [a.id, a.cost.loyalty])
        ).toEqual([
            ["jace-token-surveil", -1],
            ["jace-token-draw", -3],
        ]);
    });

    it("a client that never saw the token decodes its loyalty abilities from the id alone", () => {
        // A fresh image id makes an id no `createToken` ever registered: the
        // client bundle's cold path (`maybeSynthesizeToken`).
        const coldId = tokenDefinitionId({
            ...(JACE_PLANESWALKER_TOKEN as TokenSpec),
            imagePrintId: "00000000-0000-0000-0000-000000007198",
        });
        const def = tryGetDefinition(coldId);
        expect(def?.types).toEqual(["Planeswalker"]);
        expect(def?.subtypes).toEqual(["Jace"]);
        expect(def?.manaCost).toMatchObject({ U: expect.any(Number) });
        expect(
            def?.activatedAbilities?.map((a) => [
                a.id,
                a.cost.loyalty,
                a.useStack,
            ])
        ).toEqual([
            ["jace-token-surveil", -1, true],
            ["jace-token-draw", -3, true],
        ]);
    });
});
