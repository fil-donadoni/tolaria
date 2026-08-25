/**
 * CR 205.3 subtype tables — the only place the compiler decides that a
 * capitalised noun in a rules sentence is a SUBTYPE rather than a word it does
 * not know.
 *
 * ── Why a vendored table and not a heuristic ───────────────────────────────
 *
 * "Destroy target Wall." and "Sacrifice a Forest" name a subtype where the
 * grammar expects a noun, and nothing in the sentence says which card type is
 * implied — the reader is expected to know that Wall is a creature type and
 * Forest a land type. A heuristic ("a capitalised word is a creature type")
 * fails OPEN on exactly the cases that matter: it would read "target Aura" as
 * a creature and "target Urza's Tower" as a creature named Tower. So the
 * lists are transcribed from the vendored Comprehensive Rules and a word that
 * is in none of them is refused.
 *
 * Transcribed verbatim from data/cr/comprehensive-rules.txt (ADR 0098) —
 * CR 205.3g (artifact), CR 205.3h (enchantment), CR 205.3i (land),
 * CR 205.3k (spell) and CR 205.3m (creature). Planeswalker types (CR 205.3j)
 * are deliberately absent: grammar v0 parses no planeswalker text, and a table
 * nothing reads is a table nobody maintains.
 *
 * Wizards adds subtypes with most sets, so this table goes stale the same way
 * a CR citation does: `bun run cr 205.3m` prints the current list, and
 * `scripts/__tests__/oracle-subtypes.test.ts` re-derives every list from the
 * vendored document and fails when the two disagree — so a `bun run cr:sync`
 * that brings in a new set reds the gate here instead of silently leaving a
 * new creature type unparseable.
 */

function set(csv: string): ReadonlySet<string> {
    return new Set(csv.split(","));
}

/** CR 205.3m — creature (and kindred) types. */
export const CREATURE_SUBTYPES: ReadonlySet<string> = set(
    "Advisor,Aetherborn,Alien,Ally,Angel,Antelope,Ape,Archer,Archon," +
        "Armadillo,Army,Artificer,Assassin,Assembly-Worker,Astartes,Atog," +
        "Aurochs,Avatar,Azra,Badger,Balloon,Barbarian,Bard,Basilisk,Bat,Bear," +
        "Beast,Beaver,Beeble,Beholder,Berserker,Bird,Bison,Blinkmoth,Boar," +
        "Bringer,Brushwagg,C'tan,Camarid,Camel,Capybara,Caribou,Carrier,Cat," +
        "Centaur,Child,Chimera,Citizen,Cleric,Clown,Cockatrice,Construct," +
        "Coward,Coyote,Crab,Crocodile,Custodes,Cyberman,Cyclops,Dalek,Dauthi," +
        "Demigod,Demon,Deserter,Detective,Devil,Dinosaur,Djinn,Doctor,Dog," +
        "Dragon,Drake,Dreadnought,Drix,Drone,Druid,Dryad,Dwarf,Echidna,Efreet," +
        "Egg,Elder,Eldrazi,Elemental,Elephant,Elf,Elk,Employee,Eternal,Eye," +
        "Faerie,Ferret,Fish,Flagbearer,Fox,Fractal,Frog,Fungus,Gamer,Gamma," +
        "Gargoyle,Germ,Giant,Giraffe,Gith,Glimmer,Gnoll,Gnome,Goat,Goblin,God," +
        "Golem,Gorgon,Graveborn,Gremlin,Griffin,Guest,Hag,Halfling,Hamster," +
        "Harpy,Hedgehog,Hellion,Hero,Hippo,Hippogriff,Homarid,Homunculus," +
        "Horror,Horse,Human,Hydra,Hyena,Illusion,Imp,Incarnation,Inhuman," +
        "Inkling,Inquisitor,Insect,Jackal,Jellyfish,Juggernaut,Kangaroo,Kavu," +
        "Kirin,Kithkin,Knight,Kobold,Kor,Kraken,Kree,Lamia,Lammasu,Leech," +
        "Lemur,Leviathan,Lhurgoyf,Licid,Lizard,Llama,Lobster,Manticore," +
        "Masticore,Mercenary,Merfolk,Metathran,Minion,Minotaur,Mite,Mole," +
        "Monger,Mongoose,Monk,Monkey,Moogle,Moonfolk,Mount,Mouse,Mutant,Myr," +
        "Mystic,Nautilus,Necron,Nephilim,Nightmare,Nightstalker,Ninja,Noble," +
        "Noggle,Nomad,Nymph,Octopus,Ogre,Ooze,Orb,Orc,Orgg,Otter,Ouphe,Ox," +
        "Oyster,Pangolin,Peasant,Pegasus,Pentavite,Performer,Pest,Phelddagrif," +
        "Phoenix,Phyrexian,Pilot,Pincher,Pirate,Plant,Platypus,Porcupine," +
        "Possum,Praetor,Primarch,Prism,Processor,Qu,Rabbit,Raccoon,Ranger,Rat," +
        "Rebel,Reflection,Rhino,Rigger,Robot,Rogue,Sable,Salamander,Samurai," +
        "Sand,Saproling,Satyr,Scarecrow,Scientist,Scion,Scorpion,Scout," +
        "Sculpture,Seal,Serf,Serpent,Servo,Shade,Shaman,Shapeshifter,Shark," +
        "Sheep,Shi'ar,Siren,Skeleton,Skrull,Skunk,Slith,Sliver,Sloth,Slug," +
        "Snail,Snake,Soldier,Soltari,Sorcerer,Spawn,Specter,Spellshaper," +
        "Sphinx,Spider,Spike,Spirit,Splinter,Sponge,Spy,Squid,Squirrel," +
        "Starfish,Surrakar,Survivor,Symbiote,Synth,Tentacle,Tetravite," +
        "Thalakos,Thopter,Thrull,Tiefling,Time Lord,Toy,Treefolk,Trilobite," +
        "Triskelavite,Troll,Turtle,Tyranid,Unicorn,Utrom,Vampire,Varmint," +
        "Vedalken,Villain,Volver,Wall,Walrus,Warlock,Warrior,Weasel,Weird," +
        "Werewolf,Whale,Wizard,Wolf,Wolverine,Wombat,Worm,Wraith,Wurm,Yeti," +
        "Zombie,Zubera"
);

/** CR 205.3i — land types. */
export const LAND_SUBTYPES: ReadonlySet<string> = set(
    "Cave,Desert,Forest,Gate,Island,Lair,Locus,Mine,Mountain,Plains," +
        "Planet,Power-Plant,Sphere,Swamp,Tower,Town,Urza's"
);

/** CR 205.3g — artifact types. */
export const ARTIFACT_SUBTYPES: ReadonlySet<string> = set(
    "Attraction,Blood,Bobblehead,Book,Clue,Contraption,Equipment,Food," +
        "Fortification,Gold,Incubator,Infinity,Junk,Lander,Map,Mutagen," +
        "Powerstone,Spacecraft,Stone,Treasure,Vehicle,Vibranium"
);

/** CR 205.3h — enchantment types. */
export const ENCHANTMENT_SUBTYPES: ReadonlySet<string> = set(
    "Aura,Background,Cartouche,Case,Class,Curse,Plan,Role,Room,Rune,Saga," +
        "Shard,Shrine"
);

/** CR 205.3k — spell types (instant and sorcery). */
export const SPELL_SUBTYPES: ReadonlySet<string> = set(
    "Adventure,Arcane,Lesson,Omen,Trap"
);
