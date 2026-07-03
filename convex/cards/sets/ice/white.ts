// Ice Age (ICE) — White (mono-W) cards, split by colour per ADR 0043.
// The registry's `import * as ice from "./sets/ice"` resolves through
// ice/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {1}{G} → { X: 1, G: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).
import type {
    CardDefinition,
    CardPrint,
    DelayedTriggerDef,
    ManaCost,
    PermanentView,
    SpellContext,
    TriggeredAbility,
} from "../../types";
import { countSnowLands } from "../../snowReads";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { manaCostForCardId } from "../../manaCostLookup";
import { cumulativeUpkeepTrigger } from "../../abilities/cumulativeUpkeep";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";

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
    state: import("../../types").StaticEffectStateView,
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
//     ("can't block power 3+ unless you pay {1}"): ACTIVE (#729). The
//     `block-restriction.bypassCost` field carries the {1}; the engine auto-pays
//     it at block confirmation (`collectBlockBypassCharges`).
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
            // Migrated resolve()→effects[] (ADR 0045, #839): return the source
            // permanent to its owner's hand via the implicit $source binding
            // (CR 701.10 / 400.7).
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
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
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
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
// Hipparion — "This creature can't block creatures with power 3 or greater
// unless you pay {1}." (CR 509.1b — a pay-to-bypass block restriction.) Modelled
// as a blocker-side `block-restriction` whose predicate forbids blocking an
// attacker with effective power 3+ (CR 613 layer 7c — the combat validator
// enriches `power` to its effective value), with a `bypassCost` of {1}. The
// engine permits the block at assignment and auto-pays the {1} from the
// blocker's controller at block confirmation (`collectBlockBypassCharges`).
export const hipparion: CardDefinition = {
    id: "5969875a-f647-4daf-b76c-d1514d45c312",
    name: "Hipparion",
    rarity: "uncommon",
    oracleText:
        "This creature can't block creatures with power 3 or greater unless you pay {1}.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Horse"],
    power: 1,
    toughness: 3,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "hipparion-cant-block-power-3",
            side: "blocker",
            // `self` = Hipparion (the blocker), `opponent` = the attacker.
            // Legal (true) only when the attacker's effective power is < 3.
            predicate: (_self: PermanentView, opponent: PermanentView) =>
                (opponent.power ?? 0) < 3,
            bypassCost: { X: 1 },
            oracleText:
                "This creature can't block creatures with power 3 or greater unless you pay {1}.",
        },
    ],
};
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
            effects: [{ op: "counter", target: { target: 0 } }],
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
            // NOT DSL-migratable yet (ADR 0048): the delayed capture is the
            // trigger-EVENT's dead creature (deadCreature.id) — the tracked
            // $event.<field> grammar gap. Stays resolve().
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
            // Migrated resolve()→effects[] (ADR 0045, #839): return the source
            // permanent ($source) and the targeted creature to their owners'
            // hands (CR 701.10 / 400.7).
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
                { op: "moveZone", target: { target: 0 }, to: "hand" },
            ],
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
