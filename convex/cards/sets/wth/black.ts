// wth — black cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";

// Doomsday — {B}{B}{B} Sorcery. "Search your library and graveyard for five
// cards and exile the rest. Put the chosen cards on top of your library in any
// order. You lose half your life, rounded up."
//
// protocol card: three DEPENDENT player decisions in one resolution, each
// consuming the previous one's result. (1) The graveyard pick's COUNT is fixed
// by how many cards the library pick found. (2) The exile sweep is the
// COMPLEMENT of both picks — "everything not chosen", which no `moveZone`
// shape expresses (its filter-driven `fromZones` sweep matches on
// characteristics, never on "is not in this choice's result"). (3) The final
// ordering choice's ORDER feeds back into a library-order call — the
// reorder-FROM-choice gap the `libraryLook` registry row names by card
// (convex/cards/mechanicsRegistry.ts: "reads an opaque choice result back into
// reorderLibraryTop … stays a planned backlog Op until a choice-driven reorder
// construct exists"). The Effect Script's four frozen constructs
// (bind/ref/if/forEach) express none of the three linkages, so this is the
// sanctioned escape hatch, not a missing-Op stop-and-issue.
//
// Composed from EXISTING SpellContext primitives only — no new Op, no new
// PendingChoice kind, no new EffectValue, no new UI reducer (Primitive Reuse):
// `requestChoice({kind:"search-library"})` + `requestChoice({kind:"choose-
// graveyard-card"})` + `moveCardById` + `requestChoice({kind:"reorder-
// library"})` + `putLibraryCardsOnTop` + `getLife`/`loseLife`. This corrects
// the earlier stub note here, which read the card's three gaps as three
// missing Ops; they are three gaps in the DSL's CONTROL FLOW, and the
// primitives underneath them all already ship.
//
// "Search your library and graveyard" is offered as two sequential prompts
// (library, then graveyard) rather than one union-of-zones picker. That is a
// presentation split, not a rules split: the searcher looks at the whole
// library (CR 701.23a) and the graveyard is public (CR 400.2), so the chooser
// has complete information at the first prompt and every legal 5-card split
// across the two zones is reachable. The library prompt's min/max are clamped
// so the two picks always total five, or as many as exist (CR 701.23d — a
// search for a QUANTITY of cards must find that many).
export const doomsday: CardDefinition = {
    id: "5b3c6d87-9383-450b-bba5-33435b6b0d08",
    name: "Doomsday",
    rarity: "rare",
    manaCost: { B: 3 },
    types: ["Sorcery"],
    oracleText:
        "Search your library and graveyard for five cards and exile the rest. Put the chosen cards on top of your library in any order. You lose half your life, rounded up.",
    // AI valuation override (ADR 0018 / PRD #1423) — a scalar rather than an
    // `aiEffects` shadow script, because no Op sequence models what makes this
    // card good: its worth is entirely in the DECK it stacks, and the bot has
    // no combo-pile model to build one. Walked as a script it reads as pure
    // self-harm (library and graveyard exiled, half the life gone), which is
    // exactly what it IS for a player who cannot use the pile — so 0, the
    // floor: never worth casting, and first out on a discard.
    aiValue: 0,
    resolveSteps: [
        // Step 1 — search both zones for five cards (CR 701.23), then exile
        // the complement from both zones (CR 701.13a) and gather the kept
        // graveyard cards into the library ready for the ordering step.
        (ctx: SpellContext) => {
            const me = ctx.controller;
            const libIds = ctx.getLibraryCards(me).map((c) => c.id);
            const gyIds = ctx.getGraveyardCards(me).map((c) => c.id);
            // CR 701.23d — "five cards", a quantity with no stated quality, so
            // the searcher must find five (or as many as possible).
            const total = Math.min(5, libIds.length + gyIds.length);
            const libMax = Math.min(total, libIds.length);
            const libMin = Math.max(0, total - gyIds.length);

            // The library half is raised even with an empty library, matching
            // the interpreter's own `choice` Op convention (CR 701.23a — the
            // searcher is entitled to the LOOK, and any "whenever a player
            // searches a library" ability is entitled to its trigger, CR
            // 701.23f). An empty allow-list makes every card inert client-side.
            const libPicks = ctx.requestChoice({
                playerId: me,
                choiceId: "doomsday-library",
                kind: "search-library",
                zone: "library",
                isSearch: true,
                count: { min: libMin, max: libMax },
                ...(libIds.length === 0 ? { candidateIds: [] } : {}),
                prompt:
                    libMax === 0
                        ? "Doomsday: your library is empty."
                        : `Doomsday: choose ${libMin === libMax ? libMax : `${libMin}-${libMax}`} card(s) to keep from your library.`,
            });
            if (libPicks === undefined) return; // suspended on the search

            // The graveyard half takes exactly the balance of the five. It is
            // a public zone (CR 400.2), so eligibility is the snapshot taken
            // here, carried in `candidateIds` like every other graveyard pick.
            const gyCount = total - libPicks.length;
            let gyPicks: string[] = [];
            if (gyCount > 0) {
                const picked = ctx.requestChoice({
                    playerId: me,
                    choiceId: "doomsday-graveyard",
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    candidateIds: gyIds,
                    count: gyCount,
                    prompt: `Doomsday: choose ${gyCount} card(s) to keep from your graveyard.`,
                });
                if (picked === undefined) return; // suspended on the pick
                gyPicks = picked;
            }

            // CR 701.13a — "exile the rest": every card of BOTH searched zones
            // that was not chosen. Re-running this on a later replay of the
            // step is a no-op (`moveCardById` skips a card absent from `from`).
            const kept = new Set([...libPicks, ...gyPicks]);
            for (const id of libIds) {
                if (!kept.has(id)) ctx.moveCardById(me, id, "library", "exile");
            }
            for (const id of gyIds) {
                if (!kept.has(id)) {
                    ctx.moveCardById(me, id, "graveyard", "exile");
                }
            }
            // The kept graveyard cards join the library; the next step orders
            // the whole (now five-card) library.
            for (const id of gyPicks) {
                ctx.moveCardById(me, id, "graveyard", "library");
            }
        },
        // Step 2 — "Put the chosen cards on top of your library in any order"
        // (CR 401.4), then "You lose half your life, rounded up" (CR 119.3;
        // CR 107.1a — the effect states the rounding direction). A separate
        // resolve step so the exile sweep above is never replayed after it has
        // run: `resolveTopOfStack` checkpoints `resolutionStep` and resumes at
        // the suspended step, so step 1 only ever replays pre-mutation.
        (ctx: SpellContext) => {
            const me = ctx.controller;
            // After step 1 the library holds exactly the chosen cards.
            const remaining = ctx.getLibraryCards(me).map((c) => c.id);
            if (remaining.length > 1) {
                const ordered = ctx.requestChoice({
                    playerId: me,
                    choiceId: "doomsday-order",
                    kind: "reorder-library",
                    zone: "library",
                    candidateIds: remaining,
                    count: remaining.length,
                    prompt: "Doomsday: put the chosen cards on top of your library in any order.",
                });
                if (ordered === undefined) return; // suspended on the order
                ctx.putLibraryCardsOnTop(me, ordered);
            }
            // CR 119.3 — half the CURRENT life total, rounded up. Clamped at 0
            // so a caster already at or below 0 life never GAINS life here.
            ctx.loseLife(me, Math.max(0, Math.ceil(ctx.getLife(me) / 2)));
        },
    ],
};
