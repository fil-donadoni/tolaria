// Equipment: the "Equipped creature …" static frame (CR 301.5a) and the
// Equipment's own attach (CR 701.3a), issue #7215 — read once an "Equip {N}"
// line parsed (issue #7214).
//
// Layers:
//
//  1. GOLDEN fixtures — a real corpus Equipment compiled whole must produce
//     exactly this Compiled Definition, one per accepted form: the P/T clause
//     alone, the P/T clause with a keyword list (one keyword and several), a
//     keyword list alone, the enters trigger's "attach it", and an activated
//     "Attach this Equipment".
//  2. REFUSALS — the neighbours the corpus prints that these rules do not
//     read, so fail-closed is pinned rather than assumed.

import { describe, expect, it } from "vitest";
import type {
    ActivatedAbility,
    CardDefinition,
    TargetRequirement,
} from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { oracleCard, parseContext } from "./oracle.fixture";

const EQUIPMENT = "Artifact — Equipment";

function equipment(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        typeLine: EQUIPMENT,
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectDefinition(
    card: ReturnType<typeof oracleCard>,
    expected: Partial<CardDefinition> & Record<string, unknown>
) {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

/** CR 702.6a — the equip ability every golden prints, as `equipAbility`
 *  builds it ("Equip {0}" costs no mana at all). */
function equip(
    slug: string,
    generic: number,
    oracleText: string
): ActivatedAbility {
    return {
        id: `${slug}-equip`,
        oracleText,
        cost: { mana: generic === 0 ? {} : { generic } },
        sorcerySpeedOnly: true,
        targetRequirement: { type: "Creature", count: 1, controller: "you" },
        useStack: true,
        effects: [{ op: "attach", target: { target: 0 } }],
    };
}

const EQUIPMENT_SHELL: Pick<CardDefinition, "types" | "subtypes"> = {
    types: ["Artifact"],
    subtypes: ["Equipment"],
};

const EQUIP_1_REMINDER =
    "Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)";

describe("Equipped creature — golden fixtures (CR 301.5a)", () => {
    // CR 613.4c — the P/T clause alone, scoped to the host.
    it("a P/T clause alone: Vulshok Morningstar", () => {
        const text =
            "Equipped creature gets +2/+2.\nEquip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)";
        expectDefinition(equipment("Vulshok Morningstar", "{2}", text), {
            ...EQUIPMENT_SHELL,
            name: "Vulshok Morningstar",
            manaCost: { X: 2 },
            oracleText: text,
            activatedAbilities: [equip("vulshok-morningstar", 2, "Equip {2}")],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 2, toughness: 2 },
            ],
        });
    });

    // CR 613.1f — a P/T clause joined to ONE keyword: the cluster's two
    // claimed keys, haste and flying.
    it("a P/T clause and haste: Boots of Speed", () => {
        const text = `Equipped creature gets +1/+0 and has haste.\n${EQUIP_1_REMINDER}`;
        expectDefinition(equipment("Boots of Speed", "{R}", text), {
            ...EQUIPMENT_SHELL,
            name: "Boots of Speed",
            manaCost: { R: 1 },
            oracleText: text,
            activatedAbilities: [equip("boots-of-speed", 1, "Equip {1}")],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 1, toughness: 0 },
                { kind: "keyword-grant", appliesTo: "host", keyword: "haste" },
            ],
        });
    });

    it("a P/T clause and flying: Kitesail", () => {
        const text =
            "Equipped creature gets +1/+0 and has flying.\nEquip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)";
        expectDefinition(equipment("Kitesail", "{2}", text), {
            ...EQUIPMENT_SHELL,
            name: "Kitesail",
            manaCost: { X: 2 },
            oracleText: text,
            activatedAbilities: [equip("kitesail", 2, "Equip {2}")],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 1, toughness: 0 },
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "flying",
                },
            ],
        });
    });

    // A keyword LIST: one descriptor per printed keyword, in printed order.
    it("a P/T clause and a keyword list: Loxodon Warhammer", () => {
        const text =
            "Equipped creature gets +3/+0 and has trample and lifelink.\nEquip {3}";
        expectDefinition(equipment("Loxodon Warhammer", "{3}", text), {
            ...EQUIPMENT_SHELL,
            name: "Loxodon Warhammer",
            manaCost: { X: 3 },
            oracleText: text,
            activatedAbilities: [equip("loxodon-warhammer", 3, "Equip {3}")],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 3, toughness: 0 },
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "trample",
                },
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "lifelink",
                },
            ],
        });
    });

    it("a keyword list alone: Lightning Greaves", () => {
        const text =
            "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}";
        expectDefinition(equipment("Lightning Greaves", "{2}", text), {
            ...EQUIPMENT_SHELL,
            name: "Lightning Greaves",
            manaCost: { X: 2 },
            oracleText: text,
            activatedAbilities: [equip("lightning-greaves", 0, "Equip {0}")],
            compiledStaticEffects: [
                { kind: "keyword-grant", appliesTo: "host", keyword: "haste" },
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "shroud",
                },
            ],
        });
    });
});

describe("Attach this Equipment — golden fixtures (CR 701.3a, CR 301.5)", () => {
    // CR 608.2h — "it" behind the Equipment's own enters head IS the source.
    it("triggered, 'attach it' on the Equipment's own enters head: Utility Knife", () => {
        const text =
            "When this Equipment enters, attach it to target creature you control.\nEquipped creature gets +1/+1.\nEquip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)";
        const requirement: TargetRequirement = {
            type: "Creature",
            count: 1,
            controller: "you",
        };
        expectDefinition(equipment("Utility Knife", "{1}", text), {
            ...EQUIPMENT_SHELL,
            name: "Utility Knife",
            manaCost: { X: 1 },
            oracleText: text,
            activatedAbilities: [equip("utility-knife", 3, "Equip {3}")],
            compiledTriggeredAbilities: [
                {
                    id: "utility-knife-trigger",
                    oracleText:
                        "When this Equipment enters, attach it to target creature you control.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: requirement,
                    effects: [{ op: "attach", target: { target: 0 } }],
                },
            ],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 1, toughness: 1 },
            ],
        });
    });

    it("activated, 'Attach this Equipment' at instant speed: Horned Helm", () => {
        const text = `Equipped creature gets +1/+1 and has trample.\n{G}{G}: Attach this Equipment to target creature you control.\n${EQUIP_1_REMINDER}`;
        expectDefinition(equipment("Horned Helm", "{2}", text), {
            ...EQUIPMENT_SHELL,
            name: "Horned Helm",
            manaCost: { X: 2 },
            oracleText: text,
            activatedAbilities: [
                {
                    id: "horned-helm-ability",
                    oracleText:
                        "{G}{G}: Attach this Equipment to target creature you control.",
                    cost: { mana: { G: 2 } },
                    useStack: true,
                    effects: [{ op: "attach", target: { target: 0 } }],
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "you",
                    },
                },
                equip("horned-helm", 1, "Equip {1}"),
            ],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 1, toughness: 1 },
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "trample",
                },
            ],
        });
    });
});

describe("Equipment — refused neighbours", () => {
    const BOOTS = equipment(
        "Boots of Speed",
        "{R}",
        `Equipped creature gets +1/+0 and has haste.\n${EQUIP_1_REMINDER}`
    );

    // Each line is a real corpus card's, routed on an Equipment so the
    // refusal is the frame's and not the card-level Equipment check.
    it.each([
        [
            "a quoted ability (Sunfire Torch)",
            'Equipped creature gets +1/+0 and has "Whenever this creature attacks, you may sacrifice Sunfire Torch. When you do, Sunfire Torch deals 2 damage to any target."',
        ],
        [
            "a parameterised keyword outside the vocabulary (Lightning Rig-style ward)",
            "Equipped creature gets +1/+0 and has haste and ward {1}.",
        ],
        [
            "an ability loss (Starforged Sword)",
            "Equipped creature gets +3/+3 and loses flying.",
        ],
        [
            "a type change (Runed Stalactite)",
            "Equipped creature gets +1/+1 and is every creature type.",
        ],
        [
            "a counted P/T (Pennon Blade)",
            "Equipped creature gets +1/+1 for each creature you control.",
        ],
        [
            "an untap restriction (T-45 Power Armor)",
            "Equipped creature gets +3/+3 and doesn't untap during its controller's untap step.",
        ],
        [
            "a timed P/T (Hookblade)",
            "During your turn, equipped creature has flying.",
        ],
    ])("refuses %s", (_label, line) => {
        expect(routeLine(line, parseContext(BOOTS)).ok).toBe(false);
    });

    // CR 301.5 — no printed non-Equipment says "Equipped creature …" at the
    // head of a line, so this is Boots of Speed retyped: the one place the
    // card-level check is reachable.
    it("refuses the frame on a card that is not an Equipment (Boots of Speed, retyped)", () => {
        const card = oracleCard({
            ...BOOTS,
            typeLine: "Artifact",
        });
        expect(
            routeLine(
                "Equipped creature gets +1/+0 and has haste.",
                parseContext(card)
            ).ok
        ).toBe(false);
    });

    // CR 301.5c — an Equipment creature equips only through reconfigure,
    // which no rule reads: Utility Knife retyped as an artifact creature.
    it("refuses an Equipment creature's attach (Utility Knife, retyped)", () => {
        const card = oracleCard({
            name: "Utility Knife",
            manaCost: "{1}",
            typeLine: "Artifact Creature — Equipment",
            oracleText:
                "When this Equipment enters, attach it to target creature you control.",
            power: "1",
            toughness: "1",
        });
        expect(compileCard(card).state).toBe("unparsed");
    });

    // CR 608.2h + CR 701.3a — behind a per-creature attack head "it" is the
    // attacking creature, not the source the `attach` Op moves: Utility Knife
    // with its head swapped. Refused, never re-pointed at the source.
    it("refuses 'attach it' where the head's 'it' is another creature (Utility Knife, head swapped)", () => {
        const card = equipment(
            "Utility Knife",
            "{1}",
            "Whenever a creature you control attacks, attach it to target creature you control."
        );
        const outcome = compileCard(card);
        expect(outcome.state).toBe("unparsed");
        expect(JSON.stringify(outcome)).toContain(
            '\\"attach it\\" names a mover that is not this ability\'s source'
        );
    });
});
