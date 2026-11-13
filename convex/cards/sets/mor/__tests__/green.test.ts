// Morningtide (MOR) — green behaviour tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import {
    getPlayer,
    resolveTopOfStack,
    type GameState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { resolveCardExport } from "../../../defineCard";
import { scapeshift as scapeshiftExport } from "../green.cards";

// The PR head carries no catalogue row for the card (ADR 0157), so register
// the module's own definition.
preloadDefinitions([resolveCardExport(scapeshiftExport)!]);

const scapeshift = getDefinition("84829605-50eb-455d-a236-ebfa11e883c5");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");

function submit(state: GameState, ids: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: "p1",
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

// Scapeshift — "Sacrifice any number of lands. Search your library for up to
// that many land cards, put them onto the battlefield tapped, then shuffle."
// (CR 701.21a sacrifice, CR 701.23 search, CR 701.24a shuffle.)
describe("Scapeshift (CR 701.21a / 701.23b / 701.24a)", () => {
    function setup() {
        const lands = ["a", "b", "c"].map((id) =>
            makeInstance(forest.id, { id: `bf-${id}` })
        );
        const library = ["x", "y", "z", "w"].map((id) =>
            makeInstance(forest.id, { id: `lib-${id}`, zone: "library" })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: lands, library }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, scapeshift.id, "p1");
        resolveTopOfStack(state);
        return state;
    }

    it("sacrifices the chosen lands and fetches that many tapped", () => {
        const state = setup();
        submit(state, ["bf-a", "bf-b"]);
        const p1 = () => getPlayer(state, "p1");
        expect(
            p1()
                .graveyard.map((c) => c.id)
                .sort()
        ).toEqual(["bf-a", "bf-b"]);
        // The search ceiling is the number sacrificed: two, not three.
        submit(state, ["lib-x", "lib-y"]);
        const fetched = p1().battlefield.filter((c) => c.id.startsWith("lib-"));
        expect(fetched).toHaveLength(2);
        expect(fetched.every((c) => c.isTapped)).toBe(true);
        expect(p1().library).toHaveLength(2);
    });

    it("sacrificing nothing fetches nothing", () => {
        const state = setup();
        submit(state, []);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(getPlayer(state, "p1").battlefield).toHaveLength(3);
        expect(getPlayer(state, "p1").library).toHaveLength(4);
    });
});
