# Carte cubo da creare

Sin
Doomsday
Thassa's Oracle
Bowmaster
The one ring
Emrakul
Craterhoof
Jacked Rabbit
Gut
Laelia
Troll of Kazad-dum
Bitter Triumph
Broadside Bombardiers
Nadu
Lightning Greaves
Springheart Nantuko
Mox Diamond
Teferone
Fallen Shinobi
Grist
Necromancy
Fable of the mirror-breaker

# Bug carte

## Carte rotte

- Urborg con terra base genera un errore:
  react-Dhe7adbX.js?v=51f81d6d:2182 Uncaught (in promise) Error: [CONVEX M(game:autoTapForPayment)] [Request ID: 84f6a0d7aee0734c] Server Error
  Uncaught Error: Must choose a mana color
  at tapSourceIntoPayment (../../convex/game.ts:1014:25)
  at handler (../../convex/game.ts:6997:16)

    Called by client
    at tapSourceIntoPayment (../../convex/game.ts:1014:25)
    at handler (../../convex/game.ts:6997:16)

    Called by client
    at BaseConvexClient.mutation (http://localhost:5173/node_modules/.vite/deps/react-Dhe7adbX.js?v=51f81d6d:2182:10)

- Wishclaw talisman: c'è scritto che entra con 3 counters, non è un'abilita' attivata. verifica se ci sono altri casi di carte con questo testo e questo bug e sistema alla radice. Inoltre l'attivazione prevede un timing che va esteso alla UI, non mostrare la possibilità di attivazione tramite context menu se non sono nel mio turno. anche questo comportamento va esteso a tutte le carte con limitazioni di tempo, come regola generale.
- Starting town non viene considerata come produttrice di mana colorato ai fini di castabilità
- Erode permette di prendere terre non base con tipo di terra base, ma deve farti prendere SOLO terre base. anche path to exile.
- Il bot non so come puo' cercare di attivare cycling di un trioma già sul battlefield. Non deve essere un'opzione valida, per il giocatore reale non lo è tramite UI ma perché il bot la vede come possiblità?
- Memory lapse mette la carta in una posizione nota, quindi quella carta deve risultare rivelata a tutti nella library
- Karakas mostra come target validi le creature non leggendarie e poi genera un errore quando le selezioni. deve validare client-side e dare il ring solo a chi corrisponde al filtro dei candidati reali

## UX da migliorare

- quando c'è il dialog di conferma auto-tap, in qualche modo space può essere interpretato come cambio fase invece che come conferma di auto-tap. forse race condition, ma può rovinare un turno.
- Arch lightning sullo stack, mentre targetta 2 creature e un giocatore, mostra solo la freccia verso il giocatore
- Le frecce di target di Arc mage sono sbagliate. Ho targettato una creature e un giocatore, vedo una freccia dalla creatura primo bersaglio al giocatore secondo bersaglio invece di 2 frecce che partono da arc mage e vanno verso la creatura e il giocatore
- staff of the storyteller non è stata implementata nella sua prima edizione ma in una ristampa. correggi, trova altri casi simili e fai in modo che non ricapiti.
- chrome mox: il counter I\* non è chiaro come interfaccia, e la carta imprintata deve essere attaccata a lui, stile banishing light. questo vale per tutte le carte con imprint.
- La zona companion mostra la carta croppata, non ha il formato e le dimensioni corrette. deve essere uguale all'emblema, come formato e dimensioni.
- quando scegli carte da una pile e c'è un filtro attivo, come in Inquisition of Kozilek, stai correttamente mettendo il ring intorno alle valide. mettile anche tutte in prima posizione, come fatto per la ricerca nel grimorio con filtro (es. fetchlands)
- se cerco nel grimorio con filtro e non ci sono risultati validi, devo comunque vedere il grimorio con tutte le carte disattivate e poi mischiare.
- Goblin artisans: abbiamo perso l'animazione del coin toss che prima c'era.
- le abilità loyalty di un planeswalker non devono comparire nel context menu se siamo in una fase non sorcery speed, a meno di abilità che le abilitano a questa velocità.
- Chromatic armor non mostra il colore attualmente attivo nell'oracle text live
- premere space dopo aver dichiarato almeno un attaccante corrisponde a Confirm attacks, non ad Attack with all

# Bug gameplay

# Bug bot

- casta wild growth su terra avversaria
- cerca di tappare per mana un everflowing chalice senza counters e continua a fallire nel castare una spell, rinunciando.
- continua a castare vision charm con la mode di cambio tipo terra base, senza motivo
- casta flash of insight con X = 0, inutile
- casta sheoldred's edict senza alcuna creatura o planeswalker sul mio board
- casta damnation su board vuoto
- casta chrome mox e non imprinta nessuna carta
- attiva mother of runes a sorcery speed senza motivo
