// vow — multicolor cards (ADR 0043 colour split). Modern Scryfall oracle
// text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { createBloodTokenOp } from "../../abilities/tokens/bloodToken";

// Bloodtithe Harvester — {B}{R} Creature — Vampire, 3/2 (VOW 232, Vintage
// Cube FREE residue tranche, issue #1309, parent PRD #620). "When this
// creature enters, create a Blood token. (It's an artifact with "{1}, {T},
// Discard a card, Sacrifice this token: Draw a card.")\n{T}, Sacrifice this
// creature: Target creature gets -X/-X until end of turn, where X is twice
// the number of Blood tokens you control. Activate only as a sorcery."
//
// Ability 1 — CR 603.6a self-ETB `createToken` reusing the shared
// `BLOOD_TOKEN_SPEC` (`createBloodTokenOp`, issue #778), the exact
// Voldaren Epicure shape (`vow/red.ts`) one file over.
//
// Ability 2 — CR 602.5b/602.3b activated ability, tap + sacrifice-self cost
// (`cost: { tap: true, sacrifice: true }`) restricted to sorcery timing
// (`sorcerySpeedOnly: true`) — the exact Dauthi Voidwalker shape
// (`mh2/black.ts`, issue #1156) that unblocked `ActivatedAbility.
// sorcerySpeedOnly`. The body is a single announced-target `pump` Op
// (CR 611.2, issue #840): `power`/`toughness` are `{ negate: { count: {...,
// times: 2 } } }` — the SIGNED value grammar's negation (issue #926, Toxic
// Deluge's -X/-X shape, `c13/black.ts`) wrapping a `count` of the
// controller's battlefield permanents with subtype Blood, scaled `times: 2`
// ("twice the number of ...", the Price of Progress `EffectCountSpec.times`
// shape, issue #999, `exo/red.ts`) — no new Op, no new value grammar member,
// pure composition of three already-shipped primitives. Read live at
// resolution: the sacrificed Bloodtithe Harvester is gone by then (CR 602.1
// cost paid before the ability resolves) but its own Blood tokens are
// unaffected (only itself was sacrificed as the cost), so the count reflects
// whatever Bloods the controller still holds. Reuses ONLY already-exercised
// interpreter constructs (negate/count/pump each carry their own suite
// coverage), but the auto-generated canned-scenario smoke test cannot
// faithfully scenario-ize a non-literal `pump` amount (documented explicit
// skip, `scenarioGenerator.ts`'s `pump` case, the same Toxic Deluge
// exception) — a hand-written test lives in
// `convex/cards/sets/vow/__tests__/multicolor.test.ts` per that "explicit
// skip" fallback in `.claude/rules/gre-development.md`.
export const bloodtitheHarvester: CardDefinition = {
    id: "f0192cf7-3391-4720-b9c8-72dec5dde01e", // VOW 232
    rarity: "uncommon",
    name: "Bloodtithe Harvester",
    oracleText:
        'When this creature enters, create a Blood token. (It\'s an artifact with "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.")\n{T}, Sacrifice this creature: Target creature gets -X/-X until end of turn, where X is twice the number of Blood tokens you control. Activate only as a sorcery.',
    manaCost: { B: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Vampire"],
    power: 3,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "bloodtithe-harvester-etb",
            oracleText: "When this creature enters, create a Blood token.",
            scope: "self",
            effects: [createBloodTokenOp()],
        }),
    ],
    activatedAbilities: [
        {
            id: "bloodtithe-harvester-sac",
            oracleText:
                "{T}, Sacrifice this creature: Target creature gets -X/-X until end of turn, where X is twice the number of Blood tokens you control. Activate only as a sorcery.",
            cost: { tap: true, sacrifice: true },
            sorcerySpeedOnly: true,
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: {
                        negate: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { subtype: "Blood" },
                                times: 2,
                            },
                        },
                    },
                    toughness: {
                        negate: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { subtype: "Blood" },
                                times: 2,
                            },
                        },
                    },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
