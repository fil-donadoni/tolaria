// M3C — black cards, split by colour per ADR 0043. The registry's
// `import * as m3c from "./sets/m3c"` resolves through m3c/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    DamageDealtEvent,
    GameEvent,
    PermanentView,
    SpellContext,
} from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";

// Barrowgoyf — {2}{B} Creature — Lhurgoyf, printed */1+* (Vintage Cube
// residue, issue #1305, parent PRD #620). "Deathtouch, lifelink. Barrowgoyf's
// power is equal to the number of card types among cards in all graveyards
// and its toughness is equal to that number plus 1. Whenever this creature
// deals combat damage to a player, you may mill that many cards. If you do,
// you may put a creature card from among them into your hand."
//
// P/T HALF (CR 604.3 / 613.4c CDA, layer 7a): a `pt-cda` static effect whose
// `compute` counts DISTINCT card types among cards in ALL graveyards —
// generalizes the already-shipped Nethergoyf pattern (mh3/black.ts, "your
// graveyard" only) to every player's graveyard, the one delta the oracle
// text asks for.
//
// TRIGGER HALF: `resolve()` — the earlier #679 stub's blocker (`mill` was
// `status: "planned"`) has since shipped (issue #885), but this ability
// still can't be authored as a DSL `effects: EffectOp[]` script for a
// DIFFERENT, precedented reason (ADR 0045 protocol-card justification, the
// same class already accepted catalogue-wide for Armadillo Cloak / Spirit
// Link / El-Hajjâj — "that much damage"/"that many cards" reads
// `event.amount`, a runtime value with NO `EffectValue` grammar member and
// NO trigger-event `amount` row in `EVENT_FIELD_REGISTRY`, ADR 0049): "mill
// that many cards" is sized off the exact combat damage dealt this
// resolution, which only `DamageDealtEvent.amount` carries. `resolveSteps`
// (not a single `resolve`) is required for correctness, not style: the mill
// is an IRREVERSIBLE action that must run in an EARLIER step than the
// optional-retrieval choice that follows it — the Bazaar of Baghdad
// re-draw class of bug a single `resolve` would hit (a later suspension
// would re-run the whole closure from the top and mill a second time). Step
// 1 decides + performs the mill exactly once and hands the milled ids to
// step 2 via `noteChoice`/`recallChoice` (CR 608.2h last-known information,
// the same channel Chain Lightning uses to survive an irreversible op mid-
// resolution); step 2 offers the optional creature retrieval, restricted to
// exactly those milled ids via `candidateIds` (never the whole graveyard).
export const barrowgoyf: CardDefinition = {
    id: "f979fc86-2c7e-49b3-965e-607a203cbfb1",
    name: "Barrowgoyf",
    rarity: "rare",
    oracleText:
        "Deathtouch, lifelink\nBarrowgoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.\nWhenever this creature deals combat damage to a player, you may mill that many cards. If you do, you may put a creature card from among them into your hand.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Lhurgoyf"],
    power: 0,
    toughness: 0,
    staticAbilities: ["deathtouch", "lifelink"],
    staticEffects: [
        {
            // CR 604.3 — power = distinct card types among cards in ALL
            // graveyards; toughness = that + 1 (Tarmogoyf-style CDA, layer
            // 7a). Generalizes Nethergoyf's controller-only compute
            // (mh3/black.ts) to every player's graveyard.
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (_source, state) => {
                const types = new Set<string>();
                for (const player of state.players) {
                    for (const c of player.graveyard) {
                        for (const t of c.types) types.add(t);
                    }
                }
                const n = types.size;
                return { power: n, toughness: n + 1 };
            },
        },
    ],
    triggeredAbilities: [
        {
            id: "barrowgoyf-combat-damage",
            oracleText:
                "Whenever this creature deals combat damage to a player, you may mill that many cards. If you do, you may put a creature card from among them into your hand.",
            event: "DAMAGE_DEALT",
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "player",
            resolveSteps: [
                // Step 1 (irreversible): "you may mill that many cards" —
                // decide, then mill EXACTLY ONCE. `ctx.triggerEvent` is the
                // firing DAMAGE_DEALT event, persisted on the stack item so
                // it survives re-invocation across suspends (unlike a step
                // function's own local state).
                (ctx: SpellContext) => {
                    const event = ctx.triggerEvent as
                        | DamageDealtEvent
                        | undefined;
                    if (!event || event.type !== "DAMAGE_DEALT") return;
                    const amount = event.amount;
                    if (amount <= 0) return;
                    const controller = ctx.controller;
                    const doMill = ctx.requestMayPay({
                        playerId: controller,
                        choiceId: `barrowgoyf-mill-${ctx.sourceInstanceId}`,
                        prompt: `Mill ${amount} card${amount === 1 ? "" : "s"}?`,
                    });
                    if (doMill === undefined) return; // suspended
                    if (!doMill) return;
                    const milledIds = ctx.peekLibraryTop(controller, amount);
                    ctx.millCards(controller, amount);
                    ctx.noteChoice("barrowgoyf-milled", milledIds);
                },
                // Step 2: "you may put a creature card from among them into
                // your hand" — restricted to exactly the ids step 1 milled.
                (ctx: SpellContext) => {
                    const milledIds = ctx.recallChoice("barrowgoyf-milled");
                    if (!milledIds || milledIds.length === 0) return;
                    const controller = ctx.controller;
                    const gy = ctx.getGraveyardCards(controller);
                    const creatureIds = milledIds.filter((id) =>
                        gy.some(
                            (g) => g.id === id && g.types.includes("Creature")
                        )
                    );
                    if (creatureIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: controller,
                        choiceId: `barrowgoyf-retrieve-${ctx.sourceInstanceId}`,
                        kind: "choose-graveyard-card",
                        zone: "graveyard",
                        count: { min: 0, max: 1 },
                        candidateIds: creatureIds,
                        prompt: "Put a creature card into your hand?",
                    });
                    if (picked === undefined) return; // suspended
                    if (picked.length > 0) {
                        ctx.moveCardById(
                            controller,
                            picked[0],
                            "graveyard",
                            "hand"
                        );
                    }
                },
            ],
        },
    ],
};
