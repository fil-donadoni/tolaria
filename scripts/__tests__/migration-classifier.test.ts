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
        expect(num(summary, /—\s+(\d+)\s+closures/)).toBe(685);
        expect(num(summary, /FREE \(migratable now\):\s+(\d+)/)).toBe(438);
        expect(num(summary, /of which AFK-ready:\s+(\d+)/)).toBe(401);
        expect(num(summary, /X-only blocked:\s+(\d+)/)).toBe(14);
        expect(num(summary, /Op-blocked:\s+(\d+)/)).toBe(233);
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

    it("routes an existing-Op-only card (Cuombajj Witches) to the FREE tranche", () => {
        // Cuombajj Witches' effect maps entirely onto existing Ops, so the
        // classifier routes it to FREE (migratable now, no new engine code).
        // (Canary: this asserts a specific still-resolve() card lands in FREE;
        // when it eventually migrates, swap for another existing-Op-only card
        // that has not yet been migrated. Swapped from Night's Whisper, whose
        // draw/loseLife closure migrated to the DSL `draw` Op in #1264.)
        expect(free).toMatch(/Cuombajj Witches/);
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
