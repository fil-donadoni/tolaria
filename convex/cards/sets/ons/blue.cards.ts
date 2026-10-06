// ONS — blue cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { SpellContext } from "../../types";
import { defineCard, PERMANENT_TYPES } from "../../types";

// Chain of Vapor — {U} Instant. "Return target nonland permanent to its
// owner's hand. Then that permanent's controller may sacrifice a land of their
// choice. If the player does, they may copy this spell and may choose a new
// target for that copy."
//
// protocol card (resolveSteps, ADR 0045): the "may sacrifice a land → copy
// this spell → retarget the copy" clause is a stepped, self-referential
// resolution (CR 608.2 stepped resolution + CR 707.12 "copy this spell") that
// suspends for player input and can chain recursively. The Op vocabulary has
// no construct that copies the resolving spell and offers an optional
// retarget, so this composes the same SpellContext primitives Chain Lightning
// (leg/red.ts) already uses — `copyResolvingSpell` (CR 707.12) +
// `requestCopyRetarget` (CR 707.10c) — differing only in the optional cost:
// a `sacrifice`-leg may-pay ("Sacrifice a land", CR 701.21) instead of a mana
// may-pay.
//
// Two resolveSteps so the irreversible bounce (step 0) is checkpointed before
// the may-sacrifice gate (step 1) suspends for input. The permanent's
// controller is captured in step 0 by last-known information (CR 608.2h)
// BEFORE the bounce: once `returnToHand` moves it off the battlefield,
// `getController` would have no live permanent to read.
export const chainOfVapor = defineCard(() => ({
    id: "30f6b4a2-5780-46e9-b239-459d2cf37743",
    rarity: "uncommon",
    name: "Chain of Vapor",
    oracleText:
        "Return target nonland permanent to its owner's hand. Then that permanent's controller may sacrifice a land of their choice. If the player does, they may copy this spell and may choose a new target for that copy.",
    manaCost: { U: 1 },
    types: ["Instant"],
    // "target nonland permanent": the full CR 300.1 permanent-type set (as
    // Boomerang uses for "target permanent") minus Land via `excludeTypes`
    // ("any" alone matches only the CR 115.4 damageable types).
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: 1,
        excludeTypes: "Land",
    },
    resolveSteps: [
        // Step 0 — capture "that permanent's controller" (CR 611 / 608.2h) THEN
        // return the permanent to its owner's hand (CR 400.7). The
        // controller must be read BEFORE the bounce: after `returnToHand` the
        // permanent is no longer on the battlefield. Persisted for step 1 via
        // `noteChoice`; the bounce stays in step 0 so the suspend/replay of the
        // step-1 may-sacrifice never re-applies it.
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target) return;
            const controller = ctx.getController(target);
            ctx.noteChoice("chain-of-vapor-controller", [controller]);
            ctx.returnToHand(target);
        },
        // Step 1 — offer the bounced permanent's controller the optional
        // "Sacrifice a land" (CR 701.21). A sacrifice is recorded for step 2,
        // which offers the copy.
        (ctx: SpellContext) => {
            const controller = ctx.recallChoice(
                "chain-of-vapor-controller"
            )?.[0];
            if (!controller) return;
            // Optional sacrifice cost; suspends for the yes/no + land pick. The
            // copy uses the stack and is a genuine tactical choice, so it does
            // not auto-resolve.
            const paid = ctx.requestMayPay({
                playerId: controller,
                choiceId: "chain-of-vapor-sac",
                cost: {
                    permanent: {
                        action: "sacrifice",
                        filter: { types: "Land" },
                        count: 1,
                    },
                },
                prompt: "Sacrifice a land to copy Chain of Vapor (you may choose a new target)?",
            });
            if (paid === undefined) return; // suspended on the may-sacrifice
            if (!paid) return; // declined — the chain ends
            ctx.noteChoice("chain-of-vapor-sacrificed", [controller]);
        },
        // Step 2 — "If the player does, they MAY copy this spell": a second,
        // independent optional decision (issue #2108), cost-free. Isolated in
        // its own step so the copy choice's suspension never replays the
        // sacrifice. On yes, the player copies THIS spell (CR 707.10) and may
        // choose a new target for the copy (CR 707.10c); the copy is a fresh
        // resolution that can itself chain again.
        (ctx: SpellContext) => {
            const controller = ctx.recallChoice(
                "chain-of-vapor-sacrificed"
            )?.[0];
            if (!controller) return; // no sacrifice — nothing to copy
            const copy = ctx.requestMayPay({
                playerId: controller,
                choiceId: "chain-of-vapor-copy",
                prompt: "Copy Chain of Vapor? (you may choose a new target for the copy)",
            });
            if (copy === undefined) return; // suspended on the may-copy
            if (!copy) return; // declined — the chain ends
            const copyId = ctx.copyResolvingSpell({ controllerId: controller });
            if (copyId) ctx.requestCopyRetarget(copyId);
        },
    ],
}));
