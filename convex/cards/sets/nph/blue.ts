// nph — blue cards (ADR 0043 colour split). New Phyrexia (2011). Both cards are
// blue because their `{U/P}` Phyrexian pips are blue mana symbols (CR 105.2 —
// `getColorsFromCost` counts them), even though each can be cast for life.
// Phyrexian mana `{U/P}` (CR 107.4f) is resolved in the cost system
// (`convex/gre/phyrexian.ts`, `announceCast.phyrexianLifePips`); the effects
// below are independent of which cost was paid.
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { PERMANENT_TYPES } from "../../types";

// Gitaxian Probe — "Look at target player's hand. Draw a card." Mana cost is a
// single Phyrexian pip `{U/P}` (pay {U} or 2 life). "Look at target player's
// hand" is a PRIVATE look (CR 400.2 — the knowledge goes to the CASTER only),
// expressed with the `revealHand` suspend/ack display primitive + `markKnown`
// exactly as Glasses of Urza does; the trailing unconditional draw rides in the
// same closure.
export const gitaxianProbe: CardDefinition = {
    id: "995486ce-58bb-4753-a812-0ca73ef1a235",
    rarity: "common",
    name: "Gitaxian Probe",
    oracleText:
        "({U/P} can be paid with either {U} or 2 life.)\nLook at target player's hand.\nDraw a card.",
    manaCost: { phyrexian: { U: 1 } },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    // protocol card: "look at target player's hand" is a PRIVATE look — one
    // knower (the caster), via the `revealHand` suspend/ack display primitive +
    // `markKnown`. The DSL `reveal` Op is an ALL-PLAYERS reveal only
    // (mechanicsRegistry note on `reveal`), so a private look has no Op and
    // stays resolve(); the unconditional draw follows in the same closure.
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        // First call enqueues the reveal-hand display choice and returns
        // undefined (suspend; the resolve returns early). The re-invocation
        // after the caster acknowledges returns a non-undefined value.
        const ack = ctx.revealHand(target.id);
        if (ack === undefined) return;
        // CR 401.4 — the caster now knows the hand; stamp every card currently
        // in the target's hand `knownTo` the caster so the knowledge outlives
        // the spell.
        const handIds = ctx.getHandCards(target.id).map((c) => c.id);
        ctx.markKnown(target.id, handIds, ctx.controller);
        // CR 121.1 — then draw a card (unconditional, even on an empty hand).
        ctx.drawCards(ctx.controller, 1);
    },
};

// Phyrexian Metamorph — "You may have this creature enter as a copy of any
// artifact or creature on the battlefield, except it's an artifact in addition
// to its other types." A copy-on-entry Clone variant (CR 707.2 copy effect,
// CR 614.12 as-enters replacement) — the copy choice is DECLARED on
// `entersWith.asEnters` (ADR 0100 D3, #2451) and answered before the permanent
// enters on every entry path; `additionalTypes: ["Artifact"]` keeps the
// Artifact type (CR 707.9d). Declining (or no artifact/creature present) leaves
// it a 0/0 artifact creature that dies to SBA (CR 704.5f). Mana cost carries a
// Phyrexian pip `{U/P}` (pay {U} or 2 life).
export const phyrexianMetamorph: CardDefinition = {
    id: "d2e27911-87cb-49a0-a34f-6afe4bddd592",
    rarity: "rare",
    name: "Phyrexian Metamorph",
    oracleText:
        "({U/P} can be paid with either {U} or 2 life.)\nYou may have Phyrexian Metamorph enter the battlefield as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
    manaCost: { X: 3, phyrexian: { U: 1 } },
    types: ["Artifact", "Creature"],
    subtypes: ["Phyrexian", "Shapeshifter"],
    power: 0,
    toughness: 0,
    // Bot-only cast prune (#938): copies an artifact or creature on ETB — a
    // wasted cast (enters a 0/0 that dies to SBA) when neither is in play.
    copySourceFilter: { types: ["Artifact", "Creature"] },
    // CR 614.1c / 707.5 (ADR 0100 D3, issue #2451) — declarative as-enters copy,
    // raised on every entry path. CR 707.2's "except it's an artifact in
    // addition to its other types" rides as `CopyEffectOptions.additionalTypes`.
    entersWith: {
        asEnters: [
            {
                kind: "copy",
                filter: { types: ["Artifact", "Creature"] },
                opts: { additionalTypes: ["Artifact"] },
            },
        ],
    },
};

// Deceiver Exarch — {2}{U} Creature — Phyrexian Cleric, 1/4. Flash. ETB is a
// MODAL triggered ability (CR 603.3c): choose one — untap target permanent you
// control, or tap target permanent an opponent controls. Splinter Twin combo
// piece (the untap mode is the loop half).
//
// The mode is announced as the trigger goes on the stack, before targets, and
// each mode carries its own controller-filtered `targetRequirement` so only the
// chosen mode's targets are ever considered (CR 700.2c).
export const deceiverExarch: CardDefinition = {
    id: "1f123ad6-fe84-4fed-9c0f-6b41921e9c26",
    rarity: "uncommon",
    name: "Deceiver Exarch",
    oracleText:
        "Flash (You may cast this spell any time you could cast an instant.)\nWhen this creature enters, choose one —\n• Untap target permanent you control.\n• Tap target permanent an opponent controls.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Cleric"],
    power: 1,
    toughness: 4,
    staticAbilities: ["flash"],
    triggeredAbilities: [
        enteredTrigger({
            id: "deceiver-exarch-etb",
            oracleText:
                "When this creature enters, choose one —\n• Untap target permanent you control.\n• Tap target permanent an opponent controls.",
            scope: "self",
            // CR 603.3c — exactly one mode is announced as the trigger is put
            // on the stack; a mode whose `targetRequirement` has no legal
            // candidate can't be chosen, and with an empty board on both sides
            // (no permanent at all besides the Exarch itself, which its own
            // untap mode may legally target) the announcement resolves without
            // a prompt.
            modes: [
                {
                    id: "untap-yours",
                    label: "Untap target permanent you control",
                    oracleText: "Untap target permanent you control.",
                    targetRequirement: {
                        type: [...PERMANENT_TYPES],
                        count: 1,
                        controller: "you",
                    },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { target: 0 },
                        },
                    ],
                },
                {
                    id: "tap-theirs",
                    label: "Tap target permanent an opponent controls",
                    oracleText: "Tap target permanent an opponent controls.",
                    targetRequirement: {
                        type: [...PERMANENT_TYPES],
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { target: 0 },
                        },
                    ],
                },
            ],
        }),
    ],
};
