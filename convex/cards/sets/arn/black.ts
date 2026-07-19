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
import { DAMAGEABLE_PERMANENT_TYPES } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

export const stoneThrowingDevils: CardDefinition = {
    id: "d1c387dd-1347-4443-91ce-b71f7ccdceba",
    rarity: "common",
    name: "Stone-Throwing Devils",
    oracleText: "First strike",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Devil"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike"],
};

export const juzamDjinn: CardDefinition = {
    id: "31bf3f14-b5df-498b-a1bb-965885c82401",
    rarity: "rare",
    name: "Juzám Djinn",
    oracleText:
        "At the beginning of your upkeep, Juzám Djinn deals 1 damage to you.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 5,
    triggeredAbilities: [
        phaseTrigger({
            id: "juzam-djinn-upkeep",
            oracleText:
                "At the beginning of your upkeep, Juzám Djinn deals 1 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                { op: "dealDamage", amount: 1, to: { player: "controller" } },
            ],
        }),
    ],
};

export const jununEfreet: CardDefinition = {
    id: "5f46783a-b91e-4829-a173-5515b09ca615",
    rarity: "rare",
    name: "Junún Efreet",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice Junún Efreet unless you pay {B}{B}.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Efreet"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        phaseTrigger({
            id: "junun-efreet-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice Junún Efreet unless you pay {B}{B}.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): the `sacrifice` Op only sacrifices
            // permanents a `choice` Op picked (a picks ref) — there is no
            // sacrifice-the-source form for the "sacrifice Junún Efreet" clause.
            // Planned-migratable pending a self/source sacrifice Op.
            resolve: (ctx, _event, scopedPlayerId) => {
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `junun-efreet-${ctx.sourceInstanceId}`,
                    cost: { B: 2 },
                    prompt: "Pay {B}{B} or sacrifice Junún Efreet?",
                });
                if (paid === undefined) return; // suspended
                if (!paid) ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

export const hasranOgress: CardDefinition = {
    id: "9f310cf5-0985-4826-9779-19a713089d6d",
    rarity: "common",
    name: "Hasran Ogress",
    oracleText:
        "Whenever Hasran Ogress attacks, it deals 3 damage to you unless you pay {2}.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Ogre"],
    power: 3,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "hasran-ogress-attack",
            oracleText:
                "Whenever Hasran Ogress attacks, it deals 3 damage to you unless you pay {2}.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                {
                    // CR 117.3a — the controller ("you") decides whether to pay.
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 2 },
                    prompt: "Pay {2} or Hasran Ogress deals 3 damage to you?",
                    bind: "$paid",
                },
                {
                    // CR 120 — unless paid, Hasran Ogress deals 3 damage to you.
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [
                        {
                            op: "dealDamage",
                            amount: 3,
                            to: { player: "controller" },
                        },
                    ],
                },
            ],
        },
    ],
};

export const elHajjaj: CardDefinition = {
    id: "c4b610d3-2005-4347-bcda-c30b5b7972e5",
    rarity: "rare",
    name: "El-Hajjâj",
    oracleText: "Whenever El-Hajjâj deals damage, you gain that much life.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        damageDealtTrigger({
            id: "el-hajjaj-lifegain",
            oracleText:
                "Whenever El-Hajjâj deals damage, you gain that much life.",
            source: "self",
            // NOT DSL-migratable (ADR 0045): the gained amount is event.amount
            // (the damage just dealt), a runtime value with no EffectValue
            // construct (literal / ref / count only); damageDealtTrigger also has
            // no effects[] passthrough. Planned-migratable pending a
            // triggering-event value ref.
            resolve: (ctx, event) => {
                ctx.gainLife(ctx.controller, event.amount);
            },
        }),
    ],
};

export const khabalGhoul: CardDefinition = {
    id: "18607bf6-ce11-41cb-b001-0c9538406ba0",
    rarity: "uncommon",
    name: "Khabál Ghoul",
    oracleText:
        "At the beginning of each end step, put a +1/+1 counter on Khabál Ghoul for each creature that died this turn.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        phaseTrigger({
            id: "khabal-ghoul-end-step",
            oracleText:
                "At the beginning of each end step, put a +1/+1 counter on Khabál Ghoul for each creature that died this turn.",
            phase: "END_STEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045): planned-migratable, blocked on a
            // value construct. The counter count is "for each creature that
            // died this turn" (`getDeathsThisTurn`), a running game tally the
            // `count` grammar (battlefield/graveyard card sets only) cannot
            // express. Stays resolve() until a deaths-this-turn value member
            // exists.
            resolve: (ctx) => {
                const deaths = ctx.getDeathsThisTurn();
                if (deaths > 0) {
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "+1/+1",
                        deaths
                    );
                }
            },
        }),
    ],
};

// Erg Raiders — end-step self-damage unless it attacked, with a
// "came under your control this turn" exemption (CR 603.4 intervening-if for
// the attack clause + CR 603.3e trigger gate for the control-change clause).
// Reuses the existing `phaseTrigger` factory (END_STEP, scope "your") and the
// `dealDamage` primitive (cf. Juzám Djinn upkeep self-damage). The exemption
// reads `self.isSummoningSick`: that flag is set when a creature enters or
// changes controller and is cleared at its controller's untap step, so it is
// true for exactly the turn the creature came under your control.
export const ergRaiders: CardDefinition = {
    id: "35c73a97-531d-4dd5-8236-39b89c183c38",
    rarity: "common",
    name: "Erg Raiders",
    oracleText:
        "At the beginning of your end step, if Erg Raiders didn't attack this turn, Erg Raiders deals 2 damage to you. This ability doesn't trigger if Erg Raiders came under your control this turn.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Warrior"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        phaseTrigger({
            id: "erg-raiders-end-step",
            oracleText:
                "At the beginning of your end step, if Erg Raiders didn't attack this turn, Erg Raiders deals 2 damage to you. This ability doesn't trigger if Erg Raiders came under your control this turn.",
            phase: "END_STEP",
            scope: "your",
            // CR 603.3e — the ability does not even trigger the turn Erg
            // Raiders came under your control (summoning-sick this turn).
            condition: (_event, self) => self.isSummoningSick !== true,
            // CR 603.4 intervening-if — "if it didn't attack this turn".
            // Re-checked at resolve; `hasAttackedThisTurn` persists to CLEANUP.
            interveningIf: (_event, self) => self.hasAttackedThisTurn !== true,
            effects: [
                { op: "dealDamage", amount: 2, to: { player: "controller" } },
            ],
        }),
    ],
};

export const sorceressQueen: CardDefinition = {
    id: "94742003-f0f1-4483-b1a0-e7163995db1b",
    rarity: "uncommon",
    name: "Sorceress Queen",
    oracleText:
        "{T}: Target creature other than Sorceress Queen has base power and toughness 0/2 until end of turn.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "sorceress-queen-set",
            oracleText:
                "{T}: Target creature other than Sorceress Queen has base power and toughness 0/2 until end of turn.",
            cost: { tap: true },
            useStack: true,
            // Static fallback; the dynamic form excludes the source itself
            // ("a creature other than Sorceress Queen").
            targetRequirement: { type: "Creature", count: 1 },
            getTargetRequirement: (source) => ({
                type: "Creature",
                count: 1,
                excludeInstanceIds: [source.id],
            }),
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.setBasePT(target, 0, 2, { phase: "end-of-turn" });
                }
            },
        },
    ],
};

// Oubliette — modern Oracle uses phasing, not exile (ADR 0004). The ETB
// trigger phases a chosen creature (with its Auras/Equipment) out of existence
// until Oubliette leaves; `removePermanentTo`'s source-leaves hook phases it
// back in tapped.
//
// TARGETING (CR 603.3d, issue #1193): "target creature" is a REAL target
// chosen when the ETB trigger is put on the stack — declared as a
// `targetRequirement` on the TriggeredAbility (`raiseTriggerTargetSelection`
// in gre/rules.ts), NOT a resolution-time `requestChoice`. That makes it
// subject to hexproof / protection / ward and fires "becomes the target of an
// ability" triggers, which the old choice-as-target workaround silently
// skipped. The resolve() reads the announced target via `ctx.targets[0]` and
// keeps the phase-out (with Auras/Equipment) + source-leaves return legs.
export const oubliette: CardDefinition = {
    id: "30d1450f-2909-410e-9920-731278fa74de",
    rarity: "common",
    name: "Oubliette",
    oracleText:
        "When this enchantment enters, target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way. (Auras and Equipment phase out with it. While permanents are phased out, they're treated as though they don't exist.)",
    manaCost: { X: 1, B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "oubliette-phase-out",
            oracleText:
                "When this enchantment enters, target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way.",
            scope: "self",
            // CR 603.3d — "target creature" chosen when the trigger goes on the
            // stack (subject to hexproof / protection / ward), not a
            // resolution-time choice. The engine locks the target via
            // `raiseTriggerTargetSelection`; resolve reads `ctx.targets[0]`.
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return; // CR 608.2b — target left
                ctx.phaseOut(target.id, {
                    returnOn: {
                        kind: "source-leaves",
                        sourceId: ctx.sourceInstanceId,
                    },
                    onPhaseIn: { tap: true },
                });
            },
        }),
    ],
};

// Cuombajj Witches — "{T}: This creature deals 1 damage to any target and 1
// damage to any target of an opponent's choice." (modern oracle, ADR 0004).
//
// Two pings (CR 115.4 "any target" = creature / planeswalker / battle / player).
// The controller chooses the FIRST target at activation (the ability's normal
// `targetRequirement`, CR 602.2b). The SECOND target is "of an opponent's
// choice" (CR 601.2c / 608.2) — chosen DURING resolution by an opponent via a
// `choose-damage-target` mid-resolution choice (twin of Demonic Hordes' opponent
// pick, but over "any target" rather than a battlefield zone, so the candidate
// set spans damageable permanents AND players). The original printed text
// ("damage is inflicted simultaneously") is simplified: our engine applies the
// two pings sequentially within the single resolve step. With 1 damage each and
// no replacement interaction between the two, the observable outcome is
// identical, so the simplification is safe.
export const cuombajjWitches: CardDefinition = {
    id: "7995c3f9-a147-43c9-9f82-470924818a4c",
    rarity: "common",
    name: "Cuombajj Witches",
    oracleText:
        "{T}: This creature deals 1 damage to any target and 1 damage to any target of an opponent's choice.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "cuombajj-witches-pings",
            oracleText:
                "{T}: This creature deals 1 damage to any target and 1 damage to any target of an opponent's choice.",
            cost: { tap: true },
            useStack: true,
            // Controller's target (CR 602.2b — chosen at activation).
            targetRequirement: { type: "any", count: 1 },
            // NOT DSL-migratable (ADR 0045): the second ping is an opponent's
            // mid-resolution `choose-damage-target` pick over "any target"
            // (players + damageable permanents), a Pending Choice kind outside
            // the scriptable EffectChoiceKind subset, plus id-disambiguation of
            // the pick. Protocol-shaped; stays resolve().
            resolve: (ctx) => {
                // The opponent's choice (CR 601.2c) suspends and resumes the
                // resolve step: on suspend `requestChoice` returns undefined,
                // on resume the WHOLE body re-runs with the stored answer. So
                // request the opponent's target FIRST and apply BOTH pings only
                // after it resolves — otherwise ping 1 would be dealt twice
                // (once before the suspend, once on resume). With no opponent
                // (solo edge) or no legal second target, ping 1 still happens.
                const own = ctx.targets[0];

                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                const permanentCandidates = ctx.allPlayerIds.flatMap((pid) =>
                    ctx.getBattlefieldIds(pid, {
                        types: [...DAMAGEABLE_PERMANENT_TYPES],
                    })
                );
                const playerCandidates = [...ctx.allPlayerIds];

                // Only request the opponent's choice when there IS an opponent
                // and at least one legal target. Otherwise skip straight to the
                // controller's ping.
                let opponentTarget: TargetSelection | undefined;
                if (
                    opponentId &&
                    (permanentCandidates.length > 0 ||
                        playerCandidates.length > 0)
                ) {
                    const picked = ctx.requestChoice({
                        playerId: opponentId,
                        choiceId: `cuombajj-${ctx.sourceInstanceId}`,
                        kind: "choose-damage-target",
                        zone: "battlefield",
                        // CR 115.4 — every battlefield is a legal source of
                        // damageable permanents, so the chooser picks from all
                        // of them (the `filter` gates to the damageable types).
                        allControllers: true,
                        filter: { types: [...DAMAGEABLE_PERMANENT_TYPES] },
                        candidateIds: permanentCandidates,
                        candidatePlayerIds: playerCandidates,
                        count: 1,
                        prompt: "Cuombajj Witches: choose any target for 1 damage (opponent's choice).",
                    });
                    if (picked === undefined) return; // suspend: awaiting pick
                    const id = picked[0];
                    if (id) {
                        // Disambiguate the chosen id: a player id targets the
                        // player, otherwise a damageable permanent.
                        opponentTarget = playerCandidates.includes(id)
                            ? { type: "player", id }
                            : { type: "permanent", id };
                    }
                }

                // Both pings land now (CR 115.4 — original "simultaneously"
                // simplified to sequential; identical observable outcome for
                // 1 damage each).
                if (own) ctx.dealDamage(own, 1);
                if (opponentTarget) ctx.dealDamage(opponentTarget, 1);
            },
        },
    ],
};

// Guardian Beast — "As long as Guardian Beast is untapped, noncreature
// artifacts you control can't be enchanted, can't be the targets of spells or
// abilities, have indestructible, and their control can't be changed. This
// ability doesn't remove Auras already attached." (modern oracle, ADR 0004).
//
// A single continuous protection bundle (`permanent-guard`, CR 611), evaluated
// LIVE at four gates — targeting (CR 702.16b-style), enchant (CR 303.4),
// destroy (CR 702.12), and control change (CR 613.1b). It is NOT a
// `keyword-grant`: that machinery applies/reverts on the source's
// enter/leave-the-battlefield only, so a granted keyword would go stale on a
// tap/untap transition. The `applies` predicate reads `source.isTapped` live,
// so the four protections switch off the instant Guardian Beast taps and back
// on when it untaps — correct by construction with no re-apply hook.
//
// Scope: noncreature ARTIFACTS the same controller controls (a creature that is
// also an artifact is excluded by the `!isCreature` clause). "Doesn't remove
// Auras already attached" is automatic — the enchant gate only blocks NEW
// attachment; auras already on a guarded artifact are untouched.
//
// Simplification (flagged): the printed "if something would destroy Guardian
// Beast and your artifacts simultaneously, only Guardian Beast is destroyed"
// rider is handled implicitly — our engine resolves "destroy" effects
// sequentially and the indestructible guard is read at each destroy, so a mass
// destroy that hits Guardian Beast and a guarded artifact spares the artifact
// as long as Guardian Beast has not yet left when the artifact's destroy is
// processed. Strict CR 616 simultaneous-replacement ordering is out of scope.
export const guardianBeast: CardDefinition = {
    id: "9941f83b-2903-4eab-ac6d-5313e3978fa3",
    rarity: "rare",
    name: "Guardian Beast",
    oracleText:
        "As long as Guardian Beast is untapped, noncreature artifacts you control can't be enchanted, can't be the targets of spells or abilities, have indestructible, and their control can't be changed. This ability doesn't remove Auras already attached.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 2,
    toughness: 4,
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "guardian-beast-protection",
            applies: (target, source, ctx) =>
                !source.isTapped &&
                target.controllerId === source.controllerId &&
                target.types.includes("Artifact") &&
                !ctx.isCreature(target),
            cantBeTargeted: true,
            cantBeEnchanted: true,
            indestructible: true,
            controlCantChange: true,
        },
    ],
};
