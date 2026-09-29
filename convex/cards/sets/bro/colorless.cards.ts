// bro — colorless cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Haywire Mite — {1} Artifact Creature — Insect, 1/1 (Vintage Cube FREE:
// ETB/dies/attack triggers, issue #679). "When this creature dies, you gain
// 2 life. {G}, Sacrifice this creature: Exile target noncreature artifact or
// noncreature enchantment." CR 603.2 death trigger (DSL `gainLife` Op) +
// CR 605 activated ability with a self-sacrifice cost (DSL `exile` Op). Both
// Ops are already interpreter-exercised — no hand-written test required
// (per-Op regime, ADR 0046).
export const haywireMite: CardDefinition = {
    id: "847a175e-ead1-4596-baf3-5f7f57859e0b",
    name: "Haywire Mite",
    rarity: "uncommon",
    oracleText:
        "When this creature dies, you gain 2 life.\n{G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment.",
    manaCost: { X: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Insect"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "haywire-mite-death",
            oracleText: "When this creature dies, you gain 2 life.",
            event: "CREATURE_DIED",
            matches: (event, self) =>
                event.type === "CREATURE_DIED" &&
                event.creatureInstanceId === self.id,
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
    ],
    activatedAbilities: [
        {
            id: "haywire-mite-sac",
            oracleText:
                "{G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment.",
            cost: { mana: { G: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                excludeTypes: "Creature",
                count: 1,
            },
            effects: [{ op: "exile", target: { target: 0 } }],
        },
    ],
};

// Portal to Phyrexia — {9} Artifact. "When this artifact enters, each
// opponent sacrifices three creatures of their choice. At the beginning of
// your upkeep, put target creature card from a graveyard onto the
// battlefield under your control. It's a Phyrexian in addition to its other
// types." (issue #1965 — re-audited off #920; the original blocker is gone.)
//
// ETB (CR 603.6a): 2-player-only (CLAUDE.md — no 3+ player multiplayer), so
// "each opponent" is exactly the one opponent — the Innocent Blood shape
// (`choice(kind: "sacrifice-permanents")` binds up to 3 picks, clamped to
// however many creatures exist per CR 608.2b, then `sacrifice` consumes the
// binding) with no `forEach` needed.
//
// Upkeep (CR 603.3d target-at-announcement + CR 400.7 / 800.4a reanimation):
// the Reya Dawnbringer / Reanimate shape — a `targetRequirement` on the
// triggered ability itself (`zone: "graveyard"`, `controller: "any"` = "a
// graveyard", not just the controller's own), then `moveZone` with
// `controller: "controller"` puts it under the ability's controller
// regardless of who owned the graveyard. `bind: "$reanimated"` snapshots the
// permanent that just entered so `addSubtype` (CR 613.1d, layer 4 — the Guide
// of Souls "it becomes an Angel in addition to its other types" shape) can
// target it: "It's a Phyrexian in addition to its other types" is an
// indefinite grant on the reanimated object itself, not on Portal to
// Phyrexia, so it survives Portal leaving the battlefield — exactly what
// `addSubtype`'s no-`duration` semantics express. No new Op needed.
export const portalToPhyrexia: CardDefinition = {
    id: "5f608efc-0dbc-4cc3-aadd-ed473bfc29ab",
    name: "Portal to Phyrexia",
    rarity: "mythic",
    oracleText:
        "When this artifact enters, each opponent sacrifices three creatures of their choice.\nAt the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control. It's a Phyrexian in addition to its other types.",
    manaCost: { X: 9 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "portal-to-phyrexia-etb",
            oracleText:
                "When this artifact enters, each opponent sacrifices three creatures of their choice.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "opponent",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 3,
                    prompt: "Portal to Phyrexia: choose three creatures to sacrifice.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        }),
        phaseTrigger({
            id: "portal-to-phyrexia-upkeep",
            oracleText:
                "At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control. It's a Phyrexian in addition to its other types.",
            phase: "UPKEEP",
            scope: "your",
            // CR 603.3d — a real announced target chosen when the trigger
            // goes on the stack. "a graveyard" (not "your graveyard") =
            // `controller: "any"`, the Soul-Guide Lantern / Reanimate shape.
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
                    target: { ref: "$reanimated" },
                    subtype: "Phyrexian",
                },
            ],
        }),
    ],
};
