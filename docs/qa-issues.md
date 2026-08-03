# Carte cubo da creare

Sin
Doomsday
Thassa's Oracle
Bowmaster
Jace, Vryn's Prodigy
Mystic Confluence
Stoneforge Mystic
Adeline, Resplendent Cathar
Elite Spellbinder
Skyclave Apparition
Tamiyo, Inquisitive Student
Urza, Lord High Artificer
Emrakul
Craterhoof
Gut
Hexdrinker
Troll of Kazad-dum
Bitter Triumph
Broadside Bombardiers
Springheart Nantuko
Mox Diamond
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
Dack Fayden
Boseiju, Who Endures
Pentad Prism
Kaldra Compleat
Wrenn and Six
Otharri, Suns' Glory
Celestial Colonnade
Bolas's Citadel
Fable of the mirror-breaker

# Bug carte

## Carte rotte

## UX da migliorare

# Bug gameplay

- quando dalla pagina scenarios clicco su test, se c'è già una partita in corso non deve comparire l'errore ma un dialog che mi chiede se voglio concedere quella partita, indicando tipologia e giocatore/bot avversario
- gli scenari che specificano carte nella library non funzionano, mi ritrovo sempre e solo terre base nella library invece delle carte indicate.

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

Su landscape deckbuilder inutilizzabile
Card preview difficile da usare e scomoda
