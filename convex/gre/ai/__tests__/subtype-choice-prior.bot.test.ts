// The as-enters CREATURE-TYPE choice as a survivable ISMCTS decision node
// (CR 614.12a / CR 205.3m, issue #2710).
//
// Every other `option-pick` in the engine offers a handful of options: a modal
// spell's 2-5 modes, a body pick, 21 life amounts. "As this enters, choose a
// creature type" offers CR 205.3m's whole table — ~280 — which is two orders of
// magnitude past `CHOICE_TOP_K`. The generator emits one candidate per option
// and `topKByPrior` is a STABLE sort, so with every candidate at the flat
// `NEUTRAL_PRIOR` the eight branches the search actually opens were the first
// eight ALPHABETICALLY: the bot named Advisor (or Alien, or Ape) on every board
// it ever saw, and nothing went red — the move was enumerated and legal.
//
// What is pinned here is the seam, not the sign: the prior ranks the types
// REPRESENTED on the battlefield above the ones nobody has, and says nothing
// about whose they are. Which present type is best — the opponent's tribe for a
// -1/-1, its own for a lord — is the search's job (ADR 0102: no card-shaped
// assumption about an effect this seam cannot see). The end-to-end proof that
// the search gets it right lives in the blade entry "as-enters creature type".
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { getDefinition } from "../../../cards";
import { resolveTopOfStack, type GameState } from "../../state";
import { pushSpell } from "../../../cards/__tests__/setup";
import { CHOICE_TOP_K, choiceCandidates } from "../choiceCandidates";
import { priorFor } from "../choicePriors";

const engineeredPlague = getDefinition("27e158d5-efb2-4f90-8898-60ede98f7d29");
const llanowarElves = getDefinition("d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

/** A board with the Plague resolving under `p1` and the given creatures out,
 *  stopped at its as-enters choice (CR 614.12a). */
function plagueChoiceState(
    creatures: { defId: string; controllerId: string; id: string }[]
): GameState {
    const built = creatures.map((c) =>
        makeInstance(c.defId, {
            id: c.id,
            controllerId: c.controllerId,
            ownerId: c.controllerId,
            zone: "battlefield",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: built.filter((c) => c.controllerId === "p1"),
            }),
            makePlayer("p2", {
                battlefield: built.filter((c) => c.controllerId === "p2"),
            }),
        ],
    });
    pushSpell(state, engineeredPlague.id, "p1");
    resolveTopOfStack(state);
    return state;
}

describe("as-enters creature-type choice — the prior that survives CR 205.3m's table", () => {
    it("carries the creature type on each option so the seam can read it", () => {
        const state = plagueChoiceState([]);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        // The whole CR 205.3m table, not a board-derived subset: you may name a
        // type no creature has (CR 614.12a puts no restriction on the choice).
        expect(head.options!.length).toBeGreaterThan(200);
        for (const option of head.options!) {
            expect(option.subtype).toBe(option.id);
        }
    });

    it("ranks a type on the battlefield above one nobody has", () => {
        const state = plagueChoiceState([
            { defId: llanowarElves.id, controllerId: "p2", id: "elves" },
        ]);
        const head = state.pendingChoices![0];
        const priorOf = (subtype: string) =>
            priorFor(state, head, {
                key: `option-pick:${subtype}`,
                move: {
                    kind: "resolution-choice",
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds: [subtype],
                },
                hint: { subtypeMode: subtype },
            });
        expect(priorOf("Elf")).toBeGreaterThan(priorOf("Advisor"));
        expect(priorOf("Druid")).toBeGreaterThan(priorOf("Advisor"));
    });

    it("opens the board's types, not the alphabet's first eight", () => {
        const state = plagueChoiceState([
            { defId: llanowarElves.id, controllerId: "p2", id: "elves-1" },
            { defId: llanowarElves.id, controllerId: "p2", id: "elves-2" },
            { defId: grizzlyBears.id, controllerId: "p1", id: "bears" },
        ]);
        const head = state.pendingChoices![0];
        const opened = choiceCandidates(state, head).map(
            (c) => c.move.cardInstanceIds![0]
        );
        expect(opened.length).toBe(CHOICE_TOP_K);
        // Llanowar Elves is an Elf Druid, Grizzly Bears a Bear: all three are
        // on the board and all three must be reachable.
        expect(opened).toContain("Elf");
        expect(opened).toContain("Druid");
        // UNSIGNED: the bot's OWN Bear is ranked by presence like any other.
        expect(opened).toContain("Bear");
        expect(opened).not.toContain("Advisor");
    });

    it("stays neutral — and never empty — on a creatureless board", () => {
        const state = plagueChoiceState([]);
        const head = state.pendingChoices![0];
        const cands = choiceCandidates(state, head);
        expect(cands.length).toBe(CHOICE_TOP_K);
        const priors = new Set(cands.map((c) => c.prior));
        expect(priors.size).toBe(1);
    });
});
