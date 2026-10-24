// ALL (Alliances) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as all from "./sets/all/index.cards"` re-exports this
// module.
import { defineCard } from "../../types";

// Lim-Dûl's Vault — {U}{B} Instant. "Look at the top five cards of your
// library. As many times as you choose, you may pay 1 life, put those cards on
// the bottom of your library in any order, then look at the top five cards of
// your library. Then shuffle and put the last cards you looked at this way on
// top in any order." (CR 401.4 — arrange in any order; CR 119.4 — pay life; CR 701.24 —
// shuffle)
//
// protocol card: the optional repeat is a player-driven loop whose every
// iteration shows the library top and asks again, and the Effect Script DSL has
// no repeat construct (its four constructs are frozen, ADR 0045) — a
// `resolve()` that replays the iterations. A bare `resolve()` is re-entered
// from the top after every answered choice with its mutations kept, so each
// iteration records `vault-bottomed-<i>` once its bottoming has happened and a
// replay skips it; the iteration in flight re-reads the same unmoved top five.
// The look's arrangement doubles as the "any order" of both exits: it is the
// order the cards are bottomed in, and the order they are put back on top in
// after the shuffle (the player sees the same five cards either way, so
// deciding the order at the last look loses nothing).
// compiler-gap: As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library (#5603)
export const limDulsVault = defineCard(() => ({
    id: "f9b0164c-2d4e-48ab-addd-322d9b504739", // ALL 107
    rarity: "uncommon",
    name: "Lim-Dûl's Vault",
    oracleText:
        "Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the last cards you looked at this way on top in any order.",
    manaCost: { U: 1, B: 1 },
    types: ["Instant"],
    // AI shadow (never executed): the look-and-arrange of the top five; the
    // pay-life repeat has no Op and is not priced.
    aiEffects: [
        {
            op: "scryReorder",
            player: "controller",
            count: 5,
            destination: "none",
        },
    ],
    resolve: (ctx) => {
        const me = ctx.controller;
        for (let i = 0; ; i++) {
            // Iteration already carried out before an earlier suspension.
            if (ctx.recallChoice(`vault-bottomed-${i}`)) continue;
            const seen = ctx.peekLibraryTop(me, 5).length;
            if (seen === 0) return; // empty library: nothing to look at
            // The look: the player sees the top five and arranges them. Order-
            // only (`destination: "none"`), so the five stay on top.
            if (
                !ctx.orderTop(me, seen, {
                    destination: "none",
                    choiceId: `vault-look-${i}`,
                    prompt: "Arrange these cards (the order you stop in, or bottom them in).",
                })
            )
                return;
            const arranged = ctx.peekLibraryTop(me, seen);
            const again = ctx.requestMayPay({
                playerId: me,
                choiceId: `vault-again-${i}`,
                cost: { life: 1 },
                prompt: "Pay 1 life, put these cards on the bottom of your library, and look at the top five cards again?",
            });
            if (again === undefined) return; // suspended on the decision
            if (!again) {
                // "Then shuffle and put the last cards you looked at this way
                // on top in any order." (CR 701.24 — shuffle)
                ctx.shuffleLibrary(me);
                ctx.putLibraryCardsOnTop(me, arranged);
                return;
            }
            // Bottom them: the rest of the library keeps its order and the
            // looked-at cards follow in the arranged order (CR 401.4).
            const all = ctx.peekLibraryTop(me, Number.MAX_SAFE_INTEGER);
            const set = new Set(arranged);
            ctx.reorderLibraryTop(me, [
                ...all.filter((id) => !set.has(id)),
                ...arranged,
            ]);
            ctx.noteChoice(`vault-bottomed-${i}`, ["yes"]);
        }
    },
}));
