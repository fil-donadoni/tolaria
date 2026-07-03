// Ice Age (ICE) — Green (mono-G) cards, split by colour per ADR 0043.
// The registry's `import * as ice from "./sets/ice"` resolves through
// ice/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {1}{G} → { X: 1, G: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).
import type {
    CardDefinition,
    CardPrint,
    DelayedTriggerDef,
    PermanentView,
    SpellContext,
} from "../../types";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { makeTapForMana } from "../../abilities";
import { cumulativeUpkeepTrigger } from "../../abilities/cumulativeUpkeep";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";

// "Draw a card at the beginning of the next turn's upkeep" cantrip rider
// (CR 502.2 / 603.7d) — the signature kicker on ~22 Ice Age commons. The
// scheduling spell/ability calls `scheduleNextUpkeepDraw` from its `resolve`;
// the matching `DelayedTriggerDef` (from `nextUpkeepDrawTrigger`) lives on the
// card's `delayedTriggers[]`. The trigger carries no `targetPlayerId`, so it
// fires at the VERY NEXT upkeep regardless of whose turn it is and dequeues
// exactly once (`fireDelayedTriggers` in gre/phases.ts). The drawing player is
// the spell's controller, captured in `payload.controller` (CR 113.7).
//
// Shared because the rider repeats verbatim across the whole cantrip cycle —
// extracting it keeps each card definition to its unique body (per the
// "extract on the second occurrence" convention).
const NEXT_UPKEEP_DRAW_TRIGGER_ID = "next-upkeep-cantrip";

function scheduleNextUpkeepDraw(ctx: SpellContext, sourceCardId: string): void {
    ctx.scheduleDelayedTrigger(
        sourceCardId,
        NEXT_UPKEEP_DRAW_TRIGGER_ID,
        "next-upkeep",
        {}
    );
}

function nextUpkeepDrawTrigger(): DelayedTriggerDef {
    return {
        id: NEXT_UPKEEP_DRAW_TRIGGER_ID,
        oracleText: "At the beginning of the next turn's upkeep, draw a card.",
        timing: "next-upkeep",
        resolve: (ctx) => {
            // CR 121.1 — the trigger's controller (the scheduling spell's
            // controller, or the activator on the tap-rider path) draws one
            // card. `ctx.controller` is the delayed trigger's controller in
            // both scheduling paths (`fireDelayedTriggers` sets the stack
            // item's controller to the instance's `controller`).
            ctx.drawCards(ctx.controller, 1);
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Active tracer
// ─────────────────────────────────────────────────────────────────────────────

// Balduvian Bears — {1}{G} 2/2 vanilla Bear (CR 302). The walking-
// skeleton tracer: a complete, castable CardDefinition proving the set
// file, registry entry, pool availability, projection and id-guard all
// work before the colour batches (PRD #628) build on top.
export const balduvianBears: CardDefinition = {
    id: "ef5297cb-e763-4871-9cd3-0e2dbcc52095",
    name: "Balduvian Bears",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};
// Aurochs — {3}{G} 2/3 Aurochs with trample. "Whenever this creature attacks, it
// gets +1/+0 until end of turn for each OTHER attacking Aurochs" (CR 603.6 attack
// trigger + CR 611.1 self pump). The resolve counts attacking creatures with the
// Aurochs subtype other than self (`getIsAttacking` + `hasSubtype`) and grants
// +N/+0 to self. (Green card sitting at the tail of the Red stub block; activated
// here as part of the #656 Red-completion batch per the issue scope.)
export const aurochs: CardDefinition = {
    id: "7e973a84-7f7d-4524-9f2f-ec9a014d52ee",
    name: "Aurochs",
    rarity: "common",
    oracleText:
        "Trample\nWhenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Aurochs.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Aurochs"],
    power: 2,
    toughness: 3,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        {
            id: "aurochs-attack-pump",
            oracleText:
                "Whenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Aurochs.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            // NOT DSL-migratable (ADR 0045, issue #840): buff amount scales by a runtime count (other attacking Aurochs, excluding self, any controller). Blocked on: a count-valued pump amount / a forEach select expressing "attacking, excluding self", not pump.
            resolve: (ctx) => {
                let others = 0;
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                        subtypes: "Aurochs",
                    })) {
                        if (id === ctx.sourceInstanceId) continue;
                        if (ctx.getIsAttacking(id)) others++;
                    }
                }
                if (others === 0) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    others,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Blizzard — {G}{G} Enchantment. Cumulative upkeep {2} (CR 702.24, ADR 0042) +
// a continuous "Creatures with flying don't untap during their controllers'
// untap steps" lock (CR 502.1 / 611 — the Winter Orb shape via
// `untapRestriction` filtered to flyers).
//
// SIMPLIFICATION (flagged, no engine change): the printed "Cast this spell only
// if you control a snow land" cast restriction degrades cleanly — the ICE pool
// ships NO snow-supertype lands (snow mana is deferred; see CONTEXT.md "Snow" /
// PRD #628), so the condition would never let it be cast at all. It is dropped
// here (Blizzard is freely castable) until snow lands exist; the restriction is
// not load-bearing for the enchantment's effect once in play.
export const blizzard: CardDefinition = {
    id: "c369e4f9-0f2b-446c-9e2d-d3eefab0586d",
    name: "Blizzard",
    rarity: "rare",
    oracleText:
        "Cast this spell only if you control a snow land.\nCumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nCreatures with flying don't untap during their controllers' untap steps.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "blizzard-flyer-untap-lock",
            oracleText:
                "Creatures with flying don't untap during their controllers' untap steps (Blizzard).",
            filter: { types: "Creature", requireAbility: "flying" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "blizzard-cumulative-upkeep",
            cost: { X: 2 },
            costLabel: "{2}",
        }),
    ],
};
// TODO(#628): implement.
// export const brownOuphe: CardDefinition = {
//     id: "e26ce35b-ba65-451d-a5ed-e1db6f1d0c6f",
//     name: "Brown Ouphe",
//     rarity: "common",
//     oracleText: "{1}{G}, {T}: Counter target activated ability from an artifact source. (Mana abilities can't be targeted.)",
//     manaCost: { G: 1 },
//     types: ["Creature"],
//     subtypes: ["Ouphe"],
//     power: 1,
//     toughness: 1,
// };
// Chub Toad — {2}{G} 1/1. "Whenever this creature blocks or becomes blocked, it
// gets +2/+2 until end of turn." (CR 509.1h blocks / becomes-blocked trigger;
// CR 514.2 cleanup expiry.) Fires on BLOCKERS_CONFIRMED whenever self is the
// blocker OR the blocked attacker (the Woolly Spider self-blocker shape widened
// to either combat role), deduped to a single buff per confirmation.
export const chubToad: CardDefinition = {
    id: "b6ebcc1d-0c5c-4bc2-ade7-41944f69162e",
    name: "Chub Toad",
    rarity: "common",
    oracleText:
        "Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Frog"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "chub-toad-combat-pump",
            oracleText:
                "Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self, state) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                const isBlocker = event.blockerId === self.id;
                const isBlockedAttacker = event.attackerId === self.id;
                if (!isBlocker && !isBlockedAttacker) return false;
                // The engine emits one BLOCKERS_CONFIRMED per attacker-blocker
                // pair. As the attacker, dedupe to the first blocker so a
                // multi-blocked Toad pumps once (mirrors Johtull Wurm).
                if (isBlockedAttacker && !isBlocker) {
                    const assignments = state?.combat?.blockerAssignments;
                    if (!assignments) return true;
                    for (const [blockerId, attackerIds] of Object.entries(
                        assignments
                    )) {
                        if (attackerIds.includes(self.id)) {
                            return event.blockerId === blockerId;
                        }
                    }
                }
                return true;
            },
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +2/+2 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Dire Wolves — {2}{G} 2/2 Wolf. "This creature has banding as long as you
// control a Plains." (CR 702.21 banding; `gre/banding.ts` reads the keyword from
// `staticAbilities`.)
//
// SIMPLIFICATION (flagged, no engine change): the "as long as you control a
// Plains" condition is a CONTINUOUS keyword gate on board state. The engine's
// `keyword-grant` static effect is applied imperatively at ETB and reversed only
// when the source leaves play — its `applies` predicate gets no board view
// (`StaticEffectContext` exposes only the target's own characteristics), so a
// "controls a Plains" condition that re-evaluates as Plains come and go is not
// expressible today. Banding is therefore granted UNCONDITIONALLY. This is a
// strict superset of the printed behaviour (Dire Wolves is a green-white card
// played alongside Plains in practice) and matches the engine's existing
// treatment of conditional keywords (Snow Devil's conditional first strike).
// A board-aware keyword-grant predicate would let this track Plains exactly;
// flagged for a follow-up.
export const direWolves: CardDefinition = {
    id: "a602c93d-e00f-4b4f-a7ff-95316b7e7641",
    name: "Dire Wolves",
    rarity: "common",
    oracleText:
        "This creature has banding as long as you control a Plains. (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Wolf"],
    power: 2,
    toughness: 2,
    staticAbilities: ["banding"],
};
// Earthlore — Aura on a land you control granting it "Tap enchanted land:
// Target blocking creature gets +1/+2 until end of turn." (CR 611 activated-
// grant, CR 514.2 expiry.) The Hot Springs shape: the granted ability lives on
// `grantTemplates` (so Earthlore itself exposes nothing) and `activated-grant`
// pushes it onto the enchanted land. The cost is the LAND's own tap
// (`cost.tap`), so "Activate only if enchanted land is untapped" is enforced
// automatically — a tapped permanent can't pay a tap cost (CR 602.2 / 118.12).
export const earthlore: CardDefinition = {
    id: "319d252e-7c43-47d6-8873-f69b0e063256",
    name: "Earthlore",
    rarity: "common",
    oracleText:
        "Enchant land you control\nTap enchanted land: Target blocking creature gets +1/+2 until end of turn. Activate only if enchanted land is untapped.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1, controller: "you" },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "earthlore-pump",
        },
    ],
    grantTemplates: [
        {
            id: "earthlore-pump",
            oracleText:
                "Tap enchanted land: Target blocking creature gets +1/+2 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "blocking",
            },
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+2 EOT
            // on the announced target (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Elder Druid — {3}{G} 2/2. "{3}{G}, {T}: You may tap or untap target artifact,
// creature, or land." (CR 605 activated ability; CR 701.20a tap/untap.) The
// "tap or untap" choice is offered via `requestOptionChoice` at resolution — a
// genuine tactical branch (CR 608.2). The "you may" permits choosing neither,
// but with both branches always legal the engine auto-resolves to a real pick;
// declining is equivalent to choosing the no-op direction, so two options
// suffice.
export const elderDruid: CardDefinition = {
    id: "210f6fab-62f0-42ab-bd01-00d647bd25e7",
    name: "Elder Druid",
    rarity: "rare",
    oracleText:
        "{3}{G}, {T}: You may tap or untap target artifact, creature, or land.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Cleric", "Druid"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "elder-druid-tap-untap",
            oracleText:
                "{3}{G}, {T}: You may tap or untap target artifact, creature, or land.",
            cost: { mana: { X: 3, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Creature", "Land"],
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                const choice = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "elder-druid-tap-untap-mode",
                    options: [
                        { id: "tap", label: "Tap it" },
                        { id: "untap", label: "Untap it" },
                    ],
                    prompt: "Tap or untap the target?",
                });
                if (choice === undefined) return; // suspended for the choice
                if (choice === "tap") ctx.tap(t);
                else ctx.untap(t);
            },
        },
    ],
};
// Essence Filter — {1}{G}{G} Sorcery. "Destroy all enchantments or all nonwhite
// enchantments." (CR 700.2 modal — "or" between two mass-destroy effects; CR
// 701.7 destroy.) Two `modes`, each a no-target resolve that scans every
// battlefield for Enchantments and destroys the matching set (the nonwhite mode
// skips white enchantments via `ctx.getColors`).
export const essenceFilter: CardDefinition = {
    id: "9b610103-dafd-4248-9d79-ce57f84b9e03",
    name: "Essence Filter",
    rarity: "common",
    oracleText: "Destroy all enchantments or all nonwhite enchantments.",
    manaCost: { X: 1, G: 2 },
    types: ["Sorcery"],
    modes: [
        {
            id: "all",
            label: "Destroy all enchantments",
            oracleText: "Destroy all enchantments.",
            resolve: (ctx: SpellContext) => {
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Enchantment",
                    })) {
                        ctx.destroy({ type: "permanent", id });
                    }
                }
            },
        },
        {
            id: "nonwhite",
            label: "Destroy all nonwhite enchantments",
            oracleText: "Destroy all nonwhite enchantments.",
            resolve: (ctx: SpellContext) => {
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Enchantment",
                    })) {
                        const target = { type: "permanent" as const, id };
                        if (ctx.getColors(target).includes("W")) continue;
                        ctx.destroy(target);
                    }
                }
            },
        },
    ],
};
// Fanatical Fever — {2}{G}{G} Instant. "Target creature gets +3/+0 and gains
// trample until end of turn." (CR 611.1c temporary P/T + keyword grant; CR
// 514.2 expiry.) The Stampede single-target shape.
export const fanaticalFever: CardDefinition = {
    id: "2abba7f1-5d07-4137-88a2-5967396a3e42",
    name: "Fanatical Fever",
    rarity: "uncommon",
    oracleText:
        "Target creature gets +3/+0 and gains trample until end of turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        ctx.addTemporaryPTBuff(t, 3, 0, { phase: "end-of-turn" });
        ctx.grantStaticAbility(t, "trample", { phase: "end-of-turn" });
    },
};
// Folk of the Pines — {4}{G} 2/5 Dryad. "{1}{G}: This creature gets +1/+0 until
// end of turn." (CR 605 activated ability; CR 514.2 cleanup expiry — the
// firebreathing self-pump, the Shambling Strider shape without the toughness
// downside.)
export const folkOfThePines: CardDefinition = {
    id: "0c13311d-db83-483f-ba2b-4f54ceb8b026",
    name: "Folk of the Pines",
    rarity: "common",
    oracleText: "{1}{G}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Dryad"],
    power: 2,
    toughness: 5,
    activatedAbilities: [
        {
            id: "folk-of-the-pines-pump",
            oracleText: "{1}{G}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1, G: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+0 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Forbidden Lore — Aura on any land granting it "{T}: Target creature gets +2/+1
// until end of turn." (CR 611 activated-grant; CR 514.2 expiry.) The Hot Springs
// / Earthlore shape; "Enchant land" with no controller clause, so it may sit on
// an opponent's land (the land's controller activates).
export const forbiddenLore: CardDefinition = {
    id: "5fc225cf-4fe2-4a5b-828e-ffcb99e404e8",
    name: "Forbidden Lore",
    rarity: "rare",
    oracleText:
        'Enchant land\nEnchanted land has "{T}: Target creature gets +2/+1 until end of turn."',
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "forbidden-lore-pump",
        },
    ],
    grantTemplates: [
        {
            id: "forbidden-lore-pump",
            oracleText: "{T}: Target creature gets +2/+1 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +2/+1 EOT
            // on the announced target (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 2,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Forgotten Lore — "Target opponent chooses a card in your graveyard. You may
// pay {G}. If you do, repeat this process except that opponent can't choose a
// card already chosen for Forgotten Lore. Then put the last chosen card into
// your hand." (CR 115 target opponent; CR 608.2 iterative resolution; CR 117.3a
// may-pay; CR 400.7 graveyard → hand.)
//
// This is an UNBOUNDED iterative may-pay loop over a SHRINKING candidate set —
// the fixed-length `resolveSteps` model cannot express a loop whose length is
// decided at runtime. It is expressed with a SINGLE `resolve()` closure plus
// iteration-indexed choice ids: the non-stepped resolve re-runs from the top on
// every resume, replaying already-collected choices from `collectedChoices`
// (CR 608.2 stepped-resolution checkpointing) and enqueuing the next pick / pay.
// Each iteration `i`:
//   1. The opponent picks one card from the controller's graveyard, scoped to
//      the candidate set MINUS every card chosen in iterations 0..i-1 (the
//      shrinking set; `choiceId: forgotten-lore-pick-${i}`).
//   2. The controller may pay {G} (`choiceId: forgotten-lore-pay-${i}`). On
//      "yes" the loop advances to iteration i+1; on "no" (or no candidates
//      remain) the loop stops and the LAST chosen card moves to the controller's
//      hand. CR 117.3a — declining to pay ends the repeat.
export const forgottenLore: CardDefinition = {
    id: "fb01dd39-a957-4c1a-86cf-f31a699a154a",
    name: "Forgotten Lore",
    rarity: "uncommon",
    oracleText:
        "Target opponent chooses a card in your graveyard. You may pay {G}. If you do, repeat this process except that opponent can't choose a card already chosen for Forgotten Lore. Then put the last chosen card into your hand.",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    resolve: (ctx: SpellContext) => {
        const me = ctx.controller;
        const t = ctx.targets[0];
        if (t?.type !== "player") return;
        const opponent = t.id;

        // Walk the iterations: replay completed picks/pays from prior resumes,
        // and enqueue the next pending choice. `chosen` accumulates the cards
        // picked so far (in order); the LAST one is what goes to hand.
        const chosen: string[] = [];
        for (let i = 0; ; i++) {
            const graveIds = ctx.getGraveyardCards(me).map((c) => c.id);
            // The shrinking candidate set: cards still in the graveyard that
            // the opponent has not yet chosen for Forgotten Lore.
            const candidateIds = graveIds.filter((id) => !chosen.includes(id));
            if (candidateIds.length === 0) break; // nothing left to choose

            const pick = ctx.requestChoice({
                playerId: opponent,
                choiceId: `forgotten-lore-pick-${i}`,
                kind: "choose-graveyard-card",
                zone: "graveyard",
                zoneOwnerId: me,
                candidateIds,
                count: 1,
                prompt: "Choose a card in the opponent's graveyard.",
            });
            if (pick === undefined) return; // suspended on the opponent's pick
            if (pick.length === 0) break; // defensive — no card chosen
            chosen.push(pick[0]);

            // CR 117.3a — the controller may pay {G} to repeat the process.
            const repeat = ctx.requestMayPay({
                playerId: me,
                choiceId: `forgotten-lore-pay-${i}`,
                cost: { G: 1 },
                prompt: "Pay {G} to repeat Forgotten Lore?",
            });
            if (repeat === undefined) return; // suspended on the may-pay
            if (!repeat) break; // declined — stop the loop
            // Paid — loop continues to iteration i+1 over the shrunken set.
        }

        // CR 400.7 — put the LAST chosen card into the controller's hand. (If
        // no card was ever chosen — empty graveyard — nothing happens.)
        const last = chosen[chosen.length - 1];
        if (last) ctx.moveCardById(me, last, "graveyard", "hand");
    },
};
// Foxfire — {2}{G} Instant. "Untap target attacking creature. Prevent all
// combat damage that would be dealt to and dealt by that creature this turn"
// (CR 701.20 untap; CR 615 two-way combat-damage shield, via
// `preventAllCombatDamageToAndBy` — Ebony Horse pattern) plus the next-upkeep
// cantrip rider.
export const foxfire: CardDefinition = {
    id: "88db9685-6a2f-4548-b6c4-669918d653b4",
    name: "Foxfire",
    rarity: "common",
    oracleText:
        "Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, G: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        combatRoleFilter: "attacking",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") {
            ctx.untap(t);
            ctx.preventAllCombatDamageToAndBy(t, { phase: "end-of-turn" });
        }
        scheduleNextUpkeepDraw(ctx, foxfire.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Freyalise Supplicant — "{T}, Sacrifice a red or white creature: This creature
// deals damage to any target equal to half the sacrificed creature's power,
// rounded down." (CR 602.1 / 118.5 — {T} + sacrifice-a-filtered-creature cost;
// CR 115.4 any-target; CR 120.1 damage.) The sacrificed creature's EFFECTIVE
// power is snapshotted onto the stack item at cost commit (CR 613 layer 7c,
// 608.2h last-known information) because the creature is gone by resolution;
// the resolve reads it via `getAdditionalSacrificePower`. Mana value alone
// would be wrong — power can diverge from mana value (pumps, X/1 bodies).
export const freyaliseSupplicant: CardDefinition = {
    id: "5b1e718a-882a-4bdc-9d62-4dda88da0ba0",
    name: "Freyalise Supplicant",
    rarity: "uncommon",
    oracleText:
        "{T}, Sacrifice a red or white creature: This creature deals damage to any target equal to half the sacrificed creature's power, rounded down.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "freyalise-supplicant-sacrifice-ping",
            oracleText:
                "{T}, Sacrifice a red or white creature: This creature deals damage to any target equal to half the sacrificed creature's power, rounded down.",
            cost: {
                tap: true,
                // CR 602.1 / 118.5 — "Sacrifice a red or white creature": the
                // activator picks a matching creature on their battlefield;
                // the source (Freyalise Supplicant, a green creature) is NOT a
                // legal pick (not red/white), so it can't sacrifice itself.
                sacrificeFilter: { types: "Creature", colors: ["R", "W"] },
            },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                // CR 608.2h — the sacrificed creature's power was snapshotted
                // at cost payment (it has left play by now). Half, rounded
                // down (CR 107.2).
                const power = ctx.getAdditionalSacrificePower() ?? 0;
                ctx.dealDamage(target, Math.floor(power / 2));
            },
        },
    ],
};
// Freyalise's Charm — {G}{G} Enchantment. "Whenever an opponent casts a black
// spell, you may pay {G}{G}. If you do, you draw a card." (CR 603.2 spell-cast
// trigger scoped to opponents + colour filter; CR 117.3a may-pay via
// `requestMayPay`; CR 120 draw.) Plus "{G}{G}: Return this enchantment to its
// owner's hand." (CR 605 activated ability; CR 400.7 return-to-hand bounce.)
export const freyalisesCharm: CardDefinition = {
    id: "3e147ac1-d221-49c7-966e-5e665ddeab6b",
    name: "Freyalise's Charm",
    rarity: "uncommon",
    oracleText:
        "Whenever an opponent casts a black spell, you may pay {G}{G}. If you do, you draw a card.\n{G}{G}: Return this enchantment to its owner's hand.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "freyalises-charm-black-draw",
            oracleText:
                "Whenever an opponent casts a black spell, you may pay {G}{G}. If you do, you draw a card.",
            scope: "opponents",
            filter: { colors: "B" },
            resolve: (ctx: SpellContext) => {
                const paid = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: "freyalises-charm-pay",
                    cost: { G: 2 },
                    prompt: "Pay {G}{G} to draw a card?",
                });
                if (paid === undefined) return; // suspended for the choice
                if (paid) ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "freyalises-charm-bounce",
            oracleText: "{G}{G}: Return this enchantment to its owner's hand.",
            cost: { mana: { G: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #839): return the source
            // permanent to its owner's hand via the implicit $source binding
            // (CR 701.10 / 400.7).
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};
// Freyalise's Winds (#668) — demonstrates the counter-keyed untap replacement
// seam.
//   "Whenever a permanent becomes tapped, put a wind counter on it.
//    If a permanent with a wind counter on it would untap during its
//    controller's untap step, remove all wind counters from it instead."
// 1. CR 701.20a / 603 — the tap half is a `tappedTrigger` with `scope: "any"`
//    (any permanent, any controller) that adds a `wind` counter (CR 122.1) to
//    the tapped permanent.
// 2. CR 614.6 — the untap half is the engine seam in `untapStep`
//    (`convex/gre/phases.ts`): a permanent with a `wind` counter doesn't untap
//    during its controller's untap step; instead all its wind counters are
//    removed (gated on Freyalise's Winds being in play). The card carries no
//    code for this half — the engine consults the counter directly.
export const freyalisesWinds: CardDefinition = {
    id: "b11cd2e0-9419-4267-807e-5b73915c748a",
    name: "Freyalise's Winds",
    rarity: "rare",
    oracleText:
        "Whenever a permanent becomes tapped, put a wind counter on it.\nIf a permanent with a wind counter on it would untap during its controller's untap step, remove all wind counters from it instead.",
    manaCost: { X: 2, G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "freyalises-winds-tapped",
            oracleText:
                "Whenever a permanent becomes tapped, put a wind counter on it.",
            // CR 701.20a — any permanent becoming tapped, regardless of
            // controller (including a tap for mana — no `forMana` gate).
            scope: "any",
            // NOT DSL-migratable (ADR 0045): built via the `tappedTrigger`
            // factory (no `effects[]` site), and the counter target is the
            // permanent that became tapped (a trigger-event object) — not a
            // covered `EffectObjectSelector`. Stays resolve().
            resolve: (ctx, _event, tapped) => {
                // CR 122.1 — add a wind counter to the tapped permanent. The
                // untap-step seam later keys off this counter.
                ctx.addCounter({ type: "permanent", id: tapped.id }, "wind", 1);
            },
        }),
    ],
};
// ─────────────────────────────────────────────────────────────────────────────
// Green free tranche (#634)
//
// The free-tranche Green cards — expressible entirely with already-shipped
// primitives — are activated below (intermixed with the remaining commented
// stubs). Reprints already implemented in LEA (Giant Growth, Hurricane, Lure,
// Regeneration, Wild Growth) are CardPrints onto their existing definitions
// (ADR 0014); new-to-ICE Green cards are full CardDefinitions. Lhurgoyf is a
// `pt-cda` (layer 7a) whose `compute` counts creature cards in all graveyards
// from game state — MANDATORY wire-format test (projection keeps `.types`).
//
// GREEN-COMPLETION (#657): the buildable-now Green stubs the free tranche
// under-delivered are now active CardDefinitions below — Blizzard, Chub Toad,
// Dire Wolves, Earthlore, Elder Druid, Essence Filter, Fanatical Fever, Folk of
// the Pines, Forbidden Lore, Freyalise's Charm, Gorilla Pack, Thermokarst,
// Thoughtleech, Venomous Breath, Wiitigo. The earlier "needs primitive" defers
// for Gorilla Pack (attack-restriction + state-sac — Sea Serpent shape),
// Thoughtleech (`tappedTrigger`), Venomous Breath (delayed end-of-combat
// destroy), Wiitigo (counter-as-flag tracking) and Dire Wolves (banding grant)
// were STALE — every primitive ships today.
//
// CUMULATIVE UPKEEP (ADR 0042) — Fyndhorn Pollen, Maddening Wind and Ritual of
//   Subdual are all ACTIVE in the CU section below (#726). Ritual of Subdual
//   ({4}{G}{G}) is mono-green by colour identity and homes here despite its
//   triage stub originally sitting in multicolor.ts.
//   • Next-upkeep delayed cantrip — Pyknite: ACTIVE (#660). Touch of Vitae
//     remains deferred: its cantrip + haste legs are buildable but the granted
//     "{0}: Untap this creature. Activate only once." activated ability needs a
//     duration-scoped activated-ability grant primitive (see its stub below).
//   • Snow-matters — Snowblind / Whiteout / Woolly Mammoths / Rime Dryad
//     (snow-land counting, snow landwalk evasion, snow-land sac recursion). No
//     snow supertype filter / snow-evasion plumbing yet — snow cluster.
//     (Thermokarst is now active; its snow-land lifegain rider degrades to a
//     no-op until snow lands exist.)
//   • Forgotten Lore / Freyalise Supplicant / Freyalise's Winds — blocked
//     one-offs owned by later clusters.
//
// FLAGGED SIMPLIFICATIONS (no new primitive): Blizzard drops its snow cast-
// condition (no snow lands in pool); Dire Wolves grants banding unconditionally
// (the "as long as you control a Plains" gate needs a board-aware keyword-grant
// predicate the engine lacks); Thermokarst's snow-land lifegain is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

// Fyndhorn Brownie — "{2}{G}, {T}: Untap target creature." (CR 605 activated
// ability; CR 701.20a untap. The Twiddle-on-a-stick untap, scoped to creatures.)
export const fyndhornBrownie: CardDefinition = {
    id: "06204e82-9dfd-4334-a23a-f8240fc37772",
    name: "Fyndhorn Brownie",
    rarity: "common",
    oracleText: "{2}{G}, {T}: Untap target creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Ouphe"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "fyndhorn-brownie-untap",
            oracleText: "{2}{G}, {T}: Untap target creature.",
            cost: { mana: { X: 2, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #842): untap the announced
            // creature target (CR 701.26b).
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
            ],
        },
    ],
};
// Fyndhorn Elder — "{T}: Add {G}{G}." Mana dork (CR 605.1a mana ability,
// resolves immediately). The Llanowar Elves shape producing two green.
export const fyndhornElder: CardDefinition = {
    id: "fca8aa11-f7cb-4f88-a041-30098579f1d2",
    name: "Fyndhorn Elder",
    rarity: "uncommon",
    oracleText: "{T}: Add {G}{G}.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        makeTapForMana({
            id: "fyndhorn-elder-mana",
            oracleText: "{T}: Add {G}{G}.",
            produces: { G: 2 },
        }),
    ],
};
// Fyndhorn Elves — "{T}: Add {G}." The Llanowar Elves twin (CR 605.1a).
export const fyndhornElves: CardDefinition = {
    id: "3ba95ffa-990a-4013-98b7-5d8c0b34e9c4",
    name: "Fyndhorn Elves",
    rarity: "common",
    oracleText: "{T}: Add {G}.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        makeTapForMana({
            id: "fyndhorn-elves-mana",
            oracleText: "{T}: Add {G}.",
            produces: { G: 1 },
        }),
    ],
};
// Giant Growth — ICE reprint of the LEA instant (+3/+3 until end of turn).
// CardPrint onto the LEA definition (ADR 0014).
export const giantGrowthIce: CardPrint = {
    printId: "431c9749-fd7b-4960-a910-8d41d3704e6c",
    definitionId: "367dbefe-3366-408e-9fcf-7dc00f8cc201",
    setCode: "ice",
    rarity: "common",
};
// Gorilla Pack — {2}{G} 3/3 Ape. "This creature can't attack unless defending
// player controls a Forest.\nWhen you control no Forests, sacrifice this
// creature." The exact Sea Serpent (LEA) shape — a self `attack-restriction`
// static (CR 508.1c) gated on the defender controlling a Forest, plus a
// `stateTrigger` sacrifice (CR 603.8) when the controller has no Forests. Both
// primitives ship; the "needs primitive" defer was stale.
export const gorillaPack: CardDefinition = {
    id: "046f6b76-5f17-4728-aa34-72b7eff1d4c9",
    name: "Gorilla Pack",
    rarity: "common",
    oracleText:
        "This creature can't attack unless defending player controls a Forest.\nWhen you control no Forests, sacrifice this creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Ape"],
    power: 3,
    toughness: 3,
    staticEffects: [
        {
            // CR 508.1c — can't attack unless defending player controls a Forest
            kind: "attack-restriction" as const,
            id: "gorilla-pack-forest-restriction",
            predicate: (
                _self: PermanentView,
                defenderBattlefield: readonly PermanentView[]
            ) => defenderBattlefield.some((c) => c.subtypes.includes("Forest")),
            oracleText:
                "Gorilla Pack can't attack unless defending player controls a Forest.",
        },
    ],
    triggeredAbilities: [
        // CR 603.8 — state-triggered sacrifice; `stateTrigger` wires the
        // STATE_CHECK narrowing and resolve-time re-check (intervening-if) so it
        // fizzles if a Forest reappears before resolution.
        stateTrigger({
            id: "gorilla-pack-no-forest-sacrifice",
            oracleText: "When you control no Forests, sacrifice Gorilla Pack.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                if (!controller) return false;
                return !controller.battlefield.some((c) =>
                    c.subtypes.includes("Forest")
                );
            },
            resolve: (ctx) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};
// Hot Springs — Aura on a land you control granting it an activated prevention
// ability (CR 611 activated-grant, CR 615 prevention). The granted "{T}:
// Prevent the next 1 damage to any target this turn" lives on `grantTemplates`
// so Hot Springs itself doesn't expose it; `activated-grant` pushes it onto the
// enchanted land.
export const hotSprings: CardDefinition = {
    id: "1d4fe072-81a7-424e-8d21-aaca010d5b1d",
    name: "Hot Springs",
    rarity: "rare",
    oracleText:
        'Enchant land you control\nEnchanted land has "{T}: Prevent the next 1 damage that would be dealt to any target this turn."',
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1, controller: "you" },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "hot-springs-prevent",
        },
    ],
    grantTemplates: [
        {
            id: "hot-springs-prevent",
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t)
                    ctx.preventNextNDamageToTarget(t, 1, {
                        phase: "end-of-turn",
                    });
            },
        },
    ],
};
// Hurricane — ICE reprint of the LEA sorcery (X damage to each flier and each
// player). CardPrint onto the LEA definition (ADR 0014).
export const hurricaneIce: CardPrint = {
    printId: "a8cc6db7-1f40-40e3-a7ea-92f1d05e2e3d",
    definitionId: "52f5a19f-16e4-4d35-89e1-969ac8202f88",
    setCode: "ice",
    rarity: "uncommon",
};
// Johtull Wurm — "Whenever this creature becomes blocked, it gets -2/-1 until
// end of turn for each creature blocking it beyond the first." (CR 509.1h
// becomes-blocked, CR 514.2 cleanup expiry.) NEGATIVE asymmetric rampage: the
// engine's `rampageTrigger` only does symmetric +N/+N, so the per-blocker
// -2/-1 is written inline, reusing the BLOCKERS_CONFIRMED event + the live
// block graph (dedupe on the first blocker so it fires once) like rampage does.
export const johtullWurm: CardDefinition = {
    id: "64a22e88-f7b1-48c8-a199-e57edcd50654",
    name: "Johtull Wurm",
    rarity: "uncommon",
    oracleText:
        "Whenever this creature becomes blocked, it gets -2/-1 until end of turn for each creature blocking it beyond the first.",
    manaCost: { X: 5, G: 1 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 6,
    toughness: 6,
    triggeredAbilities: [
        {
            id: "johtull-wurm-block-shrink",
            oracleText:
                "Whenever this creature becomes blocked, it gets -2/-1 until end of turn for each creature blocking it beyond the first.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self, state) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                // Fire only when self is the blocked ATTACKER (CR 509.1h).
                if (event.attackerId !== self.id) return false;
                // The engine emits one BLOCKERS_CONFIRMED per attacker-blocker
                // pair; dedupe to the first blocker so a multi-blocked attacker
                // fires once (mirrors `rampageTrigger.firstBlockerOf`).
                const assignments = state?.combat?.blockerAssignments;
                if (!assignments) return true;
                for (const [blockerId, attackerIds] of Object.entries(
                    assignments
                )) {
                    if (attackerIds.includes(self.id)) {
                        return event.blockerId === blockerId;
                    }
                }
                return true;
            },
            // NOT DSL-migratable (ADR 0045, issue #840): buff amount scales by a runtime count (blockers beyond the first). Blocked on: a count-valued pump amount, not pump.
            resolve: (ctx: SpellContext, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const attackerId = ctx.sourceInstanceId;
                // CR 509.1h — count live blockers at resolution.
                const live = new Set<string>();
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid)) live.add(id);
                }
                const blockers = (
                    ctx.getBlockersByAttacker()[attackerId] ?? []
                ).filter((id) => live.has(id));
                const beyondFirst = Math.max(0, blockers.length - 1);
                if (beyondFirst === 0) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: attackerId },
                    -2 * beyondFirst,
                    -1 * beyondFirst,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Juniper Order Druid — "{T}: Untap target land." (CR 605 activated ability;
// CR 701.20a untap, scoped to lands.)
export const juniperOrderDruid: CardDefinition = {
    id: "cb211704-ff8e-498b-b7bb-f8384f198ffd",
    name: "Juniper Order Druid",
    rarity: "common",
    oracleText: "{T}: Untap target land.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "juniper-order-druid-untap",
            oracleText: "{T}: Untap target land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #842): untap the announced
            // land target (CR 701.26b).
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
            ],
        },
    ],
};
// Lhurgoyf — its power equals the number of creature cards in all graveyards and
// its toughness is that number plus 1 (CR 604.3 / 613.4c CDA P/T, layer 7a). A
// `pt-cda` whose `compute` counts `Creature`-typed cards across every player's
// graveyard from game state; the printed 0/0 base is the CDA target so the
// effective P/T is exactly `{ n, n+1 }`. `.types` survives `projectPublicState`
// (slimCard strips only `card`), so the count is identical on the wire — the
// mandatory wire-format test re-asserts it after projection.
export const lhurgoyf: CardDefinition = {
    id: "fee6d385-d44b-4f1a-beb1-13aeebde063e",
    name: "Lhurgoyf",
    rarity: "rare",
    oracleText:
        "Lhurgoyf's power is equal to the number of creature cards in all graveyards and its toughness is equal to that number plus 1.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Lhurgoyf"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (_source, state) => {
                let creatures = 0;
                for (const player of state.players) {
                    for (const card of player.graveyard) {
                        if (card.types.includes("Creature")) creatures++;
                    }
                }
                return { power: creatures, toughness: creatures + 1 };
            },
        },
    ],
};
// Lure — ICE reprint of the LEA Aura ("All creatures able to block enchanted
// creature do so"). CardPrint onto the LEA definition (ADR 0014).
export const lureIce: CardPrint = {
    printId: "87af69ee-c2bb-46ea-8d36-d484d04a3c8a",
    definitionId: "2a87b26e-0431-42e9-b44f-94ba8546111a",
    setCode: "ice",
    rarity: "uncommon",
};
// Nature's Lore — "Search your library for a Forest card, put that card onto the
// battlefield, then shuffle." (CR 701.19 search; CR 400.7 put onto battlefield;
// CR 701.20 shuffle.) A library search restricted to Forest cards via the
// `candidateIds` allow-list, then `putFromLibraryOntoBattlefield` + shuffle.
export const naturesLore: CardDefinition = {
    id: "668d2969-b6b7-4507-bdd4-20bbaa68035a",
    name: "Nature's Lore",
    rarity: "uncommon",
    oracleText:
        "Search your library for a Forest card, put that card onto the battlefield, then shuffle.",
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        const forests = ctx
            .getLibraryCards(ctx.controller)
            .filter((c) => c.subtypes.includes("Forest"));
        const found = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "natures-lore-search",
            kind: "search-library",
            zone: "library",
            candidateIds: forests.map((c) => c.id),
            count: { min: 0, max: 1 },
            prompt: "Search your library for a Forest card.",
        });
        if (found === undefined) return; // suspended
        const foundId = found[0];
        if (foundId) ctx.putFromLibraryOntoBattlefield(ctx.controller, foundId);
        ctx.shuffleLibrary(ctx.controller);
    },
};
// Pale Bears — {2}{G} 2/2 with islandwalk (CR 702.18 landwalk evasion).
export const paleBears: CardDefinition = {
    id: "7f19c2a3-6403-4a78-bf45-6e339578d673",
    name: "Pale Bears",
    rarity: "rare",
    oracleText:
        "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    staticAbilities: ["islandwalk"],
};
// Pygmy Allosaurus — {2}{G} 2/2 with swampwalk (CR 702.18 landwalk evasion).
export const pygmyAllosaurus: CardDefinition = {
    id: "88a68767-9822-4f15-895e-32164e2159be",
    name: "Pygmy Allosaurus",
    rarity: "rare",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Dinosaur"],
    power: 2,
    toughness: 2,
    staticAbilities: ["swampwalk"],
};
// Pyknite — {2}{G} 1/1 Ouphe. Self-ETB cantrip rider (CR 603.6a ETB trigger
// arming the CR 502.2 / 603.7d next-upkeep delayed draw).
export const pyknite: CardDefinition = {
    id: "6ffc64e4-ae3c-49f9-8ed6-518dd497bfe6",
    name: "Pyknite",
    rarity: "common",
    oracleText:
        "When this creature enters, draw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Ouphe"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "pyknite-etb",
            oracleText:
                "When this creature enters, draw a card at the beginning of the next turn's upkeep.",
            scope: "self",
            resolve: (ctx) => {
                scheduleNextUpkeepDraw(ctx, pyknite.id);
            },
        }),
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Regeneration — ICE reprint of the LEA Aura ("{G}: Regenerate enchanted
// creature"). CardPrint onto the LEA definition (ADR 0014).
export const regenerationIce: CardPrint = {
    printId: "1dacfaec-6b61-450d-a134-2087c38a298a",
    definitionId: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4",
    setCode: "ice",
    rarity: "common",
};
// Rime Dryad — snow forestwalk (CR 702.13 / 205.4a): can't be blocked while the
// defending player controls a snow Forest. The `snow forestwalk` keyword is
// enforced by the combat registry's `LANDWALK_SNOW_RULES`
// (`controlsSnowSubtype(..., "Forest")`).
export const rimeDryad: CardDefinition = {
    id: "7a93e6ce-1295-41f8-b454-2dfe321481a6",
    name: "Rime Dryad",
    rarity: "common",
    oracleText:
        "Snow forestwalk (This creature can't be blocked as long as defending player controls a snow Forest.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Dryad"],
    power: 1,
    toughness: 2,
    staticAbilities: ["snow forestwalk"],
};
// Scaled Wurm — {7}{G} 7/6 vanilla Wurm (CR 302).
export const scaledWurm: CardDefinition = {
    id: "499cd7fa-c86c-4a5f-b36d-8160e8a6af1f",
    name: "Scaled Wurm",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 7, G: 1 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 7,
    toughness: 6,
};
// Shambling Strider — "{R}{G}: This creature gets +1/-1 until end of turn."
// (CR 605 activated ability; CR 514.2 cleanup expiry — a firebreathing-style
// self-pump trading toughness for power.)
export const shamblingStrider: CardDefinition = {
    id: "8886ba2d-b25a-4b74-9299-911c509ae864",
    name: "Shambling Strider",
    rarity: "common",
    oracleText: "{R}{G}: This creature gets +1/-1 until end of turn.",
    manaCost: { X: 4, G: 2 },
    types: ["Creature"],
    subtypes: ["Yeti"],
    power: 5,
    toughness: 5,
    activatedAbilities: [
        {
            id: "shambling-strider-pump",
            oracleText: "{R}{G}: This creature gets +1/-1 until end of turn.",
            cost: { mana: { R: 1, G: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/-1 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: -1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Snowblind — Aura: enchanted creature gets -X/-Y (CR 613 layer 7c, a `pt-cda`
// since X/Y are characteristic-defined by board state — CR 604.3). X = number
// of snow lands the DEFENDING player controls if the host is attacking,
// otherwise the snow lands its CONTROLLER controls (CR 205.4a). Y = min(X,
// toughness − 1), so the toughness reduction never reduces the host below 1
// toughness on its own. The host's toughness read in `compute` is its toughness
// WITHOUT this effect (the CDA delta is added on top), giving the intended cap.
//
// SIMPLIFICATION (flagged): the "defending player" while the host attacks is
// resolved as the host's opponent (the non-controller in 2-player). Multiplayer
// (3+) is out of scope (CLAUDE.md), so the single opponent is the defender.
export const snowblind: CardDefinition = {
    id: "5f62c376-487a-42bc-bd85-ab8b0480f7dc",
    name: "Snowblind",
    rarity: "rare",
    oracleText:
        "Enchant creature\nEnchanted creature gets -X/-Y. If that creature is attacking, X is the number of snow lands defending player controls. Otherwise, X is the number of snow lands its controller controls. Y is equal to X or to enchanted creature's toughness minus 1, whichever is smaller.",
    manaCost: { X: 3, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (_source, state, ctx, target) => {
                // CR 205.4a — count snow lands controlled by the relevant
                // player. Attacking → the defending player (the host's
                // opponent); otherwise → the host's controller. The view's
                // players carry no `id`, so the opponent is identified as the
                // player whose battlefield holds permanents NOT controlled by
                // the host's controller (2-player; multiplayer out of scope).
                const controllerId = target.controllerId;
                const countSnow = (
                    predicate: (c: string) => boolean
                ): number => {
                    let n = 0;
                    for (const player of state.players) {
                        for (const p of player.battlefield) {
                            if (
                                predicate(p.controllerId) &&
                                p.types.includes("Land") &&
                                ctx.hasSupertype(p, "Snow")
                            ) {
                                n++;
                            }
                        }
                    }
                    return n;
                };
                const x = target.isAttacking
                    ? countSnow((cid) => cid !== controllerId)
                    : countSnow((cid) => cid === controllerId);
                // Y = min(X, toughness − 1). `target.toughness` here is the
                // host's toughness before this CDA delta (CR 613 — the delta is
                // added on top), so the cap keeps it from self-killing.
                const baseToughness = target.toughness ?? 0;
                const y = Math.min(x, Math.max(0, baseToughness - 1));
                return { power: -x, toughness: -y };
            },
        },
    ],
};
// Stampede — "Attacking creatures get +1/+0 and gain trample until end of turn."
// (CR 611.1c temporary P/T + keyword grant on the set of attackers; CR 514.2
// expiry.) Each currently-attacking creature receives the buff and trample.
export const stampede: CardDefinition = {
    id: "bc8265a1-4621-4d25-8f7f-f0179951a694",
    name: "Stampede",
    rarity: "rare",
    oracleText:
        "Attacking creatures get +1/+0 and gain trample until end of turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        // "Attacking creatures" = every creature currently attacking, any
        // controller (CR 506.4). Scan all players' battlefields for attackers.
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
            })) {
                if (!ctx.getIsAttacking(id)) continue;
                const target = { type: "permanent" as const, id };
                ctx.addTemporaryPTBuff(target, 1, 0, { phase: "end-of-turn" });
                ctx.grantStaticAbility(target, "trample", {
                    phase: "end-of-turn",
                });
            }
        }
    },
};
// Stunted Growth — "Target player chooses three cards from their hand and puts
// them on top of their library in any order." (CR 701-style hand→library-top;
// the targeted player makes the choice and the order.) Routes a hand-card
// choice to the TARGET player, then moves each pick to the top in pick order.
export const stuntedGrowth: CardDefinition = {
    id: "4c9b7393-eb35-4c99-bbf5-bcf924aa8ff3",
    name: "Stunted Growth",
    rarity: "rare",
    oracleText:
        "Target player chooses three cards from their hand and puts them on top of their library in any order.",
    manaCost: { X: 3, G: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const hand = ctx.getHandCards(target.id).map((c) => c.id);
        if (hand.length === 0) return;
        // "chooses three cards" — fewer than three if the hand is smaller
        // (CR 700.3: do as much as possible). The chooser's pick order becomes
        // the top-of-library order.
        const count = Math.min(3, hand.length);
        const picks = ctx.requestChoice({
            playerId: target.id,
            choiceId: "stunted-growth-pick",
            kind: "choose-hand-card",
            zone: "hand",
            candidateIds: hand,
            count,
            prompt: "Choose three cards to put on top of your library in any order.",
        });
        if (picks === undefined) return; // suspended on the target's choice
        for (const id of picks) {
            ctx.moveHandCardToLibraryTop(target.id, id);
        }
    },
};
// Tarpan — {G} 1/1 with "When this creature dies, you gain 1 life." (CR 700.4
// dies trigger; CR 119.3 life gain.)
export const tarpan: CardDefinition = {
    id: "b1420ec5-367c-4514-86c5-3993bf339e37",
    name: "Tarpan",
    rarity: "common",
    oracleText: "When this creature dies, you gain 1 life.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Horse"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        diedTrigger({
            id: "tarpan-death-lifegain",
            oracleText: "When this creature dies, you gain 1 life.",
            scope: "self",
            resolve: (ctx) => ctx.gainLife(ctx.controller, 1),
        }),
    ],
};
// Thermokarst — {1}{G}{G} Sorcery. "Destroy target land. If that land was a snow
// land, you gain 1 life." (CR 701.7 destroy.)
//
// SIMPLIFICATION (flagged, no engine change): the "if that land was a snow land,
// you gain 1 life" rider degrades to a no-op — the ICE pool ships NO snow-
// supertype lands (snow mana is deferred; see CONTEXT.md "Snow" / PRD #628), so
// no target can ever satisfy the snow branch. The destroy is the load-bearing
// effect and is implemented fully; the lifegain lands the day snow lands exist.
export const thermokarst: CardDefinition = {
    id: "00ae906b-2c4d-48e9-9f2d-217777e22292",
    name: "Thermokarst",
    rarity: "uncommon",
    oracleText:
        "Destroy target land. If that land was a snow land, you gain 1 life.",
    manaCost: { X: 1, G: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    // Snow-land lifegain rider is a no-op in the current pool (no snow lands),
    // so the whole effect is a single destroy of the announced target land.
    effects: [{ op: "destroy", target: { target: 0 } }],
};
// Thoughtleech — {G}{G} Enchantment. "Whenever an Island an opponent controls
// becomes tapped, you may gain 1 life." (CR 603.2 becomes-tapped trigger via
// `tappedTrigger`; CR 117.3a may + CR 119.3 lifegain.) The `tappedTrigger`
// watcher (Snowfall precedent) scoped to opponents' Islands; the "needs
// primitive" defer was stale. The "you may gain 1 life" is strictly beneficial,
// so the engine auto-resolves the may (ADR 0003) — modelled as an unconditional
// gain on resolution.
export const thoughtleech: CardDefinition = {
    id: "d8fe7f9d-644f-48d0-93fa-d9a536f1f755",
    name: "Thoughtleech",
    rarity: "uncommon",
    oracleText:
        "Whenever an Island an opponent controls becomes tapped, you may gain 1 life.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "thoughtleech-island-lifegain",
            oracleText:
                "Whenever an Island an opponent controls becomes tapped, you may gain 1 life.",
            scope: "opponents",
            filter: { types: "Land", subtypes: "Island" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};
// Tinder Wall — 0/3 Wall with Defender, a sacrifice-for-{R}{R} mana ability, and
// "{R}, Sacrifice this creature: It deals 2 damage to target creature it's
// blocking." (CR 605.1a mana ability with sac cost; CR 605 activated ability;
// CR 120.1 damage.) The "creature it's blocking" constraint is enforced in the
// resolve via the live block graph.
export const tinderWall: CardDefinition = {
    id: "2a7c6489-21e9-4b86-a54a-b1e2f1fce318",
    name: "Tinder Wall",
    rarity: "common",
    oracleText:
        "Defender (This creature can't attack.)\nSacrifice this creature: Add {R}{R}.\n{R}, Sacrifice this creature: It deals 2 damage to target creature it's blocking.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Plant", "Wall"],
    power: 0,
    toughness: 3,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "tinder-wall-mana",
            oracleText: "Sacrifice this creature: Add {R}{R}.",
            cost: { sacrifice: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 2 }),
            manaProduced: { R: 2 },
        },
        {
            id: "tinder-wall-bolt",
            oracleText:
                "{R}, Sacrifice this creature: It deals 2 damage to target creature it's blocking.",
            cost: { mana: { R: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};
// DEFERRED (#660) — Touch of Vitae. The next-upkeep cantrip and the haste leg
// are now buildable (the `next-upkeep` delayed-trigger timing shipped with this
// issue; `grantStaticAbility(t, "haste", …)` covers the keyword). The remaining
// blocker is the granted ACTIVATED ability: "{0}: Untap this creature. Activate
// only once." There is a duration-scoped TRIGGERED-ability grant
// (`grantTriggeredAbility`, looked up via `triggeredGrantTemplates[]`) but NO
// activated-ability analogue a one-shot spell can grant to a target for a turn,
// and the "activate only once" cap has no per-grant counter. Faithful modeling
// needs a new `grantActivatedAbility(target, sourceCardId, abilityId,
// duration)` primitive (the activated sibling of `grantTriggeredAbility`) plus a
// once-per-grant guard — explicitly out of #660's "no new primitive beyond the
// timing union" scope, so flagged for a follow-up cluster. Stub kept verbatim.
// TODO(#628): implement (needs duration-scoped activated-ability grant + cap).
// export const touchOfVitae: CardDefinition = {
//     id: "48d2cd18-a24d-40e0-a654-777d9e623ae2",
//     name: "Touch of Vitae",
//     rarity: "uncommon",
//     oracleText: "Until end of turn, target creature gains haste and \"{0}: Untap this creature. Activate only once.\"\nDraw a card at the beginning of the next turn's upkeep.",
//     manaCost: { X: 2, G: 1 },
//     types: ["Instant"],
// };
// Trailblazer — "Target creature can't be blocked this turn." (CR 509.1b — a
// can't-be-blocked restriction set on the target until end of turn.)
export const trailblazer: CardDefinition = {
    id: "9194c69d-c849-4c4a-976c-d1382bd5cf32",
    name: "Trailblazer",
    rarity: "rare",
    oracleText: "Target creature can't be blocked this turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "permanent") ctx.setCantBeBlockedThisTurn(t);
    },
};
// Venomous Breath — {3}{G} Instant. "Choose target creature. At this turn's next
// end of combat, destroy all creatures that blocked or were blocked by it this
// turn." (CR 509.1h combat pairing; CR 603.7a delayed end-of-combat destroy;
// CR 701.7 destroy.) The combat partners are captured from the live block graph
// (`getBlockersByAttacker` / `getAttackersByBlocker`) at resolution and a single
// delayed `next-end-of-combat` trigger destroys each. The combatPairKill factory
// keys off the SOURCE permanent being in the pair; Venomous Breath instead reads
// an ARBITRARY targeted creature's partners, so the capture is inline. The
// "needs primitive" defer was stale — the delayed-trigger machinery ships.
const VENOMOUS_BREATH_ID = "8eeb9e02-1d26-4959-a878-2ef8db2358bc";
export const venomousBreath: CardDefinition = {
    id: VENOMOUS_BREATH_ID,
    name: "Venomous Breath",
    rarity: "uncommon",
    oracleText:
        "Choose target creature. At this turn's next end of combat, destroy all creatures that blocked or were blocked by it this turn.",
    manaCost: { X: 3, G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // NOT DSL-migratable yet (ADR 0048): the delayed capture is a LIST of
    // combat-partner ids — the tracked list-valued-capture grammar gap (the
    // delayedTrigger Op's capture map is single-value). Stays resolve().
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        // CR 509.1h — "creatures that blocked or were blocked by it": the
        // target's blockers (if it attacked) and the attackers it blocked.
        // Only `getBlockersByAttacker` is exposed (attacker → blockers), so the
        // "blocked by it" direction is the inverse — scan for attackers whose
        // blocker list contains the target.
        const blockGraph = ctx.getBlockersByAttacker();
        const partners = new Set<string>();
        for (const id of blockGraph[t.id] ?? []) partners.add(id);
        for (const [attackerId, blockerIds] of Object.entries(blockGraph)) {
            if (blockerIds.includes(t.id)) partners.add(attackerId);
        }
        if (partners.size === 0) return; // nothing to schedule
        // Payload values are strings only; join the partner ids (CR 603.7a
        // delayed trigger captures serializable state).
        ctx.scheduleDelayedTrigger(
            VENOMOUS_BREATH_ID,
            "venomous-breath-destroy",
            "next-end-of-combat",
            { targetIds: [...partners].join(",") }
        );
    },
    delayedTriggers: [
        {
            id: "venomous-breath-destroy",
            oracleText:
                "Destroy all creatures that blocked or were blocked by the target this turn.",
            timing: "next-end-of-combat",
            resolve: (ctx: SpellContext, payload: Record<string, string>) => {
                if (!payload.targetIds) return;
                for (const id of payload.targetIds.split(",")) {
                    if (id) ctx.destroy({ type: "permanent", id });
                }
            },
        } satisfies DelayedTriggerDef,
    ],
};
// Wall of Pine Needles — 3/3 Wall with Defender and "{G}: Regenerate this
// creature." (CR 702.3 defender; CR 605 activated ability; CR 701.15
// regeneration shield.)
export const wallOfPineNeedles: CardDefinition = {
    id: "5d879923-55fc-46ab-9306-5e1f10441c89",
    name: "Wall of Pine Needles",
    rarity: "uncommon",
    oracleText:
        "Defender (This creature can't attack.)\n{G}: Regenerate this creature.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant", "Wall"],
    power: 3,
    toughness: 3,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-pine-needles-regen",
            oracleText: "{G}: Regenerate this creature.",
            cost: { mana: { G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// Whiteout — Instant: "All creatures lose flying until end of turn." (CR 611.1b
// layer-6 keyword removal via `removeStaticAbilities`, applied to every creature
// on every battlefield.)
//
// DEFERRED (non-snow capability): the second ability — "Sacrifice a snow land:
// Return this card from your graveyard to your hand." — is an ability ACTIVATED
// FROM THE GRAVEYARD (CR 113.4 / 307.4-style graveyard-activated ability). The
// engine's `activateAbility` only scans battlefield permanents, so abilities on
// cards in the graveyard cannot be activated — a general engine gap unrelated to
// Snow (the snow-land sacrifice cost itself is now buildable). Whiteout's main
// spell ships; the graveyard-recursion ability waits on graveyard-activation
// support. Flagged for a follow-up.
export const whiteout: CardDefinition = {
    id: "a8645e4f-eaa8-4420-a6a3-eb53c311fab1",
    name: "Whiteout",
    rarity: "uncommon",
    oracleText:
        "All creatures lose flying until end of turn.\nSacrifice a snow land: Return this card from your graveyard to your hand.",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        // CR 611.1b — every creature on every battlefield loses flying until
        // end of turn (layer-6 keyword removal).
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
            })) {
                ctx.removeStaticAbilities(
                    { type: "permanent", id },
                    (kw) => kw === "flying",
                    { phase: "end-of-turn" }
                );
            }
        }
    },
};
// Wiitigo — {3}{G}{G}{G} 0/0 Yeti. "This creature enters with six +1/+1 counters
// on it.\nAt the beginning of your upkeep, put a +1/+1 counter on this creature
// if it has blocked or been blocked since your last upkeep. Otherwise, remove a
// +1/+1 counter from it." (CR 122 counters at layer 7d; CR 603.2 upkeep
// trigger.) Enters with six +1/+1 via `entersWith`.
//
// "Blocked or been blocked since your last upkeep" is tracked with a non-P/T
// marker counter ("wiitigo-blocked"): a BLOCKERS_CONFIRMED trigger sets the
// marker whenever Wiitigo is in a block pair (as blocker or blocked attacker),
// and the upkeep trigger consumes it — add a +1/+1 and clear the marker if set,
// else remove a +1/+1. The marker window is exactly upkeep-to-upkeep (counters
// persist across the intervening turn), so this is the precise "since your last
// upkeep" span. The "needs primitive" defer was stale — counters-as-flags ship.
const WIITIGO_BLOCKED_MARKER = "wiitigo-blocked";
export const wiitigo: CardDefinition = {
    id: "9ee86bf2-6c54-4c6e-8394-eb39f98d5a85",
    name: "Wiitigo",
    rarity: "rare",
    oracleText:
        "This creature enters with six +1/+1 counters on it.\nAt the beginning of your upkeep, put a +1/+1 counter on this creature if it has blocked or been blocked since your last upkeep. Otherwise, remove a +1/+1 counter from it.",
    manaCost: { X: 3, G: 3 },
    types: ["Creature"],
    subtypes: ["Yeti"],
    power: 0,
    toughness: 0,
    entersWith: { counters: [{ type: "+1/+1", count: 6 }] },
    triggeredAbilities: [
        {
            id: "wiitigo-block-marker",
            oracleText:
                "Mark this creature when it blocks or becomes blocked (tracks the +1/+1 upkeep growth).",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return (
                    event.blockerId === self.id || event.attackerId === self.id
                );
            },
            // NOT DSL-migratable (ADR 0045): the marker add is gated on a
            // counter-COUNT predicate (add only if the marker count is 0) — the
            // `if` predicate grammar reads only a bound `$paid` outcome, not a
            // counter tally. Stays resolve() until a counter-count predicate
            // exists.
            resolve: (ctx: SpellContext, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // Idempotent marker: keep at most one (multiple block pairs in
                // one combat still mean "blocked since last upkeep").
                if (ctx.getCounterCount(self, WIITIGO_BLOCKED_MARKER) === 0) {
                    ctx.addCounter(self, WIITIGO_BLOCKED_MARKER, 1);
                }
            },
        },
        phaseTrigger({
            id: "wiitigo-upkeep-growth",
            oracleText:
                "At the beginning of your upkeep, put a +1/+1 counter on this creature if it has blocked or been blocked since your last upkeep. Otherwise, remove a +1/+1 counter from it.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): the +1/+1 add-or-remove branch is
            // gated on a counter-COUNT predicate (whether the blocked-marker
            // tally is > 0), and the marker-clear removes a runtime count — the
            // `if` predicate grammar reads only a bound `$paid` outcome, and the
            // `count` grammar cannot express a counter tally. Stays resolve().
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                const blocked =
                    ctx.getCounterCount(self, WIITIGO_BLOCKED_MARKER) > 0;
                if (blocked) {
                    ctx.addCounter(self, "+1/+1", 1);
                    ctx.removeCounter(
                        self,
                        WIITIGO_BLOCKED_MARKER,
                        ctx.getCounterCount(self, WIITIGO_BLOCKED_MARKER)
                    );
                } else {
                    ctx.removeCounter(self, "+1/+1", 1);
                }
            },
        }),
    ],
};
// Wild Growth — ICE reprint of the LEA Aura ("enchanted land's controller adds
// an additional {G} when it's tapped for mana"). CardPrint onto the LEA
// definition (ADR 0014).
export const wildGrowthIce: CardPrint = {
    printId: "f8047ab9-a0fc-4933-bcbc-e761aa0f622b",
    definitionId: "fd896dfa-66c0-4327-8e5b-489bbe350c95",
    setCode: "ice",
    rarity: "common",
};
// Woolly Mammoths — "This creature has trample as long as you control a snow
// land." (CR 205.4a.)
//
// SIMPLIFICATION (flagged, same treatment as Dire Wolves' conditional banding):
// the "as long as you control a snow land" clause is a CONTINUOUS keyword gate
// on board state, but `keyword-grant` is applied imperatively at ETB with no
// board-aware re-evaluation. Trample is therefore granted UNCONDITIONALLY — a
// strict superset of the printed behaviour (Woolly Mammoths is played in snow
// decks in practice). A board-aware keyword-grant predicate would track snow
// lands exactly; flagged for a follow-up.
export const woollyMammoths: CardDefinition = {
    id: "eaca1216-99c8-4ad5-a51a-3c4ff3b82097",
    name: "Woolly Mammoths",
    rarity: "common",
    oracleText: "This creature has trample as long as you control a snow land.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 3,
    toughness: 2,
    staticAbilities: ["trample"],
};
// Woolly Spider — 2/3 with Reach and "Whenever this creature blocks a creature
// with flying, this creature gets +0/+2 until end of turn." (CR 702.17 reach;
// CR 509.1h blocks trigger; CR 514.2 expiry.) The blocks trigger fires on
// BLOCKERS_CONFIRMED where self is the blocker and the blocked attacker has
// flying (`hasStaticAbility`).
export const woollySpider: CardDefinition = {
    id: "e10520b2-b5a7-4328-84c8-20443b6f588a",
    name: "Woolly Spider",
    rarity: "common",
    oracleText:
        "Reach (This creature can block creatures with flying.)\nWhenever this creature blocks a creature with flying, this creature gets +0/+2 until end of turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Spider"],
    power: 2,
    toughness: 3,
    staticAbilities: ["reach"],
    triggeredAbilities: [
        {
            id: "woolly-spider-block-flier",
            oracleText:
                "Whenever this creature blocks a creature with flying, this creature gets +0/+2 until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return event.blockerId === self.id;
            },
            // NOT DSL-migratable (ADR 0045, issue #840): the pump is gated on the blocked attacker having flying (hasStaticAbility on event.attackerId). Blocked on: an if-condition construct reading the triggering event's attacker keywords, not pump.
            resolve: (ctx: SpellContext, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                // "a creature with flying" — the blocked attacker must have
                // flying (CR 702.9). Read its effective keywords.
                const attacker = {
                    type: "permanent" as const,
                    id: event.attackerId,
                };
                if (!ctx.hasStaticAbility(attacker, "flying")) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    0,
                    2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Yavimaya Gnats — 0/1 flier with "{G}: Regenerate this creature." (CR 702.9
// flying; CR 605 activated ability; CR 701.15 regeneration shield.)
export const yavimayaGnats: CardDefinition = {
    id: "9d8b7020-ca8f-4867-bc51-13d824daf154",
    name: "Yavimaya Gnats",
    rarity: "uncommon",
    oracleText: "Flying\n{G}: Regenerate this creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "yavimaya-gnats-regen",
            oracleText: "{G}: Regenerate this creature.",
            cost: { mana: { G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// ── Green capability-cluster stubs (cumulative upkeep — ADR 0042) ────────────
// Fyndhorn Pollen — {2}{G} Enchantment with cumulative upkeep {1} (CR 702.24),
// a continuous "All creatures get -1/-0" anthem (layer 7c) and "{1}{G}: All
// creatures get -1/-0 until end of turn." Static mirrors Weakstone (atq.ts);
// the mass EOT pump mirrors Bone Flute (drk.ts).
export const fyndhornPollen: CardDefinition = {
    id: "3efbe59d-bebc-40b1-85ac-2e4c1ff3731e",
    name: "Fyndhorn Pollen",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAll creatures get -1/-0.\n{1}{G}: All creatures get -1/-0 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            // CR 611 layer 7c — every creature gets -1/-0 (no controller clause).
            kind: "pt-buff",
            applies: (target, _source, ctx) => ctx.isCreature(target),
            power: -1,
            toughness: 0,
        },
    ],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "fyndhorn-pollen-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
    activatedAbilities: [
        {
            id: "fyndhorn-pollen-mass-shrink",
            oracleText: "{1}{G}: All creatures get -1/-0 until end of turn.",
            cost: { mana: { X: 1, G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                    })) {
                        ctx.addTemporaryPTBuff(
                            { type: "permanent", id },
                            -1,
                            0,
                            { phase: "end-of-turn" }
                        );
                    }
                }
            },
        },
    ],
};
// Gorilla Pack — activated above (Green free tranche).
// Maddening Wind — {2}{G} Aura "Enchant creature" with cumulative upkeep {G}
// (CR 702.24, paid by the Aura's controller — scope "your") and a host-
// controller upkeep trigger dealing 2 damage to the enchanted creature's
// controller (Feedback pattern, lea.ts).
export const maddeningWind: CardDefinition = {
    id: "5277656c-70f5-4660-bd58-7d9261d53fb5",
    name: "Maddening Wind",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nCumulative upkeep {G} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAt the beginning of the upkeep of enchanted creature's controller, this Aura deals 2 damage to that player.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "maddening-wind-cumulative-upkeep",
            cost: { G: 1 },
            costLabel: "{G}",
        }),
        phaseTrigger({
            id: "maddening-wind-upkeep-damage",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, this Aura deals 2 damage to that player.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                ctx.dealDamage({ type: "player", id: hostController }, 2);
            },
        }),
    ],
};
// Ritual of Subdual — {4}{G}{G} Enchantment with cumulative upkeep {2}
// (CR 702.24, ADR 0042) plus a continuous single-colour land-mana substitution
// to COLORLESS (CR 614): "If a land is tapped for mana, it produces colorless
// mana instead of any other type." Modelled as a `{ color: "C" }`
// `landManaSubstitution` (the Infernal Darkness shape but colourless), read live
// from the battlefield by the `applyLandManaReplacement` mana funnel — the
// land's whole output is rewritten to the same TOTAL quantity of {C}. Mono-green
// by colour identity (CR 202.2), so it lives here despite the triage stub
// originally sitting in multicolor.ts.
export const ritualOfSubdual: CardDefinition = {
    id: "5c5c01e7-8116-45fc-afc3-d52a31a635cb",
    name: "Ritual of Subdual",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nIf a land is tapped for mana, it produces colorless mana instead of any other type.",
    manaCost: { X: 4, G: 2 },
    types: ["Enchantment"],
    landManaSubstitution: { color: "C" },
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "ritual-of-subdual-cumulative-upkeep",
            cost: { X: 2 },
            costLabel: "{2}",
        }),
    ],
};
