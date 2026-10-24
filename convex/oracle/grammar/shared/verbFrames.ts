/**
 * Frame heads — the declared table of Verb Frames the effect-clause grammar
 * could open (GLOSSARY **Verb Frame**, issue #6632).
 *
 * A Verb Frame is one per Effect Script Op: the head verb of an effect
 * sentence names the Op its arguments (object descriptor, quantity, zone, …)
 * fill. This table is the ONLY authority `oracle:report --frames` classifies
 * an unparsed span by; it carries no grammar. An `op` absent from the
 * Mechanics Registry (`EFFECT_OP_REGISTRY`) makes the head a `no Op` row —
 * filed under the Op-gap umbrella, never a frame.
 */

export interface FrameHead {
    /** The head verb, lower-case, singular ("draw" reads "Draw" and "draws"). */
    readonly verb: string;
    /**
     * The Effect Script Op the frame lowers to, or `null` when no Op exists
     * for the verb. Checked against the registry by the classifier, so a
     * misspelt name degrades to `no Op` rather than a phantom frame.
     */
    readonly op: string | null;
    /**
     * A word the span must also contain for the verb to be this head:
     * "remove … counter", "gain … life". Absent: the verb alone decides.
     */
    readonly requires?: string;
    /**
     * The verb opens the span only as its FIRST word: "counter" after a
     * subject is the noun ("for each counter on it"), not "counter target spell".
     */
    readonly leadOnly?: true;
}

/** Verb → Op, in match order: the first row whose `requires` holds wins. */
export const FRAME_HEADS: readonly FrameHead[] = [
    { verb: "destroy", op: "destroy" },
    { verb: "exile", op: "moveZone" },
    { verb: "put", op: "moveZone" },
    { verb: "return", op: "moveZone" },
    { verb: "sacrifice", op: "sacrifice" },
    { verb: "prevent", op: "preventDamage" },
    { verb: "remove", op: "counters", requires: "counter" },
    { verb: "remove", op: null },
    { verb: "draw", op: "draw" },
    { verb: "discard", op: "discard" },
    { verb: "tap", op: "tapUntap" },
    { verb: "untap", op: "tapUntap" },
    { verb: "counter", op: "counter", leadOnly: true },
    { verb: "create", op: "createToken" },
    { verb: "deal", op: "dealDamage" },
    { verb: "gain", op: "gainLife", requires: "life" },
    { verb: "gain", op: "gainControl", requires: "control" },
    { verb: "lose", op: "loseLife", requires: "life" },
    { verb: "search", op: "choice" },
    { verb: "reveal", op: "reveal" },
    { verb: "look", op: "libraryLook" },
    { verb: "shuffle", op: "libraryLook" },
    { verb: "regenerate", op: "regenerate" },
    { verb: "scry", op: "scryReorder" },
    { verb: "mill", op: "mill" },
    { verb: "fight", op: "fight" },
    { verb: "attach", op: "attach" },
    { verb: "transform", op: "transform" },
    { verb: "explore", op: "explore" },
    { verb: "add", op: "addMana" },
    // Keyword actions the registry has no Op for: reported as `no Op`.
    { verb: "surveil", op: null },
    { verb: "proliferate", op: null },
    { verb: "goad", op: null },
    { verb: "amass", op: null },
    { verb: "populate", op: null },
    { verb: "investigate", op: null },
    // Modal headers and cost payment, not verbs of an Op: reported as `no Op`.
    { verb: "choose", op: null },
    { verb: "pay", op: null },
];

/**
 * Openers that make a span a COMPOSITION head, not a frame: trigger,
 * condition, duration and subject openers. They are Composition Rules or
 * static grammar, reported beside the frames but never ranked with them.
 */
export const COMPOSITION_HEADS: readonly string[] = [
    "whenever",
    "when",
    "at",
    "if",
    "as",
    "until",
    "this",
    "enchanted",
    "equipped",
    "each",
    "all",
    "creatures",
    "other",
    "for",
    "during",
    "unless",
    "threshold",
    "nonbasic",
    "lands",
    "your",
    "spells",
];

/**
 * Words that open a span naming WHO does the verb ("Target player draws",
 * "You may discard", "Its controller sacrifices"): a span led by one is
 * scanned for its verb. "Each" is handled apart (a player noun must follow).
 */
export const SUBJECT_LEADS: ReadonlySet<string> = new Set([
    "you",
    "target",
    "that",
    "its",
    "their",
    "defending",
    "an",
    "a",
    "opponent",
    "opponents",
    "player",
    "players",
    "controller",
]);
