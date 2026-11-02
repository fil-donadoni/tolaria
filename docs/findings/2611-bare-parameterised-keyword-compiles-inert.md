---
title: A bare parameterised keyword name ("Mobilize", "Fading", "Annihilator") compiles `ready` and does nothing
discoveredBy: 2611
status: draft
confidence: medium
---

**What is wrong.** The keyword-line vocabulary (`convex/oracle/grammar/shared/keywordVocabulary.ts`)
admits every `keyword-ability` registry row by its bare `name`, including rows
whose `bindingPattern` requires a parameter (`/^mobilize \d+$/`,
`/^annihilator \d+$/`, fading). A line reading just "Mobilize" therefore
compiles `ready` to `staticAbilities: ["mobilize"]`, which no ADR 0054 expander
reads — an inert keyword shipped as ready. The keyword-line header promises
the opposite ("parameterised keywords stay out … the card is `unparsed`").

**Evidence.** `compileCard(oracleCard({ oracleText: "Mobilize" }))` →
`state: "ready"`, `staticAbilities: ["mobilize"]`; same for "Fading" and
"Annihilator" (checked in issue #2611's worktree).

**Why it may not deserve its own issue.** No corpus card prints a bare
parameterised keyword, so nothing in the lockfile is affected today; the fix
(skip a row from the bare vocabulary when its `bindingPattern` rejects the bare
spelling) is a few lines but touches every grammar that reads the vocabulary.
