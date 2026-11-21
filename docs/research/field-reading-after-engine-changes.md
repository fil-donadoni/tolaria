# The field after the engine changes: decisions recovered (issue #10028)

> **Dated:** 2026-11-21. Field window: 2026-11-19 14:43 to 2026-11-21 14:53
> (Rome). The window opens at the release that carried PR #10100 (issue
> #10026) and PR #10103 (issue #10025), `main` at `034f9f4c1`. The phone row
> opens at the release that carried PR #10324 (issue #10320), `main` at
> `cc6f4016c`, on 2026-11-21 at about 11:30. Census at `fc6726aa0` (all seven
> arms on one sha). Slice of PRD issue #10017. The note it is read against is
> `brain-search-in-the-field.md` (2026-11-16, at `a245582e4`). The census it
> is diffed against is `blade-at-field-budgets.md` (2026-11-16, at
> `b23d69e05`).

**Question.** Two engine changes shipped: state-based actions are checked only
on what a move changed (issue #10025), and the search allocates less per
iteration (issue #10026). Did real games get deeper searches? And which of the
`must` decisions that the 2026-11-16 field budgets lost does the Bot now make
at the new ones?

**Verdict up front.**

1. **Chromium and Gecko search deeper in the field.** Iterations per search
   went from 313 to **387** in Chromium (+24%) and from 71 to **94** in Gecko
   (+32%). The median report's milliseconds per iteration fell from 13.2 to
   9.5 in Chromium and from 71.4 to 50.1 in Gecko. The clock still ends the
   search: 528 of 531 searches (99%) stopped on the time cap.
2. **Desktop WebKit reads 160, not 200, and the drop is not attributed to the
   engine.** The 2026-11-16 WebKit row of 200 mixed one iPhone game with one
   Mac game. All five desktop WebKit games in this window were played on
   2026-11-20 between 18:25 and 19:03, while the owner's MacBook ran 23–40
   minutes of post-merge Bot-play replays per game window (§ 3). The engine
   share of the change is not measured here.
3. **The first phone figure: an iPhone completes 309 iterations per search.**
   That is one game (`mobile: true`, iOS, 3–4 cores, 23% of `expert`'s 1320).
   One game is under the two-game floor, so it is indicative only and gets no
   census arm.
4. **The decisions recovered.** At Gecko's new budget (94), 16 of the 40
   entries that the 71-iteration arm lost are kept, 6 of them solid. 13 of
   the 16 (4 solid) come back from depth alone: they are still red at 71 on
   the same sha. Chromium at 387 keeps 2 of its 7 losses, both thin, and both green at
   313 on the same sha too, so the depth did not recover them. At WebKit's
   lower desktop budget (160), 3 losses are kept and 8 are new. The
   solid-flip count, the figure a speed-up should move, went from 2 to 1 for
   Chromium, 7 to 5 for WebKit and 18 to 16 for Gecko.
5. **Main-phase sequencing is still what the field Bot loses most.** It
   accounts for 6 of 6 flips at 387, 12 of 16 at 160 and 25 of 33 at 94. At
   94, choice-on-resolution loses as large a share of its entries (5 of 73,
   6.8%) as main-phase sequencing does (25 of 365, 6.8%). 3 of those 5
   entries are blade entries newer than the 2026-11-16 census.

## Sources

`message:"bot search"` in Sentry's log explorer (org `filippo-donadoni`), read
on 2026-11-21: one structured report per vs-Bot game from the driver
(`src/lib/ai/bot-search-telemetry.ts`). The window holds 20 reports from 17
games, all at `expert` (1320 iterations, 3300 ms). The 2026-11-19 morning
reports (five Chromium games, three of them on Windows) come before the
release and are not read. Sums are taken by `gameId` first, as in the
2026-11-16 note: three games sent two reports each.

**Minimum before a conclusion:** two games per engine family, the floor the
owner set on 2026-11-16. Chromium (8 games), desktop WebKit (5) and Gecko (3)
clear it. The phone (1) does not.

## 1. The Bot's search, by device class

| engine         | games | searches | stopped by time | iterations completed / requested, pooled | median game | range         | iterations per search | ms per iteration, median report p50 |
| -------------- | ----- | -------- | --------------- | ---------------------------------------- | ----------- | ------------- | --------------------- | ----------------------------------- |
| Chromium       | 8     | 262      | 261 (100%)      | 0.293                                    | 0.306       | 0.131 – 0.452 | 387                   | 9.5                                 |
| WebKit desktop | 5     | 124      | 122 (98%)       | 0.121                                    | 0.128       | 0.068 – 0.203 | 160                   | 28.1                                |
| Gecko          | 3     | 136      | 136 (100%)      | 0.071                                    | 0.077       | 0.032 – 0.135 | 94                    | 50.1                                |
| phone (iOS)    | 1     | 9        | 9 (100%)        | 0.234                                    | —           | —             | 309                   | 11.6                                |

Against the 2026-11-16 note (§ 1 there):

| engine   | iterations per search, 11-16 → 11-21 | pooled ratio  | ms per iteration, median report p50 |
| -------- | ------------------------------------ | ------------- | ----------------------------------- |
| Chromium | 313 → 387 (+24%)                     | 0.237 → 0.293 | 13.2 → 9.5                          |
| WebKit   | 200 ¹ → 160 desktop, 309 phone       | 0.152 → 0.121 | 16.7 → 28.1                         |
| Gecko    | 71 → 94 (+32%)                       | 0.054 → 0.071 | 71.4 → 50.1                         |

¹ One iPhone game and one Mac game pooled; the 2026-11-16 reports could not
tell them apart.

Per game:

| game     | engine   | os    | reports | consults | searches | ratio | iterations per search | ms per iteration p50, per report |
| -------- | -------- | ----- | ------- | -------- | -------- | ----- | --------------------- | -------------------------------- |
| jn73r49s | chromium | macos | 1       | 23       | 19       | 0.452 | 597                   | 5.27                             |
| jn7dy8z5 | chromium | macos | 1       | 18       | 14       | 0.392 | 517                   | 7.19                             |
| jn7fdc6m | chromium | macos | 1       | 80       | 76       | 0.335 | 443                   | 9.46                             |
| jn76zfye | chromium | macos | 1       | 41       | 35       | 0.312 | 412                   | 9.01                             |
| jn7cvvcv | chromium | macos | 2       | 45       | 44       | 0.300 | 397                   | 9.27 / 13.23                     |
| jn7c3e6e | chromium | macos | 1       | 43       | 39       | 0.210 | 277                   | 12.64                            |
| jh73s2rn | chromium | macos | 1       | 13       | 12       | 0.151 | 200                   | 12.96                            |
| jh7cqv7g | chromium | macos | 1       | 30       | 23       | 0.131 | 174                   | 20.98                            |
| jh77gssh | webkit   | macos | 1       | 7        | 6        | 0.203 | 268                   | 11.63                            |
| jh79vt5w | webkit   | macos | 1       | 39       | 34       | 0.151 | 199                   | 28.07                            |
| jh7fe723 | webkit   | macos | 1       | 43       | 38       | 0.128 | 169                   | 41.91                            |
| jh743am0 | webkit   | macos | 1       | 18       | 12       | 0.122 | 161                   | 22.64                            |
| jh7cwhzz | webkit   | macos | 1       | 37       | 34       | 0.068 | 90                    | 44.66                            |
| jh79z3nx | webkit   | ios   | 1       | 11       | 9        | 0.234 | 309                   | 11.56                            |
| jh7fyg4x | gecko    | macos | 1       | 34       | 28       | 0.135 | 178                   | 21.32                            |
| jh73x8ad | gecko    | macos | 2       | 60       | 54       | 0.077 | 102                   | 17.19 / 50.06                    |
| jh7396nx | gecko    | macos | 2       | 60       | 54       | 0.032 | 42                    | 342.27 / 471.88                  |

What else the reports say:

- **No consult failed.** None of the five failure attributes
  (`consults.timeout`, `.worker-error`, `.search-error`, `.inline`, `.no-move`)
  exists in the window: Sentry reports each one "unknown".
- **One game ran past the 5000 ms consult timeout without being counted as a
  timeout.** In jh7396nx (Gecko), `consultMs.max` is 5046 and `searchMs.max`
  is 4966. Its second report's first search took 3567 ms for a single
  iteration (`msPerIteration.first`), and its p90 is 925–1658 ms per
  iteration. Every other game keeps `searchMs.max` at or under 3639 ms. Why
  the consult was not counted as a timeout was not checked here.
- **Two searches stopped on the iteration count** (one in Chromium jn7dy8z5,
  one in WebKit jh79vt5w) **and one settled early** (jh79vt5w).
- **The player still waits the whole cap.** `consultMs.p50` is 3308–3651 ms in
  every report.

## 2. The census at the new field budgets

`bun run blade:census` over the whole `must` tier: 629 entries, 3045 (entry,
seed) jobs per arm, on the hosted `blade-census.yml` matrix. All seven arms
ran at `fc6726aa0` and were dispatched on 2026-11-21 at 15:03. Every merge job
succeeded.

| arm      | budget                     | run         | red seeds | flipped entries | solid (≥ half seeds) | chose `pass` on every red seed |
| -------- | -------------------------- | ----------- | --------- | --------------- | -------------------- | ------------------------------ |
| base     | each entry's declared      | 44911926333 | 0         | —               | —                    | —                              |
| Chromium | `--iterations 387`         | 44911929570 | 9         | 6               | 1                    | 1                              |
| WebKit   | `--iterations 160`         | 44911932882 | 38        | 16              | 5                    | 5                              |
| Gecko    | `--iterations 94`          | 44911936054 | 83        | 33              | 16                   | 16                             |
| control  | `--iterations 313` (11-16) | 44911939251 | 10        | 5               | 2                    | 0                              |
| control  | `--iterations 200` (11-16) | 44911943128 | 33        | 11              | 6                    | 0                              |
| control  | `--iterations 71` (11-16)  | 44911946563 | 114       | 45              | 22                   | 27                             |

**Why the three control arms.** The blade moved between the two census shas:
it has 28 more `must` entries, and the Bot changed. A loss recovered at the
new budget could therefore come from more depth or from code that changed in
between. The control arms re-run the 2026-11-16 budgets on the new sha. An
entry lost on 2026-11-16 and kept at the new budget comes **back from depth**
when the control arm still loses it, and **back from code or noise** when the
control arm keeps it too.

Pairing, flip definitions and decision kinds are those of
`blade-at-field-budgets.md` § Method, run unchanged: its `classify.mjs` and
`compare.mjs`. At this sha `classify.mjs` builds all 629 entries.

### Flips by decision kind

Entries flipped (flipped seeds / those entries' seeds); share of the kind's
entries in brackets. The population at `fc6726aa0` is in the second column.

| kind                    | entries | 387             | 160               | 94                 |
| ----------------------- | ------- | --------------- | ----------------- | ------------------ |
| `main-phase-sequencing` | 365     | 6 (9/33) [1.6%] | 12 (22/60) [3.3%] | 25 (51/130) [6.8%] |
| `choice-on-resolution`  | 73      | —               | 1 (2/5) [1.4%]    | 5 (19/25) [6.8%]   |
| `instant-speed-timing`  | 80      | —               | 2 (6/10) [2.5%]   | 2 (7/10) [2.5%]    |
| `combat`                | 43      | —               | 1 (8/8) [2.3%]    | 1 (6/8) [2.3%]     |
| `response-to-stack`     | 49      | —               | —                 | —                  |
| `targeting`             | 19      | —               | —                 | —                  |
| **all**                 | **629** | **6 (9/33)**    | **16 (38/83)**    | **33 (83/173)**    |

The one combat flip, at 160 and at 94, is "free attack: holds a blocker back
against a lethal crack-back". That entry is newer than the 2026-11-16 census,
so "combat loses nothing" is not contradicted on the entries that census held.

## 3. Recovered and still lost, against issue #10021

"Field" is the new budget; "control" is the 2026-11-16 budget on the new sha.
Flip counts are red seeds over seeds.

### Chromium — 313 → 387

Recovered (2), both thin and both green in the control too, so neither is
depth's doing:

| kind                    | entry                                                                                          | 11-16 | control 313 |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ----- | ----------- |
| `main-phase-sequencing` | comparative each-step trigger: without the Oath of Druids, Oko's +1 on its own Chromatic Star… | 1/5   | green       |
| `response-to-stack`     | self-harm: Fatal Push still destroys the opponent's mana value 4 creature beside the Bot's own | 1/7   | green       |

Still lost (5): Snapcaster Mage holding on turn 4 with an empty graveyard
(4/4 → 3/4, the one solid loss left), the Oracle combo (2/5 → 1/5), prowess
holding the instant (2/5 → 2/5), Terror at the Runeclaw Bear (2/4 → 1/4), Show
and Tell for the opponent's fatty (2/10 → 1/10). Each one still makes the same
wrong pick as on 2026-11-16.

Newly lost (1): Conspire copying Burn Trail for lethal, 1/5, `pass`, and green
in the control at 313.

### WebKit — 200 → 160 (desktop)

The field budget fell, so this row measures a loss, not a recovery.

Recovered (3): Snapcaster Mage on turn 4 (3/4 on 11-16, 2/4 in the control,
green at 160), Oko's +1 (2/5, control green) and Mind Rot (1/5, control green).
None of them is monotone in the budget.

Still lost (8): Trinisphere pricing (4/4 → 4/4), Dismember's toughness cap
(5/5 → 4/5), Summoner's Pact (5/5 → 5/5), Caustic Bronco's saddle (2/5 → 2/5),
the Oracle combo, prowess, Runeclaw Bear and Show and Tell (each 1–2 seeds).

Newly lost (8):

| kind                    | entry                                                                                  | field 160 | control 200 | in 11-16 census |
| ----------------------- | -------------------------------------------------------------------------------------- | --------- | ----------- | --------------- |
| `combat`                | free attack: holds a blocker back against a lethal crack-back                          | 8/8       | 7/8         | no (new entry)  |
| `main-phase-sequencing` | graveyard engine: escapes the Black Lotus whose permanent outweighs the option         | 2/3       | green       | yes             |
| `choice-on-resolution`  | flip-walker may-pay: exiles the front face into its planeswalker when no creature can… | 2/5       | 1/5         | no (new entry)  |
| `main-phase-sequencing` | revolt: Fatal Push destroys the mana value 4 threat with revolt on                     | 2/5       | green       | yes             |
| `main-phase-sequencing` | removal: Shatter takes the artifact whose ability script outranks its floor            | 1/4       | green       | yes             |
| `instant-speed-timing`  | sacrifice outlet: Goblin Bombardment takes the blocked creature before it dies         | 1/5       | green       | yes             |
| `main-phase-sequencing` | evoke: Solitude is never evoked with no threat, spending two cards                     | 1/5       | green       | yes             |
| `main-phase-sequencing` | Conspire: taps two red creatures to copy Burn Trail for lethal                         | 1/5       | green       | yes             |

### Gecko — 71 → 94

Recovered (16). The 13 marked "depth" are still red in the control at 71:

| kind                    | entry                                                                                        | 11-16 | control 71 | by    |
| ----------------------- | -------------------------------------------------------------------------------------------- | ----- | ---------- | ----- |
| `main-phase-sequencing` | cast permission: casts a creature for free under Aluren with no lands                        | 5/5   | 5/5        | depth |
| `main-phase-sequencing` | flash permanent NEGATIVE CONTROL: still casts hasty Raging Kavu for lethal this turn         | 3/5   | 3/5        | depth |
| `main-phase-sequencing` | each-step return to hand: Disenchant takes the Sunken Hope that bounces only the bot's…      | 2/4   | 2/4        | depth |
| `choice-on-resolution`  | provoke pair: leaves a tapped large creature tapped                                          | 4/5   | 4/5        | depth |
| `main-phase-sequencing` | free mana: holds Mana Crypt at 3 life, its upkeep damage is lethal                           | 2/5   | 2/5        | depth |
| `main-phase-sequencing` | X into an ETB trigger: casts Wan Shi Tong, Librarian for all its mana                        | 2/5   | 1/5        | depth |
| `main-phase-sequencing` | strip: casts Thoughtseize at a castable Shivan Dragon                                        | 2/9   | 1/9        | depth |
| `main-phase-sequencing` | keyword relevance (protection): protection from red does not make the Runeclaw Bear…         | 1/4   | 1/4        | depth |
| `main-phase-sequencing` | each-step dig: Disenchant takes the Oath of Druids that digs only the opponent's Craw Wurms… | 1/4   | 1/4        | depth |
| `main-phase-sequencing` | Sacrifice-for-denial outlet: casts the creature                                              | 1/5   | 1/5        | depth |
| `main-phase-sequencing` | Self-growing sacrifice outlet: casts the creature                                            | 1/5   | 1/5        | depth |
| `main-phase-sequencing` | cast permission: casts Raven Familiar for free under Aluren with no lands                    | 1/5   | 1/5        | depth |
| `main-phase-sequencing` | land-type change: Reef Shaman makes a Forest to cast the green spell in hand                 | 1/10  | 1/10       | depth |
| `main-phase-sequencing` | Snapcaster Mage (issue #4217 reported position): holds it on turn 4 with an empty graveyard  | 2/4   | green      | code  |
| `response-to-stack`     | counterspell: Mana Drain holds against a Savannah Lions                                      | 3/5   | green      | code  |
| `response-to-stack`     | self-harm: Fatal Push still destroys the opponent's mana value 4 creature beside the Bot's…  | 1/7   | green      | code  |

Still lost (24), with each entry's flips going from 11-16 to now. The solid
ones: the discriminating library reveal (5/5 → 3/5), the known-top cantrip
dig (5/5 → 4/5), Trinisphere pricing (4/4 → 4/4), the Snapcaster flashback
kill (4/5 → 3/5), the Solitude evoke (4/5 → 5/5), the witnessed mill to the
Bolt (4/5 → 4/5), the Black Lotus escape (2/3 → 2/3), Summoner's Pact
(5/5 → 5/5), explore keeping the blank (4/5 → 4/5) and the morph (1/1 → 1/1).
The thin ones: the foretell (4/5 → 2/5), Conspire (3/5 → 1/5), the Oracle
combo, Hibernation, Entomb, Karma, Runed Arch, Sutured Ghoul, Wheel of
Fortune, both Toxic Deluge entries, Dismember, the Vindicate fan-out and
Sneak Attack (1–2 seeds each).

Newly lost (9):

| kind                    | entry                                                                           | field 94 | control 71 | in 11-16 census |
| ----------------------- | ------------------------------------------------------------------------------- | -------- | ---------- | --------------- |
| `combat`                | free attack: holds a blocker back against a lethal crack-back                   | 6/8      | 5/8        | no (new entry)  |
| `choice-on-resolution`  | flip-walker may-pay: exiles the front face into its planeswalker…               | 5/5      | 5/5        | no (new entry)  |
| `choice-on-resolution`  | as-enters choice: takes the haste when attacking now is lethal                  | 5/5      | 5/5        | no (new entry)  |
| `main-phase-sequencing` | sweep: Engineered Explosives clears three blockers before the Craw Wurm attacks | 5/5      | 5/5        | no (new entry)  |
| `choice-on-resolution`  | surveil: keeps a castable planeswalker on top                                   | 3/5      | 1/5        | no (new entry)  |
| `main-phase-sequencing` | removal: Shatter takes the artifact whose ability script outranks its floor     | 2/4      | 2/4        | yes             |
| `choice-on-resolution`  | scry: keeps two bombs on top of a deck of blanks                                | 2/5      | green      | yes             |
| `main-phase-sequencing` | prowess: Monastery Swiftspear holds the instant before attackers                | 1/5      | green      | yes             |
| `main-phase-sequencing` | land-type change: Reef Shaman stays untapped when Flame Slash cannot kill…      | 1/10     | green      | yes             |

Five of the nine are entries added after the 2026-11-16 census. All five are
solid at 94 and red in the control too: they are decisions the blade started
testing, not decisions the Bot stopped making.

## 4. Load: the owner's machines during the window

The owner's machines are also the pipeline's runners (ADR 0156), and **gates
ran on them through nearly every game in the window**. For each game, the
table below counts the job-minutes the owner's runners spent inside the
window [first report − 40 min, last report] (a game's start is not reported,
so 40 minutes is an assumed lead). It also includes the owner's local
`bun run release`, which ran on the MacBook from 10:33 to 11:31 (Rome) on
2026-11-21, with 39 minutes of the full test suite. Jobs on GitHub-hosted
runners are excluded.

| game     | engine   | when (Rome)       | owner-runner job-minutes in the window                                     |
| -------- | -------- | ----------------- | -------------------------------------------------------------------------- |
| jh73s2rn | chromium | 11-19 22:04       | macbook-pass 84, huawei-pass 27, macbook-lane 25 (AFK passes, queue-lane)  |
| jh7fyg4x | gecko    | 11-20 11:46       | none                                                                       |
| jh7fe723 | webkit   | 11-20 18:25       | macbook-maint 23, macbook-derive 6                                         |
| jh79vt5w | webkit   | 11-20 18:35       | macbook-maint 33, macbook-derive 6                                         |
| jh77gssh | webkit   | 11-20 18:37       | macbook-maint 35, macbook-derive 6                                         |
| jh743am0 | webkit   | 11-20 18:58       | macbook-maint 40, macbook-lane 11                                          |
| jh7cwhzz | webkit   | 11-20 19:03       | macbook-maint 40, macbook-lane 16                                          |
| jh73x8ad | gecko    | 11-21 11:31–11:40 | local release 39, macbook-lane 34                                          |
| jn7cvvcv | chromium | 11-21 11:37–11:38 | local release 34, macbook-lane 29                                          |
| jn7fdc6m | chromium | 11-21 11:47       | macbook-lane 24, local release 23                                          |
| jn7c3e6e | chromium | 11-21 12:04       | macbook-lane 23, macbook-derive 10, local release 6                        |
| jh7396nx | gecko    | 11-21 12:08–12:17 | macbook-derive 23, macbook-lane 20, macbook-maint 8                        |
| jn73r49s | chromium | 11-21 12:16       | macbook-derive 21, macbook-lane 12, macbook-maint 8                        |
| jn7dy8z5 | chromium | 11-21 12:25       | macbook-derive 30, macbook-lane 18, macbook-pass 6                         |
| jn76zfye | chromium | 11-21 12:35       | macbook-derive 37, macbook-lane 18, macbook-maint 6                        |
| jh7cqv7g | chromium | 11-21 14:34       | macbook-lane 29, macbook-maint 18                                          |
| jh79z3nx | iPhone   | 11-21 14:53       | macbook-lane 29 (another device's load; the phone's own CPU is not shared) |

`macbook-lane` runs `queue-lane` and `health` (the gates). `macbook-maint`
runs post-merge housekeeping and the **Bot-play replay on the base**, which
took up the WebKit evening. `macbook-derive` runs `derive:sync`, and
`macbook-pass` and `huawei-pass` run AFK `/next-ticket` passes.

The reports do not say which machine a desktop game was played on. If it was
the MacBook, every desktop game but jh7fyg4x searched on a loaded machine. The
one unloaded Gecko game is also the deepest Gecko game (178 iterations per
search). The slowest one, jh7396nx (42), ran in the busiest stretch. That fits
load explaining part of the spread within a family, but it is two points, not
a measurement. **No conclusion above separates the engine changes from
machine load.** The Chromium and Gecko gains are read under at least as much
load as the 2026-11-16 games had, which carried no load figure at all.

## What this says, and what it does not

- **The engine changes reached real games in Chromium and Gecko.** Both
  families search a quarter to a third deeper, and Gecko's deeper search
  brings back 13 of the decisions its old budget lost, 4 of them solid.
- **Gecko is still where the field Bot loses most**: 16 solid losses at 94
  against 1 at 387. A Firefox player still faces a Bot that fails about one
  tested main-phase decision in fifteen (25 of 365).
- **WebKit's desktop figure needs a quiet reading.** Five games played back to
  back during a Bot-play replay are the only desktop WebKit sample. The
  2026-11-16 comparison row was half a phone.
- **The phone is now visible**: `mobile: true` reached Sentry from an iPhone
  once PR #10324 shipped. At 309 iterations per search, one game sits between
  desktop WebKit and Chromium. Its single game is below the floor.
- **Not measured:** device diversity (every desktop report is in the `5-8` core
  bucket, on one owner's machines), each family's spread (the census runs the
  pooled figure, not the range), and the `stretch` tier.

## Reproduce

Field figures: the Sentry query in `brain-search-in-the-field.md`
§ Reproduce, over the window above. Typed attributes are read as
`tags[<key>,number]`, and `device.mobile` as `tags[device.mobile,boolean]`
(the untyped name reads "unknown").

Census: the seven arms on one sha, then the pairing scripts of
`blade-at-field-budgets.md` § Reproduce, unchanged:

```bash
SHA=fc6726aa0434c9d27fb5b168c9d04aef9461cfd8
gh workflow run blade-census.yml -f ref=$SHA -f tier=must            # base
for n in 387 160 94 313 200 71; do
  gh workflow run blade-census.yml -f ref=$SHA -f tier=must -f iterations=$n
done
gh run download <run> -n blade-census          # one per arm → base.json, f387.json, …
git checkout $SHA
bun classify.mjs kinds.json                    # 629 must entries, 0 unbuilt
bun compare.mjs kinds.json base.json f387.json f160.json f94.json \
    f313.json f200.json f71.json > compare.json
jq -r '.arms[] | "\(.meta.iterations): \(.newReds | length) flips"' compare.json
```

The § 3 tables pair `compare.json`'s arms with the three flipped-entry tables
of `blade-at-field-budgets.md`, matching by label: recovered = in the old
table and not in the new arm's `newReds`; still lost = in both; newly lost =
only in the new arm. The control column is the same lookup in the arm at the
old budget.
