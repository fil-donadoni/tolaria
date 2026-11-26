// CR 608.2h / 707.9b (issue #10557) — "you may exile an artifact or creature
// card from your hand. If you do, create a token that's a copy of the exiled
// card, except it's a 3/3 Golem artifact creature in addition to its other
// types" (Nexus of Becoming).
//
// Two seams: `moveZone`'s `bind` now snapshots a card that lands in EXILE, and
// `createTokenCopy` copies a source that resolved to a card in a public
// non-battlefield zone instead of fizzling as if it had left the battlefield.
// Driven through the shipped card's real trigger (`resolveTopOfStack` + the
// pending-choice submit) and read back through `projectPublicState`.

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState, type StackItem } from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { projectPublicState } from "../../gameProjections";
import { presentedDefId } from "../copy";
import { validateEffectScript } from "../effects/validate";
import type { EffectOp } from "../../cards/types";

const NEXUS = getCardByName("Nexus of Becoming");
const TRIGGER_ID = "nexus-of-becoming-combat";

function board(): GameState {
    const inHand = (id: string, name: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(NEXUS.id, {
                        id: "nexus",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                hand: [
                    inHand("bears", "Grizzly Bears"),
                    inHand("bolt", "Lightning Bolt"),
                ],
                library: [
                    makeInstance(getCardByName("Fellwar Stone").id, {
                        id: "stone",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        phase: "BEGINNING_OF_COMBAT",
    });
}

/** Puts the beginning-of-combat trigger on the stack and resolves it up to the
 *  hand-card pick. */
function fire(state: GameState): void {
    const nexus = state.players[0].battlefield[0];
    const item: StackItem = {
        ...nexus,
        id: `trig-${TRIGGER_ID}`,
        castById: "p1",
        zone: "stack",
        triggeredAbilityId: TRIGGER_ID,
        triggerSourceId: nexus.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId: "p1",
        },
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

const wired = (state: GameState, id: string) =>
    projectPublicState(state, 1, "p1").players[0].battlefield.find(
        (c) => c.id === id
    )!;

const tokens = (state: GameState) =>
    state.players[0].battlefield.filter((c) => c.isToken);

describe("Nexus of Becoming — copy of the exiled card (CR 608.2h, 707.9b)", () => {
    it("draws first, offers only artifact and creature cards, the drawn one included", () => {
        const state = board();
        fire(state);
        expect(state.pendingChoices?.[0]?.candidateIds?.slice().sort()).toEqual(
            ["bears", "stone"]
        );
    });

    it("exiles the pick and creates a 3/3 Golem artifact creature copy of it", () => {
        const state = board();
        fire(state);
        submitChoice(state, ["bears"]);

        expect(state.players[0].exile.map((c) => c.id)).toEqual(["bears"]);
        expect(state.stack).toHaveLength(0);
        const [token] = tokens(state);
        expect(token).toBeDefined();
        expect(getEffectivePower(state, token)).toBe(3);
        expect(getEffectiveToughness(state, token)).toBe(3);

        const shown = wired(state, token.id);
        expect(presentedDefId(token)).toBe(getCardByName("Grizzly Bears").id);
        expect(shown.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(shown.subtypes).toEqual(
            expect.arrayContaining(["Bear", "Golem"])
        );
    });

    it("an artifact card becomes an artifact creature, its type not doubled", () => {
        const state = board();
        fire(state);
        submitChoice(state, ["stone"]);
        const [token] = tokens(state);
        expect(presentedDefId(token)).toBe(getCardByName("Fellwar Stone").id);
        expect(token.types.filter((t) => t === "Artifact")).toHaveLength(1);
        expect(token.types).toContain("Creature");
        expect(getEffectivePower(state, token)).toBe(3);
    });

    it("declining exiles nothing and creates nothing (If you do)", () => {
        const state = board();
        fire(state);
        submitChoice(state, []);
        expect(state.players[0].exile).toHaveLength(0);
        expect(tokens(state)).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "bears",
            "bolt",
            "stone",
        ]);
    });
});

describe("moveZone `bind` destination (issue #10557)", () => {
    const script = (to: string) => ({
        id: "move-bind-probe",
        name: "Move Bind Probe",
        effects: [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                count: { min: 0, max: 1 },
                prompt: "Pick a card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to,
                bind: "$moved",
            },
        ] as unknown as EffectOp[],
    });

    it("admits exile, a public zone the snapshot readers locate", () => {
        expect(validateEffectScript(script("exile") as never)).toEqual([]);
    });

    it("still refuses a graveyard destination", () => {
        expect(
            validateEffectScript(script("graveyard") as never).join("\n")
        ).toContain('field "bind" is only valid with "cards"');
    });
});
