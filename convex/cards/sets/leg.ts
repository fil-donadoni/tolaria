// Legends (LEG) — the game's first multicolor, "legendary matters" set (310
// unique cards). This file follows the established set-file pattern (ADR 0014):
// every in-scope card is either a new `CardDefinition` (Legends has no reprints
// of already-implemented cards, so it is effectively 100% new definitions) or,
// where it reprints an implemented card, a thin `CardPrint` stub. Modern
// Scryfall oracle text is authoritative (ADR 0004); canonical names / costs /
// P/T are sourced from MTGJSON `data/json/LEG.json`.
//
// THIS slice is the walking skeleton (#370): it registers the `leg` set and
// wires one thin end-to-end tracer — a pair of vanilla legendary creatures that
// carry the `Legendary` supertype as data and are playable from the card pool
// through a preset scenario. It proves the set file, the registry entry, the
// pool/deck availability, projection, and the test harness all work before the
// bulk free tranche and the 9 feature clusters land (see PRD #369).
//
// Generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
//
// Out of scope for the whole set (per #369): Rebirth and Tempest Efreet (ante,
// ADR 0010). They stay absent so "Legends complete" means complete minus those
// two named exclusions. The remaining cards land in later batches.

import type { CardDefinition, ManaCost, SpellContext } from "../types";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { tappedTrigger } from "../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../abilities/triggers/spellCastTrigger";
import { damageDealtTrigger } from "../abilities/triggers/damageDealtTrigger";
import { manaCostForCardId } from "../manaCostLookup";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla legendary creatures (CR 205.4a — Legendary supertype; CR 704.5j legend
// rule lands as an SBA in cluster C1, #369. A legendary vanilla creature is
// playable before that SBA ships and fully correct after — legendary-ness does
// not gate the card's release.)
// ─────────────────────────────────────────────────────────────────────────────

export const jasmineBoreal: CardDefinition = {
    id: "db6ef678-4ce9-48d6-aa4f-2afd9a1ad724",
    name: "Jasmine Boreal",
    oracleText: "",
    manaCost: { X: 3, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 4,
    toughness: 5,
};

export const ladyOrca: CardDefinition = {
    id: "b2779553-74eb-42ba-97d0-96269f48c269",
    name: "Lady Orca",
    oracleText: "",
    manaCost: { X: 5, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Demon"],
    power: 7,
    toughness: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// White free tranche (#371) — every mono-white Legends card expressible with
// existing primitives (keywords, staticEffects / layer system, trigger
// factories, prevention shields, SpellContext methods). Data + resolve()
// closures only; zero engine change (ADR 0014). Cards owned by feature
// clusters (#369 C1–C9: legend/world rule, Rampage, bands-with-other, named
// counters, shroud, upkeep pay-or-sacrifice, cast-tax / combat-cap World
// enchantments, global enters-tapped, end-of-turn color change) are NOT here.
// ─────────────────────────────────────────────────────────────────────────────

// --- Vanilla / keyword creatures (CR 702 — pure data) ---------------------

// Tundra Wolves — first strike (CR 702.7).
export const tundraWolves: CardDefinition = {
    id: "8f649cb5-e19c-453f-b062-4fd452d92257",
    name: "Tundra Wolves",
    oracleText:
        "First strike (This creature deals combat damage before creatures without first strike.)",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Wolf"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike"],
};

// Thunder Spirit — flying, first strike (CR 702.9, 702.7).
export const thunderSpirit: CardDefinition = {
    id: "61a59775-b1cd-4ed0-8abf-c2b37f7be0d5",
    name: "Thunder Spirit",
    oracleText: "Flying, first strike",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "first strike"],
};

// Wall of Light — Defender, protection from black (CR 702.3, 702.16).
export const wallOfLight: CardDefinition = {
    id: "f5758e82-f901-42b7-b705-0e68ca7ba59e",
    name: "Wall of Light",
    oracleText: "Defender (This creature can't attack.)\nProtection from black",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 5,
    staticAbilities: ["defender", "protection from black"],
};

// Righteous Avengers — plainswalk (CR 702.19 landwalk variant).
export const righteousAvengers: CardDefinition = {
    id: "d96b463e-9579-4e7b-87c2-342527b91e7c",
    name: "Righteous Avengers",
    oracleText:
        "Plainswalk (This creature can't be blocked as long as defending player controls a Plains.)",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 3,
    toughness: 1,
    staticAbilities: ["plainswalk"],
};

// Keepers of the Faith — vanilla 2/3 (CR 208 — stats only).
export const keepersOfTheFaith: CardDefinition = {
    id: "b63a69ae-99ce-4d26-88b7-784793c43cd4",
    name: "Keepers of the Faith",
    oracleText: "",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 3,
};

// --- Block / evasion restriction creatures (CR 509.1b) --------------------

// Amrou Kithkin — can't be blocked by power 3 or greater (CR 509.1b). The
// block-restriction predicate receives the candidate blocker enriched to
// effective power (post-layer-7c) by the combat validator.
export const amrouKithkin: CardDefinition = {
    id: "cbce1c55-123c-4a05-bde4-18a1601fcc5a",
    name: "Amrou Kithkin",
    oracleText:
        "This creature can't be blocked by creatures with power 3 or greater.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Kithkin"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "amrou-kithkin-low-power-only",
            side: "attacker",
            // self = attacker, opponent = candidate blocker (enriched P/T).
            predicate: (_self, opponent) => (opponent.power ?? 0) < 3,
            oracleText:
                "This creature can't be blocked by creatures with power 3 or greater.",
        },
    ],
};

// --- Conditional anthems (CR 611 layer 7c, staticEffects + condition) ------

// Angelic Voices — "Creatures you control get +1/+1 as long as you control no
// nonartifact, nonwhite creatures." A source-level `condition` gates the whole
// anthem on the board state (CR 611.2c).
export const angelicVoices: CardDefinition = {
    id: "8068c263-e5fa-4449-8887-418e9d0a4da4",
    name: "Angelic Voices",
    oracleText:
        "Creatures you control get +1/+1 as long as you control no nonartifact, nonwhite creatures.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId,
            condition: (source, state, ctx) => {
                // No creature the controller controls may be both nonartifact
                // and nonwhite.
                return !state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId === source.controllerId &&
                            ctx.isCreature(c) &&
                            !c.types.includes("Artifact") &&
                            !ctx.getColors(c).includes("W")
                    )
                );
            },
            power: 1,
            toughness: 1,
        },
    ],
};

// Ivory Guardians — protection from red (CR 702.16) + a conditional anthem
// scoped to creatures named Ivory Guardians (CR 611.2c).
const IVORY_GUARDIANS_ID = "9bf9cccd-fe97-4632-a90a-9eeb0d41135e";

export const ivoryGuardians: CardDefinition = {
    id: IVORY_GUARDIANS_ID,
    name: "Ivory Guardians",
    oracleText:
        "Protection from red\nCreatures named Ivory Guardians get +1/+1 as long as an opponent controls a nontoken red permanent.",
    manaCost: { X: 4, W: 2 },
    types: ["Creature"],
    subtypes: ["Giant", "Cleric"],
    power: 3,
    toughness: 3,
    staticAbilities: ["protection from red"],
    staticEffects: [
        {
            kind: "pt-buff",
            // "Creatures named Ivory Guardians" — every copy shares the same
            // card-definition id (CR 201.2), so match on id rather than reading
            // a name off the slim projected view.
            applies: (target) =>
                (target.card as { id?: string }).id === IVORY_GUARDIANS_ID,
            condition: (source, state, ctx) =>
                state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            !c.isToken &&
                            ctx.getColors(c).includes("R")
                    )
                ),
            power: 1,
            toughness: 1,
        },
    ],
};

// Fortified Area — "Wall creatures you control get +1/+0 and have banding."
// (CR 611 — filtered anthem + keyword grant; plain banding is already shipped.)
export const fortifiedArea: CardDefinition = {
    id: "dc64f19c-5b2b-4697-b4dc-2be9c3790794",
    name: "Fortified Area",
    oracleText: "Wall creatures you control get +1/+0 and have banding.",
    manaCost: { X: 1, W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Wall"),
            power: 1,
            toughness: 0,
        },
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Wall"),
            keyword: "banding",
        },
    ],
};

// --- Auras (CR 303 — Enchant creature) ------------------------------------

// Divine Transformation — Enchanted creature gets +3/+3 (CR 303.4, 611).
export const divineTransformation: CardDefinition = {
    id: "a89ad9fd-33a6-4d31-9f4c-8bf192882f21",
    name: "Divine Transformation",
    oracleText: "Enchant creature\nEnchanted creature gets +3/+3.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 3,
            toughness: 3,
        },
    ],
};

// Seeker — "Enchanted creature can't be blocked except by artifact creatures
// and/or white creatures." (CR 509.1b block restriction via the aura's host.)
export const seeker: CardDefinition = {
    id: "df608b59-cc07-4e1d-b6d6-f15e69b15b92",
    name: "Seeker",
    oracleText:
        "Enchant creature\nEnchanted creature can't be blocked except by artifact creatures and/or white creatures.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "block-restriction",
            id: "seeker-artifact-or-white-only",
            side: "attacker",
            // opponent = candidate blocker. Legal only if it is an artifact
            // creature or a white creature (CR 202.2 colour from mana cost).
            predicate: (_self, opponent) =>
                opponent.types.includes("Artifact") ||
                colorsOf(opponent).includes("W"),
            oracleText:
                "Enchanted creature can't be blocked except by artifact creatures and/or white creatures.",
        },
    ],
};

// Spirit Link — "Whenever enchanted creature deals damage, you gain that much
// life." (CR 303.4 aura host trigger via the damage-dealt factory.)
export const spiritLink: CardDefinition = {
    id: "5e2d35f8-3cf6-4843-9030-0e9a885d836c",
    name: "Spirit Link",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nWhenever enchanted creature deals damage, you gain that much life.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        damageDealtTrigger({
            id: "spirit-link-lifegain",
            oracleText:
                "Whenever enchanted creature deals damage, you gain that much life.",
            // The damage source must be the aura's host (CR 303.4b).
            source: "any",
            condition: (event, self) =>
                event.sourceInstanceId === self.attachedTo,
            resolve: (ctx, event) => {
                ctx.gainLife(ctx.controller, event.amount);
            },
        }),
    ],
};

// --- Sweepers / removal spells (CR 701.7) ----------------------------------

// Cleanse — "Destroy all black creatures." (CR 701.7 mass destroy filtered on
// colour, CR 202.2.)
export const cleanse: CardDefinition = {
    id: "2fbd611b-ac97-4516-bad7-cc9ee4ef74f7",
    name: "Cleanse",
    oracleText: "Destroy all black creatures.",
    manaCost: { X: 2, W: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        // `getBattlefieldIds` derives colours (CR 202.2) from the card
        // registry; `destroyAll`'s filter does not populate `colors`, so the
        // sweep is driven by the colour-aware id query instead.
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
                colors: "B",
            })) {
                ctx.destroy({ type: "permanent", id });
            }
        }
    },
};

// Divine Offering — "Destroy target artifact. You gain life equal to its mana
// value." (CR 701.7 + 118.3 lifegain; snapshot the MV before the destroy.)
export const divineOffering: CardDefinition = {
    id: "9c78c2f3-2f40-48ad-9dc4-55d1fa399a56",
    name: "Divine Offering",
    oracleText:
        "Destroy target artifact. You gain life equal to its mana value.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Artifact", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const mv = ctx.getManaValue(target);
        ctx.destroy(target);
        ctx.gainLife(ctx.caster, mv);
    },
};

// --- Pump spells (CR 611.1, end-of-turn duration) --------------------------

// Great Defender — "Target creature gets +0/+X until end of turn, where X is
// its mana value." (CR 202.3 mana value snapshot + 611.1 temporary buff.)
export const greatDefender: CardDefinition = {
    id: "879a8653-1538-4f78-a3d3-a900a4d9499b",
    name: "Great Defender",
    oracleText:
        "Target creature gets +0/+X until end of turn, where X is its mana value.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const mv = ctx.getManaValue(target);
        ctx.addTemporaryPTBuff(target, 0, mv, { phase: "end-of-turn" });
    },
};

// Shield Wall — "Creatures you control get +0/+2 until end of turn." (CR 611.1
// one-shot team buff applied per matching permanent.)
export const shieldWall: CardDefinition = {
    id: "a5032bf0-f9c0-4ef0-8ec2-fe7ccea9bdf3",
    name: "Shield Wall",
    oracleText: "Creatures you control get +0/+2 until end of turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        for (const id of ctx.getBattlefieldIds(ctx.caster, {
            types: "Creature",
        })) {
            ctx.addTemporaryPTBuff({ type: "permanent", id }, 0, 2, {
                phase: "end-of-turn",
            });
        }
    },
};

// --- Damage prevention (CR 615) --------------------------------------------

// Holy Day — "Prevent all combat damage that would be dealt this turn."
// (CR 615 — the global combat-damage prevention used by Fog-style cards.)
export const holyDay: CardDefinition = {
    id: "f6c95a2b-bf44-4ff2-9c6a-916773346edd",
    name: "Holy Day",
    oracleText: "Prevent all combat damage that would be dealt this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.preventAllCombatDamage();
    },
};

// Indestructible Aura — "Prevent all damage that would be dealt to target
// creature this turn." (CR 615 — a per-target shield. "All damage" is modeled
// as a very large prevention amount consumed across the turn.)
export const indestructibleAura: CardDefinition = {
    id: "ed2a7333-c9ce-4011-b00e-1304e1eec25e",
    name: "Indestructible Aura",
    oracleText:
        "Prevent all damage that would be dealt to target creature this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        // No "prevent all damage to target" primitive exists; a shield large
        // enough to absorb any realistic turn's damage gives the same outcome
        // (CR 615.1, consumed per damage event, purged at end of turn).
        ctx.preventNextNDamageToTarget(target, 9999, { phase: "end-of-turn" });
    },
};

// Alabaster Potion — modal: "Target player gains X life" OR "Prevent the next X
// damage that would be dealt to any target this turn." (CR 700.2 modal spell.)
export const alabasterPotion: CardDefinition = {
    id: "2806c7f6-8fdd-4e65-9c71-f2e8b0cdede2",
    name: "Alabaster Potion",
    oracleText:
        "Choose one —\n• Target player gains X life.\n• Prevent the next X damage that would be dealt to any target this turn.",
    manaCost: { X: "X", W: 2 },
    types: ["Instant"],
    modes: [
        {
            id: "gain-life",
            label: "Target player gains X life",
            oracleText: "Target player gains X life.",
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "player") {
                    ctx.gainLife(target.id, ctx.getX());
                }
            },
        },
        {
            id: "prevent",
            label: "Prevent the next X damage to any target",
            oracleText:
                "Prevent the next X damage that would be dealt to any target this turn.",
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.preventNextNDamageToTarget(target, ctx.getX(), {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

// --- Enchantment triggers (CR 603) -----------------------------------------

// Spiritual Sanctuary — "At the beginning of each player's upkeep, if that
// player controls a Plains, they gain 1 life." (CR 603.6a + 603.4d if-clause.)
export const spiritualSanctuary: CardDefinition = {
    id: "654dd1e0-a91d-44ee-af20-c025bf360c3f",
    name: "Spiritual Sanctuary",
    oracleText:
        "At the beginning of each player's upkeep, if that player controls a Plains, they gain 1 life.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "spiritual-sanctuary-lifegain",
            oracleText:
                "At the beginning of each player's upkeep, if that player controls a Plains, they gain 1 life.",
            phase: "UPKEEP",
            scope: "each",
            interveningIf: (event, _self, state) => {
                const p = state?.players.find(
                    (pl) => pl.id === event.activePlayerId
                );
                return !!p?.battlefield.some((c) =>
                    c.subtypes.includes("Plains")
                );
            },
            resolve: (ctx, _event, scopedPlayerId) => {
                ctx.gainLife(scopedPlayerId, 1);
            },
        }),
    ],
};

// Lifeblood — "Whenever a Mountain an opponent controls becomes tapped, you
// gain 1 life." (CR 701.20a tap trigger, scoped to opponents' Mountains.)
export const lifeblood: CardDefinition = {
    id: "4ecb1362-9a67-4d4c-8d69-9ac2ebf4d0b0",
    name: "Lifeblood",
    oracleText:
        "Whenever a Mountain an opponent controls becomes tapped, you gain 1 life.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "lifeblood-mountain-tapped",
            oracleText:
                "Whenever a Mountain an opponent controls becomes tapped, you gain 1 life.",
            scope: "opponents",
            filter: { types: "Land", subtypes: "Mountain" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Presence of the Master — "Whenever a player casts an enchantment spell,
// counter it." (CR 601.2i cast trigger → CR 701.5a counter.)
export const presenceOfTheMaster: CardDefinition = {
    id: "1cb86b2f-116d-4952-b35a-1398341baaf5",
    name: "Presence of the Master",
    oracleText: "Whenever a player casts an enchantment spell, counter it.",
    manaCost: { X: 3, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "presence-of-the-master-counter",
            oracleText:
                "Whenever a player casts an enchantment spell, counter it.",
            scope: "any",
            filter: { types: ["Enchantment"] },
            resolve: (ctx, _event, spell) => {
                ctx.counter({ type: "spell", id: spell.instanceId });
            },
        }),
    ],
};

// --- Library inspection (CR 401) -------------------------------------------

// Visions — "Look at the top five cards of target player's library. You may
// then have that player shuffle that library." (CR 401.4 look → markKnown to
// the caster; optional shuffle, CR 701.20.)
export const visions: CardDefinition = {
    id: "21d00299-e183-4b3d-b015-18808e7135b9",
    name: "Visions",
    oracleText:
        "Look at the top five cards of target player's library. You may then have that player shuffle that library.",
    manaCost: { W: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (target?.type !== "player") return;
            const top = ctx.peekLibraryTop(target.id, 5);
            ctx.markKnown(target.id, top, ctx.caster);
            const shuffle = ctx.requestMayPay({
                playerId: ctx.caster,
                choiceId: "visions-shuffle",
                prompt: "Have that player shuffle their library?",
            });
            if (shuffle === undefined) return; // suspended
            if (shuffle) ctx.shuffleLibrary(target.id);
        },
    ],
};

/** Colour of a permanent view (CR 202.2), derived from its registered mana
 *  cost. Used by the Seeker block predicate, which receives a raw permanent
 *  view (no `StaticEffectContext`). Production instances carry only `{ id }` on
 *  `card`, so the cost is looked up cycle-safely via `manaCostForCardId`; test
 *  fixtures that inline `manaCost` on the view are honoured first. */
function colorsOf(view: { card: Record<string, unknown> }): string[] {
    const inlined = (view.card as { manaCost?: ManaCost }).manaCost;
    const cardId = (view.card as { id?: string }).id;
    const cost = inlined ?? (cardId ? manaCostForCardId(cardId) : undefined);
    if (!cost) return [];
    return (["W", "U", "B", "R", "G"] as const).filter(
        (c) => (cost[c] ?? 0) > 0
    );
}
