# Combo Corpus

`corpus.json` is the projection of the [Commander Spellbook](https://commanderspellbook.com)
combo database onto the catalogue: every combo whose pieces are all cards the
engine has (ADR 0164). **The combo data is Commander Spellbook's work**, credited
here and in the file's `source` block. Nothing here is written by hand.

## Usage terms

Commander Spellbook publishes no licence for its data (its code is MIT) and asks
for two things, which this import keeps:

- **Credit**: name Commander Spellbook and link the site wherever the data shows.
- **Sparse requests**: the import identifies itself in the User-Agent, downloads
  the bulk export once per run and never touches the REST API. It runs only when
  someone types the command: no gate, `build`, `dev` or `worktree:init` reaches
  it (`scripts/__tests__/combo-corpus-seam.test.ts`).

## Regenerating

```bash
bun run combos:import                  # downloads the export (~730 MB)
bun run combos:import --from <path>    # reads a local copy of it
```

The command prints the counts, also stored in the file. Combos are sorted by id,
one per line, so a re-import reads as a diff of added, removed and changed combos.

## What is kept

A variant is kept when its `status` is `OK`, every piece's oracle id is in
`data/card-index.json`, it has no template piece (`requires`), and it has at most
four pieces. Rules: `scripts/lib/combo-corpus.ts`.

Each piece has its name, oracle id, `zones` (Spellbook letters, any one of which
satisfies it: `H`and, `B`attlefield, `G`raveyard, `E`xile, `L`ibrary, `C`ommand),
`quantity`, and a `state` when the combo needs more than the zone.

## Who may read it

Scripts only. Nothing under `convex/` or `src/` may reach this file, and the same
test enforces that: a Bot seam reads only the derived `executable.json`, which the
Combo Census writes (ADR 0164 §§ 1, 3).
