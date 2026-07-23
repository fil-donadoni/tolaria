# Tolaria

An MTG gameplay engine for study and experimentation. Rules-correct, real-time reactive, two-player.

## MTG Domain

Terms from the Magic: The Gathering Comprehensive Rules. The CR is the authority — these definitions capture how we use each term in code, not the full CR definition.

### Game Structure

**Match**:
A best-of-N contest between two **Players**, composed of one or more **Games** (CR 100.6, tournament rules). Bo1 is a Match of a single **Game**; Bo3 is won by the first **Player** to win two **Games**. The Match owns the running **Game** score, the **Sideboarding** step between **Games**, and the play/draw choice for each **Game** after the first. Every **Game** belongs to exactly one Match.
_Avoid_: Series, set (that's a card collection), session

**Game**:
A single contest within a **Match** between two **Players**, proceeding in **Turns** divided into **Phases**, ending when one **Player** wins (opponent at life ≤ 0, decked, ten or more **Poison Counters**, or concede). A **Match** may contain several Games played in sequence.
_Avoid_: session

**Player**:
A participant in a **Game**, identified by a **Player ID**. Has life total, **Zones**, and a **Mana Pool**.
_Avoid_: User (that's the authenticated human; a user controls one or two players)

**Turn**:
One full cycle of **Phases** for the **Active Player**. Numbered sequentially from 1.
_Avoid_: Round

**Poison Counter**:
A counter that sits on a **Player** rather than on a **Permanent** or **Card Instance**. A Player who accumulates ten or more loses the **Game**. A distinct player-level resource — not the named counters carried by objects.
_Avoid_: damage, life loss (poison is its own resource and its own loss condition)

**Phase**:
A subdivision of a **Turn**. Tolaria implements 14 phases: MULLIGAN, UNTAP, UPKEEP, DRAW, PRECOMBAT*MAIN, BEGINNING_OF_COMBAT, DECLARE_ATTACKERS, DECLARE_BLOCKERS, FIRST_STRIKE_DAMAGE, COMBAT_DAMAGE, END_OF_COMBAT, POSTCOMBAT_MAIN, END_STEP, CLEANUP.
\_Avoid*: Step (CR distinguishes phases and steps; we flatten both into "phase")

**Active Player**:
The **Player** whose **Turn** it is.
_Avoid_: Current player, turn player

**Priority**:
The right to take an action. Only one **Player** has priority at a time. Both must pass consecutively for the game to advance (CR 117).
_Avoid_: Turn to act

**State-Based Actions (SBA)**:
Automatic game rules checked whenever a **Player** would receive **Priority**. Applied without using the **Stack** (CR 704). Examples: creature with toughness ≤ 0 dies, player with life ≤ 0 loses.
_Avoid_: Cleanup rules, auto-checks

### Zones

**Library**:
A **Player**'s face-down draw pile. Cards are ordered.
_Avoid_: Deck (ambiguous — see **Deck** in Tolaria Engine section)

**Hand**:
Cards a **Player** has drawn but not yet played.

**Battlefield**:
The shared zone where **Permanents** exist.
_Avoid_: Board, field, play area

**Graveyard**:
A **Player**'s discard pile. Public information, ordered.
_Avoid_: Discard pile

**Exile**:
A zone for cards removed from the game. Public information.
_Avoid_: Removed from game (old terminology)

**Stack**:
The zone where **Spells** and **Abilities** wait to **Resolve**. Last-in, first-out.
_Avoid_: Queue

**Hidden Zone**:
A **Zone** whose card identities are not public: **Library**, **Hand**, and face-down cards in **Exile**. Identity in a hidden zone is governed by **Card Knowledge**.
_Avoid_: Secret zone, private zone

**Card Knowledge** (`knownTo`):
The set of **Players** who currently know the identity of a specific **Card Instance** while it sits in a **Hidden Zone**. Persists on the instance across hidden→hidden moves (e.g. drawing a card whose top-of-**Library** identity an opponent had seen). Granted by _look_ effects (to the looker) and _reveal_ effects (to all). Cleared by an uncertainty event: a **Library** shuffle (whole library), a random or owner-chosen discard (all non-owner viewers, whole hand), or the card entering a public **Zone** (which makes it universally known anyway, so the stale set is emptied). Note: a **Player** never auto-knows their own **Library** order — only cards they precisely positioned (e.g. scry) are `knownTo` them.
_Avoid_: Revealed (that's one source of knowledge, not the state), Visible

**Look** (vs **Reveal**):
_Look_ at a card → only the looking **Player** gains **Card Knowledge**. _Reveal_ a card → all **Players** gain it. Both persist until an uncertainty event clears them.

### Cards

**Permanent**:
A card or **Token** on the **Battlefield**. Has types, subtypes, and may have abilities.
_Avoid_: Board card, in-play card

**Spell**:
A card on the **Stack** that has been **Cast** but hasn't **Resolved** yet.
_Avoid_: Playing (overloaded — "cast" for spells, "play" for lands)

**Creature**:
A **Permanent** type with power and toughness that can attack and block.

**Land**:
A card type that produces **Mana**. Played (not cast) — does not use the **Stack**.

**Planeswalker**:
A **Permanent** type representing an ally with **Loyalty** rather than power/toughness. Can be dealt damage (removing loyalty) and has **Loyalty Abilities**. A **Planeswalker** with 0 loyalty is put into its owner's **Graveyard** as an **SBA** (CR 704.5i).
_Avoid_: Walker, PW (in prose)

**Loyalty Counter**:
The **Counter** type (CR 122) that measures a **Planeswalker**'s current loyalty. Stored in the same generic `counters` map as any other counter (key `"loyalty"`); damage removes them (CR 120.3) and **Loyalty Abilities** add/remove them.
_Avoid_: Loyalty point, life (a planeswalker doesn't have life)

**Starting Loyalty**:
The printed number of **Loyalty Counters** a **Planeswalker** enters the **Battlefield** with (CR 306.5b), declared as `CardDefinition.loyalty` and placed on ETB.
_Avoid_: Base loyalty, initial life

**Loyalty Ability**:
An **Activated Ability** of a **Planeswalker** whose cost is a signed **Loyalty** change (`+N`/`-N`/`0`, `cost.loyalty`). Sorcery-speed and once per **Planeswalker** per turn (CR 606.3); a `-N` cost may not take loyalty below 0 (CR 606.5). Its presence is the whole marker — no separate flags.
_Avoid_: Planeswalker ability (broader — a planeswalker could have non-loyalty abilities), tick

**Shock Land**:
A dual land whose entry offers a **Land-Entry Pay-Choice**: "as it enters, you
may pay 2 life; if you don't, it enters tapped" (the RAV/GPT/DIS cycle — Steam
Vents, Godless Shrine, …). Distinguished from a **fast land** / check-land,
whose tapped-on-entry is a pure board predicate with no player decision.
_Avoid_: dual land (that's the broader family — a Shock Land is one kind of dual)

**Land-Entry Pay-Choice**:
A player decision made **as a land enters** the battlefield that determines
whether it enters tapped — "you may pay a cost; if you don't, it enters
tapped." Because a **Land** is played and never touches the **Stack**, this is
the one enters-tapped source that is not a deterministic board predicate: it
suspends land entry on a stackless **Pending Choice** rather than resolving
synchronously (ADR 0051). Paying satisfies only the land's own tapped clause —
any other tapped source (Kismet) still applies independently.

**Token**:
A **Permanent** not represented by a physical card. Created by effects. Ceases to exist when it leaves the **Battlefield**.

**Attachment**:
A **Permanent** attached to another **Permanent** — an **Aura** or an **Equipment**. The umbrella term for anything that tracks a **Host**. Grants its static/triggered abilities to the Host while attached.
_Avoid_: Attached card, buff (a buff is one possible effect, not the object)

**Host**:
The **Permanent** an **Attachment** is currently attached to (the enchanted or equipped object).
_Avoid_: Target (the Host is chosen by targeting, but "host" is the ongoing relationship), parent

**Aura**:
An **Enchantment** **Attachment**. If its **Host** becomes illegal or it ends up unattached, it is put into its owner's **Graveyard** (CR 704.5m/704.5n).
_Avoid_: Enchantment (broader — not every enchantment is an Aura)

**Equipment**:
An **Artifact** **Attachment** (subtype Equipment) attached to a **Creature** via **Equip**. Unlike an **Aura**, when its **Host** becomes illegal it **detaches and stays on the Battlefield** unattached (CR 704.5q). **Control-independent**: it stays attached to its **Host** even if its **Controller** no longer controls that Host (CR 301.5c) — the "you control" restriction binds only at **Equip** time.
_Avoid_: Artifact (broader), Aura (different detach outcome)

**Equip**:
The sorcery-speed **Activated Ability** of an **Equipment** — "Equip {cost}: attach to target creature you control" (CR 702.6). Uses the **Stack**; its target must be a **Creature** the **Controller** controls at activation and at resolution.
_Avoid_: Attach (Attach is the underlying keyword action; Equip is the ability that performs it), cast

**Snow**:
A supertype (CR 205.4a) marking a **Permanent** as snow. In the Ice Age block snow is referenced only _by type_ ("a snow-covered land", "sacrifice a snow Mountain"); the `{S}` snow-mana symbol is a later (Coldsnap) addition and is **not** used by these sets, so snow needs no mana-system support here — only the supertype on the five snow-covered basics and the few cards that filter on it.
_Avoid_: Snow-covered (the printed basic-land name, not the supertype)

**Face-Down Permanent**:
A **Permanent** on the **Battlefield** whose identity is hidden from players other than its **Controller** (CR 708). Presented to everyone as a 2/2 colorless nameless **Creature** with no abilities; the real card underneath is known only to the **Controller** until it is **Turned Face Up**. The one exception to the otherwise-public **Battlefield** (Illusionary Mask).
_Avoid_: Morph, hidden card, masked creature

**Turn Face Up**:
The event that reveals a **Face-Down Permanent**'s true identity, after which it is a normal **Permanent** with its real characteristics. For Illusionary Mask this happens automatically (as a replacement) the moment the creature would deal or be dealt damage or become tapped — never by paying a cost.
_Avoid_: Flip, unmorph, reveal

### Abilities

**Activated Ability**:
An ability with a cost and effect, written as "cost: effect". Uses the **Stack** unless it's a **Mana Ability**.
_Avoid_: Action, skill

**Triggered Ability**:
An ability that fires automatically when a condition is met ("when/whenever/at"). Uses the **Stack**.
_Avoid_: Event handler, listener

**Delayed Triggered Ability**:
A one-shot **Triggered Ability** created during the resolution of a spell or ability rather than printed on a permanent — "at the beginning of the next end step, destroy it" (CR 603.7). It waits for its timing condition, fires exactly once, then ceases to exist. In an **Effect Script** it is written inline: the scheduling **Op** carries the delayed body (itself an Effect Script) and its **Captures**, so the whole card reads like its oracle text.
_Avoid_: Scheduled effect, deferred callback, timer

**Cast Trigger**:
A **Triggered Ability** whose condition is "when you **Cast** this spell" — it fires from the **Stack** as the spell is announced, not from the **Battlefield**. Because ordinary trigger collection scans only battlefield (and just-left) sources, cast triggers are gathered by a dedicated pass at cast time and placed on the **Stack** _above_ the spell, so they resolve before it. **Storm** is the first cast trigger.
_Avoid_: On-cast hook, cast listener

**Storm**:
A **Keyword** ability (CR 702.40) that is a **Cast Trigger**: "when you cast this spell, copy it for each other spell cast before it this turn; you may choose new targets for the copies." The copy count is the value of **Spells Cast This Turn** captured at the moment the spell is cast (a later spell cast before the trigger resolves does not count), and the copies are created even if the original spell has since left the **Stack** — so the trigger carries a **snapshot** of the spell rather than reading the live stack item. Each copy is a **Spell Copy** offered an optional **Copy-Retarget**.
_Avoid_: Storm count (for the counter — that is **Spells Cast This Turn**)

**Static Ability**:
An ability that applies continuously while the **Permanent** is in the appropriate **Zone**. Does not use the **Stack**.
_Avoid_: Passive ability, aura effect

**Mana Ability**:
An **Activated Ability** that produces **Mana** and has no target. Resolves immediately — does not use the **Stack** (CR 605.3a).
_Avoid_: Tap for mana

**Keyword**:
A shorthand for a defined ability (flying, haste, first strike, etc.). Stored as `staticAbilities[]` on a **Card Instance**.

**Cumulative Upkeep**:
A **Keyword** ability (CR 702.24) on a **Permanent**: at the beginning of its **Controller**'s upkeep an **Age Counter** is put on it, then the controller _may_ pay the cumulative upkeep cost once for each age counter on it; declining — or being unable to pay — sacrifices it. The cost therefore grows by one increment each turn the **Permanent** survives. In the Ice Age era the cost is mana, life, or a sacrifice.
_Avoid_: Maintenance cost (the obsolete pre-keyword wording)

**Age Counter**:
The counter **Cumulative Upkeep** accrues on a **Permanent** — one added each upkeep — whose running total is the multiplier on that turn's cumulative upkeep cost. A plain named counter, not a player resource like a **Poison Counter**.
_Avoid_: Upkeep counter, age token

**Delve**:
A **Keyword** ability (CR 702.66) on a **Spell**: while paying its cost, its controller may exile any number of cards from their graveyard, each paying for {1} of the spell's generic cost. A chosen, variable payment made during casting — not a reduction of the printed cost, so the spell's **Mana Value** is unchanged. Colored pips are never delved. One of the **payWith** cast-cost family (the chosen-resource variant); contrast the passive **cost reduction** variant (a spell costing less "for each X"), which is applied automatically before payment.
_Avoid_: Cost reduction (delve pays pips, it does not lower the cost)

**Fading**:
A **Keyword** ability (CR 702.32) on a **Permanent** that enters with a set number of **Fade Counters**: at the beginning of its **Controller**'s upkeep, remove a fade counter from it; if it cannot (none remain), sacrifice it. A fading permanent therefore survives one upkeep longer than a **Vanishing** one of the same number, because the sacrifice waits for the turn it finds _no_ counter to remove rather than the turn it removes the last. Fade counters are an ordinary resource: an ability elsewhere on the card may spend them faster (Parallax Wave, Parallax Tide), hastening the sacrifice.
_Avoid_: Fade-out, decay

**Fade Counter**:
The named counter **Fading** places on a **Permanent** at entry and removes one-per-upkeep. A plain object counter, not a player resource like a **Poison Counter**.

**Vanishing**:
A **Keyword** ability (CR 702.63) on a **Permanent** that enters with a set number of **Time Counters**: at the beginning of its **Controller**'s upkeep, remove a time counter; and, as a _separate_ triggered ability, when the last time counter is removed — by upkeep or any other means — sacrifice it. The split into two abilities is what distinguishes it from **Fading**: the sacrifice keys off the removal that empties the permanent, so it dies the turn its final counter leaves, one upkeep sooner than fading.
_Avoid_: Time-out, fading (they are distinct keywords)

**Time Counter**:
The named counter **Vanishing** places on a **Permanent**; its removal to zero is the trigger condition for the vanishing sacrifice. A plain object counter, not a player resource like a **Poison Counter**.

**Rebound**:
A **Keyword** ability (CR 702.88) on an instant or sorcery: if the spell was **Cast** from its owner's hand it is exiled as it **Resolves** (instead of going to the graveyard), creating a **Delayed Triggered Ability** — "at the beginning of your next upkeep, you may cast this card from exile without paying its mana cost." The recast is optional; declining leaves the card in exile permanently (never the graveyard, CR 702.88c). Only the hand-cast rebounds — the exile recast is not from hand, so it resolves to the graveyard with no second rebound (CR 702.88d). The upkeep cast window reuses the **Madness** reflexive Cast/Decline shape.
_Avoid_: Flashback (that recasts from the graveyard, rebound from exile), buyback, recur

**Blink** (a.k.a. **Flicker**):
An effect that exiles a **Permanent** and returns it to the **Battlefield** as a brand-new object — summoning sickness reset, counters and attachments lost, enters-the-battlefield triggers refired. **Blink** returns it _immediately_, in the same **Resolve** (Ephemerate, Cloudshift); **Flicker** returns it _later_, via a **Delayed Triggered Ability** at a set timing (next end step — Liberate, Flickerwisp). Same exile-then-return shape over different return timing; contrast **Bounce** (return to hand) and reanimation (graveyard→battlefield).
_Avoid_: Bounce, reanimate, phase out

**Text Change**:
A continuous effect that rewrites a word in a card's text — a basic land type (Magical Hack) or a color word (Sleight of Mind) — lasting indefinitely until the object changes **Zone** (CR 612). Because the engine has no runtime text, a text change is modelled as a **Word Substitution** applied to structured data, not to prose.
_Avoid_: Text edit, rename

**Word Substitution**:
The mechanism implementing a **Text Change**: a `{ kind, from, to }` entry carried on a **Card Instance** (`textChanges`) that the engine applies at read time to every structured field carrying that word (land subtype, landwalk keyword, `protection from <color>`, color-based **Target** requirements). The set of word-bearing fields is enforced so a new consumer cannot be silently missed.
_Avoid_: Find-and-replace, text rewrite

**Domain (ability word)**:
An **Ability Word** (CR 702 preamble — italic, no rules meaning) introduced in Invasion: the scalar "number of basic land types among lands a **Player** controls", ranging 0–5 (Plains, Island, Swamp, Mountain, Forest — counted by land _subtype_, so one dual land can contribute several). A card's effect scales with it (Tribal Flames deals that much damage; Kavu Scout gets +1/+0 for each). In code it is one value: `getDomain(player)`, exposed to **Effect Scripts** as the `{ domain: { of } }` value member.
_Avoid_: "the domain" (the knowledge area / this glossary's subject — a homonym; always qualify the mechanic as "Domain (ability word)"), landfall, basic land count

**Pile**:
One of the two subsets a **Player** separates a set of objects into (all their nontoken lands, the top five cards of a **Library**, all creatures a player controls), after which _another_ player chooses one pile; an effect then applies asymmetrically to the chosen vs. unchosen pile (Fact or Fiction, Do or Die, Bend or Break). The divide-then-choose interaction is a two-step **Pending Choice** with distinct divider and chooser players.
_Avoid_: Group, stack (that's the **Stack**), heap, partition (informal only)

**Replacement Effect**:
A continuous effect that watches for an event about to happen and swaps it for a different one before it occurs ("if… would…, instead…", CR 614) — never using the **Stack**. It modifies the event, it does not respond to it (that is a **Triggered Ability**). When several apply to one event the affected **Player** chooses the order (CR 616.1).
_Avoid_: Interrupt, trigger (a replacement fires _before_ the event, a trigger _after_)

**Draw Replacement**:
A **Replacement Effect** on the draw event (CR 614, 121.x): "if a **Player** would draw, instead …". Its condition is a predicate over the draw — who is drawing, whether it is the turn-based **Draw Step** draw, and how many draws that player has already made this **Turn** (so "each opponent", "the first card drawn this turn", "in each of their draw steps" are all expressible). Its outcome may change the number drawn (draw N → N+1), redirect the draw to another effect (make a Treasure instead), or prevent it. Distinct from **Miracle** (which does not replace the draw — the card is still drawn, then a trigger offers a cast window) and from a plain "when you draw" **Triggered Ability**.
_Avoid_: Draw trigger, draw hook

### Spells & Stack

**Cast**:
The process of putting a **Spell** on the **Stack**: announce, choose targets, pay costs.
_Avoid_: Play (for spells — "play" is reserved for lands)

**Resolve**:
A **Spell** or **Ability** on the **Stack** completes its effect and leaves the **Stack**.
_Avoid_: Execute, trigger, fire

**Target**:
A specific **Permanent**, **Player**, or **Spell** chosen during **Casting** that the effect will apply to.

**Spell Copy**:
A **Stack Item** created by copying another spell on the **Stack** (CR 707.10, e.g. Fork). It is not a real card: it carries `isCopy`, inherits the original's resolve/targets/X, may be given a different color via `colorOverride`, and ceases to exist after resolving instead of going to a **Graveyard**. The copy's controller _may_ choose new targets for it (a **Copy-Retarget** target selection).
_Avoid_: Token spell, duplicate

**Spells Cast This Turn**:
A running count of how many **Spells** have been **Cast** by any **Player** this **Turn**, reset at each turn change (`GameState.spellsCastThisTurn`). A **Spell Copy** is put onto the **Stack**, not cast, so it never increments the count. The count read at cast time (the tally of spells cast _before_ this one) rides on the cast event as `priorSpellCount` — the value **Storm** uses for its copy count.
_Avoid_: Storm count, spell counter

**Permanent Copy**:
A **Permanent** that has become a copy of another (CR 707.2, e.g. Clone, Copy Artifact, Vesuvan Doppelganger). The engine overwrites the copy's `card.id` with the copied object's definition id so every characteristic reader (abilities, colors, P/T, types) observes the copy; the printed identity is kept in `copiedFrom` and restored when the copy leaves the battlefield (`revertCopy`). Copy effects copy printed/copiable values only — never counters, damage, tap state, auras, or control. Exceptions (CR 707.9d) are expressed as options: a kept color via `colorOverride`, added types via `additionalTypes`, and a retained ability via a `retainedThroughCopy`-flagged trigger.
_Avoid_: clone-as-token, transform

**Copy Choice (allControllers)**:
A mid-resolution `choose-permanents` **Pending Choice** whose candidates span **every** player's battlefield (CR 707 "a copy of any creature/artifact on the battlefield"), flagged `allControllers`. Applied as the copy enters via `SpellContext.becomeCopyOf` in a resolve step.

### Combat

**Attacker**:
A **Creature** declared as attacking during DECLARE_ATTACKERS.

**Blocker**:
A **Creature** declared as blocking an **Attacker** during DECLARE_BLOCKERS.

**Combat Damage**:
Damage dealt by **Creatures** during COMBAT_DAMAGE (or FIRST_STRIKE_DAMAGE for first strikers).

**Band**:
A group of attacking **Creatures** (1+ with banding, at most 1 without) declared via banding (CR 702.21e). A band attacks and is blocked as a unit — blocking any member blocks them all. Tracked in `combat.bands`.

**Damage Assignment Authority**:
Who chooses how a combat-damage **Source** splits its damage among its targets. Normally the source's controller; **Band**ing flips it to the controller of the banding creature(s) opposite (CR 702.21j-k). Tracked per source in `combat.damageAssignerIds`, with a multi-party confirm handshake (`damageAssignmentConfirmedBy`).

**Pile (Left/Right)**:
A combat-scoped grouping created by Raging River (CR 509 variant): the defender divides their non-flying **Creatures** into a "left" and a "right" pile, and each **Attacker** is labelled left or right. A labelled attacker can be blocked only by **Blockers** with flying or in the matching pile. Modelled as a `partition` **Pending Choice** plus a transient block-restriction on **GameState**, not as a card-level rule.
_Avoid_: Group, side, lane

### Mana

**Mana Cost**:
The resource cost to **Cast** a **Spell** or activate an **Ability**. Expressed as color symbols (W, U, B, R, G) and generic/colorless (C).
_Avoid_: Cost (too vague)

**Mana Pool**:
A **Player**'s current available **Mana**. Empties at end of each **Phase**.
_Avoid_: Resources, energy

**Auto-Tap**:
The engine's automatic selection of which **Mana** sources to tap to pay a **Mana Cost** when the **Player** hasn't picked sources manually. Runs server-side in the **GRE**. _Smart_ auto-tap chooses, among all minimum-tap plans that cover the cost, the one that best preserves **Demands** still playable this turn (CR-neutral UX, mirrors MTG Arena).
_Avoid_: Auto-pay, mana solver

**Demand**:
A thing the active **Player** might still want to pay mana for this turn — a **Spell** in **Hand** or an **Activated Ability** on the **Battlefield** — that smart **Auto-Tap** tries not to strand. Counted only when affordable before payment and legal at the current timing (sorcery-speed demands only at sorcery timing).
_Avoid_: Pending play, future cast

**Mana Value (MV)**:
The total mana in a card's **Mana Cost** (CR 202.3). Abbreviated `mv` in code. Formerly "converted mana cost" (CMC) — that term is obsolete.
_Avoid_: CMC, converted mana cost

**Color**:
One of the five mana colors: White (W), Blue (U), Black (B), Red (R), Green (G). Colorless (C) is not a color.

## Tolaria Engine

Terms specific to this project. These are our design choices, not CR mandates.

### Architecture

**GRE (Game Rules Engine)**:
The server-side rules processor. Validates moves, applies effects, emits events. Pure functions, deterministic given the same input. Runs inside Convex mutations.
_Avoid_: Backend, server logic, game loop

**Projection**:
The transformation of a fat **GameState** into a client-safe view. Strips hidden information (opponent's **Hand** → null array, **Library** → count only). Two variants: public (for gameplay) and full (for debug). The **Battlefield** is otherwise public, with one exception: a **Face-Down Permanent**'s identity is shown only to its **Controller** (see ADR 0013).
_Avoid_: View, snapshot, DTO

**Solo Mode**:
A single-user game where one human controls both **Players**. The UI auto-switches the viewer to whoever has **Priority**. Removes the need for two browser tabs during development and play.
_Avoid_: Single player, practice mode

**vs-AI Game**:
A single-user game where one seat is controlled by the **AI Opponent** instead of the human. Structurally a **Solo Mode** game in which one seat's moves are chosen by the **Bot** rather than clicked by the user. Authority stays server-side: the **Bot**'s move is submitted and validated like any human move (see ADR 0001).
_Avoid_: AI mode, bot match, practice mode

**AI Opponent / Bot**:
The non-human **Player** in a **vs-AI Game**. Chooses legal moves by searching possible game continuations, not by scripted per-card rules.
_Avoid_: CPU, computer player, enemy

**Brain**:
The component that computes the **Bot**'s next move. Distinct from authority: the **Brain** only _proposes_ a move; the **GRE** still validates and applies it. Runs client-side, off the authoritative path.
_Avoid_: AI engine, solver

**Blade Scenario**:
A hand-curated position where the right play is not a matter of opinion, kept as the **Brain**'s correctness metric. A position qualifies only when the wrong move loses something **forced by the rules** — a creature, the game — never merely "worse on average"; a thin-margin position is not a blade.
_Avoid_: AI test, benchmark position, puzzle

**Charter Scenario**:
The four **Blade Scenarios** that define _done_ for the credible-opponent effort: Stifle on one's own punisher trigger, fetchland timing and target, modal choice, and lethal-block defence.
_Avoid_: Acceptance test, milestone scenario

**Discriminating Pair**:
Two **Blade Scenarios** identical except for one card, asserting opposite verdicts. Neither proves anything alone — only the pair distinguishes a **Brain** that reads the consequence from one that always, or never, makes the play.
_Avoid_: A/B test, control pair

**Beyond Budget**:
A position the **Brain** solves only with more search than a real game grants. Recorded with _why_ — too many candidate moves at one decision, a payoff too far ahead, or a hidden-information coincidence that rarely occurs — because each cause names a missing piece of **Brain** knowledge, not a shortfall of thinking time.
_Avoid_: Too slow, needs more iterations, timeout

**Determinization**:
Guessing a concrete possible world for the hidden information (the opponent's **Hand** and the order of the **Library**) so the **Brain** can reason about an otherwise-hidden position as if it were fully known.
_Avoid_: Sampling, guessing, simulation

**Difficulty**:
How much thinking the **Bot** is allowed before moving. A stronger **Bot** is the same **Brain** given a larger search budget, not different logic.
_Avoid_: Level, skill setting

**DecisionTrace**:
A read-only record of what the **Brain** considered for a single move: every candidate move it weighed at the current position, how much each was explored and how good it judged each to be, plus the breakdown of the position **Evaluation** behind those judgements. Produced as a by-product of one search and surfaced for debugging — it never affects the chosen move and never leaves the client.
_Avoid_: Log, debug dump, reasoning log

**Evaluation**:
The **Brain**'s numeric judgement of how good a position is for a given **Player**, summed from weighted terms (life, cards in **Hand** via **Card Value**, creature power, board presence, available **Mana**, and the **Danger Clock**). A higher number is better for that player; the **Brain** prefers moves leading to positions it evaluates highly. Tuned for ordering, not absolute magnitude.
_Avoid_: Score, heuristic, fitness

**Card Value**:
The **Brain**'s worth of a single card, in **Evaluation** units. Has two faces: _latent_ value (potential while the card sits in **Hand**/**Library**/**Graveyard**) and _realized_ value (a **Permanent**'s contribution once on the **Battlefield**, its power/toughness/keywords). Derived from card characteristics (mana value, P/T, keywords), with an optional per-**Card Definition** override for cards the heuristic misjudges. Lets the **Brain** prefer keeping/fetching a bomb over a **Land** and refuse to spend a good card for no effect.
_Avoid_: Card weight, card score, rating

**Danger Clock**:
The **Brain**'s read of the race: each **Player**'s estimated turns-to-lethal (life ÷ incoming **Combat Damage**, net of available **Blockers**). The **Evaluation** rewards holding the faster clock, so the **Bot** both defends when threatened and pushes damage when ahead instead of stalling. Estimates the threat beyond the search's turn-boundary horizon.
_Avoid_: Threat level, aggro score, race

**Compact State**:
The serialized form of **GameState** stored in Convex. Strips defaults, coalesces against **Card Definitions**, and compresses **Library** entries to `[instanceId, cardId]` tuples.
_Avoid_: Blob, serialized state, stored state

### Card System

**Card Definition**:
A static, immutable data record describing a card's properties: name, mana cost, types, abilities, and resolve behavior. Keyed by **Card ID**. Lives in the card registry.
_Avoid_: Card template, card data, card spec

**Card Instance**:
A mutable runtime representation of a specific copy of a card in a **Game**. Carries an **Instance ID**, current zone, tap state, damage, counters, and modified abilities. One **Card Definition** may have multiple **Card Instances** in a game.
_Avoid_: Card copy, card object, card state

**Card ID**:
The Scryfall UUID identifying a **Card Definition** (its mechanics). Immutable, shared across all games. Edition-specific art is selected by **Print ID**, not the **Card ID** — though for a card with a single printing the two coincide.
_Avoid_: Definition ID, Scryfall ID

**Instance ID**:
A unique identifier for a **Card Instance** within a single **Game**. Used as React keys, target references, and attachment pointers. Assigned at game creation.
_Avoid_: Card UUID, runtime ID

**Card Print**:
A per-edition record (`CardPrint`) mapping a **Print ID** to the **Card ID** of an existing **Card Definition**, plus a set code. It carries no mechanics — it exists so a **Reprint** can supply edition-specific art while reusing the original definition. The registry resolves both the **Card ID** and every **Print ID** to the same **Card Definition**.
_Avoid_: Edition, variant, version

**Print ID**:
The Scryfall UUID of one specific printing of a card. Distinct from the **Card ID** (which keys the mechanics). A **Card Instance** stores the **Print ID** so the chosen edition's art renders while behaviour comes from the shared **Card Definition**.
_Avoid_: Edition ID, art ID

**Rarity**:
The printed rarity of a card — one of `common`, `uncommon`, `rare` (CR 206). A property of a **printing**, not of the underlying card: a home-set **Card Definition** carries its home-set rarity and each **Card Print** carries its own, so a card reprinted at a different rarity differs per edition. Backfilled across the catalogue from MTGJSON; the card generator emits it for every new card and refuses any value outside the three. Informational for **Basic** lands (they are gated by the `Basic` supertype, not rarity). Consumed by rarity-budgeted **Formats** (Alpha 40).
_Avoid_: Frequency, tier

**Reprint**:
A card appearing in a later **Set** whose mechanics already exist as a **Card Definition** in an earlier set. Modelled as a **Card Print** only — never a duplicated definition. A **Set** file contains a mix of new **Card Definitions** (cards first implemented in that set) and **Card Prints** (reprints of cards already implemented).
_Avoid_: Duplicate, copy (overloaded — see **Spell Copy**)

**Set**:
A published card collection, identified by a set code (e.g. `lea` = Alpha, `leb` = Beta). One source file per set. A card may be **out of scope** for the engine (declared in an ADR); such a card stays commented in every set it appears in, so "set complete" means "complete minus the named exclusions".
_Avoid_: Edition, expansion (use the set code)

**SpellContext**:
The API surface available to a **Card Definition**'s `resolve()` function. Provides composable primitives (moveZone, drawCards, damage, gainLife, etc.) that the resolver calls to apply effects.
_Avoid_: Resolver, effect context, spell API

**Effect Script**:
The declarative, serializable form of a **Card Definition**'s effect: an ordered list of **Ops** connected by exactly four structural constructs — bind, ref, if, forEach. Interpreted by the engine; the grammar is frozen while the **Op** vocabulary grows. A card whose effect cannot be expressed as an Effect Script uses `resolve()` instead (the escape hatch for protocol-like cards).
_Avoid_: DSL script, effect JSON, card script

**Op**:
A single vocabulary entry of an **Effect Script** (dealDamage, draw, destroy, choice, …). Each Op maps to an engine primitive; new Ops may be added freely, new structural constructs may not.
_Avoid_: Instruction, command, opcode

**Capture**:
The named values a **Delayed Triggered Ability**'s body carries across time. Each capture is declared explicitly on the scheduling **Op** and resolved to a plain identity or amount at scheduling; when the trigger fires, the body reads it back as a ref. Nothing crosses the schedule→fire boundary implicitly — the card's script states exactly what the future ability remembers.
_Avoid_: Closure, snapshot (that term is reserved for last-known-information binds)

**Mechanics Registry**:
The machine-readable census of every CR keyword ability (702) and keyword action (701), each with an implementation status and its engine binding (**Op** name or static ability). The single authority on mechanic names: cards and **Effect Scripts** may only reference mechanics it lists. Census is total; implementation is demand-driven.
_Avoid_: Mechanics doc, keyword list, capability matrix

**Holding Bundle**:
A record that pulls a **Permanent** (plus the Auras attached to it and a snapshot of its counters) off the battlefield as a unit and remembers how to put it back. Two flavours: the **phased-out bundle** (`phasedOut`, ADR 0021) keeps the same object off-battlefield with no zone change or triggers; the **exile-and-return bundle** (`exileHeld`, ADR 0028) is a real exile — leaves/enters triggers fire, the returned object is new, and counters are _noted_ then re-applied. The bundle's existence doubles as the "delayed return is armed" flag.
_Avoid_: Limbo, stash, suspended permanent

**Library Tutor**:
A search effect: `requestChoice({ kind: "search-library" })` reveals the searcher's library and picks a card (optionally gated by a `candidateIds` allow-list for a typed search), then routes it — to hand (`moveCardById`) or onto the battlefield (`putFromLibraryOntoBattlefield`, ADR 0027) — and shuffles.
_Avoid_: Fetch, search primitive

**Deck**:
The list of **Card IDs** a **Player** brings to a **Match**, split into a **Maindeck** and a **Sideboard**. Used at the start of each **Game** to build the initial **Library** from the current **Maindeck**. Static metadata — never mutated during gameplay; only altered between **Games** by **Sideboarding**.
_Avoid_: Library (that's the zone), card list

**Maindeck**:
The portion of a **Deck** that builds a **Player**'s starting **Library** for a **Game**. The cards actually played. Its size is fixed for the duration of a **Match** — **Sideboarding** may swap which cards are in it but not how many.
_Avoid_: Mainboard (we use Maindeck), main, library

**Sideboard**:
The portion of a **Deck** held outside the **Maindeck** (0–15 cards). Not used to build the starting **Library**. Between **Games** of a **Match**, **Sideboarding** exchanges cards between the **Sideboard** and the **Maindeck**.
_Avoid_: Side, bench, reserve

**Sideboarding**:
The step between two **Games** of a **Match** where a **Player** may exchange cards between **Maindeck** and **Sideboard**, keeping the **Maindeck** size constant and the combined card pool unchanged. Produces the **Maindeck** used to build the next **Game**'s **Library**.
_Avoid_: Swapping, boarding, side-in/side-out

**Companion**:
A card in a **Player**'s **Sideboard** carrying the **Companion** keyword and a deck-construction condition on the **Maindeck** (Lurrus: every permanent card has mana value ≤ 2; Lutri: singleton). When the condition holds, the card is revealed at **Game** start and held in the **Companion Slot** — a single per-**Player** holder outside the game. Once per **Game**, as a special action at sorcery timing, its controller pays {3} to move it to **Hand**, from where it is cast normally. A **Companion** whose condition fails is an ordinary, inert **Sideboard** card.
_Avoid_: Commander (a different singleton mechanic), pet, sidekick

**Companion Slot**:
The single per-**Player** holder for a declared **Companion**, distinct from every in-game **Zone** (it is _outside the game_, not the **Battlefield**/**Hand**/**Exile**). Holds at most one card, is revealed to both **Players**, and tracks whether the once-per-**Game** {3} summon has been spent. Not a general "outside the game" **Zone** — it models a **Companion** and nothing else.
_Avoid_: Command zone, outside-game zone (reserved for a future general zone)

**Format**:
A named set of deck-construction constraints a **Deck** is built under, chosen at deck creation and **immutable** thereafter. Determines which **Sets** are legal, the **Maindeck**/**Sideboard** size bounds, and the copy/category limits. Three exist: **Freeform** (no constraints), **Alpha 40** (Alpha/Beta only, ≥40 main, no sideboard, rarity- and category-based limits), **Old School** (Alpha/Beta/Arabian Nights/Antiquities/Legends/The Dark, ≥60 main, ≤15 sideboard, 4-copy + **Restricted**/**Banned** lists). A **Format** constrains deck authoring only — it is **not** a property of a **Game**, and two **Players** may bring **Decks** of different **Formats** to the same **Match**.
_Avoid_: Mode, ruleset (overloaded — see **Format Ruleset**), variant

**Format Ruleset**:
The published banned/restricted policy a **Format** is modelled on. **Old School** follows **Eternal Central** for its **Restricted** list, with the **Swedish (n00bcon)** ban of the manual-dexterity cards (Chaos Orb, Falling Star) layered on. Lives entirely in code — a policy change is a code release, not a data edit.
_Avoid_: Banlist (that's one part of it)

**Deck Legality**:
Whether a **Deck** satisfies its **Format**'s constraints — a derived boolean plus a list of human-readable reasons, computed by validating the **Deck** against its **Format** at read time. **Never stored**: it is a pure function of deck contents, **Format**, and current code, so a ruleset deploy reclassifies every **Deck** automatically. An illegal **Deck** is still saved (a draft) but cannot be selected to start a **Game**.
_Avoid_: Valid, well-formed, deck check

**Restricted Card**:
A card a **Format** limits to **one copy** in a **Deck** (Old School, per the **Eternal Central** list). Counted by **Card ID** across all **Card Prints** — two printings of the same card share the one-copy budget.
_Avoid_: Limited card, banned card (banned means zero)

**Banned Card**:
A card a **Format** forbids entirely (zero copies). In practice every **Banned Card** here is also unimplementable (ante cards, Shahrazad, manual-dexterity cards) — so the list is a documentation guard against a future stub, not an active filter.
_Avoid_: Restricted (restricted means one), illegal

**Moderated Card** (Alpha 40):
A card **Alpha 40** caps at **three copies** regardless of its **Rarity** (e.g. Lightning Bolt, Counterspell, Swords to Plowshares — commons that would otherwise be unlimited). One of Alpha 40's per-card overrides.
_Avoid_: Restricted (that's a one-copy, different-format concept)

**Category Budget** (Alpha 40):
A named list of cards from which an **Alpha 40** **Deck** may include **at most one card total** (not one of each): Fast Mana, Power, Draw, Destruction, Charm. A card appearing in two lists consumes **both** budgets (Ancestral Recall is both Power and Draw, so including it bars every other Power and Draw card).
_Avoid_: Restricted slot, power category (overloaded with the "Power" budget itself)

**Rarity**:
A card's print rarity (`common` / `uncommon` / `rare`), carried per **Card Print** (and on the home-set **Card Definition**) and sourced from MTGJSON. Used only by **Alpha 40**, which caps copies by rarity (commons unlimited, uncommons ≤6, rares ≤3) before its **Moderated** and **Category Budget** overrides apply.
_Avoid_: Frequency, tier

**Limited Event**:
An admin-created gathering of N **Players** that produces one **Limited**-legal **Deck** per seat: setup (admin picks sets/boosters) → pool generation (**Sealed**) or **Draft** → deckbuild from the pool. The Event **ends at the built Deck** — it does not orchestrate **Matches**; participants then play through the existing Match flow. Pairing, rounds, and standings are out of the Event's boundary (deferred).
_Avoid_: Tournament (implies pairing/standings), lobby (that's constructed matchmaking)

**Draftable Set**:
A **Set** eligible for a **Limited Event**: every **Booster Sheet** of the set retains at least 80% of its cards as implemented **CardDefinitions**, after cards declared **out of scope** by ADR are treated as absent from the print run. Unimplemented cards below that per-sheet ceiling are **dropped from the sheet** (weights renormalized, same mechanism as ADR-excluded cards) — never rendered as placeholders. The 80% per-sheet floor is a **temporary onramp** to ship a Limited experience before every set is fully censused; the standing goal remains 100% implementation, and a set below 100% surfaces an **Incompleteness Notice** at event creation. A sheet under the 80% floor makes the whole set non-draftable.
_Threshold is per-sheet, not per-set: a set can be 82% overall yet have a rare sheet at 52% (its long tail of complex cards) — a broken slot a per-set average would hide._

**Incompleteness Notice**:
The user-facing warning shown at **Limited Event** creation whenever a chosen **Draftable Set** is below 100% implemented — the honest disclosure that the Limited environment is an approximation of the real print run, missing some cards. Present as long as the per-sheet 80% onramp exists; disappears per set the day that set reaches 100%.
_Avoid_: Complete set (completeness is the criterion, draftability is the status), supported set

**Booster**:
A generated pack of **Card Prints** for a **Draftable Set**, produced by sampling the set's **Booster Config**. Purely a Limited-Event artifact — a Booster never exists during gameplay.
_Avoid_: Pack (informal only), pool (that's the aggregate)

**Booster Config**:
The per-**Set** data describing how a **Booster** is assembled: slots and weighted **Booster Sheets**, imported from MTGJSON via a repo script (like the rarity backfill) and checked into the repo. Foil and variant slots are dropped — foilness does not exist in the engine.
_Avoid_: Booster rules (it is data, not code), pack template

**Booster Sheet**:
A weighted list of **Card Prints** (an MTGJSON print sheet) from which one **Booster** slot draws. Preserves the real print-run distribution of old sets instead of a flat per-rarity draw.
_Avoid_: Rarity slot (a sheet may mix rarities)

**Pack Source**:
What generates the packs of a **Limited Event**. Today the only kind is a **Draftable Set**'s **Booster Config**, chosen per pack slot by the **Admin** (e.g. three INV boosters, or a mixed sequence). A cube (custom card list dealt into 15-card packs, Draftmancer-style) is a planned second kind of Pack Source, deferred.
_Avoid_: Booster type, product

**Seat**:
A numbered position (2–8, chosen by the **Admin**) at a **Limited Event**, occupied by either a **User** (joined via the event lobby) or a **Bot Drafter** (auto-filling every seat still empty at event start). Seat order defines **Draft** passing adjacency. The solo draft — one human, all other seats bots — is a primary use case, not a degenerate one.
_Avoid_: Slot (that's a **Booster** position), player (a Seat exists before any **Game**)

**Bot Drafter**:
The non-human occupant of a **Seat** in a **Limited Event**. Picks and deckbuilds are computed **server-side in Convex** (deterministic, seeded PRNG, no dependency on any connected client) — deliberately unlike the gameplay **Bot**, whose ISMCTS **Brain** runs client-side. A pick is a lightweight scoring decision, not a search.
_Avoid_: Draft AI, the Bot (that's the gameplay opponent — different component, different host)

**Pick Rating**:
A per-card score (0–5, Draftmancer-style) in an optional per-**Set** data file checked into the repo, expressing how highly a **Bot Drafter** values the card in that set's Limited environment. Curated by hand or imported from community sources. A **Draftable Set** without ratings still drafts via the **Pick Heuristic** — ratings refine, never gate.
_Avoid_: Card Value (that's the gameplay **Brain**'s evaluation term), tier, grade

**Pick Heuristic**:
The always-available fallback scoring a **Bot Drafter** uses when no **Pick Rating** exists (and as the tie-breaking layer when one does): card quality (shared with the **Brain**'s **Card Value**, extracted to a server-usable module) adjusted by **Rarity**, the seat's color commitment, and mana-curve needs.
_Avoid_: Bot logic (too broad), default rating

**Draft**:
The classic booster draft flow of a **Limited Event**: three **Boosters** per **Seat**; each round every seat **Picks** one card and passes the rest to the adjacent seat (left, then right, then left per booster). Picking is **synchronous**: seats pick in parallel, a passed pack queues at the receiving seat, and an optional per-pick timer (on/off only — when on, each pick within a pack gets progressively less time, following the official Wizards booster-draft schedule) fires an **Auto-Pick** on expiry so an absent human never freezes the table. **Bot Drafters** pick instantly.
_Avoid_: Rochester/Winston (other draft variants, out of scope for now)

**Pick**:
The act of a **Seat** taking exactly one card from the **Booster** currently in front of it during a **Draft**. Picked cards accumulate into the seat's **Pool**. Hidden information: a seat never sees another seat's picks.
_Avoid_: Choice (that's the gameplay **Pending Choice**), selection

**Auto-Pick**:
The **Pick** made on a human **Seat**'s behalf when its **Draft** timer expires. Resolves the seat's **Selected Card** if one is set; otherwise falls back to the **Pick Rating**/**Pick Heuristic** engine a **Bot Drafter** uses. Never randomly.
_Avoid_: Random pick, skip

**Selected Card**:
A human **Seat**'s tentative choice within the **Booster** currently in front of it during a **Draft**, set by a single click (which only selects — it never commits the **Pick**). Server-persisted so the **Auto-Pick** timeout resolver can honour it. A committing gesture — double-click, the context-menu **Pick** action, or a drag into the **Pool**/**Sideboard** — takes the **Pick** immediately, bypassing selection.
_Avoid_: Highlight, hover (that's the transient preview)

**Sealed**:
The simpler **Limited Event** flow: each **Seat** receives N unopened **Boosters** (default 6, admin-configurable) whose contents form the seat's **Pool** directly — no picking, no passing.
_Avoid_: Sealed deck (the Deck is what gets built from the Pool afterwards)

**Pool**:
The set of **Card Prints** a **Seat** owns for deckbuilding in a **Limited Event** — the accumulated **Picks** (Draft) or the opened **Boosters**' contents (Sealed). The Pool, plus unlimited basic lands, is the universe the seat's **Deck** may draw from.
_Avoid_: Card pool (redundant), collection

**Pool Arrangement**:
The **Seat**-scoped, server-persisted layout of a **Seat**'s **Pool** into fixed **Mana Value** columns plus a **Sideboard** column, with a per-card manual column override (a card pinned to a chosen column stays there, Draftmancer/MTGO-style). It is built up **during the Draft** — each **Pick** lands by default in its Mana Value column — and carries unchanged into the post-draft **Deck**-build: draft and deckbuild are one continuous surface, the build view merely dropping the active **Booster**. Distinct from the **Pool** itself (the authoritative card multiset on the Seat): the Arrangement is presentation/deck-intent over that multiset, never the legality authority.

**Auto-Build**:
The server-side construction of a **Limited**-legal **Deck** from a **Bot Drafter**'s **Pool** at the end of a **Limited Event**: pick the two strongest colors, ~17 spells + 17 lands, curve-aware. A bot's auto-built Deck is playable — a **User** can start a **vs-AI Game** against any bot **Seat**'s deck, closing the study loop (draft, then test your deck against the table's).
_Avoid_: Autopilot, deck generation (too generic)

**Limited (Format)**:
A **Format** whose **Deck Legality** is scoped to a **Pool** rather than to a card catalogue: the **Deck** carries its whole Pool — **Maindeck** (≥40, unlimited basic lands added freely) plus every unplayed Pool card in the **Sideboard** (no 15-card cap). Validation compares the deck's multiset (minus basics) against the authoritative Pool stored on the **Seat** (the deck references its **Limited Event** + Seat). **Sideboarding** between **Games** moves cards across the Pool boundary — already supported by the Match flow.
_Avoid_: Draft format (Sealed is Limited too), 40-card format

**Preset Deck**:
A curated, shared **Deck** that every **User** can pick but only an **Admin** can edit — the built-in decklists offered in the lobby. Has no **Owner**: it belongs to the application, not to a **User**. Identified by a stable **Slug** (not a Convex id) so external references (saved lobby selection, debug scenarios) survive edits. Distinct from a **User Deck**, which a single **User** owns and edits.
_Avoid_: Default deck, starter deck, template (overloaded)

**User Deck**:
A **Deck** owned and edited by a single **User**, private to them. The counterpart to a **Preset Deck**: same shape, but **Owner**-scoped and identified by its Convex id rather than a **Slug**.
_Avoid_: Custom deck, personal deck

**Format**:
The set of deck-construction constraints a **Deck** is built under — one of `freeform`, `alpha-40`, or `old-school`. Chosen at deck creation and immutable thereafter (cross-format reuse goes through export → new deck → import). Stored as a typed value on the **Deck** row; its rules live entirely in code (`convex/formats.ts`, the **Format Ruleset**), never in the DB (ADR 0036). Distinct from a **Match Format** (Bo1/Bo3), which is about how many **Games** a **Match** runs.
_Avoid_: Match format, Bo1/Bo3 (different concept), game mode

**Format Ruleset**:
The code-side rules for a **Format**: its label, allowed **Sets**, deck-size bounds, and a pure `validate()` seam producing the **Deck Legality**. Lives in the `FORMAT_RULES` registry in `convex/formats.ts`, imported by both server and client so the authoritative gate and the live builder panel never disagree. In the foundation slice the validators return no reasons (every deck is legal); later slices add Old School's restricted/banned lists and Alpha 40's rarity/category budgets.
_Avoid_: Format config, format data (it is code, not DB data)

**Deck Legality**:
Whether a **Deck** satisfies its **Format**'s **Format Ruleset** — an `isLegal` flag plus a list of failure reasons. Always **derived** at read time from the deck contents + the code-side rules, never stored, so a ruleset or card-pool change reclassifies every deck with no migration.
_Avoid_: Validity (too generic), legal flag (it carries reasons too)

**Slug**:
A stable, human-readable string key for a **Preset Deck** (e.g. `mono-red-burn`), derived from its name at creation and immutable thereafter. The public identity used wherever a preset is referenced outside the DB (lobby selection persisted client-side, debug scenarios). Distinct from a Convex id, which is random and per-row.
_Avoid_: ID (overloaded), handle, key

### Identity

**Player ID**:
An opaque string handle for a **Player** in a **Game**. For two-player games, equals the user's Convex ID. For **Solo Mode**, suffixed with `-p1`/`-p2`.
_Avoid_: User ID (different concept)

**Controller**:
The **Player** who currently controls a **Permanent** or **Spell**. Defaults to **Owner** but can change via effects.
_Avoid_: Player (too vague when control changes)

**Owner**:
The **Player** who started the game with a card in their **Deck**. Never changes. **Tokens** are owned by the **Controller** who created them.

**Acting Player**:
The **Player** who answers the prompts (card choice, **Targets**, X, mode, additional-cost picks, mana-source selection) for a **Cast** or **Resolve** whose **Controller** is someone else. Normally the **Acting Player** equals the **Controller**; they diverge only when one **Player** is deciding on another's behalf (Word of Command: WoC's **Controller** is the **Acting Player** for a card cast/played from the controlled **Player**'s **Hand**, while the controlled **Player** remains its **Controller** and supplies its resources). Carried as `actingPlayerId` on the cast state and on the resulting **Stack Item** so the override persists through that item's **Resolve**.
_Avoid_: Decision-maker, proxy player, controller (that's whose object it is, not who decides)

**Admin**:
A **User** flagged with elevated rights (`isAdmin` on the users row). The only **User** allowed to create, edit, or delete **Preset Decks**. The flag is the sole authority — server mutations check it directly; hiding controls in the UI is cosmetic only. Distinct from a **Player** (a seat in a **Game**) and from **Owner** (deck/card ownership in a **Game**).
_Avoid_: Superuser, moderator, root

### Interaction

**Play Area**:
The viewport MINUS the board's right strip (`--right-piles-w`). The right strip is reserved for the **piles** (library/exile/graveyard), the controller phase pod, and the lateral card preview, and is visually decoupled. Play-area content (dialogs, the player nameplate, the **Stack**) centers/anchors on the play area via the shared `.play-area-center-x` utility (`left: calc(50% - var(--right-piles-w)/2)`), so it sits over the play area, not the full viewport. Left-side dev overlays (**Debug** panel, AI-decision trace) simply float over the edges and never reserve width or affect centering. Portrait collapses the strip to `0px`, so everything centers on the full viewport.
_Avoid_: Board area, canvas

**Card Preview Overlay**:
A full-screen centered overlay showing a card's art and oracle text at maximum legible size. On touch devices, triggered by **Long-Press**. On desktop, the lateral zoom panel serves the same purpose (triggered by hover).
_Avoid_: Tooltip, zoom (overloaded — "zoom" is the desktop variant)

**Action Sheet**:
A bottom sheet listing available actions for a card when more than one is legal (cast, play land, activate abilities). Touch-device replacement for the desktop right-click context menu.
_Avoid_: Context menu (that's the desktop variant), popup

**Long-Press**:
A 400ms sustained touch on a card that opens the **Card Preview Overlay**. Cancelled if finger moves >10px (scroll intent). Provides visual feedback via progressive scale (1.05×).
_Avoid_: Long tap, press-and-hold

**Peek/Lock**:
The dismiss model for the **Card Preview Overlay** on touch devices. Release before 1s = peek (closes immediately). Hold >1s = lock (stays open, dismiss via tap on backdrop).

### Flow

**Expected Input**:
The single authoritative declaration of what the **Game** is waiting for at a stable point: which **Player** must act and what kind of input is legal (choice, target, priority, blockers). Maintained by the engine — every game mutation is gated against it, and UI, bot, and timeout all read it as their one contract. The explicit form of the game's waiting-state machine.
_Avoid_: Waiting state, pending state, game mode

**Announce**:
The first step of **Casting**: the client declares intent to cast a card. Reserves the card, puts it on the **Stack**, and waits for target selection and mana payment.
_Avoid_: Start casting, begin cast

**Pending Choice**:
A mid-resolution decision point where a **Spell** or **Ability** requires a **Player** to make a selection (choose targets, divide damage, search library). **Priority** is frozen until the choice is submitted.
_Avoid_: Prompt, dialog, selection

**Random Reveal**:
A special **Pending Choice** where the engine — not a **Player** — produces the value: it draws a random outcome from the seeded PRNG, persists it, and suspends the resolving step **before the consequence is applied**, so both clients can animate the outcome first. The chooser's client auto-acknowledges when the animation ends; the engine then resumes and applies the effect. Generalizes over **Coin Flips** and future die rolls.
_Avoid_: Random prompt, RNG dialog

**Coin Flip**:
A **Random Reveal** with two faces (CR 705.2), defaulting to WIN / LOSE relative to the flipping **Player**. The drawn bit is generated once and read back on replay — never re-rolled. Used by Bottle of Suleiman, Mijae Djinn, Ydwen Efreet.
_Avoid_: Heads-or-tails (unless a card overrides the face labels), toss

**Auto-Pass**:
A client preference where a **Player** automatically passes **Priority** during specified **Phases** when they have no legal actions. Can be cancelled.
_Avoid_: Auto-skip, fast-forward

**Drain Auto-Pass**:
The engine-side loop that applies consecutive **Auto-Passes** after a **Priority** change, without requiring round-trips to the client.
_Avoid_: Auto-pass chain, cascade

## Example Dialogue

> **Dev**: "When a creature dies, we need to move it."
> **Domain**: "A **Creature** that dies moves from the **Battlefield** to its **Owner**'s **Graveyard**. That's an **SBA** — it happens automatically before any **Player** receives **Priority**. If anything triggers on death, those **Triggered Abilities** go on the **Stack**."
>
> **Dev**: "What if a card gives all creatures +1/+1?"
> **Domain**: "That's a **Static Ability** on a **Permanent**. It applies continuously via the layer system — no **Stack** involvement. Each **Card Instance** on the **Battlefield** gets modified power/toughness. The **Card Definition** stays unchanged."
>
> **Dev**: "Player wants to Lightning Bolt a creature."
> **Domain**: "The **Player** **Announces** Lightning Bolt — it goes on the **Stack** as a **Spell** with a **Target**. The opponent gets **Priority** to respond. If both pass, it **Resolves**: the **SpellContext** calls `damage(target, 3)` on the targeted **Card Instance**. Then **SBAs** check if the creature has lethal damage."
