// mh2 — blue cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { evokeTrigger } from "../../abilities/evoke";
import { affinityForArtifacts } from "../../abilities/affinity";

// Subtlety — {2}{U}{U} Creature — Elemental Incarnation, 3/3 (MH2, issue #1205).
// "Flash. Flying. When this creature enters, choose up to one target creature
// spell or planeswalker spell. Its owner puts it on their choice of the top or
// bottom of their library. Evoke—Exile a blue card from your hand." The Evoke
// halves ship as engine infra (#900): the alt cast is a pure HAND leg (`evoke`,
// reusing `AlternativeCost.handCost`) and the sacrifice-on-ETB half is
// `evokeTrigger` (Solitude/Grief precedent).
//
// The ETB is the first TARGETED trigger over a SPELL on the stack (CR 603.3d
// + CR 113 spell targeting, issue #1205): the `targetRequirement` (type
// "spell", filtered to creature/planeswalker spells) rides the #1193 trigger-
// targeting foundation — `raiseTriggerTargetSelection` locks the target as the
// trigger is put on the stack, offering only creature/planeswalker spells below
// it. "Up to one" ⇒ min 0, so the controller may decline.
export const subtlety: CardDefinition = {
    id: "701256d5-1389-48b7-9581-d6037209bd06",
    rarity: "mythic",
    name: "Subtlety",
    oracleText:
        "Flash\nFlying\nWhen this creature enters, choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the top or bottom of their library.\nEvoke—Exile a blue card from your hand.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flash", "flying"],
    evoke: {
        id: "evoke",
        description: "Evoke—Exile a blue card from your hand",
        handCost: {
            action: "exile",
            requirements: [{ filter: { color: "U" }, count: 1 }],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "subtlety-etb",
            oracleText:
                "When this creature enters, choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the top or bottom of their library.",
            scope: "self",
            // CR 113 — a creature or planeswalker SPELL on the stack. "Up to
            // one" ⇒ min 0 (the controller may choose no target).
            targetRequirement: {
                type: "spell",
                count: { min: 0, max: 1 },
                spellStackKind: "spell",
                spellTypeFilter: ["Creature", "Planeswalker"],
            },
            // protocol card: the destination is the OWNER's own top/bottom
            // choice (a mid-resolution option-pick raised to the spell's owner,
            // not the trigger's controller), then `putSpellOnLibrary` moves the
            // stack spell. No DSL Op expresses "put target spell on its owner's
            // library, owner chooses the end" — a stack-object move gated on a
            // foreign player's option pick.
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                // "Up to one" — no target chosen, or it left the stack.
                if (!target || target.type !== "spell") return;
                // CR 113 — the spell's OWNER chooses the library end. A spell's
                // owner equals its caster (controller) except in the rare
                // cast-from-elsewhere case; `getController` is the only ctx
                // lookup that resolves a STACK item (`getOwnerId` is battlefield-
                // only), and `putSpellOnLibrary` sends the card to the true
                // `ownerId`'s library regardless.
                const ownerId = ctx.getController(target);
                // CR 113 — the spell's OWNER chooses the library end.
                const choice = ctx.requestOptionChoice({
                    playerId: ownerId,
                    choiceId: `subtlety-end-${ctx.sourceInstanceId}`,
                    options: [
                        { id: "top", label: "Top of library" },
                        { id: "bottom", label: "Bottom of library" },
                    ],
                    prompt: "Put the spell on the top or bottom of your library?",
                });
                if (choice === undefined) return; // suspended on the choice
                ctx.putSpellOnLibrary(
                    target,
                    choice === "top" ? "top" : "bottom"
                );
            },
        }),
        evokeTrigger("Subtlety"),
    ],
};

// Lose Focus — {1}{U} Instant. "Replicate {U} (When you cast this spell,
// copy it for each time you paid its replicate cost. You may choose new
// targets for the copies.) Counter target spell unless its controller pays
// {2}." Blocked: Replicate (CR 702.56) is `status: "planned"` in
// mechanicsRegistry.ts — no alternate-cast-with-copies primitive exists yet
// (distinct from CR 706 copy-a-spell: replicate copies are paid for and
// created AT CAST TIME, not via a resolution-time copy effect). The
// counter-unless-pay half is otherwise free (same shape as Force Spike,
// leg/blue.ts) — only the keyword blocks it. Stop-and-issue per
// gre-development.md; tracked stub.
// tracked-by: #930
// export const loseFocus: CardDefinition = {
//     id: "985bdb0c-ce6c-4506-8163-76f3b2fdf5fb",
//     name: "Lose Focus",
//     rarity: "common",
//     manaCost: { X: 1, U: 1 },
//     types: ["Instant"],
// };

// Thought Monitor — {6}{U} Artifact Creature — Construct, 2/2 (MH2 71).
// "Affinity for artifacts (This spell costs {1} less to cast for each artifact
// you control.) Flying. When this creature enters, draw two cards." Modern
// Scryfall oracle text is authoritative (ADR 0004).
//
// Affinity KEYWORD (CR 702.41, PRD #702 / ADR 0063) via
// `affinityForArtifacts()`. Third consumer alongside Frogmite and Thoughtcast
// (both `mrd/`); this one proves the keyword COMPOSES — it rides alongside a
// second `staticAbilities` keyword (flying) and an ordinary `enteredTrigger`,
// with no interaction between them: affinity functions only while the spell is
// on the stack (702.41a), flying only once the permanent is on the battlefield.
//
// Home set = earliest paper printing (ADR 0041). Scryfall's earliest paper
// print is the PMH2 prerelease promo (2021-05-06, #71s) rather than MH2 proper
// (2021-06-18, #71) — the promo is the SAME card with a date stamp, and
// `scripts/backfill-card-index.ts` does not exclude `set_type: "promo"`, so the
// lockfile's `firstPrintId` is the promo's. The id below follows the lockfile
// so `check:index` stays green; the set module is `mh2/` because that is the
// real set.
export const thoughtMonitor: CardDefinition = {
    id: "c5b53f25-25e7-47db-b356-65e93e3b0059", // PMH2 71s (= MH2 71)
    name: "Thought Monitor",
    rarity: "rare",
    oracleText:
        "Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nFlying\nWhen this creature enters, draw two cards.",
    manaCost: { X: 6, U: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 2,
    toughness: 2,
    ...affinityForArtifacts(["flying"]),
    triggeredAbilities: [
        enteredTrigger({
            id: "thought-monitor-etb-draw",
            oracleText: "When this creature enters, draw two cards.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 2 }],
        }),
    ],
};

export {};
