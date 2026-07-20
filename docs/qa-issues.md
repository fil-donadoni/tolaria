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

L'abilità di Dark Confidant non ha bisogno del box di spostamento della carta, deve andare in mano per forza. viene rivelata automaticamente, spostata in mano e il controllore perde i punti vita. niente scelte, niente box intermedi.

bug ux: Lion Sash equipaggiato su una creatura non può più attivare le sue abilità, né reconfigure né exile from graveyard. Questo accade anche con le aure (Chromatic armor per esempio).

Il bot cerca di tappare per mana un everflowing chalice senza counters e continua a fallire nel castare una spell, rinunciando.

Earthbend: manca la parte di abilità che ritorna le terre animate in gioco quando muoiono. Non è scritto nell'oracle text della card-preview e non avviene nel gameplay.

manca il token golem di sandtorm salvager e lo spirit di staff of the storyteller e la beast di garruk wildspeaker. verifica quali altri token mancano, importali e fai in modo che non vengano più create carte con token mancanti

staff of the storyteller non è stata implementata nella sua prima edizione ma in una ristampa. correggi, trova altri casi simili e fai in modo che non ricapiti.

la triggered ability di forth eorlingas in pila non mostra card-preview con oracle dell'abilita', ma la carta intera. correggi, trova casi simili e fai in modo che non ricapiti.

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

Urza's Bauble: quando risolve l'abilità non viene mostrata nessuna carta e non rimane nemmeno visibile dalla mano successivamente.

bug counter di dauthi voidwalker:
Cosa succede al segnalino void
I segnalini esistono solo sul campo o in esilio: Per regola del gioco, i segnalini (come i segnalini void, +1/+1 o tempo) possono esistere solo sugli oggetti in determinate zone.
Il cambio di zona cancella i segnalini: Quando attivi l'abilità del Dauthi Voidwalker e lanci la carta esiliata, quella carta si sposta dall'esilio alla pila (stack).
Rimozione immediata: Nel momento esatto in cui la carta cambia zona ed entra in pila, cessa di essere un "oggetto in esilio" e perde immediatamente il segnalino void.
