// FIN (Final Fantasy) — multicolor card behavior tests (ADR 0043 colour
// split). Each card's describe block cites the CR section it exercises.
//
// Vivi Ornitier (issue #1179) exercises the NEW non-tap choice-based mana
// activation pathway end-to-end: GRE (`getEffectiveManaChoices` board-
// conditional on her effective power, issue #927), backend integration
// (`resolveNonTapManaChoice` / `assertActivationTimingLegal`, the real
// `convex/game.ts` primitives the `activateManaAbility` mutation calls — no
// convex-test harness in this repo, see `untapRefundsLife.test.ts` for the
// established pattern), and the wire format (counters/power survive
// `projectPublicState`, so the picker's option list matches client-side).

import { describe, it, expect } from "vitest";
import { sinSpirasPunishment, viviOrnitier } from "../multicolor";
import { farrelitePriest } from "../../fem/white";
import { forest } from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import { hillGiant, lightningBolt } from "../../lea/red";
import { demonicTutor } from "../../lea/black";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getEffectiveManaChoices } from "../../../../gre/constants";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import {
    assertActivationTimingLegal,
    resolveNonTapManaChoice,
} from "../../../../game";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import type { GameEvent } from "../../../types";

const VIVI_ID = viviOrnitier.id;
const ABILITY_ID = "vivi-ornitier-mana";

function battlefieldsOf(
    ...players: { id: string; battlefield: readonly CardInstanceState[] }[]
) {
    return players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
}

describe("Vivi Ornitier (CR 605.1a / 605.3c / 602.5b — non-tap choice-based mana ability, issue #1179)", () => {
    it("getManaChoices enumerates every {U}/{R} split summing to her CURRENT effective power (CR 613.4, issue #927)", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const choices = getEffectiveManaChoices(
            vivi,
            "p1",
            battlefieldsOf(...state.players)
        );

        expect(choices).not.toBeNull();
        // X = 2: (U0R2), (U1R1), (U2R0).
        expect(choices).toHaveLength(3);
        expect(choices).toEqual(
            expect.arrayContaining([{ R: 2 }, { U: 1, R: 1 }, { U: 2 }])
        );
    });

    it("at base power 0 (no counters yet), the only legal choice is 0 mana", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const choices = getEffectiveManaChoices(
            vivi,
            "p1",
            battlefieldsOf(...state.players)
        );
        expect(choices).toEqual([{}]);
    });

    it("resolveNonTapManaChoice adds the CHOSEN mana directly to the pool, bypassing any closure (CR 605.1a)", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players[0];

        const choices = getEffectiveManaChoices(
            vivi,
            "p1",
            battlefieldsOf(...state.players)
        )!;
        const allURIndex = choices.findIndex((c) => (c.U ?? 0) === 3 && !c.R);
        expect(allURIndex).toBeGreaterThanOrEqual(0);

        const chosen = resolveNonTapManaChoice(
            state,
            player,
            vivi,
            ABILITY_ID,
            allURIndex
        );

        expect(chosen).toEqual({ U: 3 });
        expect(player.manaPool.U).toBe(3);
        expect(player.manaPool.R).toBe(0);
        // CR 602.5 — the activation count is bumped so a second activation
        // this turn is rejected by `assertActivationTimingLegal`.
        expect(vivi.activationsThisTurn?.[ABILITY_ID]).toBe(1);
    });

    it("returns null (no choice-based non-tap mana ability) for a fixed-output source like Farrelite Priest, so the caller falls back to its resolve()", () => {
        const priest = makeInstance(farrelitePriest.id, {
            id: "priest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", { battlefield: [priest] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const result = resolveNonTapManaChoice(
            state,
            state.players[0],
            priest,
            "farrelite-priest-mana",
            undefined
        );
        expect(result).toBeNull();
    });

    it("throws when a choice exists but no manaChoiceIndex was submitted", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(() =>
            resolveNonTapManaChoice(
                state,
                state.players[0],
                vivi,
                ABILITY_ID,
                undefined
            )
        ).toThrow(/choose a mana color/i);
    });

    it("throws on an out-of-range manaChoiceIndex", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        expect(() =>
            resolveNonTapManaChoice(
                state,
                state.players[0],
                vivi,
                ABILITY_ID,
                99
            )
        ).toThrow(/invalid mana choice/i);
    });

    it("CR 602.5b — assertActivationTimingLegal rejects a second activation this turn (once-per-turn) and off-controller-turn activation", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
        });
        const ability = viviOrnitier.activatedAbilities!.find(
            (a) => a.id === ABILITY_ID
        )!;

        // Legal the first time.
        expect(() =>
            assertActivationTimingLegal(state, vivi, ability)
        ).not.toThrow();

        resolveNonTapManaChoice(state, state.players[0], vivi, ABILITY_ID, 0);

        // Once-per-turn — a second activation this turn is illegal.
        expect(() => assertActivationTimingLegal(state, vivi, ability)).toThrow(
            /once each turn/i
        );

        // Controller-turn-only — illegal on the opponent's turn even with a
        // fresh activation count.
        vivi.activationsThisTurn = {};
        state.activePlayerId = "p2";
        expect(() => assertActivationTimingLegal(state, vivi, ability)).toThrow(
            /your turn/i
        );
    });

    it("wire format: counters (and so the effective-power-driven choice list) survive projectPublicState (CR 613.4)", () => {
        const vivi = makeInstance(VIVI_ID, {
            id: "vivi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const p1 = makePlayer("p1", { battlefield: [vivi] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const fatChoices = getEffectiveManaChoices(
            vivi,
            "p1",
            battlefieldsOf(...state.players)
        );

        const projected = projectPublicState(state, 1, "p1");
        const slimVivi = projected.players[0].battlefield.find(
            (c) => c.id === vivi.id
        )!;
        expect(slimVivi.counters).toEqual({ "+1/+1": 2 });

        const projectedBattlefields = projected.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield as unknown as CardInstanceState[],
        }));
        const slimChoices = getEffectiveManaChoices(
            slimVivi as unknown as CardInstanceState,
            "p1",
            projectedBattlefields
        );

        expect(slimChoices).toEqual(fatChoices);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sin, Spira's Punishment (issue #2382)
// ─────────────────────────────────────────────────────────────────────────────

const SIN_TRIGGER_ID = "sin-spira-exile-copy-loop";

function sinBoard(graveyard: CardInstanceState[]) {
    const sin = makeInstance(sinSpirasPunishment.id, {
        id: "sin",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [sin], graveyard }),
            makePlayer("p2"),
        ],
    });
    return { state, sin };
}

/** Fires Sin's ability through the REAL trigger path (`collectTriggers` →
 *  stack → `resolveTopOfStack`), never by calling the closure directly, so the
 *  `matches` discriminator is exercised alongside the resolution body. */
function fireSin(state: GameState, event: GameEvent): StackItem[] {
    const triggers = collectTriggers(state, [event]);
    state.stack.push(...triggers);
    while (state.stack.length > 0) resolveTopOfStack(state);
    return triggers;
}

const enteredSin = (): GameEvent => ({
    type: "PERMANENT_ENTERED",
    instanceId: "sin",
    controllerId: "p1",
    cardId: sinSpirasPunishment.id,
    types: ["Creature"],
});

const attackedWithSin = (): GameEvent => ({
    type: "ATTACKERS_DECLARED",
    attackingPlayerId: "p1",
    attackerIds: ["sin"],
});

/** The permanents Sin's resolution added — everything on the battlefield that
 *  is not Sin herself. */
function tokensOn(state: GameState): CardInstanceState[] {
    return state.players[0].battlefield.filter((c) => c.id !== "sin");
}

describe("Sin, Spira's Punishment (CR 603.2 multi-event trigger / CR 701.13a exile at random / CR 707.2 token copy)", () => {
    // CR 603.2 — ONE Oracle line spanning PERMANENT_ENTERED and
    // ATTACKERS_DECLARED is ONE ability with an array `event`. Both firings go
    // through the SAME ability id, which is what keeps a single row on the
    // stack (a second ability would render twice).
    it("fires on Sin ENTERING and creates a tapped token copy of the exiled card", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const { state } = sinBoard([bear]);

        const triggers = fireSin(state, enteredSin());
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggeredAbilityId).toBe(SIN_TRIGGER_ID);

        const p1 = state.players[0];
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile.map((c) => c.id)).toEqual(["gy-bear"]);

        const tokens = tokensOn(state);
        expect(tokens).toHaveLength(1);
        // CR 707.2 — copiable values are the PRINTED values of the card, so a
        // card that was never a battlefield permanent copies exactly.
        expect(tokens[0].card.id).toBe(grizzlyBears.id);
        expect(tokens[0].power).toBe(2);
        expect(tokens[0].toughness).toBe(2);
        expect(tokens[0].types).toContain("Creature");
        // CR 701.7a — "create a TAPPED token".
        expect(tokens[0].isTapped).toBe(true);
        expect(tokens[0].isToken).toBe(true);
    });

    it("fires on Sin ATTACKING, through the same single ability (CR 603.2)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const { state } = sinBoard([bear]);

        const triggers = fireSin(state, attackedWithSin());
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggeredAbilityId).toBe(SIN_TRIGGER_ID);
        expect(tokensOn(state)).toHaveLength(1);
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["gy-bear"]);
    });

    it("does not fire when SOMETHING ELSE enters or attacks", () => {
        const { state } = sinBoard([]);
        expect(
            collectTriggers(state, [
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "someone-else",
                    controllerId: "p1",
                    cardId: grizzlyBears.id,
                    types: ["Creature"],
                },
            ])
        ).toHaveLength(0);
        expect(
            collectTriggers(state, [
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds: ["someone-else"],
                },
            ])
        ).toHaveLength(0);
    });

    // Termination case 1 — an EMPTY graveyard. The pick returns undefined on
    // the first pass; CR 608.2b, the effect simply does as much as it can.
    it("stops on an EMPTY graveyard — no token, no crash", () => {
        const { state } = sinBoard([]);
        fireSin(state, enteredSin());
        expect(tokensOn(state)).toHaveLength(0);
        expect(state.players[0].exile).toHaveLength(0);
    });

    // Termination case 2 — a graveyard holding NO permanent card at all.
    // CR 110.4a: instants and sorceries are not permanent cards, so the
    // eligible pool is empty even though the graveyard is not.
    it("never picks an instant or a sorcery — a graveyard of spells stops it immediately (CR 110.4a)", () => {
        const bolt = makeInstance(lightningBolt.id, {
            id: "gy-bolt",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const tutor = makeInstance(demonicTutor.id, {
            id: "gy-tutor",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const { state } = sinBoard([bolt, tutor]);

        fireSin(state, enteredSin());

        expect(tokensOn(state)).toHaveLength(0);
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "gy-bolt",
            "gy-tutor",
        ]);
    });

    it("picks the only PERMANENT card even when instants outnumber it", () => {
        const cards = [
            makeInstance(lightningBolt.id, {
                id: "gy-bolt",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
            makeInstance(demonicTutor.id, {
                id: "gy-tutor",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
            makeInstance(hillGiant.id, {
                id: "gy-giant",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
        ];
        const { state } = sinBoard(cards);

        fireSin(state, enteredSin());

        expect(state.players[0].exile.map((c) => c.id)).toEqual(["gy-giant"]);
        const tokens = tokensOn(state);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].power).toBe(3);
        expect(tokens[0].toughness).toBe(3);
    });

    // Termination case 3 — the loop actually REPEATS. Three lands and nothing
    // else: every pick is a land, so the process repeats until the eligible
    // pool is empty. Independent of the PRNG draw order.
    it("repeats while the exiled card is a LAND — three lands make three tapped Land tokens", () => {
        const lands = ["gy-forest-1", "gy-forest-2", "gy-forest-3"].map((id) =>
            makeInstance(forest.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        const { state } = sinBoard(lands);

        fireSin(state, enteredSin());

        const p1 = state.players[0];
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile.map((c) => c.id).sort()).toEqual([
            "gy-forest-1",
            "gy-forest-2",
            "gy-forest-3",
        ]);
        const tokens = tokensOn(state);
        expect(tokens).toHaveLength(3);
        for (const t of tokens) {
            expect(t.types).toEqual(["Land"]);
            expect(t.isTapped).toBe(true);
            expect(t.card.id).toBe(forest.id);
        }
    });

    // The mixed graveyard: the loop must stop the moment a NON-land is exiled.
    // Asserted as an order invariant so it holds for every PRNG draw order —
    // every exiled card except the last is a Land, and a Land last means the
    // pool ran dry rather than the loop continuing.
    it("stops as soon as a NON-land is exiled (mixed graveyard, any draw order)", () => {
        const cards = [
            makeInstance(forest.id, {
                id: "gy-forest-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
            makeInstance(forest.id, {
                id: "gy-forest-2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
            makeInstance(grizzlyBears.id, {
                id: "gy-bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
        ];
        const { state } = sinBoard(cards);

        fireSin(state, enteredSin());

        const p1 = state.players[0];
        const exiled = p1.exile;
        expect(exiled.length).toBeGreaterThanOrEqual(1);
        // One token per exiled card, always.
        expect(tokensOn(state)).toHaveLength(exiled.length);
        for (const c of exiled.slice(0, -1)) {
            expect(c.card.id).toBe(forest.id);
        }
        const last = exiled[exiled.length - 1];
        if (last.card.id === forest.id) {
            // Only a dry pool can end a run of lands.
            expect(p1.graveyard).toHaveLength(0);
        } else {
            expect(last.card.id).toBe(grizzlyBears.id);
        }
    });

    it("only ever reads the CONTROLLER's graveyard (CR 404.2 — 'your graveyard')", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "gy-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const theirs = makeInstance(hillGiant.id, {
            id: "gy-giant-p2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const sin = makeInstance(sinSpirasPunishment.id, {
            id: "sin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sin], graveyard: [mine] }),
                makePlayer("p2", { graveyard: [theirs] }),
            ],
        });

        fireSin(state, enteredSin());

        expect(state.players[0].exile.map((c) => c.id)).toEqual(["gy-bear"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "gy-giant-p2",
        ]);
        expect(state.players[1].exile).toHaveLength(0);
    });

    // Wire format (mandatory for a visible effect): `projectPublicState` strips
    // `card` to `{ id }` and reshapes zones — re-assert the token's visible
    // fields AFTER projection, which is all the client ever sees.
    it("the tapped token copy survives projectPublicState with its copied body", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const { state } = sinBoard([bear]);
        fireSin(state, enteredSin());

        const tokenId = tokensOn(state)[0].id;
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === tokenId
        )!;
        expect(slim).toBeDefined();
        expect(slim.card.id).toBe(grizzlyBears.id);
        expect(slim.power).toBe(2);
        expect(slim.toughness).toBe(2);
        expect(slim.isTapped).toBe(true);
        expect(slim.isToken).toBe(true);
        // The exiled card is public (CR 400.2) and reaches the client.
        expect(projected.players[0].exile.map((c) => c.id)).toEqual([
            "gy-bear",
        ]);
    });
});
