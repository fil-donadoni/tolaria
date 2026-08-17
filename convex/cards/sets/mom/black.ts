// mom — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import { backupTrigger } from "../../abilities/triggers/backupTrigger";

// Consuming Aetherborn — {3}{B} Creature — Aetherborn Vampire, 2/2. "Backup 1
// (When this creature enters, put a +1/+1 counter on target creature. If
// that's another creature, it gains the following ability until end of
// turn.) Lifelink" (CR 702.165 backup, issue #1315 — the first catalogue card
// proving the Backup keyword end-to-end). A SIMPLE Backup card on purpose:
// its only granted ability is the single already-implemented keyword
// `lifelink`, so `backupTrigger(1, ["lifelink"])` is the entire triggered-
// ability body — no other unshipped mechanic involved.
export const consumingAetherborn: CardDefinition = {
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
};
