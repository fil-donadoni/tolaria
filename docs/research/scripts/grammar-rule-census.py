#!/usr/bin/env python3
"""
Clause-level grammar coverage census (issue #3849).

Re-derives, from `data/oracle-compiled.json` + `data/oracle-corpus.json.gz`, a
CLAUSE-level (not line-level) coverage census over the unparsed pool. Splits
each unparsed card's gap LINES (already normalised by the real compiler --
typography applied, reminder text stripped, self-name substituted to
"{self}" -- see the "fragments already self-substituted" note below) along
the compiler's OWN clause seams, read out of:

  - convex/oracle/grammar/shared/triggerHead.ts   (trigger head openers)
  - convex/oracle/grammar/shared/condition.ts     (the "if ..." CR 603.4 clause)
  - convex/oracle/grammar/shared/targetFilter.ts  (the "target <descriptor>" seam)
  - convex/oracle/grammar/shared/duration.ts      (the 4-phrase duration table)
  - convex/oracle/grammar/slots/triggered.ts      (". "-separated effect sentences,
                                                    ", " trigger-head/tail split)
  - convex/oracle/grammar/shared/subtypes.ts      (creature/land/artifact/
                                                    enchantment/spell subtype
                                                    tables, for leaf normalisation)
  - convex/oracle/grammar/shared/quantity.ts      (NUMBER_WORDS table)
  - convex/oracle/grammar/shared/targetFilter.ts  (COLOR_WORDS table)
  - convex/oracle/grammar/shared/cost.ts          (SELF_NOUNS -- "this creature" etc.)

This is NOT a re-implementation of the compiler: it is a coarser, purely
STRUCTURAL splitter (openers, first-comma, ". "-sentence splits, regex scans
for "target ..." and duration phrases) documented in full in
docs/research/grammar-rule-coverage-census.md `## Method`. Every number this
script prints states the exact table it produced.

Run:
    bun run oracle:corpus            # only if data/oracle-corpus.json.gz is absent
    python3 docs/research/scripts/grammar-rule-census.py
"""

from __future__ import annotations

import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CORPUS_PATH = ROOT / "data" / "oracle-corpus.json.gz"
COMPILED_PATH = ROOT / "data" / "oracle-compiled.json"
CUBE_PATH = ROOT / "convex" / "cubes" / "vintageCubeNames.ts"
TIER1_PATH = ROOT / "data" / "premodern-tier1-decks.json"
REGISTRY_PATH = ROOT / "convex" / "cards" / "mechanicsRegistry.ts"

K_VALUES = [25, 50, 100, 200, 400, 800]

# ── Vocabulary, transcribed from the files named above (not invented) ──────

# convex/oracle/grammar/shared/triggerHead.ts SELF_HEADS/OTHER_HEADS openers
TRIGGER_OPENERS = ["whenever ", "when ", "at the beginning of "]

# convex/oracle/grammar/shared/duration.ts PHRASES keys
DURATION_PHRASES = [
    "until end of turn",
    "until end of combat",
    "this turn",
    "until your next turn",
]

# convex/oracle/grammar/shared/playerRef.ts PHRASES keys (informational; not
# separately clause-split -- player references are short, closed-vocabulary
# and never the blocking element on their own in the corpus scan below).
PLAYER_REF_PHRASES = [
    "you",
    "each opponent",
    "each other player",
    "each player",
    "target player",
    "target opponent",
]

# convex/oracle/grammar/shared/cost.ts SELF_NOUNS ("this <noun>" == self)
SELF_NOUNS = [
    "creature",
    "artifact",
    "enchantment",
    "land",
    "planeswalker",
    "permanent",
    "card",
    "token",
    "Aura",
    "Equipment",
    "Vehicle",
]

# convex/oracle/grammar/shared/targetFilter.ts COLOR_WORDS keys
COLOR_WORDS = ["white", "blue", "black", "red", "green"]

# convex/oracle/grammar/shared/quantity.ts NUMBER_WORDS keys
NUMBER_WORDS = [
    "a", "an", "one", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
    "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
]

# convex/oracle/grammar/shared/subtypes.ts CREATURE_SUBTYPES (CR 205.3m),
# transcribed verbatim from the same comma-joined string the source uses.
CREATURE_SUBTYPES_CSV = (
    "Advisor,Aetherborn,Alien,Ally,Angel,Antelope,Ape,Archer,Archon,"
    "Armadillo,Army,Artificer,Assassin,Assembly-Worker,Astartes,Atog,"
    "Aurochs,Avatar,Azra,Badger,Balloon,Barbarian,Bard,Basilisk,Bat,Bear,"
    "Beast,Beaver,Beeble,Beholder,Berserker,Bird,Bison,Blinkmoth,Boar,"
    "Bringer,Brushwagg,C'tan,Camarid,Camel,Capybara,Caribou,Carrier,Cat,"
    "Centaur,Child,Chimera,Citizen,Cleric,Clown,Cockatrice,Construct,"
    "Coward,Coyote,Crab,Crocodile,Custodes,Cyberman,Cyclops,Dalek,Dauthi,"
    "Demigod,Demon,Deserter,Detective,Devil,Dinosaur,Djinn,Doctor,Dog,"
    "Dragon,Drake,Dreadnought,Drix,Drone,Druid,Dryad,Dwarf,Echidna,Efreet,"
    "Egg,Elder,Eldrazi,Elemental,Elephant,Elf,Elk,Employee,Eternal,Eye,"
    "Faerie,Ferret,Fish,Flagbearer,Fox,Fractal,Frog,Fungus,Gamer,Gamma,"
    "Gargoyle,Germ,Giant,Giraffe,Gith,Glimmer,Gnoll,Gnome,Goat,Goblin,God,"
    "Golem,Gorgon,Graveborn,Gremlin,Griffin,Guest,Hag,Halfling,Hamster,"
    "Harpy,Hedgehog,Hellion,Hero,Hippo,Hippogriff,Homarid,Homunculus,"
    "Horror,Horse,Human,Hydra,Hyena,Illusion,Imp,Incarnation,Inhuman,"
    "Inkling,Inquisitor,Insect,Jackal,Jellyfish,Juggernaut,Kangaroo,Kavu,"
    "Kirin,Kithkin,Knight,Kobold,Kor,Kraken,Kree,Lamia,Lammasu,Leech,"
    "Lemur,Leviathan,Lhurgoyf,Licid,Lizard,Llama,Lobster,Manticore,"
    "Masticore,Mercenary,Merfolk,Metathran,Minion,Minotaur,Mite,Mole,"
    "Monger,Mongoose,Monk,Monkey,Moogle,Moonfolk,Mount,Mouse,Mutant,Myr,"
    "Mystic,Nautilus,Necron,Nephilim,Nightmare,Nightstalker,Ninja,Noble,"
    "Noggle,Nomad,Nymph,Octopus,Ogre,Ooze,Orb,Orc,Orgg,Otter,Ouphe,Ox,"
    "Oyster,Pangolin,Peasant,Pegasus,Pentavite,Performer,Pest,Phelddagrif,"
    "Phoenix,Phyrexian,Pilot,Pincher,Pirate,Plant,Platypus,Porcupine,"
    "Possum,Praetor,Primarch,Prism,Processor,Qu,Rabbit,Raccoon,Ranger,Rat,"
    "Rebel,Reflection,Rhino,Rigger,Robot,Rogue,Sable,Salamander,Samurai,"
    "Sand,Saproling,Satyr,Scarecrow,Scientist,Scion,Scorpion,Scout,"
    "Sculpture,Seal,Serf,Serpent,Servo,Shade,Shaman,Shapeshifter,Shark,"
    "Sheep,Shi'ar,Siren,Skeleton,Skrull,Skunk,Slith,Sliver,Sloth,Slug,"
    "Snail,Snake,Soldier,Soltari,Sorcerer,Spawn,Specter,Spellshaper,"
    "Sphinx,Spider,Spike,Spirit,Splinter,Sponge,Spy,Squid,Squirrel,"
    "Starfish,Surrakar,Survivor,Symbiote,Synth,Tentacle,Tetravite,"
    "Thalakos,Thopter,Thrull,Tiefling,Time Lord,Toy,Treefolk,Trilobite,"
    "Triskelavite,Troll,Turtle,Tyranid,Unicorn,Utrom,Vampire,Varmint,"
    "Vedalken,Villain,Volver,Wall,Walrus,Warlock,Warrior,Weasel,Weird,"
    "Werewolf,Whale,Wizard,Wolf,Wolverine,Wombat,Worm,Wraith,Wurm,Yeti,"
    "Zombie,Zubera"
)
CREATURE_SUBTYPES = set(CREATURE_SUBTYPES_CSV.split(","))

# convex/oracle/grammar/shared/subtypes.ts LAND_SUBTYPES (CR 205.3i)
LAND_SUBTYPES_CSV = (
    "Cave,Desert,Forest,Gate,Island,Lair,Locus,Mine,Mountain,Plains,"
    "Planet,Power-Plant,Sphere,Swamp,Tower,Town,Urza's"
)
LAND_SUBTYPES = set(LAND_SUBTYPES_CSV.split(","))
# CR 305.6 -- the five BASIC land types, the subset LAND_SUBTYPES does not
# itself distinguish (grammar v0's own vocabulary has no "basic" split; this
# split is ours, for the ticket's "basic types" leaf-normalisation item).
BASIC_LAND_TYPES = {"Plains", "Island", "Swamp", "Mountain", "Forest"}
OTHER_LAND_SUBTYPES = LAND_SUBTYPES - BASIC_LAND_TYPES

ARTIFACT_SUBTYPES = set((
    "Attraction,Blood,Bobblehead,Book,Clue,Contraption,Equipment,Food,"
    "Fortification,Gold,Incubator,Infinity,Junk,Lander,Map,Mutagen,"
    "Powerstone,Spacecraft,Stone,Treasure,Vehicle,Vibranium"
).split(","))
ENCHANTMENT_SUBTYPES = set((
    "Aura,Background,Cartouche,Case,Class,Curse,Plan,Role,Room,Rune,Saga,"
    "Shard,Shrine"
).split(","))
SPELL_SUBTYPES = set("Adventure,Arcane,Lesson,Omen,Trap".split(","))
OTHER_SUBTYPES = ARTIFACT_SUBTYPES | ENCHANTMENT_SUBTYPES | SPELL_SUBTYPES | OTHER_LAND_SUBTYPES

# ── Leaf normalisation (ticket item 1: numbers / mana / colours / basic
#    types / creature types / self-reference) ───────────────────────────────

# Any brace-delimited printed symbol -- mana pips {W}{2}{X}, but also the
# non-mana symbols the same {…} notation carries ({T} tap, {Q} untap, {E}
# energy): folded into ONE leaf token because oracle text draws all of them
# from the same glyph inventory and the ticket's "mana" leaf is the closest
# named bucket. Documented as a widening of the literal ticket wording.
SYMBOL_RE = re.compile(r"\{[^{}]{1,6}\}")
SIGNED_NUMBER_RE = re.compile(r"[+-]?\d+")
STANDALONE_X_RE = re.compile(r"(?<![A-Za-z0-9_])X(?![A-Za-z0-9_])")
ADJACENT_SYM_RE = re.compile(r"SYM(?=SYM)")


def _word_alternation(words: set[str] | list[str]) -> re.Pattern[str]:
    ordered = sorted(set(words), key=len, reverse=True)
    escaped = [re.escape(w) for w in ordered]
    return re.compile(r"(?<![A-Za-z0-9_'])(?:" + "|".join(escaped) + r")(?![A-Za-z0-9_'])")


CREATURE_SUBTYPE_RE = _word_alternation(CREATURE_SUBTYPES)
BASIC_LAND_RE = _word_alternation(BASIC_LAND_TYPES | {t + "s" for t in BASIC_LAND_TYPES})
OTHER_SUBTYPE_RE = _word_alternation(OTHER_SUBTYPES)
COLOR_WORD_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:" + "|".join(COLOR_WORDS) + r")(?![A-Za-z0-9_])",
    re.IGNORECASE,
)
NUMBER_WORD_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:" + "|".join(sorted(NUMBER_WORDS, key=len, reverse=True)) + r")(?![A-Za-z0-9_])",
    re.IGNORECASE,
)
THIS_NOUN_RE = re.compile(
    r"\bthis (?:" + "|".join(re.escape(n) for n in SELF_NOUNS) + r")\b"
)


def leaf_normalize(text: str) -> str:
    """Ticket item 1: numbers, mana, colours, basic types, creature types,
    self-reference -> placeholders. `{self}` is already in the fragment text
    (the real compiler's own normalize.ts substitution, CR 201.5) -- this
    only renames it to a brace-free token so it cannot collide with the
    mana-pip regex below."""
    s = text.replace("{self}", "SELF_OBJ")
    s = THIS_NOUN_RE.sub("SELF_OBJ", s)
    s = SYMBOL_RE.sub("SYM", s)
    s = ADJACENT_SYM_RE.sub("SYM ", s)  # cosmetic: "{1}{U}" -> "SYM SYM", not "SYMSYM"
    s = CREATURE_SUBTYPE_RE.sub("CREATURETYPE", s)
    s = BASIC_LAND_RE.sub("BASICLAND", s)
    s = OTHER_SUBTYPE_RE.sub("SUBTYPE", s)
    s = COLOR_WORD_RE.sub("COLOR", s)
    s = NUMBER_WORD_RE.sub("N", s)
    s = SIGNED_NUMBER_RE.sub("N", s)
    s = STANDALONE_X_RE.sub("X_VAR", s)
    return s


# ── Clause splitting (ticket item 1: trigger head / condition / effect /
#    target filter / duration seams, read out of triggered.ts + the shared
#    sub-grammars named in the module docstring) ────────────────────────────

TARGET_PHRASE_RE = re.compile(
    r"\b(?:any target|up to one target [^,.:;]*|target [^,.:;]*)"
)
KNOWN_DURATION_RE = re.compile(
    "(?:" + "|".join(re.escape(p) for p in DURATION_PHRASES) + ")",
    re.IGNORECASE,
)
# duration.ts PHRASES -> DurationIR kind. "this turn" and "until end of turn"
# are the SAME kind in the real grammar (durationRule), so they must be the
# SAME clause shape here too, or the census would double-count one rule as
# two.
DURATION_KIND = {
    "until end of turn": "end-of-turn",
    "this turn": "end-of-turn",
    "until end of combat": "end-of-combat",
    "until your next turn": "your-next-turn",
}
# A catch-all for a duration-SHAPED phrase this grammar's 4-phrase table does
# not know -- "for as long as ...", "until ...", scanned only where the known
# table did not already match, so we do not double count.
UNKNOWN_DURATION_RE = re.compile(
    r"\b(?:for as long as [^,.:;]*|until [^,.:;]*)", re.IGNORECASE
)

# convex/oracle/grammar/shared/zoneRef.ts PHRASES keys (CR 400.1), longest
# first so "the top of your library" is not shadowed by "your library".
ZONE_REF_PHRASES = sorted(
    [
        "the battlefield", "your graveyard", "a graveyard",
        "its owner's graveyard", "your hand", "its owner's hand", "exile",
        "your library", "the top of your library", "the bottom of your library",
        "the top of its owner's library", "the bottom of its owner's library",
    ],
    key=len, reverse=True,
)
KNOWN_ZONE_RE = re.compile(
    "(?:" + "|".join(re.escape(p) for p in ZONE_REF_PHRASES) + ")", re.IGNORECASE
)

# ── Sentence-pattern canonicalisation (mirrors
#    convex/oracle/grammar/shared/effectClause.ts `effectSentence`) ─────────
#
# Applied to the sentence AFTER target-filter/duration/zone phrases are
# masked to TARGET_SLOT/DURATION_SLOT/ZONE_SLOT and leaves are normalised
# (numbers -> N, mana/symbols -> SYM, self -> SELF_OBJ). This is what lets
# two sentences that differ only in their target descriptor, their amount or
# their duration collapse to ONE shape -- the "composition" the line-level
# census (crude whole-line shape normalisation) cannot see, because it never
# separates the verb from its slots in the first place.
PUMP_RE = re.compile(r"^(.+) gets N/N DURATION_SLOT$")
DAMAGE_RE = re.compile(r"^(.+) deals N damage to (.+)$", re.IGNORECASE)
DRAW_SELF_RE = re.compile(r"^draw N cards?$", re.IGNORECASE)
DRAW_PLAYER_RE = re.compile(r"^(.+) draws N cards?$", re.IGNORECASE)
LIFE_RE = re.compile(r"^(.+) (gains?|loses?) N life$", re.IGNORECASE)
COUNTERS_RE = re.compile(r"^put N (\S+) counters? on (.+)$", re.IGNORECASE)
DISCARD_RANDOM_RE = re.compile(r"^(.+) discards N cards? at random$", re.IGNORECASE)
DESTROY_RE = re.compile(r"^destroy (.+)$", re.IGNORECASE)
TAP_UNTAP_RE = re.compile(r"^(tap|untap) (.+)$", re.IGNORECASE)
REGENERATE_RE = re.compile(r"^regenerate (.+)$", re.IGNORECASE)
RETURN_RE = re.compile(r"^return (.+) to (.+)$", re.IGNORECASE)
EXILE_RE = re.compile(r"^exile (.+)$", re.IGNORECASE)
GRANT_RE = re.compile(r"^(.+) gains (.+) DURATION_SLOT$", re.IGNORECASE)
SUPPRESS_DAMAGE_PREVENTION_TXT = "damage can't be prevented DURATION_SLOT"
CANT_BE_REGENERATED_TXT = "it can't be regenerated"
RESTRICTION_TEXTS = {
    "activate only as a sorcery": "sorcery-only",
    "activate this ability only as a sorcery": "sorcery-only",
    "activate only once each turn": "once-per-turn",
    "activate this ability only once each turn": "once-per-turn",
    "activate only during your turn": "your-turn-only",
    "activate this ability only during your turn": "your-turn-only",
    "activate only during your upkeep": "phase-upkeep",
    "activate this ability only during your upkeep": "phase-upkeep",
    "any player may activate this ability": "any-player",
}


def canon_subject(s: str) -> str:
    """playerRef.ts PHRASES + effectClause.ts SubjectIR, collapsed to one
    canonical token per subject KIND (not per literal phrase)."""
    s2 = s.strip()
    if s2 == "SELF_OBJ":
        return "SELF"
    if s2.startswith("TARGET_SLOT"):
        return "TARGET"
    low = s2.lower()
    if low == "you":
        return "PLAYER_YOU"
    if low in ("each opponent", "each other player"):
        return "PLAYER_OPPONENT"
    if low == "each player":
        return "PLAYER_EACH"
    if low == "target player":
        return "TARGET_PLAYER"
    if low == "target opponent":
        return "TARGET_OPPONENT"
    return "SUBJECT_OTHER"


def canonicalize_sentence(skeleton: str) -> tuple[str, str]:
    """The masked+leaf-normalised sentence -> (category, canonical shape).
    `effect-pattern` when it matches one of grammar v0's known sentence
    verbs (effectClause.ts); `effect-opaque` (the residual skeleton) when it
    matches none -- the genuine "we have no verb rule for this" bucket."""
    s = skeleton.strip()
    low = s.lower()

    if low in RESTRICTION_TEXTS:
        return ("effect-pattern", f"RESTRICTION:{RESTRICTION_TEXTS[low]}")
    if low == CANT_BE_REGENERATED_TXT:
        return ("effect-pattern", "MODIFIER_CANT_BE_REGENERATED")
    if low == SUPPRESS_DAMAGE_PREVENTION_TXT:
        return ("effect-pattern", "SUPPRESS_DAMAGE_PREVENTION")

    m = PUMP_RE.match(s)
    if m:
        return ("effect-pattern", f"PUMP(subject={canon_subject(m.group(1))})")
    m = DAMAGE_RE.match(s)
    if m:
        return ("effect-pattern",
                 f"DEAL_DAMAGE(from={canon_subject(m.group(1))},to={canon_subject(m.group(2))})")
    if DRAW_SELF_RE.match(s):
        return ("effect-pattern", "DRAW(player=PLAYER_YOU)")
    m = DRAW_PLAYER_RE.match(s)
    if m:
        return ("effect-pattern", f"DRAW(player={canon_subject(m.group(1))})")
    m = LIFE_RE.match(s)
    if m:
        action = "gain" if m.group(2).lower().startswith("gain") else "lose"
        return ("effect-pattern", f"LIFE({action},player={canon_subject(m.group(1))})")
    m = COUNTERS_RE.match(s)
    if m:
        return ("effect-pattern", f"COUNTERS(subject={canon_subject(m.group(2))})")
    m = DISCARD_RANDOM_RE.match(s)
    if m:
        return ("effect-pattern", f"DISCARD_RANDOM(player={canon_subject(m.group(1))})")
    m = DESTROY_RE.match(s)
    if m:
        return ("effect-pattern", f"DESTROY(subject={canon_subject(m.group(1))})")
    m = TAP_UNTAP_RE.match(s)
    if m:
        return ("effect-pattern", f"TAP_UNTAP({m.group(1).lower()},subject={canon_subject(m.group(2))})")
    m = REGENERATE_RE.match(s)
    if m:
        return ("effect-pattern", f"REGENERATE(subject={canon_subject(m.group(1))})")
    m = RETURN_RE.match(s)
    if m:
        zone = "ZONE_KNOWN" if "ZONE_SLOT" in m.group(2) else "ZONE_OTHER"
        return ("effect-pattern", f"RETURN(subject={canon_subject(m.group(1))},zone={zone})")
    m = EXILE_RE.match(s)
    if m:
        return ("effect-pattern", f"EXILE(subject={canon_subject(m.group(1))})")
    m = GRANT_RE.match(s)
    if m:
        return ("effect-pattern",
                 f"GRANT_ABILITY(subject={canon_subject(m.group(1))},keyword={m.group(2).strip().lower()})")

    return ("effect-opaque", s)


def extract_and_mask(pattern: re.Pattern[str], text: str, placeholder: str):
    """Return (clauses_found, masked_text) -- every match of `pattern`
    replaced in-place by `placeholder` so the residual skeleton keeps its
    sentence shape (composition, ADR 0105) rather than losing the slot."""
    found = pattern.findall(text)
    masked = pattern.sub(placeholder, text)
    return found, masked


def find_top_level_colon(line: str) -> int:
    """First ': ' in the line. Oracle mana/loyalty symbols never themselves
    contain a colon, so no brace-depth tracking is needed here."""
    return line.find(": ")


def segment_line(line: str) -> list[tuple[str, str]]:
    """One already-normalised gap LINE -> a list of (category, shape) pairs.

    Categories: trigger-head, condition, cost, target-filter, duration,
    duration-unknown, zone-ref, effect-pattern, effect-opaque. Every
    category's text is leaf-normalised before being returned; see
    `leaf_normalize` and `canonicalize_sentence`.
    """
    clauses: list[tuple[str, str]] = []
    remainder = line
    low = remainder.lower()

    is_trigger = any(low.startswith(op) for op in TRIGGER_OPENERS)
    if is_trigger:
        idx = remainder.find(", ")
        if idx != -1:
            clauses.append(("trigger-head", leaf_normalize(remainder[:idx].lower())))
            remainder = remainder[idx + 2:]
        else:
            clauses.append(("opaque-line", leaf_normalize(remainder)))
            return clauses
    else:
        colon = find_top_level_colon(remainder)
        if colon != -1:
            clauses.append(("cost", leaf_normalize(remainder[:colon])))
            remainder = remainder[colon + 2:]

    if remainder.lower().startswith("if "):
        idx2 = remainder.find(", ")
        if idx2 != -1:
            clauses.append(("condition", leaf_normalize(remainder[:idx2].lower())))
            remainder = remainder[idx2 + 2:]

    if not remainder:
        return clauses

    body = remainder[:-1] if remainder.endswith(".") else remainder
    sentences = [s for s in body.split(". ") if s != ""]
    if not sentences:
        return clauses

    for sentence in sentences:
        targets, masked = extract_and_mask(TARGET_PHRASE_RE, sentence, "TARGET_SLOT")
        for t in targets:
            clauses.append(("target-filter", leaf_normalize(t.lower())))

        known_durs = KNOWN_DURATION_RE.findall(masked)
        masked = KNOWN_DURATION_RE.sub("DURATION_SLOT", masked)
        for d in known_durs:
            clauses.append(("duration", DURATION_KIND[d.lower()]))

        unknown_durs, masked = extract_and_mask(
            UNKNOWN_DURATION_RE, masked, "DURATION_SLOT"
        )
        for d in unknown_durs:
            clauses.append(("duration-unknown", leaf_normalize(d.lower())))

        zones, masked = extract_and_mask(KNOWN_ZONE_RE, masked, "ZONE_SLOT")
        for z in zones:
            clauses.append(("zone-ref", z.lower()))

        skeleton = leaf_normalize(masked)
        clauses.append(canonicalize_sentence(skeleton))

    return clauses


# ── Loading ──────────────────────────────────────────────────────────────

def load_corpus() -> list[dict]:
    if not CORPUS_PATH.exists():
        sys.exit(
            f"missing {CORPUS_PATH} -- run: bun run oracle:corpus "
            "(or copy it from a checkout that has it; it is gitignored)"
        )
    with gzip.open(CORPUS_PATH, "rt") as f:
        return json.load(f)


def load_compiled() -> dict:
    return json.loads(COMPILED_PATH.read_text())


def load_cube_names() -> list[str]:
    src = CUBE_PATH.read_text()
    body = src.split("VINTAGE_CUBE_NAMES: readonly string[] = [", 1)[1]
    body = body.split("];", 1)[0]
    return re.findall(r'"([^"]+)"', body)


def load_tier1() -> dict:
    return json.loads(TIER1_PATH.read_text())


def load_registry() -> list[dict]:
    src = REGISTRY_PATH.read_text()
    cut = src.split("export const MECHANICS_REGISTRY")[0]
    chunks = re.split(r"\n\s*\{\s*\n(?=\s*id:\s*\")", cut)
    rows = []
    for chunk in chunks[1:]:
        mid = re.search(r'id:\s*"([^"]+)"', chunk)
        mname = re.search(r'name:\s*"([^"]+)"', chunk)
        mstatus = re.search(r'status:\s*"([^"]+)"', chunk)
        if mid and mname and mstatus:
            rows.append({"id": mid.group(1), "name": mname.group(1), "status": mstatus.group(1)})
    return rows


def registry_note_for(example_line: str, registry: list[dict]) -> str:
    """One-line note (ticket item 5): does an `implemented` Mechanics
    Registry row's NAME appear (whole word, case-insensitive) in the example
    line? This is a heuristic keyword-mention scan, not a compiler check."""
    low = example_line.lower()
    hits = []
    for row in registry:
        name = row["name"]
        if len(name) < 4:
            continue  # skip 1-3 char names, too many false positives
        if re.search(r"(?<![a-z0-9])" + re.escape(name.lower()) + r"(?![a-z0-9])", low):
            hits.append((name, row["status"]))
    if not hits:
        return "no Mechanics Registry keyword mentioned -- grammar-only gap"
    implemented = [n for n, s in hits if s == "implemented"]
    planned = [n for n, s in hits if s == "planned"]
    if implemented and not planned:
        return f"mentions {', '.join(implemented)} (registry: implemented) -- grammar-only gap"
    if planned:
        return f"mentions {', '.join(planned)} (registry: planned) -- engine gap, not grammar-only"
    return f"mentions {', '.join(n for n, _ in hits)}"


def main() -> None:
    corpus = load_corpus()
    compiled = load_compiled()
    fragments = compiled["fragments"]
    ccards = compiled["cards"]
    registry = load_registry()

    name_to_oracle = {c["name"]: c["oracleId"] for c in corpus}
    oracle_to_corpus = {c["oracleId"]: c for c in corpus}
    # Multi-faced cards (MDFC/adventure/split/flip/transform) carry the
    # corpus's Scryfall "name" as "Front // Back"; every OTHER data source in
    # this script (cube list, tier1 decks) names only the front face.
    front_face_to_oracle = {
        c["name"].split(" // ", 1)[0]: c["oracleId"]
        for c in corpus
        if " // " in c["name"]
    }

    def resolve_name(n: str) -> str | None:
        if n in name_to_oracle:
            return name_to_oracle[n]
        return front_face_to_oracle.get(n)

    cube_names = load_cube_names()
    cube_oracle_ids = {resolve_name(n) for n in cube_names if resolve_name(n) is not None}
    cube_missing = [n for n in cube_names if resolve_name(n) is None]

    tier1 = load_tier1()
    tier1_deck_ids: dict[str, set[str]] = {}
    tier1_all_ids: set[str] = set()
    for deck in tier1["decks"]:
        ids = set()
        for entry in deck["main"] + deck["sideboard"]:
            oid = resolve_name(entry["name"])
            if oid is not None:
                ids.add(oid)
        tier1_deck_ids[deck["slug"]] = ids
        tier1_all_ids |= ids

    premodern_ids = {c["oracleId"] for c in corpus if "premodern" in c.get("poolIn", [])}
    corpus_ids = {c["oracleId"] for c in corpus}

    unparsed = [c for c in ccards if c["state"] == "unparsed"]
    unparsed_ids = {c["oracleId"] for c in unparsed}
    ready_ids = {c["oracleId"] for c in ccards if c["state"] == "ready"}

    TARGETS = {
        "premodern": premodern_ids,
        "cube": cube_oracle_ids,
        "tier1": tier1_all_ids,
        "corpus": corpus_ids,
    }

    print("=== Target pool sizes (item: setup) ===")
    for name, ids in TARGETS.items():
        n_unparsed = len(ids & unparsed_ids)
        n_ready = len(ids & ready_ids)
        print(f"{name}: total={len(ids)} unparsed={n_unparsed} ready={n_ready} "
              f"baseline_ready%={100*n_ready/len(ids):.1f}")
    print()

    print("=== Item 2 (per-deck): the 6 Tier 1 lists individually ===")
    for slug, ids in tier1_deck_ids.items():
        n_unparsed = len(ids & unparsed_ids)
        n_ready = len(ids & ready_ids)
        print(f"-- {slug}: total={len(ids)} unparsed={n_unparsed} ready={n_ready} "
              f"baseline_ready%={100*n_ready/len(ids):.1f} --")
    print()

    # ── Per-card clause requirement sets ────────────────────────────────
    STRUCTURAL_REASON_PREFIX_STRIP = re.compile(r'"[^"]*"')

    def reason_shape(reason: str) -> str:
        # Generalise a structural (non-textual) gap reason by blanking any
        # quoted literal it names, so "layout \"transform\" is not in
        # grammar v0 ..." and "layout \"saga\" is not in grammar v0 ..."
        # stay ONE shape ("layout-not-in-grammar-v0") rather than one per
        # literal value.
        return STRUCTURAL_REASON_PREFIX_STRIP.sub("<X>", reason)

    frag_clauses: list[list[tuple[str, str]]] = []
    for frag in fragments:
        if frag["reason"] == "no slot consumed the line":
            frag_clauses.append(segment_line(frag["text"]))
        else:
            frag_clauses.append([("structural-gap", reason_shape(frag["reason"]))])

    card_requirements: dict[str, set[tuple[str, str]]] = {}
    for c in unparsed:
        reqs: set[tuple[str, str]] = set()
        for gap_idx in c["gaps"]:
            reqs.update(frag_clauses[gap_idx])
        card_requirements[c["oracleId"]] = reqs

    all_shapes: set[tuple[str, str]] = set()
    for reqs in card_requirements.values():
        all_shapes |= reqs
    print(f"distinct clause shapes across all unparsed gap lines: {len(all_shapes)}")
    by_cat = Counter(cat for cat, _ in all_shapes)
    print(f"by category: {dict(by_cat)}")
    print()

    # Representative raw example + blocking-card ids per shape, gathered
    # from the ORIGINAL (un-normalised) fragment text/reason, weighted by
    # each fragment's own global card count, for item 5's "verbatim" ask.
    shape_examples: dict[tuple[str, str], Counter] = defaultdict(Counter)
    shape_cards: dict[tuple[str, str], set[str]] = defaultdict(set)
    for c in unparsed:
        for gap_idx in c["gaps"]:
            frag = fragments[gap_idx]
            for shape in frag_clauses[gap_idx]:
                shape_examples[shape][frag["text"] if frag["reason"] == "no slot consumed the line" else frag["reason"]] += frag["cards"]
                shape_cards[shape].add(c["oracleId"])

    def blocking_count(shape, ids: set[str]) -> int:
        return len(shape_cards[shape] & ids)

    # ── Occurrence-mass check against the ticket's August estimate
    #    ("~234 clause shapes = 50% of clause OCCURRENCES") ─────────────
    # This is a DIFFERENT statistic from "cards blocked": every fragment's
    # global `cards` count is added to EVERY clause shape it produces (a
    # 3-clause line contributes to 3 shapes' occurrence totals), un-deduped
    # by card and un-scoped to any Target -- the same statistic the August
    # estimate is described as measuring.
    occurrence_weight: Counter = Counter()
    total_occurrences = 0
    for frag, clauses_for_frag in zip(fragments, frag_clauses):
        if frag["reason"] != "no slot consumed the line":
            continue
        for shape in clauses_for_frag:
            occurrence_weight[shape] += frag["cards"]
            total_occurrences += frag["cards"]
    ranked_by_occurrence = occurrence_weight.most_common()
    running = 0
    k_for_50 = None
    for i, (_, w) in enumerate(ranked_by_occurrence, start=1):
        running += w
        if k_for_50 is None and running >= total_occurrences / 2:
            k_for_50 = i
    print(f"=== Occurrence-mass check (cf. ticket's August ~234-shapes-=-50% estimate) ===")
    print(f"total clause occurrences (textual gap lines only): {total_occurrences}")
    print(f"distinct clause shapes producing them: {len(ranked_by_occurrence)}")
    print(f"shapes needed for 50% of occurrence mass: {k_for_50}")
    for k in [50, 100, 234, 500, 1000]:
        running_k = sum(w for _, w in ranked_by_occurrence[:k])
        print(f"  top {k:5d} shapes cover {100*running_k/total_occurrences:5.1f}% of occurrences")
    print()

    # ── Item 2: rank clause shapes by cards blocked, per Target ─────────
    rankings: dict[str, list[tuple[tuple[str, str], int]]] = {}
    for tname, ids in TARGETS.items():
        target_unparsed = ids & unparsed_ids
        counts = [(shape, blocking_count(shape, target_unparsed)) for shape in all_shapes]
        counts = [x for x in counts if x[1] > 0]
        counts.sort(key=lambda x: (-x[1], x[0]))
        rankings[tname] = counts

    print("=== Clause vocabulary size per Target (distinct shapes with >=1 blocked card) ===")
    for tname in TARGETS:
        print(f"  {tname}: {len(rankings[tname])} distinct clause shapes block >=1 unparsed card")
    print()

    print("=== Item 2: top 15 clause shapes by cards blocked, per Target ===")
    for tname in TARGETS:
        print(f"-- {tname} --")
        for shape, cnt in rankings[tname][:15]:
            print(f"  {cnt:5d}  {shape[0]:16s} {shape[1]}")
    print()

    # ── Item 3: greedy/frequency curves ─────────────────────────────────
    # "fix top-K clause shapes ordered by X" -- a FIXED frequency ranking
    # (not a re-optimised marginal-gain greedy pass) built once from each
    # ordering target's own blocking counts (see Method for why).
    print("=== Item 3: ready% at K shapes, ordering x target matrix ===")
    curve: dict[str, dict[int, dict[str, float]]] = defaultdict(dict)
    for order_name in ["premodern", "cube", "corpus"]:
        ordered_shapes = [shape for shape, _ in rankings[order_name]]
        for k in K_VALUES:
            top_k = set(ordered_shapes[:k])
            row = {}
            for tname, ids in TARGETS.items():
                target_unparsed_ids = ids & unparsed_ids
                if not target_unparsed_ids:
                    row[tname] = float("nan")
                    continue
                newly_ready = sum(
                    1 for oid in target_unparsed_ids
                    if card_requirements[oid] <= top_k
                )
                n_ready_already = len(ids & ready_ids)
                total = len(ids)
                pct = 100 * (n_ready_already + newly_ready) / total
                row[tname] = pct
            curve[order_name][k] = row
            print(f"order={order_name:9s} K={k:4d}  " +
                  "  ".join(f"{t}={curve[order_name][k][t]:5.1f}%" for t in TARGETS))
    print()

    # ── Item 4: overlap of top-200 shapes, premodern vs cube ────────────
    top200_premodern = set(s for s, _ in rankings["premodern"][:200])
    top200_cube = set(s for s, _ in rankings["cube"][:200])
    overlap = top200_premodern & top200_cube
    cube_only = top200_cube - top200_premodern
    print(f"=== Item 4: top-200 overlap: {len(overlap)} shapes in both premodern and cube top-200 ===")
    print(f"cube-only among cube top-200: {len(cube_only)}")

    LAYOUT_FRAMES = {
        "modal_dfc": "MDFC",
        "saga": "saga chapters",
        "class": "class levels",
        "leveler": "leveler",
        "adventure": "adventure",
        "split": "split-permanent",
        "transform": "transform (DFC)",
        "flip": "flip",
        "meld": "meld",
        "prototype": "prototype",
        "mutate": "mutate",
        "case": "case",
        "prepare": "prepare (Alchemy)",
        "host": "host/augment",
        "augment": "host/augment",
        "front_card": "front_card (unsupported multi-face)",
    }

    def frame_of(oid: str) -> str:
        card = oracle_to_corpus.get(oid)
        if card is None:
            return "unknown"
        layout = card.get("layout", "normal")
        if layout in LAYOUT_FRAMES:
            return LAYOUT_FRAMES[layout]
        type_line = card.get("typeLine", "")
        if "Planeswalker" in type_line:
            return "planeswalker loyalty"
        return "plain composition"

    frame_bucket = Counter()
    for shape in cube_only:
        cube_unparsed_ids = shape_cards[shape] & (TARGETS["cube"] & unparsed_ids)
        frames = Counter(frame_of(oid) for oid in cube_unparsed_ids)
        dominant = frames.most_common(1)[0][0] if frames else "unknown"
        frame_bucket[dominant] += 1
    print("cube-only top-200 shapes, bucketed by DOMINANT layout frame of the cards behind them:")
    for frame, n in frame_bucket.most_common():
        print(f"  {n:4d}  {frame}")
    print()

    # ── Item 5: first 30 premodern shapes and first 30 cube shapes ──────
    # `cnt` is cards blocked BY THE SHAPE (shape[1], the normalised clause
    # text) -- the printed line is only ONE representative raw example of a
    # line that contains that shape, never the whole story on its own (a
    # "duration" shape's example line is a full trigger sentence; the SHAPE
    # is just its "until end of turn" tail).
    def print_top30(order_name: str):
        print(f"=== Item 5: first 30 {order_name} shapes ===")
        print("(cnt = cards blocked BY THE SHAPE; the example line is one "
              "raw occurrence of it, for readability only)")
        for i, (shape, cnt) in enumerate(rankings[order_name][:30], start=1):
            example_text, _ = shape_examples[shape].most_common(1)[0]
            note = registry_note_for(example_text, registry)
            print(f"{i:2d}. [{cnt:4d} cards] ({shape[0]}) shape: {shape[1]!r}")
            print(f"      e.g.: {example_text!r}")
            print(f"      note: {note}")
        print()

    print_top30("premodern")
    print_top30("cube")

    if cube_missing:
        print(f"NOTE: {len(cube_missing)} cube names not found in corpus by exact name match "
              f"(double-faced-card naming mismatch, most likely): {cube_missing[:10]}")


if __name__ == "__main__":
    main()
