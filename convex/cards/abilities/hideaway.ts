// Hideaway N (CR 702.75) — a TRIGGERED-ability keyword expanded implicitly
// from a single `staticAbilities` string at the `getDefinition` seam
// (convex/cards/index.ts), the same ADR 0054 mechanism fading/vanishing and
// exalted/prowess use. A card declares only `staticAbilities: ["hideaway 4"]`;
// `expandHideaway` injects the synthesized ETB triggered ability, so the
// keyword's rules text lives in exactly one place — the string. A card can
// therefore never print the keyword and enforce nothing (the deathtouch /
// hexproof shape Guard A exists to catch). Issue #783.
//
// 702.75a "Hideaway is a triggered ability. 'Hideaway N' means 'When this
//         permanent enters, look at the top N cards of your library. Exile one
//         of them face down and put the rest on the bottom of your library in
//         a random order. The exiled card gains "The player who controls the
//         permanent that exiled this card may look at this card in the exile
//         zone."'"
// 702.75b Hideaway does NOT tap the permanent. Cards printed with a bare
//         "Hideaway" have Oracle errata to `Hideaway 4` PLUS a separate "enters
//         tapped" ability — modelled as the card's own `entersTapped: true`
//         data flag, never folded in here.
//
// Fully declarative (DSL-first, ADR 0045): the injected trigger's body is the
// single `hideaway` Op, itself pure composition over existing SpellContext
// primitives (`peekLibraryTop` + a `look-distribute` `requestChoice` +
// `exileFaceDown` + `linkExileToSource` + `reorderLibraryTop`). No `resolve()`
// closure anywhere in the keyword.
//
// The SECOND half of the printed cycle — "you may play the exiled card without
// paying its mana cost <when some condition holds>" (Shelldock Isle, Windbrisk
// Heights, Mosswort Bridge, …) — is NOT part of the keyword: CR 702.75a stops
// at the exile. It is the card's own activated/triggered ability, and it reaches
// exactly the card this keyword exiled through the CR 607 LINK this expansion
// stamps (`linkExileToSource`), read back by `grantCastFromExile`'s
// `{ exiledWithSource: true }` selector.

import type { CardDefinition, TriggeredAbility } from "../types";
import { enteredTrigger } from "./triggers/enteredTrigger";

/** Matches the parametrized keyword string, e.g. `"hideaway 4"` (CR 702.75a —
 *  N is always spelled as a numeral in the Oracle keyword line). */
const HIDEAWAY_PATTERN = /^hideaway (\d+)$/i;

/** Stable id for the injected ETB ability within `triggeredAbilities`. */
const HIDEAWAY_TRIGGER_ID = "hideaway";

/** Spelled-out counts for the printed reminder text ("look at the top four
 *  cards"). Every printed Hideaway card is N=4 or N=5; higher values fall back
 *  to the bare numeral. */
const COUNT_WORDS: Record<number, string> = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
};

/** CR 702.75a rules text for the injected trigger, spelled out for N. */
export function hideawayOracleText(n: number): string {
    const word = COUNT_WORDS[n] ?? String(n);
    const noun = n === 1 ? "card" : "cards";
    return `When this permanent enters, look at the top ${word} ${noun} of your library. Exile one of them face down and put the rest on the bottom of your library in a random order.`;
}

/** Reads the declared `hideaway N` keyword off `staticAbilities`, or undefined
 *  when the card does not have the keyword. */
function parseHideaway(
    staticAbilities: ReadonlyArray<string> | undefined
): number | undefined {
    if (!staticAbilities) return undefined;
    for (const s of staticAbilities) {
        const m = HIDEAWAY_PATTERN.exec(s.trim());
        if (m) {
            const n = Number.parseInt(m[1], 10);
            if (Number.isFinite(n) && n > 0) return n;
        }
    }
    return undefined;
}

/** CR 702.75a — the synthesized ETB triggered ability for `hideaway N`. */
export function hideawayTrigger(n: number): TriggeredAbility {
    return enteredTrigger({
        id: HIDEAWAY_TRIGGER_ID,
        oracleText: hideawayOracleText(n),
        scope: "self",
        effects: [{ op: "hideaway", player: "controller", look: n }],
    });
}

/** ADR 0054 keyword expansion — injects the CR 702.75a ETB trigger for a card
 *  declaring `hideaway N`. A no-op for every other card, so it composes freely
 *  in `expandDefinition`'s chain (order irrelevant). */
export function expandHideaway(def: CardDefinition): CardDefinition {
    const n = parseHideaway(def.staticAbilities);
    if (n === undefined) return def;
    // Idempotence guard: never inject twice (the seam memoizes per base
    // definition, but a card that already spells the trigger out by hand must
    // not end up with two copies on the stack — the triggerDedup guard shape).
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => t.id === HIDEAWAY_TRIGGER_ID)) return def;
    return {
        ...def,
        triggeredAbilities: [...existing, hideawayTrigger(n)],
    };
}
