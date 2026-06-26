// Arabian Nights (ARN), split by colour per ADR 0043. The first MTG
// expansion (78 unique cards); every entry is a CardDefinition — ARN has no
// LEA reprints, so there are no CardPrint stubs (ADR 0014). Modern Scryfall
// oracle text is authoritative (ADR 0004). Generic mana is encoded as
// `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour
// identity of their mana cost (CR 202.2); lands and artifacts (no coloured
// cost) live in colorless.ts.

import type {
    CardDefinition,
    Color,
    ManaCost,
    SpellContext,
} from "../../types";
import { manaCostForCardId } from "../../manaCostLookup";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";

export const moorishCavalry: CardDefinition = {
    id: "f86f0781-7614-4779-a58d-f13ce96bdf33",
    rarity: "common",
    name: "Moorish Cavalry",
    oracleText: "Trample",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 3,
    toughness: 3,
    staticAbilities: ["trample"],
};

export const repentantBlacksmith: CardDefinition = {
    id: "61fc30b6-1355-425b-a86f-18f59f83141c",
    rarity: "rare",
    name: "Repentant Blacksmith",
    oracleText: "Protection from red",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 2,
    staticAbilities: ["protection from red"],
};

export const warElephant: CardDefinition = {
    id: "7416c366-95cc-4799-b6c6-34d8fad8c202",
    rarity: "common",
    name: "War Elephant",
    oracleText: "Trample, banding",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 2,
    toughness: 2,
    staticAbilities: ["trample", "banding"],
};

export const kingSuleiman: CardDefinition = {
    id: "4d3dce0f-2168-4f63-b2f9-156a11beeea7",
    rarity: "rare",
    name: "King Suleiman",
    oracleText: "{T}: Destroy target Djinn or Efreet.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Noble"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "king-suleiman-destroy",
            oracleText: "{T}: Destroy target Djinn or Efreet.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: ["Djinn", "Efreet"],
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
    ],
};

export const armyOfAllah: CardDefinition = {
    id: "3d170015-b125-49a6-a15e-8fd116bbcb14",
    rarity: "common",
    name: "Army of Allah",
    oracleText: "Attacking creatures get +2/+0 until end of turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Instant"],
    effect: { kind: "pump-combat", side: "attacking", power: 2, toughness: 0 },
};

export const piety: CardDefinition = {
    id: "f649c571-d7ec-4ebc-9e18-b0657cab495b",
    rarity: "common",
    name: "Piety",
    oracleText: "Blocking creatures get +0/+3 until end of turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Instant"],
    effect: { kind: "pump-combat", side: "blocking", power: 0, toughness: 3 },
};

// Eye for an Eye — transient reflect entry on the damageRedirections family
// (CR 614): the chosen source's next damage to you proceeds unchanged, and an
// equal amount is dealt to that source's controller.
export const eyeForAnEye: CardDefinition = {
    id: "2933ca2a-097b-44f4-ae56-ad524d26fd06",
    rarity: "uncommon",
    name: "Eye for an Eye",
    oracleText:
        "The next time a source of your choice would deal damage to you this turn, instead that source deals that much damage to you and Eye for an Eye deals that much damage to that source's controller.",
    manaCost: { W: 2 },
    types: ["Instant"],
    targetRequirement: { type: ["any", "spell"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const [target] = ctx.targets;
        if (!target) return;
        // The "source of your choice" is a permanent or a spell on the stack —
        // never a player.
        if (target.type === "player") return;
        ctx.addDamageRedirectionShield({
            kind: "reflect-to-source-controller",
            sourceInstanceId: target.id,
            playerId: ctx.controller,
            remaining: 1,
            duration: { phase: "end-of-turn" },
        });
    },
};

// Camel — banding, plus "as long as this creature is attacking, prevent all
// damage Deserts would deal to it and to creatures banded with it" (CR 614).
// The protected set is Camel's attacking band (or just Camel if attacking
// solo); the prevention only applies while Camel is itself an attacker.
export const camel: CardDefinition = {
    id: "e0078aa8-bfb8-43b0-a6b7-1991596c21e1",
    rarity: "common",
    name: "Camel",
    oracleText:
        "Banding\nAs long as this creature is attacking, prevent all damage Deserts would deal to this creature and to creatures banded with this creature.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Camel"],
    power: 0,
    toughness: 1,
    staticAbilities: ["banding"],
    replacementEffects: [
        {
            id: "camel-band-no-desert-damage",
            oracleText:
                "As long as this creature is attacking, prevent all damage Deserts would deal to this creature and to creatures banded with this creature.",
            eventKind: "damage",
            appliesTo: (event, self, state) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "permanent") return false;
                if (!event.sourceSubtypes?.includes("Desert")) return false;
                const combat = state.combat;
                // Camel must itself be attacking for the shield to apply.
                if (!combat || !combat.attackerIds.includes(self.id))
                    return false;
                const band = combat.bands?.find((b) =>
                    b.memberIds.includes(self.id)
                );
                const protectedIds = band ? band.memberIds : [self.id];
                return protectedIds.includes(event.target.id);
            },
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

// Abu Ja'far — death trigger that destroys its combat partners (CR 603.2 /
// 603.10). The trigger resolves after Abu Ja'far is already in the graveyard,
// so the engine snapshots "creatures blocking or blocked by it" at the moment
// of death onto the CREATURE_DIED event (`combatPartnerIds`, computed by
// `combatPartnerIds()` in state.ts). The body re-checks each partner is still
// on the battlefield (CR 608.2b) and destroys it with `cantBeRegenerated`
// (CR 701.15c — the printed "they can't be regenerated").
export const abuJafar: CardDefinition = {
    id: "0e9ad288-d164-44a6-96ec-4185a1587f1a",
    rarity: "uncommon",
    name: "Abu Ja'far",
    oracleText:
        "When this creature dies, destroy all creatures blocking or blocked by it. They can't be regenerated.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 0,
    toughness: 1,
    triggeredAbilities: [
        diedTrigger({
            id: "abu-jafar-death",
            oracleText:
                "When this creature dies, destroy all creatures blocking or blocked by it. They can't be regenerated.",
            scope: "self",
            resolve: (ctx, _event, deadCreature) => {
                for (const partnerId of deadCreature.combatPartnerIds) {
                    ctx.destroy(
                        { type: "permanent", id: partnerId },
                        { cantBeRegenerated: true }
                    );
                }
            },
        }),
    ],
};

/** True when SOME nontoken permanent of `color` is controlled by a player
 *  other than `myControllerId` — i.e. (in a 2-player game) the opponent
 *  controls a nontoken permanent of the chosen colour. `colorsOf` abstracts
 *  the two call sites' colour derivation (the static layer's `ctx.getColors`
 *  vs. the trigger view's raw `manaCost`). */
function opponentControlsChosenColor<
    T extends { controllerId: string; isToken?: boolean },
>(
    permanents: ReadonlyArray<T>,
    myControllerId: string,
    color: Color,
    colorsOf: (perm: T) => ReadonlyArray<Color>
): boolean {
    return permanents.some(
        (c) =>
            c.controllerId !== myControllerId &&
            !c.isToken &&
            colorsOf(c).includes(color)
    );
}

/** Colors (CR 202.2) of a battlefield-view permanent. The engine stores only
 *  the slim `{ id }` card reference, so the colour comes from the registry's
 *  `manaCost` (embedded cost honored first if a fat view ever provides one).
 *  Mirrors `STATIC_EFFECT_CTX.getColors`' cost path without the layer-5
 *  colorOverride / grantedColors stack — adequate for the chosen-colour check
 *  (no ARN permanent carries a static colour override). */
function permanentColors(perm: {
    card?: Record<string, unknown>;
}): ReadonlyArray<Color> {
    const ref = perm.card as { id?: string; manaCost?: ManaCost } | undefined;
    const cost =
        ref?.manaCost ?? (ref?.id ? manaCostForCardId(ref.id) : undefined);
    if (!cost) return [];
    // Inline of `getColorsFromCost` (CR 202.2) — importing `../colors` would
    // pull in `gre/constants → cards/index`, re-introducing the set↔registry
    // eval-time cycle. Colourless `C` is not a colour.
    return (["W", "U", "B", "R", "G"] as const).filter(
        (c) => (cost[c] ?? 0) > 0
    );
}

const JIHAD_COLOR_NAMES: Record<Color, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
};

const JIHAD_COLORS: Color[] = ["W", "U", "B", "R", "G"];

export const jihad: CardDefinition = {
    id: "b6c7705a-2987-4ef1-92b1-2c55d989ec6f",
    rarity: "rare",
    name: "Jihad",
    oracleText:
        "As Jihad enters, choose a color and an opponent.\nWhite creatures get +2/+1 as long as the chosen player controls a nontoken permanent of the chosen color.\nWhen the chosen player controls no nontoken permanents of the chosen color, sacrifice Jihad.",
    manaCost: { W: 3 },
    types: ["Enchantment"],
    // CR 700.2 — the colour is chosen as the enchantment enters (modal pick).
    modes: JIHAD_COLORS.map((color) => ({
        id: color,
        label: JIHAD_COLOR_NAMES[color],
        oracleText: `White creatures get +2/+1 as long as the chosen player controls a nontoken ${JIHAD_COLOR_NAMES[color]} permanent.`,
        staticEffects: [
            {
                kind: "pt-buff" as const,
                // CR 202.2 — the anthem always boosts WHITE creatures; only the
                // active-condition keys off the chosen colour.
                applies: (target, _source, ctx) =>
                    ctx.isCreature(target) &&
                    ctx.getColors(target).includes("W"),
                condition: (source, state, ctx) =>
                    opponentControlsChosenColor(
                        state.players.flatMap((p) => p.battlefield),
                        source.controllerId,
                        color,
                        (c) => ctx.getColors(c)
                    ),
                power: 2,
                toughness: 1,
            },
        ],
    })),
    triggeredAbilities: [
        stateTrigger({
            id: "jihad-sacrifice",
            oracleText:
                "When the chosen player controls no nontoken permanents of the chosen color, sacrifice Jihad.",
            condition: (self, state) => {
                // The cast-time modal pick (CR 700.2c) is the chosen colour.
                const color = self.chosenModeId as Color | undefined;
                if (!color) return false;
                const perms = state.players.flatMap((p) => p.battlefield);
                return !opponentControlsChosenColor(
                    perms,
                    self.controllerId,
                    color,
                    permanentColors
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};
