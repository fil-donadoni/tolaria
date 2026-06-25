// Ice Age (ICE) — the 1995 expansion opening the Ice Age block (383 prints,
// 373 unique cards). PRD #628. Home set of every ICE card: setCode "ice".
//
// THIS slice is the walking skeleton (#629): it registers the `ice` set and
// wires ONE complete end-to-end tracer — Balduvian Bears ({1}{G} 2/2 vanilla
// Bear) — proving the set file, registry entry, pool/deck availability,
// projection, the id-guard against the refreshed `data/card-index.json`
// lockfile, and the `__tests__/ice.test.ts` harness all work before the colour
// free-tranche batches and the cumulative-upkeep / Zur's Weirding capability
// clusters land on top.
//
// Every other card is present as a commented-out stub (id/name/cost/types/P-T
// filled, body TODO) so the colour batch / capability cluster that owns it just
// uncomments + completes it. Modern Scryfall oracle text is authoritative
// (ADR 0004). Generic mana is encoded as `X: n` (e.g. {1}{G} → { X: 1, G: 1 }).

import type {
    BlockersConfirmedEvent,
    CardDefinition,
    CardPrint,
    Color,
    DelayedTriggerDef,
    GameEvent,
    ManaCost,
    PermanentView,
    SpellContext,
    TargetSelection,
    TriggeredAbility,
} from "../types";
import type { Phase } from "../../gre/types";
import { countSnowLands, controlsSnowSubtype } from "../snowReads";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../types";
import { manaCostForCardId } from "../manaCostLookup";
import { makeTapForMana } from "../abilities";
import { cumulativeUpkeepTrigger } from "../abilities/cumulativeUpkeep";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../abilities/triggers/leftTrigger";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../abilities/triggers/spellCastTrigger";
import { stateTrigger } from "../abilities/triggers/stateTrigger";
import { untapTrigger } from "../abilities/triggers/untapTrigger";
import { untapRestriction } from "../abilities/static/untapRestriction";
import { damageDealtTrigger } from "../abilities/triggers/damageDealtTrigger";
import { diedTrigger } from "../abilities/triggers/diedTrigger";
import { tappedTrigger } from "../abilities/triggers/tappedTrigger";

// Color-word options for Balduvian Shaman's text change (CR 612 — the five
// color words). The chosen value is the lowercase color word `addTextChange`
// expects (matching Sleight of Mind's `COLOR_WORD_LIST`).
const COLOR_WORD_OPTIONS = [
    { id: "white", label: "White" },
    { id: "blue", label: "Blue" },
    { id: "black", label: "Black" },
    { id: "red", label: "Red" },
    { id: "green", label: "Green" },
];

// "At the beginning of your upkeep, sacrifice this permanent unless you pay
// <cost>" (CR 603.6a phase trigger + CR 117.3a may-pay with a hard action on
// decline). Local twin of the LEA helper of the same name — kept per-set so
// the set file stays self-contained.
function makeUpkeepPayOrElse(args: {
    id: string;
    oracleText: string;
    cost: ManaCost;
    prompt: string;
    onDecline: (ctx: SpellContext) => void;
}): TriggeredAbility {
    return phaseTrigger({
        id: args.id,
        oracleText: args.oracleText,
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx) => {
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                cost: args.cost,
                prompt: args.prompt,
            });
            if (accept === undefined) return;
            if (!accept) args.onDecline(ctx);
        },
    });
}

// "Draw a card at the beginning of the next turn's upkeep" cantrip rider
// (CR 502.2 / 603.7d) — the signature kicker on ~22 Ice Age commons. The
// scheduling spell/ability calls `scheduleNextUpkeepDraw` from its `resolve`;
// the matching `DelayedTriggerDef` (from `nextUpkeepDrawTrigger`) lives on the
// card's `delayedTriggers[]`. The trigger carries no `targetPlayerId`, so it
// fires at the VERY NEXT upkeep regardless of whose turn it is and dequeues
// exactly once (`fireDelayedTriggers` in gre/phases.ts). The drawing player is
// the spell's controller, captured in `payload.controller` (CR 113.7).
//
// Shared because the rider repeats verbatim across the whole cantrip cycle —
// extracting it keeps each card definition to its unique body (per the
// "extract on the second occurrence" convention).
const NEXT_UPKEEP_DRAW_TRIGGER_ID = "next-upkeep-cantrip";

function scheduleNextUpkeepDraw(ctx: SpellContext, sourceCardId: string): void {
    ctx.scheduleDelayedTrigger(
        sourceCardId,
        NEXT_UPKEEP_DRAW_TRIGGER_ID,
        "next-upkeep",
        {}
    );
}

function nextUpkeepDrawTrigger(): DelayedTriggerDef {
    return {
        id: NEXT_UPKEEP_DRAW_TRIGGER_ID,
        oracleText: "At the beginning of the next turn's upkeep, draw a card.",
        timing: "next-upkeep",
        resolve: (ctx) => {
            // CR 121.1 — the trigger's controller (the scheduling spell's
            // controller, or the activator on the tap-rider path) draws one
            // card. `ctx.controller` is the delayed trigger's controller in
            // both scheduling paths (`fireDelayedTriggers` sets the stack
            // item's controller to the instance's `controller`).
            ctx.drawCards(ctx.controller, 1);
        },
    };
}

// Colors (CR 202.2) of a battlefield-view permanent, derived from its mana
// cost. The engine stores only the slim `{ id }` card reference, so the colour
// comes from the registry's `manaCost` (an embedded cost is honored first if a
// fat view ever provides one). Mirrors fem.ts's `colorsOfView` / leg.ts's
// `colorsOf` exactly — including the inlined colour list — so this set module
// never imports `../colors` (which sits in a `colors → gre/constants → index →
// sets` cycle and would create a TDZ hazard under strict ESM evaluation). Used
// by predicates that have no `StaticEffectContext` (block-restriction).
function colorsOfView(view: {
    card?: Record<string, unknown>;
}): readonly ("W" | "U" | "B" | "R" | "G")[] {
    const card = view.card ?? {};
    const inlined = (card as { manaCost?: ManaCost }).manaCost;
    const cardId = (card as { id?: string }).id;
    const cost = inlined ?? (cardId ? manaCostForCardId(cardId) : undefined);
    if (!cost) return [];
    return (["W", "U", "B", "R", "G"] as const).filter(
        (c) => (cost[c] ?? 0) > 0
    );
}

// Scarab cycle (Black/Blue/Green/Red/White Scarab) — {W} Aura. Two effects on
// the host: (1) "can't be blocked by {color} creatures" (CR 509.1b
// block-restriction, side "attacker" — restricts the host's would-be blockers);
// (2) "+2/+2 as long as an opponent controls a {color} permanent" (CR 611.2c
// conditional `pt-buff` gated on board state). The colour is fixed per card.
const SCARAB_COLOR_NAMES: Record<"W" | "U" | "B" | "R" | "G", string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};

/** True when SOME permanent of `color` is controlled by a player other than
 *  `myControllerId` — i.e. (in a 2-player game) the opponent controls a
 *  permanent of the Scarab's colour. Unlike Jihad's clause this is NOT
 *  nontoken-restricted (CR 202.2 — "a {color} permanent"). */
function opponentControlsColor(
    state: import("../types").StaticEffectStateView,
    myControllerId: string,
    color: "W" | "U" | "B" | "R" | "G",
    colorsOf: (perm: PermanentView) => readonly string[]
): boolean {
    return state.players.some((p) =>
        p.battlefield.some(
            (c) =>
                c.controllerId !== myControllerId && colorsOf(c).includes(color)
        )
    );
}

function makeScarab(args: {
    id: string;
    name: string;
    rarity: CardDefinition["rarity"];
    color: "W" | "U" | "B" | "R" | "G";
}): CardDefinition {
    const colorName = SCARAB_COLOR_NAMES[args.color];
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText: `Enchant creature\nEnchanted creature can't be blocked by ${colorName} creatures.\nEnchanted creature gets +2/+2 as long as an opponent controls a ${colorName} permanent.`,
        manaCost: { W: 1 },
        types: ["Enchantment"],
        subtypes: ["Aura"],
        targetRequirement: { type: "Creature", count: 1 },
        staticEffects: [
            {
                kind: "block-restriction",
                id: `${args.id}-cant-be-blocked-by-${colorName}`,
                // The block-restriction is collected from this Aura and applied
                // to its host (CR 303.4). side "attacker": `self` = the enchanted
                // creature (attacker), `opponent` = the candidate blocker. Legal
                // (true) unless the blocker is the Scarab's colour.
                side: "attacker",
                predicate: (_self, blocker) =>
                    !colorsOfView(blocker).includes(args.color),
                oracleText: `Enchanted creature can't be blocked by ${colorName} creatures.`,
            },
            {
                kind: "pt-buff",
                applies: AURA_AFFECTS_HOST,
                // CR 611.2c — the buff only contributes while an opponent
                // controls a permanent of the Scarab's colour.
                condition: (source, state, ctx) =>
                    opponentControlsColor(
                        state,
                        source.controllerId,
                        args.color,
                        (c) => ctx.getColors(c)
                    ),
                power: 2,
                toughness: 2,
            },
        ],
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Active tracer
// ─────────────────────────────────────────────────────────────────────────────

// Balduvian Bears — {1}{G} 2/2 vanilla Bear (CR 302). The walking-
// skeleton tracer: a complete, castable CardDefinition proving the set
// file, registry entry, pool availability, projection and id-guard all
// work before the colour batches (PRD #628) build on top.
export const balduvianBears: CardDefinition = {
    id: "ef5297cb-e763-4871-9cd3-0e2dbcc52095",
    name: "Balduvian Bears",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// White free tranche (#630)
//
// The free-tranche White cards — expressible entirely with already-shipped
// primitives — are activated below (intermixed with the remaining commented
// stubs). Reprints already implemented in earlier sets (Death Ward, Disenchant,
// Swords to Plowshares, the Circle of Protection cycle) are CardPrints onto
// their existing definitions (ADR 0014); new-to-ICE White cards are full
// CardDefinitions.
//
// COMPLETED in the buildable-now follow-up (#653) — activated below from
// already-shipped primitives: the five Scarabs (block-restriction +
// conditional pt-buff), Caribou Range (activated-grant + sacrifice-filter
// lifegain), Call to Arms (Jihad-style conditional anthem with strict
// plurality + state-trigger sacrifice), Fylgja (entersWith counters +
// counter-removal prevention), Justice (upkeep pay-or-sac + red-damage
// reflect), Seraph (Krovikan-Vampire-style next-end-step reanimate).
//
// DEFERRED (remain commented stubs, owned by a later cluster):
//   • Cumulative upkeep — Cold Snap, Energy Storm (ADR 0042 cluster).
//   • Restricted-mana CU support — Adarkar Unicorn (CU mana cluster).
//   • Snow-gated combat eligibility — Arctic Foxes (block restriction keyed on
//     "defending player controls a snow land"), Kjeldoran Guard (snow-land
//     activation gate) — owned by the Snow cluster.
//   • Power-conditional block restriction with a per-block cost — Hipparion
//     ("can't block power 3+ unless you pay {1}" — no pay-as-block primitive).
//   • "Draw a card at the beginning of the next turn's upkeep" delayed cantrips —
//     Blessed Wine, Heal, Lightning Blow, Formation: ACTIVE (#660 — the
//     `next-upkeep` delayed-trigger timing shipped; see `nextUpkeepDrawTrigger`).
//   • Specialized interactions still missing a primitive — Arenson's Aura,
//     Battle Cry, Drought, Enduring Renewal, General Jarkeld.
//   • Sacred Boon — "+0/+1 counter for each 1 damage prevented this way" needs
//     the prevention pipeline to report the amount actually consumed; no
//     primitive exposes prevented-amount today (#653 flagged, deferred).
//   • Prismatic Ward — needs a colour-keyed ALL-damage prevention shield that
//     applies to an Aura's HOST plus a stored colour choice; the shipped
//     `combat-damage-prevention` static is self-only and combat-only (#653
//     flagged, deferred).
//   • Kjeldoran Elite Guard — "+2/+2 until that creature leaves the battlefield
//     this turn, then sacrifice this" needs a per-turn linked-trigger watching a
//     specific instance leave; not modelled (#653 flagged, deferred).
//   • Kjeldoran Royal Guard — "all combat damage to you from unblocked
//     creatures is dealt to this creature instead" needs a global combat-damage
//     redirect shield; not modelled (#653 flagged, deferred).
// ─────────────────────────────────────────────────────────────────────────────

// Adarkar Unicorn — {T}: Add {U} or {C}{U}, restricted to cumulative-upkeep
// costs (CR 605.1a mana ability, CR 106.6 restricted mana — ADR 0022 / 0042).
// A two-option mana ability (`manaChoices`); whichever option is chosen, the
// produced mana lands in the controller's `restrictedMana` tagged
// "cumulative-upkeep", so it pays CU upkeeps (Breath of Dreams, Illusionary
// Forces, …) but nothing else. `useStack: false` resolves it immediately.
export const adarkarUnicorn: CardDefinition = {
    id: "0ba7526f-dba8-4483-b925-946164fc0ae9",
    name: "Adarkar Unicorn",
    rarity: "common",
    oracleText:
        "{T}: Add {U} or {C}{U}. Spend this mana only to pay cumulative upkeep costs.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Unicorn"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "adarkar-unicorn-mana",
            oracleText:
                "{T}: Add {U} or {C}{U}. Spend this mana only to pay cumulative upkeep costs.",
            cost: { tap: true },
            useStack: false,
            // The engine adds the chosen option to the controller's
            // `restrictedMana` pool (keyed by `manaRestriction`); `effect` is the
            // representative fallback, like City of Brass's mana ability.
            manaChoices: [{ U: 1 }, { C: 1, U: 1 }],
            manaRestriction: "cumulative-upkeep",
            manaProduced: { U: 1 },
            effect: (ctx) => ctx.addMana({ U: 1 }),
        },
    ],
};
// Arctic Foxes — CR 509.1b block-restriction (side "attacker") gated on the
// defending player's snow lands (CR 205.4a). A would-be blocker of power 2+ is
// illegal only while the blocker's controller (the defending player) controls a
// snow land — `countSnowLands` reads live snow status so Melting / Arcum's
// Weathervane mutations are honored.
export const arcticFoxes: CardDefinition = {
    id: "98f99c3e-dddc-492f-aab6-1d899346a385",
    name: "Arctic Foxes",
    rarity: "common",
    oracleText:
        "This creature can't be blocked by creatures with power 2 or greater as long as defending player controls a snow land.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Fox"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "arctic-foxes-snow-evasion",
            side: "attacker" as const,
            // `self` = Arctic Foxes (attacker), `opponent` = candidate blocker.
            // The block is legal unless the blocker has power 2+ AND its
            // controller (the defending player) controls a snow land.
            predicate: (_self, opponent, state) => {
                const power = opponent.power ?? 0;
                if (power < 2) return true;
                // Defending player = the blocker's controller. Locate their
                // battlefield by the player who controls the blocker.
                const defender = state?.players.find((p) =>
                    p.battlefield.some((c) => c.id === opponent.id)
                );
                if (!defender) return true;
                return countSnowLands(defender.battlefield) === 0;
            },
            oracleText:
                "Arctic Foxes can't be blocked by creatures with power 2 or greater as long as defending player controls a snow land.",
        },
    ],
};
// TODO(#628): implement.
// export const arensonsAura: CardDefinition = {
//     id: "f94f3e87-1b39-49a8-ad0d-f18c854e298a",
//     name: "Arenson's Aura",
//     rarity: "common",
//     oracleText: "{W}, Sacrifice an enchantment: Destroy target enchantment.\n{3}{U}{U}: Counter target enchantment spell.",
//     manaCost: { X: 2, W: 1 },
//     types: ["Enchantment"],
// };
// Armor of Faith — Aura: static +1/+1 (layer 7c, CR 613) plus a repeatable
// {W}: +0/+1 until end of turn pump on the host (CR 611.1). Same shape as
// LEA's Holy Armor.
export const armorOfFaith: CardDefinition = {
    id: "fccbbc47-99c6-4ba9-95c2-992d5d2a67b2",
    name: "Armor of Faith",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature gets +1/+1.\n{W}: Enchanted creature gets +0/+1 until end of turn.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 1,
            toughness: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "armor-of-faith-pump",
            oracleText: "{W}: Enchanted creature gets +0/+1 until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    0,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// TODO(#628): implement.
// export const battleCry: CardDefinition = {
//     id: "c558a8c4-035c-464e-9ff8-c188c1bb619e",
//     name: "Battle Cry",
//     rarity: "uncommon",
//     oracleText: "Untap all white creatures you control.\nWhenever a creature blocks this turn, it gets +0/+1 until end of turn.",
//     manaCost: { X: 2, W: 1 },
//     types: ["Instant"],
// };
export const blackScarab: CardDefinition = makeScarab({
    id: "5bfd4ee1-05f9-45ae-a31d-1225b271dbe6",
    name: "Black Scarab",
    rarity: "uncommon",
    color: "B",
});
// Blessed Wine — {1}{W} Instant. "You gain 1 life." plus the next-upkeep
// cantrip rider (CR 119.3 lifegain; CR 502.2 / 603.7d delayed draw).
export const blessedWine: CardDefinition = {
    id: "6b9a92f9-9bbc-4887-9fbc-0f7212fd5e66",
    name: "Blessed Wine",
    rarity: "common",
    oracleText:
        "You gain 1 life.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.gainLife(ctx.controller, 1);
        scheduleNextUpkeepDraw(ctx, blessedWine.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Blinking Spirit — {0}: Return this creature to its owner's hand (CR 701.14
// move-to-hand). A repeatable bounce that dodges targeted removal.
export const blinkingSpirit: CardDefinition = {
    id: "14fc0683-9cfa-4439-a533-8773e7747ec4",
    name: "Blinking Spirit",
    rarity: "rare",
    oracleText: "{0}: Return this creature to its owner's hand.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "blinking-spirit-bounce",
            oracleText: "{0}: Return this creature to its owner's hand.",
            cost: { mana: { X: 0 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.returnToHand({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
export const blueScarab: CardDefinition = makeScarab({
    id: "b423bb5a-eaac-4c1d-981a-1c635001fc5a",
    name: "Blue Scarab",
    rarity: "uncommon",
    color: "U",
});
// Call to Arms — {1}{W} Enchantment. "As this enchantment enters, choose a
// color and an opponent. White creatures get +1/+1 as long as the chosen color
// is the most common color among nontoken permanents the chosen player controls
// but isn't tied for most common. When the chosen color isn't the strict
// plurality, sacrifice this enchantment." (CR 611.2c conditional anthem +
// CR 603.8 state-triggered self-sacrifice.) Built on the Jihad template
// (arn.ts): the colour is a cast-time modal pick (CR 700.2, `chosenModeId`);
// "an opponent" auto-resolves to the single opponent in a duel — the clause
// keys off "nontoken permanents a player other than the source's controller
// controls". The difference from Jihad is the activeness test: STRICT plurality
// of the chosen colour among that opponent's nontoken permanents, computed live.
const CALL_TO_ARMS_COLORS: ("W" | "U" | "B" | "R" | "G")[] = [
    "W",
    "U",
    "B",
    "R",
    "G",
];

/** Battlefield-permanent shape both `StaticEffectStateView` (layer reads) and
 *  `TriggerStateView` (state-trigger reads) satisfy — the only fields the
 *  plurality count needs. */
type ColorCountablePerm = {
    controllerId: string;
    isToken?: boolean;
    card?: Record<string, unknown>;
};

/** True when `color` is the strict plurality (most common, not tied) among the
 *  colours of the nontoken permanents controlled by a player OTHER than
 *  `myControllerId`. A permanent contributes to EVERY colour it is (CR 105.2 —
 *  a multicolor permanent counts for each). Returns false when the opponent has
 *  no coloured nontoken permanents (no plurality exists). Generic over the
 *  battlefield-item shape so it serves both the layer view and the trigger
 *  view; `colorsOf` abstracts each view's colour derivation. */
function chosenColorIsStrictPlurality<T extends ColorCountablePerm>(
    battlefield: ReadonlyArray<T>,
    myControllerId: string,
    color: "W" | "U" | "B" | "R" | "G",
    colorsOf: (perm: T) => readonly string[]
): boolean {
    const tally: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const c of battlefield) {
        if (c.controllerId === myControllerId) continue;
        if (c.isToken) continue;
        for (const col of colorsOf(c)) {
            if (col in tally) tally[col]++;
        }
    }
    const mine = tally[color];
    if (mine === 0) return false;
    return CALL_TO_ARMS_COLORS.every((c) => c === color || tally[c] < mine);
}

export const callToArms: CardDefinition = {
    id: "a92f0d4a-23d8-47d4-b910-d142e0eefd3d",
    name: "Call to Arms",
    rarity: "rare",
    oracleText:
        "As this enchantment enters, choose a color and an opponent.\nWhite creatures get +1/+1 as long as the chosen color is the most common color among nontoken permanents the chosen player controls but isn't tied for most common.\nWhen the chosen color isn't the most common color among nontoken permanents the chosen player controls or is tied for most common, sacrifice this enchantment.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    // CR 700.2 — the colour is chosen as the enchantment enters (modal pick).
    modes: CALL_TO_ARMS_COLORS.map((color) => ({
        id: color,
        label: SCARAB_COLOR_NAMES[color],
        oracleText: `White creatures get +1/+1 as long as ${SCARAB_COLOR_NAMES[color]} is the strict plurality colour among nontoken permanents the chosen player controls.`,
        staticEffects: [
            {
                kind: "pt-buff" as const,
                // CR 202.2 — the anthem always boosts WHITE creatures; only the
                // active-condition keys off the chosen colour's plurality.
                applies: (target, _source, ctx) =>
                    ctx.isCreature(target) &&
                    ctx.getColors(target).includes("W"),
                condition: (source, state, ctx) =>
                    chosenColorIsStrictPlurality(
                        state.players.flatMap((p) => p.battlefield),
                        source.controllerId,
                        color,
                        (c) => ctx.getColors(c)
                    ),
                power: 1,
                toughness: 1,
            },
        ],
    })),
    triggeredAbilities: [
        stateTrigger({
            id: "call-to-arms-sacrifice",
            oracleText:
                "When the chosen color isn't the strict plurality among nontoken permanents the chosen player controls, sacrifice this enchantment.",
            condition: (self, state) => {
                const color = self.chosenModeId as
                    | "W"
                    | "U"
                    | "B"
                    | "R"
                    | "G"
                    | undefined;
                if (!color) return false;
                return !chosenColorIsStrictPlurality(
                    state.players.flatMap((p) => p.battlefield),
                    self.controllerId,
                    color,
                    (c) => colorsOfView(c)
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};
// Caribou Range — {2}{W}{W} Aura on a land you control. Grants the enchanted
// land an activated token-maker ("{W}{W}, {T}: Create a 0/1 white Caribou")
// via `activated-grant` (CR 113.1, 611 — the granted ability resolves with the
// HOST land as `sourceInstanceId`, so {T} taps the land and the token is
// controlled by the land's controller), plus a card-level lifegain ability that
// uses a Caribou token as its sacrifice cost (CR 602.1, 118.5 sacrificeFilter).
export const caribouRange: CardDefinition = {
    id: "1e5f8041-67fc-4e00-b119-d216e5cc5a3a",
    name: "Caribou Range",
    rarity: "rare",
    oracleText:
        'Enchant land you control\nEnchanted land has "{W}{W}, {T}: Create a 0/1 white Caribou creature token."\nSacrifice a Caribou token: You gain 1 life.',
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1, controller: "you" },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "caribou-range-make-caribou",
        },
    ],
    grantTemplates: [
        {
            id: "caribou-range-make-caribou",
            oracleText:
                "{W}{W}, {T}: Create a 0/1 white Caribou creature token.",
            cost: { mana: { W: 2 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(
                    {
                        name: "Caribou",
                        types: ["Creature"],
                        subtypes: ["Caribou"],
                        power: 0,
                        toughness: 1,
                        colors: ["W"],
                    },
                    ctx.controller
                );
            },
        },
    ],
    activatedAbilities: [
        {
            id: "caribou-range-gain-life",
            oracleText: "Sacrifice a Caribou token: You gain 1 life.",
            cost: { sacrificeFilter: { subtypes: "Caribou", isToken: true } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.gainLife(ctx.controller, 1);
            },
        },
    ],
};
// TODO(#628): implement.
// Circle of Protection cycle — ICE reprints of the LEA/LEB Circles (CR 615
// prevention). Mechanics live on the existing definitions; these are CardPrints
// (ADR 0014). CoP: Black's home definition is the LEB original; the other four
// are LEA.
export const circleOfProtectionBlackIce: CardPrint = {
    printId: "d528045d-3b80-48fd-b606-c132da052685",
    definitionId: "fa47b4cd-8da4-4544-b011-ba92b7009203",
    setCode: "ice",
    rarity: "common",
};
export const circleOfProtectionBlueIce: CardPrint = {
    printId: "e0d377ec-c43c-43b9-934a-91b4d11650ab",
    definitionId: "848b1a7f-e8ba-40b5-92b7-af1e963a0319",
    setCode: "ice",
    rarity: "common",
};
export const circleOfProtectionGreenIce: CardPrint = {
    printId: "487dfb1f-b3ab-4daa-bbd9-c43dc91a5fba",
    definitionId: "1ae32d20-b438-4f43-b603-e8f706ecfb03",
    setCode: "ice",
    rarity: "common",
};
export const circleOfProtectionRedIce: CardPrint = {
    printId: "5790ce22-a94f-402e-bcc7-b98f71af9fe5",
    definitionId: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e",
    setCode: "ice",
    rarity: "common",
};
export const circleOfProtectionWhiteIce: CardPrint = {
    printId: "48bc4bb0-350c-424e-976e-b800915f7fb4",
    definitionId: "92df19c9-e127-42d9-8dd2-7fa5a7095428",
    setCode: "ice",
    rarity: "common",
};
// Cold Snap — cumulative upkeep {2} (CR 702.24, ADR 0042) plus a phase trigger
// at the beginning of EACH player's upkeep (scope "each", CR 603.6a) that deals
// damage to that player equal to the number of snow lands they control
// (CR 205.4a snow read). The snow-land count is read live via a `supertypes`
// filter on `getBattlefieldIds`.
export const coldSnap: CardDefinition = {
    id: "81b87a58-b20c-4f38-afa3-59d398195740",
    name: "Cold Snap",
    rarity: "uncommon",
    oracleText:
        "Cumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAt the beginning of each player's upkeep, this enchantment deals damage to that player equal to the number of snow lands they control.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "cold-snap-cumulative-upkeep",
            cost: { X: 2 },
            costLabel: "{2}",
        }),
        phaseTrigger({
            id: "cold-snap-upkeep-damage",
            oracleText:
                "At the beginning of each player's upkeep, this enchantment deals damage to that player equal to the number of snow lands they control.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                const snowLands = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Land",
                    supertypes: ["Snow"],
                }).length;
                if (snowLands > 0) {
                    ctx.dealDamage(
                        { type: "player", id: scopedPlayerId },
                        snowLands
                    );
                }
            },
        }),
    ],
};
// Cooperation — Aura that grants the enchanted creature banding (CR 702.22,
// 611 keyword-grant on the host). Same shape as LEA's Flight.
export const cooperation: CardDefinition = {
    id: "21a815ed-c8b4-4414-8b27-ea612e2977e2",
    name: "Cooperation",
    rarity: "common",
    oracleText: "Enchant creature\nEnchanted creature has banding.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "banding",
        },
    ],
};
// Death Ward — ICE reprint of the LEA instant (CR 701.15 regenerate). The
// mechanics live on the LEA definition; this is a CardPrint onto it (ADR 0014).
export const deathWardIce: CardPrint = {
    printId: "c7b21d29-050d-4704-a4c8-93e3b55086ac",
    definitionId: "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13",
    setCode: "ice",
    rarity: "common",
};
// Disenchant — ICE reprint of the LEA instant (destroy target artifact or
// enchantment). CardPrint onto the LEA definition (ADR 0014).
export const disenchantIce: CardPrint = {
    printId: "b6085d0c-ab2b-445d-bf9d-0fa0a19183a2",
    definitionId: "2722d7e2-61c6-4934-9c21-875ee78fd06c",
    setCode: "ice",
    rarity: "common",
};
// TODO(#628): implement.
// export const drought: CardDefinition = {
//     id: "97736696-3de3-416d-94cf-4fac792f23f0",
//     name: "Drought",
//     rarity: "uncommon",
//     oracleText: "At the beginning of your upkeep, sacrifice this enchantment unless you pay {W}{W}.\nSpells cost an additional \"Sacrifice a Swamp\" to cast for each black mana symbol in their mana costs.\nActivated abilities cost an additional \"Sacrifice a Swamp\" to activate for each black mana symbol in their activation costs.",
//     manaCost: { X: 2, W: 2 },
//     types: ["Enchantment"],
// };
// Elvish Healer — {T}: prevent the next 1 damage to any target this turn; if
// that target is a green creature, prevent 2 instead (CR 615 prevention). The
// amount is target-dependent, resolved from the chosen target's color/type.
export const elvishHealer: CardDefinition = {
    id: "00bd8485-d63a-4077-a3d1-4d0f2f4d8035",
    name: "Elvish Healer",
    rarity: "common",
    oracleText:
        "{T}: Prevent the next 1 damage that would be dealt to any target this turn. If it's a green creature, prevent the next 2 damage instead.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "elvish-healer-prevent",
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to any target this turn. If it's a green creature, prevent the next 2 damage instead.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t) return;
                let amount = 1;
                if (t.type === "permanent" && ctx.getColors(t).includes("G")) {
                    amount = 2;
                }
                ctx.preventNextNDamageToTarget(t, amount, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};
// TODO(#628): implement.
// export const enduringRenewal: CardDefinition = {
//     id: "be77edac-9a8b-4b7f-a859-27df76b10aa6",
//     name: "Enduring Renewal",
//     rarity: "rare",
//     oracleText: "Play with your hand revealed.\nIf you would draw a card, reveal the top card of your library instead. If it's a creature card, put it into your graveyard. Otherwise, draw a card.\nWhenever a creature is put into your graveyard from the battlefield, return it to your hand.",
//     manaCost: { X: 2, W: 2 },
//     types: ["Enchantment"],
// };
// TODO(#628): implement.
// export const energyStorm: CardDefinition = {
//     id: "3955e358-4285-44e2-9e24-9804346a6e58",
//     name: "Energy Storm",
//     rarity: "rare",
//     oracleText: "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nPrevent all damage that would be dealt by instant and sorcery spells.\nCreatures with flying don't untap during their controllers' untap steps.",
//     manaCost: { X: 1, W: 1 },
//     types: ["Enchantment"],
// };
// Formation — {1}{W} Instant. "Target creature gains banding until end of turn"
// (CR 702.22 banding granted via layer 6 for the turn) plus the next-upkeep
// cantrip rider.
export const formation: CardDefinition = {
    id: "78446ead-61b0-485f-a5a9-b3e72d8075a7",
    name: "Formation",
    rarity: "rare",
    oracleText:
        "Target creature gains banding until end of turn. (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding a player controls are blocking or being blocked by a creature, that player divides that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") {
            ctx.grantStaticAbility(t, "banding", { phase: "end-of-turn" });
        }
        scheduleNextUpkeepDraw(ctx, formation.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Fylgja — {W} Aura. Enters with four healing counters (CR 122.1, 614.1c
// `entersWith`); "Remove a healing counter: prevent the next 1 damage to the
// enchanted creature this turn" (CR 602.1 counter-removal cost + CR 615
// prevention shield on the host); "{2}{W}: put a healing counter on this Aura"
// (replenishes the pool). The prevention targets the host via `getAttachedTo`.
export const fylgja: CardDefinition = {
    id: "3c6358a1-37f0-4b40-93d4-4f1652c38404",
    name: "Fylgja",
    rarity: "common",
    oracleText:
        "Enchant creature\nThis Aura enters with four healing counters on it.\nRemove a healing counter from this Aura: Prevent the next 1 damage that would be dealt to enchanted creature this turn.\n{2}{W}: Put a healing counter on this Aura.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    entersWith: { counters: [{ type: "healing", count: 4 }] },
    activatedAbilities: [
        {
            id: "fylgja-prevent",
            oracleText:
                "Remove a healing counter from this Aura: Prevent the next 1 damage that would be dealt to enchanted creature this turn.",
            cost: { removeCounter: { type: "healing", count: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.preventNextNDamageToTarget(
                    { type: "permanent", id: hostId },
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "fylgja-add-counter",
            oracleText: "{2}{W}: Put a healing counter on this Aura.",
            cost: { mana: { X: 2, W: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "healing",
                    1
                );
            },
        },
    ],
};
// TODO(#628): implement.
// export const generalJarkeld: CardDefinition = {
//     id: "6a4f5a28-0bd2-4cc4-b67f-324e89193caa",
//     name: "General Jarkeld",
//     rarity: "rare",
//     oracleText: "{T}: Choose two target blocked attacking creatures. If each of those creatures could be blocked by all creatures that the other is blocked by, each creature that's blocking exactly one of those attacking creatures stops blocking it and is blocking the other attacking creature. Activate only during the declare blockers step.",
//     manaCost: { X: 3, W: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Human", "Soldier"],
//     power: 1,
//     toughness: 2,
// };
export const greenScarab: CardDefinition = makeScarab({
    id: "0fbf9266-c97e-4666-b0fa-1802a69a62cc",
    name: "Green Scarab",
    rarity: "uncommon",
    color: "G",
});
// Hallowed Ground — {W}{W}: Return target nonsnow land you control to its
// owner's hand (CR 701.14). A blink/protection engine for your own lands.
//
// SIMPLIFICATION (flagged, no engine change): the "nonsnow" target restriction
// has no live effect in the current pool — snow-covered basics belong to a
// later snow cluster and TargetRequirement has no supertype-exclusion field.
// The ability targets any Land you control; the nonsnow clause is a no-op until
// snow lands ship.
export const hallowedGround: CardDefinition = {
    id: "4b35c0f4-5633-4ea9-9bda-daaf787aebdd",
    name: "Hallowed Ground",
    rarity: "uncommon",
    oracleText:
        "{W}{W}: Return target nonsnow land you control to its owner's hand.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "hallowed-ground-bounce",
            oracleText:
                "{W}{W}: Return target nonsnow land you control to its owner's hand.",
            cost: { mana: { W: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.returnToHand(t);
            },
        },
    ],
};
// Heal — {W} Instant. "Prevent the next 1 damage that would be dealt to any
// target this turn" (CR 615.1 prevention shield, Samite Healer pattern) plus
// the next-upkeep cantrip rider.
export const heal: CardDefinition = {
    id: "9e6b2704-685e-4c74-875a-25846175e5e4",
    name: "Heal",
    rarity: "common",
    oracleText:
        "Prevent the next 1 damage that would be dealt to any target this turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t) {
            ctx.preventNextNDamageToTarget(t, 1, { phase: "end-of-turn" });
        }
        scheduleNextUpkeepDraw(ctx, heal.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// TODO(#628): implement.
// export const hipparion: CardDefinition = {
//     id: "5969875a-f647-4daf-b76c-d1514d45c312",
//     name: "Hipparion",
//     rarity: "uncommon",
//     oracleText: "This creature can't block creatures with power 3 or greater unless you pay {1}.",
//     manaCost: { X: 1, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Horse"],
//     power: 1,
//     toughness: 3,
// };
// Justice — {2}{W}{W} Enchantment. Upkeep pay-{W}{W}-or-sacrifice (CR 603.6a +
// 117.3a, the `makeUpkeepPayOrElse` template) + a damage-watch trigger
// (CR 603.4): whenever a red creature or spell deals damage, Justice deals that
// much to the damage source's controller. The trigger filters the source on
// colour red and restricts to creature/spell sources via `sourceTypes` (a red
// noncreature permanent's damage is excluded, matching the Oracle wording).
export const justice: CardDefinition = {
    id: "9a6e0c8d-0fc1-4f52-8357-e550b0ac579a",
    name: "Justice",
    rarity: "uncommon",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {W}{W}.\nWhenever a red creature or spell deals damage, this enchantment deals that much damage to that creature's or spell's controller.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "justice-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {W}{W}.",
            cost: { W: 2 },
            prompt: "Pay {W}{W} to keep Justice?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
        damageDealtTrigger({
            id: "justice-reflect",
            oracleText:
                "Whenever a red creature or spell deals damage, this enchantment deals that much damage to that creature's or spell's controller.",
            source: "any",
            sourceFilter: { colors: "R" },
            // CR 205 — "creature or spell": include sources whose snapshot types
            // mark them a creature, an instant, or a sorcery (a cast red spell).
            condition: (event) => {
                const t = event.sourceTypes ?? [];
                return (
                    t.includes("Creature") ||
                    t.includes("Instant") ||
                    t.includes("Sorcery")
                );
            },
            resolve: (ctx, event) => {
                if (event.amount <= 0) return;
                ctx.dealDamage(
                    { type: "player", id: event.sourceControllerId },
                    event.amount
                );
            },
        }),
    ],
};
// Kelsinko Ranger — {1}{W}: Target green creature gains first strike until end
// of turn (CR 611.1b temporary keyword grant). Targeting is scoped to green
// creatures via the color filter.
export const kelsinkoRanger: CardDefinition = {
    id: "8402543e-5406-404f-95c4-800a1dce35f1",
    name: "Kelsinko Ranger",
    rarity: "common",
    oracleText:
        "{1}{W}: Target green creature gains first strike until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Ranger"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "kelsinko-ranger-first-strike",
            oracleText:
                "{1}{W}: Target green creature gains first strike until end of turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilter: "G",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.grantStaticAbility(t, "first strike", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// DEFERRED (#653): "+2/+2 until that creature leaves the battlefield this turn,
// then sacrifice this creature" needs a per-turn linked-trigger that watches a
// SPECIFIC chosen instance leave the battlefield. The engine has no
// instance-scoped "watch target X leave this turn" delayed trigger.
// export const kjeldoranEliteGuard: CardDefinition = {
//     id: "a73bc4b6-f7d0-494c-9e60-48279c11b7b6",
//     name: "Kjeldoran Elite Guard",
//     rarity: "uncommon",
//     oracleText: "{T}: Target creature gets +2/+2 until end of turn. When that creature leaves the battlefield this turn, sacrifice this creature. Activate only during combat.",
//     manaCost: { X: 3, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Soldier"],
//     power: 2,
//     toughness: 2,
// };
// DEFERRED (instance-scoped leave-watch, NOT snow). The snow gate ("activate
// only if defending player controls no snow lands") is now buildable via
// `countSnowLands`, but Kjeldoran Guard shares Kjeldoran Elite Guard's genuine
// engine gap: "When that creature leaves the battlefield this turn, sacrifice
// this creature" needs a per-turn delayed trigger that watches a SPECIFIC
// chosen instance leave the battlefield (CR 603.7a) — the delayed-trigger
// system has timings (next-end-step, …) but no "when target X leaves" timing,
// and `leftTrigger` only watches the source itself. Shipping the snow gate
// alone would leave the sacrifice clause unimplemented (behavior-incorrect), so
// the whole card waits on the leave-watch primitive (same as Elite Guard).
// export const kjeldoranGuard: CardDefinition = {
//     id: "bdf41f17-8f82-4a8c-adec-0f3804faff3b",
//     name: "Kjeldoran Guard",
//     rarity: "common",
//     oracleText: "{T}: Target creature gets +1/+1 until end of turn. When that creature leaves the battlefield this turn, sacrifice this creature. Activate only during combat and only if defending player controls no snow lands.",
//     manaCost: { X: 1, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Soldier"],
//     power: 1,
//     toughness: 1,
// };
// Kjeldoran Knight — banding plus two repeatable self-pumps (CR 611.1, 702.22).
export const kjeldoranKnight: CardDefinition = {
    id: "d5b9db8f-93b5-44e3-9e2b-728c80dfbb37",
    name: "Kjeldoran Knight",
    rarity: "rare",
    oracleText:
        "Banding\n{1}{W}: This creature gets +1/+0 until end of turn.\n{W}{W}: This creature gets +0/+2 until end of turn.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 1,
    toughness: 1,
    staticAbilities: ["banding"],
    activatedAbilities: [
        {
            id: "kjeldoran-knight-pump-power",
            oracleText: "{1}{W}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "kjeldoran-knight-pump-toughness",
            oracleText: "{W}{W}: This creature gets +0/+2 until end of turn.",
            cost: { mana: { W: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    0,
                    2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Kjeldoran Phalanx — first strike + banding keyword creature (CR 702.7,
// 702.22).
export const kjeldoranPhalanx: CardDefinition = {
    id: "b6e91ba0-b229-4ab1-84f3-2a490dfa5051",
    name: "Kjeldoran Phalanx",
    rarity: "rare",
    oracleText: "First strike, banding",
    manaCost: { X: 5, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 5,
    staticAbilities: ["first strike", "banding"],
};
// DEFERRED (#653): "All combat damage that would be dealt to you by unblocked
// creatures this turn is dealt to this creature instead" needs a global
// combat-damage redirect shield (every unblocked attacker → this creature).
// The shipped redirect kinds are per-source, not an all-unblocked redirect.
// export const kjeldoranRoyalGuard: CardDefinition = {
//     id: "66343008-c38a-48a9-b767-fd2243103690",
//     name: "Kjeldoran Royal Guard",
//     rarity: "rare",
//     oracleText: "{T}: All combat damage that would be dealt to you by unblocked creatures this turn is dealt to this creature instead.",
//     manaCost: { X: 3, W: 2 },
//     types: ["Creature"],
//     subtypes: ["Human", "Soldier"],
//     power: 2,
//     toughness: 5,
// };
// Kjeldoran Skycaptain — flying + first strike + banding (CR 702.9, 702.7,
// 702.22).
export const kjeldoranSkycaptain: CardDefinition = {
    id: "cf0115e0-6192-48a9-9e58-f3ef77ef77c2",
    name: "Kjeldoran Skycaptain",
    rarity: "uncommon",
    oracleText: "Flying, first strike, banding",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "first strike", "banding"],
};
// Kjeldoran Skyknight — flying + first strike + banding (CR 702.9, 702.7,
// 702.22).
export const kjeldoranSkyknight: CardDefinition = {
    id: "f794665a-8353-482a-b065-2a0777a8acda",
    name: "Kjeldoran Skyknight",
    rarity: "common",
    oracleText: "Flying, first strike, banding",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying", "first strike", "banding"],
};
// Kjeldoran Warrior — banding keyword creature (CR 702.22).
export const kjeldoranWarrior: CardDefinition = {
    id: "ce76f38f-566e-49ff-b197-510cfa1cb51c",
    name: "Kjeldoran Warrior",
    rarity: "common",
    oracleText: "Banding",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Warrior"],
    power: 1,
    toughness: 1,
    staticAbilities: ["banding"],
};
// Lightning Blow — {1}{W} Instant. "Target creature gains first strike until
// end of turn" (CR 702.7 keyword grant via layer 6) plus the next-upkeep
// cantrip rider.
export const lightningBlow: CardDefinition = {
    id: "d1a4ed99-f38c-4e0f-9ff2-2e1e9126e6ef",
    name: "Lightning Blow",
    rarity: "rare",
    oracleText:
        "Target creature gains first strike until end of turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") {
            ctx.grantStaticAbility(t, "first strike", {
                phase: "end-of-turn",
            });
        }
        scheduleNextUpkeepDraw(ctx, lightningBlow.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Lost Order of Jarkeld — as it enters, choose an opponent (CR 603.6b); its P/T
// is a characteristic-defining ability (CR 604.3, layer 7a) equal to 1 plus the
// number of creatures the chosen player controls. The pt-cda reads the stored
// `chosenPlayerId` and counts that player's creatures live from game state.
export const lostOrderOfJarkeld: CardDefinition = {
    id: "0f8fe1e5-69d2-401f-97cb-3cc01064bad3",
    name: "Lost Order of Jarkeld",
    rarity: "rare",
    oracleText:
        "As this creature enters, choose an opponent.\nLost Order of Jarkeld's power and toughness are each equal to 1 plus the number of creatures the chosen player controls.",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 0,
    toughness: 0,
    triggeredAbilities: [
        enteredTrigger({
            id: "lost-order-choose-opponent",
            oracleText: "As this creature enters, choose an opponent.",
            scope: "self",
            resolve: (ctx) => {
                // 2-player game: the single opponent of the controller.
                const opponent = ctx.apNapOrder().find(
                    (id) =>
                        id !==
                        ctx.getController({
                            type: "permanent",
                            id: ctx.sourceInstanceId,
                        })
                );
                if (opponent) ctx.setChosenPlayer(opponent);
            },
        }),
    ],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                const chosen = source.chosenPlayerId;
                let creatures = 0;
                if (chosen) {
                    for (const player of state.players) {
                        for (const p of player.battlefield) {
                            if (
                                p.controllerId === chosen &&
                                p.types.includes("Creature")
                            ) {
                                creatures++;
                            }
                        }
                    }
                }
                const value = 1 + creatures;
                return { power: value, toughness: value };
            },
        },
    ],
};
// Mercenaries — {3}: The next time this creature would deal damage to you this
// turn, prevent that damage. Any player may activate (CR 615 prevention,
// 602.1 / 113.3c open activation). The shield is keyed to this creature as the
// damage source and to the activating player as the protected recipient.
export const mercenaries: CardDefinition = {
    id: "7b28762d-1ab7-460e-b433-27f5fa858959",
    name: "Mercenaries",
    rarity: "rare",
    oracleText:
        "{3}: The next time this creature would deal damage to you this turn, prevent that damage. Any player may activate this ability.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Mercenary"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "mercenaries-prevent",
            oracleText:
                "{3}: The next time this creature would deal damage to you this turn, prevent that damage. Any player may activate this ability.",
            cost: { mana: { X: 3 } },
            useStack: true,
            activatableByAnyPlayer: true,
            resolve: (ctx: SpellContext) => {
                // The activator (the player who paid) is shielded against this
                // creature's next damage to them this turn.
                ctx.preventNextDamageFromSource(
                    ctx.sourceInstanceId,
                    ctx.controller,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Order of the Sacred Torch — {T}, Pay 1 life: Counter target black spell
// (CR 701.5 counter, CR 118.4 life cost). Target restricted to black spells on
// the stack via the spell color filter.
export const orderOfTheSacredTorch: CardDefinition = {
    id: "ccc5cb36-c43d-4c71-8019-9b683e160a0a",
    name: "Order of the Sacred Torch",
    rarity: "rare",
    oracleText: "{T}, Pay 1 life: Counter target black spell.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "order-sacred-torch-counter",
            oracleText: "{T}, Pay 1 life: Counter target black spell.",
            cost: { tap: true, life: 1 },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                colorFilter: "B",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "spell") ctx.counter(t);
            },
        },
    ],
};
// Order of the White Shield — protection from black (CR 702.16) plus a first
// strike grant and a power pump (CR 611.1b), the classic "Order" cycle shape.
export const orderOfTheWhiteShield: CardDefinition = {
    id: "92e55b10-375f-4b4f-b676-3b9b8085fdd2",
    name: "Order of the White Shield",
    rarity: "uncommon",
    oracleText:
        "Protection from black\n{W}: This creature gains first strike until end of turn.\n{W}{W}: This creature gets +1/+0 until end of turn.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 1,
    staticAbilities: ["protection from black"],
    activatedAbilities: [
        {
            id: "order-white-shield-first-strike",
            oracleText:
                "{W}: This creature gains first strike until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "first strike",
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "order-white-shield-pump",
            oracleText: "{W}{W}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { W: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// DEFERRED (#653): needs a colour-keyed ALL-damage prevention shield that
// applies to an Aura's HOST plus a stored colour choice. The shipped
// `combat-damage-prevention` static is self-only (no AURA_AFFECTS_HOST) and
// combat-only; Prismatic Ward prevents ALL damage from the chosen colour.
// export const prismaticWard: CardDefinition = {
//     id: "6f8b50fd-3d1d-4ea8-a3c7-98ca7a8a455e",
//     name: "Prismatic Ward",
//     rarity: "common",
//     oracleText: "Enchant creature\nAs this Aura enters, choose a color.\nPrevent all damage that would be dealt to enchanted creature by sources of the chosen color.",
//     manaCost: { X: 1, W: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Rally — "Blocking creatures get +1/+1 until end of turn." (CR 611.1b, 509.1)
// A combat trick that pumps every creature currently blocking. Blocking
// creatures are read from the live block graph (attacker → blocker ids).
export const rally: CardDefinition = {
    id: "e1e9f80e-5d75-45b7-9c66-c0f30996f4dc",
    name: "Rally",
    rarity: "common",
    oracleText: "Blocking creatures get +1/+1 until end of turn.",
    manaCost: { W: 2 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        const blockersByAttacker = ctx.getBlockersByAttacker();
        const blockerIds = new Set<string>();
        for (const attackerId of Object.keys(blockersByAttacker)) {
            for (const id of blockersByAttacker[attackerId]) {
                blockerIds.add(id);
            }
        }
        for (const id of blockerIds) {
            ctx.addTemporaryPTBuff({ type: "permanent", id }, 1, 1, {
                phase: "end-of-turn",
            });
        }
    },
};
export const redScarab: CardDefinition = makeScarab({
    id: "9a734154-5944-42f4-a02e-c426a45847f3",
    name: "Red Scarab",
    rarity: "uncommon",
    color: "R",
});
// DEFERRED (#653): "put a +0/+1 counter on that creature for each 1 damage
// prevented this way" needs the prevention pipeline to report the amount
// actually consumed by the shield. No primitive exposes prevented-amount today,
// so the counter count can't be composed faithfully.
// export const sacredBoon: CardDefinition = {
//     id: "d721569d-9cf2-4c3c-b11c-4c46c258a0d2",
//     name: "Sacred Boon",
//     rarity: "uncommon",
//     oracleText: "Prevent the next 3 damage that would be dealt to target creature this turn. At the beginning of the next end step, put a +0/+1 counter on that creature for each 1 damage prevented this way.",
//     manaCost: { X: 1, W: 1 },
//     types: ["Instant"],
// };
// Seraph — {6}{W} 4/4 flying Angel. "Whenever a creature dealt damage by this
// creature this turn dies, put that card onto the battlefield under your control
// at the beginning of the next end step." (CR 603.2 death trigger keyed on
// `damagedBySources` — the Sengir/Krovikan Vampire check — composed with a
// next-end-step delayed reanimation, CR 603.7c, exactly like Krovikan Vampire.)
//
// SIMPLIFICATION (flagged, no engine change — identical to Krovikan Vampire):
// the "Sacrifice the creature when you lose control of this creature" clause
// requires per-permanent control-loss tracking the engine doesn't model yet.
// The reanimation (the card's main effect) is faithful; the
// sacrifice-on-loss-of-control clause — only reachable via a control-change
// effect on Seraph, which the current pool barely exercises — is deferred.
const SERAPH_ID = "ab675291-3189-43f3-b11b-0724eca8b941";
export const seraph: CardDefinition = {
    id: SERAPH_ID,
    name: "Seraph",
    rarity: "rare",
    oracleText:
        "Flying\nWhenever a creature dealt damage by this creature this turn dies, put that card onto the battlefield under your control at the beginning of the next end step. Sacrifice the creature when you lose control of this creature.",
    manaCost: { X: 6, W: 1 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        diedTrigger({
            id: "seraph-mark",
            oracleText:
                "Whenever a creature dealt damage by this creature this turn dies, reanimate it under your control at the beginning of the next end step.",
            scope: "any-other",
            condition: (event, self) =>
                event.damagedBySources.includes(self.id),
            resolve: (ctx, _event, deadCreature) => {
                ctx.scheduleDelayedTrigger(
                    SERAPH_ID,
                    "seraph-reanimate",
                    "next-end-step",
                    {
                        deadId: deadCreature.id,
                        controllerId: ctx.controller,
                    }
                );
            },
        }),
    ],
    delayedTriggers: [
        {
            id: "seraph-reanimate",
            oracleText:
                "Put that card onto the battlefield under your control at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (!payload.deadId || !payload.controllerId) return;
                ctx.returnToBattlefield(
                    payload.controllerId,
                    payload.deadId,
                    "graveyard"
                );
            },
        },
    ],
};
// Shield Bearer — 0/3 banding wall-style creature (CR 702.22).
export const shieldBearer: CardDefinition = {
    id: "318ff2da-d309-469c-8e2f-fa3c7517a15a",
    name: "Shield Bearer",
    rarity: "common",
    oracleText: "Banding",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 0,
    toughness: 3,
    staticAbilities: ["banding"],
};
// Snow Hound — {1}, {T}: Return this creature and target green or blue creature
// you control to their owner's hand (CR 701.14). A self-bounce that also
// rescues another of your green/blue creatures.
export const snowHound: CardDefinition = {
    id: "084437ba-26d4-4af6-ab00-dcb145dd2cd0",
    name: "Snow Hound",
    rarity: "uncommon",
    oracleText:
        "{1}, {T}: Return this creature and target green or blue creature you control to their owner's hand.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Dog"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "snow-hound-bounce",
            oracleText:
                "{1}, {T}: Return this creature and target green or blue creature you control to their owner's hand.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                colorFilterAny: ["G", "U"],
            },
            resolve: (ctx: SpellContext) => {
                ctx.returnToHand({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.returnToHand(t);
            },
        },
    ],
};
// Swords to Plowshares — ICE reprint of the LEA instant (exile target
// creature, its controller gains life equal to its power). CardPrint onto the
// LEA definition (ADR 0014).
export const swordsToPlowsharesIce: CardPrint = {
    printId: "375fd2cb-443b-4be4-ad60-6d1a8e74f510",
    definitionId: "386ea9eb-abc1-4862-aa2d-8fb808d79490",
    setCode: "ice",
    rarity: "uncommon",
};
// Warning — "Prevent all combat damage that would be dealt by target attacking
// creature this turn." (CR 615.1, 510.1c). Implemented via the source-only
// "assigns no combat damage" mark — the attacker deals 0 combat damage in every
// damage step this turn but can still be dealt damage and die.
export const warning: CardDefinition = {
    id: "cca5b4a7-df11-4635-a147-df12cd13a67c",
    name: "Warning",
    rarity: "common",
    oracleText:
        "Prevent all combat damage that would be dealt by target attacking creature this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        combatRoleFilter: "attacking",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") ctx.markAssignsNoCombatDamage(t);
    },
};
export const whiteScarab: CardDefinition = makeScarab({
    id: "c57726b5-dfdd-4e47-bc52-ebf6eedbf3bd",
    name: "White Scarab",
    rarity: "uncommon",
    color: "W",
});

// ─────────────────────────────────────────────────────────────────────────────
// Blue free tranche (#631)
//
// The free-tranche Blue cards — expressible entirely with already-shipped
// primitives — are activated below (intermixed with the remaining commented
// stubs). Counterspell, Power Sink and Sleight of Mind are LEA reprints, wired
// as CardPrints onto their existing definitions (ADR 0014); every other
// new-to-ICE Blue card is a full CardDefinition.
//
// DEFERRED (remain commented stubs, owned by a later cluster):
//   • Cumulative upkeep — Arnjlot's Ascent, Breath of Dreams, the four
//     Illusionary creatures, Illusionary Terrain, Illusions of Grandeur,
//     Mesmeric Trance, Musician, Mystic Might, Mystic Remora, Polar Kraken,
//     Reality Twist, Snowfall (ADR 0042 cumulative-upkeep cluster).
//   • Zur's Weirding cluster — Zur's Weirding itself and Dreams of the Dead
//     (grants cumulative upkeep on reanimation).
//   • "Draw a card at the beginning of the next turn's upkeep" delayed cantrips
//     — Clairvoyance, Enervate, Force Void, Infuse, Portent, Ray of Erasure,
//     Updraft: ACTIVE (#660 — the `next-upkeep` delayed-trigger timing shipped;
//     the cantrips schedule it via `scheduleNextUpkeepDraw`).
//   • Until-end-of-turn control gain + "tap it when you lose control" — Ray of
//     Command, Magus of the Unseen (ControlChangeCondition has no EOT variant).
//   • Specialized primitives still missing — Mistfolk (counter a spell that
//     targets this creature — no "spell targeting source" target filter),
//     Phantasmal Mount (linked leaves-the-battlefield sacrifices — no delayed
//     "leaves the battlefield this turn" trigger timing), Essence Vortex (pay
//     LIFE in a may-pay choice), Soldevi Machinist (mana spendable only on
//     artifact ABILITIES — ManaRestriction has only spell variants), Merieke Ri
//     Berit (conditional control + destroy-on-untap), Winter's Chill (combat-
//     only X capped by snow lands), Balduvian Conjurer (animate a snow land),
//     Balduvian Shaman / Sleight-of-Mind-style colour-word text change that
//     also grants cumulative upkeep, Flooded Woodlands (attack restriction with
//     per-attacker cost).
//
// COMPLETED (#654) — buildable-now Blue cards using shipped primitives only:
//   • Krovikan Sorcerer — colour-filtered chosen-discard cost paid in-resolve
//     (Mesmeric Trance pattern, `candidateIds` from hand colours) + draw.
//   • Shyft — upkeep `may` → `requestOptionChoice` colour → indefinite layer-5
//     `setColorOverride` (single-colour reading; multicolour deferred).
// ─────────────────────────────────────────────────────────────────────────────

// Arnjlot's Ascent — {U}{U} Enchantment with cumulative upkeep {U} (CR 702.24)
// and "{1}: Target creature gains flying until end of turn." The CU keyword is
// the ADR 0042 template; the activated grant mirrors Flying Carpet (arn.ts).
export const arnjlotsAscent: CardDefinition = {
    id: "2307fb16-8b77-45b5-8a02-51a13214791d",
    name: "Arnjlot's Ascent",
    rarity: "common",
    oracleText:
        "Cumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\n{1}: Target creature gains flying until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "arnjlots-ascent-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
    ],
    activatedAbilities: [
        {
            id: "arnjlots-ascent-grant-flying",
            oracleText: "{1}: Target creature gains flying until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.grantStaticAbility(target, "flying", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// Balduvian Conjurer — {T}: animate a target SNOW land into a 2/2 creature
// until end of turn (CR 208.2 / 611.1 — `animateAsCreature`; "it's still a
// land" since animate ADDS the Creature type without removing Land). The target
// is gated to snow lands via the live `supertypeFilter` (CR 205.4a).
export const balduvianConjurer: CardDefinition = {
    id: "5b616963-fac0-451c-8df4-2cacc9466b17",
    name: "Balduvian Conjurer",
    rarity: "uncommon",
    oracleText:
        "{T}: Target snow land becomes a 2/2 creature until end of turn. It's still a land.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "balduvian-conjurer-animate",
            oracleText:
                "{T}: Target snow land becomes a 2/2 creature until end of turn. It's still a land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                supertypeFilter: ["Snow"],
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.animateAsCreature(target, {
                        power: 2,
                        toughness: 2,
                        duration: { phase: "end-of-turn" },
                    });
                }
            },
        },
    ],
};
// Balduvian Shaman — {T}: target a white enchantment you control without
// cumulative upkeep, (a) replace one color word in its text with another
// (CR 612 / 613 layer-3 text change — Sleight of Mind's primitive), and (b)
// grant it "Cumulative upkeep {1}" PERMANENTLY (CR 702.24, CR 113.1 / 611.2c —
// ADR 0042). The grant rides the enchantment indefinitely (independent of the
// Shaman) via `grantTriggeredAbilityPermanent`, reading its template from
// `triggeredGrantTemplates[]`; age counters accrue on the enchantment, paid by
// its controller. The "to" color word is picked by the activator at resolution
// (`requestOptionChoice`); the "from" word is the first present color word that
// differs (matching Sleight of Mind's auto-pick). `useStack: true` — it goes on
// the stack and can be responded to.
const BALDUVIAN_SHAMAN_ID = "74859723-8ddf-4ee6-a0a7-87192c84e8ad";
export const balduvianShaman: CardDefinition = {
    id: BALDUVIAN_SHAMAN_ID,
    name: "Balduvian Shaman",
    rarity: "common",
    oracleText:
        '{T}: Change the text of target white enchantment you control that doesn\'t have cumulative upkeep by replacing all instances of one color word with another. (For example, you may change "black creatures can\'t attack" to "blue creatures can\'t attack.") That enchantment gains "Cumulative upkeep {1}." (At the beginning of its controller\'s upkeep, that player puts an age counter on it, then sacrifices it unless they pay its upkeep cost for each age counter on it.)',
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Shaman"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "balduvian-shaman-grant",
            oracleText:
                '{T}: Change the text of target white enchantment you control that doesn\'t have cumulative upkeep by replacing all instances of one color word with another. That enchantment gains "Cumulative upkeep {1}."',
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                count: 1,
                controller: "you",
                colorFilter: "W",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "permanent") return;
                // CR 612 — replace one color word with the chosen one.
                const present = ctx.getColorWordsPresent(target);
                if (present.length > 0) {
                    const to = ctx.requestOptionChoice({
                        playerId: ctx.controller,
                        choiceId: "balduvian-shaman-color-word",
                        options: COLOR_WORD_OPTIONS,
                        prompt: "Replace a color word with:",
                    });
                    if (to === undefined) return; // suspended for the choice
                    const from = present.find((w) => w !== to) ?? present[0];
                    if (from) {
                        ctx.addTextChange(target, {
                            kind: "color-word",
                            from,
                            to,
                        });
                    }
                }
                // CR 113.1 / 702.24 — the enchantment gains "Cumulative upkeep
                // {1}" permanently (independent of the Shaman).
                ctx.grantTriggeredAbilityPermanent(
                    target,
                    BALDUVIAN_SHAMAN_ID,
                    "balduvian-shaman-granted-cu"
                );
            },
        },
    ],
    triggeredGrantTemplates: [
        cumulativeUpkeepTrigger({
            id: "balduvian-shaman-granted-cu",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
};
// Binding Grasp — Aura granting control of the enchanted creature (CR 613.1b,
// layer 2 control-change) plus a static +0/+1 (layer 7c) and an upkeep
// pay-{1}{U}-or-sacrifice tax (CR 603.6a / 117.3a). The Control-Magic shape
// with an upkeep cost rider.
export const bindingGrasp: CardDefinition = {
    id: "6b086186-5fbf-4ba7-af0d-ee3ad61d27bb",
    name: "Binding Grasp",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nAt the beginning of your upkeep, sacrifice this Aura unless you pay {1}{U}.\nYou control enchanted creature.\nEnchanted creature gets +0/+1.",
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "control-change", applies: AURA_AFFECTS_HOST },
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 0, toughness: 1 },
    ],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "binding-grasp-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this Aura unless you pay {1}{U}.",
            cost: { X: 1, U: 1 },
            prompt: "Pay {1}{U} to keep Binding Grasp?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};
// Brainstorm — "Draw three cards, then put two cards from your hand on top of
// your library in any order." (CR 121.1 draw, CR 401 library top.) Composition:
// drawCards(3) then a two-step resolution — the caster picks 2 hand cards (a
// `choose-hand-card` requestChoice), each moved to the top of the library; the
// pick order IS the top-of-library order (the first picked ends up second from
// top, matching "in any order" since the player controls the sequence).
export const brainstorm: CardDefinition = {
    id: "8d42d7aa-7f53-4cfc-842a-086aab2448d1",
    name: "Brainstorm",
    rarity: "common",
    oracleText:
        "Draw three cards, then put two cards from your hand on top of your library in any order.",
    manaCost: { U: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.drawCards(ctx.controller, 3);
        const picks = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "brainstorm-putback",
            kind: "choose-hand-card",
            zone: "hand",
            count: 2,
            prompt: "Choose two cards to put on top of your library (last picked ends up on top).",
        });
        if (picks === undefined) return; // suspended for the choice
        // Move each pick to the top; the second pick lands on top last, so the
        // player's chosen order is preserved (CR 401 "in any order").
        for (const id of picks) {
            ctx.moveHandCardToLibraryTop(ctx.controller, id);
        }
    },
};
// Breath of Dreams — {2}{U}{U} Enchantment with cumulative upkeep {U} on itself,
// plus a GROUP GRANT of "Cumulative upkeep {1}" to every green creature
// (CR 702.24, CR 611 continuous triggered-ability grant — ADR 0042). Modeled
// exactly like Energy Flux (atq.ts): a `triggered-grant` static whose `applies`
// is the green-creature predicate, with the granted template — the
// cumulative-upkeep trigger — living on `triggeredGrantTemplates[]` (kept off
// `triggeredAbilities` so Breath of Dreams itself, an Enchantment, never fires
// the granted CU). The age counter accrues on each green creature (the host),
// paid by that creature's controller (CR 702.24a). New green creatures entering
// while Breath of Dreams is in play receive the grant; it detaches when Breath
// leaves. Both players' green creatures are affected (the text is not
// controller-scoped).
const IS_GREEN_CREATURE = (
    target: PermanentView,
    _source: PermanentView,
    ctx: import("../types").StaticEffectContext
): boolean => ctx.isCreature(target) && ctx.getColors(target).includes("G");
export const breathOfDreams: CardDefinition = {
    id: "e40c9657-fab4-489d-8eb0-960ba2605add",
    name: "Breath of Dreams",
    rarity: "uncommon",
    oracleText:
        'Cumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nGreen creatures have "Cumulative upkeep {1}."',
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "breath-of-dreams-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
    ],
    staticEffects: [
        // CR 113.1 / 611 — grant "Cumulative upkeep {1}" to every green creature.
        {
            kind: "triggered-grant",
            applies: IS_GREEN_CREATURE,
            abilityId: "breath-of-dreams-granted-cu",
        },
    ],
    // The granted CU template lives here, NOT on `triggeredAbilities`, so Breath
    // of Dreams (an Enchantment, not a green creature) never fires it itself.
    triggeredGrantTemplates: [
        cumulativeUpkeepTrigger({
            id: "breath-of-dreams-granted-cu",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
};
// Clairvoyance — {U} Instant. "Look at target player's hand" (CR 401.4 look,
// via the `revealHand` display-only choice) plus the next-upkeep cantrip rider.
export const clairvoyance: CardDefinition = {
    id: "46740353-e2ba-4d80-a97d-1368bc67bf30",
    name: "Clairvoyance",
    rarity: "common",
    oracleText:
        "Look at target player's hand.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const t = ctx.targets[0];
            if (t?.type === "player") {
                // CR 401.4 — display the target's hand to the controller; the
                // step suspends until the controller dismisses it.
                if (ctx.revealHand(t.id) === undefined) return;
            }
            scheduleNextUpkeepDraw(ctx, clairvoyance.id);
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Counterspell — ICE reprint of the LEA instant ("Counter target spell").
// CardPrint onto the LEA definition (ADR 0014).
export const counterspellIce: CardPrint = {
    printId: "aedbcbaa-40f0-485f-8427-778edc2d2ec0",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    setCode: "ice",
    rarity: "common",
};
// Deflection — "Change the target of target spell with a single target."
// (CR 114.6 — change a spell's target.) Targets a spell on the stack; on
// resolution it enters a `retarget` phase via `requestRetarget`, asking the
// caster to pick a new legal target for that spell.
//
// SIMPLIFICATION (flagged, no engine change): TargetRequirement has no
// "spell with a single target" filter, so Deflection may be cast at any spell
// on the stack. The retarget then re-validates against "any target"; for a
// multi-target spell only one target would be re-chosen, which is a minor
// deviation from the printed "single target" restriction. Acceptable for the
// current pool, where targeted spells are overwhelmingly single-target.
export const deflection: CardDefinition = {
    id: "1005a00a-6a0e-44cb-abea-37e2e53125e2",
    name: "Deflection",
    rarity: "rare",
    oracleText: "Change the target of target spell with a single target.",
    manaCost: { X: 3, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "spell") return;
        // Re-pick a single new target for the spell against "any target" —
        // the engine re-validates the new target against the spell's own
        // requirement at selection time (CR 114.6).
        ctx.requestRetarget(t.id, { type: "any", count: 1 });
    },
};
// Dreams of the Dead — {3}{U} Enchantment with a {1}{U} reanimation ability:
// "Return target white or black creature card from your graveyard to the
// battlefield. That creature gains 'Cumulative upkeep {2}.' If the creature
// would leave the battlefield, exile it instead of putting it anywhere else."
// (CR 400.7 zone change, CR 702.24 granted CU — ADR 0042, CR 614.1c leave →
// exile replacement.) The granted CU rides the reanimated creature permanently
// (independent of Dreams) via `grantTriggeredAbilityPermanent`; the persistent
// `setExileOnLeave` flag routes EVERY later departure (dies / sacrifice / bounce
// / destroy) to exile, so the creature can't be re-reanimated. The {1}{U} cost
// is paid at activation; the reanimation resolves from the stack (useStack: true).
const DREAMS_OF_THE_DEAD_ID = "93372854-57e7-4db7-a1a6-376c9f49a514";
export const dreamsOfTheDead: CardDefinition = {
    id: DREAMS_OF_THE_DEAD_ID,
    name: "Dreams of the Dead",
    rarity: "uncommon",
    oracleText:
        '{1}{U}: Return target white or black creature card from your graveyard to the battlefield. That creature gains "Cumulative upkeep {2}." If the creature would leave the battlefield, exile it instead of putting it anywhere else. (At the beginning of its controller\'s upkeep, that player puts an age counter on it, then sacrifices it unless they pay its upkeep cost for each age counter on it.)',
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "dreams-of-the-dead-reanimate",
            oracleText:
                '{1}{U}: Return target white or black creature card from your graveyard to the battlefield. That creature gains "Cumulative upkeep {2}." If the creature would leave the battlefield, exile it instead of putting it anywhere else.',
            cost: { mana: { X: 1, U: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
                colorFilterAny: ["W", "B"],
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "graveyard-card" || !t.playerId) return;
                // CR 400.7 — return to the battlefield under the controller's
                // control. The instance keeps its id, so we grant CU and the
                // exile-on-leave replacement to the same id afterwards.
                const ok = ctx.returnToBattlefield(
                    ctx.controller,
                    t.id,
                    "graveyard"
                );
                if (!ok) return;
                const host = { type: "permanent" as const, id: t.id };
                // CR 702.24 — the creature gains "Cumulative upkeep {2}".
                ctx.grantTriggeredAbilityPermanent(
                    host,
                    DREAMS_OF_THE_DEAD_ID,
                    "dreams-of-the-dead-granted-cu"
                );
                // CR 614.1c — if it would leave, exile it instead (all paths).
                ctx.setExileOnLeave(host);
            },
        },
    ],
    triggeredGrantTemplates: [
        cumulativeUpkeepTrigger({
            id: "dreams-of-the-dead-granted-cu",
            cost: { X: 2 },
            costLabel: "{2}",
        }),
    ],
};
// Enervate — {1}{U} Instant. "Tap target artifact, creature, or land"
// (CR 701.20 tap) plus the next-upkeep cantrip rider.
export const enervate: CardDefinition = {
    id: "c4fdfc5b-c2ab-4c4d-b120-301e17f3d9c6",
    name: "Enervate",
    rarity: "common",
    oracleText:
        "Tap target artifact, creature, or land.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Artifact", "Creature", "Land"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") ctx.tap(t);
        scheduleNextUpkeepDraw(ctx, enervate.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// TODO(#628): implement.
// export const errantMinion: CardDefinition = {
//     id: "61648ddb-6efb-43d0-b2b1-418cc957854c",
//     name: "Errant Minion",
//     rarity: "common",
//     oracleText: "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player may pay any amount of mana. This Aura deals 2 damage to that player. Prevent X of that damage, where X is the amount of mana that player paid this way.",
//     manaCost: { X: 2, U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Essence Flare — Aura: static +2/+0 (layer 7c) plus an upkeep trigger on the
// enchanted creature's controller that puts a -0/-1 counter on the host
// (CR 603.6a phase trigger, CR 122 counters, layer 7d). The host wastes away one
// toughness per upkeep.
export const essenceFlare: CardDefinition = {
    id: "13ebb5dd-d7f1-4b06-8585-7004045be542",
    name: "Essence Flare",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature gets +2/+0.\nAt the beginning of the upkeep of enchanted creature's controller, put a -0/-1 counter on that creature.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 2, toughness: 0 },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "essence-flare-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, put a -0/-1 counter on that creature.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addCounter({ type: "permanent", id: hostId }, "-0/-1", 1);
            },
        }),
    ],
};
// Force Void — {2}{U} Instant. "Counter target spell unless its controller
// pays {1}" (CR 701.5a counter-unless-pay; CR 117.3a may-pay billed to the
// spell's controller — Vodalian Mage pattern) plus the next-upkeep cantrip
// rider. The schedule lands in a SEPARATE resolve step AFTER the may-pay so a
// suspension on the {1} prompt never double-schedules the draw.
export const forceVoid: CardDefinition = {
    id: "226555ba-22af-45f1-a3f4-d265f8685dd5",
    name: "Force Void",
    rarity: "uncommon",
    oracleText:
        "Counter target spell unless its controller pays {1}.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target || target.type !== "spell") return;
            const spellController = ctx.getController(target);
            const accept = ctx.requestMayPay({
                playerId: spellController,
                choiceId: `force-void-${ctx.sourceInstanceId}`,
                cost: { X: 1 },
                prompt: "Pay {1} or your spell is countered (Force Void)?",
            });
            if (accept === undefined) return; // suspended on the may-pay
            if (!accept) ctx.counter(target);
        },
        (ctx: SpellContext) => {
            scheduleNextUpkeepDraw(ctx, forceVoid.id);
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Glacial Wall — 0/7 Wall with Defender (CR 702.3).
export const glacialWall: CardDefinition = {
    id: "07b71bc1-d9a2-4e99-a8fa-cd696925328d",
    name: "Glacial Wall",
    rarity: "uncommon",
    oracleText: "Defender",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 7,
    staticAbilities: ["defender"],
};
// Hydroblast — modal "choose one" (CR 700.2): counter a red spell OR destroy a
// red permanent. Each mode restricts its target to red via `colorFilter: "R"`
// (the "if it's red" clause is enforced as a target restriction in the current
// pool, which is equivalent for these single-target modes). Functionally the
// Blue Elemental Blast shape.
export const hydroblast: CardDefinition = {
    id: "f62716f0-fde2-49ef-b8a4-c1b03f451194",
    name: "Hydroblast",
    rarity: "common",
    oracleText:
        "Choose one —\n• Counter target spell if it's red.\n• Destroy target permanent if it's red.",
    manaCost: { U: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "counter",
            label: "Counter target red spell",
            oracleText: "Counter target spell if it's red.",
            targetRequirement: { type: "spell", count: 1, colorFilter: "R" },
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (t?.type === "spell") ctx.counter(t);
            },
        },
        {
            id: "destroy",
            label: "Destroy target red permanent",
            oracleText: "Destroy target permanent if it's red.",
            targetRequirement: { type: "any", count: 1, colorFilter: "R" },
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.destroy(t);
            },
        },
    ],
};
// Iceberg — counters-as-mana battery (CR 122 counters, CR 605 mana ability).
// Enters with X ice counters; "{3}: Put an ice counter on this" stores mana,
// and "Remove an ice counter: Add {C}" spends it. The removal ability is a mana
// ability (`useStack: false`, CR 605.1a) so it resolves immediately.
export const iceberg: CardDefinition = {
    id: "a2f70e49-17fa-4033-bd45-63374f7f5ec5",
    name: "Iceberg",
    rarity: "uncommon",
    oracleText:
        "This enchantment enters with X ice counters on it.\n{3}: Put an ice counter on this enchantment.\nRemove an ice counter from this enchantment: Add {C}.",
    manaCost: { X: "X", U: 2 },
    types: ["Enchantment"],
    entersWith: { counters: [{ type: "ice", count: "X" }] },
    activatedAbilities: [
        {
            id: "iceberg-store",
            oracleText: "{3}: Put an ice counter on this enchantment.",
            cost: { mana: { X: 3 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "ice",
                    1
                );
            },
        },
        {
            id: "iceberg-tap-for-mana",
            oracleText: "Remove an ice counter from this enchantment: Add {C}.",
            cost: { removeCounter: { type: "ice", count: 1 } },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
    ],
};
// Icy Prison — ETB-targeted exile-and-return holding bundle (CR 603.7a /
// ADR 0028) plus an upkeep sacrifice tax. On entry it exiles a target creature
// (keyed to itself); each upkeep it is sacrificed unless {3} is paid; when it
// leaves, the exiled card returns to the battlefield under its owner's control.
//
// SIMPLIFICATION (flagged, no engine change): the printed upkeep cost is "any
// player pays {3}" — political. `makeUpkeepPayOrElse` prompts the controller
// (the player who wants to keep it). In a duel the controller is the only
// player with an incentive to pay, so this matches play in practice.
export const icyPrison: CardDefinition = {
    id: "39a7e496-8d2e-49db-b298-475d9017537a",
    name: "Icy Prison",
    rarity: "rare",
    oracleText:
        "When this enchantment enters, exile target creature.\nAt the beginning of your upkeep, sacrifice this enchantment unless any player pays {3}.\nWhen this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        enteredTrigger({
            id: "icy-prison-exile",
            oracleText: "When this enchantment enters, exile target creature.",
            scope: "self",
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                ctx.exileWithAttachments(t.id, {
                    sourceId: ctx.sourceInstanceId,
                    returnTapped: false,
                });
            },
        }),
        makeUpkeepPayOrElse({
            id: "icy-prison-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless any player pays {3}.",
            cost: { X: 3 },
            prompt: "Pay {3} to keep Icy Prison?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
        leftTrigger({
            id: "icy-prison-return",
            oracleText:
                "When this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                ctx.returnExiledForSource(ctx.sourceInstanceId);
            },
        }),
    ],
};
// Illusionary Forces — {3}{U} 4/4 flier with cumulative upkeep {U} (CR 702.24,
// ADR 0042). Flying is a plain keyword static; the CU keyword is the template.
export const illusionaryForces: CardDefinition = {
    id: "ab02268e-01cf-4729-95ca-5773afd40b56",
    name: "Illusionary Forces",
    rarity: "common",
    oracleText:
        "Flying\nCumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "illusionary-forces-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
    ],
};
// TODO(#628): implement.
// export const illusionaryPresence: CardDefinition = {
//     id: "aa31efed-4a11-4f59-a623-bac45d20091d",
//     name: "Illusionary Presence",
//     rarity: "rare",
//     oracleText: "Cumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAt the beginning of your upkeep, choose a land type. This creature gains landwalk of the chosen type until end of turn. (It can't be blocked as long as defending player controls a land of that type.)",
//     manaCost: { X: 1, U: 2 },
//     types: ["Creature"],
//     subtypes: ["Illusion"],
//     power: 2,
//     toughness: 2,
// };
// TODO(#628): implement.
// export const illusionaryTerrain: CardDefinition = {
//     id: "691f4a1b-4706-41aa-82da-ae920739f036",
//     name: "Illusionary Terrain",
//     rarity: "uncommon",
//     oracleText: "Cumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAs this enchantment enters, choose two basic land types.\nBasic lands of the first chosen type are the second chosen type.",
//     manaCost: { U: 2 },
//     types: ["Enchantment"],
// };
// Illusionary Wall — {4}{U} 7/4 with defender, flying, first strike and
// cumulative upkeep {U} (CR 702.24, ADR 0042). All keywords are plain statics.
export const illusionaryWall: CardDefinition = {
    id: "6430e8e2-fee3-4744-820e-d6e16cb992bd",
    name: "Illusionary Wall",
    rarity: "common",
    oracleText:
        "Defender, flying, first strike\nCumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion", "Wall"],
    power: 7,
    toughness: 4,
    staticAbilities: ["defender", "flying", "first strike"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "illusionary-wall-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
    ],
};
// Illusions of Grandeur — {3}{U} Enchantment with cumulative upkeep {2}
// (CR 702.24), an ETB "gain 20 life" and an LTB "lose 20 life" (the classic
// Donate combo half). CU is the ADR 0042 template; the life swings are self-
// scoped enter/left triggers (CR 603.6).
export const illusionsOfGrandeur: CardDefinition = {
    id: "17eeeef2-2ced-42b8-a5e0-1095c9e13b02",
    name: "Illusions of Grandeur",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhen this enchantment enters, you gain 20 life.\nWhen this enchantment leaves the battlefield, you lose 20 life.",
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "illusions-of-grandeur-cumulative-upkeep",
            cost: { X: 2 },
            costLabel: "{2}",
        }),
        enteredTrigger({
            id: "illusions-of-grandeur-etb",
            oracleText: "When this enchantment enters, you gain 20 life.",
            scope: "self",
            resolve: (ctx: SpellContext) => ctx.gainLife(ctx.controller, 20),
        }),
        leftTrigger({
            id: "illusions-of-grandeur-ltb",
            oracleText:
                "When this enchantment leaves the battlefield, you lose 20 life.",
            scope: "self",
            resolve: (ctx: SpellContext, _event, leaving) =>
                ctx.loseLife(leaving.controllerId, 20),
        }),
    ],
};
// Infuse — {2}{U} Instant. "Untap target artifact, creature, or land"
// (CR 701.20 untap) plus the next-upkeep cantrip rider.
export const infuse: CardDefinition = {
    id: "223287b6-224c-4e00-946c-e7ac5539bd45",
    name: "Infuse",
    rarity: "common",
    oracleText:
        "Untap target artifact, creature, or land.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Artifact", "Creature", "Land"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") ctx.untap(t);
        scheduleNextUpkeepDraw(ctx, infuse.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Krovikan Sorcerer — two looters whose discard cost is colour-filtered
// (CR 601.2h convention — the chosen-discard is paid in-resolve, Mesmeric
// Trance pattern). `PermanentFilter` has no `excludeColors`, so "nonblack" is
// expressed as a precomputed `candidateIds` allow-list from the hand's colours
// (CR 105.2 — black = colour B). Each ability taps (CR 602.1) and goes on the
// stack (`useStack: true`). The black branch is a draw-2-then-discard-1
// (CR 121.1 draw, CR 701.8 discard) sequenced across `resolveSteps`.
export const krovikanSorcerer: CardDefinition = {
    id: "9c5fc053-7b0b-4e76-bf87-ccdb1e8752ed",
    name: "Krovikan Sorcerer",
    rarity: "common",
    oracleText:
        "{T}, Discard a nonblack card: Draw a card.\n{T}, Discard a black card: Draw two cards, then discard one of them.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard", "Sorcerer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "krovikan-sorcerer-nonblack",
            oracleText: "{T}, Discard a nonblack card: Draw a card.",
            cost: { tap: true },
            useStack: true,
            resolveSteps: [
                // Step 0 — pay the discard portion of the cost: a chosen
                // nonblack card from hand (CR 601.2h convention).
                (ctx: SpellContext) => {
                    const candidateIds = ctx
                        .getHandCards(ctx.controller)
                        .filter((c) => !c.colors.includes("B"))
                        .map((c) => c.id);
                    if (candidateIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "krovikan-sorcerer-nonblack-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        candidateIds,
                        prompt: "Discard a nonblack card (Krovikan Sorcerer).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
                // Step 1 — draw a card (CR 121.1). Only if a discard was paid.
                (ctx: SpellContext) => {
                    const discarded = ctx.recallChoice(
                        "krovikan-sorcerer-nonblack-discard"
                    );
                    if (!discarded || discarded.length === 0) return;
                    ctx.drawCards(ctx.controller, 1);
                },
            ],
        },
        {
            id: "krovikan-sorcerer-black",
            oracleText:
                "{T}, Discard a black card: Draw two cards, then discard one of them.",
            cost: { tap: true },
            useStack: true,
            resolveSteps: [
                // Step 0 — pay the discard portion of the cost: a chosen black
                // card from hand (CR 601.2h convention).
                (ctx: SpellContext) => {
                    const candidateIds = ctx
                        .getHandCards(ctx.controller)
                        .filter((c) => c.colors.includes("B"))
                        .map((c) => c.id);
                    if (candidateIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "krovikan-sorcerer-black-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        candidateIds,
                        prompt: "Discard a black card (Krovikan Sorcerer).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
                // Step 1 — draw two cards (CR 121.1). Only if the discard cost
                // was paid.
                (ctx: SpellContext) => {
                    const discarded = ctx.recallChoice(
                        "krovikan-sorcerer-black-discard"
                    );
                    if (!discarded || discarded.length === 0) return;
                    ctx.drawCards(ctx.controller, 2);
                },
                // Step 2 — then discard one of them (CR 701.8). A free choice
                // among the cards now in hand.
                (ctx: SpellContext) => {
                    const discarded = ctx.recallChoice(
                        "krovikan-sorcerer-black-discard"
                    );
                    if (!discarded || discarded.length === 0) return;
                    const handIds = ctx.getHandIds(ctx.controller);
                    if (handIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "krovikan-sorcerer-black-then-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard one of the drawn cards (Krovikan Sorcerer).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
            ],
        },
    ],
};
// TODO(#628): implement.
// export const magusOfTheUnseen: CardDefinition = {
//     id: "86da04e9-b94d-42af-add3-02baf772bd33",
//     name: "Magus of the Unseen",
//     rarity: "rare",
//     oracleText: "{1}{U}, {T}: Untap target artifact an opponent controls and gain control of it until end of turn. It gains haste until end of turn. When you lose control of the artifact, tap it.",
//     manaCost: { X: 1, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Wizard"],
//     power: 1,
//     toughness: 1,
// };
// Mesmeric Trance — {1}{U}{U} Enchantment with cumulative upkeep {1}
// (CR 702.24) and "{U}, Discard a card: Draw a card." The chosen-discard cost
// is paid in-resolve (CR 601.2h convention, Dwarven Armorer pattern): step 0
// discards a chosen card, step 1 draws only if the discard was paid.
export const mesmericTrance: CardDefinition = {
    id: "ae3df593-e9d5-479d-9a9a-1c7262dd9c6c",
    name: "Mesmeric Trance",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\n{U}, Discard a card: Draw a card.",
    manaCost: { X: 1, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "mesmeric-trance-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
    activatedAbilities: [
        {
            id: "mesmeric-trance-loot",
            oracleText: "{U}, Discard a card: Draw a card.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolveSteps: [
                // Step 0 — pay the discard portion of the cost (a chosen card).
                (ctx: SpellContext) => {
                    const handIds = ctx.getHandIds(ctx.controller);
                    if (handIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "mesmeric-trance-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card (Mesmeric Trance).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
                // Step 1 — draw a card (CR 121.1). Only if a discard was paid.
                (ctx: SpellContext) => {
                    const discarded = ctx.recallChoice(
                        "mesmeric-trance-discard"
                    );
                    if (!discarded || discarded.length === 0) return;
                    ctx.drawCards(ctx.controller, 1);
                },
            ],
        },
    ],
};
// TODO(#628): implement.
// export const mistfolk: CardDefinition = {
//     id: "4f3f4d4e-ca4a-4fba-b9fd-cd1d9457cfa1",
//     name: "Mistfolk",
//     rarity: "common",
//     oracleText: "{U}: Counter target spell that targets this creature.",
//     manaCost: { U: 2 },
//     types: ["Creature"],
//     subtypes: ["Illusion"],
//     power: 1,
//     toughness: 2,
// };
// TODO(#628): implement.
// export const musician: CardDefinition = {
//     id: "9f8d2247-a10e-413a-b497-2add3918f991",
//     name: "Musician",
//     rarity: "rare",
//     oracleText: "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\n{T}: Put a music counter on target creature. If it doesn't have \"At the beginning of your upkeep, destroy this creature unless you pay {1} for each music counter on it,\" it gains that ability.",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Wizard"],
//     power: 1,
//     toughness: 3,
// };
// TODO(#628): implement.
// export const mysticMight: CardDefinition = {
//     id: "e35d7f08-0687-41bd-8c53-31a49adabb11",
//     name: "Mystic Might",
//     rarity: "rare",
//     oracleText: "Enchant land you control\nCumulative upkeep {1}{U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nEnchanted land has \"{T}: Target creature gets +2/+2 until end of turn.\"",
//     manaCost: { U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// TODO(#628): implement.
// export const mysticRemora: CardDefinition = {
//     id: "58e93dff-b774-4765-b7bd-d3957e42ff4a",
//     name: "Mystic Remora",
//     rarity: "common",
//     oracleText: "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.",
//     manaCost: { U: 1 },
//     types: ["Enchantment"],
// };
// TODO(#628): implement.
// export const phantasmalMount: CardDefinition = {
//     id: "75afdbe6-a3f9-49cf-b4ef-f370e518e960",
//     name: "Phantasmal Mount",
//     rarity: "uncommon",
//     oracleText: "Flying\n{T}: Target creature you control with toughness 2 or less gets +1/+1 and gains flying until end of turn. When this creature leaves the battlefield this turn, sacrifice that creature. When the creature leaves the battlefield this turn, sacrifice this creature.",
//     manaCost: { X: 1, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Illusion", "Horse"],
//     power: 1,
//     toughness: 1,
// };
// Polar Kraken — {8}{U}{U}{U} 11/11 with trample, enters tapped, and the only
// SACRIFICE-cost cumulative upkeep in the set: "Cumulative upkeep—Sacrifice a
// land." (CR 702.24, ADR 0042). At N age counters the controller sacrifices N
// lands or sacrifices the Kraken.
export const polarKraken: CardDefinition = {
    id: "aee01e9c-0445-4228-a73a-3e5744844ed3",
    name: "Polar Kraken",
    rarity: "rare",
    oracleText:
        "Trample\nThis creature enters tapped.\nCumulative upkeep—Sacrifice a land. (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)",
    manaCost: { X: 8, U: 3 },
    types: ["Creature"],
    subtypes: ["Kraken"],
    power: 11,
    toughness: 11,
    entersTapped: true,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "polar-kraken-cumulative-upkeep",
            cost: { sacrifice: { filter: { types: "Land" }, count: 1 } },
            costLabel: "Sacrifice a land",
        }),
    ],
};
// Portent — {U} Sorcery. "Look at the top three cards of target player's
// library, then put them back in any order. You may have that player shuffle."
// (CR 401.4 look, CR 401 reorder, CR 701.20 shuffle.) Composed from existing
// primitives: `peekLibraryTop(3)` + a `reorder-library` choice over those ids
// (Drafna's Restoration pattern), then an optional may-shuffle, then the
// next-upkeep cantrip rider. Each interactive step is its own `resolveSteps`
// entry so a suspension never re-applies an earlier step.
export const portent: CardDefinition = {
    id: "e040be83-3fb5-4da5-ba7a-4923b8854b74",
    name: "Portent",
    rarity: "common",
    oracleText:
        "Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const t = ctx.targets[0];
            if (t?.type !== "player") return;
            const topIds = ctx.peekLibraryTop(t.id, 3);
            if (topIds.length === 0) return;
            // The controller looks at and reorders the top cards (CR 401.4).
            const ordered = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: `portent-reorder-${ctx.sourceInstanceId}`,
                kind: "reorder-library",
                zone: "library",
                count: topIds.length,
                zoneOwnerId: t.id,
                candidateIds: topIds,
                prompt: "Put these cards back on top in any order (first = top).",
            });
            if (ordered === undefined) return; // suspended on the reorder
            const allIds = ctx.peekLibraryTop(t.id, Number.MAX_SAFE_INTEGER);
            const orderedSet = new Set(ordered);
            const rest = allIds.filter((id) => !orderedSet.has(id));
            ctx.reorderLibraryTop(t.id, [...ordered, ...rest]);
        },
        (ctx: SpellContext) => {
            const t = ctx.targets[0];
            if (t?.type === "player") {
                // "You may have that player shuffle" — a no-cost may decision
                // made by the controller (CR 117.3a may, cost undefined).
                const shuffle = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `portent-shuffle-${ctx.sourceInstanceId}`,
                    prompt: "Have that player shuffle their library (Portent)?",
                });
                if (shuffle === undefined) return; // suspended on the may
                if (shuffle) ctx.shuffleLibrary(t.id);
            }
            scheduleNextUpkeepDraw(ctx, portent.id);
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Power Sink — ICE reprint of the LEA instant. CardPrint onto the LEA
// definition (ADR 0014).
export const powerSinkIce: CardPrint = {
    printId: "85cbec45-81b4-40cc-b356-d6713a6a9b2b",
    definitionId: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9",
    setCode: "ice",
    rarity: "common",
};
// TODO(#628): implement.
// export const rayOfCommand: CardDefinition = {
//     id: "638abe5f-2a8a-42ca-bcdf-a52a3df66946",
//     name: "Ray of Command",
//     rarity: "common",
//     oracleText: "Untap target creature an opponent controls and gain control of it until end of turn. That creature gains haste until end of turn. When you lose control of the creature, tap it.",
//     manaCost: { X: 3, U: 1 },
//     types: ["Instant"],
// };
// Ray of Erasure — {U} Instant. "Target player mills a card" (CR 701.13a mill —
// move the top library card to its owner's graveyard, via `moveCardById` on the
// live top id; Millstone pattern) plus the next-upkeep cantrip rider.
export const rayOfErasure: CardDefinition = {
    id: "5a09fc0b-7b9c-4283-8336-f2607f5ffaf5",
    name: "Ray of Erasure",
    rarity: "common",
    oracleText:
        "Target player mills a card.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "player") {
            const [topId] = ctx.peekLibraryTop(t.id, 1);
            if (topId) ctx.moveCardById(t.id, topId, "library", "graveyard");
        }
        scheduleNextUpkeepDraw(ctx, rayOfErasure.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// TODO(#628): implement.
// export const realityTwist: CardDefinition = {
//     id: "1b7e955c-3de2-430c-93b9-0b39ccea5420",
//     name: "Reality Twist",
//     rarity: "rare",
//     oracleText: "Cumulative upkeep {1}{U}{U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nIf tapped for mana, Plains produce {R}, Swamps produce {G}, Mountains produce {W}, and Forests produce {B} instead of any other type.",
//     manaCost: { U: 3 },
//     types: ["Enchantment"],
// };
// Sea Spirit — {U}: firebreathing self-pump (CR 611.1b temporary +1/+0).
export const seaSpirit: CardDefinition = {
    id: "f2d93d05-98bc-4504-9045-dedb925895ae",
    name: "Sea Spirit",
    rarity: "uncommon",
    oracleText: "{U}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "sea-spirit-pump",
            oracleText: "{U}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Shyft — at the controller's upkeep (CR 603.6a, `phaseTrigger` scope "your"),
// the controller MAY (CR 117.3a, `requestMayPay` cost-less) set Shyft's colour
// via a layer-5 colour override (CR 305.7 / 613.1d — `setColorOverride`). The
// override rides the instance with no duration, so it lasts INDEFINITELY until
// a zone change (CR 612.7) — exactly "this effect lasts indefinitely."
//
// SIMPLIFICATION (flagged, no engine change): the oracle "the color or colors
// of your choice" permits any subset of the five colours (CR 105.2). The
// `requestOptionChoice` primitive is a single pick, so this models the five
// MONO-colour choices (each a one-element override, the common faithful
// reading — the same single-colour pick Jihad/Metamorphosis use). Picking a
// multicolour combination would need a multi-select colour primitive; the
// mono-colour pick covers the tactical use (becoming a colour to dodge a
// "protection from" / colour-hate effect). Full power-set picking lands when a
// multi-colour choice primitive exists.
const SHYFT_COLOR_OPTIONS: { id: Color; label: string }[] = [
    { id: "W", label: "White" },
    { id: "U", label: "Blue" },
    { id: "B", label: "Black" },
    { id: "R", label: "Red" },
    { id: "G", label: "Green" },
];
export const shyft: CardDefinition = {
    id: "99a60c33-b641-42c4-870d-95d07bc975dc",
    name: "Shyft",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, you may have this creature become the color or colors of your choice. (This effect lasts indefinitely.)",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Shapeshifter"],
    power: 4,
    toughness: 2,
    triggeredAbilities: [
        phaseTrigger({
            id: "shyft-upkeep-color",
            oracleText:
                "At the beginning of your upkeep, you may have this creature become the color or colors of your choice. (This effect lasts indefinitely.)",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 117.3a — the "you may" gate.
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: "shyft-may",
                    prompt: "Have Shyft become a color of your choice?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) return;
                // CR 305.7 — the chosen colour (layer 5 override).
                const chosen = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "shyft-color",
                    options: SHYFT_COLOR_OPTIONS,
                    prompt: "Choose Shyft's new color.",
                });
                if (chosen === undefined) return; // suspended
                ctx.setColorOverride(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    [chosen as Color]
                );
            },
        }),
    ],
};
// Sibilant Spirit — 5/6 flier whose attack hands the defending player an
// optional card draw (CR 508.1 attack trigger, CR 117.3a may-draw). The
// defending player is the single opponent in a duel.
export const sibilantSpirit: CardDefinition = {
    id: "47364ad2-5ce9-4b19-a9d2-f6a33188b882",
    name: "Sibilant Spirit",
    rarity: "rare",
    oracleText:
        "Flying\nWhenever this creature attacks, defending player may draw a card.",
    manaCost: { X: 5, U: 1 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 5,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "sibilant-spirit-attack",
            oracleText:
                "Whenever this creature attacks, defending player may draw a card.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                const defender = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!defender) return;
                const accept = ctx.requestMayPay({
                    playerId: defender,
                    choiceId: "sibilant-spirit-draw",
                    prompt: "Draw a card (Sibilant Spirit)?",
                });
                if (accept === undefined) return; // suspended
                if (accept) ctx.drawCards(defender, 1);
            },
        },
    ],
};
// Silver Erne — 2/2 flying + trample keyword creature (CR 702.9, 702.19).
export const silverErne: CardDefinition = {
    id: "685076cc-098c-4f98-918c-0ad825eda10f",
    name: "Silver Erne",
    rarity: "uncommon",
    oracleText: "Flying, trample",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "trample"],
};
// Sleight of Mind — ICE reprint of the LEA instant (colour-word text change,
// CR 612). CardPrint onto the LEA definition (ADR 0014).
export const sleightOfMindIce: CardPrint = {
    printId: "93dc9f02-11ad-4c4a-8199-9d20c23d31a7",
    definitionId: "d427790c-e322-446e-8d7d-a6b48ad41a42",
    setCode: "ice",
    rarity: "common",
};
// Snow Devil — Aura granting flying to the host (CR 611 keyword-grant). Same
// shape as LEA's Flight.
//
// SIMPLIFICATION (flagged, no engine change): the conditional "first strike as
// long as it's blocking and you control a snow land" clause is a no-op in the
// current pool — snow lands belong to a later snow cluster, so the snow-land
// condition is never met. Only the unconditional flying grant is modelled; the
// first-strike clause ships dead until snow lands exist (same treatment as
// Hallowed Ground's nonsnow restriction).
export const snowDevil: CardDefinition = {
    id: "2be3a9a5-2ac5-4ea4-915d-8cff35c0e72f",
    name: "Snow Devil",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature has flying.\nEnchanted creature has first strike as long as it's blocking and you control a snow land.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
};
// Snowfall — {2}{U} Enchantment with cumulative upkeep {U} (CR 702.24, ADR 0042)
// plus a CU-mana engine: "Whenever an Island is tapped for mana, its controller
// may add an additional {U}. … Spend this mana only to pay cumulative upkeep
// costs." (CR 605 mana-tap trigger via `tappedTrigger({ forMana: true })`, CR
// 106.6 restricted mana — ADR 0022.) The bonus {U} lands in the Island
// controller's CU-restricted pool, feeding Snowfall's own upkeep (and any other
// CU permanent). The added mana is auto-applied — it's strictly beneficial
// restricted mana, so the "may" carries no real downside (ADR 0003 auto-resolve).
//
// CR 205.4a — "If that Island is snow, add {U}{U} instead": now that the snow-
// covered basics ship (#661), a tapped snow Island doubles the bonus. The
// tapped view carries no supertype, so the resolve resolves the tapped land's
// live snow status by id via the snow-aware battlefield filter.
export const snowfall: CardDefinition = {
    id: "788ed793-3993-4a63-b9f9-9ac3947c3108",
    name: "Snowfall",
    rarity: "common",
    oracleText:
        "Cumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an Island is tapped for mana, its controller may add an additional {U}. If that Island is snow, its controller may add an additional {U}{U} instead. Spend this mana only to pay cumulative upkeep costs.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "snowfall-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
        tappedTrigger({
            id: "snowfall-island-mana",
            oracleText:
                "Whenever an Island is tapped for mana, its controller may add an additional {U}. Spend this mana only to pay cumulative upkeep costs.",
            scope: "any",
            filter: { subtypes: "Island" },
            forMana: true,
            resolve: (ctx, _event, tapped) => {
                // CR 106.6 — the Island controller gets the bonus {U} in their
                // CU-restricted pool (ADR 0022). CR 205.4a — if the tapped
                // Island is SNOW, the bonus is {U}{U} instead (now that snow
                // Islands ship, #661). The tapped view carries no supertype, so
                // resolve the live snow status by id via the snow-aware
                // battlefield filter.
                const isSnowIsland = ctx
                    .getBattlefieldIds(tapped.controllerId, {
                        types: "Land",
                        supertypes: ["Snow"],
                        instanceIds: [tapped.id],
                    })
                    .includes(tapped.id);
                ctx.addRestrictedMana(
                    tapped.controllerId,
                    { U: isSnowIsland ? 2 : 1 },
                    "cumulative-upkeep"
                );
            },
        }),
    ],
};
// TODO(#628): implement.
// export const soldeviMachinist: CardDefinition = {
//     id: "1f0999df-2f94-499e-b9af-fe377d515400",
//     name: "Soldevi Machinist",
//     rarity: "uncommon",
//     oracleText: "{T}: Add {C}{C}. Spend this mana only to activate abilities of artifacts.",
//     manaCost: { X: 1, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Wizard", "Artificer"],
//     power: 1,
//     toughness: 1,
// };
// Soul Barrier — punisher enchantment: whenever an opponent casts a creature
// spell, it deals 2 to that player unless they pay {2} (CR 603.2 cast trigger,
// CR 117.3a may-pay, CR 120.1 damage).
export const soulBarrier: CardDefinition = {
    id: "9ad7fac7-db4d-45b2-aba6-16f4fd1a586f",
    name: "Soul Barrier",
    rarity: "uncommon",
    oracleText:
        "Whenever an opponent casts a creature spell, this enchantment deals 2 damage to that player unless they pay {2}.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "soul-barrier-tax",
            oracleText:
                "Whenever an opponent casts a creature spell, this enchantment deals 2 damage to that player unless they pay {2}.",
            scope: "opponents",
            filter: { types: "Creature" },
            resolve: (ctx, _event, spell) => {
                const caster = spell.casterId;
                const accept = ctx.requestMayPay({
                    playerId: caster,
                    choiceId: caster,
                    cost: { X: 2 },
                    prompt: "Pay {2} or take 2 damage from Soul Barrier?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.dealDamage({ type: "player", id: caster }, 2);
                }
            },
        }),
    ],
};
// Thunder Wall — 0/2 flying Wall with Defender and a {U} self-pump
// (CR 702.3, 702.9, 611.1b).
export const thunderWall: CardDefinition = {
    id: "4fc5d510-c4f7-4a09-bf86-83c3fa3f8928",
    name: "Thunder Wall",
    rarity: "uncommon",
    oracleText:
        "Defender\nFlying\n{U}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 2,
    staticAbilities: ["defender", "flying"],
    activatedAbilities: [
        {
            id: "thunder-wall-pump",
            oracleText: "{U}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Updraft — {1}{U} Instant. "Target creature gains flying until end of turn"
// (CR 702.9 keyword grant via layer 6) plus the next-upkeep cantrip rider.
export const updraft: CardDefinition = {
    id: "d1bd4e16-27fe-4c7b-ae25-78ed77d8e8e7",
    name: "Updraft",
    rarity: "uncommon",
    oracleText:
        "Target creature gains flying until end of turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") {
            ctx.grantStaticAbility(t, "flying", { phase: "end-of-turn" });
        }
        scheduleNextUpkeepDraw(ctx, updraft.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Wind Spirit — 3/2 flying + menace keyword creature (CR 702.9, 702.111).
export const windSpirit: CardDefinition = {
    id: "4d882447-9594-4aab-b1a7-8bb275f250cf",
    name: "Wind Spirit",
    rarity: "uncommon",
    oracleText: "Flying\nMenace",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 3,
    toughness: 2,
    staticAbilities: ["flying", "menace"],
};
// DEFERRED (non-snow primitives). The snow read ("X can't be greater than the
// number of snow lands you control") is now available via `countSnowLands`, but
// Winter's Chill still needs two engine primitives outside the snow scope:
//   (1) a chosen-X UPPER-BOUND validator keyed to a board count (CR 107.3) —
//       the engine resolves X-target counts but has no "X ≤ snow lands you
//       control" cap hook at cast announcement; and
//   (2) a per-target THREE-WAY may-pay ({1} / {2} / decline) whose outcomes are
//       a delayed "destroy at end of combat" (decline) and a per-creature
//       "prevent all combat damage to AND by that creature this combat" (pay
//       {1}) — `requestMayPay` offers a single cost, not a {1}-or-{2} fork with
//       distinct delayed effects per branch.
// Both are general primitives unrelated to Snow; flagged for a follow-up.
// export const wintersChill: CardDefinition = {
//     id: "a779aca7-ff2c-48d8-9484-6ad04b2c6bcb",
//     name: "Winter's Chill",
//     rarity: "rare",
//     oracleText: "Cast this spell only during combat before blockers are declared.\nX can't be greater than the number of snow lands you control.\nChoose X target attacking creatures. For each of those creatures, its controller may pay {1} or {2}. If that player doesn't, destroy that creature at end of combat. If that player pays only {1}, prevent all combat damage that would be dealt to and dealt by that creature this combat.",
//     manaCost: { X: "X", U: 1 },
//     types: ["Instant"],
// };
// Word of Undoing — "Return target creature and all white Auras you own
// attached to it to their owners' hands." (CR 701.14 return to hand.) Before
// bouncing the creature (which would otherwise drop its Auras to the
// graveyard), the caster's white Auras attached to that creature are returned
// to hand: scan the caster's white Auras and match each host id to the target.
export const wordOfUndoing: CardDefinition = {
    id: "22b04476-5a5d-4843-a948-82db209c4218",
    name: "Word of Undoing",
    rarity: "common",
    oracleText:
        "Return target creature and all white Auras you own attached to it to their owners' hands.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        // Return the caster's white Auras attached to the target first.
        const whiteAuras = ctx.getBattlefieldIds(ctx.controller, {
            types: "Enchantment",
            subtypes: "Aura",
            colors: ["W"],
        });
        for (const auraId of whiteAuras) {
            if (ctx.getAttachedTo(auraId) === t.id) {
                ctx.returnToHand({ type: "permanent", id: auraId });
            }
        }
        ctx.returnToHand(t);
    },
};
// Wrath of Marit Lage — ETB taps every red creature (CR 603.6b enters trigger,
// CR 701.20a tap) and a static untap-lock on red creatures (CR 611 — the
// Meekstone pattern with a colour filter).
export const wrathOfMaritLage: CardDefinition = {
    id: "1d512f5c-0327-4d49-8a26-672574a49102",
    name: "Wrath of Marit Lage",
    rarity: "rare",
    oracleText:
        "When this enchantment enters, tap all red creatures.\nRed creatures don't untap during their controllers' untap steps.",
    manaCost: { X: 3, U: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "wrath-marit-lage-red-lock",
            oracleText:
                "Red creatures don't untap during their controllers' untap steps (Wrath of Marit Lage).",
            filter: { types: "Creature", colors: "R" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "wrath-marit-lage-tap-red",
            oracleText: "When this enchantment enters, tap all red creatures.",
            scope: "self",
            resolve: (ctx) => {
                for (const pid of ctx.allPlayerIds) {
                    const reds = ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                        colors: ["R"],
                    });
                    for (const id of reds) {
                        ctx.tap({ type: "permanent", id });
                    }
                }
            },
        }),
    ],
};
// TODO(#628): implement.
// export const zursWeirding: CardDefinition = {
//     id: "e1f8531f-19ca-48a2-baf2-c5dc6f18d79c",
//     name: "Zur's Weirding",
//     rarity: "rare",
//     oracleText: "Players play with their hands revealed.\nIf a player would draw a card, they reveal it instead. Then any other player may pay 2 life. If a player does, put that card into its owner's graveyard. Otherwise, that player draws a card.",
//     manaCost: { X: 3, U: 1 },
//     types: ["Enchantment"],
// };
// Zuran Enchanter — "{2}{B}, {T}: Target player discards a card. Activate only
// during your turn." (CR 605 activated ability, CR 701.8 discard chosen by the
// targeted player, CR 602.5b "only during your turn" via `controllerTurnOnly`.)
// The discarding player picks via a `discard-hand` requestChoice scoped to their
// own hand (Abyssal Specter pattern). Cast cost is {1}{U} (a blue creature whose
// black-flavored discard ability costs {2}{B}); verified against Scryfall.
export const zuranEnchanter: CardDefinition = {
    id: "721edcef-f40a-4d43-9d80-26161dc425cb",
    name: "Zuran Enchanter",
    rarity: "common",
    oracleText:
        "{2}{B}, {T}: Target player discards a card. Activate only during your turn.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "zuran-enchanter-discard",
            oracleText:
                "{2}{B}, {T}: Target player discards a card. Activate only during your turn.",
            cost: { mana: { X: 2, B: 1 }, tap: true },
            useStack: true,
            controllerTurnOnly: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "player") return;
                if (ctx.getHandSize(target.id) === 0) return;
                const picks = ctx.requestChoice({
                    playerId: target.id,
                    choiceId: `zuran-enchanter-${ctx.sourceInstanceId}-${target.id}`,
                    kind: "discard-hand",
                    zone: "hand",
                    count: 1,
                    prompt: "Zuran Enchanter: discard a card.",
                });
                if (picks === undefined) return;
                for (const id of picks) ctx.discardCard(target.id, id);
            },
        },
    ],
};
// Zuran Spellcaster — {T}: deal 1 damage to any target (CR 605 activated
// ability, CR 120.1 damage). The Prodigal Sorcerer "Tim" shape.
export const zuranSpellcaster: CardDefinition = {
    id: "152a72b1-a7b7-4e5c-8558-fab97465f549",
    name: "Zuran Spellcaster",
    rarity: "common",
    oracleText: "{T}: This creature deals 1 damage to any target.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "zuran-spellcaster-zap",
            oracleText: "{T}: This creature deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 1);
            },
        },
    ],
};
// ─────────────────────────────────────────────────────────────────────────────
// Black free tranche (#632)
//
// The free-tranche Black cards — expressible entirely with already-shipped
// primitives — are activated below (intermixed with the remaining commented
// stubs). Reprints already implemented in earlier sets (Dark Ritual, Fear,
// Howl from Beyond) are CardPrints onto their existing LEA definitions
// (ADR 0014); new-to-ICE Black cards are full CardDefinitions.
//
// BLACK BUILDABLE-NOW COMPLETION (#655): the Black tranche under-delivered, and
// several "needs primitive" stubs were STALE — the primitives had since shipped.
// Now ACTIVE from shipped primitives only (no new SpellContext primitive):
//   • Lim-Dûl's Cohort — BLOCKERS_CONFIRMED + `setTargetCantBeRegeneratedThisTurn`
//     (the stale stub claimed only `destroy(cantBeRegenerated)` existed).
//   • Soul Kiss — hard per-turn activation cap via `canActivate` reading the
//     per-turn tally (the stale stub claimed `maxActivationsPerTurn` was needed).
//   • Lim-Dûl's Hex, Mind Whip — recurring pay-or-damage upkeep (host-controller
//     phaseTrigger + requestMayPay; "{B} or {3}" composed from two may-pays).
//   • Minion of Leshrac, Infernal Denizen, Norritt — sac-or-penalty upkeep,
//     conditional `gainControl` (Aladdin pattern), and force-attack
//     (`setMustAttackThisTurn`, Nettling Imp pattern).
//   • Dance of the Dead — graveyard-reanimation aura (Animate Dead + Paralyze
//     patterns: reanimate, +1/+1, does-not-untap + pay-to-untap, LTB sacrifice).
//   • Krovikan Elementalist, Leshrac's Sigil, Zuran Enchanter — pump / sac-at-
//     end-step, green-spell-cast discard trigger, target-player discard.
//   • Flow of Maggots — cumulative upkeep {1} (ADR 0042 template) + Walls-only
//     block restriction.
//
// STILL DEFERRED (remain commented stubs, owned by a later cluster):
//   • Cumulative upkeep — Infernal Darkness (mana-color-replacement clause).
//   • "Draw a card at the beginning of the next turn's upkeep" delayed cantrips —
//     Gravebind, Krovikan Fetish, Mind Ravel, Touch of Death: ACTIVE (#660 —
//     the `next-upkeep` delayed-trigger timing shipped).
//   • Snow-land-counting effects — Drift of the Dead (P/T = snow lands),
//     Gangrenous Zombies, Icequake, Withering Wisps; snow swampwalk
//     (Legions of Lim-Dûl) (no supertype filter / snow-evasion keyword yet —
//     snow cluster).
//   • CARD_DISCARDED trigger — Necropotence's "whenever you discard a card,
//     exile it from your graveyard" needs a discard event + discardTrigger
//     factory the engine doesn't emit yet (skip-draw + pay-life-exile clauses
//     are supported, but shipping a partial Necropotence is out — flagged).
//   • "Spend only black/red mana on X" + black-mana-spent lifegain cap —
//     Soul Burn (no mana-colour-spent tracking primitive).
//   • Ashen Ghoul — graveyard-SOURCE activated ability (the engine only resolves
//     activated abilities whose source is on the battlefield; the
//     "creatures-above-in-graveyard" test itself ships, but activate-from-
//     graveyard does not).
//   • Dread Wight — paralyzation counters (counter-gated untap lock + a granted
//     "{4}: remove a counter" activated ability on other creatures).
//   • Cloak of Confusion / Gaze of Pain (assign-no-combat-damage redirect — the
//     mark ships, but the "if you do, defender discards" combat-replacement
//     rider does not), Hecatomb / Stench of Evil (tap-Swamp / pay-per-land),
//     Seizures (becomes-tapped pay-or-damage on the host's controller),
//     Oath of Lim-Dûl (lose-life trigger), Pox (fractional sacrifice). Each
//     needs a primitive not yet built; flagged for its capability cluster.
// ─────────────────────────────────────────────────────────────────────────────

// Abyssal Specter — flying 2/3; "Whenever this creature deals damage to a
// player, that player discards a card." (CR 702.9 flying, CR 120.3 / 603.4
// damage trigger, CR 701.8 discard.) The damaged player chooses which card to
// discard (modern oracle — not at random), modelled with a `discard-hand`
// requestChoice scoped to the damaged player's hand.
export const abyssalSpecter: CardDefinition = {
    id: "fc26f19c-bcf7-4bd8-af42-4757dbe47fb1",
    name: "Abyssal Specter",
    rarity: "uncommon",
    oracleText:
        "Flying\nWhenever this creature deals damage to a player, that player discards a card.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Specter"],
    power: 2,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        damageDealtTrigger({
            id: "abyssal-specter-discard",
            oracleText:
                "Whenever this creature deals damage to a player, that player discards a card.",
            source: "self",
            target: { kind: "player", player: { relation: "any" } },
            resolve: (ctx, _event, damage) => {
                if (damage.target.type !== "player") return;
                const pid = damage.target.id;
                if (ctx.getHandSize(pid) === 0) return;
                const picks = ctx.requestChoice({
                    playerId: pid,
                    choiceId: `abyssal-specter-${ctx.sourceInstanceId}-${pid}`,
                    kind: "discard-hand",
                    zone: "hand",
                    count: 1,
                    prompt: "Abyssal Specter: discard a card.",
                });
                if (picks === undefined) return; // suspended for the choice
                for (const id of picks) ctx.discardCard(pid, id);
            },
        }),
    ],
};
// DEFERRED (#655) — Ashen Ghoul's "{B}: Return this card from your graveyard to
// the battlefield" is an ACTIVATED ability whose SOURCE is in the graveyard. The
// "three or more creature cards above it" test is already shipped (the
// `creatureCardsAboveInGraveyard` graveyard-order helper, used by Nether Shadow),
// but the activation entry point (`activateAbility` in convex/game.ts) only
// resolves a source on the BATTLEFIELD — there is no activate-from-graveyard
// machinery for activated abilities. Nether Shadow gets the same recursion via a
// graveyard-zone *triggered* ability (phaseTrigger `zone: "graveyard"`); Ashen
// Ghoul is a player-chosen *activated* ability and cannot be expressed as a
// trigger faithfully. Defer until graveyard-source activation lands.
// export const ashenGhoul: CardDefinition = {
//     id: "6bb83301-5662-4628-b536-6a3ee0296f2e",
//     name: "Ashen Ghoul",
//     rarity: "uncommon",
//     oracleText: "Haste\n{B}: Return this card from your graveyard to the battlefield. Activate only during your upkeep and only if three or more creature cards are above this card.",
//     manaCost: { X: 3, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Zombie"],
//     power: 3,
//     toughness: 1,
// };
// Brine Shaman — sacrifice-a-creature engine (CR 602.1 / 118.5 sacrifice cost).
// "{T}, Sacrifice a creature: Target creature gets +2/+2 until end of turn."
// and "{1}{U}{U}, Sacrifice a creature: Counter target creature spell."
// (CR 611.1b temporary buff; CR 701.5 counter.) The sacrifice cost uses
// `sacrificeFilter` (a Creature the activator controls).
export const brineShaman: CardDefinition = {
    id: "f445962c-44a1-4f3f-88d4-17048f8ca9dc",
    name: "Brine Shaman",
    rarity: "common",
    oracleText:
        "{T}, Sacrifice a creature: Target creature gets +2/+2 until end of turn.\n{1}{U}{U}, Sacrifice a creature: Counter target creature spell.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Shaman"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "brine-shaman-pump",
            oracleText:
                "{T}, Sacrifice a creature: Target creature gets +2/+2 until end of turn.",
            cost: { tap: true, sacrificeFilter: { types: "Creature" } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 2, 2, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
        {
            id: "brine-shaman-counter",
            oracleText:
                "{1}{U}{U}, Sacrifice a creature: Counter target creature spell.",
            cost: {
                mana: { X: 1, U: 2 },
                sacrificeFilter: { types: "Creature" },
            },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                spellTypeFilter: "Creature",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "spell") ctx.counter(target);
            },
        },
    ],
};
// TODO(#628): implement.
// export const burntOffering: CardDefinition = {
//     id: "1dae52a2-3af7-4b97-9d2e-2448b7c413fb",
//     name: "Burnt Offering",
//     rarity: "common",
//     oracleText: "As an additional cost to cast this spell, sacrifice a creature.\nAdd X mana in any combination of {B} and/or {R}, where X is the sacrificed creature's mana value.",
//     manaCost: { B: 1 },
//     types: ["Instant"],
// };
// TODO(#628): implement.
// export const cloakOfConfusion: CardDefinition = {
//     id: "dc45d103-0fca-4431-a5c0-869f0f9be93e",
//     name: "Cloak of Confusion",
//     rarity: "common",
//     oracleText: "Enchant creature you control\nWhenever enchanted creature attacks and isn't blocked, you may have it assign no combat damage this turn. If you do, defending player discards a card at random.",
//     manaCost: { X: 1, B: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Dance of the Dead — graveyard-reanimation Aura (CR 303.4i, the Animate Dead
// family). Composes shipped primitives:
//   - targetRequirement zone:"graveyard" → caster picks a Creature card in any
//     graveyard at cast; the aura branch in finalizeSpellResolution reanimates
//     the host under the caster and attaches this Aura (same plumbing as Animate
//     Dead). The reanimated creature enters tapped via the resolve() tap below.
//   - staticEffect pt-buff +1/+1 (layer 7c) and a `does-not-untap` keyword-grant,
//     both via AURA_AFFECTS_HOST (Paralyze pattern, CR 611).
//   - phaseTrigger scope:"host-controller" — the host's controller may pay {1}{B}
//     each upkeep to untap the creature (CR 603.6a, 117.3a).
//   - leftTrigger (self) — when this Aura leaves, the host's controller
//     sacrifices it (CR 603.10 last-known-info), identical to Animate Dead.
// SIMPLIFICATION (flagged, no engine change): the printed "loses 'enchant
// creature card in a graveyard' and gains 'enchant creature put onto the
// battlefield with this Aura'" self-text-change is a no-op in practice — it only
// re-scopes the attachment target after reanimation, which the engine already
// handles by attaching to the reanimated permanent. The observable behavior
// (reanimate tapped, +1/+1, untap-lock with pay-to-untap, sacrifice on leave) is
// faithful.
export const danceOfTheDead: CardDefinition = {
    id: "e7c53ba4-9956-4cd6-85ca-2d6b61a5127c",
    name: "Dance of the Dead",
    rarity: "uncommon",
    oracleText:
        "Enchant creature card in a graveyard\nWhen this Aura enters, if it's on the battlefield, it loses \"enchant creature card in a graveyard\" and gains \"enchant creature put onto the battlefield with this Aura.\" Put enchanted creature card onto the battlefield tapped under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature's controller sacrifices it.\nEnchanted creature gets +1/+1 and doesn't untap during its controller's untap step.\nAt the beginning of the upkeep of enchanted creature's controller, that player may pay {1}{B}. If the player does, untap that creature.",
    manaCost: { X: 1, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "any",
    },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 1,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "does-not-untap",
        },
    ],
    // CR 303.4 — the reanimated host enters tapped. The aura's resolve() runs
    // before finalizeSpellResolution moves the host onto the battlefield, so we
    // schedule the tap as a one-step body after attachment via a self-ETB
    // trigger instead. (Paralyze taps the EXISTING host in resolve(); here the
    // host doesn't exist on the battlefield yet, so we tap on enter.)
    triggeredAbilities: [
        enteredTrigger({
            id: "dance-of-the-dead-enter-tapped",
            oracleText:
                "Put enchanted creature card onto the battlefield tapped under your control.",
            scope: "self",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (hostId) ctx.tap({ type: "permanent", id: hostId });
            },
        }),
        phaseTrigger({
            id: "dance-of-the-dead-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, that player may pay {1}{B}. If the player does, untap that creature.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                const accept = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: hostController,
                    cost: { X: 1, B: 1 },
                    prompt: "Pay {1}{B} to untap the creature Dance of the Dead enchants?",
                });
                if (accept === undefined) return;
                if (accept) ctx.untap({ type: "permanent", id: hostId });
            },
        }),
        leftTrigger({
            id: "dance-of-the-dead-ltb",
            oracleText:
                "When this Aura leaves the battlefield, that creature's controller sacrifices it.",
            scope: "self",
            resolve: (ctx, _event, leaving) => {
                const hostId = leaving.attachedToBeforeLeave;
                if (hostId) ctx.sacrifice(hostId);
            },
        }),
    ],
};
// Dark Banishing — "Destroy target nonblack creature. It can't be regenerated."
// (CR 701.7 destroy, CR 701.15 regeneration suppression, CR 202.2 colour
// restriction.) The colour gate is enforced at target selection via the
// `excludeColors` TargetRequirement filter.
export const darkBanishing: CardDefinition = {
    id: "f7dc2716-ed62-4797-ad2b-227eca5408d0",
    name: "Dark Banishing",
    rarity: "common",
    oracleText: "Destroy target nonblack creature. It can't be regenerated.",
    manaCost: { X: 2, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, excludeColors: "B" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target) ctx.destroy(target, { cantBeRegenerated: true });
    },
};
// Dark Ritual — ICE reprint of the LEA original (ADR 0014). Mechanics live on
// the existing LEA definition; this is a CardPrint binding the ICE print id.
export const darkRitualIce: CardPrint = {
    printId: "4ebcd681-1871-4914-bcd7-6bd95829f6e0",
    definitionId: "ebb6664d-23ca-456e-9916-afcd6f26aa7f",
    setCode: "ice",
    rarity: "common",
};
// Demonic Consultation — "Choose a card name. Exile the top six cards of your
// library, then reveal cards from the top of your library until you reveal a
// card with the chosen name. Put that card into your hand and exile all other
// cards revealed this way." (CR 202.3 name-a-card via `requestNameCard`;
// CR 701.13 reveal; CR 406 exile.) Composition of shipped primitives: name →
// `peekLibraryTop` to read the top in order → `moveCardById` library→exile for
// the first six → continue revealing one at a time, exiling each until one
// matches the named card (then hand). Empty-library mid-loop is a silent stop
// (CR 608.2b).
export const demonicConsultation: CardDefinition = {
    id: "8d727b9b-6114-414d-9172-16b6e1db41cc",
    name: "Demonic Consultation",
    rarity: "uncommon",
    oracleText:
        "Choose a card name. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name. Put that card into your hand and exile all other cards revealed this way.",
    manaCost: { B: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        const me = ctx.controller;
        const named = ctx.requestNameCard({
            playerId: me,
            choiceId: "demonic-consultation-name",
            prompt: "Name a card.",
        });
        if (named === undefined) return; // suspended on the name choice
        // Read the whole library top-down so exiles operate on stable ids.
        const lib = ctx.peekLibraryTop(me, Number.MAX_SAFE_INTEGER);
        // Exile the top six.
        const firstSix = lib.slice(0, 6);
        for (const id of firstSix) ctx.moveCardById(me, id, "library", "exile");
        // Reveal from the new top until the named card (or library runs out).
        for (let i = 6; i < lib.length; i++) {
            const id = lib[i];
            ctx.markKnownToAll(me, [id]);
            const cardName = ctx.getCardName(id);
            if (cardName === named) {
                ctx.moveCardById(me, id, "library", "hand");
                return;
            }
            ctx.moveCardById(me, id, "library", "exile");
        }
    },
};
// DEFERRED (#655) — Dread Wight needs the paralyzation-counter machinery, which
// is NOT shipped. The card requires three coupled pieces the engine lacks: (1) a
// per-permanent untap lock CONDITIONED on a counter ("doesn't untap … for as
// long as it has a paralyzation counter on it") — the shipped `does-not-untap`
// keyword is unconditional and not counter-gated; (2) a granted activated
// ability "{4}: Remove a paralyzation counter from this creature" placed on
// OTHER creatures (ability-grant of an activated ability that mutates the
// grantee's own counters); (3) the end-of-combat application to every creature
// blocking/blocked-by it. None of (1)-(3) is expressible from shipped primitives
// without new engine support. Defer until counter-gated untap locks land.
// export const dreadWight: CardDefinition = {
//     id: "65d332e2-4b2d-4131-84f7-862cb138c477",
//     name: "Dread Wight",
//     rarity: "rare",
//     oracleText: "At end of combat, put a paralyzation counter on each creature blocking or blocked by this creature and tap those creatures. Each of those creatures doesn't untap during its controller's untap step for as long as it has a paralyzation counter on it. Each of those creatures gains \"{4}: Remove a paralyzation counter from this creature.\"",
//     manaCost: { X: 3, B: 2 },
//     types: ["Creature"],
//     subtypes: ["Zombie"],
//     power: 3,
//     toughness: 4,
// };
// Drift of the Dead — Defender Wall whose P/T is a characteristic-defining
// ability (CR 604.3, layer 7b) equal to the number of SNOW lands its controller
// controls (CR 205.4a). Base 0/0; the `pt-cda` counts live snow lands via
// `ctx.hasSupertype` (Melting / Arcum's Weathervane honored). Mirrors
// Nightmare's Swamp-count CDA.
export const driftOfTheDead: CardDefinition = {
    id: "d8b65656-9f8c-4179-81aa-4b15d8280baa",
    name: "Drift of the Dead",
    rarity: "uncommon",
    oracleText:
        "Defender (This creature can't attack.)\nDrift of the Dead's power and toughness are each equal to the number of snow lands you control.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 0,
    staticAbilities: ["defender"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state, ctx) => {
                let snow = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.types.includes("Land") &&
                            ctx.hasSupertype(p, "Snow")
                        ) {
                            snow++;
                        }
                    }
                }
                return { power: snow, toughness: snow };
            },
        },
    ],
};
// Fear — ICE reprint of the LEA original (ADR 0014). The fear-granting Aura
// mechanics live on the existing LEA definition; this is a CardPrint.
export const fearIce: CardPrint = {
    printId: "5709398f-0744-4780-a1d2-eead96c8f348",
    definitionId: "0cd927be-e63f-4371-a1d8-7a0489cb187e",
    setCode: "ice",
    rarity: "common",
};
// Flow of Maggots — "Cumulative upkeep {1}. This creature can't be blocked by
// non-Wall creatures." (CR 702.24 cumulative upkeep via the shipped
// `cumulativeUpkeepTrigger` template + CR 509.1b block-restriction.) The block
// clause is a `block-restriction` static on the attacker side: a blocker
// qualifies only if it is a Wall. CU core has shipped (ADR 0042), so this is
// buildable today.
export const flowOfMaggots: CardDefinition = {
    id: "6880a4d3-5cbc-4a01-9190-3565617efcc9",
    name: "Flow of Maggots",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nThis creature can't be blocked by non-Wall creatures.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "flow-of-maggots-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
    staticEffects: [
        {
            kind: "block-restriction",
            id: "flow-of-maggots-walls-only",
            side: "attacker" as const,
            // CR 509.1b — can't be blocked by non-Wall creatures (only Walls
            // may block it).
            predicate: (_self, opponent) => opponent.subtypes.includes("Wall"),
            oracleText:
                "Flow of Maggots can't be blocked by non-Wall creatures.",
        },
    ],
};
// Foul Familiar — 3/1 that can't block (CR 509.1b block-restriction, ADR 0006)
// with a "{B}, Pay 1 life: Return this creature to its owner's hand." dodge
// (CR 118.4 life cost, CR 701.14 move-to-hand).
export const foulFamiliar: CardDefinition = {
    id: "8bad3541-8e40-4a2f-ac9d-f7b61f3d75a1",
    name: "Foul Familiar",
    rarity: "common",
    oracleText:
        "This creature can't block.\n{B}, Pay 1 life: Return this creature to its owner's hand.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 3,
    toughness: 1,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "foul-familiar-cant-block",
            side: "blocker",
            predicate: () => false,
            oracleText: "Foul Familiar can't block.",
        },
    ],
    activatedAbilities: [
        {
            id: "foul-familiar-bounce",
            oracleText:
                "{B}, Pay 1 life: Return this creature to its owner's hand.",
            cost: { mana: { B: 1 }, life: 1 },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.returnToHand({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// Gangrenous Zombies — {T}, Sacrifice this creature: deal 1 (or 2 if you
// control a snow Swamp — CR 205.4a) damage to each creature and each player
// (`dealDamageToEach`). The sacrifice is a COST, so the snow-Swamp check reads
// the controller's battlefield at resolution via `controlsSnowSubtype` (live
// snow status). The dealing source is gone by resolve, so the damage is dealt
// without a source-creature reference — `dealDamageToEach` handles this.
export const gangrenousZombies: CardDefinition = {
    id: "08be4d83-99be-4360-90f1-104dee1c3c2f",
    name: "Gangrenous Zombies",
    rarity: "common",
    oracleText:
        "{T}, Sacrifice this creature: This creature deals 1 damage to each creature and each player. If you control a snow Swamp, this creature deals 2 damage to each creature and each player instead.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "gangrenous-zombies-blast",
            oracleText:
                "{T}, Sacrifice this creature: This creature deals 1 damage to each creature and each player. If you control a snow Swamp, this creature deals 2 damage to each creature and each player instead.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 205.4a — "a snow Swamp": a Land with the Swamp subtype and
                // the live Snow supertype. `getBattlefieldIds` resolves the
                // supertype filter against live snow status.
                const snowSwamp =
                    ctx.getBattlefieldIds(ctx.controller, {
                        types: "Land",
                        subtypes: "Swamp",
                        supertypes: ["Snow"],
                    }).length > 0;
                const amount = snowSwamp ? 2 : 1;
                ctx.dealDamageToEach(amount, {
                    creatures: true,
                    players: true,
                });
            },
        },
    ],
};
// TODO(#628): implement.
// export const gazeOfPain: CardDefinition = {
//     id: "48401643-ec4b-444a-8f9a-1a5ea471ff4a",
//     name: "Gaze of Pain",
//     rarity: "common",
//     oracleText: "Until end of turn, whenever a creature you control attacks and isn't blocked, you may choose to have it deal damage equal to its power to a target creature. If you do, it assigns no combat damage this turn.",
//     manaCost: { X: 1, B: 1 },
//     types: ["Sorcery"],
// };
// Gravebind — {B} Instant. "Target creature can't be regenerated this turn"
// (CR 701.15c regeneration lock, via `setTargetCantBeRegeneratedThisTurn`) plus
// the next-upkeep cantrip rider.
export const gravebind: CardDefinition = {
    id: "4782fd4f-2474-4d0d-8301-e0b52af93746",
    name: "Gravebind",
    rarity: "rare",
    oracleText:
        "Target creature can't be regenerated this turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") {
            ctx.setTargetCantBeRegeneratedThisTurn(t);
        }
        scheduleNextUpkeepDraw(ctx, gravebind.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// TODO(#628): implement.
// export const hecatomb: CardDefinition = {
//     id: "8f59620f-ff9e-44d8-9c4e-be9de1a919e8",
//     name: "Hecatomb",
//     rarity: "rare",
//     oracleText: "When this enchantment enters, sacrifice this enchantment unless you sacrifice four creatures.\nTap an untapped Swamp you control: This enchantment deals 1 damage to any target.",
//     manaCost: { X: 1, B: 2 },
//     types: ["Enchantment"],
// };
// Hoar Shade — classic Shade pump (CR 611.1b). "{B}: This creature gets +1/+1
// until end of turn."
export const hoarShade: CardDefinition = {
    id: "72242dff-15ca-4da0-b3ae-9984d037b31f",
    name: "Hoar Shade",
    rarity: "common",
    oracleText: "{B}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Shade"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "hoar-shade-pump",
            oracleText: "{B}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { B: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Howl from Beyond — ICE reprint of the LEA original (ADR 0014). The +X/+0
// pump mechanics live on the existing LEA definition; this is a CardPrint.
export const howlFromBeyondIce: CardPrint = {
    printId: "ca9d0d6b-056e-4b94-8de5-a325768f67b6",
    definitionId: "67ec17e1-174b-4d07-a27f-91a333c4b2fb",
    setCode: "ice",
    rarity: "common",
};
// Hyalopterous Lemure — "{0}: This creature gets -1/-0 and gains flying until
// end of turn." (CR 611.1b negative pump + CR 702.9 flying grant.) Pay {0} to
// trade power for evasion.
export const hyalopterousLemure: CardDefinition = {
    id: "d2c9e037-f4d5-46fd-b439-56bee6fb2ad3",
    name: "Hyalopterous Lemure",
    rarity: "uncommon",
    oracleText:
        "{0}: This creature gets -1/-0 and gains flying until end of turn.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 4,
    toughness: 3,
    activatedAbilities: [
        {
            id: "hyalopterous-lemure-fly",
            oracleText:
                "{0}: This creature gets -1/-0 and gains flying until end of turn.",
            cost: { mana: { X: 0 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.addTemporaryPTBuff(self, -1, 0, { phase: "end-of-turn" });
                ctx.grantStaticAbility(self, "flying", {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};
// Icequake — destroy target land; if that land WAS a snow land (CR 205.4a),
// deal 1 damage to its controller. The snow status and controller are captured
// BEFORE the destroy (CR 608.2g — last-known information): the target is
// matched against its controller's live snow lands via the snow-aware
// `getBattlefieldIds` supertype filter while still on the battlefield.
export const icequake: CardDefinition = {
    id: "14b4dd4d-c617-4603-8a87-761ec6fc6883",
    name: "Icequake",
    rarity: "uncommon",
    oracleText:
        "Destroy target land. If that land was a snow land, Icequake deals 1 damage to that land's controller.",
    manaCost: { X: 1, B: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const controller = ctx.getController(target);
        const wasSnow = ctx
            .getBattlefieldIds(controller, {
                types: "Land",
                supertypes: ["Snow"],
                instanceIds: [target.id],
            })
            .includes(target.id);
        ctx.destroy(target);
        if (wasSnow) {
            ctx.dealDamage({ type: "player", id: controller }, 1);
        }
    },
};
// TODO(#628): implement.
// export const infernalDarkness: CardDefinition = {
//     id: "f3475eb3-909d-450b-9597-b241b259b425",
//     name: "Infernal Darkness",
//     rarity: "rare",
//     oracleText: "Cumulative upkeep—Pay {B} and 1 life. (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nIf a land is tapped for mana, it produces {B} instead of any other type.",
//     manaCost: { X: 2, B: 2 },
//     types: ["Enchantment"],
// };
// Infernal Denizen — "At the beginning of your upkeep, sacrifice two Swamps. If
// you can't, tap this creature, and an opponent may gain control of a creature
// you control of their choice for as long as this creature remains on the
// battlefield. {T}: Gain control of target creature for as long as this creature
// remains on the battlefield." (CR 603.6a upkeep trigger, CR 701.16 sacrifice,
// CR 613.1b layer-2 control change.) The "sacrifice two Swamps" is the may-pay
// sacrifice leg (count 2, subtype Swamp); on decline / inability the engine
// collapses to the false branch (the affordability gate blocks an accept the
// board can't cover), which taps the Denizen and lets the opponent steal a
// creature of their choice. Both control changes use the
// `controller-controls-source` condition (Aladdin pattern) — the closest shipped
// "for as long as [the source] remains under its controller" semantics; the
// control reverts when the Denizen leaves or changes controller.
const INFERNAL_DENIZEN_ID = "b63ac9a6-aaa5-4659-97d1-c5f6b0d5ccfe";
export const infernalDenizen: CardDefinition = {
    id: INFERNAL_DENIZEN_ID,
    name: "Infernal Denizen",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, sacrifice two Swamps. If you can't, tap this creature, and an opponent may gain control of a creature you control of their choice for as long as this creature remains on the battlefield.\n{T}: Gain control of target creature for as long as this creature remains on the battlefield.",
    manaCost: { X: 7, B: 1 },
    types: ["Creature"],
    subtypes: ["Demon"],
    power: 5,
    toughness: 7,
    triggeredAbilities: [
        phaseTrigger({
            id: "infernal-denizen-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice two Swamps. If you can't, tap this creature, and an opponent may gain control of a creature you control of their choice for as long as this creature remains on the battlefield.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: {
                        sacrifice: {
                            filter: {
                                subtypes: "Swamp",
                                controllerRelation: "you",
                            },
                            count: 2,
                        },
                    },
                    prompt: "Sacrifice two Swamps, or let an opponent steal a creature (and tap Infernal Denizen)?",
                });
                if (accept === undefined) return;
                if (accept) return;
                // Can't / won't sacrifice two Swamps → tap self + opponent's
                // choice steals one of the controller's creatures.
                ctx.tap({ type: "permanent", id: ctx.sourceInstanceId });
                const opp = ctx
                    .apNapOrder()
                    .filter((p) => p !== ctx.controller)[0];
                if (!opp) return;
                const creatures = ctx.getBattlefieldIds(ctx.controller, {
                    types: "Creature",
                });
                if (creatures.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: opp,
                    choiceId: `infernal-denizen-steal-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: ctx.controller,
                    filter: { types: "Creature" },
                    count: 1,
                    prompt: "Infernal Denizen: choose a creature to gain control of.",
                });
                if (picks === undefined) return;
                for (const id of picks) {
                    ctx.gainControl({ type: "permanent", id }, opp, {
                        kind: "controller-controls-source",
                        controllerId: opp,
                    });
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "infernal-denizen-steal",
            oracleText:
                "{T}: Gain control of target creature for as long as this creature remains on the battlefield.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.gainControl(target, ctx.controller, {
                    kind: "controller-controls-source",
                    controllerId: ctx.controller,
                });
            },
        },
    ],
};
// Kjeldoran Dead — "When this creature enters, sacrifice a creature." (CR 603.6
// ETB trigger + CR 701.16 sacrifice; the controller chooses which Creature they
// control, and may choose Kjeldoran Dead itself.) Plus "{B}: Regenerate this
// creature." (CR 701.15 regeneration shield.)
export const kjeldoranDead: CardDefinition = {
    id: "d3f7b614-6075-4b7c-acc7-ab63185b570b",
    name: "Kjeldoran Dead",
    rarity: "common",
    oracleText:
        "When this creature enters, sacrifice a creature.\n{B}: Regenerate this creature.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Skeleton"],
    power: 3,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "kjeldoran-dead-sac",
            oracleText: "When this creature enters, sacrifice a creature.",
            scope: "self",
            resolve: (ctx) => {
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `kjeldoran-dead-sac-${ctx.sourceInstanceId}`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { types: "Creature", controllerRelation: "you" },
                    count: 1,
                    prompt: "Kjeldoran Dead: sacrifice a creature.",
                });
                if (picks === undefined) return; // suspended for the choice
                for (const id of picks) ctx.sacrifice(id);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "kjeldoran-dead-regenerate",
            oracleText: "{B}: Regenerate this creature.",
            cost: { mana: { B: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// Knight of Stromgald — the black "Order" cycle shape: protection from white
// (CR 702.16) plus a first-strike grant and a power pump (CR 611.1b).
export const knightOfStromgald: CardDefinition = {
    id: "2b87069b-ebaf-4705-b5da-446932af9b73",
    name: "Knight of Stromgald",
    rarity: "uncommon",
    oracleText:
        "Protection from white\n{B}: This creature gains first strike until end of turn.\n{B}{B}: This creature gets +1/+0 until end of turn.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 1,
    staticAbilities: ["protection from white"],
    activatedAbilities: [
        {
            id: "knight-of-stromgald-first-strike",
            oracleText:
                "{B}: This creature gains first strike until end of turn.",
            cost: { mana: { B: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "first strike",
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "knight-of-stromgald-pump",
            oracleText: "{B}{B}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { B: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Krovikan Elementalist — "{2}{R}: Target creature gets +1/+0 until end of turn.
// {U}{U}: Target creature you control gains flying until end of turn. Sacrifice
// it at the beginning of the next end step." (CR 611.1b temp buff + CR 702.9
// flying grant + CR 603.7a delayed end-step sacrifice.) The second ability's
// "sacrifice it at the next end step" is a delayed trigger carrying the buffed
// creature's id.
const KROVIKAN_ELEMENTALIST_ID = "bbedca18-a074-4441-b0a9-7b14fdb07412";
export const krovikanElementalist: CardDefinition = {
    id: KROVIKAN_ELEMENTALIST_ID,
    name: "Krovikan Elementalist",
    rarity: "uncommon",
    oracleText:
        "{2}{R}: Target creature gets +1/+0 until end of turn.\n{U}{U}: Target creature you control gains flying until end of turn. Sacrifice it at the beginning of the next end step.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "krovikan-elementalist-pump",
            oracleText: "{2}{R}: Target creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 2, R: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 1, 0, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
        {
            id: "krovikan-elementalist-fly",
            oracleText:
                "{U}{U}: Target creature you control gains flying until end of turn. Sacrifice it at the beginning of the next end step.",
            cost: { mana: { U: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.grantStaticAbility(target, "flying", {
                    phase: "end-of-turn",
                });
                ctx.scheduleDelayedTrigger(
                    KROVIKAN_ELEMENTALIST_ID,
                    "krovikan-elementalist-sacrifice",
                    "next-end-step",
                    { targetId: target.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "krovikan-elementalist-sacrifice",
            oracleText:
                "Sacrifice that creature at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (payload.targetId) ctx.sacrifice(payload.targetId);
            },
        },
    ],
};
// Krovikan Fetish — {2}{B} Aura. Static +1/+1 on the host (CR 611.2c layer 7c)
// plus a self-ETB trigger (CR 603.6a) that arms the next-upkeep cantrip rider.
// Unlike the instant cantrips the schedule rides an ENTERS trigger, not a spell
// resolve — but the delayed-trigger template is identical.
export const krovikanFetish: CardDefinition = {
    id: "844e73e6-b201-4b2e-b46a-b719484fba0e",
    name: "Krovikan Fetish",
    rarity: "common",
    oracleText:
        "Enchant creature\nWhen this Aura enters, draw a card at the beginning of the next turn's upkeep.\nEnchanted creature gets +1/+1.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 1, toughness: 1 },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "krovikan-fetish-etb",
            oracleText:
                "When this Aura enters, draw a card at the beginning of the next turn's upkeep.",
            scope: "self",
            resolve: (ctx) => {
                scheduleNextUpkeepDraw(ctx, krovikanFetish.id);
            },
        }),
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Krovikan Vampire — "At the beginning of each end step, if a creature dealt
// damage by this creature this turn died, put that card onto the battlefield
// under your control. Sacrifice it when you lose control of this creature."
// (CR 603.2 death trigger keyed on `damagedBySources` — the Sengir Vampire
// check — composed with a next-end-step delayed reanimation, CR 603.7c.) When
// a creature this Vampire damaged this turn dies, a delayed trigger fires at
// that turn's end step and reanimates the card under the Vampire's controller
// via `returnToBattlefield(..., "graveyard")`.
//
// SIMPLIFICATION (flagged, no engine change): the "sacrifice it when you lose
// control of this creature" linkage requires per-permanent control-loss
// tracking the engine doesn't model yet. The reanimation (the card's main
// effect) is faithful; the sacrifice-on-loss-of-control clause — only reachable
// via a control-change effect on the Vampire, which the current pool barely
// exercises — is documented as deferred.
const KROVIKAN_VAMPIRE_ID = "717c5dda-8e38-4c76-b241-685198402284";
export const krovikanVampire: CardDefinition = {
    id: KROVIKAN_VAMPIRE_ID,
    name: "Krovikan Vampire",
    rarity: "uncommon",
    oracleText:
        "At the beginning of each end step, if a creature dealt damage by this creature this turn died, put that card onto the battlefield under your control. Sacrifice it when you lose control of this creature.",
    manaCost: { X: 3, B: 2 },
    types: ["Creature"],
    subtypes: ["Vampire"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        diedTrigger({
            id: "krovikan-vampire-mark",
            oracleText:
                "Whenever a creature dealt damage by this creature this turn dies, reanimate it under your control at the beginning of the end step.",
            scope: "any-other",
            condition: (event, self) =>
                event.damagedBySources.includes(self.id),
            resolve: (ctx, _event, deadCreature) => {
                ctx.scheduleDelayedTrigger(
                    KROVIKAN_VAMPIRE_ID,
                    "krovikan-vampire-reanimate",
                    "next-end-step",
                    {
                        deadId: deadCreature.id,
                        controllerId: ctx.controller,
                    }
                );
            },
        }),
    ],
    delayedTriggers: [
        {
            id: "krovikan-vampire-reanimate",
            oracleText:
                "Put that card onto the battlefield under your control at the beginning of the end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (!payload.deadId || !payload.controllerId) return;
                ctx.returnToBattlefield(
                    payload.controllerId,
                    payload.deadId,
                    "graveyard"
                );
            },
        },
    ],
};
// Legions of Lim-Dûl — snow swampwalk (CR 702.13 / 205.4a): can't be blocked
// while the defending player controls a snow Swamp. Modeled as the
// `snow swampwalk` keyword in `staticAbilities`; the combat registry's
// `LANDWALK_SNOW_RULES` enforces it (`controlsSnowSubtype(..., "Swamp")`).
export const legionsOfLimDL: CardDefinition = {
    id: "75b67eb2-b60e-46b4-9d48-11c284957bec",
    name: "Legions of Lim-Dûl",
    rarity: "common",
    oracleText:
        "Snow swampwalk (This creature can't be blocked as long as defending player controls a snow Swamp.)",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 3,
    staticAbilities: ["snow swampwalk"],
};
// Leshrac's Rite — Aura that grants swampwalk to its host (CR 702.13 landwalk,
// CR 611 keyword grant via `keyword-grant` staticEffect on the host).
export const leshracsRite: CardDefinition = {
    id: "4e0a6b4e-95b4-40f6-bb19-568dbd908a2b",
    name: "Leshrac's Rite",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nEnchanted creature has swampwalk. (It can't be blocked as long as defending player controls a Swamp.)",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "swampwalk",
        },
    ],
};
// Leshrac's Sigil — "Whenever an opponent casts a green spell, you may pay
// {B}{B}. If you do, look at that player's hand and choose a card from it. The
// player discards that card. {B}{B}: Return this enchantment to its owner's
// hand." (CR 603.2 spell-cast trigger filtered to green opponents' spells +
// CR 117.3a may-pay + CR 701.8 discard chosen by the Sigil's controller.) The
// chosen discard is a `discard-hand` requestChoice scoped to the caster's hand
// (Mind Warp pattern); the Sigil's controller is the chooser.
export const leshracsSigil: CardDefinition = {
    id: "ad5ba7ee-d6df-4b62-a8a1-c81e6fca392a",
    name: "Leshrac's Sigil",
    rarity: "uncommon",
    oracleText:
        "Whenever an opponent casts a green spell, you may pay {B}{B}. If you do, look at that player's hand and choose a card from it. The player discards that card.\n{B}{B}: Return this enchantment to its owner's hand.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "leshracs-sigil-green-discard",
            oracleText:
                "Whenever an opponent casts a green spell, you may pay {B}{B}. If you do, look at that player's hand and choose a card from it. The player discards that card.",
            scope: "opponents",
            filter: { colors: ["G"] },
            resolve: (ctx, _event, spell) => {
                const caster = spell.casterId;
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `leshracs-sigil-${ctx.sourceInstanceId}`,
                    cost: { B: 2 },
                    prompt: "Pay {B}{B} to make that player discard a card of your choice?",
                });
                if (accept === undefined) return;
                if (!accept) return;
                if (ctx.getHandSize(caster) === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `leshracs-sigil-pick-${ctx.sourceInstanceId}`,
                    kind: "discard-hand",
                    zone: "hand",
                    zoneOwnerId: caster,
                    count: 1,
                    prompt: "Leshrac's Sigil: choose a card for that player to discard.",
                });
                if (picks === undefined) return;
                for (const id of picks) ctx.discardCard(caster, id);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "leshracs-sigil-return",
            oracleText: "{B}{B}: Return this enchantment to its owner's hand.",
            cost: { mana: { B: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.returnToHand({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// Lim-Dûl's Cohort — "Whenever this creature blocks or becomes blocked by a
// creature, that creature can't be regenerated this turn." (CR 509.1h
// blocks-or-becomes-blocked + CR 701.15c regeneration suppression.) The
// combatPairKill family captures this exact "the other creature in the pair"
// targeting, but it always *destroys* at end of combat — here the effect is an
// immediate, no-destroy `setTargetCantBeRegeneratedThisTurn`, so we declare the
// BLOCKERS_CONFIRMED trigger directly. NOTE: `setTargetCantBeRegeneratedThisTurn`
// SHIPS today (Incinerate / Orcish Healer) — the old "needs primitive" stub was
// stale (#655).
const LIM_DULS_COHORT_ID = "3d0006f6-2f96-453d-9145-eaefa588efbc";
export const limDLsCohort: CardDefinition = {
    id: LIM_DULS_COHORT_ID,
    name: "Lim-Dûl's Cohort",
    rarity: "common",
    oracleText:
        "Whenever this creature blocks or becomes blocked by a creature, that creature can't be regenerated this turn.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        {
            id: "lim-duls-cohort-no-regen",
            oracleText:
                "Whenever this creature blocks or becomes blocked by a creature, that creature can't be regenerated this turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event: GameEvent, self: PermanentView) =>
                event.type === "BLOCKERS_CONFIRMED" &&
                (event.attackerId === self.id || event.blockerId === self.id),
            resolve: (ctx: SpellContext, event: GameEvent) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const ev = event as BlockersConfirmedEvent;
                // CR 509.1h — the OTHER creature in the pair.
                const otherId =
                    ev.attackerId === ctx.sourceInstanceId
                        ? ev.blockerId
                        : ev.attackerId;
                ctx.setTargetCantBeRegeneratedThisTurn({
                    type: "permanent",
                    id: otherId,
                });
            },
        },
    ],
};
// Lim-Dûl's Hex — "At the beginning of your upkeep, for each player, this
// enchantment deals 1 damage to that player unless they pay {B} or {3}."
// (CR 603.6a upkeep trigger + CR 117.3a may-pay, once per player.) The "{B} or
// {3}" alternative cost has no single `MayPayCost` shape (the union covers
// mana+life+sacrifice, not "either-or"), so we compose it from two sequential
// may-pays per player: offer {B} first; if declined, offer {3}; only if BOTH
// are declined does the player take 1 damage. Each player's two prompts are
// keyed by distinct choiceIds so stepped resolution (CR 608.2) keeps them apart.
export const limDLsHex: CardDefinition = {
    id: "af976f42-3d56-4e32-8294-970a276a4bf3",
    name: "Lim-Dûl's Hex",
    rarity: "uncommon",
    oracleText:
        "At the beginning of your upkeep, for each player, this enchantment deals 1 damage to that player unless they pay {B} or {3}.",
    manaCost: { X: 1, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "lim-duls-hex-upkeep",
            oracleText:
                "At the beginning of your upkeep, for each player, this enchantment deals 1 damage to that player unless they pay {B} or {3}.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 101.4 — resolve "for each player" in APNAP order. Collect
                // every player's pay decision FIRST (the may-pays are idempotent
                // on re-resolution), then apply damage in a single final pass.
                // This keeps the side effect (`dealDamage`) from re-firing each
                // time a later player's may-pay suspends and the resolve re-runs
                // (CR 608.2 — the Balance "collect then apply" pattern).
                const players = ctx.apNapOrder();
                const takesDamage: string[] = [];
                for (const playerId of players) {
                    const paidB = ctx.requestMayPay({
                        playerId,
                        choiceId: `lim-duls-hex-b-${playerId}`,
                        cost: { B: 1 },
                        prompt: "Pay {B} to avoid 1 damage from Lim-Dûl's Hex? (Declining offers {3} next.)",
                    });
                    if (paidB === undefined) return; // suspended
                    if (paidB) continue;
                    const paid3 = ctx.requestMayPay({
                        playerId,
                        choiceId: `lim-duls-hex-3-${playerId}`,
                        cost: { X: 3 },
                        prompt: "Pay {3} to avoid 1 damage from Lim-Dûl's Hex?",
                    });
                    if (paid3 === undefined) return; // suspended
                    if (!paid3) takesDamage.push(playerId);
                }
                // All decisions in — apply damage exactly once.
                for (const playerId of takesDamage) {
                    ctx.dealDamage({ type: "player", id: playerId }, 1);
                }
            },
        }),
    ],
};
// Mind Ravel — {2}{B} Sorcery. "Target player discards a card" (CR 701.8 —
// chosen by the discarding player; Zuran Enchanter pattern) plus the next-upkeep
// cantrip rider. The discard choice and the schedule live in separate resolve
// steps so a suspension on the discard never double-schedules.
export const mindRavel: CardDefinition = {
    id: "61cf3ac5-985d-4b48-b230-d5ae4ab1ace8",
    name: "Mind Ravel",
    rarity: "common",
    oracleText:
        "Target player discards a card.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (target?.type !== "player") return;
            if (ctx.getHandSize(target.id) === 0) return;
            const picks = ctx.requestChoice({
                playerId: target.id,
                choiceId: `mind-ravel-${ctx.sourceInstanceId}-${target.id}`,
                kind: "discard-hand",
                zone: "hand",
                count: 1,
                prompt: "Mind Ravel: discard a card.",
            });
            if (picks === undefined) return; // suspended on the discard choice
            for (const id of picks) ctx.discardCard(target.id, id);
        },
        (ctx: SpellContext) => {
            scheduleNextUpkeepDraw(ctx, mindRavel.id);
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Mind Warp — "Look at target player's hand and choose X cards from it. That
// player discards those cards." (CR 702.x reveal-to-caster + CR 701.8 discard.)
// The caster (not the target) chooses which X cards via a `discard-hand`
// requestChoice scoped to the target's hand; the picks are then discarded.
export const mindWarp: CardDefinition = {
    id: "de150cd6-0bbc-47f7-a781-cd1aa10eabc6",
    name: "Mind Warp",
    rarity: "uncommon",
    oracleText:
        "Look at target player's hand and choose X cards from it. That player discards those cards.",
    manaCost: { X: "X", B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const x = ctx.getX();
        const handSize = ctx.getHandSize(target.id);
        const count = Math.min(x, handSize);
        if (count <= 0) return;
        const picks = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: `mind-warp-${ctx.sourceInstanceId}`,
            kind: "discard-hand",
            zone: "hand",
            zoneOwnerId: target.id,
            count,
            prompt: "Mind Warp: choose cards for that player to discard.",
        });
        if (picks === undefined) return; // suspended for the choice
        for (const id of picks) ctx.discardCard(target.id, id);
    },
};
// Mind Whip — "Enchant creature. At the beginning of the upkeep of enchanted
// creature's controller, that player may pay {3}. If they don't, this Aura deals
// 2 damage to that player and you tap that creature." (CR 303.4 aura, CR 603.6a
// host-controller upkeep trigger, CR 117.3a may-pay — the Paralyze/Power Leak
// host-controller pattern.) Decline → 2 damage to the host's controller + tap
// the host.
export const mindWhip: CardDefinition = {
    id: "3f3ff5fb-4126-4a18-b540-2beaae382e59",
    name: "Mind Whip",
    rarity: "rare",
    oracleText:
        "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player may pay {3}. If they don't, this Aura deals 2 damage to that player and you tap that creature.",
    manaCost: { X: 2, B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "mind-whip-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, that player may pay {3}. If they don't, this Aura deals 2 damage to that player and you tap that creature.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                const accept = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: hostController,
                    cost: { X: 3 },
                    prompt: "Pay {3} to avoid 2 damage and tapping from Mind Whip?",
                });
                if (accept === undefined) return;
                if (!accept) {
                    ctx.dealDamage({ type: "player", id: hostController }, 2);
                    ctx.tap({ type: "permanent", id: hostId });
                }
            },
        }),
    ],
};
// Minion of Leshrac — "Protection from black. At the beginning of your upkeep,
// this creature deals 5 damage to you unless you sacrifice a creature other than
// this creature. If this creature deals damage to you this way, tap it. {T}:
// Destroy target creature or land." (CR 702.16 protection, CR 603.6a upkeep
// trigger, CR 117.3a may-pay with a typed-sacrifice cost, CR 701.7 destroy.) The
// "sacrifice a creature other than this" is the may-pay sacrifice leg
// (CR 701.16) filtered to creatures the controller controls; decline → 5 damage
// to controller + tap self.
const MINION_OF_LESHRAC_ID = "61278908-a1b4-4b4c-84f5-498ca41fc6b6";
export const minionOfLeshrac: CardDefinition = {
    id: MINION_OF_LESHRAC_ID,
    name: "Minion of Leshrac",
    rarity: "rare",
    oracleText:
        "Protection from black\nAt the beginning of your upkeep, this creature deals 5 damage to you unless you sacrifice a creature other than this creature. If this creature deals damage to you this way, tap it.\n{T}: Destroy target creature or land.",
    manaCost: { X: 4, B: 3 },
    types: ["Creature"],
    subtypes: ["Demon", "Minion"],
    power: 5,
    toughness: 5,
    staticAbilities: ["protection from black"],
    triggeredAbilities: [
        phaseTrigger({
            id: "minion-of-leshrac-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 5 damage to you unless you sacrifice a creature other than this creature. If this creature deals damage to you this way, tap it.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    // CR 701.16 — sacrifice a creature OTHER than this one. The
                    // sacrifice leg excludes the source by id so the player
                    // can't feed Minion of Leshrac to its own upkeep.
                    cost: {
                        sacrifice: {
                            filter: {
                                types: "Creature",
                                controllerRelation: "you",
                                excludeInstanceIds: [ctx.sourceInstanceId],
                            },
                            count: 1,
                        },
                    },
                    prompt: "Sacrifice another creature, or take 5 damage from Minion of Leshrac (which then taps it)?",
                });
                if (accept === undefined) return;
                if (!accept) {
                    ctx.dealDamage({ type: "player", id: ctx.controller }, 5);
                    ctx.tap({ type: "permanent", id: ctx.sourceInstanceId });
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "minion-of-leshrac-destroy",
            oracleText: "{T}: Destroy target creature or land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: ["Creature", "Land"], count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
    ],
};
// Minion of Tevesh Szat — "At the beginning of your upkeep, this creature deals
// 2 damage to you unless you pay {B}{B}." (CR 603.6a upkeep trigger + CR 117.3a
// may-pay; on decline it deals 2 to its controller.) Plus "{T}: Target creature
// gets +3/-2 until end of turn." (CR 611.1b — pump power, drop toughness.)
export const minionOfTeveshSzat: CardDefinition = {
    id: "ea9f3ab5-6a31-47db-b8bf-4c56a7ff19d1",
    name: "Minion of Tevesh Szat",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, this creature deals 2 damage to you unless you pay {B}{B}.\n{T}: Target creature gets +3/-2 until end of turn.",
    manaCost: { X: 4, B: 3 },
    types: ["Creature"],
    subtypes: ["Demon", "Minion"],
    power: 4,
    toughness: 4,
    triggeredAbilities: [
        phaseTrigger({
            id: "minion-tevesh-szat-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 2 damage to you unless you pay {B}{B}.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: { B: 2 },
                    prompt: "Pay {B}{B} or take 2 damage from Minion of Tevesh Szat?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.dealDamage({ type: "player", id: ctx.controller }, 2);
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "minion-tevesh-szat-pump",
            oracleText: "{T}: Target creature gets +3/-2 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 3, -2, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// Mole Worms — land-locking twin of Phyrexian Gremlins (CR 611.2 untap-lock
// tied to the source's tapped state via `lockUntapWhileSourceTapped`; CR 502.1
// optional untap). "{T}: Tap target land. It doesn't untap ... for as long as
// this creature remains tapped."
export const moleWorms: CardDefinition = {
    id: "4914f6fc-e3e7-426b-8688-12157c7df9e7",
    name: "Mole Worms",
    rarity: "uncommon",
    oracleText:
        "You may choose not to untap this creature during your untap step.\n{T}: Tap target land. It doesn't untap during its controller's untap step for as long as this creature remains tapped.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Worm"],
    power: 1,
    toughness: 1,
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "mole-worms-tap-lock",
            oracleText:
                "{T}: Tap target land. It doesn't untap during its controller's untap step for as long as this creature remains tapped.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.tap(target);
                    ctx.lockUntapWhileSourceTapped(target);
                }
            },
        },
    ],
};
// Moor Fiend — 3/3 swampwalk (CR 702.13b landwalk evasion).
export const moorFiend: CardDefinition = {
    id: "57089dd4-e30d-498d-9341-43c104c6f3f9",
    name: "Moor Fiend",
    rarity: "common",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 3,
    toughness: 3,
    staticAbilities: ["swampwalk"],
};
// TODO(#628): implement.
// export const necropotence: CardDefinition = {
//     id: "54d7a0c1-efb4-4a8d-ad92-a96d43835052",
//     name: "Necropotence",
//     rarity: "rare",
//     oracleText: "Skip your draw step.\nWhenever you discard a card, exile that card from your graveyard.\nPay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.",
//     manaCost: { B: 3 },
//     types: ["Enchantment"],
// };
// Norritt — "{T}: Untap target blue creature. {T}: Choose target non-Wall
// creature the active player has controlled continuously since the beginning of
// the turn. That creature attacks this turn if able. Destroy it at the beginning
// of the next end step if it didn't attack this turn. Activate only before
// attackers are declared." (CR 701.20b untap; CR 508.1d force-attack +
// CR 603.7a delayed end-step destroy — the Nettling Imp shape.) The
// "controlled continuously since the beginning of the turn" clause is modelled
// as `!isSummoningSick` (a creature that came under its controller's control
// this turn reads sick); `activationPhaseRestriction` enforces "before attackers
// are declared".
const NORRITT_ID = "35abefe6-c39b-4fe5-b2e3-d213f0c4f447";
export const norritt: CardDefinition = {
    id: NORRITT_ID,
    name: "Norritt",
    rarity: "common",
    oracleText:
        "{T}: Untap target blue creature.\n{T}: Choose target non-Wall creature the active player has controlled continuously since the beginning of the turn. That creature attacks this turn if able. Destroy it at the beginning of the next end step if it didn't attack this turn. Activate only before attackers are declared.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Imp"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "norritt-untap-blue",
            oracleText: "{T}: Untap target blue creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, colorFilter: "U" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.untap(target);
            },
        },
        {
            id: "norritt-force-attack",
            oracleText:
                "{T}: Choose target non-Wall creature the active player has controlled continuously since the beginning of the turn. That creature attacks this turn if able. Destroy it at the beginning of the next end step if it didn't attack this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeSubtypes: "Wall",
            },
            activationPhaseRestriction: [
                "UPKEEP",
                "DRAW",
                "PRECOMBAT_MAIN",
                "BEGINNING_OF_COMBAT",
            ],
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "permanent") return;
                ctx.setMustAttackThisTurn(target);
                ctx.scheduleDelayedTrigger(
                    NORRITT_ID,
                    "norritt-destroy",
                    "next-end-step",
                    { targetId: target.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "norritt-destroy",
            oracleText:
                "Destroy that creature at the beginning of the next end step if it didn't attack this turn.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                const target = { type: "permanent" as const, id: targetId };
                if (ctx.hasAttackedThisTurn(target)) return;
                ctx.destroy(target);
            },
        },
    ],
};
// TODO(#628): implement.
// export const oathOfLimDL: CardDefinition = {
//     id: "f16df768-06de-43a0-b548-44fb0887490b",
//     name: "Oath of Lim-Dûl",
//     rarity: "rare",
//     oracleText: "Whenever you lose life, for each 1 life you lost, sacrifice a permanent other than this enchantment unless you discard a card. (Damage dealt to you causes you to lose life.)\n{B}{B}: Draw a card.",
//     manaCost: { X: 3, B: 1 },
//     types: ["Enchantment"],
// };
// Pestilence Rats — "Pestilence Rats's power is equal to the number of other
// Rats on the battlefield." (CR 604.3 characteristic-defining ability; */3 with
// the */ power supplied by a `pt-cda` that counts other Rats across both
// battlefields — base power 0.)
export const pestilenceRats: CardDefinition = {
    id: "bff7f6a6-0e90-4eb4-b76e-d98454975fb6",
    name: "Pestilence Rats",
    rarity: "common",
    oracleText:
        "Pestilence Rats's power is equal to the number of other Rats on the battlefield. (For example, as long as there are two other Rats on the battlefield, Pestilence Rats's power and toughness are 2/3.)",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Rat"],
    power: 0,
    toughness: 3,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                let otherRats = 0;
                for (const p of state.players) {
                    for (const c of p.battlefield) {
                        if (c.id === source.id) continue;
                        if (c.subtypes.includes("Rat")) otherRats++;
                    }
                }
                // CR 613.4 layer 7b: */3 — power = other Rats, toughness fixed.
                return { power: otherRats, toughness: 0 };
            },
        },
    ],
};
// TODO(#628): implement.
// export const pox: CardDefinition = {
//     id: "a914138c-a593-414c-bbcb-83d3c1bc4f6f",
//     name: "Pox",
//     rarity: "rare",
//     oracleText: "Each player loses a third of their life, then discards a third of the cards in their hand, then sacrifices a third of the creatures they control of their choice, then sacrifices a third of the lands they control of their choice. Round up each time.",
//     manaCost: { B: 3 },
//     types: ["Sorcery"],
// };
// TODO(#628): implement.
// export const seizures: CardDefinition = {
//     id: "da369c86-7e17-43d8-b626-b6842e3d2d50",
//     name: "Seizures",
//     rarity: "common",
//     oracleText: "Enchant creature\nWhenever enchanted creature becomes tapped, this Aura deals 3 damage to that creature's controller unless that player pays {3}.",
//     manaCost: { X: 1, B: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Songs of the Damned — "Add {B} for each creature card in your graveyard."
// (CR 605/606 mana spell; counts Creature cards in the caster's graveyard at
// resolution and adds that many {B}.)
export const songsOfTheDamned: CardDefinition = {
    id: "6cff3547-8c72-439a-91fe-ebe729dab748",
    name: "Songs of the Damned",
    rarity: "common",
    oracleText: "Add {B} for each creature card in your graveyard.",
    manaCost: { B: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        const creatures = ctx
            .getGraveyardCards(ctx.controller)
            .filter((c) => c.types.includes("Creature")).length;
        if (creatures > 0) ctx.addMana({ B: creatures });
    },
};
// TODO(#628): implement.
// export const soulBurn: CardDefinition = {
//     id: "eb8e00d2-2381-4d45-bed8-c9bf738a9419",
//     name: "Soul Burn",
//     rarity: "common",
//     oracleText: "Spend only black and/or red mana on X.\nSoul Burn deals X damage to any target. You gain life equal to the damage dealt, but not more than the amount of {B} spent on X, the player's life total before the damage was dealt, the planeswalker's loyalty before the damage was dealt, or the creature's toughness.",
//     manaCost: { X: "X", B: 1 },
//     types: ["Sorcery"],
// };
// Soul Kiss — "Enchant creature. {B}, Pay 1 life: Enchanted creature gets +2/+2
// until end of turn. Activate no more than three times each turn." (CR 303.4
// aura, CR 611.1b temp buff on the host, CR 602.5 hard per-turn activation cap.)
// The cap "no more than three times each turn" is a true activation restriction:
// `canActivate` reads the per-turn tally (`activationsThisTurn`, surfaced on
// PermanentView) and rejects the 4th activation. NOTE: this is exactly the
// `getActivationCount`+`canActivate` cap the issue (#655) confirmed ships today —
// the old "needs `maxActivationsPerTurn`" stub comment was stale.
export const soulKiss: CardDefinition = {
    id: "42fbf6a5-86fe-41a3-891e-f72f11ad0aee",
    name: "Soul Kiss",
    rarity: "common",
    oracleText:
        "Enchant creature\n{B}, Pay 1 life: Enchanted creature gets +2/+2 until end of turn. Activate no more than three times each turn.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    activatedAbilities: [
        {
            id: "soul-kiss-pump",
            oracleText:
                "{B}, Pay 1 life: Enchanted creature gets +2/+2 until end of turn. Activate no more than three times each turn.",
            cost: { mana: { B: 1 }, life: 1 },
            useStack: true,
            // CR 602.5 — reject the 4th+ activation this turn. The tally is
            // recorded before resolve runs, so checking `< 3` here caps it at 3.
            canActivate: (source) =>
                (source.activationsThisTurn?.["soul-kiss-pump"] ?? 0) < 3,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    2,
                    2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Spoils of Evil — "For each artifact or creature card in target opponent's
// graveyard, add {C} and you gain 1 life." (CR 606 mana + CR 119 lifegain.)
// Counts Artifact/Creature cards in the targeted opponent's graveyard; adds
// that many {C} and gains that much life.
export const spoilsOfEvil: CardDefinition = {
    id: "fd368eb6-72f0-42d4-afa5-3daa7de949ff",
    name: "Spoils of Evil",
    rarity: "rare",
    oracleText:
        "For each artifact or creature card in target opponent's graveyard, add {C} and you gain 1 life.",
    manaCost: { X: 2, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const n = ctx
            .getGraveyardCards(target.id)
            .filter(
                (c) =>
                    c.types.includes("Artifact") || c.types.includes("Creature")
            ).length;
        if (n > 0) {
            ctx.addMana({ C: n });
            ctx.gainLife(ctx.controller, n);
        }
    },
};
// TODO(#628): implement.
// export const spoilsOfWar: CardDefinition = {
//     id: "b38af8bd-d927-46d0-a1b1-fb437ea9ea66",
//     name: "Spoils of War",
//     rarity: "rare",
//     oracleText: "X is the number of artifact and/or creature cards in an opponent's graveyard as you cast this spell.\nDistribute X +1/+1 counters among any number of target creatures.",
//     manaCost: { X: "X", B: 1 },
//     types: ["Sorcery"],
// };
// TODO(#628): implement.
// export const stenchOfEvil: CardDefinition = {
//     id: "4c7065a2-f819-4cbe-b453-a55e904f0461",
//     name: "Stench of Evil",
//     rarity: "uncommon",
//     oracleText: "Destroy all Plains. For each land destroyed this way, Stench of Evil deals 1 damage to that land's controller unless they pay {2}.",
//     manaCost: { X: 2, B: 2 },
//     types: ["Sorcery"],
// };
// Stromgald Cabal — "{T}, Pay 1 life: Counter target white spell." (CR 602.1
// tap + CR 118.4 life cost; CR 701.5 counter restricted to white spells via the
// spell-target `colorFilter`.)
export const stromgaldCabal: CardDefinition = {
    id: "6ac6fa0c-753e-4fbc-8a70-0f956503cf4e",
    name: "Stromgald Cabal",
    rarity: "rare",
    oracleText: "{T}, Pay 1 life: Counter target white spell.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "stromgald-cabal-counter",
            oracleText: "{T}, Pay 1 life: Counter target white spell.",
            cost: { tap: true, life: 1 },
            useStack: true,
            targetRequirement: { type: "spell", count: 1, colorFilter: "W" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "spell") ctx.counter(target);
            },
        },
    ],
};
// Touch of Death — {2}{B} Sorcery. "Touch of Death deals 1 damage to target
// player or planeswalker. You gain 1 life." (CR 120.1 damage, CR 119.3
// lifegain) plus the next-upkeep cantrip rider.
export const touchOfDeath: CardDefinition = {
    id: "a49c658f-e657-490b-af1f-e67e48d0046e",
    name: "Touch of Death",
    rarity: "common",
    oracleText:
        "Touch of Death deals 1 damage to target player or planeswalker. You gain 1 life.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: ["player", "Planeswalker"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t) ctx.dealDamage(t, 1);
        ctx.gainLife(ctx.controller, 1);
        scheduleNextUpkeepDraw(ctx, touchOfDeath.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Withering Wisps — end-step self-sacrifice when no creatures are on the
// battlefield (CR 603.6a phase trigger), plus "{B}: deal 1 to each creature and
// each player" with a per-turn activation cap equal to the number of snow
// Swamps you control (CR 205.4a / 602.5f). The cap is enforced in `canActivate`
// by counting the controller's snow Swamps and comparing to this turn's tally.
export const witheringWisps: CardDefinition = {
    id: "ad1e6ae5-c972-42c0-ae78-f203873aeeb1",
    name: "Withering Wisps",
    rarity: "uncommon",
    oracleText:
        "At the beginning of the end step, if no creatures are on the battlefield, sacrifice this enchantment.\n{B}: This enchantment deals 1 damage to each creature and each player. Activate no more times each turn than the number of snow Swamps you control.",
    manaCost: { X: 1, B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "withering-wisps-end-step-sacrifice",
            oracleText:
                "At the beginning of the end step, if no creatures are on the battlefield, sacrifice this enchantment.",
            phase: "END_STEP",
            scope: "each",
            // CR 603.4d intervening-if — only sacrifice when the battlefield
            // holds no creatures at all.
            interveningIf: (_event, _self, state) =>
                !(state?.players ?? []).some((p) =>
                    p.battlefield.some((c) => c.types.includes("Creature"))
                ),
            resolve: (ctx) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "withering-wisps-blast",
            oracleText:
                "{B}: This enchantment deals 1 damage to each creature and each player. Activate no more times each turn than the number of snow Swamps you control.",
            cost: { mana: { B: 1 } },
            useStack: true,
            // CR 602.5f / 205.4a — capped at the controller's snow-Swamp count.
            canActivate: (source, state) => {
                const me = source.controllerId;
                const controller = state.players.find((p) => p.id === me);
                if (!controller) return false;
                const snowSwamps = controller.battlefield.filter((c) =>
                    controlsSnowSubtype([c], "Swamp")
                ).length;
                const used =
                    source.activationsThisTurn?.["withering-wisps-blast"] ?? 0;
                return used < snowSwamps;
            },
            resolve: (ctx: SpellContext) => {
                ctx.dealDamageToEach(1, { creatures: true, players: true });
            },
        },
    ],
};
// ─────────────────────────────────────────────────────────────────────────────
// Red free tranche (#633)
//
// The free-tranche Red cards — expressible entirely with already-shipped
// primitives — are activated below (intermixed with the remaining commented
// stubs). Reprints already implemented in earlier sets (Stone Rain, Shatter)
// are CardPrints onto their existing LEA definitions (ADR 0014); new-to-ICE Red
// cards are full CardDefinitions. Pyroblast is the colour-mirror of Hydroblast
// (modal counter/destroy gated on blue).
//
// RED COMPLETION (#656) — the specialized-interaction cards below were
// activated once their stub comments were re-checked against shipped primitives
// (several "needs primitive" notes were STALE): Aggression, Balduvian Hydra,
// Battle Frenzy, Bone Shaman, Chaos Lord, Dwarven Armory, Game of Chaos, Goblin
// Mutant, Goblin Sappers, Grizzled Wolverine, Márton Stromgald, Aurochs,
// Mudslide, Orcish Squatters, and Total War. No new SpellContext primitive was
// added — all compose `addTemporaryPTBuff`, `requestCoinFlip`/`requestOptionChoice`,
// `gainControl` (control-change conditions), `grantTriggeredAbility`,
// `entersWith` (`count: "X"`), `untapRestriction`, `activationPhaseRestriction`,
// `scheduleDelayedTrigger`, and the combat read getters (`getIsAttacking`,
// `getBlockersByAttacker`, attack/block-restriction static effects).
//
// DEFERRED (remain commented stubs, owned by a later cluster):
//   • Cumulative upkeep — Brand of Ill Omen (ADR 0042 cluster).
//   • Snow-matters — Avalanche (destroy snow lands), Barbarian Guides (snow
//     landwalk grant), Glacial Crevasses / Goblin Ski Patrol / Karplusan Giant
//     (snow Mountain cost / requirement), Melting (un-snow lands) (no snow
//     supertype filter / snow-evasion plumbing yet — snow cluster).
//   • Divided-as-you-choose damage — Fire Covenant, Fiery Justice, Meteor
//     Shower (only `dealDividedDamage`, divided EVENLY, exists; the
//     player-chosen division primitive is unbuilt).
//   • Next-upkeep delayed cantrip — Flare, Panic ("draw a card at the beginning
//     of the next turn's upkeep"): ACTIVE (#660 — the `next-upkeep` timing
//     shipped).
//   • Count-of-declared-attackers attack restrictions — Errantry ("can only
//     attack alone"), Orcish Conscripts ("can't attack/block unless two other
//     creatures attack/block"). `StaticAttackRestriction.predicate` only sees
//     (self, defenderBattlefield) and the engine validates attackers one at a
//     time (selectAttacker), so neither the candidate's nor the other declared
//     attackers' `isAttacking` flags are set at validation time — a count of the
//     full declared-attacker set is not observable today. Needs an attack
//     restriction that reads the live declared-attacker set (a small engine
//     extension), flagged for the combat-restriction cluster.
//   • Library random-exile + reorder — Orcish Librarian ("look at top eight,
//     exile four at RANDOM, reorder the rest"). `peekLibraryTop` /
//     `reorderLibraryTop` ship, but no SpellContext primitive selects/exiles N
//     cards at random from a library set (the seeded PRNG is engine-internal;
//     only `discardAtRandom` is exposed). Flagged for a random-select primitive.
//   • Other specialized interactions — Chaos Moon (parity mana substitution),
//     Earthlink (dies→sac-land), Ghostly Flame (colourless-damage-source
//     static), Melee / Monsoon (choose-blocks / Island-count end-step),
//     Orcish Farmer (land-type change), Mountain Titan (cast-trigger counter
//     grant). Curse of Marit Lage (Island untap-lock) is IMPLEMENTED below as
//     the Wrath-of-Marit-Lage twin. Each remaining card needs a primitive not
//     yet built; flagged for its capability cluster.
// ─────────────────────────────────────────────────────────────────────────────

// Aggression — {2}{R} Aura on a non-Wall creature. Grants first strike + trample
// (two layer-6 keyword-grants on the host, CR 611/702) and an end-step
// self-destruct on the host if it didn't attack (CR 603.6a phase trigger +
// CR 506.2 `hasAttackedThisTurn`). The end-step trigger fires on the HOST
// controller's end step; it reads the host via `getAttachedTo` and destroys it
// when its `hasAttackedThisTurn` marker is false. The "non-Wall" enchant
// restriction is enforced by the target filter (`excludeSubtype: "Wall"`).
export const aggression: CardDefinition = {
    id: "f3f26060-0c24-496c-b8e2-4dac7ea6166b",
    name: "Aggression",
    rarity: "uncommon",
    oracleText:
        "Enchant non-Wall creature\nEnchanted creature has first strike and trample.\nAt the beginning of the end step of enchanted creature's controller, destroy that creature if it didn't attack this turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        excludeSubtypes: "Wall",
    },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "first strike",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "trample",
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "aggression-end-step-destroy",
            oracleText:
                "At the beginning of the end step of enchanted creature's controller, destroy that creature if it didn't attack this turn.",
            phase: "END_STEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                const host: TargetSelection = {
                    type: "permanent",
                    id: hostId,
                };
                // Only fire on the HOST controller's end step (CR 603.6a).
                if (ctx.getController(host) !== scopedPlayerId) return;
                // CR 506.2 — destroy if the host didn't attack this turn.
                if (!ctx.hasAttackedThisTurn(host)) {
                    ctx.destroy(host);
                }
            },
        }),
    ],
};
// Anarchy — "Destroy all white permanents." (CR 701.7 destroy + CR 105.2 colour
// filter.) A one-line `destroyAll` over the white colour filter.
export const anarchy: CardDefinition = {
    id: "28d941da-b5cb-4b7e-84f2-ece883f89af3",
    name: "Anarchy",
    rarity: "uncommon",
    oracleText: "Destroy all white permanents.",
    manaCost: { X: 2, R: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll({ colors: "W" });
    },
};
// Avalanche — Destroy X target SNOW lands (CR 205.4a). `count: "X"` resolves the
// number of land targets against the chosen X; the `supertypeFilter: ["Snow"]`
// keeps only live snow lands as legal targets (snow-aware — honors Melting /
// Arcum's Weathervane).
//
// SIMPLIFICATION (flagged): the printed cost is {X}{2}{R}{R}. `ManaCost` encodes
// `X` as EITHER the variable "X" OR a fixed generic, not both, so the fixed {2}
// generic alongside variable X is not representable; this ships as {X}{R}{R}
// (the stub's pre-existing encoding). The {2} lands when ManaCost grows a
// separate "generic-with-variable-X" field — an engine limitation, not a snow
// gap.
export const avalanche: CardDefinition = {
    id: "d3a925e5-0d0a-42ec-b1c6-9793b8e11625",
    name: "Avalanche",
    rarity: "uncommon",
    oracleText: "Destroy X target snow lands.",
    manaCost: { X: "X", R: 2 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Land",
        count: "X",
        supertypeFilter: ["Snow"],
    },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") ctx.destroy(target);
        }
    },
};
// Balduvian Barbarians — {1}{R}{R} 3/2 vanilla Human Barbarian (CR 302).
export const balduvianBarbarians: CardDefinition = {
    id: "efeabe8e-8107-4d19-8a43-362aa79cdd92",
    name: "Balduvian Barbarians",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Barbarian"],
    power: 3,
    toughness: 2,
};
// Balduvian Hydra — {X}{R}{R} 0/1 Hydra. Enters with X +1/+0 counters (CR 122.1 /
// 614.1c `entersWith` with `count: "X"`, the Iceberg pattern). "Remove a +1/+0
// counter: Prevent the next 1 damage to it this turn" is a counter-removal-cost
// activated ability (CR 602.1 cost + CR 615 prevention shield on self, the
// Fylgja pattern). "{R}{R}{R}: Put a +1/+0 counter on this. Activate only during
// your upkeep" reuses `activationPhaseRestriction: ["UPKEEP"]` + `controllerTurnOnly`
// (the Clockwork Avian timing).
export const balduvianHydra: CardDefinition = {
    id: "c3a3b37f-daa6-4502-bb12-c72afe3df035",
    name: "Balduvian Hydra",
    rarity: "rare",
    oracleText:
        "This creature enters with X +1/+0 counters on it.\nRemove a +1/+0 counter from this creature: Prevent the next 1 damage that would be dealt to it this turn.\n{R}{R}{R}: Put a +1/+0 counter on this creature. Activate only during your upkeep.",
    manaCost: { X: "X", R: 2 },
    types: ["Creature"],
    subtypes: ["Hydra"],
    power: 0,
    toughness: 1,
    entersWith: { counters: [{ type: "+1/+0", count: "X" }] },
    activatedAbilities: [
        {
            id: "balduvian-hydra-prevent",
            oracleText:
                "Remove a +1/+0 counter from this creature: Prevent the next 1 damage that would be dealt to it this turn.",
            cost: { removeCounter: { type: "+1/+0", count: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.preventNextNDamageToTarget(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "balduvian-hydra-grow",
            oracleText:
                "{R}{R}{R}: Put a +1/+0 counter on this creature. Activate only during your upkeep.",
            cost: { mana: { R: 3 } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            resolve: (ctx: SpellContext) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+0",
                    1
                );
            },
        },
    ],
};
// Barbarian Guides — "{2}{R}, {T}: Choose a land type. Target creature you
// control gains snow landwalk of the chosen type until end of turn. Return that
// creature to its owner's hand at the beginning of the next end step."
// (CR 702.13 / 205.4a snow landwalk.) The land-type choice is a
// `requestOptionChoice` over the five basic types; the matching
// `snow <type>walk` keyword (enforced by the combat registry's snow-landwalk
// rules) is granted until end of turn, and a `next-end-step` delayed trigger
// bounces the creature.
const BARBARIAN_GUIDES_ID = "fe65a045-dacb-4392-bcb6-843394ef98c9";
const SNOW_LANDWALK_BY_TYPE: Record<string, string> = {
    Plains: "snow plainswalk",
    Island: "snow islandwalk",
    Swamp: "snow swampwalk",
    Mountain: "snow mountainwalk",
    Forest: "snow forestwalk",
};
export const barbarianGuides: CardDefinition = {
    id: BARBARIAN_GUIDES_ID,
    name: "Barbarian Guides",
    rarity: "common",
    oracleText:
        "{2}{R}, {T}: Choose a land type. Target creature you control gains snow landwalk of the chosen type until end of turn. Return that creature to its owner's hand at the beginning of the next end step. (It can't be blocked as long as defending player controls a snow land of that type.)",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Barbarian"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "barbarian-guides-snow-landwalk",
            oracleText:
                "{2}{R}, {T}: Choose a land type. Target creature you control gains snow landwalk of the chosen type until end of turn. Return that creature to its owner's hand at the beginning of the next end step.",
            cost: { mana: { X: 2, R: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                const chosen = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "barbarian-guides-land-type",
                    prompt: "Choose a land type for snow landwalk.",
                    options: [
                        { id: "Plains", label: "Plains" },
                        { id: "Island", label: "Island" },
                        { id: "Swamp", label: "Swamp" },
                        { id: "Mountain", label: "Mountain" },
                        { id: "Forest", label: "Forest" },
                    ],
                });
                if (chosen === undefined) return; // suspended on the choice
                const keyword = SNOW_LANDWALK_BY_TYPE[chosen];
                if (keyword) {
                    ctx.grantStaticAbility(t, keyword, {
                        phase: "end-of-turn",
                    });
                }
                ctx.scheduleDelayedTrigger(
                    BARBARIAN_GUIDES_ID,
                    "barbarian-guides-bounce",
                    "next-end-step",
                    { creatureId: t.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "barbarian-guides-bounce",
            oracleText:
                "Return that creature to its owner's hand at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (payload.creatureId) {
                    ctx.returnToHand({
                        type: "permanent",
                        id: payload.creatureId,
                    });
                }
            },
        },
    ],
};
// Battle Frenzy — {2}{R} Instant. One-shot batch pump (CR 611.1): a fixed
// snapshot at resolution of the creatures you control, green ones get +1/+1 and
// the rest +1/+0, both until end of turn. Composes `getBattlefieldIds` +
// `getColors` + `addTemporaryPTBuff` — no anthem static (the buff is a one-time
// instant, not a continuous effect; new creatures entering later aren't pumped).
export const battleFrenzy: CardDefinition = {
    id: "a85ae675-56ca-4a00-83d2-ee035f33d6d1",
    name: "Battle Frenzy",
    rarity: "common",
    oracleText:
        "Green creatures you control get +1/+1 until end of turn.\nNongreen creatures you control get +1/+0 until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        for (const id of ctx.getBattlefieldIds(ctx.controller, {
            types: "Creature",
        })) {
            const target: TargetSelection = { type: "permanent", id };
            const isGreen = ctx.getColors(target).includes("G");
            ctx.addTemporaryPTBuff(target, 1, isGreen ? 1 : 0, {
                phase: "end-of-turn",
            });
        }
    },
};
// Bone Shaman — {2}{R}{R} 3/3 Giant Shaman. "{B}: Until end of turn, this
// creature gains 'Creatures dealt damage by this creature this turn can't be
// regenerated this turn.'" The activated ability grants a DAMAGE-DEALT triggered
// ability to self until end of turn (CR 611.1b duration-scoped trigger grant via
// `grantTriggeredAbility`); the granted rider (a `damageDealtTrigger` template on
// `triggeredGrantTemplates[]`) fires whenever self deals damage to a creature and
// applies a regen-lock to that creature (CR 701.15c, the Lim-Dûl's Cohort leg).
const BONE_SHAMAN_ID = "0a5e3d54-4dc4-482b-8ecc-bb819ba03d2c";
export const boneShaman: CardDefinition = {
    id: BONE_SHAMAN_ID,
    name: "Bone Shaman",
    rarity: "common",
    oracleText:
        '{B}: Until end of turn, this creature gains "Creatures dealt damage by this creature this turn can\'t be regenerated this turn."',
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Giant", "Shaman"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "bone-shaman-grant-rider",
            oracleText:
                '{B}: Until end of turn, this creature gains "Creatures dealt damage by this creature this turn can\'t be regenerated this turn."',
            cost: { mana: { B: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantTriggeredAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    BONE_SHAMAN_ID,
                    "bone-shaman-no-regen-rider",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    // Granted-only rider (CR 113.1): kept off `triggeredAbilities` so Bone Shaman
    // doesn't carry it natively — it functions only while granted by the ability.
    triggeredGrantTemplates: [
        damageDealtTrigger({
            id: "bone-shaman-no-regen-rider",
            oracleText:
                "Creatures dealt damage by this creature this turn can't be regenerated this turn.",
            source: "self",
            resolve: (ctx, _event, damage) => {
                if (damage.target.type === "permanent") {
                    ctx.setTargetCantBeRegeneratedThisTurn(damage.target);
                }
            },
        }),
    ],
};
// TODO(#628): implement.
// export const brandOfIllOmen: CardDefinition = {
//     id: "ceeb7bbc-2d41-4709-95be-1ceb952ed1fb",
//     name: "Brand of Ill Omen",
//     rarity: "rare",
//     oracleText: "Enchant creature\nCumulative upkeep {R} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nEnchanted creature's controller can't cast creature spells.",
//     manaCost: { X: 3, R: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Chaos Lord — {4}{R}{R}{R} 7/7 Human with first strike. "At the beginning of
// your upkeep, target opponent gains control of this creature if the number of
// permanents is even" — an upkeep trigger (CR 603.6a, scope "your") that counts
// every permanent on the battlefield (sum of unfiltered `getBattlefieldIds` over
// `allPlayerIds`, CR 122-agnostic) and, on an even count, hands control to the
// opponent for the rest of the game (`gainControl`, layer-2 control change, no
// condition → permanent). "Can attack as though it had haste unless it entered
// this turn": modelled as the `haste` keyword (CR 702.10 / 508.1a). After a
// control change resets summoning sickness, the keyword lets the new controller
// attack immediately — matching the clause's intent; the "unless it entered this
// turn" carve-out is a minor simplification (a freshly-cast Chaos Lord could
// attack the turn it enters, which the printed card forbids).
export const chaosLord: CardDefinition = {
    id: "ee245922-b380-4b2e-a43f-ab1ba8078943",
    name: "Chaos Lord",
    rarity: "rare",
    oracleText:
        "First strike\nAt the beginning of your upkeep, target opponent gains control of this creature if the number of permanents is even.\nThis creature can attack as though it had haste unless it entered this turn.",
    manaCost: { X: 4, R: 3 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 7,
    toughness: 7,
    staticAbilities: ["first strike", "haste"],
    triggeredAbilities: [
        phaseTrigger({
            id: "chaos-lord-parity-control",
            oracleText:
                "At the beginning of your upkeep, target opponent gains control of this creature if the number of permanents is even.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 700 — count every permanent on the battlefield.
                let total = 0;
                for (const pid of ctx.allPlayerIds) {
                    total += ctx.getBattlefieldIds(pid).length;
                }
                if (total % 2 !== 0) return;
                const opponent = ctx.allPlayerIds.find(
                    (pid) => pid !== ctx.controller
                );
                if (!opponent) return;
                ctx.gainControl(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    opponent
                );
            },
        }),
    ],
};
// TODO(#628): implement.
// export const chaosMoon: CardDefinition = {
//     id: "aae0543f-7f8b-4327-b735-ac21244e9936",
//     name: "Chaos Moon",
//     rarity: "rare",
//     oracleText: "At the beginning of each upkeep, count the number of permanents. If the number is odd, until end of turn, red creatures get +1/+1 and whenever a player taps a Mountain for mana, that player adds an additional {R}. If the number is even, until end of turn, red creatures get -1/-1 and if a player taps a Mountain for mana, that Mountain produces colorless mana instead of any other type.",
//     manaCost: { X: 3, R: 1 },
//     types: ["Enchantment"],
// };
// Conquer — Aura granting control of the enchanted LAND (CR 613.1b, layer 2
// control-change). The Control-Magic shape pointed at a land instead of a
// creature; no upkeep tax, no P/T.
export const conquer: CardDefinition = {
    id: "ae610e66-7bcb-40ec-bed5-86dcfd098654",
    name: "Conquer",
    rarity: "uncommon",
    oracleText: "Enchant land\nYou control enchanted land.",
    manaCost: { X: 3, R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [{ kind: "control-change", applies: AURA_AFFECTS_HOST }],
};
// Curse of Marit Lage — ETB taps every Island (CR 603.6b enters trigger, CR
// 701.20a tap) and a static untap-lock on Islands (CR 611). The mirror of
// Wrath of Marit Lage (Blue tranche), swapping red creatures → Islands.
export const curseOfMaritLage: CardDefinition = {
    id: "69b381c1-aa71-4d40-a320-70f58a440d51",
    name: "Curse of Marit Lage",
    rarity: "rare",
    oracleText:
        "When this enchantment enters, tap all Islands.\nIslands don't untap during their controllers' untap steps.",
    manaCost: { X: 3, R: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "curse-marit-lage-island-lock",
            oracleText:
                "Islands don't untap during their controllers' untap steps (Curse of Marit Lage).",
            filter: { types: "Land", subtypes: "Island" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "curse-marit-lage-tap-islands",
            oracleText: "When this enchantment enters, tap all Islands.",
            scope: "self",
            resolve: (ctx) => {
                for (const pid of ctx.allPlayerIds) {
                    const islands = ctx.getBattlefieldIds(pid, {
                        types: "Land",
                        subtypes: "Island",
                    });
                    for (const id of islands) {
                        ctx.tap({ type: "permanent", id });
                    }
                }
            },
        }),
    ],
};
// Dwarven Armory — {2}{R}{R} Enchantment. "{2}, Sacrifice a land: Put a +2/+2
// counter on target creature. Activate only during any upkeep step." A land
// sacrifice cost (`sacrificeFilter: { types: "Land" }`, the Orcish Lumberjack
// shape) gated to the upkeep step via `activationPhaseRestriction: ["UPKEEP"]`
// (NO `controllerTurnOnly` — "any upkeep step", CR 602.5b). The +2/+2 counter is
// a layer-7d P/T counter (CR 122.1).
export const dwarvenArmory: CardDefinition = {
    id: "7d14a430-6e08-40cf-970a-cae84bba6ef7",
    name: "Dwarven Armory",
    rarity: "rare",
    oracleText:
        "{2}, Sacrifice a land: Put a +2/+2 counter on target creature. Activate only during any upkeep step.",
    manaCost: { X: 2, R: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "dwarven-armory-counter",
            oracleText:
                "{2}, Sacrifice a land: Put a +2/+2 counter on target creature. Activate only during any upkeep step.",
            cost: { mana: { X: 2 }, sacrificeFilter: { types: "Land" } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addCounter(target, "+2/+2", 1);
                }
            },
        },
    ],
};
// Errantry — DEFERRED (#656). The +3/+0 keyword-grant ships, but "can only
// attack alone" needs an attack restriction that reads the FULL declared-attacker
// set: `StaticAttackRestriction.predicate` sees only (self, defenderBattlefield),
// and attacker eligibility is validated one creature at a time (selectAttacker),
// so the count of other declared attackers isn't observable at validation time.
// Needs a count-of-attackers attack restriction (combat-restriction cluster).
// TODO(#628): implement.
// export const errantry: CardDefinition = {
//     id: "8346e741-61f8-4283-be51-f5f80e9595a5",
//     name: "Errantry",
//     rarity: "common",
//     oracleText: "Enchant creature\nEnchanted creature gets +3/+0 and can only attack alone.",
//     manaCost: { X: 1, R: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Flame Spirit — 2/3 with firebreathing "{R}: +1/+0 until end of turn" (CR 605
// activated ability, CR 611.1 temporary pump).
export const flameSpirit: CardDefinition = {
    id: "add2b82a-9aa5-4d5c-a1c2-e313541f12c8",
    name: "Flame Spirit",
    rarity: "uncommon",
    oracleText: "{R}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "flame-spirit-firebreathing",
            oracleText: "{R}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Flare — {2}{R} Instant. "Flare deals 1 damage to any target" (CR 120.1
// damage) plus the next-upkeep cantrip rider (CR 502.2 / 603.7d).
export const flare: CardDefinition = {
    id: "d5350236-7bd2-462d-9768-50087626c764",
    name: "Flare",
    rarity: "common",
    oracleText:
        "Flare deals 1 damage to any target.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t) ctx.dealDamage(t, 1);
        scheduleNextUpkeepDraw(ctx, flare.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Game of Chaos — {R}{R}{R} Sorcery. A coin-flip doubling loop (CR 705.2 reveal
// + CR 119/118 life swing). Each round the caster flips: on a WIN the caster
// gains `stake` life and the opponent loses `stake`, then the CASTER decides
// whether to flip again; on a LOSS the caster loses `stake` and the opponent
// gains `stake`, then the OPPONENT decides whether to flip again. `stake` starts
// at 1 and DOUBLES each round (CR 107 — "double the life stakes with each flip").
// Built entirely from shipped primitives: `requestCoinFlip` (suspending reveal)
// + `requestOptionChoice` (the alternating "flip again?" decision). Each round's
// flip and decision are keyed by stable round-indexed choiceIds, so the stepped
// resolution (CR 608.2) replays prior rounds' answers and suspends only on the
// first unresolved prompt. A hard cap bounds the loop (an unbounded coin-flip
// resolution can't terminate deterministically across replays); 64 rounds is far
// beyond any realistic game (stake 2^63).
const GAME_OF_CHAOS_MAX_ROUNDS = 64;
export const gameOfChaos: CardDefinition = {
    id: "08265332-2c0e-4c42-8c51-83ac20462eed",
    name: "Game of Chaos",
    rarity: "rare",
    oracleText:
        "Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you lose the flip, you lose 1 life and that opponent gains 1 life, and that player decides whether to flip again. Double the life stakes with each flip.",
    manaCost: { R: 3 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const opponent = target.id;
        const me = ctx.controller;
        let stake = 1;
        for (let round = 0; round < GAME_OF_CHAOS_MAX_ROUNDS; round++) {
            const won = ctx.requestCoinFlip({
                playerId: me,
                choiceId: `game-of-chaos-flip-${round}`,
                heads: {
                    consequence: `You gain ${stake} life; opponent loses ${stake} life.`,
                },
                tails: {
                    consequence: `You lose ${stake} life; opponent gains ${stake} life.`,
                },
            });
            if (won === undefined) return; // suspended for the reveal
            // Apply the life swing for this round.
            if (won) {
                ctx.gainLife(me, stake);
                ctx.loseLife(opponent, stake);
            } else {
                ctx.loseLife(me, stake);
                ctx.gainLife(opponent, stake);
            }
            // The winner of the flip decides whether to flip again (CR 705):
            // the caster on a win, the opponent on a loss.
            const decider = won ? me : opponent;
            const again = ctx.requestOptionChoice({
                playerId: decider,
                choiceId: `game-of-chaos-again-${round}`,
                prompt: "Flip again? (Game of Chaos — the life stakes double.)",
                options: [
                    { id: "yes", label: "Flip again" },
                    { id: "no", label: "Stop" },
                ],
            });
            if (again === undefined) return; // suspended for the decision
            if (again !== "yes") return;
            stake *= 2; // CR 107 — double the stakes each flip.
        }
    },
};
// Glacial Crevasses — "Sacrifice a snow Mountain: Prevent all combat damage
// that would be dealt this turn." The cost is a snow-typed sacrifice
// (CR 118.5 / 205.4a) via `sacrificeFilter` with `subtypes: "Mountain"` +
// `supertypes: ["Snow"]` (resolved live). The effect is `preventAllCombatDamage`
// (CR 615). Mana ability? No — it has no mana and uses the stack (CR 605.1a).
export const glacialCrevasses: CardDefinition = {
    id: "2726b192-f239-470b-8ad6-69887405e7f9",
    name: "Glacial Crevasses",
    rarity: "rare",
    oracleText:
        "Sacrifice a snow Mountain: Prevent all combat damage that would be dealt this turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "glacial-crevasses-fog",
            oracleText:
                "Sacrifice a snow Mountain: Prevent all combat damage that would be dealt this turn.",
            cost: {
                sacrificeFilter: {
                    types: "Land",
                    subtypes: "Mountain",
                    supertypes: ["Snow"],
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.preventAllCombatDamage();
            },
        },
    ],
};
// Goblin Mutant — {2}{R}{R} 5/3 Goblin Mutant with trample. Two combat
// restrictions, both `staticEffects`: an `attack-restriction` (CR 508.1c) whose
// predicate scans the defending player's battlefield for an untapped creature of
// power 3+, and a `block-restriction` on side "blocker" (CR 509.1b) rejecting
// attackers of power 3+. Power is read from the live `PermanentView.power`
// (effective P/T, mirroring leg.ts's power-gated combat predicates).
export const goblinMutant: CardDefinition = {
    id: "6db54f95-6652-45a3-b960-c2fc118beca1",
    name: "Goblin Mutant",
    rarity: "uncommon",
    oracleText:
        "Trample\nThis creature can't attack if defending player controls an untapped creature with power 3 or greater.\nThis creature can't block creatures with power 3 or greater.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Goblin", "Mutant"],
    power: 5,
    toughness: 3,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "goblin-mutant-no-attack-vs-big",
            // Legal to attack UNLESS the defender controls an untapped
            // creature with power >= 3 (CR 508.1c).
            predicate: (_self, defenderBattlefield) =>
                !defenderBattlefield.some(
                    (p) =>
                        p.types.includes("Creature") &&
                        !p.isTapped &&
                        (p.power ?? 0) >= 3
                ),
            oracleText:
                "This creature can't attack if defending player controls an untapped creature with power 3 or greater.",
        },
        {
            kind: "block-restriction",
            id: "goblin-mutant-no-block-big",
            side: "blocker",
            // self = Goblin Mutant (blocker), opponent = attacker. Legal block
            // only when the attacker's power is < 3 (CR 509.1b).
            predicate: (_self, attacker) => (attacker.power ?? 0) < 3,
            oracleText:
                "This creature can't block creatures with power 3 or greater.",
        },
    ],
};
// Goblin Sappers — {1}{R} 1/1 Goblin. Two activated abilities (CR 605); both
// make a creature you control unblockable this turn (`setCantBeBlockedThisTurn`)
// and schedule an end-of-combat destroy via `scheduleDelayedTrigger`
// ("next-end-of-combat", CR 603.7a). The {R}{R} leg also destroys Goblin Sappers
// itself; the {R}{R}{R}{R} leg destroys only the chosen creature. The delayed
// trigger reads the target / self ids from its serialized payload.
const GOBLIN_SAPPERS_ID = "de839540-a7b9-4f91-91df-3fd4f5c0bc4e";
export const goblinSappers: CardDefinition = {
    id: GOBLIN_SAPPERS_ID,
    name: "Goblin Sappers",
    rarity: "common",
    oracleText:
        "{R}{R}, {T}: Target creature you control can't be blocked this turn. Destroy it and this creature at end of combat.\n{R}{R}{R}{R}, {T}: Target creature you control can't be blocked this turn. Destroy it at end of combat.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-sappers-rr",
            oracleText:
                "{R}{R}, {T}: Target creature you control can't be blocked this turn. Destroy it and this creature at end of combat.",
            cost: { mana: { R: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.setCantBeBlockedThisTurn(target);
                ctx.scheduleDelayedTrigger(
                    GOBLIN_SAPPERS_ID,
                    "goblin-sappers-destroy-both",
                    "next-end-of-combat",
                    { creatureId: target.id, sappersId: ctx.sourceInstanceId }
                );
            },
        },
        {
            id: "goblin-sappers-rrrr",
            oracleText:
                "{R}{R}{R}{R}, {T}: Target creature you control can't be blocked this turn. Destroy it at end of combat.",
            cost: { mana: { R: 4 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.setCantBeBlockedThisTurn(target);
                ctx.scheduleDelayedTrigger(
                    GOBLIN_SAPPERS_ID,
                    "goblin-sappers-destroy-target",
                    "next-end-of-combat",
                    { creatureId: target.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "goblin-sappers-destroy-both",
            oracleText:
                "Destroy that creature and Goblin Sappers at end of combat.",
            timing: "next-end-of-combat",
            resolve: (ctx, payload) => {
                if (payload.creatureId)
                    ctx.destroy({
                        type: "permanent",
                        id: payload.creatureId,
                    });
                if (payload.sappersId)
                    ctx.destroy({ type: "permanent", id: payload.sappersId });
            },
        },
        {
            id: "goblin-sappers-destroy-target",
            oracleText: "Destroy that creature at end of combat.",
            timing: "next-end-of-combat",
            resolve: (ctx, payload) => {
                if (payload.creatureId)
                    ctx.destroy({
                        type: "permanent",
                        id: payload.creatureId,
                    });
            },
        },
    ],
};
// Goblin Ski Patrol — "{1}{R}: +2/+0 and gains flying. Sacrifice it at the
// beginning of the next end step. Activate only once and only if you control a
// snow Mountain." (CR 205.4a snow gate.) The pump/flying ride until end of turn
// (the creature is sacrificed by then anyway); a `next-end-step` delayed trigger
// sacrifices it. "Activate only once" is `oncePerTurn` (functionally once, since
// it self-destructs the same turn). The snow-Mountain gate is read in
// `canActivate` via a snow-aware battlefield scan.
const GOBLIN_SKI_PATROL_ID = "fde1c8b5-1e01-4920-8d02-bf80d5b238c5";
export const goblinSkiPatrol: CardDefinition = {
    id: GOBLIN_SKI_PATROL_ID,
    name: "Goblin Ski Patrol",
    rarity: "common",
    oracleText:
        "{1}{R}: This creature gets +2/+0 and gains flying. Its controller sacrifices it at the beginning of the next end step. Activate only once and only if you control a snow Mountain.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-ski-patrol-charge",
            oracleText:
                "{1}{R}: This creature gets +2/+0 and gains flying. Its controller sacrifices it at the beginning of the next end step. Activate only once and only if you control a snow Mountain.",
            cost: { mana: { X: 1, R: 1 } },
            useStack: true,
            oncePerTurn: true,
            canActivate: (source, state) => {
                const me = source.controllerId;
                const controller = state.players.find((p) => p.id === me);
                if (!controller) return false;
                return controlsSnowSubtype(controller.battlefield, "Mountain");
            },
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.addTemporaryPTBuff(self, 2, 0, { phase: "end-of-turn" });
                ctx.grantStaticAbility(self, "flying", {
                    phase: "end-of-turn",
                });
                ctx.scheduleDelayedTrigger(
                    GOBLIN_SKI_PATROL_ID,
                    "goblin-ski-patrol-sacrifice",
                    "next-end-step",
                    { selfId: ctx.sourceInstanceId }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "goblin-ski-patrol-sacrifice",
            oracleText:
                "Its controller sacrifices it at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (payload.selfId) ctx.sacrifice(payload.selfId);
            },
        },
    ],
};
// Goblin Snowman — "Whenever this creature blocks, prevent all combat damage to
// and dealt by it this turn" (CR 509.4 block trigger, fired off
// BLOCKERS_CONFIRMED matching self; CR 615 two-way prevention) plus "{T}: deals
// 1 damage to target creature it's blocking" (the "it's blocking" restriction is
// enforced at resolve via the live block graph, CR 509.1).
export const goblinSnowman: CardDefinition = {
    id: "5bbb260a-6763-4d1c-a009-4e34cd572519",
    name: "Goblin Snowman",
    rarity: "uncommon",
    oracleText:
        "Whenever this creature blocks, prevent all combat damage that would be dealt to and dealt by it this turn.\n{T}: This creature deals 1 damage to target creature it's blocking.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "goblin-snowman-block-prevent",
            oracleText:
                "Whenever this creature blocks, prevent all combat damage that would be dealt to and dealt by it this turn.",
            // BLOCKERS_CONFIRMED fires once per attacker-blocker pair; match
            // only the pair whose blocker is self so the prevention is set once.
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) =>
                event.type === "BLOCKERS_CONFIRMED" &&
                event.blockerId === self.id,
            resolve: (ctx) => {
                ctx.preventAllCombatDamageToAndBy(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    activatedAbilities: [
        {
            id: "goblin-snowman-ping",
            oracleText:
                "{T}: This creature deals 1 damage to target creature it's blocking.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                // "it's blocking" — only deal the damage if Goblin Snowman is
                // currently blocking the targeted attacker (CR 509.1).
                const blockers = ctx.getBlockersByAttacker()[target.id] ?? [];
                if (!blockers.includes(ctx.sourceInstanceId)) return;
                ctx.dealDamage(target, 1);
            },
        },
    ],
};
// Grizzled Wolverine — {1}{R}{R} 2/2 Wolverine. "{R}: +2/+0 until end of turn.
// Activate only during the declare blockers step, only if at least one creature
// is blocking this creature, and only once each turn." Three activation gates:
// `activationPhaseRestriction: ["DECLARE_BLOCKERS"]` (CR 602.5b step), `oncePerTurn`
// (CR 602.5f — engine tracks `activationsThisTurn`), and a `canActivate` predicate
// that reads the live block graph (`state.combat.blockerAssignments`, CR 509.2)
// to confirm some blocker is assigned to this creature.
export const grizzledWolverine: CardDefinition = {
    id: "95bb17b9-55c4-4cc1-83f6-75490b9a97d0",
    name: "Grizzled Wolverine",
    rarity: "common",
    oracleText:
        "{R}: This creature gets +2/+0 until end of turn. Activate only during the declare blockers step, only if at least one creature is blocking this creature, and only once each turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Wolverine"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "grizzled-wolverine-pump",
            oracleText:
                "{R}: This creature gets +2/+0 until end of turn. Activate only during the declare blockers step, only if at least one creature is blocking this creature, and only once each turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            activationPhaseRestriction: ["DECLARE_BLOCKERS"],
            oncePerTurn: true,
            canActivate: (source, state) => {
                const assignments = state.combat?.blockerAssignments;
                if (!assignments) return false;
                // CR 509.2 — some blocker is assigned to this creature.
                return Object.values(assignments).some((atks) =>
                    atks.includes(source.id)
                );
            },
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    2,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Imposing Visage — Aura granting menace (CR 702.111, layer 6 keyword-grant on
// the host).
export const imposingVisage: CardDefinition = {
    id: "cca42b74-9b42-482b-b12a-79cafdcd087e",
    name: "Imposing Visage",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature has menace. (It can't be blocked except by two or more creatures.)",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "menace",
        },
    ],
};
// Incinerate — 3 damage to any target; a creature dealt damage this way can't be
// regenerated this turn (CR 120.1 damage, CR 701.15c regen-lock). The damage is
// dealt first, then the target-scoped regen-lock is applied to a creature.
export const incinerate: CardDefinition = {
    id: "9c3f00af-010d-4485-b8b7-47400d99c496",
    name: "Incinerate",
    rarity: "common",
    oracleText:
        "Incinerate deals 3 damage to any target. A creature dealt damage this way can't be regenerated this turn.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t) return;
        if (t.type === "permanent") {
            ctx.setTargetCantBeRegeneratedThisTurn(t);
        }
        ctx.dealDamage(t, 3);
    },
};
// Jokulhaups — "Destroy all artifacts, creatures, and lands. They can't be
// regenerated." (CR 701.7 destroy + CR 701.15c regen suppression.)
export const jokulhaups: CardDefinition = {
    id: "3bf0d325-5928-4593-8faa-64ffa414cb48",
    name: "Jokulhaups",
    rarity: "rare",
    oracleText:
        "Destroy all artifacts, creatures, and lands. They can't be regenerated.",
    manaCost: { X: 4, R: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll(["Artifact", "Creature", "Land"], {
            cantBeRegenerated: true,
        });
    },
};
// Karplusan Giant — "Tap an untapped snow land you control: +1/+1 until end of
// turn." The cost is a `tapOtherFilter` over snow lands (CR 118.8 / 205.4a),
// resolved live so Melting / Arcum's Weathervane mutations gate the cost. The
// effect is a +1/+1 self-pump until end of turn.
export const karplusanGiant: CardDefinition = {
    id: "c524ac2a-294c-4b19-b00b-999e370a3b95",
    name: "Karplusan Giant",
    rarity: "uncommon",
    oracleText:
        "Tap an untapped snow land you control: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 6, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "karplusan-giant-pump",
            oracleText:
                "Tap an untapped snow land you control: This creature gets +1/+1 until end of turn.",
            cost: {
                tapOtherFilter: {
                    filter: {
                        types: "Land",
                        supertypes: ["Snow"],
                        controllerRelation: "you",
                    },
                    count: 1,
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Karplusan Yeti — "{T}: This creature deals damage equal to its power to target
// creature. That creature deals damage equal to its power to this creature." —
// the mutual-damage "fight" shape (CR 701.12-style), expressed with the `fight`
// primitive which snapshots both powers and deals simultaneously.
export const karplusanYeti: CardDefinition = {
    id: "7dd9b214-d9fe-4c2e-b45b-7145ad98c408",
    name: "Karplusan Yeti",
    rarity: "rare",
    oracleText:
        "{T}: This creature deals damage equal to its power to target creature. That creature deals damage equal to its power to this creature.",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Yeti"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "karplusan-yeti-fight",
            oracleText:
                "{T}: This creature deals damage equal to its power to target creature. That creature deals damage equal to its power to this creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.fight(target);
            },
        },
    ],
};
// Lava Burst — "Lava Burst deals X damage to any target." (CR 120.1, X folded
// from the cost.)
//
// DEFERRED (documented simplification, NOT a card-specific primitive — same gap
// as DRK Whippoorwill): the rider "If Lava Burst would deal damage to a
// creature, that damage can't be prevented or dealt instead to another permanent
// or player" is an anti-prevention / anti-redirection lock for which no engine
// primitive exists. It is a narrow rider (matters only against active Fog-style
// prevention or redirection) and does not change the spell's primary function.
// Flagged for the prevention-lock cluster.
export const lavaBurst: CardDefinition = {
    id: "79dc0e20-5790-4927-8432-cf0e9b7381d4",
    name: "Lava Burst",
    rarity: "common",
    oracleText:
        "Lava Burst deals X damage to any target. If Lava Burst would deal damage to a creature, that damage can't be prevented or dealt instead to another permanent or player.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t) ctx.dealDamage(t, ctx.getX());
    },
};
// Márton Stromgald — {2}{R}{R} 1/1 Legendary Human Knight. Two combat triggers
// (CR 603.6 — "whenever ~ attacks/blocks"), each pumping the OTHER attackers /
// blockers by +N/+N where N is the number of attacking / blocking creatures
// OTHER than Márton (CR 611.1 temporary buff). The trigger reads the live combat
// role of every battlefield creature: attackers via `getIsAttacking`, blockers
// via the block graph (`getBlockersByAttacker`). The stale "needs primitive"
// comment was wrong — `getIsAttacking` + `addTemporaryPTBuff` suffice (#656).
export const mRtonStromgald: CardDefinition = {
    id: "7880e815-53e7-43e0-befd-e368f00a75d8",
    name: "Márton Stromgald",
    rarity: "rare",
    oracleText:
        "Whenever Márton Stromgald attacks, other attacking creatures get +1/+1 until end of turn for each attacking creature other than Márton Stromgald.\nWhenever Márton Stromgald blocks, other blocking creatures get +1/+1 until end of turn for each blocking creature other than Márton Stromgald.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "marton-attack-pump",
            oracleText:
                "Whenever Márton Stromgald attacks, other attacking creatures get +1/+1 until end of turn for each attacking creature other than Márton Stromgald.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                // All attacking creatures other than Márton (CR 508.1).
                const others: string[] = [];
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                    })) {
                        if (id === ctx.sourceInstanceId) continue;
                        if (ctx.getIsAttacking(id)) others.push(id);
                    }
                }
                const n = others.length;
                if (n === 0) return;
                for (const id of others) {
                    ctx.addTemporaryPTBuff({ type: "permanent", id }, n, n, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
        {
            id: "marton-block-pump",
            oracleText:
                "Whenever Márton Stromgald blocks, other blocking creatures get +1/+1 until end of turn for each blocking creature other than Márton Stromgald.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) =>
                event.type === "BLOCKERS_CONFIRMED" &&
                event.blockerId === self.id,
            resolve: (ctx) => {
                // All blocking creatures other than Márton, deduped across the
                // block graph (a blocker may block multiple attackers, CR 509.2).
                const blockers = new Set<string>();
                for (const ids of Object.values(ctx.getBlockersByAttacker())) {
                    for (const id of ids) {
                        if (id !== ctx.sourceInstanceId) blockers.add(id);
                    }
                }
                const n = blockers.size;
                if (n === 0) return;
                for (const id of blockers) {
                    ctx.addTemporaryPTBuff({ type: "permanent", id }, n, n, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// TODO(#628): implement.
// export const melee: CardDefinition = {
//     id: "b13a064d-bff4-4a48-a158-1b61951b0ac3",
//     name: "Melee",
//     rarity: "uncommon",
//     oracleText: "Cast this spell only during combat on your turn before blockers are declared.\nYou choose which creatures block this combat and how those creatures block.\nWhenever a creature attacks and isn't blocked this combat, untap it and remove it from combat.",
//     manaCost: { X: 4, R: 1 },
//     types: ["Instant"],
// };
// Melting — "All lands are no longer snow." A board-wide continuous
// supertype-set static (CR 205.4a, layer-4-adjacent) that REMOVES the Snow
// supertype from every Land while Melting is in play; `hasSupertype` reads the
// removal so snow-matters effects (Drift of the Dead, Cold Snap, snow landwalk,
// snow targets) see no snow lands. Restored when Melting leaves play.
export const melting: CardDefinition = {
    id: "8d90065e-2c7e-44e5-9f59-015d468214bf",
    name: "Melting",
    rarity: "uncommon",
    oracleText: "All lands are no longer snow.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "supertype-set",
            applies: (target) => target.types.includes("Land"),
            remove: ["Snow"],
        },
    ],
};
// TODO(#628): implement.
// export const meteorShower: CardDefinition = {
//     id: "50b4851e-677b-468e-9baa-e47a3b4b8339",
//     name: "Meteor Shower",
//     rarity: "common",
//     oracleText: "Meteor Shower deals X plus 1 damage divided as you choose among any number of targets.",
//     manaCost: { X: "XX", R: 1 },
//     types: ["Sorcery"],
// };
// Mountain Goat — 1/1 with mountainwalk (CR 702.13 landwalk; unblockable while
// the defender controls a Mountain).
export const mountainGoat: CardDefinition = {
    id: "ccf70276-a40c-4d25-b584-4c8a07a00602",
    name: "Mountain Goat",
    rarity: "common",
    oracleText:
        "Mountainwalk (This creature can't be blocked as long as defending player controls a Mountain.)",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goat"],
    power: 1,
    toughness: 1,
    staticAbilities: ["mountainwalk"],
};
// Mudslide — {2}{R} Enchantment. Symmetric untap-lock on non-flying creatures
// (CR 611 — `untapRestriction` with `excludeAbility: "flying"`, maxUntap 0) plus
// a per-upkeep pay-{2}-to-untap escape for each player (the Thelon's Curse / FEM
// shape: `phaseTrigger("UPKEEP", scope "each")` + a per-candidate `requestMayPay`
// of {2}, untapping each one whose cost is paid, CR 117.3a).
export const mudslide: CardDefinition = {
    id: "65acce56-8674-471e-9d5e-91b7e3f672c1",
    name: "Mudslide",
    rarity: "rare",
    oracleText:
        "Creatures without flying don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player may choose any number of tapped creatures without flying they control and pay {2} for each creature chosen this way. If the player does, untap those creatures.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "mudslide-nonflying-lock",
            oracleText:
                "Creatures without flying don't untap during their controllers' untap steps (Mudslide).",
            filter: { types: "Creature", excludeAbility: "flying" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "mudslide-untap-escape",
            oracleText:
                "At the beginning of each player's upkeep, that player may choose any number of tapped creatures without flying they control and pay {2} for each creature chosen this way. If the player does, untap those creatures.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                const player = scopedPlayerId;
                const candidates = ctx
                    .getBattlefieldIds(player, {
                        types: "Creature",
                        excludeAbility: "flying",
                    })
                    .filter((id) => ctx.getIsTapped({ type: "permanent", id }));
                if (candidates.length === 0) return;
                // CR 117.3a — one may-pay of {2} per candidate; untap each one
                // whose cost the player chooses to pay.
                for (const id of candidates) {
                    const paid = ctx.requestMayPay({
                        playerId: player,
                        choiceId: `mudslide-untap-${id}`,
                        cost: { X: 2 },
                        prompt: "Pay {2} to untap this creature (Mudslide)?",
                    });
                    if (paid === undefined) return; // suspended for the choice
                    if (paid) ctx.untap({ type: "permanent", id });
                }
            },
        }),
    ],
};
// Orcish Cannoneers — "{T}: This creature deals 2 damage to any target and 3
// damage to you." (CR 605 activated ability, CR 120.1 damage — both legs are
// real damage, the self-damage hits the controller as a player.)
export const orcishCannoneers: CardDefinition = {
    id: "a4309a2f-27f5-4652-b0b4-6a6119436f75",
    name: "Orcish Cannoneers",
    rarity: "uncommon",
    oracleText:
        "{T}: This creature deals 2 damage to any target and 3 damage to you.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Orc", "Warrior"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "orcish-cannoneers-fire",
            oracleText:
                "{T}: This creature deals 2 damage to any target and 3 damage to you.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 2);
                ctx.dealDamage({ type: "player", id: ctx.controller }, 3);
            },
        },
    ],
};
// Orcish Conscripts — DEFERRED (#656). "Can't attack/block unless at least two
// OTHER creatures attack/block" needs the same count-of-declared-attackers (and
// count-of-declared-blockers) restriction Errantry needs — not observable with
// today's per-creature `StaticAttackRestriction` / `block-restriction` predicates.
// Flagged for the combat-restriction cluster.
// TODO(#628): implement.
// export const orcishConscripts: CardDefinition = {
//     id: "e71394f8-3038-4cad-adea-a704f004777f",
//     name: "Orcish Conscripts",
//     rarity: "common",
//     oracleText: "This creature can't attack unless at least two other creatures attack.\nThis creature can't block unless at least two other creatures block.",
//     manaCost: { R: 1 },
//     types: ["Creature"],
//     subtypes: ["Orc"],
//     power: 2,
//     toughness: 2,
// };
// TODO(#628): implement.
// export const orcishFarmer: CardDefinition = {
//     id: "efa5beef-d609-4809-a813-621b0b4cff7f",
//     name: "Orcish Farmer",
//     rarity: "common",
//     oracleText: "{T}: Target land becomes a Swamp until its controller's next untap step.",
//     manaCost: { X: 1, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Orc"],
//     power: 2,
//     toughness: 2,
// };
// Orcish Healer — three activated abilities (CR 605, CR 701.15c regen-lock /
// CR 701.15a regeneration shield): a regen-lock on any creature, and two
// regenerate-a-black-or-green-creature legs differing only in their mana cost
// (the black/green target restriction uses `colorFilterAny`).
export const orcishHealer: CardDefinition = {
    id: "7ff511f3-416e-4919-acd6-fd8183bf5c60",
    name: "Orcish Healer",
    rarity: "uncommon",
    oracleText:
        "{R}{R}, {T}: Target creature can't be regenerated this turn.\n{B}{B}{R}, {T}: Regenerate target black or green creature.\n{R}{G}{G}, {T}: Regenerate target black or green creature.",
    manaCost: { R: 2 },
    types: ["Creature"],
    subtypes: ["Orc", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "orcish-healer-regen-lock",
            oracleText:
                "{R}{R}, {T}: Target creature can't be regenerated this turn.",
            cost: { mana: { R: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent")
                    ctx.setTargetCantBeRegeneratedThisTurn(target);
            },
        },
        {
            id: "orcish-healer-regen-br",
            oracleText:
                "{B}{B}{R}, {T}: Regenerate target black or green creature.",
            cost: { mana: { B: 2, R: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["B", "G"],
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent")
                    ctx.applyRegenerationShield(target);
            },
        },
        {
            id: "orcish-healer-regen-rg",
            oracleText:
                "{R}{G}{G}, {T}: Regenerate target black or green creature.",
            cost: { mana: { R: 1, G: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["B", "G"],
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent")
                    ctx.applyRegenerationShield(target);
            },
        },
    ],
};
// Orcish Librarian — DEFERRED (#656). `peekLibraryTop(8)` + `reorderLibraryTop`
// cover the "look at top eight / put the rest on top in any order" legs, but
// "exile four of them AT RANDOM" has no SpellContext primitive: the seeded PRNG
// is engine-internal and only `discardAtRandom` is exposed (no random-select /
// random-exile from a library set). Flagged for a random-select primitive.
// TODO(#628): implement.
// export const orcishLibrarian: CardDefinition = {
//     id: "8ed908d6-6d06-4ccb-9577-37ef2d01c1a5",
//     name: "Orcish Librarian",
//     rarity: "rare",
//     oracleText: "{R}, {T}: Look at the top eight cards of your library. Exile four of them at random, then put the rest on top of your library in any order.",
//     manaCost: { X: 1, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Orc"],
//     power: 1,
//     toughness: 1,
// };
// Orcish Lumberjack — "{T}, Sacrifice a Forest: Add three mana in any
// combination of {R} and/or {G}." A mana ability (CR 605.1a, `useStack: false`)
// whose Forest sacrifice cost uses `sacrificeFilter`; "any combination of R/G"
// (3 mana) is enumerated as the four discrete `manaChoices` RRR/RRG/RGG/GGG.
export const orcishLumberjack: CardDefinition = {
    id: "21ef13e3-658c-43a3-a290-4c5dde8e8b55",
    name: "Orcish Lumberjack",
    rarity: "common",
    oracleText:
        "{T}, Sacrifice a Forest: Add three mana in any combination of {R} and/or {G}.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "orcish-lumberjack-mana",
            oracleText:
                "{T}, Sacrifice a Forest: Add three mana in any combination of {R} and/or {G}.",
            cost: { tap: true, sacrificeFilter: { subtypes: "Forest" } },
            useStack: false,
            manaChoices: [{ R: 3 }, { R: 2, G: 1 }, { R: 1, G: 2 }, { G: 3 }],
            effect: (ctx) => {
                // Representative leg; the engine applies the player's chosen
                // entry from `manaChoices` at activation time.
                ctx.addMana({ R: 3 });
            },
        },
    ],
};
// Orcish Squatters — {4}{R} 2/3 Orc. "Whenever this creature attacks and isn't
// blocked, you may gain control of target land defending player controls for as
// long as you control this creature. If you do, this creature assigns no combat
// damage this turn." Fires off `ATTACKER_UNBLOCKED` (the Murk Dwellers shape).
// The optional "target land" is picked via `requestChoice` (min 0 = decline);
// control is taken with a `controller-controls-source` condition (CR 611.2b — the
// shipped "for as long as you control this" control change), and the unblocked
// Squatters is marked to assign no combat damage (`markAssignsNoCombatDamage`).
const ORCISH_SQUATTERS_ID = "f3ee7bd5-612b-4916-a914-1294805b8f64";
export const orcishSquatters: CardDefinition = {
    id: ORCISH_SQUATTERS_ID,
    name: "Orcish Squatters",
    rarity: "rare",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may gain control of target land defending player controls for as long as you control this creature. If you do, this creature assigns no combat damage this turn.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        {
            id: "orcish-squatters-steal-land",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may gain control of target land defending player controls for as long as you control this creature. If you do, this creature assigns no combat damage this turn.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx) => {
                const defender = ctx.allPlayerIds.find(
                    (pid) => pid !== ctx.controller
                );
                if (!defender) return;
                // CR 117.3a — "you may": choose 0 (decline) or 1 land the
                // defending player controls.
                const picked = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `orcish-squatters-land-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: defender,
                    filter: { types: "Land" },
                    count: { min: 0, max: 1 },
                    prompt: "Gain control of a land the defending player controls? (Orcish Squatters)",
                });
                if (picked === undefined) return; // suspended for the choice
                const landId = picked[0];
                if (!landId) return; // declined
                ctx.gainControl(
                    { type: "permanent", id: landId },
                    ctx.controller,
                    {
                        kind: "controller-controls-source",
                        controllerId: ctx.controller,
                    }
                );
                // "If you do, this creature assigns no combat damage this turn."
                ctx.markAssignsNoCombatDamage({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// Panic — {R} Instant. "Cast this spell only during combat before blockers are
// declared" (CR 601.3e cast restriction, via `castPhaseRestriction` —
// BEGINNING_OF_COMBAT + DECLARE_ATTACKERS, Blaze of Glory pattern); "Target
// creature can't block this turn" (CR 509.1b, via `setCantBlockThisTurn`) plus
// the next-upkeep cantrip rider.
export const panic: CardDefinition = {
    id: "a9ab85ac-311c-4e36-943a-817e43a3c8a8",
    name: "Panic",
    rarity: "common",
    oracleText:
        "Cast this spell only during combat before blockers are declared.\nTarget creature can't block this turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { R: 1 },
    types: ["Instant"],
    castPhaseRestriction: ["BEGINNING_OF_COMBAT", "DECLARE_ATTACKERS"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") ctx.setCantBlockThisTurn(t);
        scheduleNextUpkeepDraw(ctx, panic.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Pyroblast — modal "choose one" (CR 700.2): counter a blue spell OR destroy a
// blue permanent. The colour-mirror of Hydroblast, gating each mode's target on
// blue via `colorFilter: "U"`.
export const pyroblast: CardDefinition = {
    id: "c342cac5-08ae-4428-9c2c-f6c5904e54d2",
    name: "Pyroblast",
    rarity: "common",
    oracleText:
        "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue.",
    manaCost: { R: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "counter",
            label: "Counter target blue spell",
            oracleText: "Counter target spell if it's blue.",
            targetRequirement: { type: "spell", count: 1, colorFilter: "U" },
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (t?.type === "spell") ctx.counter(t);
            },
        },
        {
            id: "destroy",
            label: "Destroy target blue permanent",
            oracleText: "Destroy target permanent if it's blue.",
            targetRequirement: { type: "any", count: 1, colorFilter: "U" },
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.destroy(t);
            },
        },
    ],
};
// Pyroclasm — "Pyroclasm deals 2 damage to each creature." (CR 120.3 — a
// symmetric sweep over every creature.)
export const pyroclasm: CardDefinition = {
    id: "88040748-ad76-4b9a-bd4e-87e5980e9816",
    name: "Pyroclasm",
    rarity: "uncommon",
    oracleText: "Pyroclasm deals 2 damage to each creature.",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(2, { creatures: true });
    },
};
// Sabretooth Tiger — 2/1 with first strike (CR 702.7).
export const sabretoothTiger: CardDefinition = {
    id: "6914c5a8-2114-41c5-a471-ca97524d622f",
    name: "Sabretooth Tiger",
    rarity: "common",
    oracleText: "First strike",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 2,
    toughness: 1,
    staticAbilities: ["first strike"],
};
// Shatter — ICE reprint of the LEA instant ("Destroy target artifact").
// CardPrint onto the LEA definition (ADR 0014).
export const shatterIce: CardPrint = {
    printId: "7eb18d53-20de-43d7-86f7-97a6d14d54b8",
    definitionId: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e",
    setCode: "ice",
    rarity: "common",
};
// Stone Rain — ICE reprint of the LEA sorcery ("Destroy target land").
// CardPrint onto the LEA definition (ADR 0014).
export const stoneRainIce: CardPrint = {
    printId: "5a002e6d-ea59-4694-b3e5-075d6020b0d9",
    definitionId: "57ff74cb-a2ed-4123-ac42-f72f9820049e",
    setCode: "ice",
    rarity: "common",
};
// Stone Spirit — 4/3 "can't be blocked by creatures with flying" (CR 509.1b
// block restriction; the predicate rejects candidate blockers whose
// `staticAbilities` include flying).
export const stoneSpirit: CardDefinition = {
    id: "789dfae7-fe23-4e2e-9f5f-304535d22a78",
    name: "Stone Spirit",
    rarity: "uncommon",
    oracleText: "This creature can't be blocked by creatures with flying.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 4,
    toughness: 3,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "stone-spirit-no-flying-blockers",
            side: "attacker",
            // self = Stone Spirit (attacker), opponent = candidate blocker.
            // The block-restriction PermanentView carries keywords on
            // `staticAbilities` (cast, mirroring leg.ts's Wall/flying check).
            predicate: (_self, opponent) =>
                !(
                    (opponent as { staticAbilities?: string[] })
                        .staticAbilities ?? []
                ).includes("flying"),
            oracleText:
                "This creature can't be blocked by creatures with flying.",
        },
    ],
};
// Stonehands — Aura: static +0/+2 (layer 7c) plus an activated "{R}: Enchanted
// creature gets +1/+0 until end of turn" pump (CR 605 / CR 611.1) that resolves
// the host via `getAttachedTo`.
export const stonehands: CardDefinition = {
    id: "d23fa1af-78e5-4d23-bbf6-cd62bc54b4e9",
    name: "Stonehands",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature gets +0/+2.\n{R}: Enchanted creature gets +1/+0 until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 0, toughness: 2 },
    ],
    activatedAbilities: [
        {
            id: "stonehands-pump",
            oracleText: "{R}: Enchanted creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Tor Giant — {3}{R} 3/3 vanilla Giant (CR 302).
export const torGiant: CardDefinition = {
    id: "7ef8f279-1a10-4685-99d6-bc971a7f922b",
    name: "Tor Giant",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 3,
};
// Total War — {3}{R} Enchantment. "Whenever a player attacks with one or more
// creatures, destroy all untapped non-Wall creatures that player controls that
// didn't attack, except for creatures the player hasn't controlled continuously
// since the beginning of the turn." A GLOBAL attack trigger (CR 603.6 — fires on
// ANY player's ATTACKERS_DECLARED, not just self's controller). The stale stub
// flagged "continuous attack-trigger destroy" / "controlled continuously" as
// needing a primitive; both ship: the trigger fires once per declaration, and
// "controlled continuously since the beginning of the turn" is exactly
// `!isSummoningSick` (CR 302.6 — a creature is summoning-sick iff it has NOT been
// under that player's control since their most recent turn began). The resolve
// iterates the attacking player's creatures and destroys each that is untapped,
// non-Wall, not attacking, and not summoning-sick (composable `ctx.destroy`
// rather than `destroyAll`, which can't express the "didn't attack" exclusion).
export const totalWar: CardDefinition = {
    id: "6107388b-ec1e-401e-a407-a821c908ed8d",
    name: "Total War",
    rarity: "rare",
    oracleText:
        "Whenever a player attacks with one or more creatures, destroy all untapped non-Wall creatures that player controls that didn't attack, except for creatures the player hasn't controlled continuously since the beginning of the turn.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "total-war-mass-destroy",
            oracleText:
                "Whenever a player attacks with one or more creatures, destroy all untapped non-Wall creatures that player controls that didn't attack, except for creatures the player hasn't controlled continuously since the beginning of the turn.",
            event: "ATTACKERS_DECLARED",
            // Fires on any attack (CR 508.1) — the enchantment isn't a combatant.
            matches: (event) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.length > 0,
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKERS_DECLARED") return;
                const attackerPlayer = event.attackingPlayerId;
                for (const id of ctx.getBattlefieldIds(attackerPlayer, {
                    types: "Creature",
                })) {
                    const sel: TargetSelection = { type: "permanent", id };
                    if (ctx.getIsAttacking(id)) continue; // it attacked
                    if (ctx.getIsTapped(sel)) continue; // not untapped
                    if (ctx.hasSubtype(sel, "Wall")) continue; // Wall exclusion
                    // "except for creatures the player hasn't controlled
                    // continuously since the beginning of the turn" — i.e. skip
                    // summoning-sick creatures (CR 302.6).
                    if (ctx.isSummoningSick(sel)) continue;
                    ctx.destroy(sel);
                }
            },
        },
    ],
};
// Vertigo — "2 damage to target creature with flying. That creature loses
// flying until end of turn." (CR 120.1 damage + CR 611.1b layer-6 keyword
// removal.) The flying-target restriction uses `requireAbility: "flying"`; the
// loss is `removeStaticAbilities` scoped to flying, until end of turn.
export const vertigo: CardDefinition = {
    id: "3067e7af-7bbd-48c1-9f1d-df2a91a0ec54",
    name: "Vertigo",
    rarity: "uncommon",
    oracleText:
        "Vertigo deals 2 damage to target creature with flying. That creature loses flying until end of turn.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, requireAbility: "flying" },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        ctx.dealDamage(t, 2);
        ctx.removeStaticAbilities(t, (kw) => kw === "flying", {
            phase: "end-of-turn",
        });
    },
};
// Wall of Lava — 1/3 Wall with defender and firebreathing "{R}: +1/+1 until end
// of turn" (CR 702.3 defender, CR 605 / CR 611.1 pump).
export const wallOfLava: CardDefinition = {
    id: "b99d6d11-b3f7-4d73-967c-3049af82a9d8",
    name: "Wall of Lava",
    rarity: "uncommon",
    oracleText:
        "Defender (This creature can't attack.)\n{R}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 3,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-lava-pump",
            oracleText: "{R}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Word of Blasting — "Destroy target Wall. It can't be regenerated. Deals damage
// equal to that Wall's mana value to the Wall's controller." (CR 701.7 destroy +
// CR 701.15c regen-lock + CR 120.1 damage.) The Wall's mana value and controller
// are read BEFORE the destroy; the target uses a Wall subtype restriction.
export const wordOfBlasting: CardDefinition = {
    id: "46b383c8-d604-4131-a869-9e9d13e30b94",
    name: "Word of Blasting",
    rarity: "uncommon",
    oracleText:
        "Destroy target Wall. It can't be regenerated. Word of Blasting deals damage equal to that Wall's mana value to the Wall's controller.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, subtypeFilter: "Wall" },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        const mv = ctx.getManaValue(t);
        const controller = ctx.getController(t);
        ctx.destroy(t, { cantBeRegenerated: true });
        if (mv > 0) ctx.dealDamage({ type: "player", id: controller }, mv);
    },
};
// Aurochs — {3}{G} 2/3 Aurochs with trample. "Whenever this creature attacks, it
// gets +1/+0 until end of turn for each OTHER attacking Aurochs" (CR 603.6 attack
// trigger + CR 611.1 self pump). The resolve counts attacking creatures with the
// Aurochs subtype other than self (`getIsAttacking` + `hasSubtype`) and grants
// +N/+0 to self. (Green card sitting at the tail of the Red stub block; activated
// here as part of the #656 Red-completion batch per the issue scope.)
export const aurochs: CardDefinition = {
    id: "7e973a84-7f7d-4524-9f2f-ec9a014d52ee",
    name: "Aurochs",
    rarity: "common",
    oracleText:
        "Trample\nWhenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Aurochs.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Aurochs"],
    power: 2,
    toughness: 3,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        {
            id: "aurochs-attack-pump",
            oracleText:
                "Whenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Aurochs.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                let others = 0;
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                        subtypes: "Aurochs",
                    })) {
                        if (id === ctx.sourceInstanceId) continue;
                        if (ctx.getIsAttacking(id)) others++;
                    }
                }
                if (others === 0) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    others,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Blizzard — {G}{G} Enchantment. Cumulative upkeep {2} (CR 702.24, ADR 0042) +
// a continuous "Creatures with flying don't untap during their controllers'
// untap steps" lock (CR 502.1 / 611 — the Winter Orb shape via
// `untapRestriction` filtered to flyers).
//
// SIMPLIFICATION (flagged, no engine change): the printed "Cast this spell only
// if you control a snow land" cast restriction degrades cleanly — the ICE pool
// ships NO snow-supertype lands (snow mana is deferred; see CONTEXT.md "Snow" /
// PRD #628), so the condition would never let it be cast at all. It is dropped
// here (Blizzard is freely castable) until snow lands exist; the restriction is
// not load-bearing for the enchantment's effect once in play.
export const blizzard: CardDefinition = {
    id: "c369e4f9-0f2b-446c-9e2d-d3eefab0586d",
    name: "Blizzard",
    rarity: "rare",
    oracleText:
        "Cast this spell only if you control a snow land.\nCumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nCreatures with flying don't untap during their controllers' untap steps.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "blizzard-flyer-untap-lock",
            oracleText:
                "Creatures with flying don't untap during their controllers' untap steps (Blizzard).",
            filter: { types: "Creature", requireAbility: "flying" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "blizzard-cumulative-upkeep",
            cost: { X: 2 },
            costLabel: "{2}",
        }),
    ],
};
// TODO(#628): implement.
// export const brownOuphe: CardDefinition = {
//     id: "e26ce35b-ba65-451d-a5ed-e1db6f1d0c6f",
//     name: "Brown Ouphe",
//     rarity: "common",
//     oracleText: "{1}{G}, {T}: Counter target activated ability from an artifact source. (Mana abilities can't be targeted.)",
//     manaCost: { G: 1 },
//     types: ["Creature"],
//     subtypes: ["Ouphe"],
//     power: 1,
//     toughness: 1,
// };
// Chub Toad — {2}{G} 1/1. "Whenever this creature blocks or becomes blocked, it
// gets +2/+2 until end of turn." (CR 509.1h blocks / becomes-blocked trigger;
// CR 514.2 cleanup expiry.) Fires on BLOCKERS_CONFIRMED whenever self is the
// blocker OR the blocked attacker (the Woolly Spider self-blocker shape widened
// to either combat role), deduped to a single buff per confirmation.
export const chubToad: CardDefinition = {
    id: "b6ebcc1d-0c5c-4bc2-ade7-41944f69162e",
    name: "Chub Toad",
    rarity: "common",
    oracleText:
        "Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Frog"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "chub-toad-combat-pump",
            oracleText:
                "Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self, state) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                const isBlocker = event.blockerId === self.id;
                const isBlockedAttacker = event.attackerId === self.id;
                if (!isBlocker && !isBlockedAttacker) return false;
                // The engine emits one BLOCKERS_CONFIRMED per attacker-blocker
                // pair. As the attacker, dedupe to the first blocker so a
                // multi-blocked Toad pumps once (mirrors Johtull Wurm).
                if (isBlockedAttacker && !isBlocker) {
                    const assignments = state?.combat?.blockerAssignments;
                    if (!assignments) return true;
                    for (const [blockerId, attackerIds] of Object.entries(
                        assignments
                    )) {
                        if (attackerIds.includes(self.id)) {
                            return event.blockerId === blockerId;
                        }
                    }
                }
                return true;
            },
            resolve: (ctx: SpellContext, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    2,
                    2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Dire Wolves — {2}{G} 2/2 Wolf. "This creature has banding as long as you
// control a Plains." (CR 702.21 banding; `gre/banding.ts` reads the keyword from
// `staticAbilities`.)
//
// SIMPLIFICATION (flagged, no engine change): the "as long as you control a
// Plains" condition is a CONTINUOUS keyword gate on board state. The engine's
// `keyword-grant` static effect is applied imperatively at ETB and reversed only
// when the source leaves play — its `applies` predicate gets no board view
// (`StaticEffectContext` exposes only the target's own characteristics), so a
// "controls a Plains" condition that re-evaluates as Plains come and go is not
// expressible today. Banding is therefore granted UNCONDITIONALLY. This is a
// strict superset of the printed behaviour (Dire Wolves is a green-white card
// played alongside Plains in practice) and matches the engine's existing
// treatment of conditional keywords (Snow Devil's conditional first strike).
// A board-aware keyword-grant predicate would let this track Plains exactly;
// flagged for a follow-up.
export const direWolves: CardDefinition = {
    id: "a602c93d-e00f-4b4f-a7ff-95316b7e7641",
    name: "Dire Wolves",
    rarity: "common",
    oracleText:
        "This creature has banding as long as you control a Plains. (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Wolf"],
    power: 2,
    toughness: 2,
    staticAbilities: ["banding"],
};
// Earthlore — Aura on a land you control granting it "Tap enchanted land:
// Target blocking creature gets +1/+2 until end of turn." (CR 611 activated-
// grant, CR 514.2 expiry.) The Hot Springs shape: the granted ability lives on
// `grantTemplates` (so Earthlore itself exposes nothing) and `activated-grant`
// pushes it onto the enchanted land. The cost is the LAND's own tap
// (`cost.tap`), so "Activate only if enchanted land is untapped" is enforced
// automatically — a tapped permanent can't pay a tap cost (CR 602.2 / 118.12).
export const earthlore: CardDefinition = {
    id: "319d252e-7c43-47d6-8873-f69b0e063256",
    name: "Earthlore",
    rarity: "common",
    oracleText:
        "Enchant land you control\nTap enchanted land: Target blocking creature gets +1/+2 until end of turn. Activate only if enchanted land is untapped.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1, controller: "you" },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "earthlore-pump",
        },
    ],
    grantTemplates: [
        {
            id: "earthlore-pump",
            oracleText:
                "Tap enchanted land: Target blocking creature gets +1/+2 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "blocking",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent")
                    ctx.addTemporaryPTBuff(t, 1, 2, { phase: "end-of-turn" });
            },
        },
    ],
};
// Elder Druid — {3}{G} 2/2. "{3}{G}, {T}: You may tap or untap target artifact,
// creature, or land." (CR 605 activated ability; CR 701.20a tap/untap.) The
// "tap or untap" choice is offered via `requestOptionChoice` at resolution — a
// genuine tactical branch (CR 608.2). The "you may" permits choosing neither,
// but with both branches always legal the engine auto-resolves to a real pick;
// declining is equivalent to choosing the no-op direction, so two options
// suffice.
export const elderDruid: CardDefinition = {
    id: "210f6fab-62f0-42ab-bd01-00d647bd25e7",
    name: "Elder Druid",
    rarity: "rare",
    oracleText:
        "{3}{G}, {T}: You may tap or untap target artifact, creature, or land.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Cleric", "Druid"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "elder-druid-tap-untap",
            oracleText:
                "{3}{G}, {T}: You may tap or untap target artifact, creature, or land.",
            cost: { mana: { X: 3, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Creature", "Land"],
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                const choice = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "elder-druid-tap-untap-mode",
                    options: [
                        { id: "tap", label: "Tap it" },
                        { id: "untap", label: "Untap it" },
                    ],
                    prompt: "Tap or untap the target?",
                });
                if (choice === undefined) return; // suspended for the choice
                if (choice === "tap") ctx.tap(t);
                else ctx.untap(t);
            },
        },
    ],
};
// Essence Filter — {1}{G}{G} Sorcery. "Destroy all enchantments or all nonwhite
// enchantments." (CR 700.2 modal — "or" between two mass-destroy effects; CR
// 701.7 destroy.) Two `modes`, each a no-target resolve that scans every
// battlefield for Enchantments and destroys the matching set (the nonwhite mode
// skips white enchantments via `ctx.getColors`).
export const essenceFilter: CardDefinition = {
    id: "9b610103-dafd-4248-9d79-ce57f84b9e03",
    name: "Essence Filter",
    rarity: "common",
    oracleText: "Destroy all enchantments or all nonwhite enchantments.",
    manaCost: { X: 1, G: 2 },
    types: ["Sorcery"],
    modes: [
        {
            id: "all",
            label: "Destroy all enchantments",
            oracleText: "Destroy all enchantments.",
            resolve: (ctx: SpellContext) => {
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Enchantment",
                    })) {
                        ctx.destroy({ type: "permanent", id });
                    }
                }
            },
        },
        {
            id: "nonwhite",
            label: "Destroy all nonwhite enchantments",
            oracleText: "Destroy all nonwhite enchantments.",
            resolve: (ctx: SpellContext) => {
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Enchantment",
                    })) {
                        const target = { type: "permanent" as const, id };
                        if (ctx.getColors(target).includes("W")) continue;
                        ctx.destroy(target);
                    }
                }
            },
        },
    ],
};
// Fanatical Fever — {2}{G}{G} Instant. "Target creature gets +3/+0 and gains
// trample until end of turn." (CR 611.1c temporary P/T + keyword grant; CR
// 514.2 expiry.) The Stampede single-target shape.
export const fanaticalFever: CardDefinition = {
    id: "2abba7f1-5d07-4137-88a2-5967396a3e42",
    name: "Fanatical Fever",
    rarity: "uncommon",
    oracleText:
        "Target creature gets +3/+0 and gains trample until end of turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        ctx.addTemporaryPTBuff(t, 3, 0, { phase: "end-of-turn" });
        ctx.grantStaticAbility(t, "trample", { phase: "end-of-turn" });
    },
};
// Folk of the Pines — {4}{G} 2/5 Dryad. "{1}{G}: This creature gets +1/+0 until
// end of turn." (CR 605 activated ability; CR 514.2 cleanup expiry — the
// firebreathing self-pump, the Shambling Strider shape without the toughness
// downside.)
export const folkOfThePines: CardDefinition = {
    id: "0c13311d-db83-483f-ba2b-4f54ceb8b026",
    name: "Folk of the Pines",
    rarity: "common",
    oracleText: "{1}{G}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Dryad"],
    power: 2,
    toughness: 5,
    activatedAbilities: [
        {
            id: "folk-of-the-pines-pump",
            oracleText: "{1}{G}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1, G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Forbidden Lore — Aura on any land granting it "{T}: Target creature gets +2/+1
// until end of turn." (CR 611 activated-grant; CR 514.2 expiry.) The Hot Springs
// / Earthlore shape; "Enchant land" with no controller clause, so it may sit on
// an opponent's land (the land's controller activates).
export const forbiddenLore: CardDefinition = {
    id: "5fc225cf-4fe2-4a5b-828e-ffcb99e404e8",
    name: "Forbidden Lore",
    rarity: "rare",
    oracleText:
        'Enchant land\nEnchanted land has "{T}: Target creature gets +2/+1 until end of turn."',
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "forbidden-lore-pump",
        },
    ],
    grantTemplates: [
        {
            id: "forbidden-lore-pump",
            oracleText: "{T}: Target creature gets +2/+1 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent")
                    ctx.addTemporaryPTBuff(t, 2, 1, { phase: "end-of-turn" });
            },
        },
    ],
};
// TODO(#628): implement.
// export const forgottenLore: CardDefinition = {
//     id: "fb01dd39-a957-4c1a-86cf-f31a699a154a",
//     name: "Forgotten Lore",
//     rarity: "uncommon",
//     oracleText: "Target opponent chooses a card in your graveyard. You may pay {G}. If you do, repeat this process except that opponent can't choose a card already chosen for Forgotten Lore. Then put the last chosen card into your hand.",
//     manaCost: { G: 1 },
//     types: ["Sorcery"],
// };
// Foxfire — {2}{G} Instant. "Untap target attacking creature. Prevent all
// combat damage that would be dealt to and dealt by that creature this turn"
// (CR 701.20 untap; CR 615 two-way combat-damage shield, via
// `preventAllCombatDamageToAndBy` — Ebony Horse pattern) plus the next-upkeep
// cantrip rider.
export const foxfire: CardDefinition = {
    id: "88db9685-6a2f-4548-b6c4-669918d653b4",
    name: "Foxfire",
    rarity: "common",
    oracleText:
        "Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, G: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        combatRoleFilter: "attacking",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") {
            ctx.untap(t);
            ctx.preventAllCombatDamageToAndBy(t, { phase: "end-of-turn" });
        }
        scheduleNextUpkeepDraw(ctx, foxfire.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// TODO(#628): implement.
// export const freyaliseSupplicant: CardDefinition = {
//     id: "5b1e718a-882a-4bdc-9d62-4dda88da0ba0",
//     name: "Freyalise Supplicant",
//     rarity: "uncommon",
//     oracleText: "{T}, Sacrifice a red or white creature: This creature deals damage to any target equal to half the sacrificed creature's power, rounded down.",
//     manaCost: { X: 1, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Cleric"],
//     power: 1,
//     toughness: 1,
// };
// Freyalise's Charm — {G}{G} Enchantment. "Whenever an opponent casts a black
// spell, you may pay {G}{G}. If you do, you draw a card." (CR 603.2 spell-cast
// trigger scoped to opponents + colour filter; CR 117.3a may-pay via
// `requestMayPay`; CR 120 draw.) Plus "{G}{G}: Return this enchantment to its
// owner's hand." (CR 605 activated ability; CR 400.7 return-to-hand bounce.)
export const freyalisesCharm: CardDefinition = {
    id: "3e147ac1-d221-49c7-966e-5e665ddeab6b",
    name: "Freyalise's Charm",
    rarity: "uncommon",
    oracleText:
        "Whenever an opponent casts a black spell, you may pay {G}{G}. If you do, you draw a card.\n{G}{G}: Return this enchantment to its owner's hand.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "freyalises-charm-black-draw",
            oracleText:
                "Whenever an opponent casts a black spell, you may pay {G}{G}. If you do, you draw a card.",
            scope: "opponents",
            filter: { colors: "B" },
            resolve: (ctx: SpellContext) => {
                const paid = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: "freyalises-charm-pay",
                    cost: { G: 2 },
                    prompt: "Pay {G}{G} to draw a card?",
                });
                if (paid === undefined) return; // suspended for the choice
                if (paid) ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "freyalises-charm-bounce",
            oracleText: "{G}{G}: Return this enchantment to its owner's hand.",
            cost: { mana: { G: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.returnToHand({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// TODO(#628): implement.
// export const freyalisesWinds: CardDefinition = {
//     id: "b11cd2e0-9419-4267-807e-5b73915c748a",
//     name: "Freyalise's Winds",
//     rarity: "rare",
//     oracleText: "Whenever a permanent becomes tapped, put a wind counter on it.\nIf a permanent with a wind counter on it would untap during its controller's untap step, remove all wind counters from it instead.",
//     manaCost: { X: 2, G: 2 },
//     types: ["Enchantment"],
// };
// ─────────────────────────────────────────────────────────────────────────────
// Green free tranche (#634)
//
// The free-tranche Green cards — expressible entirely with already-shipped
// primitives — are activated below (intermixed with the remaining commented
// stubs). Reprints already implemented in LEA (Giant Growth, Hurricane, Lure,
// Regeneration, Wild Growth) are CardPrints onto their existing definitions
// (ADR 0014); new-to-ICE Green cards are full CardDefinitions. Lhurgoyf is a
// `pt-cda` (layer 7a) whose `compute` counts creature cards in all graveyards
// from game state — MANDATORY wire-format test (projection keeps `.types`).
//
// GREEN-COMPLETION (#657): the buildable-now Green stubs the free tranche
// under-delivered are now active CardDefinitions below — Blizzard, Chub Toad,
// Dire Wolves, Earthlore, Elder Druid, Essence Filter, Fanatical Fever, Folk of
// the Pines, Forbidden Lore, Freyalise's Charm, Gorilla Pack, Thermokarst,
// Thoughtleech, Venomous Breath, Wiitigo. The earlier "needs primitive" defers
// for Gorilla Pack (attack-restriction + state-sac — Sea Serpent shape),
// Thoughtleech (`tappedTrigger`), Venomous Breath (delayed end-of-combat
// destroy), Wiitigo (counter-as-flag tracking) and Dire Wolves (banding grant)
// were STALE — every primitive ships today.
//
// DEFERRED (remain commented stubs, owned by a later cluster):
//   • Cumulative upkeep — Fyndhorn Pollen, Maddening Wind, Ritual of Subdual
//     (ADR 0042 cluster — note Pollen/Wind are already active in the CU section).
//   • Next-upkeep delayed cantrip — Pyknite: ACTIVE (#660). Touch of Vitae
//     remains deferred: its cantrip + haste legs are buildable but the granted
//     "{0}: Untap this creature. Activate only once." activated ability needs a
//     duration-scoped activated-ability grant primitive (see its stub below).
//   • Snow-matters — Snowblind / Whiteout / Woolly Mammoths / Rime Dryad
//     (snow-land counting, snow landwalk evasion, snow-land sac recursion). No
//     snow supertype filter / snow-evasion plumbing yet — snow cluster.
//     (Thermokarst is now active; its snow-land lifegain rider degrades to a
//     no-op until snow lands exist.)
//   • Forgotten Lore / Freyalise Supplicant / Freyalise's Winds — blocked
//     one-offs owned by later clusters.
//
// FLAGGED SIMPLIFICATIONS (no new primitive): Blizzard drops its snow cast-
// condition (no snow lands in pool); Dire Wolves grants banding unconditionally
// (the "as long as you control a Plains" gate needs a board-aware keyword-grant
// predicate the engine lacks); Thermokarst's snow-land lifegain is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

// Fyndhorn Brownie — "{2}{G}, {T}: Untap target creature." (CR 605 activated
// ability; CR 701.20a untap. The Twiddle-on-a-stick untap, scoped to creatures.)
export const fyndhornBrownie: CardDefinition = {
    id: "06204e82-9dfd-4334-a23a-f8240fc37772",
    name: "Fyndhorn Brownie",
    rarity: "common",
    oracleText: "{2}{G}, {T}: Untap target creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Ouphe"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "fyndhorn-brownie-untap",
            oracleText: "{2}{G}, {T}: Untap target creature.",
            cost: { mana: { X: 2, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.untap(t);
            },
        },
    ],
};
// Fyndhorn Elder — "{T}: Add {G}{G}." Mana dork (CR 605.1a mana ability,
// resolves immediately). The Llanowar Elves shape producing two green.
export const fyndhornElder: CardDefinition = {
    id: "fca8aa11-f7cb-4f88-a041-30098579f1d2",
    name: "Fyndhorn Elder",
    rarity: "uncommon",
    oracleText: "{T}: Add {G}{G}.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        makeTapForMana({
            id: "fyndhorn-elder-mana",
            oracleText: "{T}: Add {G}{G}.",
            produces: { G: 2 },
        }),
    ],
};
// Fyndhorn Elves — "{T}: Add {G}." The Llanowar Elves twin (CR 605.1a).
export const fyndhornElves: CardDefinition = {
    id: "3ba95ffa-990a-4013-98b7-5d8c0b34e9c4",
    name: "Fyndhorn Elves",
    rarity: "common",
    oracleText: "{T}: Add {G}.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        makeTapForMana({
            id: "fyndhorn-elves-mana",
            oracleText: "{T}: Add {G}.",
            produces: { G: 1 },
        }),
    ],
};
// Giant Growth — ICE reprint of the LEA instant (+3/+3 until end of turn).
// CardPrint onto the LEA definition (ADR 0014).
export const giantGrowthIce: CardPrint = {
    printId: "431c9749-fd7b-4960-a910-8d41d3704e6c",
    definitionId: "367dbefe-3366-408e-9fcf-7dc00f8cc201",
    setCode: "ice",
    rarity: "common",
};
// Gorilla Pack — {2}{G} 3/3 Ape. "This creature can't attack unless defending
// player controls a Forest.\nWhen you control no Forests, sacrifice this
// creature." The exact Sea Serpent (LEA) shape — a self `attack-restriction`
// static (CR 508.1c) gated on the defender controlling a Forest, plus a
// `stateTrigger` sacrifice (CR 603.8) when the controller has no Forests. Both
// primitives ship; the "needs primitive" defer was stale.
export const gorillaPack: CardDefinition = {
    id: "046f6b76-5f17-4728-aa34-72b7eff1d4c9",
    name: "Gorilla Pack",
    rarity: "common",
    oracleText:
        "This creature can't attack unless defending player controls a Forest.\nWhen you control no Forests, sacrifice this creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Ape"],
    power: 3,
    toughness: 3,
    staticEffects: [
        {
            // CR 508.1c — can't attack unless defending player controls a Forest
            kind: "attack-restriction" as const,
            id: "gorilla-pack-forest-restriction",
            predicate: (
                _self: PermanentView,
                defenderBattlefield: readonly PermanentView[]
            ) => defenderBattlefield.some((c) => c.subtypes.includes("Forest")),
            oracleText:
                "Gorilla Pack can't attack unless defending player controls a Forest.",
        },
    ],
    triggeredAbilities: [
        // CR 603.8 — state-triggered sacrifice; `stateTrigger` wires the
        // STATE_CHECK narrowing and resolve-time re-check (intervening-if) so it
        // fizzles if a Forest reappears before resolution.
        stateTrigger({
            id: "gorilla-pack-no-forest-sacrifice",
            oracleText: "When you control no Forests, sacrifice Gorilla Pack.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                if (!controller) return false;
                return !controller.battlefield.some((c) =>
                    c.subtypes.includes("Forest")
                );
            },
            resolve: (ctx) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};
// Hot Springs — Aura on a land you control granting it an activated prevention
// ability (CR 611 activated-grant, CR 615 prevention). The granted "{T}:
// Prevent the next 1 damage to any target this turn" lives on `grantTemplates`
// so Hot Springs itself doesn't expose it; `activated-grant` pushes it onto the
// enchanted land.
export const hotSprings: CardDefinition = {
    id: "1d4fe072-81a7-424e-8d21-aaca010d5b1d",
    name: "Hot Springs",
    rarity: "rare",
    oracleText:
        'Enchant land you control\nEnchanted land has "{T}: Prevent the next 1 damage that would be dealt to any target this turn."',
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1, controller: "you" },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "hot-springs-prevent",
        },
    ],
    grantTemplates: [
        {
            id: "hot-springs-prevent",
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t)
                    ctx.preventNextNDamageToTarget(t, 1, {
                        phase: "end-of-turn",
                    });
            },
        },
    ],
};
// Hurricane — ICE reprint of the LEA sorcery (X damage to each flier and each
// player). CardPrint onto the LEA definition (ADR 0014).
export const hurricaneIce: CardPrint = {
    printId: "a8cc6db7-1f40-40e3-a7ea-92f1d05e2e3d",
    definitionId: "52f5a19f-16e4-4d35-89e1-969ac8202f88",
    setCode: "ice",
    rarity: "uncommon",
};
// Johtull Wurm — "Whenever this creature becomes blocked, it gets -2/-1 until
// end of turn for each creature blocking it beyond the first." (CR 509.1h
// becomes-blocked, CR 514.2 cleanup expiry.) NEGATIVE asymmetric rampage: the
// engine's `rampageTrigger` only does symmetric +N/+N, so the per-blocker
// -2/-1 is written inline, reusing the BLOCKERS_CONFIRMED event + the live
// block graph (dedupe on the first blocker so it fires once) like rampage does.
export const johtullWurm: CardDefinition = {
    id: "64a22e88-f7b1-48c8-a199-e57edcd50654",
    name: "Johtull Wurm",
    rarity: "uncommon",
    oracleText:
        "Whenever this creature becomes blocked, it gets -2/-1 until end of turn for each creature blocking it beyond the first.",
    manaCost: { X: 5, G: 1 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 6,
    toughness: 6,
    triggeredAbilities: [
        {
            id: "johtull-wurm-block-shrink",
            oracleText:
                "Whenever this creature becomes blocked, it gets -2/-1 until end of turn for each creature blocking it beyond the first.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self, state) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                // Fire only when self is the blocked ATTACKER (CR 509.1h).
                if (event.attackerId !== self.id) return false;
                // The engine emits one BLOCKERS_CONFIRMED per attacker-blocker
                // pair; dedupe to the first blocker so a multi-blocked attacker
                // fires once (mirrors `rampageTrigger.firstBlockerOf`).
                const assignments = state?.combat?.blockerAssignments;
                if (!assignments) return true;
                for (const [blockerId, attackerIds] of Object.entries(
                    assignments
                )) {
                    if (attackerIds.includes(self.id)) {
                        return event.blockerId === blockerId;
                    }
                }
                return true;
            },
            resolve: (ctx: SpellContext, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const attackerId = ctx.sourceInstanceId;
                // CR 509.1h — count live blockers at resolution.
                const live = new Set<string>();
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid)) live.add(id);
                }
                const blockers = (
                    ctx.getBlockersByAttacker()[attackerId] ?? []
                ).filter((id) => live.has(id));
                const beyondFirst = Math.max(0, blockers.length - 1);
                if (beyondFirst === 0) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: attackerId },
                    -2 * beyondFirst,
                    -1 * beyondFirst,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Juniper Order Druid — "{T}: Untap target land." (CR 605 activated ability;
// CR 701.20a untap, scoped to lands.)
export const juniperOrderDruid: CardDefinition = {
    id: "cb211704-ff8e-498b-b7bb-f8384f198ffd",
    name: "Juniper Order Druid",
    rarity: "common",
    oracleText: "{T}: Untap target land.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "juniper-order-druid-untap",
            oracleText: "{T}: Untap target land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.untap(t);
            },
        },
    ],
};
// Lhurgoyf — its power equals the number of creature cards in all graveyards and
// its toughness is that number plus 1 (CR 604.3 / 613.4c CDA P/T, layer 7a). A
// `pt-cda` whose `compute` counts `Creature`-typed cards across every player's
// graveyard from game state; the printed 0/0 base is the CDA target so the
// effective P/T is exactly `{ n, n+1 }`. `.types` survives `projectPublicState`
// (slimCard strips only `card`), so the count is identical on the wire — the
// mandatory wire-format test re-asserts it after projection.
export const lhurgoyf: CardDefinition = {
    id: "fee6d385-d44b-4f1a-beb1-13aeebde063e",
    name: "Lhurgoyf",
    rarity: "rare",
    oracleText:
        "Lhurgoyf's power is equal to the number of creature cards in all graveyards and its toughness is equal to that number plus 1.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Lhurgoyf"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (_source, state) => {
                let creatures = 0;
                for (const player of state.players) {
                    for (const card of player.graveyard) {
                        if (card.types.includes("Creature")) creatures++;
                    }
                }
                return { power: creatures, toughness: creatures + 1 };
            },
        },
    ],
};
// Lure — ICE reprint of the LEA Aura ("All creatures able to block enchanted
// creature do so"). CardPrint onto the LEA definition (ADR 0014).
export const lureIce: CardPrint = {
    printId: "87af69ee-c2bb-46ea-8d36-d484d04a3c8a",
    definitionId: "2a87b26e-0431-42e9-b44f-94ba8546111a",
    setCode: "ice",
    rarity: "uncommon",
};
// Nature's Lore — "Search your library for a Forest card, put that card onto the
// battlefield, then shuffle." (CR 701.19 search; CR 400.7 put onto battlefield;
// CR 701.20 shuffle.) A library search restricted to Forest cards via the
// `candidateIds` allow-list, then `putFromLibraryOntoBattlefield` + shuffle.
export const naturesLore: CardDefinition = {
    id: "668d2969-b6b7-4507-bdd4-20bbaa68035a",
    name: "Nature's Lore",
    rarity: "uncommon",
    oracleText:
        "Search your library for a Forest card, put that card onto the battlefield, then shuffle.",
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        const forests = ctx
            .getLibraryCards(ctx.controller)
            .filter((c) => c.subtypes.includes("Forest"));
        const found = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "natures-lore-search",
            kind: "search-library",
            zone: "library",
            candidateIds: forests.map((c) => c.id),
            count: { min: 0, max: 1 },
            prompt: "Search your library for a Forest card.",
        });
        if (found === undefined) return; // suspended
        const foundId = found[0];
        if (foundId) ctx.putFromLibraryOntoBattlefield(ctx.controller, foundId);
        ctx.shuffleLibrary(ctx.controller);
    },
};
// Pale Bears — {2}{G} 2/2 with islandwalk (CR 702.18 landwalk evasion).
export const paleBears: CardDefinition = {
    id: "7f19c2a3-6403-4a78-bf45-6e339578d673",
    name: "Pale Bears",
    rarity: "rare",
    oracleText:
        "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    staticAbilities: ["islandwalk"],
};
// Pygmy Allosaurus — {2}{G} 2/2 with swampwalk (CR 702.18 landwalk evasion).
export const pygmyAllosaurus: CardDefinition = {
    id: "88a68767-9822-4f15-895e-32164e2159be",
    name: "Pygmy Allosaurus",
    rarity: "rare",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Dinosaur"],
    power: 2,
    toughness: 2,
    staticAbilities: ["swampwalk"],
};
// Pyknite — {2}{G} 1/1 Ouphe. Self-ETB cantrip rider (CR 603.6a ETB trigger
// arming the CR 502.2 / 603.7d next-upkeep delayed draw).
export const pyknite: CardDefinition = {
    id: "6ffc64e4-ae3c-49f9-8ed6-518dd497bfe6",
    name: "Pyknite",
    rarity: "common",
    oracleText:
        "When this creature enters, draw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Ouphe"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "pyknite-etb",
            oracleText:
                "When this creature enters, draw a card at the beginning of the next turn's upkeep.",
            scope: "self",
            resolve: (ctx) => {
                scheduleNextUpkeepDraw(ctx, pyknite.id);
            },
        }),
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Regeneration — ICE reprint of the LEA Aura ("{G}: Regenerate enchanted
// creature"). CardPrint onto the LEA definition (ADR 0014).
export const regenerationIce: CardPrint = {
    printId: "1dacfaec-6b61-450d-a134-2087c38a298a",
    definitionId: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4",
    setCode: "ice",
    rarity: "common",
};
// Rime Dryad — snow forestwalk (CR 702.13 / 205.4a): can't be blocked while the
// defending player controls a snow Forest. The `snow forestwalk` keyword is
// enforced by the combat registry's `LANDWALK_SNOW_RULES`
// (`controlsSnowSubtype(..., "Forest")`).
export const rimeDryad: CardDefinition = {
    id: "7a93e6ce-1295-41f8-b454-2dfe321481a6",
    name: "Rime Dryad",
    rarity: "common",
    oracleText:
        "Snow forestwalk (This creature can't be blocked as long as defending player controls a snow Forest.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Dryad"],
    power: 1,
    toughness: 2,
    staticAbilities: ["snow forestwalk"],
};
// Scaled Wurm — {7}{G} 7/6 vanilla Wurm (CR 302).
export const scaledWurm: CardDefinition = {
    id: "499cd7fa-c86c-4a5f-b36d-8160e8a6af1f",
    name: "Scaled Wurm",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 7, G: 1 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 7,
    toughness: 6,
};
// Shambling Strider — "{R}{G}: This creature gets +1/-1 until end of turn."
// (CR 605 activated ability; CR 514.2 cleanup expiry — a firebreathing-style
// self-pump trading toughness for power.)
export const shamblingStrider: CardDefinition = {
    id: "8886ba2d-b25a-4b74-9299-911c509ae864",
    name: "Shambling Strider",
    rarity: "common",
    oracleText: "{R}{G}: This creature gets +1/-1 until end of turn.",
    manaCost: { X: 4, G: 2 },
    types: ["Creature"],
    subtypes: ["Yeti"],
    power: 5,
    toughness: 5,
    activatedAbilities: [
        {
            id: "shambling-strider-pump",
            oracleText: "{R}{G}: This creature gets +1/-1 until end of turn.",
            cost: { mana: { R: 1, G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    -1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Snowblind — Aura: enchanted creature gets -X/-Y (CR 613 layer 7c, a `pt-cda`
// since X/Y are characteristic-defined by board state — CR 604.3). X = number
// of snow lands the DEFENDING player controls if the host is attacking,
// otherwise the snow lands its CONTROLLER controls (CR 205.4a). Y = min(X,
// toughness − 1), so the toughness reduction never reduces the host below 1
// toughness on its own. The host's toughness read in `compute` is its toughness
// WITHOUT this effect (the CDA delta is added on top), giving the intended cap.
//
// SIMPLIFICATION (flagged): the "defending player" while the host attacks is
// resolved as the host's opponent (the non-controller in 2-player). Multiplayer
// (3+) is out of scope (CLAUDE.md), so the single opponent is the defender.
export const snowblind: CardDefinition = {
    id: "5f62c376-487a-42bc-bd85-ab8b0480f7dc",
    name: "Snowblind",
    rarity: "rare",
    oracleText:
        "Enchant creature\nEnchanted creature gets -X/-Y. If that creature is attacking, X is the number of snow lands defending player controls. Otherwise, X is the number of snow lands its controller controls. Y is equal to X or to enchanted creature's toughness minus 1, whichever is smaller.",
    manaCost: { X: 3, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (_source, state, ctx, target) => {
                // CR 205.4a — count snow lands controlled by the relevant
                // player. Attacking → the defending player (the host's
                // opponent); otherwise → the host's controller. The view's
                // players carry no `id`, so the opponent is identified as the
                // player whose battlefield holds permanents NOT controlled by
                // the host's controller (2-player; multiplayer out of scope).
                const controllerId = target.controllerId;
                const countSnow = (
                    predicate: (c: string) => boolean
                ): number => {
                    let n = 0;
                    for (const player of state.players) {
                        for (const p of player.battlefield) {
                            if (
                                predicate(p.controllerId) &&
                                p.types.includes("Land") &&
                                ctx.hasSupertype(p, "Snow")
                            ) {
                                n++;
                            }
                        }
                    }
                    return n;
                };
                const x = target.isAttacking
                    ? countSnow((cid) => cid !== controllerId)
                    : countSnow((cid) => cid === controllerId);
                // Y = min(X, toughness − 1). `target.toughness` here is the
                // host's toughness before this CDA delta (CR 613 — the delta is
                // added on top), so the cap keeps it from self-killing.
                const baseToughness = target.toughness ?? 0;
                const y = Math.min(x, Math.max(0, baseToughness - 1));
                return { power: -x, toughness: -y };
            },
        },
    ],
};
// Stampede — "Attacking creatures get +1/+0 and gain trample until end of turn."
// (CR 611.1c temporary P/T + keyword grant on the set of attackers; CR 514.2
// expiry.) Each currently-attacking creature receives the buff and trample.
export const stampede: CardDefinition = {
    id: "bc8265a1-4621-4d25-8f7f-f0179951a694",
    name: "Stampede",
    rarity: "rare",
    oracleText:
        "Attacking creatures get +1/+0 and gain trample until end of turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        // "Attacking creatures" = every creature currently attacking, any
        // controller (CR 506.4). Scan all players' battlefields for attackers.
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
            })) {
                if (!ctx.getIsAttacking(id)) continue;
                const target = { type: "permanent" as const, id };
                ctx.addTemporaryPTBuff(target, 1, 0, { phase: "end-of-turn" });
                ctx.grantStaticAbility(target, "trample", {
                    phase: "end-of-turn",
                });
            }
        }
    },
};
// Stunted Growth — "Target player chooses three cards from their hand and puts
// them on top of their library in any order." (CR 701-style hand→library-top;
// the targeted player makes the choice and the order.) Routes a hand-card
// choice to the TARGET player, then moves each pick to the top in pick order.
export const stuntedGrowth: CardDefinition = {
    id: "4c9b7393-eb35-4c99-bbf5-bcf924aa8ff3",
    name: "Stunted Growth",
    rarity: "rare",
    oracleText:
        "Target player chooses three cards from their hand and puts them on top of their library in any order.",
    manaCost: { X: 3, G: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const hand = ctx.getHandCards(target.id).map((c) => c.id);
        if (hand.length === 0) return;
        // "chooses three cards" — fewer than three if the hand is smaller
        // (CR 700.3: do as much as possible). The chooser's pick order becomes
        // the top-of-library order.
        const count = Math.min(3, hand.length);
        const picks = ctx.requestChoice({
            playerId: target.id,
            choiceId: "stunted-growth-pick",
            kind: "choose-hand-card",
            zone: "hand",
            candidateIds: hand,
            count,
            prompt: "Choose three cards to put on top of your library in any order.",
        });
        if (picks === undefined) return; // suspended on the target's choice
        for (const id of picks) {
            ctx.moveHandCardToLibraryTop(target.id, id);
        }
    },
};
// Tarpan — {G} 1/1 with "When this creature dies, you gain 1 life." (CR 700.4
// dies trigger; CR 119.3 life gain.)
export const tarpan: CardDefinition = {
    id: "b1420ec5-367c-4514-86c5-3993bf339e37",
    name: "Tarpan",
    rarity: "common",
    oracleText: "When this creature dies, you gain 1 life.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Horse"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        diedTrigger({
            id: "tarpan-death-lifegain",
            oracleText: "When this creature dies, you gain 1 life.",
            scope: "self",
            resolve: (ctx) => ctx.gainLife(ctx.controller, 1),
        }),
    ],
};
// Thermokarst — {1}{G}{G} Sorcery. "Destroy target land. If that land was a snow
// land, you gain 1 life." (CR 701.7 destroy.)
//
// SIMPLIFICATION (flagged, no engine change): the "if that land was a snow land,
// you gain 1 life" rider degrades to a no-op — the ICE pool ships NO snow-
// supertype lands (snow mana is deferred; see CONTEXT.md "Snow" / PRD #628), so
// no target can ever satisfy the snow branch. The destroy is the load-bearing
// effect and is implemented fully; the lifegain lands the day snow lands exist.
export const thermokarst: CardDefinition = {
    id: "00ae906b-2c4d-48e9-9f2d-217777e22292",
    name: "Thermokarst",
    rarity: "uncommon",
    oracleText:
        "Destroy target land. If that land was a snow land, you gain 1 life.",
    manaCost: { X: 1, G: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") ctx.destroy(t);
        // Snow-land lifegain rider: no-op in the current pool (no snow lands).
    },
};
// Thoughtleech — {G}{G} Enchantment. "Whenever an Island an opponent controls
// becomes tapped, you may gain 1 life." (CR 603.2 becomes-tapped trigger via
// `tappedTrigger`; CR 117.3a may + CR 119.3 lifegain.) The `tappedTrigger`
// watcher (Snowfall precedent) scoped to opponents' Islands; the "needs
// primitive" defer was stale. The "you may gain 1 life" is strictly beneficial,
// so the engine auto-resolves the may (ADR 0003) — modelled as an unconditional
// gain on resolution.
export const thoughtleech: CardDefinition = {
    id: "d8fe7f9d-644f-48d0-93fa-d9a536f1f755",
    name: "Thoughtleech",
    rarity: "uncommon",
    oracleText:
        "Whenever an Island an opponent controls becomes tapped, you may gain 1 life.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "thoughtleech-island-lifegain",
            oracleText:
                "Whenever an Island an opponent controls becomes tapped, you may gain 1 life.",
            scope: "opponents",
            filter: { types: "Land", subtypes: "Island" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};
// Tinder Wall — 0/3 Wall with Defender, a sacrifice-for-{R}{R} mana ability, and
// "{R}, Sacrifice this creature: It deals 2 damage to target creature it's
// blocking." (CR 605.1a mana ability with sac cost; CR 605 activated ability;
// CR 120.1 damage.) The "creature it's blocking" constraint is enforced in the
// resolve via the live block graph.
export const tinderWall: CardDefinition = {
    id: "2a7c6489-21e9-4b86-a54a-b1e2f1fce318",
    name: "Tinder Wall",
    rarity: "common",
    oracleText:
        "Defender (This creature can't attack.)\nSacrifice this creature: Add {R}{R}.\n{R}, Sacrifice this creature: It deals 2 damage to target creature it's blocking.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Plant", "Wall"],
    power: 0,
    toughness: 3,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "tinder-wall-mana",
            oracleText: "Sacrifice this creature: Add {R}{R}.",
            cost: { sacrifice: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 2 }),
            manaProduced: { R: 2 },
        },
        {
            id: "tinder-wall-bolt",
            oracleText:
                "{R}, Sacrifice this creature: It deals 2 damage to target creature it's blocking.",
            cost: { mana: { R: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.dealDamage(t, 2);
            },
        },
    ],
};
// DEFERRED (#660) — Touch of Vitae. The next-upkeep cantrip and the haste leg
// are now buildable (the `next-upkeep` delayed-trigger timing shipped with this
// issue; `grantStaticAbility(t, "haste", …)` covers the keyword). The remaining
// blocker is the granted ACTIVATED ability: "{0}: Untap this creature. Activate
// only once." There is a duration-scoped TRIGGERED-ability grant
// (`grantTriggeredAbility`, looked up via `triggeredGrantTemplates[]`) but NO
// activated-ability analogue a one-shot spell can grant to a target for a turn,
// and the "activate only once" cap has no per-grant counter. Faithful modeling
// needs a new `grantActivatedAbility(target, sourceCardId, abilityId,
// duration)` primitive (the activated sibling of `grantTriggeredAbility`) plus a
// once-per-grant guard — explicitly out of #660's "no new primitive beyond the
// timing union" scope, so flagged for a follow-up cluster. Stub kept verbatim.
// TODO(#628): implement (needs duration-scoped activated-ability grant + cap).
// export const touchOfVitae: CardDefinition = {
//     id: "48d2cd18-a24d-40e0-a654-777d9e623ae2",
//     name: "Touch of Vitae",
//     rarity: "uncommon",
//     oracleText: "Until end of turn, target creature gains haste and \"{0}: Untap this creature. Activate only once.\"\nDraw a card at the beginning of the next turn's upkeep.",
//     manaCost: { X: 2, G: 1 },
//     types: ["Instant"],
// };
// Trailblazer — "Target creature can't be blocked this turn." (CR 509.1b — a
// can't-be-blocked restriction set on the target until end of turn.)
export const trailblazer: CardDefinition = {
    id: "9194c69d-c849-4c4a-976c-d1382bd5cf32",
    name: "Trailblazer",
    rarity: "rare",
    oracleText: "Target creature can't be blocked this turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") ctx.setCantBeBlockedThisTurn(t);
    },
};
// Venomous Breath — {3}{G} Instant. "Choose target creature. At this turn's next
// end of combat, destroy all creatures that blocked or were blocked by it this
// turn." (CR 509.1h combat pairing; CR 603.7a delayed end-of-combat destroy;
// CR 701.7 destroy.) The combat partners are captured from the live block graph
// (`getBlockersByAttacker` / `getAttackersByBlocker`) at resolution and a single
// delayed `next-end-of-combat` trigger destroys each. The combatPairKill factory
// keys off the SOURCE permanent being in the pair; Venomous Breath instead reads
// an ARBITRARY targeted creature's partners, so the capture is inline. The
// "needs primitive" defer was stale — the delayed-trigger machinery ships.
const VENOMOUS_BREATH_ID = "8eeb9e02-1d26-4959-a878-2ef8db2358bc";
export const venomousBreath: CardDefinition = {
    id: VENOMOUS_BREATH_ID,
    name: "Venomous Breath",
    rarity: "uncommon",
    oracleText:
        "Choose target creature. At this turn's next end of combat, destroy all creatures that blocked or were blocked by it this turn.",
    manaCost: { X: 3, G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        // CR 509.1h — "creatures that blocked or were blocked by it": the
        // target's blockers (if it attacked) and the attackers it blocked.
        // Only `getBlockersByAttacker` is exposed (attacker → blockers), so the
        // "blocked by it" direction is the inverse — scan for attackers whose
        // blocker list contains the target.
        const blockGraph = ctx.getBlockersByAttacker();
        const partners = new Set<string>();
        for (const id of blockGraph[t.id] ?? []) partners.add(id);
        for (const [attackerId, blockerIds] of Object.entries(blockGraph)) {
            if (blockerIds.includes(t.id)) partners.add(attackerId);
        }
        if (partners.size === 0) return; // nothing to schedule
        // Payload values are strings only; join the partner ids (CR 603.7a
        // delayed trigger captures serializable state).
        ctx.scheduleDelayedTrigger(
            VENOMOUS_BREATH_ID,
            "venomous-breath-destroy",
            "next-end-of-combat",
            { targetIds: [...partners].join(",") }
        );
    },
    delayedTriggers: [
        {
            id: "venomous-breath-destroy",
            oracleText:
                "Destroy all creatures that blocked or were blocked by the target this turn.",
            timing: "next-end-of-combat",
            resolve: (ctx: SpellContext, payload: Record<string, string>) => {
                if (!payload.targetIds) return;
                for (const id of payload.targetIds.split(",")) {
                    if (id) ctx.destroy({ type: "permanent", id });
                }
            },
        } satisfies DelayedTriggerDef,
    ],
};
// Wall of Pine Needles — 3/3 Wall with Defender and "{G}: Regenerate this
// creature." (CR 702.3 defender; CR 605 activated ability; CR 701.15
// regeneration shield.)
export const wallOfPineNeedles: CardDefinition = {
    id: "5d879923-55fc-46ab-9306-5e1f10441c89",
    name: "Wall of Pine Needles",
    rarity: "uncommon",
    oracleText:
        "Defender (This creature can't attack.)\n{G}: Regenerate this creature.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant", "Wall"],
    power: 3,
    toughness: 3,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-pine-needles-regen",
            oracleText: "{G}: Regenerate this creature.",
            cost: { mana: { G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// Whiteout — Instant: "All creatures lose flying until end of turn." (CR 611.1b
// layer-6 keyword removal via `removeStaticAbilities`, applied to every creature
// on every battlefield.)
//
// DEFERRED (non-snow capability): the second ability — "Sacrifice a snow land:
// Return this card from your graveyard to your hand." — is an ability ACTIVATED
// FROM THE GRAVEYARD (CR 113.4 / 307.4-style graveyard-activated ability). The
// engine's `activateAbility` only scans battlefield permanents, so abilities on
// cards in the graveyard cannot be activated — a general engine gap unrelated to
// Snow (the snow-land sacrifice cost itself is now buildable). Whiteout's main
// spell ships; the graveyard-recursion ability waits on graveyard-activation
// support. Flagged for a follow-up.
export const whiteout: CardDefinition = {
    id: "a8645e4f-eaa8-4420-a6a3-eb53c311fab1",
    name: "Whiteout",
    rarity: "uncommon",
    oracleText:
        "All creatures lose flying until end of turn.\nSacrifice a snow land: Return this card from your graveyard to your hand.",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        // CR 611.1b — every creature on every battlefield loses flying until
        // end of turn (layer-6 keyword removal).
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
            })) {
                ctx.removeStaticAbilities(
                    { type: "permanent", id },
                    (kw) => kw === "flying",
                    { phase: "end-of-turn" }
                );
            }
        }
    },
};
// Wiitigo — {3}{G}{G}{G} 0/0 Yeti. "This creature enters with six +1/+1 counters
// on it.\nAt the beginning of your upkeep, put a +1/+1 counter on this creature
// if it has blocked or been blocked since your last upkeep. Otherwise, remove a
// +1/+1 counter from it." (CR 122 counters at layer 7d; CR 603.2 upkeep
// trigger.) Enters with six +1/+1 via `entersWith`.
//
// "Blocked or been blocked since your last upkeep" is tracked with a non-P/T
// marker counter ("wiitigo-blocked"): a BLOCKERS_CONFIRMED trigger sets the
// marker whenever Wiitigo is in a block pair (as blocker or blocked attacker),
// and the upkeep trigger consumes it — add a +1/+1 and clear the marker if set,
// else remove a +1/+1. The marker window is exactly upkeep-to-upkeep (counters
// persist across the intervening turn), so this is the precise "since your last
// upkeep" span. The "needs primitive" defer was stale — counters-as-flags ship.
const WIITIGO_BLOCKED_MARKER = "wiitigo-blocked";
export const wiitigo: CardDefinition = {
    id: "9ee86bf2-6c54-4c6e-8394-eb39f98d5a85",
    name: "Wiitigo",
    rarity: "rare",
    oracleText:
        "This creature enters with six +1/+1 counters on it.\nAt the beginning of your upkeep, put a +1/+1 counter on this creature if it has blocked or been blocked since your last upkeep. Otherwise, remove a +1/+1 counter from it.",
    manaCost: { X: 3, G: 3 },
    types: ["Creature"],
    subtypes: ["Yeti"],
    power: 0,
    toughness: 0,
    entersWith: { counters: [{ type: "+1/+1", count: 6 }] },
    triggeredAbilities: [
        {
            id: "wiitigo-block-marker",
            oracleText:
                "Mark this creature when it blocks or becomes blocked (tracks the +1/+1 upkeep growth).",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return (
                    event.blockerId === self.id || event.attackerId === self.id
                );
            },
            resolve: (ctx: SpellContext, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // Idempotent marker: keep at most one (multiple block pairs in
                // one combat still mean "blocked since last upkeep").
                if (ctx.getCounterCount(self, WIITIGO_BLOCKED_MARKER) === 0) {
                    ctx.addCounter(self, WIITIGO_BLOCKED_MARKER, 1);
                }
            },
        },
        phaseTrigger({
            id: "wiitigo-upkeep-growth",
            oracleText:
                "At the beginning of your upkeep, put a +1/+1 counter on this creature if it has blocked or been blocked since your last upkeep. Otherwise, remove a +1/+1 counter from it.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                const blocked =
                    ctx.getCounterCount(self, WIITIGO_BLOCKED_MARKER) > 0;
                if (blocked) {
                    ctx.addCounter(self, "+1/+1", 1);
                    ctx.removeCounter(
                        self,
                        WIITIGO_BLOCKED_MARKER,
                        ctx.getCounterCount(self, WIITIGO_BLOCKED_MARKER)
                    );
                } else {
                    ctx.removeCounter(self, "+1/+1", 1);
                }
            },
        }),
    ],
};
// Wild Growth — ICE reprint of the LEA Aura ("enchanted land's controller adds
// an additional {G} when it's tapped for mana"). CardPrint onto the LEA
// definition (ADR 0014).
export const wildGrowthIce: CardPrint = {
    printId: "f8047ab9-a0fc-4933-bcbc-e761aa0f622b",
    definitionId: "fd896dfa-66c0-4327-8e5b-489bbe350c95",
    setCode: "ice",
    rarity: "common",
};
// Woolly Mammoths — "This creature has trample as long as you control a snow
// land." (CR 205.4a.)
//
// SIMPLIFICATION (flagged, same treatment as Dire Wolves' conditional banding):
// the "as long as you control a snow land" clause is a CONTINUOUS keyword gate
// on board state, but `keyword-grant` is applied imperatively at ETB with no
// board-aware re-evaluation. Trample is therefore granted UNCONDITIONALLY — a
// strict superset of the printed behaviour (Woolly Mammoths is played in snow
// decks in practice). A board-aware keyword-grant predicate would track snow
// lands exactly; flagged for a follow-up.
export const woollyMammoths: CardDefinition = {
    id: "eaca1216-99c8-4ad5-a51a-3c4ff3b82097",
    name: "Woolly Mammoths",
    rarity: "common",
    oracleText: "This creature has trample as long as you control a snow land.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 3,
    toughness: 2,
    staticAbilities: ["trample"],
};
// Woolly Spider — 2/3 with Reach and "Whenever this creature blocks a creature
// with flying, this creature gets +0/+2 until end of turn." (CR 702.17 reach;
// CR 509.1h blocks trigger; CR 514.2 expiry.) The blocks trigger fires on
// BLOCKERS_CONFIRMED where self is the blocker and the blocked attacker has
// flying (`hasStaticAbility`).
export const woollySpider: CardDefinition = {
    id: "e10520b2-b5a7-4328-84c8-20443b6f588a",
    name: "Woolly Spider",
    rarity: "common",
    oracleText:
        "Reach (This creature can block creatures with flying.)\nWhenever this creature blocks a creature with flying, this creature gets +0/+2 until end of turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Spider"],
    power: 2,
    toughness: 3,
    staticAbilities: ["reach"],
    triggeredAbilities: [
        {
            id: "woolly-spider-block-flier",
            oracleText:
                "Whenever this creature blocks a creature with flying, this creature gets +0/+2 until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return event.blockerId === self.id;
            },
            resolve: (ctx: SpellContext, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                // "a creature with flying" — the blocked attacker must have
                // flying (CR 702.9). Read its effective keywords.
                const attacker = {
                    type: "permanent" as const,
                    id: event.attackerId,
                };
                if (!ctx.hasStaticAbility(attacker, "flying")) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    0,
                    2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Yavimaya Gnats — 0/1 flier with "{G}: Regenerate this creature." (CR 702.9
// flying; CR 605 activated ability; CR 701.15 regeneration shield.)
export const yavimayaGnats: CardDefinition = {
    id: "9d8b7020-ca8f-4867-bc51-13d824daf154",
    name: "Yavimaya Gnats",
    rarity: "uncommon",
    oracleText: "Flying\n{G}: Regenerate this creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "yavimaya-gnats-regen",
            oracleText: "{G}: Regenerate this creature.",
            cost: { mana: { G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// ── Green capability-cluster stubs (cumulative upkeep — ADR 0042) ────────────
// Fyndhorn Pollen — {2}{G} Enchantment with cumulative upkeep {1} (CR 702.24),
// a continuous "All creatures get -1/-0" anthem (layer 7c) and "{1}{G}: All
// creatures get -1/-0 until end of turn." Static mirrors Weakstone (atq.ts);
// the mass EOT pump mirrors Bone Flute (drk.ts).
export const fyndhornPollen: CardDefinition = {
    id: "3efbe59d-bebc-40b1-85ac-2e4c1ff3731e",
    name: "Fyndhorn Pollen",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAll creatures get -1/-0.\n{1}{G}: All creatures get -1/-0 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            // CR 611 layer 7c — every creature gets -1/-0 (no controller clause).
            kind: "pt-buff",
            applies: (target, _source, ctx) => ctx.isCreature(target),
            power: -1,
            toughness: 0,
        },
    ],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "fyndhorn-pollen-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
    activatedAbilities: [
        {
            id: "fyndhorn-pollen-mass-shrink",
            oracleText: "{1}{G}: All creatures get -1/-0 until end of turn.",
            cost: { mana: { X: 1, G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                    })) {
                        ctx.addTemporaryPTBuff(
                            { type: "permanent", id },
                            -1,
                            0,
                            { phase: "end-of-turn" }
                        );
                    }
                }
            },
        },
    ],
};
// TODO(#628): implement.
// export const giantGrowth: CardDefinition = {
//     id: "431c9749-fd7b-4960-a910-8d41d3704e6c",
//     name: "Giant Growth",
//     rarity: "common",
//     oracleText: "Target creature gets +3/+3 until end of turn.",
//     manaCost: { G: 1 },
//     types: ["Instant"],
// };
// Gorilla Pack — activated above (Green free tranche).
// TODO(#628): implement.
// export const hurricane: CardDefinition = {
//     id: "a8cc6db7-1f40-40e3-a7ea-92f1d05e2e3d",
//     name: "Hurricane",
//     rarity: "uncommon",
//     oracleText: "Hurricane deals X damage to each creature with flying and each player.",
//     manaCost: { X: "X", G: 1 },
//     types: ["Sorcery"],
// };
// TODO(#628): implement.
// export const lure: CardDefinition = {
//     id: "87af69ee-c2bb-46ea-8d36-d484d04a3c8a",
//     name: "Lure",
//     rarity: "uncommon",
//     oracleText: "Enchant creature\nAll creatures able to block enchanted creature do so.",
//     manaCost: { X: 1, G: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Maddening Wind — {2}{G} Aura "Enchant creature" with cumulative upkeep {G}
// (CR 702.24, paid by the Aura's controller — scope "your") and a host-
// controller upkeep trigger dealing 2 damage to the enchanted creature's
// controller (Feedback pattern, lea.ts).
export const maddeningWind: CardDefinition = {
    id: "5277656c-70f5-4660-bd58-7d9261d53fb5",
    name: "Maddening Wind",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nCumulative upkeep {G} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAt the beginning of the upkeep of enchanted creature's controller, this Aura deals 2 damage to that player.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "maddening-wind-cumulative-upkeep",
            cost: { G: 1 },
            costLabel: "{G}",
        }),
        phaseTrigger({
            id: "maddening-wind-upkeep-damage",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, this Aura deals 2 damage to that player.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                ctx.dealDamage({ type: "player", id: hostController }, 2);
            },
        }),
    ],
};
// Pyknite — activated above (Green tranche; duplicate stub removed, #660).
// TODO(#628): implement.
// export const regeneration: CardDefinition = {
//     id: "1dacfaec-6b61-450d-a134-2087c38a298a",
//     name: "Regeneration",
//     rarity: "common",
//     oracleText: "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\n{G}: Regenerate enchanted creature. (The next time that creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
//     manaCost: { X: 1, G: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Rime Dryad — activated above (Green snow cluster); duplicate stub removed.
// TODO(#628): implement.
// export const ritualOfSubdual: CardDefinition = {
//     id: "5c5c01e7-8116-45fc-afc3-d52a31a635cb",
//     name: "Ritual of Subdual",
//     rarity: "rare",
//     oracleText: "Cumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nIf a land is tapped for mana, it produces colorless mana instead of any other type.",
//     manaCost: { X: 4, G: 2 },
//     types: ["Enchantment"],
// };
// Snowblind — activated above (Green snow cluster); duplicate stub removed.
// Thermokarst — activated above (Green free tranche).
// Thoughtleech — activated above (Green free tranche).
// Touch of Vitae — deferred (#660); single stub kept above (duplicate removed).
// Venomous Breath — activated above (Green free tranche).
// Whiteout — activated above (Green snow cluster); duplicate stub removed.
// Wiitigo — activated above (Green free tranche).
// TODO(#628): implement.
// export const wildGrowth: CardDefinition = {
//     id: "f8047ab9-a0fc-4933-bcbc-e761aa0f622b",
//     name: "Wild Growth",
//     rarity: "common",
//     oracleText: "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.",
//     manaCost: { G: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Woolly Mammoths — activated above (Green snow cluster); duplicate stub removed.
// ─────────────────────────────────────────────────────────────────────────────
// MULTICOLOUR free tranche (#635) — the gold ICE cards expressible with
// already-shipped primitives are active CardDefinitions below (Altar of Bone,
// Centaur Archer, Essence Vortex, Giant Trap Door Spider; plus the gold cards
// already activated by their colour batches: Diabolic Vision, Elemental Augury,
// Glaciers, Skeleton Ship, Spectral Shield, Storm Spirit, Stormbind, Wings of
// Aesthir).
//
// DEFERRED (remain commented stubs, owned by a later capability cluster):
//   • Divided-as-you-choose damage — Fiery Justice, Fire Covenant (only the
//     even-split `dealDividedDamage` exists; the player-chosen division
//     primitive is unbuilt). Fire Covenant ALSO needs a pay-X-life additional
//     cost.
//   • Pay-life additional cost — Fumarole ("pay 3 life" as an additional cast
//     cost; `additionalCosts` only models sacrifice/exile today).
//   • Colour-creature attack tax — Flooded Woodlands / Reclamation ("X creatures
//     can't attack unless their controller sacrifices a land per attacker"); a
//     declare-attackers per-attacker sacrifice restriction is unbuilt.
//   • Cross-graveyard reanimation under YOUR control — Hymn of Rebirth
//     (`returnToBattlefield` returns the card under its OWNER's control; putting
//     an opponent's graveyard creature under the caster's control needs a
//     source-owner / controller split).
//   • End-of-combat destroy of blocking-or-blocked-by — Kjeldoran Frostbeast
//     (same delayed end-of-combat combat-relationship trigger flagged for
//     Venomous Breath).
//   • Choose-colour-on-ETB + dynamic protection swap — Chromatic Armor.
//   • Specialized statics / triggers — Earthlink (dies → sac a land), Ghostly
//     Flame (colourless-damage-source static), Monsoon (per-player end-step
//     Island tap + damage), Mountain Titan (cast-trigger counter grant),
//     Merieke Ri Berit (gain control + destroy-on-leave/untap). Each needs a
//     primitive not yet built; flagged for its capability cluster.
// ─────────────────────────────────────────────────────────────────────────────
// Altar of Bone — {G}{W} Sorcery. "As an additional cost to cast this spell,
// sacrifice a creature. Search your library for a creature card, reveal it, put
// it into your hand, then shuffle." (CR 117.9 / 601.2f sacrifice additional cost
// via `additionalCosts.sacrificeFilter`; CR 701.19 library search for a creature
// card → hand; CR 701.20 shuffle.) The reveal is implicit — the searched card
// moves to the caster's hand and the library is shuffled.
export const altarOfBone: CardDefinition = {
    id: "75d5b014-8675-4d91-a539-ac5c31d44b35",
    name: "Altar of Bone",
    rarity: "rare",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card, reveal it, put it into your hand, then shuffle.",
    manaCost: { W: 1, G: 1 },
    types: ["Sorcery"],
    additionalCosts: {
        sacrificeFilter: { types: "Creature", controllerRelation: "you" },
    },
    resolve: (ctx: SpellContext) => {
        const creatures = ctx
            .getLibraryCards(ctx.controller)
            .filter((c) => c.types.includes("Creature"));
        const found = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "altar-of-bone-search",
            kind: "search-library",
            zone: "library",
            candidateIds: creatures.map((c) => c.id),
            count: { min: 0, max: 1 },
            prompt: "Search your library for a creature card.",
        });
        if (found === undefined) return; // suspended for the search
        const foundId = found[0];
        if (foundId) {
            ctx.moveCardById(ctx.controller, foundId, "library", "hand");
        }
        ctx.shuffleLibrary(ctx.controller);
    },
};
// Centaur Archer — {1}{R}{G} 3/2. "{T}: This creature deals 1 damage to target
// creature with flying." (CR 605 activated ability; CR 120.1 damage; the "with
// flying" filter narrows legal targets via `requireAbility`. Modern Scryfall
// Oracle text — ADR 0004.)
export const centaurArcher: CardDefinition = {
    id: "e275c295-72da-4a86-82c6-cfd75b38b19c",
    name: "Centaur Archer",
    rarity: "uncommon",
    oracleText:
        "{T}: This creature deals 1 damage to target creature with flying.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Centaur", "Archer"],
    power: 3,
    toughness: 2,
    activatedAbilities: [
        {
            id: "centaur-archer-ping",
            oracleText:
                "{T}: This creature deals 1 damage to target creature with flying.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                requireAbility: "flying",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.dealDamage(target, 1);
            },
        },
    ],
};
// DEFERRED (#659): needs a CONTINUOUS all-damage-prevention shield keyed to a
// STORED colour choice that protects an Aura's HOST — the same capability that
// keeps Prismatic Ward deferred (#653). The shipped `combat-damage-prevention`
// static is self-only and combat-only; Chromatic Armor prevents ALL damage from
// sources of the chosen colour. Choose-colour-on-ETB is expressible via
// `modes`/`getChosenModeId`, but the `{X}: re-choose colour` clause also needs a
// way to MUTATE the stored colour post-ETB (no such primitive). Flagged for the
// colour-prevention capability cluster alongside Prismatic Ward.
// export const chromaticArmor: CardDefinition = {
//     id: "2657e85b-8f77-41fa-9df2-233443efef43",
//     name: "Chromatic Armor",
//     rarity: "rare",
//     oracleText: "Enchant creature\nAs this Aura enters, choose a color.\nThis Aura enters with a sleight counter on it.\nPrevent all damage that would be dealt to enchanted creature by sources of the last chosen color.\n{X}: Put a sleight counter on this Aura and choose a color. X is the number of sleight counters on this Aura.",
//     manaCost: { X: 1, W: 1, U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// TODO(#628): implement.
// Diabolic Vision — "Look at the top five cards of your library. Put one of
// them into your hand and the rest on top of your library in any order." (CR
// 401 library peek/reorder, CR 121 to hand.) Composition: peek the top five
// (grant knowledge), pick one to move to hand, then reorder the remaining top
// cards.
export const diabolicVision: CardDefinition = {
    id: "1ea01324-1cfb-498c-8299-f690373864bd",
    name: "Diabolic Vision",
    rarity: "uncommon",
    oracleText:
        "Look at the top five cards of your library. Put one of them into your hand and the rest on top of your library in any order.",
    manaCost: { U: 1, B: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        const top = ctx.peekLibraryTop(ctx.controller, 5);
        if (top.length === 0) return;
        ctx.markKnown(ctx.controller, top, ctx.controller);
        const pick = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "diabolic-vision-keep",
            kind: "search-library",
            zone: "library",
            count: 1,
            candidateIds: top,
            prompt: "Put one of the top five cards into your hand.",
        });
        if (pick === undefined) return; // suspended for the choice
        const kept = pick[0];
        if (kept) ctx.moveCardById(ctx.controller, kept, "library", "hand");
        // The rest stay on top; their order is the player's prerogative
        // ("in any order") — reorder among the remaining peeked ids.
        const rest = top.filter((id) => id !== kept);
        const ordered = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "diabolic-vision-reorder",
            kind: "reorder-library",
            zone: "library",
            count: rest.length,
            candidateIds: rest,
            prompt: "Put the rest back on top in any order (first picked ends up on top).",
        });
        if (ordered === undefined) return; // suspended
        ctx.reorderLibraryTop(ctx.controller, ordered);
    },
};
// Earthlink — upkeep "pay {2} or sacrifice" (CR 603.6a phase trigger +
// CR 117.3a may-pay with a hard sacrifice on decline, via the local
// `makeUpkeepPayOrElse`) plus a death trigger: "Whenever a creature dies, that
// creature's controller sacrifices a land of their choice" (CR 603.2 death
// trigger over `scope: "any"`; the dying creature's controller is read from the
// `diedTrigger` last-known-information payload, CR 603.10, and chooses which
// Land to sacrifice via a `sacrifice-permanents` choice, CR 701.16). Modern
// Scryfall oracle text (ADR 0004): the upkeep clause is a flat "pay {2}", NOT
// cumulative upkeep.
const EARTHLINK_ID = "a83cb1c4-7c5b-4a5e-b15e-138d644f5cdb";
export const earthlink: CardDefinition = {
    id: EARTHLINK_ID,
    name: "Earthlink",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {2}.\nWhenever a creature dies, that creature's controller sacrifices a land of their choice.",
    manaCost: { X: 3, B: 1, R: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "earthlink-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {2}.",
            cost: { X: 2 },
            prompt: "Pay {2} to keep Earthlink?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
        diedTrigger({
            id: "earthlink-dies-sac-land",
            oracleText:
                "Whenever a creature dies, that creature's controller sacrifices a land of their choice.",
            scope: "any",
            resolve: (ctx, _event, deadCreature) => {
                const controller = deadCreature.controllerId;
                // CR 701.16 — only ask when the controller actually has a Land
                // to sacrifice (a no-Land board makes the sacrifice a no-op).
                const lands = ctx.getBattlefieldIds(controller, {
                    types: "Land",
                });
                if (lands.length === 0) return;
                const picked = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `earthlink-${ctx.sourceInstanceId}-${deadCreature.id}`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Earthlink: sacrifice a land of your choice.",
                });
                if (picked === undefined) return; // suspended for the choice
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
    ],
};
// Elemental Augury — "{3}: Look at the top three cards of target player's
// library, then put them back in any order." (CR 401 library peek/reorder.)
// The activated ability targets a player; on resolution the controller looks at
// (gains knowledge of) the top three of that player's library and reorders
// them.
export const elementalAugury: CardDefinition = {
    id: "62bbff2a-5109-400a-961b-eacffb9aed67",
    name: "Elemental Augury",
    rarity: "rare",
    oracleText:
        "{3}: Look at the top three cards of target player's library, then put them back in any order.",
    manaCost: { U: 1, B: 1, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "elemental-augury-look",
            oracleText:
                "{3}: Look at the top three cards of target player's library, then put them back in any order.",
            cost: { mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "player") return;
                const top = ctx.peekLibraryTop(t.id, 3);
                if (top.length === 0) return;
                ctx.markKnown(t.id, top, ctx.controller);
                const ordered = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "elemental-augury-reorder",
                    kind: "reorder-library",
                    zone: "library",
                    count: top.length,
                    candidateIds: top,
                    zoneOwnerId: t.id,
                    prompt: "Put the top three cards back in any order (first picked ends up on top).",
                });
                if (ordered === undefined) return; // suspended
                ctx.reorderLibraryTop(t.id, ordered);
            },
        },
    ],
};
// Essence Vortex — {1}{U}{B} Instant. "Destroy target creature unless its
// controller pays life equal to its toughness. A creature destroyed this way
// can't be regenerated." (CR 117.3a / 118.4 — a "pay life unless" offer to the
// target's controller via `requestMayPay` (no mana cost = a yes/no life gate);
// pay `getToughness` life to keep it, else destroy with the no-regen rider
// CR 701.15a.) The toughness is snapshotted at resolution (CR 608.2g).
export const essenceVortex: CardDefinition = {
    id: "fe07e496-5070-4116-a91a-a3bbe19c12af",
    name: "Essence Vortex",
    rarity: "uncommon",
    oracleText:
        "Destroy target creature unless its controller pays life equal to its toughness. A creature destroyed this way can't be regenerated.",
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const toughness = ctx.getToughness(target);
        const controller = ctx.getController(target);
        // CR 118.4 — only offer the life payment when the controller can
        // afford it; otherwise the creature is destroyed outright.
        if (toughness > 0 && ctx.getLife(controller) >= toughness) {
            const pay = ctx.requestMayPay({
                playerId: controller,
                choiceId: `essence-vortex-${target.id}`,
                prompt: `Pay ${toughness} life to keep this creature?`,
            });
            if (pay === undefined) return; // suspended for the choice
            if (pay) {
                ctx.loseLife(controller, toughness);
                return;
            }
        }
        ctx.destroy(target, { cantBeRegenerated: true });
    },
};
// TODO(#628): implement.
// export const fieryJustice: CardDefinition = {
//     id: "8965ce61-0522-4f77-a82d-89441d1ba867",
//     name: "Fiery Justice",
//     rarity: "rare",
//     oracleText: "Fiery Justice deals 5 damage divided as you choose among any number of targets. Target opponent gains 5 life.",
//     manaCost: { W: 1, R: 1, G: 1 },
//     types: ["Sorcery"],
// };
// TODO(#628): implement.
// export const fireCovenant: CardDefinition = {
//     id: "6a0139c2-ad86-4c71-ab6d-4840c37d5d20",
//     name: "Fire Covenant",
//     rarity: "uncommon",
//     oracleText: "As an additional cost to cast this spell, pay X life.\nFire Covenant deals X damage divided as you choose among any number of target creatures.",
//     manaCost: { X: 1, B: 1, R: 1 },
//     types: ["Instant"],
// };
// DEFERRED (#659): the attack restriction is a PER-ATTACKER COST ("can't attack
// unless their controller sacrifices a land ... for each green creature they
// control that's attacking"), not a binary prohibition. The shipped attack-
// restriction static (`global-attack-restriction`, CR 509.1) is forbid/allow
// only — `validateAttackerEligibility` returns eligible/ineligible with no path
// to charge a scaling sacrifice cost as attackers are declared. Modelling
// "can't attack unless pay <cost> per matching attacker" needs a declare-
// attackers cost-payment mechanism (a new combat primitive crossing the declare-
// attackers validator + UI), out of scope for the gold/misc completion slice.
// Twin: Reclamation (same mechanic, black creatures). Flagged for a combat-cost
// capability cluster.
// export const floodedWoodlands: CardDefinition = {
//     id: "de89e9e1-485b-42e5-9728-5d6f948999e1",
//     name: "Flooded Woodlands",
//     rarity: "rare",
//     oracleText: "Green creatures can't attack unless their controller sacrifices a land of their choice for each green creature they control that's attacking. (This cost is paid as attackers are declared.)",
//     manaCost: { X: 2, U: 1, B: 1 },
//     types: ["Enchantment"],
// };
// DEFERRED (#659): "Destroy target creature AND target land" needs TWO distinct
// typed targets on one spell (CR 601.2c). The engine models only a SINGLE
// `targetRequirement` per spell — there is no multi-distinct-requirement
// targeting (a `["Creature","Land"]` type list picks ONE object of EITHER type,
// not one of each). That is a targeting-pipeline addition crossing
// GRE → game.ts selectTarget → frontend, out of scope for the gold/misc
// completion slice. (The "pay 3 life" additional cast cost is separately
// unbuilt — `additionalCosts` models only sacrifice/exile — but the dual-target
// requirement is the gating capability.) Flagged for a dedicated targeting
// cluster.
// export const fumarole: CardDefinition = {
//     id: "efa53e9a-0d7c-4d17-b2be-56930edfa2c2",
//     name: "Fumarole",
//     rarity: "uncommon",
//     oracleText: "As an additional cost to cast this spell, pay 3 life.\nDestroy target creature and target land.",
//     manaCost: { X: 3, B: 1, R: 1 },
//     types: ["Sorcery"],
// };
// TODO(#628): implement.
// export const ghostlyFlame: CardDefinition = {
//     id: "6314344b-6493-4142-9c76-da9b90b8d3e1",
//     name: "Ghostly Flame",
//     rarity: "rare",
//     oracleText: "Black and/or red permanents and spells are colorless sources of damage.",
//     manaCost: { B: 1, R: 1 },
//     types: ["Enchantment"],
// };
// Giant Trap Door Spider — {1}{R}{G} 2/3. "{1}{R}{G}, {T}: Exile this creature
// and target creature without flying that's attacking you." (CR 605 activated
// ability; CR 118.5 / 406 exile. "Without flying" filters legal targets via
// `excludeAbility`; "attacking you" is `combatRoleFilter: "attacking"` — in a
// 2-player game every attacking creature is attacking the lone defender. The
// ability exiles both its source and the chosen attacker.)
export const giantTrapDoorSpider: CardDefinition = {
    id: "8965dfa8-dc90-4cf2-a93b-72bf88b58936",
    name: "Giant Trap Door Spider",
    rarity: "uncommon",
    oracleText:
        "{1}{R}{G}, {T}: Exile this creature and target creature without flying that's attacking you.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Spider"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "giant-trap-door-spider-exile",
            oracleText:
                "{1}{R}{G}, {T}: Exile this creature and target creature without flying that's attacking you.",
            cost: { mana: { X: 1, R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
                excludeAbility: "flying",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.exile(target);
                // Exile the spider itself (CR 118.5) — its own ability paid the
                // tap cost, so it is on the battlefield at resolution.
                ctx.exile({ type: "permanent", id: ctx.sourceInstanceId });
            },
        },
    ],
};
// Glaciers — upkeep pay-{W}{U}-or-sacrifice (CR 603.6a / 117.3a) plus the
// Conversion-style global subtype replacement "All Mountains are Plains"
// (CR 305.7, layer 4 subtype-set).
export const glaciers: CardDefinition = {
    id: "b86e159b-ecf1-4b4a-9041-4e97fdf935e5",
    name: "Glaciers",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {W}{U}.\nAll Mountains are Plains.",
    manaCost: { X: 2, W: 1, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "subtype-set",
            applies: (target) => target.subtypes.includes("Mountain"),
            subtypes: ["Plains"],
        },
    ],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "glaciers-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {W}{U}.",
            cost: { W: 1, U: 1 },
            prompt: "Pay {W}{U} to keep Glaciers?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};
// Hymn of Rebirth — "Put target creature card from a graveyard onto the
// battlefield under your control." (CR 601.2c graveyard target in ANY graveyard;
// CR 400.7 / 800.4a zone change where the OWNER stays the graveyard's owner but
// the CONTROLLER becomes the caster.) Unlike Resurrection (which returns under
// the owner's control), this reanimates cross-graveyard under YOUR control, so
// the resolve passes the caster as the explicit `controllerId` override on
// `returnToBattlefield`. The target carries `t.playerId` — the graveyard's
// owner — used to locate the card; the 4th arg redirects control to the caster.
export const hymnOfRebirth: CardDefinition = {
    id: "61d0f2f2-f6e2-4b8a-8418-10b17c5e0ea9",
    name: "Hymn of Rebirth",
    rarity: "uncommon",
    oracleText:
        "Put target creature card from a graveyard onto the battlefield under your control.",
    manaCost: { X: 3, W: 1, G: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "any",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "graveyard-card" || !t.playerId) return;
        // CR 800.4a — owner stays `t.playerId`; controller becomes the caster.
        ctx.returnToBattlefield(t.playerId, t.id, "graveyard", ctx.controller);
    },
};
// Kjeldoran Frostbeast — "At end of combat, destroy all creatures blocking or
// blocked by this creature." (CR 511.3 END_OF_COMBAT phase trigger, scope
// "each"; CR 701.7 destroy.) The block graph is still live at the END_OF_COMBAT
// step (combat is torn down on step exit), so the resolve reads
// `getBlockersByAttacker()` and walks BOTH directions relative to Frostbeast:
//   • if Frostbeast attacked → the creatures BLOCKING it (its entry's blockers),
//   • if Frostbeast blocked → the attackers it is BLOCKING (entries that list
//     Frostbeast among their blockers).
// Every such partner is destroyed (CR 510.1c damage has already been dealt by
// this step, so survivors of combat are still destroyed by the trigger).
const KJELDORAN_FROSTBEAST_ID = "2fccb1d0-b324-4780-bb9e-4533240da06d";
export const kjeldoranFrostbeast: CardDefinition = {
    id: KJELDORAN_FROSTBEAST_ID,
    name: "Kjeldoran Frostbeast",
    rarity: "uncommon",
    oracleText:
        "At end of combat, destroy all creatures blocking or blocked by this creature.",
    manaCost: { X: 3, W: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Beast"],
    power: 2,
    toughness: 4,
    triggeredAbilities: [
        phaseTrigger({
            id: "kjeldoran-frostbeast-end-of-combat",
            oracleText:
                "At end of combat, destroy all creatures blocking or blocked by this creature.",
            phase: "END_OF_COMBAT",
            scope: "each",
            resolve: (ctx) => {
                const selfId = ctx.sourceInstanceId;
                const blockersByAttacker = ctx.getBlockersByAttacker();
                const partners = new Set<string>();
                for (const [attackerId, blockerIds] of Object.entries(
                    blockersByAttacker
                )) {
                    if (attackerId === selfId) {
                        // Frostbeast attacked → creatures blocking it.
                        for (const id of blockerIds) partners.add(id);
                    } else if (blockerIds.includes(selfId)) {
                        // Frostbeast blocked → the attacker it blocked.
                        partners.add(attackerId);
                    }
                }
                for (const id of partners) {
                    ctx.destroy({ type: "permanent", id });
                }
            },
        }),
    ],
};
// Merieke Ri Berit — "doesn't untap during your untap step" (the
// `does-not-untap` self-keyword, read by the untap step, CR 502.1) + "{T}: Gain
// control of target creature for as long as you control Merieke Ri Berit"
// (CR 613.1b layer-2 control change with the `controller-controls-source`
// condition — the Preacher/Aladdin precedent, auto-reverted by the conditional-
// control SBA when Merieke leaves or changes controller) + "When Merieke Ri
// Berit leaves the battlefield or becomes untapped, destroy that creature. It
// can't be regenerated." (CR 603.10 / 701.20b dual leave-or-untap delayed
// destroy — the Tawnos's Coffin trigger pair.)
//
// Tracking the stolen creature for the destroy clause: on activation Merieke
// stamps a per-source marker counter (`merieke:<sourceInstanceId>`) on the
// stolen creature (idiomatic custom counter, cf. "wind"/"hunger"/"mire"). The
// leave/untap triggers scan the battlefield for that marker, destroy each
// marked creature (no regen, CR 701.15a), and clear the marker — no closure or
// new control primitive needed. Because Merieke "doesn't untap", it normally
// stays tapped (so the untap clause fires only if something force-untaps it).
const MERIEKE_RI_BERIT_ID = "3bf47c0a-5c17-47d0-b663-becff62fbdf8";
function meriekeMarker(sourceInstanceId: string): string {
    return `merieke:${sourceInstanceId}`;
}
// Destroy every creature Merieke had gained control of (marked on steal),
// clearing the marker. Shared by the leave and untap triggers (CR 603.10).
function meriekeDestroyControlled(ctx: SpellContext): void {
    const marker = meriekeMarker(ctx.sourceInstanceId);
    for (const pid of ctx.allPlayerIds) {
        for (const id of ctx.getBattlefieldIds(pid)) {
            const sel: TargetSelection = { type: "permanent", id };
            if (ctx.getCounterCount(sel, marker) > 0) {
                ctx.removeCounter(
                    sel,
                    marker,
                    ctx.getCounterCount(sel, marker)
                );
                ctx.destroy(sel, { cantBeRegenerated: true });
            }
        }
    }
}
export const meriekeRiBerit: CardDefinition = {
    id: MERIEKE_RI_BERIT_ID,
    name: "Merieke Ri Berit",
    rarity: "rare",
    oracleText:
        "Merieke Ri Berit doesn't untap during your untap step.\n{T}: Gain control of target creature for as long as you control Merieke Ri Berit. When Merieke Ri Berit leaves the battlefield or becomes untapped, destroy that creature. It can't be regenerated.",
    manaCost: { W: 1, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 1,
    toughness: 1,
    staticAbilities: ["does-not-untap"],
    activatedAbilities: [
        {
            id: "merieke-ri-berit-steal",
            oracleText:
                "{T}: Gain control of target creature for as long as you control Merieke Ri Berit. When Merieke Ri Berit leaves the battlefield or becomes untapped, destroy that creature. It can't be regenerated.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                // Layer-2 control change, reverted by the SBA the instant
                // Merieke stops being controlled (leaves / changes controller).
                ctx.gainControl(target, ctx.controller, {
                    kind: "controller-controls-source",
                    controllerId: ctx.controller,
                });
                // Mark the stolen creature so the leave/untap destroy clause
                // can find it (CR 603.10 — the "that creature" reference).
                ctx.addCounter(target, meriekeMarker(ctx.sourceInstanceId), 1);
            },
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "merieke-ri-berit-on-leave",
            oracleText:
                "When Merieke Ri Berit leaves the battlefield, destroy that creature. It can't be regenerated.",
            scope: "self",
            resolve: (ctx) => meriekeDestroyControlled(ctx),
        }),
        untapTrigger({
            id: "merieke-ri-berit-on-untap",
            oracleText:
                "When Merieke Ri Berit becomes untapped, destroy that creature. It can't be regenerated.",
            scope: "self",
            resolve: (ctx) => meriekeDestroyControlled(ctx),
        }),
    ],
};
// Monsoon — "At the beginning of each player's end step, tap all untapped
// Islands that player controls and this enchantment deals X damage to the
// player, where X is the number of Islands tapped this way." (CR 603.6a phase
// trigger, scope "each" with the step's player delivered as `scopedPlayerId`;
// CR 701.20a tap; CR 120.1 damage.) Tap only the UNTAPPED Islands (already-
// tapped ones don't count), then deal damage equal to the number tapped this
// way (Power Surge's "untapped lands" read, but Monsoon also TAPS them).
const MONSOON_ID = "254fcc50-79a5-40cd-b028-e78dde3f8480";
export const monsoon: CardDefinition = {
    id: MONSOON_ID,
    name: "Monsoon",
    rarity: "rare",
    oracleText:
        "At the beginning of each player's end step, tap all untapped Islands that player controls and this enchantment deals X damage to the player, where X is the number of Islands tapped this way.",
    manaCost: { X: 2, R: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "monsoon-end-step",
            oracleText:
                "At the beginning of each player's end step, tap all untapped Islands that player controls and this enchantment deals X damage to the player, where X is the number of Islands tapped this way.",
            phase: "END_STEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                const islandIds = ctx.getBattlefieldIds(scopedPlayerId, {
                    subtypes: "Island",
                });
                let tapped = 0;
                for (const id of islandIds) {
                    const sel: TargetSelection = { type: "permanent", id };
                    if (!ctx.getIsTapped(sel)) {
                        ctx.tap(sel);
                        tapped++;
                    }
                }
                if (tapped > 0) {
                    ctx.dealDamage(
                        { type: "player", id: scopedPlayerId },
                        tapped
                    );
                }
            },
        }),
    ],
};
// Mountain Titan — "{1}{R}{R}: Until end of turn, whenever you cast a black
// spell, put a +1/+1 counter on this creature." (CR 605 activated ability that
// arms an until-end-of-turn cast-watch trigger via `grantTriggeredAbility` with
// `{ phase: "end-of-turn" }`, CR 611.1b; the granted rider — a
// `spellCastTrigger(scope:"you", filter:{colors:"B"})` on
// `triggeredGrantTemplates[]` — fires on each black spell you cast and adds a
// +1/+1 counter, CR 122.1.) The Bone Shaman pattern: the rider is grant-only
// (off `triggeredAbilities`) so it functions only while armed. Each activation
// stacks another copy until end of turn, matching the printed wording.
const MOUNTAIN_TITAN_ID = "bcc1d589-02a2-4896-a283-9d0385534667";
export const mountainTitan: CardDefinition = {
    id: MOUNTAIN_TITAN_ID,
    name: "Mountain Titan",
    rarity: "rare",
    oracleText:
        "{1}{R}{R}: Until end of turn, whenever you cast a black spell, put a +1/+1 counter on this creature.",
    manaCost: { X: 2, B: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "mountain-titan-arm-cast-watch",
            oracleText:
                "{1}{R}{R}: Until end of turn, whenever you cast a black spell, put a +1/+1 counter on this creature.",
            cost: { mana: { X: 1, R: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantTriggeredAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    MOUNTAIN_TITAN_ID,
                    "mountain-titan-black-cast-rider",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    // Granted-only rider (CR 113.1): off `triggeredAbilities` so it functions
    // only while armed by the activated ability.
    triggeredGrantTemplates: [
        spellCastTrigger({
            id: "mountain-titan-black-cast-rider",
            oracleText:
                "Whenever you cast a black spell, put a +1/+1 counter on this creature.",
            scope: "you",
            filter: { colors: "B" },
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        }),
    ],
};
// DEFERRED (#659): twin of Flooded Woodlands (black creatures). Same gating
// capability — a per-attacker "can't attack unless sacrifice a land" cost that
// the binary `global-attack-restriction` static cannot express. See the
// Flooded Woodlands note above; flagged for the same combat-cost cluster.
// export const reclamation: CardDefinition = {
//     id: "ca335f4f-d345-4eb9-9bc6-74595c501078",
//     name: "Reclamation",
//     rarity: "rare",
//     oracleText: "Black creatures can't attack unless their controller sacrifices a land of their choice for each black creature they control that's attacking. (This cost is paid as attackers are declared.)",
//     manaCost: { X: 2, W: 1, G: 1 },
//     types: ["Enchantment"],
// };
// Skeleton Ship — legendary 0/3 with a state-triggered "no Islands → sacrifice"
// guard (CR 603.8) and "{T}: Put a -1/-1 counter on target creature" (CR 122,
// layer 7d). The state trigger fizzles at resolve if an Island reappears.
export const skeletonShip: CardDefinition = {
    id: "271c8a7c-0f71-4f9d-ab0e-ca7c8c4aca50",
    name: "Skeleton Ship",
    rarity: "rare",
    oracleText:
        "When you control no Islands, sacrifice Skeleton Ship.\n{T}: Put a -1/-1 counter on target creature.",
    manaCost: { X: 3, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Skeleton"],
    power: 0,
    toughness: 3,
    triggeredAbilities: [
        stateTrigger({
            id: "skeleton-ship-no-islands",
            oracleText: "When you control no Islands, sacrifice Skeleton Ship.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                if (!controller) return false;
                return !controller.battlefield.some((perm) =>
                    perm.subtypes.includes("Island")
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
    activatedAbilities: [
        {
            id: "skeleton-ship-weaken",
            oracleText: "{T}: Put a -1/-1 counter on target creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.addCounter(t, "-1/-1", 1);
            },
        },
    ],
};
// Spectral Shield — Aura: static +0/+2 (layer 7c) and "can't be the target of
// spells" on the host (CR 113.3 — spells only; abilities may still target it).
export const spectralShield: CardDefinition = {
    id: "7fe0a783-d086-4dc8-ae4a-59f3c2daaca0",
    name: "Spectral Shield",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nEnchanted creature gets +0/+2 and can't be the target of spells.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 0, toughness: 2 },
        {
            kind: "permanent-guard",
            id: "spectral-shield-spell-shroud",
            cantBeTargeted: true,
            targetSourceMustBeSpell: true,
            applies: (target, source) => target.id === source.attachedTo,
        },
    ],
};
// Storm Spirit — 3/3 flier with "{T}: deal 2 damage to target creature"
// (CR 605 activated ability, CR 120.1 damage).
export const stormSpirit: CardDefinition = {
    id: "7a383a5f-4814-4b92-aa80-2a6440a719bc",
    name: "Storm Spirit",
    rarity: "rare",
    oracleText: "Flying\n{T}: This creature deals 2 damage to target creature.",
    manaCost: { X: 3, W: 1, U: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "storm-spirit-zap",
            oracleText: "{T}: This creature deals 2 damage to target creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.dealDamage(t, 2);
            },
        },
    ],
};
// Stormbind — R/G Enchantment (activated here as part of the Red tranche, #633):
// "{2}, Discard a card at random: This enchantment deals 2 damage to any
// target." (CR 605 activated ability; the discard-at-random leg of the cost uses
// the `discardAtRandom` cost field; CR 120.1 damage.)
export const stormbind: CardDefinition = {
    id: "c2d5d91b-aeb4-4d7e-b748-77f9960da55f",
    name: "Stormbind",
    rarity: "rare",
    oracleText:
        "{2}, Discard a card at random: This enchantment deals 2 damage to any target.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "stormbind-bolt",
            oracleText:
                "{2}, Discard a card at random: This enchantment deals 2 damage to any target.",
            cost: { mana: { X: 2 }, discardAtRandom: 1 },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 2);
            },
        },
    ],
};
// Wings of Aesthir — Aura: static +1/+0 (layer 7c) plus flying and first
// strike grants on the host (CR 611 keyword-grant).
export const wingsOfAesthir: CardDefinition = {
    id: "eeb0282d-ccec-4556-8b70-b6f665077afe",
    name: "Wings of Aesthir",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nEnchanted creature gets +1/+0 and has flying and first strike.",
    manaCost: { W: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 1, toughness: 0 },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "first strike",
        },
    ],
};
// Adarkar Sentinel — {1}: This creature gets +0/+1 until end of turn (CR 605
// self-pump activated ability; CR 613 layer 7c temporary buff). A colourless
// artifact creature.
export const adarkarSentinel: CardDefinition = {
    id: "ff62754b-f4f0-4731-8dd7-327a820f60a8",
    name: "Adarkar Sentinel",
    rarity: "uncommon",
    oracleText: "{1}: This creature gets +0/+1 until end of turn.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Soldier"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "adarkar-sentinel-pump",
            oracleText: "{1}: This creature gets +0/+1 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    0,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Aegis of the Meek — {1}, {T}: Target 1/1 creature gets +1/+2 until end of
// turn (CR 605 activated ability; CR 613 layer 7c). The "1/1 creature" filter
// is the target's effective power AND toughness (powerFilter + toughnessFilter
// both pinned to 1).
export const aegisOfTheMeek: CardDefinition = {
    id: "5d272051-f442-4f6e-8c64-df28b398d2e8",
    name: "Aegis of the Meek",
    rarity: "rare",
    oracleText: "{1}, {T}: Target 1/1 creature gets +1/+2 until end of turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "aegis-of-the-meek-pump",
            oracleText:
                "{1}, {T}: Target 1/1 creature gets +1/+2 until end of turn.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { min: 1, max: 1 },
                toughnessFilter: { min: 1, max: 1 },
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.addTemporaryPTBuff(t, 1, 2, { phase: "end-of-turn" });
                }
            },
        },
    ],
};
// DEFERRED — Amulet of Quoz is an ante card (CR 407 / ADR 0010 — ante &
// subgames are out of scope). Stays a commented stub permanently.
// export const amuletOfQuoz: CardDefinition = {
//     id: "764ec6a8-a878-446c-b7e4-6026c2a3e9a4",
//     name: "Amulet of Quoz",
//     rarity: "rare",
//     oracleText: "Remove this card from your deck before playing if you're not playing for ante.\n{T}, Sacrifice this artifact: Target opponent may ante the top card of their library. If they don't, you flip a coin. If you win the flip, that player loses the game. If you lose the flip, you lose the game. Activate only during your upkeep.",
//     manaCost: { X: 6 },
//     types: ["Artifact"],
// };
// Arcum's Sleigh — "{2}, {T}: Target creature gains vigilance until end of turn.
// Activate only during combat and only if defending player controls a snow
// land." (CR 205.4a.) `activationPhaseRestriction` to the combat steps;
// `canActivate` gates on a non-active (defending) player controlling a snow land
// (2-player — the defending player is the non-active player).
export const arcumsSleigh: CardDefinition = {
    id: "e9780ce2-756c-48e5-9936-45f6a224f61d",
    name: "Arcum's Sleigh",
    rarity: "uncommon",
    oracleText:
        "{2}, {T}: Target creature gains vigilance until end of turn. Activate only during combat and only if defending player controls a snow land.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "arcums-sleigh-vigilance",
            oracleText:
                "{2}, {T}: Target creature gains vigilance until end of turn. Activate only during combat and only if defending player controls a snow land.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            activationPhaseRestriction: [
                "BEGINNING_OF_COMBAT",
                "DECLARE_ATTACKERS",
                "DECLARE_BLOCKERS",
                "COMBAT_DAMAGE",
                "END_OF_COMBAT",
            ],
            // CR 205.4a — the defending player (non-active, 2-player) controls a
            // snow land.
            canActivate: (_source, state) => {
                const active = state.activePlayerId;
                return state.players.some(
                    (p) => p.id !== active && countSnowLands(p.battlefield) > 0
                );
            },
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.grantStaticAbility(t, "vigilance", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// Arcum's Weathervane — two activated abilities that mutate a target land's snow
// supertype INDEFINITELY (CR 205.4a): one removes Snow from a snow land, the
// other adds Snow to a nonsnow BASIC land. Both use the `setSupertype`
// primitive (sentinel "indefinite" source — not tied to the artifact staying in
// play). Target filtering: the remove ability targets live snow lands
// (`supertypeFilter: ["Snow"]`); the add ability targets basic lands (the
// "nonsnow" clause is enforced in resolve — a no-op if already snow).
export const arcumsWeathervane: CardDefinition = {
    id: "9e142435-6930-4596-bc3b-60abde1229df",
    name: "Arcum's Weathervane",
    rarity: "uncommon",
    oracleText:
        "{2}, {T}: Target snow land is no longer snow.\n{2}, {T}: Target nonsnow basic land becomes snow.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "arcums-weathervane-unsnow",
            oracleText: "{2}, {T}: Target snow land is no longer snow.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                supertypeFilter: ["Snow"],
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.setSupertype(t, "Snow", false);
            },
        },
        {
            id: "arcums-weathervane-snow",
            oracleText: "{2}, {T}: Target nonsnow basic land becomes snow.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            // CR 205.4a — "nonsnow basic land": basic lands only; the nonsnow
            // restriction is moot since adding Snow to an already-snow land is a
            // no-op.
            targetRequirement: {
                type: "Land",
                count: 1,
                supertypeFilter: ["Basic"],
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.setSupertype(t, "Snow", true);
            },
        },
    ],
};
// DEFERRED (#658) — Arcum's Whistle needs an "attacks this turn if able"
// requirement plus a delayed end-step "destroy it if it didn't attack"
// conditional, both keyed on whether the chosen creature actually attacked.
// The engine has no attack-requirement primitive (`mustAttackThisTurn`) nor a
// per-creature "did it attack this turn?" flag readable by a delayed trigger,
// and the "before attackers are declared" activation window isn't expressible
// via `canActivate`. Build the attack-requirement seam first.
// export const arcumsWhistle: CardDefinition = {
//     id: "73c07c87-0e44-4a5a-92b7-728350cd02de",
//     name: "Arcum's Whistle",
//     rarity: "uncommon",
//     oracleText: "{3}, {T}: Choose target non-Wall creature the active player has controlled continuously since the beginning of the turn. That player may pay {X}, where X is that creature's mana value. If they don't pay, the creature attacks this turn if able, and at the beginning of the next end step, destroy it if it didn't attack this turn. Activate only before attackers are declared.",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };
// Barbed Sextant — {1} Artifact. "{1}, {T}, Sacrifice this artifact: Add one
// mana of any color. Draw a card at the beginning of the next turn's upkeep."
// The mana add is a mana ability (CR 605.1a — adds mana, doesn't target), so it
// resolves without the stack (`useStack: false`) with the any-colour pick on
// `manaChoices` (Black Lotus shape). The "draw at the next upkeep" rider can't
// live in the mana-ability `effect` context (which only exposes `addMana`), so
// it rides `armsDelayedTriggerOnTap` (ADR 0040): tapping for mana arms the
// shared `next-upkeep` cantrip delayed trigger, controlled by the activator.
export const barbedSextant: CardDefinition = {
    id: "edb82654-de12-4dce-8c6b-f28d68f0fbe1",
    name: "Barbed Sextant",
    rarity: "common",
    oracleText:
        "{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "barbed-sextant-mana",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card at the beginning of the next turn's upkeep.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            // ADR 0040 — arm the next-upkeep cantrip when tapped for mana.
            armsDelayedTriggerOnTap: {
                triggerId: NEXT_UPKEEP_DRAW_TRIGGER_ID,
                timing: "next-upkeep",
            },
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Baton of Morale — {2}: Target creature gains banding until end of turn
// (CR 605 activated ability; CR 702.22 banding granted via the layer system,
// CR 613 layer 6).
export const batonOfMorale: CardDefinition = {
    id: "8bc29872-b1a2-4851-9eca-f3e67ae6e14c",
    name: "Baton of Morale",
    rarity: "uncommon",
    oracleText: "{2}: Target creature gains banding until end of turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "baton-of-morale-banding",
            oracleText: "{2}: Target creature gains banding until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.grantStaticAbility(t, "banding", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// Celestial Sword — {3}, {T}: Target creature you control gets +3/+3 until end
// of turn, then is sacrificed at the next end step (CR 605 activated ability;
// CR 613 layer 7c buff; CR 603.7b delayed triggered ability for the sacrifice).
const CELESTIAL_SWORD_ID = "2bc0e8d3-633b-4281-863f-c51c69eed0b6";
export const celestialSword: CardDefinition = {
    id: CELESTIAL_SWORD_ID,
    name: "Celestial Sword",
    rarity: "rare",
    oracleText:
        "{3}, {T}: Target creature you control gets +3/+3 until end of turn. Its controller sacrifices it at the beginning of the next end step.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "celestial-sword-pump",
            oracleText:
                "{3}, {T}: Target creature you control gets +3/+3 until end of turn. Its controller sacrifices it at the beginning of the next end step.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                ctx.addTemporaryPTBuff(t, 3, 3, { phase: "end-of-turn" });
                ctx.scheduleDelayedTrigger(
                    CELESTIAL_SWORD_ID,
                    "celestial-sword-sacrifice",
                    "next-end-step",
                    { targetId: t.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "celestial-sword-sacrifice",
            oracleText:
                "Its controller sacrifices it at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (targetId) ctx.sacrifice(targetId);
            },
        },
    ],
};
// Despotic Scepter — {T}: Destroy target permanent you own. It can't be
// regenerated (CR 605 activated ability; CR 701.7 destroy; the
// can't-be-regenerated rider suppresses the regen shield).
export const despoticScepter: CardDefinition = {
    id: "53e381a4-810e-4b75-aed3-c16cf0eb06fa",
    name: "Despotic Scepter",
    rarity: "rare",
    oracleText:
        "{T}: Destroy target permanent you own. It can't be regenerated.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "despotic-scepter-destroy",
            oracleText:
                "{T}: Destroy target permanent you own. It can't be regenerated.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Creature", "Enchantment", "Land"],
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.destroy(t, { cantBeRegenerated: true });
                }
            },
        },
    ],
};
// Crown of the Ages — {4}, {T}: Attach target Aura attached to a creature to
// another creature (CR 605 activated ability; CR 303.4 / 701.3d move-an-aura via
// `reattachAura`). The targeted Aura is chosen via `subtypeFilter: "Aura"`; the
// new creature host is picked mid-resolution from all battlefields. We re-read
// the aura's current host (`getAttachedTo`) and exclude it so the reattach moves
// the aura to a DIFFERENT creature ("another creature").
export const crownOfTheAges: CardDefinition = {
    id: "fce2991f-48e1-4cfe-af0a-18b6d9400493",
    name: "Crown of the Ages",
    rarity: "rare",
    oracleText:
        "{4}, {T}: Attach target Aura attached to a creature to another creature.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "crown-of-the-ages-move-aura",
            oracleText:
                "{4}, {T}: Attach target Aura attached to a creature to another creature.",
            cost: { mana: { X: 4 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                subtypeFilter: "Aura",
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const aura = ctx.targets[0];
                if (aura?.type !== "permanent") return;
                const oldHost = ctx.getAttachedTo(aura.id);
                const creatures = ctx
                    .apNapOrder()
                    .flatMap((pid) =>
                        ctx.getBattlefieldIds(pid, { types: "Creature" })
                    )
                    .filter((id) => id !== oldHost);
                if (creatures.length === 0) return; // no other creature host
                const picked = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "crown-of-the-ages-host",
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    candidateIds: creatures,
                    count: 1,
                    prompt: "Attach the Aura to another creature.",
                });
                if (picked === undefined) return; // suspended
                const newHost = picked[0];
                if (newHost) ctx.reattachAura(aura.id, newHost);
            },
        },
    ],
};
// DEFERRED (#658) — Elkin Bottle needs the impulse-PLAY seam, which is NOT
// shipped. ADR 0026's impulse-draw (`exileFaceDown`) only grants the controller
// permission to LOOK at the exiled card (CR 406.3), not to PLAY/cast it from
// exile within a time window. Granting "until your next upkeep, you may play
// that card" requires a play-permission registry (which exiled cards a player
// may cast, and from which zone), a casting-validator hook that consults it, and
// a delayed end-of-window cleanup — none expressible from shipped primitives.
// Build the impulse-play seam first.
// export const elkinBottle: CardDefinition = {
//     id: "49301c19-55a0-4146-9474-0b86cd320e31",
//     name: "Elkin Bottle",
//     rarity: "rare",
//     oracleText: "{3}, {T}: Exile the top card of your library. Until the beginning of your next upkeep, you may play that card.",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };
// Fyndhorn Bow — {3}, {T}: Target creature gains first strike until end of turn
// (CR 605 activated ability; CR 702.7 first strike granted via the layer system,
// CR 613 layer 6).
export const fyndhornBow: CardDefinition = {
    id: "65dd0a41-cc51-4728-b597-fdb2510accd8",
    name: "Fyndhorn Bow",
    rarity: "uncommon",
    oracleText:
        "{3}, {T}: Target creature gains first strike until end of turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "fyndhorn-bow-first-strike",
            oracleText:
                "{3}, {T}: Target creature gains first strike until end of turn.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.grantStaticAbility(t, "first strike", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// Goblin Lyre — Sacrifice this artifact: Flip a coin. Win → deal damage to
// target opponent equal to creatures you control; lose → deal damage to you
// equal to creatures that opponent controls (CR 605 activated ability with
// sacrifice cost; CR 705.2 coin flip via the suspending `requestCoinFlip`;
// CR 120.1 damage; `getCreatureCount`). Planeswalkers are out of scope, so the
// "or planeswalker" clause collapses to "target opponent".
export const goblinLyre: CardDefinition = {
    id: "951114fb-5ae5-4eb0-8e03-6e39b0b634b5",
    name: "Goblin Lyre",
    rarity: "rare",
    oracleText:
        "Sacrifice this artifact: Flip a coin. If you win the flip, this artifact deals damage to target opponent equal to the number of creatures you control. If you lose the flip, this artifact deals damage to you equal to the number of creatures that opponent controls.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "goblin-lyre-flip",
            oracleText:
                "Sacrifice this artifact: Flip a coin. If you win the flip, this artifact deals damage to target opponent equal to the number of creatures you control. If you lose the flip, this artifact deals damage to you equal to the number of creatures that opponent controls.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "player") return;
                const opponent = t.id;
                const me = ctx.controller;
                const won = ctx.requestCoinFlip({
                    playerId: me,
                    choiceId: "goblin-lyre-coin",
                    heads: {
                        consequence:
                            "Deal damage to the opponent equal to creatures you control.",
                    },
                    tails: {
                        consequence:
                            "Take damage equal to creatures the opponent controls.",
                    },
                });
                if (won === undefined) return; // suspended for the reveal
                if (won) {
                    const n = ctx.getCreatureCount(me);
                    if (n > 0)
                        ctx.dealDamage({ type: "player", id: opponent }, n);
                } else {
                    const n = ctx.getCreatureCount(opponent);
                    if (n > 0) ctx.dealDamage({ type: "player", id: me }, n);
                }
            },
        },
    ],
};
// Talisman cycle (Hematite/Lapis Lazuli/Malachite/Nacre/Onyx) — "Whenever a
// player casts a [color] spell, you may pay {3}. If you do, untap target
// permanent." (CR 603.2 cast trigger via `spellCastTrigger` + SpellFilter color
// gate; CR 117.3a optional `requestMayPay`; CR 701.20b untap.) The untap target
// is chosen mid-resolution from EVERY battlefield via `requestChoice` (a TANTO
// trigger that doesn't pre-target — the modern oracle lets it untap any
// permanent). All five share `makeTalisman`; only the matched color and ids
// differ.
function makeTalisman(args: {
    id: string;
    name: string;
    color: Color;
    colorWord: string;
}): CardDefinition {
    const slug = args.name.toLowerCase().replace(/[^a-z]+/g, "-");
    return {
        id: args.id,
        name: args.name,
        rarity: "uncommon",
        oracleText: `Whenever a player casts a ${args.colorWord} spell, you may pay {3}. If you do, untap target permanent.`,
        manaCost: { X: 2 },
        types: ["Artifact"],
        triggeredAbilities: [
            spellCastTrigger({
                id: `${slug}-untap`,
                oracleText: `Whenever a player casts a ${args.colorWord} spell, you may pay {3}. If you do, untap target permanent.`,
                scope: "any",
                filter: { colors: args.color },
                resolve: (ctx) => {
                    const me = ctx.controller;
                    const accept = ctx.requestMayPay({
                        playerId: me,
                        choiceId: `${slug}-pay`,
                        cost: { X: 3 },
                        prompt: `Pay {3} to untap target permanent with ${args.name}?`,
                    });
                    if (accept === undefined) return; // suspended
                    if (!accept) return;
                    const picked = ctx.requestChoice({
                        playerId: me,
                        choiceId: `${slug}-target`,
                        kind: "choose-permanents",
                        zone: "battlefield",
                        allControllers: true,
                        count: 1,
                        prompt: "Untap target permanent.",
                    });
                    if (picked === undefined) return; // suspended
                    const targetId = picked[0];
                    if (targetId) {
                        ctx.untap({ type: "permanent", id: targetId });
                    }
                },
            }),
        ],
    };
}
export const hematiteTalisman: CardDefinition = makeTalisman({
    id: "83585337-56a9-44d2-9ed1-8a959bcfb010",
    name: "Hematite Talisman",
    color: "R",
    colorWord: "red",
});
// TODO(#628): implement.
// export const iceCauldron: CardDefinition = {
//     id: "1a3e095a-7056-4df3-bf7d-9c217d591446",
//     name: "Ice Cauldron",
//     rarity: "rare",
//     oracleText: "{X}, {T}: You may exile a nonland card from your hand. You may cast that card for as long as it remains exiled. Put a charge counter on this artifact and note the type and amount of mana spent to pay this activation cost. Activate only if there are no charge counters on this artifact.\n{T}, Remove a charge counter from this artifact: Add this artifact's last noted type and amount of mana. Spend this mana only to cast the last card exiled with this artifact.",
//     manaCost: { X: 4 },
//     types: ["Artifact"],
// };
// Icy Manipulator — {1}, {T}: Tap target artifact, creature, or land (CR 605
// activated ability; CR 701.20a tap). The classic tapper; the multi-type target
// is expressed as a CardType array.
export const icyManipulator: CardDefinition = {
    id: "1eda936f-7691-4440-9b83-eb0c6035b109",
    name: "Icy Manipulator",
    rarity: "uncommon",
    oracleText: "{1}, {T}: Tap target artifact, creature, or land.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "icy-manipulator-tap",
            oracleText: "{1}, {T}: Tap target artifact, creature, or land.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Creature", "Land"],
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t) ctx.tap(t);
            },
        },
    ],
};
// Infinite Hourglass — upkeep time-counter accrual + a counter-scaled anthem +
// an any-player {3} counter-removal restricted to upkeep steps (CR 603.6a phase
// trigger via `phaseTrigger`; CR 122 counters via `addCounter`/`removeCounter`;
// CR 613 layer 7c anthem via a `pt-cda` that reads `source.counters.time`;
// CR 602.1 `activatableByAnyPlayer` + CR 602.5 `activationPhaseRestriction:
// ["UPKEEP"]`). The anthem is `pt-cda` (not `pt-buff`) because its magnitude is
// game-state-dependent (the live time-counter count), recomputed every stat read.
export const infiniteHourglass: CardDefinition = {
    id: "f9a42152-32c0-47ff-aaac-8deaf01873ca",
    name: "Infinite Hourglass",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, put a time counter on this artifact.\nAll creatures get +1/+0 for each time counter on this artifact.\n{3}: Remove a time counter from this artifact. Any player may activate this ability but only during any upkeep step.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, _source, ctx) => ctx.isCreature(target),
            compute: (source) => ({
                power: source.counters?.time ?? 0,
                toughness: 0,
            }),
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "infinite-hourglass-accrue",
            oracleText:
                "At the beginning of your upkeep, put a time counter on this artifact.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "time",
                    1
                );
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "infinite-hourglass-remove",
            oracleText:
                "{3}: Remove a time counter from this artifact. Any player may activate this ability but only during any upkeep step.",
            cost: { mana: { X: 3 } },
            useStack: true,
            activatableByAnyPlayer: true,
            activationPhaseRestriction: ["UPKEEP"] as Phase[],
            canActivate: (source) => (source.counters?.time ?? 0) > 0,
            resolve: (ctx: SpellContext) => {
                ctx.removeCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "time",
                    1
                );
            },
        },
    ],
};
// Jester's Cap — {2}, {T}, Sacrifice this artifact: Search target player's
// library for three cards and exile them. Then that player shuffles (CR 605
// activated ability with sacrifice cost; CR 701.19 library search of another
// player's zone via `requestChoice` with `zoneOwnerId`; CR 406 exile;
// CR 701.20 shuffle). The activating player makes the search.
export const jestersCap: CardDefinition = {
    id: "47ac44d0-8090-4e7b-ac47-c567294f185e",
    name: "Jester's Cap",
    rarity: "rare",
    oracleText:
        "{2}, {T}, Sacrifice this artifact: Search target player's library for three cards and exile them. Then that player shuffles.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jesters-cap-strip",
            oracleText:
                "{2}, {T}, Sacrifice this artifact: Search target player's library for three cards and exile them. Then that player shuffles.",
            cost: { mana: { X: 2 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "player") return;
                const targetPlayer = t.id;
                const picked = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "jesters-cap-search",
                    kind: "search-library",
                    zone: "library",
                    zoneOwnerId: targetPlayer,
                    count: { min: 0, max: 3 },
                    prompt: "Search the target player's library for up to three cards to exile.",
                });
                if (picked === undefined) return; // suspended for the search
                for (const id of picked) {
                    ctx.moveCardById(targetPlayer, id, "library", "exile");
                }
                ctx.shuffleLibrary(targetPlayer);
            },
        },
    ],
};
// Jester's Mask — enters tapped; {1},{T},Sac: a target opponent puts their hand
// on top of their library; you search that player's library for that many cards;
// those go to their hand; then they shuffle (CR 110.5b enters tapped; CR 605
// activated ability with mana+tap+sacrifice cost; CR 400.7 zone changes;
// CR 701.19 library search of another player's zone via `requestChoice` with
// `zoneOwnerId`; CR 701.20 shuffle). Composition of shipped primitives: capture
// the hand size, move the whole hand to library (`moveZone`), search for that
// many cards into hand, shuffle. The "on top of library" detail is washed out by
// the mandatory final shuffle, so the library-position primitive isn't needed.
export const jestersMask: CardDefinition = {
    id: "daa1ba0c-cb89-4bb2-8a35-6a4a4eecccf7",
    name: "Jester's Mask",
    rarity: "rare",
    oracleText:
        "This artifact enters tapped.\n{1}, {T}, Sacrifice this artifact: Target opponent puts the cards from their hand on top of their library. Search that player's library for that many cards. That player puts those cards into their hand, then shuffles.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "jesters-mask-rearrange",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Target opponent puts the cards from their hand on top of their library. Search that player's library for that many cards. That player puts those cards into their hand, then shuffles.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "player") return;
                const player = t.id;
                // CR 608.2 stepped resolution: the `moveZone` below is
                // destructive and NOT idempotent, so it must run exactly once.
                // On resume after the search suspension the resolve re-runs from
                // the top — `noteChoice`/`recallChoice` carry the original hand
                // size forward and gate the one-time hand→library move.
                const noted = ctx.recallChoice("jesters-mask-hand-count");
                const firstPass = noted === undefined;
                const handCount = firstPass
                    ? ctx.getHandSize(player)
                    : Number(noted[0]);
                if (firstPass) {
                    // CR 400.7 — the opponent's whole hand goes onto their library.
                    ctx.noteChoice("jesters-mask-hand-count", [
                        String(handCount),
                    ]);
                    ctx.moveZone(player, "hand", "library");
                }
                if (handCount > 0) {
                    // CR 701.19 — the activating player searches that player's
                    // library for `handCount` cards to put into their hand.
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "jesters-mask-search",
                        kind: "search-library",
                        zone: "library",
                        zoneOwnerId: player,
                        count: { min: 0, max: handCount },
                        prompt: `Search the target player's library for up to ${handCount} cards to put into their hand.`,
                    });
                    if (picked === undefined) return; // suspended for the search
                    for (const id of picked) {
                        ctx.moveCardById(player, id, "library", "hand");
                    }
                }
                ctx.shuffleLibrary(player);
            },
        },
    ],
};
// TODO(#628): implement.
// export const jeweledAmulet: CardDefinition = {
//     id: "34f7bad2-d28f-42d2-9246-fe3545ef49a7",
//     name: "Jeweled Amulet",
//     rarity: "uncommon",
//     oracleText: "{1}, {T}: Put a charge counter on this artifact. Note the type of mana spent to pay this activation cost. Activate only if there are no charge counters on this artifact.\n{T}, Remove a charge counter from this artifact: Add one mana of this artifact's last noted type.",
//     types: ["Artifact"],
// };
export const lapisLazuliTalisman: CardDefinition = makeTalisman({
    id: "ce00bb19-983e-427d-be54-ae6daf0ccdde",
    name: "Lapis Lazuli Talisman",
    color: "U",
    colorWord: "blue",
});
export const malachiteTalisman: CardDefinition = makeTalisman({
    id: "63fb8a24-ce53-4a69-be2a-55c6dbba5ee7",
    name: "Malachite Talisman",
    color: "G",
    colorWord: "green",
});
export const nacreTalisman: CardDefinition = makeTalisman({
    id: "06912236-8225-4eb0-8086-c6a163c69892",
    name: "Nacre Talisman",
    color: "W",
    colorWord: "white",
});
// DEFERRED (cumulative upkeep, ADR 0042) — owned by the cumulative-upkeep
// capability cluster. The mana-substitution body ("Plains produce {R}, ...")
// also needs a land-mana-replacement primitive not yet built.
// export const nakedSingularity: CardDefinition = {
//     id: "cabadfb2-93cd-4c7a-b901-59c3dd1a7c3c",
//     name: "Naked Singularity",
//     rarity: "rare",
//     oracleText: "Cumulative upkeep {3} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nIf tapped for mana, Plains produce {R}, Islands produce {G}, Swamps produce {W}, Mountains produce {U}, and Forests produce {B} instead of any other type.",
//     manaCost: { X: 5 },
//     types: ["Artifact"],
// };
export const onyxTalisman: CardDefinition = makeTalisman({
    id: "a89b2368-1180-4821-bcb8-8161c18e5538",
    name: "Onyx Talisman",
    color: "B",
    colorWord: "black",
});
// Pentagram of the Ages — {4}, {T}: The next time a source of your choice would
// deal damage to you this turn, prevent that damage (CR 605 activated ability;
// CR 609.7 "source of your choice" via `requestChoice({ kind: "pick-source" })`;
// CR 615.1/615.6 one-shot source-scoped prevention shield via
// `preventNextDamageFromSource`, the Circle of Protection mechanism).
export const pentagramOfTheAges: CardDefinition = {
    id: "b8d889a5-f6c7-410d-97f9-acf08b9091c8",
    name: "Pentagram of the Ages",
    rarity: "rare",
    oracleText:
        "{4}, {T}: The next time a source of your choice would deal damage to you this turn, prevent that damage.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "pentagram-of-the-ages-prevent",
            oracleText:
                "{4}, {T}: The next time a source of your choice would deal damage to you this turn, prevent that damage.",
            cost: { mana: { X: 4 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `pentagram-source-${ctx.sourceInstanceId}`,
                    kind: "pick-source",
                    zone: "battlefield",
                    allControllers: true,
                    count: 1,
                    prompt: "Pentagram of the Ages: pick the source whose next damage to you this turn is prevented.",
                });
                if (picks === undefined) return; // suspended for the choice
                const sourceId = picks[0];
                if (!sourceId) return;
                ctx.preventNextDamageFromSource(sourceId, ctx.controller, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};
// Pit Trap — {2}, {T}, Sacrifice this artifact: Destroy target attacking
// creature without flying. It can't be regenerated (CR 605 activated ability
// with sacrifice cost; CR 508.1 attacking filter; CR 702.9 "without flying"
// via excludeAbility; CR 701.7 destroy).
export const pitTrap: CardDefinition = {
    id: "c588fe7f-945d-4459-904c-67442f88b4e1",
    name: "Pit Trap",
    rarity: "uncommon",
    oracleText:
        "{2}, {T}, Sacrifice this artifact: Destroy target attacking creature without flying. It can't be regenerated.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "pit-trap-destroy",
            oracleText:
                "{2}, {T}, Sacrifice this artifact: Destroy target attacking creature without flying. It can't be regenerated.",
            cost: { mana: { X: 2 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
                excludeAbility: "flying",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.destroy(t, { cantBeRegenerated: true });
                }
            },
        },
    ],
};
// Runed Arch — enters tapped; {X},{T},Sac: X target creatures with power 2 or
// less can't be blocked this turn (CR 110.5b enters tapped; CR 605 activated
// ability with X-bound target count; CR 107.3 X chosen at activation;
// CR 613 layer 7c power filter; CR 509.1b can't-be-blocked via
// `setCantBeBlockedThisTurn`). `count: "X"` resolves the target count against the
// chosen X; a 0-X activation skips target selection.
export const runedArch: CardDefinition = {
    id: "ca02861b-9639-480d-8e54-e024f0c70158",
    name: "Runed Arch",
    rarity: "rare",
    oracleText:
        "This artifact enters tapped.\n{X}, {T}, Sacrifice this artifact: X target creatures with power 2 or less can't be blocked this turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "runed-arch-unblockable",
            oracleText:
                "{X}, {T}, Sacrifice this artifact: X target creatures with power 2 or less can't be blocked this turn.",
            cost: { mana: { X: "X" }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: "X",
                powerFilter: { max: 2 },
            },
            resolve: (ctx: SpellContext) => {
                for (const target of ctx.targets) {
                    if (target.type === "permanent") {
                        ctx.setCantBeBlockedThisTurn(target);
                    }
                }
            },
        },
    ],
};
// Shield of the Ages — {2}: Prevent the next 1 damage that would be dealt to
// you this turn (CR 605 activated ability; CR 615.1 prevention shield on the
// controller).
export const shieldOfTheAges: CardDefinition = {
    id: "7411ab40-47f6-44d1-8e33-9ff5301dcd9b",
    name: "Shield of the Ages",
    rarity: "uncommon",
    oracleText:
        "{2}: Prevent the next 1 damage that would be dealt to you this turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "shield-of-the-ages-prevent",
            oracleText:
                "{2}: Prevent the next 1 damage that would be dealt to you this turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.preventNextNDamageToTarget(
                    { type: "player", id: ctx.controller },
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Skull Catapult — {1}, {T}, Sacrifice a creature: This artifact deals 2 damage
// to any target (CR 605 activated ability with a sacrifice-a-creature cost via
// `sacrificeFilter`; CR 120.1 / 115.4 "any target" damage).
export const skullCatapult: CardDefinition = {
    id: "eb92a3e6-dc30-4a08-baba-e125290cadc5",
    name: "Skull Catapult",
    rarity: "uncommon",
    oracleText:
        "{1}, {T}, Sacrifice a creature: This artifact deals 2 damage to any target.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "skull-catapult-fling",
            oracleText:
                "{1}, {T}, Sacrifice a creature: This artifact deals 2 damage to any target.",
            cost: {
                mana: { X: 1 },
                tap: true,
                sacrificeFilter: {
                    types: "Creature",
                    controllerRelation: "you",
                },
            },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t) ctx.dealDamage(t, 2);
            },
        },
    ],
};
// Snow Fortress — Defender Wall with two self-pumps and a {3} ping (CR 702.3
// defender; CR 605 activated abilities; CR 613 layer 7c buffs; CR 120.1 damage).
//
// SIMPLIFICATION (flagged, no engine change): the printed ping targets a
// non-flying creature "that's attacking you". The engine's combat-role filter
// can express "attacking" and "without flying" but not the "attacking YOU"
// (the controller is the defending player) refinement. In a duel every
// attacker is attacking Snow Fortress's controller, so the narrower filter
// matches play exactly.
export const snowFortress: CardDefinition = {
    id: "1c480e07-fb26-4760-865f-47985f7447bb",
    name: "Snow Fortress",
    rarity: "rare",
    oracleText:
        "Defender (This creature can't attack.)\n{1}: This creature gets +1/+0 until end of turn.\n{1}: This creature gets +0/+1 until end of turn.\n{3}: This creature deals 1 damage to target creature without flying that's attacking you.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 4,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "snow-fortress-pump-power",
            oracleText: "{1}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "snow-fortress-pump-toughness",
            oracleText: "{1}: This creature gets +0/+1 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    0,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "snow-fortress-ping",
            oracleText:
                "{3}: This creature deals 1 damage to target creature without flying that's attacking you.",
            cost: { mana: { X: 3 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
                excludeAbility: "flying",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.dealDamage(t, 1);
            },
        },
    ],
};
// Soldevi Golem — a 5/3 Golem that doesn't untap normally; instead, at your
// upkeep you may untap a tapped opponent creature to untap it too (CR 702 —
// "doesn't untap" via the `does-not-untap` keyword; CR 603.6a phase trigger;
// CR 117.3a optional `requestMayPay`; CR 701.20b untap). The mid-resolution
// target is a tapped creature an opponent controls, picked via `requestChoice`
// (candidateIds = opponents' tapped creatures); untapping it also untaps Golem.
export const soldeviGolem: CardDefinition = {
    id: "64d35e88-81d3-4a54-aa79-190615abc616",
    name: "Soldevi Golem",
    rarity: "rare",
    oracleText:
        "This creature doesn't untap during your untap step.\nAt the beginning of your upkeep, you may untap target tapped creature an opponent controls. If you do, untap this creature.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 5,
    toughness: 3,
    staticAbilities: ["does-not-untap"],
    triggeredAbilities: [
        phaseTrigger({
            id: "soldevi-golem-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may untap target tapped creature an opponent controls. If you do, untap this creature.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const opponents = ctx.allPlayerIds.filter(
                    (pid) => pid !== scopedPlayerId
                );
                const candidates = opponents.flatMap((pid) =>
                    ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                        tapped: true,
                    })
                );
                if (candidates.length === 0) return; // nothing to untap
                const accept = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: "soldevi-golem-may",
                    prompt: "Untap a tapped creature an opponent controls (and untap Soldevi Golem)?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) return;
                const picked = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: "soldevi-golem-target",
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    candidateIds: candidates,
                    count: 1,
                    prompt: "Untap target tapped creature an opponent controls.",
                });
                if (picked === undefined) return; // suspended
                const targetId = picked[0];
                if (!targetId) return;
                ctx.untap({ type: "permanent", id: targetId });
                ctx.untap({ type: "permanent", id: ctx.sourceInstanceId });
            },
        }),
    ],
};
// Soldevi Simulacrum — {4} Artifact Creature 2/4 with cumulative upkeep {1}
// (CR 702.24, ADR 0042) and firebreathing "{1}: This creature gets +1/+0 until
// end of turn." (CR 611.1 temporary P/T mod, Dragon Engine pattern).
export const soldeviSimulacrum: CardDefinition = {
    id: "9fabc7b6-e766-4e3c-816e-04cfeceaff09",
    name: "Soldevi Simulacrum",
    rarity: "uncommon",
    oracleText:
        "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\n{1}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Soldier"],
    power: 2,
    toughness: 4,
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "soldevi-simulacrum-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
    activatedAbilities: [
        {
            id: "soldevi-simulacrum-firebreathing",
            oracleText: "{1}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Staff of the Ages — Creatures with landwalk abilities can be blocked as
// though they didn't have those abilities (CR 509.1b / 702.13 landwalk-negation
// static, battlefield-scanned). Expressed with the parametric landwalk-negation
// kind (shared with Great Wall / Undertow) listing every basic land subtype, so
// all basic landwalk variants are suppressed at once.
export const staffOfTheAges: CardDefinition = {
    id: "5c709836-55b6-4de9-b190-b5f66dc53c87",
    name: "Staff of the Ages",
    rarity: "rare",
    oracleText:
        "Creatures with landwalk abilities can be blocked as though they didn't have those abilities.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "landwalk-negation",
            id: "staff-of-the-ages-landwalk-negation",
            subtypes: ["Plains", "Island", "Swamp", "Mountain", "Forest"],
            oracleText:
                "Creatures with landwalk abilities can be blocked as though they didn't have those abilities.",
        },
    ],
};
// Sunstone — "{2}, Sacrifice a snow land: Prevent all combat damage that would
// be dealt this turn." The cost combines {2} mana with a snow-typed sacrifice
// (CR 118.5 / 205.4a) via `sacrificeFilter` (Land + Snow supertype, resolved
// live); the effect is `preventAllCombatDamage` (CR 615).
export const sunstone: CardDefinition = {
    id: "3c1c67fa-ff88-4a61-b8a5-8a872b3dc44f",
    name: "Sunstone",
    rarity: "uncommon",
    oracleText:
        "{2}, Sacrifice a snow land: Prevent all combat damage that would be dealt this turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "sunstone-fog",
            oracleText:
                "{2}, Sacrifice a snow land: Prevent all combat damage that would be dealt this turn.",
            cost: {
                mana: { X: 2 },
                sacrificeFilter: { types: "Land", supertypes: ["Snow"] },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.preventAllCombatDamage();
            },
        },
    ],
};
// Time Bomb — upkeep time-counter accrual + a {1},{T},Sac board-wipe scaled by
// the time-counter count (CR 603.6a phase trigger; CR 122 counters; CR 605
// activated ability with mana+tap+sacrifice cost; CR 119/120.1 damage via
// `dealDamageToEach`). The sacrifice is a COST (paid at activation), so by
// resolution the source is off the battlefield — `getCounterCount` reads the
// pre-sacrifice last-known count off the resolving stack item (CR 608.2g).
export const timeBomb: CardDefinition = {
    id: "092ec691-4729-46d3-a4e2-0cfc5df42a31",
    name: "Time Bomb",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, put a time counter on this artifact.\n{1}, {T}, Sacrifice this artifact: This artifact deals damage equal to the number of time counters on it to each creature and each player.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "time-bomb-accrue",
            oracleText:
                "At the beginning of your upkeep, put a time counter on this artifact.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "time",
                    1
                );
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "time-bomb-detonate",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: This artifact deals damage equal to the number of time counters on it to each creature and each player.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const count = ctx.getCounterCount(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "time"
                );
                if (count > 0) {
                    ctx.dealDamageToEach(count, {
                        creatures: true,
                        players: true,
                    });
                }
            },
        },
    ],
};
// DEFERRED (#660) — Urza's Bauble. The next-upkeep cantrip is now buildable
// (the `next-upkeep` delayed-trigger timing shipped with this issue). The
// blocker is "Look at a card AT RANDOM in target player's hand": there is no
// SpellContext primitive that reveals a randomly-chosen card from a hand to the
// looker — the only random-from-hand surface is the `discardAtRandom` COST,
// which discards (not reveals) from the activating player's OWN hand. This is
// the SAME missing general primitive that defers Wand of Ith (drk.ts) — a
// seeded-PRNG "look at a card at random from a hand" pick + `markKnown` to the
// looker. Out of #660's "no new primitive beyond the timing union" scope, so
// flagged for the random-from-hand primitive follow-up. Stub kept verbatim.
// TODO(#628): implement (needs random-from-hand reveal primitive).
// export const urzasBauble: CardDefinition = {
//     id: "58c9e9a7-e170-4361-b7d5-22fc0771c489",
//     name: "Urza's Bauble",
//     rarity: "uncommon",
//     oracleText: "{T}, Sacrifice this artifact: Look at a card at random in target player's hand. You draw a card at the beginning of the next turn's upkeep.",
//     types: ["Artifact"],
// };
// Vexing Arcanix — {3}, {T}: Target player names a card, reveals their top card;
// hit → hand, miss → graveyard + 2 damage to them (CR 605 activated ability;
// CR 202.3 name-a-card via `requestNameCard` made by the TARGET player; CR 701.13
// reveal via `markKnownToAll`; CR 120.1 damage). The named-card choice and the
// reveal are both the target's, so the prompt's `playerId` is the target, not the
// controller.
export const vexingArcanix: CardDefinition = {
    id: "0c9ea118-6a19-4e1b-aa5a-9b2729efc096",
    name: "Vexing Arcanix",
    rarity: "rare",
    oracleText:
        "{3}, {T}: Target player chooses a card name, then reveals the top card of their library. If that card has the chosen name, that player puts it into their hand. Otherwise, they put it into their graveyard and this artifact deals 2 damage to them.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "vexing-arcanix-guess",
            oracleText:
                "{3}, {T}: Target player chooses a card name, then reveals the top card of their library. If that card has the chosen name, that player puts it into their hand. Otherwise, they put it into their graveyard and this artifact deals 2 damage to them.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "player") return;
                const player = t.id;
                const named = ctx.requestNameCard({
                    playerId: player,
                    choiceId: "vexing-arcanix-name",
                    prompt: "Name a card, then reveal the top card of your library.",
                });
                if (named === undefined) return; // suspended on the name choice
                const top = ctx.peekLibraryTop(player, 1)[0];
                if (top === undefined) return; // empty library — nothing to reveal
                ctx.markKnownToAll(player, [top]);
                if (ctx.getCardName(top) === named) {
                    ctx.moveCardById(player, top, "library", "hand");
                } else {
                    ctx.moveCardById(player, top, "library", "graveyard");
                    ctx.dealDamage({ type: "player", id: player }, 2);
                }
            },
        },
    ],
};
// Vibrating Sphere — During your turn, creatures you control get +2/+0; during
// turns other than yours, creatures you control get -0/-2 (CR 611.2c
// turn-conditional anthem via two `pt-buff` static effects gated by
// `state.activePlayerId === source.controllerId`, CR 102.1 turn ownership;
// CR 613 layer 7c). "You" is the controller of Vibrating Sphere.
export const vibratingSphere: CardDefinition = {
    id: "48f93ded-ecf6-4a70-8ca3-a9c0c3201c21",
    name: "Vibrating Sphere",
    rarity: "rare",
    oracleText:
        "During your turn, creatures you control get +2/+0.\nDuring turns other than yours, creatures you control get -0/-2.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId,
            condition: (source, state) =>
                state.activePlayerId === source.controllerId,
            power: 2,
            toughness: 0,
        },
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId,
            condition: (source, state) =>
                state.activePlayerId !== source.controllerId,
            power: 0,
            toughness: -2,
        },
    ],
};
// Walking Wall — Defender Wall with a once-per-turn {3} self-pump that also lets
// it attack despite defender (CR 702.3 defender; CR 605 activated ability;
// CR 613 layer 7c temporary +3/-1 via `addTemporaryPTBuff`; CR 508
// attack-despite-defender via `allowAttackDespiteDefender`; CR 602.5 once-per-turn
// via `oncePerTurn`).
export const walkingWall: CardDefinition = {
    id: "cba1238c-1969-452d-8112-124cbbd49417",
    name: "Walking Wall",
    rarity: "uncommon",
    oracleText:
        "Defender\n{3}: This creature gets +3/-1 until end of turn and can attack this turn as though it didn't have defender. Activate only once each turn.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 6,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "walking-wall-mobilize",
            oracleText:
                "{3}: This creature gets +3/-1 until end of turn and can attack this turn as though it didn't have defender. Activate only once each turn.",
            cost: { mana: { X: 3 } },
            useStack: true,
            oncePerTurn: true,
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.addTemporaryPTBuff(self, 3, -1, { phase: "end-of-turn" });
                ctx.allowAttackDespiteDefender(self);
            },
        },
    ],
};
// Wall of Shields — Defender + Banding artifact Wall (CR 702.3 defender,
// CR 702.22 banding). Pure keyword data.
export const wallOfShields: CardDefinition = {
    id: "6376c7c4-aaca-4625-83d4-a49f01aec535",
    name: "Wall of Shields",
    rarity: "uncommon",
    oracleText:
        "Defender (This creature can't attack.)\nBanding (If any creatures with banding you control are blocking a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by.)",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 4,
    staticAbilities: ["defender", "banding"],
};
// War Chariot — {3}, {T}: Target creature gains trample until end of turn
// (CR 605 activated ability; CR 702.19 trample granted via the layer system,
// CR 613 layer 6).
export const warChariot: CardDefinition = {
    id: "d0ea0c6c-aa76-4b16-bc99-2ff46dc56d4e",
    name: "War Chariot",
    rarity: "uncommon",
    oracleText: "{3}, {T}: Target creature gains trample until end of turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "war-chariot-trample",
            oracleText:
                "{3}, {T}: Target creature gains trample until end of turn.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.grantStaticAbility(t, "trample", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// Whalebone Glider — {2}, {T}: Target creature with power 3 or less gains
// flying until end of turn (CR 605 activated ability; CR 702.9 flying granted
// via the layer system; the "power 3 or less" filter narrows legal targets via
// powerFilter, CR 613 layer 7c effective power).
export const whaleboneGlider: CardDefinition = {
    id: "4b75adf0-9501-4776-a213-456c2b821070",
    name: "Whalebone Glider",
    rarity: "uncommon",
    oracleText:
        "{2}, {T}: Target creature with power 3 or less gains flying until end of turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "whalebone-glider-flying",
            oracleText:
                "{2}, {T}: Target creature with power 3 or less gains flying until end of turn.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 3 },
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.grantStaticAbility(t, "flying", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// Zuran Orb — Sacrifice a land: You gain 2 life (CR 605 activated ability with
// a sacrifice-a-land cost via `sacrificeFilter`; CR 119.3 life gain). A {0}
// artifact (no mana cost). The ability has no mana/tap component — its only
// cost is the land sacrifice.
export const zuranOrb: CardDefinition = {
    id: "3a9d1082-a862-45d4-9e5e-392e879fead6",
    name: "Zuran Orb",
    rarity: "uncommon",
    oracleText: "Sacrifice a land: You gain 2 life.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "zuran-orb-gain-life",
            oracleText: "Sacrifice a land: You gain 2 life.",
            cost: {
                sacrificeFilter: { types: "Land", controllerRelation: "you" },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.gainLife(ctx.controller, 2);
            },
        },
    ],
};
// DEFERRED (painland cycle — capability cluster). "{T}: Add {C}." is free, but
// "{T}: Add {W} or {U}. This land deals 1 damage to you." needs a self-damage
// rider on the COLORED mana ability only (not on every tap, so City of Brass's
// PERMANENT_TAPPED trigger can't model it). The mana-ability `effect` ctx
// (`ActivatedAbilityContext`) exposes only `addMana` — dealing damage from it
// needs the same declarative tap-side-effect seam as ADR 0040
// (`armsDelayedTriggerOnTap`). A `dealsDamageToControllerOnTap` rider on
// `ActivatedAbility`, fired in both tap paths (tapUntap + tapSourceIntoPayment)
// when that ability produced mana, is the clean fix — owned by the painland
// capability cluster, not this free tranche.
// export const adarkarWastes: CardDefinition = {
//     id: "09dd9023-f7ee-4e99-8821-7059deb83730",
//     name: "Adarkar Wastes",
//     rarity: "rare",
//     oracleText: "{T}: Add {C}.\n{T}: Add {W} or {U}. This land deals 1 damage to you.",
//     types: ["Land"],
// };
// DEFERRED (painland cycle — see Adarkar Wastes note; needs the
// `dealsDamageToControllerOnTap` rider, painland capability cluster).
// export const brushland: CardDefinition = {
//     id: "170e5ccd-54bf-4c6d-86b4-0359ca8f36e8",
//     name: "Brushland",
//     rarity: "rare",
//     oracleText: "{T}: Add {C}.\n{T}: Add {G} or {W}. This land deals 1 damage to you.",
//     types: ["Land"],
// };
// DEFERRED (cumulative upkeep — ADR 0042 capability cluster).
// export const glacialChasm: CardDefinition = {
//     id: "3d23f800-7a6f-40e3-b242-9f5955e47a75",
//     name: "Glacial Chasm",
//     rarity: "uncommon",
//     oracleText: "Cumulative upkeep—Pay 2 life. (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhen this land enters, sacrifice a land.\nCreatures you control can't attack.\nPrevent all damage that would be dealt to you.",
//     types: ["Land"],
// };
// DEFERRED (cumulative upkeep — ADR 0042 capability cluster).
// export const hallsOfMist: CardDefinition = {
//     id: "b926a189-90b6-47bb-b5d6-b033e57007b4",
//     name: "Halls of Mist",
//     rarity: "rare",
//     oracleText: "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nCreatures that attacked during their controller's last turn can't attack.",
//     types: ["Land"],
// };
// Ice Floe — land-flavoured untap-lock twin of Mole Worms (CR 611.2 untap-lock
// tied to the source's tapped state via `lockUntapWhileSourceTapped`; CR 502.1
// optional untap via `may-choose-not-to-untap`). Target filter mirrors Giant
// Trap Door Spider: a non-flying attacking creature ("attacking you" in
// 2-player = an opponent's attacker, CR 508.1) via `combatRoleFilter:
// "attacking"` + `excludeAbility: "flying"`.
export const iceFloe: CardDefinition = {
    id: "85ce04fb-e687-41e0-ae9a-16a51df5d943",
    name: "Ice Floe",
    rarity: "uncommon",
    oracleText:
        "You may choose not to untap this land during your untap step.\n{T}: Tap target creature without flying that's attacking you. It doesn't untap during its controller's untap step for as long as this land remains tapped.",
    types: ["Land"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "ice-floe-tap-lock",
            oracleText:
                "{T}: Tap target creature without flying that's attacking you. It doesn't untap during its controller's untap step for as long as this land remains tapped.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
                excludeAbility: "flying",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.tap(target);
                    ctx.lockUntapWhileSourceTapped(target);
                }
            },
        },
    ],
};
// DEFERRED (painland cycle — see Adarkar Wastes note; needs the
// `dealsDamageToControllerOnTap` rider, painland capability cluster).
// export const karplusanForest: CardDefinition = {
//     id: "ba6f1263-d598-49fb-b5f8-09f11822ebd0",
//     name: "Karplusan Forest",
//     rarity: "rare",
//     oracleText: "{T}: Add {C}.\n{T}: Add {R} or {G}. This land deals 1 damage to you.",
//     types: ["Land"],
// };
// DEFERRED (depletion-dual cycle — capability cluster). Needs a
// per-permanent depletion-counter mechanic: tapping for mana adds a counter,
// the upkeep removes one, and the land skips its untap step while any counter
// remains (CR 122 counters + a conditional untap-skip keyed on counter count).
// No existing primitive expresses "don't untap while this has a depletion
// counter" — owned by the depletion capability cluster.
// export const landCap: CardDefinition = {
//     id: "c4806c02-7a4d-42e3-affd-0338084bd3ab",
//     name: "Land Cap",
//     rarity: "rare",
//     oracleText: "This land doesn't untap during your untap step if it has a depletion counter on it.\nAt the beginning of your upkeep, remove a depletion counter from this land.\n{T}: Add {W} or {U}. Put a depletion counter on this land.",
//     types: ["Land"],
// };
// DEFERRED (depletion-dual cycle — capability cluster). Needs a
// per-permanent depletion-counter mechanic: tapping for mana adds a counter,
// the upkeep removes one, and the land skips its untap step while any counter
// remains (CR 122 counters + a conditional untap-skip keyed on counter count).
// No existing primitive expresses "don't untap while this has a depletion
// counter" — owned by the depletion capability cluster.
// export const lavaTubes: CardDefinition = {
//     id: "5e7c2cf6-f36f-451b-bba5-19a82c659c4c",
//     name: "Lava Tubes",
//     rarity: "rare",
//     oracleText: "This land doesn't untap during your untap step if it has a depletion counter on it.\nAt the beginning of your upkeep, remove a depletion counter from this land.\n{T}: Add {B} or {R}. Put a depletion counter on this land.",
//     types: ["Land"],
// };
// DEFERRED (depletion-dual cycle — capability cluster). Needs a
// per-permanent depletion-counter mechanic: tapping for mana adds a counter,
// the upkeep removes one, and the land skips its untap step while any counter
// remains (CR 122 counters + a conditional untap-skip keyed on counter count).
// No existing primitive expresses "don't untap while this has a depletion
// counter" — owned by the depletion capability cluster.
// export const riverDelta: CardDefinition = {
//     id: "ea335fc0-0591-4acd-9ae8-7858222770da",
//     name: "River Delta",
//     rarity: "rare",
//     oracleText: "This land doesn't untap during your untap step if it has a depletion counter on it.\nAt the beginning of your upkeep, remove a depletion counter from this land.\n{T}: Add {U} or {B}. Put a depletion counter on this land.",
//     types: ["Land"],
// };
// DEFERRED (painland cycle — see Adarkar Wastes note; needs the
// `dealsDamageToControllerOnTap` rider, painland capability cluster).
// export const sulfurousSprings: CardDefinition = {
//     id: "2fdeab50-b45f-412b-85a3-c6cf009ce567",
//     name: "Sulfurous Springs",
//     rarity: "rare",
//     oracleText: "{T}: Add {C}.\n{T}: Add {B} or {R}. This land deals 1 damage to you.",
//     types: ["Land"],
// };
// DEFERRED (depletion-dual cycle — capability cluster). Needs a
// per-permanent depletion-counter mechanic: tapping for mana adds a counter,
// the upkeep removes one, and the land skips its untap step while any counter
// remains (CR 122 counters + a conditional untap-skip keyed on counter count).
// No existing primitive expresses "don't untap while this has a depletion
// counter" — owned by the depletion capability cluster.
// export const timberlineRidge: CardDefinition = {
//     id: "87cc2fc9-0a24-4ac1-afcc-9317b90c7178",
//     name: "Timberline Ridge",
//     rarity: "rare",
//     oracleText: "This land doesn't untap during your untap step if it has a depletion counter on it.\nAt the beginning of your upkeep, remove a depletion counter from this land.\n{T}: Add {R} or {G}. Put a depletion counter on this land.",
//     types: ["Land"],
// };
// DEFERRED (painland cycle — see Adarkar Wastes note; needs the
// `dealsDamageToControllerOnTap` rider, painland capability cluster).
// export const undergroundRiver: CardDefinition = {
//     id: "92369d7e-5e5a-46f9-bb31-c57d62410283",
//     name: "Underground River",
//     rarity: "rare",
//     oracleText: "{T}: Add {C}.\n{T}: Add {U} or {B}. This land deals 1 damage to you.",
//     types: ["Land"],
// };
// DEFERRED (depletion-dual cycle — capability cluster). Needs a
// per-permanent depletion-counter mechanic: tapping for mana adds a counter,
// the upkeep removes one, and the land skips its untap step while any counter
// remains (CR 122 counters + a conditional untap-skip keyed on counter count).
// No existing primitive expresses "don't untap while this has a depletion
// counter" — owned by the depletion capability cluster.
// export const veldt: CardDefinition = {
//     id: "987534fb-74a9-46a3-805f-fe2fe2df4a90",
//     name: "Veldt",
//     rarity: "rare",
//     oracleText: "This land doesn't untap during your untap step if it has a depletion counter on it.\nAt the beginning of your upkeep, remove a depletion counter from this land.\n{T}: Add {G} or {W}. Put a depletion counter on this land.",
//     types: ["Land"],
// };
// Plains — ICE reprint of the LEA basic land (CR 305.6 intrinsic mana ability).
// CardPrint onto the LEA definition (ADR 0014); the stub id is the ICE print's
// Scryfall id, used here as the printId.
export const plainsIce: CardPrint = {
    printId: "7b68bdb0-41cc-48f6-905e-7da1ff4ba5e0",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    setCode: "ice",
    rarity: "common",
};
// Snow-Covered Plains — basic land carrying the Snow supertype (CR 205.4a).
// The intrinsic basic mana ability comes from the Plains subtype
// (`LAND_SUBTYPE_MANA`); ICE snow is a TYPE reference only — there is no {S}
// snow mana (that is a later Coldsnap addition; see CONTEXT.md "Snow").
export const snowCoveredPlains: CardDefinition = {
    id: "cb3ac778-fb45-4fd3-a9af-8a0791f833e8",
    name: "Snow-Covered Plains",
    rarity: "common",
    oracleText: "({T}: Add {W}.)",
    types: ["Land"],
    supertypes: ["Basic", "Snow"],
    subtypes: ["Plains"],
};
// Island — ICE reprint of the LEA basic land (CardPrint onto LEA, ADR 0014).
export const islandIce: CardPrint = {
    printId: "ef2d6fc9-ddad-4dd2-b218-afa1a5449b7e",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5",
    setCode: "ice",
    rarity: "common",
};
export const snowCoveredIsland: CardDefinition = {
    id: "ad8b77cf-b53e-4da3-9c27-3851b7b25a98",
    name: "Snow-Covered Island",
    rarity: "common",
    oracleText: "({T}: Add {U}.)",
    types: ["Land"],
    supertypes: ["Basic", "Snow"],
    subtypes: ["Island"],
};
export const snowCoveredSwamp: CardDefinition = {
    id: "65a3c27f-6b15-49b6-ac89-36cfb79b3b54",
    name: "Snow-Covered Swamp",
    rarity: "common",
    oracleText: "({T}: Add {B}.)",
    types: ["Land"],
    supertypes: ["Basic", "Snow"],
    subtypes: ["Swamp"],
};
// Swamp — ICE reprint of the LEA basic land (CardPrint onto LEA, ADR 0014).
export const swampIce: CardPrint = {
    printId: "4695653a-5c4c-4ff3-b80c-f4b6c685f370",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8",
    setCode: "ice",
    rarity: "common",
};
// Mountain — ICE reprint of the LEA basic land (CardPrint onto LEA, ADR 0014).
export const mountainIce: CardPrint = {
    printId: "4ecf39c3-3b5f-4263-a7b5-9881bded3494",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56",
    setCode: "ice",
    rarity: "common",
};
export const snowCoveredMountain: CardDefinition = {
    id: "ccd3afb3-5574-4f2d-adbe-969a428f1c63",
    name: "Snow-Covered Mountain",
    rarity: "common",
    oracleText: "({T}: Add {R}.)",
    types: ["Land"],
    supertypes: ["Basic", "Snow"],
    subtypes: ["Mountain"],
};
// Forest — ICE reprint of the LEA basic land (CardPrint onto LEA, ADR 0014).
export const forestIce: CardPrint = {
    printId: "fbdcbd97-90a9-45ea-94f6-2a1c6faaf965",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
    setCode: "ice",
    rarity: "common",
};
export const snowCoveredForest: CardDefinition = {
    id: "4c0ad95c-d62c-4138-ada0-fa39a63a449e",
    name: "Snow-Covered Forest",
    rarity: "common",
    oracleText: "({T}: Add {G}.)",
    types: ["Land"],
    supertypes: ["Basic", "Snow"],
    subtypes: ["Forest"],
};
