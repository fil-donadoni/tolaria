// Streets of New Capenna Commander (VOC) — blue behavior tests (ADR 0043).

import { describe, it, expect } from "vitest";
import { occultEpiphany } from "../blue";
import { ponder } from "../../lrw/blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

describe("Occult Epiphany (draw X, discard X, spirits per card type; CR 107.3 / 707.2)", () => {
    it("is an {X}{U} instant", () => {
        expect(occultEpiphany.manaCost).toEqual({ X: "X", U: 1 });
        expect(occultEpiphany.types).toEqual(["Instant"]);
    });

    it("draws X, discards X, and makes one flying Spirit per distinct discarded card type", () => {
        // Hand seeds: an Instant (occultEpiphany) and a Sorcery (ponder) → two
        // distinct card types when both are discarded.
        const handInstant = makeInstance(occultEpiphany.id, {
            id: "hInstant",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const handSorcery = makeInstance(ponder.id, {
            id: "hSorcery",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib = [0, 1].map((i) =>
            makeInstance(occultEpiphany.id, {
                id: `d${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handInstant, handSorcery],
                    library: lib,
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, occultEpiphany.id, "p1");
        item.chosenX = 2;

        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the discard choice
        expect(state.players[0].hand).toHaveLength(4); // 2 seed + 2 drawn

        // Discard the Instant + the Sorcery → two distinct card types.
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hInstant", "hSorcery"],
        });

        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(2);
        expect(tokens.every((t) => t.staticAbilities.includes("flying"))).toBe(
            true
        );

        // Wire format: token count survives projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(2);
    });
});
