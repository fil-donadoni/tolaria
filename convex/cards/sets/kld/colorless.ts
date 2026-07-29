// kld (Kaladesh) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeDualLand } from "../../abilities";
import { makeVehicle } from "../../abilities/vehicle";

// The KLD "fast land" cycle — see `makeDualLand`'s `fastLand` flag in
// `convex/cards/abilities/index.ts` for the shared conditional-tapped shape.
// Vintage Cube free tranche (issue #675, ADR 0041).
export const inspiringVantage: CardDefinition = makeDualLand({
    id: "160ac412-005f-48ca-a204-10207307c6c2",
    name: "Inspiring Vantage",
    rarity: "rare",
    colors: ["R", "W"],
    fastLand: true,
});

export const spirebluffCanal: CardDefinition = makeDualLand({
    id: "4e587ea7-0632-4789-ba75-3c410da2bb96",
    name: "Spirebluff Canal",
    rarity: "rare",
    colors: ["U", "R"],
    fastLand: true,
});

export const botanicalSanctum: CardDefinition = makeDualLand({
    id: "8744471b-a528-47d9-84d0-4526273f55e9",
    name: "Botanical Sanctum",
    rarity: "rare",
    colors: ["G", "U"],
    fastLand: true,
});

export const bloomingMarsh: CardDefinition = makeDualLand({
    id: "90da33d4-fe9c-42fe-b326-2fe337dc3ecd",
    name: "Blooming Marsh",
    rarity: "rare",
    colors: ["B", "G"],
    fastLand: true,
});

export const concealedCourtyard: CardDefinition = makeDualLand({
    id: "c8769e97-aee8-4466-a9d7-0f4245ae4a97",
    name: "Concealed Courtyard",
    rarity: "rare",
    colors: ["W", "B"],
    fastLand: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Vehicles (CR 301.7) + Crew (CR 702.122) — issue #777
// ─────────────────────────────────────────────────────────────────────────────

// Smuggler's Copter — {2} Artifact — Vehicle, 3/3. "Flying. Whenever this
// Vehicle attacks or blocks, you may draw a card. If you do, discard a card.
// Crew 1." The engine's first Vehicle (issue #777, unblocking the vintage-cube
// worklist PRD #620 / #674). Built by `makeVehicle`, which emits both the
// board-visible "crew 1" keyword string and its enforcing CR 702.122a activated
// ability (see `cards/abilities/vehicle.ts` for the full modelling note).
//
// The loot trigger is ONE `TriggeredAbility` over an ARRAY of events (the
// multi-event standard, CR 603.2): one Oracle sentence, two engine events
// (ATTACKERS_DECLARED / BLOCKERS_CONFIRMED). Its effect is the bare cost-free
// `mayPay` ("you may…", issue #680) gating the standard draw-then-choose-then-
// discard loot idiom (Vodalian Merchant), so no Op is new here.
//
// One narrowing, out of scope: `BLOCKERS_CONFIRMED` is emitted per
// attacker/blocker PAIR, so a Copter that somehow blocks two attackers at once
// would trigger twice where CR 509.1 fires "whenever this blocks" once. Blocking
// multiple attackers requires an outside effect none of the current pool
// provides, so this is out of scope rather than a tracked gap.
export const smugglersCopter: CardDefinition = makeVehicle({
    id: "7832abb5-5107-4603-904e-491b221bd3e3",
    name: "Smuggler's Copter",
    rarity: "rare",
    manaCost: { X: 2 },
    oracleText:
        "Flying\nWhenever this Vehicle attacks or blocks, you may draw a card. If you do, discard a card.\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)",
    power: 3,
    toughness: 3,
    crew: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "smugglers-copter-loot",
            oracleText:
                "Whenever this Vehicle attacks or blocks, you may draw a card. If you do, discard a card.",
            event: ["ATTACKERS_DECLARED", "BLOCKERS_CONFIRMED"],
            matches: (event, self) =>
                (event.type === "ATTACKERS_DECLARED" &&
                    event.attackerIds.includes(self.id)) ||
                (event.type === "BLOCKERS_CONFIRMED" &&
                    event.blockerId === self.id),
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Draw a card, then discard a card (Smuggler's Copter)?",
                    bind: "$loot",
                },
                {
                    op: "if",
                    predicate: { binding: "$loot" },
                    then: [
                        { op: "draw", player: "controller", count: 1 },
                        {
                            op: "choice",
                            kind: "choose-hand-card",
                            player: "controller",
                            zone: "hand",
                            count: 1,
                            prompt: "Discard a card.",
                            bind: "$discard",
                        },
                        {
                            op: "discard",
                            player: "controller",
                            cards: { ref: "$discard" },
                        },
                    ],
                },
            ],
        },
    ],
});
