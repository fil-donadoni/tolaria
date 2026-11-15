// ulg (Urza's Legacy) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import { defineCard, type SpellContext } from "../../types";

// Memory Jar — {5} Artifact (Vintage Cube FREE: edict/discard/hand
// disruption, issue #682). "{T}, Sacrifice this artifact: Each player exiles
// all cards from their hand face down and draws seven cards. At the
// beginning of the next end step, each player discards their hand and
// returns to their hand each card they exiled this way." (CR 400.7 zone
// changes, CR 701.20a reveal-adjacent face-down exile, CR 603.7a delayed trigger.)
//
// PROTOCOL (`resolve()` — no Op vocabulary gap, a genuine per-player linked-
// state capability the frozen Effect Script grammar doesn't carry, ADR 0045):
// (1) [CLOSED by #1279] a WHOLE-ZONE "exile every hand card" now HAS an Op —
// `moveZone`'s bulk whole-zone shape (no target/cards, issue #1279) moves an
// entire hand with no selection — but that alone doesn't unblock this card:
// this is a FACE-DOWN exile — [CLOSED by #3812] the whole-zone shape now
// takes `faceDown` + `bindAll`, and a `{ select: { set: "bound" } }` capture
// freezes the exiled ids (Suppress, apc/black.cards.ts); (2) [CLOSED by #3812, same
// skin]; (3) STILL OPEN, and the reason this stays `resolve()`: the
// `delayedTrigger` Op's `capture` map resolves ONCE at
// scheduling (a flat map), but this card needs a DIFFERENT list of exiled ids
// PER PLAYER, re-associated with that same player at fire time — the
// list-valued capture grammar (issue #866) has no per-`forEach`-member
// capture shape. The template `resolve()` path composes only already-shipped
// primitives
// (`getHandIds`, `exileFaceDown`, `drawCards`, `moveZone`, `moveCardById`,
// `scheduleDelayedTrigger`) with a plain comma-joined-ids payload encoding —
// the legacy template payload is scalar-only (`Record<string, string>`, see
// `gre/state.ts`'s `resolveTopOfStack`), so a per-player id list is carried as
// one joined string under a per-player key (`exiled:<playerId>`), the same
// "note a value for the resume" idiom Jester's Mask uses
// (`convex/cards/sets/ice/colorless.cards.ts`). `exileFaceDown` gets NO knower
// (issue #3812): CR 406.3 — a card exiled face down "can't be examined by any
// player except when instructions allow it", and this one's never do, so not
// even its owner may look until it comes back.
const MEMORY_JAR_RETURN_TRIGGER_ID = "memory-jar-return";

// hand-tail: {T}, Sacrifice this artifact: Each player exiles all cards from their hand face down and draws seven cards. At the beginning of the next end step, each player discards their hand and returns to their hand each card they exiled this way. (#8505)
export const memoryJar = defineCard(() => ({
    id: "a15d33d6-7213-4482-a1be-ac0a73644af6",
    name: "Memory Jar",
    rarity: "rare",
    oracleText:
        "{T}, Sacrifice this artifact: Each player exiles all cards from their hand face down and draws seven cards. At the beginning of the next end step, each player discards their hand and returns to their hand each card they exiled this way.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "memory-jar-activate",
            oracleText:
                "{T}, Sacrifice this artifact: Each player exiles all cards from their hand face down and draws seven cards. At the beginning of the next end step, each player discards their hand and returns to their hand each card they exiled this way.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const payload: Record<string, string> = {};
                for (const pid of ctx.allPlayerIds) {
                    const handIds = ctx.getHandIds(pid);
                    for (const id of handIds) {
                        // Oracle: "exiles all cards from their hand FACE
                        // DOWN" (CR 406.3) — genuinely face down, and no
                        // instruction lets anyone look: no knower (#3812).
                        ctx.exileFaceDown(
                            pid,
                            id,
                            "hand",
                            null,
                            "face-down-exile"
                        );
                    }
                    payload[`exiled:${pid}`] = handIds.join(",");
                    ctx.drawCards(pid, 7);
                }
                ctx.scheduleDelayedTrigger(
                    memoryJar().id,
                    MEMORY_JAR_RETURN_TRIGGER_ID,
                    "next-end-step",
                    payload
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: MEMORY_JAR_RETURN_TRIGGER_ID,
            oracleText:
                "At the beginning of the next end step, each player discards their hand and returns to their hand each card they exiled this way.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                // Oracle order: discard the (drawn) hand FIRST, then return
                // the exiled cards — a player who exiled nothing and drew
                // nothing (empty library) simply discards an empty hand.
                // CR 701.9a — each card goes through the discard chokepoint
                // (issue #3814), so discard replacements (Library of Leng,
                // an opponent's Dodecapod) and "whenever you discard"
                // triggers see it; the cause is this ability's controller.
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getHandIds(pid)) {
                        ctx.discardCard(pid, id);
                    }
                }
                for (const pid of ctx.allPlayerIds) {
                    const raw = payload[`exiled:${pid}`];
                    if (!raw) continue;
                    for (const id of raw.split(",").filter(Boolean)) {
                        ctx.moveCardById(pid, id, "exile", "hand");
                    }
                }
            },
        },
    ],
}));
