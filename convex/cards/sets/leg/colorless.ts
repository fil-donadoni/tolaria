// Legends (LEG) — Colorless: lands and artifacts (no coloured mana cost) cards, split by colour per ADR 0043.
// The registry's `import * as leg from "./sets/leg"` resolves through
// leg/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).

import type {
    CardDefinition,
    ManaCost,
    Rarity,
    SpellContext,
    PermanentView,
    StaticEffectContext,
    Color,
} from "../../types";
import { payOrSacrificeUpkeepTrigger } from "./multicolor";

// --- Vanilla / keyword creatures (CR 110.1 — pure data) -------------------

// Crimson Kobolds — vanilla 0/1 Kobold (CR 110.1; cost {0}, CR 202.1).
export const crimsonKobolds: CardDefinition = {
    id: "13696657-aeef-4add-9a3b-8137fce01fe3",
    rarity: "common",
    name: "Crimson Kobolds",
    oracleText: "",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 0,
    toughness: 1,
};

// Crookshank Kobolds — vanilla 0/1 Kobold (CR 110.1).
export const crookshankKobolds: CardDefinition = {
    id: "7af6b119-7db4-49dd-aaa4-044b8c133f13",
    rarity: "common",
    name: "Crookshank Kobolds",
    oracleText: "",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 0,
    toughness: 1,
};

// Kobolds of Kher Keep — vanilla 0/1 Kobold (CR 110.1).
export const koboldsOfKherKeep: CardDefinition = {
    id: "df0320d9-7c2a-456a-9159-1b4fae67bfb5",
    rarity: "common",
    name: "Kobolds of Kher Keep",
    oracleText: "",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 0,
    toughness: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts, lands & colorless free tranche (#377) — every artifact, land, and
// colorless Legends card expressible TODAY with existing primitives (keywords,
// staticEffects / layer system, trigger factories, prevention shields,
// activated / mana abilities, SpellContext methods). Data + resolve() closures
// only; zero engine change (ADR 0014). Legendary artifacts/lands ship carrying
// the `Legendary` supertype as data and become fully correct once the legend-
// rule SBA (#369 C1) lands. Source: MTGJSON LEG.json, modern Oracle text
// (ADR 0004).
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • C4 bands-with-other grant-lands: Adventurers' Guildhouse, Cathedral of
//     Serra, Mountain Stronghold, Seafarer's Quay, Unholy Citadel; and the
//     banding strip Tolaria.
//   • C5 named counters: Triassic Egg (hatchling counters), Voodoo Doll (pin
//     counters), Serpent Generator (poison-counter token).
//   • C7 upkeep pay-or-sacrifice: Forethought Amulet, The Tabernacle at Pendrell
//     Vale.
//
// SKIPPED here — needs an engine primitive that genuinely isn't built yet
// (data-only tranche must not build engine support); each lands in a later
// batch when its primitive ships:
//   • Hammerheim, Urborg — "target creature loses all landwalk / loses first
//     strike or swampwalk until end of turn" needs a duration-scoped keyword
//     REMOVAL; only static keyword-remove and keyword GRANT exist (same gap
//     flagged for Radjan Spirit).
//   • Karakas — "Return target legendary creature" needs a supertype target
//     filter; TargetRequirement has no `supertypeFilter`.
//   • Arena of the Ancients — "Legendary creatures don't untap" needs a
//     supertype-scoped untap-restriction; PermanentFilter has no supertypes
//     field.
//   • Al-abara's Carpet — "prevent all damage to you by attacking creatures
//     without flying" needs an attacker-flying-filtered player damage shield;
//     no primitive (Island Sanctuary is an attack restriction, not prevention).
//   • Horn of Deafening, Kry Shield — "prevent all damage that would be dealt
//     BY target creature" needs a per-source by-only prevention; only the
//     to-AND-by shield and global Fog exist (same gap flagged for Subdue).
//   • Marble Priest — "all Walls able to block this do so" + Wall-filtered
//     damage prevention has no clean primitive.
//   • Nova Pentacle — redirect player-damage onto a creature; no redirect-to-
//     creature shield kind exists (the shields redirect to a player).
//   • Bronze Horse — "prevent all damage by spells that target this, while you
//     control another creature" needs a conditional spell-damage prevention
//     guard; permanent-guard covers targeting/destroy, not damage.
//   • Sentinel — "change base toughness to 1 + target's power, indefinitely"
//     needs an indefinite base-P/T set; only phase-scoped setBasePT exists
//     (same gap flagged for Wood Elemental).
//   • North Star — "spend mana as though any type for one spell" needs a
//     one-shot any→any mana substitution; only static single-pair from→to
//     mana-substitution exists.
//   • Ring of Immortals — "counter a spell that targets a permanent you
//     control" needs a target-of-the-spell predicate not exposed to
//     TargetRequirement.
//   • Sword of the Ages — "Sacrifice any number of creatures" as a cost needs a
//     variable multi-sacrifice activation cost; only single sacrificeFilter
//     exists.
//   • Gauntlets of Chaos — two-target type-matched control exchange + aura
//     destruction; deferred to keep this batch low-risk.
//   • Knowledge Vault — "return all cards exiled with this artifact to hand /
//     graveyard" needs exile-by-source tracking with non-battlefield return;
//     returnExiledForSource returns to the battlefield only.
//   • Life Chisel — gain life equal to the SACRIFICED creature's toughness; the
//     sacrifice cost snapshots mana value only, not toughness.
//   • Life Matrix — grants an INDEFINITE activated ability to a creature;
//     grantAbility is phase-scoped only.
// ─────────────────────────────────────────────────────────────────────────────

// --- Cost-reduction artifacts (CR 601.2f — cost-modifier static) ----------

// Mana Matrix — "Instant and enchantment spells you cast cost {2} less."
// Generic-only reduction (CR 601.2f) scoped to the controller via the spell's
// controllerId matching the artifact's controllerId.
export const manaMatrix: CardDefinition = {
    id: "a3eedc11-0b47-430c-8391-577a2d05c2ae",
    rarity: "rare",
    name: "Mana Matrix",
    oracleText:
        "Instant and enchantment spells you cast cost {2} less to cast.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (
                card: PermanentView,
                _ctx: StaticEffectContext,
                effectSource?: PermanentView
            ) =>
                card.controllerId === effectSource?.controllerId &&
                (card.types.includes("Instant") ||
                    card.types.includes("Enchantment")),
            costReduction: { X: 2 },
        },
    ],
};

// Planar Gate — "Creature spells you cast cost {2} less to cast."
export const planarGate: CardDefinition = {
    id: "dd27f0fe-c032-4f61-9f3d-98a6d2e2c426",
    rarity: "rare",
    name: "Planar Gate",
    oracleText: "Creature spells you cast cost {2} less to cast.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (
                card: PermanentView,
                _ctx: StaticEffectContext,
                effectSource?: PermanentView
            ) =>
                card.controllerId === effectSource?.controllerId &&
                card.types.includes("Creature"),
            costReduction: { X: 2 },
        },
    ],
};

// --- Utility artifacts (CR 602 activated abilities) -----------------------

// Relic Barrier — "{T}: Tap target artifact." (CR 701.20 tap.)
export const relicBarrier: CardDefinition = {
    id: "c062cbae-ce5e-43be-9932-c81a0a3622e8",
    rarity: "uncommon",
    name: "Relic Barrier",
    oracleText: "{T}: Tap target artifact.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "relic-barrier-tap",
            oracleText: "{T}: Tap target artifact.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.tap(target);
            },
        },
    ],
};

// Alchor's Tomb — "{2}, {T}: Target permanent you control becomes the color of
// your choice. (This effect lasts indefinitely.)" (CR 105.2, 611 color-set via
// indefinite setColorOverride; the color is a player option choice.)
export const alchorsTomb: CardDefinition = {
    id: "f4395b19-2118-4a09-8932-f9ce9bc54d6d",
    rarity: "rare",
    name: "Alchor's Tomb",
    oracleText:
        "{2}, {T}: Target permanent you control becomes the color of your choice. (This effect lasts indefinitely.)",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "alchors-tomb-color",
            oracleText:
                "{2}, {T}: Target permanent you control becomes the color of your choice.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "any",
                count: 1,
                controller: "you",
            },
            resolveSteps: [
                (ctx: SpellContext) => {
                    const target = ctx.targets[0];
                    if (target?.type !== "permanent") return;
                    const pick = ctx.requestOptionChoice({
                        playerId: ctx.controller,
                        choiceId: "alchors-tomb-color",
                        prompt: "Choose a color.",
                        options: [
                            { id: "W", label: "White" },
                            { id: "U", label: "Blue" },
                            { id: "B", label: "Black" },
                            { id: "R", label: "Red" },
                            { id: "G", label: "Green" },
                        ],
                    });
                    if (pick === undefined) return; // suspended
                    ctx.setColorOverride(target, [pick as "W"]);
                },
            ],
        },
    ],
};

// Mirror Universe — "{T}, Sacrifice Mirror Universe: Exchange life totals with
// target opponent. Activate only during your upkeep." (CR 118.5 life exchange,
// modeled as gain/loss deltas since there is no setLife primitive.)
export const mirrorUniverse: CardDefinition = {
    id: "a8f05d5e-bb7d-4554-b880-f0c6b4688357",
    rarity: "rare",
    name: "Mirror Universe",
    oracleText:
        "{T}, Sacrifice Mirror Universe: Exchange life totals with target opponent. Activate only during your upkeep.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "mirror-universe-exchange",
            oracleText:
                "{T}, Sacrifice Mirror Universe: Exchange life totals with target opponent. Activate only during your upkeep.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "player") return;
                const mine = ctx.getLife(ctx.controller);
                const theirs = ctx.getLife(target.id);
                const delta = mine - theirs;
                if (delta > 0) {
                    ctx.loseLife(ctx.controller, delta);
                    ctx.gainLife(target.id, delta);
                } else if (delta < 0) {
                    ctx.gainLife(ctx.controller, -delta);
                    ctx.loseLife(target.id, -delta);
                }
            },
        },
    ],
};

// --- Legendary lands (CR 305 land + 205.4a Legendary supertype) -----------

// Pendelhaven — Legendary land. "{T}: Add {G}." + "{T}: Target 1/1 creature gets
// +1/+2 until end of turn." (CR 605.1a mana ability; CR 611.1 temp P/T buff
// gated by a 1/1 power+toughness filter.)
export const pendelhaven: CardDefinition = {
    id: "79427109-c1f3-476d-a029-0049217237b5",
    rarity: "uncommon",
    name: "Pendelhaven",
    oracleText:
        "{T}: Add {G}.\n{T}: Target 1/1 creature gets +1/+2 until end of turn.",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "pendelhaven-mana",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaProduced: { G: 1 },
        },
        {
            id: "pendelhaven-pump",
            oracleText:
                "{T}: Target 1/1 creature gets +1/+2 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { min: 1, max: 1 },
                toughnessFilter: { min: 1, max: 1 },
            },
            // Migrated resolve()→effects[] (ADR 0045, #840): +1/+2 to the
            // targeted 1/1 creature until end of turn (CR 611.1) via `pump`.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C4 — Bands with other [quality] (CR 702.22j, #381)
//
// The restricted banding variant. Encoded as a parametric keyword string on
// `staticAbilities` and consumed by the band-formation legality check in
// `convex/gre/banding.ts`:
//
//   "bands with other:legendary"               — "bands with other legendary creatures"
//   "bands with other:name=Wolves of the Hunt" — "bands with other creatures named …"
//
// A band is legal (CR 702.22j) when some member has "bands with other [Q]" and
// EVERY member satisfies that quality [Q]. The damage-division property of
// banding (CR 702.22j-k) also applies — `getDamageAssignerId` treats a
// bands-with-other creature exactly like a plain-banding one.
//
// Scope of #381: band-FORMATION eligibility + the damage-assignment authority,
// reusing the shipped banding engine (block-as-a-group and damage division were
// already built for plain banding). No new attacking-band primitives.
//
// The five grant-lands publish the keyword onto color-matched legendary
// creatures their controller controls via a filtered `keyword-grant` static
// effect (continuous, CR 611). Master of the Hunt mints same-named Wolf tokens
// carrying the name-quality keyword. Shelkin Brownie and Tolaria strip the
// ability until end of turn via the duration-scoped `removeStaticAbilities`
// primitive (Tolaria also strips plain banding).
// ─────────────────────────────────────────────────────────────────────────────

/** Predicate factory for a grant-land: matches the controller's legendary
 *  creatures of the given color (CR 611 — "[Color] legendary creatures you
 *  control"). */
const legendaryCreatureGrant =
    (
        color: Color
    ): ((
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean) =>
    (target, source, ctx) =>
        ctx.isCreature(target) &&
        target.controllerId === source.controllerId &&
        ctx.hasSupertype(target, "Legendary") &&
        ctx.getColors(target).includes(color);

// Adventurers' Guildhouse — "Green legendary creatures you control have 'bands
// with other legendary creatures.'" (CR 702.22j via keyword-grant.)
export const adventurersGuildhouse: CardDefinition = {
    id: "32865e68-5842-4f17-b2ea-4ffa743b511f",
    rarity: "uncommon",
    name: "Adventurers' Guildhouse",
    oracleText:
        'Green legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("G"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Cathedral of Serra — White legendary creatures grant-land.
export const cathedralOfSerra: CardDefinition = {
    id: "e65356e6-0ead-49fd-b069-be1ea9b1c105",
    rarity: "uncommon",
    name: "Cathedral of Serra",
    oracleText:
        'White legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("W"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Mountain Stronghold — Red legendary creatures grant-land.
export const mountainStronghold: CardDefinition = {
    id: "314fd1d7-4bd8-4d95-b7c2-1aa6660ab88a",
    rarity: "uncommon",
    name: "Mountain Stronghold",
    oracleText:
        'Red legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("R"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Seafarer's Quay — Blue legendary creatures grant-land.
export const seafarersQuay: CardDefinition = {
    id: "66641d88-b3f0-4bcd-8d2d-29aa2de69e30",
    rarity: "uncommon",
    name: "Seafarer's Quay",
    oracleText:
        'Blue legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("U"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Unholy Citadel — Black legendary creatures grant-land.
export const unholyCitadel: CardDefinition = {
    id: "9de534ff-fb48-4692-bd0f-dd237ca28502",
    rarity: "uncommon",
    name: "Unholy Citadel",
    oracleText:
        'Black legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("B"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Tolaria — "{T}: Add {U}." and "{T}: Target creature loses banding and all
// 'bands with other' abilities until end of turn. Activate only during any
// upkeep step." (CR 605.1a mana ability + CR 611.1b duration-scoped strip with
// a phase-restricted activation.) Legendary land.
export const tolaria: CardDefinition = {
    id: "d43c01b7-443d-4061-a934-6863d230c9b8",
    rarity: "uncommon",
    name: "Tolaria",
    oracleText:
        '{T}: Add {U}.\n{T}: Target creature loses banding and all "bands with other" abilities until end of turn. Activate only during any upkeep step.',
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "tolaria-mana",
            oracleText: "{T}: Add {U}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 1 }),
            manaProduced: { U: 1 },
        },
        {
            id: "tolaria-strip",
            oracleText:
                '{T}: Target creature loses banding and all "bands with other" abilities until end of turn. Activate only during any upkeep step.',
            cost: { tap: true },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.removeStaticAbilities(
                    target,
                    (kw) =>
                        kw === "banding" || kw.startsWith("bands with other:"),
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

/** CR 205 — true if `target` is a Creature (The Tabernacle's affected set).
 *  Reads live `types` so a permanent animated into a creature is taxed too;
 *  the set is recomputed as creatures enter/leave (CR 611). */
const IS_CREATURE: (
    target: PermanentView,
    source: PermanentView,
    ctx: StaticEffectContext
) => boolean = (target) => target.types.includes("Creature");

// The Tabernacle at Pendrell Vale — Legendary Land. "All creatures have 'At the
// beginning of your upkeep, destroy this creature unless you pay {1}.'" The
// granted upkeep tax is attached to every creature (either player's) while the
// Tabernacle is in play via a `triggered-grant` static effect (CR 113.1 / 611),
// exactly like Energy Flux taxes every artifact. Each creature's controller, at
// the start of their OWN upkeep, may pay {1} to keep it — otherwise it is
// destroyed (CR 701.7). Each creature gets its own trigger on the stack so the
// pay-or-destroy decision is independent per creature (CR 603.3b). Legendary
// land → tapping for no mana; supertype carried as data (CR 205.4a), legend
// rule applies once the C1 SBA lands.
export const theTabernacleAtPendrellVale: CardDefinition = {
    id: "64bc9b1d-5818-4d9e-b771-e49af4ff9a5c",
    rarity: "rare",
    name: "The Tabernacle at Pendrell Vale",
    oracleText:
        'All creatures have "At the beginning of your upkeep, destroy this creature unless you pay {1}."',
    types: ["Land"],
    supertypes: ["Legendary"],
    staticEffects: [
        // CR 113.1 / 611 — grant the upkeep tax to every creature.
        {
            kind: "triggered-grant",
            applies: IS_CREATURE,
            abilityId: "tabernacle-upkeep",
        },
    ],
    // The granted template lives here, NOT on `triggeredAbilities`, so the
    // Tabernacle itself (a Land, not a creature) never fires it.
    triggeredGrantTemplates: [
        payOrSacrificeUpkeepTrigger({
            id: "tabernacle-upkeep",
            cardName: "this creature",
            cost: { X: 1 },
            costText: "{1}",
            consequence: "destroy",
        }),
    ],
};

// --- Mana Batteries (#482) ---------------------------------------------------
//
// The five {4} colour Mana Batteries share one shape:
//   "{2}, {T}: Put a charge counter on this artifact."
//   "{T}, Remove any number of charge counters from this artifact: Add {C}, then
//    add an additional {C} for each charge counter removed this way."
//   ({C} = the battery's colour.)
//
// The first half is an ordinary activated ability that uses the stack (CR 605 —
// it is NOT a mana ability: it adds a counter, not mana) with a {2} mana cost
// and a {T} cost; it accrues one `charge` counter per activation via
// `ctx.addCounter` (CR 122.1).
//
// The second half is a mana ability (CR 605.1a, `useStack: false` → resolves
// immediately, no stack). The player chooses N = 0..available charge counters;
// the ability removes N counters as part of its cost and produces 1 + N mana of
// the battery's colour (CR 106.1). This is expressed by reusing the existing
// board-conditional `getManaChoices` chooser (the Fellwar Stone primitive):
// each choice index N maps to "produce 1 + N mana", and the new
// `manaChoiceRemovesCounters` field tells the engine the chosen index N is also
// the number of `charge` counters to remove (CR 122.6) — keeping the cost and
// the output locked to the same single player choice. No new SpellContext
// primitive and no per-card engine code: one factory drives all five colours.
function makeManaBattery(config: {
    id: string;
    name: string;
    rarity: Rarity;
    color: Color;
}): CardDefinition {
    const { id, name, rarity, color } = config;
    const colorLabel = `{${color}}`;
    return {
        id,
        name,
        rarity,
        oracleText:
            `{2}, {T}: Put a charge counter on this artifact.\n` +
            `{T}, Remove any number of charge counters from this artifact: ` +
            `Add ${colorLabel}, then add an additional ${colorLabel} for each ` +
            `charge counter removed this way.`,
        manaCost: { X: 4 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "mana-battery-charge",
                oracleText: "{2}, {T}: Put a charge counter on this artifact.",
                cost: { mana: { X: 2 }, tap: true },
                // CR 605: this ability adds a counter, not mana, so it uses the
                // stack like any ordinary activated ability.
                useStack: true,
                resolve: (ctx: SpellContext) => {
                    // CR 122.1 — accrue one charge counter on the source.
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "charge",
                        1
                    );
                },
            },
            {
                id: "mana-battery-tap",
                oracleText:
                    `{T}, Remove any number of charge counters from this artifact: ` +
                    `Add ${colorLabel}, then add an additional ${colorLabel} for ` +
                    `each charge counter removed this way.`,
                cost: { tap: true },
                // CR 605.1a — mana ability: resolves immediately, no stack.
                useStack: false,
                // Representative / fallback output (used by best-effort callers
                // without a board snapshot): the base one mana with no counters
                // removed. The board-conditional `getManaChoices` below is what
                // the player actually picks from.
                manaChoices: [{ [color]: 1 } as ManaCost],
                effect: (ctx) => ctx.addMana({ [color]: 1 } as ManaCost),
                // CR 106.1 / 122.6 — index N = "remove N charge counters, add
                // 1 + N mana of the battery's colour". With `available` counters
                // the chooser offers N = 0..available, i.e. 1..1+available mana.
                getManaChoices: (source) => {
                    const available = source.counters?.charge ?? 0;
                    const out: ManaCost[] = [];
                    for (let n = 0; n <= available; n++) {
                        out.push({ [color]: 1 + n } as ManaCost);
                    }
                    return out;
                },
                // The chosen index N is also the number of `charge` counters
                // removed to pay the scaling cost (CR 122.6), restored on untap.
                manaChoiceRemovesCounters: "charge",
            },
        ],
    };
}

export const blackManaBattery: CardDefinition = makeManaBattery({
    id: "d0c66e64-e357-457d-8302-b3a1fc0c56ce",
    rarity: "uncommon",
    name: "Black Mana Battery",
    color: "B",
});

export const blueManaBattery: CardDefinition = makeManaBattery({
    id: "35393661-2c53-46f0-bb33-2390d552b060",
    rarity: "uncommon",
    name: "Blue Mana Battery",
    color: "U",
});

export const greenManaBattery: CardDefinition = makeManaBattery({
    id: "4671fa01-4a9e-4cd9-8154-b0d45e11b702",
    rarity: "uncommon",
    name: "Green Mana Battery",
    color: "G",
});

export const redManaBattery: CardDefinition = makeManaBattery({
    id: "363cc5d6-70f8-4a3c-92bd-8f49774bdce2",
    rarity: "uncommon",
    name: "Red Mana Battery",
    color: "R",
});

export const whiteManaBattery: CardDefinition = makeManaBattery({
    id: "35fbbe41-d21b-4028-905f-054c44d30eb2",
    rarity: "uncommon",
    name: "White Mana Battery",
    color: "W",
});
