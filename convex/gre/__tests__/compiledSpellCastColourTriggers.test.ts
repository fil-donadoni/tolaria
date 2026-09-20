// Compiled SPELL-CAST heads with a colour filter reach the engine as REAL
// triggers (issue #4135, CR 603.2 / 601.2i / 105.2).
//
// The grammar test (`oracle/__tests__/spellCastColourHeads.test.ts`) proves the
// Oracle text lowers to the right descriptor. It cannot prove the rebuilt
// ability FIRES on the right colour and stays silent on the wrong one — a
// filter dropped at the `spellCastTrigger` seam reads exactly like a correct
// compile and fires on every spell. So each test compiles a real Oracle row,
// registers it, and drives a real SPELL_CAST through the trigger scan.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { darkRitual } from "../../cards/sets/lea/black";
import { counterspell } from "../../cards/sets/lea/blue";
import { lightningBolt } from "../../cards/sets/lea/red";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/fixtures";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    type GameState,
} from "../state";

function register(
    id: string,
    card: ReturnType<typeof oracleCard>
): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    const definition = {
        ...outcome.definition,
        id,
        rarity: "common" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const BOG_GNARR = register(
    "test-4135-bog-gnarr",
    oracleCard({
        name: "Bog Gnarr",
        manaCost: "{4}{G}",
        typeLine: "Creature — Beast",
        oracleText:
            "Whenever a player casts a black spell, this creature gets +2/+2 until end of turn.",
        power: "5",
        toughness: "5",
    })
);

const DWARVEN_PATROL = register(
    "test-4135-dwarven-patrol",
    oracleCard({
        name: "Dwarven Patrol",
        manaCost: "{2}{R}",
        typeLine: "Creature — Dwarf",
        oracleText: "Whenever you cast a nonred spell, untap this creature.",
        power: "3",
        toughness: "3",
    })
);

/** P1 controls `sourceId`; `casterId` casts `spellId`; returns the triggers
 *  the real scan put on the stack. */
function castAgainst(
    sourceId: string,
    casterId: "p1" | "p2",
    spellId: string
): string[] {
    const state: GameState = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(sourceId, {
                        id: "p1-source",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {}),
        ],
    });
    const spell = pushSpell(state, spellId, casterId);
    emitSpellCastEvent(state, spell);
    processPendingActionTriggers(state);
    return state.stack
        .map((s) => s.triggeredAbilityId)
        .filter((id): id is string => typeof id === "string");
}

describe("a compiled colour-filtered cast trigger fires on the right colour (CR 603.2)", () => {
    const GNARR_TRIGGER = "bog-gnarr-trigger";

    it("Bog Gnarr fires when EITHER player casts a black spell", () => {
        expect(castAgainst(BOG_GNARR.id, "p2", darkRitual.id)).toEqual([
            GNARR_TRIGGER,
        ]);
        expect(castAgainst(BOG_GNARR.id, "p1", darkRitual.id)).toEqual([
            GNARR_TRIGGER,
        ]);
    });

    it("Bog Gnarr does NOT fire on a red or a blue spell", () => {
        expect(castAgainst(BOG_GNARR.id, "p2", lightningBolt.id)).toEqual([]);
        expect(castAgainst(BOG_GNARR.id, "p2", counterspell.id)).toEqual([]);
    });

    const PATROL_TRIGGER = "dwarven-patrol-trigger";

    it("Dwarven Patrol fires on YOUR nonred spell", () => {
        expect(castAgainst(DWARVEN_PATROL.id, "p1", darkRitual.id)).toEqual([
            PATROL_TRIGGER,
        ]);
    });

    it("Dwarven Patrol does NOT fire on your red spell, nor on the opponent's nonred one", () => {
        expect(castAgainst(DWARVEN_PATROL.id, "p1", lightningBolt.id)).toEqual(
            []
        );
        expect(castAgainst(DWARVEN_PATROL.id, "p2", darkRitual.id)).toEqual([]);
    });
});
