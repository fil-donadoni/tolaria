// Antiquities (ATQ) — the game's first artifact-centric expansion, split by
// colour per ADR 0043. Every entry is a new CardDefinition (ATQ has no
// reprints of already-implemented cards, so there are no CardPrint stubs).
// Modern Scryfall oracle text is authoritative (ADR 0004); the canonical
// card list, mana costs, and types are sourced from MTGJSON `ATQ.json`.
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`. Cards are classified by the colour identity of their mana
// cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type { CardDefinition, PermanentView, SpellContext } from "../../types";
import { makeCircleOfProtection } from "../../abilities";

// Argivian Archaeologist — {1}{W}{W} Creature — Human Artificer, 1/1 (NOT an
// artifact creature — a mundane archaeologist who works with artifacts) with
// "{W}{W}, {T}: Return target artifact card from your graveyard to your
// hand." (CR 605 activated ability; CR 400.7 zone change). The repeatable
// engine version of Reconstruction. Same graveyard-zone target filter; the
// {W}{W} + tap cost is paid at activation and the move resolves from the stack
// (useStack: true). MTGJSON ATQ.json: casting cost {1}{W}{W}, types
// ["Creature"], 1/1 — the "Artifact" type and 1/2 toughness above were both
// wrong, caught by the widened data/json conformance guard.
export const argivianArchaeologist: CardDefinition = {
    id: "ce83a3cb-467d-44f6-a051-4855c8cf52a6",
    rarity: "rare",
    name: "Argivian Archaeologist",
    oracleText:
        "{W}{W}, {T}: Return target artifact card from your graveyard to your hand.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "argivian-archaeologist-return",
            oracleText:
                "{W}{W}, {T}: Return target artifact card from your graveyard to your hand.",
            cost: { tap: true, mana: { W: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            // Migrated resolve()→effects[] (ADR 0045, #839): return the
            // targeted graveyard artifact card to its owner's hand (CR 400.7).
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Argivian Blacksmith — {1}{W}{W} Creature — Human Artificer, 2/2. "{T}:
// Prevent the next 2 damage that would be dealt to target artifact creature
// this turn." (CR 615.1 prevention shield.)
//
// DIVERGENCE (flagged): the target filter is "artifact creature" (AND of two
// card types), but `TargetRequirement.type` arrays are OR-of-types (rules.ts
// uses `.some()`), and there is no AND-of-types filter. The target is scoped to
// `type: "Creature"` here, so it can prevent damage to a non-artifact creature
// too — a loosening of the printed restriction. Closing this needs an
// AND-types target filter (engine/rules change) and is deferred (tracked #974).
export const argivianBlacksmith: CardDefinition = {
    id: "5f604338-5ee4-4c47-ad5a-5c805c96c8de",
    rarity: "common",
    name: "Argivian Blacksmith",
    oracleText:
        "{T}: Prevent the next 2 damage that would be dealt to target artifact creature this turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "argivian-blacksmith-prevent",
            oracleText:
                "{T}: Prevent the next 2 damage that would be dealt to target artifact creature this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-2
            // shield on the announced target creature (CR 615.1).
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Circle of Protection: Artifacts — {1}{W} Enchantment. "{2}: The next time an
// artifact source of your choice would deal damage to you this turn, prevent
// that damage." (CR 615.1/615.6.) Built from the shared `makeCircleOfProtection`
// factory generalized to an artifact-source filter (instead of a color).
export const circleOfProtectionArtifacts: CardDefinition =
    makeCircleOfProtection({
        id: "22ebd5a3-fef8-4097-b038-89a6cb38227d",
        rarity: "uncommon",
        name: "Circle of Protection: Artifacts",
        oracleText:
            "{2}: The next time an artifact source of your choice would deal damage to you this turn, prevent that damage.",
        source: { kind: "artifact", word: "artifact" },
    });

// ─────────────────────────────────────────────────────────────────────────────
// Cluster C+D — continuous prevention/redirection of damage from artifact
// sources + per-turn artifact-damage tracking (PRD #269, issue #287)
//
// CR 615.1 — a prevention effect replaces a would-be damage event with
// nothing. The engine has no dedicated "prevention" event layer; instead a
// continuous prevention is expressed as a CR 614 damage replacement that
// `consumed`s the event when the source matches the filter. (Both layers run
// at the same damage sites via `runDamageReplacement`; consuming the event
// before the original action is observationally identical to prevention for a
// total "prevent all" effect.)
//
// CR 109.5 / 202.2 — the damage source's characteristics (`sourceTypes`) are
// snapshotted onto the `DamageReplacementEvent` by `runDamageReplacement`, so
// an "artifact source" filter is `event.sourceTypes.includes("Artifact")` and
// an "artifact creature" filter additionally requires `"Creature"`.
// ─────────────────────────────────────────────────────────────────────────────

/** Builds a continuous CR 614/615 damage-prevention replacement. `appliesToId`
 *  resolves which permanent's incoming damage is protected (self, or an aura's
 *  host). `isArtifactCreatureOnly` narrows the source filter from "artifact
 *  source" to "artifact creature" (Argothian Pixies). The effect consumes the
 *  whole event (prevent all). */
function artifactSourcePreventionEffect(opts: {
    id: string;
    oracleText: string;
    appliesToId: (self: PermanentView) => string | undefined;
    isArtifactCreatureOnly?: boolean;
}): import("../../types").ReplacementEffect {
    return {
        id: opts.id,
        oracleText: opts.oracleText,
        eventKind: "damage",
        damageEffectKind: "prevention",
        appliesTo: (event, self) => {
            if (event.kind !== "damage") return false;
            if (event.target.type !== "permanent") return false;
            if (event.target.id !== opts.appliesToId(self)) return false;
            const types = event.sourceTypes;
            if (!types.includes("Artifact")) return false;
            if (opts.isArtifactCreatureOnly && !types.includes("Creature")) {
                return false;
            }
            return true;
        },
        // CR 615 — prevent all damage from the matching source.
        replace: () => ({ kind: "consumed" }),
    };
}

// Artifact Ward — {W} Enchantment — Aura. "Enchant creature. Enchanted
// creature can't be blocked by artifact creatures. Prevent all damage that
// would be dealt to enchanted creature by artifact sources. Enchanted creature
// can't be the target of abilities from artifact sources." (CR 303.4 aura;
// CR 509.1b block restriction on the host; CR 615 continuous prevention on the
// host; CR 611 source-type-filtered targeting guard.)
export const artifactWard: CardDefinition = {
    id: "b3a5101a-ec66-4658-950c-9ad49c29b836",
    rarity: "common",
    name: "Artifact Ward",
    oracleText:
        "Enchant creature\nEnchanted creature can't be blocked by artifact creatures.\nPrevent all damage that would be dealt to enchanted creature by artifact sources.\nEnchanted creature can't be the target of abilities from artifact sources.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "block-restriction",
            id: "artifact-ward-no-artifact-creatures",
            side: "attacker" as const,
            // CR 509.1b — enchanted creature can't be blocked by artifact
            // creatures (predicate runs against the host as the attacker).
            predicate: (_self, opponent) =>
                !opponent.types.includes("Artifact"),
            oracleText:
                "Enchanted creature can't be blocked by artifact creatures.",
        },
        {
            kind: "permanent-guard",
            id: "artifact-ward-cant-be-targeted-by-artifacts",
            // CR 611 — guard the host (attachedTo). Source-type filter narrows
            // it to artifact sources only (CR 109.5).
            applies: (target, source) => target.id === source.attachedTo,
            cantBeTargeted: true,
            targetSourceTypeFilter: ["Artifact"],
        },
    ],
    replacementEffects: [
        artifactSourcePreventionEffect({
            id: "artifact-ward-prevent",
            oracleText:
                "Prevent all damage that would be dealt to enchanted creature by artifact sources.",
            // The aura's `self` carries `attachedTo` — protect the host.
            appliesToId: (self) => self.attachedTo,
        }),
    ],
};

// Martyrs of Korlis — {3}{W}{W} Creature — Human, 1/6. "As long as this
// creature is untapped, all damage that would be dealt to you by artifacts is
// dealt to this creature instead." (CR 614 continuous redirection, gated on
// self.isTapped and the source being an artifact.)
export const martyrsOfKorlis: CardDefinition = {
    id: "bde037b9-4947-4ff7-8ea4-e9f1a7e4ab88",
    rarity: "uncommon",
    name: "Martyrs of Korlis",
    oracleText:
        "As long as this creature is untapped, all damage that would be dealt to you by artifacts is dealt to this creature instead.",
    manaCost: { X: 3, W: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 6,
    replacementEffects: [
        {
            id: "martyrs-of-korlis-redirect",
            oracleText:
                "All damage from artifacts that would be dealt to you is dealt to Martyrs of Korlis instead.",
            eventKind: "damage",
            damageEffectKind: "redirection",
            appliesTo: (event, self) => {
                if (event.kind !== "damage") return false;
                // "Damage dealt to you" — the controller of Martyrs.
                if (event.target.type !== "player") return false;
                if (event.target.id !== self.controllerId) return false;
                // "As long as this creature is untapped" (read live).
                if (self.isTapped) return false;
                // "by artifacts" (CR 109.5 source-type snapshot).
                return event.sourceTypes.includes("Artifact");
            },
            replace: (event, ctx) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        target: { type: "permanent", id: ctx.self.id },
                    },
                };
            },
        },
    ],
};

// Reverse Polarity — {W}{W} Instant. "You gain X life, where X is twice the
// damage dealt to you so far this turn by artifacts." (CR 119 lifegain; reads
// the artifact-narrowed per-turn damage tally.)
// NOT DSL-migratable: X = twice getArtifactDamageDealtThisTurn(caster) needs a
// per-turn artifact-damage EffectValue plus an arithmetic (×2) value construct;
// neither exists in the grammar (literal|ref|count|manaValue), so the amount
// can't be expressed as an Op today. tracked-by: #1993
export const reversePolarity: CardDefinition = {
    id: "da7ed8ba-3886-4779-a9b3-6892a7ed3527",
    rarity: "common",
    name: "Reverse Polarity",
    oracleText:
        "You gain X life, where X is twice the damage dealt to you so far this turn by artifacts.",
    manaCost: { W: 2 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        const caster = ctx.controller;
        const artifactDamage = ctx.getArtifactDamageDealtThisTurn(caster);
        if (artifactDamage > 0) {
            ctx.gainLife(caster, artifactDamage * 2);
        }
    },
};
