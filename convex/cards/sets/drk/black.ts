// The Dark (DRK), split by colour per ADR 0043. The expansion after Legends
// (119 unique cards); every entry is a CardDefinition — The Dark has zero
// reprints of already-implemented cards, so there are no CardPrint stubs
// (ADR 0014). Modern Scryfall oracle text is authoritative (ADR 0004);
// canonical names / costs / P/T are sourced from MTGJSON `data/json/DRK.json`.
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are
// classified by the colour identity of their mana cost (CR 202.2); lands and
// artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    SpellContext,
    TargetSelection,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// ═════════════════════════════════════════════════════════════════════════════
// BLACK free tranche (#413) — all 17 DRK Black cards. Every card is expressible
// with shipped primitives plus three small orthogonal engine reads/writes
// (getHandCards colours, discardAtRandom type filter, failToEnter) and one new
// combat event (ATTACKER_UNBLOCKED). Modern Scryfall oracle (ADR 0004); stats
// validated against DRK.json.
// ═════════════════════════════════════════════════════════════════════════════

// Ashes to Ashes — "Exile two target nonartifact creatures. Ashes to Ashes
// deals 5 damage to you." (CR 701.18 exile two distinct creature targets, CR
// 601.2c; `excludeTypes: "Artifact"` enforces "nonartifact"; CR 119 the 5
// damage to the caster.)
export const ashesToAshes: CardDefinition = {
    id: "825496e5-19c7-4f50-8070-0265a58608dc",
    rarity: "common",
    name: "Ashes to Ashes",
    oracleText:
        "Exile two target nonartifact creatures. Ashes to Ashes deals 5 damage to you.",
    manaCost: { X: 1, B: 2 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 2,
        excludeTypes: "Artifact",
    },
    // Migrated resolve()→effects[] (ADR 0045, #832): exile both announced
    // targets (CR 701.13), then 5 damage to the controller (CR 120).
    effects: [
        { op: "exile", target: { target: 0 } },
        { op: "exile", target: { target: 1 } },
        { op: "dealDamage", amount: 5, to: { player: "controller" } },
    ],
};

// Banshee — "{X}, {T}: This creature deals half X damage, rounded down, to any
// target, and half X damage, rounded up, to you." (CR 605 activated ability
// with an {X} cost read at activation via `ctx.getX()`; CR 115.4 "any target";
// CR 119 the floor/ceil split of half X.)
export const banshee: CardDefinition = {
    id: "66eaa7d6-48b2-4b35-a834-790edd679e0e",
    rarity: "uncommon",
    name: "Banshee",
    oracleText:
        "{X}, {T}: This creature deals half X damage, rounded down, to any target, and half X damage, rounded up, to you.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "banshee-half-x",
            oracleText:
                "{X}, {T}: This creature deals half X damage, rounded down, to any target, and half X damage, rounded up, to you.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            // NOT DSL-migratable (ADR 0045, #852): "half X rounded down / up" is
            // floor(X/2) and ceil(X/2) — ARITHMETIC (division) the value grammar
            // has no construct for. `{ X: true }` supplies X but cannot halve it.
            // Classifier over-count (folds dealDamage + getX, blind to the math).
            resolve: (ctx: SpellContext) => {
                const x = ctx.getX();
                const toTarget = Math.floor(x / 2);
                const toSelf = Math.ceil(x / 2);
                const [target] = ctx.targets;
                if (
                    toTarget > 0 &&
                    (target?.type === "player" || target?.type === "permanent")
                ) {
                    ctx.dealDamage(target, toTarget);
                }
                if (toSelf > 0) {
                    ctx.dealDamage(
                        { type: "player", id: ctx.controller },
                        toSelf
                    );
                }
            },
        },
    ],
};

// Bog Imp — vanilla flier (CR 702.9). Keyword on `staticAbilities[]`.
export const bogImp: CardDefinition = {
    id: "e3bb7271-634a-4612-9073-7a5438e8c2b8",
    rarity: "common",
    name: "Bog Imp",
    oracleText: "Flying",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Imp"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
};

// Bog Rats — "This creature can't be blocked by Walls." (CR 509.1b block
// restriction, `side: "attacker"`: a candidate blocker that is a Wall is
// rejected. CR 205.3 the Wall subtype.)
export const bogRats: CardDefinition = {
    id: "d64c9153-bc6d-4a64-885f-c039a5487a31",
    rarity: "common",
    name: "Bog Rats",
    oracleText: "This creature can't be blocked by Walls.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Rat"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "bog-rats-no-wall-blockers",
            oracleText: "This creature can't be blocked by Walls.",
            side: "attacker",
            // self = Bog Rats (attacker), opponent = candidate blocker. The
            // block is legal unless the blocker is a Wall.
            predicate: (_self, opponent) => !opponent.subtypes.includes("Wall"),
        },
    ],
};

// Curse Artifact — Aura enchant artifact. "At the beginning of the upkeep of
// enchanted artifact's controller, this Aura deals 2 damage to that player
// unless they sacrifice that artifact." (CR 603.6a upkeep trigger scoped to the
// HOST's controller + CR 117.3a do-X-unless-you-sacrifice; mirrors Erosion's
// host-controller scope, but the "unless" is a sacrifice of the host, not a
// mana/life payment, and the consequence is 2 damage rather than destroy.)
export const curseArtifact: CardDefinition = {
    id: "9fc0d070-8a42-4d5e-8f2b-ceb59147de6f",
    rarity: "uncommon",
    name: "Curse Artifact",
    oracleText:
        "Enchant artifact\nAt the beginning of the upkeep of enchanted artifact's controller, this Aura deals 2 damage to that player unless they sacrifice that artifact.",
    manaCost: { X: 2, B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "curse-artifact-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted artifact's controller, this Aura deals 2 damage to that player unless they sacrifice that artifact.",
            phase: "UPKEEP",
            scope: "host-controller",
            // NOT DSL-migratable (ADR 0045): two gaps remain even though
            // `sacrifice` now takes a `target: EffectObjectSelector` (issue
            // #1083) — (1) there is no object-ref/selector naming "the
            // permanent this Aura is attached to" (no `$host`-style binding;
            // `EffectObjectSelector` only reaches an announced target slot,
            // `$source`, or a `forEach` `$each`), so the enchanted artifact
            // can't be named as a sacrifice target; (2) the payer is the
            // HOST's current controller (CR 603.10 LKI, re-read at resolve),
            // which has no `EffectPlayerRef` selector (`controller` /
            // `opponent` / `{ target }` / `{ controllerOf }` all name
            // something other than an aura's host-controller). Stays
            // resolve().
            resolve: (ctx, _event, scopedPlayerId) => {
                const hostId = ctx.getAttachedToId();
                if (hostId === undefined) return; // host gone — nothing to do
                // CR 117.3a — offer to sacrifice the enchanted artifact;
                // declining (or being unable) takes 2 damage.
                const sacrifice = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `curse-artifact-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice the enchanted artifact to avoid 2 damage?",
                });
                if (sacrifice === undefined) return; // suspended
                if (sacrifice) {
                    ctx.sacrifice(hostId);
                    return;
                }
                ctx.dealDamage({ type: "player", id: scopedPlayerId }, 2);
            },
        }),
    ],
};

// Eater of the Dead — "{0}: If this creature is tapped, exile target creature
// card from a graveyard and untap this creature." (CR 605 activated ability
// with a free {0} cost gated on the source being tapped via `canActivate`; CR
// 701.18 exile the graveyard-card target; CR 701.20b untap. The famous "untap
// loop" is harmless here — each activation requires a distinct creature card in
// a graveyard, so it terminates when graveyards run dry.)
export const eaterOfTheDead: CardDefinition = {
    id: "d89fe2be-bb7e-4bae-9b1f-9f0d58f20ceb",
    rarity: "uncommon",
    name: "Eater of the Dead",
    oracleText:
        "{0}: If this creature is tapped, exile target creature card from a graveyard and untap this creature.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 3,
    toughness: 4,
    activatedAbilities: [
        {
            id: "eater-of-the-dead-exile-untap",
            oracleText:
                "{0}: If this creature is tapped, exile target creature card from a graveyard and untap this creature.",
            cost: {},
            useStack: true,
            // CR 605 — the "if tapped" clause gates legality; activating while
            // untapped is illegal.
            canActivate: (source) => source.isTapped === true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            // Migrated resolve()→effects[] (ADR 0045, #842): exile the announced
            // graveyard creature-card target (moveZone graveyard→exile, CR
            // 701.13), then untap the source (CR 701.26b). The "if tapped" gate
            // is enforced by `canActivate` above.
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "exile" },
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        },
    ],
};

// Frankenstein's Monster — DEFERRED (TODO(#413)). "As this creature enters,
// exile X creature cards from your graveyard. ... For each creature card exiled
// this way, this creature enters with a +2/+0, +1/+1, or +0/+2 counter on it."
// Needs an "as it enters, choose-and-exile X cards from YOUR GRAVEYARD" pick at
// resolution: a graveyard-zone `requestChoice` kind. The PendingChoice zone-pick
// plumbing (requestChoice `zone` union, the submit-validator zone branches in
// `pendingChoiceSubmit.ts`) supports battlefield/hand/library only — there is no
// graveyard pick. Modeling the exile as cast-time TARGETS would change the
// timing semantics ("as it enters" → targeted on the stack) and the per-counter
// choice cadence, so it would be a fake. The counter placement and CDA-from-
// counters parts are all shipped; only the graveyard pick is missing. Defer the
// whole card until the graveyard-pick choice kind lands. NOT registered (no
// exported CardDefinition) to keep the pool honest.

// Grave Robbers — "{B}, {T}: Exile target artifact card from a graveyard. You
// gain 2 life." (CR 605 activated ability; CR 701.18 exile the graveyard-card
// target filtered to artifacts; CR 119.3 lifegain.)
export const graveRobbers: CardDefinition = {
    id: "a131605a-f646-4745-a1e4-48d155a3d94f",
    rarity: "rare",
    name: "Grave Robbers",
    oracleText:
        "{B}, {T}: Exile target artifact card from a graveyard. You gain 2 life.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Rogue"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "grave-robbers-exile-artifact",
            oracleText:
                "{B}, {T}: Exile target artifact card from a graveyard. You gain 2 life.",
            cost: { tap: true, mana: { B: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            // Migrated resolve()→effects[] (ADR 0045, #839): exile the targeted
            // graveyard artifact card (CR 400.7), then gain 2 life (CR 119.3).
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "exile" },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        },
    ],
};

// Inquisition — "Target player reveals their hand. Inquisition deals damage to
// that player equal to the number of white cards in their hand." (CR 701.x
// reveal; CR 202.2 colour count via `getHandCards().colors`; CR 119 damage.)
export const inquisition: CardDefinition = {
    id: "5f133f06-6398-4db1-8577-66c16fd3e00d",
    rarity: "common",
    name: "Inquisition",
    oracleText:
        "Target player reveals their hand. Inquisition deals damage to that player equal to the number of white cards in their hand.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const [target] = ctx.targets;
        if (target?.type !== "player") return;
        const playerId = target.id;
        ctx.revealHand(playerId);
        const whiteCount = ctx
            .getHandCards(playerId)
            .filter((c) => c.colors.includes("W")).length;
        if (whiteCount > 0)
            ctx.dealDamage({ type: "player", id: playerId }, whiteCount);
    },
};

// Marsh Gas — "All creatures get -2/-0 until end of turn." (CR 611.2 temporary
// P/T mod on every creature; mirrors Holy Light's iterate-all-creatures shape.)
export const marshGas: CardDefinition = {
    id: "b80ecb15-258b-4fc9-86e4-c2bf01891606",
    rarity: "common",
    name: "Marsh Gas",
    oracleText: "All creatures get -2/-0 until end of turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] (ADR 0045, #840): all-creatures pump →
    // forEach over every battlefield's creatures, pump each -2/0 EOT (CR 611.2).
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
                    power: -2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Murk Dwellers — "Whenever this creature attacks and isn't blocked, it gets
// +2/+0 until end of combat." (CR 509.1h — the new ATTACKER_UNBLOCKED combat
// event fires once per unblocked attacker when the block graph is finalized;
// CR 611.2 the +2/+0 pump scoped to end of combat.)
export const murkDwellers: CardDefinition = {
    id: "a213450f-02f4-4c08-8da8-891ebfa8e237",
    rarity: "common",
    name: "Murk Dwellers",
    oracleText:
        "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "murk-dwellers-unblocked-pump",
            oracleText:
                "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            // Migrated resolve()→effects[] (ADR 0045, #840): self-pump +2/0
            // until end of combat (CR 611.2).
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-combat" },
                },
            ],
        },
    ],
};

// Nameless Race — "Trample\nAs this creature enters, pay any amount of life.
// The amount you pay can't be more than the total number of white nontoken
// permanents your opponents control plus the total number of white cards in
// their graveyards.\nNameless Race's power and toughness are each equal to the
// life paid as it entered." (CR 702.19 trample; CR 614.12 "as it enters" pay-
// life choice capped by an opponent-board count; CR 604.3 the CDA reading the
// paid amount, stored as a named counter so it survives the wire projection.)
// The cap and the paid amount are computed in a `resolveSteps` body; the chosen
// amount is written as "life-paid" counters and the base P/T is set from it via
// `setSelfBody`.
export const namelessRace: CardDefinition = {
    id: "348a467a-4661-4fdb-af1d-9171a1a930d9",
    rarity: "rare",
    name: "Nameless Race",
    oracleText:
        "Trample\nAs this creature enters, pay any amount of life. The amount you pay can't be more than the total number of white nontoken permanents your opponents control plus the total number of white cards in their graveyards.\nNameless Race's power and toughness are each equal to the life paid as it entered.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    power: 0,
    toughness: 0,
    staticAbilities: ["trample"],
    resolveSteps: [
        (ctx: SpellContext) => {
            // CR 614.12 — compute the cap: white nontoken permanents opponents
            // control + white cards in their graveyards.
            let cap = 0;
            for (const pid of ctx.allPlayerIds) {
                if (pid === ctx.controller) continue;
                cap += ctx.getBattlefieldIds(pid, {
                    colors: "W",
                    isToken: false,
                }).length;
                cap += ctx
                    .getGraveyardCards(pid)
                    .filter((c) => c.colors.includes("W")).length;
            }
            // The player also can't pay more life than they have (CR 118.4 —
            // can't pay life you don't have).
            const maxPayable = Math.min(cap, ctx.getLife(ctx.controller));
            if (maxPayable <= 0) {
                // Enters as a 0/0; the lethal-toughness SBA puts it in the
                // graveyard immediately (CR 704.5f). Nothing to choose.
                ctx.setSelfBody({ power: 0, toughness: 0 });
                return;
            }
            const options = Array.from({ length: maxPayable + 1 }, (_, n) => ({
                id: String(n),
                label: `Pay ${n} life`,
            }));
            const choice = ctx.requestOptionChoice({
                playerId: ctx.controller,
                choiceId: `nameless-race-life-${ctx.sourceInstanceId}`,
                options,
                prompt: "Pay any amount of life (caps Nameless Race's P/T).",
            });
            if (choice === undefined) return; // suspended
            const paid = Number(choice);
            if (paid > 0) ctx.loseLife(ctx.controller, paid);
            // CR 604.3 — base P/T set from the life paid as it entered.
            ctx.setSelfBody({ power: paid, toughness: paid });
        },
    ],
};

// Rag Man — "{B}{B}{B}, {T}: Target opponent reveals their hand and discards a
// creature card at random. Activate only during your turn." (CR 605 activated
// ability with `controllerTurnOnly`; CR 701.x reveal; CR 701.8a the filtered
// random discard via `discardAtRandom(..., "Creature")`.)
export const ragMan: CardDefinition = {
    id: "f4c133b8-8383-433f-be96-c47a937287b7",
    rarity: "rare",
    name: "Rag Man",
    oracleText:
        "{B}{B}{B}, {T}: Target opponent reveals their hand and discards a creature card at random. Activate only during your turn.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Minion"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "rag-man-discard",
            oracleText:
                "{B}{B}{B}, {T}: Target opponent reveals their hand and discards a creature card at random. Activate only during your turn.",
            cost: { tap: true, mana: { B: 3 } },
            useStack: true,
            controllerTurnOnly: true,
            targetRequirement: {
                type: "player",
                controller: "opponent",
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type !== "player") return;
                ctx.revealHand(target.id);
                ctx.discardAtRandom(target.id, 1, "Creature");
            },
        },
    ],
};

// Season of the Witch — "At the beginning of your upkeep, sacrifice this
// enchantment unless you pay 2 life.\nAt the beginning of the end step, destroy
// all untapped creatures that didn't attack this turn, except for creatures
// that couldn't attack." (CR 603.6a + CR 118.4 upkeep pay-2-life-or-sacrifice;
// CR 603.6a each end step a mass destroy of untapped creatures that didn't
// attack — excepting those that "couldn't attack": creatures with defender or
// that were summoning-sick this turn.)
export const seasonOfTheWitch: CardDefinition = {
    id: "06900a71-34ca-48c6-94ac-fca744356829",
    rarity: "rare",
    name: "Season of the Witch",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay 2 life.\nAt the beginning of the end step, destroy all untapped creatures that didn't attack this turn, except for creatures that couldn't attack.",
    manaCost: { B: 3 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "season-of-the-witch-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay 2 life.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): a `mayPay(cost:{life:2})` Op pays
            // the cost inside `applyMayPaySubmit` (the mutation-level submit
            // handler) at ACCEPT time — `SpellContext.requestMayPay`'s resume
            // path only reads the stored yes/no answer back, it never deducts
            // life itself (`convex/gre/state.ts`). This card's OWN per-card
            // test (`black.test.ts`, untouched per the migration playbook)
            // drives the answer through the raw `answerChoice` shim, which
            // writes `collectedChoices` directly and bypasses
            // `applyMayPaySubmit` entirely — so a `mayPay`-Op version would
            // resume with `$paid=true` but no life ever deducted, silently
            // failing the pre-existing "paying 2 life keeps it" assertion.
            // Reusing the exact `mayPay+if+sacrifice` shape Vile Consumption
            // ships (`inv/multicolor.ts`) is correct in PRODUCTION (which
            // always goes through the real submit mutation) but not provably
            // equivalent against this test harness without editing the test —
            // forbidden by the migration playbook. Stays resolve(), which pays
            // the 2 life manually via `ctx.loseLife` right after reading the
            // boolean, matching what `answerChoice` alone can drive.
            resolve: (ctx) => {
                const controller = ctx.controller;
                // CR 118.4 — can't pay 2 life you don't have: forced sacrifice.
                if (ctx.getLife(controller) < 2) {
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                const pay = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: `season-of-the-witch-${ctx.sourceInstanceId}`,
                    prompt: "Pay 2 life to keep Season of the Witch?",
                });
                if (pay === undefined) return; // suspended
                if (pay) {
                    ctx.loseLife(controller, 2);
                    return;
                }
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
        phaseTrigger({
            id: "season-of-the-witch-end-step",
            oracleText:
                "At the beginning of the end step, destroy all untapped creatures that didn't attack this turn, except for creatures that couldn't attack.",
            phase: "END_STEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045): the destroy set is filtered by
            // runtime predicates (hasAttackedThisTurn / isSummoningSick /
            // defender) the forEach `permanents` selector can't express (it
            // filters only by type/subtype). Stays resolve().
            resolve: (ctx) => {
                // CR 603.6a — every untapped creature that didn't attack this
                // turn and could have attacked is destroyed. "Couldn't attack"
                // is approximated by the two structural reasons in this pool: a
                // creature with defender, or one that was summoning-sick this
                // turn (CR 508.1a). Tapped creatures are excluded by the
                // `tapped: false` filter (CR 508.1g).
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                        tapped: false,
                    })) {
                        const ref = { type: "permanent" as const, id };
                        if (ctx.hasAttackedThisTurn(ref)) continue;
                        if (ctx.hasStaticAbility(ref, "defender")) continue;
                        if (ctx.isSummoningSick(ref)) continue;
                        ctx.destroy(ref);
                    }
                }
            },
        }),
    ],
};

// The Fallen — "At the beginning of your upkeep, this creature deals 1 damage to
// each opponent and planeswalker it has dealt damage to this game." (CR 603.6a
// upkeep trigger; "dealt damage to this game" is tracked with a named flag
// counter — a `damageDealtTrigger` stamps "fallen-marked" the first time The
// Fallen damages an opponent, and the upkeep trigger deals 1 to that opponent
// while the flag is set. Planeswalkers are out of scope, so only the opponent
// player is tracked — exactly one opponent in a 2-player game.)
export const theFallen: CardDefinition = {
    id: "f4a176e1-b22b-4f36-ba7b-c506cb4e1bed",
    rarity: "uncommon",
    name: "The Fallen",
    oracleText:
        "At the beginning of your upkeep, this creature deals 1 damage to each opponent and planeswalker it has dealt damage to this game.",
    manaCost: { X: 1, B: 3 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        // Stamp a persistent "has dealt damage to an opponent this game" flag
        // the first (and every) time The Fallen deals damage to a player.
        damageDealtTrigger({
            id: "the-fallen-mark",
            oracleText:
                "Marks each opponent The Fallen has dealt damage to this game.",
            source: "self",
            target: { kind: "player", player: { relation: "opponent" } },
            // Migrated resolve()→effects[] (ADR 0045, issue #1015): the
            // `damageDealtTrigger` factory now exposes an `effects[]` site;
            // the body is a plain `counters` add on `$source` (Powder Keg
            // shape, `uds/colorless.ts`).
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "fallen-marked",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
        phaseTrigger({
            id: "the-fallen-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 1 damage to each opponent and planeswalker it has dealt damage to this game.",
            phase: "UPKEEP",
            scope: "your",
            // Migrated resolve()→effects[] (ADR 0045, issue #1015): the
            // `counters` EffectValue member (a SIXTH grammar member, not a new
            // Op) reads the LIVE "fallen-marked" counter count on `$source`
            // directly in an `if` comparison predicate — the flag is a
            // non-zero counter set by the mark trigger above. One opponent in
            // a 2-player game (CR 102.2), so "each opponent" is the plain
            // `"opponent"` player selector.
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: {
                            counters: {
                                of: { ref: "$source" },
                                type: "fallen-marked",
                            },
                        },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: "opponent" },
                        },
                    ],
                },
            ],
        }),
    ],
};

// Uncle Istvan — "Prevent all damage that would be dealt to this creature by
// creatures." (CR 615 — a continuous damage-prevention replacement that
// consumes any damage event whose source is a creature and whose target is
// Uncle Istvan; the Desert Nomads shape but filtered on `sourceTypes` rather
// than `sourceSubtypes`.)
export const uncleIstvan: CardDefinition = {
    id: "848ad6d5-3a7e-4d6b-9929-36465796871f",
    rarity: "uncommon",
    name: "Uncle Istvan",
    oracleText:
        "Prevent all damage that would be dealt to this creature by creatures.",
    manaCost: { X: 1, B: 3 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 3,
    replacementEffects: [
        {
            id: "uncle-istvan-prevent-creature-damage",
            oracleText:
                "Prevent all damage that would be dealt to this creature by creatures.",
            eventKind: "damage",
            appliesTo: (event, self) =>
                event.kind === "damage" &&
                event.target.type === "permanent" &&
                event.target.id === self.id &&
                event.sourceTypes.includes("Creature"),
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

// Word of Binding — "Tap X target creatures." (CR 601.2c a variable number of
// creature targets fixed at announcement by X; CR 701.20a tap each.) Mana
// cost is {X}{B}{B} (MTGJSON DRK.json) — `X: 1` (a FIXED generic amount, not
// the variable marker `"X"`) was a typo the widened data/json conformance
// guard caught: `hasX` (gre/moves.ts) keys on `typeof cost.X === "string"`,
// so with a fixed X this was never offered as an X spell at all, and its own
// `count: "X"` targetRequirement below had no announced X to resolve against.
export const wordOfBinding: CardDefinition = {
    id: "ee30efdb-f1f1-497f-80a6-ec961db67c1d",
    rarity: "common",
    name: "Word of Binding",
    oracleText: "Tap X target creatures.",
    manaCost: { X: "X", B: 2 },
    types: ["Sorcery"],
    // CR 601.2c — "X target creatures": the number of targets equals X. The
    // engine resolves the count from `chosenX` at announcement.
    targetRequirement: { type: "Creature", count: "X" },
    // Migrated resolve()→effects[] (ADR 0045, issue #1083): the
    // `forEach { set: "targets" }` selector iterates the WHOLE announced
    // target set (the X-multi-target companion to a fixed `{ target: N }`
    // slot, Distorting Wake shape) — tap each (CR 701.26a).
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [
                { op: "tapUntap", action: "tap", target: { ref: "$each" } },
            ],
        },
    ],
};

// Worms of the Earth — {2}{B}{B}{B} Enchantment.
// "Players can't play lands.\nLands can't enter the battlefield.\nAt the
//  beginning of each upkeep, any player may sacrifice two lands of their choice
//  or have this enchantment deal 5 damage to that player. If a player does
//  either, destroy this enchantment."
//
// Two prohibitions (CR 614 — a land that would enter is prevented; a player
// can't take the land-play special action, CR 305.1):
//   • `preventsLandPlayAndETB: true` — a CardDefinition marker scanned live
//     from the battlefield (like Fastbond's `extraLandDrops`). `getLegalActions`
//     suppresses the "play" land action and every battlefield-entry site
//     (`canLandEnterBattlefield`) prevents a land from entering. The lock lifts
//     automatically the instant Worms leaves play (no LTB cleanup); the engine
//     mirrors it into `state.landPlayLocked` for serialization.
//
// Upkeep clause (CR 603.6a "each" upkeep; CR 117.3a optional; CR 701.16
// sacrifice): on EVERY player's upkeep, that player MAY (a) sacrifice two of
// their lands, OR (b) take 5 damage from Worms; if they do EITHER, destroy
// Worms. Modeled as a three-way option pick (sacrifice / take 5 / decline);
// the "sacrifice two lands" option is offered only when the player controls at
// least two lands. `resolveSteps` checkpoints the irreversible
// sacrifice/damage before `destroy`, so a suspended choice never re-applies.
export const wormsOfTheEarth: CardDefinition = {
    id: "65a97821-ca5b-46fb-af08-86de81d0daac",
    rarity: "rare",
    name: "Worms of the Earth",
    oracleText:
        "Players can't play lands.\nLands can't enter the battlefield.\nAt the beginning of each upkeep, any player may sacrifice two lands of their choice or have this enchantment deal 5 damage to that player. If a player does either, destroy this enchantment.",
    manaCost: { X: 2, B: 3 },
    types: ["Enchantment"],
    preventsLandPlayAndETB: true,
    triggeredAbilities: [
        phaseTrigger({
            id: "worms-of-the-earth-upkeep",
            oracleText:
                "At the beginning of each upkeep, any player may sacrifice two lands of their choice or have this enchantment deal 5 damage to that player. If a player does either, destroy this enchantment.",
            phase: "UPKEEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045, issue #849): the modal pick's option
            // SET is dynamic — "sacrifice two lands" is offered only when the
            // upkeep player controls at least two lands — which the
            // `optionChoice` Op's STATIC modes can't express (always offering it
            // would let a pick-sacrifice-with-fewer-than-two clamp and still
            // destroy Worms, a behaviour change). It is also a `scope: "each"`
            // per-player trigger whose chooser is the iterated `playerId`, not a
            // fixed EffectPlayerRef. Stays resolve().
            resolveSteps: [
                (ctx, playerId) => {
                    const self: TargetSelection = {
                        type: "permanent",
                        id: ctx.sourceInstanceId,
                    };
                    const landIds = ctx.getBattlefieldIds(playerId, {
                        types: "Land",
                    });
                    // CR 117.3a — the upkeep player chooses. "Sacrifice two
                    // lands" is offered only when they control at least two.
                    const options = [
                        ...(landIds.length >= 2
                            ? [
                                  {
                                      id: "sacrifice",
                                      label: "Sacrifice two lands (destroys Worms of the Earth)",
                                  },
                              ]
                            : []),
                        {
                            id: "damage",
                            label: "Take 5 damage (destroys Worms of the Earth)",
                        },
                        { id: "decline", label: "Do nothing" },
                    ];
                    const choice = ctx.requestOptionChoice({
                        playerId,
                        choiceId: `worms-${playerId}`,
                        options,
                        prompt: "Worms of the Earth: sacrifice two lands or take 5 damage?",
                    });
                    if (choice === undefined) return;
                    if (choice === "sacrifice") {
                        const picked = ctx.requestChoice({
                            playerId,
                            choiceId: `worms-sac-${playerId}`,
                            kind: "sacrifice-permanents",
                            zone: "battlefield",
                            filter: { types: "Land" },
                            count: 2,
                            prompt: "Sacrifice two lands.",
                        });
                        if (picked === undefined) return;
                        for (const id of picked) ctx.sacrifice(id);
                        ctx.destroy(self);
                    } else if (choice === "damage") {
                        ctx.dealDamage({ type: "player", id: playerId }, 5);
                        ctx.destroy(self);
                    }
                    // decline: do nothing; Worms survives.
                },
            ],
        }),
    ],
};
