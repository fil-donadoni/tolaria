// Antiquities (ATQ) — the game's first artifact-centric expansion, split by
// colour per ADR 0043. Every entry is a new CardDefinition (ATQ has no
// reprints of already-implemented cards, so there are no CardPrint stubs).
// Modern Scryfall oracle text is authoritative (ADR 0004); the canonical
// card list, mana costs, and types are sourced from MTGJSON `ATQ.json`.
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`. Cards are classified by the colour identity of their mana
// cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type { CardDefinition, PermanentView, SpellContext } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Hurkyl's Recall — {1}{U} Instant. "Return all artifacts target player owns
// to their hand." Targets a player, then bounces every artifact that player
// owns (CR 701.10). `returnToHand` already routes each card to its OWNER's
// hand. Implementation note / divergence: `getBattlefieldIds(playerId, …)`
// enumerates artifacts on the TARGET PLAYER'S battlefield (i.e. those they
// control). For artifacts the target player owns but does NOT control (e.g.
// one stolen by an opponent via a control-change effect), this misses them,
// and it would wrongly bounce an artifact the target controls but another
// player owns. The current card pool has no artifact control-theft, so in
// practice owner == controller for artifacts; a strict owner-scoped
// enumeration would need a new engine query and is deferred (no engine change
// in this tranche).
export const hurkylsRecall: CardDefinition = {
    id: "f32373dd-06d8-45d1-8777-3b1411bcb30a",
    rarity: "rare",
    name: "Hurkyl's Recall",
    oracleText: "Return all artifacts target player owns to their hand.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const artifactIds = ctx.getBattlefieldIds(target.id, {
            types: "Artifact",
        });
        for (const id of artifactIds) {
            ctx.returnToHand({ type: "permanent", id });
        }
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Graveyard / library recursion & card-flow (free tranche, #275) — CR 400.7
// zone changes, CR 401 library order, CR 701.20 shuffle, CR 121.1 draw, CR
// 701.8 discard, CR 701.20b untap. Modern Scryfall oracle text is authoritative
// (ADR 0004); mana costs / type lines come from MTGJSON ATQ.json. Every effect
// composes existing SpellContext primitives (moveCardById, moveZone,
// shuffleLibrary, reorderLibraryTop, peekLibraryTop, drawCards, discardCard,
// untap) — no new primitive, no engine change.
// ─────────────────────────────────────────────────────────────────────────────

// Reconstruction — {U} Sorcery. "Return target artifact card from your
// graveyard to your hand." Twin of Regrowth (lea.ts) narrowed to artifacts via
// the graveyard-zone target filter (CR 400.7 — the graveyard card becomes a new
// object on the zone change). `type: "Artifact"` + `zone: "graveyard"` +
// `controller: "you"` scopes legal targets to artifact cards in the caster's
// own graveyard (rules.ts graveyard branch). `moveCardById` routes the picked
// card graveyard → hand.
export const reconstruction: CardDefinition = {
    id: "1aa2d27b-cc25-4baa-86f4-4db45b30e2a4",
    rarity: "common",
    name: "Reconstruction",
    oracleText: "Return target artifact card from your graveyard to your hand.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Artifact",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "graveyard-card" || !t.playerId) return;
        ctx.moveCardById(t.playerId, t.id, "graveyard", "hand");
    },
};

// Drafna's Restoration — {U} Sorcery. "Put any number of target artifact cards
// from target player's graveyard on top of their library in any order."
// (CR 601.2c variable target count, CR 400.7 zone change, CR 401 library
// order.) Targets one-or-more artifact graveyard cards (the engine's graveyard
// target branch already scopes to one player per card, and Antiquities' oracle
// reads "from a single graveyard"; `controller: "any"` lets the caster recur
// from any player's bin).
//
// Composition for "on top in any order" using existing primitives only: move
// every chosen card graveyard → library (they append to the BOTTOM, since
// moveCard pushes and drawCard reads index 0), then let the player order just
// those cards via a `reorder-library` choice gated by `candidateIds`, and
// finally `reorderLibraryTop` over the FULL library with the chosen cards first
// — placing them on top in the chosen order ahead of the pre-existing library.
export const drafnasRestoration: CardDefinition = {
    id: "4be2aa3b-207b-4d21-abfb-6788520c7676",
    rarity: "common",
    name: "Drafna's Restoration",
    oracleText:
        "Put any number of target artifact cards from target player's graveyard on top of their library in any order.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Artifact",
        count: { min: 1 },
        zone: "graveyard",
        controller: "any",
    },
    resolveSteps: [
        (ctx: SpellContext) => {
            const targets = ctx.targets.filter(
                (t) => t.type === "graveyard-card" && t.playerId
            );
            if (targets.length === 0) return;
            // All targeted cards come from a single graveyard (one owner).
            const ownerId = targets[0].playerId!;
            const movedIds: string[] = [];
            for (const t of targets) {
                if (t.playerId !== ownerId) continue;
                ctx.moveCardById(ownerId, t.id, "graveyard", "library");
                movedIds.push(t.id);
            }
            if (movedIds.length === 0) return;
            // Player orders the moved cards (first = top). The allow-list pins
            // the choice to exactly the cards just put into the library.
            const ordered = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "drafna-order",
                kind: "reorder-library",
                zone: "library",
                count: movedIds.length,
                zoneOwnerId: ownerId,
                candidateIds: movedIds,
                prompt: "Put these artifact cards on top in any order (first = top).",
            });
            if (!ordered) return;
            // Build the full library order: chosen cards first (top), then the
            // remainder of the library in its current order. peekLibraryTop with
            // a large N returns every id (slice clamps).
            const allIds = ctx.peekLibraryTop(ownerId, Number.MAX_SAFE_INTEGER);
            const orderedSet = new Set(ordered);
            const rest = allIds.filter((id) => !orderedSet.has(id));
            ctx.reorderLibraryTop(ownerId, [...ordered, ...rest]);
        },
    ],
};

// Sage of Lat-Nam — {1}{U} 1/2. "{T}, Sacrifice an artifact: Draw a card."
export const sageOfLatNam: CardDefinition = {
    id: "b4ff60ce-073c-46b8-807c-8b40467b960c",
    rarity: "common",
    name: "Sage of Lat-Nam",
    oracleText: "{T}, Sacrifice an artifact: Draw a card.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "sage-of-lat-nam-draw",
            oracleText: "{T}, Sacrifice an artifact: Draw a card.",
            cost: { tap: true, sacrificeFilter: { types: "Artifact" } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster J (#290) — activated-ability cost reduction. CR 601.2f models cost
// modification (reductions and increases) applied as the cost is calculated;
// 118.7 forbids a reduction from taking a cost below the floor its source
// declares. The `cost-modifier` static effect (originally increase-only, for
// Gloom) is extended with `costReduction` + `minTotalMana`: the engine reduces
// only the generic portion of a matching cost and clamps the post-reduction
// TOTAL mana up to the floor (colored pips are immovable). The effect's carrier
// permanent is passed to `appliesToAbility`, letting an Aura scope the modifier
// to its host. Modern Scryfall oracle text is authoritative (ADR 0004).
// ─────────────────────────────────────────────────────────────────────────────

// Power Artifact — {1}{U} Enchantment — Aura. "Enchant artifact. Enchanted
// artifact's activated abilities cost {2} less to activate. This effect can't
// reduce the mana in that cost to less than one mana." (CR 303.4 aura
// attachment, 601.2f cost reduction, 118.7 floor.) As with the other ATQ auras
// there is no `host` scope (ADR 0002): the `cost-modifier`'s `appliesToAbility`
// receives the Aura itself as `effectSource` and matches only abilities whose
// source is `effectSource.attachedTo`. The {2} reduction is generic-only and
// floored at one total mana, so a {T} mana ability like Mana Vault's
// "{T}: Add {C}{C}{C}" (no mana in its cost) is unaffected, "{3}: Untap" drops
// to {1}, and "{2}, {T}" drops to "{T}" only down to the one-mana floor.
export const powerArtifact: CardDefinition = {
    id: "e48bc89e-6da5-43da-b4e0-60d5f850199c",
    rarity: "uncommon",
    name: "Power Artifact",
    oracleText:
        "Enchant artifact\nEnchanted artifact's activated abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToAbility: (
                source: PermanentView,
                _ctx,
                effectSource?: PermanentView
            ) =>
                !!effectSource?.attachedTo &&
                effectSource.attachedTo === source.id,
            costReduction: { X: 2 },
            minTotalMana: 1,
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster N (#291) — grant a triggered ability to a filtered set. CR 113.1
// (granted abilities) + CR 611 (continuous effects): an anthem grants a
// triggered ability to every permanent matching a filter, continuously
// recomputed as permanents enter and leave. Modeled with a new
// `triggered-grant` static effect — the lord-style analogue of
// `activated-grant` for triggers. The granted trigger's template lives on the
// granting card's `triggeredGrantTemplates[]`; the grant is applied to current
// and future matching permanents via `applySourceStaticEffects` /
// `applyExistingGrantsTo` and reversed via `unapplySourceStaticEffects`, exactly
// like the keyword/activated grants. `effectiveTriggeredAbilities` unions the
// granted triggers into each recipient so the existing trigger collector and
// resolution lookup observe them as if printed on the recipient — no change to
// the scan loop itself. The granted trigger uses `scope: "your"`, whose
// `self.controllerId` is the artifact's controller (CR 603.6a "your upkeep"),
// and `ctx.sourceInstanceId` is the artifact ("sacrifice this artifact").
// ─────────────────────────────────────────────────────────────────────────────

/** CR 205 — true if `target` is an Artifact (Energy Flux's affected set). Reads
 *  the live `types` so an artifact animated by another effect still counts; the
 *  set is recomputed as artifacts enter/leave. */
const IS_ARTIFACT: (
    target: PermanentView,
    source: PermanentView,
    ctx: import("../../types").StaticEffectContext
) => boolean = (target) => target.types.includes("Artifact");

// Energy Flux — {2}{U} Enchantment. "All artifacts have 'At the beginning of
// your upkeep, sacrifice this artifact unless you pay {2}.'" (CR 113.1 granted
// ability + CR 611 continuous filtered set + CR 603.6a upkeep trigger + CR
// 118 mana payment.) The granted trigger is attached to every artifact (either
// player's) while Energy Flux is in play and detaches when it leaves; new
// artifacts entering afterwards receive it too. Each artifact's controller, at
// the start of their own upkeep, may pay {2} to keep it — otherwise it is
// sacrificed. Each artifact gets its own trigger on the stack, so the
// pay-or-sacrifice decision is independent per artifact (CR 603.3b).
export const energyFlux: CardDefinition = {
    id: "bd1f624b-e8f2-462f-838a-7cb9e8fda988",
    rarity: "uncommon",
    name: "Energy Flux",
    oracleText:
        'All artifacts have "At the beginning of your upkeep, sacrifice this artifact unless you pay {2}."',
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        // CR 113.1 / 611 — grant the upkeep trigger to every artifact.
        {
            kind: "triggered-grant",
            applies: IS_ARTIFACT,
            abilityId: "energy-flux-upkeep",
        },
    ],
    // The granted template lives here, NOT on `triggeredAbilities`, so Energy
    // Flux itself (an Enchantment, not an artifact) never fires it.
    triggeredGrantTemplates: [
        phaseTrigger({
            id: "energy-flux-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this artifact unless you pay {2}.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                // CR 118 — the artifact's controller may pay {2}; if they
                // don't (or can't), the artifact is sacrificed (CR 701.16).
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `energy-flux-${ctx.sourceInstanceId}`,
                    cost: { X: 2 },
                    prompt: "Pay {2} or sacrifice this artifact?",
                });
                if (paid === undefined) return; // suspended for the choice
                if (!paid) ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Library tutor → battlefield (ATQ cluster H, ADR 0027)
// ─────────────────────────────────────────────────────────────────────────────

// Transmute Artifact — {U}{U} Sorcery. "Sacrifice an artifact. If you do,
// search your library for an artifact card. If that card's mana value is less
// than or equal to the sacrificed artifact's mana value, put it onto the
// battlefield. If it's greater, you may pay {X}, where X is the difference. If
// you do, put it onto the battlefield. If you don't, put it into its owner's
// graveyard. Then shuffle." (CR 701.16 sacrifice, CR 701.19 search, CR 202.3
// mana value, CR 701.20 shuffle.)
//
// All board mutations run only after the LAST suspending choice (the search,
// or the optional pay-the-difference when it applies): a `resolveSteps` step
// re-runs from its top on every resume, so any mutation reached before a later
// suspend would fire twice. The sacrificed artifact stays on the battlefield
// until that final pass, so `getManaValue` reads its live mana value just
// before it leaves (CR 608.2g — the sacrifice and the comparison are part of
// the same resolution; no priority intervenes).
export const transmuteArtifact: CardDefinition = {
    id: "6eab6765-eba3-4844-81ca-ae37a6e903df",
    rarity: "uncommon",
    name: "Transmute Artifact",
    oracleText:
        "Sacrifice an artifact. If you do, search your library for an artifact card. If that card's mana value is less than or equal to the sacrificed artifact's mana value, put it onto the battlefield. If it's greater, you may pay {X}, where X is the difference. If you do, put it onto the battlefield. If you don't, put it into its owner's graveyard. Then shuffle.",
    manaCost: { U: 2 },
    types: ["Sorcery"],
    resolveSteps: [
        (ctx: SpellContext) => {
            // "Sacrifice an artifact." — mandatory if able; with no artifact to
            // sacrifice the whole effect ("If you do, …") does nothing.
            const artifacts = ctx.getBattlefieldIds(ctx.caster, {
                types: "Artifact",
            });
            if (artifacts.length === 0) return;
            const sacPick = ctx.requestChoice({
                playerId: ctx.caster,
                choiceId: "transmute-sac",
                kind: "sacrifice-permanents",
                zone: "battlefield",
                zoneOwnerId: ctx.caster,
                filter: { types: "Artifact" },
                count: 1,
                prompt: "Sacrifice an artifact.",
            });
            if (sacPick === undefined) return; // suspended
            const sacId = sacPick[0];
            if (!sacId) return;

            // "search your library for an artifact card" — the submit
            // validator does not apply a filter to hidden library cards, so the
            // artifact-card restriction is carried as a `candidateIds`
            // allow-list (CR 701.19; a fail-to-find is allowed, min 0).
            const libArtifacts = ctx
                .getLibraryCards(ctx.caster)
                .filter((c) => c.types.includes("Artifact"));
            const found = ctx.requestChoice({
                playerId: ctx.caster,
                choiceId: "transmute-search",
                kind: "search-library",
                zone: "library",
                candidateIds: libArtifacts.map((c) => c.id),
                count: { min: 0, max: 1 },
                prompt: "Search your library for an artifact card.",
            });
            if (found === undefined) return; // suspended

            // Read the sacrificed artifact's mana value while it is still on the
            // battlefield (CR 202.3), then resolve the comparison.
            const sacMv = ctx.getManaValue({ type: "permanent", id: sacId });
            const foundId = found[0];

            // Fail-to-find (or no artifact in library): sacrifice, then shuffle.
            if (!foundId) {
                ctx.sacrifice(sacId);
                ctx.shuffleLibrary(ctx.caster);
                return;
            }
            const foundMv =
                libArtifacts.find((c) => c.id === foundId)?.manaValue ?? 0;

            if (foundMv > sacMv) {
                // "you may pay {X}, where X is the difference."
                const diff = foundMv - sacMv;
                const paid = ctx.requestMayPay({
                    playerId: ctx.caster,
                    choiceId: "transmute-paydiff",
                    cost: { X: diff },
                    prompt: `Pay {${diff}} to put the artifact onto the battlefield?`,
                });
                if (paid === undefined) return; // suspended
                ctx.sacrifice(sacId);
                if (paid) {
                    ctx.putFromLibraryOntoBattlefield(ctx.caster, foundId);
                } else {
                    ctx.moveCardById(
                        ctx.caster,
                        foundId,
                        "library",
                        "graveyard"
                    );
                }
                ctx.shuffleLibrary(ctx.caster);
                return;
            }

            // mana value ≤ sacrificed mana value: straight onto the battlefield.
            ctx.sacrifice(sacId);
            ctx.putFromLibraryOntoBattlefield(ctx.caster, foundId);
            ctx.shuffleLibrary(ctx.caster);
        },
    ],
};
