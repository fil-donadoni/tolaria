// The as-enters COPY leg restricted to "a creature YOU CONTROL" (CR 614.1c /
// 707.9b, issue #10508 — Glasspool Mimic). `controller: "you"` on the
// `entersWith.asEnters` copy member narrows the offered sources to the
// battlefield of the player the permanent enters under; Clone's
// "any creature on the battlefield" spans every battlefield.
import { describe, expect, it } from "vitest";
import {
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { checkStateBasedActions } from "../sba";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/index.cards";
import { glasspoolMimicGlasspoolShore } from "../../cards/sets/znr/blue.cards";
import { getDefinition } from "../../cards/index";

const serraAngel = () => getDefinition("f8ac5006-91bd-4803-93da-f87cf196dd2f");
const mimic = () => glasspoolMimicGlasspoolShore();

function head(state: GameState) {
    return (state.pendingChoices ?? [])[0];
}

function answer(state: GameState, ids: string[]): void {
    const h = head(state);
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

function permanent(defId: string, id: string, who: string): CardInstanceState {
    return makeInstance(defId, { id, controllerId: who, ownerId: who });
}

/** p1 casts the Mimic; `mine` / `theirs` are the two battlefields. */
function board(
    mine: CardInstanceState[],
    theirs: CardInstanceState[]
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: mine }),
            makePlayer("p2", { battlefield: theirs }),
        ],
    });
}

function entered(state: GameState, id: string): CardInstanceState | undefined {
    return state.players[0].battlefield.find((c) => c.id === id);
}

describe("CR 614.1c — enter as a copy of a creature YOU control (#10508)", () => {
    it("offers only the caster's creatures, never the opponent's", () => {
        const state = board(
            [permanent(grizzlyBears().id, "bears", "p1")],
            [permanent(serraAngel().id, "serra", "p2")]
        );
        const spell = pushSpell(state, mimic().id, "p1");

        resolveTopOfStack(state);

        expect(head(state).asEntersKind).toBe("copy");
        expect(head(state).candidateIds).toEqual(["bears"]);
        // The client renders the prompt off the projected choice.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0]?.candidateIds).toEqual(["bears"]);

        answer(state, ["bears"]);

        const copy = entered(state, spell.id)!;
        expect((copy.card as { id: string }).id).toBe(grizzlyBears().id);
        expect(getEffectivePower(state, copy)).toBe(2);
        expect(getEffectiveToughness(state, copy)).toBe(2);
        // CR 707.9b — Shapeshifter Rogue IN ADDITION TO the copied subtypes.
        expect(copy.subtypes).toEqual(["Bear", "Shapeshifter", "Rogue"]);
    });

    it("only an opponent's creature in play — no legal source, auto-declined, the 0/0 dies (CR 704.5f)", () => {
        const state = board([], [permanent(serraAngel().id, "serra", "p2")]);
        const spell = pushSpell(state, mimic().id, "p1");

        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        const printed = entered(state, spell.id)!;
        expect((printed.card as { id: string }).id).toBe(mimic().id);
        expect(getEffectiveToughness(state, printed)).toBe(0);

        checkStateBasedActions(state);
        expect(entered(state, spell.id)).toBeUndefined();
    });

    it("a non-cast entry reads the controller it enters under", () => {
        // CR 614.12a — the choice is raised on every entry path; here p2's
        // creature is the only one besides p1's, and p1 is the controller.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(mimic().id, {
                            id: "subject",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                    battlefield: [permanent(grizzlyBears().id, "bears", "p1")],
                }),
                makePlayer("p2", {
                    battlefield: [permanent(serraAngel().id, "serra", "p2")],
                }),
            ],
        });
        const [card] = state.players[0].graveyard.splice(0, 1);
        putReanimatedSetOnBattlefield(state, [{ card, controllerId: "p1" }]);

        expect(head(state).candidateIds).toEqual(["bears"]);
    });
});
