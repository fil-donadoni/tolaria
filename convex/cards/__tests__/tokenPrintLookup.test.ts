// Pins the build-time generated token-print mapping (CR 707.1) and the
// helper that reads it. The mapping itself comes from
// `convex/cards/generated/token-prints.json`, refreshed via
// `node scripts/fetch-token-prints.mjs convex/cards/sets/*.ts`. These tests
// guard against:
//   - the generated file accidentally diverging from the helper API
//   - a regression where a card known to produce a token returns undefined
//     (would silently fall back to the placeholder, masking a missing
//     mapping refresh after adding a token producer)

import { describe, it, expect } from "vitest";
import { tokenPrintIdFor } from "../tokenPrintLookup";
import { getAllCards } from "../index";
import type { CardDefinition, EffectOp, EffectTokenSpec } from "../types";

describe("tokenPrintIdFor (build-time Scryfall reverse-link)", () => {
    const HIVE_ID = "544a7138-eae8-4ff9-9e17-680bfa717183";

    it("returns the printed Wasp Scryfall id for The Hive", () => {
        const id = tokenPrintIdFor(HIVE_ID, "Wasp");
        expect(id).toBe("09921372-126f-4c81-b6d8-ea50b1d0eb44");
    });

    it("name-omitted lookup returns the first entry (single-token card)", () => {
        const id = tokenPrintIdFor(HIVE_ID);
        expect(id).toBe("09921372-126f-4c81-b6d8-ea50b1d0eb44");
    });

    it("name match is case-insensitive", () => {
        expect(tokenPrintIdFor(HIVE_ID, "wasp")).toBe(
            "09921372-126f-4c81-b6d8-ea50b1d0eb44"
        );
        expect(tokenPrintIdFor(HIVE_ID, "WASP")).toBe(
            "09921372-126f-4c81-b6d8-ea50b1d0eb44"
        );
    });

    it("unknown card returns undefined", () => {
        // Random valid-looking UUID that isn't a token producer in the set.
        expect(
            tokenPrintIdFor("ce2d603a-3231-4a8c-bf39-1617586ea870")
        ).toBeUndefined();
    });

    it("known card with wrong tokenName returns undefined", () => {
        expect(tokenPrintIdFor(HIVE_ID, "Soldier")).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Catalogue-wide guard (issue #941): every DSL `createToken` Op across every
// card, activated ability, and triggered ability is walked (including the
// structural constructs a createToken can be nested inside — `if`/`else`,
// `coinFlip` win/loss, `optionChoice` modes, `forEach` bodies, and a
// `delayedTrigger`'s own body). For each token spec found, if
// `token-prints.json` HAS a printed counterpart for that (cardId, tokenName)
// pair, the spec MUST carry the matching `imagePrintId` — silently omitting
// it would regress straight back to issue #941 (placeholder art despite a
// real print existing). A token with genuinely no printed counterpart
// (`tokenPrintIdFor` returns undefined) is a documented exception by
// construction — nothing to assert, nothing to flag.
// ---------------------------------------------------------------------------

/** Recursively collects every `createToken` Op's token spec out of an Op
 *  list, descending into every structural construct that can nest one
 *  (ADR 0045's four frozen constructs, plus the two multi-branch Ops that
 *  reuse the same nested-list shape: `coinFlip`, `optionChoice`). */
function collectTokenSpecs(ops: EffectOp[]): EffectTokenSpec[] {
    const specs: EffectTokenSpec[] = [];
    for (const op of ops) {
        switch (op.op) {
            case "createToken":
                specs.push(op.token);
                break;
            case "if":
                specs.push(...collectTokenSpecs(op.then));
                if (op.else) specs.push(...collectTokenSpecs(op.else));
                break;
            case "forEach":
                specs.push(...collectTokenSpecs(op.effects));
                break;
            case "delayedTrigger":
                specs.push(...collectTokenSpecs(op.effects));
                break;
            case "coinFlip":
                specs.push(...collectTokenSpecs(op.win.effects));
                specs.push(...collectTokenSpecs(op.loss.effects));
                break;
            case "optionChoice":
                for (const mode of op.modes) {
                    specs.push(...collectTokenSpecs(mode.effects));
                }
                break;
            default:
                break;
        }
    }
    return specs;
}

/** Every `effects[]` site on a card that can carry a `createToken` Op: the
 *  spell site itself, plus every activated/triggered ability and grant
 *  template (mirrors `abilitySites` in `effectScripts.test.ts`). */
function allTokenSpecsFor(card: CardDefinition): EffectTokenSpec[] {
    const sites: (EffectOp[] | undefined)[] = [
        card.effects,
        ...(card.activatedAbilities ?? []).map((a) => a.effects),
        ...(card.triggeredAbilities ?? []).map((a) => a.effects),
        ...(card.grantTemplates ?? []).map((a) => a.effects),
        ...(card.triggeredGrantTemplates ?? []).map((a) => a.effects),
    ];
    return sites
        .filter((effects): effects is EffectOp[] => effects !== undefined)
        .flatMap(collectTokenSpecs);
}

describe("createToken imagePrintId catalogue guard (issue #941)", () => {
    it("every DSL createToken spec with a known printed counterpart carries imagePrintId", () => {
        const missing: string[] = [];
        for (const card of getAllCards()) {
            for (const spec of allTokenSpecsFor(card)) {
                const printed = tokenPrintIdFor(card.id, spec.name);
                if (printed && spec.imagePrintId !== printed) {
                    missing.push(
                        `${card.name} (${card.id}): token "${spec.name}" has a printed counterpart (${printed}) but imagePrintId is ${JSON.stringify(spec.imagePrintId)}`
                    );
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
