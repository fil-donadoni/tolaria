// INV — red cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type {
    CardDefinition,
    ManaCost,
    SpellContext,
    CardPrint,
    PermanentView,
    StaticEffectStateView,
    StaticEffectContext,
} from "../../types";
import { countDomain, EFFECT_AFFECTS_SELF } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Shared "as long as no opponent controls a white or blue creature" gate (CR
// 611.2c) — Skittish Kavu's `pt-buff.condition` and Kavu Runner's
// `keyword-grant.condition` (issue #1095) share this IDENTICAL board-state
// predicate verbatim; extracted here on the second occurrence per project
// convention (closure on the 1st card, shared helper on the 2nd).
function noOpponentWhiteOrBlueCreature(
    source: PermanentView,
    state: StaticEffectStateView,
    ctx: StaticEffectContext
): boolean {
    return !state.players
        .flatMap((p) => p.battlefield)
        .some(
            (c) =>
                c.controllerId !== source.controllerId &&
                ctx.isCreature(c) &&
                (ctx.getColors(c).includes("W") ||
                    ctx.getColors(c).includes("U"))
        );
}

// Local mana-cost → colours helper (CR 202.2), following the established
// inline-helper precedent (arn/white.ts) rather than importing the shared
// `convex/cards/colors.ts` — that module pulls in `gre/constants.ts`, which
// imports back into `convex/cards/index.ts` (the registry), creating an
// import cycle through the `sets/inv` barrel that leaves `red.ts`'s OWN
// exports still-undefined mid-evaluation (the registry's `Object.values`
// scan then silently drops every card in this file). Used only by
// `declared-attack-restriction` predicates, which get no `ctx` to call
// `StaticEffectContext.getColors` with.
const RED_MANA_COLOR_KEYS = ["W", "U", "B", "R", "G"] as const;
function colorsFromManaCost(cost?: ManaCost): readonly string[] {
    if (!cost) return [];
    return RED_MANA_COLOR_KEYS.filter((c) => (cost[c] ?? 0) > 0);
}

// Overload — "Kicker {2}. Destroy target artifact if its mana value is 2 or
// less. If this spell was kicked, destroy that artifact if its mana value is 5
// or less instead." (CR 702.33 Kicker — the on-resolution effect is DSL; only
// the optional additional cost lives in the engine `kicker` field.) The MV
// threshold, not the target set, changes with the kick, so there is no
// `kickedTargetRequirement`: the spell always targets an artifact and the
// `manaValue` value member (CR 202.3) gates the destroy at resolution.
// Vintage Cube Kicker cluster (issue #692, ADR 0041).
export const overload: CardDefinition = {
    id: "c91fca91-7296-422e-b251-d571b710ff71",
    rarity: "common",
    name: "Overload",
    oracleText:
        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nDestroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that artifact if its mana value is 5 or less instead.",
    manaCost: { R: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}",
            mana: { X: 2 },
        },
    ],
    targetRequirement: { type: "Artifact", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: { target: 0 } } },
                        op: "le",
                        right: 5,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
            else: [
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: { target: 0 } } },
                        op: "le",
                        right: 2,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        },
    ],
};

// Obliterate — "This spell can't be countered. Destroy all artifacts,
// creatures, and lands. They can't be regenerated." (CR 113.6g can't-be-
// countered flag, issue #1065; CR 701.8 destroy + CR 701.19c regen
// suppression.)
//
// NOT DSL-migratable (ADR 0045, issue #831 precedent — Wrath of God is the
// first occurrence of this exact shape, Damnation the second, Jokulhaups the
// third, this the fourth): the `destroy` Op has no "can't be regenerated"
// option, so a `forEach`/`destroy` sweep would let a regeneration shield save
// a permanent (unlike this card). The fix is the existing shared primitive
// `SpellContext.destroyAll`, not a new one. Blocked on: a `cantBeRegenerated`
// option on the `destroy` Op.
export const obliterate: CardDefinition = {
    id: "cdabde40-2143-4677-b7b4-ea8fbf9b1f25",
    rarity: "rare",
    name: "Obliterate",
    oracleText:
        "This spell can't be countered.\nDestroy all artifacts, creatures, and lands. They can't be regenerated.",
    manaCost: { X: 6, R: 2 },
    types: ["Sorcery"],
    cantBeCountered: true,
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll(["Artifact", "Creature", "Land"], {
            cantBeRegenerated: true,
        });
    },
};

// Urza's Rage — "Kicker {8}{R}. This spell can't be countered. Urza's Rage
// deals 3 damage to any target. If this spell was kicked, instead it deals
// 10 damage to that permanent or player and the damage can't be prevented."
// (CR 113.6g can't-be-countered flag, issue #1065; CR 702.33 Kicker; CR 120.1
// damage; CR 615 prevention — the kicked mode's `unpreventable: true` skips
// prevention shields only, generalizing `dealDamage`'s existing preventable
// path — CR 614 replacement/redirection and CR 702.16 protection are
// untouched, same as every other `dealDamage` card.)
export const urzasRage: CardDefinition = {
    id: "61a25a35-3ae4-471e-adcd-d8baf2f77b68",
    rarity: "rare",
    name: "Urza's Rage",
    oracleText:
        "Kicker {8}{R} (You may pay an additional {8}{R} as you cast this spell.)\nThis spell can't be countered.\nUrza's Rage deals 3 damage to any target. If this spell was kicked, instead it deals 10 damage to that permanent or player and the damage can't be prevented.",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {8}{R}",
            mana: { X: 8, R: 1 },
        },
    ],
    cantBeCountered: true,
    targetRequirement: { type: "any", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "dealDamage",
                    amount: 10,
                    to: { target: 0 },
                    unpreventable: true,
                },
            ],
            else: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Tribal Flames — {1}{R} Sorcery. "Domain — Tribal Flames deals X damage to
// any target, where X is the number of basic land types among lands you
// control." (CR 115.4 any target, CR 120.1 damage, CR 702 preamble Domain
// ability word, issue #1066.) The ninth EffectValue grammar member
// `{ domain: { of } }` skins the amount directly — no arithmetic, a straight
// `dealDamage` reuse.
export const tribalFlames: CardDefinition = {
    id: "9b32531e-c759-4603-abd0-1724e8df70db",
    rarity: "common",
    name: "Tribal Flames",
    oracleText:
        "Domain — Tribal Flames deals X damage to any target, where X is the number of basic land types among lands you control.",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    effects: [
        {
            op: "dealDamage",
            amount: { domain: { of: "controller" } },
            to: { target: 0 },
        },
    ],
};

// Kavu Scout — {2}{R} Creature — Kavu Scout, printed 0/2. "Domain — This
// creature gets +1/+0 for each basic land type among lands you control."
// (CR 604.3 CDA, CR 702 preamble Domain ability word, issue #1066.) Mirrors
// Wayfaring Giant's self-scoped `pt-cda` shape (`inv/white.ts`) — only the
// toughness half of the delta is zero (a +1/+0-per-Domain scaling, not
// +1/+1).
export const kavuScout: CardDefinition = {
    id: "cbc2670d-a3f4-47c2-b424-01fd379ff186",
    name: "Kavu Scout",
    rarity: "common",
    oracleText:
        "Domain — This creature gets +1/+0 for each basic land type among lands you control. (Plains, Island, Swamp, Mountain, and Forest are basic land types.)",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu", "Scout"],
    power: 0,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                const domain = countDomain(state, source.controllerId);
                return { power: domain, toughness: 0 };
            },
        },
    ],
};

// Collapsing Borders — {3}{R} Enchantment. "Domain — At the beginning of
// each player's upkeep, that player gains 1 life for each basic land type
// among lands they control. Then this enchantment deals 3 damage to that
// player." (CR 603.6a phase trigger, CR 119.3 life gain, CR 120.1 damage,
// CR 702 preamble Domain ability word, issue #1066.) A per-player symmetric
// trigger (`scope: "each"`) — the DOMAIN READ and both effects target
// WHOEVER'S upkeep it is, not the enchantment's controller, so both
// `player`/`to.player` selectors AND the `domain` value's `of` read the
// scoped player via `{ ref: "$event.activePlayerId" }` (a newly-censused
// `EVENT_FIELD_REGISTRY` row for `PHASE_BEGIN`, ADR 0049) rather than the
// plain `"controller"` selector — this is what keeps an `each`-scope
// triggered ability DSL-first (`phaseTrigger`'s own doc note: a plain
// `"controller"` selector only works for `scope: "your"`; this ref
// bypasses `ctx.controller` entirely).
export const collapsingBorders: CardDefinition = {
    id: "cc019633-788e-4095-9610-6c0a432f7656",
    name: "Collapsing Borders",
    rarity: "rare",
    oracleText:
        "Domain — At the beginning of each player's upkeep, that player gains 1 life for each basic land type among lands they control. Then this enchantment deals 3 damage to that player.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "collapsing-borders-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, that player gains 1 life for each basic land type among lands they control. Then this enchantment deals 3 damage to that player.",
            phase: "UPKEEP",
            scope: "each",
            effects: [
                {
                    op: "gainLife",
                    player: { ref: "$event.activePlayerId" },
                    amount: {
                        domain: { of: { ref: "$event.activePlayerId" } },
                    },
                },
                {
                    op: "dealDamage",
                    amount: 3,
                    to: { player: { ref: "$event.activePlayerId" } },
                },
            ],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche (issue #1072, parent PRD #1063) — reuse-only, DSL-first.
// 9 cards in this tranche hit a genuinely missing engine capability and were
// left as commented stubs at the bottom of this file. Six have since shipped;
// the three that remain are tagged with the issue that owns their specific
// gap (#2146 / #2145 / #1332) — the umbrella #1095 was retired by a tracker
// audit on 2026-08-04.
// ─────────────────────────────────────────────────────────────────────────

// Callous Giant — {4}{R}{R} Creature — Giant, 4/4. "If a source would deal 3
// or less damage to this creature, prevent that damage." (CR 614/615
// replacement effect — the exact Divine Presence clamp template, inv/white.ts,
// generalized from "reduce to 3" to "prevent entirely" via `{kind:"consumed"}`
// instead of `{kind:"modified"}`.)
export const callousGiant: CardDefinition = {
    id: "330028c4-8e91-4fe3-a87d-1660dfd2507e",
    rarity: "rare",
    name: "Callous Giant",
    oracleText:
        "If a source would deal 3 or less damage to this creature, prevent that damage.",
    manaCost: { X: 4, R: 2 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 4,
    toughness: 4,
    replacementEffects: [
        {
            id: "callous-giant-small-damage-prevention",
            oracleText:
                "If a source would deal 3 or less damage to this creature, prevent that damage.",
            eventKind: "damage",
            damageEffectKind: "prevention",
            appliesTo: (event, self) =>
                event.kind === "damage" &&
                event.target.type === "permanent" &&
                event.target.id === self.id &&
                event.amount <= 3,
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

// Chaotic Strike — {1}{R} Instant. "Cast this spell only during combat after
// blockers are declared. Flip a coin. If you win the flip, target creature
// gets +1/+1 until end of turn. Draw a card." (CR 601.3e cast restriction via
// `castPhaseRestriction`, spanning every step from DECLARE_BLOCKERS through
// END_OF_COMBAT — "after blockers are declared" is not just the one step;
// CR 705.2 coin flip via the shipped `coinFlip` Op; the draw is unconditional,
// outside both branches.)
export const chaoticStrike: CardDefinition = {
    id: "061df8e4-6947-4bbb-9fe7-52ca4fd95d65",
    rarity: "uncommon",
    name: "Chaotic Strike",
    oracleText:
        "Cast this spell only during combat after blockers are declared.\nFlip a coin. If you win the flip, target creature gets +1/+1 until end of turn.\nDraw a card.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    castPhaseRestriction: [
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
        "COMBAT_DAMAGE",
        "END_OF_COMBAT",
    ],
    targetRequirement: { type: "Creature", count: 1 },
    // The draw is unconditional (CR 705 coin flip only gates the pump), so
    // it rides in BOTH branches — `isCoinFlipBranch` requires a non-empty
    // `effects` list (ADR 0045), and there is no card-shaped no-op Op to pad
    // an otherwise-empty loss branch with.
    effects: [
        {
            op: "coinFlip",
            win: {
                consequence:
                    "Target creature gets +1/+1 until end of turn. Draw a card.",
                effects: [
                    {
                        op: "pump",
                        target: { target: 0 },
                        power: 1,
                        toughness: 1,
                        duration: { phase: "end-of-turn" },
                    },
                    { op: "draw", player: "controller", count: 1 },
                ],
            },
            loss: {
                consequence: "Draw a card.",
                effects: [{ op: "draw", player: "controller", count: 1 }],
            },
        },
    ],
};

// crownOfFlames — INV reprint of the Tempest definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `tmp/red.ts`.
export const crownOfFlamesInv: CardPrint = {
    printId: "5a46239c-3de7-48ca-8f5c-b51f307fd0e5", // INV 138
    definitionId: "f2c82741-2869-41f9-82f4-6ed88756e2fd", // crownOfFlames (Tempest)
    setCode: "inv",
    rarity: "common",
};

// Halam Djinn — {5}{R} Creature — Djinn, 6/5. "Haste. This creature gets
// -2/-2 as long as red is the most common color among all permanents or is
// tied for most common." (CR 702.10 haste + CR 611.2c conditional CDA anthem
// on itself — the Zanam Djinn / Goham Djinn cycle template, inv/blue.ts /
// inv/black.ts, colour swapped to red.)
const HALAM_DJINN_COLORS = ["W", "U", "B", "R", "G"] as const;
function redIsMostCommonOrTied(
    battlefields: ReadonlyArray<{ colors: readonly string[] }>
): boolean {
    const tally: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const permanent of battlefields) {
        for (const color of permanent.colors) {
            if (color in tally) tally[color]++;
        }
    }
    const red = tally.R;
    return HALAM_DJINN_COLORS.every((c) => tally[c] <= red);
}
export const halamDjinn: CardDefinition = {
    id: "369ade1f-e909-47ae-bb01-19588269ad8f",
    rarity: "uncommon",
    name: "Halam Djinn",
    oracleText:
        "Haste\nThis creature gets -2/-2 as long as red is the most common color among all permanents or is tied for most common.",
    manaCost: { X: 5, R: 1 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 6,
    toughness: 5,
    staticAbilities: ["haste"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: EFFECT_AFFECTS_SELF,
            condition: (_source, state, ctx) =>
                redIsMostCommonOrTied(
                    state.players
                        .flatMap((p) => p.battlefield)
                        .map((c) => ({ colors: ctx.getColors(c) }))
                ),
            power: -2,
            toughness: -2,
        },
    ],
};

// Kavu Aggressor — {2}{R} Creature — Kavu, 3/2. "Kicker {4}. This creature
// can't block. If this creature was kicked, it enters with a +1/+1 counter on
// it." (CR 702.33 Kicker, CR 509.1b block restriction — the Foul Familiar
// "can't block" template, ice/black.ts — CR 122.1/614.1c ETB counter via
// `entersWith.counters` `count: "kicker"`.)
export const kavuAggressor: CardDefinition = {
    id: "a2832ad3-ce7f-44d2-beb2-c95d982905a6",
    rarity: "common",
    name: "Kavu Aggressor",
    oracleText:
        "Kicker {4} (You may pay an additional {4} as you cast this spell.)\nThis creature can't block.\nIf this creature was kicked, it enters with a +1/+1 counter on it.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 2,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {4}",
            mana: { X: 4 },
        },
    ],
    entersWith: { counters: [{ type: "+1/+1", count: "kicker" }] },
    staticEffects: [
        {
            kind: "block-restriction",
            id: "kavu-aggressor-cant-block",
            side: "blocker",
            predicate: () => false,
            oracleText: "Kavu Aggressor can't block.",
        },
    ],
};

// Kavu Monarch — {2}{R}{R} Creature — Kavu, 3/3. "Kavu creatures have
// trample. Whenever another Kavu enters, put a +1/+1 counter on this
// creature." (CR 702.19 trample anthem via `keyword-grant` scanning subtypes
// board-wide — no controller restriction, matching every Kavu including
// itself; CR 603.6a ETB trigger. The `PERMANENT_ENTERED` event carries no
// subtypes (`enteredTrigger`'s `filter` hard-codes an empty subtypes array
// for its subject), so the "Kavu" check rides the trigger's `condition`
// callback instead, reading the entering permanent's live subtypes off
// `state` — the sanctioned "arbitrary domain logic the scope/filter can't
// express" escape hatch documented on `EnteredTriggerArgs.condition`, not
// `resolve()`.)
export const kavuMonarch: CardDefinition = {
    id: "ea63dfd5-d8d7-45b8-8219-1cc2b3de5666",
    rarity: "rare",
    name: "Kavu Monarch",
    oracleText:
        "Kavu creatures have trample.\nWhenever another Kavu enters, put a +1/+1 counter on this creature.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 3,
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target) => target.subtypes.includes("Kavu"),
            keyword: "trample",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "kavu-monarch-tribal-counter",
            oracleText:
                "Whenever another Kavu enters, put a +1/+1 counter on this creature.",
            scope: "any-other",
            condition: (event, _self, state) => {
                if (!state) return false;
                const entering = state.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === event.instanceId);
                return entering?.subtypes.includes("Kavu") ?? false;
            },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
};

// maniacalRage — INV reprint of the Exodus definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `exo/red.ts`.
export const maniacalRageInv: CardPrint = {
    printId: "3d17886c-fffd-4f0d-b4da-4b5fba18b811", // INV 151
    definitionId: "f3aa840f-6a70-4674-acb7-ded0ea4397d8", // maniacalRage (Exodus)
    setCode: "inv",
    rarity: "common",
};

// Pouncing Kavu — {1}{R} Creature — Kavu, 1/1. "Kicker {2}{R}. First strike.
// If this creature was kicked, it enters with two +1/+1 counters on it and
// with haste." (CR 702.33 Kicker, CR 702.7 first strike, CR 122.1/614.1c ETB
// counters — the exact Duskwalker template, inv/black.ts: two `entersWith`
// counter entries each `count: "kicker"`, plus a `keyword-grant` gated on the
// permanent's own `wasKicked` flag, CardInstanceState.wasKicked, gre/state.ts
// — a one-shot fact snapshotted from the resolving stack item's
// `kickerCount` at ETB, issue #1716. Previously this read the `+1/+1` counter
// count the same `entersWith` had just placed as a PROXY for "was kicked",
// which is safe ONLY at the instant of ETB — see the counter-gated statics
// guard, cards/__tests__/counterGatedStatics.test.ts, for the two failure
// modes that made it a proxy and not a live condition.)
export const pouncingKavu: CardDefinition = {
    id: "7e6e2e49-7bde-43c1-8caf-43d237dfc052",
    rarity: "common",
    name: "Pouncing Kavu",
    oracleText:
        "Kicker {2}{R} (You may pay an additional {2}{R} as you cast this spell.)\nFirst strike\nIf this creature was kicked, it enters with two +1/+1 counters on it and with haste.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 1,
    toughness: 1,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}{R}",
            mana: { X: 2, R: 1 },
        },
    ],
    staticAbilities: ["first strike"],
    entersWith: {
        counters: [
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
        ],
    },
    staticEffects: [
        {
            kind: "keyword-grant",
            // No `dependsOnCounters` needed (CR 613.5 / issue #1711) — this
            // predicate no longer reads counters at all. `wasKicked` is a
            // one-shot fact fixed at CR 614.1c ETB replacement time (CR
            // 702.33) and not mutated by anything else while this permanent
            // stays on the battlefield (`CardInstanceState.wasKicked`,
            // gre/state.ts), so it is safe to read whether or not the grant
            // is ever re-evaluated during that time — unlike the `+1/+1`
            // counter count it replaces (issue #1716). It IS cleared on a CR
            // 400.7 zone change (`resetBattlefieldTransientState`, issue
            // #1753), so a bounced-then-recast-unkicked or reanimated Kavu
            // reads `undefined`, not a stale `true`.
            applies: (target, source) =>
                target.id === source.id && target.wasKicked === true,
            keyword: "haste",
        },
    ],
};

// Rage Weaver — {1}{R} Creature — Human Wizard, 2/1. "{2}: Target black or
// green creature gains haste until end of turn." (CR 702.10 haste grant via
// the shipped `grantAbility` Op; `colorFilterAny` restricts legal targets.)
export const rageWeaver: CardDefinition = {
    id: "a654295d-b63c-4025-bf36-899023a8ba1d",
    rarity: "uncommon",
    name: "Rage Weaver",
    oracleText:
        "{2}: Target black or green creature gains haste until end of turn. (It can attack and {T} this turn.)",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "rage-weaver-haste",
            oracleText:
                "{2}: Target black or green creature gains haste until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["B", "G"],
            },
            effects: [
                {
                    op: "grantAbility",
                    ability: "haste",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Rogue Kavu — {1}{R} Creature — Kavu, 1/1. "Whenever this creature attacks
// alone, it gets +2/+0 until end of turn." (CR 508.1 attack declaration —
// `ATTACKERS_DECLARED` carries the full `attackerIds` list, so "attacks
// alone" is a plain custom `matches` predicate checking the declared set is
// exactly this creature; CR 611.2 until-end-of-turn pump via the shipped
// `pump` Op.)
export const rogueKavu: CardDefinition = {
    id: "61e1a445-129d-4bb9-a8b0-3f55e3e0bc58",
    rarity: "common",
    name: "Rogue Kavu",
    oracleText:
        "Whenever this creature attacks alone, it gets +2/+0 until end of turn.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "rogue-kavu-alone",
            oracleText:
                "Whenever this creature attacks alone, it gets +2/+0 until end of turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.length === 1 &&
                event.attackerIds[0] === self.id,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Ruby Leech — {1}{R} Creature — Leech, 2/2. "First strike. Red spells you
// cast cost {R} more to cast." (CR 702.7 first strike + CR 601.2f cost
// increase — the exact Sapphire Leech / Derelor `cost-modifier` template,
// inv/blue.ts / fem/black.ts, colour swapped to red.)
export const rubyLeech: CardDefinition = {
    id: "be621b12-4f4e-43a6-b65e-da4223e742b5",
    rarity: "rare",
    name: "Ruby Leech",
    oracleText: "First strike\nRed spells you cast cost {R} more to cast.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Leech"],
    power: 2,
    toughness: 2,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                ctx.getColors(card).includes("R") &&
                effectSource !== undefined &&
                card.controllerId === effectSource.controllerId,
            costIncrease: { R: 1 },
        },
    ],
};

// Scarred Puma — {R} Creature — Cat, 2/1. "This creature can't attack unless
// a black or green creature also attacks." (CR 508.1c declared-attack
// restriction, evaluated once the full attacking set is known — the Orcish
// Conscripts template. `declared-attack-restriction`'s predicate gets no
// `ctx`, so colour is derived directly off each attacker's raw card via the
// local `colorsFromManaCost` helper above — the same mana-cost-derivation
// `ctx.getColors` itself wraps, just without needing a StaticEffectContext.)
export const scarredPuma: CardDefinition = {
    id: "067ff95e-c4dc-41bb-9677-67f51a09b05a",
    rarity: "common",
    name: "Scarred Puma",
    oracleText:
        "This creature can't attack unless a black or green creature also attacks.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 2,
    toughness: 1,
    staticEffects: [
        {
            kind: "declared-attack-restriction",
            id: "scarred-puma-needs-company",
            predicate: (self, declaredAttackers) =>
                declaredAttackers.some((c) => {
                    if (c.id === self.id) return false;
                    const colors = colorsFromManaCost(
                        (c.card as { manaCost?: ManaCost }).manaCost
                    );
                    return colors.includes("B") || colors.includes("G");
                }),
            oracleText:
                "Scarred Puma can't attack unless a black or green creature also attacks.",
        },
    ],
};

// Searing Rays — {2}{R} Sorcery. "Choose a color. Searing Rays deals damage
// to each player equal to the number of creatures of that color that player
// controls." (CR 700.2 "choose a color" via a 5-mode `optionChoice` — the
// Addle template, inv/black.ts; per player, `count` reads that player's
// battlefield filtered by the chosen color, fed straight into `dealDamage`.)
function searingRaysMode(color: "W" | "U" | "B" | "R" | "G", label: string) {
    return {
        label,
        color,
        effects: [
            {
                op: "forEach" as const,
                select: { set: "players" as const },
                effects: [
                    {
                        op: "dealDamage" as const,
                        amount: {
                            count: {
                                zone: "battlefield" as const,
                                controller: { ref: "$each" },
                                filter: { type: "Creature" as const, color },
                            },
                        },
                        to: { player: { ref: "$each" } },
                    },
                ],
            },
        ],
    };
}
export const searingRays: CardDefinition = {
    id: "4f66ff2d-f2d2-4a6b-bf26-b510de60c0b6",
    rarity: "uncommon",
    name: "Searing Rays",
    oracleText:
        "Choose a color. Searing Rays deals damage to each player equal to the number of creatures of that color that player controls.",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "optionChoice",
            player: "controller",
            prompt: "Choose a color.",
            modes: [
                searingRaysMode("W", "White"),
                searingRaysMode("U", "Blue"),
                searingRaysMode("B", "Black"),
                searingRaysMode("R", "Red"),
                searingRaysMode("G", "Green"),
            ],
        },
    ],
};

// Shivan Harvest — {1}{R} Enchantment. "{1}{R}, Sacrifice a creature: Destroy
// target nonbasic land." (CR 602.1/118.5 sacrifice-a-permanent activation
// cost via `sacrificeFilter`; CR 701.8 destroy; `excludeSupertypes: "Basic"`
// for "nonbasic land" — the Wasteland template.)
export const shivanHarvest: CardDefinition = {
    id: "47dbd765-d7ea-4181-bd22-5c749ad081af",
    rarity: "uncommon",
    name: "Shivan Harvest",
    oracleText: "{1}{R}, Sacrifice a creature: Destroy target nonbasic land.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "shivan-harvest-destroy-land",
            oracleText:
                "{1}{R}, Sacrifice a creature: Destroy target nonbasic land.",
            cost: {
                mana: { X: 1, R: 1 },
                sacrificeFilter: { types: "Creature" },
            },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                excludeSupertypes: "Basic",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Skittish Kavu — {1}{R} Creature — Kavu, 1/1. "This creature gets +1/+1 as
// long as no opponent controls a white or blue creature." (CR 611.2c
// conditional CDA anthem via `pt-buff`'s `condition(source, state, ctx)` —
// the same board-state-aware slot Zanam Djinn / Halam Djinn use for their
// "most common color" gate, here scanning every OTHER controller's
// battlefield for a white/blue creature.)
export const skittishKavu: CardDefinition = {
    id: "be806378-50a7-4416-9d99-1ea2c1f2b7cb",
    rarity: "uncommon",
    name: "Skittish Kavu",
    oracleText:
        "This creature gets +1/+1 as long as no opponent controls a white or blue creature.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: EFFECT_AFFECTS_SELF,
            condition: noOpponentWhiteOrBlueCreature,
            power: 1,
            toughness: 1,
        },
    ],
};

// Skizzik — {3}{R} Creature — Elemental, 5/3. "Kicker {R}. Trample, haste. At
// the beginning of the end step, if this creature wasn't kicked, sacrifice
// it." (CR 702.33 Kicker, CR 702.19 trample, CR 702.10 haste. The recurring
// "at the beginning of the end step" check collapses to a ONE-SHOT decision
// made at ETB — behaviorally identical, since a kicked Skizzik never
// satisfies "wasn't kicked" (the perpetual ability would be permanently
// inert) and an unkicked Skizzik is gone after its first end step (there is
// no second occurrence to re-check). Modeled as a self-ETB trigger reading
// `kickerCount` (the exact Vodalian Serpent / Duskwalker ETB-kicker-read
// idiom) that schedules a `delayedTrigger` sacrifice — the Kjeldoran Elite
// Guard / Kjeldoran Guard `capture: { ref: "$source" }` + `sacrifice: {
// target: { ref } }` template, ice/white.ts.)
export const skizzik: CardDefinition = {
    id: "dc7732bc-e168-44d9-923a-db7e985bd6db",
    rarity: "rare",
    name: "Skizzik",
    oracleText:
        "Kicker {R} (You may pay an additional {R} as you cast this spell.)\nTrample, haste\nAt the beginning of the end step, if this creature wasn't kicked, sacrifice it.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 5,
    toughness: 3,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {R}",
            mana: { R: 1 },
        },
    ],
    staticAbilities: ["trample", "haste"],
    triggeredAbilities: [
        enteredTrigger({
            id: "skizzik-unkicked-check",
            oracleText:
                "At the beginning of the end step, if this creature wasn't kicked, sacrifice it.",
            scope: "self",
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "lt",
                        right: 1,
                    },
                    then: [
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "At the beginning of the end step, sacrifice this creature.",
                            capture: { $it: { ref: "$source" } },
                            effects: [
                                { op: "sacrifice", target: { ref: "$it" } },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
};

// Slimy Kavu — {2}{R} Creature — Kavu, 2/2. "{T}: Target land becomes a
// Swamp until end of turn." (CR 305.7 land-type change. NOT DSL-migratable,
// ADR 0045 — the Orcish Farmer (ice/red.ts) / Vision Charm (vis/blue.ts)
// precedent: a land-type change has no Effect Script Op wrapper around the
// existing SpellContext primitive `setSubtypesUntil` (no "setSubtype" Op is
// registered). Same execution path as both precedents — only the duration
// differs, "until end of turn" here vs. "until its controller's next untap
// step" / "until end of turn" there.)
export const slimyKavu: CardDefinition = {
    id: "8e82044d-88cd-4ee4-8ec9-e71a0a85ed46",
    rarity: "common",
    name: "Slimy Kavu",
    oracleText: "{T}: Target land becomes a Swamp until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "slimy-kavu-swamp",
            oracleText: "{T}: Target land becomes a Swamp until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                ctx.setSubtypesUntil(t, ["Swamp"], { phase: "end-of-turn" });
            },
        },
    ],
};

// stun — INV reprint of the Tempest definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `tmp/red.ts`.
export const stunInv: CardPrint = {
    printId: "d22f3ae8-a40b-4dab-abf4-3ab7b05191f7", // INV 162
    definitionId: "c09c0da6-37a7-42ba-b264-18898ee372f0", // stun (Tempest)
    setCode: "inv",
    rarity: "common",
};

// Tectonic Instability — {2}{R} Enchantment. "Whenever a land enters, tap
// all lands its controller controls." (CR 603.6a ETB trigger for ANY land,
// any controller; the `forEach` selector's `controller` field takes the
// entering land's controller via a newly-censused `$event.controllerId` ref
// on `PERMANENT_ENTERED` — the exact `EVENT_FIELD_REGISTRY` growth pattern
// Collapsing Borders used for `PHASE_BEGIN.activePlayerId` above, issue
// #1066 — then taps every land that player controls via `tapUntap`.)
export const tectonicInstability: CardDefinition = {
    id: "0476cc6b-ecc6-44d6-9f44-a90d4ee85daa",
    rarity: "rare",
    name: "Tectonic Instability",
    oracleText:
        "Whenever a land enters, tap all lands its controller controls.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "tectonic-instability-tap",
            oracleText:
                "Whenever a land enters, tap all lands its controller controls.",
            event: "PERMANENT_ENTERED",
            matches: (event) =>
                event.type === "PERMANENT_ENTERED" &&
                event.types.includes("Land"),
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: { ref: "$event.controllerId" },
                        filter: { type: "Land" },
                    },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Zap — {2}{R} Instant. "Zap deals 1 damage to any target. Draw a card." (CR
// 115.4 any target, CR 120.1 damage, CR 121.1 draw.)
export const zap: CardDefinition = {
    id: "7502ce01-b762-40fe-a064-c7b20b08a722",
    rarity: "common",
    name: "Zap",
    oracleText: "Zap deals 1 damage to any target.\nDraw a card.",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    effects: [
        { op: "dealDamage", amount: 1, to: { target: 0 } },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Breath of Darigaaz — {1}{R} Sorcery. "Kicker {2}. Breath of Darigaaz deals
// 1 damage to each creature without flying and each player. If this spell was
// kicked, it deals 4 damage to each creature without flying and each player
// instead." (CR 702.33 Kicker, CR 120.1 damage. NOT DSL-migratable, ADR 0045
// #852 — the Earthquake precedent, lea/red.ts: "each creature without
// flying" needs an ABILITY-EXCLUSION filter on a forEach permanents set;
// `EffectCardFilter` is type/subtype/colour/mana-value only. Blocked on a
// forEach ability-exclusion filter, not on the kicker branch — that's a
// plain `ctx.getKickerCount()` read composed with the existing
// `dealDamageToEach` primitive Earthquake already uses.)
export const breathOfDarigaaz: CardDefinition = {
    id: "480bb7e3-df03-454d-ada0-592ef8a4a6f0",
    rarity: "uncommon",
    name: "Breath of Darigaaz",
    oracleText:
        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nBreath of Darigaaz deals 1 damage to each creature without flying and each player. If this spell was kicked, it deals 4 damage to each creature without flying and each player instead.",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}",
            mana: { X: 2 },
        },
    ],
    resolve: (ctx: SpellContext) => {
        const amount = ctx.getKickerCount() > 0 ? 4 : 1;
        ctx.dealDamageToEach(amount, {
            creatures: { excludeAbility: "flying" },
            players: true,
        });
    },
};

// Kavu Runner — {3}{R} Creature — Kavu, 3/3. "This creature has haste as long
// as no opponent controls a white or blue creature." (CR 611.2c board-state-
// conditional keyword grant via `keyword-grant`'s new `condition` field
// (issue #1095, generalize-don't-add) — mirrors `pt-buff`'s `condition`,
// which Skittish Kavu above already uses for the IDENTICAL "as long as no
// opponent controls a white or blue creature" gate, just granting `haste`
// here instead of a +1/+1 buff. Re-evaluated every SBA pass by
// `refreshCounterGatedStatics` (`gre/state.ts`) so haste appears/disappears
// as the opponent's board changes, not just once at ETB.)
export const kavuRunner: CardDefinition = {
    id: "2bc1b462-4e3c-47cc-87c5-f6e29dd70c01",
    rarity: "uncommon",
    name: "Kavu Runner",
    oracleText:
        "This creature has haste as long as no opponent controls a white or blue creature.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 3,
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: EFFECT_AFFECTS_SELF,
            condition: noOpponentWhiteOrBlueCreature,
            keyword: "haste",
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// The former #1095 parking lot. Cards here were stubbed because the capability
// they need did not exist; each one that has since SHIPPED sits inline with
// the gap that unblocked it recorded above it, and the rest stay commented
// with a live `tracked-by:` pointing at the issue that owns THAT gap. Never
// invented Ops — a stub cites the exact gap and the tracking issue.
//
// #1095 itself was retired by a tracker audit on 2026-08-04 (audited
// `83e6805e`): six of its nine gaps had shipped, and the three survivors were
// split into issues of their own, so nothing points at the umbrella any more.
//
// Shipped: Kavu Runner (#1811, board-state-conditional keyword grant),
// Goblin Spy (#2111, continuous library-top reveal), Ancient Kavu (#1083's
// `setColor`), Lightning Dart (#1747's `objectMatchesFilter`), Loafing Giant
// (#1955's source-scoped shield + #2144's `mill` bind), Scorching Lava
// (#1283's `preventRegeneration` + #2144's `exileOnDeath`).
// Still blocked: Ghitu Fire (#2146 — conditional flash for an ADDITIONAL
// cost, CR 601.3c; five INV cards share this one gap), Turf Wound (#2145 —
// per-PLAYER land-play restriction; the only lock today is global), Mages'
// Contest (#1332 — bidding, a single-consumer line on the INV one-off bucket,
// gated behind #2071's voting sequencer and #1421's `chooseNumber`).
// ─────────────────────────────────────────────────────────────────────────

// Ancient Kavu — {3}{R} Creature — Kavu, 3/3. "{2}: This creature becomes
// colorless until end of turn." (CR 613.1e layer 5 colour-setting, CR 105.2c
// colourless is the ABSENCE of colour rather than a sixth colour — so the
// empty `colors: []` set, not a "colorless" member.) Was the `setColor` gap
// of issue #1095; `setColor` shipped `implemented` with issue #1083 (Blind
// Seer / Metathran Transport / Sway of Illusion), so this is now a pure
// reuse: `$source` self-target, the same `{ phase: "end-of-turn" }` duration
// Metathran Transport uses.
export const ancientKavu: CardDefinition = {
    id: "c8ccb5d0-735b-443f-addd-8b70f5f2c60d",
    name: "Ancient Kavu",
    rarity: "common",
    oracleText: "{2}: This creature becomes colorless until end of turn.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "ancient-kavu-colorless",
            oracleText:
                "{2}: This creature becomes colorless until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            effects: [
                {
                    op: "setColor",
                    target: { ref: "$source" },
                    colors: [],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Ghitu Fire — the CR 601.3c conditional-flash rider (issue #2146), shipped
// as `flashSurcharge`. The only member of the Invasion cycle with an {X} in
// its cost, and the one that shows why the rider is a SURCHARGE and not an
// `AlternativeCost`: the {2} joins {X}{R} (CR 601.2f), it does not replace it,
// so casting for X=3 on the opponent's turn costs {5}{R} and the same cast in
// your own main phase costs {3}{R}. The damage half is Lava Burst's body
// (`ice/red.ts`).
export const ghituFire: CardDefinition = {
    id: "78827acd-a526-411b-bd22-ab9b538c75dd",
    name: "Ghitu Fire",
    rarity: "rare",
    oracleText:
        "You may cast this spell as though it had flash if you pay {2} more to cast it. Ghitu Fire deals X damage to any target.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    flashSurcharge: { X: 2 },
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: { X: true }, to: { target: 0 } }],
};

// Goblin Spy — CR 401.5 continuous library-top reveal (issue #1095 gap 7).
// "Play with the top card of your library revealed" is a static ability whose
// continuous effect runs for exactly as long as the permanent is on the
// battlefield (CR 604.2), so it is a flat `revealsLibraryTop` scope read LIVE
// off the battlefield by `computeLibraryTopRevealedPlayers`
// (`convex/gre/libraryReveal.ts`) — the exact shape `revealsHand` uses for the
// other hidden zone. Never a stored flag: CR 401.6 / 701.20d make the reveal a
// property of the POSITION, so a draw / shuffle / mill / put-on-top changes
// what is revealed with nothing to update, and the reveal simply stops when the
// Spy leaves play. CR 613.11 — it modifies the rules of the game (what players
// may see), not any object's characteristics, so it is deliberately not a
// layered `StaticEffect`. CR 400.2 — the library stays a hidden zone; exactly
// one card's identity is exposed, symmetrically, to both players.
export const goblinSpy: CardDefinition = {
    id: "2a89a099-8805-4b26-babd-5d9f48ee406a",
    name: "Goblin Spy",
    rarity: "uncommon",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Rogue"],
    power: 1,
    toughness: 1,
    oracleText: "Play with the top card of your library revealed.",
    revealsLibraryTop: "controller",
};

// Lightning Dart — {1}{R} Instant. "Lightning Dart deals 1 damage to target
// creature. If that creature is white or blue, Lightning Dart deals 4 damage
// to it instead." (CR 120.1 damage, CR 202.2 / 613 layer 5 colour.) Was the
// "colour-based `if` predicate" gap of issue #1095: the predicate grammar has
// since grown `objectMatchesFilter` (issue #1747, Figure of Destiny), which
// tests an object selector against a full `EffectCardFilter` — and `color`
// has OR-within-the-field semantics, so `{ color: ["W", "U"] }` IS "white or
// blue". Deliberately the LIVE read, not a snapshot: it resolves through the
// layer-materialised battlefield matcher, so a creature painted blue by
// Painter's Servant (or made white by a resolving effect between announcement
// and resolution) takes 4, exactly as CR 613 requires.
//
// The two damage amounts are if/else branches of ONE `dealDamage`, never two:
// "instead" replaces the amount, so a white creature is dealt 4 in a single
// damage event — a 1-then-4 sequence would double-trigger every "whenever
// damage is dealt" watcher and blow through a 1-damage prevention shield
// twice (CR 615.1).
export const lightningDart: CardDefinition = {
    id: "54d05157-d154-4203-bf3e-add110cb1cee",
    name: "Lightning Dart",
    rarity: "uncommon",
    oracleText:
        "Lightning Dart deals 1 damage to target creature. If that creature is white or blue, Lightning Dart deals 4 damage to it instead.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "if",
            predicate: {
                objectMatchesFilter: { target: 0 },
                filter: { color: ["W", "U"] },
            },
            then: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
            else: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Loafing Giant — {4}{R} Creature — Giant, 4/6. "Whenever this creature
// attacks or blocks, mill a card. If a land card was milled this way, prevent
// all combat damage this creature would deal this turn." (CR 508.1 / 509.1
// attack-or-block trigger, CR 701.17 mill, CR 615 prevention.) Was the
// "source-only combat damage prevention" gap of issue #1095, closed on both
// sides:
//
//  - the SHIELD half shipped with issue #1955 — `preventDamage`'s
//    `"all-from-source"` mode is exactly "prevent all damage this ONE
//    permanent would deal", and `combatOnly: true` narrows it to CR 510
//    combat damage. Turn-scoped by construction (every source-scoped shield
//    expires at CLEANUP, CR 514.2), so the Oracle's "this turn" needs no
//    duration field.
//  - the READ-BACK half is this issue's own slice: `mill` gained an optional
//    `bind` (mirroring `discardAtRandom`'s), snapshotting the card that
//    actually reached the graveyard so `boundMatchesFilter` can answer "if a
//    LAND card was milled this way".
//
// `millCards` returns only genuinely-milled ids, so a card a CR 614
// graveyard-bound replacement redirected to exile never satisfies the gate —
// it was exiled, not milled (CR 701.17a), and the `if` correctly reads false.
// An empty library mills nothing and binds nothing (CR 608.2b), which the
// same predicate reads as false.
//
// The two-event `event: [...]` + `matches` shape is the standing "one Oracle
// line = ONE TriggeredAbility" multi-event form (CR 603.2), same as
// Smuggler's Copter (`kld/colorless.ts`).
export const loafingGiant: CardDefinition = {
    id: "fab5f738-04d0-44c9-88ec-28469b668040",
    name: "Loafing Giant",
    rarity: "rare",
    oracleText:
        "Whenever this creature attacks or blocks, mill a card. If a land card was milled this way, prevent all combat damage this creature would deal this turn.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 4,
    toughness: 6,
    triggeredAbilities: [
        {
            id: "loafing-giant-mill",
            oracleText:
                "Whenever this creature attacks or blocks, mill a card. If a land card was milled this way, prevent all combat damage this creature would deal this turn.",
            event: ["ATTACKERS_DECLARED", "BLOCKERS_CONFIRMED"],
            matches: (event, self) =>
                (event.type === "ATTACKERS_DECLARED" &&
                    event.attackerIds.includes(self.id)) ||
                (event.type === "BLOCKERS_CONFIRMED" &&
                    event.blockerId === self.id),
            effects: [
                {
                    op: "mill",
                    player: "controller",
                    count: 1,
                    bind: "$milled",
                },
                {
                    op: "if",
                    predicate: {
                        boundMatchesFilter: { ref: "$milled" },
                        filter: { type: "Land" },
                    },
                    then: [
                        {
                            op: "preventDamage",
                            mode: "all-from-source",
                            source: { ref: "$source" },
                            combatOnly: true,
                        },
                    ],
                },
            ],
        },
    ],
};

// Mages' Contest — {1}{R}{R} Instant. "You and target spell's controller bid
// life. You start the bidding with a bid of 1. In turn order, each player may
// top the high bid. The bidding ends if the high bid stands. The high bidder
// loses life equal to the high bid. If you win the bidding, counter that
// spell." Blocked on a bidding protocol: no alternating, dynamically-
// terminated round-robin PendingChoice exists, and no free-form integer entry
// exists. The 2026-08-04 audit corrected #1095's "needs its own ADR from
// scratch" premise — #2071 (will-of-the-council voting, CR 701.38) builds the
// per-player sequential-suspend PendingChoice family, its client prompt and
// its bot dispatch arm, and #1421 owns the `chooseNumber` primitive (it was
// #1120 gap 6(a); #1120 was retired by its 2026-08-04 audit); bidding is
// those two plus an unbounded loop terminated by a pass. Multi-suspend inside
// one Op is NOT the blocker — `castDuringResolution` (effects/interpreter.ts)
// and `divideIntoPiles` already do it. Do this after #2071 and #1421.
// Single-consumer (the only card in the catalogue that bids), so it is a line
// on the INV one-off bucket rather than its own issue. tracked-by: #1332
// export const magesContest: CardDefinition = {
//     id: "c516861c-68d9-4d02-a343-689dba0526c6",
//     name: "Mages' Contest",
//     rarity: "rare",
//     manaCost: { X: 1, R: 2 },
//     types: ["Instant"],
// };

// Scorching Lava — {1}{R} Instant. "Kicker {R}. Scorching Lava deals 2
// damage to any target. If this spell was kicked, that creature can't be
// regenerated this turn and if it would die this turn, exile it instead."
// (CR 702.33 Kicker, CR 115.4 any target, CR 120.1 damage, CR 701.19c regeneration
// lock, CR 614.1a death replacement.) Was the two-part gap 6 of
// issue #1095, closed on both sides:
//
//  - the regeneration lock shipped as the `preventRegeneration` Op with
//    issue #1283 (Incinerate's identical rider);
//  - the "exile it instead" half is this issue's own slice — the primitive
//    `SpellContext.setExileOnDeath` already existed with three `resolve()`
//    callers (Disintegrate `drk/green.ts`, `fin/red.ts`, `lea/red.ts`); it
//    now has its DSL skin, the `exileOnDeath` Op.
//
// The rider is DELIBERATELY unguarded by a creature check: the spell targets
// "any target", and both Ops no-op on a player / planeswalker target
// (CR 608.2b — `setTargetCantBeRegeneratedThisTurn` and `setExileOnDeath`
// both require a battlefield CREATURE), which is precisely what the Oracle's
// "that creature" means. Neither is scoped by `dealDamage`'s outcome either:
// the Oracle applies them on a kicked resolution regardless of whether the 2
// damage was lethal, prevented, or replaced.
export const scorchingLava: CardDefinition = {
    id: "2a85437f-052e-494c-a9ee-265c4624a409",
    name: "Scorching Lava",
    rarity: "common",
    oracleText:
        "Kicker {R} (You may pay an additional {R} as you cast this spell.)\nScorching Lava deals 2 damage to any target. If this spell was kicked, that creature can't be regenerated this turn and if it would die this turn, exile it instead.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {R}",
            mana: { R: 1 },
        },
    ],
    targetRequirement: { type: "any", count: 1 },
    effects: [
        { op: "dealDamage", amount: 2, to: { target: 0 } },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                { op: "preventRegeneration", target: { target: 0 } },
                { op: "exileOnDeath", target: { target: 0 } },
            ],
        },
    ],
};

// Turf Wound — {2}{R} Instant. "Target player can't play lands this turn.
// Draw a card." The only existing land-play lock (`landPlayLockActive` /
// `preventsLandPlayAndETB`) is GLOBAL (Worms of the Earth style), not scoped
// to one player. Needs a new per-player `GameState` field (mirroring
// `cannotActivateAbilitiesThisTurn`'s bare `string[]`) plus a
// `restrictLandPlay`-style Op read at the single legality choke-point in
// `gre/rules.ts`. Two traps recorded on the issue: it must NOT be modelled as
// a land-drop allowance of zero (CR 101.2 — a later Exploration would
// increment it back and silently unlock the player), and it must NOT gate
// `canLandEnterBattlefield` (CR 305.4 — "put onto the battlefield" is not
// "playing a land"; Worms gates both only because its own text says both).
// tracked-by: #2145
// export const turfWound: CardDefinition = {
//     id: "91392e9f-f96a-4ac5-b1f1-c73540cf249e",
//     name: "Turf Wound",
//     rarity: "common",
//     manaCost: { X: 2, R: 1 },
//     types: ["Instant"],
// };

// Bend or Break — {3}{R} Sorcery. "Each player separates all nontoken lands
// they control into two piles. For each player, one of their piles is
// chosen by one of their opponents of their choice. Destroy all lands in the
// chosen piles. Tap all lands in the other piles." (CR 701.8 destroy,
// CR 701.26 tap, ADR 0053 pile division.) CR 102.2 (2-player + solo engine
// scope) simplification: "each player" / "one of their opponents of their
// choice" is UNROLLED to the fixed two players as two sibling
// `divideIntoPiles` Ops rather than an outer `forEach { set: "players" }` —
// with exactly one opponent, "of their choice" is not a real decision, and
// this sidesteps nesting a per-pile `forEach` inside a `forEach { set:
// "players" }` body (the validator's one-construct-level-per-script ban).
// Each Op has each player as their OWN divider, the other as chooser.
export const bendOrBreak: CardDefinition = {
    id: "b76b6660-d4b2-44de-a1a7-8d00811f90f6",
    name: "Bend or Break",
    rarity: "rare",
    oracleText:
        "Each player separates all nontoken lands they control into two piles. For each player, one of their piles is chosen by one of their opponents of their choice. Destroy all lands in the chosen piles. Tap all lands in the other piles.",
    manaCost: { X: 3, R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "divideIntoPiles",
            objects: {
                set: "permanents",
                zone: "battlefield",
                controller: "controller",
                filter: { type: "Land", isToken: false },
            },
            divider: "controller",
            chooser: "opponent",
            dividePrompt:
                "Bend or Break — divide your nontoken lands into two piles.",
            pickPrompt:
                "Choose a pile: lands in it are destroyed, the rest are tapped.",
            chosenBind: "$bendOrBreakChosen1",
            otherBind: "$bendOrBreakOther1",
            chosenEffect: [
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$bendOrBreakChosen1" },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
            otherEffect: [
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$bendOrBreakOther1" },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ],
        },
        {
            op: "divideIntoPiles",
            objects: {
                set: "permanents",
                zone: "battlefield",
                controller: "opponent",
                filter: { type: "Land", isToken: false },
            },
            divider: "opponent",
            chooser: "controller",
            dividePrompt:
                "Bend or Break — your opponent divides their nontoken lands into two piles.",
            pickPrompt:
                "Choose a pile: lands in it are destroyed, the rest are tapped.",
            chosenBind: "$bendOrBreakChosen2",
            otherBind: "$bendOrBreakOther2",
            chosenEffect: [
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$bendOrBreakChosen2" },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
            otherEffect: [
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$bendOrBreakOther2" },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Stand or Fall — {3}{R} Enchantment. "At the beginning of combat on your
// turn, for each defending player, separate all creatures that player
// controls into two piles and that player chooses one. Only creatures in
// the chosen piles can block this turn." (CR 603.6a combat-begin trigger,
// CR 509.1b block restriction, ADR 0053 pile division.) `scope: "your"`
// (fires on the CASTER's turn — CR 102.2 2-player engine: exactly one
// defending player, the opponent) — the scoped player equals the ability's
// controller, so the plain `"controller"`/`"opponent"` selectors are safe
// here (unlike Fight or Flight's `scope: "opponents"`). Divider = the
// enchantment's controller ("you"); chooser = the defending player (the
// opponent, "that player chooses one"). The chosen pile has no restriction
// (may block, the default) — `chosenEffect: []`; the other pile can't block
// this turn via `restrictCombat`.
export const standOrFall: CardDefinition = {
    id: "60c34970-a106-490c-ac37-6156eb7f34ce",
    name: "Stand or Fall",
    rarity: "rare",
    oracleText:
        "At the beginning of combat on your turn, for each defending player, separate all creatures that player controls into two piles and that player chooses one. Only creatures in the chosen piles can block this turn.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "stand-or-fall-divide",
            oracleText:
                "At the beginning of combat on your turn, for each defending player, separate all creatures that player controls into two piles and that player chooses one. Only creatures in the chosen piles can block this turn.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            effects: [
                {
                    op: "divideIntoPiles",
                    objects: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "opponent",
                        filter: { type: "Creature" },
                    },
                    divider: "controller",
                    chooser: "opponent",
                    dividePrompt:
                        "Stand or Fall — divide the defending player's creatures into two piles.",
                    pickPrompt:
                        "Choose a pile: only creatures in it can block this turn.",
                    chosenBind: "$standOrFallChosen",
                    otherBind: "$standOrFallOther",
                    chosenEffect: [],
                    otherEffect: [
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$standOrFallOther" },
                            effects: [
                                {
                                    op: "restrictCombat",
                                    restriction: "cant-block",
                                    target: { ref: "$each" },
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
};
