# The blade at field budgets: the `must` decisions the field Bot loses (issue #10021)

> **Dated:** 2026-11-16, census at `b23d69e05` (all four arms, the same sha).
> Slice 1 of PRD issue #10017. The field budgets are read from
> `brain-search-in-the-field.md` § 1 (dated 2026-11-16, at `a245582e4`): the
> iterations per search a real `expert` game completes, per engine family —
> **Chromium 313, WebKit 200, Gecko 71**. They are research inputs here, never
> constants in code; a later field reading replaces them and this census is
> re-run.
>
> **Re-run:** 2026-11-21 at the post-engine-change field budgets (387 / 160 /
> 94), diffed entry by entry against this one —
> `field-reading-after-engine-changes.md`.

**Question.** The blade proves the Bot's tested decisions at each entry's
declared budget. In real games the clock stops almost every search long before
`expert`'s 1320 iterations. Which `must` decisions does the Bot still make at
the iterations a real game actually completes — and what kind of decision is
it that it loses?

**Verdict up front.**

1. **At the Chromium budget (313) the field Bot keeps almost every tested
   decision**: 7 of 601 `must` entries flip, 2 of them on at least half their
   seeds. At WebKit's (200): 11 flip, 7 solidly. At Gecko's (71): **40 flip,
   18 solidly** — 93 of 2891 (entry, seed) rows, against 0 in the base arm.
2. **Main-phase sequencing is what the field Bot loses most**, at every field
   budget: 6 of 7 flips at 313, 10 of 11 at 200, 34 of 40 at 71 (9.6% of the
   353 main-phase entries; no other group passes 4.2%). Attack and block
   declarations and target choices lose nothing at any field budget.
3. **The shape of the loss changes with depth.** At 313 and 200 the shallow Bot
   mostly _acts when it should hold_ (5 of 7, 9 of 11): it casts Snapcaster
   Mage into an empty graveyard, Opt before the prowess attack, Show and Tell
   for the opponent's fatty. At 71 it mostly _passes when it should act_ (26 of
   40): the payoff of the play — a flashback kill, a free cast under Aluren, a
   lethal conspire copy — lies beyond what 71 iterations reach.
4. **Most `must` entries already declare less than `expert` searches.** 421
   declare 400 iterations and 120 declare 200; only 23 declare more than 400.
   The blade never proved `expert`'s 1320, so "the field Bot completes a
   quarter of its budget" is a smaller loss against what the blade tests than
   against what the preset asks for: 313 sits 22% under the commonest declared
   budget.

## Method

Four arms of `bun run blade:census` (issue #9276) over the whole `must` tier,
on the hosted `blade-census.yml` matrix (16 slices × 4 workers), all at
`b23d69e05`, dispatched 2026-11-16 17:51 (Rome):

| arm      | budget                   | run         | jobs | red entries | wall  | CPU     |
| -------- | ------------------------ | ----------- | ---- | ----------- | ----- | ------- |
| base     | each entry's declared    | 43912167847 | 2891 | 0           | 220 s | 159 min |
| Chromium | `--iterations 313` (all) | 43912175392 | 2891 | 7           | 228 s | 154 min |
| WebKit   | `--iterations 200` (all) | 43912182481 | 2891 | 11          | 169 s | 96 min  |
| Gecko    | `--iterations 71` (all)  | 43912188936 | 2891 | 40          | 80 s  | 44 min  |

601 entries, 2891 (entry, seed) jobs per arm, each entry's own seeds. The
base arm's merge job failed in setup (a `pixi.js` tarball integrity error,
infra); its 16 slices were green and were merged by hand with the same
command the workflow runs.

**Pairing by label, not by `--diff`.** `blade:census --diff` pairs verdicts by
(label, iterations), so an arm under `--iterations N` shares no key with the
base at declared budgets: every entry would be `unmatched`.
`compare.mjs` (§ Reproduce) pairs them by label and seed
instead. A **flip** is an entry green on every seed in the base and red on at
least one at the field budget; the **flip count** is its red seeds over its
seeds. No entry was red in the base, so no arm has a `fixed` or `stillRed`
row, and every field-red seed is a flipped seed.

**The override cuts both ways.** `--iterations N` replaces every declared
budget, so an entry declaring less than N searches _more_ in the field arm. Two
flips are of that kind and are marked ↑ below; they are search noise, not
lost depth.

**Decision kinds.** `classify.mjs` (§ Reproduce) builds every
entry's position through the blade builder (no search) and reads the Decision
Class (`verdicts/coverage.ts`) of the moves its expectation names — or, for a
predicate entry, of the root's legal moves other than `pass` — plus the phase,
the stack and any pending choice. The first rule that holds names the kind:

| kind                    | rule                                                                | entries | seeds |
| ----------------------- | ------------------------------------------------------------------- | ------- | ----- |
| `choice-on-resolution`  | a pending choice at the root                                        | 63      | 303   |
| `combat`                | the decision is an attack or block declaration                      | 40      | 197   |
| `targeting`             | the decision is a target selection                                  | 18      | 93    |
| `response-to-stack`     | the stack is not empty                                              | 48      | 257   |
| `main-phase-sequencing` | the Bot's own main phase, empty stack: cast, activate, land or hold | 353     | 1642  |
| `instant-speed-timing`  | anything else: upkeep, combat steps, end step, opponent's turn      | 79      | 399   |

## Flips by decision kind

Entries flipped (flipped seeds / those entries' seeds); share of the kind's
entries in brackets.

| kind                    | entries | 313              | 200               | 71                 |
| ----------------------- | ------- | ---------------- | ----------------- | ------------------ |
| `main-phase-sequencing` | 353     | 6 (13/33) [1.7%] | 10 (27/52) [2.8%] | 34 (74/176) [9.6%] |
| `instant-speed-timing`  | 79      | —                | 1 (5/5) [1.3%]    | 2 (7/10) [2.5%]    |
| `response-to-stack`     | 48      | 1↑ (1/7)         | —                 | 2 (4/12) [4.2%]    |
| `choice-on-resolution`  | 63      | —                | —                 | 2 (8/10) [3.2%]    |
| `combat`                | 40      | —                | —                 | —                  |
| `targeting`             | 18      | —                | —                 | —                  |
| **all**                 | **601** | **7 (14/40)**    | **11 (32/57)**    | **40 (93/208)**    |
| solid (≥ half seeds)    |         | 2                | 7                 | 18                 |
| chose `pass` / acted    |         | 2 / 5            | 2 / 9             | 26 / 14            |

**The loss is not monotone in the budget.** Five entries red at 200 are green
at 71, and the 313-only Fatal Push flip is at a raised budget. Every one of
them is red on at most 2 of its seeds: a thin flip is a seed-sensitive margin,
not a decision the depth decides. The solid rows grow monotonically (2 → 7 →
18).

## Flipped entries

`declared` is the entry's own budget; the moves are the field Bot's wrong
picks (one per distinct move).

### Chromium — 313 iterations

| kind                    | entry                                                                                                                                           | declared | flips | field pick                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- | -------------------------- |
| `main-phase-sequencing` | Snapcaster Mage (issue #4217 reported position): holds it on turn 4 with an empty graveyard                                                     | 1000     | 4/4   | casts Snapcaster Mage      |
| `main-phase-sequencing` | Oracle combo: casts Thassa's Oracle before Demonic Consultation into a possible counterspell                                                    | 1200     | 2/5   | casts Demonic Consultation |
| `main-phase-sequencing` | prowess: Monastery Swiftspear holds the instant before attackers                                                                                | 1000     | 2/5   | casts Opt                  |
| `main-phase-sequencing` | keyword relevance (protection): against a bot showing no red, protection from red does not make the Runeclaw Bear Terror's target (issue #5356) | 400      | 2/4   | Terror on Runeclaw Bear    |
| `main-phase-sequencing` | cheat into play: holds Show and Tell when only the opponent has a fatty                                                                         | 1200     | 2/10  | casts Show and Tell        |
| `main-phase-sequencing` | comparative each-step trigger: without the Oath of Druids, Oko's +1 on its own Chromatic Star stays a free body (issue #8734)                   | 400      | 1/5   | pass                       |
| `response-to-stack`     | self-harm: Fatal Push still destroys the opponent's mana value 4 creature beside the Bot's own                                                  | 100 ↑    | 1/7   | pass                       |

### WebKit — 200 iterations

| kind                    | entry                                                                                                                                           | declared | flips | field pick                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- | --------------------------------- |
| `main-phase-sequencing` | cost-modifier pricing: Disenchant takes the Trinisphere taxing the bot's hand of one-drops, not the 2-MV artifact (issue #5363)                 | 400      | 4/4   | casts Savannah Lions              |
| `main-phase-sequencing` | phyrexian mana: Dismember never aims at toughness above 5                                                                                       | 400      | 5/5   | Dismember on Force of Nature      |
| `instant-speed-timing`  | pact: Summoner's Pact is never cast with the upkeep unpayable                                                                                   | 400      | 5/5   | casts Summoner's Pact             |
| `main-phase-sequencing` | Snapcaster Mage (issue #4217 reported position): holds it on turn 4 with an empty graveyard                                                     | 1000     | 3/4   | casts Snapcaster Mage             |
| `main-phase-sequencing` | Oracle combo: casts Thassa's Oracle before Demonic Consultation into a possible counterspell                                                    | 1200     | 3/5   | casts Demonic Consultation        |
| `main-phase-sequencing` | prowess: Monastery Swiftspear holds the instant before attackers                                                                                | 1000     | 3/5   | casts Opt                         |
| `main-phase-sequencing` | keyword relevance (protection): against a bot showing no red, protection from red does not make the Runeclaw Bear Terror's target (issue #5356) | 400      | 2/4   | Terror on Runeclaw Bear           |
| `main-phase-sequencing` | attacks with the saddlers rather than saddle its Mount when their damage outweighs the drain                                                    | 400      | 2/5   | activates Caustic Bronco (saddle) |
| `main-phase-sequencing` | comparative each-step trigger: without the Oath of Druids, Oko's +1 on its own Chromatic Star stays a free body (issue #8734)                   | 400      | 2/5   | pass                              |
| `main-phase-sequencing` | cheat into play: holds Show and Tell when only the opponent has a fatty                                                                         | 1200     | 2/10  | casts Show and Tell               |
| `main-phase-sequencing` | opponent's choice: Mind Rot strips a lone Sacred Ground                                                                                         | 400      | 1/5   | pass                              |

### Gecko — 71 iterations

| kind                    | entry                                                                                                                                           | declared | flips | field pick                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- | -------------------------------------- |
| `main-phase-sequencing` | cast permission: casts a creature for free under Aluren with no lands                                                                           | 200      | 5/5   | pass                                   |
| `main-phase-sequencing` | discriminating pair: reveals its whole library and reads the payoff off the graveyard's top                                                     | 400      | 5/5   | pass                                   |
| `main-phase-sequencing` | known top: digs with a cantrip because it knows the Bolt is there                                                                               | 1200     | 5/5   | pass                                   |
| `main-phase-sequencing` | cost-modifier pricing: Disenchant takes the Trinisphere taxing the bot's hand of one-drops, not the 2-MV artifact (issue #5363)                 | 400      | 4/4   | casts Savannah Lions                   |
| `main-phase-sequencing` | Snapcaster Mage: casts it to flash back a sorcery that kills a Serra Angel                                                                      | 400      | 4/5   | pass                                   |
| `main-phase-sequencing` | evoke: Solitude is never evoked with no threat, spending two cards                                                                              | 400      | 4/5   | evokes Solitude                        |
| `main-phase-sequencing` | foretell: keeps the mana open for a held Counterspell instead of foretelling                                                                    | 200      | 4/5   | foretells Behold the Multiverse        |
| `main-phase-sequencing` | witnessed placement: mills down to the Bolt it saw put there                                                                                    | 1200     | 4/5   | pass                                   |
| `main-phase-sequencing` | Conspire: taps two red creatures to copy Burn Trail for lethal                                                                                  | 1000     | 3/5   | pass                                   |
| `main-phase-sequencing` | flash permanent NEGATIVE CONTROL: still casts hasty Raging Kavu for lethal this turn                                                            | 2000     | 3/5   | pass                                   |
| `main-phase-sequencing` | graveyard engine: escapes the Black Lotus whose permanent outweighs the option                                                                  | 400      | 2/3   | pass                                   |
| `main-phase-sequencing` | Snapcaster Mage (issue #4217 reported position): holds it on turn 4 with an empty graveyard                                                     | 1000     | 2/4   | casts Snapcaster Mage                  |
| `main-phase-sequencing` | Oracle combo: casts Thassa's Oracle before Demonic Consultation into a possible counterspell                                                    | 1200     | 2/5   | casts Demonic Consultation             |
| `main-phase-sequencing` | X into an ETB trigger: casts Wan Shi Tong, Librarian for all its mana                                                                           | 200      | 2/5   | pass                                   |
| `main-phase-sequencing` | bounce sweep: casts Hibernation when the opponent's green board outweighs its mana                                                              | 400      | 2/5   | pass                                   |
| `main-phase-sequencing` | free mana: holds Mana Crypt at 3 life, its upkeep damage is lethal                                                                              | 400      | 2/5   | casts Mana Crypt                       |
| `main-phase-sequencing` | tutor: casts Entomb with a reanimation spell in hand                                                                                            | 400      | 2/5   | pass                                   |
| `main-phase-sequencing` | strip: casts Thoughtseize at a castable Shivan Dragon                                                                                           | 400      | 2/9   | pass                                   |
| `main-phase-sequencing` | morph: casts Exalted Angel face down for {3} on three lands                                                                                     | 400      | 1/1   | pass                                   |
| `main-phase-sequencing` | keyword relevance (protection): against a bot showing no red, protection from red does not make the Runeclaw Bear Terror's target (issue #5356) | 400      | 1/4   | Terror on Runeclaw Bear                |
| `main-phase-sequencing` | each-step dig: Disenchant takes the Oath of Druids that digs only the opponent's Craw Wurms, not the 2-MV artifact (issue #5627)                | 400      | 1/4   | pass                                   |
| `main-phase-sequencing` | each-step return to hand: Disenchant takes the Sunken Hope that bounces only the bot's creature, not the 2-MV artifact (issue #5628)            | 400      | 2/4   | pass                                   |
| `main-phase-sequencing` | symmetric life engine: Disenchant takes the Karma burning the bot's Swamps, not the 2-MV artifact (issue #5574)                                 | 400      | 1/4   | pass                                   |
| `main-phase-sequencing` | Sacrifice-for-denial outlet: casts the creature                                                                                                 | 400      | 1/5   | pass                                   |
| `main-phase-sequencing` | Self-growing sacrifice outlet: casts the creature                                                                                               | 200      | 1/5   | pass                                   |
| `main-phase-sequencing` | activation {X}: Runed Arch announces X = 2 to make both Bears unblockable for lethal                                                            | 200      | 1/5   | pass                                   |
| `main-phase-sequencing` | cast permission: casts Raven Familiar for free under Aluren with no lands                                                                       | 200      | 1/5   | pass                                   |
| `main-phase-sequencing` | choose-graveyard-card: casts Sutured Ghoul over a graveyard of creatures                                                                        | 400      | 1/5   | pass                                   |
| `main-phase-sequencing` | each-player one-shot: casts Wheel of Fortune holding nothing else against a seven-card hand                                                     | 400      | 1/5   | pass                                   |
| `main-phase-sequencing` | life X: Toxic Deluge never pays to lethal                                                                                                       | 400      | 1/5   | casts Toxic Deluge                     |
| `main-phase-sequencing` | life X: Toxic Deluge pays exactly what the sweep needs                                                                                          | 400      | 1/5   | pass                                   |
| `main-phase-sequencing` | phyrexian mana: Dismember never aims at toughness above 5                                                                                       | 400      | 1/5   | Dismember on Force of Nature           |
| `main-phase-sequencing` | land-type change: Reef Shaman makes a Forest to cast the green spell in hand                                                                    | 200      | 1/10  | pass                                   |
| `main-phase-sequencing` | starved target fan-out: a Vindicate cast aims at the opponent's Hero token (iterations 15)                                                      | 15 ↑     | 1/14  | Vindicate on Astrologian's Planisphere |
| `instant-speed-timing`  | pact: Summoner's Pact is never cast with the upkeep unpayable                                                                                   | 400      | 5/5   | casts Summoner's Pact                  |
| `instant-speed-timing`  | cheat into play: activates Sneak Attack at the beginning of combat                                                                              | 400      | 2/5   | pass                                   |
| `response-to-stack`     | counterspell: Mana Drain holds against a Savannah Lions                                                                                         | 400      | 3/5   | Mana Drain on Savannah Lions           |
| `response-to-stack`     | self-harm: Fatal Push still destroys the opponent's mana value 4 creature beside the Bot's own                                                  | 100      | 1/7   | pass                                   |
| `choice-on-resolution`  | explore: bins the revealed blank instead of leaving it as the next draw                                                                         | 200      | 4/5   | keeps Ornithopter on top               |
| `choice-on-resolution`  | provoke pair: leaves a tapped large creature tapped                                                                                             | 400      | 4/5   | pays (untaps it)                       |

## What this says, and what it does not

- **Chromium's field Bot is close to the tested Bot; Gecko's is not.** Two
  solid losses at 313 against eighteen at 71. A Firefox player faces a Bot that
  fails one tested main-phase decision in ten.
- **Main-phase sequencing is where depth pays.** Its decisions are whole-turn
  plans — hold this for the attack, cast that for its payoff two plies down —
  and both failure shapes (acting too early at 200–313, never finding the play
  at 71) are the search not reaching the turn's end. Combat declarations and
  target choices are decided near the root and survive 71 iterations intact.
- **Not measured:** the field budgets are medians of a skewed distribution
  (Chromium's games range 148–945 iterations per search, § 1 of the field
  note); this census runs each at its median, not across its spread. The
  `stretch` tier was not run. The flips are counted at the blade's own seeds
  (1–14 per entry); a flip on one seed of five is a margin, not a verdict.
- **Re-run after every engine or preset change** (PRD issue #10017, user story
  5): the solid-flip column per field budget is the number a speed-up should
  move.

## Reproduce

No script ships with this note: the two below are its contract. Save each at
the repository root (untracked) and run them with `bun` from there, at the
census sha.

Dispatch the four arms on one sha (the field budgets from
`brain-search-in-the-field.md` § 1), then download each merged artifact:

```bash
SHA=b23d69e0555d3b32e70f746f63102a3dfe9939a6
gh workflow run blade-census.yml -f ref=$SHA -f tier=must            # base
gh workflow run blade-census.yml -f ref=$SHA -f tier=must -f iterations=313
gh workflow run blade-census.yml -f ref=$SHA -f tier=must -f iterations=200
gh workflow run blade-census.yml -f ref=$SHA -f tier=must -f iterations=71
gh run download <run> -n blade-census          # one per arm → base.json, f313.json, …
# a merge job that failed in setup: merge its slices locally
gh run download <run> -p 'census-slice-*' -D base-slices
bun run blade:census --merge base.json base-slices/*/slice-*.json
```

Classify the entries and pair the arms:

```bash
git checkout b23d69e05
bun classify.mjs kinds.json
bun compare.mjs kinds.json base.json f313.json f200.json f71.json > compare.json
jq -r '.arms[] | "\(.meta.iterations): \(.newReds | length) flips"' compare.json
```

`classify.mjs`:

```js
// Classify every blade `must` entry by the decision it tests (issue #10021).
// Builds each entry's position through the real blade builder (no search) and
// records the Decision Class of the move(s) its expectation names, the root's
// legal move classes, the phase, the stack depth and whether a choice is
// pending. `kinds.json` feeds `compare.mjs`.
//
//   bun classify.mjs kinds.json
import { writeFileSync } from "node:fs";
import { BLADE_SCENARIOS } from "./convex/gre/ai/blade/registry";
import { buildBladeState } from "./convex/gre/ai/blade/build";
import { seatPlayerId } from "./convex/gre/ai/blade/matcher";
import { applyBladeRevisit } from "./convex/gre/ai/blade/setup";
import { enumerateMoves } from "./convex/gre/moves";
import { actedSeatFor } from "./convex/gre/expectedInput";
import { CLASS_OF_MOVE_KIND } from "./convex/gre/ai/verdicts/coverage";

const cls = (k) => CLASS_OF_MOVE_KIND[k] ?? k;
const out = [];
for (const s of BLADE_SCENARIOS) {
    if (s.tier !== "must") continue;
    const e = s.expect;
    const matcherKinds = [...(e.moves ?? []), ...(e.forbidden ?? [])].map(
        (m) => m.kind
    );
    const row = {
        label: s.label,
        iterations: s.budget.iterations,
        seeds: s.seeds?.length ?? 1,
        shape: e.moves ? "moves" : e.forbidden ? "forbidden" : "predicate",
        matcherClasses: [...new Set(matcherKinds.map(cls))],
        rootClasses: [],
        phase: "?",
        stack: 0,
        pending: false,
        active: false,
        err: null,
    };
    try {
        const state = buildBladeState(s);
        const botId = seatPlayerId(state, s.bot);
        if (s.revisit) applyBladeRevisit(state, s, botId);
        const seat = actedSeatFor(state, botId) ?? botId;
        row.phase = String(state.phase);
        row.stack = state.stack.length;
        row.pending = (state.pendingChoices?.length ?? 0) > 0;
        row.active = state.activePlayerId === botId;
        row.rootClasses = [
            ...new Set(enumerateMoves(state, seat).map((m) => cls(m.kind))),
        ];
    } catch (x) {
        row.err = String(x).slice(0, 200);
    }
    out.push(row);
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(
    `${out.length} must entries, ${out.filter((r) => r.err).length} unbuilt`
);
```

`compare.mjs`:

```js
// Compare census arms run at different budgets, entry by entry (issue #10021).
// `bun run blade:census --diff` pairs verdicts by (label, iterations), so a
// base arm at declared budgets and an arm under `--iterations N` share no key;
// this pairs them by label and seed instead.
//
//   bun compare.mjs \
//       kinds.json base.json f313.json f200.json f71.json > compare.json
//
// Per field arm: `newReds` (green on every seed in the base, red on at least
// one at the field budget), `fixed` (the reverse), `stillRed` (red in both).
// Every record carries its decision kind (below), its Decision Class, its
// declared budget, its seed count, and how many seeds are red at each arm.
import { readFileSync } from "node:fs";

const [kindsP, baseP, ...fieldP] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const kinds = read(kindsP);
const base = read(baseP);
const fields = fieldP.map(read);

const MAIN = new Set(["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"]);
const classes = (k) =>
    k.matcherClasses.length
        ? k.matcherClasses
        : k.rootClasses.filter((c) => c !== "pass");
// The first rule that holds names the entry's decision kind. `combat` is an
// attack or block declaration; a spell or ability in a combat step is
// `instant-speed-timing`, like one in an upkeep or an end step.
function decisionKind(k) {
    const cls = classes(k);
    if (k.pending) return "choice-on-resolution";
    if (cls.includes("declare-attackers") || cls.includes("declare-blockers"))
        return "combat";
    if (cls.includes("targeting")) return "targeting";
    if (k.stack > 0) return "response-to-stack";
    if (MAIN.has(k.phase) && k.active) return "main-phase-sequencing";
    return "instant-speed-timing";
}
const decisionClass = (k) => [...classes(k)].sort().join("+") || "pass";
const kindOf = new Map(kinds.map((k) => [k.label, k]));

const bySeed = (arm) => {
    const m = new Map();
    for (const r of arm.rows) {
        if (!m.has(r.label)) m.set(r.label, new Map());
        m.get(r.label).set(r.seed, r);
    }
    return m;
};
const b = bySeed(base);
const redIn = (seeds) => [...seeds.values()].filter((r) => !r.ok);
const out = {
    base: {
        meta: base.meta,
        redEntries: [...b].filter(([, s]) => redIn(s).length).map(([l]) => l),
    },
    arms: [],
    population: {},
};
for (const f of fields) {
    const v = bySeed(f);
    const arm = {
        meta: f.meta,
        newReds: [],
        fixed: [],
        stillRed: [],
        unmatched: [],
    };
    for (const [label, seeds] of v) {
        const bs = b.get(label);
        if (!bs) {
            arm.unmatched.push(label);
            continue;
        }
        const k = kindOf.get(label);
        const fieldRed = redIn(seeds);
        const baseRed = redIn(bs);
        const rec = {
            label,
            kind: k ? decisionKind(k) : "unclassified",
            cls: k ? decisionClass(k) : "?",
            declared: [...bs.values()][0].iterations,
            seeds: seeds.size,
            baseRedSeeds: baseRed.length,
            fieldRedSeeds: fieldRed.length,
            flippedSeeds: fieldRed.filter((r) => bs.get(r.seed)?.ok === true)
                .length,
            moves: fieldRed.map((r) => `seed ${r.seed}: ${r.move}`),
        };
        if (!baseRed.length && fieldRed.length) arm.newReds.push(rec);
        else if (baseRed.length && !fieldRed.length) arm.fixed.push(rec);
        else if (baseRed.length) arm.stillRed.push(rec);
    }
    for (const label of b.keys()) if (!v.has(label)) arm.unmatched.push(label);
    out.arms.push(arm);
}
for (const k of kinds) {
    const d = decisionKind(k);
    out.population[d] ??= { entries: 0, seeds: 0 };
    out.population[d].entries++;
    out.population[d].seeds += k.seeds;
}
console.log(JSON.stringify(out, null, 1));
```
