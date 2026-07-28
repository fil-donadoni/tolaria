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

- Ragavan ti permette solo di castare le spell in esilio, non deve lasciarti giocare terre
- Teferi time raveler permette di castare sorcery nel turno avversario anche senza aver fatto il +1 (thoughtseize nell'esempio)
- Sylvan library non ti permette di mettere carte in cima al grimorio, e dovrebbe farti scegliere solo tra quelle pescate.
- Emry non ti lascia attivare la sua abilità nemmeno nel timing consentito e con artefatti al cimitero.
- Backup non dà le abilità alla creatura bersaglio ma solo il counter +1/+1
- Wishclaw talisman: c'è scritto che entra con 3 counters, non è un'abilita' attivata. verifica se ci sono altri casi di carte con questo testo e questo bug e sistema alla radice. Inoltre l'attivazione prevede un timing che va esteso alla UI, non mostrare la possibilità di attivazione tramite context menu se non sono nel mio turno. anche questo comportamento va esteso a tutte le carte con limitazioni di tempo, come regola generale.
- Starting town non viene considerata come produttrice di mana colorato ai fini di castabilità
- Memory lapse mette la carta in una posizione nota, quindi quella carta deve risultare rivelata a tutti nella library
- Karakas mostra come target validi le creature non leggendarie e poi genera un errore quando le selezioni. deve validare client-side e dare il ring solo a chi corrisponde al filtro dei candidati reali
- Seer's vision si rompe nel momento della scelta della carta da scartare, deve mostrare il dialog stile Thoughtseize e invece non mostra niente e non si può scegliere la carta. game bloccato

## UX da migliorare

- non si vede visivamente quando una carta ha summoning sickness. è semi-trasparente solo durante il combat, serve un segnale persistente per tutto il turno
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
- In dichiarazione attaccanti, premere space dopo aver dichiarato almeno un attaccante deve corrispondere a "Confirm attacks", non ad "Attack with all". "Attack with all" resta il comportamento di space solo quando non è stato dichiarato nessun attaccante.
- la choice di Barrin's Spite deve far cliccare su una card instance specifica, se è testuale non è chiaro quale sia la prima e quale la seconda. e quella che torna in mano deve risultare rivelata
- Lobotomy: la ricerca nelle altre zone deve essere esplicita e manuale, permette al giocatore di vedere la library avversaria. ora stai automatizzando e togli questa possibilità di visualizzazione.
- le abilità attivate senza target validi non devono comparire nel context menu (es. un equipment senza creature sul board)
- la seconda abilità triggered di Inti non ha l'oracle text quando la metti in pila
- la scelta modale di lorehold charm deve chiudersi dopo aver selezionato la modalità. se scelgo la seconda mi si apre subito il dialog del cimitero ma la scelta rimane li' e confonde, perche' e' gia' stata fatta

# Bug gameplay

- gli scenari che specificano carte nella library non funzionano, mi ritrovo sempre e solo terre base nella libraryi invece delle carte indicate.

# Bug bot

- casta wild growth su terra avversaria
- cerca di tappare per mana un everflowing chalice senza counters e continua a fallire nel castare una spell, rinunciando.
- continua a castare vision charm con la mode di cambio tipo terra base, senza motivo
- casta flash of insight con X = 0, inutile
- casta sheoldred's edict senza alcuna creatura o planeswalker sul mio board
- casta damnation su board vuoto
- casta chrome mox e non imprinta nessuna carta
- attiva mother of runes a sorcery speed senza motivo
- attiva sandstorm salvager senza token sul board
