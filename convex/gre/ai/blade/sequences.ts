// Blade SEQUENCE entries (issue #10470, ADR 0185) — see `sequence.ts`.
//
// Two consecutive Bot decisions, the second on the tree the first kept. The
// `must` registry (`scenarios.ts`) is untouched by tree reuse: its entries
// search a fresh tree at their declared iterations. These pin the reuse
// itself — the second decision continues from the subtree the game moved
// into and still answers correctly, on the kept tree and on a fresh one —
// and its drop on an observation the Bot makes.

import type { BladeSequence } from "./sequence";

export const BLADE_SEQUENCES: BladeSequence[] = [
    {
        label: "tree reuse: the land drop, then the creature it pays for, on the kept subtree",
        spec: {
            cards: [
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 10,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        first: [{ kind: "play-land", card: "Forest" }],
        second: [{ kind: "cast-spell", card: "Grizzly Bears" }],
        reuse: "kept",
        note: "Case A of the note (§ 2): the Bot decides again straight after its own move, so the second decision continues from the subtree under the land drop, which the first search visited most.",
    },
    {
        label: "tree reuse: the opponent's own draw between two Bot decisions keeps the tree",
        spec: {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Giant Growth", owner: "me", zone: "hand" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            phase: "UPKEEP",
            turn: 4,
            activePlayer: "opp",
            priority: "me",
            passCount: 1,
            landCount: 0,
            libraryCount: 10,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        first: [{ kind: "pass" }],
        second: [{ kind: "pass" }],
        reuse: "kept",
        note: "The path crosses the OPPONENT's draw: a card moves out of the opponent's library into its hand, both hidden from the Bot, so the Bot observes nothing and the tree is kept. The bench's `botDrew` proxy and a turn-based rule agree with the predicate here only by luck; the next entry is the other half.",
    },
    {
        label: "tree reuse: the Bot's own draw between two decisions drops the tree",
        spec: {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Swamp", owner: "me", zone: "battlefield" },
                { name: "Dark Ritual", owner: "me", zone: "hand" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            phase: "UPKEEP",
            turn: 4,
            activePlayer: "me",
            priority: "me",
            landCount: 0,
            libraryCount: 10,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        first: [{ kind: "pass" }],
        second: [{ kind: "pass" }],
        reuse: { dropped: "observation" },
        note: "The path crosses the Bot's own draw (CR 504.1): a card it did not see at the old root is in its hand now. The tree pools every world's draw, so the kept node would fuse strategies across draws the Bot can tell apart (note § 3): dropped. The Ritual is the real choice that grows a tree at the upkeep; the Bot declines it in both decisions.",
    },
    {
        label: "pondering: the human's instant-speed choice in its draw step, then the Bot's pass, on the pondered subtree",
        spec: {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Giant Growth", owner: "me", zone: "hand" },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "battlefield" },
                { name: "Giant Growth", owner: "opp", zone: "hand" },
            ],
            phase: "UPKEEP",
            turn: 4,
            activePlayer: "opp",
            priority: "me",
            passCount: 1,
            landCount: 0,
            libraryCount: 10,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        deckKnowledge: [
            { seat: "me", cards: ["Grizzly Bears", "Forest", "Giant Growth"] },
            { seat: "opp", cards: ["Hill Giant", "Forest", "Giant Growth"] },
        ],
        budget: { iterations: 200 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        first: [{ kind: "pass" }],
        ponder: { iterations: 200 },
        reply: { kind: "pass" },
        second: [{ kind: "pass" }],
        reuse: "pondered",
        note: "Issue #10472 — the human's real choice between two Bot decisions is pondered: in its draw step (CR 504.2) the active player holds priority with a Giant Growth and an untapped Forest, and may cast it or pass. The human passes, the commonest human action (note § 2). The Bot's answer in the same step continues from the subtree under that pass with pondered visits in it, and passes too — nothing on the board wants its own Growth — on the pondered tree, on the kept tree without pondering and on a fresh one. The human's decklist is known (`expert`), so its cast from hand is an edge of the pondered node (note § 3); the human's own draw is no observation of the Bot's.",
    },
];
