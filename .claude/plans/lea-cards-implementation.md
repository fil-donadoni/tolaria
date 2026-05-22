# Analisi carte LEA non implementate

## Status snapshot (2026-05-12, post Wave 11 follow-up)

**Plan location**: `.claude/plans/lea-cards-implementation.md` (spostato da `~/.claude/plans/`).
**Carte attive in `lea.ts`**: 217 (Wave 11 + follow-up: spellBlast, animateArtifact, sacrifice).
**Carte ancora commentate**: 73 (era 76 post-Wave-10).
**Test totali**: 1051 passing (+9 per Wave 11 + follow-up: 3 spellBlast + 3 animateArtifact + 3 sacrifice).

Wave 8 chiusa: flat-upkeep pay-or-else pattern + 3 carte. Gap I del plan originale era misnamed: le carte LEA non hanno cumulative upkeep (introdotto Ice Age, post-LEA), ma flat-upkeep may-pay con consequence diversa.
Wave 7 chiusa: full gap U (replacement effect framework + 7 carte).
Wave 6 chiusa: resurrection, animateDead (gap H parziale — reanimation senza replacement framework U).
Wave 5 chiusa: basaltMonolith, manaVault, meekstone, smoke, stasis, paralyze (gap J).

### Feature implementate dopo l'analisi originale

- **B. Buff P/T temporaneo con duration** → `addTemporaryPTBuff(target, p, t, duration)` in `SpellContext`. Sblocca firebreathing, graniteGargoyle, dragonWhelp, shivanDragon, frozenShade, howlFromBeyond, wallOfWater, wallOfFire, holyArmor, stoneGiant.
- **A. Counter +1/+1 e generici** → `addCounter` / `removeCounter` / `getCounterCount` in `SpellContext` + integrazione layer 7d. Sblocca fungusaur, clockworkBeast, scavengingGhoul.
- **F. CREATURE_DIED globale** → evento `CREATURE_DIED` emesso da `removePermanentTo` per ogni death path. Sblocca soulNet, scavengingGhoul, creatureBond, sengirVampire.
- **D. SPELL_CAST trigger** → evento `SPELL_CAST` con types/subtypes/colors. Sblocca verduranEnchantress, sphere cycle (crystalRod / ironStar / ivoryCup / throneOfBone / woodenSphere).
- **C. Tap-for-mana trigger (parziale)** → evento `PERMANENT_TAPPED` con `forMana` + `manaProduced`. Sblocca manaFlare, manabarbs, lifetap, wildGrowth.
- **Q. Reach** → riconosciuta in `validateBlockerEligibility` accanto a flying.
- **Color filter su target spell** → `colorFilter` su `TargetRequirement` ora applicato anche a target su stack (validatore in `game.ts:1701-1714`).

### Wave 1 completata (2026-05-10) — 11 carte uncomment

- Aura activated pump: `firebreathing`, `holyArmor` (+passive +0/+2)
- Aura keyword-grant `reach`: `web` (+0/+2 + reach), `giantSpider` (vanilla reach)
- Aura tap-of-host: `psychicVenom` (PERMANENT_TAPPED → 2 dmg controller)
- Aura upkeep may-pay/decline: `powerLeak`
- Sacrifice-counter color-filtered: `lifeforce` (vs B), `deathgrip` (vs G)
- Activated destroy color-filtered: `northernPaladin` (vs B)
- Composite upkeep+sweep: `pestilence`
- Upkeep ping per untapped land: `powerSurge`

24 nuovi test, 6 preset scenarios. `bun run check:all` + `bun run test` verdi.

### Wave 11 follow-up — type-add + additional-cost frameworks, gap V chiuso — DONE (2026-05-12)

Wave 11 originale aveva deferred animateArtifact + sacrifice citando "no partial implementations" — user pushback. Completati nel follow-up.

**Type-add static effect (layer 4 surrogate, CR 205)**:

- Nuovo `StaticTypeAdd { kind: "type-add"; applies; types: CardType[] }` in `cards/types.ts`.
- Aggiunto a `StaticEffect` union.
- `CardInstanceState.grantedTypes?: { type, auraId }[]` (gre/state.ts) per tracker per-origine.
- Engine: `applySourceStaticEffects` push types a `target.types` se non già presenti, registra origine. `unapplySourceStaticEffects` rimuove origini matching e fa il pop dai `types[]` solo se nessun'altra origine rimanente E il type non era printed. `applyExistingGrantsTo` mirror for incoming permanents.
- Serialize: `grantedTypes` persisted su compactCard/expandCard.
- Limitazione documentata: il predicate `applies` viene letto al apply-time, non continuamente. Sufficiente per LEA scope (nessuna carta revoca un type-add mid-life).

**pt-cda compute signature**:

- `StaticPTCDA.compute` ora riceve `target` come 4° parametro. Nightmare/Bog Wraith continuano a funzionare (self-targeting, target === source). Animate Artifact può ora computare dal target (host) via target.

**StaticEffectContext.getCmc(card)**:

- Nuovo helper sul context — evita import cycles tra `cards/sets/lea.ts` e `..` perché passa attraverso il context già esposto. Riusa `tryGetCardById` server-side. Numerico X incluso (codebase encoding di generic cost come `X: number`).

**Carta animateArtifact** ({3}{U} Aura on Artifact):

- `type-add: Creature` quando l'host non è già Creature.
- `pt-cda`: P/T = host's mana value via `ctx.getCmc(target)`.

**Additional-cost framework (CR 117.9 / 601.2f)**:

- `CardDefinition.additionalCosts?: { sacrificeFilter: PermanentFilter }` (cards/types.ts).
- `PendingCast.additionalCost?: { kind: "sacrifice"; filter; pickedId? }` (gre/state.ts).
- `StackItem.additionalSacrificeSnapshot?: { cardInstanceId; cmc }`.
- `SpellContext.getAdditionalSacrificeCmc(): number | undefined`.
- `announceCast` mutation: validate ≥1 matching permanent at cast (else throw "no legal additional cost"), apri pendingCast in additional-cost picker stage (no auto-commit fino al pick).
- Nuova mutation `selectAdditionalCost(gameId, playerId, cardInstanceId)`: validates against filter + zone owner = caster's battlefield, sets `pickedId`, attempts auto-commit.
- `tryAutoCommitPendingCast`: gate su `additionalCost.pickedId` set; sacrifice della selected permanent + snapshot CMC su stack item al commit.
- Serialize: `additionalSacrificeSnapshot` persisted su stack item.
- UI: `player-battlefield.tsx` route clicks via `isPickingAdditionalCost` → `selectAdditionalCost` mutation.

**Carta sacrifice** ({B} Instant):

- `additionalCosts.sacrificeFilter: { types: "Creature" }`.
- resolve: `ctx.addMana({ B: ctx.getAdditionalSacrificeCmc() })`.

Test aggiunti: 6 (3 animateArtifact: type-add base + skip-if-already-creature + wire-format projection; 3 sacrifice: resolve adds B = snapshot cmc + duplicate of getAdditionalSacrificeCmc + metadata snapshot). 1045 → 1051 passing.

Preset scenarios aggiunti:

- "Additional cost — Sacrifice ({B} instant, sac creature for B mana = CMC)".
- "Layer 4 type-add — Animate Artifact + Mana Vault".

Bug fix collaterale: `StaticEffectContext.getCmc` initially excluded numeric X — corretto al pattern del codebase (X numerico = generic cost, X string = variable cost).

`bun run check:all` + `bun run test` verdi.

### Wave 11 — gap V parziale: CMC lookup + cmcFilter framework — DONE (2026-05-12)

Plan listava 3 carte gap V: animateArtifact, sacrifice, spellBlast. Reality check:

- `animateArtifact` ({3}{U} Aura): richiede layer 4 type-add (gap O — non chiuso). Deferred.
- `sacrifice` ({B} Instant): "additional cost: sacrifice a creature" + add B mana = creature CMC. Richiede framework "additional cost" CR 117.9 / 601.2f (pick creature al cast time, validate ≥1 available, pay before stack push). Non esiste oggi. Deferred per scope (alternativa "pick a resolve" è semanticamente sbagliata vs CR — niente fizzle se nessun bersaglio).
- `spellBlast` ({X}{U} Instant): contained — sblocca via `cmcFilter`.

Wave 11 scope contained: solo spellBlast + framework cmc.

**Framework**:

- Nuovo metodo `SpellContext.getCmc(target: TargetSelection): number` in `convex/gre/state.ts`. Per permanent target restituisce printed CMC (X = 0 per X-cost permanents — limitazione documentata: chosen X non persisted su CardInstanceState dopo finalize). Per spell target sulla stack folda chosenX. Per player / graveyard-card / unknown → 0.
- Nuovo opt `cmcFilter` su `TargetRequirement` (`convex/cards/types.ts`): `{ min?, max?, equals?: number | "X" }`. "X" risolve all'announcement contro chosenX. Documentato uso per spellBlast.
- Nuovo opt `cmcFilter` su `PendingTarget` (`gre/state.ts`) con bound numerici (post-resoluzione).
- Helper esportati in `convex/gre/rules.ts`:
    - `resolveCmcFilter(filter, chosenX)`: risolve placeholders "X" → numeric.
    - `matchesCmcFilter(filter, cmc)`: testa numeric cmc contro bounds.
- `getLegalTargets` accetta nuovo param opzionale `chosenX` per filtrare a tempo di announce.
- selectTarget mutation: validazione cmcFilter su permanent (target.subtypeFilter site) e su spell branch.
- announceCast + activateAbility (target-req path): propagano resolveCmcFilter(cmcFilter, chosenX) verso PendingTarget.

**Carta**:

- `spellBlast` ({X}{U} Instant): `targetRequirement: { type: "spell", count: 1, cmcFilter: { equals: "X" } }`. Resolve: counter target spell se ancora sulla stack.

Test aggiunti: 3 (counter target di cmc=X = 1, counter Braingeyser con chosenX=4 via Spell Blast X=6, metadata snapshot cmcFilter shape). 1042 → 1045 passing.

Preset scenario: "CMC-target — Spell Blast (counter spell with cmc = X)" con Spell Blast + Bolt + Braingeyser in mano + 8 Island + 2 Mountain per esercitare valid X=1 e cross-validation con Braingeyser variabile.

Limitazioni documentate:

- X-cost permanents su battlefield non persistono chosenX → CMC reads printed (X = 0). Affligge solo cards modello sacrifice creature for value (non in scope LEA attuale).
- `sacrifice` deferred fino ad additional-cost framework.
- `animateArtifact` deferred fino a gap O (layer 4 type-add).

`bun run check:all` + `bun run test` verdi.

### Wave 10 — gap N residuo: blessing + instillEnergy + activation-timing framework — DONE (2026-05-12)

Gap N framework (StaticActivatedGrant + grantTemplates) già esisteva e usato da wildGrowth + zombieMaster. Residue carte LEA:

- `blessing` ({W}{W} Aura on Creature) — pattern activated-on-aura: `{W}: host +1/+1 EOT`. Niente nuovo framework. Riusa addTemporaryPTBuff. Mirror di holyArmor's pump.
- `instillEnergy` ({G} Aura on Creature) — pseudo-haste (keyword-grant "haste" via aura su host) + `{0}: untap host` con due restrizioni novel: "activate only during your turn" + "only once each turn". Implementazione richiede nuovo activation-timing framework.

**Activation-timing framework (CR 602.5b)**:

- Nuovi opt flag su `ActivatedAbility`:
    - `controllerTurnOnly?: boolean` — activate solo se `state.activePlayerId === card.controllerId`.
    - `oncePerTurn?: boolean` — limit 1 activation per turn per source instance.
- Nuovo tracking su `CardInstanceState`: `activationsThisTurn?: Record<abilityId, number>`. Incremento ad ogni activation commit. Reset al turn-start (in `startNextTurn` phases.ts).
- Helpers in `game.ts`: `assertActivationTimingLegal(state, card, ability)` (lancia se viola) + `recordActivation(card, abilityId)` (incrementa counter).
- Wired in 3 commit path: `activateAbility` mutation con target + senza target, `tryAutoCommitPendingActivation` (deferred mana payment), `finalizeTargetSelection` ability branch.
- Validation chiamata in 2 entry point: prima del cost lock in `finalizeTargetSelection` ability branch e in `activateAbility` no-target path.
- Serialize: `activationsThisTurn` persisted su compactCard/expandCard.

Test aggiunti: 4 (1 blessing pump host P/T effective + 2 instillEnergy haste-keyword propagation + activated-untap + 1 metadata snapshot su controllerTurnOnly+oncePerTurn). 1038 → 1042 passing.

Preset scenario: "Activation timing (CR 602.5) — Instill Energy + Blessing" con grizzlyBears + entrambe le aure in hand + 2 Forest + 2 Plains per esercitare il pump multi-attivazione (Blessing infinito) e l'untap once-per-turn restricted (Instill Energy bloccato dopo 1 attivazione e durante opp turn).

Limitazione documentata: pseudo-haste di Instill Energy modellato come keyword `haste` puro (granted via static-keyword-grant). Differenza vs printed: pseudo-haste vero permette solo attacking (non activated abilities con tap cost). Per il modello binary di summoning-sickness dell'engine, accettabile.

`bun run check:all` + `bun run test` verdi.

### Wave 9 — gap G: modal spell framework (CR 700.2) + 3 carte — DONE (2026-05-11)

Framework modal a livello CardDefinition: nuovo campo `modes?: SpellMode[]`. Ogni `SpellMode` ha `id`, `label`, `oracleText`, `targetRequirement?`, `resolve`. La caster sceglie esattamente un mode all'announcement (CR 700.2c). Mode locked-in via nuovo `chosenModeId` su `PendingCast`, `PendingTarget` e `StackItem` (propagato through l'intero flow announce → target → pay → stack).

Engine changes:

- `announceCast` mutation accetta `chosenModeId?: string`. Valida che sia richiesto iff `card.modes` è set (CR 700.2c). Lookup del mode, fallback alla `targetRequirement` del mode (CR 700.2d). Propagato nelle pendingTarget / pendingCast / stack item.
- `finalizeTargetSelection` propaga `chosenModeId` ricevuto da pendingTarget verso pendingCast / stack item.
- `commitPendingCast` (mana pool sufficient) propaga `chosenModeId` su stack item finale.
- `resolveTopOfStackInner`: branch dedicato per spell modal — dispatch su `cardDef.modes.find(m => m.id === top.chosenModeId)?.resolve(ctx)` invece di `resolveFn`. Fallback al path non-modal se chosenModeId mancante.

UI: nuovo componente `src/components/cards/mode-picker.tsx` (popover dropdown in stile ManaChoicePicker). In `selectable-card.tsx` `onCastClick`, dopo `chosenX` prompt, se `def.modes` set apre il picker; la selezione chiude il picker e chiama `commitAnnounceCast` con `chosenModeId`. Cancel dismissa il picker senza announcement.

Carte uncomment:

- `healingSalve` ({W} Instant): mode "gain-life" → target player +3 life; mode "prevent" → `preventNextNDamageToTarget(target, 3, end-of-turn)` (gap K primitive).
- `blueElementalBlast` ({U} Instant): mode "counter" → counter target red spell (colorFilter R); mode "destroy" → destroy target red permanent.
- `redElementalBlast` ({R} Instant): mirror di BEB su blue. Estratto helper `makeElementalBlast({id, name, oracleColor, castColor, targetColor})` che builda entrambi i mode + cost dal pattern condiviso.

Test aggiunti: 5 (2 healingSalve full path: gain-life + prevent shield absorb; 1 BEB counter; 1 REB destroy; 1 metadata snapshot su modes shape). 1033 → 1038 passing.

Preset scenario aggiunto: "Modal spells (CR 700.2) — Healing Salve / Blue & Red Elemental Blast" con tutte 3 in mano + Bolt + Shivan Dragon / Merfolk in opp battlefield + 6 mixed land per esercitare ogni mode.

`bun run check:all` + `bun run test` verdi.

### Wave 8 — gap I rinominato: flat-upkeep pay-or-else pattern — DONE (2026-05-11)

Gap I del plan originale era etichettato "cumulative upkeep" ma le carte LEA hanno il pattern flat: "at the beginning of your upkeep, do X unless you pay Y" (no age counter, costo costante). Cumulative upkeep (CR 702.23) è meccanica di Ice Age, post-LEA.

Helper estratto `makeUpkeepPayOrElse({ id, oracleText, cost, prompt, onDecline })` in `lea.ts` — restituisce un `TriggeredAbility` PHASE_BEGIN UPKEEP keyed sul controller, esegue requestMayPay e su decline chiama `onDecline(ctx)`. Riusabile da future carte con stesso pattern (post-LEA cards che NON sono cumulative upkeep).

Carte uncomment:

- `phantasmalForces` ({3}{U} 4/1 Illusion flying) — onDecline = `ctx.sacrifice(self)`.
- `forceOfNature` ({2}{G}{G}{G}{G} 8/8 Elemental trample) — onDecline = `ctx.dealDamage({type:"player", id:controller}, 8)`.
- `wanderlust` ({1}{G}{G} Aura) — non usa helper (no upkeep cost, solo trigger upkeep → 1 dmg al controller dell'host). Pattern condiviso con farmstead (aura upkeep trigger keyed sul controller dell'host).

Estensione `PendingChoice.zoneOwnerId?: string` (gre/state.ts) + `requestChoice.zoneOwnerId?` (cards/types.ts) per choice cross-player (chooser != zone owner). Default: zone owner = chooser. `selectResolutionChoice` mutation usa `zoneOwnerId ?? args.playerId` per lookup nella zone. UI routing in `player-battlefield.tsx`: la battlefield del display player riceve i click se `viewer == activeChoice.playerId && (activeChoice.zoneOwnerId ?? activeChoice.playerId) == player.id`. Nuovo invariante: il `playerId` della PendingChoice è SEMPRE chi clicca; `zoneOwnerId` è chi possiede gli items.

`demonicHordes` ({3}{B}{B} 5/5 Demon) implementata sfruttando il framework cross-player:

- Activated `{T}: destroy target land`.
- Upkeep trigger: requestMayPay({B}{B}{B}) sul controller; decline → `tap(self)` + requestChoice con `playerId: opp`, `zoneOwnerId: controller`, `kind: "sacrifice-permanents"`, `filter: { types: "Land" }`, `count: 1`. Pick → `ctx.sacrifice(id)`.

Test aggiunti: 10 (2 phantasmalForces + 3 forceOfNature including trample assertion + 2 wanderlust including non-trigger su opp upkeep + 3 demonicHordes: opp prompt enqueued, opp pick → controller's swamp sacrificed, activated destroy-land). 1023 → 1033 passing.

Preset scenarios aggiunti:

- "Upkeep pay-or-else — Phantasmal Forces / Force of Nature / Wanderlust (CR 603.6a, 117.3a)".
- "Cross-player choice — Demonic Hordes (opp picks your land to sacrifice)" per esercitare il cross-player choice routing UI in solo mode.

`bun run check:all` + `bun run test` verdi.

### Wave 7 — full gap U (replacement effect framework + 7 carte) — DONE (2026-05-11)

Framework CR 614 / 616 implementato in `convex/gre/replacements.ts`. Apply order ad ogni site di damage / life-change / discard / lose-game:

1. CR 614 replacement loop (questo modulo) — può rewriteare target/amount o cancellare.
2. CR 615 prevention (preventionEffects / targetPreventionShields esistenti).
3. CR 702.16 protection.
4. Application del payload finale.

Loop bound: 64 iterazioni, CR 616.1d (`(sourceInstanceId|effectId)` once-per-event), APNAP order deterministico.

Tipi di replacement (in `convex/cards/types.ts`):

- `ReplacementEventKind` = `"damage" | "lifegain" | "lifeloss" | "discard" | "lose-game"`
- `DamageReplacementEvent`, `LifeChangeReplacementEvent`, `DiscardReplacementEvent`, `LoseGameReplacementEvent`
- `ReplacementEffect` (declarable su `CardDefinition.replacementEffects[]`)
- `ReplacementApplyContext` con mutators: `drawCards`, `autoSacrifice`, `moveHandCardToLibraryTop`, `adjustLifeRaw`, `apNapOrder`, `revealHandCard`

Transient one-shot shields per spell / activated abilities (`state.damageRedirections`), tre kind:

- `prevent-from-source-gain-life` — Reverse Damage
- `to-self-redirect-to-owner` — (riservato per modern Personal Incarnation activated, non usato dalla versione LEA continuous)
- `from-source-to-permanent-redirect-to-player` — Jade Monolith (sourceInstanceId opzionale = wildcard)

Hook points:

- `SpellContext.dealDamage` + `applyOneCombatDamage` in `phases.ts` → `runDamageReplacement(state, source, src-controller, target, amount, isCombat)` (continuous + transient).
- `SpellContext.gainLife` / `loseLife` → `applyLifeChangeReplacements`.
- `SpellContext.discardCard` / `discardAtRandom` → `applyDiscardReplacements`.
- `checkGameOverSBA` → `applyLoseGameReplacements` per "life-zero" reason.

Eventi nuovi:

- `PERMANENT_ENTERED` (CR 603.6) emesso da `finalizeSpellResolution` + `putReanimatedOnBattlefield`. Mirroring di `PERMANENT_LEFT`. Trigger via collectTriggers standard.
- `PermanentLeftEvent.ownerId` aggiunto (snapshot owner per LTB-trigger come Personal Incarnation).

Tracking nuovo:

- `state.damageDealtToPlayerThisTurn?: Record<playerId, number>` — incrementato dopo ogni damage che arriva al player. Read da Simulacrum. Reset turn start.

Nuovi SpellContext primitives:

- `addDamageRedirectionShield(shield)` — push shield in `state.damageRedirections`. Tre kind discriminator.
- `loseGame(playerId)` — forza state.gameOver bypassando lose-game replacement (per Lich LTB-trigger).
- `getDamageDealtThisTurn(playerId)` — read del tally.
- `returnToBattlefield` già esistente da Wave 6.

Carte uncomment:

- `personalIncarnation` ({4}{W}{W}{W} 6/6) — replacementEffect damage redirect to self quando target.id === self.ownerId. + dies-trigger PERMANENT_LEFT toZone=graveyard → owner loses ceil(life/2).
- `veteranBodyguard` ({3}{W}{W} 2/4) — replacementEffect damage redirect gated su self.isTapped===false + source must be unblocked-attacking-creature (lookup `ReplacementStateView.combat`).
- `lich` ({2}{B}{B} Enchantment) — ETB trigger (lose life equal to current via PERMANENT_ENTERED), damage trigger (sacrifice N nontoken or loseGame), LTB trigger (loseGame), replacementEffects: lose-game don't-lose + lifegain → drawCards.
- `simulacrum` ({X}{B} Instant) — read getDamageDealtThisTurn(caster), gain life + deal damage to target creature.
- `reverseDamage` ({2}{W} Instant) — push prevent-from-source-gain-life shield, caster, EOT.
- `jadeMonolith` ({4} Artifact, {1} activated) — target creature, push from-source-to-permanent-redirect-to-player shield, sourceInstanceId undefined (any source), remaining 1, EOT, redirectToPlayer = controller.
- `libraryOfLeng` ({1} Artifact) — replacementEffect discard kind, auto-accept "may" e move to library top via moveHandCardToLibraryTop.

Limitazioni risolte (commit follow-up post-Wave 7):

- **Simulacrum target controller filter** → fix: estesa `controller: "you" | "opponent"` filter su battlefield targets in `getLegalTargets` (rules.ts). Carta ora ha `targetRequirement.controller: "you"`.
- **Reverse Damage stack-item source** → fix: `targetRequirement.type: ["any", "spell"]` accetta sia permanenti sia stack items come source.
- **Lich sacrifice choice player-driven** → fix: la damage-trigger resolve usa `requestChoice` con `kind: "keep-permanents"` (filter `isToken: false, excludeInstanceIds: [self]`). Player sceglie quali permanenti tenere; il resto viene sacrificato. Estensione `PermanentFilter` con `isToken` + `excludeInstanceIds`.
- **Library of Leng "may"** → fix: opt-out via `state.playerPreferences[playerId].libraryOfLengRouting: "graveyard"`. Default routes alla libreria (Library of Leng accetta); il player può togglare lo stato direttamente o tramite futura UI mutation. Preservato per replay.
- **Jade Monolith multi-target** → fix: activated ability target la creatura, poi durante resolve `requestChoice` chiede al player quale source bindare nella shield. Source id baked in shield (`sourceInstanceId` ora richiesto, non wildcard).

Limitazioni residue: nessuna. Tutte le UX semantic-mismatch risolte nel refactor pending-choice kinds.

### Refactor pending-choice taxonomy (post-Wave 7, 2026-05-11)

Problema: `PendingChoice["kind"]` union cresceva ad ogni nuovo card semantic + UI ternary chain fragile. Ogni nuova carta che chiede una scelta forzava un'aggiunta in due posti (state.ts + UI label match).

Refactor:

- Taxonomy di famiglie in `convex/gre/types.ts`: `ZonePickKind` (zone-pick: `keep-permanents`, `sacrifice-permanents`, `keep-hand`, `search-library`, `pick-source`), `YesNoChoiceKind` (`may-pay`), `OrderChoiceKind` (`mulligan-bottom`), `PendingChoiceKind` union. Lives in `gre/types.ts` per evitare cycle con `cards/types.ts`.
- `PendingChoice.kind: PendingChoiceKind` (state.ts) e `SpellContext.requestChoice.kind: ZonePickKind` (cards/types.ts) condividono la stessa source-of-truth.
- Nuovo kind `sacrifice-permanents` rimpiazza il pattern "keep N inverso" di Lich (count diretto = N da sacrificare, no inversione mentale).
- Nuovo kind `pick-source` rimpiazza il "keep-permanents" forzato di Jade Monolith.
- Registry UI labels esaustiva in `src/lib/pending-choice-labels.ts`: `Record<PendingChoiceKind, string>` — TS catch errore di compilazione se manca una label. Replace della catena ternary 6-deep in `pending-choice-prompt.tsx` con un singolo lookup.

Estensioni future: aggiungere un nuovo kind a una famiglia esistente = 1 entry nella union + 1 entry nella label registry. Nuova famiglia = nuova mutation submission path + nuovo branch in `assertNoPendingChoices` (raro).

Test aggiunti totale Wave 7: 17 nuovi (12 originali + 2 path-update Lich choice + 1 Jade Monolith kind assertion + 2 new Lich/LibraryOfLeng dopo limit-fix). 1006 → 1023 passing.

`bun run check:all` + `bun run test` verdi.

### Wave 6 — gap H parziale (reanimation graveyard → battlefield) — DONE (2026-05-11)

Nuova primitiva `SpellContext.returnToBattlefield(playerId, cardInstanceId, fromZone)` per riportare una carta da graveyard o exile al battlefield del player indicato. Mirrors la branch "non-Aura permanent" di `finalizeSpellResolution`:

- Splicia la carta da `playerId.graveyard` o `playerId.exile`.
- `resetBattlefieldTransientState` per pulire residui (tap, danno, granted abilities, controlChanges, counters, temporaryPTMods).
- Setta `zone=battlefield`, `controllerId=playerId`, `isSummoningSick=true` se Creature (CR 302.1).
- `applyExistingGrantsTo` per pickup di lord-grants già in play (Goblin King-style).
- `applySourceStaticEffects` per push-out dei propri keyword-grant.
- Helper interno `putReanimatedOnBattlefield` riusato anche dalla branch aura (vedi sotto).

Estensione `finalizeSpellResolution` per aure che targettano graveyard-card (CR 303.4i): se `target.type === "graveyard-card"`, la creature viene reanimata sotto `castById` via `putReanimatedOnBattlefield`, poi l'aura si attacca normalmente. Fallback fizzle se la carta non è più nella graveyard dichiarata al momento del cast (CR 608.2b).

Nuovo evento `PERMANENT_LEFT` emesso da `removePermanentTo` per ogni leave path (destroy, exile, sacrifice, return-to-hand, ecc.). Payload con last-known-info (CR 603.10): `instanceId`, `controllerId`, `cardId`, `types`, `wasAura`, `attachedToBeforeLeave`, `toZone`. `collectTriggers` esteso con `recentlyLeft` map (`instanceId → toZone`) che scansiona la zona di destinazione per ritrovare il source che ha appena lasciato, mirroring del pattern `recentlyDead`/CREATURE_DIED.

Carte uncomment:

- `resurrection` ({2}{W} sorcery, target creature card in your graveyard, `returnToBattlefield`).
- `animateDead` ({1}{B} aura, target creature card in any graveyard, `staticEffect` pt-buff -1/0 via `AURA_AFFECTS_HOST`, triggeredAbility on `PERMANENT_LEFT` self → `ctx.sacrifice(event.attachedToBeforeLeave)` per il LTB-trigger "controller sacrifices it" (CR 603.10).

Test aggiunti: 9 nuovi (4 resurrection + 5 animateDead) in `lea.test.ts`. 997 → 1006 passing. 1 nuovo preset scenario "Reanimation — Resurrection / Animate Dead" con Sengir Vampire in my graveyard + Shivan Dragon in opp graveyard come target dimostrativi.

Wire format test mandatory per animateDead pt-buff: `getEffectivePower(projected, slimRevived).toBe(1)` su `grizzlyBears` reanimato (2-1=1) post `projectPublicState`. Verde.

Decisione di scope: gap U (replacement effect framework completo) **non incluso** in Wave 6. Il LTB-trigger di animateDead è modellato come triggeredAbility normale (CR 603) — è quello che il moderno Oracle text fa. Gap U separato copre: simulacrum, reverseDamage, lich, jadeMonolith, libraryOfLeng, personalIncarnation, veteranBodyguard (7 carte) — tutte richiedono il replacement layer (CR 614) vero.

### Wave 5 — gap J (skip/restrict untap step) — DONE (2026-05-11)

Esteso `untapStep` in `convex/gre/phases.ts` con 4 nuovi marker globali/per-permanent oltre al pre-esistente `limits-acl-untap`:

| Keyword                                         | Card                                                             | Significato                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `does-not-untap` (per-permanent)                | basaltMonolith, manaVault, paralyze (aura keyword-grant al host) | il permanente skippa l'untap del proprio controller              |
| `skip-untap-step` (global)                      | stasis                                                           | tutto il loop UNTAP è no-op per active player                    |
| `limits-creature-untap-to-one` (global)         | smoke                                                            | solo prima creature tappata untap; altre restano tap             |
| `prevents-untap-of-power-3-or-greater` (global) | meekstone                                                        | creature con effective power ≥3 (layer 7c read live) restano tap |

Carte uncomment: `basaltMonolith` ({3}: untap activated stack ability + {T}: {C}{C}{C} mana ability), `manaVault` (+ upkeep may-pay {4} → untap + draw-step intervening-if damage 1 to controller se tapped), `meekstone`, `smoke`, `stasis` (+ upkeep sacrifice-unless-{U} pattern à la Pestilence), `paralyze` (aura: ETB-tap via `resolve()` su spell prima del finalize attach + keyword-grant AURA_AFFECTS_HOST does-not-untap + upkeep may-pay {4} sul host controller).

Decisione di scope: PERMANENT_ENTERED event NON aggiunto. L'ETB-tap di Paralyze è eseguito nel `resolve()` della spell (vista come single-shot pre-attach in `finalizeSpellResolution`), pattern già praticabile senza nuovi eventi. Note alle altre aure ETB-trigger: si può estendere a un evento dedicato quando arriverà la prossima carta che lo richiede (gap F adiacente — `CREATURE_DIED` global già esiste, ma `PERMANENT_ENTERED` no).

Test aggiunti: 26 nuovi (1-5 per carta) in `lea.test.ts` con helper condiviso `runUntapForJ`. 957 → 983 passing. 1 nuovo preset scenario "Skip / restrict untap step — Basalt Monolith / Mana Vault / Meekstone / Smoke / Stasis / Paralyze (CR 502.1)" con setup tappato per esercitare i quattro pattern keyword + Paralyze in hand su Sengir Vampire avversario.

Note feature-gap residue dopo Wave 5: `timeVault` ancora bloccato (gap AG — skip-turn + extra turn).

**Fix UI follow-up (2026-05-11)**:

1. **Keyword display map** (`src/lib/card-utils.ts:capitalizeKeyword`): i marker interni di `staticAbilities` (slug come `prevents-untap-of-power-3-or-greater`, `does-not-untap`, `skip-untap-step`, `limits-creature-untap-to-one`, `limits-acl-untap`, `cant-attack-unless-defender-controls-Island`, `cant-be-blocked-by-wall`, `cant-block-power-2-or-greater`, `attacks-if-able`) ora consultano un `KEYWORD_DISPLAY` map che traduce ogni marker nella Oracle line corrispondente. Cards reali (flying/trample/first strike/…) restano invariate.

2. **Oracle display per Aura** (`src/components/cards/card-preview.tsx`): `showOracleText` ora include `isAura` (subtype check), e `hasBody` viene soppresso quando `showOracleText` è true. Risolve il display parziale per aure con `staticEffects` (grant su host) combinato a `triggeredAbilities`/`activatedAbilities` — la printed oracle text copre tutte le clausole (statiche + attivate + trigger) ed evita la doppia renderizzazione. Sblocca paralyze + tutte le altre aure con structured (holyArmor, controlMagic, circleOfProtection\*, etc.).

### Wave 4 — gap Y (token creation) — DONE (2026-05-10)

Nuova primitiva `SpellContext.createToken(spec, controllerId, count?)` con type `TokenSpec` ({ name, types, subtypes?, supertypes?, power?, toughness?, colors?, staticAbilities? }).

Token model:

- `CardInstanceState.isToken?: boolean` flag
- Token genera CardDefinition sintetica registrata via `registerTokenDefinition` (in `convex/cards/index.ts`); id stabile content-derived (`token:Wasp|Artifact,Creature|Insect|...`). Specs uguali → stessa def riusata.
- Colori encodati come `manaCost` sintetico così `hasColor`/projection trattano token come carte stampate.
- Token ETB summoning-sick se Creature; carica lord-grants esistenti via `applyExistingGrantsTo`.

Nuova SBA `checkTokenExistenceSBA` (CR 704.5d): scansiona graveyard/exile/hand/library di ogni player, splicia via i token. Aggiunta in pipeline `checkStateBasedActions`.

Carte uncomment: `theHive` ({5}, {T}: crea Wasp 1/1 flying Insect Artifact Creature).

Wire format compatibile: token ha `card.id = "token:Wasp|..."`, frontend `getCardById` risolve via registry sintetico.

Test: 4 nuovi (theHive resolve, deduplicazione def, cease-to-exist 704.5d, projection). 930 → 934 passing. 1 nuovo preset scenario "The Hive — {5}, {T}: create a 1/1 flying Wasp token" con Giant Spider opp per dimostrare reach blocca flying token.

### Wave 3 — gap K (prevent-to-target) — DONE (2026-05-10)

Nuova primitiva `SpellContext.preventNextNDamageToTarget(target, amount, duration)`. Mirror parallelo a `preventNextDamageFromSource` ma TARGET-keyed e source-agnostic.

Storage: `GameState.targetPreventionShields?: TargetPreventionShield[]` con `{ targetType, targetId, remaining, duration }`. Helper `applyTargetPrevention(state, targetType, targetId, amount): number` ritorna danno residuo dopo assorbimento; consumato in declaration order, entry purgate a 0.

Hook in 5 damage sites:

- `SpellContext.dealDamage` (player + permanent branches) in `state.ts`
- Combat unblocked → defender (`phases.ts:354`)
- Combat trample → defender (`phases.ts:380`)
- Combat attacker → blocker (`phases.ts:407`)
- Combat blocker → attacker (`phases.ts:435`)

Tick block aggiunto in `tickAllDurations` accanto a `preventionEffects`.

Carte uncomment: `samiteHealer` ({T}: prevent next 1 to any target), `conservator` ({3}, {T}: prevent next 2 to you).

Test: 8 nuovi (5 samiteHealer + 3 conservator) in `lea.test.ts`. 922 → 930 passing. 1 nuovo preset scenario "Damage prevention shields — Samite Healer / Conservator".

Note: `healingSalve` (richiede modal — gap G), `guardianAngel` (divided variant), `jadeMonolith` (redirect — gap U) ancora bloccate.

### Wave 2 — gap L (block restrictions custom) — DONE (2026-05-10)

Esteso `validateBlockerEligibility` con 4 keyword + nuovo `powerFilter` su `TargetRequirement`:

| Keyword                          | Card                                                   | Significato                                              |
| -------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `cant-be-blocked-except-by-wall` | invisibility (aura grant)                              | blocker deve avere subtype `Wall`                        |
| `fear`                           | fear (aura grant)                                      | blocker deve essere `Black` o `Artifact`                 |
| `cant-block-power-2-or-greater`  | ironclawOrcs (self)                                    | blocker non può bloccare se attacker effective power ≥ 2 |
| `unblockable`                    | dwarvenWarriors (activated grant EOT, target ≤2 power) | nessun blocker legale                                    |

Anche aggiunta primitiva `TargetRequirement.powerFilter: { min?, max? }` propagata in `PendingTarget` e validata da `getLegalTargets` + cast/ability target validator. Reusable per future carte tipo "target creature with power 4+".

`validateBlockerEligibility` ora accetta `state?: GameState` opzionale per leggere `getEffectivePower(state, attacker)` (CR 613 layer 7c). Callers in `game.ts` e `phases.ts` aggiornati. Backward-compatible (fallback a `attacker.power ?? 0`).

Test aggiunti: 4 describe in `combat.test.ts` (validator-level) + 4 describe in `lea.test.ts` (carte). 900 → 922 passing. 1 nuovo preset scenario "Block restrictions — Invisibility / Fear / Ironclaw / Dwarven Warriors".

### Stato gap residui

Ancora aperti (senza ordine): O parziale (type/text-changing — layer 4 type-add chiuso via `StaticTypeAdd`; layer 5 subtype-change + layer 3 text-change ancora aperti per purelace cycle + magicalHack + sleightOfMind + evilPresence + phantasmalTerrain + conversion + livingLands + kormusBell), R (counter-spell varianti — partial), P (banding), AE (look at hand/library), AF (discard chosen), S (forced attack/block), W (copy permanent), X (cost modifier), AC (trigger choice), AD (multi-blocker), AG (skip turn — sblocca timeVault), AH (activation phase + state), AI (activation count tracking ≥4 → side-effect — dragonWhelp), AJ (mana output by land type), AK (cost-aware mana), AL (pt-buff state lookup), AM (mass damage prevention), AN (aura on land/artifact custom), AP (mandatory sacrifice), AB (control-mind / forced ability).

Chiusi: B (P/T temporaneo), A (counter +1/+1), F (CREATURE_DIED), D (SPELL_CAST), C (tap-for-mana, partial), Q (reach), color-filter target, K (prevent-to-target), L (block restrictions), Y (token creation), J (skip/restrict untap step), H (reanimation graveyard → battlefield + PERMANENT_LEFT event), U (replacement effect framework — CR 614/616 + PERMANENT_ENTERED event + 7 carte), I (flat-upkeep pay-or-else 4 carte LEA inclusa demonicHordes via cross-player choice framework — `PendingChoice.zoneOwnerId`), G (modal spell CR 700.2 — `CardDefinition.modes` + chosenModeId propagation + UI mode picker, 3 carte LEA), N (StaticActivatedGrant + grantTemplates esistente già + blessing/instillEnergy + activation-timing framework — `controllerTurnOnly` + `oncePerTurn` su ActivatedAbility, `activationsThisTurn` tracking su CardInstanceState), V (CMC lookup `getCmc` + `cmcFilter` su TargetRequirement/PendingTarget + StaticEffectContext.getCmc — sblocca spellBlast + animateArtifact + sacrifice), additional-cost framework (CR 117.9 — `CardDefinition.additionalCosts` + `PendingCast.additionalCost` + `selectAdditionalCost` mutation + `StackItem.additionalSacrificeSnapshot` + UI routing in player-battlefield).

---

## Context

`convex/cards/sets/lea.ts` contiene ~111 `CardDefinition` attive e ~130 stub commentati (UUID + nome + costo + type line, senza implementazione). Obiettivo: classificare ogni stub in:

1. **Implementabile gratis** — solo primitive già disponibili in `SpellContext` / `StaticEffect` / `TriggeredAbility`.
2. **Richiede feature nuova/estesa** — quale primitivo o evento manca.
3. **Escluse** — ante (CR 407) e azioni fisiche (CR 100.6).

L'inventario primitive di riferimento è in `convex/cards/types.ts` (linee 195–436 SpellContext, 495–576 StaticEffect, 583–681 trigger). Niente codice da scrivere ora — solo report.

---

## Escluse (4 carte)

| Carta               | Motivo                           | Linea |
| ------------------- | -------------------------------- | ----- |
| `chaosOrb`          | Azione fisica (lancio del token) | 2714  |
| `contractFromBelow` | Ante                             | 1169  |
| `darkpact`          | Ante                             | 1194  |
| `demonicAttorney`   | Ante                             | 1215  |

---

## Specchietto 1 — Implementabili gratis (38 carte)

Solo primitive esistenti. `pt-buff` con `applies`, `pt-cda`, `keyword-grant` (aura o lord), `PHASE_BEGIN` trigger, `destroyAll`/`destroy` con filtri attuali, `applyRegenerationShield`, `grantStaticAbility` keyword, `manaChoices`, `discardAtRandom`, `gainLife`, `dealDamageToEach`, `moveCardById` graveyard→hand, `cant-attack-unless-defender-controls-X` static.

### White (7)

| Carta            | Implementazione                                                          | Linea |
| ---------------- | ------------------------------------------------------------------------ | ----- |
| `consecrateLand` | aura land, `keyword-grant: "indestructible"`                             | 281   |
| `crusade`        | `pt-buff` applies = creature && color includes W, +1/+1                  | 296   |
| `deathWard`      | instant, `applyRegenerationShield(target)`                               | 303   |
| `farmstead`      | aura su Plains, trigger `PHASE_BEGIN` UPKEEP → `gainLife(controller, 2)` | 321   |
| `holyStrength`   | aura, `pt-buff` applies = attached, +1/+2                                | 357   |
| `karma`          | trigger `PHASE_BEGIN` UPKEEP per APNAP, conta Swamp e `dealDamage`       | 372   |
| `lance`          | aura, `keyword-grant: "first strike"`                                    | 379   |

### Blue (5)

| Carta              | Implementazione                                                                              | Linea |
| ------------------ | -------------------------------------------------------------------------------------------- | ----- |
| `feedback`         | aura su Enchantment, trigger `PHASE_BEGIN` UPKEEP → `dealDamage` al controller dell'host     | 703   |
| `flight`           | aura, `keyword-grant: "flying"`                                                              | 711   |
| `jump`             | instant, `grantStaticAbility(target,"flying",{phase:"end-of-turn"})`                         | 727   |
| `pirateShip`       | `staticAbilities: ["cant-attack-unless-defender-controls-Island"]` + activated `{T}: deal 1` | 815   |
| `prodigalSorcerer` | activated `{T}: deal 1 damage to any target`                                                 | 840   |

### Black (10)

| Carta             | Implementazione                                                                | Linea |
| ----------------- | ------------------------------------------------------------------------------ | ----- |
| `cursedLand`      | aura land, trigger `PHASE_BEGIN` UPKEEP → 1 damage al controller dell'host     | 1176  |
| `drudgeSkeletons` | activated `{B}: applyRegenerationShield(self)`                                 | 1277  |
| `mindTwist`       | sorcery XB, target player, `discardAtRandom(player, getX())`                   | 1376  |
| `plagueRats`      | `pt-cda` compute = count Rats su tutti i battlefield                           | 1454  |
| `raiseDead`       | sorcery, target `card` zone graveyard your, `moveCardById(...,graveyard,hand)` | 1462  |
| `unholyStrength`  | aura, `pt-buff` +2/+1                                                          | 1596  |
| `wallOfBone`      | defender + activated `{B}: applyRegenerationShield(self)`                      | 1604  |
| `warpArtifact`    | aura su Artifact, trigger UPKEEP → 1 damage al controller dell'host            | 1614  |
| `weakness`        | aura, `pt-buff` -2/-1                                                          | 1622  |
| `willOTheWisp`    | flying + activated `{B}` regen                                                 | 1630  |

### Red (8)

| Carta                  | Implementazione                                                                                     | Linea |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ----- |
| `burrowing`            | aura, `keyword-grant: "mountainwalk"`                                                               | 1657  |
| `goblinBalloonBrigade` | activated `{R}: grantStaticAbility(self,"flying",eot)`                                              | 1799  |
| `goblinKing`           | `pt-buff` other Goblins +1/+1 + `keyword-grant` Goblin → mountainwalk (predicate generico, no aura) | 1809  |
| `keldonWarlord`        | `pt-cda` count other creatures controllate                                                          | 1869  |
| `orcishArtillery`      | activated `{T}: deal 2 to any + deal 3 to caster`                                                   | 1912  |
| `shatter`              | `targetRequirement: {type:"Artifact"}`, `destroy`                                                   | 1981  |
| `stoneRain`            | target Land, `destroy`                                                                              | 2015  |
| `tunnel`               | target Wall (`subtypeFilter:"Wall"`), `destroy`                                                     | 2022  |
| `uthdenTroll`          | activated `{R}` regen                                                                               | 2039  |

### Green (5)

| Carta            | Implementazione                                                      | Linea |
| ---------------- | -------------------------------------------------------------------- | ----- |
| `iceStorm`       | sorcery, target Land, `destroy`                                      | 2343  |
| `leyDruid`       | activated `{T}: untap target Land`                                   | 2376  |
| `lordOfAtlantis` | `pt-buff` other Merfolk +1/+1 + `keyword-grant` Merfolk → islandwalk | 741   |
| `streamOfLife`   | sorcery XG, target player, `gainLife(player, getX())`                | 2531  |
| `wallOfBrambles` | vanilla 2/3 defender wall (no abilities oltre defender)              | 2588  |

### Artifact (3)

| Carta            | Implementazione                                                                         | Linea |
| ---------------- | --------------------------------------------------------------------------------------- | ----- |
| `celestialPrism` | activated `{2}{T}: addMana` con `manaChoices` 5 colori                                  | 2707  |
| `copperTablet`   | trigger `PHASE_BEGIN` UPKEEP per APNAP → `dealDamageToEach({players:true})` 1 al player | 2738  |
| `rodOfRuin`      | activated `{3}{T}: deal 1 to any target`                                                | 3135  |

---

## Specchietto 2 — Richiedono nuove feature (~88 carte)

Raggruppate per gap di feature. Una carta può comparire in più gruppi.

### A. Counter sui permanenti (`+1/+1`, mire, age, vitality)

**Manca**: primitivo `addCounter(target, type, n)` / `removeCounter` + integrazione layer 7d per `+1/+1`. Sengir Vampire usa `modifyPower`/`modifyToughness` non counter veri.

- `rockHydra` (1961) — XRR, ETB con X counter, `{R}` rimuovi counter come regen
- `fungusaur` (2278) — counter +1/+1 quando subisce danno e sopravvive
- `clockworkBeast` (2721) — counter di carica, attacca scarica
- `cyclopeanTomb` (2752) — mire counter su land → diventa Swamp

### B. Buff P/T temporaneo (`+X/+Y until end of turn`)

**Manca**: `modifyPower`/`modifyToughness` con `DurationSpec`, oppure `StaticPTBuff` con duration. Berserk lo evita perché la creatura muore comunque.

- `firebreathing` (1774) — `{R}: +1/+0`
- `graniteGargoyle` (1819) — `{R}: +0/+1` (più flying base)
- `dragonWhelp` (1679) — `{R}: +1/+0`, sacrifice se 4+ attivazioni
- `shivanDragon` (1988) — `{R}: +1/+0`
- `frozenShade` (1303) — `{B}: +1/+1`
- `howlFromBeyond` (1320) — XB, +X/+0 al target
- `wallOfWater` (1099) — `{U}: +1/+0`
- `wallOfFire` (2049) — `{R}: +1/+0`
- `holyArmor` (349) — `{1}{W}: +0/+3` (parte aura `+0/+2` è FREE)
- `righteousness` (485) — +7/+7 a creatura che blocca (anche gap E)
- `stoneGiant` (2005) — pump + grant flying

### C. Trigger su tap-for-mana

**Manca**: evento `MANA_TAPPED` o `PERMANENT_TAPPED_FOR_MANA`.

- `manaFlare` (1888)
- `manabarbs` (1895)
- `lifetap` (734)
- `wildGrowth` (2647) — anche gap N (grant attivata a host)

### D. Trigger su lancio di spell (`whenever you cast …`)

**Manca**: evento `SPELL_CAST` con tipo/colore.

- `verduranEnchantress` (2578)
- `crystalRod` (2745) — su blue spell
- `ironStar` (2875) — su red
- `ivoryCup` (2882) — su white
- `throneOfBone` (3182) — su black
- `woodenSphere` (3210) — su green

### E. Static che dipendono da stato di combattimento (attacking/blocking)

**Manca**: `StaticEffectStateView` non espone `isAttacking`/`isBlocking` ai predicati `applies`. Servirebbe estendere la view o emettere eventi BEGIN/END combat.

- `orcishOriflamme` (1922) — attacking creatures +1/+0
- `righteousness` (485) — buff a blocker

### F. CREATURE_DIED globale (non solo da combat)

**Manca**: post-resolution death scan in `engine.ts`. Oggi solo combat damage emette l'evento.

- `soulNet` (3161)
- `dingusEgg` (2759) — anche su land destroy (gap M)
- `scavengingGhoul` (1519)
- `creatureBond` (688)
- `netherShadow` (1383) — anche reanimazione automatica
- `cockatrice` (2223) — kill-on-block
- `thicketBasilisk` (2538) — kill-on-block

### G. Modal spell (CR 700.2)

**Manca**: meccanismo `modes: [...]` con scelta a cast.

- `healingSalve` (342) — gain life o prevent
- `blueElementalBlast` (619) — counter o destroy
- `redElementalBlast` (1943) — idem

### H. Reanimazione graveyard → battlefield

**Manca**: `MovableZone` non include `battlefield`. Serve `returnToBattlefield(card, controllerId)` con ETB.

- `resurrection` (471)
- `animateDead` (1119) — anche aura su carta in graveyard (caso speciale)

### I. Cumulative upkeep (CR 702.23)

**Manca**: meccanica completa (counter sull'enchantment + costo crescente + sacrifice se non pagato).

- `phantasmalForces` (786)
- `demonicHordes` (1222)
- `forceOfNature` (2268)
- `wanderlust` (2620)
- `psychicVenom` (866) — variante upkeep paid mana

### J. Skip untap step / "doesn't untap during untap step"

**Manca**: replacement effect su untap di permanente specifico.

- `paralyze` (1439)
- `basaltMonolith` (2662)
- `manaVault` (2996)
- `smoke` (1998)
- `meekstone` (3003) — cond. su power
- `stasis` (936)
- `winterOrb` ha `limits-acl-untap` static già — pattern non riusabile per non-mass

### K. Prevenzione di danno verso target (non solo da source)

**Manca**: `preventNextDamageFromSource` è source-keyed. Serve `preventNextNDamageToTarget(target, n, duration)` come Healing Salve.

- `samiteHealer` (492)
- `healingSalve` (342) — anche gap G
- `guardianAngel` (335) — divisa fra target
- `conservator` (2731) — al controller
- `jadeMonolith` (2889) — redirect a controller (gap U)

### L. Block restrictions custom

**Manca**: predicato static `blockBy(attacker, blocker) → boolean` letto dal validator combat.

- `invisibility` (719) — solo Wall
- `fear` (1295) — solo black/artifact
- `ironclawOrcs` (1859) — non blocca creature power ≥ 2
- `dwarvenWarriors` (1699) — `{R}` unblockable

### M. Trigger su land entering / on permanente che diventa zone X

**Manca**: evento `PERMANENT_ENTERED` filtrato per type, e `PERMANENT_LEFT` (per dingusEgg "land destroyed").

- `ankhOfMishra` (2655)
- `dingusEgg` (2759)

### N. Grant attivata a permanente (non a player)

**Manca**: `grantAbility` esiste solo per player. Serve variante `grantActivatedToPermanent(target, abilityDef, duration)`.

- `wildGrowth` (2647) — host gains `{T}: add G`
- `blessing` (181) — host gains `{W}{W}: untap`
- `instillEnergy` (2350) — host gains `{0}: untap`, ignore summoning sickness
- `zombieMaster` (1647) — Zombie altrui hanno `{B}: regen` (zone-static activated, ancora più complesso)

### O. Effetti type-changing su permanenti (lace + land conversion)

**Manca**: layer 4 (type) e layer 5 (subtype). Cambiamenti tipo + nessuno pattern attuale.

- `purelace`/`chaoslace`/`deathlace`/`lifelace`/`thoughtlace` (427/1665/1208/2393/963) — color change
- `magicalHack` (751) / `sleightOfMind` (922) — text-changing CR 612.2
- `evilPresence` (1287)
- `phantasmalTerrain` (796)
- `conversion` (289)
- `livingLands` (2408)
- `kormusBell` (2972)

### P. Banding (CR 702.21)

**Manca**: keyword + risoluzione dichiarazione blocker raggruppati.

- `benalishHero` (158)
- `mesaPegasus` (387)
- `timberWolves` (2548)
- `helmOfChatzuk` (2794) — grant banding

### Q. Reach (CR 702.17)

**Manca**: keyword "reach" non è nel set di keyword riconosciuti dal block validator (oggi solo "flying").

- `giantSpider` (2308)
- `web` (2639) — grant reach

### R. Counter target spell — varianti

**Manca**: `counterUnlessPays(target, mana|life)`, `counterIfCmcEqualsX`, `copySpell`.

- `powerSink` (833) — counter unless pays X
- `spellBlast` (929) — counter spell with cmc = X
- `deathgrip` (1201) — counter green spell
- `lifeforce` (2386) — counter black spell
- `fork` (1792) — copia spell

### S. Forced attack / forced block

**Manca**: vincoli combat positivi (must-attack/must-block).

- `lure` (2437) — must block
- `blazeOfGlory` (174) — must block
- `sirensCall` (915) — must attack
- `nettlingImp` (1393) — must attack target o sacrifice

### T. Color/type filter su PermanentFilter e target

**Manca**: `colorFilter` esiste su `TargetRequirement` solo per source-of-damage prevention; non si può targettare permanente filtrato per colore. Manca anche flag `cantBeRegenerated` su `destroy`.

- `northernPaladin` (397) — destroy black
- `terror` (1589) — destroy non-black non-artifact, no regen
- `disintegrate` (1672) — X damage no regen, exile if dies

### U. Damage redirection / replacement effects

**Manca**: replacement effect framework generale.

- `simulacrum` (1569)
- `reverseDamage` (478)
- `personalIncarnation` (417)
- `lich` (1359)
- `jadeMonolith` (2889)
- `veteranBodyguard` (538)
- `libraryOfLeng` (2979) — discard replacement

### V. Lookup CMC di carta

**Manca**: `getCmc(target)` accessibile a `SpellContext`. Serve a:

- `animateArtifact` (611) — P/T = cmc
- `sacrifice` (1502) — add B = cmc
- `spellBlast` (929) — gap R

### W. Copia di permanenti

**Manca**: ETB copy effect.

- `clone` (640)
- `copyArtifact` (668)
- `vesuvanDoppelganger` (1034)

### X. Modifica costo / cost increase

**Manca**: `costModifier` static che aumenta CMC di una classe di spell.

- `gloom` (1313) — White +3
- `manaShort` (769) — drena mana pool
- `drainPower` (696)

### Y. Token creation

**Manca**: `createToken(spec, controllerId, n)`.

- `theHive` (3175) — 1/1 flying Wasp

### Z. Skip-draw / attack restriction by-player

**Manca**: replacement su draw + global combat restriction.

- `islandSanctuary` (365)

### AA. Ignora summoning sickness

**Manca**: keyword grant esiste ma non tratta `haste`-equivalente "may attack first turn".

- `instillEnergy` (2350) — anche gap N

### AB. Forced ability su carte avversarie / control mind

- `wordOfCommand` (1640) — controlla turno avversario
- `falseOrders` (1743)
- `gaeasLiege` (2288)

### AC. Trigger choice "X or Y" (sacrifice or take damage)

**Manca**: `requestChoice` esiste ma non in trigger resolve con effetti diversi per scelta.

- `lordOfThePit` (1366)

### AD. Multi-blocker / multi-attacker

**Manca**: regole combat con N>1 blocker per attacker dichiarato dall'attaccante.

- `twoHeadedGiantOfForiys` (2029)
- `ragingRiver` (1936)
- `forcefield` (2773)

### AE. Look at hand / library

**Manca**: `peekHand(playerId)`, `peekLibrary(playerId, n)`.

- `glassesOfUrza` (2787)
- `naturalSelection` (2445)
- `disruptingScepter` (2766) — discard scelto da target

### AF. Discard scelto invece che random

**Manca**: `discardChosen(playerId, count, fromHand)`.

- `disruptingScepter` (2766)
- `blackVise` (2700) — penalty hand size

### AG. Skip turn / extra constraint

- `timeVault` (3189)

### AH. Restrizione attivazione "only during your turn AND attacking"

**Manca**: `activationPhaseRestriction` esiste, ma non condizione "self is attacking".

- `dwarvenDemolitionTeam` (1689)

### AI. Activation count limit

**Manca**: contatore attivazioni per turno.

- `dragonWhelp` (1679)

### AJ. Mana abilities con output dipendente da land type / Lord mana

- `gauntletOfMight` (2780) — Mountain produce R extra
- `sunglassesOfUrza` (3168) — Plains produce R
- `manaShort` (769)

### AK. Cost-aware mana production (life, sacrifice, mana drain)

- `bottleOfSuleiman` non in lea — N/A
- `forceOfNature` (2268) gap I

### AL. Bonus condizionale su land type controllato (`pt-buff` con state lookup)

**Manca**: predicato `applies` non riceve `StaticEffectStateView` (solo `pt-cda` la riceve in `compute`). Sedge Troll vuole pt-buff condizionale su Swamp controllata.

- `sedgeTroll` (1971) — +1/+1 se controlli Swamp; B regen
- `aspectOfWolf` (2090) — divisa per Forest controllati

### AM. Combat damage prevention (mass, esplicito)

**Manca**: prevenzione di tutto il danno da combat questo turno.

- `fog` (2261)

### AN. Aura su land/artifact con effetto tap-collegato

- `kudzu` (2368) — destroy land at untap, swap aura
- `livingArtifact` (2400) — vitality counter (gap A)

### AO. Carte con interazione tipo Plains / Mountain / Swamp / Island a livello mass

- `flashfires` già FREE; `tsunami` FREE — pattern già usato
- `cyclopeanTomb` (gap A)

### AP. Demoniche / sacrifice mandatorio

- `pestilence` (1447) — sacrifice if no creature, damage everything at upkeep
- `wanderlust` (2620)

### AQ. Pirate Ship-like ma altri vincoli

- (già coperto)

### AR. Phasing-style restore

**Manca** per `consecrateLand` la prevent-damage (i lands non subiscono damage in regole di base, quindi clausola innocua — non blocco).

---

## Sintesi: feature gap a maggior impatto

| Feature                                  | # carte sbloccate (approx) |
| ---------------------------------------- | -------------------------- |
| B. Buff P/T temporaneo con duration      | 11                         |
| O. Type/color/text-changing static       | 11                         |
| H+U. Replacement framework + reanimation | 9                          |
| F. CREATURE_DIED globale                 | 7                          |
| D. Spell-cast trigger                    | 6                          |
| K. Prevent-to-target                     | 5                          |
| J. Skip untap step                       | 7                          |
| L. Block restrictions custom             | 4                          |
| C. Tap-for-mana trigger                  | 4                          |
| P. Banding                               | 4                          |
| A. Counter +1/+1                         | 4                          |
| N. Grant activated a permanente          | 4                          |
| R. Counter spell varianti                | 5                          |

Implementare in ordine i top 5 (B, O, H, F, D) sblocca ~44 carte stub aggiuntive.

---

## File critici (sola lettura per ora)

- `convex/cards/sets/lea.ts` — stub list
- `convex/cards/types.ts` — `SpellContext` 195–436, `StaticEffect` 495–576, trigger 583–681
- `convex/gre/sba.ts` — SBA implementati
- `convex/gre/engine.ts` — emissione eventi (verificare quando aggiungere CREATURE_DIED globale)
- `convex/gre/triggers.ts` — matching engine
- `convex/gre/combat.ts` — block validator (per gap L, P, Q)

## Verifica

Nessuna modifica codice. L'output è il presente report.
