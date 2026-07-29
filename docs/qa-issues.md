# Carte cubo da creare

Sin
Doomsday
Thassa's Oracle
Bowmaster
Jace, Vryn's Prodigy
Mystic Confluence
Stoneforge Mystic
Adeline, Resplendent Cathar
Phantasmal Image
Shelldock Isle
Elite Spellbinder
Skyclave Apparition
Tamiyo, Inquisitive Student
Urza, Lord High Artificer
Emrakul
Craterhoof
Jacked Rabbit
Gut
Hexdrinker
Troll of Kazad-dum
Bitter Triumph
Broadside Bombardiers
Springheart Nantuko
Mox Diamond
Teferone
Fallen Shinobi
Grist
Necromancy
Shallow Grave
Corpse Dance
Through the Breach
Sentinel of the Nameless City
Six
Questing Beast
Pest Infestation
Boseiju, Who Endures
Pentad Prism
Kaldra Compleat
Wrenn and Six
Vindicate
Otharri, Suns' Glory
Celestial Colonnade
Bolas's Citadel
Fable of the mirror-breaker

# Bug carte

## Carte rotte

- Berserk: la creatura non muore a fine turno dopo aver attaccato

## UX da migliorare

- quando faccio mouseover su una carta che viene coperta da card-preview si crea un loop tipo flash con card-preview che appare e scompare
- il dialog Pay kicker cost è brutto e incoerente col resto della UI.
- tangle e altre carte che danno "non stappa nel prossimo untap" funzionano, ma non c'è il dato di questa abilità ritardata nell'oracle text della card-preview. bisogna che il giocatore lo veda sempre
- restock: il testo della choiche dialog dice una carta, ma selezionandone 2 ne recupero 2, correttamente. correggere la ux
- quando ho messo il companion in mano, la zona companion puo' anche scomparire per il resto del game

# Bug gameplay

- gli scenari che specificano carte nella library non funzionano, mi ritrovo sempre e solo terre base nella libraryi invece delle carte indicate.

# Bug bot

Segnalazione 2026-07-29 — tutti tracciati, raggruppati per root cause:

- #1887 — cast no-op provabili: Damnation su board vuoto, Sheoldred's Edict senza creature/PW avversari, Sandstorm Salvager senza token, Vision Charm mode inutile, Chrome Mox senza imprint
- #1888 — choice priors: Wild Growth su terra avversaria, Flash of Insight X=0, Chrome Mox che non imprinta, Vision Charm mode sbagliata
- #1889 — engine: Everflowing Chalice con 0 charge counters tappato per mana → cast fallisce in loop
- #1890 — timing attivazioni: Mother of Runes a sorcery speed, Mishra's Factory animata post-combat

Causa strutturale sotto i 4 cluster: mappa wayfinder #1892 (soffitto di forza del bot — fedeltà dell'eval, non profondità di ricerca).

# Mobile

## Bug

## UI/UX
