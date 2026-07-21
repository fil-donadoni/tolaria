// Arabian Nights (ARN), split by colour per ADR 0043. The first MTG
// expansion (78 unique cards); every entry is a CardDefinition — ARN has no
// LEA reprints, so there are no CardPrint stubs (ADR 0014). Modern Scryfall
// oracle text is authoritative (ADR 0004). Generic mana is encoded as
// `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour
// identity of their mana cost (CR 202.2); lands and artifacts (no coloured
// cost) live in colorless.ts.

import type {
    CardDefinition,
    PermanentView,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

/** Local builder for the "when you control no <X>, sacrifice this" shape
 *  shared by Serendib Djinn, Dandân and Island Fish Jasconius (CR 603.8).
 *  Mirrors `stateTrigger()`'s CR 603.8 wiring (STATE_CHECK narrowing +
 *  `interveningIf` re-check baked from the same `condition`) but plugs the
 *  effect into the `effects[]` dispatch seam (ADR 0045) instead of
 *  `resolve` — `stateTrigger()` itself only exposes `resolve` today, so a
 *  file-scoped migration reproduces its exact event wiring here rather than
 *  widening the shared factory. `{ op: "sacrifice", target: { ref: "$source" } }`
 *  is the registered `sacrifice` Op (`EFFECT_OP_REGISTRY`) applied to the
 *  triggered ability's own source, which the interpreter binds as `$source`
 *  for every effects[] ability regardless of which factory built it. */
function sacrificeSelfWhen(args: {
    id: string;
    oracleText: string;
    condition: (self: PermanentView, state: TriggerStateView) => boolean;
}): TriggeredAbility {
    const { id, oracleText, condition } = args;
    return {
        id,
        oracleText,
        event: "STATE_CHECK",
        matches: (event, self, state) => {
            if (event.type !== "STATE_CHECK") return false;
            if (!state) return false;
            return condition(self, state);
        },
        interveningIf: (_event, self, state) => {
            if (!state) return false;
            return condition(self, state);
        },
        effects: [{ op: "sacrifice", target: { ref: "$source" } }],
    };
}

export const flyingMen: CardDefinition = {
    id: "25ab9a2b-e248-4ae2-aac3-b49fdb3e260a",
    rarity: "common",
    name: "Flying Men",
    oracleText: "Flying",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
};

export const serendibEfreet: CardDefinition = {
    id: "cf56e862-3169-4f63-acd0-731080fa32f2",
    rarity: "rare",
    name: "Serendib Efreet",
    oracleText:
        "Flying\nAt the beginning of your upkeep, Serendib Efreet deals 1 damage to you.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Efreet"],
    power: 3,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        phaseTrigger({
            id: "serendib-efreet-upkeep",
            oracleText:
                "At the beginning of your upkeep, Serendib Efreet deals 1 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                { op: "dealDamage", amount: 1, to: { player: "controller" } },
            ],
        }),
    ],
};

export const serendibDjinn: CardDefinition = {
    id: "0458b733-d689-4cb5-8970-3b675c67fc4d",
    rarity: "rare",
    name: "Serendib Djinn",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice a land. If you sacrifice an Island this way, Serendib Djinn deals 3 damage to you.\nWhen you control no lands, sacrifice Serendib Djinn.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        phaseTrigger({
            id: "serendib-djinn-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice a land. If you sacrifice an Island this way, Serendib Djinn deals 3 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): "if you sacrifice an Island this way,
            // deal 3" needs an `if` predicate on the sacrificed permanent's
            // subtype (no subtype/binding predicate form), and the sacrifice
            // targets a chosen land — expressible — but the conditional-damage
            // clause is not. Stays resolve().
            resolve: (ctx, _event, scopedPlayerId) => {
                const lands = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Land",
                });
                if (lands.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: `serendib-djinn-${ctx.sourceInstanceId}`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    zoneOwnerId: scopedPlayerId,
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Serendib Djinn: choose a land to sacrifice.",
                });
                if (picks === undefined) return; // suspended
                const sacrificedId = picks[0];
                if (!sacrificedId) return;
                const wasIsland = ctx.hasSubtype(
                    { type: "permanent", id: sacrificedId },
                    "Island"
                );
                ctx.sacrifice(sacrificedId);
                if (wasIsland) {
                    ctx.dealDamage({ type: "player", id: scopedPlayerId }, 3);
                }
            },
        }),
        sacrificeSelfWhen({
            id: "serendib-djinn-no-lands",
            oracleText: "When you control no lands, sacrifice Serendib Djinn.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.types.includes("Land")
                );
            },
        }),
    ],
};

export const dandan: CardDefinition = {
    id: "414d3cae-b8cf-4d53-bd6b-1aa83a828ba9",
    rarity: "common",
    name: "Dandân",
    oracleText:
        "Dandân can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice Dandân.",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Fish"],
    power: 4,
    toughness: 1,
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "dandan-island-restriction",
            oracleText:
                "Dandân can't attack unless defending player controls an Island.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
        },
    ],
    triggeredAbilities: [
        sacrificeSelfWhen({
            id: "dandan-no-islands",
            oracleText: "When you control no Islands, sacrifice Dandân.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
        }),
    ],
};

export const islandFishJasconius: CardDefinition = {
    id: "8537cb0f-4821-417b-80cc-ea57d51ee9b8",
    rarity: "rare",
    name: "Island Fish Jasconius",
    oracleText:
        "Island Fish Jasconius doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {U}{U}{U}. If you do, untap Island Fish Jasconius.\nIsland Fish Jasconius can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice Island Fish Jasconius.",
    manaCost: { X: 4, U: 3 },
    types: ["Creature"],
    subtypes: ["Fish"],
    power: 6,
    toughness: 8,
    // `does-not-untap` keyword (read by `untapStep` in phases.ts) skips the
    // untap step for this permanent only — cleaner than a filtered
    // untap-restriction, which is for global "players skip untap" effects.
    staticAbilities: ["does-not-untap"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "island-fish-island-restriction",
            oracleText:
                "Island Fish Jasconius can't attack unless defending player controls an Island.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "island-fish-untap-option",
            oracleText:
                "At the beginning of your upkeep, you may pay {U}{U}{U}. If you do, untap Island Fish Jasconius.",
            phase: "UPKEEP",
            scope: "your",
            // Migrated resolve()→effects[] (ADR 0045, #842): may pay {U}{U}{U};
            // if paid, untap the source (CR 117.3a, 701.26b). A `your`-scoped
            // phaseTrigger so the scoped player == controller.
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { U: 3 },
                    prompt: "Pay {U}{U}{U} to untap Island Fish Jasconius?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$source" },
                        },
                    ],
                },
            ],
        }),
        sacrificeSelfWhen({
            id: "island-fish-no-islands",
            oracleText:
                "When you control no Islands, sacrifice Island Fish Jasconius.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
        }),
    ],
};

export const giantTortoise: CardDefinition = {
    id: "096f7ac8-c639-4347-9767-7305eaf490ba",
    rarity: "common",
    name: "Giant Tortoise",
    oracleText: "Giant Tortoise gets +0/+3 as long as it's untapped.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Turtle"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) =>
                target.id === source.id && !target.isTapped,
            power: 0,
            toughness: 3,
        },
    ],
};

export const fishliverOil: CardDefinition = {
    id: "deb6ed87-aa07-4b5e-ac40-1e16dc2a817a",
    rarity: "common",
    name: "Fishliver Oil",
    oracleText: "Enchant creature\nEnchanted creature has islandwalk.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) => target.id === source.attachedTo,
            keyword: "islandwalk",
        },
    ],
};

export const unstableMutation: CardDefinition = {
    id: "a79e9236-a39e-471a-b18a-2c2ba16e7774",
    rarity: "common",
    name: "Unstable Mutation",
    oracleText:
        "Enchant creature\nEnchanted creature gets +3/+3.\nAt the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 3,
            toughness: 3,
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "unstable-mutation-decay",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature.",
            phase: "UPKEEP",
            scope: "host-controller",
            // NOT DSL-migratable (ADR 0045): the counter target is the ENCHANTED
            // creature (`getAttachedToId`), and no `EffectObjectSelector`
            // names an Aura's attached object (only announced slots, `$source`,
            // `$each`). The phaseTrigger `effects[]` site is also restricted to
            // `scope: "your"`; this is `host-controller`. Stays resolve() until
            // an attached-object selector exists.
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (hostId) {
                    ctx.addCounter(
                        { type: "permanent", id: hostId },
                        "-1/-1",
                        1
                    );
                }
            },
        }),
    ],
};

// Old Man of the Sea — control change conditioned on "remains tapped and the
// target's power stays <= this creature's power". The "may choose not to
// untap" clause is not yet modelled (no optional-untap choice mechanism); Old
// Man therefore untaps normally and the SBA reverts control at the controller's
// next upkeep. Tracked as a follow-up.
export const oldManOfTheSea: CardDefinition = {
    id: "d10f8a05-78b0-42a7-adcd-83f6bafe5417",
    rarity: "rare",
    name: "Old Man of the Sea",
    oracleText:
        "You may choose not to untap this creature during your untap step.\n{T}: Gain control of target creature with power less than or equal to this creature's power for as long as this creature remains tapped and that creature's power remains less than or equal to this creature's power.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "old-man-of-the-sea-steal",
            oracleText:
                "{T}: Gain control of target creature with power less than or equal to this creature's power for as long as this creature remains tapped and that creature's power remains less than or equal to this creature's power.",
            cost: { tap: true },
            useStack: true,
            // Static fallback caps at the printed power; the dynamic form reads
            // the source's current power at activation.
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 2 },
            },
            getTargetRequirement: (source) => ({
                type: "Creature",
                count: 1,
                powerFilter: { max: source.power ?? 0 },
            }),
            // Migrated resolve()→effects[] (ADR 0045, #848): gain control of the
            // targeted creature "for as long as this creature remains tapped and
            // that creature's power remains ≤ this creature's power" (CR 613.1b
            // layer-2 control change; CR 611.2b conditional-control revert).
            effects: [
                {
                    op: "gainControl",
                    target: { target: 0 },
                    controller: "controller",
                    duration: "while-source-tapped-and-power-ge",
                },
            ],
        },
    ],
};
