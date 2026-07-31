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

- quando ho il dialog di auto-tap e premo esc deve annullare il cast, come avessi premuto U, invece di aprire il menu
- quando faccio mouseover su una carta che viene coperta da card-preview si crea un loop tipo flash con card-preview che appare e scompare
- il dialog Pay kicker cost è brutto e incoerente col resto della UI.
- tangle e altre carte che danno "non stappa nel prossimo untap" funzionano, ma non c'è il dato di questa abilità ritardata nell'oracle text della card-preview. bisogna che il giocatore lo veda sempre
- restock: il testo della choiche dialog dice una carta, ma selezionandone 2 ne recupero 2, correttamente. correggere la ux
- quando ho messo il companion in mano, la zona companion puo' anche scomparire per il resto del game
- quirion elves: la scelta deve essere scritta nell'oracle text della card-preview, come per chromatic armor
- filtri deckbuilder: aggiungi anche la direzione del sorting oltre a campo di sorting
- Titania's Song toglie le abilità, ma posso ancora vedere un'abilità attivata e cliccarci sopra, per poi ricevere un errore server. il client deve essere sempr sincronizzato su questi casi e non mostarare le abilità che la carta ha perso per stato di gioco
- I bersagli possibili di una Lair devono avere il ring di candidati. questo deve valere ogni volta che si devono scegliere bersagli, ma non lo stai facendo sempre. stessa cosa ad esempio sul sacrifice di Keldon Twilight, deve evidenziare solo le tue creature non entrate in questo turno. regola generale da applicare ovunque
- quando in solo game tappo una terra che ha anche l'avversario, c'e' una strana animazione sui due fan: il mio e il suo, che però non dovrebbero interagire. forse c'è un conflitto nei conteggi per tenere insieme le terre con lo stesso state?
- in Skyship Weatherlight le due parti di oracle text sono scambiate nella card-preview rispetto a quello che è stampato sulla carta originale. verifica la causa root e sistema globalmente.
- chromatic armor non mostra il colore di cui sta prevenendo il danno, in card-preview

# Bug gameplay

- quando dalla pagina scenarios clicco su test, se c'è già una partita in corso non deve comparire l'errore ma un dialog che mi chiede se voglio concedere quella partita, indicando tipologia e giocatore/bot avversario
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
