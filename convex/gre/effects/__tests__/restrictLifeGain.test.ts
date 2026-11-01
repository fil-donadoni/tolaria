// `restrictLifeGain` + `dealDamage { bindDamagedPlayer }` — the Op's and the
// field's permanent test (CR 119.7 / 611.2a / 120.3, issue #3239).
//
// Driven through the real entry point: the spell is pushed and resolved by
// `resolveTopOfStack`, and the later life gain runs through the real
// `gainLife` Op, so the lock is read where every gain lands
// (`gainLifeEmitting`). The wire-format assertion reads the lock back through
// `projectPublicState`.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { getDefinition } from "../../../cards/index";
import { resolveTopOfStack } from "../../state";
import type { GameState } from "../../state";
import { compactState, expandState } from "../../serialize";
import { validateEffectScript } from "../validate";
import { projectPublicState } from "../../../gameProjections";
import { playerHasRestriction } from "../../playerRestrictions";

const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const lich = getDefinition("4250caec-0e37-41be-9ec4-8938deb5f0d0");

/** "Deal 3 damage to any target. If a player is dealt damage this way, they
 *  can't gain life for the rest of the game." */
const LOCK_SCRIPT: EffectOp[] = [
    {
        op: "dealDamage",
        amount: 3,
        to: { target: 0 },
        bindDamagedPlayer: "$damaged",
    },
    { op: "restrictLifeGain", player: { ref: "$damaged" } },
];

/** "Target player gains 4 life." */
const GAIN_SCRIPT: EffectOp[] = [
    { op: "gainLife", player: { target: 0 }, amount: 4 },
];

function spellDef(
    id: string,
    effects: EffectOp[],
    type: "any" | "player"
): CardDefinition {
    return {
        id,
        name: id,
        rarity: "common",
        oracleText: "",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        targetRequirement: { type, count: 1 },
        effects,
    } as CardDefinition;
}

const LOCK = spellDef("test-restrict-life-gain", LOCK_SCRIPT, "any");
const GAIN = spellDef("test-gain-life", GAIN_SCRIPT, "player");

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "bear",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

const life = (state: GameState, id: string) =>
    state.players.find((p) => p.id === id)!.life;

/** Casts LOCK at `target`, then GAIN at p2, resolving each. */
function lockThenGain(
    state: GameState,
    target: { type: "player" | "permanent"; id: string }
): void {
    withTemporaryDefinition(LOCK, () =>
        withTemporaryDefinition(GAIN, () => {
            pushSpell(state, LOCK.id, "p1", [target]);
            resolveTopOfStack(state);
            pushSpell(state, GAIN.id, "p1", [{ type: "player", id: "p2" }]);
            resolveTopOfStack(state);
        })
    );
}

describe("restrictLifeGain — can't gain life for the rest of the game (CR 119.7 / 611.2a)", () => {
    it("validates", () => {
        expect(validateEffectScript(LOCK)).toEqual([]);
    });

    it("a player dealt damage this way is locked, and a later gain gives nothing", () => {
        const state = board();
        lockThenGain(state, { type: "player", id: "p2" });
        expect(playerHasRestriction(state, "p2", "cantGainLife")).toBe(true);
        expect(playerHasRestriction(state, "p1", "cantGainLife")).toBe(false);
        // 20 − 3 damage, and the 4-life gain never lands (CR 119.7).
        expect(life(state, "p2")).toBe(17);
        // CR 119.3 — no gain, so "if you gained life this turn" sees none.
        expect(state.lifeGainedThisTurn?.p2 ?? 0).toBe(0);
    });

    it("damage to a creature locks nobody (bindDamagedPlayer stays uncaptured)", () => {
        const state = board();
        lockThenGain(state, { type: "permanent", id: "bear" });
        expect(state.playerRestrictions ?? []).toEqual([]);
        expect(life(state, "p2")).toBe(24);
    });

    it("fully prevented damage was not dealt — no lock (CR 120.3 / 615)", () => {
        const state = board();
        state.playerDamagePrevention = [
            {
                playerId: "p2",
                match: {},
                mode: "all",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        lockThenGain(state, { type: "player", id: "p2" });
        expect(playerHasRestriction(state, "p2", "cantGainLife")).toBe(false);
        expect(life(state, "p2")).toBe(24);
    });

    it("locks the player dealt damage this way, not a reflected-damage bystander (Eye for an Eye)", () => {
        const state = board();
        withTemporaryDefinition(LOCK, () => {
            const spell = pushSpell(state, LOCK.id, "p1", [
                { type: "player", id: "p2" },
            ]);
            // p2's Eye for an Eye names the spell: p2 still takes the 3 and
            // the spell's controller, p1, takes 3 too — both tallies rise.
            state.damageRedirections = [
                {
                    kind: "reflect-to-source-controller",
                    sourceInstanceId: spell.id,
                    playerId: "p2",
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                },
            ];
            resolveTopOfStack(state);
        });
        expect(life(state, "p1")).toBe(17);
        expect(playerHasRestriction(state, "p2", "cantGainLife")).toBe(true);
        expect(playerHasRestriction(state, "p1", "cantGainLife")).toBe(false);
    });

    it("a replacement of the gain does nothing either — Lich draws no card (CR 119.7)", () => {
        const state = board();
        state.players[1]!.battlefield.push(
            makeInstance(lich.id, {
                id: "lich",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        state.players[1]!.library = [
            makeInstance(grizzlyBears.id, {
                id: "lib-1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
        ];
        const handBefore = state.players[1]!.hand.length;
        lockThenGain(state, { type: "player", id: "p2" });
        expect(state.players[1]!.hand.length).toBe(handBefore);
        expect(state.players[1]!.library.map((c) => c.id)).toEqual(["lib-1"]);
    });

    it("survives a save/load round trip and crosses the wire (projectPublicState)", () => {
        const state = board();
        lockThenGain(state, { type: "player", id: "p2" });
        const reloaded = expandState(compactState(state));
        expect(playerHasRestriction(reloaded, "p2", "cantGainLife")).toBe(true);
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            expect(playerHasRestriction(projected, "p2", "cantGainLife")).toBe(
                true
            );
        }
    });
});
