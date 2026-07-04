// Arabian Nights (ARN), split by colour per ADR 0043. The first MTG
// expansion (78 unique cards); every entry is a CardDefinition — ARN has no
// LEA reprints, so there are no CardPrint stubs (ADR 0014). Modern Scryfall
// oracle text is authoritative (ADR 0004). Generic mana is encoded as
// `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour
// identity of their mana cost (CR 202.2); lands and artifacts (no coloured
// cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
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
// trigger, CR 702.13 forestwalk evasion, CR 611.1b layer-6 keyword grant.) The
// target is chosen imperatively in the resolve body (triggered abilities model
// targeting via `requestChoice`, not a `targetRequirement`). The grant duration
// `{ phase: "upkeep", player: "controller" }` is "until your next upkeep" — the
// same DurationSpec Xenic Poltergeist uses — scoped to Erhnam's controller, so
// the keyword falls off as that player's next upkeep begins.
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
        phaseTrigger({
            id: "erhnam-djinn-forestwalk",
            oracleText:
                "At the beginning of your upkeep, target non-Wall creature an opponent controls gains forestwalk until your next upkeep.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): the target is chosen from the
            // OPPONENT's battlefield filtered to non-Wall creatures, then
            // granted forestwalk. The `choice` Op's filter is inclusion-only
            // (no subtype EXCLUSION for "non-Wall") and applies to the
            // chooser's own battlefield picks, not an opponent-owned zone.
            // Blocked on: choice candidate-filter expressiveness (opponent-zone
            // pick + subtype exclusion); grantStaticAbility itself is covered
            // by grantAbility (#843).
            resolve: (ctx, _event, scopedPlayerId) => {
                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== scopedPlayerId
                );
                if (!opponentId) return;
                // Non-Wall creatures the opponent controls are the legal
                // targets (CR 603.3d). No legal target → the trigger does
                // nothing (it still went on the stack, CR 603.3b).
                const candidates = ctx
                    .getBattlefieldIds(opponentId, { types: "Creature" })
                    .filter(
                        (id) =>
                            !ctx.hasSubtype({ type: "permanent", id }, "Wall")
                    );
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: `erhnam-djinn-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: opponentId,
                    candidateIds: candidates,
                    count: 1,
                    prompt: "Erhnam Djinn: choose a non-Wall creature an opponent controls.",
                });
                if (picks === undefined) return; // suspended
                const targetId = picks[0];
                if (!targetId) return;
                ctx.grantStaticAbility(
                    { type: "permanent", id: targetId },
                    "forestwalk",
                    { phase: "upkeep", player: "controller" }
                );
            },
        }),
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
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.setBasePT(target, 0, undefined, {
                        phase: "end-of-turn",
                    });
                }
            },
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
        damageDealtTrigger({
            id: "nafs-asp-damage",
            oracleText:
                "Whenever this creature deals damage to a player, that player loses 1 life at the beginning of their next draw step unless they pay {1} before that draw step.",
            source: "self",
            target: { kind: "player", player: { relation: "any" } },
            // NOT DSL-migratable yet (ADR 0048): the delayed capture (and
            // the timing's target player) is a trigger-EVENT field
            // (event.target.id) — the tracked $event.<field> grammar gap.
            // Stays resolve().
            resolve: (ctx, event) => {
                if (event.target.type !== "player") return;
                ctx.scheduleDelayedTrigger(
                    NAFS_ASP_ID,
                    "nafs-asp-draw-step",
                    "next-draw-step",
                    { playerId: event.target.id },
                    event.target.id
                );
            },
        }),
    ],
    delayedTriggers: [
        {
            id: "nafs-asp-draw-step",
            oracleText:
                "That player loses 1 life unless they paid {1} before this draw step.",
            timing: "next-draw-step",
            // Legacy template body (ADR 0048): expressible as an inline
            // mayPay/if body once the scheduling site's $event.<field>
            // capture gap closes — the card migrates as a whole then.
            resolve: (ctx, payload) => {
                const pid = payload.playerId;
                if (!pid) return;
                const paid = ctx.requestMayPay({
                    playerId: pid,
                    choiceId: "nafs-asp-pay",
                    cost: { X: 1 },
                    prompt: "Pay {1} to avoid losing 1 life to Nafs Asp?",
                });
                if (paid === undefined) return; // suspended for the decision
                if (!paid) ctx.loseLife(pid, 1);
            },
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
        stateTrigger({
            id: "drop-of-honey-sacrifice",
            oracleText:
                "When there are no creatures on the battlefield, sacrifice this enchantment.",
            condition: (_self, state) =>
                state.players.every((p) =>
                    p.battlefield.every((c) => !c.types.includes("Creature"))
                ),
            resolve: (ctx) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

// Metamorphosis (ARN) — "As an additional cost to cast this spell, sacrifice a
// creature. Add X mana of any one color, where X is 1 plus the sacrificed
// creature's mana value. Spend this mana only to cast creature spells."
//
// CR 117.9 / 601.2f: the sacrifice is an additional cost paid at announcement;
// the engine snapshots the sacrificed creature's mana value, read here via
// getAdditionalSacrificeMv(). CR 106.6: the produced mana carries a
// "creature-spell" spend restriction enforced at later spell-cast sites.
//
// "Any one color" is modelled as five modes (one per color) picked at
// announcement. CR 700.2 puts a modal choice at announcement; the printed card
// chooses the color on resolution. Choosing at announcement is a deliberate,
// invisible simplification — all five colors are always legal and nothing
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
