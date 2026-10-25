// `dealDamageToEach` — the Op's permanent test (CR 120.3 / 109.5).
//
// Driven through the real entry points: the spell is pushed and resolved by
// `resolveTopOfStack`; the single-call assertion builds the real SpellContext
// and runs the script through `runEffectScript`. The wire-format assertion
// reads the result back through `projectPublicState`.

import { describe, expect, it, vi } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { getDefinition } from "../../../cards/index";
import { buildSpellContext, resolveTopOfStack } from "../../state";
import type { GameState } from "../../state";
import { runEffectScript } from "../interpreter";
import { validateEffectScript } from "../validate";
import { projectPublicState } from "../../../gameProjections";

const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

function spellDef(effects: EffectOp[]): CardDefinition {
    return {
        id: "test-deal-damage-to-each",
        name: "Each Probe",
        rarity: "common",
        oracleText: "",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    } as CardDefinition;
}

function bears(id: string, controllerId: string) {
    return makeInstance(grizzlyBears.id, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [bears("mine", "p1")] }),
            makePlayer("p2", {
                battlefield: [bears("theirsA", "p2"), bears("theirsB", "p2")],
            }),
        ],
    });
}

const marked = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)
        ?.damageMarked ?? 0;
const life = (state: GameState, id: string) =>
    state.players.find((p) => p.id === id)!.life;

function resolveWith(effects: EffectOp[], state = board()): GameState {
    const def = spellDef(effects);
    withTemporaryDefinition(def, () => {
        pushSpell(state, def.id, "p1");
        resolveTopOfStack(state);
    });
    return state;
}

describe("dealDamageToEach (CR 120.3 / 109.5)", () => {
    it("scopes both halves to the opponent: their life and their creatures only", () => {
        const state = resolveWith([
            {
                op: "dealDamageToEach",
                amount: 1,
                creatures: { controller: "opponent" },
                players: "opponent",
            },
        ]);
        expect(life(state, "p2")).toBe(19);
        expect(life(state, "p1")).toBe(20);
        expect(marked(state, "theirsA")).toBe(1);
        expect(marked(state, "theirsB")).toBe(1);
        expect(marked(state, "mine")).toBe(0);
    });

    it("scopes to the controller's own side", () => {
        const state = resolveWith([
            {
                op: "dealDamageToEach",
                amount: 2,
                creatures: { controller: "controller" },
                players: "controller",
            },
        ]);
        expect(life(state, "p1")).toBe(18);
        expect(life(state, "p2")).toBe(20);
        expect(marked(state, "mine")).toBe(2);
        expect(marked(state, "theirsA")).toBe(0);
    });

    it("an unscoped creature half and `players: each` keep the both-sides default", () => {
        const state = resolveWith([
            {
                op: "dealDamageToEach",
                amount: 1,
                creatures: {},
                players: "each",
            },
        ]);
        expect(life(state, "p1")).toBe(19);
        expect(life(state, "p2")).toBe(19);
        for (const id of ["mine", "theirsA", "theirsB"]) {
            expect(marked(state, id)).toBe(1);
        }
    });

    it("a creatures-only Op leaves every player's life alone", () => {
        const state = resolveWith([
            {
                op: "dealDamageToEach",
                amount: 1,
                creatures: { controller: "opponent" },
            },
        ]);
        expect(life(state, "p1")).toBe(20);
        expect(life(state, "p2")).toBe(20);
        expect(marked(state, "theirsA")).toBe(1);
    });

    it("deals the whole set through ONE primitive call, in one event batch", () => {
        const state = board();
        const def = spellDef([]);
        withTemporaryDefinition(def, () => {
            const item = pushSpell(state, def.id, "p1");
            const ctx = buildSpellContext(state, item);
            const each = vi.spyOn(ctx, "dealDamageToEach");
            const events = (state.pendingEvents ?? []).length;
            runEffectScript(ctx, [
                {
                    op: "dealDamageToEach",
                    amount: 1,
                    creatures: { controller: "opponent" },
                    players: "opponent",
                },
            ]);
            expect(each).toHaveBeenCalledTimes(1);
            // Two creatures + the player: three damage events, one batch the
            // trigger scan reads together.
            const dealt = (state.pendingEvents ?? [])
                .slice(events)
                .filter((e) => e.type === "DAMAGE_DEALT");
            expect(dealt).toHaveLength(3);
        });
    });

    it("amount 0 is a no-op", () => {
        const state = resolveWith([
            {
                op: "dealDamageToEach",
                amount: 0 as never,
                creatures: {},
                players: "each",
            },
        ]);
        expect(life(state, "p2")).toBe(20);
        expect(marked(state, "theirsA")).toBe(0);
    });

    it("survives the wire: projected damage and life match the fat state", () => {
        const state = resolveWith([
            {
                op: "dealDamageToEach",
                amount: 1,
                creatures: { controller: "opponent" },
                players: "opponent",
            },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        const theirs = projected.players.find((p) => p.id === "p2")!;
        expect(theirs.life).toBe(19);
        expect(
            theirs.battlefield.find((c) => c.id === "theirsA")!.damageMarked
        ).toBe(1);
        const mine = projected.players.find((p) => p.id === "p1")!;
        expect(
            mine.battlefield.find((c) => c.id === "mine")!.damageMarked
        ).toBe(undefined);
    });
});

describe("dealDamageToEach validation", () => {
    const host = (effects: unknown[]) => ({
        id: "test-host",
        name: "Host",
        effects: effects as EffectOp[],
    });

    it("accepts every legal shape", () => {
        expect(
            validateEffectScript(
                host([
                    {
                        op: "dealDamageToEach",
                        amount: 2,
                        creatures: {
                            controller: "opponent",
                            filter: { subtype: "Bear" },
                        },
                        players: "opponent",
                    },
                ]) as never
            )
        ).toEqual([]);
    });

    it("rejects a card-type restriction that the Creature force would erase", () => {
        const errors = validateEffectScript(
            host([
                {
                    op: "dealDamageToEach",
                    amount: 2,
                    creatures: { filter: { type: "Artifact" } },
                },
            ]) as never
        );
        expect(errors).not.toEqual([]);
    });

    it("rejects an Op naming neither half, and an unknown scope", () => {
        const none = validateEffectScript(
            host([{ op: "dealDamageToEach", amount: 1 }]) as never
        );
        expect(none.join("\n")).toMatch(/creatures.*players/);
        const bad = validateEffectScript(
            host([
                { op: "dealDamageToEach", amount: 1, players: "everyone" },
            ]) as never
        );
        expect(bad).not.toEqual([]);
    });
});
