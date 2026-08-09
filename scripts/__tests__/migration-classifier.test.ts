import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Smoke test for the resolve()→effects[] migration classifier
// (`scripts/migration-classifier.mjs`, PRD #795 / #826, playbook #809). The
// classifier is the single source of truth for the bulk-migration worklist,
// so a regression in it must fail like any other script (prior art:
// scripts/__tests__/json-to-cards.test.ts, list-to-cards.test.ts).
//
// This asserts EXTERNAL behaviour — the census bucket totals, the FREE ⊎
// X-only ⊎ Op-blocked partition invariant, and the routing of a known card —
// never the parser internals (balanced-brace extraction, the fold table).
// The exact totals are a committed baseline snapshot: they drift DOWN as Ops
// ship and cards migrate (the whole point of the tool), so a migration PR that
// moves a card between buckets updates the number here — the check exists to
// catch an accidental regression (e.g. the parser silently returning 0), not
// to freeze the catalogue.

const SCRIPT = join(process.cwd(), "scripts", "migration-classifier.mjs");

function run(...args: string[]): string {
    return execFileSync("bun", [SCRIPT, ...args], { encoding: "utf-8" });
}

/** Pulls the integer following a summary label out of the classifier's
 *  default (summary) stdout. */
function num(summary: string, label: RegExp): number {
    const m = summary.match(label);
    expect(m, `label ${label} not found in classifier output`).not.toBeNull();
    return Number(m![1]);
}

describe("migration classifier — census buckets (PRD #826)", () => {
    const summary = run();

    it("parses the whole catalogue without crashing and reports a closure total", () => {
        const total = num(summary, /—\s+(\d+)\s+closures/);
        expect(total).toBeGreaterThan(0);
    });

    it("buckets partition the closure total (FREE ⊎ X-only ⊎ Op-blocked = total)", () => {
        const total = num(summary, /—\s+(\d+)\s+closures/);
        const free = num(summary, /FREE \(migratable now\):\s+(\d+)/);
        const xOnly = num(summary, /X-only blocked:\s+(\d+)/);
        const opBlocked = num(summary, /Op-blocked:\s+(\d+)/);
        // Every closure lands in exactly one bucket — the classifier's core
        // contract (a closure is FREE, X-only, or Op-blocked, never two).
        expect(free + xOnly + opBlocked).toBe(total);
    });

    it("AFK-ready (has-test) free cards never exceed the free total", () => {
        const free = num(summary, /FREE \(migratable now\):\s+(\d+)/);
        const ready = num(summary, /of which AFK-ready:\s+(\d+)/);
        const needTest = num(summary, /need test first:\s+(\d+)/);
        expect(ready).toBeLessThanOrEqual(free);
        expect(ready + needTest).toBe(free);
    });

    // Committed baseline snapshot (bun scripts/migration-classifier.mjs at
    // #826 authoring time). Update DOWNWARD as migration proceeds.
    // #838 (delayedTrigger Op + ADR 0048, on top of #839's moveZone): Rocket
    // Launcher + Urza's Bauble migrated (−3 closures: 2 scheduling + 1
    // template body), and the delayed-body union + grammar-gap
    // pseudo-blockers keep the remaining scheduling closures truthfully
    // Op-blocked ($eventFieldCapture: Venom, Battering Ram, Nafs Asp,
    // Seraph, Krovikan Vampire; $listCapture: Venomous Breath).
    // #840 (pump Op): addTemporaryPTBuff is now a COVERED Op — the pump
    // cluster's closures moved from Op-blocked to FREE, and the ~59
    // cleanly-expressible ones were migrated away (total closures 842→783;
    // Op-blocked 583→497). The remaining FREE pump closures are the
    // aura-pumps (getAttachedTo — blocked on an attached-object selector, a
    // classifier read the tool counts as harmless) and count/colour/combat-
    // role-scaled pumps not expressible by the current value grammar.
    // #840 fixup: the remaining cleanly-expressible pump-only closures the
    // first pass missed were migrated (Mishra's Factory, Krovikan Elementalist,
    // Minion of Tevesh Szat, Electric Eel) — 4 more FREE/AFK-ready closures
    // migrated away (total 783→779, FREE 270→266, AFK-ready 245→241).
    // #841 (counters Op): addCounter / removeCounter are now COVERED Ops — the
    // counter cluster's closures moved from Op-blocked to FREE, and the ~31
    // cleanly-expressible ones (fixed-count adds/removes on an announced slot or
    // `$source`, choice→discard→counter) were migrated away (total 779→748;
    // Op-blocked 497→431; FREE 266→299 as the residual counter closures surface
    // as FREE). The remaining FREE counter closures are NOT cleanly expressible
    // by the current DSL and stay resolve() with a recorded NOT-migratable
    // reason: factory-built triggers (died/entered/left/tapped/spellCast — no
    // `effects[]` site), Aura attached-object targets (`getAttachedTo`),
    // counter-count / deaths-this-turn / mana-value amounts and counter-count
    // predicates (value/predicate grammar gaps), and event-field capture
    // targets. Two closures moved Op-blocked→X-only (Clockwork Beast / Clockwork
    // Avian recharge: {X}-cost counter adds), so X-only 16→18.
    // #841 fixup: Psychic Frog's discard-pump was reverted from the migrated
    // choice→discard→counters chain back to resolve() — the chain fired
    // `counters add` unconditionally on an empty hand, granting a free counter
    // without paying the discard COST (CR 118.3), and the cost-gating is not
    // expressible by the current DSL (no discard-chosen activation cost; the
    // `if` predicate cannot test a choice binding's cardinality). That restores
    // one FREE/AFK-ready closure (total 748→749, FREE 299→300, AFK-ready
    // 273→274; Op-blocked/X-only unchanged).
    // #842 (tapUntap Op): tap / untap are now COVERED Ops — the tap/untap
    // cluster's closures moved from Op-blocked to FREE, and the 22
    // cleanly-expressible ones (tap/untap an announced slot or `$source`,
    // may-pay→untap-source upkeeps, a forEach mass-untap, an exile+untap chain,
    // and the tap/untap + next-upkeep-cantrip pair via an inline delayedTrigger)
    // were migrated away (total 749→728; Op-blocked 431→383 as the residual tap
    // closures surface as FREE; FREE 300→326). The remaining FREE tap/untap
    // closures stay resolve() with a recorded NOT-migratable reason: mass taps
    // gated on COLOUR (no colour on EffectCardFilter — Riptide, Wrath/Curse of
    // Marit Lage), X-count announced-target iteration (Word of Binding,
    // Candelabra of Tawnos, Winter Blast), `each`-scoped upkeep escapes (no
    // effects on non-"your" phaseTrigger — Thelon's Curse, Mudslide, Magnetic
    // Mountain, Monsoon), Aura attached-host targets (`getAttachedTo` —
    // Instill Energy, Paralyze, Dance of the Dead, Mind Whip, Cocoon,
    // Tourach's Gate), sacrifice/discard-as-cost may-pays with a conditional
    // self-tap (Yawgmoth Demon, Mishra's War Machine, Minion of Leshrac), a
    // tap-toggle needing an isTapped predicate (Twiddle), cross-controller
    // choices (Demonic Hordes, Soldevi Golem), and enteredTrigger ETB taps
    // (no effects[] site). The X-only bucket gains one (16→...→19) as a residual
    // {X}-cost closure surfaces.
    // #843 (grantAbility Op): grantStaticAbility is now a COVERED Op — the grant
    // cluster's closures moved from Op-blocked to FREE, and the 40
    // cleanly-expressible ones (grant a keyword to an announced slot / `$source`
    // / a forEach $each, self-pump+grant combos, a "your"-scoped phaseTrigger
    // self-grant, grant + next-upkeep-cantrip via an inline delayedTrigger, and
    // a BLOCKERS_CONFIRMED self-grant trigger) were migrated away (total
    // 728→688; Op-blocked 383→332 as the residual grant closures surface as
    // FREE; FREE 326→337; AFK-ready 299→309). The remaining FREE grant closures
    // stay resolve() with a recorded NOT-migratable reason: trigger-event field
    // capture / combat-pairing reads (Giant Shark, Spitting Slug, Tidal Flats),
    // opponent-zone choice with a subtype-exclusion filter (Erhnam Djinn),
    // X-count announced-target iteration (Part Water), forEach combat-role
    // filter (Stampede — no isAttacking predicate), delayed self/target
    // SACRIFICE (Goblin Ski Patrol, Krovikan Elementalist — the sacrifice Op
    // reads a picks-LIST, not the object a delayed capture binds), the
    // self-power +X/+0 value + attacked-this-turn predicate (Berserk), and an
    // implementation-coupled per-card test (Stone Giant — its test asserts the
    // delayed trigger's internal id/payload, which the inline delayedTrigger Op
    // changes). Ability removal (removeStaticAbilities, a predicate closure)
    // stays residual — not JSON-expressible.
    // #844 (libraryLook Op): shuffleLibrary is now a COVERED Op — but ONLY the
    // shuffle primitive was folded (the one pure declarative library skin;
    // peek/reorder deferred to the planned scryReorder Op, since every caller
    // reads a choice result back into reorderLibraryTop or drives a mill loop).
    // The shuffle-freed closures moved Op-blocked→FREE (FREE 337→341; Op-blocked
    // 332→328; AFK-ready 309→313; total/X-only unchanged), but ZERO migrated:
    // all three shuffle-freed sites are SEARCH+SHUFFLE tutors (Demonic Tutor,
    // Jester's Cap, Altar of Bone) whose search half moves a CHOICE-PICKED
    // LIBRARY card — the `moveZone` Op only sources the battlefield/graveyard
    // (classifier over-count: moveCardById reads as covered, but not for a
    // library source), so they stay resolve() with a recorded NOT-migratable
    // reason. The Op earns its permanent per-Op test through the interpreter
    // suite (shuffle skin) rather than a migrated card this wave.
    // #845 (preventDamage Op): preventNextNDamageToTarget /
    // preventAllCombatDamage / preventAllCombatDamageToAndBy are now COVERED —
    // the prevention cluster's closures moved Op-blocked→FREE, and the 27
    // cleanly-expressible cards were migrated away (total 688→659; Op-blocked
    // 328→295 as the residual prevention closures surface as FREE; FREE 341→343
    // net; AFK-ready unchanged at 313 — the 29 migrated closures were all
    // AFK-ready). The migrations span all three modes: "all-combat" Fog (Fog /
    // Darkness / Holy Day / Sunstone / Spore Flower), "combat-to-and-by" two-way
    // shields (Maze of Ith / Ebony Horse / Elvish Scout / Foxfire / Goblin
    // Snowman), and "next-n" prevent-N shields (Samite Healer / Amulet of Kroog
    // / Conservator / Kei Takahashi / Rock Hydra / Balduvian Hydra / Rasputin /
    // Indestructible Aura / Glyph of Destruction / … — including $source and
    // relative-player recipients, and inline delayedTrigger riders on Rakalite /
    // Foxfire / Heal / Glyph). The remaining FREE prevention closures stay
    // resolve() with a recorded NOT-migratable reason: colour-conditional
    // prevention amount (Elvish Healer — no colour predicate), Aura attached-host
    // targets (Fylgja — `getAttachedTo`), a modal "choose one" wrapper (Healing
    // Salve — needs the optionChoice Op), a block-graph conditional deal (Goblin
    // Snowman's ping), and a no-per-card-test Fog (Glacial Crevasses — no
    // green-before harness). X-only rose 19→21 as two residual {X}-cost closures
    // surface once their prevention half stops blocking.
    // #846 (regenerate Op): applyRegenerationShield is now a COVERED Op — the
    // regeneration cluster's 30 closures moved Op-blocked→FREE, and the 27
    // cleanly-expressible ones (self-$source regens Drudge Skeletons / Sedge
    // Troll / Clay Statue / Kjeldoran Dead / Zombie Master grantTemplate / …
    // and announced-target regens Death Ward / Niall Silvain / Ragnar / Horror
    // of Horrors / Orcish Healer×2 / …) were migrated away (total 659→632;
    // Op-blocked 295→265; FREE 343→346 net; AFK-ready 313→316 — all 27 migrated
    // were AFK-ready). The remaining 3 FREE regen closures stay resolve() with a
    // recorded NOT-migratable reason: Aura attached-host targets read via
    // getAttachedTo / getAttachedToId — no attached-host object selector
    // (Regeneration, Thrull Retainer, The Brute — same block as Fylgja #845).
    // #847 (createToken Op): the plain spec-driven `createToken` primitive is
    // now a COVERED Op — the token cluster's closures moved Op-blocked→FREE
    // (+14: Op-blocked 265→251), and the 10 cleanly-expressible ones were
    // migrated away (total 632→622; FREE 360→350 net; AFK-ready 330→320 — all
    // 10 migrated were AFK-ready): spec spells/abilities Icatian Town, The Hive,
    // Master of the Hunt, Boris Devilboon, the four spore/graveyard Saproling
    // makers (Thallid, Thallid Devourer, Elvish Farmer, Night Soil), the
    // Breeding Pit end-step phaseTrigger, and the Caribou Range grantTemplate.
    // The remaining 3 FREE createToken closures stay resolve() with a recorded
    // NOT-migratable reason: a runtime X token COUNT (Homarid Spawning Bed —
    // getAdditionalSacrificeMv, no X value grammar), a sacrifice-as-cost
    // cardinality gate (Goblin Warrens — choice-clamp would create tokens
    // without paying the full cost, same class as Psychic Frog #841), and the
    // diedTrigger-factory-wrapped scheduling (Rukh Egg — the factory owns its
    // resolve and exposes no effects[] site, blocking the inline delayedTrigger
    // conversion). The copy form (createTokenCopyOf, Dance of Many) is split
    // out as the new `createTokenCopy` backlog Op.
    // #848 (gainControl Op): SpellContext.gainControl is now a COVERED Op — the
    // control-change cluster's 13 closures moved Op-blocked→FREE (+13), and the
    // 5 cleanly-expressible ones were migrated away (total 622→617; FREE 350→358
    // net; AFK-ready 320→328; Op-blocked 251→238): the announced-target control
    // grabs Old Man of the Sea (arn/blue, source-tapped-and-power-ge), Aladdin
    // (arn/red) / Thrull Champion (fem/black) / Infernal Denizen's ACTIVATED
    // ability (ice/black) (all controller-controls-source), and the Force-Spike-
    // shaped mayPay-or-steal Scarwood Bandits (drk/green). The remaining 8 FREE
    // gainControl closures stay resolve() with a recorded NOT-migratable reason:
    // a runtime-computed recipient (Ghazbán Ogre — uniqueMostLife; arn/green),
    // a controller-controls-Island runtime guard (Seasinger; fem/blue), a
    // delayedTriggers[] body with no effects[] site (Rainbow Vale; fem/colorless),
    // a runtime marker-counter + linked leave/untap destroy rider (Merieke Ri
    // Berit; ice/multicolor), a board-wide permanent-count parity predicate
    // (Chaos Lord; ice/red), a choice-picked single-object target (Preacher;
    // drk/white), and Infernal Denizen's apNapOrder-blocked UPKEEP trigger
    // (ice/black). "Until end of turn" control (Ray of Command / Magus of the
    // Unseen) was never in the free list — no ControlChangeCondition EOT variant
    // (issue #730). The gainControl backlog stub is retired.
    // #849 (optionChoice Op): SpellContext.requestOptionChoice is now a COVERED
    // Op — the "choose one" modal cluster's 7 closures moved Op-blocked→FREE
    // (+7: Op-blocked 238→231), and the 3 cleanly-expressible ones were migrated
    // away (total 617→614; FREE 358→362 net; AFK-ready 328→331): Elder Druid
    // (ice/green) and Hyperion Blacksmith (leg/red) — tap-or-untap target modes;
    // Illusionary Presence (ice/blue) — five land-type → landwalk grant modes.
    // The remaining 4 FREE optionChoice closures stay resolve() with a recorded
    // NOT-migratable reason: `requestOptionChoice` used as a dynamic COUNT picker
    // + createdBy provenance (Tetravus counters-to-tokens; atq/colorless), a
    // dynamically-conditional option set on a `scope: "each"` per-player trigger
    // (Worms of the Earth; drk/black), a template `delayedTriggers[]` bounce
    // rider with no effects[] site (Barbarian Guides; ice/red, same class as
    // Rainbow Vale), and a no-test ranged-topdeck + pay-life composition (Sylvan
    // Library; leg/green). The optionChoice backlog stub is retired.
    // #850 (addMana Op): SpellContext.addManaTo / addMana are now COVERED Ops —
    // the mana-add cluster's 15 closures moved Op-blocked→FREE (+15: Op-blocked
    // 231→216), and the 2 cleanly-expressible ones (fixed produced mana on a
    // real effects[] site) were migrated away (total 614→612; FREE 362→375 net;
    // AFK-ready 331→344): Dark Ritual (lea/black — spell, "Add {B}{B}{B}") and
    // Ashnod's Altar (atq/colorless — activated ability, "Add {C}{C}"). The
    // remaining 13 FREE mana-add closures (Su-Chi, Wild Growth, Mana Flare,
    // Gauntlet of Might — tappedTrigger/diedTrigger FACTORIES with no effects[]
    // site; Priest of Yawgmoth, Energy Tap, Sacrifice, Mana Drain ×2 — runtime
    // mana-value amounts / captures with no mana-value EffectValue; Farrelite
    // Priest, Initiates of the Ebon Hand — activation-count predicate; Songs of
    // the Damned, Spoils of Evil — count-scaled produced mana the fixed-amount
    // addMana grammar cannot carry) stay resolve() with recorded NOT-migratable
    // reasons. SCOPE (issue #850): fixed produced mana only — "any colour",
    // count-scaled amounts, and the addRestrictedMana rider are not folded. The
    // addMana backlog stub is retired.
    // #851 (coinFlip Op): SpellContext.requestCoinFlip is now a COVERED Op — the
    // coin-flip cluster's 6 closures moved Op-blocked→FREE (+6: Op-blocked
    // 216→210), and the 3 cleanly-expressible ones (a real effects[] site with a
    // fixed win/loss branch) were migrated away (total 612→609; FREE 375→378
    // net; AFK-ready 344→347): Bottle of Suleiman (arn/colorless — create-Djinn
    // / take-5), Orcish Captain (fem/red — +2/+0 or -0/-2 pump), Goblin Lyre
    // (ice/colorless — creature-count damage). The remaining 3 FREE coin-flip
    // closures stay resolve() with a recorded NOT-migratable reason: Goblin
    // Kites (fem/red, ×2 — the activated ability + delayed body: "sacrifice that
    // creature" is a SINGLE captured object the picks-consuming `sacrifice` Op
    // cannot express; split out as the new `sacrificeObject` backlog Op) and
    // Game of Chaos (ice/red — an unbounded repeat-until-stop DOUBLING loop:
    // arithmetic stake + a loop construct the frozen grammar has neither of; a
    // classifier over-count). SCOPE (issue #851): the suspending reveal flip
    // only — the synchronous flipCoin and the loop cards stay resolve(). The
    // coinFlip backlog stub is retired; the sacrificeObject stub is added.
    // #852 (X value-grammar member): the chosen-cost `{ X: true }` EffectValue
    // member shipped (a fifth value-grammar member, NOT an Op — ADR 0045 stays
    // closed). It does not appear in "Covered Ops" (it is a value member, not an
    // Op) and the classifier still buckets a getX()-using closure as X-only
    // (usesX is independent of the value grammar). 7 of the 21 X-only closures
    // were cleanly migratable and moved to effects[] (total 609→602; X-only
    // 21→14): Drain Life (lea/black), Howl from Beyond (lea/black), Braingeyser
    // (lea/blue), Stream of Life (lea/green), Guardian Angel (lea/white), Lava
    // Burst (ice/red), Traumatic Critique (sos/multicolor). The remaining 14
    // X-only closures stay resolve() with a recorded NOT-migratable reason —
    // each has a hidden blocker BEYOND X the classifier over-counts: cap/half/
    // divided arithmetic (Clockwork Avian, Clockwork Beast, Banshee, Dwarven
    // Catapult), a choice count derived from X + min-clamp (Mind Warp), a
    // noted-mana-spent + clamp life gain (Soul Burn), a forEach ability filter
    // (Earthquake without-flying, Hurricane with-flying), a multi-step protocol
    // (Recall), an aura attached-host selector (Venarian Gold), a modal card
    // (Alabaster Potion), and a choice-count + distinct-types tally (Occult
    // Epiphany). This is the LAST wave-1 issue — X was the final value-grammar
    // gap; the residual X-only closures are Op/grammar-blocked, not X-blocked.
    // #674 (Cube FREE card-draw slice): Sheoldred, the Apocalypse
    // (dmu/black.ts) adds ONE new resolve() closure — its "whenever an
    // opponent draws a card" trigger uses `drawTrigger({ scope: "opponents",
    // resolve: ... })` because `drawTrigger`'s `effects` opt-in (mirroring
    // `phaseTrigger`) only binds `ctx.controller`, valid for `scope: "your"`;
    // an opponents-scoped effect needs to act on the DRAWING player, who
    // differs from the source's controller (documented on the card). The
    // classifier's static heuristic buckets it FREE/need-test (it can't see
    // the scope-mismatch reason) — 602→603 total, 378→379 FREE, need-test
    // 31→32; AFK-ready/X-only/Op-blocked unchanged.
    // #888 (PR review fixup): Sheoldred's "opponents"-scope drawTrigger
    // resolve() closure now has a dedicated GRE test
    // (dmu/__tests__/black.test.ts, CR 121.1) covering both draw-scope
    // clauses and no-cross-fire. The classifier's hasTest heuristic now sees
    // it, flipping it from need-test → AFK-ready — 380 FREE unchanged,
    // need-test 32→31, AFK-ready 348→349 (relative to the post-rebase
    // combined baseline below, which already folds in #886/#734/#674).
    // Vintage Cube mana ramp/rocks/dorks/fixing tranche (issue #675) adds 3
    // resolve() closures: City of Traitors' sacrifice trigger
    // (`ctx.sacrifice(ctx.sourceInstanceId)` — FREE/AFK-ready, since
    // `sacrifice` is a covered Op even though this specific self-sacrifice
    // shape doesn't route through the Op's picks-list wrapper) and the two
    // manlands' animate abilities, Creeping Tar Pit + Celestial Colonnade
    // (both Op-blocked on `animateAsCreature`, not yet Op-wrapped — same as
    // every other manland already in the catalog, e.g. Mishra's Factory).
    // #676 (Cube FREE targeted-removal slice): adds 14 new resolve()
    // closures across Portable Hole (afr/white.ts — ETB + LTB, Banishing
    // Light O-Ring idiom), Wasteland (tmp/colorless.ts — mana `effect:`),
    // and four modal `modes: SpellMode[]` cards whose bullets target
    // different permanent types (Abrade hou/red.ts, Suplex fin/red.ts,
    // Witherbloom Charm + Silverquill Charm sos/multicolor.ts — Healing
    // Salve precedent, lea/white.ts). Every one of these five cards got a
    // dedicated GRE test (hou/afr/fin/sos __tests__), so the classifier's
    // hasTest heuristic counts all of their closures AFK-ready. Landed
    // together with a separate parallel loop's ICE combat/trigger/control
    // batch (#730/#732/#733/#736) — the pinned totals below are the real
    // `bun scripts/migration-classifier.mjs` output computed AFTER the
    // rebase that combines every one of these waves, not hand-picked.
    it("reports the committed baseline bucket totals", () => {
        // Combined post-#886 + #734 + #674 + #888 + #675 truth. #886 landed
        // ICE utility cards; #734 added Sacred Boon (a card-level resolve()
        // seam + its next-end-step delayed-trigger resolve, both Op-blocked —
        // the +0/+1-per-1-damage-prevented follow-up reads back a prevented
        // amount that no Op surfaces); #674 added Sheoldred, the Apocalypse's
        // opponents-scoped drawTrigger resolve() closure (see the #674 note
        // above); #888's fixup gave it a dedicated GRE test, flipping it
        // need-test → AFK-ready (see the #888 note above); #675 added City of
        // Traitors + the two manlands (see the #675 note above); #676 added
        // Portable Hole, Wasteland and four modal charms (see the #676 note
        // above), each with a dedicated GRE test so every closure lands
        // AFK-ready.
        // #732 added the ICE combat-damage redirect / assign-no-damage cluster:
        // Kjeldoran Royal Guard (activated resolve installing the CR 614.6
        // all-unblocked redirect combat seam), Cloak of Confusion (triggered
        // resolve) and Gaze of Pain (spell resolve arming the rider + its
        // graveyard-zone triggered resolve) — 4 new Op-blocked closures (the
        // combat-rider seams have no Op vocabulary; the triggers also read the
        // ATTACKER_UNBLOCKED event's attacker, gap #865).
        // #730 added Ray of Command + Magus of the Unseen: two resolve()
        // closures (gain-control-until-EOT rider) that both carry per-card
        // tests, so each lands FREE + AFK-ready (+2 closures, +2 FREE,
        // +2 AFK-ready).
        // #738 added Arcum's Whistle: two resolve() closures (the activated
        // pay-{X}-gated forced-attack rider + its next-end-step delayed
        // destroy). The activated closure is Op-blocked (no Op wraps
        // setMustAttackThisTurn / the may-pay-gated branch); the delayed-trigger
        // closure is FREE and carries the per-card test → AFK-ready
        // (+2 closures, +1 FREE, +1 AFK-ready, +1 Op-blocked).
        // #733 added the ICE attack-sacrifice-tax cluster (Flooded Woodlands,
        // Reclamation), #736 added the ICE filtered-counter cluster (Mistfolk,
        // Brown Ouphe, Arenson's Aura), and #739 added General Jarkeld: one
        // resolve() closure (the {T} attacker-side blocker-reassignment
        // ability). Combat manipulation is a SpellContext primitive, not an
        // Op — Op-blocked (Jarkeld: +1 closure, +1 Op-blocked;
        // FREE/AFK-ready/X-only unchanged).
        // Pins below are the classifier's actual reported values with every
        // wave (#886 + #734 + #674 + #888 + #675 + #732 + #730 + #738 + #733
        // + #736 + #676 + #739) landed together post-rebase — computed via
        // `bun scripts/migration-classifier.mjs` against the merged tree, not
        // hand-picked.
        // #865 (`$event.<field>` refs, ADR 0049) migrated Battering Ram, Venom
        // and Nafs Asp off resolve() — 6 closures removed (each card's
        // scheduling trigger + its delayed body: Battering Ram/Venom fold their
        // "destroy at end of combat" into an inline delayedTrigger, Nafs Asp its
        // "pay {1} or lose 1 life" draw-step body — all reading the firing event
        // via the new value grammar). Battering Ram's/Venom's/Nafs Asp's
        // scheduling closures were Op-blocked ($eventFieldCapture); their delayed
        // bodies were FREE/AFK-ready. Net: total 633→627, FREE 399→394,
        // AFK-ready 366→361, Op-blocked 220→219, X-only unchanged. The new
        // `$id-equality` pseudo-blocker adds 0 (Venom's split removed the only
        // catalogue closure that would have tripped it).
        // #866 (list-valued delayedTrigger capture, ADR 0049) migrated Venomous
        // Breath off resolve() — 2 closures removed: its scheduling closure was
        // Op-blocked ($list-capture) and its delayed body was FREE/AFK-ready,
        // both folded into one inline `delayedTrigger` with a `combatPartners`
        // list capture + `forEach { set: "bound" }` body. Net: total 627→625,
        // FREE 394→393, AFK-ready 361→360, Op-blocked 219→218, X-only unchanged.
        // #727 (Illusionary Terrain, ADR 0050) ADDED one protocol resolve() — the
        // ETB "choose two basic land types" storing the pair via
        // `setChosenSubtypes` (on-entry-choice-storage class, not a migratable
        // Op). Net: total 625→626, Op-blocked 218→219, others unchanged.
        // #681 (Cube FREE +1/+1 counters) ADDED one protocol resolve() —
        // Luminarch Aspirant's beginning-of-combat "put a +1/+1 counter on
        // target creature you control": no trigger-level targetRequirement
        // exists yet, so the pick rides a resolution-time `choose-permanents`
        // choice (documented protocol note in `sets/znr/white.ts`, same shape
        // as Oubliette/Tourach's Chant). It has a per-card test
        // (`sets/znr/__tests__/white.test.ts`), so it counts as AFK-ready, not
        // "need test first". Net: total 626→627, FREE 393→394, AFK-ready
        // 360→361, X-only/Op-blocked unchanged.
        // #679 (Cube FREE — ETB/dies/attack triggered abilities), rebased on
        // top of #681 above, landed 7 `resolve()`-idiom protocol cards
        // (Robber of the Rich, Azure Beastbinder, Flickerwisp, Chrome Mox,
        // Aang's Iceberg, Headliner Scarlett, Haywire Mite — the last a pure
        // DSL card contributing 0 closures), each composing shipped
        // SpellContext primitives with no new Op. Each `resolve()` card
        // carries its own per-card GRE + wire test per the authoring rule, so
        // all new FREE closures land AFK-ready. Net (independent of, and
        // additive with, #681's delta above — no shared cards): total
        // 627→637, FREE 394→397, AFK-ready 361→364, Op-blocked 219→226,
        // X-only unchanged.
        // #685 (Cube FREE — mass removal / sweepers) ADDED one protocol
        // resolve() — Damnation ("destroy all creatures, can't be
        // regenerated") via the shared `SpellContext.destroyAll` primitive
        // (the SECOND consumer after Wrath of God — not a new primitive, so
        // no new-Op backlog entry), with a per-card test → AFK-ready;
        // Upheaval shipped pure DSL (0 closures). Net from #685: total
        // 637→638, FREE 397→398, AFK-ready 364→365.
        // #682 (Cube FREE — edict/discard/hand disruption), on top of #685,
        // ADDED one protocol resolve() card, Memory Jar (2 closures: the {T},
        // Sacrifice activated ability + its "next end step" delayed trigger)
        // — a whole-hand face-down exile with a per-player linked delayed
        // restore the frozen Effect Script grammar can't carry (no whole-
        // zone-move Op, no per-forEach-member delayedTrigger capture; see
        // `sets/ulg/colorless.ts`). Both closures land Op-blocked. Net from
        // #682: total 638→640, Op-blocked 226→228.
        // #683 (Cube FREE — counterspells), rebased on top of #682/#684/#685,
        // ADDED 3 protocol `resolve()` closures via Quandrix Charm's per-mode
        // legacy `modes` mechanism (CR 700.2c cross-mode-target gap, same
        // escape as Witherbloom Charm/Silverquill Charm): the
        // counter-unless-pay and destroy-enchantment modes each carry the
        // card's own per-card test (sos/__tests__/multicolor.test.ts),
        // landing FREE + AFK-ready; the set-pt mode reuses the
        // already-`resolve()`-only `setBasePT` primitive, landing Op-blocked.
        // Net from #683: total 640→643, FREE 398→400, AFK-ready 365→367,
        // Op-blocked 228→229, X-only unchanged.
        // #960 (LEA Oracle-text reimplementation — Farmstead, Power Leak,
        // Pestilence) net-ADDED one protocol resolve() closure: Pestilence's
        // modern end-step "sacrifice if no creatures" phase trigger carries an
        // intervening-if + `resolve` (CR 603.4d), while Farmstead/Power Leak
        // stayed closure-neutral. The added closure is FREE + AFK-ready (its
        // per-card test lives in sets/lea/__tests__/black.test.ts). Net from
        // #960: total 643→644, FREE 400→401, AFK-ready 367→368, Op-blocked and
        // X-only unchanged.
        // #961 (dropped-clause batch) MIGRATED one FREE closure — Twiddle's
        // toggle resolve() became a modal `optionChoice`/`tapUntap` Effect
        // Script (#961), so it leaves the closure census. Thrull Wizard was
        // already effects[] (only its punisher gained the {3} alternative, no
        // closure change). Net from #961: total 644→643, FREE 401→400, AFK-ready
        // 368→367, Op-blocked and X-only unchanged.
        // #961 review fixup: Tunnel's "can't be regenerated" rider was
        // implemented as a resolve() closure (mirroring Fissure/Detonate),
        // re-adding one FREE + AFK-ready closure (its per-card test lives in
        // sets/lea/__tests__/red.test.ts). Consecrate Land's "can't be
        // enchanted" clause is data (a permanent-guard staticEffect) — no
        // closure change. Net from the fixup: total 643→644, FREE 400→401,
        // AFK-ready 367→368, Op-blocked and X-only unchanged.
        // #885 (scryReorder / mill Ops SHIPPED) MIGRATED four resolve() /
        // resolveSteps closures to effects[] — Preordain + Ponder (the
        // `scryReorder` skin over orderTop) and Thought Scour + Millstone (the
        // `mill` library→graveyard loop) all leave the closure census. All four
        // were Op-blocked on the (then-planned) scryReorder Op, so the drop
        // lands in Op-blocked (229→223, minus the six closures those four cards'
        // multi-step bodies contributed — reconciled by re-running the
        // classifier, not hand-added); FREE rose 401→403 / AFK-ready 368→370 as
        // peekLibraryTop / orderTop became Covered Ops and unblocked their
        // dependents. Net from #885: total 644→640. Values below are the true
        // post-change totals, reconciled by re-running
        // `bun scripts/migration-classifier.mjs` against the merged tree rather
        // than hand-added.
        // #993 (Chain of Vapor — ons/blue.ts) net-ADDED one protocol
        // resolveSteps closure: its "return target nonland permanent, then that
        // permanent's controller may sacrifice a land to copy this spell and
        // retarget" chain has no DSL Op (the copy-resolving-spell primitive,
        // shared with Chain Lightning), so it lands Op-blocked.
        // #991 (Cursed Scroll) net-ADDED one more protocol resolve() closure —
        // a name-a-card + random-reveal-from-hand + runtime-name-compare
        // ability blocked on the `nameCard` planned Op, also landing in the
        // Op-blocked bucket. BOTH #993 and #991 add one Op-blocked closure:
        // over the base that is total 644→646, Op-blocked 229→231.
        // MERGE (rebase of #885 onto main): #885's four migrations (Preordain +
        // Ponder + Thought Scour + Millstone leaving the closure census) stack
        // ON TOP of #993 + #991: total 646→642 (−4), FREE 401→403 (+2),
        // AFK-ready 368→370 (+2), Op-blocked 231→225 (−6), X-only unchanged.
        // MERGE (#984 digToHand onto the advanced main carrying #986 + #994):
        // — main side: #994 (Dominate) net-ADDED one protocol resolve() closure
        //   blocked on a control-change Op, and the #986 union carried one more
        //   resolve() closure than the branch base — total 642→643 (+1),
        //   Op-blocked 225→226 (+1); FREE / AFK-ready / X-only unchanged.
        // — this PR: #984 (digToHand Op SHIPPED) added NO closure (Impulse ships
        //   as effects[], not a resolve()). But its binding folds the
        //   `reorderLibraryTop` primitive — now a Covered Op — the last blocker
        //   of three still-resolve() closures (Drafna's Restoration + two
        //   others) whose only uncovered primitive was `reorderLibraryTop`.
        //   Those three flip Op-blocked → FREE / AFK-ready: FREE 403→406 (+3),
        //   AFK-ready 370→373 (+3), Op-blocked 226→223 (−3).
        // Merged tree: total 643, FREE 406, AFK-ready 373, X-only 14,
        // Op-blocked 223. Values below are the true post-merge totals,
        // reconciled by re-running `bun scripts/migration-classifier.mjs`
        // against the combined tree, never hand-added.
        // #988 (Sulfuric Vortex) net-ADDED exactly ONE counted closure — an
        // `each`-scoped upkeep phaseTrigger resolve() (dealDamage, a Covered
        // Op, but `each` scope disallows `effects[]`). Its lifegain-lock
        // replacementEffect closure is NOT counted (the classifier counts only
        // resolve()/resolveSteps). It is FREE (no blocked Op) and AFK-ready
        // (ships with a per-card test).
        // IMPORTANT — this PR also reconciles a pre-existing green-main drift:
        // the committed snapshot above stale-asserts 643, but plain
        // `origin/main` already classifies at 644 / FREE 407 / AFK-ready 374.
        // That +1 total drift was introduced by Jackal Pup's resolve() (commit
        // 268b6c89), which was merged directly WITHOUT bumping this snapshot —
        // leaving main red on this test. So the base deltas here are the base
        // reconciliation PLUS Vortex's +1: total 644→645, FREE 407→408,
        // AFK-ready 374→375; X-only / Op-blocked unchanged.
        // #693 (Flashback CAP, THIS PR) then net-ADDS three more closures on
        // top of that 645 baseline: Echo of Eons (resolve() — whole-table
        // Timetwister reset, no shuffle/per-player Op) and Sevinne's
        // Reclamation (resolveSteps — copy-this-spell clause, no spell-copy Op)
        // land Op-blocked (223→225, +2); Snapcaster Mage's ETB resolve()
        // (requestChoice + grantFlashback, all covered) lands FREE (408→409,
        // +1) and AFK-ready (375→376, +1, it has a per-card test). Combined
        // tree: total 645→648, FREE 408→409, AFK-ready 375→376, X-only 14,
        // Op-blocked 223→225.
        // #690 (Free pitch CAP) then net-ADDS two more closures: Snuff Out
        // (resolve() — destroy + can't-regenerate flag, all covered) lands FREE
        // (409→410, +1) and AFK-ready (376→377, +1, it has a per-card test);
        // Pyrokinesis (resolve() — dealDamageDividedAsChosen, division has no
        // Op) lands Op-blocked (225→226, +1). Combined tree: total 648→650,
        // FREE 409→410, AFK-ready 376→377, X-only 14, Op-blocked 225→226.
        // #692 (Kicker / Multikicker CAP) then ships kicker Op/interpreter
        // coverage that RECLASSIFIES one formerly Op-blocked closure as FREE
        // (and AFK-ready): total conserved at 650, FREE 410→411, AFK-ready
        // 377→378, Op-blocked 226→225, X-only 14 (Everflowing Chalice's mana
        // ability is a {T}-mana closure, excluded from the migration census, so
        // it does not add to the total). Partition still holds: 411+14+225=650.
        // #691 (Threshold/Delirium/Revolt CAP) adds Fatal Push as a resolve()
        // closure (FREE, +1; no per-card test yet, so AFK-ready stays 378).
        // Combined tree: total 650→651, FREE 411→412, AFK-ready 378,
        // X-only 14, Op-blocked 225.
        // Known-bottom library (this PR, ADR 0026 — scry/Impulse-bottomed cards
        // become known and orderable): two deltas.
        //  1. Stock Up migrated resolve() → the `digToHand` Op, removing one
        //     FREE + AFK-ready closure (total −1, FREE −1, AFK-ready −1).
        //  2. `digToHand`'s binding now folds `markKnown` (+ `readOrderedSecond`)
        //     — those primitives become COVERED live (the classifier reads every
        //     Op binding as its covered-primitive set). Five resolve() closures
        //     that were Op-blocked ONLY on `markKnown` reclassify Op-blocked →
        //     FREE, and all five carry a per-card test → AFK-ready too
        //     (Op-blocked −5, FREE +5, AFK-ready +5).
        // Net from #691: total 651→650, FREE 412→416, AFK-ready 378→382,
        // Op-blocked 225→220, X-only 14. Partition holds: 416+14+220=650.
        // #689 (Cycling CAP) adds Marauding Mako as a resolve() closure — its
        // "whenever you discard" discardTrigger body puts a +1/+1 counter (the
        // covered addCounter Op), so it classifies FREE, and it carries a
        // per-card test (dft/red.test.ts) so it is AFK-ready too. Total 650→651,
        // FREE 416→417, AFK-ready 382→383, Op-blocked 220, X-only 14 (the ten
        // Triome {T}-mana closures and the DSL Miscalculation/Unearth are all
        // excluded). Partition holds: 417+14+220=651.
        // #1054 (opponent-caused LTB/destroy trigger cause) adds Karmic Justice
        // (ody/white.ts) and Sacred Ground (sth/white.ts) as resolve()
        // leftTrigger closures: TriggeredAbility carries no targetRequirement
        // (ADR 0002), so each card's "target permanent/land an opponent
        // controls" pick is a resolution-time choose-permanents selection,
        // which doesn't compose with the DSL's choice/destroy/returnToBattlefield
        // Ops today (choice's bind is a picks-family binding; destroy's /
        // returnToBattlefield's target ref needs a snapshot-family binding) —
        // both stay resolve() with a recorded justification. Both bodies use
        // only COVERED Ops (destroy; returnToBattlefield), so both classify
        // FREE, and both carry a per-card test (ody/__tests__/white.test.ts,
        // sth/__tests__/white.test.ts) so both are AFK-ready too. Total
        // 651→653, FREE 417→419, AFK-ready 383→385, Op-blocked 220, X-only 14.
        // Partition holds: 419+14+220=653.
        // #1055 (mill / library→graveyard zone-change trigger) adds Gaea's
        // Blessing (wth/green.ts) as a resolve() CARD_MILLED graveyard trigger:
        // its body is a WHOLE-graveyard bulk move (moveZone graveyard→library +
        // shuffleLibrary) for which no DSL Op exists yet (tracked as #1056), so
        // it classifies Op-blocked. Total 653→654, Op-blocked 220→221, FREE 419
        // / AFK-ready 385 / X-only 14 unchanged. Partition holds: 419+14+221=654.
        // #1065 (INV can't-be-countered flag + 4 cards, CR 701.5) adds TWO
        // resolve() closures. Obliterate (inv/red.ts) is a spell resolve()
        // calling the shared `destroyAll` primitive with regen suppression —
        // the same NOT-DSL-migratable shape as the already-FREE Wrath of
        // God/Damnation (destroy has no regen-suppression option) — and ships
        // with its own per-card test (inv/__tests__/red.test.ts), so it lands
        // FREE + AFK-ready. Kavu Chameleon (inv/green.ts) is an activated-
        // ability resolve() closure generalizing `setColorOverride` with an
        // optional until-end-of-turn duration; no DSL Op wraps that duration
        // param yet, so it lands Op-blocked (adding to the `setColorOverride`
        // backlog entry). Net from #1065: total 654→656, FREE 419→420,
        // AFK-ready 385→386, Op-blocked 221→222, X-only 14 unchanged.
        // Partition held: 420+14+222=656.
        // Net from #1069 (INV free tranche — White): the new white cards added
        // closures (2 precedent resolve() + additional Op-blocked colour/
        // duration-gapped cards), while the duplicate Holy Day was removed:
        // total 656→659, FREE 420→422, AFK-ready 386→388, Op-blocked 222→223,
        // X-only 14 unchanged. Partition holds: 422+14+223=659.
        // Net from #1070 (INV free tranche — Blue): Traveler's Cloak's
        // land-type resolve() lands Op-blocked (no DSL Op wraps the choose-a-
        // land-type protocol yet): total 659→660, Op-blocked 223→224, FREE 422
        // / AFK-ready 388 / X-only 14 unchanged. Partition holds: 422+14+224=660.
        // Net from #1071 (INV free tranche — Black): the black cards added 7
        // resolve() closures, all FREE + AFK-ready (each ships a per-card GRE
        // test — the 5 destroy-no-regen / trigger-condition cards plus Phyrexian
        // Delver + Plague Spitter): total 660→667, FREE 422→429, AFK-ready
        // 388→395, Op-blocked 224 / X-only 14 unchanged. Partition: 429+14+224=667.
        // Net from #1074 (INV free tranche — Colorless): adds 2 resolve()
        // closures. Alloy Golem (inv/colorless.ts) is an ETB `enteredTrigger`
        // resolve() choosing a color then calling `setColorOverride` — the
        // declarative `setColor` Op is still `status: "planned"` in the
        // Mechanics Registry, so it lands Op-blocked (the `setColorOverride`
        // backlog entry grows 8→9). Sparring Golem (inv/colorless.ts) is a
        // "becomes blocked, +1/+1 per blocker" triggered-ability resolve()
        // mirroring the shipped `rampageTrigger` shape (no EffectValue member
        // counts "creatures blocking this"); its body uses only the COVERED
        // `addTemporaryPTBuff` Op and ships its own per-card test, so it lands
        // FREE + AFK-ready. Net: total 667→669, FREE 429→430, AFK-ready
        // 395→396, Op-blocked 224→225, X-only 14 unchanged.
        // Partition: 430+14+225=669.
        // Net from #1073 (INV free tranche — Green): adds 2 resolve() closures,
        // both precedent-justified twins of already-accepted patterns.
        // Fertile Ground (inv/green.ts) mirrors Wild Growth's `tappedTrigger`
        // factory (hardcoded resolve, no effects[] site; recipient is an
        // event-field player ref). Kavu Lair (inv/green.ts) is an
        // `enteredTrigger` whose payout goes to the ENTERING creature's
        // controller (cross-player), which the factory hands only to resolve()
        // — the effects[] path always binds ctx.controller to the SOURCE's
        // controller. Both bodies use only COVERED Ops and ship per-card tests,
        // so both land FREE + AFK-ready. Net: total 669→671, FREE 430→432,
        // AFK-ready 396→398, Op-blocked 225 / X-only 14 unchanged.
        // Partition: 432+14+225=671.
        // Net from #1072 (INV free tranche — Red): adds 4 resolve() closures,
        // each a precedent-justified twin of a shipped resolve() card whose
        // primitive has no Op wrapper (not stop-and-issue "Op absent"):
        // Breath of Darigaaz → Earthquake (`dealDamageToEach`+`excludeAbility`
        // filter gap), Crown of Flames pump → Thrull Retainer (`getAttachedToId`
        // + `addTemporaryPTBuff`, no attached-host selector Op), Slimy Kavu →
        // Orcish Farmer/Vision Charm (`setSubtypesUntil`, no Op), Stun → Panic
        // (`setCantBlockThisTurn`, no Op). Two land FREE (their primitives are
        // otherwise expressible) but lack a dedicated per-card test so
        // AFK-ready is unchanged; two land Op-blocked (the filter/selector gap).
        // Net: total 671→675, FREE 432→434, Op-blocked 225→227,
        // AFK-ready 398 / X-only 14 unchanged. Partition: 434+14+227=675.
        // Net from #1067 (INV pile division, ADR 0053): adds 0 resolve()
        // closures (all six pile cards are pure DSL), but registers three new
        // Ops — `divideIntoPiles`, `restrictCombat`, and the `cantBeRegenerated`
        // flag on `destroy` — which reclassify existing closures the classifier
        // now sees a covering Op for. Net: total 675 UNCHANGED, FREE 434→437,
        // AFK-ready 398→400, Op-blocked 227→224 (three closures move
        // Op-blocked→FREE, two of them AFK-ready), X-only 14 unchanged.
        // Partition: 437+14+224=675.
        // Net from #676 (Fading/Vanishing + Parallax cycle): adds 4 resolve()
        // closures, both Parallax cards (Wave/Tide) contributing an activated
        // exile resolve + a leaves-the-battlefield return resolve. Both key off
        // the exile-and-return bundle pair (`exileWithAttachments` /
        // `returnExiledForSource`, ADR 0028) — a resolve()-only SpellContext
        // primitive with no Op wrapper, the Banishing Light / Safe Haven
        // precedent — so all four land Op-blocked. (Blastoderm / Deep Forest
        // Hermit add no closures: fading/vanishing are seam-expanded keyword
        // strings and the Squirrel factory + anthem are pure DSL.) Net: total
        // 675→679, Op-blocked 224→228, FREE 437 / AFK-ready 400 / X-only 14
        // unchanged. Partition: 437+14+228=679.
        // Net from #1077 (INV free gold — BR): adds 1 resolve() closure —
        // Smoldering Tar's upkeep "target player loses 1 life" trigger, which
        // hits the real architecture limit (TriggeredAbility has no
        // targetRequirement; no EffectChoiceKind picks a player), the same
        // ADR-0002 `requestOptionChoice` precedent black.ts already records.
        // It ships its own per-card test, so it lands FREE + AFK-ready. Net:
        // total 679→680, FREE 437→438, AFK-ready 400→401, Op-blocked 228 /
        // X-only 14 unchanged. Partition: 438+14+228=680.
        // Net from the concurrent "nuove carte per enchantress" merge (88893eea,
        // an out-of-band main advance): adds 2 resolve() closures (FREE +
        // AFK-ready) whose merge did NOT bump this baseline — this reconciliation
        // absorbs that drift alongside #1079. Net from #1079 (INV free gold —
        // GW): adds 3 resolve() closures — Armadillo Cloak / Horned Cheetah
        // (lifegain-equal-to-damage, the `event.amount` DSL gap; Spirit Link /
        // El-Hajjâj precedent) and Aura Shards (cross-controller `allControllers`
        // choice gap; Loran precedent) — all three ship per-card tests, so all
        // land FREE + AFK-ready. Combined net: total 680→685, FREE 438→443,
        // AFK-ready 401→406, Op-blocked 228 / X-only 14 unchanged.
        // Partition: 443+14+228=685.
        // Net from a concurrent out-of-band main advance (stub-fury / cross-set
        // card merges) that added 1 Op-blocked resolve() closure without bumping
        // this baseline — this reconciliation absorbs that drift: total 685→686,
        // Op-blocked 228→229, FREE 443 / AFK-ready 406 / X-only 14 unchanged.
        // Partition: 443+14+229=686.
        // Net from #695 (Cube CAP: Escape): the escape cards add 2 new resolve()
        // closures (Phlage's `choose-damage-target` value ability + one more),
        // both FREE (no missing Op) and both carrying per-card tests, so both
        // also land AFK-ready. Reconciled against the rebased tree via
        // `bun scripts/migration-classifier.mjs`: total 686→688, FREE 445→447,
        // AFK-ready 408→410, X-only 14 / Op-blocked 227 unchanged.
        // Partition: 447+14+227=688.
        // #696 (Phyrexian mana + Dismember/Gitaxian Probe/Phyrexian Metamorph):
        // Dismember is pure DSL (`pump` Op) and adds no closure. Gitaxian Probe
        // adds one resolve() closure (protocol card: a PRIVATE hand-look via
        // `revealHand`/`markKnown` — the DSL `reveal` Op is an all-players
        // reveal only, no Op covers a single-knower look). Phyrexian Metamorph
        // adds one resolveSteps closure (`becomeCopyOf` copy-on-ETB, an
        // uncovered Op). Both are Op-blocked (no missing-Op-free path), so
        // total 688→690, Op-blocked 227→229, FREE/AFK-ready/X-only unchanged.
        // Partition: 447+14+229=690.
        // #694 (Cube CAP: Landfall) ADDED one resolve() closure — Bristly Bill,
        // Spine Sower's landfall trigger (`sets/otj/green.ts`). Its effect (add
        // a +1/+1 counter via requestChoice) uses only COVERED primitives, so
        // the classifier's static heuristic buckets it FREE (it cannot see the
        // real DSL-migration blocker: the engine has no announcement-time
        // targeted-trigger support, tracked #1193 — same class as the Loran /
        // Aura Shards resolve() closures already counted FREE). It carries a
        // per-card test (`sets/otj/__tests__/green.test.ts`) → AFK-ready. The
        // activated double-counters ability is pure DSL (0 closures); the four
        // other cluster cards are commented stubs (0 closures). Partition:
        // 448+14+229=691.
        //
        // Then Galvanic Discharge (`sets/mh3/red.ts`, Cube CAP Energy #697) adds
        // ONE resolveSteps closure ("pay any amount of {E}" variable resource
        // payment — a justified resolve, not DSL). Its effect uses only COVERED
        // primitives (addEnergy / payEnergy / dealDamage / requestOptionChoice),
        // so the classifier's static heuristic buckets it FREE, and it carries a
        // per-card test (`sets/mh3/__tests__/red.test.ts`) → AFK-ready. Guide of
        // Souls (#1194) and Satya (#1195) are commented stubs (0 closures). Net:
        // total 691→692, FREE 448→449, AFK-ready 411→412, X-only 14 / Op-blocked
        // 229 unchanged. Partition: 449+14+229=692.
        //
        // Then Anje's Ravager (`sets/c19/red.ts`, Cube CAP Madness #698) adds ONE
        // resolve() closure — the attack trigger "discard your hand, then draw
        // three" (a justified protocol resolve: no whole-hand-discard Op, the
        // Wheel of Fortune pattern). Its body uses only COVERED primitives
        // (discardCard / drawCards / getHandIds), so the classifier's static
        // heuristic buckets it FREE, and it carries a per-card test
        // (`sets/c19/__tests__/red.test.ts`) → AFK-ready. Basking Rootwalla
        // (`sets/tor/green.ts`) and Blazing Rootwalla (`sets/mh2/red.ts`) are
        // pure DSL (`effects[]` pump, 0 closures). Net: total 692→693, FREE
        // 449→450, AFK-ready 412→413, X-only 14 / Op-blocked 229 unchanged.
        // Partition: 450+14+229=693.
        //
        // Then Evoke ships (issue #900): Solitude (mh2/white.ts) adds ONE
        // real `resolve()` closure (its ETB — cross-controller battlefield
        // choice, the Loran precedent, `// protocol:` justified) using only
        // COVERED primitives (requestChoice / exile / gainLife / getPower /
        // getController) → buckets FREE. Grief (mh2/black.ts) is pure DSL
        // (`effects[]`, the Thoughtseize template) — 0 closures. The
        // classifier's `closures()` scan is a RAW-TEXT regex over
        // `resolve(|resolveSteps)\s*:` with no comment-awareness, so it was
        // ALSO counting the OLD Fury stub's commented-out WIP `resolve:`
        // body (mh2/red.ts, `ctx.dealDamageDividedAsChosen` — uncovered,
        // Op-blocked) before this change rewrote that stub's comment to drop
        // the `resolve:` text (Fury itself stays a stub — CR-accurate
        // multi-target divided damage at trigger-resolution time is a
        // separate, still-unbuilt gap). Net effect: one Op-blocked closure
        // (the old comment text) is replaced by one FREE closure (Solitude's
        // real code) — total closures unchanged (693), FREE 450→451,
        // AFK-ready unchanged (413 — Solitude has no per-card describe block
        // matching this heuristic; it lands in "need test first" instead,
        // covered instead by the dedicated `convex/gre/__tests__/evoke.test.ts`
        // end-to-end mechanism suite), Op-blocked 229→228. Partition:
        // 451+14+228=693.
        //
        // Then the `putBack` Op ships (issue #1046 — "put N hand cards on top
        // of your library in any order", unblocking Brainstorm's DSL
        // migration): its binding adds `moveHandCardToLibraryTop` to the
        // COVERED-primitive set (`requestChoice` was already covered via the
        // `choice`/`mayPay` Ops). Brainstorm (ice/blue.ts) migrates
        // resolveSteps→effects (`draw` 3 + `putBack` 2), so its ONE
        // resolveSteps closure disappears from the census entirely — it was
        // previously bucketed Op-blocked (moveHandCardToLibraryTop was
        // uncovered before this Op), not FREE, so removing it drops the
        // Op-blocked count, not the FREE count. No OTHER cataloguue closure
        // using `moveHandCardToLibraryTop` (fem/colorless.ts, ice/green.ts,
        // lea/colorless.ts, leg/green.ts) flips to FREE — each is blocked on
        // at least one other still-uncovered primitive too. Net: total
        // 693→692, FREE/AFK-ready/X-only unchanged (451/413/14), Op-blocked
        // 228→227. Partition: 451+14+227=692.
        //
        // Then Winter's Chill ships (issue #738 — the combat-only capped-X
        // three-way-may-pay card): it adds TWO new closures (its `resolveSteps`
        // body + its `delayedTriggers[]` end-of-combat destroy resolve), both
        // FREE and AFK-ready (the card carries a per-card describe block). Touch
        // of Vitae (same issue) is authored DSL-first (`effects[]`), so it adds
        // no closure. Net: total 692→694, FREE 451→453, AFK-ready 413→415,
        // X-only unchanged (14), Op-blocked unchanged (227). Partition:
        // 453+14+227=694.
        //
        // Then Fury ships (issue #1206 — the first targeted trigger with
        // divide-as-you-choose, on the #1193 foundation): it adds TWO new
        // closures — the `fury-etb` divided-damage resolve (no DSL Op expresses
        // per-target divided damage → Op-blocked) and its `evokeTrigger`
        // sacrifice-on-ETB resolve (the evoke half, also no DSL Op →
        // Op-blocked). Net: total 694→696, FREE/AFK-ready/X-only unchanged
        // (453/415/14), Op-blocked 227→229. Partition: 453+14+229=696.
        //
        // Then Subtlety ships (issue #1205 — the first targeted trigger over a
        // stack SPELL, on the #1193 foundation): its `subtlety-etb` resolve
        // (owner top/bottom option-pick + putSpellOnLibrary — no DSL Op) adds
        // ONE Op-blocked closure. Net: total 696→697, FREE/AFK-ready/X-only
        // unchanged (453/415/14), Op-blocked 229→230. Partition:
        // 453+14+230=697.
        //
        // Then Arc Lightning (usg) + Arc Mage (nem) ship (divide-as-you-choose
        // damage — the spell + the first ACTIVATED-ability divide): each adds
        // ONE `resolve()` closure calling `dealDamageDividedAsChosen`, which no
        // DSL Op expresses (same Op-blocked bucket as Fury's divided-damage
        // resolve). Net: total 697→699, FREE/AFK-ready/X-only unchanged
        // (453/415/14), Op-blocked 230→232. Partition: 453+14+232=699.
        //
        // Then Pirate Ship (lea) gains its silently-dropped "When you control no
        // Islands, sacrifice this creature" state trigger (CR 603.8) — a
        // `stateTrigger` resolve calling `ctx.sacrifice`, the same shape as
        // Seasinger. `sacrifice` is a COVERED Op, so the closure lands FREE and
        // (it ships with a per-card test) AFK-ready. Net: total 699→700, FREE
        // 453→454, AFK-ready 415→416, X-only/Op-blocked unchanged (14/232).
        // Partition: 454+14+232=700.
        //
        // Then Chromatic Armor (ice, #734) ships its "{X}: Put a sleight counter
        // on this Aura and choose a color" re-choose ability — a `resolve()`
        // closure that re-writes the host Aura's stored modal colour post-ETB
        // (`ctx.setChosenMode`, a NEW SpellContext primitive no Op expresses).
        // Op-blocked, so total 700→701, Op-blocked 232→233, FREE/AFK-ready/X-only
        // unchanged (454/416/14). Partition: 454+14+233=701.
        //
        // Then Enduring Renewal (ice, #735) ships its "whenever a creature is put
        // into your graveyard from the battlefield, return it to your hand"
        // owner-scoped death trigger — ONE `resolve()` closure (a `diedTrigger`
        // factory body calling `ctx.moveCardById(graveyard→hand)`, FREE) that
        // carries a per-card GRE test → AFK-ready. Zur's Weirding (the same slice)
        // is pure data (hand-reveal + draw-reveal statics), no closure. Net: total
        // 701→702, FREE 454→455, AFK-ready 416→417, X-only/Op-blocked unchanged
        // (14/233). Partition: 455+14+233=702.
        //
        // Then Scythecat Cub (j25, #1189) ships its Landfall escalation — a
        // `resolve()` triggered ability (targeting "creature you control" per the
        // #917 precedent, then a resolution-count-gated counter double) that
        // carries per-card GRE tests → FREE + AFK-ready. Omnath (the sibling in
        // the same slice) is pure DSL, no closure. Net: total 702→703, FREE
        // 455→456, AFK-ready 417→418, X-only/Op-blocked unchanged (14/233).
        // Partition: 456+14+233=703.
        //
        // Then issue #1156 (Dauthi Voidwalker) ships the `grantCastFromExile`
        // Op — a thin declarative skin over the pre-existing SpellContext
        // primitive `grantCastFromExile` (already used by five `resolve()`
        // closures: Headliner Scarlett, Robber of the Rich, two Ice Cauldron-
        // family cards, and Expressive Iteration). Registering the Op's
        // `binding` retroactively marks that primitive COVERED for every
        // closure calling it, not just Dauthi's own (DSL, so it adds no
        // closures itself). Of the five, only Expressive Iteration
        // (stx/multicolor.ts) had `grantCastFromExile` as its SOLE remaining
        // blocker — the other four still call at least one other unshipped
        // primitive (e.g. `exileFaceDown`) and stay Op-blocked. Total
        // unchanged (still 703 — no new closures), FREE 456→457, AFK-ready
        // 418→419 (Expressive Iteration carries a test), X-only unchanged
        // (14), Op-blocked 233→232. Partition: 457+14+232=703.
        //
        // Then issue #1274 (modal spells pick their mode at CAST) migrates
        // Vision Charm (vis/blue.ts) off its single card-level `resolve()`
        // (which picked the mode at resolution via requestOptionChoice) onto the
        // cast-time `modes` framework: ONE card-level closure becomes THREE
        // mode-level `resolve:` closures (+2 net). The classifier's raw
        // `/(resolve|resolveSteps)\s*:/` scan counts each mode closure. Their
        // buckets: "mill" (peekLibraryTop + moveCardById) is FREE + AFK-ready
        // (the card has a test); "land-type" (requestOptionChoice + a
        // subtype-set primitive) and "phase" (phaseOut) stay Op-blocked. Net:
        // total 703→705, FREE 457→458, AFK-ready 419→420, X-only unchanged
        // (14), Op-blocked 232→233. Partition: 458+14+233=705.
        //
        // Then issue #1264 (migrate ~38 resolve() effect-draws to the DSL
        // `draw` Op, on the #1263 draw-replacement seam) migrates 19 cards —
        // 20 closures — off resolve() (Night's Whisper, Mystic Remora, Howling
        // Mine, Verduran Enchantress, Winds of Change, Fasting, …). All 20 were
        // FREE draw closures (`draw` is a COVERED Op), so they leave FREE only;
        // X-only and Op-blocked are untouched. 19 carried a per-card test, so
        // AFK-ready drops by 19. Net: total 705→685, FREE 458→438, AFK-ready
        // 420→401, X-only unchanged (14), Op-blocked unchanged (233).
        // Partition: 438+14+233=685. (The 30 draws that stayed resolve() are
        // Op-blocked stubs — already in the Op-blocked count, not FREE — so the
        // FREE/Op-blocked split is unaffected by them.)
        //
        // Then issue #1199 (Monarch designation) adds Palace Jailer (cn2/
        // white.ts): its "you become the monarch" ETB is a DSL `becomeMonarch`
        // Op (no new closure — `becomeMonarch` is now a Covered Op, its
        // binding read live from EFFECT_OP_REGISTRY), but its "exile target
        // creature ... until an opponent becomes the monarch" ETB stays
        // resolve() (protocol card — no Op expresses the monarch-change return
        // condition, matching the sibling O-Ring-style cards' precedent) and
        // calls the NEW primitive `SpellContext.exileUntilMonarchChanges`,
        // which isn't yet in the classifier's covered-Ops list. +1 closure,
        // Op-blocked (not FREE). Net: total 685→686, FREE/AFK-ready/X-only
        // unchanged (438/401/14), Op-blocked 233→234. Partition: 438+14+234=686.
        //
        // Then issue #791 (Currency Converter — ncc/colorless.ts) adds THREE
        // resolve()/resolveSteps closures on this one new card: its
        // "{2}, {T}: Draw a card, then discard a card" activated `resolveSteps`
        // (draw / discard / requestChoice / getHandIds — all COVERED → FREE +
        // AFK-ready, the card ships a per-card test); its "whenever you discard,
        // you may exile that card from your graveyard" triggered `resolve`
        // (requestMayPay / moveCardById / linkExileToSource — the per-source
        // exile-linkage primitive `linkExileToSource` has no Op → Op-blocked);
        // and its "{T}: put an exiled card into its owner's graveyard, then make
        // a token" activated `resolve` (getCardsExiledWith + token creation — a
        // COVERED path → FREE + AFK-ready). Net: total 686→689, FREE 438→440,
        // AFK-ready 401→403, X-only unchanged (14), Op-blocked 234→235.
        // Partition: 440+14+235=689.
        //
        // Then issue #1287 (picksNonEmpty `if` predicate + excludeColor filter)
        // migrates Krovikan Sorcerer (both the nonblack and black
        // discard→draw activated abilities) and Mesmeric Trance from
        // `resolveSteps`/`resolve` to `effects[]` — the picks-nonempty predicate
        // now gates the conditional draw and excludeColor expresses the
        // nonblack filter. Net −3 closures, all FREE (2 AFK-ready + 1
        // need-test): total 689→686, FREE 440→437, AFK-ready 403→401, X-only
        // unchanged (14), Op-blocked unchanged (235). Partition: 437+14+235=686.
        //
        // Then issue #1284 widens `forEach { set: "bound" }`'s validator to
        // also accept a PICKS-family binding (a `choice` Op's `bind`, not just
        // a delayedTrigger/divideIntoPiles LIST capture) and migrates Frantic
        // Search (ulg/blue.ts) off its `resolveSteps: [...]` array to
        // `effects[]` — draw + choice(choose-hand-card)/discard + choice(
        // choose-permanents)/forEach(bound)/tapUntap. The classifier counts one
        // closure per `resolve:`/`resolveSteps:` KEY (not per array entry), so
        // this drops exactly ONE closure — it was FREE + AFK-ready (the card
        // already carried its own suspend/resume test, ulg/__tests__/blue.
        // test.ts, which still passes unchanged against the DSL script). Net
        // −1 closure: total 686→685, FREE 437→436, AFK-ready 401→400, X-only
        // unchanged (14), Op-blocked unchanged (235). Partition:
        // 436+14+235=685.
        //
        // Then issue #1305 ships Barrowgoyf (m3c/black.ts) as a new
        // `resolveSteps` closure — its dies/ETB graveyard-count trigger reads
        // `event.amount`, which is inexpressible in the DSL (no numeric
        // `EffectValue` member; `EVENT_FIELD_REGISTRY` is id-only), the same
        // codified precedent class as Armadillo Cloak / Spirit Link / El-
        // Hajjâj. +1 closure, Op-blocked (protocol, not FREE). Net: total
        // 685→686, Op-blocked 235→236, FREE/AFK-ready/X-only unchanged
        // (436/400/14). Partition: 436+14+236=686.
        //
        // Then issue #1306 ships Multiversal Passage (spm/colorless.ts) with
        // a new `enteredTrigger` `resolve()` closure — the SAME sanctioned
        // on-entry instance-scoped choice-storage protocol Illusionary
        // Terrain already established (`setChosenSubtypes`, no Effect Script
        // Op persists an instance-scoped choice). +1 closure, Op-blocked
        // (protocol, not FREE — the New-Op backlog's `setChosenSubtypes`
        // bucket picks up its third caller). Net: total 686→687, Op-blocked
        // 236→237, FREE/AFK-ready/X-only unchanged (436/400/14). Partition:
        // 436+14+237=687.
        //
        // Then issue #1308 ships Time Spiral (usg/blue.ts) with a new
        // `resolveSteps` closure — the SAME already-tracked Timetwister-shape
        // bulk whole-zone-move gap (lea/blue.ts's own `resolve()` closure,
        // tracked-by #1279) plus a self-exile (`ctx.exileSelf()`) and a
        // ranged battlefield untap choice, none of which is FREE-migratable
        // today. +1 closure, Op-blocked (not FREE — same #1279 bucket
        // Timetwister/Anje's Ravager/Echo of Eons/Winds of Change/Memory
        // Jar/Wheel of Fortune already sit in). Net: total 687→688,
        // Op-blocked 237→238, FREE/AFK-ready/X-only unchanged (436/400/14).
        // Partition: 436+14+238=688.
        //
        // Then issue #1320 ships Phelia, Exuberant Shepherd (mh3/white.ts)
        // with TWO new `resolve()` closures — an attack-trigger `resolve()`
        // (the SAME sanctioned Flickerwisp/Liberate flicker-idiom protocol:
        // `requestChoice` "another target" substitute + `exile` +
        // `scheduleDelayedTrigger`, all already-covered primitives) and its
        // paired `delayedTriggers[]` `resolve()` (`returnToBattlefield` +
        // the new controller/owner branch read via `getController` +
        // `addCounter`, also already-covered primitives). Both closures
        // classify FREE (every primitive they call is already in the
        // covered set) and both ship with a per-card test (AFK-ready). +2
        // closures, +2 FREE, +2 AFK-ready. Net: total 688→690, FREE
        // 436→438, AFK-ready 400→402, X-only/Op-blocked unchanged (14/238).
        // Partition: 438+14+238=690.
        //
        // Then issue #1317 ships Badgermole Cub (tla/green.ts) with a new
        // `tappedTrigger` `resolve()` closure (the mana-doubler "whenever you
        // tap a creature for mana, add an additional {G}" — the SAME
        // sanctioned Wild-Growth-style triggered-mana-ability protocol,
        // `ctx.addMana`, an already-covered primitive) — +1 closure, FREE
        // (need-test: the classifier's per-card-test heuristic doesn't match
        // this ability's test shape, so it lands in "need test first" rather
        // than AFK-ready despite `tla/__tests__/green.test.ts` covering it).
        // ALSO adds the `animate` Effect Script Op (`EFFECT_OP_REGISTRY`,
        // `binding: "SpellContext.animateAsCreature"`), which newly covers
        // `animateAsCreature` as a primitive — reclassifying every EXISTING
        // Op-blocked closure that calls it (Mishra's Factory-style "becomes a
        // creature" manland/animate abilities across the catalogue, e.g.
        // Mishra's Factory atq/colorless.ts, Mishra's War Machine) from
        // Op-blocked to FREE (AFK-ready — they already ship per-card tests).
        // Net: +1 new closure (FREE, need-test) + 6 reclassified closures
        // (Op-blocked→FREE, AFK-ready): total 690→691, FREE 438→445,
        // AFK-ready 402→408, X-only unchanged (14), Op-blocked 238→232.
        // Partition: 445+14+232=691.
        //
        // Then issue #1279 ships the `moveZone` Op's bulk whole-zone shape
        // (no target/cards) and the `discard` Op's bulk whole-hand shape
        // (cards omitted), and migrates FOUR of the long-standing #1279-
        // tracked-by closures away from `resolve()`: Timetwister
        // (lea/blue.ts), Echo of Eons (mh1/blue.ts), Wheel of Fortune
        // (lea/red.ts), and Anje's Ravager's attack-trigger (c19/red.ts) —
        // all four compose ONLY the new bulk shapes + already-covered
        // primitives (`libraryLook` shuffle, `draw`), no new primitive.
        // Winds of Change (leg/red.ts) and Memory Jar (ulg/colorless.ts) stay
        // resolve() — Winds of Change needs a dynamic count-of-cards-moved
        // ("draws THAT MANY") the bulk shape doesn't carry (tracked-by
        // #1388, a narrower follow-up gap); Memory Jar needs face-down exile
        // + a per-player delayed-trigger capture shape, genuinely more than
        // whole-zone move (protocol card, unchanged reasons 2/3 of its own
        // comment). -4 closures (all four leave the census entirely, since a
        // migrated card's effect is `effects[]` data, not a `resolve()`
        // closure the classifier scans). Of the four, THREE were genuinely
        // Op-blocked pre-migration (Timetwister, Echo of Eons, Wheel of
        // Fortune — all three called `ctx.moveZone`/`ctx.discardCard` in the
        // bulk-loop shape the classifier's static primitive scan correctly
        // flagged as needing the new Op); Anje's Ravager's attack-trigger
        // closure was already counted FREE+AFK-ready pre-migration (its
        // individual primitives — `getHandIds`, `discardCard`, `drawCards` —
        // were ALL already "covered" primitives; the classifier's primitive-
        // presence scan doesn't detect the whole-hand LOOP usage pattern as
        // blocking, only the Op-vocabulary gap the *other* three closures hit
        // more directly). Net: total 691→687 (-4), FREE 445→444 (-1, the
        // already-FREE Anje's Ravager closure leaving), AFK-ready 408→407
        // (-1, same closure — it shipped with a per-card test), need-test
        // unchanged (37 = 444−407 = 445−408), X-only unchanged (14),
        // Op-blocked 232→229 (-3, the three genuinely-blocked closures).
        // Partition: 444+14+229=687.
        //
        // Then issue #1083 ships the `setColor` Op (CR 613.1e layer 5,
        // wrapping the EXISTING `SpellContext.setColorOverride` primitive,
        // promoted from `EFFECT_OP_BACKLOG` to `EFFECT_OP_REGISTRY`) and the
        // `setSubtype` Op (CR 305.7 layer 4, wrapping `SpellContext.setSubtypesUntil`)
        // alongside 9 newly-unstubbed INV cards (inv/blue.ts) that compose the
        // new Ops as `effects[]` DATA — not `resolve()` closures the classifier
        // scans, so they add ZERO new closures to the census. What changes the
        // count is `setColorOverride`/`setSubtypesUntil` newly joining the
        // "Covered Ops" primitive set: every PRE-EXISTING `resolve()` closure
        // elsewhere in the catalogue that already called one of these two
        // primitives directly reclassifies from Op-blocked to FREE, e.g.
        // Alloy Golem (inv/colorless.ts), Kavu Chameleon (inv/green.ts), Shyft
        // (ice/blue.ts), Personal Incarnation (lea/white.ts), Sea Kings'
        // Blessing (leg/blue.ts), Sylvan Paradise (leg/green.ts), Alchor's Tomb
        // (leg/colorless.ts), Orcish Farmer (ice/red.ts) and Vision Charm
        // (vis/blue.ts) — all AFK-ready (already ship per-card tests); Dwarven
        // Song (leg/red.ts) and Touch of Darkness (leg/black.ts) land
        // "need test first" because their existing coverage lives in the
        // WRONG per-colour test file (leg/white.test.ts, not the parallel
        // leg/red.test.ts / leg/black.test.ts the classifier's heuristic
        // requires); Slimy Kavu (inv/red.ts) has no test at all yet. Total
        // closures unchanged (687, no closures added or removed). Net: FREE
        // 444→455 (+11), AFK-ready 407→415 (+8), need-test 37→40 (+3),
        // X-only unchanged (14), Op-blocked 229→218 (-11).
        // Partition: 455+14+218=687.
        //
        // Then issue #1391 (Companion framework) adds Lutri, the
        // Spellchaser's ETB trigger — a genuinely Op-blocked resolve()
        // closure: `copyStackItem`/`requestCopyRetarget` (CR 707.10
        // copy-a-spell) are `SpellContext`-only primitives with NO Effect
        // Script Op wrapper anywhere in the registry (the same architectural
        // gap Fork, lea/red.ts, has always had — copying a spell on the
        // stack is resolve()-only by design, not a card-shaped oversight).
        // This lands on top of the #1083 INV baseline above (455/415/218),
        // not the earlier pre-#1083 one. Net: total 687→688 (+1),
        // FREE/AFK-ready/X-only unchanged, Op-blocked 218→219 (+1, the new
        // closure). Partition: 455+14+219=688.
        //
        // 2026-07-20 census refresh: one previously-FREE closure reclassified
        // as Op-blocked (FREE 455→454, AFK-ready 415→414, Op-blocked 219→220);
        // total unchanged at 688. Partition: 454+14+220=688.
        //
        // 2026-07-20 arn FREE-tranche migration: 8 resolve() closures migrated
        // to effects[] (arn black/blue/green/red) — total 688→680 (−8),
        // FREE 454→447 (−7), AFK-ready 414→407 (−7), Op-blocked 220→219 (−1,
        // one migrated closure had been classified Op-blocked). X-only
        // unchanged. Partition: 447+14+219=680.
        //
        // 2026-07-20 atq FREE-tranche migration: 9 resolve() closures migrated
        // to effects[] (atq colorless 5, blue 2, green 2; black 0 — all 5
        // classifier false-positives, comment-only reassessment) — total
        // 680→671 (−9), FREE 447→438 (−9), AFK-ready 407→398 (−9). X-only and
        // Op-blocked unchanged. Partition: 438+14+219=671.
        //
        // 2026-07-21 census refresh: two previously Op-blocked closures
        // reclassified as FREE (exo colorless / lea green edits in the
        // phase-2 WIP) — FREE 438→440, AFK-ready 398→400, Op-blocked
        // 219→217; total unchanged at 671. Partition: 440+14+217=671.
        //
        // 2026-07-21 #1280 factory-effects migration: 9 resolve() closures
        // migrated to effects[] via the new `effects` site added to the shared
        // trigger/ability factories — DelayedTriggerDef ×6 (nextUpkeepDrawTrigger
        // copies in csp/colorless + ice colorless/white/green/blue/black),
        // leftTrigger (Chromatic Star), damageDealtTrigger (Psychic Frog),
        // SpellMode (Witherbloom Charm sacrifice-draw mode) — total 671→662
        // (−9), FREE 440→431 (−9), AFK-ready 400→397 (−3, three had per-card
        // tests). X-only and Op-blocked unchanged. Partition: 431+14+217=662.
        //
        // 2026-07-21 #1285 Stun migration (landed first): resolve()→effects[]
        // via restrictCombat + draw — total 662→661 (−1), FREE 431→430 (−1);
        // Stun had no test so AFK-ready stayed 397.
        //
        // 2026-07-21 #1282 Bazaar of Baghdad migration: 1 resolveSteps()
        // closure migrated to effects[] (draw + author-supplied-id choice +
        // discard, unblocked by the new `choice` Op `id` field) — total
        // 661→660 (−1), FREE 430→429 (−1), AFK-ready 397→396 (−1, it had a
        // per-card test). X-only and Op-blocked unchanged. Partition:
        // 429+14+217=660.
        //
        // 2026-07-21 lookRandomHand Op ships (Urza's Bauble private hand look,
        // CR 701.18a): `lookRandomHandCard` / `notifyReveal` join the Covered
        // Ops, reclassifying a previously Op-blocked private-random-hand-look
        // closure as FREE. Measured census after this Op AND the concurrent
        // #1281 (coinFlip) / #1282 (Bazaar) / #1285 (Stun) migrations logged
        // above: total 659, FREE 431, AFK-ready 398, X-only 14, Op-blocked
        // 214. Partition: 431+14+214=659.
        //
        // 2026-07-21 atq/red Shatterstorm migrated (destroyAll → forEach +
        // destroy{cantBeRegenerated}, Day of Judgment shape, no new Op): total
        // 659→658 (−1), FREE 431→430 (−1), AFK-ready 398→397 (−1, it had a
        // per-card test). X-only and Op-blocked unchanged. Partition:
        // 430+14+214=658.
        // 2026-07-21 free-tranche batch 1 (atq/drk colour modules): 4 FREE +
        // AFK-ready closures migrated resolve()→effects[] — Goblin Wizard
        // (drk/red, choose-hand-card + moveZone), The Fallen ×2 (drk/black,
        // damageDealtTrigger factory now exposes an effects[] site + a
        // counter-count `if` guard), and Word of Binding (drk/black, the
        // `{ set: "targets" }` X-multi-target selector, issue #1083). All four
        // left the FREE bucket: total 658→654, FREE 430→426, AFK-ready
        // 397→393. X-only and Op-blocked unchanged. Partition: 426+14+214=654.
        // 2026-07-21 free-tranche batch 2 (lea/black, lea/blue, lea/colorless,
        // leg/white — Alpha/Legends): 15 FREE + AFK-ready closures migrated
        // resolve()→effects[]. lea/colorless: Ankh of Mishra, Copper Tablet,
        // Jade Statue, Mana Vault. lea/blue: Pirate Ship, Sea Serpent, Spell
        // Blast, Time Walk. leg/white: Cleanse, Divine Offering, Spiritual
        // Sanctuary, Petra Sphinx. lea/black: Demonic Hordes, Demonic Tutor,
        // Pestilence (the first two had STALE NOT-migratable markers that
        // choice.zoneOwnerId / moveZone-library-source have since unblocked).
        // All 15 left the FREE bucket: total 654→639, FREE 426→411, AFK-ready
        // 393→378. X-only and Op-blocked unchanged. Partition: 411+14+214=639.
        // 2026-07-21 diedTrigger + tappedTrigger factories gained an effects[]
        // opt-in (mirroring leftTrigger/landfallTrigger — the interpreter seam
        // compiles it; the LKI/tapped payload is NOT surfaced so LKI-reading
        // cards stay resolve()). Two proof cards migrated resolve()→effects[]:
        // Soul Net (lea/colorless, diedTrigger — mayPay+if+gainLife) and
        // Lifetap (lea/blue, tappedTrigger — gainLife controller). Both left
        // the FREE bucket: total 639→637, FREE 411→409, AFK-ready 378→376.
        // X-only and Op-blocked unchanged. Partition: 409+14+214=637.
        // 2026-07-21 free-tranche batch 3 (ice/black, ice/blue, ice/green,
        // lea/red — harvesting the diedTrigger/tappedTrigger cluster just
        // unblocked by the factory effects[] opt-in, plus other stale-marker
        // re-assessments): 28 closures migrated resolve()→effects[] (incl.
        // Tarpan/Thoughtleech via the new factory path, Tunnel, Hydroblast,
        // Nature's Lore, Dark Banishing, …), and ice/green's now-dead
        // next-upkeep-draw delayed-trigger helper (Pyknite was the last caller)
        // removed 2 more counted closures. A couple of residual closures shifted
        // FREE→Op-blocked as newly-added markers cite genuinely-unregistered Ops.
        // Net: total 637→607, FREE 409→377, AFK-ready 376→350, Op-blocked
        // 214→216, X-only unchanged. Partition: 377+14+216=607.
        // 2026-07-21 free-tranche batch 4 (leg/black, leg/blue, sos/multicolor,
        // inv/black — fresh modules): 19 closures migrated resolve()→effects[]
        // (Plague Spitter via the new diedTrigger effects[] path; the three
        // Strixhaven charms' modes; Flash Flood, Sea King's Blessing, Part
        // Water, Phyrexian Reaper/Slayer/Delver, Jovial Evil, Touch of Darkness,
        // Mold Demon, …). Every examined non-migratable card now carries an
        // accurate marker. All 19 left the FREE bucket: total 607→588, FREE
        // 377→358, AFK-ready 350→334. X-only and Op-blocked unchanged.
        // Partition: 358+14+216=588.
        // 2026-07-22 free-tranche batch 5 (ice/red, ice/multicolor,
        // ice/colorless, inv/multicolor — fresh disjoint modules): 22 closures
        // migrated resolve()→effects[]. ice/red 9 (Anarchy, Avalanche,
        // Jokulhaups, Glacial Crevasses, Karplusan Giant, Goblin Ski Patrol,
        // Orcish Farmer, Pyroblast, Word of Blasting); ice/multicolor 5 (Giant
        // Trap Door Spider, Hymn of Rebirth, Skeleton Ship, Earthlink+Glaciers
        // shared upkeep factory); ice/colorless 6 (Despotic Scepter, Pit Trap,
        // Soldevi Golem, Soldevi Simulacrum, Time Bomb, Jester's Cap — stale
        // moveZone marker cleared); inv/multicolor 2 (Smoldering Tar, Aura
        // Shards). All 22 left the FREE bucket: total 588→565, FREE 358→335,
        // AFK-ready 334→317. X-only and Op-blocked unchanged.
        // Partition: 335+14+216=565.
        // 2026-07-22 free-tranche batch 6 (ice/black, ice/white, fem/blue,
        // drk/blue — disjoint modules): 16 closures migrated resolve()→effects[].
        // ice/black 1 (Krovikan Elementalist delayed body) + 8 over-count cards
        // accurately marked ($event/factory-no-site/custom-triggerId); ice/white
        // 5 (Blessed Wine, Call to Arms, Cold Snap, Hallowed Ground, Justice
        // upkeep); fem/blue 5 (Homarid+Tidal Influence tide-trigger factory ×2,
        // Vodalian Knights, Seasinger, Merseine enter); drk/blue 5 (Mana Vortex
        // ×2, Riptide, Electric Eel, Dance of Many self-sac). All 16 left FREE:
        // total 565→549, FREE 335→318, AFK-ready 317→303. One card reclassified
        // FREE→Op-blocked on re-marking (Op-blocked 216→217). X-only unchanged.
        // Partition: 318+14+217=549.
        // 2026-07-22 free-tranche batch 7 (fem white/red/black, leg
        // multicolor/green/red/colorless, lea blue/white/green/black, ice/blue,
        // inv/green — small disjoint modules, packed 2-4 per subagent): 25
        // closures migrated resolve()→effects[]. Several shared factories
        // collapsed (payOrSacrificeUpkeepTrigger across the Elder Dragons +
        // Tabernacle; makeElementalBlast; makeLace 5-card cycle), so the closure
        // count drops by more than the card count. Many classifier over-counts
        // (misattributed comment/factory-ref false positives, DelayedTriggerDef
        // bodies double-counted) given accurate NOT-DSL markers. All 25 left
        // FREE: total 549→524, FREE 318→293, AFK-ready 303→281. X-only and
        // Op-blocked unchanged. Partition: 293+14+217=524.
        // 2026-07-22 free-tranche batch 8 (INV/MH3/HOU/NCC/EVE/singleton sweep
        // — heavily fragmented pool, packed many small modules per subagent):
        // 11 closures migrated resolve()→effects[]. mh3/multicolor (Phlage
        // enters+attacks, shared value fn); hou/red (Abrade both modes);
        // inv/colorless (Alloy Golem setColor); ncc/colorless (Currency
        // Converter draw-discard); znr/white (Luminarch Aspirant); wwk/colorless
        // (Celestial Colonnade); vis/blue (Vision Charm mill mode); thb/colorless
        // (Soul-Guide Lantern x2). Most other classifier entries were confirmed
        // heuristic false positives (comment-`resolve:` mis-attribution,
        // DelayedTriggerDef body double-counts, host-controller/LKI blockers) and
        // given accurate markers. All 11 left FREE: total 524→513, FREE 293→283,
        // AFK-ready 281→271. One card reclassified out of Op-blocked (217→216).
        // X-only unchanged. Partition: 283+14+216=513.
        //
        // 2026-07-22 (Op-infra batch — exile-and-return Ops, the top New-Op
        // backlog entries): shipped the `exileWithAttachments` (was 8 blocked)
        // and `returnExiledForSource` (was 9 blocked) Effect Script Ops — the
        // O-Ring / Banishing Light / Oblivion Ring / Tawnos's Coffin family —
        // as thin declarative skins over the existing ADR 0028 SpellContext
        // primitives, plus an `effects[]` opt-in on the last holdout trigger
        // factory (`untapTrigger`, mirroring leftTrigger). 16 closures migrated
        // resolve()→effects[] across the whole exile-and-return cluster: jou
        // (Banishing Light), afr (Portable Hole), nem/white (Parallax Wave),
        // nem/blue (Parallax Tide), ice/blue (Icy Prison), tla/white (Aang's
        // Iceberg — 2 of 3 abilities; the waterbend partition-scry stays
        // resolve()), drk/colorless (Safe Haven's activated exile; its
        // may-pay upkeep return stays resolve()), atq/colorless (Tawnos's
        // Coffin — all 3 abilities, incl. the untapTrigger return). Both Ops
        // left the New-Op backlog and are now COVERED. All 16 were AFK-ready.
        // Net: total 513→497, FREE 283→284 (a formerly Op-blocked residual
        // closure surfaced FREE as the cluster drained), AFK-ready 271→272,
        // Op-blocked 216→199 (−17), X-only unchanged. Partition: 284+14+199=497.
        //
        // 2026-07-22 (Op-infra batch — `dealDamageDividedAsChosen`, the joint
        // top New-Op backlog entry at 8): shipped the divide-as-you-choose
        // damage Op (CR 601.2d / 120.4) as a thin declarative skin over the
        // existing `SpellContext.dealDamageDividedAsChosen` primitive over the
        // WHOLE announced target group; `total` reuses the exact
        // `divideAsChosen.total` vocabulary (number | "X" | "X+1"). 7 closures
        // migrated resolve()→effects[] across the whole cluster: usg (Arc
        // Lightning), all (Pyrokinesis), mh2 (Fury's ETB trigger), nem (Arc
        // Mage's activated ability), ice/red (Meteor Shower, total "X+1"),
        // ice/multicolor (Fiery Justice — +gainLife opponent — and Fire
        // Covenant, total "X"). The Op left the New-Op backlog and is now
        // COVERED. All 7 were AFK-ready. Net: total 497→490, Op-blocked
        // 199→192 (−7), FREE/X-only/AFK-ready unchanged. Partition:
        // 284+14+192=490.
        //
        // 2026-07-22 (Op-infra batch — `restrictCombat` evasion restriction,
        // the joint top New-Op backlog entry at 7): EXTENDED the existing
        // `restrictCombat` Op with `restriction: "cant-be-blocked"` (CR
        // 509.1b) → `setCantBeBlockedThisTurn`, the reuse-over-new-Op choice
        // (widen one union member + one executor branch + one validator value;
        // NO new op-key / registry row / scenarioGenerator switch case — the
        // generator switches on op name, so the value is auto-covered). 5
        // closures migrated resolve()→effects[]: atq (Tawnos's Wand), ice/green
        // (Trailblazer), ice/colorless (Runed Arch — forEach { set: "targets" }
        // over X targets), leg/blue (Teleport), wwk/colorless (Creeping Tar-Pit
        // — `animate` Op + the new restriction, now fully DSL). The 2 Goblin
        // Sappers legs (ice/red) stay resolve() — blocked on the delayedTrigger
        // sentinel-id issue, orthogonal to this Op. The primitive left the
        // New-Op backlog and is now COVERED. All 5 were AFK-ready. Net: total
        // 490→485, Op-blocked 192→185 (−7 whole cluster de-listed), FREE
        // 284→286 / AFK-ready 272→274 (+2 = the 2 Sappers reclassified: their
        // named primitive is now covered but they stay resolve(), already
        // NOT-DSL-marked so hidden from the --free worklist). X-only unchanged.
        // Partition: 286+14+185=485.
        //
        // 2026-07-22 (Op-infra batch — `setBasePT`, joint top New-Op backlog
        // entry at 7): shipped the layer-7b base-P/T SET Op (CR 613.4b) as a
        // thin declarative skin over the existing `SpellContext.setBasePT`
        // primitive; power/toughness are each OPTIONAL non-negative-int
        // characteristics (0 legal), at least one required, `duration` required
        // (distinct from `pump`'s relative 7c modifier and `animate`'s 7a
        // base-set-plus-become-creature). 4 closures migrated resolve()->
        // effects[]: arn/black (Sorceress Queen 0/2), arn/colorless (Island of
        // Wak-Wak power-0), arn/green (Singing Tree power-0), sos/multicolor
        // (the 5/5 set). The 3 remaining setBasePT closures stay resolve(),
        // blocked on OTHER gaps (markers re-worded off the now-shipped Op):
        // leg/multicolor (Halfdane — base P/T = SNAPSHOT of an announced
        // target's P/T, a value-from-target ref), leg/black (base toughness =
        // "1 + creatures in graveyard", an additive-count value), blb/blue
        // (removeStaticAbilities Op + a target-is-creature `if` predicate).
        // The Op left the New-Op backlog and is now COVERED. All 4 were
        // AFK-ready. Net: total 485->481, Op-blocked 185->179 (-6), FREE
        // 286->288 / AFK-ready 274->276 (+2 = the leg/multicolor + leg/black
        // closures reclassified: their named primitive is now covered but they
        // stay resolve(), re-marked NOT-DSL so hidden from the --free worklist).
        // X-only unchanged. Partition: 288+14+179=481.
        //
        // 2026-07-22 (Op-infra batch — `skipNextUntap`, joint-top New-Op
        // backlog entry at 6): shipped the one-shot "doesn't untap during its
        // controller's next untap step" Op (CR 302.6/502.1) as a thin
        // declarative skin over the existing `SpellContext.skipNextUntap`
        // primitive — a single `target` selector, no amount/duration (the
        // one-shot next-untap scope is intrinsic to the flag). Split off the
        // CONTINUOUS source-linked half (`lockUntapWhileSourceTapped`), which
        // stays `planned` under the `lockUntap` row. 5 closures migrated
        // resolve()->effects[]: drk/colorless (Barl's Cage, announced slot),
        // drk/red (Goblin Rock Sled, $source self-lock trigger), fem/blue
        // (Homarid Warrior + Deep Spawn — each a grantAbility shroud +
        // tapUntap tap + skipNextUntap $source triple), fem/green (Elvish
        // Hunter, announced slot). The 6th skipNextUntap closure (fem/green
        // Spore Cloud — a forEach over attacking/blocking creatures) is
        // NOT cleanly migratable (a battlefield forEach loop) but its named
        // primitive is now covered, so the classifier reclassifies it FREE
        // (+1). All 5 migrated were AFK-ready. Net: total 481->476, Op-blocked
        // 179->173 (-6), FREE 288->289 / AFK-ready 276->277 (+1 = the forEach
        // closure surfacing as FREE). X-only unchanged. Partition: 289+14+173=476.
        //
        // 2026-07-22 (Op-infra batch — `discardAtRandom`, joint-top New-Op
        // backlog entry at 6): shipped the "discards N cards AT RANDOM from
        // hand" Op (CR 701.8a) as a thin declarative skin over the existing
        // `SpellContext.discardAtRandom` primitive — a `player` selector plus
        // a `count` EffectValue (literal or chosen-cost {X}). Distinct from
        // the `discard` Op (player-chosen / whole-hand set); this Op owns the
        // seeded-PRNG random selection no `choice` binding can express. 3
        // closures migrated resolve()->effects[]: fem/black (Hymn to Tourach,
        // count 2), lea/black (Mind Twist, count {X}), leg/multicolor (Gwendlyn
        // Di Corci's activated ability, count 1) — all announced-player slots.
        // The other 3 discardAtRandom closures stay resolve(): drk/black (The
        // Fallen — a "creature card" filter + reveal-hand it, blocked on
        // revealHand + a filter param), ice/black (Cloak of Confusion) and
        // lea/black (Hypnotic Specter) both read the firing $event. All 3
        // migrated were AFK-ready. Net: total 476->473, Op-blocked 173->169
        // (-4: the 3 migrated + one closure double-counted under this
        // primitive that now surfaces elsewhere), FREE 289->290 / AFK-ready
        // 277->278 (+1). X-only unchanged. Partition: 290+14+169=473.
        //
        // 2026-07-22 (Op-infra batch — `markAssignsNoCombatDamage`, the
        // source-side "assigns no combat damage this turn" Op, tracked-by
        // #1283): shipped a thin skin over the existing
        // `SpellContext.markAssignsNoCombatDamage` primitive (CR 510.1c) — a
        // single `target` EffectObjectSelector (announced slot / `$source` /
        // `$each`). Suppresses combat damage dealt BY the marked source
        // (distinct from the receiver-side `preventNextNDamageToTarget` /
        // `preventAllCombatDamage` Ops). 2 closures migrated resolve()->effects[]:
        // ice/white (Warning, announced), inv/white (Restrain, announced +
        // draw). The other markAssigns call sites stay resolve() — all
        // multi-step / $event closures: ice/black + fem/white combat-attacker
        // triggers reading the firing $event, ice/red (Orcish Squatters'
        // gain-control rider), fem/white (Heroism's per-attacker may-pay loop),
        // fem/white (Farrel's Zealot, a targeted trigger with a paired damage
        // op + "may" clause). The flag is a top-level `state.sourcePreventionShields`
        // array set in the SAME resolution and carried to the wire by the
        // `...state` projection spread, so scenarioGenerator does a REAL
        // assertor (the id appears in the array), not a skip. Both migrated
        // were AFK-ready. Net: total 470->468 (2 migrated), Op-blocked
        // 164->156 (-8: the markAssigns-only-blocked cluster reclassified —
        // 2 migrated out, the rest to FREE / their other blocker), FREE
        // 292->298 / AFK-ready 280->286 (+6). X-only unchanged. Partition:
        // 298+14+156=468.
        // #1459 (createTokenCopy Op): the Op shipped and Dance of Many's ETB
        // closure (its sole consumer — "create a token that's a copy of target
        // nontoken creature") migrated resolve()->effects[]. The ETB was the
        // only createTokenCopy-blocked closure, so it drops out of Op-blocked.
        // Net: total 468->467 (1 migrated), Op-blocked 156->155 (-1). FREE /
        // AFK-ready / X-only unchanged (the ETB was Op-blocked, not FREE).
        // Partition: 298+14+155=467.
        //
        // #1527 (Cube FREE wave 3 — keyword-residue creatures): two BRAND-NEW
        // catalogue cards, not migrations, each a `resolve()` closure composing
        // the impulse-draw protocol (`peekLibraryTop` + `exileFaceDown` +
        // `grantCastFromExile`, no Op skin — same documented shape as Robber of
        // the Rich / Headliner Scarlett): Ragavan, Nimble Pilferer's
        // combat-damage trigger (mh2/red.ts) and Inti, Seneschal of the Sun's
        // discard-impulse trigger (lci/red.ts). Both land in Op-blocked
        // (blocked on `exileFaceDown`, which has no Op skin). Net: total
        // 467->469 (+2 new closures), Op-blocked 155->157 (+2). FREE /
        // AFK-ready / X-only unchanged (neither closure is migratable).
        // Partition: 298+14+157=469.
        //
        // #1528 (Cube FREE wave 3 — graveyard CDA + stack interaction): Pyrogoyf
        // (m3c/red.ts) is a BRAND-NEW catalogue card, not a migration. Its
        // enter-trigger `resolve()` deals damage to an announced target, so the
        // static clause-mapper reads it as dealDamage-mappable (FREE) and it
        // ships with a per-card test (m3c/__tests__/red.test.ts → AFK-ready) —
        // even though the closure itself stays `resolve()` (the damage AMOUNT is
        // the entering creature's power read off the firing $event, no
        // EffectValue member). Net: total 469->470 (+1 new closure), FREE
        // 298->299, AFK-ready 286->287. X-only / Op-blocked unchanged.
        // Partition: 299+14+157=470.
        //
        // #1403 (flicker-card DSL migration, exile(bind)+delayedTrigger+moveZone
        // "blink" idiom, issue #1401): Liberate (inv/white.ts) and Flickerwisp
        // (eve/white.ts) each dropped TWO `resolve()` closures apiece — the
        // card/ETB-trigger `resolve()` AND its paired old-style
        // `delayedTriggers[]` entry's own `resolve()` — replaced by a single
        // `effects: EffectOp[]` script per card (no card-level `delayedTriggers[]`
        // left at all; the delayed body is now inline on a `delayedTrigger` Op).
        // Both cards' closures were previously classified FREE + AFK-ready (each
        // had a per-card test). Krovikan Vampire (ice/black.ts) / Seraph
        // (ice/white.ts) were re-assessed and NOT migrated here — same-shaped
        // oracle text but a structurally different idiom (CR 603.7c graveyard
        // reanimation off a death trigger, not exile), blocked on a separate,
        // still-open gap (no `CREATURE_DIED` `EVENT_FIELD_REGISTRY` row) tracked
        // by issue #1600. Net: total 470->466 (-4 closures), FREE 299->295 (-4),
        // AFK-ready 287->283 (-4). X-only / Op-blocked unchanged. Partition:
        // 295+14+157=466.
        //
        // #1558 (CARDS_EXILED event + Laelia, the Blade Reforged, c21/red.ts):
        // Laelia is a BRAND-NEW catalogue card, not a migration. Its
        // attack-trigger ability is a `resolve()` closure composing the same
        // impulse-draw protocol as Ragavan / Inti above (`peekLibraryTop` +
        // `exileFaceDown` + `grantCastFromExile`, no Op skin) — lands in
        // Op-blocked, same as those siblings (her second ability, the
        // CARDS_EXILED counter trigger, ships as a real `effects: EffectOp[]`
        // script and isn't a closure at all). Net: total 466->467 (+1 new
        // closure), Op-blocked 157->158 (+1). FREE / AFK-ready / X-only
        // unchanged. Partition: 295+14+158=467.
        //
        // #1283 (misc DSL Op gaps — Kavu Lair inv/green.ts, Island Sanctuary
        // lea/white.ts, Sylvan Library leg/green.ts): three resolve() closures
        // migrated to `effects: EffectOp[]`. Kavu Lair became expressible today
        // via `{ ref: "$event.controllerId" }` (no engine change); Island
        // Sanctuary and Sylvan Library got two new Ops shipped this PR
        // (`setIslandSanctuaryProtection`, `rangedTopdeck`), both thin
        // skins/compositions over pre-existing SpellContext primitives — so the
        // classifier had already scored them FREE, not Op-blocked. Net: total
        // 467->464 (-3 closures), FREE 295->293 (-2), AFK-ready 283->282 (-1),
        // Op-blocked 158->157 (-1, one of the three carried a per-card test in
        // the Op-blocked bucket). X-only unchanged. Partition: 293+14+157=464.
        //
        // "basic land card" search fix (Erode `sos/white.ts`, Path to Exile
        // `con/white.ts`): both `resolve()` closures gained their first
        // per-card test file, and AFK-ready is FREE ∧ hasTest — so the two
        // move from "need test" into the AFK-ready subset. No closure was
        // added or migrated: total / FREE / X-only / Op-blocked all unchanged,
        // only AFK-ready 282->284.
        //
        // #728 (ICE small utilities — Dread Wight, ice/black.ts): a BRAND-NEW
        // catalogue card, not a migration. Its END_OF_COMBAT trigger is a
        // `resolve()` closure that walks the combat graph
        // (`getBlockersByAttacker()` both directions relative to the source) to
        // find "each creature blocking or blocked by this creature" — the same
        // gap Kjeldoran Frostbeast documents (no `EffectForEachSelector`
        // filters permanents by combat role relative to a specific object).
        // The static clause-mapper reads its body as addCounter + tap
        // mappable, so it scores FREE, and it ships with a per-card test
        // (ice/__tests__/black.test.ts → AFK-ready). Soldevi Machinist (the
        // other card in that PR) is a mana ability's `effect:` shorthand, not a
        // closure, so it does not enter the census. Net: total 464->465 (+1 new
        // closure), FREE 293->294, AFK-ready 284->285. X-only / Op-blocked
        // unchanged. Partition: 294+14+157=465.
        //
        // #1563 (Phantasmal Image, m12/blue.ts): a BRAND-NEW catalogue card,
        // not a migration. Its `resolveSteps` copy-effect closure
        // (`requestMayPay` + `requestChoice` + `becomeCopyOf`) is the SAME
        // protocol shape Clone / Copy Artifact / Phyrexian Metamorph already
        // use — `becomeCopyOf` is an existing New-Op-backlog entry (Op-blocked,
        // not FREE), so this card doesn't shift FREE/AFK-ready/X-only, only
        // adds one more Op-blocked closure onto the existing `becomeCopyOf`
        // bucket. Net: total 465->466 (+1 new closure), Op-blocked 157->158.
        // FREE / AFK-ready / X-only unchanged. Partition: 294+14+158=466.
        //
        // #1884 (Urza's Saga, mh2/colorless.ts): a BRAND-NEW catalogue card,
        // not a migration. Chapter II's GRANTED ability body is a `resolve()`
        // closure because the Construct token it makes carries a
        // characteristic-defining P/T (`pt-cda`, a `compute` CLOSURE) and the
        // DSL's `EffectTokenSpec` is a JSON-pure allowlist with no
        // `staticEffects` slot (ADR 0046). The static clause-mapper only sees
        // the `createToken` call, which IS a covered Op, so it scores FREE —
        // a false positive the census tolerates (it is a heuristic over call
        // shapes, not a purity checker); the card ships with a per-card test
        // file, so it lands in the AFK-ready subset. Net: total 466->467
        // (+1 new closure), FREE 294->295, AFK-ready 285->286. X-only /
        // Op-blocked unchanged. Partition: 295+14+158=467.
        //
        // #783 (Hideaway, CR 702.75): the new `hideaway` Op's binding string
        // names two primitives that had never appeared in a COVERED Op before —
        // `exileFaceDown` (the ADR 0026 impulse-draw face-down exile) and
        // `linkExileToSource` (the CR 607 exile provenance stamp). The census
        // reads its "covered" set live from `EFFECT_OP_REGISTRY` bindings, so
        // nine closures that were Op-blocked ONLY on those two primitives
        // reclassify as FREE, all nine already carrying a per-card test. NO new
        // closure was added (the card is DSL-first; its one `effect:` shorthand
        // is a mana ability, which the census does not count). Net: total
        // unchanged at 467, FREE 295->304, AFK-ready 286->295, Op-blocked
        // 158->149. Partition: 304+14+149=467.
        //
        // #1939 (Mirrorwood Treefolk, pls/green.ts): a BRAND-NEW catalogue
        // card, not a migration. Its `{2}{R}{W}` redirect ability is a
        // protocol-card `resolve()` closure (a mid-resolution
        // `choose-damage-target` pick over players + damageable permanents,
        // CR 115.4, plus the `addDamageRedirectionShield` primitive — neither
        // has an Effect Script Op wrapper) — one more Op-blocked closure onto
        // the existing `addDamageRedirectionShield` bucket (already the
        // Jade Monolith / Personal Incarnation / Reverse Damage shape). FREE /
        // AFK-ready / X-only unchanged. Net: total 467->468 (+1 new closure),
        // Op-blocked 149->150. Partition: 304+14+150=468.
        //
        // #788 (Wan Shi Tong, Librarian, tla/blue.ts): a BRAND-NEW catalogue
        // card landed briefly with a `resolve()` ETB ("put X counters, THEN
        // draw half X cards, rounded down") — the integer-division clause is
        // arithmetic the frozen `EffectValue` grammar can't express (ADR
        // 0045), so it read as a genuine resolve() justification, and the
        // static clause-mapper's `addCounter`/`drawCards` heuristic scored it
        // FREE/AFK-ready (total 468->469, FREE 304->305, AFK-ready 295->296).
        // Re-review (ADR 0061, issue #1993) caught that the closure also
        // calls the raw `SpellContext.drawCards` primitive directly, which
        // ADR 0061 forbids for any `resolve()`/`resolveSteps` site (only the
        // DSL `draw` Op is replacement-aware/resumable) — a stop-and-issue
        // case, not a shippable card. The card was converted to a commented
        // stub (`tracked-by: #1993`) and its per-card test file deleted, so
        // the ETB closure — and the +1 it contributed — is gone. Net: total
        // 469->468, FREE 305->304, AFK-ready 296->295 (back to the
        // pre-#788 baseline). X-only / Op-blocked unchanged. The card's
        // SECOND ability ("whenever an opponent searches their library...")
        // stayed pure DSL (`effects: EffectOp[]`, no `resolve()`) and never
        // contributed to this census. Partition: 304+14+150=468.
        //
        // Issue #1949 (PLS free tranche — Blue) added THREE new `resolve()`
        // closures, all protocol-justified (no Op skin for the primitive
        // each needs — `.claude/rules/gre-development.md` § DSL-first
        // authoring): Planeswalker's Mischief's activated ability (blocked
        // on the backlog's `revealHand` — the public
        // `SpellContext.revealRandomHandCard` primitive has no Op wrapper,
        // only the private `lookRandomHand` sibling does) scores Op-blocked
        // (150->151); its `delayedTriggers[]` return-body (`moveCardById`,
        // `getExileCardOwner`) and Sleeping Potion's ETB tap trigger
        // (`ctx.tap`/`ctx.getAttachedToId` — no attached-host
        // `EffectObjectSelector` exists in the DSL, the established Venarian
        // Gold precedent gap) both lean on COVERED primitives (`tap`,
        // `moveCardById`) the static heuristic scores FREE even though
        // they're genuinely blocked on a missing object-selector — the SAME
        // known over-count class the Wan Shi Tong note above documents, not
        // a certification these two should actually migrate today (FREE
        // 304->306). Per PR #2010's review (BLOCKER 1, mandatory hand-written
        // tests for a `resolve()` site — `gre-development.md` § Card testing
        // convention), both FREE-scored closures (Sleeping Potion's ETB tap,
        // Planeswalker's Mischief's delayed-trigger return body) landed a
        // per-card test in `pls/__tests__/blue.test.ts`, which is exactly
        // what "AFK-ready" tracks ("has per-card test"): AFK-ready 295->297,
        // "need test first" 11->9 (the same two closures moving out of it).
        // Partition: 306+14+151=471.
        // #1951 (PLS red free tranche, F4): six NEW resolve() closures landed,
        // each with its own recorded NOT-DSL-migratable justification (an
        // established gap, not a fresh one — matches Seizures/Stonehands/
        // Regeneration/Karplusan Yeti precedent): Insolence's host-controller
        // damage (tappedTrigger's effects[] site binds no cross-player
        // selector), Keldon Mantle's three Aura activated abilities
        // (getAttachedTo — no attached-host object selector), Planeswalker's
        // Fury (revealRandomHandCard's random pick has no bound ref), and
        // Tahngarth's fight ability (no registered `fight` Op, tracked-by
        // #2013). The static clause-mapper scores by primitive coverage, not
        // by the recorded justification: Insolence + Keldon Mantle's three
        // abilities call only COVERED primitives (dealDamage,
        // applyRegenerationShield, addTemporaryPTBuff, grantStaticAbility) so
        // they land FREE — and all four already have a per-card test (this
        // PR's own), so AFK-ready moves with FREE one-for-one. Planeswalker's
        // Fury (revealRandomHandCard) and Tahngarth (fight) call primitives
        // absent from "Covered Ops", so they land Op-blocked. Net: total
        // 471->477, FREE 306->310, AFK-ready 297->301 (need-test-first
        // unchanged at 9), X-only unchanged at 14, Op-blocked 151->153.
        // Partition: 310+14+153=477.
        //
        // Issue #1953 (PLS free tranche — multicolour 2c) adds exactly ONE
        // closure: Meddling Mage's `resolveSteps` CR 614.12 as-enters name
        // choice (`requestNameCard` + the new `setSelfChosenName`). The
        // clause-mapper scores it Op-blocked — `setSelfChosenName` is a
        // `resolveSteps`-only primitive with no Effect Script Op wrapper, the
        // same shape `setSelfBody` (Primal Clay / Shapeshifter) already
        // occupies. Every OTHER card in that 24-card slice is a pure Effect
        // Script and contributes no closure at all. Net: total 477->478,
        // Op-blocked 153->154; FREE / AFK-ready / X-only all unchanged.
        // Partition: 310+14+154=478.
        //
        // Issue #1957 (skipNextTurn Effect Op + Waterspout Elemental) adds NO
        // new resolve() closure of its own (Waterspout Elemental is pure
        // Effect Script) but registers the `skipNextTurn` Op as a thin skin
        // over the ALREADY-shipped `SpellContext.setSkipNextTurn` primitive —
        // the exact primitive Time Vault's pre-existing `resolve()` closure
        // ("Skip your next turn: Untap Time Vault.", lea/colorless.ts) already
        // calls. That primitive becoming Op-covered flips Time Vault's
        // closure from Op-blocked to FREE (it already has a per-card test —
        // `colorless.test.ts`'s "Time Vault" describe block — so it lands
        // AFK-ready too, not "need test first"). Net: total unchanged at 478,
        // FREE 310->311, AFK-ready 301->302, Op-blocked 154->153; X-only
        // unchanged at 14. Partition: 311+14+153=478.
        //
        // The `attacks-unblocked` delayed-trigger timing (CR 603.7a / 509.1h)
        // REMOVES two closures instead of adding any: Delif's Cone and Delif's
        // Cube each shipped an intentionally EMPTY `resolve() {}` standing in
        // for the armed unblocked-attack rider the engine could not express.
        // Both abilities are now pure Effect Scripts (`delayedTrigger` with
        // the new timing), so the two closures are gone from the catalogue
        // entirely. They were classified FREE/AFK-ready (empty bodies with a
        // per-card test), which is where the deltas land. Net: total 478->476,
        // FREE 311->309, AFK-ready 302->300; X-only unchanged at 14,
        // Op-blocked unchanged at 153. Partition: 309+14+153=476.
        //
        // The `exileOnDeath` Op (CR 614.1a, issue #1095) ADDS no closure — it
        // is a DSL skin over `SpellContext.setExileOnDeath`, which three
        // existing `resolve()` closures already call (Disintegrate
        // `drk/green.ts`, `fin/red.ts`, `lea/red.ts`). That primitive becoming
        // Op-covered flips all three OUT of Op-blocked: two land FREE (both
        // carry a per-card test, so AFK-ready too) and Disintegrate falls
        // through to X-only instead, its `{X}{R}` cost being the remaining
        // blocker once the exile arm is expressible. Net: total unchanged at
        // 476, FREE 309->311, AFK-ready 300->302, X-only 14->15, Op-blocked
        // 153->150. Partition: 311+15+150=476.
        //
        // Urza, Lord High Artificer (mh1/blue.ts, issue #2371) ADDS two
        // `resolve()` closures: the ETB Construct-creation trigger
        // (`createUrzaConstruct` — a protocol-like exception, the CDA token
        // spec genuinely has no DSL skin) and the `{5}` shuffle/exile/free-
        // cast activated ability (no Op skin for an unconditional top-of-
        // library exile, same shape as Elkin Bottle's own long-standing
        // closure). Both carry a per-card test (`mh1/__tests__/blue.test.ts`),
        // so both land FREE/AFK-ready like every other tested empty-primitive-
        // gap closure above. Net: total 476->478, FREE 311->313, AFK-ready
        // 302->304; X-only unchanged at 15, Op-blocked unchanged at 150.
        // Partition: 313+15+150=478.
        //
        // Vaultborn Tyrant (big/green.ts, issue #2364) ADDS one `resolve()`
        // closure: the dies trigger that creates its artifact token copy
        // (`vaultborn-tyrant-dies-copy`). It calls ONLY the already-covered
        // `createToken` Op (via `ctx.createToken`), so the classifier's
        // primitive sweep counts it FREE — the reason it STAYS `resolve()`
        // (reusing this card's own `TriggeredAbility` OBJECTS so the token
        // copy keeps working closures, CR 707.2) is a DSL-expressivity
        // nuance the classifier's coarse "does it call an uncovered
        // primitive" heuristic doesn't model, not a missing Op. Carries a
        // per-card test (`big/__tests__/green.test.ts`), so AFK-ready too.
        // Net: total 478->479, FREE 313->314, AFK-ready 304->305; X-only
        // unchanged at 15, Op-blocked unchanged at 150. Partition:
        // 314+15+150=479.
        expect(num(summary, /—\s+(\d+)\s+closures/)).toBe(479);
        expect(num(summary, /FREE \(migratable now\):\s+(\d+)/)).toBe(314);
        expect(num(summary, /of which AFK-ready:\s+(\d+)/)).toBe(305);
        expect(num(summary, /X-only blocked:\s+(\d+)/)).toBe(15);
        expect(num(summary, /Op-blocked:\s+(\d+)/)).toBe(150);
    });

    it("surfaces the demonstrated new-Op backlog (a covered primitive leaves it)", () => {
        // pump (#840), counters (#841), tapUntap (#842), grantAbility (#843),
        // regenerate (#846) and now scryReorder / mill (#885) SHIPPED:
        // addTemporaryPTBuff, addCounter / removeCounter, tap / untap,
        // grantStaticAbility, applyRegenerationShield and now
        // peekLibraryTop / orderTop are COVERED Ops (they appear in the "Covered
        // Ops" line, no longer in the backlog). peekLibraryTop was the top
        // blocker before #885, and `markKnown` folded into a covered Op with the
        // known-bottom PR (`digToHand`'s binding); the backlog still surfaces the
        // next primitives (moveZone / …), a stable signal that it is being read.
        expect(summary).toMatch(/New-Op backlog/);
        expect(summary).toMatch(/Covered Ops[^\n]*applyRegenerationShield/);
        expect(summary).toMatch(/Covered Ops[^\n]*peekLibraryTop/);
    });
});

describe("migration classifier — known-card routing (PRD #826)", () => {
    const free = run("--free");
    const freeAll = run("--free", "--all");

    it("hides an already-assessed non-migratable card (Cuombajj Witches) from the pickable --free list", () => {
        // Cuombajj Witches' effect maps onto existing Ops by the static
        // clause-mapper (so it counts in the summary FREE upper bound), but it
        // carries a NOT-DSL-migratable marker — its second ping is an
        // opponent's choice with no Op. The `--free` worklist picker therefore
        // HIDES it (re-dispatching a subagent onto it would only re-confirm the
        // skip), while `--free --all` still surfaces it. This is the canary for
        // the assessed-skip filter: a marked card is hidden from the pickable
        // list but present with --all.
        expect(free).not.toMatch(/Cuombajj Witches/);
        expect(freeAll).toMatch(/Cuombajj Witches/);
    });

    it("does NOT route an Op-blocked card (Word of Command) to the FREE tranche", () => {
        // Word of Command is a PROTOCOL card (ADR 0037): its resolution takes
        // over an opponent's decisions ("look at their hand, choose a card,
        // they cast/play it") through a control-transfer protocol that no Op
        // vocabulary can express — it is permanently resolve() by design, never
        // a migration candidate. That makes it the most STABLE canary: unlike a
        // primitive-blocked card, it can never flip to FREE by an Op shipping.
        // (Canary swapped from Drafna's Restoration, whose sole blocker
        // `reorderLibraryTop` shipped with the `digToHand` Op — issue #984 — so
        // the classifier now routes it to FREE; the swap keeps the canary
        // pointed at a card that stays genuinely Op-blocked.)
        expect(free).not.toMatch(/Word of Command/);
    });
});
