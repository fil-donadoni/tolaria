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

Bug carte:

- chrome mox: il counter I\* non è chiaro come interfaccia, e la carta imprintata deve essere attaccata a lui, stile banishing light. questo vale per tutte le carte con imprint.
- Flash of Insight non risulta castabile con flashback
- Enduring renewal non mostra l'intero oracle text in card-preview, e anche Icetill Explorer. Cerca altri casi simili e risolvi alla radice.
- La seconda abilità di currency converter non mi mostra le carte esiliate con lei all'interno del dialog di scelta, non posso selezionare niente.
- L'abilità di Dark Confidant non ha bisogno del box di spostamento della carta, deve andare in mano per forza. viene rivelata automaticamente, spostata in mano e il controllore perde i punti vita. niente scelte, niente box intermedi.
- bug ux: Lion Sash equipaggiato su una creatura non può più attivare le sue abilità, né reconfigure né exile from graveyard. Questo accade anche con le aure (Chromatic armor per esempio).
- Earthbend: manca la parte di abilità che ritorna le terre animate in gioco quando muoiono. Non è scritto nell'oracle text della card-preview e non avviene nel gameplay.
- manca il token golem di sandtorm salvager e lo spirit di staff of the storyteller e la beast di garruk wildspeaker e human di torsten. verifica quali altri token mancano, importali e fai in modo che non vengano più create carte con token mancanti
- staff of the storyteller non è stata implementata nella sua prima edizione ma in una ristampa. correggi, trova altri casi simili e fai in modo che non ricapiti.
- Le frecce di target di Arc mage sono sbagliate. Ho targettato una creature e un giocatore, vedo una freccia dalla creatura primo bersaglio al giocatore secondo bersaglio invece di 2 frecce che partono da arc mage e vanno verso la creatura e il giocatore
- Le creature distrutte dall'ultimate di Sorin, Lord of Innistrad non tornano sul battlefield, rimangono nel cimitero.
- Il may cast di Malcolm è solo nel momento della risoluzione dell'abilità, non nel resto del turno. verifica sul CR./

Bug gameplay:

- Non so se sia un problema di UI o di fasi di gioco, ma mi chiede di scartare per hand size quando c'è scritto untap dell'avversario invece che nella mia cleanup
- Se premo space 2 volte troppo velocemente su declare attackers ricevo un 500 e il gioco si blocca finché non refresho la pagina

Nuova UI:

- lo stack non mostra le frecce che attraversano il board tra carta/abilità in stack e bersagli. il badge con scritto il bersaglio non è assolutamente utile.
- Non c'è modo di vedere Printed Card nel card-preview
- Dialog sideboard fa flicker quando la card-preview ha un testo molto lungo, deve avere altezza generalmente maggiore ma anche adattabile con overflow scroll verticale
- i loyalty counters dei planeswalker devono stare sopra l'svg planeswalker, a forma di scudo loyalty
- la schermata di game over ha delle scrollbar che compaiono a tratti, molto strano. e manca il pulsante back to lobby
- le carte in esilio e graveyard non hanno le animazioni di quelle sul battlefield e nella mano. uniforma l'interazione, anche a quelle nelle pile dei dialog

Bug bot:

- casta wild growth su terra avversaria
- cerca di tappare per mana un everflowing chalice senza counters e continua a fallire nel castare una spell, rinunciando.
