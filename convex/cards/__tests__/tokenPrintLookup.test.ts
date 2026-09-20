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
import { getAllCatalogueCards } from "../catalogue";
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
// Catalogue-wide COMPLETENESS guard (issue #1305): every DSL `createToken` Op
// across every card, activated ability, and triggered ability is walked
// (including the structural constructs a createToken can be nested inside —
// `if`/`else`, `coinFlip` win/loss, `optionChoice` modes, `forEach` bodies,
// and a `delayedTrigger`'s own body). Token art is now auto-resolved at
// creation time (`SpellContext.createToken`, gre/state.ts) from the committed
// `token-prints.json` association keyed by (producing card id, token name), so
// cards no longer hand-wire `imagePrintId`. This guard enforces that EVERY
// token-producing card actually HAS art available: for each token spec, either
//   - the spec carries an explicit `imagePrintId` (shared Treasure/Clue/Food
//     tokens, or a deliberate override), OR
//   - `tokenPrintIdFor(cardId, name)` resolves a printed counterpart (the
//     auto-resolution will supply it at runtime), OR
//   - the (cardId, tokenName) pair is on `NO_PRINTED_TOKEN_ALLOWLIST` — a
//     token that genuinely has no printed Scryfall counterpart (custom tokens,
//     or a producing card whose Scryfall `all_parts` links no such token).
// Anything else FAILS CI: a new token-producing card can never again ship with
// silently missing art (it must either regenerate the lockfile via
// `node scripts/fetch-token-prints.mjs --all`, or be allowlisted with a note).
// ---------------------------------------------------------------------------

/** Tokens that genuinely have NO printed Scryfall counterpart — the accepted
 *  `TokenPlaceholder`-art exceptions. Keyed `"<cardId>:<tokenName>"`. Keep
 *  each entry justified; the guard fails if a listed pair actually DOES have a
 *  print now (so the allowlist can't mask a lockfile that has since caught up). */
const NO_PRINTED_TOKEN_ALLOWLIST: Record<string, string> = {
    // Old cards whose bespoke tokens were never printed as token cards, and
    // for which Scryfall has no same-characteristics substitute print either
    // (verified via `!"<name>" is:token` / `<name> type:token` — zero hits).
    // These render via `TokenPlaceholder` by design.
    "c474cd6b-5610-49eb-ac98-918d900efe8b:Djinn":
        "Bottle of Suleiman (ARN) — 5/5 flying Djinn; no printed Djinn token of these characteristics exists.",
    "1e5f8041-67fc-4e00-b119-d216e5cc5a3a:Caribou":
        "Caribou Range (ICE) — 0/1 white Caribou; no printed Caribou token exists.",
    "82ae30e8-2dcd-46b8-925b-cc24e11fb95d:Minor Demon":
        "Boris Devilboon (LEG) — 1/1 B/R Minor Demon; no printed Minor Demon token exists.",
    "4e6bf56e-2d74-4e4d-a667-885853979377:Wolves of the Hunt":
        "Master of the Hunt (LEG) — 1/1 green Wolf named Wolves of the Hunt; no printed token exists.",
    // Oracle-compiled producers (issue #4125): the card's FIRST printing — its
    // compiled id (ADR 0108) — links no token in Scryfall's `all_parts`, so
    // `fetch-token-prints.mjs --compiled` has nothing to resolve. They render
    // via `TokenPlaceholder` until a pinned substitute exists for compiled cards.
    "198ba150-f3fb-48a7-8c3d-bcb6b263b0a2:Saproling":
        "Selesnya Guildmage (compiled) — first printing's all_parts links no Saproling token.",
    "6d3c539b-4039-45c2-8d43-80648d946e91:Knight":
        "Errand of Duty (compiled) — first printing's all_parts links no Knight token.",
    "9079b01a-d595-4085-9e75-59e31827efeb:Skeleton":
        "Hag of Death's Legion (compiled) — first printing's all_parts links no Skeleton token.",
    "3c1a11b2-bcb8-43e2-9aa3-8e964dec1319:Spirit":
        "Imaginary Friends (compiled) — first printing's all_parts links no Spirit token.",
    "ee334211-4109-46ff-8676-856048221a1c:Kavu":
        "Penumbra Kavu (compiled) — first printing's all_parts links no Kavu token.",
    "9b544ed7-0df1-4fa0-b62c-d4b4a79bc121:Faerie Dragon":
        "Rasaad, Dragon Monk (compiled) — first printing's all_parts links no Faerie Dragon token.",
    "96aa9530-5404-4890-8bd0-40b39393afdd:Skeleton":
        "Rasaad, Shadow Monk (compiled) — first printing's all_parts links no Skeleton token.",
    "e26b4c00-cc85-41a2-8864-4688bef175aa:Boar":
        "Rasaad, Sylvan Monk (compiled) — first printing's all_parts links no Boar token.",
    "154ad44b-0a15-4564-890a-12517d81948f:Soldier":
        "Rasaad, Warrior Monk (compiled) — first printing's all_parts links no Soldier token.",
    "18cd73f4-78ba-404b-bdb2-7213a56daa4f:Saproling":
        "Scatter the Seeds (compiled) — first printing's all_parts links no Saproling token.",
    "951473f8-6925-4fe4-8595-ad4886282330:Saproling":
        "Thallid Germinator (compiled) — first printing's all_parts links no Saproling token.",
    "d0eee2d9-bb7e-40d8-b1bf-ca98c107c5d2:Saproling":
        "Thallid Shell-Dweller (compiled) — first printing's all_parts links no Saproling token.",
    "1131c187-8fc3-4cee-9422-355ef6622de7:Elemental":
        "Wand of the Elements (compiled) — first printing's all_parts links no Elemental token.",
    "940180bb-8781-425f-9eeb-7eb0fad7a188:Saproling":
        "Selesnya Evangel (compiled) — first printing's all_parts links no Saproling token.",
};

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

// The walk covers the WHOLE catalogue — hand-written AND Oracle-compiled
// (issue #4125). A compiled card resolves its token art through the same
// `tokenPrintIdFor(producerId, name)` lookup at runtime, so a grammar rule
// that graduates a token producer owes the same art a hand-written author does.
describe("createToken art completeness catalogue guard (issue #1305)", () => {
    it("every DSL createToken spec has resolvable art (print, explicit, or allowlisted)", () => {
        const missing: string[] = [];
        for (const card of getAllCatalogueCards()) {
            for (const spec of allTokenSpecsFor(card)) {
                const printed = tokenPrintIdFor(card.id, spec.name);
                const key = `${card.id}:${spec.name}`;
                const allowlisted = key in NO_PRINTED_TOKEN_ALLOWLIST;
                const hasArt =
                    spec.imagePrintId !== undefined || printed !== undefined;
                if (!hasArt && !allowlisted) {
                    missing.push(
                        `${card.name} (${card.id}): token "${spec.name}" has NO token art — regenerate token-prints.json (node scripts/fetch-token-prints.mjs --all; --compiled for a compiled card) or add "${key}" to NO_PRINTED_TOKEN_ALLOWLIST`
                    );
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("no allowlist entry masks a token that DOES have a print now", () => {
        const stale: string[] = [];
        for (const card of getAllCatalogueCards()) {
            for (const spec of allTokenSpecsFor(card)) {
                const key = `${card.id}:${spec.name}`;
                if (
                    key in NO_PRINTED_TOKEN_ALLOWLIST &&
                    tokenPrintIdFor(card.id, spec.name) !== undefined
                ) {
                    stale.push(
                        `${key} is allowlisted as art-less but now has a printed counterpart — drop it from NO_PRINTED_TOKEN_ALLOWLIST`
                    );
                }
            }
        }
        expect(stale).toEqual([]);
    });
});
