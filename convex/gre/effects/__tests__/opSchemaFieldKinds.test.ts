// Op Schema field kinds (issue #4451) — the binding declarations, read off
// the tagged `OP_SCHEMAS` rows (`bindingDeclaration(kind)`), that replaced the
// ref checker's per-Op blocks, the `bindingKindOf` if-chain and `splice.ts`'s
// hand-kept `BINDING_DECLARATION_FIELDS` (now the naming rule in
// `bindingFields.ts`, which `check:ts` holds the schema to). Each of those was
// first seen equal to its derivation (parity phase), then deleted; this pins
// the derivation so a re-tagged row is a deliberate edit here. The amount /
// nested-script key sets are pinned by behaviour in
// `effectFieldKeySets.test.ts`.

import { describe, expect, it } from "vitest";
import type { EffectOp } from "../../../cards/types";
import {
    SCHEMA_OP_NAMES,
    bindingDeclarationsOf,
    schemaFieldNamesOf,
    validateEffectScript,
} from "../validate";
import { isBindingDeclarationField } from "../bindingFields";

/** Every binding declaration in the schema, `op.field:family[@scope]`. */
const DECLARATIONS = [
    "castDuringResolution.resultBind:boolean",
    "chooseCreatureType.bind:picks",
    "chooseNumber.bind:number",
    "choice.bind:picks",
    "choice.bindOther:snapshot",
    "coinFlipSeries.bindFlips:number",
    "coinFlipSeries.bindLosses:number",
    "coinFlipSeries.bindWins:number",
    "counter.bindSource:snapshot",
    "createToken.bind:snapshot",
    "createTokenCopy.bind:snapshot",
    "destroy.bind:snapshot",
    "digMatchingToHand.bind:snapshot",
    "discardAtRandom.bind:snapshot",
    "divideIntoPiles.chosenBind:list@chosenEffect",
    "divideIntoPiles.otherBind:list@otherEffect",
    "exile.bind:snapshot",
    "exileTopOfLibrary.bindAll:picks",
    "lookDistribute.bind:snapshot",
    "mayPay.bind:boolean",
    "mill.bind:snapshot",
    "mill.bindAll:picks",
    "moveZone.bind:snapshot",
    "moveZone.bindAll:picks",
    "moveZone.bindCount:number",
    "nameCard.bind:picks",
    "payVariableMana.bind:number",
    "recallCapturedBinding.bind:snapshot",
    "reveal.bind:picks",
    "sacrifice.bind:snapshot",
    "tapUntap.bind:snapshot",
];

const HOST = "Field Kind Probe";
const errorsOf = (effects: EffectOp[]) =>
    validateEffectScript({
        id: "field-kind-probe",
        name: HOST,
        types: ["Sorcery"],
        effects,
    });

/** "For each of `$x`, draw a card" — a bound-set iteration, which reads a
 *  PICKS (or list) binding (issue #1284). */
const eachOf = (ref: string): EffectOp => ({
    op: "forEach",
    select: { set: "bound", ref },
    effects: [{ op: "draw", player: "controller", count: 1 }],
});

describe("Op Schema binding declarations — derived from the tagged rows (issue #4451)", () => {
    it("every declaration, its family and its scope", () => {
        const derived = SCHEMA_OP_NAMES.flatMap((op) =>
            bindingDeclarationsOf(op).map(
                (d) =>
                    `${op}.${d.field}:${d.binding}${d.scopedTo ? `@${d.scopedTo}` : ""}`
            )
        );
        expect(derived.sort()).toEqual([...DECLARATIONS].sort());
    });

    // `splice.ts` reads the naming rule, never the schema (the Brain worker
    // bundles it): the rule must pick out exactly the tagged fields.
    it("a schema field is a binding declaration iff splice's naming rule says so", () => {
        const mismatches = SCHEMA_OP_NAMES.flatMap((op) => {
            const declaring = new Set(
                bindingDeclarationsOf(op).map((d) => d.field)
            );
            return schemaFieldNamesOf(op)
                .filter(
                    (field) =>
                        isBindingDeclarationField(field) !==
                        declaring.has(field)
                )
                .map((field) => `${op}.${field}`);
        });
        expect(mismatches).toEqual([]);
        expect(
            ["bind", "bindAll", "chosenBind", "resultBind"].every(
                isBindingDeclarationField
            )
        ).toBe(true);
        expect(
            ["binding", "binder", "ref", "bound"].some(
                isBindingDeclarationField
            )
        ).toBe(false);
    });

    it("an Op with no schema, or no declaring field, declares nothing", () => {
        expect(bindingDeclarationsOf("noSuchOp")).toEqual([]);
        expect(bindingDeclarationsOf(undefined)).toEqual([]);
        expect(bindingDeclarationsOf("draw")).toEqual([]);
    });

    // The hand-kept blocks never learned `exileTopOfLibrary.bindAll` (issue
    // #3235), which the interpreter binds as picks: a later read of it was an
    // "undeclared binding" error. The tagged row declares it.
    it("exileTopOfLibrary.bindAll declares a picks binding a later Op may read", () => {
        expect(
            errorsOf([
                {
                    op: "exileTopOfLibrary",
                    player: "controller",
                    count: 2,
                    bindAll: "$exiled",
                } as EffectOp,
                eachOf("$exiled"),
            ])
        ).toEqual([]);
    });

    it("the contrast: the same exile with no bindAll leaves the read undeclared", () => {
        expect(
            errorsOf([
                {
                    op: "exileTopOfLibrary",
                    player: "controller",
                    count: 2,
                } as EffectOp,
                eachOf("$exiled"),
            ]).length
        ).toBeGreaterThan(0);
    });

    // Only `mill.bindAll` fills a PUBLIC zone (CR 701.17); `moveZone.bindAll`
    // is the same picks family but may be a face-down exile (CR 406.3), so it
    // must never source a "from among them" pick — the ref pass keeps the
    // public-zone registration per Op, not per family.
    it("moveZone.bindAll is picks, but never a public-zone candidate source", () => {
        const errors = errorsOf([
            {
                op: "moveZone",
                player: "controller",
                from: "hand",
                to: "exile",
                faceDown: true,
                bindAll: "$exiled",
            } as EffectOp,
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: "controller",
                zone: "exile",
                candidates: [{ ref: "$exiled" }],
                count: 1,
                prompt: "Choose one.",
                bind: "$kept",
            } as EffectOp,
        ]);
        expect(errors.join("\n")).toContain("not known to be in a public zone");
    });

    // One rule for every declaring field: `$each` belongs to forEach (issue
    // #807). The hand-kept blocks enforced it on `bind` / `bindAll` /
    // `bindCount` / `coinFlipSeries` only.
    it.each([
        [
            "choice.bindOther",
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { controllerOf: { target: 0 } },
                zone: "battlefield",
                candidates: [{ target: 0 }, { target: 1 }],
                count: 1,
                prompt: "Choose which of the two creatures to sacrifice",
                bind: "$sacrificed",
                bindOther: "$each",
            },
            'bindOther "$each" is reserved',
        ],
        [
            "mill.bindAll",
            {
                op: "mill",
                player: "controller",
                count: 2,
                bindAll: "$each",
            },
            'bindAll "$each" is reserved',
        ],
    ])("%s may not declare $each", (_label, op, message) => {
        expect(
            errorsOf([op as EffectOp]).some((e) => e.includes(message))
        ).toBe(true);
    });
});
