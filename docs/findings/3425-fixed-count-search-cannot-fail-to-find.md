---
title: A typed Library Tutor cannot express a deliberate CR 701.23b fail-to-find
discoveredBy: 3425
status: triaged
issue: 3437
confidence: high
---

**What is wrong.** CR 701.23b — "if a player is searching a hidden zone for
cards with a stated quality … that player isn't required to find some or all of
those cards even if they're present in that zone" — is not modelled for a
Library Tutor whose search names a quality but declares a fixed count. The
picker demands that many cards whenever the Library holds them, so the searcher
cannot decline a card they can see.

**Evidence.** A genuine `search-library` choice passes its declared count
straight through, and the submit validator rejects a submission shorter than the
choice's minimum; the engine lowers the prompt to a 0-pick one only when the
filter matches NOTHING, purely to preserve the CR 701.23a look. Twenty shipped
Ops are in the affected shape — all nine fetchlands, Prismatic Vista, Fabled
Passage, Terminal Moraine, Expedition Map, Tinker, Natural Order, Captain Sisay,
Urza's Saga, Tezzeret Cruel Captain, Formidable Speaker — plus Lobotomy, whose
minimum equals its maximum although CR 701.23b's own Splinter example says the
player may find fewer.

Declining carries no verification burden, which is why the engine only has to
permit it: CR 701.23e leaves found cards unrevealed unless the effect says
otherwise, so no opponent can check the claim. Issue #3425's public
fail-to-find announcement is the whole — deliberately unprovable — signal.

**The scope is narrower than it first looks.** Seven shipped Ops declare NO
filter and a fixed count (Demonic Tutor, Entomb, Intuition, Wishclaw Talisman,
Diabolic Intent, Manipulate Fate, Planar Portal) and are CORRECT as written: CR
701.23d makes a search for a bare quantity mandatory. A blanket flip of every
fixed count would introduce a new bug, which is what raised this from a sweep to
a rule — the minimum is DERIVABLE from whether a quality is stated, so it
belongs in the engine with a guard rather than in 20 hand-edited definitions.
