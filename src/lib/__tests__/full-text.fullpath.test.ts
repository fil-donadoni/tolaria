// Issue #6741 — the CR 612.6 full-text effect, FULL PATH in one test:
// GRE sync → wire → the client ability views → `convex/game.ts` activation →
// resolution → the graveyard funnel re-syncing the form.
//
// The single-layer suite is `convex/gre/__tests__/fullText.test.ts`. What only
// this file can catch: the presented card's ability and the retained text both
// reaching the button the player presses (a server-only assertion passes while
// the button is absent), and the retained ability — which `card.id` no longer
// names — resolving through the real activation seam.
import { describe, it, expect } from "vitest";
import { getStackAbilities } from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import {
    getPlayer,
    recomputeContinuousEffects,
    resolveTopOfStack,
} from "@convex/gre/state";
import { getEffectivePower, getEffectiveToughness } from "@convex/gre/layers";
import { presentedDefId } from "@convex/gre/copy";
import { activateAbilityOnState } from "@convex/game";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";

const SHAPESHIFTER = "test-full-text-shapeshifter";
const DISCARD = "test-full-text-shapeshifter-discard";
/** Frozen Shade — `{B}: This creature gets +1/+1 until end of turn.` */
const SHADE = "d0bd76c8-4cff-4c15-9686-7a299b589814";
const SHADE_PUMP = "frozen-shade-ability";
const CRAW_WURM = "bfed1a95-bd67-4e16-a781-81866028af2f"; // 6/4

/** Volrath's Shapeshifter's shape (the card itself is issue #6704). */
const shapeshifterDef: CardDefinition = {
    id: SHAPESHIFTER,
    name: "Full Text Test Shapeshifter",
    rarity: "rare",
    oracleText:
        'As long as the top card of your graveyard is a creature card, this creature has the full text of that card and has the text "{2}: Discard a card."\n{2}: Discard a card.',
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Shapeshifter"],
    power: 0,
    toughness: 1,
    fullText: {
        from: "controller-graveyard-top",
        requiresType: "Creature",
        retainedActivatedAbilityIds: [DISCARD],
    },
    activatedAbilities: [
        {
            id: DISCARD,
            oracleText: "{2}: Discard a card.",
            cost: { mana: { X: 2 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        },
    ],
};

/** p1: the Shapeshifter over a Frozen Shade card, a Craw Wurm in hand, and
 *  {B}{C}{C} floating. */
function board(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [makeInstance(SHAPESHIFTER, { id: "shifter" })],
                graveyard: [
                    makeInstance(SHADE, { id: "shade", zone: "graveyard" }),
                ],
                hand: [makeInstance(CRAW_WURM, { id: "wurm", zone: "hand" })],
                manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 },
            }),
            makePlayer("p2"),
        ],
    });
    recomputeContinuousEffects(state);
    return state;
}

function projectedShifter(state: GameState): CardInstance {
    return projectPublicState(state, 1, "p1")
        .players.flatMap((p) => p.battlefield)
        .find((c) => c.id === "shifter") as unknown as CardInstance;
}

function shifter(state: GameState) {
    return getPlayer(state, "p1").battlefield.find((c) => c.id === "shifter")!;
}

describe("full-text effect, GRE → wire → UI → game.ts (CR 612.6, issue #6741)", () => {
    it("offers the presented card's ability and the retained text to the client", () => {
        withTemporaryDefinition(shapeshifterDef, () => {
            const card = projectedShifter(board());
            expect(card.card.id).toBe(SHADE);
            expect(getStackAbilities(card).map((a) => a.id)).toEqual([
                SHADE_PUMP,
                DISCARD,
            ]);
        });
    });

    it("activates the presented card's ability through game.ts", () => {
        withTemporaryDefinition(shapeshifterDef, () => {
            const state = board();
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "shifter",
                abilityId: SHADE_PUMP,
            });
            resolveTopOfStack(state);
            // Frozen Shade 0/1, pumped +1/+1.
            expect(getEffectivePower(state, shifter(state))).toBe(1);
            expect(getEffectiveToughness(state, shifter(state))).toBe(2);
        });
    });

    it("the retained {2}: Discard a card. resolves, and the discarded creature becomes the new form", () => {
        withTemporaryDefinition(shapeshifterDef, () => {
            const state = board();
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "shifter",
                abilityId: DISCARD,
            });
            expect(state.stack).toHaveLength(1);
            resolveTopOfStack(state);
            submitChoice(state, ["wurm"]);
            expect(getPlayer(state, "p1").graveyard.at(-1)?.id).toBe("wurm");
            expect(presentedDefId(shifter(state))).toBe(CRAW_WURM);
            const card = projectedShifter(state);
            expect(card.card.id).toBe(CRAW_WURM);
            // Craw Wurm has no activated ability: the retained text alone.
            expect(getStackAbilities(card).map((a) => a.id)).toEqual([DISCARD]);
        });
    });
});
