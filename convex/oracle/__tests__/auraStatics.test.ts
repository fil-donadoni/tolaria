// Static slot: Aura statics — "Enchanted <noun> …" and "You control enchanted
// <noun>" (CR 303.4b, issue #3833).
//
// Three layers, each watching a different way a host-scoped static can go
// wrong:
//
//  1. GOLDEN fixtures — a real corpus Aura, compiled whole, must produce
//     exactly this Compiled Definition. One row per form the frames accept:
//     P/T buff, keyword list, protection pair, the CR 702.16n rider, an
//     ability granted in quotation marks, control change, and the combat
//     restrictions (alone and joined to a P/T clause).
//  2. REFUSALS — every tail the frames do not read fails the line WHOLE, and
//     the card-level checks (an Aura, whose enchant line can host the noun).
//     Hand-written Auras are covered catalogue-wide by Guard C
//     (`cards/__tests__/compilerRoundTrip.test.ts`), whose baseline this
//     issue drained.
//  3. BEHAVIOUR — a compiled Aura resolved onto a creature through the REAL
//     stack and the REAL registry seam, asserted through `projectPublicState`
//     where the board shows the effect (`.claude/rules/gre-development.md`
//     § Wire format test).

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { projectPublicState } from "../../gameProjections";
import { getEffectiveActivatedAbilities } from "../../gre/activatedAbilities";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
} from "../../gre/combat";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { checkStateBasedActions } from "../../gre/sba";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import type { CompiledDefinition, OracleCard } from "../types";

const AURA = "Enchantment — Aura";

function aura(
    name: string,
    manaCost: string,
    oracleText: string,
    oracleId = `test-${name}`
): OracleCard {
    return {
        oracleId,
        name,
        manaCost,
        typeLine: AURA,
        oracleText,
        layout: "normal",
    };
}

/** The whole Compiled Definition, or the reasons it was refused. */
function compiledOf(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `unparsed: ${outcome.gaps.map((g) => `${g.fragment} (${g.reason})`).join("; ")}`
        );
    return outcome.definition;
}

/** The refusal reasons for a card that must NOT compile. */
function refusedOf(card: OracleCard): string {
    const outcome = compileCard(card);
    expect(outcome.state, `expected ${card.name} to be refused`).toBe(
        "unparsed"
    );
    return outcome.state === "unparsed"
        ? outcome.gaps.map((g) => g.reason).join("; ")
        : "";
}

const CREATURE_AURA = {
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
} as const;

// ── 1. Golden fixtures ─────────────────────────────────────────────────────

/** [real corpus card, the Compiled Definition it must produce]. */
const GOLDEN: readonly (readonly [OracleCard, CompiledDefinition])[] = [
    // CR 613.4c — the P/T buff, scoped to the host, never to a set.
    [
        aura(
            "Holy Strength",
            "{W}",
            "Enchant creature\nEnchanted creature gets +1/+2.",
            "9357de36-f8be-4f49-b2c8-9fe9eaf82b07"
        ),
        {
            ...CREATURE_AURA,
            name: "Holy Strength",
            manaCost: { W: 1 },
            oracleText: "Enchant creature\nEnchanted creature gets +1/+2.",
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 1, toughness: 2 },
            ],
        },
    ],
    // CR 613.1f — a P/T clause joined to a keyword LIST: one descriptor per
    // printed effect, in printed order (the catalogue's own shape).
    [
        aura(
            "Wings of Aesthir",
            "{W}{U}",
            "Enchant creature\nEnchanted creature gets +1/+0 and has flying and first strike.",
            "06413d87-d119-4c04-93d5-5ced7ad4a858"
        ),
        {
            ...CREATURE_AURA,
            name: "Wings of Aesthir",
            manaCost: { W: 1, U: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature gets +1/+0 and has flying and first strike.",
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 1, toughness: 0 },
                { kind: "keyword-grant", appliesTo: "host", keyword: "flying" },
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "first strike",
                },
            ],
        },
    ],
    // CR 702.16a — "protection from X and from Y" is TWO instances, the way
    // the catalogue writes a printed one (two `staticAbilities` strings).
    [
        aura(
            "Mask of Law and Grace",
            "{W}",
            "Enchant creature\nEnchanted creature has protection from black and from red.",
            "21474195-5d91-466d-8874-4818c900dea7"
        ),
        {
            ...CREATURE_AURA,
            name: "Mask of Law and Grace",
            manaCost: { W: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature has protection from black and from red.",
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "protection from black",
                },
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "protection from red",
                },
            ],
        },
    ],
    // CR 702.16n — the rider keeps the Aura on a host it protects.
    [
        aura(
            "Green Ward",
            "{W}",
            "Enchant creature\nEnchanted creature has protection from green. This effect doesn't remove this Aura.",
            "727ab7f2-741e-4442-b5cb-e3032549fa87"
        ),
        {
            ...CREATURE_AURA,
            name: "Green Ward",
            manaCost: { W: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature has protection from green. This effect doesn't remove this Aura.",
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "protection from green",
                },
            ],
            exemptFromProtectionDetach: true,
        },
    ],
    // CR 113.1a — an ability granted in quotation marks: a template on
    // `grantTemplates[]`, lowered exactly like a printed one, and the grant
    // naming it. "This creature" is the HOST, the granted ability's source.
    [
        aura(
            "Hermetic Study",
            "{1}{U}",
            'Enchant creature\nEnchanted creature has "{T}: This creature deals 1 damage to any target."',
            "792d7818-ee5c-4254-b969-7b50f475c629"
        ),
        {
            ...CREATURE_AURA,
            name: "Hermetic Study",
            manaCost: { X: 1, U: 1 },
            oracleText:
                'Enchant creature\nEnchanted creature has "{T}: This creature deals 1 damage to any target."',
            compiledStaticEffects: [
                {
                    kind: "activated-grant",
                    appliesTo: "host",
                    abilityId: "hermetic-study-granted",
                },
            ],
            grantTemplates: [
                {
                    id: "hermetic-study-granted",
                    oracleText:
                        "{T}: This creature deals 1 damage to any target.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [
                        { op: "dealDamage", amount: 1, to: { target: 0 } },
                    ],
                    targetRequirement: { type: "any", count: 1 },
                },
            ],
        },
    ],
    // CR 613.1b — a layer-2 control change on the host.
    [
        aura(
            "Control Magic",
            "{2}{U}{U}",
            "Enchant creature\nYou control enchanted creature.",
            "cd0d7141-46d2-4aa3-bc77-6b3b4513803e"
        ),
        {
            ...CREATURE_AURA,
            name: "Control Magic",
            manaCost: { X: 2, U: 2 },
            oracleText: "Enchant creature\nYou control enchanted creature.",
            compiledStaticEffects: [
                { kind: "control-change", appliesTo: "host" },
            ],
        },
    ],
    // CR 508.1c / 509.1b — "can't attack or block": one restriction per
    // declaration, each carrying the sentence the engine shows on refusal.
    [
        aura(
            "Pacifism",
            "{1}{W}",
            "Enchant creature\nEnchanted creature can't attack or block.",
            "5f5e0b10-c8cf-450c-bfd3-bcb0528ec330"
        ),
        {
            ...CREATURE_AURA,
            name: "Pacifism",
            manaCost: { X: 1, W: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature can't attack or block.",
            compiledStaticEffects: [
                {
                    kind: "attack-restriction",
                    id: "pacifism-cant-attack",
                    oracleText: "Enchanted creature can't attack or block.",
                },
                {
                    kind: "block-restriction",
                    id: "pacifism-cant-block",
                    oracleText: "Enchanted creature can't attack or block.",
                },
            ],
        },
    ],
    // CR 509.1b — a restriction joined to a P/T clause carries its OWN
    // sentence: the P/T half is no reason the engine refuses a block.
    [
        aura(
            "Cast into Darkness",
            "{1}{B}",
            "Enchant creature\nEnchanted creature gets -2/-0 and can't block.",
            "4160e621-3f13-486b-af17-728ce85f7ea5"
        ),
        {
            ...CREATURE_AURA,
            name: "Cast into Darkness",
            manaCost: { X: 1, B: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature gets -2/-0 and can't block.",
            compiledStaticEffects: [
                {
                    kind: "pt-buff",
                    appliesTo: "host",
                    power: -2,
                    toughness: 0,
                },
                {
                    kind: "block-restriction",
                    id: "cast-into-darkness-cant-block",
                    oracleText: "Enchanted creature can't block.",
                },
            ],
        },
    ],
];

describe("Aura statics — golden fixtures (CR 303.4b)", () => {
    it.each(GOLDEN.map(([card, expected]) => [card.name, card, expected]))(
        "%s compiles to exactly its golden definition",
        (_name, card, expected) => {
            const outcome = compileCard(card);
            expect(outcome.state).toBe("ready");
            expect(compiledOf(card)).toEqual(expected);
        }
    );

    it('reads "can\'t attack" and "can\'t block" alone', () => {
        expect(
            compiledOf(
                aura(
                    "Attack Lock",
                    "{W}",
                    "Enchant creature\nEnchanted creature can't attack."
                )
            ).compiledStaticEffects
        ).toEqual([
            {
                kind: "attack-restriction",
                id: "attack-lock-cant-attack",
                oracleText: "Enchanted creature can't attack.",
            },
        ]);
        expect(
            compiledOf(
                aura(
                    "Block Lock",
                    "{R}",
                    "Enchant creature\nEnchanted creature can't block."
                )
            ).compiledStaticEffects
        ).toEqual([
            {
                kind: "block-restriction",
                id: "block-lock-cant-block",
                oracleText: "Enchanted creature can't block.",
            },
        ]);
    });

    it("reads a serial keyword list and a non-creature host", () => {
        expect(
            compiledOf(
                aura(
                    "Serial Grant",
                    "{G}",
                    "Enchant creature\nEnchanted creature has flying, first strike, and trample."
                )
            ).compiledStaticEffects
        ).toEqual(
            ["flying", "first strike", "trample"].map((keyword) => ({
                kind: "keyword-grant",
                appliesTo: "host",
                keyword,
            }))
        );
        // CR 303.4b — "enchanted land" names the host exactly as "enchanted
        // creature" does; the noun agrees with the enchant line.
        const land = compiledOf(
            aura(
                "Land Grant",
                "{B}",
                'Enchant land\nEnchanted land has "{T}: Target player loses 3 life."'
            )
        );
        expect(land.targetRequirement).toEqual({ type: "Land", count: 1 });
        expect(land.grantTemplates?.[0]?.id).toBe("land-grant-granted");
    });
});

// ── 2. Refusals ────────────────────────────────────────────────────────────

describe("Aura statics — refusals", () => {
    it.each([
        // An "as long as" condition the frame would drop.
        "Enchanted creature gets +2/+2 as long as an opponent controls a black permanent.",
        // A variable modifier.
        "Enchanted creature gets +X/+X, where X is the number of Forests you control.",
        // A keyword with a condition the frame would drop.
        "Enchanted creature has shroud as long as it's untapped.",
        // A protection quality outside the colour family (CR 702.16a).
        "Enchanted creature has protection from the chosen color. This effect doesn't remove this Aura.",
        // CR 702.16n — the rider modifies a protection grant and nothing else.
        "Enchanted creature has flying. This effect doesn't remove this Aura.",
        // A keyword granted twice is a misread, not a stack of two.
        "Enchanted creature has flying and flying.",
        // A predicate the frame does not read.
        "Enchanted creature gets +2/+2 and is goaded.",
        "Enchanted creature gets +2/+2 and attacks each combat if able.",
        // A quoted TRIGGERED ability is a `triggered-grant`, not this form.
        'Enchanted creature has "At the beginning of your upkeep, you lose 1 life."',
        // "enchanted permanent" names no host type for a quoted ability.
        'Enchanted permanent has "{T}: Draw a card."',
        // Equipment is not an Aura, and no Equip line parses yet.
        "Equipped creature gets +2/+0.",
    ])("refuses %s", (line) => {
        expect(
            refusedOf(aura("Refused", "{W}", `Enchant creature\n${line}`))
        ).toContain("no slot consumed the line");
    });

    it('refuses "enchanted" on a card with no enchant line (CR 303.4b)', () => {
        expect(
            refusedOf({
                oracleId: "test-not-an-aura",
                name: "Not an Aura",
                manaCost: "{W}",
                typeLine: "Enchantment",
                oracleText: "Enchanted creature gets +1/+1.",
                layout: "normal",
            })
        ).toContain("no enchant line");
    });

    it("refuses a host noun its enchant line can never attach to", () => {
        expect(
            refusedOf(
                aura(
                    "Wrong Host",
                    "{G}",
                    "Enchant land\nEnchanted creature gets +1/+1."
                )
            )
        ).toContain("cannot enchant one");
    });

    it("refuses a quoted ability that names the Aura itself (CR 201.5a)", () => {
        expect(
            refusedOf(
                aura(
                    "Named Aura",
                    "{G}",
                    'Enchant creature\nEnchanted creature has "{T}: Return Named Aura to its owner\'s hand."'
                )
            )
        ).toContain("no slot consumed the line");
    });
});

// ── 3. Behaviour in the real engine ────────────────────────────────────────

/** The golden twin of a corpus card, registered under a test id. */
function registered(card: OracleCard, id: string): CardDefinition {
    return { ...compiledOf(card), id, rarity: "common" };
}

/**
 * Resolve `auraDef` onto a Grizzly Bears controlled by `bearController`,
 * beside a second, UNENCHANTED bear the Aura must leave alone — the negative
 * half, which is the one that reds when the host scope widens to a set.
 */
function enchantBear(auraDef: CardDefinition, bearController = "p1") {
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: bearController,
        ownerId: bearController,
        isSummoningSick: false,
    });
    const bystander = makeInstance(grizzlyBears.id, {
        id: "bystander",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield:
                    bearController === "p1" ? [bear, bystander] : [bystander],
            }),
            makePlayer("p2", {
                battlefield: bearController === "p2" ? [bear] : [],
            }),
        ],
    });
    pushSpell(state, auraDef.id, "p1", [{ type: "permanent", id: "bear" }]);
    resolveTopOfStack(state);
    checkStateBasedActions(state);
    const find = (id: string) =>
        state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;
    return { state, host: find("bear"), other: find("bystander") };
}

describe("Aura statics in the real engine (CR 303.4b)", () => {
    it("buffs and grants a keyword to the host — through projectPublicState", () => {
        const def = registered(
            aura(
                "Compiled Wings",
                "{W}{U}",
                "Enchant creature\nEnchanted creature gets +1/+0 and has flying and first strike."
            ),
            "compiled-wings-3833"
        );
        withTemporaryDefinition(def, () => {
            const { state, host } = enchantBear(def);
            expect(getEffectivePower(state, host)).toBe(3);
            const projected = projectPublicState(state, 1, "p1");
            const slim = (id: string) =>
                projected.players[0]!.battlefield.find((c) => c.id === id)!;
            expect(getEffectivePower(projected, slim("bear"))).toBe(3);
            expect(getEffectiveToughness(projected, slim("bear"))).toBe(2);
            expect(slim("bear").staticAbilities).toEqual(
                expect.arrayContaining(["flying", "first strike"])
            );
            // The host, and ONLY the host (CR 303.4b).
            expect(getEffectivePower(projected, slim("bystander"))).toBe(2);
            expect(slim("bystander").staticAbilities ?? []).not.toContain(
                "flying"
            );
        });
    });

    it("takes control of the host (CR 613.1b)", () => {
        const def = registered(
            aura(
                "Compiled Control",
                "{2}{U}{U}",
                "Enchant creature\nYou control enchanted creature."
            ),
            "compiled-control-3833"
        );
        withTemporaryDefinition(def, () => {
            const { state, host, other } = enchantBear(def, "p2");
            expect(host.controllerId).toBe("p1");
            expect(other.controllerId).toBe("p1");
            expect(state.players[0]!.battlefield.map((c) => c.id)).toContain(
                "bear"
            );
        });
    });

    it("stops the host attacking and blocking (CR 508.1c / 509.1b)", () => {
        const def = registered(
            aura(
                "Compiled Pacifism",
                "{1}{W}",
                "Enchant creature\nEnchanted creature can't attack or block."
            ),
            "compiled-pacifism-3833"
        );
        withTemporaryDefinition(def, () => {
            const { state, host, other } = enchantBear(def);
            expect(validateAttackerEligibility(host, [], state)).toEqual({
                eligible: false,
                reason: "Enchanted creature can't attack or block.",
            });
            expect(validateAttackerEligibility(other, [], state)).toEqual({
                eligible: true,
            });
            const attacker = makeInstance(grizzlyBears.id, {
                id: "attacker",
                controllerId: "p2",
                ownerId: "p2",
            });
            expect(
                validateBlockerEligibility(attacker, host, [host], state)
            ).toMatchObject({ eligible: false });
        });
    });

    it("grants the quoted ability to the host, and only the host (CR 113.1a)", () => {
        const def = registered(
            aura(
                "Compiled Study",
                "{1}{U}",
                'Enchant creature\nEnchanted creature has "{T}: This creature deals 1 damage to any target."'
            ),
            "compiled-study-3833"
        );
        withTemporaryDefinition(def, () => {
            const { state, host, other } = enchantBear(def);
            const granted = getEffectiveActivatedAbilities(host).map(
                (a) => a.ability.oracleText
            );
            expect(granted).toEqual([
                "{T}: This creature deals 1 damage to any target.",
            ]);
            expect(getEffectiveActivatedAbilities(other)).toEqual([]);
            const auraInstance = state.players[0]!.battlefield.find(
                (c) => c.card.id === def.id
            )!;
            expect(getEffectiveActivatedAbilities(auraInstance)).toEqual([]);
        });
    });

    it("keeps a protection Aura of the protected colour attached (CR 702.16n)", () => {
        // White Ward is white and grants protection from white: without the
        // rider, CR 702.16c puts it into the graveyard as a state-based action.
        const def = registered(
            aura(
                "Compiled White Ward",
                "{W}",
                "Enchant creature\nEnchanted creature has protection from white. This effect doesn't remove this Aura."
            ),
            "compiled-white-ward-3833"
        );
        withTemporaryDefinition(def, () => {
            const { state } = enchantBear(def);
            checkStateBasedActions(state);
            const attached = state.players[0]!.battlefield.find(
                (c) => c.card.id === def.id
            );
            expect(attached?.attachedTo).toBe("bear");
        });
    });
});
