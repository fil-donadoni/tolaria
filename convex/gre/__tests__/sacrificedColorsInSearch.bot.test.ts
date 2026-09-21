// CR 105.2 / 608.2h — the search sandboxes and the cost-sacrificed COLOUR read
// (issue #3806), plus Mind Extraction's Bot reachability.
//
// The colour twin of `castSacrificeSnapshotInSearch.bot.test.ts`. Both search
// sandboxes pay the additional sacrifice through the SAME
// `applyCastSacrificeVictims` authority the mutation path stamps from, so a
// field threaded into `sacrificeSnapshotFromSelection` (`gre/activation.ts`)
// and NOT into that one makes the tree model a different game than the server
// plays: inside the tree Mind Extraction would sacrifice a creature, spend a
// card and discard NOTHING, so the bot could never see the line — and a wholly
// worthless cast still ties `pass` once the rollout washes the material out,
// so it could still pick it.
//
// The three Bot seams for this card (`.claude/rules/gre-development.md`
// § Bot reachability) are exactly what the first test walks: `enumerateMoves`
// offers the cast (with its cost pick riding on the Move), there is no choice
// surface to answer (the discard is filter-driven, no player picks), and the
// `discard` Op's existing valuer sees a real discard rather than a blank.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { cloneGameState } from "../clone";
import { checkStateBasedActions } from "../sba";
import { resolveTopOfStack, type GameState } from "../state";
import { getDefinition } from "../../cards/index";

/** Llanowar Elves — {G}, the green card the discard must take. */
const LLANOWAR_ELVES = getDefinition("d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb").id;

/** Grizzly Bears is {1}{G} — the discard must take the opponent's green card
 *  and leave the black one. */
function board(): GameState {
    const scenario: BladeScenario = {
        label: "sacrificed-colors-search-unit",
        spec: {
            cards: [
                { name: "Mind Extraction", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Llanowar Elves", owner: "opp", zone: "hand" },
                { name: "Dark Ritual", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    };
    return buildBladeState(scenario);
}

/** The enumerated Mind Extraction cast aimed at the OPPONENT. The enumerator
 *  announces its choice of target (CR 601.2c), so the enumerator offers one
 *  cast per legal choice — the bot's own seat included, and
 *  taking the first blind would discard from the bot's own hand and prove
 *  nothing about the colour read. */
function castMove(state: GameState, playerId: string): Move {
    const oppId = state.players.find((p) => p.id !== playerId)!.id;
    const move = enumerateMoves(state, playerId).find(
        (m) =>
            m.kind === "cast-spell" &&
            (m as { targets?: { id?: string }[] }).targets?.[0]?.id === oppId
    );
    if (!move) throw new Error("no Mind Extraction cast was enumerated");
    return move;
}

/** Resolve whatever the sandbox left on the stack, the way the tree does. */
function settle(state: GameState): void {
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 8) {
        resolveTopOfStack(state);
        checkStateBasedActions(state);
    }
}

/** Definition ids in the opponent's graveyard — a `CardInstanceState` carries
 *  no name of its own, so the assertion goes through the id. */
function oppGraveyardDefIds(state: GameState, meId: string): string[] {
    return (
        state.players
            .find((p) => p.id !== meId)
            ?.graveyard.map((c) => (c.card as { id?: string }).id ?? "")
            .sort() ?? []
    );
}

describe("cost-sacrificed colours in the search sandboxes (CR 105.2 / 608.2h, issue #3806)", () => {
    // Bot reachability seam 1: the Bot can PLAY the card at all — one cast is
    // enumerated per legal target choice although the spell owes a mandatory
    // additional sacrifice. `castCostPicks.sacrificeIds` is EMPTY here by
    // design and not a gap: a board with exactly one matching creature is
    // fungible, so the victim is auto-resolved server-side at announcement and
    // the Move carries only the picks the payer must SUBMIT.
    it("enumerateMoves offers the cast at both seats despite the mandatory sacrifice cost", () => {
        const state = board();
        const me = state.players[0].id;
        const casts = enumerateMoves(state, me).filter(
            (m) => m.kind === "cast-spell"
        );
        expect(
            casts
                .map(
                    (m) =>
                        (m as { targets?: { id?: string }[] }).targets?.[0]?.id
                )
                .sort()
        ).toEqual(state.players.map((p) => p.id).sort());
    });

    it("the ISMCTS sandbox stamps the victim's COLOURS onto the stack item", () => {
        const state = board();
        const me = state.players[0].id;
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, me, castMove(state, me));
        const item = probe.stack[probe.stack.length - 1];
        expect(item?.additionalSacrificeSnapshot?.colors).toEqual(["G"]);
    });

    it("the ISMCTS sandbox resolves it into a REAL discard, not a blank", () => {
        const state = board();
        const me = state.players[0].id;
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, me, castMove(state, me));
        settle(probe);
        // The green card goes; the black one stays.
        expect(oppGraveyardDefIds(probe, me)).toEqual([LLANOWAR_ELVES]);
    });

    it("the greedy 1-ply sandbox discards the SAME card — a divergence here is the tree modelling another game", () => {
        const state = board();
        const me = state.players[0].id;
        const after = applyMoveForSearch(state, me, castMove(state, me));
        settle(after);
        expect(oppGraveyardDefIds(after, me)).toEqual([LLANOWAR_ELVES]);
    });
});
