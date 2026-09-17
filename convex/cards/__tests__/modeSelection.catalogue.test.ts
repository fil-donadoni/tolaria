// Catalogue guard — a mode list that can choose MORE THAN ONE mode (ADR 0094,
// `ModeSelection`) is legal only on the ANNOUNCEMENT domain:
//
//   1. none of its modes may carry `staticEffects`. A modal PERMANENT stores
//      exactly one mode (`CardInstanceState.chosenModeId`, read by the layer
//      system), stamped from the first announced instance, so a second chosen
//      mode with a continuous half would be dropped with no error.
//   2. every mode must be an Effect Script. Several instances resolve as ONE
//      checkpointed script (`runModeInstanceScripts`); an imperative `resolve`
//      has no checkpoint and would replay earlier instances on a resume (CR
//      608.3). The engine throws at resolution as a backstop — this sweep
//      catches it at definition time.

import { describe, expect, it } from "vitest";
import type { CardDefinition, ModeSelection } from "../types";
import { getAllCards } from "../index";
import { maxModeCount } from "../../gre/modeSelection";
import { hullBreach } from "../sets/pls/multicolor";

type ModeListShape = {
    staticEffects?: unknown[];
    resolve?: unknown;
};

function modeListOffences(
    where: string,
    selection: ModeSelection | undefined,
    modes: readonly (ModeListShape & { id: string })[] | undefined
): string[] {
    if (!modes || maxModeCount(selection) <= 1) return [];
    return modes.flatMap((m) => [
        ...(m.staticEffects?.length
            ? [`${where} mode ${m.id}: staticEffects on a multi-mode list`]
            : []),
        ...(m.resolve
            ? [`${where} mode ${m.id}: imperative resolve on a multi-mode list`]
            : []),
    ]);
}

function cardOffences(card: CardDefinition): string[] {
    return [
        ...modeListOffences(card.name, card.modeSelection, card.modes),
        ...(card.activatedAbilities ?? []).flatMap((a) =>
            modeListOffences(
                `${card.name} :: ability ${a.id}`,
                a.modeSelection,
                a.modes
            )
        ),
    ];
}

describe("ModeSelection catalogue guard (ADR 0094)", () => {
    it("no multi-mode list carries staticEffects or an imperative mode body", () => {
        expect(getAllCards().flatMap(cardOffences)).toEqual([]);
    });

    it("guards the guard: both offences are reported on a synthetic card", () => {
        const offender: CardDefinition = {
            ...hullBreach,
            modeSelection: { min: 1, max: 1, when: { condition: { kicked: true }, min: 1, max: 2 } },
            modes: [
                { ...hullBreach.modes![0], staticEffects: [] },
                {
                    ...hullBreach.modes![1],
                    staticEffects: [{ type: "keyword-grant" } as never],
                },
                {
                    id: "imperative",
                    label: "x",
                    oracleText: "x",
                    resolve: () => {},
                },
            ],
        };
        expect(cardOffences(offender)).toEqual([
            "Hull Breach mode enchantment: staticEffects on a multi-mode list",
            "Hull Breach mode imperative: imperative resolve on a multi-mode list",
        ]);
        // The same list at exactly one mode is the modal-permanent shape.
        expect(
            cardOffences({ ...offender, modeSelection: undefined })
        ).toEqual([]);
    });
});
