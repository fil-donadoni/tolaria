Migliorare UI sideboard con /prototype. Card previews, possibilità di avere >60 carte nella main, miglioramento cta spostamento, visualizzazione a pile

Non so se sia un problema di UI o di fasi di gioco, ma mi chiede di scartare per hand size quando c'è scritto untap dell'avversario invece che nella mia cleanup

Flash of Insight non risulta castabile con flashback

Se premo space 2 volte troppo velocemente su declare attackers ricevo un 500 e il gioco si blocca finché non refresho la pagina

Se ho una terra che aggiunge 2 mana (1 blu e uno verde) e casto un artefatto costo 1, non mi fa scegliere quale mana usare

Carte cubo da creare:
Atraxa
Sin
Doomsday
Thassa's Oracle
Bowmaster
The one ring
Emrakul
Craterhoof
Ocelot Pride
Jacked Rabbit
Gut
Laelia
Troll of Kazad-dum
Bitter Triumph
Pyrogoyf
Minsc&Boo
Skullclamp
Nadu
Lightning Greaves
Springheart Nantuko
Mox Opal
Teferino
Teferone
Fallen Shinobi
Lurrus
Lutri
Grist
Necromancy
Fable of the mirror-breaker

Enduring renewal non mostra l'intero oracle text in card-preview, e anche Icetill Explorer. Cerca altri casi simili e risolvi alla radice.

La seconda abilità di currency converter non mi mostra le carte esiliate con lei all'interno del dialog di scelta, non posso selezionare niente.

L'abilità di end step di sneak attack va sullo stack con l'immagine della carta intera, invece che con la full-art con sotto l'oracle text dell'abilità. Cerca tutti gli altri casi simili e risolvi alla radice.

L'abilità di Dark Confidant non ha bisogno del box di spostamento della carta, deve andare in mano per forza. viene rivelata automaticamente, spostata in mano e il controllore perde i punti vita. niente scelte, niente box intermedi.

bug ux: Lion Sash equipaggiato su una creatura non può più attivare le sue abilità, né reconfigure né exile from graveyard. Questo accade anche con le aure (Chromatic armor per esempio).

Il bot cerca di tappare per mana un everflowing chalice senza counters e continua a fallire nel castare una spell, rinunciando.

Earthbend: manca la parte di abilità che ritorna le terre animate in gioco quando muoiono. Non è scritto nell'oracle text della card-preview e non avviene nel gameplay.

UI scelta Satyr Wayfinder non deve mostrare la library: deve solo selezionare una carta in una pila di 4, filtrata secondo le sue regole, e alla selezione la manda in mano. non serve la ui tipo Scry.

UI scelta di Narset, parter of veils deve separare la mano dal top della library, ora è visivamente confuso dove si mette la carta che si trascina a destra.

nelle pile di permanenti uguali sul board, l'indicatore xN deve comparire solo da 5 in su e deve avere del margin top per non creare confusione sovrapponendosi a carte del livello superiore

manca il token golem di sandtorm salvager e lo spirit di staff of the storyteller e la beast di garruk wildspeaker. verifica quali altri token mancano, importali e fai in modo che non vengano più create carte con token mancanti

staff of the storyteller non è stata implementata nella sua prima edizione ma in una ristampa. correggi, trova altri casi simili e fai in modo che non ricapiti.

la triggered ability di forth eorlingas in pila non mostra card-preview con oracle dell'abilita', ma la carta intera. correggi, trova casi simili e fai in modo che non ricapiti.

Metallic rebuke non risulta castabile se ho 2 terre stappate e degli artefatti stappati. nel conteggio di castabilità non vengono considerati gli artefatti tappabili, quando una carta ha improvise.

Phelia deve esiliare mostrando la carta sotto di lei, come farebbe banishing light o simile. Anche Dauthi voidwalker. Per voidwalker la UI non permette nemmeno di selezionare le carte in esilio con il void counter, quando lo sacrifichi. bug.

Bug quando provo ad attivare l'abilità di Harvester of misery:
installHook.js:1 [CONVEX M(game:selectTarget)] [Request ID: 6efb7360d6a7c912] Server Error
Uncaught Error: Ability source not on battlefield
at finalizeTargetSelection (../convex/game.ts:4011:64)
at advanceTargetGroupOrFinalize (../convex/game.ts:3776:0)
at handler (../convex/game.ts:7608:12)

Le frecce di target di Arc mage sono sbagliate. Ho targettato una creature e un giocatore, vedo una freccia dalla creatura primo bersaglio al giocatore secondo bersaglio invece di 2 frecce che partono da arc mage e vanno verso la creatura e il giocatore

Non si vedono da nessuna parte gli emblemi (Sorin, per esempio, anche se il +1/+0 viene applicato alle creature)

Le creature distrutte dall'ultimate di Sorin, Lord of Innistrad non tornano sul battlefield, rimangono nel cimitero.

Il may cast di Malcolm è solo nel momento della risoluzione dell'abilità, non nel resto del turno. verifica sul CR.
