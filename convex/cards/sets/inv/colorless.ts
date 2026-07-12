// inv (Invasion) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Colourless artifacts (no coloured
// cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import {
    hasNonManaActivatedAbility,
    untapRestriction,
} from "../../abilities/static/untapRestriction";

// Tsabo's Web — {2} Artifact. "When this artifact enters, draw a card. Each
// land with an activated ability that isn't a mana ability doesn't untap during
// its controller's untap step." (Premodern-legal utility-land hoser, PRD #979.)
//
// Part (a) — the ETB cantrip is a self-scoped `enteredTrigger` running a single
// `draw` Op (CR 603.6a, CR 121.1), DSL-first (ADR 0045).
//
// Part (b) — the untap lock is a continuous `untap-restriction` static effect
// (CR 502.1). Its target set — "each land with an activated ability that isn't a
// mana ability" — depends on the land's card DEFINITION (its
// `activatedAbilities`), which `PermanentFilter` doesn't carry, so it uses the
// `dynamicMatch` refinement: the base `filter` scopes to lands, and
// `hasNonManaActivatedAbility` (a non-mana ability is `useStack: true`,
// CR 605.1a — NO tap-cost requirement, so no-{T} animate creaturelands like
// Creeping Tar Pit are caught) selects the qualifying ones at untap-collection
// time. `maxUntap: 0` makes it a hard skip — matching lands cannot untap while
// Tsabo's Web is in play (mana-only lands untap normally).
export const tsabosWeb: CardDefinition = {
    id: "0dee69f8-cceb-41b9-a0ee-6b2ac9f4bad9",
    rarity: "rare",
    name: "Tsabo's Web",
    oracleText:
        "When this artifact enters, draw a card.\nEach land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "tsabos-web-etb-draw",
            oracleText: "When this artifact enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    staticEffects: [
        untapRestriction({
            id: "tsabos-web-untap-lock",
            oracleText:
                "Each land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.",
            filter: { types: "Land" },
            maxUntap: 0,
            dynamicMatch: (_candidate, def) => hasNonManaActivatedAbility(def),
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Power Armor — {4} Artifact. "Domain — {3}, {T}: Target creature gets
// +1/+1 until end of turn for each basic land type among lands you
// control." (CR 605 activated ability, CR 611.1 temporary P/T, CR 702
// preamble Domain ability word, issue #1066.) The `pump` Op's `power`/
// `toughness` are the ninth EffectValue grammar member `{ domain: { of } }`
// — no arithmetic needed, a straight reuse of the same value member Tribal
// Flames uses for `dealDamage`.
export const powerArmor: CardDefinition = {
    id: "ed1981dd-c0f3-4e9d-a1f1-8bea823326ef",
    name: "Power Armor",
    rarity: "uncommon",
    oracleText:
        "Domain — {3}, {T}: Target creature gets +1/+1 until end of turn for each basic land type among lands you control.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "power-armor-pump",
            oracleText:
                "{3}, {T}: Target creature gets +1/+1 until end of turn for each basic land type among lands you control.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: { domain: { of: "controller" } },
                    toughness: { domain: { of: "controller" } },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
