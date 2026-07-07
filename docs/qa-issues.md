# QA Issues — triage log

Tutte le osservazioni raccolte il 2026-07-07 sono state smistate. Nuove
osservazioni QA vanno aggiunte in fondo; una volta smistate, spostarle qui.

## Risolte in-place (fix applicati su questo branch)

- Doppio click su terra per pagare un costo → `Source became tapped during
payment`: ora drop silenzioso (misclick). `convex/game.ts`
  (`tryAutoCommitPendingActivation`) + test in `payment-priority-guard.test.ts`.
- Passare priorità quando non ce l'hai → errore ADR 0047: ora no-op silenzioso.
  `convex/game.ts` (`passPriority`).
- Dance of the Dead: prompt mostrava `{1}{b}` come testo → ora simboli mana SVG.
  `src/components/board/pending-choice-prompt.tsx` (`formatOracleText`).
- Box scelta mana non si chiudeva premendo auto-tap → si chiude alla fine del
  pagamento. `src/hooks/useBattlefieldInteraction.tsx`.

## Aperte come GitHub issue (fil-donadoni/tolaria)

- #938 — bot casta Copy Artifact/Clone senza sorgente da copiare
- #939 — abilità con costo di sacrificio mostrano il dialog mana auto-tap
- #940 — costo may-pay di sacrificio auto-seleziona il permanente (Witherbloom Charm)
- #941 — token creati (Elemental di Titania, Spirit) senza immagine Scryfall
- #942 — dialog "guarda le prime N carte" mostra tutta la library o niente (Stock Up, Preordain)
- #943 — artefatti che si sacrificano per mana non triggerano il trigger di morte/cimitero (Chromatic Star)
- #944 — costo addizionale non pagabile fa crashare il cast (Natural Order)
- #945 — carta cercata non rivelata all'avversario (Spellseeker)
- #946 — permesso play-from-exile non scade e blocca le terre (Headliner Scarlett)
- #947 — abilità di mana offerta quando `canActivate` è false (Chrome Mox)
- #948 — painland tappata per mana colorato non fa perdere vita/danno
