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

**Opponent**:
The other **Player** in a **Game**.
_AKA_: Oppo

**Turn**:
One full cycle of **Phases** for the **Active Player**. Numbered sequentially from 1.
_Avoid_: Round

**Poison Counter**:
A counter that sits on a **Player** rather than on a **Permanent** or **Card Instance**. A Player who accumulates ten or more loses the **Game**. A distinct player-level resource — not the named counters carried by objects.
_Avoid_: damage, life loss (poison is its own resource and its own loss condition)

**Phase**:
A subdivision of a **Turn**. Tolaria implements 14 phases: `MULLIGAN`, `UNTAP`, `UPKEEP`, `DRAW`, `PRECOMBAT_MAIN`, `BEGINNING_OF_COMBAT`, `DECLARE_ATTACKERS`, `DECLARE_BLOCKERS`, `FIRST_STRIKE_DAMAGE`, `COMBAT_DAMAGE`, `END_OF_COMBAT`, `POSTCOMBAT_MAIN`, `END_STEP`, `CLEANUP`. The list describes one canonical **Turn**, not a guarantee of occurrence: a phase may be skipped, and a phase may occur **more than once** in the same Turn (see **Extra Phase**).
_Avoid_: Step (CR distinguishes phases and steps; we flatten both into "phase"); treating the list as an order each Turn walks exactly once

**Extra Phase**:
A **Phase** an effect adds to the **Turn** already in progress, occurring directly after a named one (CR 500.8). The added phase is a full phase — every constituent step, each with its normal **Priority** windows and turn-based actions — and once created it is independent of the effect that made it. Several added after the same phase occur most-recently-created first. Tolaria grants one kind, an extra **Combat** phase; the **Turn** number does not change, so a **Turn** may contain two combats.
_Avoid_: Extra turn (that's CR 500.7, a whole additional **Turn** — a different mechanism and a different boundary), additional combat step (it is a phase, not one step of one)
_AKA_: Additional phase, additional combat phase

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

**As-Enters Choice**:
A player decision a **Replacement Effect** requires before a **Permanent**
enters the **Battlefield** (CR 614.1c / 614.12a) — the copy pick of a Clone, the
colour of Voice of All, the name of Meddling Mage, the body of Primal Clay, and
the **Land-Entry Pay-Choice** as its land-only special case. Declared as data on
`entersWith.asEnters`, never as an **Effect Script**: a replacement is a
declaration, not an effect that resolves. Owed on _every_ entry path, not only
on a cast (ADR 0100), and the owed list GROWS mid-flight — a copy's choice is
answered first, and the copied card's own as-enters choices are then discovered
and owed afresh (CR 707.6).
_Avoid_: ETB choice (an ETB **Trigger** resolves off the **Stack** after the
permanent has entered — the opposite timing)

**Staged Entry**:
A **Permanent** that has left its origin zone but has not yet entered the
**Battlefield** because its controller still owes an **As-Enters Choice**. Held
in `GameState.stagedEntries`, **off every zone**, so no **SBA** sweep and no
wire projection ever observes it mid-choice — which is what keeps a copy card
from entering as its printed 0/0 and dying (CR 704.5f) before it becomes a copy
(CR 707.5). Resumed by a single finalize once the owed list empties.
_Avoid_: pending entry, provisional entry (that is the opposite shape — the
permanent already on the battlefield with its event deferred)

**Token**:
A **Permanent** not represented by a physical card. Created by effects. Ceases to exist when it leaves the **Battlefield**.

**Attachment**:
A **Permanent** attached to another **Permanent** — an **Aura** or an **Equipment**. The umbrella term for anything that tracks a **Host**. Grants its static/triggered abilities to the Host while attached.
_Avoid_: Attached card, buff (a buff is one possible effect, not the object)

**Host**:
The **Permanent** an **Attachment** is currently attached to (the enchanted or equipped object).
_Avoid_: Target (the Host is chosen by targeting, but "host" is the ongoing relationship), parent

**Aura**:
An **Enchantment** **Attachment**. If its **Host** becomes illegal or it ends up unattached, it is put into its owner's **Graveyard** (CR 704.5m/704.5n) — with one exception, a **Bestowed Permanent**, which stays on the **Battlefield** and becomes a **Creature** instead.
_Avoid_: Enchantment (broader — not every enchantment is an Aura)

**Enchant Restriction**:
What an **Aura** may legally be attached to (CR 303.4 — "defined by its enchant keyword ability"). Two origins, and an object can carry both at once: **printed**, normalized from the card's cast-time target requirement (Control Magic's "enchant creature"), and **granted**, stamped on a single **Permanent** that _becomes_ an Aura while on the **Battlefield** ("it becomes an Aura with enchant creature"). ONE predicate resolves them, and it conjoins rather than ranks — CR 702.5c, "all of them apply … only objects or players that match all of its enchant abilities". A granted restriction may name one specific object rather than a characteristic, which no printed one can. It is **Battlefield-scoped**: it exists only while the object does (CR 400.7), so it is cleared on every departure _and_ before any entry-time legality question — an Aura leaving and re-entering keeps only its printed clause. That scoping is what makes the offered **Host** set (CR 303.4f) and the enforced one (the CR 704.5m **SBA**) agree: one predicate is not enough on its own if the two sites read it at moments where the data differs.
_Avoid_: Target requirement (that is the cast-time announcement; the enchant restriction outlives it and applies to a Permanent), enchant ability

**Bestowed Permanent**:
An enchantment creature card cast for its **Bestow** cost, which is an **Aura** for as long as it stays attached (CR 702.103). While attached it is **not a Creature**; the moment it becomes unattached it stops being an Aura and reverts to being a creature on the **Battlefield**, rather than going to the **Graveyard**. The type change is a **Continuous Effect**, recomputed at every read (ADR 0084) — never a stored rewrite of the card's types, which is reserved for copiable-value changes like **Turn Face Up** and transform.
_Avoid_: Aura (a Bestowed Permanent is one only conditionally), Enchantment Creature (that is the card; "bestowed" is how it was cast)

**Equipment**:
An **Artifact** **Attachment** (subtype Equipment) attached to a **Creature** via **Equip**. Unlike an **Aura**, when its **Host** becomes illegal it **detaches and stays on the Battlefield** unattached (CR 704.5q). **Control-independent**: it stays attached to its **Host** even if its **Controller** no longer controls that Host (CR 301.5c) — the "you control" restriction binds only at **Equip** time.
_Avoid_: Artifact (broader), Aura (different detach outcome)

**Equip**:
The sorcery-speed **Activated Ability** of an **Equipment** — "Equip {cost}: attach to target creature you control" (CR 702.6). Uses the **Stack**; its target must be a **Creature** the **Controller** controls at activation and at resolution.
_Avoid_: Attach (Attach is the underlying keyword action; Equip is the ability that performs it), cast

**Enchanted**:
Said of a **Permanent** that is the **Host** of at least one **Aura**, whoever controls that Aura. Strictly narrower than "has an **Attachment**": an **Equipment** makes its Host _equipped_, never enchanted, and a Fortification makes a **Land** _fortified_. The distinction is load-bearing wherever a card selects by it ("target permanent that isn't enchanted"), because counting attachments instead of Auras silently changes which permanents are legal.
_Avoid_: Attached (broader — covers Equipment and Fortification), equipped (a different attachment relation)

**Snow**:
A supertype (CR 205.4a) marking a **Permanent** as snow. In the Ice Age block snow is referenced only _by type_ ("a snow-covered land", "sacrifice a snow Mountain"); the `{S}` snow-mana symbol is a later (Coldsnap) addition and is **not** used by these sets, so snow needs no mana-system support here — only the supertype on the five snow-covered basics and the few cards that filter on it.
_Avoid_: Snow-covered (the printed basic-land name, not the supertype)

**Face-Down Permanent**:
A **Permanent** on the **Battlefield** whose identity is hidden from players other than its **Controller** (CR 708). Presented to everyone as a 2/2 colorless nameless **Creature** with no abilities; the real card underneath is known only to the **Controller** until it is **Turned Face Up**. The one exception to the otherwise-public **Battlefield** (Illusionary Mask).
_Avoid_: Morph, hidden card, masked creature

**Turn Face Up**:
The event that reveals a **Face-Down Permanent**'s true identity, after which it is a normal **Permanent** with its real characteristics. How it may happen depends on **why** the permanent is face down: for Illusionary Mask it happens automatically (as a replacement) the moment the creature would deal or be dealt damage or become tapped, and can never be paid for; for a **Manifested** permanent its **Controller** may choose to turn it face up by paying the real card's **Mana Cost**, as a **Special Action** (ADR 0083).
_Avoid_: Flip, unmorph, reveal

**Manifest Dread**:
Look at the top two cards of your **Library**, put one onto the **Battlefield** as a **Face-Down Permanent** and the other into your **Graveyard** (CR 701.62). A permanent that arrived this way is **Manifested**: unlike a Masked one, its **Controller** may **Turn It Face Up** for its **Mana Cost** if the card underneath is a creature card.
_Avoid_: Manifest (the plain CR 701.40 keyword action — same face-down result, no look and no graveyard half; not implemented), morph

**Special Action**:
Something a **Player** may do without using the **Stack** and without passing **Priority** (CR 116.2) — it cannot be responded to. Taken while they have priority. Playing a **Land** is one; so are summoning a companion, turning a **Manifested** permanent face up, and **Foretell**. Each carries its own timing window, and they differ: companion needs a main phase with an empty stack, foretell only needs priority during its player's own turn.
_Avoid_: Activated Ability (uses the Stack), free action

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
A **Triggered Ability** whose condition is "when you **Cast** this spell" — it fires from the **Stack** as the spell is announced, not from the **Battlefield**. Because ordinary trigger collection scans only battlefield (and just-left) sources, cast triggers are gathered by a dedicated pass at cast time and placed on the **Stack** _above_ the spell, so they resolve before it. **Storm** was the first cast trigger.
_Avoid_: On-cast hook, cast listener

**Cast-Copy**:
The shared mechanism behind every **Keyword** that copies its own spell as that spell is announced — **Storm** (CR 702.40) and **Replicate** (CR 702.56), with conspire and other cardinality variants to follow. The mechanism is one thing and the keywords differ only in the **Cast-Copy Count**: the **Cast Trigger** carries a detached **snapshot** of the spell plus a remaining-copies number, and pays out one **Spell Copy** at a time, each offered an optional **Copy-Retarget**. Because the snapshot is detached, the copies are still created when the original spell has already left the **Stack** (countered in response). Naming follows the mechanic, never the keyword that happened to arrive first.
_Avoid_: Storm machinery, spell duplication (a **Spell Copy** made at **Resolution** by a copy effect, CR 706, is a different thing — cast-copies are decided and paid for at cast time)

**Cast-Copy Count**:
The number of **Spell Copy** items a **Cast-Copy** keyword produces, fixed as the spell is **Announced** and stored on the **Cast Trigger**. Each keyword supplies it differently — **Storm** from **Spells Cast This Turn**, **Replicate** from the number of times its **Additional Cost Keyword** cost was paid — and that difference is the _whole_ of what distinguishes them.
_Avoid_: Storm count (that names one keyword's source, and the counter itself is **Spells Cast This Turn**)

**Storm**:
A **Keyword** ability (CR 702.40) that is a **Cast Trigger**: "when you cast this spell, copy it for each other spell cast before it this turn; you may choose new targets for the copies." Its **Cast-Copy Count** is the value of **Spells Cast This Turn** captured at the moment the spell is cast — a later spell cast before the trigger resolves does not count.
_Avoid_: Storm count (for the counter — that is **Spells Cast This Turn**)

**Replicate**:
A **Keyword** ability (CR 702.56) that pairs an **Additional Cost Keyword** cost payable any number of times with a **Cast Trigger**: its **Cast-Copy Count** is the number of times that cost was paid. It is a member of the additional-cost family that is repeatable but never **Kicked** — the payment count buys copies rather than a bigger effect, so a merely-replicated spell must not answer to "counter target spell if it was kicked".
_Avoid_: Multikicker (that names the repeatable cost alone, not the copies it buys)

**Static Ability**:
An ability that applies continuously while the **Permanent** is in the appropriate **Zone**. Does not use the **Stack**.
_Avoid_: Passive ability, aura effect

**Mana Ability**:
An **Activated Ability** that produces **Mana** and has no target. Resolves immediately — does not use the **Stack** (CR 605.3a).
_Avoid_: Tap for mana

**Hand-Activated Ability**:
An **Activated Ability** that functions only while its card is in its owner's **Hand**, because a leg of its cost moves that card out of the hand (CR 113.6c — an ability whose cost moves the card out of a zone functions only in that zone). The card is not a **Permanent** and never was: it is announced from the hand, its cost discards it, and the ability resolves from the **Stack** with its source already in the graveyard. **Cycling** and **Channel (ability word)** are the two families; the engine treats them as one seam (an `activateFromHand` flag), so an affordance or a **Move** built for either serves both.
_Avoid_: Cycling (that is one instance of the family), hand ability, cast from hand (that names casting a spell)

**Channel (ability word)**:
An **Ability Word** (CR 702 preamble — italic, no rules meaning) introduced in Kamigawa: it labels a **Hand-Activated Ability** whose cost is mana plus discarding the card, and whose effect is unrelated to what the card does on the **Battlefield** — a second, cheaper use for a card you don't want to play. It grants nothing by itself; every Channel ability is an ordinary activated ability and the word is decoration. The Kamigawa: Neon Dynasty legendary lands each pair a **Mana Ability** with a Channel ability, so one card is either a land or a spell-like effect, never both.
_Avoid_: Channel (the Alpha sorcery of that name is a different card — always qualify the mechanic as "Channel (ability word)"), cycling (that draws a card; Channel's effect is arbitrary), alternative cost (Channel costs are activation costs, not a replacement for a **Cast** cost)

**Keyword**:
A shorthand for a defined ability (flying, haste, first strike, etc.). Read off a **Card Instance** as an **Effective Characteristic**, never as printed text alone — a keyword may be granted or removed by a **Continuous Effect**.

**Continuous Effect**:
An effect that applies over a span of time rather than at a single moment (CR 611) — from a **Static Ability**, or generated for a duration by a resolved **Spell** or ability ("until end of turn"), or carried by a **Counter**. The CR splits them in two, and the engine follows that split: a **Characteristic-Changing** effect (CR 613 — power/toughness, color, types, subtypes, abilities, control) is ordered by the **Layer** system; a **Rules-Modifying** effect (CR 611.3 — attack and block restrictions, cost modifiers, cast timing locks, hand size, untap restrictions) changes no characteristic, never enters the layer system, and is ordered by **Timestamp** alone.
_Avoid_: Static effect (that names only the _source shape_, not the duration-based or counter-borne cases), passive effect, buff

**Layer**:
One of the seven ordered stages a **Characteristic-Changing** **Continuous Effect** is applied in (CR 613.1): 1 copy, 2 control, 3 text, 4 type, 5 color, 6 ability, 7 power/toughness. Every effect is applied in its layer regardless of when it started, so a later effect in an earlier layer still applies first. A characteristic is not stored and mutated — it is recomputed from the base object plus every applicable effect each time it is read.
_Avoid_: Pass, stage, priority (that's the **Priority** turn-order term)

**Timestamp**:
The moment a **Continuous Effect** started, and the tiebreak that orders two effects inside one **Layer** (CR 613.7) — later wins, so a **Keyword** granted after a "loses all abilities" effect comes back. A single monotonic sequence covers grants and removals alike, which is what makes them interleave correctly. Dependency (CR 613.8 — an effect applying out of timestamp order because another changes what it does) is a **Documented Divergence**, not implemented (issue #2068).
_Avoid_: Sequence number, order, priority

**Continuous Effects Registry**:
The single list of every active **Characteristic-Changing** **Continuous Effect** in a game, each entry carrying its **Layer**, **Timestamp**, and expiry. It is the sole source of truth for **Effective Characteristics**: the engine reads no materialised per-**Card Instance** copy of a granted keyword or buff. One list because the CR draws no distinction between an effect from a **Permanent** on the battlefield and one left behind by a resolved **Spell** — both are simply continuous effects with a timestamp (ADR 0082).
_Avoid_: Static effect table, buff list, modifier stack

**Effective Characteristic**:
A characteristic's value _after_ every applicable **Continuous Effect** has been applied in **Layer** and **Timestamp** order — as opposed to its printed or base value. Always derived at read time. What crosses to the client is a snapshot of the derived value, computed when the state is projected; the client never re-derives it and never holds authority over it.
_Avoid_: Current value, actual value, computed stat

**Card Type Set**:
A **Layer** 4 **Continuous Effect** that _replaces_ an object's card types rather than adding to them (CR 205.1a) — "it's an enchantment". Distinguished from a type _add_, which an effect signals by saying the object becomes the new type "in addition to its other types" (CR 205.1b); only the add leaves the prior types standing. An object with the instant or sorcery card type keeps it either way. Setting a type also drops every **Correlated Subtype** the object no longer has a type for.
_Avoid_: Type change, type override, becomes-a

**Correlated Subtype**:
A subtype belonging to one card type's subtype set — creature, land, artifact, enchantment, planeswalker, spell or battle types (CR 205.3). A subtype is only meaningful while the object has its type: when a **Card Type Set** removes that type, the subtype goes too, unless a type the object still has also claims it (CR 205.1a). The engine classifies a subtype by listing the closed non-creature sets the CR enumerates and treating everything else as a creature type, since only the creature set grows.
_Avoid_: Subtype class, tribe, type line tail

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
A **Keyword** ability (CR 702.88) on an instant or sorcery: if the spell was **Cast** from its owner's hand it is exiled as it **Resolves** (instead of going to the graveyard), creating a **Delayed Triggered Ability** — "at the beginning of your next upkeep, you may cast this card from exile without paying its mana cost." The recast is optional; declining leaves the card in exile permanently (never the graveyard, CR 702.88c). Only the hand-cast rebounds — the exile recast is not from hand, so it resolves to the graveyard with no second rebound (CR 702.88a). The upkeep cast window reuses the **Madness** reflexive Cast/Decline shape.
_Avoid_: Flashback (that recasts from the graveyard, rebound from exile), buyback, recur

**Foretell**:
A **Keyword** ability (CR 702.143) that functions while the card is in its owner's hand: at any priority **during their own turn** — not only at sorcery timing — that player may pay {2} and exile the card face down, as a **Special Action** (CR 116.2h, so it uses no **Stack** and cannot be responded to). The card becomes a **Foretold Card**. Unlike **Madness** and **Rebound**, whose exile cast windows are opened by a triggered ability and are single-shot, foretell's permission is open-ended: it lasts as long as the card remains exiled.
_Avoid_: Suspend (that exiles with time counters and casts itself), morph, "flashback from exile"

**Foretold Card**:
A card in exile as a result of the **Foretell** special action: face down (a **Hidden Zone** exception inside the otherwise public **Exile**), lookable by its owner alone, castable by them for its **Foretell Cost** — but only once the turn it was foretold has _ended_. Any later turn qualifies, including an opponent's, so a foretold instant is a live response held outside the hand; the card's own type then governs timing as usual. A foretold card that is never cast simply stays exiled. All foretold cards are revealed to everyone when the game ends (CR 702.143f).
_Avoid_: Impulse-exiled card (also face down in exile, but playable only for a limited window and never revealed at game end), suspended card

**Foretell Cost**:
The alternative cost (CR 601.2b) a **Foretold Card** may be cast for instead of its **Mana Cost**. Distinct from the {2} paid to foretell, which is a cost of the **Special Action**, not of the spell. A foretold card may also be cast for its normal cost by any other means — it stays "foretold" either way (CR 702.143c).
_Avoid_: Foretell tax, alternate cost (the CR term is _alternative_)

**Cast Provenance**:
The **Zone** a **Spell** was **Cast** from, remembered on the spell itself so its own effect can read it at **Resolution** ("if this spell was cast from exile"). A single fact with one authority, not a family of per-mechanism flags. Distinct from having been **Foretold**: a foretold card cast for its normal cost is still foretold, and a card cast from exile under an unrelated permission was never foretold.
_Avoid_: Cast source, origin zone

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

**Cost Leg**:
One component of a composite cost, in one of four kinds: a **mana** leg, a **permanent** leg (return or sacrifice N permanents matching a filter), a **life** leg, or a **hand** leg (exile or discard cards from hand). A cost is a set of legs, all of which must be paid; the kinds compose freely. The same leg vocabulary describes an **Alternative Cost** (which _replaces_ a **Spell**'s mana cost, CR 118.9 — evoke, dash, flashback, madness) and a **Kicker** cost (which is _added on top of_ it, CR 601.2f / 702.33a). That distinction is about whether the cost replaces or adds, never about what the legs are — which is why one `CostLegs` type serves both (ADR 0079).
_Avoid_: Cost component, sub-cost, additional cost (that names the add-on _relationship_, not a leg)

**Self Cost Reduction**:
A CR 601.2f cost reduction an object declares on **itself** — "this spell costs {1} less to cast for each artifact you control", "this ability costs {1} less to activate for each legendary creature you control" — as opposed to a **Cost Modifier** carried by some other **Permanent** on the **Battlefield**. The distinction is not stylistic: the reducing object is not on the battlefield when the reduction must be computed (a **Spell** is still being **Announced**; a **Hand-Activated Ability**'s source is in the **Hand**), so no battlefield scan can discover it and it must be read off the announced object itself. Both kinds resolve to a generic-mana amount through one shared resolver and are applied at one shared site, so they can never disagree about the floor or about which pips a reduction may touch.
_Avoid_: Cost modifier (that names the other-permanent kind), discount, affinity (one card's flavour of the count-driven amount)

**Kicker Payment**:
The record of which of a **Spell**'s kickers were paid as it was **Announced**, and how many times each — a map from kicker id to a count, snapshotted on the **Stack** item at cast commit and read at **Resolution**. A card may offer several kickers payable independently ("Kicker {A} and/or {B}" — the Planeshift Battlemages), so a single total cannot answer "was it kicked with its {2}{U} kicker"; the total remains available as the sum. A per-kicker count (rather than a boolean) is what lets Multikicker (CR 702.33e) be a property of one kicker rather than of the card.
_Avoid_: Kicker count (that is the derived _total_, not the record), kicked flag

**Additional Cost Keyword**:
A **Keyword** whose cost half is "you may pay an additional [cost] as you cast this spell" — **Kicker** (CR 702.33a) and **Offspring** (CR 702.175a) word it identically, and Sticker kicker (CR 702.33h) is defined as meaning Kicker. They share one set of **Cost Legs**, one announcement, and one payment path, and are told apart only by which keyword an entry declares. That identity is load-bearing rather than cosmetic: **Kicked** is defined over kicker costs alone, so a spell whose offspring cost was paid was never kicked, and each keyword carries its own separately **Linked** abilities (CR 607).
_Avoid_: Kicker (that is one member, not the family), optional cost

**Kicked**:
A property of a **Spell** whose controller declared the intention to pay any of its **Kicker** costs, and _only_ a kicker cost (CR 702.33d). Paying a different **Additional Cost Keyword**'s cost does not make a spell kicked. The question is asked by cards other than the one that was kicked ("counter target spell if it was kicked"), so it is a public property of the spell, not a private note.
_Avoid_: Paid an additional cost (broader), kicker count (that is how many times)

**Pile**:
One of the two subsets a **Player** separates a set of objects into (all their nontoken lands, the top five cards of a **Library**, all creatures a player controls), after which _another_ player chooses one pile; an effect then applies asymmetrically to the chosen vs. unchosen pile (Fact or Fiction, Do or Die, Bend or Break). The divide-then-choose interaction is a two-step **Pending Choice** with distinct divider and chooser players.
_Avoid_: Group, stack (that's the **Stack**), heap, partition (informal only)

**Replacement Effect**:
A continuous effect that watches for an event about to happen and swaps it for a different one before it occurs ("if… would…, instead…", CR 614) — never using the **Stack**. It modifies the event, it does not respond to it (that is a **Triggered Ability**). When several apply to one event the affected **Player** chooses the order (CR 616.1).
_Avoid_: Interrupt, trigger (a replacement fires _before_ the event, a trigger _after_)

**Draw Replacement**:
A **Replacement Effect** on the draw event (CR 614, 121.x): "if a **Player** would draw, instead …". Its condition is a predicate over the draw — who is drawing, whether it is the turn-based **Draw Step** draw, and how many draws that player has already made this **Turn** (so "each opponent", "the first card drawn this turn", "in each of their draw steps" are all expressible). Its outcome may change the number drawn (draw N → N+1), redirect the draw to another effect (make a Treasure instead), or prevent it. Distinct from **Miracle** (which does not replace the draw — the card is still drawn, then a trigger offers a cast window) and from a plain "when you draw" **Triggered Ability**.
_Avoid_: Draw trigger, draw hook

**Saga**:
An enchantment subtype (CR 714) whose **Permanent** advances through numbered **Chapter Abilities**, tracked by **Lore Counters**, and sacrifices itself once past its **Final Chapter**. Saga-ness is the _subtype_, never "has chapter abilities" — CR 714.2d explicitly contemplates a Saga with none. A card may carry the Saga subtype alongside other types and subtypes: Urza's Saga is `Enchantment Land — Urza's` + `Saga`, two subtypes, one of them a land type.
_Avoid_: Chapter enchantment, story enchantment, quest

**Lore Counter**:
The **Counter** a **Saga** uses to track its progress (CR 714.3). The first arrives via the Saga's own intrinsic ability "this Saga enters with a lore counter on it" — a **Replacement Effect** (CR 714.3a, 614.1c), so a Saga stripped of its abilities enters with none. Thereafter one is placed as its **Controller**'s precombat main phase begins, on each Saga they control _that has at least one_ **Chapter Ability** — a turn-based action that does not use the **Stack**. Placing one is what fires a chapter ability. (Printed Saga reminder text still says "after your draw step"; that wording predates Dominaria United and is not the rule — reminder text carries no rules meaning, CR 207.2.)
_Avoid_: Chapter counter, progress counter, verse counter

**Chapter Ability**:
A **Triggered Ability** on a **Saga** introduced by a chapter symbol. "{rN} — [Effect]" is shorthand (CR 714.2b) for "when one or more **Lore Counters** are put onto this Saga, if the number of lore counters on it _was less than N and became at least N_, [effect]" — so it is an ordinary counter-placement trigger with an intervening-if over the before/after count, not a special ability kind. One ability may carry several chapter numbers ("I, II —", CR 714.2c).
_Avoid_: Chapter, verse, stage, phase (that's a **Turn** structure term)

**Final Chapter**:
The greatest chapter number among the **Chapter Abilities** a **Saga** _currently has_ (CR 714.2d) — derived from the Saga's effective abilities, never from its printed text. Once a Saga's lore counters reach its final chapter and no chapter ability of it is still on the **Stack**, its controller sacrifices it (CR 714.4, a **State Based Action**). Both that sacrifice and the precombat-main lore counter apply only to a Saga that _has_ at least one chapter ability, so a Saga whose abilities are stripped (Blood Moon on Urza's Saga, Humility) is not sacrificed and stops advancing — it simply persists, inert, with the lore counters it already had.
_Avoid_: Last chapter, chapter count, max chapter

### Spells & Stack

**Cast**:
The process of putting a **Spell** on the **Stack**: announce, choose targets, pay costs.
_Avoid_: Play (for spells — "play" is reserved for lands)

**Resolve**:
A **Spell** or **Ability** on the **Stack** completes its effect and leaves the **Stack**.
_Avoid_: Execute, trigger, fire

**Graveyard Play Permission**:
A permission held by a **Player** to use cards in their own **Graveyard** as if from **Hand** — to **Cast** them, to play **Lands** from there, or both (CR 305.1-analog / 601). It licenses an _action_, never a cost: a permission cast pays the card's normal costs and leaves the card where the action normally would (contrast **Flashback**, whose grant carries its own cost and exiles on **Resolve**). One grammar spans every source of it — which actions (`play-land` / `cast`), an optional card-type and **Mana Value** ceiling, and optional once-per-**Turn** / your-turn-only limits — and sources differ only in **Duration**: **Continuous** while a **Permanent** granting it is on the **Battlefield** (Icetill Explorer, Lurrus, Yawgmoth's Agenda), or turn-scoped when a resolved effect grants it (Yawgmoth's Will).
_Avoid_: Graveyard recursion (that returns cards to a zone), flashback, "cast from graveyard" (names one of the two actions)

**Last Known Information (LKI)**:
The values an object had the instant before it left the public zone it was expected to be in, used in place of failing when a **Resolving** effect asks about that object (CR 608.2h, CR 113.7a). An **Ability** exists on the **Stack** independently of its source, so by the time it resolves the source may be gone — "when this creature dies, it deals damage equal to its power" reads the power the creature had the moment it died, layered buffs folded in, not the printed value and not nothing. LKI is read for a **Source** and for any object an effect names without **Targeting** it; a **Target** that has left its zone is instead simply illegal (CR 608.2b), which is a different rule with a different outcome. Distinct from a cast-time snapshot such as a **Kicker Payment**: that records a choice frozen when it was made, whereas LKI is a live value read as late as possible and only then falling back.
_Avoid_: Snapshot (that is the storage mechanism, not the rule), stale state, cached characteristics

**Target**:
A specific **Permanent**, **Player**, or **Spell** chosen during **Casting** that the effect will apply to.

**Spell Copy**:
A **Stack Item** created by copying another spell on the **Stack** (CR 707.10, e.g. Fork). It is not a real card: it carries `isCopy`, inherits the original's resolve/targets/X, may be given a different color via `colorOverride`, and ceases to exist after resolving instead of going to a **Graveyard**. The copy's controller _may_ choose new targets for it (a **Copy-Retarget** target selection).
_Avoid_: Token spell, duplicate

**Spells Cast This Turn**:
A running count of how many **Spells** have been **Cast** by any **Player** this **Turn**, reset at each turn change (`GameState.spellsCastThisTurn`). A **Spell Copy** is put onto the **Stack**, not cast, so it never increments the count. The count read at cast time (the tally of spells cast _before_ this one) rides on the cast event as `priorSpellCount` — the value **Storm** uses for its copy count. Each **Player** also carries their OWN mirror of this count (`PlayerState.spellsCastThisTurn`), reset the same way — what a **Nth-spell-this-turn** trigger condition reads when it means "the CASTER's own spells", as opposed to the global count Storm reads.
_Avoid_: Storm count, spell counter

**Spells Cast This Game**:
A running count of how many **Spells** a **Player** has **Cast**, NEVER reset (`PlayerState.spellsCastThisGame`) — the lifetime sibling of **Spells Cast This Turn**, incremented at the same choke point, never cleared at a turn change. Exists to answer "is this the first spell I've cast in the whole game" — an **Alternative Cost** condition (Once Upon a Time, issue #790), a question the per-turn count cannot answer.
_Avoid_: Lifetime spell count, total spells cast

**Permanent Copy**:
A **Permanent** that has become a copy of another (CR 707.2, e.g. Clone, Copy Artifact, Vesuvan Doppelganger). The engine overwrites the copy's `card.id` with the copied object's definition id so every characteristic reader (abilities, colors, P/T, types) observes the copy; the printed identity is kept in `copiedFrom` and restored when the copy leaves the battlefield (`revertCopy`). Copy effects copy printed/copiable values only — never counters, damage, tap state, auras, or control. Exceptions (CR 707.9d) are expressed as options: a kept color via `colorOverride`, added types via `additionalTypes`, and a retained ability via a `retainedThroughCopy`-flagged trigger.
_Avoid_: clone-as-token, transform

**Copiable Values**:
The subset of an object's characteristics a copy acquires (CR 707.2): those derived from its printed text — name, mana cost, colour indicator, card types, subtypes, supertypes, rules text, power, toughness, loyalty — as further modified by other copy effects, by **Face-Down** status, and by "as … enters" abilities that set power and toughness. Everything else is excluded: **Counters**, damage, tapped status, attached **Auras**, control, and every **Continuous Effect** from the **Layer** system. The distinction has teeth in both directions. A **Permanent Copy** made 1/1 by its own copy effect's "except" clause is 1/1 _copiably_, so a later copy of it is also 1/1 — whereas the same creature at 1/1 through a layer-7 buff would be copied at its printed size. And the values are recomputed at the moment of copying only (CR 707.2b): changing the original afterwards leaves the copy alone.
_Avoid_: Printed values (the copiable set is printed values _as modified_), effective characteristics (that is the layered read), base P/T

**Copy Choice (allControllers)**:
A mid-resolution `choose-permanents` **Pending Choice** whose candidates span **every** player's battlefield (CR 707 "a copy of any creature/artifact on the battlefield"), flagged `allControllers`. Applied as the copy enters via `SpellContext.becomeCopyOf` in a resolve step.

**Vote**:
A choice each **Player** makes in turn order, starting with the **Controller** of the **Spell** or **Ability** that instructs them to (CR 701.38). Votes are **public** as they are cast, so a later voter knows the earlier ones. What is voted _for_ is a shared candidate set — in this engine, a **Permanent**; the effect then acts on whatever tied for most votes. With two players a split vote ties, so a "most votes or tied for most" effect hits **both** choices.
_Avoid_: Choice (a Vote is one specific, ordered, public kind of choice), Will of the council (the italic ability word introducing it, with no rules meaning of its own)

**Mode**:
One option of a **Modal** **Spell** or **Ability** — a single bullet in its printed list, carrying its own effect and its own **Targets** (CR 700.2).
_Avoid_: Option, branch, choice (a **Mode** is picked at announcement; a **Pending Choice** is answered mid-**Resolve**)

**Modal**:
Describes a **Spell** or **Ability** whose printed text offers two or more **Modes**. The picking happens at **announcement** — as the spell is **Cast** or the ability activated, before **Targets** (CR 601.2b) — never during **Resolve**. Only the picked **Modes** contribute targets, and the pick can never change afterwards.
_Avoid_: Charm (a card cycle, not the concept), multi-choice

**Mode Cardinality**:
How many **Modes** a **Modal** spell or ability picks: exactly one, a fixed N, a range, and whether repeats are allowed ("You may choose the same mode more than once"). The count may be conditional on board state or on a cost chosen at announcement. Distinct from a **Mode**'s own content — cardinality is a property of the **list**.
_Avoid_: Mode count (ambiguous — reads as "how many modes the card has printed"), choose-N

**Mode Instance**:
One picked occurrence of a **Mode**. A card that picks the same **Mode** twice has two **Mode Instances**, each announcing its own **Targets** — which may be the same object for both (CR 700.2d). Instances are performed in **printed** order, never pick order (CR 608.2c).
_Avoid_: Repeat, duplicate mode, copy (a **Copy** is a different concept entirely)

### Combat

**Attacker**:
A **Creature** declared as attacking during DECLARE_ATTACKERS.

**Blocker**:
A **Creature** declared as blocking an **Attacker** during DECLARE_BLOCKERS.

**Combat Damage**:
Damage dealt by **Creatures** during COMBAT_DAMAGE (or FIRST_STRIKE_DAMAGE for first strikers).

**Band**:
A group of attacking **Creatures** (1+ with banding, at most 1 without) declared via banding (CR 702.22c). A band attacks and is blocked as a unit — blocking any member blocks them all. Tracked in `combat.bands`.

**Damage Assignment Authority**:
Who chooses how a combat-damage **Source** splits its damage among its targets. Normally the source's controller; **Band**ing flips it to the controller of the banding creature(s) opposite (CR 702.22j-k). Tracked per source in `combat.damageAssignerIds`, with a multi-party confirm handshake (`damageAssignmentConfirmedBy`).

**Attack Tax**:
A cost the attacking player must pay to make an already-declared attack legal, charged once per taxed **Attacker** as attackers are confirmed (CR 508.1c/1g) — not a restriction that hides the attack, but a price for it. Paid in mana (Propaganda) or by sacrificing **Permanents** (Flooded Woodlands, Leviathan). Two directions, and a card means exactly one: **directed** — "creatures can't attack _you_ unless…", where only the player being attacked imposes it; **undirected** — "this creature can't attack unless…", which applies whoever is being attacked. If the whole tax cannot be paid, the entire attack declaration is illegal and is re-declared.
_Avoid_: Attack restriction (a restriction forbids the attack outright; a tax prices it), upkeep cost, ward

**Combat Damage Prevention**:
A continuous effect that stops combat damage before it is dealt (CR 615), scoped by two independent axes: _whose_ damage (the **Source** side — "damage dealt **by** this creature") and _who_ would take it (the recipient side — "damage dealt **to** this creature"). A card may declare either or both (Gaseous Form declares both). The recipient side covers damage to a **Player**, not only to a **Permanent** — a prevention on the "by" axis mutes the enchanted creature's hit to the defending player too.
_Avoid_: Damage immunity (an unconditional property of one object), protection (a broader shield covering targeting, blocking, enchanting and damage), shield counter

**Activation Cap**:
An upper bound on how many times an **Activated Ability** may be activated in a single turn (CR 602.5 — "Activate only once each turn", "Activate no more than twice each turn"). A property of the ability, tallied per source per turn and reset at the turn boundary. The triggered-ability twin is a cap on how many times an ability may trigger per turn.
_Avoid_: Cooldown, sorcery-speed restriction (a timing restriction, not a count)

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

**Devotion**:
A **Player**'s count of mana symbols of a given **Color** among the **Mana Costs** of the **Permanents** they control (CR 700.6). A hybrid symbol counts for both of its colors and a Phyrexian symbol counts for its color; generic and {X} count for nothing, and a permanent with no mana cost (a token, a **Land**) contributes nothing. Distinct from **Mana Value** — devotion counts _symbols on the battlefield_, mana value counts _one card's cost_.
_Avoid_: Color identity (a deck-building property), pip count

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

**Ladder**:
The **Brain**'s strength metric: paired bot-vs-bot games in which the two **Players** use the same decks and the same shuffles and only the **Brain** configuration differs by seat, so the verdict ("stronger", "weaker", "inconclusive") is about the **Brain**, never about the decks. Complements the **Blade Scenario**: a blade proves a forced play is not missed, a ladder proves a change that shifts every decision a little is a net gain.
_Avoid_: Self-play benchmark, deck win-rate, tournament

**Pairing Registry**:
The curated list of deck pairs the **Ladder** plays, each row tagged with the gameplay **Dynamics** it exercises (racing, go-wide combat, discard, sacrifice outlets, two-card combos…). A change claims strength on the **Dynamics** it touches; a dynamic with no row is added with the change that needs it.
_Avoid_: Deck list, matchup table, gauntlet

**Environment Rung**:
A tier of the **Pairing Registry** ordered by how much interaction the decks carry — combat and racing first, instant-speed interaction and repeatable abilities next, cube archetypes with combos last. Work on the **Brain** climbs the rungs in order; a rung is not skipped because the player happens to play at a higher one.
_Avoid_: Level, difficulty, format

**Shortcut**:
A sequence of game choices a **Player** with **Priority** proposes in one breath instead of performing step by step (CR 732) — including a loop repeated a stated number of times ("I'll create a million tokens"), which each other **Player** may accept or cut short at the point where they would choose differently. An engine capability consumed alike by the human UI and by the **Brain**, whose search otherwise cannot see the end of a loop.
_Avoid_: Combo, infinite, macro, auto-repeat

**Determinization**:
Guessing a concrete possible world for the hidden information (the opponent's **Hand** and the order of the **Library**) so the **Brain** can reason about an otherwise-hidden position as if it were fully known. Re-guessed once per search iteration, so the **Brain** reasons over many possible worlds rather than one.
How the opponent's hidden cards are filled in depends on whether the search has **Deck Knowledge** for that seat: without it they are anonymous placeholders the simulated opponent can never cast, with it they are real cards drawn from the **Unseen Remainder**.
_Avoid_: Sampling, guessing, simulation

**Deck Knowledge**:
The decklists the search is permitted to know, named one seat at a time. A seat with no entry is blind and keeps anonymous placeholders — that absence is the permission check, so knowledge is never acquired by accident.
_Avoid_: Cheating, peeking, perfect information

**Unseen Remainder**:
What a seat's decklist could still be hiding: the whole list minus every copy already accounted for somewhere public (**Battlefield**, **Graveyard**, exile, a spell on the **Stack**). It is what keeps an imagined **Hand** honest — a four-of with three copies already visible admits exactly one more, so the **Brain** can never imagine a fifth.
_Avoid_: Remaining deck, unknown cards, the rest of the library

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

**Column Layout**:
The per-**Zone** (**Maindeck** / **Sideboard**) arrangement of a **Deck** into vertical **Columns** while it is being built. Owns the **Grouping**, the ordered **Column** list (including any manual Columns and the mandatory **Catch-All Column**), and the within-Column **Ordering**. It does **not** own the Zone's build-time filter — that is a momentary tool, never persisted, so a saved Layout can never hide part of a **Deck** from its author. Each Zone owns its own Layout independently — the Maindeck may be grouped by **Mana Value** while the Sideboard is grouped by colour. Presentation and deck-intent only: a Layout never changes which cards are in the Deck, and is never a **Deck Legality** input.
_Avoid_: View, grouping (that's one field of it), sort order, arrangement (reserved for **Pool Arrangement**)

**Column**:
One vertical bucket of a **Column Layout**, with a stable namespaced id (`mv:5`, `color:R`, `custom:…`) and a label. A **generated** Column carries a predicate and is produced by the current **Grouping**; a **manual** Column carries no predicate — cards reach it only by **Card Pin** — is user-created and user-labelled, and lives in every Grouping of its **Zone**. A Column may be deleted **only while empty**. A card lands in the first Column that claims it: a `custom` **Card Pin**, else the Pin for the current **Grouping**, else a generated Column's predicate, else the **Catch-All Column**.
_Avoid_: Pile (that's the in-game stack of cards), category, bucket

**Catch-All Column**:
The mandatory last **Column** of every **Column Layout**, holding every card no other Column claims. Cannot be deleted, has no predicate, and is what makes deleting a **Column** safe — a card whose Column no longer exists is always visible somewhere.
_Avoid_: Other, misc, default column (it is not a fallback default — it is a real Column)

**Grouping**:
The rule that generates a **Column Layout**'s predicate-carrying **Columns** — by **Mana Value**, colour, card type, or none. Switching Grouping regenerates the generated Columns; manual **Columns** and every **Card Pin** survive untouched, because Column ids are namespaced per Grouping.
_Avoid_: Group by, sort (see **Ordering**), filter

**Ordering**:
The rule that sorts cards **inside** a **Column** (name, **Mana Value**, colour, rarity). Orthogonal to **Grouping**, which decides which Columns exist — "Columns by colour, ordered by Mana Value" is one Layout, not two.
_Avoid_: Sort by (ambiguous with Grouping), order

**Card Pin**:
A user's manual override placing one card in a chosen **Column**, recorded per **Grouping** namespace (`{ mv: "mv:5", color: null, … }`) plus an optional `custom` pin. A Pin is **never erased by a Grouping switch** — it simply does not apply while its namespace isn't the active **Grouping** — so the arrangement built during a **Draft** survives an exploratory look at the **Pool** by colour. A `custom` Pin outranks every other rule.
_Avoid_: Column override (the pre-unification name), assignment, manual placement

**Format**:
A named set of deck-construction constraints a **Deck** is built under, chosen at deck creation and **immutable** thereafter. Determines the **Maindeck**/**Sideboard** size bounds, the copy/category limits, and — for most Formats — which **Sets** are legal; **Premodern** is the one exception (issue #2695): its legality is a generated, name-keyed map of Scryfall's `legalities.premodern` per card, not a Set list, so a card is legal exactly when Scryfall says the CARD is, regardless of which Set its only built printing sits in. Registered today: **Freeform** (no constraints), **Limited** (pool-scoped rather than set-scoped — legality is membership in the **Deck Pool**, ≥40 main, no sideboard cap), **Premodern** (Scryfall-legality by name, ≥60 main, ≤15 sideboard, 4-copy + code-seed/DB-backed **Banned** list, no Restricted list), **Manual** (Tabletop, unvalidated and unplayable by the engine), **Alpha 40** (Alpha/Beta only, ≥40 main, no sideboard, rarity- and category-based limits), **Old School** (Alpha/Beta/Arabian Nights/Antiquities/Legends/The Dark, ≥60 main, ≤15 sideboard, 4-copy + **Restricted**/**Banned** lists). A **Format** constrains deck authoring only — it is **not** a property of a **Game**, and two **Players** may bring **Decks** of different **Formats** to the same **Match**.
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
An admin-created gathering of N **Players** that produces one **Limited**-legal **Deck** per **Seat** and then plays it out: setup (admin picks sets/boosters, **Match Format**, optional **Round Deadline**) → pool generation (**Sealed**) or **Draft** → deckbuild from the **Pool** → **Play Phase** (Swiss **Rounds**, ending in **Standings**). The Event owns the whole arc; it orchestrates its round **Matches** through the existing Match flow rather than replacing it. Its lifecycle is a four-member status — `open` → `started` → `playing` → `finished` — whose meaning is only ever read through named predicates, never a literal comparison (ADR 0076). The terminal status is reached either way: the last **Round** resolving on its own, or the creator manually **closing** the Event (issue #2357) — the two are indistinguishable once reached, by design (no separate "abandoned" status).
_Historical_: ADR 0055 originally stopped the Event at the built Deck, with pairing/rounds/standings deferred; ADR 0076 reverses that — a drafted deck whose performance is never recorded loses the study loop the environment exists for.
_Avoid_: Lobby (that's constructed matchmaking)

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
The always-available quality scoring a **Bot Drafter** falls back to when no **Pick Rating** exists: card quality (shared with the **Brain**'s **Card Value**, extracted to a server-usable module) adjusted by **Rarity**, mapped onto the same 0–5 rating scale so a rated and an unrated card are comparable in one unit. It is the BASE term's fallback, not a layer under the rating — two equally-rated cards are separated by the contextual terms (**Colour Commitment**, curve fit, later **Archetype**/**Capability**), not by raw quality.
_Avoid_: Bot logic (too broad), default rating

**Pick Candidate Trace**:
The primary result of scoring one candidate: every term with its value in rating points AND its provenance — the specific **Pool** cards that produced it. The score is DERIVED by summing the breakdown, so the explanation and the arithmetic that decides the **Pick** are the same object; there is deliberately no second narrator path that could drift from the scorer it describes. What the **Draft Lab** renders.
_Avoid_: Explanation, log, debug string

**Contextual Cap**:
The bound on the SUM of every non-base term of a **Pick**'s score, which GROWS with the pick number (~0.3 rating points at the first **Pick**, ~2.0 by the end of the **Draft**). It encodes "raw power early, fit late" as the single parameter it is: the first pick has no deck to respect, the thirtieth does. The sum is clamped to `[0, cap]`, NOT `±cap`: contextual fit is a pure BONUS — a candidate that fits nothing earns nothing and is never penalised — so the cap is exactly the bound on the DIFFERENCE between two candidates, and a rating gap wider than that pick's cap can never be overturned by context. Ratings anchor, context refines.
_Avoid_: Weight, clamp (it caps the sum of terms, not each term); penalty (a term that only ever subtracts is dead under the non-negative clamp — express it as the bonus its complement earns)

**Archetype**:
A named strategy a **Pool** can be built toward within one **Pack Source** scope (`reanimator`, `artifacts`, `jeskai-tempo`). A card declares the Archetypes it belongs to; a **Seat**'s accumulated **Pool** therefore has a measurable commitment per Archetype, which biases later **Picks**. Coarse-grained on purpose — it steers colours and plan, not card-to-card fit (that is **Capability**).
_Avoid_: Deck type, strategy, colour pair (an Archetype is not its colours)

**Capability**:
A named property from a small closed vocabulary that a card either **provides** or **requires** (`value-on-death`, `reanimatable`, `value-on-attack`). Fit between two cards is **computed**, never enumerated: a card requiring `value-on-death` (Flash) is served by any card providing it (Worldspine Wurm) and by no other. Absence of a match is itself the veto — Animate Dead requires `reanimatable`, which Worldspine Wurm does not provide, so the pair scores nothing despite sharing an **Archetype**. Authoring cost is one declaration per card, not one per pair.
_Avoid_: Tag (too vague — an **Archetype** is also a tag), synergy edge, keyword (that is CR 702)

**Combo Edge**:
An explicit, signed, directed link between two specific cards, used only for the closed two-card loop no **Capability** vocabulary can express (Painter's Servant + Grindstone). Deliberately capped in number — the escape hatch, not the model. Everything expressible as **Capability** must be a Capability.
_Avoid_: Synergy, combo (bare — a combo in the domain sense may well be Capability-derived)

**Card Profile**:
The per-card, per-**Pack Source** scope authored record a **Bot Drafter** reads beyond its **Pick Rating**: its **Archetypes**, the **Capabilities** it provides, the Capabilities it requires. Sibling of the **Pick Rating** — same scope keying, same DB-over-seed layering, same **Admin** editability.
_Avoid_: Card metadata (too generic), card tags

**Colour Commitment**:
How far a **Seat**'s **Pool** has already invested in each colour, and therefore how strongly a **Bot Drafter** should prefer that colour in later **Picks**. Measured from **coloured pips in mana costs**, not from card count and not from mana sources: a `{U}{U}` spell commits twice as hard as a `{4}{U}` one, and a dual land does not commit at all — it _follows_ commitment rather than creating it, so a strong land early never marries a seat to a colour pair.
_Avoid_: Colour identity (CR 903.4, a different thing), on-colour (that is the derived verdict, not the measure)

**Castability**:
Whether a **Seat**'s **Pool** can actually cast a card, measured as its coloured pip requirement against the mana sources the Pool already holds for those colours. A triple-pipped bomb in a Pool with two sources of that colour is worth less to a **Bot Drafter** than its raw power says. Distinct from **Colour Commitment**: commitment is where the seat is going, castability is what it can pay for.
_Avoid_: Playability (broader — includes curve and role), fixing

**Fixing Value**:
What a mana source is worth to a **Seat** right now — driven by **deficit**, not by **Colour Commitment**. A source's value is the pip demand its **Pool** already has for the colours it produces, minus the sources it already holds for them. A Temur pool heavy in `{R}` pips but short on red sources values Volcanic Island above Tropical Island, though both are on-colour. Capped, so a large deficit cannot make a basic land rival a genuine bomb.
_Avoid_: Mana fixing (the card property), colour fit

**Draft Signal**:
What the cards still present in a passed-around pack say about which colours the neighbouring **Seats** are not taking — the read that lets a drafter change colours mid-round rather than committing on the first **Pick**. Requires a **Seat**'s history of packs seen, not just its **Pool**. Recognised in the domain but **not yet acted on** by the **Bot Drafter**.
_Avoid_: Signal (bare — overloaded), cut, open colour (that is the conclusion drawn from a Signal)

**Pick Invariant**:
An assertion about how a **Bot Drafter**'s scoring must _respond_, never about which card it must choose: adding Flash to a **Pool** may not lower Worldspine Wurm's score; a mana source is worth more to a Pool short of that colour than to one already served. Holds for any positive weighting, so retuning never turns one red — only a broken model does (a miscensused **Capability**, an inverted deficit, a term not reading the Pool it claims to). The backbone of drafting correctness, precisely because a **Pick** is a free choice with no rules-forced right answer, unlike a gameplay move.
_Avoid_: Golden pick (promises a truth that does not exist), expected pick

**Anchor Pick**:
A small, deliberately separate set of absolute expected **Picks** where competent drafters agree and the condition is stated tightly enough to remove doubt — Black Lotus is taken from a pack containing no other Power Nine. Openly an **opinion**, not a **Pick Invariant**: it guards the base sanity of the **Bot Drafter** against gross breakage, and when one goes red the answer is a decision (accept the new behaviour and restate the anchor, or revert), never an automatic code fix. Most valuable for the **Vintage Cube**, where card power varies wildly; a set or block environment is tuned through **Pick Ratings** instead, where anchors matter less.
_Avoid_: Invariant (an Anchor is the opposite kind of claim), regression test

**Draft Lab**:
A developer surface that runs a whole **Draft** in the browser and shows, for every **Pick**, the score breakdown of every candidate in the pack. Admin-only: `/draft-lab` has no navigation entry and answers a 404 to anyone else, and the two reads it depends on are `assertIsAdmin`-gated server-side. Client-only and never persisted — it imports the same pure modules the server picks with, so it cannot drift from real **Bot Drafter** behaviour. The sibling of the gameplay **Brain**'s decision trace, applied to drafting. Two modes: a **synthetic** draft from any seed (all seats bots, full visibility on every seat — the tuning instrument), and a **replay** of a real completed **Limited Event**, reconstructed from its seed plus the human **Seat**'s append-ordered **Pool** with no extra stored data. A replay diverges the moment retuned weights change a bot **Pick**; the divergence point is shown, never hidden.
_Avoid_: Draft replay (that is one of its two modes), draft debugger, simulator (it is also a replay tool)

**Draft**:
The classic booster draft flow of a **Limited Event**: three **Boosters** per **Seat**; each round every seat **Picks** one card and passes the rest to the adjacent seat (left, then right, then left per booster). Picking is **synchronous**: seats pick in parallel, a passed pack queues at the receiving seat, and an optional **Pick Timer** fires an **Auto-Pick** on expiry so an absent human never freezes the table. **Bot Drafters** pick instantly.
_Avoid_: Rochester/Winston (other draft variants, out of scope for now)

**Pick**:
The act of a **Seat** taking exactly one card from the **Booster** currently in front of it during a **Draft**. Picked cards accumulate into the seat's **Pool**. Hidden information: a seat never sees another seat's picks.
_Avoid_: Choice (that's the gameplay **Pending Choice**), selection

**Pick Timer**:
The optional per-**Pick** clock of a **Draft**: the span a human **Seat** has to take the **Booster** in front of it before an **Auto-Pick** is made for it. Configured on/off only for the whole **Limited Event** — its length is never chosen, it is a pure function of the **cards remaining** in the pack being picked from, descending through the official Wizards booster-draft schedule, so a short pack simply starts further down the same table. With one card left there is no choice to time and no Pick Timer runs. It is a **readout**, never an alarm: it reports how much of this Pick's span is left and never interrupts the **Seat** to demand a decision.
_Avoid_: Draft timer (ambiguous with **Round Deadline**, which is per-**Round**), pick deadline (that's the instant it expires, not the clock), shot clock

**Auto-Pick**:
The **Pick** made on a human **Seat**'s behalf when its **Pick Timer** expires. Resolves the seat's **Selected Card** if one is set; otherwise takes the seat's **Default Pick**. Never randomly.
_Avoid_: Random pick, skip

**Default Pick**:
What the **Pick Heuristic** would take from the **Booster** currently in front of a human **Seat** — the card its **Auto-Pick** will take unless the seat sets a **Selected Card** first. Known from the moment the pack arrives, not computed at expiry, so the seat can be shown what the clock is about to do while there is still time to disagree. Deliberately **not** shown by default: a standing recommendation on the pack conditions the seat's own **Pick** even when it doesn't mean to, so the seat opts in to seeing it. Distinct from the **Selected Card** — one is the engine's declaration, the other the seat's choice, and the seat's always outranks it.
_Avoid_: Suggested pick (it is not advice, it is what will happen), fallback pick (it exists from the start of the **Pick Timer**, not only at expiry), standing pick

**Unattended Pick**:
A **Pick** the clock made for a **Seat** that had chosen nothing — an **Auto-Pick** resolved from the **Default Pick**. The resulting **Pool** card is one the seat neither chose nor selected, and is surfaced as such in the **Pool** until the seat makes its next **Pick** by hand, which is what proves it is back at the table. An **Auto-Pick** that honoured a **Selected Card** is **not** unattended: the seat chose that card, the clock only committed it.
_Avoid_: Missed pick (nothing was missed — a card was taken), unseen pick (the seat may have watched it happen and simply not acted), timeout pick

**Selected Card**:
A human **Seat**'s tentative choice within the **Booster** currently in front of it during a **Draft**, set by a single click (which only selects — it never commits the **Pick**). Server-persisted so the **Auto-Pick** timeout resolver can honour it. A committing gesture — double-click, the context-menu **Pick** action, or a drag into the **Pool**/**Sideboard** — takes the **Pick** immediately, bypassing selection.
_Avoid_: Highlight, hover (that's the transient preview)

**Sealed**:
The simpler **Limited Event** flow: each **Seat** receives N unopened **Boosters** (default 6, admin-configurable) whose contents form the seat's **Pool** directly — no picking, no passing.
_Avoid_: Sealed deck (the Deck is what gets built from the Pool afterwards)

**Pool**:
The set of **Card Prints** a **Seat** owns for deckbuilding in a **Limited Event** — the accumulated **Picks** (Draft) or the opened **Boosters**' contents (Sealed). The Pool, plus unlimited basic lands, is the universe the seat's **Deck** may draw from. It lives on the **Seat**, so it is authoritative only while the **Limited Event** exists; a saved **Deck** validates against its own **Deck Pool**, not against this one.
_Avoid_: Card pool (redundant), collection

**Deck Pool**:
The copy of a **Seat**'s **Pool** that lives beside a **Limited** **Deck** and is that Deck's own legality universe. Written whenever the Deck is saved and skipped when identical to what is already stored, so it stops being rewritten the moment the **Pool** stops changing. A Deck can never contradict its Deck Pool: the two are written in the same instant, from a **Pool** the Deck was built out of. It is what makes a **Limited** Deck outlive its **Limited Event** — the Event becomes the Deck's provenance rather than its authority, and legality is still **derived** (a **Deck Pool** is data, never a stored **Deck Legality**). Stored apart from the Deck row, because the deck list is a subscribed read and Convex bills a read by the whole document.
_Avoid_: Frozen pool (it is rewritten during a **Draft**), pool snapshot (there is only ever one), sideboard

**Limited Origin**:
What a **Limited** **Deck** was born from, as a canonical key: the **Limited Event**'s kind plus its **Pack Source** — `sealed:lea`, `draft:inv`, `draft:inv+ps` for a mixed booster sequence, `draft:cube:<slug>` for a cube. Copied onto the Deck, never resolved through the **Limited Event**, so it survives the Event's deletion exactly as the **Deck Pool** does. Deliberately coarser than the Event's full configuration: pack counts are not part of it, because they distinguish Decks nobody is trying to tell apart. It classifies, it never constrains — every **Limited** Deck has the same **Format** and the same rules; two Decks differing only in **Limited Origin** are equally legal. The label shown to a **User** is derived from the key, never stored beside it.
_Avoid_: Limited format (they are all one **Format**), pool source (collides with **Pack Source**, which is what the key is derived FROM), sub-format

**Pool Arrangement**:
The **Seat**-scoped, server-persisted form of a **Column Layout** for a **Limited Event**: which of the **Seat**'s **Pool** cards sit in the **Maindeck** vs the **Sideboard**, plus each card's **Card Pins**. It is built up **during the Draft** — each **Pick** lands by default in the **Column** its **Mana Value** claims — and carries unchanged into the post-draft **Deck**-build: draft and deckbuild are one continuous surface, the build view merely dropping the active **Booster**. Distinct from the **Pool** itself (the authoritative card multiset on the Seat): the Arrangement is presentation/deck-intent over that multiset, never the legality authority. It is keyed by **Pool index**, not by **Card ID**, so two copies of the same card can sit in different **Columns**.
_Avoid_: Pool layout, seat layout

**Auto-Build**:
The server-side construction of a **Limited**-legal **Deck** from a **Bot Drafter**'s **Pool** at the end of a **Limited Event**: pick the two strongest colors, ~17 spells + 17 lands, curve-aware. A bot's auto-built Deck is playable — a **User** can start a **vs-AI Game** against any bot **Seat**'s deck, closing the study loop (draft, then test your deck against the table's).
_Avoid_: Autopilot, deck generation (too generic)

**Play Phase**:
The stretch of a **Limited Event** after every **Seat** has a **Deck**, in which the event runs its Swiss **Rounds** (status `playing`, ending at `finished`). Entering it does not freeze the earlier artifacts: **Pools**, submitted **Decks** and **Auto-Built** bot decks stay readable — a Pool is never un-dealt — because they are exactly what the rounds are played and evaluated against. While it runs, free challenges and Play-vs-Bots are withdrawn; they return once the event is `finished`, labelled as unrecorded playtesting.
_Avoid_: Tournament phase, match phase (a Round contains Matches, the phase contains Rounds)

**Round**:
One Swiss round of a **Limited Event**'s **Play Phase**: a numbered set of **Pairings** covering every **Seat**, opened all at once and decided before the next begins. **Embedded** in the event document (with its pairings and their results) rather than living in its own table — the table is bounded at 8 seats × 3 rounds. A Round stamps its own `deadlineAt` from the event's **Round Deadline** when it opens.
_Avoid_: Turn, cycle

**Pairing**:
The unit inside a **Round**: two **Seats** matched against each other, or one Seat with a **Bye**. Keyed by **Seat** index, not by user — a bot Seat has no user. A Pairing is _chosen_ (with randomness among equal-score Seats) and therefore **persisted**, never re-derived, so a re-render can't disagree with what was actually played. It carries an optional result in **games won by each side** plus a `source` (`played` / `simulated` / `bye` / `timeout`) recording how the result came to be. A human Pairing gets a real **Match**; a bot-vs-bot Pairing is **evaluated** from both drafted decks, never simulated through the **GRE**.
_Avoid_: Matchup, match (a Pairing may have no Match at all)

**Match Format** (event-level):
Whether every **Round** **Match** of a **Limited Event** is best-of-one or best-of-three (`bo1` / `bo3`), chosen once at creation and fixed for the event's life. Bo3 is the default, so an unconfigured event plays like real Limited. Stored optionally (events predating the **Play Phase** carry nothing) but resolved to a definite value by a single tolerant reader, so the wire shape and every consumer only ever see a concrete format — no client re-implements the default. Maps to the existing Match's best-of setting at one seam.
_Avoid_: Format (that's the deck-construction constraint set — a different concept entirely), bestOf (that's the Match-flow field it maps onto)

**Round Deadline**:
The optional per-**Round** clock of a **Limited Event**, configured at creation as a duration in **minutes** (not an epoch — each Round stamps its own expiry when it opens) and range-checked server-side. When it expires, an undecided human **Pairing** is closed as a loss with source `timeout`. Absent means the event has no clock: a relaxed table is never cut short. It is also how a Seat that goes away is handled — there is no explicit drop.
_Avoid_: Timer, **Pick Timer** (that's the per-**Pick** clock), time limit

**Bye**:
A **Pairing** with only one **Seat** — the odd Seat out at a table with an odd count — awarded the match win, worth the games its **Match Format** requires, with source `bye`. At most one per Seat per event.
_Avoid_: Forfeit, walkover (those imply an opponent who lost)

**Standings**:
The ranked table of a **Limited Event**'s **Seats** — match points, match record and game-win percentage — **derived at read time** from the recorded **Pairing** results, never stored. The complement of persisting the Pairings: persist what was _chosen_, derive what is _implied_, so the table can never disagree with the results it comes from.
_Avoid_: Leaderboard, ranking (implies persistence across events — explicitly out of scope)

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

**Payment Park**:
A cost-payment decision suspended inside the announcement window of a **Cast** or an **Activated Ability** (CR 601.2 / 602.2), while the object is announced but not yet on the **Stack**: which permanent to sacrifice, which card to discard or exile, which creatures to tap. The announcement stays parked and cannot commit until the payer submits the pick — mana coverage alone is never enough. Distinct from a **Pending Choice**, which happens mid-resolution, after the object is already on the **Stack**. The engine's commit gate is the single authority on which payments a given announcement still owes.
_Avoid_: Pending Choice (that one is mid-resolution), **Entry Park** (that one is entry-time), picker, prompt, parked choice

**Pending Choice**:
A mid-resolution decision point where a **Spell** or **Ability** requires a **Player** to make a selection (choose targets, divide damage, search library). **Priority** is frozen until the choice is submitted.
_Avoid_: Prompt, dialog, selection, **Payment Park** (that one is announcement-time)

**As-Enters Choice**:
A decision a **Permanent** requires before it enters the **Battlefield** (CR 614.12a): which colour, which name, which body, which **Permanent** to copy, which host to enchant, whether to pay a cost. It belongs to the entry, not to the **Cast** — the same choice is made whether the **Permanent** is cast, reanimated, put onto the **Battlefield** by an effect, created as a **Token**, or played as a land.
_Avoid_: ETB choice (that reads as a **Triggered Ability**, which resolves once the **Permanent** is already there), mode (a modal **Spell**'s mode is announced instead, CR 601.2b), entry replacement

**Entry Park**:
A **Permanent** held outside every **Zone** while its **As-Enters Choices** are answered. Being in no **Zone** is the point: no **SBA**, no layer, no **Target** and no projection can reach it, and the entry completes only once every choice has been submitted. The entry-time sibling of the **Payment Park**.
_Avoid_: Staging, limbo, pending entry, **Payment Park** (that one is announcement-time)

**Random Reveal**:
A special **Pending Choice** where the engine — not a **Player** — produces the value: it draws a random outcome from the seeded PRNG, persists it, and suspends the resolving step **before the consequence is applied**, so both clients can animate the outcome first. The chooser's client auto-acknowledges when the animation ends; the engine then resumes and applies the effect. Generalizes over **Coin Flips** and future die rolls.
_Avoid_: Random prompt, RNG dialog

**Coin Flip**:
A **Random Reveal** with two faces (CR 705.2), defaulting to WIN / LOSE relative to the flipping **Player**. The drawn bit is generated once and read back on replay — never re-rolled. Used by Bottle of Suleiman, Mijae Djinn, Ydwen Efreet.
_Avoid_: Heads-or-tails (unless a card overrides the face labels), toss

**Pass Turn**:
A **Player**'s standing intent to yield the rest of the current turn. Permissive: it gives up response windows and turn-based decisions, so **Drain Auto-Pass** resolves the **Stack** and confirms attackers, blockers and damage on that **Player**'s behalf. Can be cancelled.
_Avoid_: Auto-pass, fast-forward

**Phase Stop**:
A per-**Phase**, per-side (own turn / opponent's turn) preference for where a **Player** wants to be handed **Priority**. Strict: a **Phase** with no stop is passed through only when nothing is awaited — never past a non-empty **Stack**, a pending choice or target, or a turn-based combat decision. Owned by the **Player**, not by the **Game**, and mirrored to the server so **Drain Auto-Pass** can honour it without a round-trip per **Phase**. The stored preference is the _complement_ of the stop the UI shows.
_Avoid_: Auto-pass, auto-skip, phase skip

**Drain Auto-Pass**:
The engine-side loop that applies consecutive passes after a **Priority** change without round-trips to the client. Honours both **Pass Turn** and **Phase Stop**, each with its own semantics — the permissive one may resolve the **Stack**, the strict one never may.
_Avoid_: Auto-pass chain, cascade

### Manual Play

**Manual Game**:
A game played without the **GRE** — no rule is enforced and no action is automated. Players move cards, tap, adjust life and counters by hand, and agree between themselves on legality. Hidden information is still server-enforced (projected per viewer). Every printed card is playable because no **CardDefinition** is ever hydrated — the card image alone is all the client needs.
_Avoid_: Tabletop game, free-form game, cockatrice (as a domain term — the user-facing label of a **Manual Game** IS **Cockatrice Mode**, see Surfaces)

**Manual Deck**:
A deck built for **Manual Mode**, carrying `format: "manual"`. It is REJECTED by the real engine (fail-closed in `createGame`/`joinGame`/`createSoloGame`) but a real-format deck IS playable in a **Manual Game** — both address cards by the same Scryfall print UUID.
_Avoid_: Cockatrice deck, free deck

### Surfaces

**Viewport Matrix**:
The five emulated viewports every UI-affecting change is measured at: phone portrait 390×844×3 touch, phone landscape 844×390×3 touch, tablet portrait 820×1180×2 touch, tablet landscape 1180×820×2 touch, desktop 1440×900×2. Semantic breakpoints align to it; the headless probe reports occlusion / zero-size / stranded per viewport. ADR 0101.
_Avoid_: Three viewports (the retired rule), responsive check (too vague)

**Shell Mode**:
Which chrome a route wears. **Browse** (lobby, decks, limited list, profile): top bar on desktop/tablet, bottom nav on phone. **Immersive** (board, **Draft Room**, deckbuilder): no persistent nav, a contextual bar with an explicit Exit and an overflow menu. One `AppShell` decides from the route. ADR 0101.
_Avoid_: Fullscreen (that is a browser state), header-less

**Draft Room**:
The immersive surface where a **Player** picks from the current pack: own route `/limited/$eventId/draft`, a thin bar (pack n/3 · pick n/15 · direction · timer · waiting-pack dot · **Table Ring** · pool toggle), the pack grid and the pool. On phone it has exactly two **Snap Stops**. Sealed uses it in reveal mode. ADR 0101.
_Avoid_: Draft arena (the retired #2404 name), draft page, event page (that is the antechamber)

**Snap Stop**:
One of the two resting positions of the phone **Draft Room** (`scroll-snap-type: mandatory`, no intermediates): Pack 85 / Pool 15 and Pack 15 / Pool 85 in portrait; Pack 80 / **Sneak-peek Column** 20 and collapsed-pack 20 / pool-columns 80 in landscape. The visible 15–20% of the other pane is its live tab and a drop target. ADR 0101.
_Avoid_: Tab (it is not a tab switch — the other pane stays visible), page

**Sneak-peek Column**:
The 20% right column of the landscape **Draft Room** at the pack **Snap Stop**: the picks as one vertical Arena-style pile, the Sideboard count, and the actions bar under it (Pick / → SB / Inspect for the selected card). Dropping a card on it picks it. ADR 0101.
_Avoid_: Pool strip (that is the portrait form), sidebar

**Peek Panel**:
The non-modal panel a tap opens on an editing surface (**Draft Room**, deckbuilder, search): the selected card's thumb, name, type, and a 44px CTA row (`→ Side` / `→ Pool` / `Move to…` / `Inspect`, or `Pick` / `→ SB` / `Inspect`). Portrait = bottom sheet, landscape = right rail, tablet = fixed rail. The CTA row is the primary move path on touch; long-press drag is the power-user path. ADR 0101.
_Avoid_: Action Sheet (that is the board's modal list of legal actions), card menu, toolbar

**Inspect Overlay**:
The **Card Preview Overlay** as opened from a **Peek Panel** CTA (or hover on desktop) on an editing surface: ≤100dvh, art | scrolling text in landscape, the surface's own actions inside it (builder: `→ Side`, `Move to…`; draft: `Pick`, ‹ › to step). In the **Draft Room** a tap anywhere except `Pick` closes it. Same component as the board's overlay; the trigger differs (no hold-preview on editing surfaces — long-press is drag there).
_Avoid_: Zoom, preview (say which: board preview vs inspect)

**Table Ring**:
The Arena-style dialog showing the draft table: seats, names/avatars, queued packs per seat, passing direction, self at the bottom. Opened from the **Draft Room** bar or the antechamber; never a dominant page element.
_Avoid_: Seat ring, table view, lobby ring

**Arena Mode**:
The user-facing label of a **Game** run by the **GRE** — rules enforced by the engine (vs Bot, **Solo Mode**, multiplayer). A label in the Play panel's game-mode selector, not a domain term. ADR 0101.
_Avoid_: Rules enforced, engine mode, classic, real game

**Permanent Stack**:
Two or more of a player's permanents that share the same name and the same clean state (no counters, damage, attachments or other alteration), fanned into one footprint on the battlefield with a count badge — presentation only, never the spell **Stack**. A change of state pulls a permanent out of its stack.
_Avoid_: Stack (the spell stack), pile (that is a zone), group

**Engine View**:
The part of the **Card Preview Overlay** that shows how the **GRE** read the card: its keywords, targets, effects, triggered and activated abilities as a tree of nodes with parameter chips, read from the card's definition, with a badge saying whether it is Effect Script or a hand-written protocol card, and a way to report a problem. Beside the live Oracle text, never instead of it.
_Avoid_: Parse panel, debug view, AST

**Skin**:
The visual identity layer of every surface — token values, type faces, panel frame, materials, motion — as distinct from the **Layout** (the viewport matrix, shell modes, zones and affordances of ADR 0101). A skin change moves nothing and removes no affordance; it changes how the same things look. Identity v4 (2026-08) is a skin: "quiet chrome, loud world" — cold graphite ground, monochrome ivory chrome, the colour left to card art, mana and game-state signals.
_Avoid_: Theme (too small — a theme is one value set inside a skin), restyle, redesign (that word implies layout)

**Mode Tile**:
One of the large art-backed tiles on the lobby's main menu, one per way to play (Play vs Bot, Solo game, Open a table, Limited). Selecting a tile arms the **Loadout**'s primary action; it never starts anything by itself.
_Avoid_: Card (overloaded), hero, banner

**Loadout**:
The lobby panel that shows the active deck (featured art, name, colours, size, format, legality) with the match settings (Bo1/Bo3) and the single primary action for the selected **Mode Tile**. There is exactly one.
_Avoid_: Active deck panel (that is its contents), play panel, sidebar

**Deck Shelf**:
A horizontal, scrollable row of small deck tiles (featured art + name) under the **Loadout**; one shelf per source (your decks, presets). Picking a tile swaps the **Loadout**.
_Avoid_: Deck list (the tabular form), carousel, grid

**Cockatrice Mode**:
The user-facing label of a **Manual Game** — a free table, any printed card, the players call the rules. Picking it filters the deck list to **Manual Decks** and swaps the action set (Solo table · Open a table). A label, not a domain term. ADR 0101.
_Avoid_: Tabletop, manual mode (in UI copy — the domain term stays **Manual Game**), free play

## Example Dialogue

> **Dev**: "When a creature dies, we need to move it."
> **Domain**: "A **Creature** that dies moves from the **Battlefield** to its **Owner**'s **Graveyard**. That's an **SBA** — it happens automatically before any **Player** receives **Priority**. If anything triggers on death, those **Triggered Abilities** go on the **Stack**."
>
> **Dev**: "What if a card gives all creatures +1/+1?"
> **Domain**: "That's a **Static Ability** on a **Permanent**. It applies continuously via the layer system — no **Stack** involvement. Each **Card Instance** on the **Battlefield** gets modified power/toughness. The **Card Definition** stays unchanged."
>
> **Dev**: "Player wants to Lightning Bolt a creature."
> **Domain**: "The **Player** **Announces** Lightning Bolt — it goes on the **Stack** as a **Spell** with a **Target**. The opponent gets **Priority** to respond. If both pass, it **Resolves**: the **SpellContext** calls `damage(target, 3)` on the targeted **Card Instance**. Then **SBAs** check if the creature has lethal damage."
