// SNC (Streets of New Capenna) — blue. Ledger Shredder (issue #1343): the
// card whose trigger condition needed the new PER-PLAYER spell-cast counter
// (`PlayerState.spellsCastThisTurn` / `SpellCastEvent.casterSpellCountThisTurn`,
// gre/state.ts) and the new `picksMatchFilter` `if` predicate (connive's
// "if you discarded a nonland card" gate). The counter/condition plumbing has
// its own dedicated test suites — `gre/__tests__/spellCastPerPlayerCount.test.ts`
// (the counter) and `cards/abilities/triggers/__tests__/spellCastTrigger.test.ts`
// (the reusable `nthSpellThisTurn` condition) and
// `gre/effects/__tests__/interpreter.test.ts` (the `picksMatchFilter`
// predicate's own permanent test) — this file locks the CARD wiring: the real
// production `ledgerShredder.triggeredAbilities[0]` fires on exactly the
// caster's second spell (not the first, not a different player's first) and
// resolves connive end-to-end.

import { describe, it, expect } from "vitest";
import { ledgerShredder } from "../blue";
import { grizzlyBears } from "../../lea/green";
import { island } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import type { CardType } from "../../../types";

describe("Ledger Shredder (CR 701.50 connive, CR 601.2i, issue #1343)", () => {
    const trig = ledgerShredder.triggeredAbilities?.[0];

    it("ships flying and a single connive trigger", () => {
        expect(ledgerShredder.staticAbilities).toContain("flying");
        expect(trig).toBeDefined();
        expect(trig!.effects).toBeDefined();
        expect(trig!.resolve).toBeUndefined();
    });

    // Per-player-vs-global distinction (the exact gap issue #1343 closes):
    // P1's 1st spell + P2's 1st spell (2 spells total, table-wide) must NOT
    // fire — each caster is still on their own first spell. Only a caster's
    // OWN second spell fires, regardless of who controls Ledger Shredder
    // (scope: "any" — CR 701.50a "a player", not "you").
    it("fires on exactly a caster's SECOND spell this turn, never the table-wide 2nd spell", () => {
        const self = {
            id: "ls1",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"] as CardType[],
            subtypes: ["Bird", "Advisor"],
            isTapped: false,
            card: {},
        };
        const baseEvent = {
            type: "SPELL_CAST" as const,
            spellInstanceId: "x",
            spellCardId: "y",
            spellTypes: ["Instant"] as CardType[],
            spellSubtypes: [],
            spellColors: [],
        };
        // P1's 1st spell (casterSpellCountThisTurn 0) — no fire.
        expect(
            trig!.matches(
                { ...baseEvent, casterId: "p1", casterSpellCountThisTurn: 0 },
                self
            )
        ).toBe(false);
        // P2's 1st spell right after — table-wide this is spell #2, but P2's
        // OWN first — still no fire.
        expect(
            trig!.matches(
                { ...baseEvent, casterId: "p2", casterSpellCountThisTurn: 0 },
                self
            )
        ).toBe(false);
        // P1's 2nd spell — fires (Ledger Shredder's own controller).
        expect(
            trig!.matches(
                { ...baseEvent, casterId: "p1", casterSpellCountThisTurn: 1 },
                self
            )
        ).toBe(true);
        // P2's 2nd spell — ALSO fires (scope: "any" — any player's 2nd spell,
        // not just the controller's).
        expect(
            trig!.matches(
                { ...baseEvent, casterId: "p2", casterSpellCountThisTurn: 1 },
                self
            )
        ).toBe(true);
    });

    it("connives: draws, discards a nonland card, and puts a +1/+1 counter on itself — wire format", () => {
        const shredder = makeInstance(ledgerShredder.id, {
            id: "ls1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = [
            makeInstance(grizzlyBears.id, {
                id: "h1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ];
        const lib = [
            makeInstance(grizzlyBears.id, {
                id: "lib0",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [shredder],
                    hand,
                    library: lib,
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...shredder,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: trig!.id,
            triggerSourceId: "ls1",
            triggerEvent: {
                type: "SPELL_CAST",
                casterId: "p2",
                spellInstanceId: "s",
                spellCardId: "c",
                spellTypes: ["Instant"] as CardType[],
                spellSubtypes: [],
                spellColors: [],
                casterSpellCountThisTurn: 1,
            },
            targets: undefined,
        });
        // Draw resolves immediately, then suspends on the discard choice.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1"],
        });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "ls1"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("h1");
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib0"]);

        // Wire — the counter and hand/graveyard contents are board-visible.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ls1"
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(1);
        expect(projected.players[0].graveyard.map((c) => c.id)).toContain(
            "h1"
        );
        expect(projected.players[0].hand.map((c) => c?.id)).toEqual([
            "lib0",
        ]);
    });

    it("discarding a LAND card connives WITHOUT a +1/+1 counter (CR 701.50a)", () => {
        const shredder = makeInstance(ledgerShredder.id, {
            id: "ls2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = [
            makeInstance(island.id, {
                id: "h2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ];
        const lib = [
            makeInstance(grizzlyBears.id, {
                id: "lib1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [shredder],
                    hand,
                    library: lib,
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...shredder,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: trig!.id,
            triggerSourceId: "ls2",
            triggerEvent: {
                type: "SPELL_CAST",
                casterId: "p1",
                spellInstanceId: "s",
                spellCardId: "c",
                spellTypes: ["Instant"] as CardType[],
                spellSubtypes: [],
                spellColors: [],
                casterSpellCountThisTurn: 1,
            },
            targets: undefined,
        });
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h2"],
        });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "ls2"
        )!;
        expect(after.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("h2");
    });
});
