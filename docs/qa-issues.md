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

- Le terre giocate dal cimitero con Icetill Explorer entrano tappate
- Berserk: la creatura non muore a fine turno dopo aver attaccato
- Worldspine Wurm è stato messo nel cimitero con Malevolent Rumble e non ha triggerato lo shuffle

## UX da migliorare

- il dialog Pay kicker cost è brutto e incoerente col resto della UI.
- restock: il testo della choiche dialog dice una carta, ma selezionandone 2 ne recupero 2, correttamente. correggere la ux
- quando ho messo il companion in mano, la zona companion puo' anche scomparire per il resto del game
- filtri deckbuilder: aggiungi anche la direzione del sorting oltre a campo di sorting
- Titania's Song toglie le abilità, ma posso ancora vedere un'abilità attivata e cliccarci sopra, per poi ricevere un errore server. il client deve essere sempr sincronizzato su questi casi e non mostarare le abilità che la carta ha perso per stato di gioco
- I bersagli possibili di una Lair devono avere il ring di candidati. questo deve valere ogni volta che si devono scegliere bersagli, ma non lo stai facendo sempre. stessa cosa ad esempio sul sacrifice di Keldon Twilight, deve evidenziare solo le tue creature non entrate in questo turno. regola generale da applicare ovunque
- quando in solo game tappo una terra che ha anche l'avversario, c'e' una strana animazione sui due fan: il mio e il suo, che però non dovrebbero interagire. forse c'è un conflitto nei conteggi per tenere insieme le terre con lo stesso state?

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
