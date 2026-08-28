// ulg (Urza's Legacy) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition, SpellContext } from "../../types";
import { makeTapForMana } from "../../abilities";

// Grim Monolith — "This artifact doesn't untap during your untap step.
// {T}: Add {C}{C}{C}. {4}: Untap this artifact." (CR 502.1 untap
// restriction, CR 605.1a/605.3a mana ability `useStack: false`.) Identical
// shape to LEA's Basalt Monolith (`convex/cards/sets/lea/colorless.ts`) — the
// `{4}: Untap this artifact` ability reuses the same `tapUntap` Op pattern.
// Vintage Cube free tranche (issue #675, ADR 0041).
export const grimMonolith: CardDefinition = {
    id: "9ddc9fe1-17c8-4e1d-aeb8-c4214e881280",
    rarity: "rare",
    name: "Grim Monolith",
    oracleText:
        "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{4}: Untap this artifact.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["does-not-untap"],
    activatedAbilities: [
        makeTapForMana({
            id: "grim-monolith-mana",
            oracleText: "{T}: Add {C}{C}{C}.",
            produces: { C: 3 },
        }),
        {
            id: "grim-monolith-untap",
            oracleText: "{4}: Untap this artifact.",
            cost: { mana: { X: 4 } },
            useStack: true,
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        },
    ],
};

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
// this is a FACE-DOWN exile (`exileFaceDown`, ADR 0026), which the whole-zone
// shape doesn't do (it's a plain CR 400.7 move, no face-down marker); (2)
// `exileFaceDown` is a per-card imperative primitive with no Op skin; (3)
// most importantly, the `delayedTrigger` Op's `capture` map resolves ONCE at
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
// (`convex/cards/sets/ice/colorless.ts`). `exileFaceDown`'s `knowerId` is the
// card's own owner — a player may always look at their own face-down cards
// (morph precedent), matching the "you may look at it for as long as it
// remains exiled" spirit of a self-owned face-down zone.
const MEMORY_JAR_RETURN_TRIGGER_ID = "memory-jar-return";

export const memoryJar: CardDefinition = {
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
                        // DOWN" (CR 406.3) — genuinely face down, so it is
                        // hidden from its owner's own pile tile too; they may
                        // LOOK, which is the preview's second face (#2904).
                        ctx.exileFaceDown(
                            pid,
                            id,
                            "hand",
                            pid,
                            "face-down-exile"
                        );
                    }
                    payload[`exiled:${pid}`] = handIds.join(",");
                    ctx.drawCards(pid, 7);
                }
                ctx.scheduleDelayedTrigger(
                    memoryJar.id,
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
                for (const pid of ctx.allPlayerIds) {
                    ctx.moveZone(pid, "hand", "graveyard");
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
};
