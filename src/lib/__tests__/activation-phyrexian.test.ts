// CR 107.4f — full path for a Phyrexian pip in an activated ability's cost
// (issue #7830): GRE state → the wire projection the client reads → the
// picker rows the board offers → the mutation core each row dispatches.
// A row the UI offers must be a split the server charges, and the server must
// charge exactly the row's label.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import { activateAbilityOnState } from "@convex/gre/activation";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { activationPhyrexianChoices } from "~/lib/activation-phyrexian";

const FOUNTAIN = getCardByName("Fountain of Youth");

/** "{1}{G/P}, {T}: You gain 1 life." */
function phyrexianFountain(): CardDefinition {
    return {
        ...FOUNTAIN,
        activatedAbilities: FOUNTAIN.activatedAbilities!.map((a) => ({
            ...a,
            cost: { ...a.cost, mana: { X: 1, phyrexian: { G: 1 } } },
        })),
    };
}

function build(life: number) {
    return makeState({
        players: [
            makePlayer("p1", {
                life,
                battlefield: [makeInstance(FOUNTAIN.id, { id: "fountain" })],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 },
            }),
            makePlayer("p2"),
        ],
    });
}

function viewerRows(life: number) {
    const def = phyrexianFountain();
    const projected = projectPublicState(build(life), 1, "p1");
    const viewer = projected.players.find((p) => p.id === "p1")!;
    return activationPhyrexianChoices(def.activatedAbilities![0], viewer.life);
}

describe("activated-ability Phyrexian picker, end to end (CR 107.4f)", () => {
    it("offers mana-or-life rows, and each row's dispatch is charged as labelled", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const rows = viewerRows(20);
            expect(rows).toEqual([
                { lifePips: 0, label: "{G}" },
                { lifePips: 1, label: "2 life" },
            ]);
            for (const row of rows) {
                const state = build(20);
                activateAbilityOnState(state, {
                    playerId: "p1",
                    cardInstanceId: "fountain",
                    abilityId: FOUNTAIN.activatedAbilities![0].id,
                    phyrexianLifePips: row.lifePips,
                });
                const me = state.players[0];
                expect(state.stack).toHaveLength(1);
                expect(me.life).toBe(20 - row.lifePips * 2);
                // {1} always; the pip's {G} only on the mana row.
                expect(me.manaPool.G + me.manaPool.C).toBe(row.lifePips);
            }
        });
    });

    it("CR 119.4 — below 2 life there is no choice to offer (mana only)", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            expect(viewerRows(1)).toEqual([]);
        });
    });

    it("an ability with no Phyrexian pip opens no picker", () => {
        expect(
            activationPhyrexianChoices(FOUNTAIN.activatedAbilities![0], 20)
        ).toEqual([]);
    });
});
