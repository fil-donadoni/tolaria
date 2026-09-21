# Nome ufficiale del prodotto

Stato al 2026-09-21: **nessuna scelta fatta.** Cinque finalisti, criteri
stabilizzati, verifiche di disponibilità eseguite.

## Perché Tolaria va sostituito

`Tolaria` è un piano della lore di Magic, quindi proprietà almeno derivata di
Wizards of the Coast, e _Tolarian Community College_ è un canale YouTube molto
noto nello stesso spazio. Va sostituito prima del rilascio.

Va ritirato anche il dominio attuale, un sottodominio del sito personale
dell'autore: nato come portfolio per una candidatura in Wizards, troppo
personale per un prodotto pubblico.

Il nome cercato deve essere inequivocabilmente associabile a Magic ma non
soggetto a copyright, e deve rimandare alla **lore** più che alle meccaniche. Il
progetto è personale e rivolto a giocatori: la robustezza legale da
multinazionale non serve.

## I criteri

Non dichiarati a priori — emersi scartando nomi. Si applicano come filtri, in
quest'ordine.

1. **La regola del canale.** Non «esiste un omonimo?» né «è un concorrente?», ma
   **«condivide un canale con me?»** — GitHub, prima pagina di Google, package
   manager, store, spazio di ricerca del gaming. Un adesivo industriale 3M
   chiamato Fastbond vive su un altro pianeta ed è irrilevante; un progetto open
   source da 7.900 stelle chiamato Snapcast vive nel canale identico e
   squalifica il nome. È il criterio che ha deciso più esclusioni di tutte.
2. **Eco di una carta, mai la carta intera.** Meglio un frammento (Shadowmage da
   Shadowmage Infiltrator) o una contrazione da tavolo (Snapmage da Snapcaster
   Mage).
3. **Nessun significato forte fuori da Magic.** È il difetto che ha ucciso
   _Scoop_, _Brain Freeze_ e _Tinker_. Un nome che fuori dal gioco non significa
   nulla — _Goyf_, _Sligh_, _Rhystic_ — batte uno bello ma ambiguo.
4. **Lore, non meccaniche.** I termini di regolamento sono stati rifiutati in
   blocco, e così il registro accademico greco-latino: «troppo distanti da
   Magic».
5. **Pronuncia e grafia per un italiano.** Bocciano: il gruppo `th` (Thran,
   Dauthi), la terminazione `-ngue` (Flametongue), l'iniziale `rh-` non
   deducibile dal suono (Rhystic si pronuncia _RIS-tik_). Promuovono: due
   sillabe, vocali aperte, grafia fonetica.
6. **Una parola sola**, preferibilmente. Non assoluto — _Rhystic Petal_ era
   stato accettato — ma i monoparola sono sempre risaliti.
7. **Deve reggere la dettatura a voce.** Un domain hack come `shadowma.ge` fa
   sorridere ma si perde al telefono: va affiancato da un dominio normale.

## I cinque finalisti

Disponibilità verificata il 2026-09-21.

| Nome           | Origine                        | `.io`  | `.gg`          | `.com`     | `.cards` | hack                 | GitHub     |
| -------------- | ------------------------------ | ------ | -------------- | ---------- | -------- | -------------------- | ---------- |
| **Shadowmage** | Shadowmage Infiltrator         | libero | libero         | in vendita | libero   | `shadowma.ge` libero | occupato   |
| **Voidwalk**   | Dauthi Voidwalker              | libero | **registrato** | registrato | libero   | impossibile          | occupato   |
| **Twincast**   | Twincast (M11)                 | libero | libero         | registrato | libero   | —                    | occupato   |
| **Snapmage**   | contrazione di Snapcaster Mage | libero | libero         | registrato | libero   | `snapma.ge` libero   | **libero** |
| **Fastbond**   | Fastbond (Alpha)               | libero | libero         | in vendita | libero   | —                    | occupato   |

Metodo riproducibile: `whois` sul dominio più `dig +short NS` come controprova —
il solo DNS non basta, un dominio può essere registrato senza essere delegato.
Handle GitHub via `https://api.github.com/users/<handle>` (404 = libero).

Cosa dice la tabella:

- **Snapmage è l'unico con l'en plein**, handle GitHub compreso, ed è anche
  l'unico che concilia due cose piaciute separatamente: il suono `snap-` di
  Snapcast e la famiglia `-mage`.
- **Voidwalk è il più debole sul piano pratico** pur essendo il primo piaciuto:
  `.gg` registrato e delegato a Cloudflare, nessun hack possibile perché `.k`
  non esiste come estensione, e _Voidwalker_ è il demone evocabile dallo
  stregone in World of Warcraft.
- Gli handle GitHub occupati non sono bloccanti: il repository vive sotto
  l'account personale. L'handle nudo serve solo per un'organizzazione.
- I due `.com` «in vendita» stanno su pagine di broker: comprabili, tipicamente
  fra 1.000 e 5.000 dollari, non necessari per partire.

## Già scartati — non riproporre

Intere famiglie cadute:

- **Termini di regolamento e gergo** (Upkeep, Draw-Go, Cantrip, Untap, Mulligan,
  Sideboard, Durdle, Mise, Topdeck): meccaniche, non lore.
- **Registro accademico greco-latino** (Scriptorium, Palimpsest, Athenaeum,
  Vellum, Lyceum, Arcanum, Grimoire).
- **Composti tech-brandable** (Cardwright, Rulesmith, Spellstack, Tapstone,
  Resolvr, Rulebound).
- **Nomi con `mana-`**: veto esplicito, troppi prodotti esistenti (Manabox,
  Manastack). Vale anche per Manabond e Manaverse.
- **Artefatti e luoghi generici** (Lotus, Chalice, Reliquary, Cabal, Spire).

Nomi singoli caduti per collisione di canale:

| Nome        | Perché                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Snapcast    | progetto open source audio multiroom, 7.882 stelle, attivo, org `snapcast` occupata            |
| Snapkeep    | app _SnapKeep — Photo Cleaner_ attiva su App Store, più società omonima su Crunchbase          |
| Flametongue | _Flametongue Weapon_ è un'abilità da sciamano in World of Warcraft dal 2004, più grafia ostica |
| Voidwalker  | demone evocabile in World of Warcraft                                                          |
| Leyline     | `.io` e `.gg` entrambi registrati, esiste un'organizzazione esports                            |
| Tinker      | eroe di Dota 2                                                                                 |
| Morphling   | eroe di Dota 2                                                                                 |
| Oracle      | termine WotC _e_ Oracle Corporation                                                            |
| Forge       | client MTG già esistente                                                                       |

Altri bocciati: Serra (in italiano significa _greenhouse_, più nome proprio
della lore WotC), Brain Freeze (idioma universale), Sneak Attack (meccanica base
di D&D), Blood Moon (termine astronomico), Daze, Upheaval (generici), Talaria
(legge come derivato di Tolaria).

Sopravvissuti non finalisti, utili se la terna finale cade: Kavu, Wurmcoil,
Glimmervoid, Voidmage, Rhystic Petal, Vesuvan Petal, Dauthi Petal, Forkbomb,
Riftwalk, Braingeyser, Goyf, Sligh.

## Prossimi passi

1. **Controllo marchi** su Shadowmage, Twincast, Snapmage: USPTO (TESS) ed EUIPO
   (eSearch plus), classi 9 e 41, sul nome nudo e non sul dominio. Per
   Shadowmage l'unico riscontro noto è _The Gates of the Shadowmage_, modulo
   d'avventura per Fantasy Grounds — altro canale, irrilevante.
2. **Handle social**: Bluesky, Discord, Reddit, X. Un nome libero ovunque tranne
   dove i giocatori stanno davvero vale meno di uno con il `.com` occupato.
3. **Decidere la coppia nome-dominio**: il domain hack come vanity URL e un
   `.io` o `.cards` accanto come dominio canonico da dettare e da mettere nel
   README.
4. **Lavoro a valle, mai discusso.** Il rename tocca molto più del dominio: il
   nome `tolaria` è nel nome del repository, in `tolaria.config.json`, nei
   prefissi delle variabili d'ambiente (`TOLARIA_ALLOW_MAIN_EDIT`,
   `TOLARIA_VITEST_WORKERS`, `TOLARIA_ALLOW_FULL_SUITE`,
   `TOLARIA_ALLOW_MANUAL_MERGE`) e nella documentazione. Va deciso **se**
   rinominare il codice o solo il prodotto pubblico: il motore interno può
   continuare a chiamarsi Tolaria. Se si rinomina, serve un ticket dedicato e
   probabilmente un ADR, visto quante invarianti citano il nome.
