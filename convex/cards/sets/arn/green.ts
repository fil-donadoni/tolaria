// Arabian Nights (ARN), split by colour per ADR 0043. The first MTG
// expansion (78 unique cards); every entry is a CardDefinition — ARN has no
// LEA reprints, so there are no CardPrint stubs (ADR 0014). Modern Scryfall
// oracle text is authoritative (ADR 0004). Generic mana is encoded as
// `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour
// identity of their mana cost (CR 202.2); lands and artifacts (no coloured
// cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";

export const wyluliWolf: CardDefinition = {
    id: "15ccebe1-ef08-4805-a65f-a1c57abed9f2",
    rarity: "common",
    name: "Wyluli Wolf",
    oracleText: "{T}: Target creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Wolf"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "wyluli-wolf-pump",
            oracleText: "{T}: Target creature gets +1/+1 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Erhnam Djinn — "At the beginning of your upkeep, target non-Wall creature an
// opponent controls gains forestwalk until your next upkeep." (CR 603.6a upkeep
// trigger, CR 702.14 forestwalk evasion, CR 611.2a layer-6 keyword grant.)
//
// CR 603.3d — "target non-Wall creature an opponent controls" is a REAL target
// chosen when the trigger is PUT ON THE STACK (issue #1193 machinery,
// `raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes it subject to hexproof / protection / ward and
// fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. Declared as a
// `targetRequirement` on the TriggeredAbility: `controller: "opponent"`
// = "an opponent controls", `excludeSubtypes: "Wall"` = "non-Wall",
// `count: 1` = a single mandatory target (auto-selected when exactly one is
// legal per CR 603.3d; removed from the stack per CR 603.3c when none is
// legal). The resolve body reads the announced `ctx.targets[0]` and grants
// forestwalk. The grant duration `{ phase: "upkeep", player: "controller" }`
// is "until your next upkeep" — the same DurationSpec Xenic Poltergeist uses —
// scoped to Erhnam's controller, so the keyword falls off as that player's
// next upkeep begins.
//
// Migrated resolve()→effects[] (ADR 0045): a single clause, `grantAbility`
// (issue #843) — the registered Op wrapping `SpellContext.grantStaticAbility`
// — reading the announced target slot via `{ target: 0 }` (same slot
// `ctx.targets[0]` read imperatively). CR 608.2b's "absent target → no-op" is
// the Op's own skip-when-gone behavior, so the old `if (target?.type !==
// "permanent") return;` guard needs no explicit restatement.
export const erhnamDjinn: CardDefinition = {
    id: "42bc0c3f-0a52-4bdc-83da-6484bf3102f3",
    rarity: "rare",
    name: "Erhnam Djinn",
    oracleText:
        "At the beginning of your upkeep, target non-Wall creature an opponent controls gains forestwalk until your next upkeep. (It can't be blocked as long as defending player controls a Forest.)",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 4,
    toughness: 5,
    triggeredAbilities: [
        {
            ...phaseTrigger({
                id: "erhnam-djinn-forestwalk",
                oracleText:
                    "At the beginning of your upkeep, target non-Wall creature an opponent controls gains forestwalk until your next upkeep.",
                phase: "UPKEEP",
                scope: "your",
                // CR 603.3d — the target was chosen when the trigger went on
                // the stack (`ctx.targets[0]` / `{ target: 0 }`); absent/left
                // the battlefield is a no-op (CR 608.2b, `grantAbility`'s own
                // skip-when-gone behavior).
                effects: [
                    {
                        op: "grantAbility",
                        target: { target: 0 },
                        ability: "forestwalk",
                        duration: { phase: "upkeep", player: "controller" },
                    },
                ],
            }),
            // CR 603.3d — "target non-Wall creature an opponent controls":
            // a real target locked at stack placement (issue #1193), subject to
            // hexproof / protection / ward. `controller: "opponent"` filters to
            // creatures an opponent of the ability's controller controls;
            // `excludeSubtypes: "Wall"` drops Walls; `count: 1` is a single
            // mandatory target.
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "opponent",
                excludeSubtypes: "Wall",
            },
        },
    ],
};

export const sandstorm: CardDefinition = {
    id: "73cba9cd-73d9-442e-bd99-9cba9f398b64",
    rarity: "common",
    name: "Sandstorm",
    oracleText: "Sandstorm deals 1 damage to each attacking creature.",
    manaCost: { G: 1 },
    types: ["Instant"],
    // NOT DSL-migratable (ADR 0045): "each attacking creature" needs a forEach
    // over permanents filtered by combat role, but EffectCardFilter is
    // type/subtype only — no isAttacking predicate. Stays resolve().
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(1, { creatures: { isAttacking: true } });
    },
};

export const desertTwister: CardDefinition = {
    id: "0d77c149-cca2-45c7-bc83-5ba1872ad5e0",
    rarity: "uncommon",
    name: "Desert Twister",
    oracleText: "Destroy target permanent.",
    manaCost: { X: 4, G: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    effect: "destroy-target",
};

export const singingTree: CardDefinition = {
    id: "3003bf1e-8085-45d8-882b-c449109e7631",
    rarity: "rare",
    name: "Singing Tree",
    oracleText:
        "{T}: Target attacking creature has base power 0 until end of turn.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant"],
    power: 0,
    toughness: 3,
    activatedAbilities: [
        {
            id: "singing-tree-set-power",
            oracleText:
                "{T}: Target attacking creature has base power 0 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            // DSL-first (ADR 0045): base POWER set to 0 until end of turn via
            // the `setBasePT` Op (CR 613.4b layer 7b) — toughness omitted, so it
            // is left untouched (a power-only base set).
            effects: [
                {
                    op: "setBasePT",
                    target: { target: 0 },
                    power: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

/** Returns the unique player with strictly more life than every other, or
 *  null on a tie (CR 104 "the player with the most life"). */
function uniqueMostLife(
    lives: ReadonlyArray<{ id: string; life: number }>
): string | null {
    let max = -Infinity;
    let leader: string | null = null;
    let tied = false;
    for (const { id, life } of lives) {
        if (life > max) {
            max = life;
            leader = id;
            tied = false;
        } else if (life === max) {
            tied = true;
        }
    }
    return tied ? null : leader;
}

// Ghazbán Ogre — at your upkeep, an indefinite control reassign to the unique
// most-life player (no revert condition). Intervening-if gates on a strict
// unique maximum (CR 603.4).
export const ghazbanOgre: CardDefinition = {
    id: "f9d613d5-36a2-4633-b5af-64511bb29cc2",
    rarity: "common",
    name: "Ghazbán Ogre",
    oracleText:
        "At the beginning of your upkeep, if a player has more life than each other player, the player with the most life gains control of Ghazbán Ogre.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Ogre"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        phaseTrigger({
            id: "ghazban-ogre-upkeep",
            oracleText:
                "At the beginning of your upkeep, if a player has more life than each other player, the player with the most life gains control of Ghazbán Ogre.",
            phase: "UPKEEP",
            scope: "your",
            interveningIf: (_event, _self, state) =>
                !!state &&
                uniqueMostLife(
                    state.players.map((p) => ({ id: p.id, life: p.life }))
                ) !== null,
            // NOT DSL-migratable (ADR 0045): the recipient is a RUNTIME-computed
            // player — the unique player with the most life (uniqueMostLife over
            // live life totals), not a declarative player ref (controller /
            // opponent / target slot). The gainControl Op (#848) is COVERED, but
            // no player-ref selector can name "the player with the most life".
            // Blocked on: a computed-player selector (a value-grammar gap, not an
            // Op) — stays resolve().
            resolve: (ctx) => {
                const leader = uniqueMostLife(
                    ctx.allPlayerIds.map((id) => ({
                        id,
                        life: ctx.getLife(id),
                    }))
                );
                if (!leader) return;
                ctx.gainControl(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    leader
                );
            },
        }),
    ],
};

const NAFS_ASP_ID = "965f722c-2b18-4c22-8c30-12552def5940";

// Nafs Asp — on dealing damage to a player, schedule a delayed trigger at that
// player's NEXT DRAW STEP (new `next-draw-step` timing) offering "pay {1} or
// lose 1 life". The "before that draw step" window is modelled as a may-pay at
// the draw step itself.
export const nafsAsp: CardDefinition = {
    id: NAFS_ASP_ID,
    rarity: "common",
    name: "Nafs Asp",
    oracleText:
        "Whenever this creature deals damage to a player, that player loses 1 life at the beginning of their next draw step unless they pay {1} before that draw step.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Snake"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            // Migrated resolve()→effects[] (ADR 0049, issue #865). The damaged
            // player is read off the firing event with `$event.damagedPlayer`
            // (player family) — both for the delayed trigger's target player
            // (CR 504, so it fires on THAT player's next draw step) and for the
            // captured `$victim` the body acts on. The "pay {1} or lose 1 life"
            // decision is an inline delayedTrigger body (ADR 0048): a mayPay
            // whose declined outcome loses 1 life. LKI reuses the ADR 0048
            // capture semantics (the id crosses to fire time in the payload).
            id: "nafs-asp-damage",
            oracleText:
                "Whenever this creature deals damage to a player, that player loses 1 life at the beginning of their next draw step unless they pay {1} before that draw step.",
            event: "DAMAGE_DEALT",
            matches: (event, self) => {
                if (event.type !== "DAMAGE_DEALT") return false;
                // Self deals damage to a player (CR 120.3 / 603.4).
                return (
                    event.sourceInstanceId === self.id &&
                    event.target.type === "player"
                );
            },
            effects: [
                {
                    op: "delayedTrigger",
                    timing: "next-draw-step",
                    oracleText:
                        "That player loses 1 life at the beginning of their next draw step unless they pay {1} before that draw step.",
                    targetPlayer: { ref: "$event.damagedPlayer" },
                    capture: { $victim: { ref: "$event.damagedPlayer" } },
                    effects: [
                        {
                            op: "mayPay",
                            player: { ref: "$victim" },
                            cost: { X: 1 },
                            prompt: "Pay {1} to avoid losing 1 life to Nafs Asp?",
                            bind: "$paid",
                        },
                        {
                            op: "if",
                            predicate: { not: { binding: "$paid" } },
                            then: [
                                {
                                    op: "loseLife",
                                    player: { ref: "$victim" },
                                    amount: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

// Cyclone — upkeep: add a wind counter, then pay {G} per counter or sacrifice;
// if paid, deal (counter count) damage to each creature and player. The wind
// counter and the damage run on the resumed (committed) path so the stepped
// re-run after the may-pay suspension doesn't double-apply them.
export const cyclone: CardDefinition = {
    id: "f11684d6-5b74-47a7-a2d0-256c9e437aa6",
    rarity: "uncommon",
    name: "Cyclone",
    oracleText:
        "At the beginning of your upkeep, put a wind counter on this enchantment, then sacrifice this enchantment unless you pay {G} for each wind counter on it. If you pay, this enchantment deals damage equal to the number of wind counters on it to each creature and each player.",
    manaCost: { X: 2, G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "cyclone-upkeep",
            oracleText:
                "At the beginning of your upkeep, put a wind counter on this enchantment, then sacrifice this enchantment unless you pay {G} for each wind counter on it. If you pay, this enchantment deals damage equal to the number of wind counters on it to each creature and each player.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): planned-migratable, blocked on
            // value constructs. The `mayPay` cost is dynamic ({G} PER wind
            // counter, `getCounterCount` + arithmetic) and the damage amount is
            // the wind-counter tally — neither expressible by the `count`
            // grammar (battlefield/graveyard card sets only, no counter counts,
            // no arithmetic). Stays resolve() until a counter-count value member
            // exists.
            resolve: (ctx, _event, scopedPlayerId) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // Cost basis = counters after the (not-yet-applied) increment.
                const windCount = ctx.getCounterCount(self, "wind") + 1;
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: "cyclone-pay",
                    cost: { G: windCount },
                    prompt: `Pay {G} for each wind counter (×${windCount}) or sacrifice Cyclone?`,
                });
                if (paid === undefined) return; // suspended for the decision
                // Committed path (runs once on resume).
                ctx.addCounter(self, "wind", 1);
                if (!paid) {
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                ctx.dealDamageToEach(windCount, {
                    creatures: true,
                    players: true,
                });
            },
        }),
    ],
};

// Drop of Honey — upkeep: destroy the least-power creature (can't be
// regenerated; you choose among ties). A separate state trigger sacrifices it
// when the battlefield has no creatures.
export const dropOfHoney: CardDefinition = {
    id: "26e090d4-e7fe-403c-9aca-05c1b45ed238",
    rarity: "rare",
    name: "Drop of Honey",
    oracleText:
        "At the beginning of your upkeep, destroy the creature with the least power. It can't be regenerated. If two or more creatures are tied for least power, you choose one of them.\nWhen there are no creatures on the battlefield, sacrifice this enchantment.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "drop-of-honey-upkeep",
            oracleText:
                "At the beginning of your upkeep, destroy the creature with the least power. It can't be regenerated. If two or more creatures are tied for least power, you choose one of them.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): "destroy the creature with the least
            // power" requires a min-power selection across the battlefield with a
            // tie-break choice — no declarative selector or predicate expresses
            // "least power". The no-creatures state trigger below sacrifices the
            // source, which `sacrifice` also cannot express. Stays resolve().
            resolve: (ctx, _event, scopedPlayerId) => {
                const creatureIds = ctx.allPlayerIds.flatMap((pid) =>
                    ctx.getBattlefieldIds(pid, { types: "Creature" })
                );
                if (creatureIds.length === 0) return;
                const powers = creatureIds.map((id) =>
                    ctx.getPower({ type: "permanent", id })
                );
                const minPower = Math.min(...powers);
                const tied = creatureIds.filter(
                    (_id, i) => powers[i] === minPower
                );
                let victimId = tied[0];
                if (tied.length > 1) {
                    const picks = ctx.requestChoice({
                        playerId: scopedPlayerId,
                        choiceId: "drop-of-honey-tie",
                        kind: "choose-permanents",
                        zone: "battlefield",
                        candidateIds: tied,
                        count: 1,
                        prompt: "Choose a creature with the least power to destroy.",
                    });
                    if (picks === undefined) return; // suspended for the choice
                    victimId = picks[0] ?? tied[0];
                }
                ctx.destroy(
                    { type: "permanent", id: victimId },
                    { cantBeRegenerated: true }
                );
            },
        }),
        // Migrated resolve()→effects[] (ADR 0045): a single clause,
        // `sacrifice` (issue #807) targeting `$source` — the same
        // self-sacrifice shape as Underworld Breach (thb/red.ts). No
        // resolution-time choice or filter beyond the state condition, which
        // the factory already re-checks via `interveningIf`.
        stateTrigger({
            id: "drop-of-honey-sacrifice",
            oracleText:
                "When there are no creatures on the battlefield, sacrifice this enchantment.",
            condition: (_self, state) =>
                state.players.every((p) =>
                    p.battlefield.every((c) => !c.types.includes("Creature"))
                ),
            effects: [{ op: "sacrifice", target: { ref: "$source" } }],
        }),
    ],
};

// Metamorphosis (ARN) — "As an additional cost to cast this spell, sacrifice a
// creature. Add X mana of any one color, where X is 1 plus the sacrificed
// creature's mana value. Spend this mana only to cast creature spells."
//
// CR 118.8 / 601.2f: the sacrifice is an additional cost paid at announcement;
// the engine snapshots the sacrificed creature's mana value, read here via
// getAdditionalSacrificeMv(). CR 106.6: the produced mana carries a
// "creature-spell" spend restriction enforced at later spell-cast sites.
//
// "Any one color" is modelled as five modes (one per color) picked at
// announcement. CR 700.2 puts a modal choice at announcement; the printed card
// chooses the color on resolution. Choosing at announcement is a deliberate,
// invisible simplification — all five colors are always legal and nothing (tracked-by: #2785)
// between announcement and resolution can change that — and it reuses the
// engine's existing, fully-wired modal cast flow (incl. the UI mode picker)
// instead of a bespoke resolution-time color picker.
const METAMORPHOSIS_COLORS: {
    id: string;
    color: "W" | "U" | "B" | "R" | "G";
    label: string;
}[] = [
    { id: "white", color: "W", label: "Add white mana" },
    { id: "blue", color: "U", label: "Add blue mana" },
    { id: "black", color: "B", label: "Add black mana" },
    { id: "red", color: "R", label: "Add red mana" },
    { id: "green", color: "G", label: "Add green mana" },
];

export const metamorphosis: CardDefinition = {
    id: "fbc6cfc3-b232-40bf-bc0c-4618f6f5c9a5",
    rarity: "common",
    name: "Metamorphosis",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nAdd X mana of any one color, where X is 1 plus the sacrificed creature's mana value. Spend this mana only to cast creature spells.",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    additionalCosts: { sacrificeFilter: { types: "Creature" } },
    // NOT DSL-migratable (ADR 0045): the amount is `1 + <sacrificed
    // creature's mana value>` — arithmetic over a value
    // (`getAdditionalSacrificeMv()`) with no censused `EffectValue` member,
    // and there is no registered Op wrapping `addRestrictedMana` (the
    // restricted-mana-pool primitive `addMana` doesn't cover). Blocked on: an
    // arithmetic-composable value construct + an `addRestrictedMana` Op.
    // Stays resolve().
    modes: METAMORPHOSIS_COLORS.map((m) => ({
        id: m.id,
        label: m.label,
        oracleText:
            "Add X mana of any one color, where X is 1 plus the sacrificed creature's mana value. Spend this mana only to cast creature spells.",
        resolve: (ctx: SpellContext) => {
            // X = 1 + sacrificed creature's mana value (CR 202.3).
            const mv = ctx.getAdditionalSacrificeMv();
            if (mv === undefined) return;
            const amount = 1 + mv;
            if (amount <= 0) return;
            const cost: {
                W?: number;
                U?: number;
                B?: number;
                R?: number;
                G?: number;
            } = {};
            cost[m.color] = amount;
            ctx.addRestrictedMana(ctx.controller, cost, "creature-spell");
        },
    })),
};

// Ifh-Bíff Efreet — "Flying\n{G}: This creature deals 1 damage to each creature
// with flying and each player. Any player may activate this ability."
// (CR 113.3c — "any player may activate"; CR 120.3 mass damage). The damage
// body is identical to Hurricane's `dealDamageToEach` sweep (1 fixed instead of
// X), and the only novelty is the activation-permission flag: any player with
// priority — not just the controller — may pay {G} to fire it (game.ts gates
// the controller-only default on `ability.activatableByAnyPlayer`). The
// activator pays {G} from their own pool; the source is not tapped and stays
// under its controller's control.
export const ifhBiffEfreet: CardDefinition = {
    id: "c0b10fb7-8667-42bf-aeb6-35767a82917b",
    rarity: "rare",
    name: "Ifh-Bíff Efreet",
    oracleText:
        "Flying\n{G}: This creature deals 1 damage to each creature with flying and each player. Any player may activate this ability.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Efreet"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "ifh-biff-efreet-rain",
            oracleText:
                "{G}: This creature deals 1 damage to each creature with flying and each player. Any player may activate this ability.",
            cost: { mana: { G: 1 } },
            useStack: true,
            activatableByAnyPlayer: true,
            // NOT DSL-migratable (ADR 0045): "each creature with flying and each
            // player" is a mixed sweep — a forEach over permanents can't filter
            // by keyword ability (EffectCardFilter is type/subtype only) and
            // can't fold players into the same set. Stays resolve().
            resolve: (ctx: SpellContext) => {
                ctx.dealDamageToEach(1, {
                    creatures: { requireAbility: "flying" },
                    players: true,
                });
            },
        },
    ],
};
