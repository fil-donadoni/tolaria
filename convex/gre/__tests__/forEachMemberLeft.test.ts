// CR 701.8a — a `forEach` member that already left the battlefield leaves
// `$each` EMPTY for its iteration: the body skips it. It must never read the
// `$each` of an EARLIER, completed forEach of the same script instead.
//
// Driven through Sundering Titan (DST), whose script is five
// `choice` → `forEach { set: "bound" } destroy` pairs, one per basic land
// type (CR 205.3i). A dual land answering two types can be chosen for both;
// by the second forEach it is gone, and that iteration's absent `$each` used
// to fall through `readBinding` to `readIteratedPicks` — the union of the
// earlier forEach's snapshots — and crash `destroy`'s object lookup.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { removePermanentTo, resolveTopOfStack, type GameState } from "../state";
import { checkStateBasedActions } from "../sba";
import { getAllCards } from "../../cards/index";

function cardId(name: string): string {
    const def = getAllCards().find((c) => c.name === name);
    if (!def) throw new Error(`card not registered: ${name}`);
    return def.id;
}

function permanent(name: string, id: string, controllerId: string) {
    return makeInstance(cardId(name), {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

/** Titan + lands for p1; p2 holds a Volcanic Island (Island AND Mountain) and
 *  two Swamps. No other Mountain or Island exists. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    permanent("Sundering Titan", "titan", "p1"),
                    permanent("Plains", "plains", "p1"),
                    permanent("Forest", "forest", "p1"),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    permanent("Volcanic Island", "volcanic", "p2"),
                    permanent("Swamp", "swamp1", "p2"),
                    permanent("Swamp", "swamp2", "p2"),
                ],
            }),
        ],
    });
}

/** Answers every Titan prompt in order, picking per basic land type. */
function answerAll(
    state: GameState,
    pickFor: Record<string, string>
): string[] {
    const asked: string[] = [];
    for (let guard = 0; state.pendingChoices?.length && guard < 10; guard++) {
        const head = state.pendingChoices[0];
        const type = Object.keys(pickFor).find((t) =>
            head.prompt.includes(`type ${t} `)
        );
        if (!type) throw new Error(`unexpected prompt: ${head.prompt}`);
        asked.push(type);
        submitChoice(state, [pickFor[type]]);
    }
    return asked;
}

function battlefieldIds(state: GameState): string[] {
    return state.players.flatMap((p) => p.battlefield.map((c) => c.id)).sort();
}

describe("forEach member that left — empty $each (CR 701.8a)", () => {
    it("a dual chosen for two basic land types is destroyed once, and no later forEach reads an earlier one's $each", () => {
        const state = board();
        // CR 603.6c — the leaves-the-battlefield half of the one trigger.
        removePermanentTo(state, "titan", "graveyard");
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        const asked = answerAll(state, {
            Plains: "plains",
            Island: "volcanic",
            Swamp: "swamp1",
            Mountain: "volcanic",
            Forest: "forest",
        });

        expect(asked).toEqual([
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]);
        expect(state.stack).toHaveLength(0);
        // Every chosen land is destroyed — the controller's own included — and
        // the unchosen Swamp survives.
        expect(battlefieldIds(state)).toEqual(["swamp2"]);
        const graveyards = state.players
            .flatMap((p) => p.graveyard.map((c) => c.id))
            .sort();
        expect(graveyards).toEqual(
            ["forest", "plains", "swamp1", "titan", "volcanic"].sort()
        );
    });

    it("a basic land type with no land on the battlefield raises no choice", () => {
        const state = board();
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "volcanic"
        );
        removePermanentTo(state, "titan", "graveyard");
        checkStateBasedActions(state);
        resolveTopOfStack(state);

        const asked = answerAll(state, {
            Plains: "plains",
            Swamp: "swamp2",
            Forest: "forest",
        });

        expect(asked).toEqual(["Plains", "Swamp", "Forest"]);
        expect(battlefieldIds(state)).toEqual(["swamp1"]);
    });
});
