// Per-card-type spell-cast-this-turn tally (CR 601.2i, CR 205.2b) —
// `PlayerState.spellTypesCastThisTurn` + `SpellCastEvent.
// casterSpellTypeCountsThisTurn`, written at the cast choke point
// (`emitSpellCastEvent`), and `nthSpellOfTypeThisTurn`, the reusable
// `spellCastTrigger` condition reading it. The per-player total it splits has
// its own suite (`spellCastPerPlayerCount.test.ts`).

import { describe, it, expect } from "vitest";
import { makeState, pushSpell } from "../../cards/__tests__/setup.helper";
import { emitSpellCastEvent } from "../state";
import { advancePhase } from "../phases";
import { compactState, expandState } from "../serialize";
import { nthSpellOfTypeThisTurn } from "../../cards/abilities/triggers/spellCastTrigger";
import type { GameState } from "../state";
import type { SpellCastEvent } from "../../cards/types";

const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Creature
const LIGHTNING_BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Instant
const ORNITHOPTER = "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0"; // Artifact Creature

function cast(state: GameState, cardId: string, casterId = "p1") {
    const item = pushSpell(state, cardId, casterId);
    emitSpellCastEvent(state, item);
    const casts = (state.pendingEvents ?? []).filter(
        (e): e is SpellCastEvent => e.type === "SPELL_CAST"
    );
    return casts[casts.length - 1];
}

describe("per-type spell-cast tally (CR 601.2i, CR 205.2b)", () => {
    it("counts a spell once under each of its types and snapshots the prior tally on SPELL_CAST", () => {
        const state = makeState();
        const first = cast(state, GRIZZLY_BEARS);
        expect(first.casterSpellTypeCountsThisTurn).toEqual({});
        const second = cast(state, ORNITHOPTER);
        expect(second.casterSpellTypeCountsThisTurn).toEqual({ Creature: 1 });
        const third = cast(state, LIGHTNING_BOLT);
        expect(third.casterSpellTypeCountsThisTurn).toEqual({
            Creature: 2,
            Artifact: 1,
        });
        expect(state.players[0].spellTypesCastThisTurn).toEqual({
            Creature: 2,
            Artifact: 1,
            Instant: 1,
        });
        expect(state.players[0].spellsCastThisTurn).toBe(3);
    });

    it("is scoped to the caster — the opponent's creature spell does not advance yours", () => {
        const state = makeState();
        cast(state, GRIZZLY_BEARS, "p2");
        const mine = cast(state, GRIZZLY_BEARS, "p1");
        expect(mine.casterSpellTypeCountsThisTurn).toEqual({});
        expect(state.players[1].spellTypesCastThisTurn).toEqual({
            Creature: 1,
        });
    });

    it("resets at the start of each turn", () => {
        const state = makeState({ phase: "END_STEP", turn: 1 });
        state.players[0].spellTypesCastThisTurn = { Creature: 2 };
        state.players[1].spellTypesCastThisTurn = { Instant: 1 };
        advancePhase(state);
        expect(state.turn).toBe(2);
        expect(state.players[0].spellTypesCastThisTurn).toBeUndefined();
        expect(state.players[1].spellTypesCastThisTurn).toBeUndefined();
    });

    it("round-trips through the DB compact/expand form (serialize.ts)", () => {
        const state = makeState();
        state.players[0].spellTypesCastThisTurn = { Creature: 2, Instant: 1 };
        state.players[1].spellTypesCastThisTurn = {};
        const round = expandState(compactState(state));
        expect(round.players[0].spellTypesCastThisTurn).toEqual({
            Creature: 2,
            Instant: 1,
        });
        expect(round.players[1].spellTypesCastThisTurn).toBeUndefined();
    });
});

describe("nthSpellOfTypeThisTurn (CR 601.2i, CR 603.4)", () => {
    const self = {
        id: "src",
        controllerId: "p1",
        ownerId: "p1",
        types: [],
        subtypes: [],
        isTapped: false,
        card: {},
    };

    it("second creature spell: the first does not match, a noncreature spell in between does not advance it, the second does", () => {
        const second = nthSpellOfTypeThisTurn(2, { types: "Creature" });
        const state = makeState();
        expect(second(cast(state, GRIZZLY_BEARS), self)).toBe(false);
        expect(second(cast(state, LIGHTNING_BOLT), self)).toBe(false);
        expect(second(cast(state, ORNITHOPTER), self)).toBe(true);
        expect(second(cast(state, GRIZZLY_BEARS), self)).toBe(false);
    });

    it("fourth noncreature spell: counts the caster's total minus its creature spells", () => {
        const fourth = nthSpellOfTypeThisTurn(4, { excludeTypes: "Creature" });
        const state = makeState();
        const verdicts = [
            LIGHTNING_BOLT,
            GRIZZLY_BEARS,
            LIGHTNING_BOLT,
            LIGHTNING_BOLT,
            ORNITHOPTER,
            LIGHTNING_BOLT,
            LIGHTNING_BOLT,
        ].map((id) => fourth(cast(state, id), self));
        expect(verdicts).toEqual([
            false,
            false,
            false,
            false,
            false,
            true,
            false,
        ]);
    });
});
