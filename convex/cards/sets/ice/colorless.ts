// Ice Age (ICE) — Colorless: lands and artifacts (no coloured mana cost) cards, split by colour per ADR 0043.
// The registry's `import * as ice from "./sets/ice"` resolves through
// ice/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {1}{G} → { X: 1, G: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).
import type {
    CardDefinition,
    CardPrint,
    Color,
    DelayedTriggerDef,
    SpellContext,
} from "../../types";
import type { Phase } from "../../../gre/types";
import { countSnowLands } from "../../snowReads";
import { cumulativeUpkeepTrigger } from "../../abilities/cumulativeUpkeep";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

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
// Ice Cauldron — noted-mana battery + cast-from-exile (CR 106.10, CR 601.3e).
// "{X}, {T}: You may exile a nonland card from your hand. You may cast that card
// for as long as it remains exiled. Put a charge counter and note the TYPE and
// AMOUNT of mana spent to pay this activation cost. Activate only if there are
// no charge counters." then "{T}, Remove a charge counter: Add this artifact's
// last noted type and amount of mana. Spend this mana only to cast the last card
// exiled with this artifact."
//
// Ability 1 (`noteManaSpent: true`) captures the colours spent on {X}, exiles
// the chosen nonland card face down (`exileFaceDown` — hidden to the opponent,
// CR 406.3), grants it cast-from-exile (`grantCastFromExile`), and stores the
// noted mana on the artifact keyed to that card's instance id (so the replayed
// mana is spendable only on it, CR 106.6 instance-restricted mana). Ability 2
// removes the counter and replays the noted mana via `addNotedMana`; because the
// note carries `castableCardId`, the mana floats as instance-restricted mana —
// the cast pipeline accepts it only when the spell being cast is that exiled
// card.
//
// SIMPLIFICATION (flagged, CR 605.1a): as with Jeweled Amulet, the "add the
// noted mana" ability is a mana ability that this engine models as
// `useStack: true` (the mana-ability path can't produce stored/variable mana).
export const iceCauldron: CardDefinition = {
    id: "1a3e095a-7056-4df3-bf7d-9c217d591446",
    name: "Ice Cauldron",
    rarity: "rare",
    oracleText:
        "{X}, {T}: You may exile a nonland card from your hand. You may cast that card for as long as it remains exiled. Put a charge counter on this artifact and note the type and amount of mana spent to pay this activation cost. Activate only if there are no charge counters on this artifact.\n{T}, Remove a charge counter from this artifact: Add this artifact's last noted type and amount of mana. Spend this mana only to cast the last card exiled with this artifact.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "ice-cauldron-charge",
            oracleText:
                "{X}, {T}: You may exile a nonland card from your hand. You may cast that card for as long as it remains exiled. Put a charge counter on this artifact and note the type and amount of mana spent to pay this activation cost. Activate only if there are no charge counters on this artifact.",
            cost: { mana: { X: "X" }, tap: true },
            useStack: true,
            canActivate: (source) => (source.counters?.charge ?? 0) === 0,
            // CR 106.10 — capture the TYPE and AMOUNT of mana spent on {X}.
            noteManaSpent: true,
            resolve: (ctx: SpellContext) => {
                // CR 601.3e — "You may exile a nonland card from your hand."
                const nonland = ctx
                    .getHandCards(ctx.caster)
                    .filter((c) => !c.types.includes("Land"))
                    .map((c) => c.id);
                let exiledCardId: string | undefined;
                if (nonland.length > 0) {
                    const picks = ctx.requestChoice({
                        playerId: ctx.caster,
                        choiceId: "ice-cauldron-exile",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: { min: 0, max: 1 },
                        candidateIds: nonland,
                        prompt: "Ice Cauldron: exile a nonland card from your hand (or skip).",
                    });
                    if (picks === undefined) return; // suspended — resume later
                    if (picks.length > 0) {
                        exiledCardId = picks[0];
                        // CR 406.3 — exiled face down (hidden to the opponent),
                        // known to its controller.
                        ctx.exileFaceDown(
                            ctx.caster,
                            exiledCardId,
                            "hand",
                            ctx.caster
                        );
                        // CR 601.3e — castable from exile by the controller.
                        ctx.grantCastFromExile(exiledCardId, ctx.caster);
                    }
                }
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "charge",
                    1
                );
                // CR 106.10 — note the type/amount spent, keyed to the exiled
                // card so the replayed mana is spendable only to cast it.
                ctx.noteMana(ctx.sourceInstanceId, {
                    mana: ctx.getNotedManaSpent(),
                    ...(exiledCardId ? { castableCardId: exiledCardId } : {}),
                });
            },
        },
        {
            id: "ice-cauldron-add",
            oracleText:
                "{T}, Remove a charge counter from this artifact: Add this artifact's last noted type and amount of mana. Spend this mana only to cast the last card exiled with this artifact.",
            cost: { tap: true, removeCounter: { type: "charge", count: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addNotedMana(ctx.sourceInstanceId, ctx.caster);
            },
        },
    ],
};
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
// Jeweled Amulet — noted-mana battery (CR 106.10). "{1}, {T}: Put a charge
// counter on this artifact. Note the TYPE of mana spent to pay this activation
// cost. Activate only if there are no charge counters." then "{T}, Remove a
// charge counter: Add one mana of this artifact's last noted type."
//
// The first ability spends {1} (any one colour); `noteManaSpent: true` makes the
// engine capture the colour actually spent (the manaPool delta), read on resolve
// via `getNotedManaSpent()` and stored on the artifact with `noteMana`. The
// second ability removes the counter and replays the noted colour via
// `addNotedMana`. Both gate on the no-counter / has-counter invariant so only
// one charge sits on the artifact at a time (CR 122 counters).
//
// SIMPLIFICATION (flagged, CR 605.1a): the "add the noted mana" ability is a
// mana ability and should not use the stack. The engine's mana-ability path
// (`useStack: false` / `manaProduced`) produces only fixed, definition-time
// mana; it cannot read the artifact's stored note to produce a variable colour.
// Both abilities are therefore `useStack: true` (resolve-driven). The only
// observable difference is that an opponent could respond to the mana being
// added — a rules-lawyer-level deviation with no effect in normal play.
export const jeweledAmulet: CardDefinition = {
    id: "34f7bad2-d28f-42d2-9246-fe3545ef49a7",
    name: "Jeweled Amulet",
    rarity: "uncommon",
    oracleText:
        "{1}, {T}: Put a charge counter on this artifact. Note the type of mana spent to pay this activation cost. Activate only if there are no charge counters on this artifact.\n{T}, Remove a charge counter from this artifact: Add one mana of this artifact's last noted type.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jeweled-amulet-charge",
            oracleText:
                "{1}, {T}: Put a charge counter on this artifact. Note the type of mana spent to pay this activation cost. Activate only if there are no charge counters on this artifact.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            // CR 122 — "Activate only if there are no charge counters on it."
            canActivate: (source) => (source.counters?.charge ?? 0) === 0,
            // CR 106.10 — capture the TYPE of mana spent to pay the {1}.
            noteManaSpent: true,
            resolve: (ctx: SpellContext) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "charge",
                    1
                );
                // The {1} generic was paid with exactly one mana of some colour;
                // note that colour (CR 106.10).
                const spent = ctx.getNotedManaSpent();
                ctx.noteMana(ctx.sourceInstanceId, { mana: spent });
            },
        },
        {
            id: "jeweled-amulet-add",
            oracleText:
                "{T}, Remove a charge counter from this artifact: Add one mana of this artifact's last noted type.",
            cost: { tap: true, removeCounter: { type: "charge", count: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addNotedMana(ctx.sourceInstanceId, ctx.caster);
            },
        },
    ],
};
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
// Naked Singularity — cumulative upkeep {3} (CR 702.24, ADR 0042) plus a
// continuous per-basic-subtype land-mana permutation (CR 614): "If tapped for
// mana, Plains produce {R}, Islands produce {G}, Swamps produce {W}, Mountains
// produce {U}, and Forests produce {B} instead of any other type." Modelled as
// a `byBasicSubtype` `landManaSubstitution` (global, read live from the
// battlefield by the `applyLandManaReplacement` mana funnel). A dual / nonbasic
// land whose subtype isn't a basic type is unaffected.
export const nakedSingularity: CardDefinition = {
    id: "cabadfb2-93cd-4c7a-b901-59c3dd1a7c3c",
    name: "Naked Singularity",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {3} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nIf tapped for mana, Plains produce {R}, Islands produce {G}, Swamps produce {W}, Mountains produce {U}, and Forests produce {B} instead of any other type.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    landManaSubstitution: {
        byBasicSubtype: {
            Plains: "R",
            Island: "G",
            Swamp: "W",
            Mountain: "U",
            Forest: "B",
        },
    },
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "naked-singularity-cumulative-upkeep",
            cost: { X: 3 },
            costLabel: "{3}",
        }),
    ],
};
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
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
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
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
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
// Urza's Bauble ships as an active CardDefinition below (issue #674): the
// next-upkeep cantrip is buildable via the shared `nextUpkeepDrawTrigger`, and
// the "look at a card at random in target player's hand" clause is purely
// informational (no game-state change, no decision derives from it — unlike
// Wand of Ith), so it is intentionally not modelled. See the def for the note.
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
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
    ],
};
// Painland cycle (Adarkar Wastes, Brushland, Karplusan Forest, Sulfurous
// Springs, Underground River) — "{T}: Add {C}.  {T}: Add <c1> or <c2>. This
// land deals 1 damage to you." (CR 605.1a — both are mana abilities,
// `useStack: false`). Modelled as ONE choice mana ability whose first option is
// the painless {C} and whose two coloured options carry the
// `dealsDamageToControllerOnColoredTap: 1` rider, so the colourless tap stays
// free while only a coloured tap pings the controller. City of Brass's blanket
// "whenever this becomes tapped" trigger can't express this (it fires on every
// tap, including the painless {C}); the rider fires only on a coloured choice.
export const adarkarWastes: CardDefinition = {
    id: "09dd9023-f7ee-4e99-8821-7059deb83730",
    name: "Adarkar Wastes",
    rarity: "rare",
    oracleText:
        "{T}: Add {C}.\n{T}: Add {W} or {U}. This land deals 1 damage to you.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "adarkar-wastes-mana",
            oracleText:
                "{T}: Add {C}.\n{T}: Add {W} or {U}. This land deals 1 damage to you.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ C: 1 }, { W: 1 }, { U: 1 }],
            dealsDamageToControllerOnColoredTap: 1,
        },
    ],
};
// Painland — see Adarkar Wastes note ({C} painless + coloured-tap self-damage).
export const brushland: CardDefinition = {
    id: "170e5ccd-54bf-4c6d-86b4-0359ca8f36e8",
    name: "Brushland",
    rarity: "rare",
    oracleText:
        "{T}: Add {C}.\n{T}: Add {G} or {W}. This land deals 1 damage to you.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "brushland-mana",
            oracleText:
                "{T}: Add {C}.\n{T}: Add {G} or {W}. This land deals 1 damage to you.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ C: 1 }, { G: 1 }, { W: 1 }],
            dealsDamageToControllerOnColoredTap: 1,
        },
    ],
};
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
// Painland — see Adarkar Wastes note ({C} painless + coloured-tap self-damage).
export const karplusanForest: CardDefinition = {
    id: "ba6f1263-d598-49fb-b5f8-09f11822ebd0",
    name: "Karplusan Forest",
    rarity: "rare",
    oracleText:
        "{T}: Add {C}.\n{T}: Add {R} or {G}. This land deals 1 damage to you.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "karplusan-forest-mana",
            oracleText:
                "{T}: Add {C}.\n{T}: Add {R} or {G}. This land deals 1 damage to you.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ C: 1 }, { R: 1 }, { G: 1 }],
            dealsDamageToControllerOnColoredTap: 1,
        },
    ],
};
// Depletion-dual cycle (Land Cap, Lava Tubes, River Delta, Timberline Ridge,
// Veldt — CR 605.1a / 502.1 / 603.6a / 122.1). Each:
//   * "{T}: Add <c1> or <c2>. Put a depletion counter on this land." — ONE
//     `manaChoices` tap mana ability (`useStack: false`, both options coloured)
//     carrying the `putDepletionCounterOnTap` rider, so every tap for mana puts
//     a depletion counter on the land (the engine adds it in both tap-for-mana
//     paths, and reverses it if the land is untapped to refund unspent mana).
//   * "This land doesn't untap during your untap step if it has a depletion
//     counter on it." — the `does-not-untap-with-depletion-counter` static
//     ability; the untap step skips the land while a depletion counter remains.
//   * "At the beginning of your upkeep, remove a depletion counter from this
//     land." — a `phaseTrigger` UPKEEP `your`-scoped trigger that removes one.
// Net: the land taps for mana, sits tapped through the next untap step, and the
// following upkeep clears the counter so it untaps every other turn. No new
// GameState field — the `depletion` counter rides the existing per-instance
// `counters` map (CR 122.1), which already persists across the DB round-trip.
function depletionDual(args: {
    id: string;
    name: string;
    c1: Exclude<Color, "C">;
    c2: Exclude<Color, "C">;
}): CardDefinition {
    const oracleText = `This land doesn't untap during your untap step if it has a depletion counter on it.\nAt the beginning of your upkeep, remove a depletion counter from this land.\n{T}: Add {${args.c1}} or {${args.c2}}. Put a depletion counter on this land.`;
    const slug = args.name.toLowerCase().replace(/[^a-z]+/g, "-");
    return {
        id: args.id,
        name: args.name,
        rarity: "rare",
        oracleText,
        types: ["Land"],
        // CR 502.1 — conditional untap-skip keyed on the depletion counter.
        staticAbilities: ["does-not-untap-with-depletion-counter"],
        activatedAbilities: [
            {
                id: `${slug}-mana`,
                oracleText: `{T}: Add {${args.c1}} or {${args.c2}}. Put a depletion counter on this land.`,
                cost: { tap: true },
                useStack: false,
                manaChoices: [{ [args.c1]: 1 }, { [args.c2]: 1 }],
                // CR 605.1a / 122.1 — every tap for mana puts a depletion
                // counter on the source (both options are coloured).
                putDepletionCounterOnTap: true,
            },
        ],
        triggeredAbilities: [
            // CR 603.6a / 122.1 — "At the beginning of your upkeep, remove a
            // depletion counter from this land."
            phaseTrigger({
                id: `${slug}-upkeep-deplete`,
                oracleText:
                    "At the beginning of your upkeep, remove a depletion counter from this land.",
                phase: "UPKEEP",
                scope: "your",
                resolve: (ctx) => {
                    ctx.removeCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "depletion",
                        1
                    );
                },
            }),
        ],
    };
}
export const landCap: CardDefinition = depletionDual({
    id: "c4806c02-7a4d-42e3-affd-0338084bd3ab",
    name: "Land Cap",
    c1: "W",
    c2: "U",
});
// Depletion-dual — see the `depletionDual` factory note above Land Cap.
export const lavaTubes: CardDefinition = depletionDual({
    id: "5e7c2cf6-f36f-451b-bba5-19a82c659c4c",
    name: "Lava Tubes",
    c1: "B",
    c2: "R",
});
// Depletion-dual — see the `depletionDual` factory note above Land Cap.
export const riverDelta: CardDefinition = depletionDual({
    id: "ea335fc0-0591-4acd-9ae8-7858222770da",
    name: "River Delta",
    c1: "U",
    c2: "B",
});
// Painland — see Adarkar Wastes note ({C} painless + coloured-tap self-damage).
export const sulfurousSprings: CardDefinition = {
    id: "2fdeab50-b45f-412b-85a3-c6cf009ce567",
    name: "Sulfurous Springs",
    rarity: "rare",
    oracleText:
        "{T}: Add {C}.\n{T}: Add {B} or {R}. This land deals 1 damage to you.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "sulfurous-springs-mana",
            oracleText:
                "{T}: Add {C}.\n{T}: Add {B} or {R}. This land deals 1 damage to you.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ C: 1 }, { B: 1 }, { R: 1 }],
            dealsDamageToControllerOnColoredTap: 1,
        },
    ],
};
// Depletion-dual — see the `depletionDual` factory note above Land Cap.
export const timberlineRidge: CardDefinition = depletionDual({
    id: "87cc2fc9-0a24-4ac1-afcc-9317b90c7178",
    name: "Timberline Ridge",
    c1: "R",
    c2: "G",
});
// Painland — see Adarkar Wastes note ({C} painless + coloured-tap self-damage).
export const undergroundRiver: CardDefinition = {
    id: "92369d7e-5e5a-46f9-bb31-c57d62410283",
    name: "Underground River",
    rarity: "rare",
    oracleText:
        "{T}: Add {C}.\n{T}: Add {U} or {B}. This land deals 1 damage to you.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "underground-river-mana",
            oracleText:
                "{T}: Add {C}.\n{T}: Add {U} or {B}. This land deals 1 damage to you.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ C: 1 }, { U: 1 }, { B: 1 }],
            dealsDamageToControllerOnColoredTap: 1,
        },
    ],
};
// Depletion-dual — see the `depletionDual` factory note above Land Cap.
export const veldt: CardDefinition = depletionDual({
    id: "987534fb-74a9-46a3-805f-fe2fe2df4a90",
    name: "Veldt",
    c1: "G",
    c2: "W",
});
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
// Urza's Bauble — {0} Artifact (Vintage Cube card-advantage tranche, issue
// #674). "{T}, Sacrifice this artifact: Look at a card at random in target
// player's hand. You draw a card at the beginning of the next turn's upkeep."
// The "look at a random card" clause is hidden information shown only to the
// activator and changes no game state, so it is not modelled (CR 701.18 look);
// the card-advantage core is the next-upkeep cantrip, reusing the shared ICE
// `nextUpkeepDrawTrigger` rider (CR 603.7d delayed triggered ability). The
// ability resolves on the stack (it is not a mana ability), schedules the
// delayed draw, and the source is sacrificed as a cost.
export const urzasBauble: CardDefinition = {
    id: "58c9e9a7-e170-4361-b7d5-22fc0771c489",
    name: "Urza's Bauble",
    rarity: "common",
    oracleText:
        "{T}, Sacrifice this artifact: Look at a card at random in target player's hand. You draw a card at the beginning of the next turn's upkeep.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "urzas-bauble-look-draw",
            oracleText:
                "{T}, Sacrifice this artifact: Look at a card at random in target player's hand. You draw a card at the beginning of the next turn's upkeep.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            // Effect Script (ADR 0045/0048, migrated in #838): the
            // next-upkeep cantrip is a `delayedTrigger` Op with an inline
            // body (CR 603.7d) — the private look at a random hand card is
            // not modelled (no game state change). "controller" resolves to
            // the delayed trigger's controller (the activator, CR 113.7).
            effects: [
                {
                    op: "delayedTrigger",
                    timing: "next-upkeep",
                    oracleText:
                        "At the beginning of the next turn's upkeep, draw a card.",
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
    ],
};
