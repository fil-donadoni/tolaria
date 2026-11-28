// Catalogue guard — a mode list that can choose MORE THAN ONE mode (ADR 0094,
// `ModeSelection`) is legal only on the ANNOUNCEMENT domain:
//
//   1. none of its modes may carry `staticEffects`. A modal PERMANENT stores
//      exactly one mode (`CardInstanceState.chosenModeId`, read by the layer
//      system), stamped from the first announced instance, so a second chosen
//      mode with a continuous half would be dropped with no error.
//   2. every mode must be an Effect Script. Several instances resolve as ONE
//      checkpointed script (`runModeInstanceScripts`); an imperative `resolve`
//      has no checkpoint and would replay earlier instances on a resume. The
//      engine throws at resolution as a backstop — this sweep
//      catches it at definition time.
//   3. its bounds are sane (1 <= min <= max, for the base and for `when`). A
//      minimum above one is legal: the picker sends several modes (issue
//      #2264) and the Bot enumerates every announceable combination (issue
//      #2265, `announceableModeCombinations`).
//   4. a triggered multi-mode list declares no ability-level target groups:
//      several instances split the flat target list among themselves, so no
//      instance's script could own those slots.
//   5. CR 700.2i — a {P} budget and per-mode pawprints come together: a
//      budgeted list whose mode carries no weight, or a weighted mode on a
//      list with no budget, is a list the announcement would misjudge.

import { describe, expect, it } from "vitest";
import type { CardDefinition, ModeSelection } from "../types";
import { getAllCards } from "../index";
import { maxModeCount } from "../../gre/modeSelection";
import { hullBreach } from "../sets/pls/multicolor.cards";

type ModeListShape = {
    staticEffects?: unknown[];
    resolve?: unknown;
    pawprints?: number;
};

/** CR 700.2i — the {P} budget and the per-mode weights come as a pair. */
function pawprintOffences(
    where: string,
    selection: ModeSelection | undefined,
    modes: readonly (ModeListShape & { id: string })[] | undefined
): string[] {
    const budgeted = selection?.pawprintBudget !== undefined;
    return (modes ?? []).flatMap((m) => {
        const weighted = m.pawprints !== undefined;
        if (budgeted && (!weighted || m.pawprints! < 1))
            return [`${where} mode ${m.id}: no {P} weight on a budgeted list`];
        if (!budgeted && weighted)
            return [`${where} mode ${m.id}: a {P} weight with no budget`];
        return [];
    });
}

function boundsOffences(where: string, selection: ModeSelection): string[] {
    const ranges = [
        ["base", selection.min, selection.max],
        ...(selection.when
            ? [["when", selection.when.min, selection.when.max] as const]
            : []),
    ] as const;
    return ranges.flatMap(([label, min, max]) =>
        min < 1 || min > max
            ? [
                  `${where}: ${label} bounds ${min}..${max} are not 1 <= min <= max`,
              ]
            : []
    );
}

function modeListOffences(
    where: string,
    selection: ModeSelection | undefined,
    modes: readonly (ModeListShape & { id: string })[] | undefined
): string[] {
    const pawprints = pawprintOffences(where, selection, modes);
    if (!modes || !selection) return pawprints;
    const bounds = [...pawprints, ...boundsOffences(where, selection)];
    if (maxModeCount(selection) <= 1) return bounds;
    return [
        ...bounds,
        ...modes.flatMap((m) => [
            ...(m.staticEffects?.length
                ? [`${where} mode ${m.id}: staticEffects on a multi-mode list`]
                : []),
            ...(m.resolve
                ? [
                      `${where} mode ${m.id}: imperative resolve on a multi-mode list`,
                  ]
                : []),
        ]),
    ];
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
        ...(card.triggeredAbilities ?? []).flatMap((a) => {
            const where = `${card.name} :: trigger ${a.id}`;
            return [
                ...modeListOffences(where, a.modeSelection, a.modes),
                ...(maxModeCount(a.modeSelection) > 1 &&
                a.additionalTargetRequirements?.length
                    ? [`${where}: ability-level groups on a multi-mode list`]
                    : []),
            ];
        }),
    ];
}

describe("ModeSelection catalogue guard (ADR 0094)", () => {
    it("no multi-mode list carries staticEffects or an imperative mode body", () => {
        expect(getAllCards().flatMap(cardOffences)).toEqual([]);
    });

    it("guards the guard: both offences are reported on a synthetic card", () => {
        const offender: CardDefinition = {
            ...hullBreach(),
            modeSelection: {
                min: 1,
                max: 1,
                when: { condition: { kicked: true }, min: 1, max: 2 },
            },
            modes: [
                { ...hullBreach().modes![0], staticEffects: [] },
                {
                    ...hullBreach().modes![1],
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
        const trigger = {
            id: "t",
            event: "PERMANENT_ENTERED",
            oracleText: "x",
            modeSelection: { min: 2, max: 2 },
            modes: [
                { id: "a", label: "a", oracleText: "a", resolve: () => {} },
            ],
            additionalTargetRequirements: [{ type: "Creature", count: 1 }],
        };
        expect(
            cardOffences({
                ...hullBreach(),
                modes: undefined,
                modeSelection: undefined,
                triggeredAbilities: [trigger],
            } as unknown as CardDefinition)
        ).toEqual([
            "Hull Breach :: trigger t mode a: imperative resolve on a multi-mode list",
            "Hull Breach :: trigger t: ability-level groups on a multi-mode list",
        ]);
        expect(cardOffences(offender)).toEqual([
            "Hull Breach mode enchantment: staticEffects on a multi-mode list",
            "Hull Breach mode imperative: imperative resolve on a multi-mode list",
        ]);
        expect(
            cardOffences({
                ...hullBreach(),
                modeSelection: { min: 3, max: 2 },
            })
        ).toEqual(["Hull Breach: base bounds 3..2 are not 1 <= min <= max"]);
        // CR 700.2i — a budget with an unweighted mode, a weight with none.
        expect(
            cardOffences({
                ...hullBreach(),
                modeSelection: { min: 1, max: 1, pawprintBudget: 5 },
            })
        ).toEqual([
            "Hull Breach mode artifact: no {P} weight on a budgeted list",
            "Hull Breach mode enchantment: no {P} weight on a budgeted list",
            "Hull Breach mode both: no {P} weight on a budgeted list",
        ]);
        expect(
            cardOffences({
                ...hullBreach(),
                modeSelection: undefined,
                modes: [{ ...hullBreach().modes![0], pawprints: 1 }],
            })
        ).toEqual([
            `Hull Breach mode ${hullBreach().modes![0].id}: a {P} weight with no budget`,
        ]);
        // The same list at exactly one mode is the modal-permanent shape.
        expect(cardOffences({ ...offender, modeSelection: undefined })).toEqual(
            []
        );
    });
});
