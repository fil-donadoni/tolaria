/**
 * The rollout's random draw never aims an announcement wholly at the wrong
 * side while a variant of it aimed otherwise is in the same pool
 * (`withoutMisdirectedVariants` in `rollout`, `search.ts`; issue #10376). The
 * draw lands only in the lines that still hold the card, so it skewed "hold"
 * against "cast". CR 601.2c (a target is chosen among the legal ones): with
 * the aimed variant illegal the misdirected one is the spell's only form, and
 * stays drawable.
 *
 * Read off the stack as each playout resolves it, on the playout's own state:
 * a creature in the graveyard would also count the ones that died in combat.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as resolution from "../state";
import { applyMoveInSearch, rollout } from "../search";
import { cloneGameState } from "../clone";
import { makeRng } from "../rng";
import type { GameState } from "../state";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { buildBladeState, findBladeScenario } from "../ai/blade";
import { instanceIdsForName, seatPlayerId } from "../ai/blade/matcher";

const ANCHOR =
    "delirium: Unholy Heat never aims at toughness 3 or more with delirium off";
const SPELL = "Unholy Heat";
const OWN = "Mons's Goblin Raiders";
const OPPOSING = "Serra Angel";
const PLAYOUTS = 60;

/** The anchor's position with its opposing creature replaced. */
function position(opposing: string): GameState {
    const entry = findBladeScenario(ANCHOR);
    if (!entry) throw new Error(`no blade entry "${ANCHOR}"`);
    return buildBladeState({
        ...entry,
        spec: {
            ...entry.spec,
            cards: entry.spec.cards.map((c) =>
                c.name === OPPOSING ? { ...c, name: opposing } : c
            ),
        },
    });
}

/** How many of `PLAYOUTS` seeded playouts from the root `pass` child resolve
 *  the spell at each creature. */
function aimedAt(state: GameState, opposing: string) {
    const me = seatPlayerId(state, "me");
    const [spell] = instanceIdsForName(state, SPELL);
    const [own] = instanceIdsForName(state, OWN);
    const [theirs] = instanceIdsForName(state, opposing);
    const counts = { own: 0, theirs: 0 };
    let world: GameState | null = null;
    const original = resolution.resolveTopOfStack;
    vi.spyOn(resolution, "resolveTopOfStack").mockImplementation(
        (s, ...rest) => {
            const top = s.stack[s.stack.length - 1];
            if (s === world && top?.id === spell) {
                const target = top.targets?.[0]?.id;
                if (target === own) counts.own++;
                if (target === theirs) counts.theirs++;
            }
            return original(s, ...rest);
        }
    );
    for (let seed = 0; seed < PLAYOUTS; seed++) {
        world = cloneGameState(state);
        applyMoveInSearch(world, me, { kind: "pass" });
        rollout(world, me, makeRng(seed), DEFAULT_EVAL_WEIGHTS);
    }
    return counts;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the rollout's random draw and misdirected variants (CR 601.2c)", () => {
    it("never casts the spell at the mover's own creature while the opposing one is a legal target", () => {
        const counts = aimedAt(position(OPPOSING), OPPOSING);
        expect(counts.own).toBe(0);
        // The playouts do draw the spell: the zero above is an aim, not a hold.
        expect(counts.theirs).toBeGreaterThan(0);
    });

    it("still draws the misdirected variant when it is the spell's only form", () => {
        // Shroud (CR 702.18a): the opposing creature is no legal target.
        const counts = aimedAt(position("Blastoderm"), "Blastoderm");
        expect(counts.theirs).toBe(0);
        expect(counts.own).toBeGreaterThan(0);
    });
});
