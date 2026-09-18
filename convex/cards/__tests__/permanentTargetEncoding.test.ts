// "Target permanent" is the permanent-type list, never "any" (issues #3073,
// #3046).
//
// CR 115.4 "any target" is a creature, player, planeswalker or battle — the
// engine's `"any"` admits the DAMAGEABLE permanent types plus, when no colour
// filter closes it, PLAYERS (`getLegalTargets`, gre/rules.ts). CR 110.1 "a
// permanent" is a card or token on the battlefield, of any of CR 110.4's six types. So a
// "destroy target permanent" written as `type: "any"` misses artifacts,
// enchantments and lands, and — with no colour filter — can target a player.

import { describe, expect, it } from "vitest";
import { getAllCatalogueCards } from "../catalogue";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../gre/rules";
import type { CardDefinition, TargetRequirement } from "../types";
import { makeInstance, makePlayer, makeState } from "./setup";

// Northern Paladin retired in issue #4027 (ADR 0114) — it is no longer in
// `getAllCards()` (hand-written only), but the catalogue-wide sweep below
// wants every card, compiled twin included.
const CARDS = getAllCatalogueCards();
const byName = (name: string): CardDefinition => {
    const def = CARDS.find((c) => c.name === name);
    if (!def) throw new Error(`no card named ${name}`);
    return def;
};

/** A "target <words> permanent" phrase, read off one Oracle sentence. */
const TARGET_PERMANENT = /\btarget (?:[\w'-]+ )*?permanents?\b/i;

interface RequirementSite {
    readonly card: string;
    readonly path: string;
    readonly oracleText: string;
    readonly requirement: TargetRequirement;
}

/** Every `targetRequirement` in the catalogue, with the Oracle text of the
 *  mode / ability that owns it (the card's own text at top level). */
function requirementSites(): RequirementSite[] {
    const out: RequirementSite[] = [];
    const walk = (
        card: CardDefinition,
        node: Record<string, unknown>,
        path: string,
        inherited: string
    ): void => {
        const oracleText =
            typeof node.oracleText === "string" ? node.oracleText : inherited;
        const requirement = node.targetRequirement as
            | TargetRequirement
            | undefined;
        if (requirement)
            out.push({ card: card.name, path, oracleText, requirement });
        // A kicked requirement shares its owner's Oracle text (CR 702.33).
        const kicked = node.kickedTargetRequirement as
            | TargetRequirement
            | undefined;
        if (kicked)
            out.push({
                card: card.name,
                path: `${path}.kickedTargetRequirement`,
                oracleText,
                requirement: kicked,
            });
        for (const key of [
            "modes",
            "activatedAbilities",
            "triggeredAbilities",
        ]) {
            const children = node[key];
            if (!Array.isArray(children)) continue;
            children.forEach((child, i) =>
                walk(card, child, `${path}.${key}[${i}]`, oracleText)
            );
        }
    };
    for (const card of CARDS)
        walk(
            card,
            card as unknown as Record<string, unknown>,
            "",
            card.oracleText ?? ""
        );
    return out;
}

describe('catalogue — "target … permanent" is never CR 115.4 "any"', () => {
    it("no requirement whose own Oracle text says target … permanent uses type any", () => {
        const sites = requirementSites();
        // Vacuity guard: the sweep sees the class it polices.
        expect(
            sites.filter((s) => TARGET_PERMANENT.test(s.oracleText)).length
        ).toBeGreaterThan(10);
        const offenders = sites
            .filter((s) => TARGET_PERMANENT.test(s.oracleText))
            .filter((s) => {
                const types = Array.isArray(s.requirement.type)
                    ? s.requirement.type
                    : [s.requirement.type];
                return types.includes("any");
            })
            .map((s) => `${s.card}${s.path}`);
        expect(offenders).toEqual([]);
    });
});

/** The requirement of a card's mode / activated ability, or its own. */
function requirementOf(
    name: string,
    where?: { mode?: string; ability?: number }
): TargetRequirement {
    const def = byName(name);
    const req =
        where?.mode !== undefined
            ? def.modes?.find((m) => m.id === where.mode)?.targetRequirement
            : where?.ability !== undefined
              ? def.activatedAbilities?.[where.ability]?.targetRequirement
              : def.targetRequirement;
    if (!req) throw new Error(`${name}: no targetRequirement`);
    return req;
}

const ID = {
    island: byName("Island").id,
    karakas: byName("Karakas").id,
    controlMagic: byName("Control Magic").id, // blue enchantment
    firebreathing: byName("Firebreathing").id, // red enchantment
    animateDead: byName("Animate Dead").id, // black enchantment
    grizzlyBears: byName("Grizzly Bears").id, // green creature
};

/** p1 casts / activates; p2 controls the candidate permanents unless the
 *  fixture says otherwise. */
function legalIds(
    req: TargetRequirement,
    permanents: { id: string; cardId: string; controllerId?: string }[]
): string[] {
    const p1 = makePlayer("p1", {
        battlefield: permanents
            .filter((p) => p.controllerId === "p1")
            .map((p) =>
                makeInstance(p.cardId, { id: p.id, controllerId: "p1" })
            ),
    });
    const p2 = makePlayer("p2", {
        battlefield: permanents
            .filter((p) => p.controllerId !== "p1")
            .map((p) =>
                makeInstance(p.cardId, { id: p.id, controllerId: "p2" })
            ),
    });
    const state = makeState({ players: [p1, p2] });
    return getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1").map(
        (t) => t.id
    );
}

describe("Desert Twister — destroy target permanent (CR 110.4, 701.8)", () => {
    it("a land is a legal target; a player is not", () => {
        const legal = legalIds(requirementOf("Desert Twister"), [
            { id: "land", cardId: ID.island },
            { id: "ench", cardId: ID.firebreathing },
        ]);
        expect(legal).toEqual(expect.arrayContaining(["land", "ench"]));
        expect(legal).not.toContain("p1");
        expect(legal).not.toContain("p2");
    });
});

describe.each([
    ["Active Volcano", { mode: "destroy-blue" }, "blue", "red"],
    ["Red Elemental Blast", { mode: "destroy" }, "blue", "red"],
    ["Pyroblast", { mode: "destroy" }, "blue", "red"],
    ["Flash Flood", { mode: "destroy-red" }, "red", "blue"],
    ["Blue Elemental Blast", { mode: "destroy" }, "red", "blue"],
    ["Hydroblast", { mode: "destroy" }, "red", "blue"],
] as const)(
    "%s — destroy target coloured permanent (CR 110.4, 105.2)",
    (name, where, legalColour, illegalColour) => {
        it(`a ${legalColour} enchantment is a legal target; a ${illegalColour} one and a player are not`, () => {
            const cardOf = { blue: ID.controlMagic, red: ID.firebreathing };
            const legal = legalIds(requirementOf(name, where), [
                { id: "hit", cardId: cardOf[legalColour] },
                { id: "miss", cardId: cardOf[illegalColour] },
            ]);
            expect(legal).toContain("hit");
            expect(legal).not.toContain("miss");
            expect(legal).not.toContain("p1");
            expect(legal).not.toContain("p2");
        });
    }
);

describe("Northern Paladin — destroy target black permanent (CR 110.4, 105.2)", () => {
    it("the ability's text matches the card's", () => {
        const def = byName("Northern Paladin");
        expect(def.oracleText).toContain(
            def.activatedAbilities?.[0]?.oracleText ?? "<missing>"
        );
    });

    it("a black enchantment is a legal target; a green creature is not", () => {
        const legal = legalIds(
            requirementOf("Northern Paladin", { ability: 0 }),
            [
                { id: "hit", cardId: ID.animateDead },
                { id: "miss", cardId: ID.grizzlyBears },
            ]
        );
        expect(legal).toContain("hit");
        expect(legal).not.toContain("miss");
    });
});

describe("Alchor's Tomb — target permanent you control (CR 110.4)", () => {
    it("a land you control is a legal target; an opponent's land and a player are not", () => {
        const legal = legalIds(requirementOf("Alchor's Tomb", { ability: 0 }), [
            { id: "mine", cardId: ID.island, controllerId: "p1" },
            { id: "theirs", cardId: ID.island },
        ]);
        expect(legal).toContain("mine");
        expect(legal).not.toContain("theirs");
        expect(legal).not.toContain("p1");
        expect(legal).not.toContain("p2");
    });
});

describe("Empress Galina — target legendary permanent (CR 110.4, 205.4a)", () => {
    it("a legendary land is a legal target; a non-legendary one and a player are not", () => {
        const legal = legalIds(
            requirementOf("Empress Galina", { ability: 0 }),
            [
                { id: "hit", cardId: ID.karakas },
                { id: "miss", cardId: ID.island },
            ]
        );
        expect(legal).toContain("hit");
        expect(legal).not.toContain("miss");
        expect(legal).not.toContain("p1");
        expect(legal).not.toContain("p2");
    });
});
