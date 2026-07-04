// Ice Age (ICE) — Black (mono-B) cards, split by colour per ADR 0043.
// The registry's `import * as ice from "./sets/ice"` resolves through
// ice/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {1}{G} → { X: 1, G: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).
import type {
    BlockersConfirmedEvent,
    CardDefinition,
    CardPrint,
    DelayedTriggerDef,
    GameEvent,
    PermanentFilter,
    PermanentView,
    SpellContext,
} from "../../types";
import { controlsSnowSubtype } from "../../snowReads";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { cumulativeUpkeepTrigger } from "../../abilities/cumulativeUpkeep";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { discardTrigger } from "../../abilities/triggers/discardTrigger";
import { lifeLostTrigger } from "../../abilities/triggers/lifeLostTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";

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
//     exile that card from your graveyard": ACTIVE (#667 — the CARD_DISCARDED
//     event + `discardTrigger` factory shipped; Necropotence is composed from
//     skip-draw + pay-life face-down exile + next-end-step return + the new
//     discard→exile trigger).
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
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +2/+2 EOT
            // on the announced target (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
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
            // Migrated resolve()→effects[] (ADR 0045): counter the announced
            // target creature spell (CR 701.5a). The other ability (pump) is
            // also migrated (brine-shaman-pump, pump Op, issue #840). Untouched
            // per-card test is the equivalence harness.
            effects: [{ op: "counter", target: { target: 0 } }],
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
            // NOT DSL-migratable (ADR 0045): taps the ENCHANTED host
            // (`getAttachedTo` — no attached-object selector) on an
            // `enteredTrigger`, which has no `effects[]` site (only phaseTrigger
            // does).
            // Blocked on: attached-object selector + enteredTrigger effects site.
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
            // NOT DSL-migratable (ADR 0045): untaps the ENCHANTED host
            // (`getAttachedTo` — no attached-object selector) on a
            // `host-controller`-scoped trigger (scoped player ≠ controller, so
            // `effects` is disallowed on the phaseTrigger).
            // Blocked on: attached-object selector + non-"your" trigger effects.
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
            // Migrated resolve()→effects[] (ADR 0045, #839): return the source
            // permanent to its owner's hand via the implicit $source binding
            // (CR 701.10 / 400.7).
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
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
// DEFERRED (#664 shipped divide-as-you-choose; Gaze of Pain is a separate
// combat-redirect capability that does NOT use divided damage). It needs a
// player-scoped, turn-long, EVENT-WATCHING delayed trigger: "until end of turn,
// whenever a creature YOU CONTROL attacks and isn't blocked" must hook every
// `ATTACKER_UNBLOCKED` this turn (CR 509.1h), then offer an optional
// (`you may`) "deal damage = its power to a target creature; if you do, it
// assigns no combat damage" choice. The building blocks exist
// (`ATTACKER_UNBLOCKED` event, `markAssignsNoCombatDamage`, `dealDamage`), but
// the turn-scoped event-watcher + optional-redirect-with-target orchestration
// is unbuilt — the engine's `delayedTriggers` are one-shot phase-boundary
// timings, not event-watching. Flagged for the combat-redirect cluster (twin:
// Cloak of Confusion's discard rider). Stub kept for the art mapping.
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
// Hecatomb — ETB "sacrifice this enchantment unless you sacrifice four
// creatures" (CR 603.6a ETB + CR 117.3a unless-cost + CR 701.16 sacrifice,
// same shape as Mold Demon) plus an activated "Tap an untapped Swamp you
// control: deal 1 damage to any target." The tap-a-Swamp leg is a
// `tapOtherFilter` activation cost (CR 602.1 / 118.8) — the same generic
// tap-another-permanent cost Hand of Justice / Vodalian War Machine use, here
// pointed at a LAND subtype rather than a creature. The damage is a standard
// `type: "any"` targeted ability (CR 115.4).
export const hecatomb: CardDefinition = {
    id: "8f59620f-ff9e-44d8-9c4e-be9de1a919e8",
    name: "Hecatomb",
    rarity: "rare",
    oracleText:
        "When this enchantment enters, sacrifice this enchantment unless you sacrifice four creatures.\nTap an untapped Swamp you control: This enchantment deals 1 damage to any target.",
    manaCost: { X: 1, B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "hecatomb-etb",
            oracleText:
                "When this enchantment enters, sacrifice this enchantment unless you sacrifice four creatures.",
            scope: "self",
            resolve: (ctx) => {
                const controller = ctx.controller;
                const creatureIds = ctx.getBattlefieldIds(controller, {
                    types: "Creature",
                });
                // CR 117.3a — an unpayable "unless" cost (fewer than four
                // creatures, counting Hecatomb itself? No: Hecatomb is an
                // Enchantment, not a creature) forces the consequence: sacrifice
                // Hecatomb. No prompt with no real choice.
                if (creatureIds.length < 4) {
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                const accept = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: `hecatomb-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice four creatures to keep Hecatomb?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                const picked = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `hecatomb-${ctx.sourceInstanceId}-creatures`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { types: "Creature" },
                    count: 4,
                    prompt: "Sacrifice four creatures.",
                });
                if (picked === undefined) return; // suspended
                if (picked.length < 4) {
                    // Failed to pay the full cost → sacrifice Hecatomb.
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "hecatomb-ping",
            oracleText:
                "Tap an untapped Swamp you control: This enchantment deals 1 damage to any target.",
            // CR 602.1 / 118.8 — "Tap an untapped Swamp you control" is a
            // tap-ANOTHER-permanent cost (not the source's own {T}). The Swamp
            // is a land, exercising the tap-a-land seam of `tapOtherFilter`.
            cost: {
                tapOtherFilter: {
                    filter: { subtypes: "Swamp", controllerRelation: "you" },
                    count: 1,
                },
            },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 1);
            },
        },
    ],
};
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
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+1 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
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
            // Migrated resolve()→effects[] (ADR 0045, #843): self -1/0 (CR 611.1)
            // + self-grant flying until end of turn (CR 611.1b).
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: -1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
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
// Infernal Darkness — cumulative upkeep {B} and 1 life (CR 702.24, ADR 0042,
// mixed mana+life cost so the scaled total repeats the {B} and sums the life)
// plus a continuous land-mana colour substitution (CR 614): "If a land is
// tapped for mana, it produces {B} instead of any other type." The
// substitution is GLOBAL (every player's lands) and unconditional (any land),
// so it's a single-`color` `landManaSubstitution` read live from the
// battlefield by the `applyLandManaReplacement` mana funnel.
export const infernalDarkness: CardDefinition = {
    id: "f3475eb3-909d-450b-9597-b241b259b425",
    name: "Infernal Darkness",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep—Pay {B} and 1 life. (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nIf a land is tapped for mana, it produces {B} instead of any other type.",
    manaCost: { X: 2, B: 2 },
    types: ["Enchantment"],
    landManaSubstitution: { color: "B" },
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "infernal-darkness-cumulative-upkeep",
            cost: { mana: { B: 1 }, life: 1 },
            costLabel: "{B} and 1 life",
        }),
    ],
};
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
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.15a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
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
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant first
            // strike until end of turn (CR 611.1b).
            effects: [
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "knight-of-stromgald-pump",
            oracleText: "{B}{B}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { B: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+0 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
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
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+0 EOT
            // on the announced target (CR 613.4c) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
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
            // NOT DSL-migratable (ADR 0045): the flying grant is covered
            // (grantAbility #843), but the delayed "sacrifice it" body cannot be
            // expressed — the `sacrifice` Op reads a picks-LIST binding, while a
            // delayedTrigger capture binds the announced target as a single
            // OBJECT ($ via bindSnapshot), which `sacrifice` cannot read.
            // Blocked on: sacrifice-by-object-ref (a single-permanent sacrifice
            // Op).
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
            // NOT DSL-migratable yet (ADR 0048): the delayed capture is the
            // trigger-EVENT's dead creature (deadCreature.id) — the tracked
            // $event.<field> grammar gap. Stays resolve().
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
            // Migrated resolve()→effects[] (ADR 0045, #839): return the source
            // permanent to its owner's hand via the implicit $source binding
            // (CR 701.10 / 400.7).
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
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
            // NOT DSL-migratable (ADR 0045): on decline, taps the ENCHANTED host
            // (`getAttachedTo` — no attached-object selector) on a
            // `host-controller`-scoped trigger (scoped player ≠ controller, so
            // `effects` is disallowed on the phaseTrigger).
            // Blocked on: attached-object selector + non-"your" trigger effects.
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
            // NOT DSL-migratable (ADR 0045): "deals 5 damage unless you
            // sacrifice a creature; if it deals damage this way, tap it" is a
            // sacrifice-as-alternative-cost (a mayPay whose cost is a chosen
            // sacrifice, not mana — the `mayPay` Op only pays a ManaCost) with a
            // conditional self-tap on the declined branch. Same class as
            // Yawgmoth Demon.
            // Blocked on: a sacrifice-cost mayPay + declined-branch predicate.
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
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +3/-2 EOT
            // on the announced target (CR 613.4c; toughness is a signed value,
            // -2 is a shrink) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 3,
                    toughness: -2,
                    duration: { phase: "end-of-turn" },
                },
            ],
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
// Necropotence (#667) — the Ice Age card-advantage engine, composed from
// shipped primitives plus the CARD_DISCARDED seam this slice added:
//   1. "Skip your draw step." — CR 504 / 614 draw-step skip via the
//      `drawStepReplacement` flag (Island Sanctuary precedent). Necropotence's
//      skip is UNCONDITIONAL (no "may"), so the flag alone suffices — no DRAW
//      phaseTrigger offers a choice (unlike Island Sanctuary / Fasting).
//   2. "Whenever you discard a card, exile that card from your graveyard." —
//      CR 701.8 discard event + CR 603 trigger via the new `discardTrigger`
//      factory (CARD_DISCARDED). The card has already landed in the graveyard
//      when the event fires, so the resolve moves it graveyard → exile.
//   3. "Pay 1 life: Exile the top card of your library face down. Put that card
//      into your hand at the beginning of your next end step." — a life-cost
//      activated ability (CR 118.4) that exiles the top library card face down
//      (`exileFaceDown`, ADR 0026 impulse-draw) and schedules a next-end-step
//      delayed trigger (CR 603.7a) carrying that card's id; the delayed trigger
//      moves it exile → hand. Each activation schedules its own delayed trigger,
//      so any number of cards exiled this turn all return at the same next end
//      step.
const NECROPOTENCE_ID = "54d7a0c1-efb4-4a8d-ad92-a96d43835052";
export const necropotence: CardDefinition = {
    id: NECROPOTENCE_ID,
    name: "Necropotence",
    rarity: "rare",
    oracleText:
        "Skip your draw step.\nWhenever you discard a card, exile that card from your graveyard.\nPay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.",
    manaCost: { B: 3 },
    types: ["Enchantment"],
    // 1. CR 504 / 614 — "Skip your draw step." Suppresses the turn-based draw
    //    unconditionally (no DRAW phaseTrigger, unlike the "may skip" cards).
    drawStepReplacement: true,
    triggeredAbilities: [
        // 2. CR 701.8 / 603 — "Whenever you discard a card, exile that card from
        //    your graveyard." Fires off the CARD_DISCARDED choke point.
        discardTrigger({
            id: "necropotence-discard-exile",
            oracleText:
                "Whenever you discard a card, exile that card from your graveyard.",
            scope: "your",
            resolve: (ctx, _event, discardingPlayerId, discardedId) => {
                // The discarded card is in the graveyard; exile it face up.
                ctx.moveCardById(
                    discardingPlayerId,
                    discardedId,
                    "graveyard",
                    "exile"
                );
            },
        }),
    ],
    activatedAbilities: [
        // 3. CR 118.4 — "Pay 1 life: Exile the top card of your library face
        //    down. Put that card into your hand at the beginning of your next
        //    end step."
        {
            id: "necropotence-pay-life",
            oracleText:
                "Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.",
            cost: { life: 1 },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 121.1 — the top card of the controller's library.
                const topId = ctx.peekLibraryTop(ctx.controller, 1)[0];
                if (topId === undefined) return; // empty library — nothing exiled
                // CR 406.3 / ADR 0026 — exile FACE DOWN, known to the
                // controller alone (opponents see a face-down card).
                ctx.exileFaceDown(
                    ctx.controller,
                    topId,
                    "library",
                    ctx.controller
                );
                // CR 603.7a — schedule the return at the next end step. The
                // exiled card's instance id rides in the payload; multiple
                // activations queue independent delayed triggers.
                ctx.scheduleDelayedTrigger(
                    NECROPOTENCE_ID,
                    "necropotence-return-to-hand",
                    "next-end-step",
                    { cardInstanceId: topId, ownerId: ctx.controller }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "necropotence-return-to-hand",
            oracleText:
                "At the beginning of your next end step, put the exiled card into your hand.",
            timing: "next-end-step",
            resolve: (ctx: SpellContext, payload) => {
                // CR 400.7 — move the exiled card to its owner's hand. No-op if
                // it has since left exile (e.g. a graveyard-hate effect).
                ctx.moveCardById(
                    payload.ownerId,
                    payload.cardInstanceId,
                    "exile",
                    "hand"
                );
            },
        },
    ],
};
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
            // Migrated resolve()→effects[] (ADR 0045, #842): untap the announced
            // blue-creature target (CR 701.26b).
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
            ],
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
// Oath of Lim-Dûl (#668) — the demonstration card for the LIFE_LOST seam.
//   "Whenever you lose life, for each 1 life you lost, sacrifice a permanent
//    other than this enchantment unless you discard a card. {B}{B}: Draw a
//    card."
// 1. CR 119.3 / 603 — the triggered ability listens to LIFE_LOST (the new seam
//    emitted on every life-loss path: the `loseLife` primitive, paid life costs,
//    and all damage-to-player sinks). The event carries the amount actually
//    lost, so the resolve loops `amount` times (CR 603 — "for each 1 life you
//    lost"). Each iteration is a punisher choice (CR 117.3a): the default is to
//    sacrifice a permanent other than Oath itself; the player may instead
//    discard a card. Per-iteration `choiceId`s (`oath-...-${i}`) keep the
//    suspend/resume of `requestMayPay` / `requestChoice` stable across replays —
//    on resume the answered iterations fast-forward to the next open point.
// 2. CR 605 — the {B}{B} draw activated ability is plain.
const OATH_OF_LIM_DUL_ID = "f16df768-06de-43a0-b548-44fb0887490b";
export const oathOfLimDul: CardDefinition = {
    id: OATH_OF_LIM_DUL_ID,
    name: "Oath of Lim-Dûl",
    rarity: "rare",
    oracleText:
        "Whenever you lose life, for each 1 life you lost, sacrifice a permanent other than this enchantment unless you discard a card. (Damage dealt to you causes you to lose life.)\n{B}{B}: Draw a card.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        lifeLostTrigger({
            id: "oath-of-lim-dul-life-loss",
            oracleText:
                "Whenever you lose life, for each 1 life you lost, sacrifice a permanent other than this enchantment unless you discard a card.",
            scope: "your",
            resolve: (ctx, _event, losingPlayerId, amount) => {
                // CR 603 — repeat the punisher resolution once per point of
                // life lost. The loop is replay-stable: each iteration's
                // choices key under unique `choiceId`s, so a suspended
                // (undefined) request that re-enters the body fast-forwards
                // through already-answered points.
                for (let i = 0; i < amount; i++) {
                    const handIds = ctx.getHandIds(losingPlayerId);
                    // CR 117.3a — the player may discard a card INSTEAD of
                    // sacrificing. Only offer the opt-out when a card exists.
                    if (handIds.length > 0) {
                        const discardInstead = ctx.requestMayPay({
                            playerId: losingPlayerId,
                            choiceId: `oath-discard-may-${i}`,
                            prompt: "Discard a card instead of sacrificing a permanent to Oath of Lim-Dûl?",
                        });
                        if (discardInstead === undefined) return; // suspended
                        if (discardInstead) {
                            const picked = ctx.requestChoice({
                                playerId: losingPlayerId,
                                choiceId: `oath-discard-${i}`,
                                kind: "choose-hand-card",
                                zone: "hand",
                                count: 1,
                                prompt: "Discard a card.",
                            });
                            if (picked === undefined) return; // suspended
                            if (picked.length > 0) {
                                ctx.discardCard(losingPlayerId, picked[0]);
                            }
                            continue;
                        }
                    }
                    // Default: sacrifice a permanent other than Oath itself
                    // (CR 701.16). If the only permanent is Oath (or none),
                    // there is nothing to sacrifice — the clause does nothing.
                    const sacCandidates = ctx
                        .getBattlefieldIds(losingPlayerId)
                        .filter((id) => id !== ctx.sourceInstanceId);
                    if (sacCandidates.length === 0) continue;
                    const chosen = ctx.requestChoice({
                        playerId: losingPlayerId,
                        choiceId: `oath-sacrifice-${i}`,
                        kind: "choose-permanents",
                        zone: "battlefield",
                        count: 1,
                        candidateIds: sacCandidates,
                        prompt: "Sacrifice a permanent other than Oath of Lim-Dûl.",
                    });
                    if (chosen === undefined) return; // suspended
                    if (chosen.length > 0) ctx.sacrifice(chosen[0]);
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "oath-of-lim-dul-draw",
            oracleText: "{B}{B}: Draw a card.",
            cost: { mana: { B: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};
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
// Pox — "Each player loses a third of their life, rounds up, then discards a
// third of the cards in their hand, rounds up, then sacrifices a third of the
// creatures they control, rounds up, then sacrifices a third of the lands they
// control, rounds up. (Each player chooses which cards to discard and which
// permanents to sacrifice.)" — modern Oracle text (CR 119.3 life loss; CR 701.8
// discard; CR 701.16 sacrifice; CR 107.2 "round up"). The four phases happen in
// APNAP order (CR 101.4) and each is a SEPARATE suspension point so a player's
// choice in one phase doesn't leak into another; modeled as four `resolveSteps`.
//
// "A third, rounded up" of n is `Math.ceil(n / 3)`. For the permanent/hand
// phases each player CHOOSES which to keep, so the engine prompts the player to
// pick the KEEP set (count = n − ceil(n/3)) and sacrifices/discards the rest —
// the same shrink-to-a-target-count primitive Balance uses.
function poxThird(n: number): number {
    return Math.ceil(n / 3); // CR 107.2 — "round up"
}

// Each player chooses which `loseCount = ceil(n/3)` permanents (matching
// `filter`) to sacrifice — i.e. which `n − loseCount` to KEEP. Mirrors the
// Balance equalize helper; the keep-pick is auto-resolved when there is no real
// choice (lose all, or lose none).
function poxSacrificeThird(
    ctx: SpellContext,
    filter: PermanentFilter,
    label: { singular: string; plural: string }
): void {
    const players = ctx.apNapOrder();
    const keepByPlayer: Record<string, string[] | undefined> = {};
    for (const p of players) {
        const ids = ctx.getBattlefieldIds(p, filter);
        const n = ids.length;
        const keep = n - poxThird(n);
        if (keep <= 0) {
            keepByPlayer[p] = []; // sacrifice everything — no choice
            continue;
        }
        if (keep >= n) {
            keepByPlayer[p] = ids; // sacrifice nothing — no choice
            continue;
        }
        keepByPlayer[p] = ctx.requestChoice({
            playerId: p,
            choiceId: `pox-${label.plural}-${p}`,
            kind: "keep-permanents",
            zone: "battlefield",
            filter,
            count: keep,
            prompt:
                keep === 1
                    ? `Pox: choose the ${label.singular} to keep`
                    : `Pox: choose ${keep} ${label.plural} to keep`,
        });
    }
    if (Object.values(keepByPlayer).some((v) => v === undefined)) return;
    for (const p of players) {
        const keep = new Set(keepByPlayer[p]);
        for (const id of ctx.getBattlefieldIds(p, filter)) {
            if (!keep.has(id)) ctx.sacrifice(id);
        }
    }
}

export const pox: CardDefinition = {
    id: "a914138c-a593-414c-bbcb-83d3c1bc4f6f",
    name: "Pox",
    rarity: "rare",
    oracleText:
        "Each player loses a third of their life, rounds up, then discards a third of the cards in their hand, rounds up, then sacrifices a third of the creatures they control, rounds up, then sacrifices a third of the lands they control, rounds up.",
    manaCost: { B: 3 },
    types: ["Sorcery"],
    resolveSteps: [
        // 1) Each player loses a third of their life (round up). No choice.
        (ctx: SpellContext) => {
            for (const p of ctx.apNapOrder()) {
                const loss = poxThird(ctx.getLife(p));
                if (loss > 0) ctx.loseLife(p, loss);
            }
        },
        // 2) Each player discards a third of their hand (round up), their choice.
        (ctx: SpellContext) => {
            const players = ctx.apNapOrder();
            const keepByPlayer: Record<string, string[] | undefined> = {};
            for (const p of players) {
                const ids = ctx.getHandIds(p);
                const n = ids.length;
                const keep = n - poxThird(n);
                if (keep <= 0) {
                    keepByPlayer[p] = [];
                    continue;
                }
                if (keep >= n) {
                    keepByPlayer[p] = ids;
                    continue;
                }
                keepByPlayer[p] = ctx.requestChoice({
                    playerId: p,
                    choiceId: `pox-hand-${p}`,
                    kind: "keep-hand",
                    zone: "hand",
                    count: keep,
                    prompt:
                        keep === 1
                            ? "Pox: choose 1 card to keep"
                            : `Pox: choose ${keep} cards to keep`,
                });
            }
            if (Object.values(keepByPlayer).some((v) => v === undefined))
                return;
            for (const p of players) {
                const keep = new Set(keepByPlayer[p]);
                for (const id of ctx.getHandIds(p)) {
                    if (!keep.has(id)) ctx.discardCard(p, id);
                }
            }
        },
        // 3) Each player sacrifices a third of their creatures (round up).
        (ctx: SpellContext) => {
            poxSacrificeThird(
                ctx,
                { types: "Creature" },
                { singular: "creature", plural: "creatures" }
            );
        },
        // 4) Each player sacrifices a third of their lands (round up).
        (ctx: SpellContext) => {
            poxSacrificeThird(
                ctx,
                { types: "Land" },
                { singular: "land", plural: "lands" }
            );
        },
    ],
};
// Seizures (#668) — Aura demonstrating the host-scoped "becomes tapped"
// trigger seam.
//   "Enchant creature. Whenever enchanted creature becomes tapped, this Aura
//    deals 3 damage to that creature's controller unless that player pays {3}."
// CR 303.4 — an Aura with `targetRequirement: { type: "Creature" }`. CR 701.20a
// / 603 — the trigger listens to PERMANENT_TAPPED with `scope: "host"` (the new
// PermanentScope variant matching the Aura's `attachedTo` host), so it fires
// only when the ENCHANTED creature becomes tapped. CR 117.3a — the host's
// controller may pay {3} to avoid the 3 damage (CR 120.1).
export const seizures: CardDefinition = {
    id: "da369c86-7e17-43d8-b626-b6842e3d2d50",
    name: "Seizures",
    rarity: "common",
    oracleText:
        "Enchant creature\nWhenever enchanted creature becomes tapped, this Aura deals 3 damage to that creature's controller unless that player pays {3}.",
    manaCost: { X: 1, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "seizures-tapped",
            oracleText:
                "Whenever enchanted creature becomes tapped, this Aura deals 3 damage to that creature's controller unless that player pays {3}.",
            // CR 303.4b — keyed on the enchanted creature (the Aura's host).
            scope: "host",
            resolve: (ctx, _event, tapped) => {
                // CR 117.3a — the controller of the enchanted creature may pay
                // {3} to avoid the damage.
                const controller = tapped.controllerId;
                const accept = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: controller,
                    cost: { X: 3 },
                    prompt: "Pay {3} or take 3 damage from Seizures?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.dealDamage({ type: "player", id: controller }, 3);
                }
            },
        }),
    ],
};
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
// Soul Burn — "{X}{2}{B}: Soul Burn deals X damage to any target. You gain life
// equal to the damage dealt, but not more than the amount of {B} spent on X …"
// (CR 107.3 X, CR 120 damage, CR 119 lifegain). The lifegain is capped by the
// {B} actually spent on X: `noteManaSpent` records the per-colour pool delta
// around payment, and the resolve reads it back via `getNotedManaSpent()` and
// subtracts the one fixed {B} pip to isolate the black spent on the X portion.
// The `{X}{2}{B}` cost uses the `generic` field (the `X` slot holds the
// variable marker, so the fixed {2} lives in `generic`).
//
// SIMPLIFICATION (flagged): the oracle's "Spend only black and/or red mana on X"
// payment restriction is NOT enforced at tap time — the engine has no
// colour-restricted generic-payment seam, and the merged mana pool carries no
// provenance of which colour paid the X portion. The observable game effect —
// the lifegain cap by {B} spent on X — IS modelled faithfully (noted black
// minus the fixed pip, clamped to [0, X]).
const SOUL_BURN_FIXED_BLACK_PIPS = 1;
export const soulBurn: CardDefinition = {
    id: "eb8e00d2-2381-4d45-bed8-c9bf738a9419",
    name: "Soul Burn",
    rarity: "common",
    oracleText:
        "Spend only black and/or red mana on X.\nSoul Burn deals X damage to any target. You gain life equal to the damage dealt, but not more than the amount of {B} spent on X, the player's life total before the damage was dealt, the planeswalker's loyalty before the damage was dealt, or the creature's toughness.",
    manaCost: { X: "X", generic: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    noteManaSpent: true,
    resolve: (ctx: SpellContext) => {
        const x = ctx.getX();
        ctx.dealDamage(ctx.targets[0], x);
        // CR 119 — gain life equal to the damage dealt, but not more than the
        // {B} spent on X. `notedManaSpent.B` includes the one fixed {B} pip; the
        // remainder is the black spent on the X portion (clamped to [0, X]). The
        // damage-dealt amount is X here (the toughness / life-total sub-caps are
        // the same secondary clause Drain Life also leaves unmodelled).
        const blackSpent = ctx.getNotedManaSpent().B ?? 0;
        const blackOnX = Math.max(
            0,
            Math.min(x, blackSpent - SOUL_BURN_FIXED_BLACK_PIPS)
        );
        if (blackOnX > 0) ctx.gainLife(ctx.caster, blackOnX);
    },
};
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
            // NOT DSL-migratable (ADR 0045, issue #840): pumps the enchanted creature (getAttachedTo). Blocked on: an attached-object EffectObjectSelector, not pump.
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
// Spoils of War is implemented below (divide-as-you-choose cluster, #664).
// Stench of Evil — {2}{B} Sorcery. "Destroy all Plains. For each land destroyed
// this way, Stench of Evil deals 1 damage to that land's controller unless they
// pay {2}." A per-permanent pay-or-damage rider over a mass effect (#669):
//   • step 0 — destroy every Plains, recording the controller of each one that
//     actually reached a graveyard (CR 614.5 — `destroy` reports real movement,
//     so an indestructible/regenerated Plains is not billed). The list persists
//     on the stack item (`noteMassRiderTargets`) because the destroy is
//     irreversible and step 1 may suspend on a may-pay.
//   • step 1 — for each recorded entry, the controller MAY pay {2}; on decline
//     (or inability) they take 1 damage. Decisions are collected FIRST and
//     damage applied in a single final pass (CR 608.2 — the idempotent
//     "collect then apply" pattern shared with Lim-Dûl's Hex), so a suspension
//     on a later entry never re-fires an earlier entry's damage.
export const stenchOfEvil: CardDefinition = {
    id: "4c7065a2-f819-4cbe-b453-a55e904f0461",
    name: "Stench of Evil",
    rarity: "uncommon",
    oracleText:
        "Destroy all Plains. For each land destroyed this way, Stench of Evil deals 1 damage to that land's controller unless they pay {2}.",
    manaCost: { X: 2, B: 2 },
    types: ["Sorcery"],
    resolveSteps: [
        (ctx: SpellContext) => {
            // CR 701.7 — destroy each Plains individually so the controller of
            // every land that actually dies is captured for the rider. (A
            // bulk `destroyAll` would not report which/whose lands moved.)
            const billed: string[] = [];
            ctx.forEachPlayer((playerId) => {
                for (const id of ctx.getBattlefieldIds(playerId, {
                    subtypes: "Plains",
                })) {
                    if (ctx.destroy({ type: "permanent", id })) {
                        billed.push(playerId);
                    }
                }
            });
            ctx.noteMassRiderTargets(billed);
        },
        (ctx: SpellContext) => {
            const billed = ctx.getMassRiderTargets();
            const takesDamage: string[] = [];
            for (let i = 0; i < billed.length; i++) {
                const playerId = billed[i];
                // CR 118 — the land's controller may pay {2} to avoid 1 damage.
                // A distinct choiceId per destroyed land keeps the prompts apart
                // under stepped resolution (CR 608.2).
                const paid = ctx.requestMayPay({
                    playerId,
                    choiceId: `stench-of-evil-${i}`,
                    cost: { X: 2 },
                    prompt: "Pay {2} to avoid 1 damage from Stench of Evil?",
                });
                if (paid === undefined) return; // suspended — resumes on submit.
                if (!paid) takesDamage.push(playerId);
            }
            // All decisions in — apply damage exactly once.
            for (const playerId of takesDamage) {
                ctx.dealDamage({ type: "player", id: playerId }, 1);
            }
        },
    ],
};
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
            // Migrated resolve()→effects[] (ADR 0045): counter the announced
            // target spell (CR 701.5a). Untouched per-card test is the
            // equivalence harness.
            effects: [{ op: "counter", target: { target: 0 } }],
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

// Spoils of War — {X}{B} Sorcery. "X is the number of artifact and/or creature
// cards in an opponent's graveyard as you cast this spell. Distribute X +1/+1
// counters among any number of target creatures." (CR 107.3 / 608.2g cast-time
// derived X; CR 601.2d / 120.4 divide as you choose.) The engine computes X
// from the opponent's graveyard at announcement (`xFromOpponentGraveyard`) — it
// is NOT chosen or paid — and snapshots it so `getX()` returns it at resolve.
// The {X} in the mana cost is the same derived value (it folds into generic at
// cast). Counters are distributed ≥1-each among the chosen creatures.
export const spoilsOfWar: CardDefinition = {
    id: "b38af8bd-d927-46d0-a1b1-fb437ea9ea66",
    name: "Spoils of War",
    rarity: "rare",
    oracleText:
        "X is the number of artifact and/or creature cards in an opponent's graveyard as you cast this spell.\nDistribute X +1/+1 counters among any number of target creatures.",
    manaCost: { X: "X", B: 1 },
    types: ["Sorcery"],
    additionalCosts: {
        xFromOpponentGraveyard: { cardTypes: ["Artifact", "Creature"] },
    },
    targetRequirement: {
        type: "Creature",
        count: { min: 1 },
        divideAsChosen: { total: "X" },
    },
    resolve: (ctx: SpellContext) => {
        ctx.distributeCountersAsChosen(ctx.targets, ctx.getX(), "+1/+1");
    },
};
