// SOS (Secrets of Strixhaven) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos"` resolves through
// sos/index.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2): lands and colourless artifacts (no coloured cost) live in
// colorless.ts.
import type { CardDefinition } from "../../types";

// Traumatic Critique — {X}{U}{R} Instant. "Traumatic Critique deals X damage to
// any target. Draw two cards, then discard a card." CR 107.3 X cost (read via
// getX()), CR 115.4 "any target", CR 121.1 draw, CR 701.8 discard. Stepped
// resolution: the irreversible damage + draw run first, then the discard pick
// can suspend without re-running them (CR 608.2).
export const traumaticCritique: CardDefinition = {
    id: "2a812fa7-4599-4e25-97db-20ffc6bc0b26",
    rarity: "common",
    name: "Traumatic Critique",
    oracleText:
        "Traumatic Critique deals X damage to any target. Draw two cards, then discard a card.",
    manaCost: { X: "X", U: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    // Migrated resolveSteps()→effects[] (ADR 0045, #852): X damage to any target
    // (CR 120.1, chosen-cost `{ X: true }`) + draw two, then a `choice`-driven
    // discard of one (CR 701.8 — Jalum Tome loot shape). The choice Op suspends
    // resolution and resumes AT the choice (the interpreter's pre-order cursor
    // guarantees the irreversible damage + draw never re-run — CR 608.3), so the
    // two resolveSteps collapse into one script.
    effects: [
        { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        { op: "draw", player: "controller", count: 2 },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: 1,
            prompt: "Discard a card (Traumatic Critique).",
            bind: "$discard",
        },
        { op: "discard", player: "controller", cards: { ref: "$discard" } },
    ],
};

// Witherbloom Charm — "Choose one — • You may sacrifice a permanent. If you
// do, draw two cards. • You gain 5 life. • Destroy target nonland permanent
// with mana value 2 or less." (CR 700.2 modal.) Modes have different target
// shapes (modes 1-2 have none, mode 3 targets a permanent) — a card-level
// `targetRequirement` can't flex per chosen mode, and the DSL `optionChoice`
// Op runs on a SINGLE already-announced target set. Uses the legacy `modes`
// mechanism instead (CR 700.2c per-mode target/resolve), the same
// established escape used by Healing Salve (lea/white.ts) for this exact
// cross-mode-target gap.
export const witherbloomCharm: CardDefinition = {
    id: "254437f7-7a8a-4b11-9cea-e8e7ea23c59e",
    rarity: "uncommon",
    name: "Witherbloom Charm",
    oracleText:
        "Choose one —\n• You may sacrifice a permanent. If you do, draw two cards.\n• You gain 5 life.\n• Destroy target nonland permanent with mana value 2 or less.",
    manaCost: { B: 1, G: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "sacrifice-draw",
            label: "You may sacrifice a permanent. If you do, draw two cards.",
            oracleText:
                "You may sacrifice a permanent. If you do, draw two cards.",
            // NOT DSL-migratable (ADR 0045): the effect (mayPay sacrifice →
            // draw two) maps cleanly onto `mayPay` + `if` + `draw`, but
            // `SpellMode` (this modal card's per-mode site) only accepts a
            // `resolve` callback — it has no `effects` field to migrate onto.
            // Planned-migratable (blocked on `SpellMode` gaining an `effects`
            // option, not this card). tracked-by: #1280
            resolve: (ctx) => {
                const paid = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `witherbloom-charm-sac-${ctx.sourceInstanceId}`,
                    cost: { sacrifice: { filter: {}, count: 1 } },
                    prompt: "Witherbloom Charm: sacrifice a permanent to draw two cards?",
                });
                if (paid === undefined) return; // suspended for the decision
                if (paid) ctx.drawCards(ctx.controller, 2);
            },
        },
        {
            id: "gain-life",
            label: "You gain 5 life.",
            oracleText: "You gain 5 life.",
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 5);
            },
        },
        {
            id: "destroy",
            label: "Destroy target nonland permanent with mana value 2 or less.",
            oracleText:
                "Destroy target nonland permanent with mana value 2 or less.",
            targetRequirement: {
                type: [
                    "Artifact",
                    "Creature",
                    "Enchantment",
                    "Planeswalker",
                    "Battle",
                ],
                count: 1,
                mvFilter: { max: 2 },
            },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.destroy(target);
            },
        },
    ],
};

// Silverquill Charm — "Choose one — • Put two +1/+1 counters on target
// creature. • Exile target creature with power 2 or less. • Each opponent
// loses 3 life and you gain 3 life." (CR 700.2 modal.) Same cross-mode-target
// gap as Witherbloom Charm above — uses the legacy `modes` mechanism.
export const silverquillCharm: CardDefinition = {
    id: "3eb73579-f1c6-4762-81d2-9568ab501fac",
    rarity: "uncommon",
    name: "Silverquill Charm",
    oracleText:
        "Choose one —\n• Put two +1/+1 counters on target creature.\n• Exile target creature with power 2 or less.\n• Each opponent loses 3 life and you gain 3 life.",
    manaCost: { W: 1, B: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "counters",
            label: "Put two +1/+1 counters on target creature.",
            oracleText: "Put two +1/+1 counters on target creature.",
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.addCounter(target, "+1/+1", 2);
            },
        },
        {
            id: "exile",
            label: "Exile target creature with power 2 or less.",
            oracleText: "Exile target creature with power 2 or less.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 2 },
            },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.exile(target);
            },
        },
        {
            id: "drain",
            label: "Each opponent loses 3 life and you gain 3 life.",
            oracleText: "Each opponent loses 3 life and you gain 3 life.",
            resolve: (ctx) => {
                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (opponentId) ctx.loseLife(opponentId, 3);
                ctx.gainLife(ctx.controller, 3);
            },
        },
    ],
};

// Quandrix Charm — {G}{U} Instant. "Choose one — Counter target spell unless
// its controller pays {2}. / Destroy target enchantment. / Target creature
// has base power and toughness 5/5 until end of turn." (CR 700.2 modal.)
// Modes have DIFFERENT target shapes (mode 1 targets a spell, mode 2 an
// enchantment, mode 3 a creature) — a card-level `targetRequirement` can't
// flex per chosen mode, and the DSL `optionChoice` Op runs on a SINGLE
// already-announced target set. Uses the legacy `modes` mechanism instead
// (CR 700.2c per-mode target/resolve), the same established escape used by
// Witherbloom Charm/Silverquill Charm above for this exact cross-mode-target
// gap (issue #683 adds mode 1's counter-unless-pay shape and mode 3's
// `setBasePT` set, both already-shipped primitives — Force Spike (leg/blue.ts)
// and Halfdane (leg/multicolor.ts) respectively).
export const quandrixCharm: CardDefinition = {
    id: "318486e0-f255-40f5-8150-dc272eec9d7d",
    rarity: "uncommon",
    name: "Quandrix Charm",
    oracleText:
        "Choose one —\n• Counter target spell unless its controller pays {2}.\n• Destroy target enchantment.\n• Target creature has base power and toughness 5/5 until end of turn.",
    manaCost: { G: 1, U: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "counter",
            label: "Counter target spell unless its controller pays {2}.",
            oracleText: "Counter target spell unless its controller pays {2}.",
            targetRequirement: { type: "spell", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "spell") return;
                // CR 117.3a — the spell's controller decides whether to pay.
                const controllerId = ctx.getController(target);
                const paid = ctx.requestMayPay({
                    playerId: controllerId,
                    choiceId: `quandrix-charm-counter-${ctx.sourceInstanceId}`,
                    cost: { X: 2 },
                    prompt: "Pay {2} to prevent your spell from being countered?",
                });
                if (paid === undefined) return; // suspended for the decision
                if (!paid) ctx.counter(target);
            },
        },
        {
            id: "destroy-enchantment",
            label: "Destroy target enchantment.",
            oracleText: "Destroy target enchantment.",
            targetRequirement: { type: "Enchantment", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (target) ctx.destroy(target);
            },
        },
        {
            id: "set-pt",
            label: "Target creature has base power and toughness 5/5 until end of turn.",
            oracleText:
                "Target creature has base power and toughness 5/5 until end of turn.",
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target) return;
                // CR 613.4b layer 7b — a fixed base P/T set, locked at
                // resolution (CR 611.2), until end of turn.
                ctx.setBasePT(target, 5, 5, { phase: "end-of-turn" });
            },
        },
    ],
};

// Lorehold Charm — {R}{W} Instant. "Choose one — Each opponent sacrifices a
// nontoken artifact of their choice. / Return target artifact or creature
// card with mana value 2 or less from your graveyard to the battlefield. /
// Creatures you control get +1/+1 and gain trample until end of turn." (CR
// 700.2 modal, already supported by `optionChoice`.) Blocked: modes 2 (a
// graveyard reanimation with `manaValueAtMost: 2`) and 3 (a mass pump +
// trample grant) are both free with existing Ops, but mode 1 needs a
// `nontoken` field on `EffectCardFilter`, which doesn't exist — and a card
// can't ship with only 2 of its 3 modes (issue #920).
// tracked-by: #920
// export const loreholdCharm: CardDefinition = {
//     id: "5fe70295-e550-4577-a341-dab6c25aabfd",
//     name: "Lorehold Charm",
//     rarity: "uncommon",
//     manaCost: { W: 1, R: 1 },
//     types: ["Instant"],
// };

// Vicious Rivalry — {2}{B}{G} Sorcery. "As an additional cost to cast this
// spell, pay X life. Destroy all artifacts and creatures with mana value X or
// less." (CR 118.4 pay-X-life additional cost — already shipped via
// `additionalCosts.payXLife`, Fire Covenant.) BLOCKED: `EffectCardFilter.
// manaValueAtMost` is a FIXED literal ceiling by design (its own doc comment
// in `convex/cards/types.ts` names Green Sun's Zenith's "mana value X or
// less" as the exact NOT-expressible case) — there is no DYNAMIC (chosen-X)
// mana-value ceiling for a `forEach`/battlefield-sweep filter. Do not invent
// a name or paper over the gap with `resolve()`.
// tracked-by: #898
// export const viciousRivalry: CardDefinition = {
//     id: "6fa9cd18-3181-4373-ab65-49bf9de9487f",
//     name: "Vicious Rivalry",
//     rarity: "rare",
//     oracleText:
//         "As an additional cost to cast this spell, pay X life.\nDestroy all artifacts and creatures with mana value X or less.",
//     manaCost: { X: 2, B: 1, G: 1 },
//     types: ["Sorcery"],
//     additionalCosts: { payXLife: true },
// };
