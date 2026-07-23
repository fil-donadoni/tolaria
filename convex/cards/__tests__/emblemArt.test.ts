// Emblem art + registration completeness catalogue guard (CR 114).
//
// The emblem analogue of the `createToken` art guard
// (`tokenPrintLookup.test.ts`, issue #1305). An emblem an effect creates is
// referenced by KEY only (`{ op: "emblem", emblem: <id> }`); its art, name and
// abilities live in `EMBLEM_REGISTRY` (`convex/cards/emblems.ts`). Two silent
// failure modes this guard catches — both shipped once on Chandra, Torch of
// Defiance's −7 emblem:
//
//   1. No `imagePrintId` on the emblem definition → the command-zone tile and
//      the stack row render a text-only placeholder instead of the emblem card
//      art (`board-emblem.tsx`, `stack-row.tsx`).
//   2. A card references an emblem id that isn't registered, or a registered
//      emblem's triggered ability has no `oracleText` → the stack row's
//      `getTriggeredAbilityOracleText` has nothing to show (and a bare
//      `getEmblemDefinition` on an unregistered id throws at resolution).
//
// Standard procedure (mirrors token art): every emblem a shipped card can
// create MUST carry `imagePrintId` (the emblem's own printing where present —
// Scryfall `t:emblem`, layout `emblem` — else a same-characteristics
// substitute, per the token/emblem art rule) and renderable ability text.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import {
    getAllEmblemDefinitions,
    isRegisteredEmblem,
    tryGetEmblemDefinition,
} from "../emblems";
import type { CardDefinition, EffectOp } from "../types";

/** Recursively collects every `emblem` Op's emblem id out of an Op list,
 *  descending into the four frozen structural constructs plus the two
 *  multi-branch Ops — the exact traversal `collectTokenSpecs` uses. */
function collectEmblemIds(ops: EffectOp[]): string[] {
    const ids: string[] = [];
    for (const op of ops) {
        switch (op.op) {
            case "emblem":
                ids.push(op.emblem);
                break;
            case "if":
                ids.push(...collectEmblemIds(op.then));
                if (op.else) ids.push(...collectEmblemIds(op.else));
                break;
            case "forEach":
                ids.push(...collectEmblemIds(op.effects));
                break;
            case "delayedTrigger":
                ids.push(...collectEmblemIds(op.effects));
                break;
            case "coinFlip":
                ids.push(...collectEmblemIds(op.win.effects));
                ids.push(...collectEmblemIds(op.loss.effects));
                break;
            case "optionChoice":
                for (const mode of op.modes) {
                    ids.push(...collectEmblemIds(mode.effects));
                }
                break;
            default:
                break;
        }
    }
    return ids;
}

/** Every `effects[]` site on a card that can carry an `emblem` Op (mirrors
 *  `allTokenSpecsFor`). */
function allEmblemIdsFor(card: CardDefinition): string[] {
    const sites: (EffectOp[] | undefined)[] = [
        card.effects,
        ...(card.activatedAbilities ?? []).map((a) => a.effects),
        ...(card.triggeredAbilities ?? []).map((a) => a.effects),
        ...(card.grantTemplates ?? []).map((a) => a.effects),
        ...(card.triggeredGrantTemplates ?? []).map((a) => a.effects),
    ];
    return sites
        .filter((effects): effects is EffectOp[] => effects !== undefined)
        .flatMap(collectEmblemIds);
}

describe("emblem art + registration catalogue guard (CR 114)", () => {
    it("every registered emblem ships with imagePrintId (renderable art)", () => {
        const missing = getAllEmblemDefinitions()
            .filter((e) => e.imagePrintId === undefined)
            .map(
                (e) =>
                    `emblem "${e.id}" (${e.name}) has NO imagePrintId — set the Scryfall emblem print id (t:emblem, layout "emblem"; the card's own set where present)`
            );
        expect(missing).toEqual([]);
    });

    it("every registered emblem's triggered abilities have oracle text (stack renders)", () => {
        const missing: string[] = [];
        for (const emblem of getAllEmblemDefinitions()) {
            for (const ability of emblem.triggeredAbilities ?? []) {
                if (!ability.oracleText) {
                    missing.push(
                        `emblem "${emblem.id}" triggered ability "${ability.id}" has no oracleText — the stack row cannot render it`
                    );
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("every emblem a shipped card creates is registered and has art", () => {
        const problems: string[] = [];
        for (const card of getAllCards()) {
            for (const emblemId of allEmblemIdsFor(card)) {
                if (!isRegisteredEmblem(emblemId)) {
                    problems.push(
                        `${card.name} (${card.id}) creates emblem "${emblemId}" but no emblem is registered under that id (EMBLEM_REGISTRY) — resolution would throw`
                    );
                    continue;
                }
                if (
                    tryGetEmblemDefinition(emblemId)?.imagePrintId === undefined
                ) {
                    problems.push(
                        `${card.name} (${card.id}) creates emblem "${emblemId}" which has no imagePrintId — set the Scryfall emblem print id`
                    );
                }
            }
        }
        expect(problems).toEqual([]);
    });
});
