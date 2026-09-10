// LCI white — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Sanguine Evangelist is DSL-only over an already-exercised Op
// (`createToken`), so the per-Op regime would ordinarily cover it. Two things
// earn this file anyway, and both are shapes a green suite would not notice:
//
//  * CR 603.2 — the printed "enters or dies" line is ONE ability spanning two
//    engine events. Two abilities would put two triggers on the stack off one
//    line, which no static sweep catches.
//  * The DIES half resolves with the source already in the graveyard
//    (CR 603.10 / 113.7a last-known information). A body that reached back to
//    the battlefield for its controller would make exactly one of the two
//    halves silently inert.
//
// Battle cry itself is the keyword expansion's own capability test
// (`abilities/__tests__/keywordTriggers.test.ts`, CR 702.91); what is asserted
// here is that this card actually declares the keyword the seam expands.

import { describe, it, expect } from "vitest";
import { BAT_TOKEN } from "../../../sharedTokens";
import { getDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import type { GameEvent } from "../../../types";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";

const sanguineEvangelist = getDefinition(
    "269ddd84-fdc4-4c94-b183-32ecec56967c"
);

const TRIGGER_ID = "sanguine-evangelist-bat";

/** Board: p1 controls the Evangelist (on the battlefield) or has it in the
 *  graveyard, mirroring the two halves of its printed line. */
function boardWithEvangelist(zone: "battlefield" | "graveyard"): {
    state: GameState;
    evangelist: CardInstanceState;
} {
    const evangelist = makeInstance(sanguineEvangelist.id, {
        id: "evangelist",
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: zone === "battlefield" ? [evangelist] : [],
                graveyard: zone === "graveyard" ? [evangelist] : [],
            }),
            makePlayer("p2"),
        ],
    });
    return { state, evangelist };
}

/** Fire the Evangelist's trigger for one of its two events and resolve it
 *  through the real path. */
function resolveBatTrigger(
    state: GameState,
    evangelist: CardInstanceState,
    event: "PERMANENT_ENTERED" | "CREATURE_DIED"
): void {
    state.stack.push({
        ...evangelist,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: TRIGGER_ID,
        triggerSourceId: evangelist.id,
        triggerEvent: (event === "PERMANENT_ENTERED"
            ? { type: "PERMANENT_ENTERED", instanceId: evangelist.id }
            : {
                  type: "CREATURE_DIED",
                  creatureInstanceId: evangelist.id,
                  creatureControllerId: "p1",
                  creatureTypes: ["Creature"],
                  lastKnownPower: 2,
                  lastKnownToughness: 1,
              }) as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

/** The CR 603.10 last-known-information payload the engine emits when the
 *  Evangelist dies — its own death, so the LKI is its printed 2/1. */
const deathEvent = (instanceId: string): GameEvent => ({
    type: "CREATURE_DIED",
    creatureInstanceId: instanceId,
    creatureControllerId: "p1",
    creatureOwnerId: "p1",
    creatureTypes: ["Creature"],
    damagedBySources: [],
    creaturePower: 2,
    creatureToughness: 1,
});

const bats = (state: GameState): CardInstanceState[] =>
    state.players[0].battlefield.filter((c) => c.id !== "evangelist");

describe("Sanguine Evangelist (LCI, CR 603.2 + CR 702.91)", () => {
    it("declares battle cry as a bare keyword, and the seam expands it (CR 702.91a)", () => {
        expect(sanguineEvangelist.staticAbilities).toContain("battle cry");
        // The trigger enforcing the keyword is injected, never hand-written.
        expect(
            sanguineEvangelist.triggeredAbilities?.some(
                (t) => t.id === "battle-cry"
            )
        ).toBe(true);
    });

    it("CR 603.2 — ONE ability answers BOTH events (enters and dies)", () => {
        // The claim is about the STACK, so it is measured on the stack: each
        // of the two events must put exactly ONE trigger there, and both must
        // come from the same ability. Two abilities off one printed line would
        // render twice — the bug this shape exists to prevent.
        const entered = boardWithEvangelist("battlefield");
        const enterTriggers = collectTriggers(entered.state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: entered.evangelist.id,
                controllerId: "p1",
            } as GameEvent,
        ]);
        expect(
            enterTriggers.filter((t) => t.triggerSourceId === "evangelist")
        ).toHaveLength(1);

        const died = boardWithEvangelist("graveyard");
        const deathTriggers = collectTriggers(died.state, [
            deathEvent(died.evangelist.id),
        ]);
        expect(
            deathTriggers.filter((t) => t.triggerSourceId === "evangelist")
        ).toHaveLength(1);

        expect(deathTriggers[0].triggeredAbilityId).toBe(
            enterTriggers[0].triggeredAbilityId
        );
        expect(deathTriggers[0].triggeredAbilityId).toBe(TRIGGER_ID);
    });

    it("creates a 1/1 black flying Bat when it enters, surviving the wire", () => {
        const { state, evangelist } = boardWithEvangelist("battlefield");
        expect(bats(state)).toHaveLength(0);

        resolveBatTrigger(state, evangelist, "PERMANENT_ENTERED");

        const created = bats(state);
        expect(created).toHaveLength(1);
        const bat = created[0];
        expect(bat.subtypes).toContain("Bat");
        expect(bat.staticAbilities).toContain("flying");
        expect(getEffectivePower(state, bat)).toBe(1);
        expect(getEffectiveToughness(state, bat)).toBe(1);

        // Wire format: the token is what the client renders, so its identity
        // has to survive the projection (a stripped `card` would render a
        // placeholder silently, CR 114/111).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === bat.id
        )!;
        expect(slim.subtypes).toContain("Bat");
        expect(slim.staticAbilities).toContain("flying");
        expect(getEffectivePower(projected, slim)).toBe(1);
    });

    it("creates the Bat when it DIES, resolving from the graveyard (CR 603.10)", () => {
        const { state, evangelist } = boardWithEvangelist("graveyard");

        // The real trigger scan, not a hand-pushed stack item: the source has
        // already left the battlefield, so `collectTriggers` has to find it in
        // the graveyard for the dies half to fire at all.
        const collected = collectTriggers(state, [deathEvent(evangelist.id)]);
        expect(
            collected.filter((t) => t.triggeredAbilityId === TRIGGER_ID)
        ).toHaveLength(1);

        resolveBatTrigger(state, evangelist, "CREATURE_DIED");

        // The source is gone from the battlefield; the token still lands under
        // its controller.
        const created = state.players[0].battlefield;
        expect(created).toHaveLength(1);
        expect(created[0].subtypes).toContain("Bat");
        expect(created[0].controllerId).toBe("p1");
        // Nothing landed on the opponent's side.
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("both halves create the SAME shared Bat spec (one token definition)", () => {
        const entered = boardWithEvangelist("battlefield");
        resolveBatTrigger(
            entered.state,
            entered.evangelist,
            "PERMANENT_ENTERED"
        );
        const died = boardWithEvangelist("graveyard");
        resolveBatTrigger(died.state, died.evangelist, "CREATURE_DIED");

        const fromEnter = bats(entered.state)[0];
        const fromDeath = died.state.players[0].battlefield[0];
        expect((fromEnter.card as { id: string }).id).toBe(
            (fromDeath.card as { id: string }).id
        );
        expect(fromEnter.subtypes).toEqual(BAT_TOKEN.subtypes);
    });
});
