// Ice Age (ICE) — Red (mono-R) cards, split by colour per ADR 0043.
// The registry's `import * as ice from "./sets/ice"` resolves through
// ice/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {1}{G} → { X: 1, G: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).
import type {
    CardDefinition,
    CardPrint,
    PermanentView,
    SpellContext,
    TargetSelection,
} from "../../types";
import { controlsSnowSubtype } from "../../snowReads";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { cumulativeUpkeepTrigger } from "../../abilities/cumulativeUpkeep";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Red free tranche (#633)
//
// The free-tranche Red cards — expressible entirely with already-shipped
// primitives — are activated below (intermixed with the remaining commented
// stubs). Reprints already implemented in earlier sets (Stone Rain, Shatter)
// are CardPrints onto their existing LEA definitions (ADR 0014); new-to-ICE Red
// cards are full CardDefinitions. Pyroblast is the colour-mirror of Hydroblast
// (modal counter/destroy gated on blue).
//
// RED COMPLETION (#656) — the specialized-interaction cards below were
// activated once their stub comments were re-checked against shipped primitives
// (several "needs primitive" notes were STALE): Aggression, Balduvian Hydra,
// Battle Frenzy, Bone Shaman, Chaos Lord, Dwarven Armory, Game of Chaos, Goblin
// Mutant, Goblin Sappers, Grizzled Wolverine, Márton Stromgald, Aurochs,
// Mudslide, Orcish Squatters, and Total War. No new SpellContext primitive was
// added — all compose `addTemporaryPTBuff`, `requestCoinFlip`/`requestOptionChoice`,
// `gainControl` (control-change conditions), `grantTriggeredAbility`,
// `entersWith` (`count: "X"`), `untapRestriction`, `activationPhaseRestriction`,
// `scheduleDelayedTrigger`, and the combat read getters (`getIsAttacking`,
// `getBlockersByAttacker`, attack/block-restriction static effects).
//
// DEFERRED (remain commented stubs, owned by a later cluster):
//   • Cumulative upkeep — Brand of Ill Omen (ADR 0042 cluster).
//   • Snow-matters — Avalanche (destroy snow lands), Barbarian Guides (snow
//     landwalk grant), Glacial Crevasses / Goblin Ski Patrol / Karplusan Giant
//     (snow Mountain cost / requirement), Melting (un-snow lands) (no snow
//     supertype filter / snow-evasion plumbing yet — snow cluster).
//   • Divided-as-you-choose damage / counters — Fire Covenant, Fiery Justice,
//     Meteor Shower, Spoils of War: SHIPPED (#664). `dealDamageDividedAsChosen`
//     / `distributeCountersAsChosen` + the `divideAsChosen` target requirement
//     implement player-chosen ≥1-each division (CR 601.2d / 120.4), plus the
//     pay-X-life additional cost (Fire Covenant) and cast-time graveyard-derived
//     X (Spoils of War).
//   • Next-upkeep delayed cantrip — Flare, Panic ("draw a card at the beginning
//     of the next turn's upkeep"): ACTIVE (#660 — the `next-upkeep` timing
//     shipped).
//   • Count-of-declared-attackers attack restrictions — Errantry ("can only
//     attack alone"), Orcish Conscripts ("can't attack/block unless two other
//     creatures attack/block"): ACTIVE (#729). The `declared-attack-restriction`
//     / `declared-block-restriction` static-effect kinds read the COMPLETE
//     declared set and are evaluated at attacker/blocker confirmation
//     (`validateDeclaredAttackers` / `validateDeclaredBlockers`), the mirror of
//     the menace `validateMinimumBlockers` check.
//   • Library random-exile + reorder — Orcish Librarian ("look at top eight,
//     exile four at RANDOM, reorder the rest"). `peekLibraryTop` /
//     `reorderLibraryTop` / the `scryReorder` Op ship, but no SpellContext
//     primitive selects/exiles N cards at random from a library set (the seeded
//     PRNG is engine-internal; only hand-shaped draws are exposed).
//     tracked-by: #1702
//   • Other specialized interactions — Chaos Moon (parity mana substitution),
//     Earthlink (dies→sac-land), Ghostly Flame (colourless-damage-source
//     static), Melee / Monsoon (choose-blocks / Island-count end-step),
//     Orcish Farmer (land-type change), Mountain Titan (cast-trigger counter
//     grant). Curse of Marit Lage (Island untap-lock) is IMPLEMENTED below as
//     the Wrath-of-Marit-Lage twin. Each remaining card needs a primitive not
//     yet built; flagged for its capability cluster.
// ─────────────────────────────────────────────────────────────────────────────

// Aggression — {2}{R} Aura on a non-Wall creature. Grants first strike + trample
// (two layer-6 keyword-grants on the host, CR 611/702) and an end-step
// self-destruct on the host if it didn't attack (CR 603.6a phase trigger +
// CR 506.2 `hasAttackedThisTurn`). The end-step trigger fires on the HOST
// controller's end step; it reads the host via `getAttachedTo` and destroys it
// when its `hasAttackedThisTurn` marker is false. The "non-Wall" enchant
// restriction is enforced by the target filter (`excludeSubtype: "Wall"`).
export const aggression: CardDefinition = {
    id: "f3f26060-0c24-496c-b8e2-4dac7ea6166b",
    name: "Aggression",
    rarity: "uncommon",
    oracleText:
        "Enchant non-Wall creature\nEnchanted creature has first strike and trample.\nAt the beginning of the end step of enchanted creature's controller, destroy that creature if it didn't attack this turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        excludeSubtypes: "Wall",
    },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "first strike",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "trample",
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "aggression-end-step-destroy",
            oracleText:
                "At the beginning of the end step of enchanted creature's controller, destroy that creature if it didn't attack this turn.",
            phase: "END_STEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045, PRD #795 assessment): the body
            // reads the Aura's ATTACHED HOST via `ctx.getAttachedTo` and
            // conditionally destroys it based on `ctx.hasAttackedThisTurn` —
            // neither a host-object selector nor an "attacked this turn"
            // predicate exists in the EffectObjectSelector / `if`-predicate
            // grammar (only `$source`/`$each`/announced targets are
            // resolvable refs, per `EffectObjectSelector` in
            // convex/cards/types.ts). Blocked on: an attached-host object
            // selector + a combat-history predicate, not destroy.
            resolve: (ctx, _event, scopedPlayerId) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                const host: TargetSelection = {
                    type: "permanent",
                    id: hostId,
                };
                // Only fire on the HOST controller's end step (CR 603.6a).
                if (ctx.getController(host) !== scopedPlayerId) return;
                // CR 506.2 — destroy if the host didn't attack this turn.
                if (!ctx.hasAttackedThisTurn(host)) {
                    ctx.destroy(host);
                }
            },
        }),
    ],
};
// Anarchy — "Destroy all white permanents." (CR 701.7 destroy + CR 105.2 colour
// filter.) A one-line `destroyAll` over the white colour filter.
export const anarchy: CardDefinition = {
    id: "28d941da-b5cb-4b7e-84f2-ece883f89af3",
    name: "Anarchy",
    rarity: "uncommon",
    oracleText: "Destroy all white permanents.",
    manaCost: { X: 2, R: 2 },
    types: ["Sorcery"],
    // Migrated resolve()→effects[] (ADR 0045, PRD #795): the Day of Judgment
    // sweep shape — forEach over battlefield permanents matching the colour
    // filter, destroy each (CR 701.7 / 105.2).
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { color: "W" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};
// Avalanche — Destroy X target SNOW lands (CR 205.4a). `count: "X"` resolves the
// number of land targets against the chosen X; the `supertypeFilter: ["Snow"]`
// keeps only live snow lands as legal targets (snow-aware — honors Melting /
// Arcum's Weathervane).
//
// Mana cost is {X}{2}{R}{R} (MTGJSON ICE.json) — the fixed {2} generic pip
// alongside the variable {X} uses `generic` (Soul Burn's `{X}{2}{B}` shape,
// ice/black.ts). The stale "not representable" note above predated that
// field; the widened data/json conformance guard caught the drift (the
// stub had shipped one generic mana cheap as {X}{R}{R}).
export const avalanche: CardDefinition = {
    id: "d3a925e5-0d0a-42ec-b1c6-9793b8e11625",
    name: "Avalanche",
    rarity: "uncommon",
    oracleText: "Destroy X target snow lands.",
    manaCost: { X: "X", generic: 2, R: 2 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Land",
        count: "X",
        supertypeFilter: ["Snow"],
    },
    // Migrated resolve()→effects[] (ADR 0045, PRD #795): a forEach over the
    // announced `{ set: "targets" }` set (the X-multi-target shape) destroying
    // each (CR 701.7). No hand-written per-card outcome test exists (the
    // colorless.test.ts coverage checks target legality only) — the per-Op
    // regime (catalogue static sweep + canned-scenario smoke) covers it.
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};
// Balduvian Barbarians — {1}{R}{R} 3/2 vanilla Human Barbarian (CR 302).
export const balduvianBarbarians: CardDefinition = {
    id: "efeabe8e-8107-4d19-8a43-362aa79cdd92",
    name: "Balduvian Barbarians",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Barbarian"],
    power: 3,
    toughness: 2,
};
// Balduvian Hydra — {X}{R}{R} 0/1 Hydra. Enters with X +1/+0 counters (CR 122.1 /
// 614.1c `entersWith` with `count: "X"`, the Iceberg pattern). "Remove a +1/+0
// counter: Prevent the next 1 damage to it this turn" is a counter-removal-cost
// activated ability (CR 602.1 cost + CR 615 prevention shield on self, the
// Fylgja pattern). "{R}{R}{R}: Put a +1/+0 counter on this. Activate only during
// your upkeep" reuses `activationPhaseRestriction: ["UPKEEP"]` + `controllerTurnOnly`
// (the Clockwork Avian timing).
export const balduvianHydra: CardDefinition = {
    id: "c3a3b37f-daa6-4502-bb12-c72afe3df035",
    name: "Balduvian Hydra",
    rarity: "rare",
    oracleText:
        "This creature enters with X +1/+0 counters on it.\nRemove a +1/+0 counter from this creature: Prevent the next 1 damage that would be dealt to it this turn.\n{R}{R}{R}: Put a +1/+0 counter on this creature. Activate only during your upkeep.",
    manaCost: { X: "X", R: 2 },
    types: ["Creature"],
    subtypes: ["Hydra"],
    power: 0,
    toughness: 1,
    entersWith: { counters: [{ type: "+1/+0", count: "X" }] },
    activatedAbilities: [
        {
            id: "balduvian-hydra-prevent",
            oracleText:
                "Remove a +1/+0 counter from this creature: Prevent the next 1 damage that would be dealt to it this turn.",
            cost: { removeCounter: { type: "+1/+0", count: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-1
            // shield on the source itself (`$source`, CR 615.1).
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { ref: "$source" },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "balduvian-hydra-grow",
            oracleText:
                "{R}{R}{R}: Put a +1/+0 counter on this creature. Activate only during your upkeep.",
            cost: { mana: { R: 3 } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            // CR 122 (issue #841) — put one +1/+0 counter on the source.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+0",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
    ],
};
// Barbarian Guides — "{2}{R}, {T}: Choose a land type. Target creature you
// control gains snow landwalk of the chosen type until end of turn. Return that
// creature to its owner's hand at the beginning of the next end step."
// (CR 702.13 / 205.4a snow landwalk.) The land-type choice is a
// `requestOptionChoice` over the five basic types; the matching
// `snow <type>walk` keyword (enforced by the combat registry's snow-landwalk
// rules) is granted until end of turn, and a `next-end-step` delayed trigger
// bounces the creature.
const BARBARIAN_GUIDES_ID = "fe65a045-dacb-4392-bcb6-843394ef98c9";
const SNOW_LANDWALK_BY_TYPE: Record<string, string> = {
    Plains: "snow plainswalk",
    Island: "snow islandwalk",
    Swamp: "snow swampwalk",
    Mountain: "snow mountainwalk",
    Forest: "snow forestwalk",
};
export const barbarianGuides: CardDefinition = {
    id: BARBARIAN_GUIDES_ID,
    name: "Barbarian Guides",
    rarity: "common",
    oracleText:
        "{2}{R}, {T}: Choose a land type. Target creature you control gains snow landwalk of the chosen type until end of turn. Return that creature to its owner's hand at the beginning of the next end step. (It can't be blocked as long as defending player controls a snow land of that type.)",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Barbarian"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "barbarian-guides-snow-landwalk",
            oracleText:
                "{2}{R}, {T}: Choose a land type. Target creature you control gains snow landwalk of the chosen type until end of turn. Return that creature to its owner's hand at the beginning of the next end step.",
            cost: { mana: { X: 2, R: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            // NOT DSL-migratable (ADR 0045, PRD #795 re-assessment): the STALE
            // reason below (delayedTrigger inline-body-only) is gone — both the
            // `optionChoice` Op (land-type pick) and the `delayedTrigger` Op's
            // inline body now ship. Re-blocked for a DIFFERENT, concrete
            // reason: the `delayedTrigger` Op always persists the FIXED
            // sentinel `INLINE_DELAYED_TRIGGER_ID` ("$inline-effects") as the
            // scheduled instance's `triggerId` (`convex/gre/effects/
            // interpreter.ts`), never the card-chosen id below. This card's
            // OWN pre-existing per-card test
            // (`ice/__tests__/red.test.ts` "Barbarian Guides") asserts
            // `state.delayedTriggers` contains a `triggerId ===
            // "barbarian-guides-bounce"` entry — migrating would silently
            // change that id and either fail the untouched harness or force
            // editing it (forbidden by the migration playbook). Blocked on:
            // this specific test's literal id assertion, not an Op gap.
            // Stays resolve().
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                const chosen = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "barbarian-guides-land-type",
                    prompt: "Choose a land type for snow landwalk.",
                    options: [
                        { id: "Plains", label: "Plains" },
                        { id: "Island", label: "Island" },
                        { id: "Swamp", label: "Swamp" },
                        { id: "Mountain", label: "Mountain" },
                        { id: "Forest", label: "Forest" },
                    ],
                });
                if (chosen === undefined) return; // suspended on the choice
                const keyword = SNOW_LANDWALK_BY_TYPE[chosen];
                if (keyword) {
                    ctx.grantStaticAbility(t, keyword, {
                        phase: "end-of-turn",
                    });
                }
                ctx.scheduleDelayedTrigger(
                    BARBARIAN_GUIDES_ID,
                    "barbarian-guides-bounce",
                    "next-end-step",
                    { creatureId: t.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "barbarian-guides-bounce",
            oracleText:
                "Return that creature to its owner's hand at the beginning of the next end step.",
            timing: "next-end-step",
            // NOT DSL-migratable (ADR 0045, PRD #795): this legacy
            // `delayedTriggers[]` template body is inseparable from the
            // scheduling ability's own marker above — see that marker for
            // the full reason (the `delayedTrigger` Op's fixed sentinel
            // triggerId would break this card's untouched per-card test).
            resolve: (ctx, payload) => {
                if (payload.creatureId) {
                    ctx.returnToHand({
                        type: "permanent",
                        id: payload.creatureId,
                    });
                }
            },
        },
    ],
};
// Battle Frenzy — {2}{R} Instant. One-shot batch pump (CR 611.1): a fixed
// snapshot at resolution of the creatures you control, green ones get +1/+1 and
// the rest +1/+0, both until end of turn. Composes `getBattlefieldIds` +
// `getColors` + `addTemporaryPTBuff` — no anthem static (the buff is a one-time
// instant, not a continuous effect; new creatures entering later aren't pumped).
export const battleFrenzy: CardDefinition = {
    id: "a85ae675-56ca-4a00-83d2-ee035f33d6d1",
    name: "Battle Frenzy",
    rarity: "common",
    oracleText:
        "Green creatures you control get +1/+1 until end of turn.\nNongreen creatures you control get +1/+0 until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    // NOT DSL-migratable (ADR 0045, issue #840): the toughness bonus is conditional per-creature on colour (green +1/+1, nongreen +1/+0). Blocked on: a colour predicate in the forEach select / an if-condition on $each's colour, not pump.
    resolve: (ctx: SpellContext) => {
        for (const id of ctx.getBattlefieldIds(ctx.controller, {
            types: "Creature",
        })) {
            const target: TargetSelection = { type: "permanent", id };
            const isGreen = ctx.getColors(target).includes("G");
            ctx.addTemporaryPTBuff(target, 1, isGreen ? 1 : 0, {
                phase: "end-of-turn",
            });
        }
    },
};
// Bone Shaman — {2}{R}{R} 3/3 Giant Shaman. "{B}: Until end of turn, this
// creature gains 'Creatures dealt damage by this creature this turn can't be
// regenerated this turn.'" The activated ability grants a DAMAGE-DEALT triggered
// ability to self until end of turn (CR 611.1b duration-scoped trigger grant via
// `grantTriggeredAbility`); the granted rider (a `damageDealtTrigger` template on
// `triggeredGrantTemplates[]`) fires whenever self deals damage to a creature and
// applies a regen-lock to that creature (CR 701.15c, the Lim-Dûl's Cohort leg).
const BONE_SHAMAN_ID = "0a5e3d54-4dc4-482b-8ecc-bb819ba03d2c";
export const boneShaman: CardDefinition = {
    id: BONE_SHAMAN_ID,
    name: "Bone Shaman",
    rarity: "common",
    oracleText:
        '{B}: Until end of turn, this creature gains "Creatures dealt damage by this creature this turn can\'t be regenerated this turn."',
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Giant", "Shaman"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "bone-shaman-grant-rider",
            oracleText:
                '{B}: Until end of turn, this creature gains "Creatures dealt damage by this creature this turn can\'t be regenerated this turn."',
            cost: { mana: { B: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantTriggeredAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    BONE_SHAMAN_ID,
                    "bone-shaman-no-regen-rider",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    // Granted-only rider (CR 113.1): kept off `triggeredAbilities` so Bone Shaman
    // doesn't carry it natively — it functions only while granted by the ability.
    triggeredGrantTemplates: [
        damageDealtTrigger({
            id: "bone-shaman-no-regen-rider",
            oracleText:
                "Creatures dealt damage by this creature this turn can't be regenerated this turn.",
            source: "self",
            resolve: (ctx, _event, damage) => {
                if (damage.target.type === "permanent") {
                    ctx.setTargetCantBeRegeneratedThisTurn(damage.target);
                }
            },
        }),
    ],
};
// Brand of Ill Omen — {3}{R} Aura. "Enchant creature / Cumulative upkeep {R} /
// Enchanted creature's controller can't cast creature spells." The cast clause
// is a player-scoped `cast-restriction` static (CR 601.3a, #669): scanned at the
// cast gate (`getLegalActions` / cast mutation) and client-side, it forbids the
// HOST creature's controller from casting any creature spell. The restriction is
// read-time only — it never mutates a permanent and auto-reverts when the Aura
// leaves play (the host loses its host, or the Aura is sacrificed to cumulative
// upkeep). Cumulative upkeep {R} reuses `cumulativeUpkeepTrigger` (ADR 0042).
export const brandOfIllOmen: CardDefinition = {
    id: "ceeb7bbc-2d41-4709-95be-1ceb952ed1fb",
    name: "Brand of Ill Omen",
    rarity: "rare",
    oracleText:
        "Enchant creature\nCumulative upkeep {R} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nEnchanted creature's controller can't cast creature spells.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        cumulativeUpkeepTrigger({ cost: { R: 1 }, costLabel: "{R}" }),
    ],
    staticEffects: [
        {
            kind: "cast-restriction",
            id: "brand-of-ill-omen-no-creature-spells",
            // CR 601.3a — the host creature's controller can't cast creature
            // spells. `forbids` returns true (cast FORBIDDEN) when `caster`
            // controls this Aura's host AND the spell is a creature spell. The
            // host is found via `source.attachedTo`; an unattached Aura (still
            // on the stack, or its host gone) forbids nothing.
            forbids: (caster, spell, source, state, ctx) => {
                if (!spell.types.includes("Creature")) return false;
                const hostId = (source as { attachedTo?: string }).attachedTo;
                if (!hostId) return false;
                for (const player of state.players) {
                    const host = player.battlefield.find(
                        (c) => c.id === hostId
                    );
                    if (host) return host.controllerId === caster;
                }
                // `ctx` unused for this predicate; spell typing is read off the
                // live `types` array, which a `type-add` effect keeps current.
                void ctx;
                return false;
            },
            oracleText:
                "Enchanted creature's controller can't cast creature spells.",
        },
    ],
};
// Chaos Lord — {4}{R}{R}{R} 7/7 Human with first strike. "At the beginning of
// your upkeep, target opponent gains control of this creature if the number of
// permanents is even" — an upkeep trigger (CR 603.6a, scope "your") that counts
// every permanent on the battlefield (sum of unfiltered `getBattlefieldIds` over
// `allPlayerIds`, CR 122-agnostic) and, on an even count, hands control to the
// opponent for the rest of the game (`gainControl`, layer-2 control change, no
// condition → permanent).
//
// "This creature can attack as though it had haste unless it entered this
// turn" (CR 508.1a / 702.10b) is a CONDITIONAL attack permission, strictly
// NARROWER than haste, and it is NOT redundant with plain summoning sickness.
// The two gates read different clocks:
//   - CR 302.6 summoning sickness asks "has it been under its controller's
//     control continuously since that controller's most recent turn began?"
//     — re-set by a CONTROL CHANGE (`isSummoningSick`).
//   - This clause asks "did it ENTER the battlefield this turn?" — a zone
//     change only (`enteredOnTurn`, CR 400.7), untouched by a control change.
// The reachable gap between them is a MID-TURN control change: an external
// steal that lands during the new controller's OWN turn, after their untap
// step, from an effect that does NOT itself grant haste and CAN legally take a
// 7-mana 7/7. Shipped exemplars, all activatable/castable in the thief's own
// precombat main: Infernal Denizen (`ice/black.ts:1343`, `{T}: Gain control of
// target creature`, `targetRequirement: { type: "Creature", count: 1 }` — no
// filter, no haste grant), Merieke Ri Berit (`ice/multicolor.ts:870`, same
// unfiltered `{T}:` steal), and Dominate (`nem/blue.ts:102`, `mvFilter: { max:
// "X" }` — X ≥ 7 reaches a Chaos Lord). `applyControlChange` re-sets
// `isSummoningSick`, no untap step intervenes before that turn's combat, but
// `enteredOnTurn` still points at an earlier turn — so the clause is what lets
// the stolen 7/7 swing the turn it is taken. Conversely a FRESHLY CAST Chaos
// Lord entered this turn, gets no permission, and is held back by ordinary
// summoning sickness — the restriction that offsets a 7/7 first-striker for
// {4}{R}{R}{R}.
//
// NOTE — the card's OWN upkeep trigger below is NOT the case this covers, and
// reasoning from it gets the card backwards. That trigger is `scope: "your"`,
// so it fires on the controller's upkeep and hands the Lord to the NON-active
// player; `untapStep` (`gre/phases.ts`) then clears `isSummoningSick` for the
// active player's whole battlefield unconditionally, so the recipient always
// gets a full untap step of their own before their combat. Via the parity
// hand-off alone the grant is never load-bearing.
//
// Modelled as a CR 611.2c "as long as ..." conditional layer-6 keyword grant
// of `haste` (`keyword-grant` + `condition`, the Kavu Runner shape, issue
// #1095), NOT as an unconditional `staticAbilities` entry. The grant is
// materialized into the instance's `staticAbilities`, which is exactly what
// `validateAttackerEligibility` (`gre/combat.ts`, CR 702.10b) reads, and
// `refreshCounterGatedStatics` re-evaluates the condition on every stable
// transition — so haste appears the turn AFTER the Lord arrives, with no
// per-reader layer hop. (Granting the `haste` keyword rather than an
// attack-only permission is the project's established reading of "can attack
// as though it had haste": Instill Energy, `lea/green.ts`, does the same. The
// difference — real haste also lifts the CR 302.6 {T}-ability lock — is
// unobservable here: Chaos Lord has no activated abilities.)
export const chaosLord: CardDefinition = {
    id: "ee245922-b380-4b2e-a43f-ab1ba8078943",
    name: "Chaos Lord",
    rarity: "rare",
    oracleText:
        "First strike\nAt the beginning of your upkeep, target opponent gains control of this creature if the number of permanents is even.\nThis creature can attack as though it had haste unless it entered this turn.",
    manaCost: { X: 4, R: 3 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 7,
    toughness: 7,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: EFFECT_AFFECTS_SELF,
            // CR 400.7 / 611.2c — "unless it entered this turn". FAILS
            // CLOSED on either side being `undefined`: an absent entry stamp
            // means "unknown", NOT "entered earlier", so a bare
            // `enteredOnTurn !== state.turn` would read `undefined !== 5` as
            // true and hand a stamp-less summoning-sick Lord the permission —
            // exactly the bug this card's grant exists to prevent. The
            // `source.enteredOnTurn !== undefined` guard is the REACHABLE one
            // (any permanent staged without going through
            // `markEnteredThisTurn`); the `state.turn` guard covers the
            // optional-by-contract view field (`StaticEffectStateView.turn`).
            // A permission is only ever granted on positive evidence.
            condition: (source, state) =>
                state.turn !== undefined &&
                source.enteredOnTurn !== undefined &&
                source.enteredOnTurn !== state.turn,
            keyword: "haste",
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "chaos-lord-parity-control",
            oracleText:
                "At the beginning of your upkeep, target opponent gains control of this creature if the number of permanents is even.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): the control hand-off is gated on a
            // RUNTIME parity read — "if the number of [all] permanents is even"
            // (a count of every permanent on the battlefield, CR 700). The
            // gainControl Op (#848) is COVERED, but no `if` predicate can express
            // "the total permanent count is even" (a count-of-all-permanents
            // parity test — a value/predicate grammar gap). Blocked on: a
            // board-wide permanent-count parity predicate — stays resolve().
            resolve: (ctx) => {
                // CR 700 — count every permanent on the battlefield.
                let total = 0;
                for (const pid of ctx.allPlayerIds) {
                    total += ctx.getBattlefieldIds(pid).length;
                }
                if (total % 2 !== 0) return;
                const opponent = ctx.allPlayerIds.find(
                    (pid) => pid !== ctx.controller
                );
                if (!opponent) return;
                ctx.gainControl(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    opponent
                );
            },
        }),
    ],
};
// Chaos Moon — "At the beginning of each upkeep, count the number of
// permanents. If the number is odd, until end of turn, red creatures get +1/+1
// and whenever a player taps a Mountain for mana, that player adds an
// additional {R}. If the number is even, until end of turn, red creatures get
// -1/-1 and if a player taps a Mountain for mana, that Mountain produces
// colorless mana instead of any other type." (CR 603.6a each-upkeep trigger,
// CR 700 permanent count, CR 611 until-EOT P/T, CR 614 / 514.2 turn-scoped
// land-mana riders.) The parity-dependent Mountain rider is armed via the
// generalized `addLandManaRider` turn-scoped primitive (the High Tide funnel):
// odd → an "additional" {R} per Mountain tap; even → an "override" to {C}.
export const chaosMoon: CardDefinition = {
    id: "aae0543f-7f8b-4327-b735-ac21244e9936",
    name: "Chaos Moon",
    rarity: "rare",
    oracleText:
        "At the beginning of each upkeep, count the number of permanents. If the number is odd, until end of turn, red creatures get +1/+1 and whenever a player taps a Mountain for mana, that player adds an additional {R}. If the number is even, until end of turn, red creatures get -1/-1 and if a player taps a Mountain for mana, that Mountain produces colorless mana instead of any other type.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "chaos-moon-parity",
            oracleText:
                "At the beginning of each upkeep, count the number of permanents. If the number is odd, red creatures get +1/+1 and a Mountain tapped for mana adds an additional {R} until end of turn; if even, red creatures get -1/-1 and a Mountain tapped for mana produces colorless instead.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx) => {
                // CR 700 — count every permanent on the battlefield.
                let total = 0;
                for (const pid of ctx.allPlayerIds) {
                    total += ctx.getBattlefieldIds(pid).length;
                }
                const odd = total % 2 !== 0;
                // Red creatures get ±1/±1 until end of turn (CR 611).
                const delta = odd ? 1 : -1;
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                        colors: "R",
                    })) {
                        ctx.addTemporaryPTBuff(
                            { type: "permanent", id },
                            delta,
                            delta,
                            { phase: "end-of-turn" }
                        );
                    }
                }
                // Mountain land-mana rider until end of turn (CR 614 / 514.2).
                ctx.addLandManaRider(
                    odd
                        ? {
                              subtype: "Mountain",
                              color: "R",
                              mode: "additional",
                          }
                        : { subtype: "Mountain", color: "C", mode: "override" }
                );
            },
        }),
    ],
};
// Conquer — Aura granting control of the enchanted LAND (CR 613.1b, layer 2
// control-change). The Control-Magic shape pointed at a land instead of a
// creature; no upkeep tax, no P/T.
export const conquer: CardDefinition = {
    id: "ae610e66-7bcb-40ec-bed5-86dcfd098654",
    name: "Conquer",
    rarity: "uncommon",
    oracleText: "Enchant land\nYou control enchanted land.",
    manaCost: { X: 3, R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [{ kind: "control-change", applies: AURA_AFFECTS_HOST }],
};
// Curse of Marit Lage — ETB taps every Island (CR 603.6b enters trigger, CR
// 701.20a tap) and a static untap-lock on Islands (CR 611). The mirror of
// Wrath of Marit Lage (Blue tranche), swapping red creatures → Islands.
export const curseOfMaritLage: CardDefinition = {
    id: "69b381c1-aa71-4d40-a320-70f58a440d51",
    name: "Curse of Marit Lage",
    rarity: "rare",
    oracleText:
        "When this enchantment enters, tap all Islands.\nIslands don't untap during their controllers' untap steps.",
    manaCost: { X: 3, R: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "curse-marit-lage-island-lock",
            oracleText:
                "Islands don't untap during their controllers' untap steps (Curse of Marit Lage).",
            filter: { types: "Land", subtypes: "Island" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "curse-marit-lage-tap-islands",
            oracleText: "When this enchantment enters, tap all Islands.",
            scope: "self",
            // NOT DSL-migratable (ADR 0045): the mass tap of all Islands is
            // itself a forEach-permanents (subtype Island) skin, but the
            // `enteredTrigger` factory has no `effects[]` site (only
            // `phaseTrigger` does) — an ETB effect can't be authored
            // declaratively yet.
            // Blocked on: an `effects[]` site on enteredTrigger.
            resolve: (ctx) => {
                for (const pid of ctx.allPlayerIds) {
                    const islands = ctx.getBattlefieldIds(pid, {
                        types: "Land",
                        subtypes: "Island",
                    });
                    for (const id of islands) {
                        ctx.tap({ type: "permanent", id });
                    }
                }
            },
        }),
    ],
};
// Dwarven Armory — {2}{R}{R} Enchantment. "{2}, Sacrifice a land: Put a +2/+2
// counter on target creature. Activate only during any upkeep step." A land
// sacrifice cost (`sacrificeFilter: { types: "Land" }`, the Orcish Lumberjack
// shape) gated to the upkeep step via `activationPhaseRestriction: ["UPKEEP"]`
// (NO `controllerTurnOnly` — "any upkeep step", CR 602.5b). The +2/+2 counter is
// a layer-7d P/T counter (CR 122.1).
export const dwarvenArmory: CardDefinition = {
    id: "7d14a430-6e08-40cf-970a-cae84bba6ef7",
    name: "Dwarven Armory",
    rarity: "rare",
    oracleText:
        "{2}, Sacrifice a land: Put a +2/+2 counter on target creature. Activate only during any upkeep step.",
    manaCost: { X: 2, R: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "dwarven-armory-counter",
            oracleText:
                "{2}, Sacrifice a land: Put a +2/+2 counter on target creature. Activate only during any upkeep step.",
            cost: { mana: { X: 2 }, sacrificeFilter: { types: "Land" } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            targetRequirement: { type: "Creature", count: 1 },
            // CR 122 (issue #841) — put one +2/+2 counter on the target.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+2/+2",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        },
    ],
};
// Errantry — Aura. "Enchant creature\nEnchanted creature gets +3/+0 and can
// only attack alone." (CR 303.4 Aura on a creature; CR 613 layer 7c +3/+0
// `pt-buff` applied to the host; CR 508.1c "can only attack alone" as a
// `declared-attack-restriction` — collected from the Aura and applied to its
// host, legal only when no OTHER creature is also declared as an attacker. The
// engine evaluates it over the complete declared-attacker set at confirm.)
export const errantry: CardDefinition = {
    id: "8346e741-61f8-4283-be51-f5f80e9595a5",
    name: "Errantry",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature gets +3/+0 and can only attack alone.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 3,
            toughness: 0,
        },
        {
            kind: "declared-attack-restriction",
            id: "errantry-attack-alone",
            // `self` = the enchanted creature; legal only when it is the sole
            // declared attacker (no other creature attacks this combat).
            predicate: (
                self: PermanentView,
                declaredAttackers: readonly PermanentView[]
            ) => declaredAttackers.filter((a) => a.id !== self.id).length === 0,
            oracleText: "Enchanted creature can only attack alone.",
        },
    ],
};
// Flame Spirit — 2/3 with firebreathing "{R}: +1/+0 until end of turn" (CR 605
// activated ability, CR 611.1 temporary pump).
export const flameSpirit: CardDefinition = {
    id: "add2b82a-9aa5-4d5c-a1c2-e313541f12c8",
    name: "Flame Spirit",
    rarity: "uncommon",
    oracleText: "{R}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "flame-spirit-firebreathing",
            oracleText: "{R}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
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
// Flare — {2}{R} Instant. "Flare deals 1 damage to any target" (CR 120.1
// damage) plus the next-upkeep cantrip rider (CR 502.2 / 603.7d).
export const flare: CardDefinition = {
    id: "d5350236-7bd2-462d-9768-50087626c764",
    name: "Flare",
    rarity: "common",
    oracleText:
        "Flare deals 1 damage to any target.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, issue #1264): 1 damage to the
    // announced target (CR 120.1), then the next-upkeep draw cantrip via the
    // ADR 0048 `delayedTrigger` Op with an inline `draw` body — replacing the
    // legacy `DelayedTriggerDef` seam so the scheduled draw is
    // replacement-aware (CR 614, ADR 0061).
    effects: [
        { op: "dealDamage", amount: 1, to: { target: 0 } },
        {
            op: "delayedTrigger",
            timing: "next-upkeep",
            oracleText:
                "Draw a card at the beginning of the next turn's upkeep.",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};
// Game of Chaos — {R}{R}{R} Sorcery. A coin-flip doubling loop (CR 705.2 reveal
// + CR 119/118 life swing). Each round the caster flips: on a WIN the caster
// gains `stake` life and the opponent loses `stake`, then the CASTER decides
// whether to flip again; on a LOSS the caster loses `stake` and the opponent
// gains `stake`, then the OPPONENT decides whether to flip again. `stake` starts
// at 1 and DOUBLES each round (CR 107 — "double the life stakes with each flip").
// Built entirely from shipped primitives: `requestCoinFlip` (suspending reveal)
// + `requestOptionChoice` (the alternating "flip again?" decision). Each round's
// flip and decision are keyed by stable round-indexed choiceIds, so the stepped
// resolution (CR 608.2) replays prior rounds' answers and suspends only on the
// first unresolved prompt. A hard cap bounds the loop (an unbounded coin-flip
// resolution can't terminate deterministically across replays); 64 rounds is far
// beyond any realistic game (stake 2^63).
const GAME_OF_CHAOS_MAX_ROUNDS = 64;
export const gameOfChaos: CardDefinition = {
    id: "08265332-2c0e-4c42-8c51-83ac20462eed",
    name: "Game of Chaos",
    rarity: "rare",
    oracleText:
        "Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you lose the flip, you lose 1 life and that opponent gains 1 life, and that player decides whether to flip again. Double the life stakes with each flip.",
    manaCost: { R: 3 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    // NOT DSL-migratable (ADR 0045, assessed #851): although the coinFlip Op
    // shipped, Game of Chaos is a repeat-until-stop DOUBLING loop — each round
    // the stake DOUBLES (`stake *= 2`, arithmetic the frozen value grammar
    // literal|ref|count cannot carry) and the flip repeats an unbounded number
    // of rounds with the decider alternating between the two players. Neither an
    // unbounded loop nor an arithmetic value construct exists (reopening ADR 0045
    // for a fifth structural construct is out of scope). The classifier reports
    // it FREE because every PRIMITIVE it calls (requestCoinFlip / gainLife /
    // loseLife / requestOptionChoice) is covered, but the loop + doubling make
    // it un-transcribable — a classifier over-count (PRD #826 FREE is an upper
    // bound). Stays resolve(). Blocked on: an unbounded-loop construct + an
    // arithmetic (doubling) value construct.
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const opponent = target.id;
        const me = ctx.controller;
        let stake = 1;
        for (let round = 0; round < GAME_OF_CHAOS_MAX_ROUNDS; round++) {
            const won = ctx.requestCoinFlip({
                playerId: me,
                choiceId: `game-of-chaos-flip-${round}`,
                heads: {
                    consequence: `You gain ${stake} life; opponent loses ${stake} life.`,
                },
                tails: {
                    consequence: `You lose ${stake} life; opponent gains ${stake} life.`,
                },
            });
            if (won === undefined) return; // suspended for the reveal
            // Apply the life swing for this round.
            if (won) {
                ctx.gainLife(me, stake);
                ctx.loseLife(opponent, stake);
            } else {
                ctx.loseLife(me, stake);
                ctx.gainLife(opponent, stake);
            }
            // The winner of the flip decides whether to flip again (CR 705):
            // the caster on a win, the opponent on a loss.
            const decider = won ? me : opponent;
            const again = ctx.requestOptionChoice({
                playerId: decider,
                choiceId: `game-of-chaos-again-${round}`,
                prompt: "Flip again? (Game of Chaos — the life stakes double.)",
                options: [
                    { id: "yes", label: "Flip again" },
                    { id: "no", label: "Stop" },
                ],
            });
            if (again === undefined) return; // suspended for the decision
            if (again !== "yes") return;
            stake *= 2; // CR 107 — double the stakes each flip.
        }
    },
};
// Glacial Crevasses — "Sacrifice a snow Mountain: Prevent all combat damage
// that would be dealt this turn." The cost is a snow-typed sacrifice
// (CR 118.5 / 205.4a) via `sacrificeFilter` with `subtypes: "Mountain"` +
// `supertypes: ["Snow"]` (resolved live). The effect is `preventAllCombatDamage`
// (CR 615). Mana ability? No — it has no mana and uses the stack (CR 605.1a).
export const glacialCrevasses: CardDefinition = {
    id: "2726b192-f239-470b-8ad6-69887405e7f9",
    name: "Glacial Crevasses",
    rarity: "rare",
    oracleText:
        "Sacrifice a snow Mountain: Prevent all combat damage that would be dealt this turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "glacial-crevasses-fog",
            oracleText:
                "Sacrifice a snow Mountain: Prevent all combat damage that would be dealt this turn.",
            cost: {
                sacrificeFilter: {
                    types: "Land",
                    subtypes: "Mountain",
                    supertypes: ["Snow"],
                },
            },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): the trivial
            // "all-combat" Fog shape, identical to Fog / Darkness / Holy Day
            // (#845). No hand-written per-card outcome test exists in
            // red.test.ts, but colorless.test.ts's "Glacial Crevasses ...
            // prevents all combat damage on resolution" test already exercises
            // this exact resolve path (kept green, unchanged) — plus the
            // per-Op regime (catalogue static sweep + canned-scenario smoke)
            // covers it independently.
            effects: [{ op: "preventDamage", mode: "all-combat" }],
        },
    ],
};
// Goblin Mutant — {2}{R}{R} 5/3 Goblin Mutant with trample. Two combat
// restrictions, both `staticEffects`: an `attack-restriction` (CR 508.1c) whose
// predicate scans the defending player's battlefield for an untapped creature of
// power 3+, and a `block-restriction` on side "blocker" (CR 509.1b) rejecting
// attackers of power 3+. Power is read from the live `PermanentView.power`
// (effective P/T, mirroring leg.ts's power-gated combat predicates).
export const goblinMutant: CardDefinition = {
    id: "6db54f95-6652-45a3-b960-c2fc118beca1",
    name: "Goblin Mutant",
    rarity: "uncommon",
    oracleText:
        "Trample\nThis creature can't attack if defending player controls an untapped creature with power 3 or greater.\nThis creature can't block creatures with power 3 or greater.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Goblin", "Mutant"],
    power: 5,
    toughness: 3,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "goblin-mutant-no-attack-vs-big",
            // Legal to attack UNLESS the defender controls an untapped
            // creature with power >= 3 (CR 508.1c).
            predicate: (_self, defenderBattlefield) =>
                !defenderBattlefield.some(
                    (p) =>
                        p.types.includes("Creature") &&
                        !p.isTapped &&
                        (p.power ?? 0) >= 3
                ),
            oracleText:
                "This creature can't attack if defending player controls an untapped creature with power 3 or greater.",
        },
        {
            kind: "block-restriction",
            id: "goblin-mutant-no-block-big",
            side: "blocker",
            // self = Goblin Mutant (blocker), opponent = attacker. Legal block
            // only when the attacker's power is < 3 (CR 509.1b).
            predicate: (_self, attacker) => (attacker.power ?? 0) < 3,
            oracleText:
                "This creature can't block creatures with power 3 or greater.",
        },
    ],
};
// Goblin Sappers — {1}{R} 1/1 Goblin. Two activated abilities (CR 605); both
// make a creature you control unblockable this turn (`setCantBeBlockedThisTurn`)
// and schedule an end-of-combat destroy via `scheduleDelayedTrigger`
// ("next-end-of-combat", CR 603.7a). The {R}{R} leg also destroys Goblin Sappers
// itself; the {R}{R}{R}{R} leg destroys only the chosen creature. The delayed
// trigger reads the target / self ids from its serialized payload.
const GOBLIN_SAPPERS_ID = "de839540-a7b9-4f91-91df-3fd4f5c0bc4e";
export const goblinSappers: CardDefinition = {
    id: GOBLIN_SAPPERS_ID,
    name: "Goblin Sappers",
    rarity: "common",
    oracleText:
        "{R}{R}, {T}: Target creature you control can't be blocked this turn. Destroy it and this creature at end of combat.\n{R}{R}{R}{R}, {T}: Target creature you control can't be blocked this turn. Destroy it at end of combat.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-sappers-rr",
            oracleText:
                "{R}{R}, {T}: Target creature you control can't be blocked this turn. Destroy it and this creature at end of combat.",
            cost: { mana: { R: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            // NOT DSL-migratable (ADR 0045, PRD #795 assessment): setCantBeBlockedThisTurn
            // + a next-end-of-combat delayed trigger are both Op-covered
            // (`restrictCombat`, `delayedTrigger`), but the `delayedTrigger`
            // Op always persists the fixed sentinel `INLINE_DELAYED_TRIGGER_ID`
            // ("$inline-effects") as the scheduled instance's `triggerId`
            // (`convex/gre/effects/interpreter.ts`), never a card-chosen id.
            // This ability's OWN pre-existing per-card test
            // (`ice/__tests__/red.test.ts` "Goblin Sappers") asserts
            // `state.delayedTriggers` contains `triggerId ===
            // "goblin-sappers-destroy-both"` — migrating would change that id
            // and either fail the untouched harness or force editing it
            // (forbidden). Blocked on: this test's literal id assertion, not
            // an Op gap. Stays resolve().
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.setCantBeBlockedThisTurn(target);
                ctx.scheduleDelayedTrigger(
                    GOBLIN_SAPPERS_ID,
                    "goblin-sappers-destroy-both",
                    "next-end-of-combat",
                    { creatureId: target.id, sappersId: ctx.sourceInstanceId }
                );
            },
        },
        {
            id: "goblin-sappers-rrrr",
            oracleText:
                "{R}{R}{R}{R}, {T}: Target creature you control can't be blocked this turn. Destroy it at end of combat.",
            cost: { mana: { R: 4 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            // NOT DSL-migratable (ADR 0045, PRD #795 assessment): same class
            // as the {R}{R} leg above — the `delayedTrigger` Op's fixed
            // `INLINE_DELAYED_TRIGGER_ID` sentinel triggerId would break this
            // leg's OWN untouched test asserting `triggerId ===
            // "goblin-sappers-destroy-target"`. Stays resolve().
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.setCantBeBlockedThisTurn(target);
                ctx.scheduleDelayedTrigger(
                    GOBLIN_SAPPERS_ID,
                    "goblin-sappers-destroy-target",
                    "next-end-of-combat",
                    { creatureId: target.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "goblin-sappers-destroy-both",
            oracleText:
                "Destroy that creature and Goblin Sappers at end of combat.",
            timing: "next-end-of-combat",
            // NOT DSL-migratable (ADR 0045, PRD #795): legacy
            // `delayedTriggers[]` template body — see the scheduling
            // ability's marker above (the `delayedTrigger` Op's fixed
            // sentinel triggerId would break this card's untouched test).
            resolve: (ctx, payload) => {
                if (payload.creatureId)
                    ctx.destroy({
                        type: "permanent",
                        id: payload.creatureId,
                    });
                if (payload.sappersId)
                    ctx.destroy({ type: "permanent", id: payload.sappersId });
            },
        },
        {
            id: "goblin-sappers-destroy-target",
            oracleText: "Destroy that creature at end of combat.",
            timing: "next-end-of-combat",
            // NOT DSL-migratable (ADR 0045, PRD #795): legacy
            // `delayedTriggers[]` template body — see the scheduling
            // ability's marker above (the `delayedTrigger` Op's fixed
            // sentinel triggerId would break this card's untouched test).
            resolve: (ctx, payload) => {
                if (payload.creatureId)
                    ctx.destroy({
                        type: "permanent",
                        id: payload.creatureId,
                    });
            },
        },
    ],
};
// Goblin Ski Patrol — "{1}{R}: +2/+0 and gains flying. Sacrifice it at the
// beginning of the next end step. Activate only once and only if you control a
// snow Mountain." (CR 205.4a snow gate.) The pump/flying ride until end of turn
// (the creature is sacrificed by then anyway); a `next-end-step` delayed trigger
// sacrifices it. "Activate only once" is `oncePerTurn` (functionally once, since
// it self-destructs the same turn). The snow-Mountain gate is read in
// `canActivate` via a snow-aware battlefield scan.
const GOBLIN_SKI_PATROL_ID = "fde1c8b5-1e01-4920-8d02-bf80d5b238c5";
export const goblinSkiPatrol: CardDefinition = {
    id: GOBLIN_SKI_PATROL_ID,
    name: "Goblin Ski Patrol",
    rarity: "common",
    oracleText:
        "{1}{R}: This creature gets +2/+0 and gains flying. Its controller sacrifices it at the beginning of the next end step. Activate only once and only if you control a snow Mountain.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-ski-patrol-charge",
            oracleText:
                "{1}{R}: This creature gets +2/+0 and gains flying. Its controller sacrifices it at the beginning of the next end step. Activate only once and only if you control a snow Mountain.",
            cost: { mana: { X: 1, R: 1 } },
            useStack: true,
            oncePerTurn: true,
            canActivate: (source, state) => {
                const me = source.controllerId;
                const controller = state.players.find((p) => p.id === me);
                if (!controller) return false;
                return controlsSnowSubtype(controller.battlefield, "Mountain");
            },
            // Migrated resolve()→effects[] (ADR 0045, PRD #795 re-assessment):
            // the STALE reason below (sacrifice-by-object-ref) is gone — the
            // `sacrifice` Op's `target` form (issue #1151, Sneak Attack /
            // Goblin Kites shape) now sacrifices a `delayedTrigger`-captured
            // single object directly. This ability's only per-card test
            // (`ice/__tests__/red.test.ts` "Goblin Ski Patrol") covers
            // `canActivate` gating only — it does not assert the resolve
            // body's `delayedTriggers[]` triggerId, so the delayedTrigger Op's
            // fixed sentinel id (unlike Barbarian Guides / Goblin Sappers
            // above) doesn't collide with anything.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    ability: "flying",
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Its controller sacrifices it at the beginning of the next end step.",
                    capture: { $self: { ref: "$source" } },
                    effects: [{ op: "sacrifice", target: { ref: "$self" } }],
                },
            ],
        },
    ],
};
// Goblin Snowman — "Whenever this creature blocks, prevent all combat damage to
// and dealt by it this turn" (CR 509.4 block trigger, fired off
// BLOCKERS_CONFIRMED matching self; CR 615 two-way prevention) plus "{T}: deals
// 1 damage to target creature it's blocking" (the "it's blocking" restriction is
// enforced at resolve via the live block graph, CR 509.1).
export const goblinSnowman: CardDefinition = {
    id: "5bbb260a-6763-4d1c-a009-4e34cd572519",
    name: "Goblin Snowman",
    rarity: "uncommon",
    oracleText:
        "Whenever this creature blocks, prevent all combat damage that would be dealt to and dealt by it this turn.\n{T}: This creature deals 1 damage to target creature it's blocking.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "goblin-snowman-block-prevent",
            oracleText:
                "Whenever this creature blocks, prevent all combat damage that would be dealt to and dealt by it this turn.",
            // BLOCKERS_CONFIRMED fires once per attacker-blocker pair; match
            // only the pair whose blocker is self so the prevention is set once.
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) =>
                event.type === "BLOCKERS_CONFIRMED" &&
                event.blockerId === self.id,
            // Migrated resolve()→effects[] (ADR 0045, #845): the block trigger
            // arms the two-way combat-damage prevention shield on the source
            // itself (`$source`, preventDamage "combat-to-and-by", CR 615).
            effects: [
                {
                    op: "preventDamage",
                    mode: "combat-to-and-by",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
    activatedAbilities: [
        {
            id: "goblin-snowman-ping",
            oracleText:
                "{T}: This creature deals 1 damage to target creature it's blocking.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // NOT DSL-migratable (ADR 0045, issue #845): the ping deals damage
            // only if this creature is CURRENTLY BLOCKING the targeted attacker
            // — a runtime read of the live block graph (`getBlockersByAttacker`)
            // gating the deal. `dealDamage` is covered, but there is no
            // "is blocking target" predicate for the DSL `if`. The classifier
            // over-counts this site (the block-graph read is ignored). Blocked
            // on: a combat-relationship predicate.
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                // "it's blocking" — only deal the damage if Goblin Snowman is
                // currently blocking the targeted attacker (CR 509.1).
                const blockers = ctx.getBlockersByAttacker()[target.id] ?? [];
                if (!blockers.includes(ctx.sourceInstanceId)) return;
                ctx.dealDamage(target, 1);
            },
        },
    ],
};
// Grizzled Wolverine — {1}{R}{R} 2/2 Wolverine. "{R}: +2/+0 until end of turn.
// Activate only during the declare blockers step, only if at least one creature
// is blocking this creature, and only once each turn." Three activation gates:
// `activationPhaseRestriction: ["DECLARE_BLOCKERS"]` (CR 602.5b step), `oncePerTurn`
// (CR 602.5f — engine tracks `activationsThisTurn`), and a `canActivate` predicate
// that reads the live block graph (`state.combat.blockerAssignments`, CR 509.2)
// to confirm some blocker is assigned to this creature.
export const grizzledWolverine: CardDefinition = {
    id: "95bb17b9-55c4-4cc1-83f6-75490b9a97d0",
    name: "Grizzled Wolverine",
    rarity: "common",
    oracleText:
        "{R}: This creature gets +2/+0 until end of turn. Activate only during the declare blockers step, only if at least one creature is blocking this creature, and only once each turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Wolverine"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "grizzled-wolverine-pump",
            oracleText:
                "{R}: This creature gets +2/+0 until end of turn. Activate only during the declare blockers step, only if at least one creature is blocking this creature, and only once each turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            activationPhaseRestriction: ["DECLARE_BLOCKERS"],
            oncePerTurn: true,
            canActivate: (source, state) => {
                const assignments = state.combat?.blockerAssignments;
                if (!assignments) return false;
                // CR 509.2 — some blocker is assigned to this creature.
                return Object.values(assignments).some((atks) =>
                    atks.includes(source.id)
                );
            },
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +2/+0 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Imposing Visage — Aura granting menace (CR 702.111, layer 6 keyword-grant on
// the host).
export const imposingVisage: CardDefinition = {
    id: "cca42b74-9b42-482b-b12a-79cafdcd087e",
    name: "Imposing Visage",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature has menace. (It can't be blocked except by two or more creatures.)",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "menace",
        },
    ],
};
// Incinerate — 3 damage to any target; a creature dealt damage this way can't be
// regenerated this turn (CR 120.1 damage, CR 701.15c regen-lock). The damage is
// dealt first, then the target-scoped regen-lock is applied to a creature.
export const incinerate: CardDefinition = {
    id: "9c3f00af-010d-4485-b8b7-47400d99c496",
    name: "Incinerate",
    rarity: "common",
    oracleText:
        "Incinerate deals 3 damage to any target. A creature dealt damage this way can't be regenerated this turn.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    effects: [
        { op: "dealDamage", amount: 3, to: { target: 0 } },
        { op: "preventRegeneration", target: { target: 0 } },
    ],
};
// Jokulhaups — "Destroy all artifacts, creatures, and lands. They can't be
// regenerated." (CR 701.7 destroy + CR 701.15c regen suppression.)
export const jokulhaups: CardDefinition = {
    id: "3bf0d325-5928-4593-8faa-64ffa414cb48",
    name: "Jokulhaups",
    rarity: "rare",
    oracleText:
        "Destroy all artifacts, creatures, and lands. They can't be regenerated.",
    manaCost: { X: 4, R: 2 },
    types: ["Sorcery"],
    // Migrated resolve()→effects[] (ADR 0045, PRD #795): forEach over
    // battlefield permanents matching the OR-within-field type filter
    // (Artifact/Creature/Land), destroy each with `cantBeRegenerated: true`
    // (CR 701.7 / 701.15c).
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: ["Artifact", "Creature", "Land"] },
            },
            effects: [
                {
                    op: "destroy",
                    target: { ref: "$each" },
                    cantBeRegenerated: true,
                },
            ],
        },
    ],
};
// Karplusan Giant — "Tap an untapped snow land you control: +1/+1 until end of
// turn." The cost is a `tapOtherFilter` over snow lands (CR 118.8 / 205.4a),
// resolved live so Melting / Arcum's Weathervane mutations gate the cost. The
// effect is a +1/+1 self-pump until end of turn.
export const karplusanGiant: CardDefinition = {
    id: "c524ac2a-294c-4b19-b00b-999e370a3b95",
    name: "Karplusan Giant",
    rarity: "uncommon",
    oracleText:
        "Tap an untapped snow land you control: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 6, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "karplusan-giant-pump",
            oracleText:
                "Tap an untapped snow land you control: This creature gets +1/+1 until end of turn.",
            cost: {
                tapOtherFilter: {
                    filter: {
                        types: "Land",
                        supertypes: ["Snow"],
                        controllerRelation: "you",
                    },
                    count: 1,
                },
            },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): a plain +1/+1
            // EOT self-pump — the pump Op covers it directly. The per-card
            // test lives in the snow cluster (ice/__tests__/colorless.test.ts
            // "Karplusan Giant"), kept green unchanged as the equivalence
            // harness.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Karplusan Yeti — "{T}: This creature deals damage equal to its power to target
// creature. That creature deals damage equal to its power to this creature." —
// the mutual-damage "fight" shape (CR 701.12-style), expressed with the `fight`
// primitive which snapshots both powers and deals simultaneously.
export const karplusanYeti: CardDefinition = {
    id: "7dd9b214-d9fe-4c2e-b45b-7145ad98c408",
    name: "Karplusan Yeti",
    rarity: "rare",
    oracleText:
        "{T}: This creature deals damage equal to its power to target creature. That creature deals damage equal to its power to this creature.",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Yeti"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "karplusan-yeti-fight",
            oracleText:
                "{T}: This creature deals damage equal to its power to target creature. That creature deals damage equal to its power to this creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.fight(target);
            },
        },
    ],
};
// Lava Burst — "Lava Burst deals X damage to any target." (CR 120.1, X folded
// from the cost.)
//
// DEFERRED (documented simplification, NOT a card-specific primitive — same gap
// as DRK Whippoorwill, tracked-by: #1212): the rider "If Lava Burst would deal damage to a
// creature, that damage can't be prevented or dealt instead to another permanent
// or player" is an anti-prevention / anti-redirection lock for which no engine
// primitive exists. It is a narrow rider (matters only against active Fog-style
// prevention or redirection) and does not change the spell's primary function.
// Flagged for the prevention-lock cluster.
export const lavaBurst: CardDefinition = {
    id: "79dc0e20-5790-4927-8432-cf0e9b7381d4",
    name: "Lava Burst",
    rarity: "common",
    oracleText:
        "Lava Burst deals X damage to any target. If Lava Burst would deal damage to a creature, that damage can't be prevented or dealt instead to another permanent or player.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #852): X damage to any target
    // (CR 120.1) via the chosen-cost `{ X: true }` amount. The anti-prevention /
    // anti-redirection rider was already DEFERRED in the closure (no engine
    // primitive) — the migration preserves that; the rider stays unmodelled.
    effects: [{ op: "dealDamage", amount: { X: true }, to: { target: 0 } }],
};
// Márton Stromgald — {2}{R}{R} 1/1 Legendary Human Knight. Two combat triggers
// (CR 603.6 — "whenever ~ attacks/blocks"), each pumping the OTHER attackers /
// blockers by +N/+N where N is the number of attacking / blocking creatures
// OTHER than Márton (CR 611.1 temporary buff). The trigger reads the live combat
// role of every battlefield creature: attackers via `getIsAttacking`, blockers
// via the block graph (`getBlockersByAttacker`). The stale "needs primitive"
// comment was wrong — `getIsAttacking` + `addTemporaryPTBuff` suffice (#656).
export const mRtonStromgald: CardDefinition = {
    id: "7880e815-53e7-43e0-befd-e368f00a75d8",
    name: "Márton Stromgald",
    rarity: "rare",
    oracleText:
        "Whenever Márton Stromgald attacks, other attacking creatures get +1/+1 until end of turn for each attacking creature other than Márton Stromgald.\nWhenever Márton Stromgald blocks, other blocking creatures get +1/+1 until end of turn for each blocking creature other than Márton Stromgald.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "marton-attack-pump",
            oracleText:
                "Whenever Márton Stromgald attacks, other attacking creatures get +1/+1 until end of turn for each attacking creature other than Márton Stromgald.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            // NOT DSL-migratable (ADR 0045, issue #840): buff amount scales by a runtime count (+N/+N where N = other attacking creatures) applied across that self-excluded attacking set. Blocked on: a count-valued pump amount + a forEach select expressing "attacking, excluding self", not pump.
            resolve: (ctx) => {
                // All attacking creatures other than Márton (CR 508.1).
                const others: string[] = [];
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                    })) {
                        if (id === ctx.sourceInstanceId) continue;
                        if (ctx.getIsAttacking(id)) others.push(id);
                    }
                }
                const n = others.length;
                if (n === 0) return;
                for (const id of others) {
                    ctx.addTemporaryPTBuff({ type: "permanent", id }, n, n, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
        {
            id: "marton-block-pump",
            oracleText:
                "Whenever Márton Stromgald blocks, other blocking creatures get +1/+1 until end of turn for each blocking creature other than Márton Stromgald.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) =>
                event.type === "BLOCKERS_CONFIRMED" &&
                event.blockerId === self.id,
            // NOT DSL-migratable (ADR 0045, issue #840): buff amount scales by a runtime count (+N/+N where N = other blocking creatures) applied across that self-excluded blocking set. Blocked on: a count-valued pump amount + a forEach select expressing "blocking, excluding self", not pump.
            resolve: (ctx) => {
                // All blocking creatures other than Márton, deduped across the
                // block graph (a blocker may block multiple attackers, CR 509.2).
                const blockers = new Set<string>();
                for (const ids of Object.values(ctx.getBlockersByAttacker())) {
                    for (const id of ids) {
                        if (id !== ctx.sourceInstanceId) blockers.add(id);
                    }
                }
                const n = blockers.size;
                if (n === 0) return;
                for (const id of blockers) {
                    ctx.addTemporaryPTBuff({ type: "permanent", id }, n, n, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};
// Melee — {4}{R} Instant. "Cast this spell only during combat on your turn
// before blockers are declared. You choose which creatures block this combat
// and how those creatures block. Whenever a creature attacks and isn't blocked
// this combat, untap it and remove it from combat." (#669)
//
// The cast window is the controller's DECLARE_ATTACKERS step (CR 117.1b — "your
// turn, before blockers are declared"; attackers are already declared by the
// time priority opens in that step, so `getBattlefieldIds(..., isAttacking)` is
// populated). On resolution `ctx.enableAttackerChoosesBlocks()` sets the
// combat-scoped `meleeCombat` flag: the DECLARE_BLOCKERS step routes the block
// declaration to the ATTACKING player, with every assignment still gated by
// `validateBlockerEligibility` (only LEGAL blocks can be forced). The
// untap-unblocked rider is applied by `applyMeleeUnblockedRider` at blocker
// confirmation (CR 509.1) — every attacker left unblocked is untapped and
// removed from combat.
export const melee: CardDefinition = {
    id: "b13a064d-bff4-4a48-a158-1b61951b0ac3",
    name: "Melee",
    rarity: "uncommon",
    oracleText:
        "Cast this spell only during combat on your turn before blockers are declared.\nYou choose which creatures block this combat and how those creatures block.\nWhenever a creature attacks and isn't blocked this combat, untap it and remove it from combat.",
    manaCost: { X: 4, R: 1 },
    types: ["Instant"],
    // CR 117.1b — castable only during the controller's declare-attackers step
    // (the "during combat on your turn before blockers are declared" window).
    castPhaseRestriction: ["DECLARE_ATTACKERS"],
    castTurnRestriction: "self",
    resolve: (ctx: SpellContext) => {
        ctx.enableAttackerChoosesBlocks();
    },
};
// Melting — "All lands are no longer snow." A board-wide continuous
// supertype-set static (CR 205.4a, layer-4-adjacent) that REMOVES the Snow
// supertype from every Land while Melting is in play; `hasSupertype` reads the
// removal so snow-matters effects (Drift of the Dead, Cold Snap, snow landwalk,
// snow targets) see no snow lands. Restored when Melting leaves play.
export const melting: CardDefinition = {
    id: "8d90065e-2c7e-44e5-9f59-015d468214bf",
    name: "Melting",
    rarity: "uncommon",
    oracleText: "All lands are no longer snow.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "supertype-set",
            applies: (target) => target.types.includes("Land"),
            remove: ["Snow"],
        },
    ],
};
// Meteor Shower is implemented below (divide-as-you-choose cluster, #664).
// Mountain Goat — 1/1 with mountainwalk (CR 702.13 landwalk; unblockable while
// the defender controls a Mountain).
export const mountainGoat: CardDefinition = {
    id: "ccf70276-a40c-4d25-b584-4c8a07a00602",
    name: "Mountain Goat",
    rarity: "common",
    oracleText:
        "Mountainwalk (This creature can't be blocked as long as defending player controls a Mountain.)",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goat"],
    power: 1,
    toughness: 1,
    staticAbilities: ["mountainwalk"],
};
// Mudslide — {2}{R} Enchantment. Symmetric untap-lock on non-flying creatures
// (CR 611 — `untapRestriction` with `excludeAbility: "flying"`, maxUntap 0) plus
// a per-upkeep pay-{2}-to-untap escape for each player (the Thelon's Curse / FEM
// shape: `phaseTrigger("UPKEEP", scope "each")` + a per-candidate `requestMayPay`
// of {2}, untapping each one whose cost is paid, CR 117.3a).
export const mudslide: CardDefinition = {
    id: "65acce56-8674-471e-9d5e-91b7e3f672c1",
    name: "Mudslide",
    rarity: "rare",
    oracleText:
        "Creatures without flying don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player may choose any number of tapped creatures without flying they control and pay {2} for each creature chosen this way. If the player does, untap those creatures.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "mudslide-nonflying-lock",
            oracleText:
                "Creatures without flying don't untap during their controllers' untap steps (Mudslide).",
            filter: { types: "Creature", excludeAbility: "flying" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "mudslide-untap-escape",
            oracleText:
                "At the beginning of each player's upkeep, that player may choose any number of tapped creatures without flying they control and pay {2} for each creature chosen this way. If the player does, untap those creatures.",
            phase: "UPKEEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045): an `each`-scoped phaseTrigger
            // (scoped player ≠ controller, so `effects` is disallowed) that
            // selects tapped non-flying creatures (no tap-state/ability filter
            // on the forEach selector) and runs a per-creature mayPay→untap loop
            // over a runtime candidate set. Same shape as Thelon's Curse.
            // Blocked on: non-"your" trigger effects + tap/ability filters +
            // a per-member mayPay iteration.
            resolve: (ctx, _event, scopedPlayerId) => {
                const player = scopedPlayerId;
                const candidates = ctx
                    .getBattlefieldIds(player, {
                        types: "Creature",
                        excludeAbility: "flying",
                    })
                    .filter((id) => ctx.getIsTapped({ type: "permanent", id }));
                if (candidates.length === 0) return;
                // CR 117.3a — one may-pay of {2} per candidate; untap each one
                // whose cost the player chooses to pay.
                for (const id of candidates) {
                    const paid = ctx.requestMayPay({
                        playerId: player,
                        choiceId: `mudslide-untap-${id}`,
                        cost: { X: 2 },
                        prompt: "Pay {2} to untap this creature (Mudslide)?",
                    });
                    if (paid === undefined) return; // suspended for the choice
                    if (paid) ctx.untap({ type: "permanent", id });
                }
            },
        }),
    ],
};
// Orcish Cannoneers — "{T}: This creature deals 2 damage to any target and 3
// damage to you." (CR 605 activated ability, CR 120.1 damage — both legs are
// real damage, the self-damage hits the controller as a player.)
export const orcishCannoneers: CardDefinition = {
    id: "a4309a2f-27f5-4652-b0b4-6a6119436f75",
    name: "Orcish Cannoneers",
    rarity: "uncommon",
    oracleText:
        "{T}: This creature deals 2 damage to any target and 3 damage to you.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Orc", "Warrior"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "orcish-cannoneers-fire",
            oracleText:
                "{T}: This creature deals 2 damage to any target and 3 damage to you.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045): 2 damage to the
            // announced target, 3 to the controller (CR 120.1). Untouched
            // per-card test is the equivalence harness.
            effects: [
                { op: "dealDamage", amount: 2, to: { target: 0 } },
                { op: "dealDamage", amount: 3, to: { player: "controller" } },
            ],
        },
    ],
};
// Orcish Conscripts — "This creature can't attack unless at least two other
// creatures attack.\nThis creature can't block unless at least two other
// creatures block." (CR 508.1c / 509.1b — count-aware combat restrictions read
// over the COMPLETE declared-attacker / declared-blocker set, evaluated at
// confirm via `declared-attack-restriction` / `declared-block-restriction`.)
export const orcishConscripts: CardDefinition = {
    id: "e71394f8-3038-4cad-adea-a704f004777f",
    name: "Orcish Conscripts",
    rarity: "common",
    oracleText:
        "This creature can't attack unless at least two other creatures attack.\nThis creature can't block unless at least two other creatures block.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "declared-attack-restriction",
            id: "orcish-conscripts-attack-gate",
            // Legal only when at least two OTHER creatures are also declared as
            // attackers this combat.
            predicate: (
                self: PermanentView,
                declaredAttackers: readonly PermanentView[]
            ) => declaredAttackers.filter((a) => a.id !== self.id).length >= 2,
            oracleText:
                "This creature can't attack unless at least two other creatures attack.",
        },
        {
            kind: "declared-block-restriction",
            id: "orcish-conscripts-block-gate",
            // Legal only when at least two OTHER creatures are also declared as
            // blockers this combat.
            predicate: (
                self: PermanentView,
                declaredBlockers: readonly PermanentView[]
            ) => declaredBlockers.filter((b) => b.id !== self.id).length >= 2,
            oracleText:
                "This creature can't block unless at least two other creatures block.",
        },
    ],
};
// Orcish Farmer — "{T}: Target land becomes a Swamp until its controller's next
// untap step." (CR 305.7 land-type change, CR 502.1 / 611.2 timed duration.)
// Making the land a Swamp overwrites its subtypes, so it sheds its old basic
// land types and taps for {B} via the intrinsic Swamp mana ability (CR 305.6 /
// 605.1a — the engine derives mana from `subtypes`). `setSubtypesUntil` with
// `{ phase: "untap", player: "controller" }` reverts it at the affected
// controller's next untap step. Modern Oracle: just `{T}` (no sacrifice).
export const orcishFarmer: CardDefinition = {
    id: "efa5beef-d609-4809-a813-621b0b4cff7f",
    name: "Orcish Farmer",
    rarity: "common",
    oracleText:
        "{T}: Target land becomes a Swamp until its controller's next untap step.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "orcish-farmer-swamp",
            oracleText:
                "{T}: Target land becomes a Swamp until its controller's next untap step.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): the
            // `setSubtype` Op is the direct declarative skin over
            // `setSubtypesUntil` — its own doc comment (convex/cards/types.ts)
            // names this exact card as the reference "target land becomes a
            // Swamp ... until its controller's next untap step" shape (CR
            // 305.7 / 502.1).
            effects: [
                {
                    op: "setSubtype",
                    target: { target: 0 },
                    subtypes: ["Swamp"],
                    duration: { phase: "untap", player: "controller" },
                },
            ],
        },
    ],
};
// Orcish Healer — three activated abilities (CR 605, CR 701.15c regen-lock /
// CR 701.15a regeneration shield): a regen-lock on any creature, and two
// regenerate-a-black-or-green-creature legs differing only in their mana cost
// (the black/green target restriction uses `colorFilterAny`).
export const orcishHealer: CardDefinition = {
    id: "7ff511f3-416e-4919-acd6-fd8183bf5c60",
    name: "Orcish Healer",
    rarity: "uncommon",
    oracleText:
        "{R}{R}, {T}: Target creature can't be regenerated this turn.\n{B}{B}{R}, {T}: Regenerate target black or green creature.\n{R}{G}{G}, {T}: Regenerate target black or green creature.",
    manaCost: { R: 2 },
    types: ["Creature"],
    subtypes: ["Orc", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "orcish-healer-regen-lock",
            oracleText:
                "{R}{R}, {T}: Target creature can't be regenerated this turn.",
            cost: { mana: { R: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "preventRegeneration", target: { target: 0 } }],
        },
        {
            id: "orcish-healer-regen-br",
            oracleText:
                "{B}{B}{R}, {T}: Regenerate target black or green creature.",
            cost: { mana: { B: 2, R: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["B", "G"],
            },
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.15a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
        },
        {
            id: "orcish-healer-regen-rg",
            oracleText:
                "{R}{G}{G}, {T}: Regenerate target black or green creature.",
            cost: { mana: { R: 1, G: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["B", "G"],
            },
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.15a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
        },
    ],
};
// Orcish Librarian — DEFERRED, re-verified against the current engine for
// issue #728 (2026-07). `peekLibraryTop(8)` + `orderTop`/`reorderLibraryTop`
// cover the "look at top eight / put the rest on top in any order" legs (and
// the `scryReorder` Op shipped in #885), but "exile four of them AT RANDOM" has
// no SpellContext primitive: the seeded PRNG (`gre/rng.ts`) is engine-internal
// and the only exposed draws are hand-shaped (`discardAtRandom`,
// `revealRandomHandCard`, `lookRandomHandCard`) or whole-zone
// (`shuffleLibrary`) — there is no random-select over an arbitrary set of card
// ids. Stop-and-issue, not invented. Blocked on a random-select primitive over
// a card set: tracked-by: #1702
// export const orcishLibrarian: CardDefinition = {
//     id: "8ed908d6-6d06-4ccb-9577-37ef2d01c1a5",
//     name: "Orcish Librarian",
//     rarity: "rare",
//     oracleText: "{R}, {T}: Look at the top eight cards of your library. Exile four of them at random, then put the rest on top of your library in any order.",
//     manaCost: { X: 1, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Orc"],
//     power: 1,
//     toughness: 1,
// };
// Orcish Lumberjack — "{T}, Sacrifice a Forest: Add three mana in any
// combination of {R} and/or {G}." A mana ability (CR 605.1a, `useStack: false`)
// whose Forest sacrifice cost uses `sacrificeFilter`; "any combination of R/G"
// (3 mana) is enumerated as the four discrete `manaChoices` RRR/RRG/RGG/GGG.
export const orcishLumberjack: CardDefinition = {
    id: "21ef13e3-658c-43a3-a290-4c5dde8e8b55",
    name: "Orcish Lumberjack",
    rarity: "common",
    oracleText:
        "{T}, Sacrifice a Forest: Add three mana in any combination of {R} and/or {G}.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "orcish-lumberjack-mana",
            oracleText:
                "{T}, Sacrifice a Forest: Add three mana in any combination of {R} and/or {G}.",
            cost: { tap: true, sacrificeFilter: { subtypes: "Forest" } },
            useStack: false,
            manaChoices: [{ R: 3 }, { R: 2, G: 1 }, { R: 1, G: 2 }, { G: 3 }],
            effect: (ctx) => {
                // Representative leg; the engine applies the player's chosen
                // entry from `manaChoices` at activation time.
                ctx.addMana({ R: 3 });
            },
        },
    ],
};
// Orcish Squatters — {4}{R} 2/3 Orc. "Whenever this creature attacks and isn't
// blocked, you may gain control of target land defending player controls for as
// long as you control this creature. If you do, this creature assigns no combat
// damage this turn." Fires off `ATTACKER_UNBLOCKED` (the Murk Dwellers shape).
//
// CR 603.3d — "target land defending player controls" is a REAL target chosen
// when the trigger is PUT ON THE STACK (issue #1193 machinery,
// `raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes it subject to hexproof / protection / ward and
// fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. In a 2-player / solo game the
// "defending player" is the attacker controller's sole opponent, so
// `controller: "opponent"` = "defending player controls"; `type: "Land"`;
// `count: 1` is a single mandatory target (auto-selected when exactly one is
// legal per CR 603.3d, removed from the stack per CR 603.3c when none is legal).
//
// The "you may" is a SEPARATE resolution-time decision (CR 117.3a), distinct
// from the targeting — kept as a cost-less `requestMayPay` (the Verduran
// Enchantress "may draw a card" shape). Accepting takes control with a
// `controller-controls-source` condition (CR 611.2b — the shipped "for as long
// as you control this" control change) and, "if you do", marks the unblocked
// Squatters to assign no combat damage this turn (`markAssignsNoCombatDamage`);
// declining keeps combat damage.
const ORCISH_SQUATTERS_ID = "f3ee7bd5-612b-4916-a914-1294805b8f64";
export const orcishSquatters: CardDefinition = {
    id: ORCISH_SQUATTERS_ID,
    name: "Orcish Squatters",
    rarity: "rare",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may gain control of target land defending player controls for as long as you control this creature. If you do, this creature assigns no combat damage this turn.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        {
            id: "orcish-squatters-steal-land",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may gain control of target land defending player controls for as long as you control this creature. If you do, this creature assigns no combat damage this turn.",
            event: "ATTACKER_UNBLOCKED",
            // CR 603.3d — the target land is chosen when the trigger is put on
            // the stack (see card note above), not at resolution.
            targetRequirement: {
                type: "Land",
                count: 1,
                controller: "opponent",
            },
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx) => {
                // CR 603.3d — the target land was announced when the trigger
                // went on the stack; read it off `ctx.targets[0]`. Gone / left
                // the battlefield → no-op (CR 608.2b).
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                // CR 117.3a — "you may gain control": a cost-less yes/no at
                // resolution, distinct from the targeting above. Declining
                // keeps combat damage; accepting gains control and, "if you
                // do", makes Squatters assign no combat damage this turn.
                const gain = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `orcish-squatters-may-${ctx.sourceInstanceId}`,
                    prompt: "Gain control of the target land? (Orcish Squatters — if you do, it assigns no combat damage this turn)",
                });
                if (gain === undefined) return; // suspended for the decision
                if (!gain) return; // declined — combat damage proceeds
                ctx.gainControl(
                    { type: "permanent", id: target.id },
                    ctx.controller,
                    {
                        kind: "controller-controls-source",
                        controllerId: ctx.controller,
                    }
                );
                // "If you do, this creature assigns no combat damage this turn."
                ctx.markAssignsNoCombatDamage({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};
// Panic — {R} Instant. "Cast this spell only during combat before blockers are
// declared" (CR 601.3e cast restriction, via `castPhaseRestriction` —
// BEGINNING_OF_COMBAT + DECLARE_ATTACKERS, Blaze of Glory pattern); "Target
// creature can't block this turn" (CR 509.1b, via `setCantBlockThisTurn`) plus
// the next-upkeep cantrip rider.
export const panic: CardDefinition = {
    id: "a9ab85ac-311c-4e36-943a-817e43a3c8a8",
    name: "Panic",
    rarity: "common",
    oracleText:
        "Cast this spell only during combat before blockers are declared.\nTarget creature can't block this turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { R: 1 },
    types: ["Instant"],
    castPhaseRestriction: ["BEGINNING_OF_COMBAT", "DECLARE_ATTACKERS"],
    targetRequirement: { type: "Creature", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, issue #1264): "can't block" via
    // the ADR 0053 `restrictCombat` Op, then the next-upkeep draw cantrip via
    // the ADR 0048 `delayedTrigger` Op with an inline `draw` body.
    effects: [
        {
            op: "restrictCombat",
            restriction: "cant-block",
            target: { target: 0 },
        },
        {
            op: "delayedTrigger",
            timing: "next-upkeep",
            oracleText:
                "Draw a card at the beginning of the next turn's upkeep.",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};
// Pyroblast — modal "choose one" (CR 700.2): counter a blue spell OR destroy a
// blue permanent. The colour-mirror of Hydroblast, gating each mode's target on
// blue via `colorFilter: "U"`.
export const pyroblast: CardDefinition = {
    id: "c342cac5-08ae-4428-9c2c-f6c5904e54d2",
    name: "Pyroblast",
    rarity: "common",
    oracleText:
        "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue.",
    manaCost: { R: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] per mode (ADR 0045, PRD #795): `SpellMode.effects`
    // dispatches through the same interpreter seam as `ActivatedAbility.effects`.
    modes: [
        {
            id: "counter",
            label: "Counter target blue spell",
            oracleText: "Counter target spell if it's blue.",
            targetRequirement: { type: "spell", count: 1, colorFilter: "U" },
            effects: [{ op: "counter", target: { target: 0 } }],
        },
        {
            id: "destroy",
            label: "Destroy target blue permanent",
            oracleText: "Destroy target permanent if it's blue.",
            targetRequirement: { type: "any", count: 1, colorFilter: "U" },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};
// Pyroclasm — "Pyroclasm deals 2 damage to each creature." (CR 120.3 — a
// symmetric sweep over every creature.)
export const pyroclasm: CardDefinition = {
    id: "88040748-ad76-4b9a-bd4e-87e5980e9816",
    name: "Pyroclasm",
    rarity: "uncommon",
    oracleText: "Pyroclasm deals 2 damage to each creature.",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    // Migrated resolve()→effects[] (ADR 0045): a symmetric creature sweep is a
    // forEach over battlefield creatures dealing 2 to each (CR 120.3). The
    // untouched per-card test is the equivalence harness.
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [{ op: "dealDamage", amount: 2, to: { ref: "$each" } }],
        },
    ],
};
// Sabretooth Tiger — 2/1 with first strike (CR 702.7).
export const sabretoothTiger: CardDefinition = {
    id: "6914c5a8-2114-41c5-a471-ca97524d622f",
    name: "Sabretooth Tiger",
    rarity: "common",
    oracleText: "First strike",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 2,
    toughness: 1,
    staticAbilities: ["first strike"],
};
// Shatter — ICE reprint of the LEA instant ("Destroy target artifact").
// CardPrint onto the LEA definition (ADR 0014).
export const shatterIce: CardPrint = {
    printId: "7eb18d53-20de-43d7-86f7-97a6d14d54b8",
    definitionId: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e",
    setCode: "ice",
    rarity: "common",
};
// Stone Rain — ICE reprint of the LEA sorcery ("Destroy target land").
// CardPrint onto the LEA definition (ADR 0014).
export const stoneRainIce: CardPrint = {
    printId: "5a002e6d-ea59-4694-b3e5-075d6020b0d9",
    definitionId: "57ff74cb-a2ed-4123-ac42-f72f9820049e",
    setCode: "ice",
    rarity: "common",
};
// Stone Spirit — 4/3 "can't be blocked by creatures with flying" (CR 509.1b
// block restriction; the predicate rejects candidate blockers whose
// `staticAbilities` include flying).
export const stoneSpirit: CardDefinition = {
    id: "789dfae7-fe23-4e2e-9f5f-304535d22a78",
    name: "Stone Spirit",
    rarity: "uncommon",
    oracleText: "This creature can't be blocked by creatures with flying.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 4,
    toughness: 3,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "stone-spirit-no-flying-blockers",
            side: "attacker",
            // self = Stone Spirit (attacker), opponent = candidate blocker.
            // The block-restriction PermanentView carries keywords on
            // `staticAbilities` (cast, mirroring leg.ts's Wall/flying check).
            predicate: (_self, opponent) =>
                !(
                    (opponent as { staticAbilities?: string[] })
                        .staticAbilities ?? []
                ).includes("flying"),
            oracleText:
                "This creature can't be blocked by creatures with flying.",
        },
    ],
};
// Stonehands — Aura: static +0/+2 (layer 7c) plus an activated "{R}: Enchanted
// creature gets +1/+0 until end of turn" pump (CR 605 / CR 611.1) that resolves
// the host via `getAttachedTo`.
export const stonehands: CardDefinition = {
    id: "d23fa1af-78e5-4d23-bbf6-cd62bc54b4e9",
    name: "Stonehands",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature gets +0/+2.\n{R}: Enchanted creature gets +1/+0 until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 0, toughness: 2 },
    ],
    activatedAbilities: [
        {
            id: "stonehands-pump",
            oracleText: "{R}: Enchanted creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            // NOT DSL-migratable (ADR 0045, issue #840): pumps the enchanted creature (getAttachedTo). Blocked on: an attached-object EffectObjectSelector, not pump.
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
// Tor Giant — {3}{R} 3/3 vanilla Giant (CR 302).
export const torGiant: CardDefinition = {
    id: "7ef8f279-1a10-4685-99d6-bc971a7f922b",
    name: "Tor Giant",
    rarity: "common",
    oracleText: "",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 3,
};
// Total War — {3}{R} Enchantment. "Whenever a player attacks with one or more
// creatures, destroy all untapped non-Wall creatures that player controls that
// didn't attack, except for creatures the player hasn't controlled continuously
// since the beginning of the turn." A GLOBAL attack trigger (CR 603.6 — fires on
// ANY player's ATTACKERS_DECLARED, not just self's controller). The stale stub
// flagged "continuous attack-trigger destroy" / "controlled continuously" as
// needing a primitive; both ship: the trigger fires once per declaration, and
// "controlled continuously since the beginning of the turn" is exactly
// `!isSummoningSick` (CR 302.6 — a creature is summoning-sick iff it has NOT been
// under that player's control since their most recent turn began). The resolve
// iterates the attacking player's creatures and destroys each that is untapped,
// non-Wall, not attacking, and not summoning-sick (composable `ctx.destroy`
// rather than `destroyAll`, which can't express the "didn't attack" exclusion).
export const totalWar: CardDefinition = {
    id: "6107388b-ec1e-401e-a407-a821c908ed8d",
    name: "Total War",
    rarity: "rare",
    oracleText:
        "Whenever a player attacks with one or more creatures, destroy all untapped non-Wall creatures that player controls that didn't attack, except for creatures the player hasn't controlled continuously since the beginning of the turn.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "total-war-mass-destroy",
            oracleText:
                "Whenever a player attacks with one or more creatures, destroy all untapped non-Wall creatures that player controls that didn't attack, except for creatures the player hasn't controlled continuously since the beginning of the turn.",
            event: "ATTACKERS_DECLARED",
            // Fires on any attack (CR 508.1) — the enchantment isn't a combatant.
            matches: (event) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.length > 0,
            // NOT DSL-migratable (ADR 0045, PRD #795 assessment): the sweep
            // needs FOUR simultaneous per-creature exclusions (untapped, not
            // attacking, non-Wall, not summoning-sick) — `EffectCardFilter`
            // (the `forEach { set: "permanents" }` selector's filter) has
            // type/subtype/supertype/color/manaValue/isToken/name/hasCounter
            // fields, none of which read tap state, live combat-attacker
            // status, or summoning sickness. Blocked on: a forEach filter (or
            // an `if`-predicate) reading `isTapped`/`isAttacking`/
            // `isSummoningSick`, not destroy/forEach themselves.
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKERS_DECLARED") return;
                const attackerPlayer = event.attackingPlayerId;
                for (const id of ctx.getBattlefieldIds(attackerPlayer, {
                    types: "Creature",
                })) {
                    const sel: TargetSelection = { type: "permanent", id };
                    if (ctx.getIsAttacking(id)) continue; // it attacked
                    if (ctx.getIsTapped(sel)) continue; // not untapped
                    if (ctx.hasSubtype(sel, "Wall")) continue; // Wall exclusion
                    // "except for creatures the player hasn't controlled
                    // continuously since the beginning of the turn" — i.e. skip
                    // summoning-sick creatures (CR 302.6).
                    if (ctx.isSummoningSick(sel)) continue;
                    ctx.destroy(sel);
                }
            },
        },
    ],
};
// Vertigo — "2 damage to target creature with flying. That creature loses
// flying until end of turn." (CR 120.1 damage + CR 611.1b layer-6 keyword
// removal.) The flying-target restriction uses `requireAbility: "flying"`; the
// loss is `removeStaticAbilities` scoped to flying, until end of turn.
export const vertigo: CardDefinition = {
    id: "3067e7af-7bbd-48c1-9f1d-df2a91a0ec54",
    name: "Vertigo",
    rarity: "uncommon",
    oracleText:
        "Vertigo deals 2 damage to target creature with flying. That creature loses flying until end of turn.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, requireAbility: "flying" },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        ctx.dealDamage(t, 2);
        ctx.removeStaticAbilities(t, (kw) => kw === "flying", {
            phase: "end-of-turn",
        });
    },
};
// Wall of Lava — 1/3 Wall with defender and firebreathing "{R}: +1/+1 until end
// of turn" (CR 702.3 defender, CR 605 / CR 611.1 pump).
export const wallOfLava: CardDefinition = {
    id: "b99d6d11-b3f7-4d73-967c-3049af82a9d8",
    name: "Wall of Lava",
    rarity: "uncommon",
    oracleText:
        "Defender (This creature can't attack.)\n{R}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 3,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-lava-pump",
            oracleText: "{R}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+1 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Word of Blasting — "Destroy target Wall. It can't be regenerated. Deals damage
// equal to that Wall's mana value to the Wall's controller." (CR 701.7 destroy +
// CR 701.15c regen-lock + CR 120.1 damage.) The Wall's mana value and controller
// are read BEFORE the destroy; the target uses a Wall subtype restriction.
export const wordOfBlasting: CardDefinition = {
    id: "46b383c8-d604-4131-a869-9e9d13e30b94",
    name: "Word of Blasting",
    rarity: "uncommon",
    oracleText:
        "Destroy target Wall. It can't be regenerated. Word of Blasting deals damage equal to that Wall's mana value to the Wall's controller.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, subtypeFilter: "Wall" },
    // Migrated resolve()→effects[] (ADR 0045, PRD #795): the `manaValue`
    // EffectValue reads the LIVE mana value off the battlefield permanent
    // (CR 608.2b — undefined once it leaves play), so the damage Op runs
    // BEFORE the destroy Op — the reverse of the oracle's sentence order, but
    // the same final state as the original closure's pre-destroy
    // snapshot-and-destroy sequence (CR 608.2h last-known information; no
    // observer can see the intermediate ordering within one resolution). A 0
    // mana value deals 0 damage — a no-op, equivalent to the original
    // closure's `if (mv > 0)` guard.
    effects: [
        {
            op: "dealDamage",
            amount: { manaValue: { of: { target: 0 } } },
            to: { player: { controllerOf: { target: 0 } } },
        },
        { op: "destroy", target: { target: 0 }, cantBeRegenerated: true },
    ],
};

// Meteor Shower — {X}{X}{R} Sorcery. "Meteor Shower deals X plus 1 damage
// divided as you choose among any number of targets." (CR 107.3 doubled-X cost
// via `xFactor: 2`; CR 601.2d / 120.4 divide as you choose.) The total is X+1
// (`divideAsChosen: { total: "X+1" }`); the `dealDamageDividedAsChosen` Op
// (DSL-first ADR 0045) resolves `total: "X+1"` as `getX()+1` and reads the
// announced per-target split off the stack item.
export const meteorShower: CardDefinition = {
    id: "50b4851e-677b-468e-9baa-e47a3b4b8339",
    name: "Meteor Shower",
    rarity: "common",
    oracleText:
        "Meteor Shower deals X plus 1 damage divided as you choose among any number of targets.",
    manaCost: { X: "X", xFactor: 2, R: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "any",
        count: { min: 1 },
        divideAsChosen: { total: "X+1" },
    },
    effects: [{ op: "dealDamageDividedAsChosen", total: "X+1" }],
};
