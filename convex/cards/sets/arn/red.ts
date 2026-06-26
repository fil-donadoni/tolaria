// Arabian Nights (ARN), split by colour per ADR 0043. The first MTG
// expansion (78 unique cards); every entry is a CardDefinition — ARN has no
// LEA reprints, so there are no CardPrint stubs (ADR 0014). Modern Scryfall
// oracle text is authoritative (ADR 0004). Generic mana is encoded as
// `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour
// identity of their mana cost (CR 202.2); lands and artifacts (no coloured
// cost) live in colorless.ts.

import type {
    CardDefinition,
    SpellContext,
    TargetSelection,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";

export const birdMaiden: CardDefinition = {
    id: "5c1ba0b9-db01-447f-90cc-a2fc2c24146e",
    rarity: "common",
    name: "Bird Maiden",
    oracleText: "Flying",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Bird"],
    power: 1,
    toughness: 2,
    staticAbilities: ["flying"],
};

export const aliBaba: CardDefinition = {
    id: "29cd7064-3703-43e0-8702-d1ba13703fd8",
    rarity: "uncommon",
    name: "Ali Baba",
    oracleText: "{R}: Tap target Wall.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Rogue"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "ali-baba-tap-wall",
            oracleText: "{R}: Tap target Wall.",
            cost: { mana: { R: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Wall",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.tap(target);
            },
        },
    ],
};

export const rukhEgg: CardDefinition = {
    id: "b28f9e63-e5e4-44b5-a17e-8301ff17c623",
    rarity: "common",
    name: "Rukh Egg",
    oracleText:
        "When Rukh Egg dies, create a 4/4 red Bird creature token with flying at the beginning of the next end step.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Bird", "Egg"],
    power: 0,
    toughness: 3,
    triggeredAbilities: [
        diedTrigger({
            id: "rukh-egg-death",
            oracleText:
                "When Rukh Egg dies, create a 4/4 red Bird creature token with flying at the beginning of the next end step.",
            scope: "self",
            resolve: (ctx) => {
                ctx.scheduleDelayedTrigger(
                    rukhEgg.id,
                    "rukh-egg-token",
                    "next-end-step",
                    { controller: ctx.controller }
                );
            },
        }),
    ],
    delayedTriggers: [
        {
            id: "rukh-egg-token",
            oracleText:
                "At the beginning of the next end step, create a 4/4 red Bird creature token with flying.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                ctx.createToken(
                    {
                        name: "Bird",
                        types: ["Creature"],
                        subtypes: ["Bird"],
                        power: 4,
                        toughness: 4,
                        colors: ["R"],
                        staticAbilities: ["flying"],
                    },
                    payload.controller,
                    1
                );
            },
        },
    ],
};

export const kirdApe: CardDefinition = {
    id: "ebe8845e-df1c-481c-949c-aab84af99a05",
    rarity: "common",
    name: "Kird Ape",
    oracleText: "Kird Ape gets +1/+2 as long as you control a Forest.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Ape"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            // Board-conditional, so a CDA (compute reads the full state) rather
            // than a flat `pt-buff` (whose predicate can't query the battlefield).
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                const controlsForest = state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId === source.controllerId &&
                            c.subtypes.includes("Forest")
                    )
                );
                return controlsForest
                    ? { power: 1, toughness: 2 }
                    : { power: 0, toughness: 0 };
            },
        },
    ],
};

// Ali from Cairo — declarative damage replacement (CR 614): clamp any damage
// that would drop its controller's life below 1 so it lands on exactly 1.
// Fires per damage event (repeatable, CR 616.1d).
export const aliFromCairo: CardDefinition = {
    id: "42027613-d261-4ce2-8ba1-7a2480c660f8",
    rarity: "rare",
    name: "Ali from Cairo",
    oracleText:
        "Damage that would reduce your life total to less than 1 reduces it to 1 instead.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 0,
    toughness: 1,
    replacementEffects: [
        {
            id: "ali-from-cairo-clamp",
            oracleText:
                "Damage that would reduce your life total to less than 1 reduces it to 1 instead.",
            eventKind: "damage",
            appliesTo: (event, self, state) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "player") return false;
                if (event.target.id !== self.controllerId) return false;
                const player = state.players.find(
                    (p) => p.id === self.controllerId
                );
                if (!player) return false;
                // Only intercept damage that would drop life below 1.
                return event.amount >= player.life;
            },
            replace: (event, ctx) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                const player = ctx.state.players.find(
                    (p) => p.id === ctx.self.controllerId
                );
                const life = player?.life ?? 1;
                // Reduce the amount so the resulting life total is exactly 1.
                return {
                    kind: "modified",
                    event: { ...event, amount: Math.max(0, life - 1) },
                };
            },
        },
    ],
};

// Aladdin — activated control change conditioned on "you control Aladdin"
// (CR 611.2b). Reverts via the conditional-control SBA when Aladdin leaves or
// changes controller.
export const aladdin: CardDefinition = {
    id: "db52bad2-a3ec-4f6f-9418-12e8c40703f6",
    rarity: "rare",
    name: "Aladdin",
    oracleText:
        "{1}{R}{R}, {T}: Gain control of target artifact for as long as you control Aladdin.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Rogue"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "aladdin-steal-artifact",
            oracleText:
                "{1}{R}{R}, {T}: Gain control of target artifact for as long as you control Aladdin.",
            cost: { mana: { X: 1, R: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target || target.type !== "permanent") return;
                ctx.gainControl(target, ctx.controller, {
                    kind: "controller-controls-source",
                    controllerId: ctx.controller,
                });
            },
        },
    ],
};

// Desert Nomads — desertwalk (reuses the landwalk evasion machinery, keyed to
// the Desert subtype) plus a static "prevent all damage Deserts would deal to
// this creature" replacement (CR 614).
export const desertNomads: CardDefinition = {
    id: "e46d0c10-ec09-48ba-9e93-1392dca8111a",
    rarity: "common",
    name: "Desert Nomads",
    oracleText:
        "Desertwalk\nPrevent all damage that would be dealt to this creature by Deserts.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Nomad"],
    power: 2,
    toughness: 2,
    staticAbilities: ["desertwalk"],
    replacementEffects: [
        {
            id: "desert-nomads-no-desert-damage",
            oracleText:
                "Prevent all damage that would be dealt to this creature by Deserts.",
            eventKind: "damage",
            appliesTo: (event, self) =>
                event.kind === "damage" &&
                event.target.type === "permanent" &&
                event.target.id === self.id &&
                !!event.sourceSubtypes?.includes("Desert"),
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

// Magnetic Mountain (ARN) — "Blue creatures don't untap during their
// controllers' untap steps. / At the beginning of each player's upkeep, that
// player may choose any number of tapped blue creatures they control and pay
// {4} for each creature chosen this way. If the player does, untap those
// creatures."
//
// CR 502.1 — the untap-step restriction is a `StaticUntapRestriction` with a
// color-scoped filter and maxUntap 0 (a hard skip of blue creatures), honored
// by the untap dispatcher for every player's untap step (scope each-player).
// CR 603.6a — the upkeep trigger fires at the beginning of EACH player's
// upkeep (scope "each"); the upkeep player is the chooser/payer. The resolve
// suspends twice (ADR 0008): a choose-any-number pick, then a may-pay scaled
// to {4} × chosen (CR 118), and on payment untaps the chosen creatures.
export const magneticMountain: CardDefinition = {
    id: "95fde48b-e40a-4183-b324-1ec276dde015",
    rarity: "uncommon",
    name: "Magnetic Mountain",
    oracleText:
        "Blue creatures don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {4} for each creature chosen this way. If the player does, untap those creatures.",
    manaCost: { X: 1, R: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "magnetic-mountain-no-untap",
            oracleText:
                "Blue creatures don't untap during their controllers' untap steps.",
            filter: { types: "Creature", colors: ["U"] },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "magnetic-mountain-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {4} for each creature chosen this way. If the player does, untap those creatures.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                const eligible = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Creature",
                    colors: ["U"],
                    tapped: true,
                });
                if (eligible.length === 0) return;
                const chosen = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: `${scopedPlayerId}:mm-pick`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: { types: "Creature", colors: ["U"], tapped: true },
                    count: { min: 0, max: eligible.length },
                    prompt: "Choose any number of tapped blue creatures to untap ({4} each).",
                });
                if (chosen === undefined) return; // suspend: awaiting the pick
                if (chosen.length === 0) return; // chose none — nothing to pay
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `${scopedPlayerId}:mm-pay`,
                    cost: { X: 4 * chosen.length },
                    prompt: `Pay {${4 * chosen.length}} to untap ${chosen.length} blue creature(s)?`,
                });
                if (paid === undefined) return; // suspend: awaiting the payment
                if (paid) {
                    for (const id of chosen) {
                        ctx.untap({ type: "permanent", id });
                    }
                }
            },
        }),
    ],
};

export const mijaeDjinn: CardDefinition = {
    id: "d3ddbe51-cd1a-4b2c-849a-7c82d622122a",
    rarity: "rare",
    name: "Mijae Djinn",
    oracleText:
        "Whenever this creature attacks, flip a coin. If you lose the flip, remove this creature from combat and tap it.",
    manaCost: { R: 3 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 6,
    toughness: 3,
    triggeredAbilities: [
        {
            id: "mijae-djinn-attack-flip",
            oracleText:
                "Whenever this creature attacks, flip a coin. If you lose the flip, remove this creature from combat and tap it.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                // CR 705.2 / ADR 0023 — the trigger flips on the stack at
                // declare-attackers and PAUSES to reveal the coin before
                // touching combat. `requestCoinFlip` draws the bit once,
                // suspends the trigger (returns undefined), and on resume
                // returns the persisted outcome (no re-roll). The caller MUST
                // return early while suspended so the remove-from-combat + tap
                // land only after the reveal, and only on a LOSE.
                const won = ctx.requestCoinFlip({
                    playerId: ctx.controller,
                    choiceId: "mijae-djinn-attack-flip",
                    heads: { consequence: "Mijae Djinn stays attacking" },
                    tails: {
                        consequence:
                            "Remove Mijae Djinn from combat and tap it",
                    },
                });
                if (won === undefined) return; // suspended after the flip
                if (won) return; // won: stays attacking
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                ctx.removeFromCombat(self);
                ctx.tap(self);
            },
        },
    ],
};

export const ydwenEfreet: CardDefinition = {
    id: "efdba2a9-d171-45ed-8dd4-9d0046128f68",
    rarity: "rare",
    name: "Ydwen Efreet",
    oracleText:
        "Whenever this creature blocks, flip a coin. If you lose the flip, remove this creature from combat and it can't block this turn. Creatures it was blocking that had become blocked by only this creature this combat become unblocked.",
    manaCost: { R: 3 },
    types: ["Creature"],
    subtypes: ["Efreet"],
    power: 3,
    toughness: 6,
    triggeredAbilities: [
        {
            id: "ydwen-efreet-block-flip",
            oracleText:
                "Whenever this creature blocks, flip a coin. If you lose the flip, remove this creature from combat and it can't block this turn. Creatures it was blocking that had become blocked by only this creature this combat become unblocked.",
            // BLOCKERS_CONFIRMED fires once per attacker-blocker pair; this
            // trigger collapses to a single flip per block declaration by
            // matching only the pair whose blocker is self and whose attacker
            // is the first one Ydwen blocked (so the flip runs once even when
            // Ydwen blocks a band).
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return event.blockerId === self.id;
            },
            resolve: (ctx) => {
                // CR 705.2 / ADR 0023 — flip a coin and PAUSE to reveal the
                // outcome before applying it. `requestCoinFlip` draws the bit
                // once, suspends the trigger resolution (returns undefined),
                // and on resume returns the persisted outcome (no re-roll).
                // The caller MUST return early while suspended so the
                // remove-from-combat / unblock consequence lands only after the
                // reveal. Block triggers (CR 509.4) run this at declare-blockers
                // while Ydwen is still on the stack as a triggered ability.
                const won = ctx.requestCoinFlip({
                    playerId: ctx.controller,
                    choiceId: "ydwen-efreet-block-flip",
                    heads: { consequence: "Ydwen Efreet stays blocking" },
                    tails: {
                        consequence:
                            "Remove Ydwen Efreet from combat; attackers it solely blocked become unblocked",
                    },
                });
                if (won === undefined) return; // suspended after the flip
                if (won) return; // won: stays blocking
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                // Capture the attackers Ydwen is solely blocking BEFORE it
                // leaves combat: any attacker whose only blocker is Ydwen
                // becomes unblocked (CR 509.1h) and hits the defender. Safe to
                // read here on resume — removeFromCombat has not run yet.
                const blockersByAttacker = ctx.getBlockersByAttacker();
                const solelyBlocked = Object.keys(blockersByAttacker).filter(
                    (attackerId) => {
                        const blockers = blockersByAttacker[attackerId];
                        return (
                            blockers.length === 1 &&
                            blockers[0] === ctx.sourceInstanceId
                        );
                    }
                );
                ctx.removeFromCombat(self);
                ctx.setCantBlockThisTurn(self);
                for (const attackerId of solelyBlocked) {
                    ctx.becomeUnblocked(attackerId);
                }
            },
        },
    ],
};
