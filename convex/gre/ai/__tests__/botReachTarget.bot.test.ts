// Bot-play sweep position for targeted spells (issue #4259). A spell whose
// target requirement narrows the creature, or whose cost needs more than the
// position's lands, was refused by the ENGINE for a human too — the verdict
// `position-unmodelled` was a fact about the harness. One case per class of
// pose, each asserting the very affordance a human's client gates the cast on
// (`getLegalActions`), plus a full sweep play for the combat shapes.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type {
    CardDefinition,
    EffectOp,
    TargetRequirement,
} from "../../../cards/types";
import { getLegalActions } from "../../rules";
import {
    botReachSpec,
    buildBotReachState,
    playBotReach,
    TRICK_WINDOW,
} from "../botReach";
import { combatTrickPosition, targetPose } from "../botReachTarget";

const targetPoseCards = (def: CardDefinition) => targetPose(def).cards;

const DESTROY: EffectOp[] = [{ op: "destroy", target: { target: 0 } }];
const PUMP: EffectOp[] = [
    {
        op: "pump",
        target: { target: 0 },
        power: 2,
        toughness: 2,
        duration: { phase: "end-of-turn" },
    },
];

function instant(
    slug: string,
    requirement: Partial<TargetRequirement>,
    extra: Partial<CardDefinition> = {}
): CardDefinition {
    return {
        id: `bot-reach-target-test:${slug}`,
        name: `Bot Reach Target ${slug}`,
        rarity: "common",
        manaCost: { W: 1, generic: 1 },
        types: ["Instant"],
        targetRequirement: { type: "Creature", count: 1, ...requirement },
        effects: DESTROY,
        ...extra,
    };
}

/** CR 117.1 — does the engine offer the holder this card's cast? */
function castable(def: CardDefinition): boolean {
    return withTemporaryDefinition(def, () => {
        const { state, holderId, instanceId } = buildBotReachState(def, 0);
        const player = state.players.find((p) => p.id === holderId)!;
        const card = player.hand.find((c) => c.id === instanceId)!;
        return getLegalActions(state, player, card).includes("cast");
    });
}

describe("the generated position poses a narrowed creature target (CR 115.1)", () => {
    const shapes: ReadonlyArray<readonly [string, CardDefinition]> = [
        ["power N or greater", instant("power", { powerFilter: { min: 4 } })],
        [
            "toughness N or less (no toughness boost)",
            instant("toughness", { toughnessFilter: { max: 3 } }),
        ],
        ["a colour", instant("colour", { colorFilter: "W" })],
        ["a subtype", instant("subtype", { subtypeFilter: ["Human"] })],
        [
            "a subtype only defenders carry",
            instant("wall", { subtypeFilter: "Wall" }),
        ],
        ["a supertype", instant("legend", { supertypeFilter: ["Legendary"] })],
        ["tapped", instant("tapped", { tappedFilter: "tapped" })],
        ["mana value N or greater", instant("mv", { mvFilter: { min: 3 } })],
        [
            "a keyword only defenders carry",
            instant("defender", { requireAbility: "defender" }),
        ],
        [
            "a keyword no plain body carries",
            instant("horsemanship", { requireAbility: "horsemanship" }),
        ],
    ];
    it.each(shapes)("%s", (_label, def) => {
        expect(castable(def)).toBe(true);
    });
});

describe("the generated position poses a declared combat (CR 508.1, 509.1)", () => {
    it("attacking creature (CR 508.1)", () => {
        const def = instant("attacking", { combatRoleFilter: ["attacking"] });
        expect(castable(def)).toBe(true);
        expect(withTemporaryDefinition(def, () => playBotReach(def))).toEqual({
            outcome: "played",
        });
    });

    it("blocking creature of the opponent (CR 509.1)", () => {
        const def = instant("blocking-removal", {
            combatRoleFilter: ["blocking"],
        });
        expect(castable(def)).toBe(true);
    });

    it("blocking creature of the holder, for a pump (CR 509.1)", () => {
        const def = instant(
            "blocking-pump",
            { combatRoleFilter: ["blocking"] },
            { effects: PUMP }
        );
        expect(castable(def)).toBe(true);
        expect(withTemporaryDefinition(def, () => playBotReach(def))).toEqual({
            outcome: "played",
        });
    });
});

describe("the generated position pays a cost its lands cannot (CR 601.2h)", () => {
    it("an additional discard cost needs a real card to discard", () => {
        const def = instant(
            "discard",
            {},
            { additionalCosts: { discard: { filter: {}, count: 1 } } }
        );
        expect(castable(def)).toBe(true);
    });

    it("a colourless mana symbol needs colourless mana (CR 106.1b)", () => {
        const def = instant(
            "colourless",
            {},
            { manaCost: { C: 1, generic: 1 } }
        );
        expect(castable(def)).toBe(true);
    });
});

describe("a requirement no plain creature satisfies stays unmodelled", () => {
    it("is refused the cast, not posed with something else", () => {
        const def = instant("nothing", {
            subtypeFilter: ["Bot Reach Nonexistent Type"],
        });
        expect(castable(def)).toBe(false);
    });
});

describe("the pose stays out of positions that did not need it", () => {
    it("an untyped X discard is paid by the opaque hand card, not a real one", () => {
        const def = instant(
            "x-discard",
            {},
            { additionalCosts: { discard: { filter: {}, count: "X" } } }
        );
        const handOf = (d: CardDefinition) =>
            botReachSpec(d).cards.filter((c) => c.zone === "hand");
        expect(handOf(def)).toEqual([]);
    });

    it("an unnarrowed requirement declares no combat and seeds no extra creature", () => {
        const spec = botReachSpec(instant("plain", {}));
        expect(spec.combat).toBeUndefined();
        expect(spec.phase).toBe("PRECOMBAT_MAIN");
        expect(spec.manaPool).toBeUndefined();
    });
});

describe("the pose puts the target on the side where the spell is cast", () => {
    it("a boon on a blocker is cast with the holder defending", () => {
        const spec = botReachSpec(
            instant(
                "boon",
                { combatRoleFilter: ["blocking"] },
                { effects: PUMP }
            )
        );
        expect(spec.activePlayer).toBe("opp");
    });

    it("removal of a blocker is cast with the holder attacking", () => {
        const spec = botReachSpec(
            instant("removal", { combatRoleFilter: ["blocking"] })
        );
        expect(spec.activePlayer).toBe("me");
    });
});

describe("what the sweep registered for its own plays never decides the pose", () => {
    it("a creature registered under the sweep's id prefix is not posed", () => {
        const type = "Bot Reach Sweep Only Type";
        const sweepCreature: CardDefinition = {
            id: "oracle-bot-reach:sweep-only",
            name: "Bot Reach Sweep Only",
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Creature"],
            subtypes: [type],
            power: 1,
            toughness: 1,
        };
        const def = instant("sweep-only", { subtypeFilter: [type] });
        expect(
            withTemporaryDefinition(sweepCreature, () => castable(def))
        ).toBe(false);
    });
});

describe("the generated position poses a land target on the opponent's side (issue #4262)", () => {
    const STONE_RAIN_SHAPE = instant(
        "land-destroy",
        { type: "Land" },
        { types: ["Sorcery"], manaCost: { R: 1, generic: 2 } }
    );
    const oppLands = (def: CardDefinition): number =>
        botReachSpec(def).cards.filter(
            (c) =>
                c.owner === "opp" &&
                c.zone === "battlefield" &&
                c.name === "Forest"
        ).length;

    it("gives the opponent a land, so the holder's own mana is not the only target", () => {
        expect(oppLands(STONE_RAIN_SHAPE)).toBe(1);
    });

    it("leaves a creature spell's position without one", () => {
        expect(oppLands(instant("creature", {}))).toBe(0);
    });

    it("the Bot casts a land destroyer at that land", () => {
        expect(
            withTemporaryDefinition(STONE_RAIN_SHAPE, () =>
                playBotReach(STONE_RAIN_SHAPE)
            )
        ).toEqual({ outcome: "played" });
    });
});

describe("a combat trick is posed in a declared combat once the main phases passed it over (issue #4264)", () => {
    const TRICK = instant("trick", {}, { effects: PUMP });
    const combat = (def: CardDefinition) => botReachSpec(def, TRICK_WINDOW);

    it("declares the holder's attacker blocked, holder holding priority", () => {
        const spec = combat(TRICK);
        expect(spec.phase).toBe("DECLARE_BLOCKERS");
        expect(spec.activePlayer).toBe("me");
        expect(spec.priority).toBe("me");
        expect(spec.combat?.blockers).toHaveLength(1);
    });

    it("the engine offers the cast in that position", () => {
        withTemporaryDefinition(TRICK, () => {
            const { state, holderId, instanceId } = buildBotReachState(
                TRICK,
                0,
                TRICK_WINDOW
            );
            const player = state.players.find((p) => p.id === holderId)!;
            const card = player.hand.find((c) => c.id === instanceId)!;
            expect(getLegalActions(state, player, card)).toContain("cast");
        });
    });

    it("leaves the main-phase windows exactly as they were", () => {
        expect(botReachSpec(TRICK).phase).toBe("PRECOMBAT_MAIN");
        expect(botReachSpec(TRICK, "POSTCOMBAT_MAIN").phase).toBe(
            "POSTCOMBAT_MAIN"
        );
    });

    it("poses no combat for a removal spell or a sorcery pump", () => {
        expect(combatTrickPosition(instant("removal", {}))).toBeNull();
        const sorcery = instant(
            "sorcery",
            {},
            { types: ["Sorcery"], effects: PUMP }
        );
        expect(combatTrickPosition(sorcery)).toBeNull();
    });

    it("the Bot casts the trick in that combat", () => {
        expect(
            withTemporaryDefinition(TRICK, () => playBotReach(TRICK))
        ).toEqual({ outcome: "played" });
    });
});

// Issue #4265 — a sorcery whose creature target is named by a mana value or a
// keyword no plain catalogue body carries. Each was refused by the engine for a
// human too (`position-unmodelled`); the position now poses the body, and the
// Bot casts the removal at it.
describe("a sorcery removal spell's narrowed target is posed and played (CR 115.1)", () => {
    const removal = (
        slug: string,
        requirement: Partial<TargetRequirement>
    ): CardDefinition => ({
        ...instant(slug, requirement),
        types: ["Sorcery"],
    });
    const shapes: ReadonlyArray<readonly [string, CardDefinition]> = [
        [
            "mana value N or greater",
            removal("sorcery-mv", { mvFilter: { min: 3 } }),
        ],
        [
            "a printed keyword (defender)",
            removal("sorcery-defender", { requireAbility: "defender" }),
        ],
        [
            "a keyword only a grant can supply (horsemanship)",
            removal("sorcery-horsemanship", { requireAbility: "horsemanship" }),
        ],
    ];
    it.each(shapes)("%s", (_label, def) => {
        expect(castable(def)).toBe(true);
        expect(withTemporaryDefinition(def, () => playBotReach(def))).toEqual({
            outcome: "played",
        });
    });

    it("a mana value bound the position cannot read poses nothing", () => {
        const def = removal("sorcery-mv-x", { mvFilter: { max: "X" } });
        expect(
            withTemporaryDefinition(def, () => targetPoseCards(def))
        ).toEqual([]);
    });
});
