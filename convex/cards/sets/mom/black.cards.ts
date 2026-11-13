// mom — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import { defineCard } from "../../types";
import { backupTrigger } from "../../abilities/triggers/backupTrigger";

// Consuming Aetherborn — {3}{B} Creature — Aetherborn Vampire, 2/2. "Backup 1
// (When this creature enters, put a +1/+1 counter on target creature. If
// that's another creature, it gains the following ability until end of
// turn.) Lifelink" (CR 702.165 backup, issue #1315 — the first catalogue card
// proving the Backup keyword end-to-end). A SIMPLE Backup card on purpose:
// its only granted ability is the single already-implemented keyword
// `lifelink`, so `backupTrigger(1, ["lifelink"])` is the entire triggered-
// ability body — no other unshipped mechanic involved.
export const consumingAetherborn = defineCard(() => ({
    id: "7311ade8-eb75-40f8-b018-668762aa3b77", // MOM printing (scryfallId)
    name: "Consuming Aetherborn",
    rarity: "common",
    oracleText:
        "Backup 1 (When this creature enters, put a +1/+1 counter on target creature. If that's another creature, it gains the following ability until end of turn.)\nLifelink",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Aetherborn", "Vampire"],
    power: 2,
    toughness: 2,
    // CR 702.165c — "backup N" is board-visible reminder data; "lifelink" is
    // the card's OWN printed ability (both applies to itself always, per CR
    // 702.9, AND is what backupTrigger(1, [...]) grants a non-self target).
    staticAbilities: ["backup 1", "lifelink"],
    triggeredAbilities: [backupTrigger(1, ["lifelink"])],
}));

// Glistening Deluge — {1}{B}{B} Sorcery. "All creatures get -1/-1 until end of
// turn. Creatures that are green and/or white get an additional -2/-2 until
// end of turn." (CR 611.2 — two one-shot effects that each create a
// continuous P/T change; CR 613.4c P/T modification.) Two `forEach`
// sweeps with no `controller` (every player's battlefield): the first hits
// every creature, the second the green-and-or-white subset via
// `filter.color` array (OR semantics, CR 105.2 — a green-white creature matches
// once and takes the additional -2/-2 once).
// hand-tail: All creatures get -1/-1 until end of turn. Creatures that are green and/or white get an additional -2/-2 until end of turn. (#8621)
export const glisteningDeluge = defineCard(() => ({
    id: "83ca46ac-0698-4651-940d-3fd20c266b74", // MOM printing (scryfallId)
    name: "Glistening Deluge",
    rarity: "uncommon",
    oracleText:
        "All creatures get -1/-1 until end of turn. Creatures that are green and/or white get an additional -2/-2 until end of turn.",
    manaCost: { X: 1, B: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$each" },
                    power: -1,
                    toughness: -1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", color: ["G", "W"] },
            },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$each" },
                    power: -2,
                    toughness: -2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
}));
