// Per-player spell-cast-this-turn counter (CR 601.2i, issue #1343) —
// mechanism tests. Distinct from Storm's GLOBAL `GameState.spellsCastThisTurn`
// tally (ADR 0052, `storm.test.ts`): `PlayerState.spellsCastThisTurn` +
// `SpellCastEvent.casterSpellCountThisTurn` are scoped to the CASTER, so a
// per-player "Nth spell" trigger condition (connive, Ledger Shredder) can
// distinguish "P1's 1st + P2's 1st spell = 2 total" from "P1's 2nd spell" —
// the exact rules violation the global counter would commit if reused
// directly. `nthSpellThisTurn` (the reusable `spellCastTrigger.condition`
// built on this field) has its own unit tests in
// `cards/abilities/triggers/__tests__/spellCastTrigger.test.ts`; this file
// tests the underlying counter/event plumbing in `gre/state.ts`.

import { describe, it, expect } from "vitest";
import { makeState, pushSpell } from "../../cards/__tests__/setup";
import { emitSpellCastEvent } from "../state";
import { advancePhase } from "../phases";
import { compactState, expandState } from "../serialize";
import { lightningBolt } from "../../cards/sets/lea";

describe("Per-player spell-cast counter (CR 601.2i, issue #1343)", () => {
    it("increments per-caster and carries casterSpellCountThisTurn (the caster's own prior count) on SPELL_CAST", () => {
        const state = makeState();
        const bolt1 = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt1);
        expect(state.players[0].spellsCastThisTurn).toBe(1);
        const events1 = state.pendingEvents ?? [];
        const casts1 = events1.filter((e) => e.type === "SPELL_CAST");
        expect(casts1[casts1.length - 1]).toMatchObject({
            type: "SPELL_CAST",
            casterId: "p1",
            casterSpellCountThisTurn: 0,
        });

        const bolt2 = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt2);
        expect(state.players[0].spellsCastThisTurn).toBe(2);
        const events2 = state.pendingEvents ?? [];
        const casts2 = events2.filter((e) => e.type === "SPELL_CAST");
        expect(casts2[casts2.length - 1]).toMatchObject({
            type: "SPELL_CAST",
            casterId: "p1",
            casterSpellCountThisTurn: 1,
        });
    });

    it("is scoped PER PLAYER — P1's 1st + P2's 1st spell must NOT read as anyone's 2nd", () => {
        const state = makeState();
        const p1Bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, p1Bolt);
        const p2Bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        emitSpellCastEvent(state, p2Bolt);

        // The GLOBAL Storm counter sees 2 spells cast this turn...
        expect(state.spellsCastThisTurn).toBe(2);
        // ...but PER PLAYER, each caster is still on their FIRST spell.
        expect(state.players[0].spellsCastThisTurn).toBe(1);
        expect(state.players[1].spellsCastThisTurn).toBe(1);

        const events = (state.pendingEvents ?? []).filter(
            (e) => e.type === "SPELL_CAST"
        );
        const p2Event = events[events.length - 1];
        // P2's cast is the SECOND spell of the turn globally (priorSpellCount
        // = 1) but P2's OWN first spell (casterSpellCountThisTurn = 0) — the
        // exact distinction a per-player "second spell" trigger needs.
        expect(p2Event).toMatchObject({
            priorSpellCount: 1,
            casterSpellCountThisTurn: 0,
        });

        // Now P1 casts a SECOND spell — this is the caster's own 2nd spell.
        const p1Bolt2 = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, p1Bolt2);
        const events2 = (state.pendingEvents ?? []).filter(
            (e) => e.type === "SPELL_CAST"
        );
        expect(events2[events2.length - 1]).toMatchObject({
            casterId: "p1",
            casterSpellCountThisTurn: 1,
        });
        expect(state.players[0].spellsCastThisTurn).toBe(2);
    });

    it("resets at the start of each turn, per player (mirrors landsPlayedThisTurn's reset boundary)", () => {
        const state = makeState({ phase: "END_STEP", turn: 1 });
        state.players[0].spellsCastThisTurn = 2;
        state.players[1].spellsCastThisTurn = 1;
        advancePhase(state); // END_STEP -> CLEANUP (auto) -> UNTAP (auto, new turn) -> UPKEEP
        expect(state.turn).toBe(2);
        expect(state.players[0].spellsCastThisTurn).toBe(0);
        expect(state.players[1].spellsCastThisTurn).toBe(0);
    });

    it("round-trips through the DB compact/expand form (serialize.ts)", () => {
        const state = makeState();
        state.players[0].spellsCastThisTurn = 3;
        const round = expandState(compactState(state));
        expect(round.players[0].spellsCastThisTurn).toBe(3);
        // Falsy (0/undefined) is omitted from the compact form — mirrors
        // `landsPlayedThisTurn`'s own compaction convention.
        expect(round.players[1].spellsCastThisTurn).toBeUndefined();
    });
});
