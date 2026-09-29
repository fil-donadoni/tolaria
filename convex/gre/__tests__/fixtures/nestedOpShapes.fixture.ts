// Every NESTING SHAPE the Effect Script DSL has — one host Op per place an
// Op list can sit inside another Op (issue #4477).
//
// Shared on purpose: the direct test of `childOpArrays`
// (`effectOpChildren.bot.test.ts`), the `NESTED_SCRIPT_KEYS` test in
// `effects/__tests__/effectFieldKeySets.test.ts`, and the walker-reach
// snapshot issue #4442 owes all need "a script nesting one Op under every
// shape". Three hand-typed copies of that script are three chances to miss
// the same new construct, so there is one.
//
// Adding a nesting Op to the DSL means adding its shape(s) here; the
// `childOpArrays` test then fails until the authority learns it too.

import type { EffectOp } from "../../../cards/types";

/** One place an Op list nests: the host Op's name and the field holding it. */
export interface NestingShape {
    /** A stable label, `<host op>.<field>`. */
    readonly label: string;
    /** The host Op's `op`. */
    readonly hostOp: EffectOp["op"];
    /** The host field the nested list sits under — the `NESTED_SCRIPT_KEYS`
     *  vocabulary (`win`/`loss` name the branch object, whose `effects` is
     *  the list). */
    readonly key: string;
    /** Builds the host Op with `inner` as that one nested list; every other
     *  nested list of the host is empty, so `inner` is the only thing inside. */
    readonly nest: (inner: EffectOp[]) => EffectOp;
}

export const NESTING_SHAPES: readonly NestingShape[] = [
    {
        label: "if.then",
        hostOp: "if",
        key: "then",
        nest: (inner) => ({
            op: "if",
            predicate: { binding: "$paid" },
            then: inner,
        }),
    },
    {
        label: "if.else",
        hostOp: "if",
        key: "else",
        nest: (inner) => ({
            op: "if",
            predicate: { binding: "$paid" },
            then: [],
            else: inner,
        }),
    },
    {
        label: "forEach.effects",
        hostOp: "forEach",
        key: "effects",
        nest: (inner) => ({
            op: "forEach",
            select: { set: "players" },
            effects: inner,
        }),
    },
    {
        label: "optionChoice.modes",
        hostOp: "optionChoice",
        key: "modes",
        nest: (inner) => ({
            op: "optionChoice",
            prompt: "Choose one.",
            modes: [{ label: "The nested mode", effects: inner }],
        }),
    },
    {
        label: "coinFlip.win",
        hostOp: "coinFlip",
        key: "win",
        nest: (inner) => ({
            op: "coinFlip",
            win: { consequence: "Win", effects: inner },
            loss: { consequence: "Lose", effects: [] },
        }),
    },
    {
        label: "coinFlip.loss",
        hostOp: "coinFlip",
        key: "loss",
        nest: (inner) => ({
            op: "coinFlip",
            win: { consequence: "Win", effects: [] },
            loss: { consequence: "Lose", effects: inner },
        }),
    },
    {
        label: "coinFlipSync.win",
        hostOp: "coinFlipSync",
        key: "win",
        nest: (inner) => ({
            op: "coinFlipSync",
            win: { consequence: "Win", effects: inner },
            loss: { consequence: "Lose", effects: [] },
        }),
    },
    {
        label: "coinFlipSync.loss",
        hostOp: "coinFlipSync",
        key: "loss",
        nest: (inner) => ({
            op: "coinFlipSync",
            win: { consequence: "Win", effects: [] },
            loss: { consequence: "Lose", effects: inner },
        }),
    },
    {
        label: "delayedTrigger.effects",
        hostOp: "delayedTrigger",
        key: "effects",
        nest: (inner) => ({
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText: "At the beginning of the next end step, do it.",
            effects: inner,
        }),
    },
    {
        label: "reflexiveTrigger.effects",
        hostOp: "reflexiveTrigger",
        key: "effects",
        nest: (inner) => ({
            op: "reflexiveTrigger",
            oracleText: "When you do, do it.",
            effects: inner,
        }),
    },
    {
        label: "divideIntoPiles.chosenEffect",
        hostOp: "divideIntoPiles",
        key: "chosenEffect",
        nest: (inner) => ({
            op: "divideIntoPiles",
            objects: {
                set: "permanents",
                zone: "battlefield",
                controller: "opponent",
                filter: { type: "Creature" },
            },
            divider: "controller",
            chooser: "opponent",
            dividePrompt: "Divide.",
            pickPrompt: "Pick.",
            chosenBind: "$chosen",
            otherBind: "$other",
            chosenEffect: inner,
            otherEffect: [],
        }),
    },
    {
        label: "divideIntoPiles.otherEffect",
        hostOp: "divideIntoPiles",
        key: "otherEffect",
        nest: (inner) => ({
            op: "divideIntoPiles",
            objects: {
                set: "permanents",
                zone: "battlefield",
                controller: "opponent",
                filter: { type: "Creature" },
            },
            divider: "controller",
            chooser: "opponent",
            dividePrompt: "Divide.",
            pickPrompt: "Pick.",
            chosenBind: "$chosen",
            otherBind: "$other",
            chosenEffect: [],
            otherEffect: inner,
        }),
    },
];

/** A marker Op, compared by IDENTITY — call once per shape for a fresh
 *  object, so a walk can say WHICH shape it reached. */
export function markerOp(): EffectOp {
    return { op: "gainLife", player: "controller", amount: 1 };
}
