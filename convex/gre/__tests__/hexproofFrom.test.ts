// "Hexproof from [quality]" (CR 702.11d) and its CR 702.11e identity with
// hexproof (issue #2604).
//
//  1. The parser (`parseHexproofQuality`) — names monocolored, multicolored
//     and the five colours; FAILS CLOSED on every other quality.
//  2. The targeting guard (`isGuardedAgainst`, the one predicate the offered
//     set, the accepted set, resolution and the client click gate share):
//     an opponent's [quality] spell / ability from a [quality] source is
//     barred, a non-[quality] one and the controller's own are not.
//  3. CR 702.11e — an effect removing hexproof removes hexproof-from (the
//     `loseAbility` Op and a layer-6 `keyword-remove` static), and an effect
//     looking for hexproof finds it (`requireAbility`).
//  4. The catalogue guard — no shipped card declares a hexproof-from string
//     the parser cannot name.

import { describe, expect, it } from "vitest";
import {
    getAllCatalogueCards,
    getCardByName,
    registerTokenDefinition,
} from "../../cards";
import type { CardDefinition, Color } from "../../cards/types";
import { matchesPermanentFilter } from "../../cards/filters";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    hasHexproofQuality,
    isHexproofFromAbility,
    keywordDenotes,
    parseHexproofQuality,
} from "../hexproofQuality";
import { isGuardedAgainst } from "../permanentGuard";
import {
    beginApplyingStaticEffects,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const ROKIRIC = () => getCardByName("General Ferrous Rokiric").id;

function rokiricBoard(): { state: GameState; rokiric: CardInstanceState } {
    const rokiric = makeInstance(ROKIRIC(), {
        id: "rokiric",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [rokiric] }),
            makePlayer("p2"),
        ],
    });
    return { state, rokiric };
}

const guarded = (
    state: GameState,
    target: CardInstanceState,
    colors: Color[],
    controllerId: string,
    isSpell: boolean
) =>
    isGuardedAgainst(state, target, "cantBeTargeted", {
        colors,
        controllerId,
        isSpell,
    });

describe("parseHexproofQuality (CR 702.11d)", () => {
    it("names monocolored, multicolored and each colour", () => {
        expect(parseHexproofQuality("hexproof from monocolored")).toEqual({
            kind: "monocolored",
        });
        expect(parseHexproofQuality("hexproof from multicolored")).toEqual({
            kind: "multicolored",
        });
        expect(parseHexproofQuality("hexproof from black")).toEqual({
            kind: "color",
            color: "B",
        });
    });

    it("FAILS CLOSED on a quality it cannot name", () => {
        for (const s of [
            "hexproof from artifacts and enchantments",
            "hexproof from each color",
            "hexproof from planeswalkers",
            "hexproof from colorless",
            "hexproof from ",
            "hexproof",
        ]) {
            expect(parseHexproofQuality(s), s).toBeNull();
        }
        expect(isHexproofFromAbility("hexproof from planeswalkers")).toBe(true);
        expect(isHexproofFromAbility("hexproof")).toBe(false);
    });

    it("CR 105.2a-c — monocolored is exactly one colour; colourless is neither", () => {
        const mono = { kind: "monocolored" } as const;
        const multi = { kind: "multicolored" } as const;
        expect(hasHexproofQuality(mono, ["R"])).toBe(true);
        expect(hasHexproofQuality(mono, ["R", "W"])).toBe(false);
        expect(hasHexproofQuality(mono, [])).toBe(false);
        expect(hasHexproofQuality(mono, ["C"])).toBe(false);
        expect(hasHexproofQuality(multi, ["R", "W"])).toBe(true);
        expect(hasHexproofQuality(multi, ["R"])).toBe(false);
        expect(hasHexproofQuality(multi, [])).toBe(false);
    });
});

describe("hexproof from monocolored — the targeting guard (CR 702.11d)", () => {
    it("General Ferrous Rokiric declares the keyword", () => {
        expect(
            getCardByName("General Ferrous Rokiric").staticAbilities
        ).toEqual(["hexproof from monocolored"]);
    });

    it("bars an opponent's monocolored spell", () => {
        const { state, rokiric } = rokiricBoard();
        expect(guarded(state, rokiric, ["R"], "p2", true)).toBe(true);
    });

    it("lets an opponent's multicolored or colourless spell through", () => {
        const { state, rokiric } = rokiricBoard();
        expect(guarded(state, rokiric, ["R", "W"], "p2", true)).toBe(false);
        expect(guarded(state, rokiric, [], "p2", true)).toBe(false);
    });

    it("bars an opponent's ability from a monocolored SOURCE, not from a multicolored one", () => {
        const { state, rokiric } = rokiricBoard();
        expect(guarded(state, rokiric, ["U"], "p2", false)).toBe(true);
        expect(guarded(state, rokiric, ["W", "G"], "p2", false)).toBe(false);
    });

    it("lets the controller target their own permanent with a monocolored spell", () => {
        const { state, rokiric } = rokiricBoard();
        expect(guarded(state, rokiric, ["R"], "p1", true)).toBe(false);
    });

    it("guards only targeting — no other clause", () => {
        const { state, rokiric } = rokiricBoard();
        expect(isGuardedAgainst(state, rokiric, "cantBeEnchanted")).toBe(false);
        expect(isGuardedAgainst(state, rokiric, "indestructible")).toBe(false);
    });

    it("a colour quality bars that colour only", () => {
        const { state, rokiric } = rokiricBoard();
        rokiric.staticAbilities = ["hexproof from black"];
        expect(guarded(state, rokiric, ["B"], "p2", true)).toBe(true);
        expect(guarded(state, rokiric, ["B", "R"], "p2", true)).toBe(true);
        expect(guarded(state, rokiric, ["R"], "p2", true)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.11e — a "hexproof from [quality]" ability IS a hexproof ability
// ─────────────────────────────────────────────────────────────────────────

const LOSE_HEXPROOF = "test-hexproof-from-lose-hexproof";
registerTokenDefinition({
    id: LOSE_HEXPROOF,
    name: LOSE_HEXPROOF,
    rarity: "common",
    // Colourless, like Shadowspear: a monocolored spell could not target the
    // permanent in the first place (CR 702.11d, CR 608.2b).
    manaCost: { X: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "loseAbility",
            target: { target: 0 },
            ability: "hexproof",
            duration: { phase: "end-of-turn" },
        },
    ],
});

const HEXPROOF_STRIPPER = "test-hexproof-from-static-stripper";
registerTokenDefinition({
    id: HEXPROOF_STRIPPER,
    name: HEXPROOF_STRIPPER,
    rarity: "common",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "keyword-remove",
            keyword: "hexproof",
            applies: (target, source) =>
                target.controllerId !== source.controllerId,
        },
    ],
} as CardDefinition);

describe("CR 702.11e — hexproof-from is a hexproof ability", () => {
    it("an effect naming hexproof denotes every hexproof-from ability, not the converse", () => {
        expect(keywordDenotes("hexproof from monocolored", "hexproof")).toBe(
            true
        );
        expect(keywordDenotes("hexproof", "hexproof from monocolored")).toBe(
            false
        );
        expect(keywordDenotes("shroud", "hexproof")).toBe(false);
    });

    it("loseAbility hexproof (Shadowspear's Op) removes hexproof from monocolored", () => {
        const { state, rokiric } = rokiricBoard();
        pushSpell(state, LOSE_HEXPROOF, "p2", [
            { type: "permanent", id: "rokiric" },
        ]);
        resolveTopOfStack(state);
        expect(rokiric.staticAbilities).not.toContain(
            "hexproof from monocolored"
        );
        // …and the guard goes with it: a monocolored spell can now target it.
        expect(guarded(state, rokiric, ["R"], "p2", true)).toBe(false);
    });

    it("a layer-6 keyword-remove static naming hexproof removes it", () => {
        const { state, rokiric } = rokiricBoard();
        const stripper = makeInstance(HEXPROOF_STRIPPER, {
            id: "stripper",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(stripper);
        beginApplyingStaticEffects(state, stripper);
        expect(rokiric.staticAbilities).not.toContain(
            "hexproof from monocolored"
        );
    });

    it("an effect looking for hexproof finds it (requireAbility)", () => {
        const { rokiric } = rokiricBoard();
        expect(
            matchesPermanentFilter(
                {
                    ...rokiric,
                    staticAbilities: rokiric.staticAbilities,
                } as never,
                { requireAbility: "hexproof" }
            )
        ).toBe(true);
        expect(
            matchesPermanentFilter(rokiric as never, {
                excludeAbility: "hexproof",
            })
        ).toBe(false);
    });
});

describe("catalogue guard — every shipped hexproof-from quality parses (CR 702.11d)", () => {
    it("no card declares a hexproof-from string the parser cannot name", () => {
        const offenders: string[] = [];
        let seen = 0;
        for (const def of getAllCatalogueCards()) {
            for (const s of def.staticAbilities ?? []) {
                if (!isHexproofFromAbility(s)) continue;
                seen += 1;
                if (parseHexproofQuality(s) === null)
                    offenders.push(`${def.name}: "${s}"`);
            }
        }
        expect(offenders).toEqual([]);
        // The sweep reaches the compiled catalogue (Rokiric is compiled).
        expect(seen).toBeGreaterThan(0);
    });
});
