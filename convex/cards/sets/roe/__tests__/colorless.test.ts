// ROE — colorless card behavior tests (ADR 0043 colour split).
//
// Emrakul, the Aeons Torn (issue #2319, PRD #1301 slice S3). Most of the card
// rides already-exercised Ops and is covered catalogue-wide by the
// `validateEffectScript` sweep plus the generated canned-scenario smoke test,
// so it needs no hand-written coverage here. The FROM-ANYWHERE GRAVEYARD
// TRIGGER is the exception the issue calls out: it composes a shape no shipped
// card uses — a WHOLE-GRAVEYARD sweep off an array `event`, addressed to the
// card's OWNER rather than its controller — so it earns a card-level test.

import { describe, it, expect } from "vitest";
import { emrakulTheAeonsTorn } from "../colorless";
import { grizzlyBears } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    emitSpellCastEvent,
    removePermanentTo,
    discardToGraveyard,
    emitCardMilled,
    processPendingActionTriggers,
    resolveTopOfStack,
    moveCard,
    getPlayer,
} from "../../../../gre/state";
import { pushSpell } from "../../../__tests__/setup";
import { annihilatorTriggerId } from "../../../abilities/annihilator";
import { getDefinition } from "../../..";

/** Drains the stack, resolving every pending item (including a `trigger-order`
 *  PendingChoice, CR 603.3b / ADR 0058). */
function drainStack(state: ReturnType<typeof makeState>): void {
    let guard = 0;
    while (
        (state.stack.length > 0 || state.pendingChoices?.length) &&
        guard++ < 10
    ) {
        if (state.pendingChoices?.[0]?.kind === "trigger-order") {
            resolveTriggerOrder(state);
            continue;
        }
        if (state.stack.length === 0) break;
        resolveTopOfStack(state);
    }
}

describe("Emrakul, the Aeons Torn — definition (CR 702.9 / 702.16a / 702.86)", () => {
    it("annihilator 6's enforcing attack trigger is injected by the getDefinition seam, not written on the card", () => {
        // The card file declares only the keyword STRING; `expandAnnihilator`
        // (CR 702.86a) adds the trigger at the registry seam (#2295). Reading
        // the raw module export must NOT show it — reading through
        // `getDefinition` must.
        const rawTriggerIds = (
            emrakulTheAeonsTorn.triggeredAbilities ?? []
        ).map((a) => a.id);
        expect(rawTriggerIds).not.toContain(annihilatorTriggerId(6));

        const expanded = getDefinition(emrakulTheAeonsTorn.id);
        const expandedIds = (expanded.triggeredAbilities ?? []).map(
            (a) => a.id
        );
        expect(expandedIds).toContain(annihilatorTriggerId(6));
    });
});

describe("Emrakul, the Aeons Torn — put into a graveyard from anywhere (CR 400.7 / 603.2 / 701.24)", () => {
    /** p1 owns Emrakul and has a stocked graveyard; p2 has their own graveyard
     *  which must never be touched. `emrakulZone` places Emrakul for the
     *  origin under test. */
    function setup(
        emrakulZone: "battlefield" | "hand" | "library",
        opts: { controllerId?: string } = {}
    ) {
        const emrakul = makeInstance(emrakulTheAeonsTorn.id, {
            id: "emrakul",
            controllerId: opts.controllerId ?? "p1",
            ownerId: "p1",
            zone: emrakulZone,
        });
        const mkP1Yard = (n: number) =>
            Array.from({ length: n }, (_, i) =>
                makeInstance(grizzlyBears.id, {
                    id: `p1-yard-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "graveyard",
                })
            );
        const p2Yard = [
            makeInstance(lightningBolt.id, {
                id: "p2-yard-0",
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            }),
        ];
        const p1 = makePlayer("p1", {
            graveyard: mkP1Yard(3),
            battlefield:
                emrakulZone === "battlefield" && !opts.controllerId
                    ? [emrakul]
                    : [],
            hand: emrakulZone === "hand" ? [emrakul] : [],
            library: emrakulZone === "library" ? [emrakul] : [],
        });
        const p2 = makePlayer("p2", {
            graveyard: p2Yard,
            // A control-change effect leaves the permanent on the CONTROLLER's
            // battlefield while ownership stays with p1 (CR 108.3 / 110.2).
            battlefield:
                emrakulZone === "battlefield" && opts.controllerId === "p2"
                    ? [emrakul]
                    : [],
        });
        const state = makeState({ players: [p1, p2] });
        return { state, emrakul };
    }

    it("dies from the battlefield: the owner's WHOLE graveyard — Emrakul included — is shuffled into their library", () => {
        const { state } = setup("battlefield");
        expect(state.players[0].graveyard).toHaveLength(3);

        removePermanentTo(state, "emrakul", "graveyard");
        processPendingActionTriggers(state);
        drainStack(state);

        const p1 = state.players[0];
        // The whole graveyard is gone — this is the delta vs. Worldspine Wurm /
        // Blightsteel Colossus, which shuffle back only themselves.
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.library.map((c) => c.id).sort()).toEqual([
            "emrakul",
            "p1-yard-0",
            "p1-yard-1",
            "p1-yard-2",
        ]);
        expect(p1.battlefield.some((c) => c.id === "emrakul")).toBe(false);
    });

    it("the sweep is addressed to the OWNER, not the controller: a stolen Emrakul still shuffles its OWNER's graveyard", () => {
        // The discriminating case. Emrakul is owned by p1 but controlled by p2
        // (Control Magic / Gilded Drake). CR 108.3 — ownership is immutable, and
        // the Oracle text says "its OWNER shuffles THEIR graveyard". Reading the
        // trigger's controller instead would sweep p2's graveyard into p2's
        // library and leave p1's untouched.
        const { state } = setup("battlefield", { controllerId: "p2" });
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "emrakul",
        ]);

        removePermanentTo(state, "emrakul", "graveyard");
        processPendingActionTriggers(state);
        drainStack(state);

        const [p1, p2] = state.players;
        // p1 (the OWNER) had their graveyard swept into their library.
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.library.map((c) => c.id).sort()).toEqual([
            "emrakul",
            "p1-yard-0",
            "p1-yard-1",
            "p1-yard-2",
        ]);
        // p2 (the last CONTROLLER) is entirely untouched.
        expect(p2.graveyard.map((c) => c.id)).toEqual(["p2-yard-0"]);
        expect(p2.library).toHaveLength(0);
    });

    it("discarded from hand: fires with no battlefield presence at all (CR 701.9)", () => {
        const { state } = setup("hand");

        expect(discardToGraveyard(state, "p1", "emrakul")).toBe(true);
        processPendingActionTriggers(state);
        drainStack(state);

        const p1 = state.players[0];
        expect(p1.hand).toHaveLength(0);
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.library.map((c) => c.id).sort()).toEqual([
            "emrakul",
            "p1-yard-0",
            "p1-yard-1",
            "p1-yard-2",
        ]);
    });

    it("milled from the library: fires and sweeps the graveyard back (CR 701.17)", () => {
        const { state } = setup("library");
        const p1 = getPlayer(state, "p1");
        // Mill it: library → graveyard, then the trigger sweeps everything back.
        moveCard(p1, "emrakul", "library", "graveyard");
        emitCardMilled(state, "p1", "emrakul", emrakulTheAeonsTorn.id);

        processPendingActionTriggers(state);
        drainStack(state);

        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].library.map((c) => c.id).sort()).toEqual([
            "emrakul",
            "p1-yard-0",
            "p1-yard-1",
            "p1-yard-2",
        ]);
    });

    it("an UNRELATED creature dying does not fire the sweep — the trigger is self-scoped", () => {
        // The must-NOT row of the census: `matches` discriminates on instance
        // id, so another creature hitting the graveyard leaves Emrakul (and the
        // graveyard) exactly where they are.
        const { state } = setup("battlefield");
        const bystander = makeInstance(grizzlyBears.id, {
            id: "bystander",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(bystander);

        removePermanentTo(state, "bystander", "graveyard");
        processPendingActionTriggers(state);
        drainStack(state);

        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "emrakul")).toBe(true);
        // 3 originals + the bystander that just died, all still binned.
        expect(p1.graveyard).toHaveLength(4);
        expect(p1.library).toHaveLength(0);
    });
});

describe("Emrakul, the Aeons Torn — extra turn on CAST (CR 603.6e / 500.7)", () => {
    /** Drives the REAL cast path: `emitSpellCastEvent` +
     *  `processPendingActionTriggers` is exactly what `castSpell` in
     *  `convex/game.ts` runs after pushing the stack item. Asserting on the
     *  card definition alone would not reach the code — the trigger's whole
     *  risk is that nothing COLLECTS it (issue #2319: a self-scoped
     *  `spellCastTrigger` was invisible to every trigger sweep, so the clause
     *  was built, shipped and silently inert). */
    function cast() {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const spell = pushSpell(state, emrakulTheAeonsTorn.id, "p1");
        emitSpellCastEvent(state, spell);
        processPendingActionTriggers(state);
        return { state, spell };
    }

    it("puts the extra-turn trigger on the stack ABOVE the spell when it is cast", () => {
        const { state, spell } = cast();
        // Two objects: Emrakul itself, and its cast trigger on top (CR 601.2i —
        // the trigger is announced in the same atomic step and resolves first).
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].id).toBe(spell.id);
        const trigger = state.stack[1];
        expect(trigger.triggeredAbilityId).toBe("emrakul-cast-extra-turn");
        expect(trigger.triggerSourceId).toBe(spell.id);
        // Not yet resolved — the turn is queued on resolution, not on cast.
        expect(state.extraTurns).toBeUndefined();
    });

    it("queues an extra turn for the caster once that trigger resolves", () => {
        const { state } = cast();
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);
    });

    it("the extra turn is taken even if the spell never resolves (the trigger is independent of it)", () => {
        const { state, spell } = cast();
        // Bin the spell itself, leaving only its cast trigger on the stack.
        state.stack = state.stack.filter((s) => s.id !== spell.id);
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);
    });
});
