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
        expect(num(summary, /—\s+(\d+)\s+closures/)).toBe(633);
        expect(num(summary, /FREE \(migratable now\):\s+(\d+)/)).toBe(399);
        expect(num(summary, /of which AFK-ready:\s+(\d+)/)).toBe(366);
        expect(num(summary, /X-only blocked:\s+(\d+)/)).toBe(14);
        expect(num(summary, /Op-blocked:\s+(\d+)/)).toBe(220);
    });

    it("surfaces the demonstrated new-Op backlog (top blocker is peekLibraryTop)", () => {
        // pump (#840), counters (#841), tapUntap (#842), grantAbility (#843)
        // and now regenerate (#846) SHIPPED: addTemporaryPTBuff, addCounter /
        // removeCounter, tap / untap, grantStaticAbility and
        // applyRegenerationShield are now COVERED Ops (they appear in the
        // "Covered Ops" line, no longer in the backlog). The most-blocking
        // remaining primitive is peekLibraryTop (the scryReorder backlog Op) —
        // a stable signal that the Op backlog is being read.
        expect(summary).toMatch(/New-Op backlog/);
        expect(summary).toMatch(/peekLibraryTop/);
        expect(summary).toMatch(/Covered Ops[^\n]*applyRegenerationShield/);
    });
});

describe("migration classifier — known-card routing (PRD #826)", () => {
    const free = run("--free");

    it("routes a draw spell (Night's Whisper) to the FREE tranche", () => {
        // Night's Whisper's effect is draw + lose-life — every clause maps onto
        // an existing Op (`draw`, `loseLife`), so it is migratable now with no
        // new engine code. (Canary: this asserts a specific still-resolve() card
        // lands in FREE; when it eventually migrates, swap for another
        // existing-Op-only card that has not yet been migrated.)
        expect(free).toMatch(/Night's Whisper/);
    });

    it("does NOT route an Op-blocked card (Millstone) to the FREE tranche", () => {
        // Millstone calls ctx.reorderLibraryTop / peekLibraryTop — blocked on the
        // unshipped `scryReorder` Op (a choice-driven reorder / mill construct),
        // so it belongs to that Op's cluster issue, not the free tranche.
        // (Canary swapped from Bottle of Suleiman, whose `coinFlip` Op shipped —
        // issue #851 — so it migrated to effects[] and is no longer a resolve()
        // closure the classifier counts.)
        expect(free).not.toMatch(/Millstone/);
    });
});
