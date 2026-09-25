# Clause-level grammar coverage census

Issue #3849. Measurements only, each with the command that produced it. No
opinion on what to build next — that is the next ticket's job.

Script: `docs/research/scripts/grammar-rule-census.py`. Full raw output this
document quotes from: reproduce with the commands in `## Reproduce` below.

## Method

**Seams used** (read before writing the splitter, not invented):

- `convex/oracle/grammar/slots/triggered.ts` — a triggered ability line is
  `head, [if <condition>,] <effects, ". "-separated>.`; the head/tail split
  is on the first `", "`, the effect tail is `". "`-separated sentences.
- `convex/oracle/grammar/shared/triggerHead.ts` — the trigger-head openers
  (`when `, `whenever `, `at the beginning of `) used to detect a triggered
  line at all.
- `convex/oracle/grammar/shared/condition.ts` — the CR 603.4 `if …,` clause.
- `convex/oracle/grammar/shared/targetFilter.ts` — the `target <descriptor>`
  / `any target` / `up to one target <descriptor>` seam (`TARGET_FILTER`),
  plus `COLOR_WORDS` for leaf normalisation.
- `convex/oracle/grammar/shared/duration.ts` — the 4-phrase `DURATION`
  table, and its `DurationIR` KIND (`end-of-turn` covers both `"until end of
turn"` and `"this turn"` — the same collapse the real `durationRule` makes).
- `convex/oracle/grammar/shared/zoneRef.ts` — the 12-phrase `ZONE_REF` table
  (CR 400.1).
- `convex/oracle/grammar/shared/effectClause.ts` — `sentenceRule`'s cascade
  (`PUMP`, `DAMAGE`, `DRAW_SELF`/`DRAW_PLAYER`, `LIFE`, `COUNTERS`,
  `DISCARD_RANDOM`, `Destroy`/`Tap`/`Untap`/`Regenerate`/`Return`/`Exile`
  prefixes, the `" gains … until …"` keyword grant, the CR 602.5
  `RESTRICTIONS` table, `SUPPRESS_DAMAGE_PREVENTION`, the CR 701.19c
  modifier) — reimplemented as regexes over the MASKED, leaf-normalised
  sentence, to recognise the same dozen-odd verb shapes the real grammar
  does, not to reparse the corpus independently of it.
- `convex/oracle/grammar/shared/playerRef.ts` — the 6-phrase `PLAYER_REF`
  table, used to canonicalise a sentence-pattern's subject/player group.
- `convex/oracle/grammar/shared/subtypes.ts` — `CREATURE_SUBTYPES` (205.3m),
  `LAND_SUBTYPES` (205.3i, split into the 5 CR 305.6 basics vs the rest),
  `ARTIFACT_SUBTYPES`/`ENCHANTMENT_SUBTYPES`/`SPELL_SUBTYPES`, for leaf
  normalisation.
- `convex/oracle/grammar/shared/quantity.ts` — `NUMBER_WORDS` (a…twenty).
- `convex/oracle/grammar/shared/cost.ts` — `SELF_NOUNS` (`"this creature"`
  etc. = self, CR 700.7), and confirmation that fragment text is already
  self-substituted (`convex/oracle/normalize.ts`'s `{self}` marker) — see
  below.
- `convex/cards/mechanicsRegistry.ts` — parsed (regex, not `tsc`) for
  `id`/`name`/`status` rows, used only for item 5's one-line note.

**A load-bearing shortcut**: `data/oracle-compiled.json`'s `fragments[]` are
already the compiler's own post-`normalize.ts` LINES — typography applied,
reminder text stripped, the card's own name substituted to the literal
`{self}` token — deduplicated across cards, each carrying its own router
failure `reason` and a global `cards` count. Verified directly:

```
$ python3 -c "
import json
d = json.load(open('data/oracle-compiled.json'))
print(sum(1 for f in d['fragments'] if '{self}' in f['text']))"
2445
```

and that every fragment's `cards` count exactly equals the number of
`unparsed` cards whose `gaps[]` cites it (checked exhaustively, 0 mismatches
of 34,471). This means the splitter below runs on the REAL compiler's own
normalised text, not a reimplementation of `normalize.ts` — removing a whole
class of drift risk.

**What the splitter does, per gap line** (`segment_line` in the script):

1. If the line opens with a trigger opener, split at the first `", "` into
   `trigger-head` + tail (documented approximation: the real router tries
   EVERY comma and keeps the one where both halves parse; taking the first
   comma is simpler and can occasionally misplace the boundary on a
   multi-comma effect tail — see Caveats).
2. Else, if the line has a top-level `": "`, split into `cost` + tail
   (activated/mana-ability shape).
3. If the tail opens with `"if "` and has a `", "`, peel a `condition`
   clause.
4. Split the remaining tail on `". "` into sentences (mirrors
   `triggered.ts`'s `listOf("effect sentences", ". ", …)`).
5. Per sentence: extract every `target <descriptor>` / `any target` phrase
   as its own `target-filter` clause and mask it to `TARGET_SLOT`; extract
   the 4 known `duration` phrases (canonicalised to their `DurationIR` kind)
   and mask to `DURATION_SLOT`, then a generic `duration-unknown` catch-all
   (`"until …"`, `"for as long as …"`) for a duration-SHAPED phrase outside
   the table; extract the 12 known `zone-ref` phrases and mask to
   `ZONE_SLOT`.
6. Leaf-normalise what's left (see below), then try the dozen
   `effectClause.ts` sentence patterns against the masked+normalised
   skeleton. A match becomes an `effect-pattern` shape named after the verb
   with its subject/player canonicalised to a KIND (`SELF` / `TARGET` /
   `PLAYER_YOU` / `PLAYER_OPPONENT` / `PLAYER_EACH` / `TARGET_PLAYER` /
   `TARGET_OPPONENT` / `SUBJECT_OTHER`) — e.g. `DESTROY(subject=TARGET)`.
   No match: the residual skeleton itself is the shape, category
   `effect-opaque` — the genuine "no verb rule for this" bucket.
7. A structural (non-textual) fragment reason (`layout "X" is not in
grammar v0 …`, `"hand" is not a zone destination …`, …) is its own
   `structural-gap` shape, generalised by blanking quoted literals so
   `layout "transform"` and `layout "saga"` are ONE shape, not one per value.

**Leaf normalisation** (ticket item 1 — numbers / mana / colours / basic
types / creature types / self-reference), applied to every extracted clause
text: `{self}` and `"this <SELF_NOUN>"` → `SELF_OBJ`; any `{…}` symbol (mana
pip, `{T}`/`{Q}`, `{E}` energy) → `SYM`; a `CREATURE_SUBTYPES` word →
`CREATURETYPE`; a basic land type (Plains/Island/Swamp/Mountain/Forest,
CR 305.6) → `BASICLAND`; any other CR 205.3 subtype → `SUBTYPE` (a widening
beyond the ticket's literal wording, kept because otherwise "Clue token" and
"Treasure token" would be different shapes for no reason the grammar cares
about); `COLOR_WORDS` → `COLOR`; a `NUMBER_WORDS` word or a bare digit run
(signed) → `N`; a standalone `X` → `X_VAR`.

**Card requirement**: for each `unparsed` card, the union of clause shapes
produced by every one of its `gaps[]` fragments. A card is "ready" under a
candidate top-K shape set iff its ENTIRE requirement set is a subset of that
K (ticket item 3's rule, applied literally).

**Ranking / curve method**: item 3 says "fix top-K clause shapes ordered by
X; report ready% at K = …" — read literally as a FIXED frequency ranking
(shapes sorted once, descending, by cards-blocked in ordering target X), not
an iterative marginal-gain (submodular) greedy recomputed at every step. A
true adaptive greedy pass would do at least as well at every K; the
frequency-ranked curve below is the simpler, fully reproducible reading of
"fix top-K … ordered by".

### Caveats

1. **First-comma approximation.** The real router tries every comma in a
   trigger line and keeps the one where both the head and the tail parse;
   this script always takes the first. On a line like "When this creature
   enters, destroy target creature, then draw a card" this is right by
   construction (there is exactly one trigger-head-shaped prefix), but a
   condition or a target descriptor that itself contains a stray comma could
   misplace the boundary. Not spot-checked line-by-line; the top-ranked
   shapes above were manually eyeballed via their verbatim examples (item 5)
   and read correctly.
2. **A card's requirement set over-counts.** Because a card is `unparsed` if
   even ONE of its clauses is unrecognised, its OTHER (already-supported)
   clauses on the SAME line still enter its requirement set — e.g. a
   `DESTROY(subject=TARGET)` pattern is unambiguously already within grammar
   v0's sentence vocabulary, yet it appears as a "requirement" for every
   card whose gap line pairs it with something the grammar cannot read (a
   bad target descriptor, an unrecognised trigger head, …). This makes the
   ready% curves in item 3 a LOWER BOUND relative to a hypothetical
   perfectly surgical compiler fix (which would need only the one truly
   missing rule, not every already-implemented clause on the line to also
   appear in some top-K set) — but should not much change the RANKING,
   since near-universal already-supported shapes (`DESTROY(subject=TARGET)`,
   `end-of-turn` duration, …) cluster at the very top of every frequency
   ranking regardless, and enter the top-K at small K either way.
3. **Small-pool "leverage" trap — this directly explains why the clause-level
   cube number below reads LOWER than the line-level number the ticket
   quotes.** Counted directly:

    ```
    $ python3 -c "
    import json, gzip
    corpus = json.load(gzip.open('data/oracle-corpus.json.gz','rt'))
    compiled = json.load(open('data/oracle-compiled.json'))
    cube_ids = {...}  # resolved from convex/cubes/vintageCubeNames.ts, see script
    unparsed = [c for c in compiled['cards'] if c['state']=='unparsed' and c['oracleId'] in cube_ids]
    gap_idxs = set();
    for c in unparsed: gap_idxs.update(c['gaps'])
    print(len(unparsed), len(gap_idxs))"
    499 717
    ```

    Cube's 499 unparsed cards carry only 717 DISTINCT gap LINES in total. The
    ticket's quoted line-level "cube → 98.7% ready at K=800 [line] shapes" is
    therefore near-tautological for this Target: K=800 whole-line shapes is
    MORE than the total distinct line vocabulary cube's unparsed pool has, so
    that number mostly says "cube's unparsed pool is small enough to nearly
    enumerate its raw lines at K=800", not "800 shared rules cover cube".
    Premodern is a genuinely different case — 4,546 unparsed cards carry
    4,656 distinct gap lines, so its quoted K=400/32.8% is real leverage (400
    ≪ 4,656). The clause split makes each line's requirement a CONJUNCTION of
    several smaller shapes (trigger-head AND duration AND target-filter AND
    effect-verb, each separately), which is strictly harder to satisfy per
    line than one whole-line template match — so for a tiny, low-redundancy
    pool like cube, decomposing into smaller shared pieces can need a LARGER
    K to reach the same ready% than just enumerating the (few) raw lines
    would, even though those smaller pieces are individually far more
    reusable ACROSS lines and across Targets (see the corpus occurrence-mass
    check below, which shows the same decomposition IS a large net win at
    corpus scale).

4. **`registry_note_for` (item 5) is a keyword-mention heuristic**, not a
   compiler check: it regex-scans the representative raw example line for
   any Mechanics Registry `name` as a whole word. A mention does not prove
   the clause's OWN gap is that keyword (the keyword could be reminder text
   already stripped, or a different clause on the same line) — read it as
   "this example line touches a registry-known concept", not as a
   line-by-line proof.
5. **Cube name resolution**: `convex/cubes/vintageCubeNames.ts` names only a
   multi-faced card's front face (`"Jace, Vryn's Prodigy"`), while the
   corpus's Scryfall `name` field is `"Front // Back"`; the script resolves
   by front-face prefix when an exact match fails. All 542 cube names
   resolved this way (0 unresolved in the final run).

## 1. Clause split + leaf normalisation — shape counts

```
$ python3 docs/research/scripts/grammar-rule-census.py 2>&1 | sed -n '1,20p'
distinct clause shapes across all unparsed gap lines: 29831
by category: {'effect-opaque': 21545, 'trigger-head': 3078, 'target-filter': 2770,
  'condition': 928, 'cost': 1090, 'duration-unknown': 173, 'effect-pattern': 208,
  'structural-gap': 21, 'zone-ref': 12, 'duration': 3, 'opaque-line': 3}
```

29,831 distinct clause shapes, vs. 34,471 distinct LINES in the same
unparsed pool (`oracle-compiled.json` header, "34,471 distinct lines for
34,890 cards" — the ticket's own figure). The clause split's compression is
concentrated entirely in the CLOSED-vocabulary seams: `duration` collapses
to 3 shapes (from thousands of lines containing a duration phrase),
`zone-ref` to 12, `structural-gap` to 21, `effect-pattern` (the dozen known
sentence verbs, subject-canonicalised) to 208. The OPEN-vocabulary seams stay
large: `trigger-head` 3,078, `target-filter` 2,770, `cost` 1,090, `condition`
928 — and `effect-opaque` (every sentence matching none of grammar v0's
dozen verb patterns) is 21,545, **72% of all distinct shapes**. This is the
headline qualitative finding: composition helps enormously where the
grammar already has a closed table (duration, zone, the dozen sentence
verbs) and barely at all where it doesn't (the long tail of effect verbs
outside that dozen) — see `## Reproduce vs. line-level` below for the
quantitative version of this same point.

**Occurrence-mass cross-check against the ticket's August estimate**
("~234 clause shapes = 50% of clause occurrences"):

```
total clause occurrences (textual gap lines only): 107972
distinct clause shapes producing them: 29810
shapes needed for 50% of occurrence mass: 199
  top    50 shapes cover  37.9% of occurrences
  top   100 shapes cover  44.2% of occurrences
  top   234 shapes cover  51.3% of occurrences
  top   500 shapes cover  57.5% of occurrences
  top  1000 shapes cover  63.3% of occurrences
```

234 shapes cover 51.3% of occurrences (199 shapes cross the 50% line) —
this re-derivation, despite the splitter's structural (not full-parse)
approximation, lands almost exactly on the August estimate. Read as
corroboration of that estimate's order of magnitude, not as an independent
confirmation of its exact method (the August pass is not in this repo to
compare code against).

## 2. Clause shapes ranked by cards blocked, per Target

Target pool sizes and baseline (`state: "ready"`) coverage:

```
premodern: total=5408 unparsed=4546 ready=602 baseline_ready%=11.1
cube:      total=542  unparsed=499  ready=36  baseline_ready%=6.6
tier1:     total=117  unparsed=95   ready=19  baseline_ready%=16.2
corpus:    total=34890 unparsed=31454 ready=2613 baseline_ready%=7.5
```

Distinct clause vocabulary size per Target (shapes blocking >=1 of that
Target's unparsed cards):

| Target    | distinct blocking shapes |
| --------- | -----------------------: |
| premodern |                     4267 |
| cube      |                      970 |
| tier1     |                      179 |
| corpus    |                    29831 |

The 6 Tier 1 lists individually (`data/premodern-tier1-decks.json`):

| deck               | total | unparsed | ready | baseline ready% |
| ------------------ | ----: | -------: | ----: | --------------: |
| goblin             |    28 |       21 |     6 |            21.4 |
| psychatog          |    25 |       23 |     1 |             4.0 |
| parallax-replenish |    21 |       19 |     2 |             9.5 |
| landstill          |    28 |       25 |     3 |            10.7 |
| oath-ponza         |    24 |       18 |     6 |            25.0 |
| aluren             |    21 |       17 |     3 |            14.3 |

(60 main + 15 sideboard per deck, deduplicated by name; 147 name-slots reduce
to 117 unique cards across all six because sideboards and Tier 1 staples
overlap heavily.)

Top 15 clause shapes by cards blocked, per Target (`cards blocked` = number
of that Target's `unparsed` cards for which this shape is one of their
required clauses):

**premodern**

| blocked | category       | shape                           |
| ------: | -------------- | ------------------------------- |
|     794 | duration       | end-of-turn                     |
|     436 | cost           | SYM                             |
|     289 | effect-opaque  | Enchant creature                |
|     282 | zone-ref       | the battlefield                 |
|     228 | zone-ref       | exile                           |
|     213 | zone-ref       | your library                    |
|     201 | trigger-head   | at the beginning of your upkeep |
|     195 | trigger-head   | when SELF_OBJ enters            |
|     195 | zone-ref       | your hand                       |
|     185 | zone-ref       | your graveyard                  |
|     162 | cost           | SYM, SYM                        |
|     139 | effect-pattern | DESTROY(subject=SUBJECT_OTHER)  |
|     130 | target-filter  | any target                      |
|     103 | effect-pattern | PUMP(subject=SUBJECT_OTHER)     |
|      99 | effect-pattern | DESTROY(subject=TARGET)         |

**cube**

| blocked | category       | shape                                                                                |
| ------: | -------------- | ------------------------------------------------------------------------------------ |
|      80 | zone-ref       | exile                                                                                |
|      61 | zone-ref       | your library                                                                         |
|      53 | trigger-head   | when SELF_OBJ enters                                                                 |
|      51 | zone-ref       | your hand                                                                            |
|      50 | zone-ref       | the battlefield                                                                      |
|      44 | duration       | end-of-turn                                                                          |
|      41 | cost           | SYM                                                                                  |
|      40 | structural-gap | land with a basic land type — intrinsic mana ability (CR 305.6) is not in grammar v0 |
|      35 | zone-ref       | your graveyard                                                                       |
|      21 | cost           | N                                                                                    |
|      19 | structural-gap | layout \<X\> is not in grammar v0 (multi-faced cards)                                |
|      16 | effect-opaque  | ZONE_SLOT TARGET_SLOT                                                                |
|      15 | target-filter  | any target                                                                           |
|      14 | effect-opaque  | Counter TARGET_SLOT                                                                  |
|      13 | effect-opaque  | Add N mana of any color                                                              |

**tier1**

| blocked | category       | shape                                                                                |
| ------: | -------------- | ------------------------------------------------------------------------------------ |
|      12 | zone-ref       | your library                                                                         |
|      11 | cost           | SYM                                                                                  |
|      11 | zone-ref       | the battlefield                                                                      |
|      10 | zone-ref       | your hand                                                                            |
|       9 | duration       | end-of-turn                                                                          |
|       8 | trigger-head   | when SELF_OBJ enters                                                                 |
|       7 | effect-opaque  | Counter TARGET_SLOT                                                                  |
|       7 | effect-pattern | DEAL_DAMAGE(from=SUBJECT_OTHER,to=PLAYER_YOU)                                        |
|       7 | zone-ref       | exile                                                                                |
|       6 | structural-gap | land with a basic land type — intrinsic mana ability (CR 305.6) is not in grammar v0 |

**corpus**

| blocked | category       | shape                                                 |
| ------: | -------------- | ----------------------------------------------------- |
|    5394 | duration       | end-of-turn                                           |
|    2915 | trigger-head   | when SELF_OBJ enters                                  |
|    2395 | zone-ref       | exile                                                 |
|    2067 | zone-ref       | the battlefield                                       |
|    1960 | zone-ref       | your library                                          |
|    1953 | zone-ref       | your hand                                             |
|    1639 | cost           | SYM                                                   |
|    1488 | zone-ref       | your graveyard                                        |
|    1156 | structural-gap | layout \<X\> is not in grammar v0 (multi-faced cards) |
|     894 | effect-opaque  | Enchant creature                                      |
|     832 | target-filter  | target creature                                       |
|     794 | effect-pattern | COUNTERS(subject=SUBJECT_OTHER)                       |
|     706 | cost           | SYM, SYM                                              |
|     666 | trigger-head   | at the beginning of your upkeep                       |
|     663 | target-filter  | any target                                            |

The `condition` category never reaches any Target's top 15 — its own
distribution is the "almost perfectly flat tail" `condition.ts`'s own
docstring describes from issue #2698 (1,113 cards behind 1,086 distinct
fragments at the LINE level); this clause-level pass reproduces that same
shape independently.

## 3. Greedy/frequency curves: ready% at K, ordering × Target

K ∈ {25, 50, 100, 200, 400, 800}, three fixed orderings (by premodern / by
cube / by corpus blocking count), ready% reported against ALL four Targets
per (ordering, K) — `100 × (already-ready + newly-ready-under-top-K) / total`
for that Target:

| ordering  |   K | premodern |  cube | tier1 | corpus |
| --------- | --: | --------: | ----: | ----: | -----: |
| premodern |  25 |     13.6% |  6.8% | 19.7% |   8.7% |
| premodern |  50 |     17.3% |  8.5% | 23.1% |  10.5% |
| premodern | 100 |     22.2% | 10.3% | 29.1% |  12.1% |
| premodern | 200 |     27.1% | 19.4% | 37.6% |  14.5% |
| premodern | 400 |     35.6% | 23.6% | 45.3% |  17.1% |
| premodern | 800 |     45.6% | 26.2% | 52.1% |  19.9% |
| cube      |  25 |     11.9% | 21.8% | 24.8% |  11.5% |
| cube      |  50 |     13.3% | 25.1% | 31.6% |  12.5% |
| cube      | 100 |     14.7% | 27.7% | 35.0% |  13.7% |
| cube      | 200 |     17.4% | 33.4% | 38.5% |  15.6% |
| cube      | 400 |     18.7% | 42.6% | 40.2% |  16.3% |
| cube      | 800 |     21.2% | 72.7% | 46.2% |  18.7% |
| corpus    |  25 |     11.9% | 10.1% | 17.1% |  11.4% |
| corpus    |  50 |     13.8% | 11.1% | 18.8% |  13.0% |
| corpus    | 100 |     17.4% | 19.6% | 29.1% |  16.0% |
| corpus    | 200 |     22.1% | 22.9% | 35.9% |  19.2% |
| corpus    | 400 |     27.0% | 26.6% | 41.0% |  23.4% |
| corpus    | 800 |     32.5% | 32.1% | 46.2% |  28.8% |

**Comparison with the ticket's quoted line-level (whole-line, crude-shape)
numbers**, same K, same premodern target: line-level 32.8% @ K=400, 54.1% @
K=1,600; clause-level (premodern-ordered) 35.6% @ K=400, and (not directly
comparable at K=1,600, outside this ticket's K list, but monotonically
continuing past 45.6% @ K=800). So at K=400 the clause split is a **real but
modest** improvement over the line-level number for premodern (+2.8 points)
— composition helps, but not dramatically, because (Caveat 2 above) a
card's full gap-line requirement is a conjunction across several clause
categories, most of which (`trigger-head`, `target-filter`, `cost`) are
still open-vocabulary at the several-thousand-shape scale. For cube, the
clause-level number (72.7% @ K=800, cube-ordered) reads far BELOW the quoted
line-level 98.7% @ K=800 — explained in Caveat 3: cube's unparsed pool has
only 717 distinct gap LINES total, so line-level K=800 is closer to
exhaustive enumeration than to genuine rule-sharing, and decomposing into
smaller conjunctive clause pieces cannot beat exhaustive enumeration of an
already-small set.

## 4. Top-200 shape overlap: premodern vs. cube

```
top-200 overlap: 72 shapes in both premodern and cube top-200
cube-only among cube top-200: 128
```

Cube-only top-200 shapes, bucketed by the DOMINANT `layout` (Scryfall field,
`data/oracle-corpus.json.gz`) or type-line frame of the cube-unparsed cards
behind each shape:

| frame                | shapes |
| -------------------- | -----: |
| plain composition    |    113 |
| planeswalker loyalty |     11 |
| MDFC                 |      2 |
| transform (DFC)      |      1 |
| split-permanent      |      1 |

**128 cube-only shapes, 113 of them (88%) are plain composition** — ordinary
card text that simply doesn't rank highly for premodern (a card-legality
artifact: premodern's format cutoff predates most of these mechanics/cards
outright), not a special multi-face/planeswalker frame. Only 16 of the 128
(12%) are attributable to a genuinely different card-shape frame
(planeswalker loyalty abilities, MDFC, transform, split). This says the
premodern/cube divergence in item 4 is mostly about WHICH ordinary abilities
each pool prints, not about cube leaning on frames grammar v0 structurally
cannot parse yet (those show up as `structural-gap` shapes instead, already
visible in item 2's cube top-15: `land with a basic land type`, `layout "…"
is not in grammar v0`).

## 5. First 30 shapes, premodern and cube orderings

**`cnt` (cards blocked) is the count for the SHAPE — the normalised clause
text — not for the example line.** Each row: rank, cards blocked (in that
Target) by the shape, clause category, the **shape** itself (the normalised
clause text every one of those cards actually shares — this is the thing
being ranked), then one representative RAW example line containing that
shape (the most-frequent exact line contributing to it, weighted by that
line's own global corpus card count, not scoped to the Target — shown only
for readability, it is NOT what the count measures), and a Mechanics
Registry keyword-mention note (see Caveat 4). Row 1 below, for instance, is
blocked by the `end-of-turn` DURATION clause, not by "Landfall" — the example
line is just one of the 794 cards' lines that happens to contain that clause.

### First 30 premodern shapes

1. [794] (duration) shape: `end-of-turn` — e.g. `Landfall — Whenever a land you control enters, this creature gets +2/+2 until end of turn.` — no registry keyword mentioned; grammar-only gap.
2. [436] (cost) shape: `SYM` — e.g. `{T}: Add one mana of any color.` — no registry keyword mentioned; grammar-only gap.
3. [289] (effect-opaque) shape: `Enchant creature` — e.g. `Enchant creature` — mentions Enchant (implemented); grammar-only gap.
4. [282] (zone-ref) shape: `the battlefield` — e.g. `If this card is in your opening hand, you may begin the game with it on the battlefield.` — no registry keyword mentioned; grammar-only gap.
5. [228] (zone-ref) shape: `exile` — e.g. `Exile {self}.` — mentions Exile (implemented); grammar-only gap.
6. [213] (zone-ref) shape: `your library` — e.g. `You may look at the top card of your library any time.` — no registry keyword mentioned; grammar-only gap.
7. [201] (trigger-head) shape: `at the beginning of your upkeep` — e.g. `At the beginning of your upkeep, surveil 1.` — mentions Surveil (implemented); grammar-only gap.
8. [195] (trigger-head) shape: `when SELF_OBJ enters` — e.g. `When this creature enters, you get {E}{E} .` — no registry keyword mentioned; grammar-only gap.
9. [195] (zone-ref) shape: `your hand` — e.g. `Search your library for a card, put that card into your hand, then shuffle.` — mentions Search, Shuffle (implemented); grammar-only gap.
10. [185] (zone-ref) shape: `your graveyard` — e.g. `You may play lands from your graveyard.` — mentions Play (implemented); grammar-only gap.
11. [162] (cost) shape: `SYM, SYM` — e.g. `{1}, {T}: Add one mana of any color.` — no registry keyword mentioned; grammar-only gap.
12. [139] (effect-pattern) shape: `DESTROY(subject=SUBJECT_OTHER)` — e.g. `Destroy all enchantments.` — mentions Destroy (implemented); grammar-only gap.
13. [130] (target-filter) shape: `any target` — e.g. `{T}: Prevent the next 1 damage that would be dealt to any target this turn.` — no registry keyword mentioned; grammar-only gap.
14. [103] (effect-pattern) shape: `PUMP(subject=SUBJECT_OTHER)` — e.g. `Landfall — Whenever a land you control enters, this creature gets +2/+2 until end of turn.` — no registry keyword mentioned; grammar-only gap.
15. [99] (effect-pattern) shape: `DESTROY(subject=TARGET)` — e.g. `Destroy target attacking or blocking creature.` — mentions Destroy (implemented); grammar-only gap.
16. [99] (target-filter) shape: `target creature` — e.g. `Exile target creature.` — mentions Exile (implemented); grammar-only gap.
17. [97] (zone-ref) shape: `its owner's hand` — e.g. `When this Aura is put into a graveyard from the battlefield, return it to its owner's hand.` — no registry keyword mentioned; grammar-only gap.
18. [91] (effect-pattern) shape: `DEAL_DAMAGE(from=SELF,to=SUBJECT_OTHER)` — e.g. `{self} deals 3 damage to each creature.` — no registry keyword mentioned; grammar-only gap.
19. [89] (effect-pattern) shape: `DEAL_DAMAGE(from=SUBJECT_OTHER,to=TARGET)` — e.g. `When this land enters, it deals 1 damage to target opponent.` — no registry keyword mentioned; grammar-only gap.
20. [88] (effect-pattern) shape: `RETURN(subject=SUBJECT_OTHER,zone=ZONE_KNOWN)` — e.g. `When this Aura is put into a graveyard from the battlefield, return it to its owner's hand.` — no registry keyword mentioned; grammar-only gap.
21. [87] (cost) shape: `SYM SYM` — e.g. `{4}{W}: Creatures you control get +1/+1 until end of turn.` — no registry keyword mentioned; grammar-only gap.
22. [87] (effect-opaque) shape: `Counter TARGET_SLOT` — e.g. `Counter target spell.` — mentions Counter (implemented); grammar-only gap.
23. [73] (effect-opaque) shape: `Cycling SYM` — e.g. `Cycling {2}` — mentions Cycling (implemented); grammar-only gap.
24. [66] (cost) shape: `SYM, Sacrifice SELF_OBJ` — e.g. `{T}, Sacrifice this artifact: Add one mana of any color.` — mentions Sacrifice (implemented); grammar-only gap.
25. [66] (effect-pattern) shape: `DEAL_DAMAGE(from=SUBJECT_OTHER,to=SUBJECT_OTHER)` — e.g. `Create a 0/1 black Wizard creature token with "Whenever you cast a noncreature spell, this token deals 1 damage to each opponent."` — mentions Cast, Create (implemented); grammar-only gap. (Splitter limitation: this shape comes from the DAMAGE pattern matching a sentence inside the token's own QUOTED granted-ability text, not a top-level sentence of the printed card — see Caveats.)
26. [55] (cost) shape: `SYM SYM, SYM` — e.g. `{1}{U}, {T}: Draw a card, then discard a card.` — mentions Discard (implemented); grammar-only gap.
27. [54] (effect-opaque) shape: `Enchanted creature gets N/N` — e.g. `Enchanted creature gets +1/+1.` — no registry keyword mentioned; grammar-only gap.
28. [51] (trigger-head) shape: `when SELF_OBJ dies` — e.g. `When this creature dies, create a Treasure token.` — mentions Create (implemented); grammar-only gap.
29. [50] (effect-opaque) shape: `Protection from COLOR` — e.g. `Protection from black` — mentions Protection (implemented); grammar-only gap.
30. [49] (cost) shape: `Sacrifice SELF_OBJ` — e.g. `Sacrifice this Aura: Regenerate enchanted creature.` — mentions Regenerate, Sacrifice (implemented); grammar-only gap.

### First 30 cube shapes

1. [80] (zone-ref) shape: `exile` — e.g. `Exile {self}.` — mentions Exile (implemented); grammar-only gap.
2. [61] (zone-ref) shape: `your library` — e.g. `You may look at the top card of your library any time.` — no registry keyword mentioned; grammar-only gap.
3. [53] (trigger-head) shape: `when SELF_OBJ enters` — e.g. `When this creature enters, you get {E}{E} .` — no registry keyword mentioned; grammar-only gap.
4. [51] (zone-ref) shape: `your hand` — e.g. `Search your library for a card, put that card into your hand, then shuffle.` — mentions Search, Shuffle (implemented); grammar-only gap.
5. [50] (zone-ref) shape: `the battlefield` — e.g. `If this card is in your opening hand, you may begin the game with it on the battlefield.` — no registry keyword mentioned; grammar-only gap.
6. [44] (duration) shape: `end-of-turn` — e.g. `Landfall — Whenever a land you control enters, this creature gets +2/+2 until end of turn.` — no registry keyword mentioned; grammar-only gap.
7. [41] (cost) shape: `SYM` — e.g. `{T}: Add one mana of any color.` — no registry keyword mentioned; grammar-only gap.
8. [40] (structural-gap) shape: `land with a basic land type — intrinsic mana ability (CR 305.6) is not in grammar v0` — e.g. (same text; this category's "example" is always its own reason string) — no registry keyword mentioned; grammar-only gap.
9. [35] (zone-ref) shape: `your graveyard` — e.g. `You may play lands from your graveyard.` — mentions Play (implemented); grammar-only gap.
10. [21] (cost) shape: `N` — e.g. `+1: Draw a card.` — no registry keyword mentioned; grammar-only gap. (This is a planeswalker loyalty-ability cost line, `+1:` — see item 4.)
11. [19] (structural-gap) shape: `layout <X> is not in grammar v0 (multi-faced cards)` — e.g. `layout "front_card" is not in grammar v0 (multi-faced cards)` — no registry keyword mentioned; grammar-only gap.
12. [16] (effect-opaque) shape: `ZONE_SLOT TARGET_SLOT` — e.g. `When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.` — mentions Exile (implemented); grammar-only gap.
13. [15] (target-filter) shape: `any target` — e.g. `{T}: Prevent the next 1 damage that would be dealt to any target this turn.` — no registry keyword mentioned; grammar-only gap.
14. [14] (effect-opaque) shape: `Counter TARGET_SLOT` — e.g. `Counter target spell.` — mentions Counter (implemented); grammar-only gap.
15. [13] (effect-opaque) shape: `Add N mana of any color` — e.g. `{T}: Add one mana of any color.` — no registry keyword mentioned; grammar-only gap.
16. [13] (target-filter) shape: `target creature` — e.g. `Exile target creature.` — mentions Exile (implemented); grammar-only gap.
17. [13] (trigger-head) shape: `whenever SELF_OBJ attacks` — e.g. `Whenever this creature attacks, it gets +2/+0 until end of turn.` — no registry keyword mentioned; grammar-only gap.
18. [12] (effect-pattern) shape: `COUNTERS(subject=SUBJECT_OTHER)` — e.g. `Whenever this creature deals combat damage to a player, put a +1/+1 counter on it.` — mentions Counter (implemented); grammar-only gap.
19. [12] (effect-pattern) shape: `DRAW(player=PLAYER_YOU)` — e.g. `When this artifact is put into a graveyard from the battlefield, draw a card.` — no registry keyword mentioned; grammar-only gap.
20. [11] (cost) shape: `SYM, Pay N life, Sacrifice SELF_OBJ` — e.g. `{T}, Pay 1 life, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield, then shuffle.` — mentions Sacrifice, Search, Shuffle (implemented); grammar-only gap.
21. [11] (cost) shape: `SYM, SYM` — e.g. `{1}, {T}: Add one mana of any color.` — no registry keyword mentioned; grammar-only gap.
22. [11] (zone-ref) shape: `the bottom of your library` — e.g. `Look at the top two cards of your library. Put one of them into your hand and the other on the bottom of your library.` — no registry keyword mentioned; grammar-only gap.
23. [10] (cost) shape: `SYM, Sacrifice SELF_OBJ` — e.g. `{T}, Sacrifice this artifact: Add one mana of any color.` — mentions Sacrifice (implemented); grammar-only gap.
24. [10] (effect-opaque) shape: `Search ZONE_SLOT for N BASICLAND or BASICLAND card, put it onto ZONE_SLOT, then shuffle` — e.g. `{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.` — mentions Sacrifice, Search, Shuffle (implemented); grammar-only gap.
25. [10] (effect-opaque) shape: `This land enters tapped unless you control N or fewer other lands` — e.g. `This land enters tapped unless you control two or fewer other lands.` — no registry keyword mentioned; grammar-only gap.
26. [10] (effect-pattern) shape: `DESTROY(subject=TARGET)` — e.g. `Destroy target attacking or blocking creature.` — mentions Destroy (implemented); grammar-only gap.
27. [9] (trigger-head) shape: `at the beginning of your upkeep` — e.g. `At the beginning of your upkeep, surveil 1.` — mentions Surveil (implemented); grammar-only gap.
28. [8] (effect-pattern) shape: `DEAL_DAMAGE(from=SUBJECT_OTHER,to=PLAYER_YOU)` — e.g. `{T}: Add {U} or {R}. This land deals 1 damage to you.` — no registry keyword mentioned; grammar-only gap.
29. [8] (target-filter) shape: `target artifact` — e.g. `You may tap or untap target artifact, creature, or land.` — no registry keyword mentioned; grammar-only gap.
30. [8] (target-filter) shape: `target spell unless its controller pays SYM` — e.g. `Counter target spell unless its controller pays {2}.` — mentions Counter (implemented); grammar-only gap.

**Every one of these 60 rows is a "grammar-only gap" or a structural (layout)
gap** — none is blocked by a `planned` (unimplemented) Mechanics Registry
keyword. The one clear counter-example found while checking this claim is
`Monstrosity` (`status: "planned"`, i.e. an actual ENGINE gap, not a grammar
one): its own clause shape, `("effect-opaque", "Monstrosity N")`, blocks 0
premodern cards (Monstrosity is a Theros/2013+ mechanic, after premodern's
format cutoff), 1 cube card, and 29 corpus cards — ranked #314 of 29,857 in
the corpus ordering, nowhere near either Target's top 30. So the finding
holds for the top of both rankings: for premodern and cube specifically, the
blocking factor is overwhelmingly the GRAMMAR's own vocabulary
(trigger-head/target-filter/zone-ref/cost phrase tables), not missing engine
capability — matching the repo's own framing (`CLAUDE.md` "Implemented
engine capabilities" — most mechanics are supported). A genuine
engine-capability gap (Monstrosity) exists in the corpus but sits far down
the ranking for these two Targets specifically.

## Reproduce

```bash
# 1. Docs worktree (branch: docs/grammar-rule-census -- wt:docs named it that,
#    not research/grammar-rule-census; see the issue comment for the branch).
cd /Users/filippo/code/mtg/tolaria && bun run wt:docs grammar-rule-census

# 2. The corpus cache is gitignored -- generate or copy it in.
cd /Users/filippo/code/mtg/tolaria-wt-grammar-rule-census
bun run oracle:corpus   # or: cp /path/to/a/checkout/with/it/data/oracle-corpus.json.gz data/

# 3. Run the census.
python3 docs/research/scripts/grammar-rule-census.py
```

No network access, no `bun run test`/`check:all` (this is a read-only
analysis script over already-generated lockfiles). Runtime ~2.5s.
