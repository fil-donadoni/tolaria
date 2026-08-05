# Registering the debug scenario a receipt carried

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

Entered only when a receipt carries a `scenario`. A headless subagent has never loaded one, so what it
emits is the shape it IMAGINED — this file is why you check it rather than register it.

---

**Expect the emitted spec to be wrong and check it.** A headless subagent never loads a scenario, so it writes the shape it _imagines_ — a plausible-looking `{deckId, hand, battlefield}` when the validator wants `{cards: [{name, owner, zone, count}], phase, landCount}` (observed). The mutation rejects it with the full expected validator in the error, which is the fastest way to learn the real shape; fix and re-run rather than handing the failure back.

**Then check it exercises the feature.** A scenario that loads is not a scenario that demonstrates anything — the emitted one used a 1-mana spell to show off _batched_ multi-land payment, which taps exactly one land. Re-pick the cards yourself against the actual mechanic, and verify every card name resolves in the catalogue (`grep -rn 'name: "…"' convex/cards/sets/`) before registering.
