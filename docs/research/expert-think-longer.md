# What a longer think buys: the presets' caps from the field, and the owner's ruling (issue #10027)

> **Dated:** 2026-11-17, read at `713841e9d`. Field figures are the 28
> `bot search` reports of `brain-search-in-the-field.md` (logged 2026-11-15
> 09:10 – 2026-11-16 16:38 Rome), re-queried on 2026-11-17 over 14 days: no
> report has arrived since, so the dataset is the same. Decision figures are
> the census of `blade-at-field-budgets.md` (at `b23d69e05`). Constants are
> read at `713841e9d`. Slice 3 of PRD issue #10017.

**Question.** Should `expert` think longer than its 3300 ms? How many
iterations would each extra second buy in each engine family? How much room
is left under the 5000 ms consult timeout? Which lost decisions would those
iterations win back? And what separates `medium`, `hard` and `expert` when the
clock ends almost every search?

**Verdict up front.**

1. **One extra second buys about 95 iterations in Chromium, 61 in WebKit and
   22 in Gecko.**
2. **Under today's consult timeout there is no room for a longer think.** The
   worst consult measured ran 1358 ms past its 3300 ms cap: it was a late-game
   Gecko search where one iteration cost about a second. That leaves 342 ms.
   No cap above about 3640 ms survives that consult. Up to that ceiling, the
   extra time buys at most 9% more iterations, which the census cannot tell
   apart from its own seed noise.
3. **Winning back the census's lost decisions needs caps beyond the timeout
   at today's engine speed.** Going from one census arm to the next takes
   4.2 s (Chromium, 313 → 400 iterations), 5.2 s (WebKit, 200 → 313) or 9.3 s
   (Gecko, 71 → 200).
4. **In the field, `hard` is `expert` with 9% fewer iterations.** The census
   cannot tell the two apart. `medium` searches about half as deep.
5. **The ruling.** `expert` is the level that guarantees quality, and it must
   reach **400 iterations per search on every engine family**. Brain
   performance work comes first, slow engines above all. The difficulty
   levels are switched off for now. The blade reports performance and
   saturation separately from correctness. The consult timeout and the
   watchdog are derived from the cap. The Bot must hold up on a weak line and
   a weak client.

## 1. Iterations per extra second, per engine family

The search stops at its iteration budget or at its time cap, whichever comes
first. In the field 98% of searches stopped on the time cap
(`brain-search-in-the-field.md` § 1). So the cap is the knob that matters, and
iterations grow linearly with it. The rate below is iterations completed per
search divided by the 3.3 s cap, pooled over every search of the family.

| engine   | searches | iterations per search | iterations per second, pooled | per game, median | per game, range |
| -------- | -------- | --------------------- | ----------------------------- | ---------------- | --------------- |
| Chromium | 338      | 313                   | **94.8**                      | 83.1             | 45 – 286        |
| WebKit   | 64       | 200                   | **60.7**                      | 58.9             | 45 – 73         |
| Gecko    | 227      | 71                    | **21.6**                      | 20.9             | 13 – 57         |

This is a lower bound for Chromium: its 15 searches that stopped on the
iteration count are counted at the full 3.3 s. It is also an average rate,
not a marginal one. The reports carry no figures from inside a search, so
nothing here can show whether later iterations cost more than earlier ones.
WebKit is two games, one of them on a phone (field note § 4), and is
indicative only.

At the same rates, iterations per search under each cap:

| cap (ms) | Chromium | WebKit | Gecko |
| -------- | -------- | ------ | ----- |
| 1000     | 95       | 61     | 22    |
| 1500     | 142      | 91     | 32    |
| 2000     | 190      | 121    | 43    |
| 3000     | 284      | 182    | 65    |
| 3300     | 313      | 200    | 71    |
| 3600     | 341      | 218    | 78    |
| 4000     | 379      | 243    | 86    |
| 4500     | 427      | 273    | 97    |

## 2. The margin under the consult timeout

A consult that has not answered within `BRAIN_CONSULT_TIMEOUT_MS` (5000 ms,
`src/lib/ai/brain-client.ts`) resolves "no move". The driver's watchdog then
takes over: `BOT_WATCHDOG_MS` is 6000 ms, its ladder has five rungs, and the
last rung hands the window to the server (`src/hooks/useVsAiDriver.ts`). The
decision is lost.

A consult lasts longer than its cap. The search checks the clock only
between iterations (`convex/gre/search.ts`), so the iteration in flight when
the cap passes runs to its end. The Worker's transport comes on top. Neither
part depends on the cap, so the worst consult at cap _C_ is _C_ plus the worst
overrun measured:

| engine   | worst `searchMs.max` | worst `consultMs.max` | overrun past the 3300 ms cap | report                      |
| -------- | -------------------- | --------------------- | ---------------------------- | --------------------------- |
| Chromium | 3629                 | 3658                  | 358                          | jh7334vv, 36 ms/iteration   |
| WebKit   | 3445                 | 3472                  | 172                          | jh74q517, 46 ms/iteration   |
| Gecko    | 4294                 | 4658                  | **1358**                     | jh74dkfv, 1074 ms/iteration |

Margin under the 5000 ms timeout, by candidate cap (5000 − cap − overrun):

| cap (ms) | Chromium | WebKit | Gecko    |
| -------- | -------- | ------ | -------- |
| 3300     | 1342     | 1528   | 342      |
| 3600     | 1042     | 1228   | 42       |
| 4000     | 642      | 828    | **−358** |
| 4500     | 142      | 328    | −858     |

- **Gecko's worst consult sets the ceiling at about 3640 ms.** That consult
  is the last of the three reports of game jh74dkfv: 3 searches at the end of
  a game, where one iteration cost about a second. It is a single game. Its
  next-worst Gecko report overran by 765 ms (jh79ywfg), which would put the
  ceiling near 4200 ms. Even then, the gain stays inside the census's noise
  (§ 3).
- **The timeout test reserves less than the field has already used.**
  `brain-client-timeout.bot.test.ts` asserts timeout − hardest cap ≥ 1000 ms.
  The field overran by 1358 ms. With today's constants no consult failed:
  723 consults carried no timeout (field note § 1). A cap of 4000 ms, which
  the test allows, would have failed that Gecko consult.

## 3. What the census says a candidate cap would win back

The census (`blade-at-field-budgets.md`) has arms at 71, 200 and 313
iterations, plus each entry's declared budget (421 of the 601 `must` entries
declare 400). It counts as **solid losses** the entries red on at least half
their seeds: 18 at 71, 7 at 200, 2 at 313, 0 at the declared budgets.

**Under the current timeout (cap ≤ ~3640 ms):**

| engine   | iterations at 3300 → 3600 | what the census can say                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium | 313 → 341                 | Of the 7 flips at 313, four declare 1000–1200 iterations (Snapcaster Mage, Oracle combo, prowess, Show and Tell): 28 more iterations are 4% of the way to theirs. The Terror and Oko entries declare 400. The census can't tell whether 341 wins them back, and both are thin (2/4 and 1/5 seeds). The Fatal Push flip is search noise at a raised budget. |
| WebKit   | 200 → 218                 | The 5 entries red at 200 but green at 313 (Disenchant on Trinisphere, Dismember, Summoner's Pact, saddle, Mind Rot) are the most a cap could win back on the way to 313. 218 covers 16% of that distance.                                                                                                                                                  |
| Gecko    | 71 → 78                   | 7 of the 129 iterations between the 71 and 200 arms. The 29 entries recovered between those arms (11 of them solid) stay out of reach.                                                                                                                                                                                                                     |

The census's thin flips are not monotone in the budget: five entries red at
200 are green at 71 (census § Flips by decision kind). So a gain of 4–16% of
an arm's distance is below what the census can resolve. **No cap the current
timeout allows wins back a solid loss the census can name.**

**Cap needed to reach the next arm, at today's speed:**

| engine   | from → to                      | cap needed | solid losses at the target |
| -------- | ------------------------------ | ---------- | -------------------------- |
| Chromium | 313 → 400 (commonest declared) | 4.2 s      | 2 → 0                      |
| WebKit   | 200 → 313                      | 5.2 s      | 7 → 2                      |
| Gecko    | 71 → 200                       | 9.3 s      | 18 → 7                     |
| Gecko    | 71 → 400                       | 18.5 s     | 18 → 0                     |

Every one of these is past the timeout. At the speed shown in § 1, depth can
only come from a faster engine or from a longer timeout chain.

## 4. What separates the presets when the clock binds

`convex/gre/difficulty.ts`: `medium {400, 1500 ms}`, `hard {1200, 3000 ms}`,
`expert {1320, 3300 ms}`. All three know the opponent's decklist
(`DIFFICULTY_KNOWS_OPPONENT`), so the clock is the only axis left between
them.

| preset | cap     | Chromium | WebKit | Gecko | census reading (Chromium)           |
| ------ | ------- | -------- | ------ | ----- | ----------------------------------- |
| medium | 1500 ms | 142      | 91     | 32    | between the 71 and 200 arms         |
| hard   | 3000 ms | 284      | 182    | 65    | 9% under `expert`: inside the noise |
| expert | 3300 ms | 313      | 200    | 71    | 2 solid losses                      |

- `hard` and `expert` are the same Bot in the field. Their iteration budgets
  (1200 and 1320) bind only on the fastest early-game boards: 15 of 629
  searches stopped on the count.
- `expert` in Gecko (71) searches shallower than `medium` in Chromium (142).
  The browser decides the Bot's strength more than the preset does.

## 5. The owner's ruling (2026-11-17)

The analysis above was put to the owner, who ruled as follows.

1. **Engine performance comes first.** "Every millisecond saved per
   iteration is decisive", above all on the slow engines. The engine work of
   PRD issue #10017 (issues #10025, #10026, #10097) is read against the
   target below.
2. **`expert` thinks longer: it is the level that guarantees quality.** The
   target is set in iterations, not milliseconds: **400 iterations per search
   on every engine family.** That is the budget 421 of the 601 `must` entries
   declare, and the census loses no entry there. The cap follows from engine
   speed. At today's speed, 400 iterations take 4.2 s in Chromium, 6.6 s in
   WebKit and 18.5 s in Gecko. Reaching 400 in 5 s takes at most 12.5 ms per
   iteration: a 1.3× speed-up for WebKit and 3.7× for Gecko, against the
   pooled rates of § 1 (10.5, 16.5 and 46 ms per iteration). The cap itself is sized in issue #10029, from the
   field reading taken after the engine changes (issue #10028).
3. **The difficulty levels are switched off for now.** Below `expert` the Bot
   is not worth playing. Every vs-Bot game plays `expert` (issue #10113).
4. **The blade measures performance apart from correctness.** No timeout in
   the blade analysis; it never had one, since its budgets are iterations
   only. Instead, it reports how many searches pass a 5000 ms threshold, and
   saturation (green decisions the field clock would cut) as the reading
   between the two (issue #10114).
5. **The timeout chain follows the cap** (issue #10115). The consult timeout
   and the watchdog become derived from the hardest cap plus named margins.
   The overrun margin covers the field's 1358 ms, so a longer `expert` cannot
   turn into a failed consult.
6. **Resilience to a weak line and a weak client** is measured before it is
   assumed (issue #10116): CPU and network throttling, cold-cache first
   consult, a phone.

## Not measured

- Marginal against average iteration cost inside one search (§ 1).
- Phones, slow devices and loaded machines: the field note's § 4 limits all
  apply here unchanged.
- Census arms at the candidate budgets (341, 218, 78, …). They were not run;
  § 3 brackets them between the existing arms. They would run on hosted
  runners, and the bracketing already shows that gains of this size are below
  the census's resolution.

## Reproduce

Field reports: Sentry log explorer, org `filippo-donadoni`, last 14 days,
`message:"bot search"`, numeric fields typed `tags[<name>,number]` (the field
note's § Reproduce lists them). Per engine family:

```text
iterations per second = Σ iterations.completed / Σ searches / 3.3
overrun               = max(consultMs.max) − 3300
margin at cap C       = 5000 − C − overrun
iterations at cap C   = iterations per second × C / 1000
```
