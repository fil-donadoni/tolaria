// VIS — black cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, TriggerStateView } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Vampiric Tutor — {B} Instant. "Search your library for a card, then
// shuffle and put that card on top. You lose 2 life." (CR 701.23 search /
// 701.24 shuffle / 401.4 top-of-library / 119.3 life loss, issue #1125 —
// unblocked by the `moveZone` `to: "library-top"` destination.)
// `count: { min: 0, max: 1 }` is CR 701.19b's fail-to-find allowance (no
// filter — "a card" is any card). The shuffle Op runs BEFORE the
// `library-top` move, mirroring the oracle text's own "then shuffle and put
// that card on top" ordering; the life loss is unconditional and runs last.
export const vampiricTutor: CardDefinition = {
    id: "0a07cba3-2e8d-48ec-a6f8-4d2edfcd833d",
    name: "Vampiric Tutor",
    rarity: "rare",
    manaCost: { B: 1 },
    types: ["Instant"],
    oracleText:
        "Search your library for a card, then shuffle and put that card on top. You lose 2 life.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: { min: 0, max: 1 },
            prompt: "Search your library for a card.",
            bind: "$picked",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "library-top",
        },
        { op: "loseLife", player: "controller", amount: 2 },
    ],
};

/** CR 603.4 intervening-if support — "if it's on the battlefield", asked of the
 *  trigger's own source. Answered from the `TriggerStateView` the engine passes
 *  to `interveningIf` at BOTH check time and resolution; without a state view
 *  there is nothing to check against, so it fails CLOSED (the trigger fizzles)
 *  rather than acting on a permanent that may no longer be there. */
function sourceIsOnBattlefield(
    sourceId: string,
    state: TriggerStateView | undefined
): boolean {
    if (!state) return false;
    return state.players.some((p) =>
        p.battlefield.some((c) => c.id === sourceId)
    );
}

// Necromancy — {2}{B} Enchantment. Three Oracle sentences, three engine
// shapes.
//
// (1) "You may cast this spell as though it had flash. If you cast it any time
// a sorcery couldn't have been cast, the controller of the permanent it becomes
// sacrifices it at the beginning of the next cleanup step." The permission is
// `castAsThoughFlash` — the UNCONDITIONAL half of the card-level self-grant
// seam `hasCardSelfFlashPermission` (`cards/castRestrictions.ts`), reached from
// the single timing authority `castTimingBaseLegal` (`gre/rules.ts`). It costs
// nothing: `flashSurchargeRequired` keys on the DECLARED surcharge, which this
// card has none of. The plain `flash` keyword would be wrong twice over — it
// would give the card a static ability it does not have (CR 604.1), and the
// second sentence asks about the TIMING USED, not about possessing the ability.
// That question is answered by the cast-time snapshot
// `CardInstanceState.castOffSorceryTiming` (CR 307.1 / 117.1a, issue #2473),
// which rides onto the permanent this spell becomes, and is read here as a
// CR 603.4 check-time `conditionOnSelf` — the same shape `evoked`/`dashed` use.
// "It" in that sentence is NECROMANCY itself, not the reanimated creature: the
// delayed trigger (CR 603.7) sacrifices the enchantment at the next cleanup
// step, and the third sentence's leaves-the-battlefield trigger then takes the
// creature down with it. CR 514.3a is what makes the cleanup step able to host
// both — "the game checks to see if ... any triggered abilities are waiting to
// be put onto the stack (including those that trigger 'at the beginning of the
// next cleanup step')", after which the active player gets priority and, once
// the stack empties, another cleanup step begins.
//
// The delayed trigger is armed from an ETB trigger rather than at the moment
// the spell resolves, because a delayed triggered ability is created by a
// RESOLVING ability body in this engine (CR 603.7a lists exactly those three
// creation moments) and a permanent card runs no script of its own on
// resolution. The observable cost is one extra (empty-looking) object on the
// stack; the outcome is identical, including when Necromancy leaves in
// response — the `$becomes` capture then resolves to nothing and the fired
// trigger sacrifices nothing (CR 608.2b), exactly as the real delayed ability
// would find its permanent already gone. See
// docs/findings/2392-delayed-trigger-armed-from-etb.md.
//
// (2) "When this enchantment enters, if it's on the battlefield, it becomes an
// Aura with 'enchant creature put onto the battlefield with Necromancy.' Put
// target creature card from a graveyard onto the battlefield under your control
// and attach this enchantment to it." The reanimation is the general `moveZone`
// Op (`to: "battlefield"` + a `controller` override — Portal to Phyrexia's
// shape); the self-transform is `addSubtype` on `$source` carrying the
// `enchantRestriction` payload (issue #2471), which is what lets the CR 303.4c /
// 704.5m attachment SBA see a restriction at all: `resolveEnchantRestriction`
// reads the printed clause AND the runtime-granted one (CR 702.5c — all
// instances of enchant apply). The clause names the specific object
// (`host: { ref: "$reanimated" }`, resolved to an instance id at grant time),
// so no OTHER creature is a legal host. Necromancy therefore needs NO cast-time
// `targetRequirement` — the host is chosen by this trigger, and modern Oracle
// text has no "enchant creature card in a graveyard" line to model (contrast
// Dance of the Dead, `ice/black.ts`, which is PRINTED as an Aura).
//
// (3) "When this enchantment leaves the battlefield, that creature's controller
// sacrifices it." Same Oracle shape as Animate Dead (`lea/black.ts`), and the
// same recorded `resolve()` justification: it needs
// `LeavingPermanent.attachedToBeforeLeave` (CR 603.10a — leaves-the-battlefield
// abilities look back in time), a `leftTrigger`-only payload the Effect Script
// interpreter has no ref selector for.
export const necromancy: CardDefinition = {
    id: "311a6257-dd77-4bb6-81cb-c8e7862350f3",
    name: "Necromancy",
    rarity: "uncommon",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    oracleText:
        "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nWhen this enchantment enters, if it's on the battlefield, it becomes an Aura with \"enchant creature put onto the battlefield with Necromancy.\" Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it.\nWhen this enchantment leaves the battlefield, that creature's controller sacrifices it.",
    // CR 601.3 / 702.8a — "You may cast this spell as though it had flash."
    castAsThoughFlash: true,
    triggeredAbilities: [
        enteredTrigger({
            id: "necromancy-etb-reanimate",
            oracleText:
                'When this enchantment enters, if it\'s on the battlefield, it becomes an Aura with "enchant creature put onto the battlefield with Necromancy." Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it.',
            scope: "self",
            // CR 603.4 — the printed intervening-if, re-checked at resolution:
            // an enchantment that has already left play does nothing (no
            // reanimation, no attach), rather than reanimating a creature and
            // leaving it behind. Fails CLOSED without a state view, mirroring
            // the `sacrificeSelfWhen` shape in `arn/blue.ts`.
            interveningIf: (_event, self, state) =>
                sourceIsOnBattlefield(self.id, state),
            // CR 603.3d — a real announced target, chosen as the trigger goes
            // on the stack. "a graveyard" (not "your graveyard") is
            // `controller: "any"` (Portal to Phyrexia / Reanimate shape).
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "battlefield",
                    controller: "controller",
                    bind: "$reanimated",
                },
                {
                    op: "addSubtype",
                    target: { ref: "$source" },
                    subtype: "Aura",
                    // CR 303.4 — "What an Aura can be attached to is defined by
                    // its enchant keyword ability", granted here TOGETHER with
                    // the subtype and naming the one specific object ("enchant
                    // creature put onto the battlefield with Necromancy").
                    enchantRestriction: {
                        types: ["Creature"],
                        host: { ref: "$reanimated" },
                    },
                },
                { op: "attach", target: { ref: "$reanimated" } },
            ],
        }),
        enteredTrigger({
            id: "necromancy-cleanup-sacrifice",
            oracleText:
                "If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.",
            scope: "self",
            // CR 307.1 / 117.1a — the cast-time snapshot, not a re-derived
            // legality verdict. `conditionOnSelf` (rather than `condition`) so
            // the gate is retained on the built ability as `{ onSelf }` and the
            // Bot's value model can decide whether this ability fires instead
            // of assuming it always does. A sorcery-speed cast arms NOTHING.
            conditionOnSelf: (self) => self.castOffSorceryTiming === true,
            effects: [
                {
                    op: "delayedTrigger",
                    // CR 603.7 / 514.3a — the cleanup-step boundary (issue
                    // #2472). NOT `next-end-step`: CR 514 cleanup happens
                    // AFTER the end step.
                    timing: "next-cleanup-step",
                    oracleText:
                        "At the beginning of the next cleanup step, the controller of the permanent Necromancy became sacrifices it.",
                    // Resolved to Necromancy's own instance id at scheduling
                    // time; re-bound as a fresh snapshot when the trigger fires
                    // (and simply absent, so the body skips per CR 608.2b, if
                    // the permanent is no longer on the battlefield).
                    capture: { $becomes: { ref: "$source" } },
                    // No `player` field: to sacrifice a permanent, "its
                    // controller moves it from the battlefield directly to its
                    // owner's graveyard" (CR 701.21a) — which is exactly "the
                    // controller of the permanent it becomes".
                    effects: [{ op: "sacrifice", target: { ref: "$becomes" } }],
                },
            ],
        }),
        leftTrigger({
            id: "necromancy-ltb",
            oracleText:
                "When this enchantment leaves the battlefield, that creature's controller sacrifices it.",
            scope: "self",
            // protocol card (ADR 0045): NOT DSL-migratable — the body needs
            // `leaving.attachedToBeforeLeave` (CR 603.10a — a
            // leaves-the-battlefield ability looks back in time, so the host is
            // read from last-known information), a `leftTrigger`-only payload
            // the Effect Script interpreter has no object-ref selector for.
            // Identical justification, and identical body, to Animate Dead
            // (`lea/black.ts`).
            //
            // PRD #1423 — the AI-only SHADOW script for that imperative body:
            // never executed, only walked by `OP_VALUERS`, so the Bot's value
            // model can see that losing this Aura costs it the creature. CR
            // 701.3 `$host` is the permanent the source is attached to, which
            // is what `attachedToBeforeLeave` names at fire time.
            aiEffects: [{ op: "sacrifice", target: { ref: "$host" } }],
            resolve: (ctx, _event, leaving) => {
                const hostId = leaving.attachedToBeforeLeave;
                if (!hostId) return;
                ctx.sacrifice(hostId);
            },
        }),
    ],
};
