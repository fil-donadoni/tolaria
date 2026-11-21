// Which card name an as-enters name LOCK should name (issue #10225).
//
// CR 614.12a — "As this enters, choose a card name": a lock permanent (an
// activated-ability lock, CR 602.5 / 113.7, or a cast lock, CR 601.3a) does
// exactly as much as the name it was given. Both doors that answer the window
// for the Bot — the live Brain's default (`nameCardDefaultFor`,
// `src/lib/ai/bot-view.ts`) and the search's forced answer (`nameCardAnswer`,
// `choiceCandidates.ts`) — read THIS ranking, so the two cannot disagree.
//
// The lock's scope is read off the entering card's own definition (its
// `staticEffects`), never off a card name: an `activation-restriction` keyed on
// `sourcesNamed: "chosen-name"` (with its CR 605.1a mana-ability exemption) and
// a `cast-restriction` on a card that owes an as-enters name. Candidates are
// what the chooser legitimately sees: every battlefield, graveyard and face-up
// exile, plus the hand cards the caller says the chooser knows (a CR 701.20a
// reveal) — never hidden information.
//
// Legality stays `isLegalNamedCard`'s (the caller passes it in): this module
// only ORDERS legal names, so its answer is legal by construction.

import type { CardDefinition } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { isManaAbilityForRules } from "../constants";
import { isFaceDownExile } from "../faceDown";
import { cardValueById } from "../cardValue";
import type { PendingChoice } from "../state";

/** What a name-keyed lock stops, read off its definition. */
export interface NameLockScope {
    /** CR 602.5 — activated abilities of sources with the name; `exemptMana`
     *  is CR 605.1a's "unless they're mana abilities". */
    activation?: { exemptMana: boolean };
    /** CR 601.3a — spells with the name can't be cast. */
    cast: boolean;
}

/** A card slot as either state shape carries it: a full `CardInstanceState`
 *  or its projected slim twin. `null` is a hidden projected hand slot. */
export type NameLockSlot = {
    card?: { id?: unknown } | Record<string, unknown>;
    knownTo?: readonly string[];
    faceDownBy?: unknown;
} | null;

/** The board this read needs — a `GameState` or the projected public one. */
export interface NameLockBoard {
    stagedEntries?: ReadonlyArray<{ card: NameLockSlot & object }>;
    players: ReadonlyArray<{
        id: string;
        battlefield: ReadonlyArray<NameLockSlot>;
        graveyard: ReadonlyArray<NameLockSlot>;
        exile: ReadonlyArray<NameLockSlot>;
        hand: ReadonlyArray<NameLockSlot>;
    }>;
}

type Zone = "battlefield" | "graveyard" | "exile" | "hand";

function defIdOf(slot: NameLockSlot): string | undefined {
    const id = (slot?.card as { id?: unknown } | undefined)?.id;
    return typeof id === "string" && id !== "" ? id : undefined;
}

/** The scope of the lock `def` imposes once named, or `undefined` when `def`
 *  is no name-keyed lock. */
export function nameLockScopeOf(
    def: CardDefinition | undefined
): NameLockScope | undefined {
    if (!def) return undefined;
    const statics = def.staticEffects ?? [];
    let activation: NameLockScope["activation"];
    for (let i = 0; i < statics.length; i++) {
        const e = statics[i];
        if (
            e.kind === "activation-restriction" &&
            e.sourcesNamed === "chosen-name"
        )
            activation = { exemptMana: e.exemptManaAbilities === true };
    }
    // CR 601.3a — a `cast-restriction` carries its predicate as a closure;
    // on a card that owes an as-enters NAME it is the name-keyed lock (the
    // compiled "Spells with the chosen name can't be cast").
    const owesName =
        def.entersWith?.asEnters?.some((owed) => owed.kind === "name") ?? false;
    const cast = owesName && statics.some((e) => e.kind === "cast-restriction");
    return activation || cast ? { activation, cast } : undefined;
}

/** The scope of the lock entering behind an as-enters `name-card` head. */
export function nameLockScopeForHead(
    board: Pick<NameLockBoard, "stagedEntries">,
    head: PendingChoice
): NameLockScope | undefined {
    if (head.stackItemId !== "" || head.asEntersCardId === undefined)
        return undefined;
    const entry = (board.stagedEntries ?? []).find(
        (e) => (e.card as { id?: unknown }).id === head.asEntersCardId
    );
    const defId = entry ? defIdOf(entry.card) : undefined;
    return nameLockScopeOf(
        (defId ? tryGetDefinition(defId) : undefined) ?? undefined
    );
}

/** Whether the lock stops anything a card named `def` does — and how hard
 *  (0 = nothing). CR 602.5: an activated ability the exemption does not
 *  cover; CR 601.3a: a nonland card is cast (CR 305.1 — a land is played). */
function lockBite(def: CardDefinition, scope: NameLockScope): number {
    let bite = 0;
    if (scope.activation) {
        const exempt = scope.activation.exemptMana;
        const abilities = def.activatedAbilities ?? [];
        for (let i = 0; i < abilities.length; i++) {
            if (!(exempt && isManaAbilityForRules(abilities[i]))) bite++;
        }
    }
    if (scope.cast && !def.types.includes("Land")) bite++;
    return bite;
}

interface Candidate {
    name: string;
    /** 2 = the lock bites where the opponent is using it now (a permanent's
     *  abilities on the battlefield, a cast-lock card known in hand); 1 = seen
     *  in a graveyard / exile / battlefield, so in the deck. */
    tier: number;
    value: number;
    /** The chooser shows the same name: the lock would bind it too. */
    hitsSelf: boolean;
}

function tierOf(zone: Zone, scope: NameLockScope, def: CardDefinition): number {
    const activationBites =
        scope.activation !== undefined &&
        lockBite(def, { activation: scope.activation, cast: false }) > 0;
    if (zone === "battlefield" && activationBites) return 2;
    if (zone === "hand" && scope.cast && !def.types.includes("Land")) return 2;
    return 1;
}

/** The name the lock should name, or `undefined` when no legal name bites an
 *  opponent (the caller falls back to its legal default).
 *
 *  Order: names that bind only the opponent before names that bind the
 *  chooser too; then tier; then the card's latent value (`cardValueById`)
 *  plus the count of abilities/casts the lock denies; name order breaks ties
 *  so every world and seed agree. A name seen only on the chooser's side is
 *  never a candidate. */
export function rankNameLockName(
    board: NameLockBoard,
    head: PendingChoice,
    scope: NameLockScope,
    isLegal: (name: string) => boolean,
    /** Whether the chooser knows this hand slot's identity (its own hand,
     *  or an opponent's card it was shown). */
    handSlotKnown: (playerId: string, slot: NameLockSlot) => boolean
): string | undefined {
    const chooser = head.playerId;
    const byName = new Map<string, Candidate>();
    const selfNames = new Set<string>();
    const legalCache = new Map<string, boolean>();
    const legal = (name: string): boolean => {
        let ok = legalCache.get(name);
        if (ok === undefined) {
            ok = isLegal(name);
            legalCache.set(name, ok);
        }
        return ok;
    };
    const observe = (playerId: string, zone: Zone, slot: NameLockSlot) => {
        if (slot === null) return;
        if (
            zone === "exile" &&
            isFaceDownExile(slot as Parameters<typeof isFaceDownExile>[0])
        )
            return;
        if (zone === "hand" && !handSlotKnown(playerId, slot)) return;
        const defId = defIdOf(slot);
        const def = defId ? tryGetDefinition(defId) : undefined;
        if (!def || !defId) return;
        const bite = lockBite(def, scope);
        if (bite === 0 || !legal(def.name)) return;
        if (playerId === chooser) {
            selfNames.add(def.name);
            return;
        }
        const tier = tierOf(zone, scope, def);
        const value = cardValueById(defId) + bite;
        const prev = byName.get(def.name);
        if (
            !prev ||
            tier > prev.tier ||
            (tier === prev.tier && value > prev.value)
        )
            byName.set(def.name, {
                name: def.name,
                tier,
                value,
                hitsSelf: false,
            });
    };
    const zones: Zone[] = ["battlefield", "graveyard", "exile", "hand"];
    for (let i = 0; i < board.players.length; i++) {
        const p = board.players[i];
        for (let z = 0; z < zones.length; z++) {
            const slots = p[zones[z]];
            for (let j = 0; j < slots.length; j++)
                observe(p.id, zones[z], slots[j]);
        }
    }
    const ranked: Candidate[] = [];
    byName.forEach((c) =>
        ranked.push({ ...c, hitsSelf: selfNames.has(c.name) })
    );
    ranked.sort(
        (a, b) =>
            Number(a.hitsSelf) - Number(b.hitsSelf) ||
            b.tier - a.tier ||
            b.value - a.value ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
    return ranked[0]?.name;
}
