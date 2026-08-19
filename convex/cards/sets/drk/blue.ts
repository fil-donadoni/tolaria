// The Dark (DRK), split by colour per ADR 0043. The expansion after Legends
// (119 unique cards); every entry is a CardDefinition — The Dark has zero
// reprints of already-implemented cards, so there are no CardPrint stubs
// (ADR 0014). Modern Scryfall oracle text is authoritative (ADR 0004);
// canonical names / costs / P/T are sourced from MTGJSON `data/json/DRK.json`.
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are
// classified by the colour identity of their mana cost (CR 202.2); lands and
// artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    Color,
    ManaCost,
    SpellContext,
    TriggeredAbility,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
// CR 603.6a — reuse the shipped LEG C7 "sacrifice this unless you pay [cost]"
// upkeep trigger (the Elder Dragon maintenance-cost family) for Dance of Many's
// {U}{U} upkeep clause. NOT reimplemented here.
import { payOrSacrificeUpkeepTrigger } from "../leg";

// ═════════════════════════════════════════════════════════════════════════════
// BLUE free tranche (#412) — 13 of the 15 DRK Blue cards. Two (Leviathan, Tangle
// Kelp) need an unbuilt engine capability and are deferred in the footer below.
// Modern Scryfall oracle text (ADR 0004); stats validated against DRK.json.
// ═════════════════════════════════════════════════════════════════════════════

/** Shared upkeep "do X unless you pay [mana]" maintenance trigger (CR 603.6a +
 *  CR 117.3a). Mirrors lea.ts's `makeUpkeepPayOrElse` (the Stasis / Phantasmal
 *  Forces helper) so Sunken City and Psychic Allergy don't repeat the body. On
 *  the controller's upkeep the controller MAY pay `cost`; declining (or being
 *  unable to pay) runs `onDecline`. */
function upkeepPayOrElse(args: {
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
        // NOT DSL-migratable (ADR 0045): a shared parameterized helper whose
        // "unless" consequence (`onDecline`) is an opaque TypeScript callback
        // supplied per call site — no DSL construct captures a caller-
        // supplied effect body threaded through a factory parameter. Its
        // only current call site in this file (Sunken City) has its own
        // per-card test. Stays resolve().
        resolve: (ctx) => {
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                cost: args.cost,
                prompt: args.prompt,
            });
            if (accept === undefined) return; // suspended for the choice
            if (!accept) args.onDecline(ctx);
        },
    });
}

/** "When you control no Islands, sacrifice ~" state trigger (CR 603.8) — the
 *  Dandân / Island Fish Jasconius clause, reused by Giant Shark. */
function sacrificeWhenNoIslands(
    id: string,
    cardName: string
): TriggeredAbility {
    return stateTrigger({
        id,
        oracleText: `When you control no Islands, sacrifice ${cardName}.`,
        condition: (self, state) => {
            const controller = state.players.find(
                (p) => p.id === self.controllerId
            );
            return !controller?.battlefield.some((c) =>
                c.subtypes.includes("Island")
            );
        },
        resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
    });
}

// Amnesia — "Target player reveals their hand and discards all nonland cards."
// (CR 701.9 discard + CR 701.x reveal.) Reveals the whole hand to all players,
// then discards every card whose printed types contain no Land type. Lands are
// kept; everything else (instants, sorceries, creatures, artifacts,
// enchantments) is discarded.
export const amnesia: CardDefinition = {
    id: "e07df65c-ebcc-4873-b928-d99040d1f2f6",
    rarity: "uncommon",
    name: "Amnesia",
    oracleText:
        "Target player reveals their hand and discards all nonland cards.",
    manaCost: { X: 3, U: 3 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const [target] = ctx.targets;
        if (target?.type !== "player") return;
        const playerId = target.id;
        // CR 701.x — the whole hand is revealed to all players first.
        ctx.revealHand(playerId);
        // CR 701.9 — discard every nonland card (a card is "land" iff its
        // printed types include a Land type; CR 305).
        const handCards = ctx.getHandCards(playerId);
        for (const c of handCards) {
            if (!c.types.includes("Land")) ctx.discardCard(playerId, c.id);
        }
    },
};

// Apprentice Wizard — "{U}, {T}: Add {C}{C}{C}." (CR 605.1a mana ability —
// resolves immediately, no stack, CR 605.3a.) Pays one blue to filter into
// three colorless.
export const apprenticeWizard: CardDefinition = {
    id: "151b332e-164b-4646-8f52-741984cd71ad",
    rarity: "rare",
    name: "Apprentice Wizard",
    oracleText: "{U}, {T}: Add {C}{C}{C}.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "apprentice-wizard-mana",
            oracleText: "{U}, {T}: Add {C}{C}{C}.",
            cost: { tap: true, mana: { U: 1 } },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 3 }),
            manaProduced: { C: 3 },
        },
    ],
};

// Erosion — Aura enchant land. "At the beginning of the upkeep of enchanted
// land's controller, destroy that land unless that player pays {1} or 1 life."
// (CR 603.6a upkeep trigger scoped to the HOST's controller + CR 117.3a do-X-
// unless-you-pay with a choice of {1} OR 1 life — CR 119.4 life payment.) The
// "pay {1} or 1 life" alternatives are offered as two sequential may-pay
// prompts: mana first, then (if declined) 1 life; declining both destroys the
// land.
export const erosion: CardDefinition = {
    id: "5f4b6507-89ee-482e-aafd-8e05ada8f1ce",
    rarity: "common",
    name: "Erosion",
    oracleText:
        "Enchant land\nAt the beginning of the upkeep of enchanted land's controller, destroy that land unless that player pays {1} or 1 life.",
    manaCost: { U: 3 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "erosion-upkeep-tax",
            oracleText:
                "At the beginning of the upkeep of enchanted land's controller, destroy that land unless that player pays {1} or 1 life.",
            phase: "UPKEEP",
            // Scoped to the enchanted land's controller (CR 603.10 — read at
            // resolve); the factory resolves `host-controller` to the host's
            // current controller.
            scope: "host-controller",
            // NOT DSL-migratable (ADR 0045, re-assessed): `phaseTrigger` DOES
            // have an `effects[]` site now, so that's no longer the blocker.
            // Two genuine gaps remain: (1) the destroy target is the aura's
            // HOST (`ctx.getAttachedToId()`), a DIFFERENT object than
            // `$source`/`$each` — no DSL object-ref construct names "the
            // enchanted permanent"; (2) `scope: "host-controller"` needs the
            // land's controller as the mayPay/destroy actor, but an
            // `effects[]` script's `ctx.controller` is always the ABILITY's
            // controller (Erosion's own controller) — WRONG here, since the
            // whole point of the card is enchanting an OPPONENT's land.
            // Unlike `scope: "each"` (unblocked via `{ ref:
            // "$event.activePlayerId" }`, issue #1066), `PHASE_BEGIN`'s
            // censused field is the ACTIVE player, not "the host's
            // controller" — no equivalent ref exists for host-controller
            // scope. Stays resolve().
            // Blocked on: an object-ref construct for an aura's attached
            // host, and a host-controller-scope player ref — both genuine
            // Op-vocabulary gaps. Worth an issue if more Aura-upkeep-tax
            // cards need it.
            resolve: (ctx, _event, scopedPlayerId) => {
                const hostId = ctx.getAttachedToId();
                if (hostId === undefined) return; // host gone — nothing to tax
                // CR 117.3a — first offer to pay {1}.
                const paidMana = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `erosion-mana-${ctx.sourceInstanceId}`,
                    cost: { X: 1 },
                    prompt: "Pay {1} to keep the enchanted land?",
                });
                if (paidMana === undefined) return; // suspended
                if (paidMana) return;
                // Declined the mana — offer 1 life instead (CR 119.4).
                if (ctx.getLife(scopedPlayerId) >= 1) {
                    const paidLife = ctx.requestMayPay({
                        playerId: scopedPlayerId,
                        choiceId: `erosion-life-${ctx.sourceInstanceId}`,
                        prompt: "Pay 1 life to keep the enchanted land?",
                    });
                    if (paidLife === undefined) return; // suspended
                    if (paidLife) {
                        ctx.loseLife(scopedPlayerId, 1);
                        return;
                    }
                }
                ctx.destroy({ type: "permanent", id: hostId });
            },
        }),
    ],
};

// Flood — "{U}{U}: Tap target creature without flying." (CR 605 activated
// ability; CR 701.26a tap; CR 702.9 the "without flying" filter excludes
// flyers from legal targets via `excludeAbility`.)
export const flood: CardDefinition = {
    id: "fabc3267-b59b-4f36-8873-5b4b072711ca",
    rarity: "uncommon",
    name: "Flood",
    oracleText: "{U}{U}: Tap target creature without flying.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "flood-tap",
            oracleText: "{U}{U}: Tap target creature without flying.",
            cost: { mana: { U: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeAbility: "flying",
            },
            // Migrated resolve()→effects[] (ADR 0045, #842): tap the announced
            // creature-without-flying target (CR 701.26a tap).
            effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
        },
    ],
};

// Ghost Ship — "Flying\n{U}{U}{U}: Regenerate this creature." (CR 702.9 flying;
// CR 605 activated ability; CR 701.19a regenerate via a shield consumed by the
// next destroy.)
export const ghostShip: CardDefinition = {
    id: "db591b28-37e5-4e7c-ae4d-d761262b12d0",
    rarity: "common",
    name: "Ghost Ship",
    oracleText: "Flying\n{U}{U}{U}: Regenerate this creature.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 2,
    toughness: 4,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "ghost-ship-regenerate",
            oracleText: "{U}{U}{U}: Regenerate this creature.",
            cost: { mana: { U: 3 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.19a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Giant Shark — "This creature can't attack unless defending player controls an
// Island.\nWhenever this creature blocks or becomes blocked by a creature that
// has been dealt damage this turn, this creature gets +2/+0 and gains trample
// until end of turn.\nWhen you control no Islands, sacrifice this creature."
// (CR 508.1c attack restriction; CR 509.1h combat-pairing trigger gated on the
// opponent creature's marked damage — `getMarkedDamage` > 0 means it has been
// dealt damage this turn (CR 120.3, cleared at CLEANUP); CR 603.8 state-trigger
// sacrifice.)
export const giantShark: CardDefinition = {
    id: "53ec4a19-0f2f-4713-a869-58832484648d",
    rarity: "common",
    name: "Giant Shark",
    oracleText:
        "This creature can't attack unless defending player controls an Island.\nWhenever this creature blocks or becomes blocked by a creature that has been dealt damage this turn, this creature gets +2/+0 and gains trample until end of turn.\nWhen you control no Islands, sacrifice this creature.",
    manaCost: { X: 5, U: 1 },
    types: ["Creature"],
    subtypes: ["Shark"],
    power: 4,
    toughness: 4,
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "giant-shark-island-restriction",
            oracleText:
                "This creature can't attack unless defending player controls an Island.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
        },
    ],
    triggeredAbilities: [
        {
            id: "giant-shark-combat-pump",
            oracleText:
                "Whenever this creature blocks or becomes blocked by a creature that has been dealt damage this turn, this creature gets +2/+0 and gains trample until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return (
                    event.attackerId === self.id || event.blockerId === self.id
                );
            },
            // NOT DSL-migratable (ADR 0045, re-assessed): trigger-event field
            // capture itself HAS shipped — `BLOCKERS_CONFIRMED.attackerId` /
            // `.blockerId` are censused `EVENT_FIELD_REGISTRY` rows (ADR
            // 0049), so `$event.attackerId` / `$event.blockerId` ARE
            // readable. The remaining blocker is selecting "the OTHER
            // creature in the pair" — `isSelfAttacker ? event.blockerId :
            // event.attackerId`, an id-equality conditional pick. The frozen
            // grammar (bind/ref/if/forEach) has no id-equality `if`
            // predicate for this (tracked `$id-equality`, issue #865/#1315);
            // Venom sidesteps it by splitting into two role-discriminated
            // triggers, a restructuring this single-Oracle-line ability
            // avoids for now. `grantStaticAbility` itself is covered by
            // `grantAbility` (#843) and `addTemporaryPTBuff` by `pump` — only
            // the pair-selection is unblocked. Stays resolve().
            // Blocked on: an id-equality conditional-pick construct
            // ($id-equality, issue #865/#1315).
            resolve: (ctx, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const isSelfAttacker =
                    event.attackerId === ctx.sourceInstanceId;
                const opponentId = isSelfAttacker
                    ? event.blockerId
                    : event.attackerId;
                // CR 120.3 — "has been dealt damage this turn": non-zero marked
                // damage on the paired creature (damage persists until CLEANUP).
                if (
                    ctx.getMarkedDamage({
                        type: "permanent",
                        id: opponentId,
                    }) <= 0
                ) {
                    return;
                }
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.addTemporaryPTBuff(self, 2, 0, { phase: "end-of-turn" });
                ctx.grantStaticAbility(self, "trample", {
                    phase: "end-of-turn",
                });
            },
        },
        sacrificeWhenNoIslands("giant-shark-no-islands", "Giant Shark"),
    ],
};

// Mana Vortex — "When you cast this spell, counter it unless you sacrifice a
// land.\nAt the beginning of each player's upkeep, that player sacrifices a
// land of their choice.\nWhen there are no lands on the battlefield, sacrifice
// this enchantment." (CR 603.6e cast trigger that may counter the spell on the
// stack; CR 603.6a each-player upkeep land sacrifice; CR 603.8 state-trigger
// self-sacrifice.) The cast trigger uses `spellCastTrigger` scope "self".
export const manaVortex: CardDefinition = {
    id: "f857a00a-82e0-4227-86ee-1f9c7ca232ae",
    rarity: "rare",
    name: "Mana Vortex",
    oracleText:
        "When you cast this spell, counter it unless you sacrifice a land.\nAt the beginning of each player's upkeep, that player sacrifices a land of their choice.\nWhen there are no lands on the battlefield, sacrifice this enchantment.",
    manaCost: { X: 1, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        // CR 603.6e — "When you cast this spell, counter it unless you sacrifice
        // a land." The trigger goes above the Mana Vortex spell on the stack;
        // on resolution the controller may sacrifice a land to keep it,
        // otherwise the still-on-stack spell is countered (CR 117.3a).
        spellCastTrigger({
            id: "mana-vortex-cast-counter",
            oracleText:
                "When you cast this spell, counter it unless you sacrifice a land.",
            scope: "self",
            // NOT DSL-migratable (ADR 0045, re-assessed): `spellCastTrigger`
            // DOES have an `effects[]` site now, and `counter` IS a
            // registered Op — but the target here is THIS SPELL, currently on
            // the stack, being cast (CR 603.6e). `SPELL_CAST` has no
            // `EVENT_FIELD_REGISTRY` row (unlike `BLOCKERS_CONFIRMED` /
            // `PHASE_BEGIN`), so there is no `$event.spellInstanceId` ref to
            // name the counter target — a genuine census gap. Separately, the
            // land-sacrifice-or-counter gate needs the SAME raise-time
            // affordability pre-check gap documented on Yawgmoth Demon
            // (atq/black.ts): the imperative body checks `lands.length === 0`
            // BEFORE prompting, so a landless controller is countered with NO
            // suspension — the generic `mayPay` Op has no such pre-check.
            // Stays resolve(). (Mana Vortex's other two triggers — the
            // each-upkeep land sac and the no-lands self-sac — HAVE been
            // migrated to `effects[]` below.)
            // Blocked on: a `SPELL_CAST` `EVENT_FIELD_REGISTRY` row for
            // `spellInstanceId`, AND a raise-time affordability gate for
            // `mayPay` (same gap as Yawgmoth Demon).
            resolve: (ctx, _event, spell) => {
                const controller = ctx.controller;
                const spellRef = {
                    type: "spell" as const,
                    id: spell.instanceId,
                };
                const lands = ctx.getBattlefieldIds(controller, {
                    types: "Land",
                });
                // Can't afford the cost → the spell is countered (CR 117.3a).
                if (lands.length === 0) {
                    ctx.counter(spellRef);
                    return;
                }
                const accept = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: `mana-vortex-cast-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice a land to keep Mana Vortex?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.counter(spellRef);
                    return;
                }
                const picked = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `mana-vortex-cast-${ctx.sourceInstanceId}-land`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Sacrifice a land.",
                });
                if (picked === undefined) return; // suspended
                if (picked.length < 1) {
                    ctx.counter(spellRef);
                    return;
                }
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
        // CR 603.6a — at each player's upkeep, the active player sacrifices a
        // land of their choice.
        phaseTrigger({
            id: "mana-vortex-upkeep-sac",
            oracleText:
                "At the beginning of each player's upkeep, that player sacrifices a land of their choice.",
            phase: "UPKEEP",
            scope: "each",
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): scope
            // "each" needs the ACTIVE player, not the ability's controller —
            // `{ ref: "$event.activePlayerId" }` reads it straight off the
            // firing `PHASE_BEGIN` event (issue #1066, ADR 0049), unblocking
            // this trigger for `effects[]`.
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$event.activePlayerId" },
                    zone: "battlefield",
                    filter: { type: "Land" },
                    count: 1,
                    prompt: "Mana Vortex: sacrifice a land.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        }),
        // CR 603.8 — when no lands remain on the battlefield, sacrifice Mana
        // Vortex.
        stateTrigger({
            id: "mana-vortex-no-lands",
            oracleText:
                "When there are no lands on the battlefield, sacrifice this enchantment.",
            condition: (_self, state) =>
                !state.players.some((p) =>
                    p.battlefield.some((c) => c.types.includes("Land"))
                ),
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): sacrifice
            // the implicit $source (CR 701.21).
            effects: [{ op: "sacrifice", target: { ref: "$source" } }],
        }),
    ],
};

// Merfolk Assassin — "{T}: Destroy target creature with islandwalk." (CR 605
// activated ability; CR 701.8 destroy; `requireAbility: "islandwalk"` scopes
// legal targets to islandwalkers, CR 702.)
export const merfolkAssassin: CardDefinition = {
    id: "36313dc7-6bf2-4d73-b696-969d984a7466",
    rarity: "uncommon",
    name: "Merfolk Assassin",
    oracleText: "{T}: Destroy target creature with islandwalk.",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Assassin"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "merfolk-assassin-destroy",
            oracleText: "{T}: Destroy target creature with islandwalk.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                requireAbility: "islandwalk",
            },
            // Migrated resolve()→effects[] (ADR 0045, #832): destroy the
            // announced target creature (CR 701.8).
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Mind Bomb — "Each player may discard up to three cards. Mind Bomb deals
// damage to each player equal to 3 minus the number of cards they discarded
// this way." (CR 701.9 optional discard per player + CR 119 damage.) Each
// player independently chooses 0–3 cards to discard; the damage is 3 minus the
// count they discarded. APNAP order via `allPlayerIds`.
export const mindBomb: CardDefinition = {
    id: "0ee810a5-f0f9-4b73-8194-3d1344784050",
    rarity: "rare",
    name: "Mind Bomb",
    oracleText:
        "Each player may discard up to three cards. Mind Bomb deals damage to each player equal to 3 minus the number of cards they discarded this way.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    // NOT DSL-migratable (ADR 0045): the damage is "3 minus the number of cards
    // discarded" — arithmetic on a runtime pick count, which the value grammar
    // (literal/ref/count, no arithmetic) can't express. Stays resolve().
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            const handSize = ctx.getHandSize(pid);
            const max = Math.min(3, handSize);
            let discarded = 0;
            if (max > 0) {
                const picks = ctx.requestChoice({
                    playerId: pid,
                    choiceId: `mind-bomb-${ctx.sourceInstanceId}-${pid}`,
                    kind: "discard-hand",
                    zone: "hand",
                    count: { min: 0, max },
                    prompt: "Mind Bomb: discard up to three cards.",
                });
                if (picks === undefined) return; // suspended for this player
                for (const id of picks) ctx.discardCard(pid, id);
                discarded = picks.length;
            }
            const damage = 3 - discarded;
            if (damage > 0) ctx.dealDamage({ type: "player", id: pid }, damage);
        }
    },
};

const PSYCHIC_ALLERGY_COLOR_NAMES: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};
const PSYCHIC_ALLERGY_COLORS = ["W", "U", "B", "R", "G"] as const;

// Psychic Allergy — "As this enchantment enters, choose a color.\nAt the
// beginning of each opponent's upkeep, this enchantment deals X damage to that
// player, where X is the number of nontoken permanents of the chosen color they
// control.\nAt the beginning of your upkeep, destroy this enchantment unless you
// sacrifice two Islands." (CR 700.2c modal colour pick stored as `chosenModeId`;
// CR 603.6a opponents'-upkeep damage trigger; CR 603.6a + CR 117.3a own-upkeep
// destroy-unless-sacrifice-two-Islands.)
export const psychicAllergy: CardDefinition = {
    id: "fec3275e-4491-43a8-9f23-d7b48177c103",
    rarity: "rare",
    name: "Psychic Allergy",
    oracleText:
        "As this enchantment enters, choose a color.\nAt the beginning of each opponent's upkeep, this enchantment deals X damage to that player, where X is the number of nontoken permanents of the chosen color they control.\nAt the beginning of your upkeep, destroy this enchantment unless you sacrifice two Islands.",
    manaCost: { X: 3, U: 2 },
    types: ["Enchantment"],
    // CR 614.1c / 614.12a (issue #2019) — the colour is chosen AS the
    // enchantment enters, a replacement effect, so the pick is declared on
    // `entersWith.asEnters` (ADR 0100 D3) and raised at the single CR 614
    // chokepoint on every entry path rather than at cast announcement.
    entersWith: { asEnters: [{ kind: "mode" }] },
    modes: PSYCHIC_ALLERGY_COLORS.map((color) => ({
        id: color,
        label: PSYCHIC_ALLERGY_COLOR_NAMES[color],
        oracleText: `Deals damage equal to the number of nontoken ${PSYCHIC_ALLERGY_COLOR_NAMES[color]} permanents each opponent controls at their upkeep.`,
    })),
    triggeredAbilities: [
        phaseTrigger({
            id: "psychic-allergy-opponent-upkeep",
            oracleText:
                "At the beginning of each opponent's upkeep, this enchantment deals X damage to that player, where X is the number of nontoken permanents of the chosen color they control.",
            phase: "UPKEEP",
            scope: "opponents",
            // NOT DSL-migratable (ADR 0045, re-assessed): `phaseTrigger` DOES
            // have an `effects[]` site now, and `{ ref:
            // "$event.activePlayerId" }` (issue #1066) would resolve the
            // `scope: "opponents"` scoped player correctly. The remaining
            // blocker is the damage amount itself: "X, where X is the number
            // of nontoken permanents of the CHOSEN color" — the color is a
            // per-instance runtime value (`ctx.getChosenModeId()`, CR 700.2
            // modal pick), and `EffectCardFilter.color` only accepts a
            // static literal `Color`, not a ref/binding — no DSL construct
            // parametrizes a battlefield-count filter by a stored modal
            // choice. Stays resolve(). (The sibling upkeep clause —
            // "destroy unless sacrifice two Islands" — is tracked separately
            // below on `psychic-allergy-own-upkeep`.)
            // Blocked on: a ref/binding-driven `color` field on
            // `EffectCardFilter` (to parametrize a count filter by a stored
            // modal choice) — a genuine Op-vocabulary gap.
            resolve: (ctx, _event, scopedPlayerId) => {
                const color = ctx.getChosenModeId();
                if (!color) return;
                const ids = ctx.getBattlefieldIds(scopedPlayerId, {
                    colors: color as Color,
                    isToken: false,
                });
                if (ids.length > 0) {
                    ctx.dealDamage(
                        { type: "player", id: scopedPlayerId },
                        ids.length
                    );
                }
            },
        }),
        // CR 603.6a + CR 117.3a — the "pay" is an alternate cost (sacrifice two
        // Islands), not mana, so this composes `requestMayPay` (the yes/no gate)
        // with a `sacrifice-permanents` choice (the Mold Demon shape) rather
        // than `upkeepPayOrElse`.
        phaseTrigger({
            id: "psychic-allergy-own-upkeep",
            oracleText:
                "At the beginning of your upkeep, destroy this enchantment unless you sacrifice two Islands.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045, re-assessed): the `mayPay` Op's
            // `cost.sacrifice` leg (`MayPayCost.sacrifice`) DOES now express
            // "sacrifice two Islands" itself — `{ op: "mayPay", cost: {
            // sacrifice: { filter: { subtypes: "Island" }, count: 2 } } }` +
            // `if !$paid` for the destroy else-branch. The remaining blocker
            // is the SAME raise-time/skip mismatch documented on Yawgmoth
            // Demon (atq/black.ts): this card's imperative body checks
            // `islandIds.length < 2` BEFORE calling `requestMayPay`, so with
            // fewer than two Islands the may-pay prompt is never raised at
            // all and Psychic Allergy is destroyed immediately (see this
            // file's "no Islands to sacrifice" test — asserts no
            // suspension). The generic interpreter `mayPay` Op has no such
            // affordability pre-check — it unconditionally calls
            // `ctx.requestMayPay`, which unconditionally raises a
            // PendingChoice; `canPayMayPayCost` only gates at the SUBMIT
            // boundary. Migrating would introduce an unwanted
            // suspension/prompt in the too-few-Islands case, changing
            // observable behaviour under the existing per-card test
            // (forbidden — the test is the equivalence oracle and stays
            // untouched). Stays resolve().
            // Blocked on: a raise-time affordability gate for `mayPay` (same
            // gap as Yawgmoth Demon) — a genuine interpreter capability gap,
            // not a missing Op/value construct.
            resolve: (ctx) => {
                const controller = ctx.controller;
                const islandIds = ctx.getBattlefieldIds(controller, {
                    subtypes: "Island",
                });
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // Can't afford → the only legal outcome is to destroy Psychic
                // Allergy (CR 117.3a — an unpayable "unless" forces the
                // consequence). No prompt with no real choice.
                if (islandIds.length < 2) {
                    ctx.destroy(self);
                    return;
                }
                const accept = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: `psychic-allergy-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice two Islands to keep Psychic Allergy?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.destroy(self);
                    return;
                }
                const picked = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `psychic-allergy-${ctx.sourceInstanceId}-islands`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { subtypes: "Island" },
                    count: 2,
                    prompt: "Sacrifice two Islands.",
                });
                if (picked === undefined) return; // suspended
                if (picked.length < 2) {
                    ctx.destroy(self);
                    return;
                }
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
    ],
};

// Riptide — "Tap all blue creatures." (CR 701.26a — tap every blue creature on
// the battlefield, either controller; CR 202.2 colour.)
export const riptide: CardDefinition = {
    id: "b0f11ae4-e30e-441d-bb64-439930d9997c",
    rarity: "common",
    name: "Riptide",
    oracleText: "Tap all blue creatures.",
    manaCost: { U: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] (ADR 0045, PRD #795; re-assessed stale
    // marker — `EffectCardFilter.color` now propagates to a battlefield
    // `forEach`'s `PermanentFilter` via `toPermanentFilter`): tap every blue
    // creature, either controller (CR 701.20a).
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", color: "U" },
            },
            effects: [
                { op: "tapUntap", action: "tap", target: { ref: "$each" } },
            ],
        },
    ],
};

// Sunken City — "At the beginning of your upkeep, sacrifice this enchantment
// unless you pay {U}{U}.\nBlue creatures get +1/+1." (CR 603.6a + CR 117.3a
// upkeep maintenance cost; CR 611 layer 7c anthem filtered on blue, CR 202.2.)
export const sunkenCity: CardDefinition = {
    id: "f1e0f9ec-2b06-4bda-8b80-a716d82d1f13",
    rarity: "common",
    name: "Sunken City",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {U}{U}.\nBlue creatures get +1/+1.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("U"),
            power: 1,
            toughness: 1,
        },
    ],
    triggeredAbilities: [
        upkeepPayOrElse({
            id: "sunken-city-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {U}{U}.",
            cost: { U: 2 },
            prompt: "Pay {U}{U} or sacrifice Sunken City?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Water Wurm — "This creature gets +0/+1 as long as an opponent controls an
// Island." (CR 611 layer 7d conditional buff via a `pt-cda` whose `compute`
// reads the board — the Kird Ape pattern.)
export const waterWurm: CardDefinition = {
    id: "e3da4a88-5225-467f-9240-f30bc1eee520",
    rarity: "common",
    name: "Water Wurm",
    oracleText:
        "This creature gets +0/+1 as long as an opponent controls an Island.",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                const opponentHasIsland = state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            c.subtypes.includes("Island")
                    )
                );
                // CR 613.4 layer 7a: `pt-cda` contributes a DELTA on top of the
                // printed 1/1 base (effective = base + Σ pt-cda). The +0/+1 is
                // applied only while an opponent controls an Island.
                return opponentHasIsland
                    ? { power: 0, toughness: 1 }
                    : { power: 0, toughness: 0 };
            },
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════════
// BLUE C4 — Copy-as-token (Dance of Many, #421).
// ═════════════════════════════════════════════════════════════════════════════

// Dance of Many — "{U}{U} Enchantment. When this enchantment enters, create a
// token that's a copy of target nontoken creature. When this enchantment leaves
// the battlefield, exile the token. When the token leaves the battlefield,
// sacrifice this enchantment. At the beginning of your upkeep, sacrifice this
// enchantment unless you pay {U}{U}." (Modern Scryfall oracle, ADR 0004.)
//
// Implementation (CR 707.2 copy + CR 603.10 leave-linkage + CR 603.6a upkeep):
//
//   • ETB trigger (`enteredTrigger` scope:self) — "create a token that's a copy
//     of target nontoken creature". Per CR 603.3d the target is chosen when the
//     trigger is PUT ON THE STACK, so it is declared as a `targetRequirement`
//     (issue #1193 machinery, `raiseTriggerTargetSelection` in gre/rules.ts) and
//     the resolve reads the locked slot via `ctx.targets[0]` — NOT a
//     resolution-time `requestChoice`. This makes the copy target subject to
//     hexproof / protection / ward and fires "becomes the target" triggers, which
//     the old choice-as-target workaround silently skipped. `createTokenCopyOf`
//     is the token-recipient form of the clone path: it makes a fresh token and
//     runs `applyCopy` on it (the SAME `applyCopy` `becomeCopyOf` uses; CR 707.2
//     copies copiable values only), stamping `createdBy` so the enchantment can
//     find its token, and storing the reverse `linkedTokenId` on the enchantment
//     so it can identify the token after it leaves play.
//     FIXED (issue #1195): the oracle restricts the target to a NONTOKEN
//     creature (CR 111.5); `TargetRequirement.isToken` (added by #1195,
//     Satya, Aetherflux Genius's identical "nontoken creature" clause) closes
//     this — `isToken: false` on the requirement below, wired through the
//     single target-filter authority (`gre/targetFilters.ts`, ADR 0068) so a
//     token creature is now correctly ILLEGAL as a copy target, both
//     offered (`getLegalTargets`) and accepted (`selectTarget`). Previously a
//     documented DIVERGENCE ("TargetRequirement has no token filter field").
//
//   • Enchantment-leaves → exile token (`leftTrigger` scope:self) — the token
//     is still on the battlefield at this point, so it is located by
//     `createdBy` provenance and exiled (CR 603.10). A token in any zone but
//     the battlefield ceases to exist (CR 111.7 SBA), so exile is permanent.
//
//   • Token-leaves → sacrifice enchantment (`leftTrigger` scope:any with a
//     `linkedTokenId` condition) — the leaving permanent's id is matched
//     against the enchantment's stored `linkedTokenId` (the `PermanentLeftEvent`
//     does not carry `createdBy`, and the token has already left), then the
//     enchantment is sacrificed (CR 701.21).
//
//   • Upkeep {U}{U}-or-sacrifice — REUSES the shipped LEG C7
//     `payOrSacrificeUpkeepTrigger` (the Elder Dragon maintenance-cost family);
//     not reimplemented (CR 603.6a + CR 117.3a).
//
// The two leave triggers are mutual no-ops on the second hop: when the
// enchantment leaves it exiles the token, whose departure tries to sacrifice
// the already-gone enchantment (silent no-op, CR 608.2b); and vice versa.
export const danceOfMany: CardDefinition = {
    id: "13453abe-3f05-4956-8493-382d7d2af699",
    rarity: "rare",
    name: "Dance of Many",
    oracleText:
        "When this enchantment enters, create a token that's a copy of target nontoken creature.\nWhen this enchantment leaves the battlefield, exile the token.\nWhen the token leaves the battlefield, sacrifice this enchantment.\nAt the beginning of your upkeep, sacrifice this enchantment unless you pay {U}{U}.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    // Bot-only cast prune (#938): its ETB makes a token copy of a nontoken
    // creature — a wasted cast (creates nothing, then self-sacrifices on the
    // upkeep clock) when no nontoken creature is in play.
    copySourceFilter: { types: "Creature", isToken: false },
    triggeredAbilities: [
        enteredTrigger({
            id: "dance-of-many-etb",
            oracleText:
                "When this enchantment enters, create a token that's a copy of target nontoken creature.",
            scope: "self",
            // CR 603.3d (issue #1193) — "target nontoken creature" is a REAL
            // target chosen when the trigger is put on the stack, declared as a
            // `targetRequirement` and locked by `raiseTriggerTargetSelection`
            // (gre/rules.ts), NOT a resolution-time `requestChoice`. `isToken:
            // false` (issue #1195) is the "nontoken" clause — see the FIXED
            // note above.
            targetRequirement: { type: "Creature", count: 1, isToken: false },
            // DSL-migrated (ADR 0045, issue #1459): "create a token that's a
            // copy of target nontoken creature" is now a single `createTokenCopy`
            // Op (CR 707.2). `source: { target: 0 }` reads the announced target
            // locked at stack placement (CR 603.3d); the Op drives the SAME
            // `createTokenCopyOf` → `applyCopy` copy path this card used
            // imperatively, stamping the resolving source's `createdBy`
            // provenance (this enchantment) so the leave-linkage triggers below
            // can find their token. A gone target creates no token (CR 608.2b —
            // the Op skips on an unresolvable source). The two leave triggers +
            // upkeep tax below still need `createdBy`-scoped scans / an upkeep
            // cost, so they stay resolve() (see their own notes).
            effects: [
                {
                    op: "createTokenCopy",
                    source: { target: 0 },
                    controller: "controller",
                },
            ],
        }),
        leftTrigger({
            id: "dance-of-many-exile-token",
            oracleText:
                "When this enchantment leaves the battlefield, exile the token.",
            scope: "self",
            // NOT DSL-migratable (ADR 0045): iterates EVERY player's
            // battlefield for permanents whose `createdBy` equals the
            // leaving enchantment's id (`leaving.id`, always `$source` at
            // this scope:"self" site) and exiles each. `EffectCardFilter`
            // (the forEach `permanents` selector's filter shape) has no
            // `createdBy` field — `PermanentFilter` (the engine-level type)
            // does, but `toPermanentFilter` doesn't expose it, so a
            // provenance-scoped forEach can't be expressed. Stays resolve().
            // Blocked on: a `createdBy` member on `EffectCardFilter` (with
            // ref support, since the id is a runtime `$source`, not a
            // literal) — a genuine Op-vocabulary gap. Worth an issue if more
            // token-provenance cards need it.
            resolve: (ctx: SpellContext, _event, leaving) => {
                // CR 603.10 — the token (still on the battlefield) is found by
                // its `createdBy` provenance link to this enchantment.
                for (const pid of ctx.allPlayerIds) {
                    const tokens = ctx.getBattlefieldIds(pid, {
                        createdBy: leaving.id,
                    });
                    for (const tokenId of tokens) {
                        ctx.exile({ type: "permanent", id: tokenId });
                    }
                }
            },
        }),
        leftTrigger({
            id: "dance-of-many-sacrifice-self",
            oracleText:
                "When the token leaves the battlefield, sacrifice this enchantment.",
            scope: "any",
            // CR 603.10 — fire only for THIS enchantment's token. The token has
            // already left, so it is identified by the `linkedTokenId` stored
            // on the enchantment when the token was created.
            condition: (event, self) =>
                self.linkedTokenId !== undefined &&
                event.instanceId === self.linkedTokenId,
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): sacrifice
            // the implicit $source (CR 701.21); `condition` (unchanged)
            // still gates the firing to this enchantment's own token.
            effects: [{ op: "sacrifice", target: { ref: "$source" } }],
        }),
        payOrSacrificeUpkeepTrigger({
            id: "dance-of-many-upkeep",
            cardName: "Dance of Many",
            cost: { U: 2 },
            costText: "{U}{U}",
        }),
    ],
};

// Deep Water — "{U}: Until end of turn, if you tap a land you control for mana,
// it produces {U} instead of any other type." (CR 605 activated ability that
// resolves on the stack; CR 614 self-replacement of the mana TYPE — the same
// total quantity is produced, only the colour becomes {U}. The replacement is a
// per-turn, controller-scoped flag (`replaceLandManaWithBlue`) consumed by the
// engine's single `applyLandManaReplacement` mana funnel; expires at CLEANUP,
// CR 514.2.)
export const deepWater: CardDefinition = {
    id: "9dd6a230-6bc0-499c-b7fd-4aaa2569f98f",
    rarity: "common",
    name: "Deep Water",
    oracleText:
        "{U}: Until end of turn, if you tap a land you control for mana, it produces {U} instead of any other type.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "deep-water-replace",
            oracleText:
                "{U}: Until end of turn, if you tap a land you control for mana, it produces {U} instead of any other type.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 614 — arm the controller's land-mana → {U} replacement for
                // the rest of the turn.
                ctx.replaceLandManaWithBlue(ctx.controller);
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Free tranche — Multicolor (#416). Six gold / off-color-activation cards from
// The Dark. Each is pure CardDefinition data over already-shipped primitives
// (landwalk statics, regeneration shields, temporary P/T buffs, temporary
// keyword grants, mana abilities, ETB triggers, filtered-sacrifice costs).
// Note: in The Dark a card is "multicolor" by its activation-cost colors, not
// by its color identity (e.g. Drowned/Electric Eel/Elves are mono-colored but
// activate with off-color mana). Modern Scryfall oracle text (ADR 0004).
// ─────────────────────────────────────────────────────────────────────────────

// Drowned — {1}{U} 1/1 Zombie, "{B}: Regenerate this creature." (CR 605
// activated ability; CR 701.19a regenerate via a shield consumed by the next
// destroy/lethal-damage event.)
export const drowned: CardDefinition = {
    id: "951b6c10-cbba-44b6-aae2-2c386b7ebacb",
    rarity: "common",
    name: "Drowned",
    oracleText: "{B}: Regenerate this creature.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "drowned-regenerate",
            oracleText: "{B}: Regenerate this creature.",
            cost: { mana: { B: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.19a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Electric Eel — {U} 1/1 Fish. "When this creature enters, it deals 1 damage to
// you.\n{R}{R}: This creature gets +2/+0 until end of turn and deals 1 damage to
// you." (CR 603.6a ETB self-trigger dealing damage to controller; CR 605
// activated pump with a CR 611.1 end-of-turn P/T buff plus self-inflicted
// damage. The two clauses of the activated ability resolve together, CR 608.)
export const electricEel: CardDefinition = {
    id: "b8834c18-0e4e-4785-9d15-b33345e3789b",
    rarity: "uncommon",
    name: "Electric Eel",
    oracleText:
        "When this creature enters, it deals 1 damage to you.\n{R}{R}: This creature gets +2/+0 until end of turn and deals 1 damage to you.",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Fish"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "electric-eel-etb-damage",
            oracleText: "When this creature enters, it deals 1 damage to you.",
            scope: "self",
            // Migrated resolve()→effects[] (ADR 0045, PRD #795; re-assessed
            // stale marker — `enteredTrigger` now accepts `effects[]` and is
            // safe for every scope, since an ETB ability's controller is
            // always the source's controller): 1 damage to the controller
            // (CR 119.3).
            effects: [
                { op: "dealDamage", amount: 1, to: { player: "controller" } },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "electric-eel-pump",
            oracleText:
                "{R}{R}: This creature gets +2/+0 until end of turn and deals 1 damage to you.",
            cost: { mana: { R: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +2/+0 EOT on
            // the resolving source (CR 613.4c) via the pump Op, then 1 damage to
            // the controller (CR 119.3). Both clauses resolve together (CR 608).
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
                { op: "dealDamage", amount: 1, to: { player: "controller" } },
            ],
        },
    ],
};
