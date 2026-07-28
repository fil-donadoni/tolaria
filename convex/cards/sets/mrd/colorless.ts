// mrd (Mirrodin) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { CardDefinition, SpellContext } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { makeTalisman } from "../../abilities";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

const CHROME_MOX_ID = "6a058e68-70af-4a64-859c-c881e5578368";
const CHROME_MOX_COLORS = ["W", "U", "B", "R", "G"] as const;

// Chrome Mox — {0} Artifact (Vintage Cube FREE: ETB/dies/attack triggers,
// issue #679). "Imprint — When this artifact enters, you may exile a
// nonartifact, nonland card from your hand. {T}: Add one mana of any of the
// exiled card's colors." "Imprint" is not a censused mechanic
// (mechanicsRegistry.ts has no `imprint` row) but the card's actual rules
// text needs no such keyword string — it is a plain ETB choice + exile
// (CR 603.6a / 701.13) plus a colour-gated mana ability (CR 605.1a), both
// composable from shipped primitives.
//
// PROTOCOL (own-hand exile, precedent: Ice Cauldron / Elkin Bottle,
// convex/cards/sets/ice/colorless.ts): "you may exile a ... card from your
// hand" has no Effect Script Op skin (the DSL `exile` Op only takes an
// on-battlefield/stack object ref, not a hand-zone choice pick — issue #679
// audit). The ETB composes shipped SpellContext primitives directly:
// `requestChoice(zone:"hand")` + `exileFaceDown` (CR 406.3, hidden to the
// opponent, known to the controller).
//
// The exiled card's colours are stamped as zero-weight counters
// (`imprint-<color>`) on Chrome Mox's own instance — CR 122 counters are a
// general per-instance numeric store, read back here only while Chrome Mox
// is still on the battlefield (its own mana ability), so this does not hit
// the "counter value unreadable once its holder leaves play" ceiling that
// blocks a leave-triggered reader (see Skyclave Apparition, split out
// separately in znr/white.ts). `getManaChoices` (board-conditional mana
// choices, Fellwar Stone's own mechanism) reads them back to offer exactly
// the exiled card's colours; a card with no colours (or no imprint) offers
// none.
export const chromeMox: CardDefinition = {
    id: CHROME_MOX_ID,
    name: "Chrome Mox",
    rarity: "rare",
    oracleText:
        "Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card's colors.",
    manaCost: {},
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "chrome-mox-imprint",
            oracleText:
                "When this artifact enters, you may exile a nonartifact, nonland card from your hand.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                const candidates = ctx
                    .getHandCards(ctx.controller)
                    .filter(
                        (c) =>
                            !c.types.includes("Artifact") &&
                            !c.types.includes("Land")
                    );
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `chrome-mox-imprint-${ctx.sourceInstanceId}`,
                    kind: "choose-hand-card",
                    zone: "hand",
                    count: { min: 0, max: 1 },
                    candidateIds: candidates.map((c) => c.id),
                    prompt: "Chrome Mox: exile a nonartifact, nonland card from your hand (or skip).",
                });
                if (picks === undefined) return; // suspended for the choice
                const cardId = picks[0];
                if (!cardId) return;
                const card = candidates.find((c) => c.id === cardId);
                // CR 406.2 — the imprinted card is exiled FACE UP (Chrome Mox
                // names no face-down exile), so both players can read which
                // colours the Mox now taps for.
                ctx.moveCardById(ctx.controller, cardId, "hand", "exile");
                // CR 111 (issue #791) — pin the imprinted card to the Mox so
                // the board renders it attached to its permanent (Banishing
                // Light treatment) instead of loose in the exile pile. This is
                // what makes "imprint" legible at a glance; the `imprint-*`
                // counters below stay the machine-readable colour store the
                // mana ability reads, and are hidden from the counter badges.
                ctx.linkExileToSource(cardId, ctx.sourceInstanceId);
                for (const color of card?.colors ?? []) {
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        `imprint-${color}`,
                        1
                    );
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "chrome-mox-mana",
            oracleText: "{T}: Add one mana of any of the exiled card's colors.",
            cost: { tap: true },
            useStack: false,
            canActivate: (source) =>
                CHROME_MOX_COLORS.some(
                    (c) => (source.counters?.[`imprint-${c}`] ?? 0) > 0
                ),
            // CR 106.1 — the real per-activation colour choice is resolved by
            // `getManaChoices` (server + client share the same list, ADR
            // matches Fellwar Stone); `effect` is the required-but-unreached
            // fallback for this choice-ability shape (mirrors Birds of
            // Paradise, lea/green.ts).
            effect: (ctx) => ctx.addMana({ W: 1 }),
            // Fallback / representative list (all five colours) for
            // best-effort callers without a board snapshot (affordability,
            // autoTap) — mirrors Fellwar Stone (drk/colorless.ts). Also
            // load-bearing for `getActivatedManaAbility` (gre/constants.ts),
            // which gates on `manaProduced || manaChoices` and does not look
            // at `getManaChoices` alone; without this static fallback Chrome
            // Mox's mana ability would be invisible to the tap-for-mana
            // pipeline entirely (issue #679 fix). The engine overrides this
            // with `getManaChoices` whenever a board snapshot exists.
            // `canActivate` above (issue #947) is the availability gate every
            // consumer of this static list now consults FIRST — an
            // un-imprinted Mox is excluded before this fallback is ever read,
            // so the "all five colours" shape here is purely representative,
            // never surfaced as a real tap-for-mana option with no imprint.
            manaChoices: CHROME_MOX_COLORS.map((c) => ({ [c]: 1 })),
            getManaChoices: (source) =>
                CHROME_MOX_COLORS.filter(
                    (c) => (source.counters?.[`imprint-${c}`] ?? 0) > 0
                ).map((c) => ({ [c]: 1 })),
        },
    ],
};

// Talisman of Progress / Dominance — {2} artifact mana rocks (Vintage Cube
// free tranche, issue #675, ADR 0041). See `makeTalisman` in
// `convex/cards/abilities/index.ts` for the shared painland-shaped ability.
export const talismanOfProgress: CardDefinition = makeTalisman({
    id: "41ff849e-2439-4690-8aa4-769039b6da4c",
    name: "Talisman of Progress",
    rarity: "uncommon",
    colors: ["W", "U"],
});

export const talismanOfDominance: CardDefinition = makeTalisman({
    id: "991037a2-fea2-49f5-8ace-ebbf9f678cff",
    name: "Talisman of Dominance",
    rarity: "uncommon",
    colors: ["U", "B"],
});

// Aether Spellbomb — {1} Artifact (Vintage Cube FREE misc value/utility,
// issue #687). "{U}, Sacrifice this artifact: Return target creature to its
// owner's hand. {1}, Sacrifice this artifact: Draw a card." Two independent
// activated abilities (CR 602.1), each with a mana + sacrifice-self cost
// (`sacrifice: true`, CR 118.5 / 701.16). The effects compose live Ops only:
// `moveZone` to hand (CR 400.7 bounce) and `draw` (CR 121.1).
export const aetherSpellbomb: CardDefinition = {
    id: "f3792e8b-4ad7-4e2d-994c-c4eaac0fa55f",
    rarity: "common",
    name: "Aether Spellbomb",
    oracleText:
        "{U}, Sacrifice this artifact: Return target creature to its owner's hand.\n{1}, Sacrifice this artifact: Draw a card.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "aether-spellbomb-bounce",
            oracleText:
                "{U}, Sacrifice this artifact: Return target creature to its owner's hand.",
            cost: { mana: { U: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
        {
            id: "aether-spellbomb-draw",
            oracleText: "{1}, Sacrifice this artifact: Draw a card.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Lightning Greaves — {2} Artifact — Equipment (Vintage Cube FREE wave 3,
// issue #1530, parent PRD #1525). "Equipped creature has haste and shroud.
// Equip {0}." Precedent: Skullclamp (`dst/colorless.ts`) proves the Equip
// spine (`attach` Op, sorcery-speed-only targeted activated ability);
// Cori-Steel Cutter (`tdm/red.ts`) proves the `keyword-grant` P/T+keyword
// combo (there: +1/+1, trample, haste, all `AURA_AFFECTS_HOST`-scoped); this
// card's own haste grant is the identical `keyword-grant` shape.
//
// Shroud (CR 702.18) is NOT itself a keyword-grant-only effect — every
// printed-shroud card in this catalogue (Blastoderm, `nem/green.ts`; the
// Mechanics Registry `shroud` row) pairs the `staticAbilities: ["shroud"]`
// reminder string with a `permanent-guard` staticEffect (`cantBeTargeted:
// true`) that `isGuardedAgainst` (`gre/permanentGuard.ts`) actually reads —
// the reminder string alone is decorative and enforces nothing. Sterling
// Grove (`inv/multicolor.ts`) is the precedent for a GRANTED (not
// self-printed) shroud: it pairs a `keyword-grant` (the reminder string) with
// a `permanent-guard` (the real enforcement), BOTH scoped by the same
// predicate — here `AURA_AFFECTS_HOST` instead of Sterling Grove's
// enchantment-group filter, since Lightning Greaves grants to its equipped
// HOST specifically (CR 303.4-style attach relationship), not a battlefield-
// wide group.
export const lightningGreaves: CardDefinition = {
    id: "61a28870-cf78-4323-9d82-cee764067764",
    name: "Lightning Greaves",
    rarity: "uncommon",
    oracleText: "Equipped creature has haste and shroud.\nEquip {0}",
    manaCost: { generic: 2 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "haste",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "shroud",
        },
        {
            kind: "permanent-guard",
            id: "lightning-greaves-shroud",
            applies: AURA_AFFECTS_HOST,
            cantBeTargeted: true,
        },
    ],
    activatedAbilities: [
        {
            // CR 702.6e — Equip is sorcery-speed-only and targets a creature
            // its controller controls. Equip {0} — no mana cost.
            id: "lightning-greaves-equip",
            oracleText: "Equip {0}",
            cost: { mana: {} },
            sorcerySpeedOnly: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            useStack: true,
            effects: [{ op: "attach", target: { target: 0 } }],
        },
    ],
};
