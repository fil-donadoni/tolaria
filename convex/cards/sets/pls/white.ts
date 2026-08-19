// PLS (Planeshift) — white cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    Color,
    EffectTokenSpec,
    ManaCost,
    PermanentView,
} from "../../types";
import {
    AURA_AFFECTS_HOST,
    EFFECT_AFFECTS_SELF,
    PERMANENT_TYPES,
    mostCommonColors,
} from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { manaCostForCardId } from "../../manaCostLookup";

// The five colours a "choose a color" effect can name (CR 105.1), in WUBRG
// order — Voice of All's CR 614.12 as-enters pick, mirroring the
// Prismatic Ward / Quirion Elves idiom (`ice/white.ts`, `mir/green.ts`).
const PLS_WHITE_COLORS = ["W", "U", "B", "R", "G"] as const;
const PLS_WHITE_COLOR_NAMES: Record<(typeof PLS_WHITE_COLORS)[number], string> =
    {
        W: "white",
        U: "blue",
        B: "black",
        R: "red",
        G: "green",
    };

/** Live colour read off a `PermanentView` with no `ctx` in scope (a
 *  `block-restriction` predicate gets `(self, opponent, state?)` only — no
 *  colour-derivation context). Mirrors `inv/blue.ts`'s local
 *  `effectiveColors` helper exactly (duplicated per-file, same precedent as
 *  `arn/white.ts`'s `permanentColors`): colorOverride wins outright, else
 *  derive from mana cost, then fold in granted colors. `perm` carries
 *  `colorOverride`/`grantedColors` at runtime even though `PermanentView`'s
 *  declared type doesn't list them — the combat validator passes the raw
 *  (fat) `CardInstanceState`, just typed narrower. Reimplemented locally
 *  rather than imported to avoid the same eval-time registry cycle
 *  `inv/blue.ts` documents (`gre/layers.ts` imports the card registry, which
 *  imports every set module including this one). */
function effectiveColors(perm: PermanentView): Color[] {
    const raw = perm as unknown as {
        colorOverride?: Color[];
        card?: { id?: string; manaCost?: ManaCost };
        grantedColors?: { color: string }[];
    };
    if (raw.colorOverride) return raw.colorOverride;
    const cost =
        raw.card?.manaCost ??
        (raw.card?.id ? manaCostForCardId(raw.card.id) : undefined);
    const base = cost
        ? (["W", "U", "B", "R", "G"] as const).filter((c) => (cost[c] ?? 0) > 0)
        : [];
    if (!raw.grantedColors?.length) return [...base];
    const all = new Set<Color>(base);
    for (const g of raw.grantedColors) all.add(g.color as Color);
    return [...all];
}

// Lashknife Barrier — {2}{W} Enchantment. "When this enchantment enters,
// draw a card.\nIf a source would deal damage to a creature you control, it
// deals that much damage minus 1 to that creature instead." (CR 614
// continuous replacement — issue #1939.) The ETB draw is a plain `draw` Op
// trigger (DSL-first). The reduction is a permanent-bound
// `replacementEffects[]` entry, the same live-scan mechanism as Well-Laid
// Plans / Camel (`convex/cards/sets/inv/blue.ts` / `arn/white.ts`) — no new
// persisted state, since the effect is simply "active while this enchantment
// is on the battlefield" and re-evaluated at every `damage` event.
//
// Generalization over the existing player-scoped shield
// (`PlayerDamagePreventionShield`, `gre/state.ts`): that shield's `mode` is
// `"all" | "half-down"` and its scope is a single PLAYER ("damage to you").
// Lashknife Barrier needs neither — its scope is a FILTERED SET of
// permanents (every creature the controller of Lashknife Barrier controls,
// not a fixed instance list) and its residual is a flat "minus 1", which
// fits the `ReplacementEffect.appliesTo`/`replace` closure shape directly
// rather than the transient-shield family (that family models one-shot /
// N-charge grants created by an activated ability mid-game, not a
// permanent's own continuous static text). `Math.max(0, amount - 1)` keeps
// the reduction from going negative (a 1-damage source deals 0, never
// "negative damage").
export const lashknifeBarrier: CardDefinition = {
    id: "2485c10d-de02-4be9-8119-afb2296e3317", // PLS printing (scryfallId)
    name: "Lashknife Barrier",
    rarity: "uncommon",
    oracleText:
        "When this enchantment enters, draw a card.\nIf a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "lashknife-barrier-etb",
            oracleText: "When this enchantment enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    replacementEffects: [
        {
            id: "lashknife-barrier-reduce",
            eventKind: "damage",
            oracleText:
                "If a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead.",
            appliesTo: (event, self, state) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "permanent") return false;
                const targetCreature = state.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === event.target.id);
                if (!targetCreature?.types.includes("Creature")) return false;
                return targetCreature.controllerId === self.controllerId;
            },
            // CR 614 — reduce the damage by 1, floored at 0.
            replace: (event) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        amount: Math.max(0, event.amount - 1),
                    },
                };
            },
        },
    ],
};

// Heroic Defiance — {1}{W} Enchantment — Aura. "Enchant creature. Enchanted
// creature gets +3/+3 unless it shares a color with the most common color
// among all permanents or a color tied for most common." (CR 613 board-wide
// colour census, issue #1943, PRD #1935 cluster C8b.)
//
// The census counts each colour across EVERY permanent both players control
// (every card type, not creatures only) via the shared `mostCommonColors`
// helper (`cards/types.ts`, promoted off its 3rd consumer — Goham Djinn /
// Tsabo's Assassin, `sets/inv/black.ts`, were the first two). A multicoloured
// permanent contributes to each of its colours; a colourless permanent
// contributes to none and can never be "most common". With no coloured
// permanents at all `mostCommonColors` returns `[]`, and `.some(...)` on an
// empty array is false, so the bonus applies — exactly the "no coloured
// permanents ⇒ bonus applies" acceptance criterion, for free.
//
// Modeled as a `pt-cda` (CR 613.4a/7a), not a `pt-buff` + `condition`: a
// `pt-buff`'s `condition` is evaluated per-SOURCE only (`source, state, ctx`
// — no `target` parameter, `cards/types.ts` `StaticPTBuff.condition`), so it
// cannot read the enchanted creature's OWN colour to compare against the
// census. `pt-cda`'s `compute` receives `target` as its 4th argument
// (`StaticPTCDA.compute`), which is exactly what "unless IT shares a colour"
// needs. Same shape as Exotic Curse / Goham Djinn (`sets/inv/black.ts`).
//
// No CR 613.8 dependency-loop risk: the census reads `ctx.getColors` (layer
// 5, colour — already resolved by the time this layer-7 P/T read runs) to
// compute a P/T contribution; it never feeds back into colour derivation, so
// there is nothing to order against itself. `ctx.getColors` already resolves
// the EFFECTIVE colour (CR 613.1d `colorOverride`, granted colours), so a
// colour-changing effect elsewhere on the board shifts the census on its own
// — no extra wiring needed here.
//
// DIVERGENCE: `getCDAContribution` (`gre/layers.ts`) overwrites rather than
// sums layer-7a `pt-cda` contributions across sources, which is correct for
// a true CR 613.4b "set" CDA but wrong for this card's CR 613.4c-shaped
// *modification* — enchanting a creature that carries its OWN `pt-cda`
// (e.g. Nightmare) makes one effect silently clobber the other, in the
// worst case producing a 0/0 that dies to SBA. `pt-buff` (layer 7c) can't
// express this card instead: its `applies` gets no `state` (can't read the
// board-wide census) and its `condition` gets no `target` (can't compare the
// enchanted creature's own colour). Bug-class tracked-by: #1992.
export const heroicDefiance: CardDefinition = {
    id: "0dc1aa36-5d3b-4d25-9d54-937cdabf72a4", // PLS 6
    rarity: "common",
    name: "Heroic Defiance",
    oracleText:
        "Enchant creature\nEnchanted creature gets +3/+3 unless it shares a color with the most common color among all permanents or a color tied for most common.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (_source, state, ctx, target) => {
                const mostCommon = mostCommonColors(state, ctx);
                const sharesColor = ctx
                    .getColors(target)
                    .some((c) => mostCommon.includes(c));
                return sharesColor
                    ? { power: 0, toughness: 0 }
                    : { power: 3, toughness: 3 };
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche (issue #1948, parent PRD #1935) — every card below is
// expressible with already-shipped Ops/keywords (Kicker, Domain, cost
// reduction, the CR 614.12 as-enters choice, the layer system). Two cards
// hit genuine capability gaps and are left as tracked stubs at the end of
// this section (Planeswalker's Mirth, Sunscape Battlemage).
// ─────────────────────────────────────────────────────────────────────────

// Aura Blast — {1}{W} Instant. "Destroy target enchantment.\nDraw a card."
// (CR 701.8 destroy, CR 121.1 draw.)
export const auraBlast: CardDefinition = {
    id: "090f5ad6-e10e-49b3-8643-51a4e792517c", // PLS 1
    name: "Aura Blast",
    rarity: "common",
    oracleText: "Destroy target enchantment.\nDraw a card.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Enchantment", count: 1 },
    effects: [
        { op: "destroy", target: { target: 0 } },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Aurora Griffin — {3}{W} Creature — Griffin, 2/2. "Flying\n{W}: Target
// permanent becomes white until end of turn." (CR 702.9 flying; CR 613.1e
// colour-change via the `setColor` Op, issue #1083.) "Target permanent" of
// any type uses the full CR 300.1 permanent-type set (incl. Land), not
// `type: "any"` (which matches only the CR 115.4 damageable types) —
// Vindicate / Boomerang precedent (`apc/multicolor.ts`).
export const auroraGriffin: CardDefinition = {
    id: "bfd6c695-1944-4bb0-a701-0daf47cdbcb4", // PLS 2
    name: "Aurora Griffin",
    rarity: "common",
    oracleText:
        "Flying\n{W}: Target permanent becomes white until end of turn.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Griffin"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "aurora-griffin-color",
            oracleText:
                "{W}: Target permanent becomes white until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            targetRequirement: { type: [...PERMANENT_TYPES], count: 1 },
            effects: [
                {
                    op: "setColor",
                    target: { target: 0 },
                    colors: ["W"],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Disciple of Kangee — {2}{W} Creature — Human Wizard, 2/2. "{U}, {T}:
// Target creature gains flying and becomes blue until end of turn." (CR
// 702.9 temporary flying grant via `grantAbility`, issue #843; CR 613.1e
// colour-change via `setColor`, issue #1083 — the SAME two-Op composition
// Disciple of Kangee's blue mirror-image, Tidal Visionary, already ships.)
export const discipleOfKangee: CardDefinition = {
    id: "e268fe16-070b-4b78-9793-59755edb2fd5", // PLS 3
    name: "Disciple of Kangee",
    rarity: "common",
    oracleText:
        "{U}, {T}: Target creature gains flying and becomes blue until end of turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "disciple-of-kangee-fly-blue",
            oracleText:
                "{U}, {T}: Target creature gains flying and becomes blue until end of turn.",
            cost: { mana: { U: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "setColor",
                    target: { target: 0 },
                    colors: ["U"],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// The five WUBRG basic-land-type → protection-colour pairs Dominaria's
// Judgment grants "until end of turn ... if you control a <land>". Table
// form avoids repeating the same `if` shape five times by hand.
const DOMINARIAS_JUDGMENT_PAIRS: { subtype: string; colorName: string }[] = [
    { subtype: "Plains", colorName: "white" },
    { subtype: "Island", colorName: "blue" },
    { subtype: "Swamp", colorName: "black" },
    { subtype: "Mountain", colorName: "red" },
    { subtype: "Forest", colorName: "green" },
];

// Dominaria's Judgment — {2}{W} Instant. "Until end of turn, creatures you
// control gain protection from white if you control a Plains, from blue if
// you control an Island, from black if you control a Swamp, from red if you
// control a Mountain, and from green if you control a Forest." (CR 702.16
// protection, CR 611.2a temporary grant via `grantAbility`.) Each of the five
// clauses is a per-creature `if`/`count` pair — "control a <land>" is a
// board-wide condition independent of WHICH creature is being granted
// protection, so it is re-evaluated once per iterated creature (correct, just
// not memoized — five cheap battlefield scans per creature, no card in this
// engine's supported pool has enough creatures for that to matter). `count`
// (`EffectCountSpec`, issue #999) matches "a <land>" against the LAND
// SUBTYPE (not merely a card named "Plains"), so a nonbasic land carrying the
// Plains type (Snow-Covered Plains, a dual) counts too — broader than a
// basic-only check, matching CR 305.6.
export const dominariasJudgment: CardDefinition = {
    id: "9703d090-b415-48e2-8158-dd8fc57ecc50", // PLS 4
    name: "Dominaria's Judgment",
    rarity: "rare",
    oracleText:
        "Until end of turn, creatures you control gain protection from white if you control a Plains, from blue if you control an Island, from black if you control a Swamp, from red if you control a Mountain, and from green if you control a Forest.",
    manaCost: { X: 2, W: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                controller: "controller",
                filter: { type: "Creature" },
            },
            effects: DOMINARIAS_JUDGMENT_PAIRS.map(
                ({ subtype, colorName }) => ({
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { subtype },
                            },
                        },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "grantAbility",
                            ability: `protection from ${colorName}`,
                            target: { ref: "$each" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                })
            ),
        },
    ],
};

// Hobble — {2}{W} Enchantment — Aura. "Enchant creature\nWhen this Aura
// enters, draw a card.\nEnchanted creature can't attack.\nEnchanted creature
// can't block if it's black." (CR 303.4 aura; CR 121.1 ETB draw; CR 508.1c
// attack-restriction and CR 509.1a block-restriction, both AURA-GRANTED onto
// the host.)
//
// The "can't attack" clause needed a small engine fix (`gre/combat.ts`):
// `collectAttackRestrictions` previously read ONLY a permanent's OWN
// `staticEffects[]` (fine for a self-restricting creature like Vodalian
// Serpent), never an attached Aura's — an asymmetry with
// `collectBlockRestrictions`, which already scans attached auras (CR 303.4 —
// "aura effects apply to their host"). Extended `collectAttackRestrictions`
// to accept the optional `state` its caller (`validateAttackerEligibility`)
// already threads and scan attached auras identically to the block-side
// helper, rather than reaching for the unrelated "defender" keyword (CR
// 702.3a) as a hack — defender carries its own identity (Prison
// Barricade-style "as though it didn't have defender" overrides key off the
// literal keyword), which this card's oracle text never grants.
export const hobble: CardDefinition = {
    id: "54c76a22-f9e3-408b-a5bd-403add57e31a", // PLS 7
    name: "Hobble",
    rarity: "common",
    oracleText:
        "Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature can't attack.\nEnchanted creature can't block if it's black.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        enteredTrigger({
            id: "hobble-etb-draw",
            oracleText: "When this Aura enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "hobble-cant-attack",
            predicate: () => false,
            oracleText: "Enchanted creature can't attack.",
        },
        {
            kind: "block-restriction",
            id: "hobble-cant-block-if-black",
            side: "blocker",
            predicate: (self) => !effectiveColors(self).includes("B"),
            oracleText: "Enchanted creature can't block if it's black.",
        },
    ],
};

// Honorable Scout — {W} Creature — Human Soldier Scout, 1/1. "When this
// creature enters, you gain 2 life for each black and/or red creature target
// opponent controls." (CR 603.6a ETB; CR 119.3 life gain scaled by a
// targeted-player battlefield count, `EffectCountSpec`, issue #999 — `color`
// is an OR filter, CR 202.2, so a black-red creature counts once, exactly
// "black and/or red" and never double.)
export const honorableScout: CardDefinition = {
    id: "bd311758-0352-4b7d-a24f-7f3f2b5d7b0f", // PLS 8
    name: "Honorable Scout",
    rarity: "common",
    oracleText:
        "When this creature enters, you gain 2 life for each black and/or red creature target opponent controls.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier", "Scout"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "honorable-scout-etb",
            oracleText:
                "When this creature enters, you gain 2 life for each black and/or red creature target opponent controls.",
            scope: "self",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: { target: 0 },
                            filter: { type: "Creature", color: ["B", "R"] },
                            times: 2,
                        },
                    },
                },
            ],
        }),
    ],
};

// The 1/1 white Spirit flying token March of Souls creates for each creature
// destroyed this way (PLS's printed token for this card, Scryfall id
// 6f5a5786-e2be-4bb0-b971-81d1d5cc8f52 — reverse-linked off March of Souls's
// own `all_parts`). Pinned explicitly (no lockfile regen) per the
// resolve()-closure blind spot the token/emblem art rule calls out — this
// token is created inside a `forEach` body, not from a top-level `createToken`
// the lockfile script's static scan would catch either way, so pinning is the
// simplest correct path.
const MARCH_OF_SOULS_SPIRIT: EffectTokenSpec = {
    name: "Spirit",
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 1,
    toughness: 1,
    colors: ["W"],
    staticAbilities: ["flying"],
    imagePrintId: "6f5a5786-e2be-4bb0-b971-81d1d5cc8f52",
};

// March of Souls — {4}{W} Sorcery. "Destroy all creatures. They can't be
// regenerated. For each creature destroyed this way, its controller creates
// a 1/1 white Spirit creature token with flying." (CR 701.8 mass destroy +
// CR 701.8c "can't be regenerated" via `cantBeRegenerated`, the Wrath of God
// idiom this file already ships; CR 111 token creation.)
//
// "For each creature destroyed this way" excludes a creature that SURVIVES
// the destroy (indestructible) — checked per-iteration via `objectMatchesFilter`
// on the SAME `$each` ref the `destroy` Op just acted on: `resolveObjectRef`
// for a bound permanent ref returns undefined once the permanent has left the
// battlefield (CR 608.2b), so the predicate reads `false` for a creature that
// was actually destroyed (create the token) and `true` for one still on the
// battlefield (indestructible saved it — no token). `{ ref: "$each.controller" }`
// as `createToken`'s `controller` (an `EffectPlayerRef` bare-ref form, issue
// #807/#1083) reads the iterated creature's OWN controller from its
// per-iteration snapshot — LKI (CR 608.2h), so it still resolves after the
// creature has left play — giving the token to ITS controller, not the caster.
export const marchOfSouls: CardDefinition = {
    id: "f07dd0f1-b80b-4af0-ae76-907ec55ec7d5", // PLS 10
    name: "March of Souls",
    rarity: "rare",
    oracleText:
        "Destroy all creatures. They can't be regenerated. For each creature destroyed this way, its controller creates a 1/1 white Spirit creature token with flying.",
    manaCost: { X: 4, W: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [
                {
                    op: "destroy",
                    target: { ref: "$each" },
                    cantBeRegenerated: true,
                },
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$each" },
                        filter: { type: "Creature" },
                    },
                    then: [],
                    else: [
                        {
                            op: "createToken",
                            token: MARCH_OF_SOULS_SPIRIT,
                            controller: { ref: "$each.controller" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Orim's Chant — {W} Instant. "Kicker {W} (You may pay an additional {W} as
// you cast this spell.)\nTarget player can't cast spells this turn. If this
// spell was kicked, creatures can't attack this turn." (CR 702.33 Kicker, CR
// 601.3a a per-player "can't cast spells" turn restriction via
// `restrictCasting`, CR 508.1a "can't attack" via `restrictCombat`.)
//
// DIVERGENCE (tracked-by: #2002): the kicked clause is "creatures can't
// attack this turn" — EVERY creature, including one that enters the
// battlefield LATER this same turn, before attackers are declared. The
// engine has no turn-scoped GLOBAL "can't attack" flag (only a PER-INSTANCE
// one, `restrictCombat`/`setCantAttackThisTurn`) — the same gap
// `drk/colorless.ts`'s Festival stub documents (that card stays fully
// deferred; its own tracking ref, the closed whole-slice issue #411, no
// longer points anywhere useful, hence the fresh issue). This ships the
// forEach-over-CURRENTLY-existing-creatures approximation, which is CR-exact
// for every board state that doesn't flash a creature in between this
// spell's resolution and the declare-attackers step later the same turn —
// the overwhelming majority of games — and narrower than the full CR 508.1a
// scope only in that one edge case.
export const orimsChant: CardDefinition = {
    id: "055afa78-b969-498f-a3ad-c792426e5ee6", // PLS 11
    name: "Orim's Chant",
    rarity: "rare",
    oracleText:
        "Kicker {W} (You may pay an additional {W} as you cast this spell.)\nTarget player can't cast spells this turn. If this spell was kicked, creatures can't attack this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    kickers: [{ id: "kicker", description: "Kicker {W}", mana: { W: 1 } }],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        { op: "restrictCasting", player: { target: 0 } },
        {
            op: "if",
            predicate: { left: { kickerPaid: "kicker" }, op: "ge", right: 1 },
            then: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "restrictCombat",
                            restriction: "cant-attack",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Samite Elder — {2}{W} Creature — Human Cleric, 1/2. "{T}: Creatures you
// control gain protection from the colors of target permanent you control
// until end of turn." (CR 702.16 protection, CR 611.2a temporary grant.)
//
// DSL Effect Script (issue #1948 review, MAJOR 4 — the original `resolve()`
// justification was wrong): the candidate colours are the FIVE known at
// authoring time (exactly like Dominaria's Judgment above), and
// `objectMatchesFilter` (issue #1747) reads the target's LIVE, layer-
// materialised colours per candidate colour — there is no need to iterate an
// arbitrary runtime colour SET. `forEach` over the controller's creatures,
// with FIVE `if(objectMatchesFilter(target 0, color X))` checks in the body,
// each conditionally granting "protection from X" to the current `$each`.
export const samiteElder: CardDefinition = {
    id: "b3c5dccc-2a48-4dcc-a796-fa6fdc11a14e", // PLS 14
    name: "Samite Elder",
    rarity: "rare",
    oracleText:
        "{T}: Creatures you control gain protection from the colors of target permanent you control until end of turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "samite-elder-protection",
            oracleText:
                "{T}: Creatures you control gain protection from the colors of target permanent you control until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: PLS_WHITE_COLORS.map((color) => ({
                        op: "if",
                        predicate: {
                            objectMatchesFilter: { target: 0 },
                            filter: { color },
                        },
                        then: [
                            {
                                op: "grantAbility",
                                ability: `protection from ${PLS_WHITE_COLOR_NAMES[color]}`,
                                target: { ref: "$each" },
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    })),
                },
            ],
        },
    ],
};

// Samite Pilgrim — {1}{W} Creature — Human Cleric, 1/1. "Domain — {T}:
// Prevent the next X damage that would be dealt to target creature this
// turn, where X is the number of basic land types among lands you control."
// (CR 702 preamble ability word Domain, issue #1066; CR 615.1 damage
// prevention shield via `preventDamage` mode `"next-n"`.) Domain is an
// ITALIC ABILITY WORD with no independent rules meaning (CR 207.2c) — it
// carries no `staticAbilities[]` entry, matching every other shipped Domain
// card (Tribal Flames / Wandering Stream / Power Armor, `inv/*.ts`).
export const samitePilgrim: CardDefinition = {
    id: "c12529e4-f4b1-45be-8252-28783badbec5", // PLS 15
    name: "Samite Pilgrim",
    rarity: "common",
    oracleText:
        "Domain — {T}: Prevent the next X damage that would be dealt to target creature this turn, where X is the number of basic land types among lands you control.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "samite-pilgrim-prevent",
            oracleText:
                "Domain — {T}: Prevent the next X damage that would be dealt to target creature this turn, where X is the number of basic land types among lands you control.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: { domain: { of: "controller" } },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Sunscape Familiar — {1}{W} Creature — Wall, 0/3. "Defender (This creature
// can't attack.)\nGreen spells and blue spells you cast cost {1} less to
// cast." (CR 702.3 defender; CR 601.2f generic cost reduction via a
// `cost-modifier` static, gated to the controller's OWN spells via the
// matching `effectSource` check — Alabaster Leech's `inv/white.ts`
// cost-increase precedent, just a reduction.)
//
// A SINGLE `cost-modifier` entry with an OR predicate (issue #1948 review,
// BLOCKER 3) — not two independent entries. `getCostModifiers`
// (`gre/state.ts`) accumulates `reductionGeneric` per MATCHING effect with no
// per-source cap, so two entries (one gated green, one gated blue) would both
// match a spell that is BOTH colours and double the reduction to {2} — a
// gold green-blue spell would cost {2} less instead of the printed {1} less.
// One entry whose predicate is true for "green OR blue" applies the {1}
// reduction exactly once regardless of how many of the two colours the spell
// has.
export const sunscapeFamiliar: CardDefinition = {
    id: "9621f341-bf85-4b77-bf19-2fb013b4c955", // PLS 17
    name: "Sunscape Familiar",
    rarity: "common",
    oracleText:
        "Defender (This creature can't attack.)\nGreen spells and blue spells you cast cost {1} less to cast.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 3,
    staticAbilities: ["defender"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                (ctx.getColors(card).includes("G") ||
                    ctx.getColors(card).includes("U")) &&
                card.controllerId === effectSource?.controllerId,
            costReduction: { X: 1 },
        },
    ],
};

// Surprise Deployment — {3}{W} Instant. "Cast this spell only during
// combat.\nYou may put a nonwhite creature card from your hand onto the
// battlefield. At the beginning of the next end step, return that creature
// to your hand. (Return it only if it's on the battlefield.)" (CR 601.3e
// cast-timing restriction via `castPhaseRestriction`, spanning every combat
// step, precedent Spinal Embrace `inv/multicolor.ts`; CR 400.7 hand →
// battlefield via a `choice(kind: "choose-hand-card")` + `moveZone(from:
// "hand", to: "battlefield", bind)` pair, EXACT precedent Sneak Attack
// `usg/red.ts` — the same `bind`-on-the-`cards`-shape capability issue #1151
// added closes the "capture the just-entered permanent" gap Cauldron Dance's
// still-stubbed comment describes as blocking; CR 603.7 delayed trigger for
// the return, ADR 0048.)
export const surpriseDeployment: CardDefinition = {
    id: "9a26148b-b981-4af5-995b-52b1426737e3", // PLS 18
    name: "Surprise Deployment",
    rarity: "uncommon",
    oracleText:
        "Cast this spell only during combat.\nYou may put a nonwhite creature card from your hand onto the battlefield. At the beginning of the next end step, return that creature to your hand. (Return it only if it's on the battlefield.)",
    manaCost: { X: 3, W: 1 },
    types: ["Instant"],
    castPhaseRestriction: [
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
        "COMBAT_DAMAGE",
        "END_OF_COMBAT",
    ],
    effects: [
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            filter: { type: "Creature", excludeColor: "W" },
            count: { min: 0, max: 1 },
            prompt: "Put a nonwhite creature card from your hand onto the battlefield (or none).",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "hand",
            to: "battlefield",
            bind: "$deployed",
        },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText:
                "At the beginning of the next end step, return that creature to your hand.",
            capture: { $captured: { ref: "$deployed" } },
            effects: [
                { op: "moveZone", target: { ref: "$captured" }, to: "hand" },
            ],
        },
    ],
};

// Voice of All — {2}{W}{W} Creature — Angel, 2/2. "Flying\nAs this creature
// enters, choose a color.\nThis creature has protection from the chosen
// color." (CR 702.9 flying; CR 614.12 the as-enters colour choice, modelled
// as a `modes` pick stored on `chosenModeId` — the same idiom Prismatic Ward
// / Quirion Elves use — read back by FIVE `keyword-grant` static effects, one
// per colour, each gated by `condition: source.chosenModeId === color` via
// `EFFECT_AFFECTS_SELF`; CR 702.16 protection, materialized into
// `staticAbilities` at apply time so every protection consumer —
// `getLegalTargets`/`selectTarget`/`dealDamage`/block validation — sees it
// identically to a printed keyword.)
//
// CR 614.1c makes "As this creature enters, choose a color" a REPLACEMENT
// effect and CR 614.12a puts the choice before the permanent enters, so it is
// declared as data on `entersWith.asEnters` (ADR 0100 D3, issue #2019) rather
// than taken at cast announcement: the pick rides the single CR 614 chokepoint
// and is therefore raised on every entry path that goes THROUGH a card — a
// cast, reanimation, a "put onto the battlefield" effect, a blink out of
// exile. `announceCast` rejects a `chosenModeId` for a card that declares
// this, so the choice is raised once and only once.
//
// That includes a TOKEN COPY (issue #2558) — CR 614.12's own worked example:
// "An effect creates a token that's a copy of Voice of All. As that token is
// created, the token's controller chooses a color for it." The copy is stamped
// onto the token before the CR 614 chokepoint reads it (CR 707.5), so the
// chokepoint sees THIS definition's clause on the token exactly as it does on
// a cast or reanimated Voice of All.
export const voiceOfAll: CardDefinition = {
    id: "75f37536-db3d-4726-9e45-b9108247d0e6", // PLS 19
    name: "Voice of All",
    rarity: "uncommon",
    oracleText:
        "Flying\nAs this creature enters, choose a color.\nThis creature has protection from the chosen color.",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    // CR 614.12a — the colour is chosen as the creature ENTERS, on every entry
    // path; the answer lands on `chosenModeId` (`applyAsEntersAnswer`).
    entersWith: { asEnters: [{ kind: "mode" }] },
    modes: PLS_WHITE_COLORS.map((color) => ({
        id: color,
        label: PLS_WHITE_COLOR_NAMES[color],
        oracleText: `This creature has protection from ${PLS_WHITE_COLOR_NAMES[color]}.`,
    })),
    staticEffects: PLS_WHITE_COLORS.map((color) => ({
        kind: "keyword-grant",
        applies: EFFECT_AFFECTS_SELF,
        condition: (source) => source.chosenModeId === color,
        keyword: `protection from ${PLS_WHITE_COLOR_NAMES[color]}`,
    })),
};

// ─────────────────────────────────────────────────────────────────────────
// Deferred (engine capability gap) — of the two PLS White cards below, only
// Planeswalker's Mirth still needs a genuinely unbuilt engine capability,
// tracked-by: #2003. Sunscape Battlemage's OWN blocker (issue #1328) is
// resolved — see its bullet — so it stays documented here for the
// implementation notes but is no longer a Guard-B divergence; it is
// intentionally NOT registered (no exported CardDefinition) to keep the card
// pool honest; flagged in the PR.
// ─────────────────────────────────────────────────────────────────────────
//
//   • Planeswalker's Mirth (Enchantment) — "{3}{W}: Target opponent reveals a
//     card at random from their hand. You gain life equal to that card's
//     mana value." Needs a PUBLIC random-hand-card reveal Op with a `bind`
//     (the `discardAtRandom` Op's shape, but revealing — the card stays in
//     hand — not discarding: `SpellContext.revealRandomHandCard` already
//     exists, used today only by Cursed Scroll's `resolve()`, but no Effect
//     Script Op wraps it, and the existing `reveal` Op's two shapes — whole-
//     hand and a searched-and-found card — are neither a RANDOM single-card
//     reveal). tracked-by: #2003.
//
//   • Sunscape Battlemage (Creature) — "Kicker {1}{G} and/or {2}{U}\nWhen
//     this creature enters, if it was kicked with its {1}{G} kicker, destroy
//     target creature with flying.\nWhen this creature enters, if it was
//     kicked with its {2}{U} kicker, draw two cards." Each ETB clause is a
//     SEPARATELY-firing `TriggeredAbility` (CR 603.6a, a new stack item
//     pushed after the permanent enters) whose `interveningIf` needs to read
//     WHICH kicker was paid. That was the blocker when this note was
//     written: nothing persisted a per-Kicker tally onto the entering
//     permanent for a later-firing trigger to read (issue #1328's gap 1,
//     "ETB-trigger readability of kicker" — Shivan Emissary / Benalish
//     Emissary, `inv/*.ts`, the shipped precedent for leaving a card
//     unshipped rather than working around it). NO LONGER APPLIES, and #1328
//     itself CLOSED once it shipped: `kickerPayments` is now a typed,
//     serialized field on `CardInstanceState`/`PermanentView` (#1950), and
//     `kickerPaidCondition` (`abilities/triggers/shared.ts`, issue #2015) is
//     the shared per-Kicker CHECK-TIME predicate its three shipped cycle
//     siblings already use — paired, as they all are, with a resolution-time
//     `if { kickerPaid: "<id>" }` branch inside the ability's own
//     `effects[]` (never an `interveningIf`; see that helper's doc block for
//     why the re-check misreads a blinked permanent). The card is unblocked
//     and needs only ordinary card work — out of scope for issue #2560
//     (a stale-reference fix, not a card implementation).

// ─────────────────────────────────────────────────────────────────────────────
// PLS C4 — source-scoped prevention shields + divided allocation (#1955,
// parent PRD #1935).
// ─────────────────────────────────────────────────────────────────────────────

// Guard Dogs — {3}{W} Creature — Dog, 2/2. "{2}{W}, {T}: Choose a permanent
// you control. Prevent all combat damage target creature would deal this turn
// if it shares a color with that permanent." (CR 615 / 105.2 / 202.2.)
//
// Two decisions, both from the printed Oracle text + the card's own rulings:
//
//  • The permanent is CHOSEN, not targeted (only the creature is a target), so
//    it is a resolution-time `choice` Op (`choose-permanents` over the
//    controller's own battlefield, count 1) — never a second target slot.
//    Guard Dogs itself is always a legal candidate, so the choice can never be
//    empty.
//  • The colour comparison is made ONCE, ON RESOLUTION — the card's ruling is
//    explicit: "You only check colors on resolution and not later when the
//    damage prevention actually is applied." So this is an `if` gate around
//    the shield, NOT a condition carried on the shield itself: a creature that
//    changes colour after this resolves keeps (or keeps lacking) the shield.
//    The gate is the `sharesColor` predicate (issue #1955), which reads BOTH
//    sides' colours live through the layer pipeline (`SpellContext.getColors`,
//    layer 5) so a permanent painted a colour by another effect counts exactly
//    as a printed one does.
//
// The shield itself is the `preventDamage` mode `"all-from-source"` with
// `combatOnly: true` — the same source-scoped, recipient-agnostic entry
// Falling Timber uses (`pls/green.ts`).
export const guardDogs: CardDefinition = {
    id: "ba32eee7-10ba-4f0b-8a87-c3ecfa22ae41", // PLS 5
    rarity: "uncommon",
    name: "Guard Dogs",
    oracleText:
        "{2}{W}, {T}: Choose a permanent you control. Prevent all combat damage target creature would deal this turn if it shares a color with that permanent.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Dog"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "guard-dogs-prevent",
            oracleText:
                "{2}{W}, {T}: Choose a permanent you control. Prevent all combat damage target creature would deal this turn if it shares a color with that permanent.",
            cost: { mana: { X: 2, W: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: "controller",
                    zone: "battlefield",
                    count: 1,
                    prompt: "Choose a permanent you control (Guard Dogs).",
                    bind: "$chosen",
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$chosen" },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                sharesColor: { target: 0 },
                                with: { ref: "$each" },
                            },
                            then: [
                                {
                                    op: "preventDamage",
                                    mode: "all-from-source",
                                    source: { target: 0 },
                                    combatOnly: true,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

// Pollen Remedy — {W} Instant. "Kicker—Sacrifice a land.\nPrevent the next 3
// damage that would be dealt this turn to any number of targets, divided as
// you choose. If this spell was kicked, prevent the next 6 damage this way
// instead." (CR 615.1 / 601.2d / 120.4 / 702.33a.)
//
// The prevention ANALOGUE of the divided-damage idiom, and deliberately built
// on the same machinery rather than a second one: the per-target split is
// chosen at ANNOUNCEMENT via `targetRequirement.divideAsChosen` (each chosen
// target ≥ 1, the sum validated to equal the total by `selectTarget` in
// `convex/game.ts`), snapshotted onto the stack item's `targetAmounts`, and
// read back at resolution by the `preventDamage` mode `"next-n-divided"` —
// which installs one prevent-the-next-N shield per target instead of dealing
// damage. "Any number of targets" is `count: { min: 1 }`, capped at the total
// by the ≥1-each rule (Arc Lightning / Fiery Justice precedent).
//
// Kicked, BOTH halves change: the target requirement's total (via
// `kickedTargetRequirement`, so the announcement-time stepper offers 6) and
// the resolution-time total. The `if { kickerCount: true } >= 1` branch keeps
// the two in lockstep.
export const pollenRemedy: CardDefinition = {
    id: "9797c813-0cda-44ad-ae41-330e9bde9cb9", // PLS 13
    rarity: "common",
    name: "Pollen Remedy",
    oracleText:
        "Kicker—Sacrifice a land. (You may sacrifice a land in addition to any other costs as you cast this spell.)\nPrevent the next 3 damage that would be dealt this turn to any number of targets, divided as you choose. If this spell was kicked, prevent the next 6 damage this way instead.",
    manaCost: { W: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker—Sacrifice a land",
            permanent: {
                action: "sacrifice",
                filter: { types: "Land" },
                count: 1,
            },
        },
    ],
    targetRequirement: {
        type: "any",
        count: { min: 1 },
        divideAsChosen: { total: 3, kind: "prevent" },
    },
    kickedTargetRequirement: {
        type: "any",
        count: { min: 1 },
        divideAsChosen: { total: 6, kind: "prevent" },
    },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "preventDamage",
                    mode: "next-n-divided",
                    total: 6,
                    duration: { phase: "end-of-turn" },
                },
            ],
            else: [
                {
                    op: "preventDamage",
                    mode: "next-n-divided",
                    total: 3,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
