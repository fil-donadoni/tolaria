# Architecture Decision Records — Index

Queryable index of every ADR. **Read this first**, then open only the records
relevant to what you're working on — ADRs are not auto-loaded into context, so
this list is how you discover which ones exist. Grep it by keyword (e.g. `combat`,
`mana`, `bot`, `layer`) to find the decision that touches your area.

**Maintenance:** add one line here whenever you create a new ADR. The number is
the filename number (canonical). Keep this list in sync — a drift guard may be
added later (see issue tracker).

> ⚠️ **Known numbering collisions** (pre-existing, to be cleaned up): two ADRs
> share `0020`, two share `0021`, and `0000`/`0008` have mismatched in-file
> headings. Numbers are not currently unique — rely on the **slug**, not the
> number, to identify a record.

| #    | Decision                                                                                           | File                                                                   |
| ---- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0000 | AI opponent: client-side ISMCTS over the real GRE, server-authoritative apply                      | [link](0000-ai-opponent-client-side-ismcts.md)                         |
| 0001 | One trigger factory per zone-of-origin (no unified `zoneChangeTrigger`)                            | [link](0001-zone-change-trigger-factories.md)                          |
| 0002 | Trigger factory architecture                                                                       | [link](0002-trigger-factory-architecture.md)                           |
| 0003 | Auto-resolve trivial player choices (Arena-style UX)                                               | [link](0003-auto-resolve-trivial-choices.md)                           |
| 0004 | Card text and rules follow modern Oracle and current Comprehensive Rules                           | [link](0004-modern-oracle-and-current-cr.md)                           |
| 0005 | Data-driven untap-step restrictions                                                                | [link](0005-data-driven-untap-restrictions.md)                         |
| 0006 | Data-driven combat eligibility (attack-restriction + attack-requirement)                           | [link](0006-data-driven-combat-eligibility.md)                         |
| 0007 | UI design system: semantic tokens + universal Panel frame                                          | [link](0007-ui-design-system.md)                                       |
| 0008 | Client-buffered pending choice submission _(in-file heading says 0007)_                            | [link](0008-client-buffered-pending-choices.md)                        |
| 0009 | Mobile touch interaction model                                                                     | [link](0009-mobile-touch-interaction-model.md)                         |
| 0010 | LEA cards declared permanently out of scope                                                        | [link](0010-lea-out-of-scope-cards.md)                                 |
| 0011 | Text-changing effects (CR 612, layer 3) on a data-driven engine                                    | [link](0011-text-changing-effects-layer-3.md)                          |
| 0012 | Transient combat block-restrictions (Raging River, pile combat)                                    | [link](0012-transient-combat-block-restrictions.md)                    |
| 0013 | Face-down permanents with hidden identity (Illusionary Mask)                                       | [link](0013-face-down-permanents.md)                                   |
| 0014 | Set files carry both reprints (CardPrint) and new cards (CardDefinition)                           | [link](0014-set-files-mix-prints-and-definitions.md)                   |
| 0015 | ISMCTS rollout terminates at a turn boundary, not a fixed ply count                                | [link](0015-rollout-terminates-at-turn-boundary.md)                    |
| 0016 | Bot resolves interactive choices with a legal default; smart selection deferred                    | [link](0016-bot-resolution-choice-default-policy.md)                   |
| 0017 | Ordered P/T layer pipeline (CR 613.4)                                                              | [link](0017-ordered-pt-layer-pipeline.md)                              |
| 0018 | Forge-style evaluation enrichment (card value, danger clock, Forge-scale)                          | [link](0018-forge-style-evaluation-enrichment.md)                      |
| 0019 | Blocked is explicit combat state, not blocker count                                                | [link](0019-blocked-is-explicit-combat-state.md)                       |
| 0020 | Bot timing & option-value awareness ⚠️ _(number shared)_                                           | [link](0020-bot-timing-and-option-value.md)                            |
| 0020 | Destroy-replacement via the replacement framework; regeneration kept separate ⚠️ _(number shared)_ | [link](0020-destroy-replacement-via-framework.md)                      |
| 0021 | General phasing via a silent holding-bundle move ⚠️ _(number shared)_                              | [link](0021-general-phasing-via-holding-bundle.md)                     |
| 0021 | Stronger opponent model & temporal flexibility ⚠️ _(number shared)_                                | [link](0021-stronger-opponent-model-and-temporal-flexibility.md)       |
| 0022 | Restricted mana (spend-only-on constraints)                                                        | [link](0022-restricted-mana.md)                                        |
| 0023 | Random Reveal: pause resolution to animate the outcome before applying it                          | [link](0023-random-reveal-pause.md)                                    |
| 0024 | `ABILITY_ACTIVATED`: separate event for the non-`{T}` half of "an artifact is used"                | [link](0024-ability-activated-event.md)                                |
| 0025 | Turn controller surface + responsive board layout                                                  | [link](0025-turn-controller-and-responsive-board.md)                   |
| 0026 | Persistent per-card knowledge (`knownTo`) replaces choice-derived visibility                       | [link](0026-persistent-card-knowledge.md)                              |
| 0027 | Library tutor → battlefield: a destination primitive, not a search primitive                       | [link](0027-library-tutor-to-battlefield.md)                           |
| 0028 | Exile-and-return via a metadata holding bundle + `PERMANENT_UNTAPPED` event                        | [link](0028-exile-and-return-holding-bundle.md)                        |
| 0029 | Match as a thin orchestrator over Games (best-of-N)                                                | [link](0029-match-orchestrator-over-games.md)                          |
| 0030 | Legend rule as a pending-choice state-based action                                                 | [link](0030-legend-rule-pending-choice-sba.md)                         |
| 0031 | Nonbasic-land lockdown via composed static effects (Blood Moon)                                    | [link](0031-nonbasic-land-lockdown-via-composed-statics.md)            |
| 0032 | Poison as a player-level resource with its own loss SBA                                            | [link](0032-poison-as-player-resource-and-loss-sba.md)                 |
| 0033 | Preset Decks live in the DB and are Admin-editable                                                 | [link](0033-preset-decks-in-db-admin-editable.md)                      |
| 0034 | Smart auto-tap: demand-aware mana source selection                                                 | [link](0034-smart-auto-tap-demand-aware.md)                            |
| 0035 | Deck builder drag & drop with touch-delay disambiguation                                           | [link](0035-deckbuilder-drag-and-drop.md)                              |
| 0036 | Deck Format validation system                                                                      | [link](0036-deck-format-validation-system.md)                          |
| 0037 | Acting Player: deciding a cast on another player's behalf                                          | [link](0037-acting-player-controlled-cast.md)                          |
| 0038 | Menace via a generic minimum-blocker threshold                                                     | [link](0038-menace-and-minimum-blocker-threshold.md)                   |
| 0039 | Sacrifice-self as a fixed-output mana ability                                                      | [link](0039-sacrifice-self-fixed-output-mana-ability.md)               |
| 0040 | Tap-mana-ability delayed-trigger rider (control-change-on-tap)                                     | [link](0040-tap-mana-ability-delayed-trigger-rider.md)                 |
| 0041 | Worklist-driven cross-set card implementation                                                      | [link](0041-worklist-driven-cross-set-card-implementation.md)          |
| 0042 | Cumulative Upkeep via Age Counters and a Scaling Cost Template                                     | [link](0042-cumulative-upkeep-age-counter-template.md)                 |
| 0043 | Set-file decomposition by colour for parallel agentic throughput                                   | [link](0043-set-file-decomposition-for-parallel-agentic-throughput.md) |
| 0044 | DB-backed, LLM-generated debug scenarios                                                           | [link](0044-db-backed-llm-generated-debug-scenarios.md)                |
| 0045 | Effect Script: hybrid declarative DSL with a frozen minimal grammar                                | [link](0045-effect-script-hybrid-dsl-frozen-grammar.md)                |
| 0046 | Card registry: repo as source of truth, DB as a rebuildable projection                             | [link](0046-card-registry-repo-source-of-truth-db-projection.md)       |
| 0047 | Expected Input as the authoritative gate (and why not a full FSM)                                  | [link](0047-expected-input-authoritative-gate.md)                      |
| 0048 | delayedTrigger Op: inline body with explicit capture                                               | [link](0048-delayed-trigger-op-inline-body.md)                         |
| 0049 | Trigger-site event refs (`$event.<field>`) and list-valued capture                                 | [link](0049-trigger-event-refs-and-list-capture.md)                    |
| 0050 | Computed static output driven by an on-entry stored choice                                         | [link](0050-computed-static-output-from-stored-choice.md)              |
| 0051 | Land-entry pay-choice as a stackless pending choice (shock lands)                                  | [link](0051-land-entry-pay-choice-stackless-pending-choice.md)         |
| 0052 | Storm as a cast-trigger over a spell snapshot                                                      | [link](0052-storm-cast-trigger-and-spell-snapshot.md)                  |
| 0053 | Pile division as a two-step divide-then-choose pending choice                                      | [link](0053-pile-division-divide-then-choose-pending-choice.md)        |
| 0054 | Fading & Vanishing: implicit keyword expansion + counter-removed trigger                           | [link](0054-fading-vanishing-implicit-keyword-expansion.md)            |
| 0055 | Limited Event: ends at the deck, pool-as-sideboard, server-side Bot Drafter                        | [link](0054-limited-event-architecture.md)                             |
| 0056 | Boosters from MTGJSON print sheets, draftability gated on complete sets                            | [link](0055-booster-mtgjson-sheets-complete-set-gate.md)               |
| 0057 | Premodern/Old School banlists become DB-backed, name-keyed, Scryfall-synced (supersedes ADR 0036 banlist clause, scoped to those two formats) | [link](0057-db-backed-name-keyed-banlists.md)                          |
