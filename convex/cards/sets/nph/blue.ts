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
// hand" is a PRIVATE look (CR 701.18a — the knowledge goes to the CASTER only),
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
// to its other types." A copy-on-ETB Clone variant (CR 707.2 copy effect,
// 614.12 as-enters replacement) — the copy choice runs in a resolve step while
// the spell is still on the stack; `becomeCopyOf` overwrites its copiable
// characteristics before it enters, `additionalTypes: ["Artifact"]` keeps the
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
    resolveSteps: [
        (ctx: SpellContext) => {
            let candidates = 0;
            for (const pid of ctx.allPlayerIds) {
                candidates += ctx.getBattlefieldIds(pid, {
                    types: ["Artifact", "Creature"],
                }).length;
            }
            if (candidates === 0) return; // enters as a 0/0 artifact creature
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "phyrexian-metamorph-may-copy",
                prompt: "Have Phyrexian Metamorph enter as a copy of an artifact or creature?",
            });
            if (accept === undefined) return; // suspended
            if (!accept) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "phyrexian-metamorph-target",
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                filter: { types: ["Artifact", "Creature"] },
                count: 1,
                prompt: "Choose an artifact or creature for Phyrexian Metamorph to copy.",
            });
            if (picks === undefined) return; // suspended
            if (picks.length === 1) {
                ctx.becomeCopyOf(picks[0], {
                    additionalTypes: ["Artifact"],
                });
            }
        },
    ],
};

// Deceiver Exarch — {2}{U} Creature — Phyrexian Cleric, 1/4. Flash. ETB:
// target any permanent — if it's yours, untap it; if it's an opponent's, tap
// it. Splinter Twin combo piece.
//
// protocol card: the Oracle text is modal ("choose one — untap target
// permanent you control, or tap target permanent an opponent controls"), but
// DSL TriggeredAbility lacks a `modes` field (unlike ActivatedAbility). The
// mode is auto-deduced from the target's controller: same-controller →
// untap, other-controller → tap. Functionally identical for all practical
// in-game decisions — the controller always knows whose permanent they're
// targeting, and there is no reason to choose a mode illegal for that
// target.
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
            targetRequirement: { type: [...PERMANENT_TYPES], count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                const targetController = ctx.getController(target);
                if (targetController === ctx.controller) {
                    ctx.untap(target);
                } else {
                    ctx.tap(target);
                }
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — the body is a bare
            // `resolve()`, so the value model has nothing to walk. Sketch the
            // UNTAP arm: both arms score the same `TAP_UNTAP_VALUE`, so the
            // only thing the choice decides is beneficence (`opValuers.ts`:
            // untap → beneficial, tap → harmful), i.e. which side's permanent
            // the bot aims at. Untap is the arm this card exists for (the
            // Splinter Twin loop untaps your own enchanted creature); the tap
            // arm is the same Op mirrored and needs no second sketch. Never
            // executed — only `OP_VALUERS` reads it.
            aiEffects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
            ],
        }),
    ],
};
