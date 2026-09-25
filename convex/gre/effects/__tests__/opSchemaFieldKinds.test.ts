// Op Schema field kinds (issue #4451) — PARITY PHASE: each derived list
// against the hand-kept one it replaces, seen green before the hand copy is
// deleted.

import { describe, expect, it } from "vitest";
import {
    AMOUNT_KEYS as DERIVED_AMOUNT_KEYS,
    BINDING_DECLARATION_FIELDS,
    HAND_NESTED_SCRIPT_KEYS,
    NESTED_SCRIPT_KEYS,
    SCHEMA_OP_NAMES,
    bindingDeclarationsOf,
    bindingKindOf,
} from "../validate";
import { AMOUNT_KEYS as HAND_AMOUNT_KEYS } from "../scenarioGenerator";
import { HAND_BINDING_DECLARATION_FIELDS } from "../../splice";

const sorted = (xs: Iterable<string>) => [...xs].sort();

describe("Op Schema field kinds — parity with the hand-kept lists (issue #4451)", () => {
    it("AMOUNT_KEYS: derived == hand-kept, plus moveZone.position", () => {
        expect(sorted(DERIVED_AMOUNT_KEYS)).toEqual(
            sorted([...HAND_AMOUNT_KEYS, "position"])
        );
    });

    it("NESTED_SCRIPT_KEYS: derived == hand-kept", () => {
        expect(sorted(NESTED_SCRIPT_KEYS)).toEqual(
            sorted(HAND_NESTED_SCRIPT_KEYS)
        );
    });

    it("BINDING_DECLARATION_FIELDS: derived == hand-kept", () => {
        expect(sorted(BINDING_DECLARATION_FIELDS)).toEqual(
            sorted(HAND_BINDING_DECLARATION_FIELDS)
        );
    });

    it("bindingKindOf: every schema `bind` field's family == the if-chain's", () => {
        const derived = SCHEMA_OP_NAMES.flatMap((op) =>
            bindingDeclarationsOf(op)
                .filter((d) => d.field === "bind")
                .map((d) => `${op}:${d.binding}`)
        );
        const hand = SCHEMA_OP_NAMES.flatMap((op) =>
            bindingDeclarationsOf(op).some((d) => d.field === "bind")
                ? [`${op}:${bindingKindOf(op)}`]
                : []
        );
        expect(derived.length).toBeGreaterThan(15);
        expect(derived).toEqual(hand);
    });

    it("ref checker: the non-`bind` declarations == its per-Op blocks, plus exileTopOfLibrary.bindAll", () => {
        const derived = SCHEMA_OP_NAMES.flatMap((op) =>
            bindingDeclarationsOf(op)
                .filter((d) => d.field !== "bind")
                .map(
                    (d) =>
                        `${op}.${d.field}:${d.binding}${d.scopedTo ? `@${d.scopedTo}` : ""}`
                )
        );
        // Transcribed from `checkOpListRefs`'s blocks, one row per block arm.
        const hand = [
            "choice.bindOther:snapshot",
            "counter.bindSource:snapshot",
            "moveZone.bindCount:number",
            "moveZone.bindAll:picks",
            "coinFlipSeries.bindFlips:number",
            "coinFlipSeries.bindWins:number",
            "coinFlipSeries.bindLosses:number",
            "mill.bindAll:picks",
            "castDuringResolution.resultBind:boolean",
            "divideIntoPiles.chosenBind:list@chosenEffect",
            "divideIntoPiles.otherBind:list@otherEffect",
        ];
        expect(sorted(derived)).toEqual(
            sorted([...hand, "exileTopOfLibrary.bindAll:picks"])
        );
    });
});
