/**
 * Lowering: effect SENTENCES → `EffectOp[]`, plus the target bookkeeping every
 * ability site shares (CR 601.2c via CR 602.2b / 603.3d, ADR 0045).
 *
 * Extracted from `lowerActivated.ts` when the triggered slot (#2698) became the
 * second consumer: a trigger's body is the SAME sentence list an activated
 * ability's is, and the one piece of cross-sentence bookkeeping in the grammar
 * — target SLOTS — has to be assigned by ONE walk at either site or the index
 * an Op points at drifts from the requirement that declares it.
 *
 * The site-specific parts stayed behind: an activated ability has a cost and
 * CR 602.5 restrictions, a triggered one has a head and a CR 603.4 condition.
 * What is here is exactly what both have.
 */

import type {
    EffectObjectSelector,
    EffectOp,
    CardType,
    Color,
    EffectCardFilter,
    EffectPlayerRef,
    EffectPredicate,
    EffectTokenSpec,
    EffectValue,
    KickerCost,
    ManaCost,
    TargetRequirement,
} from "../cards/types";
import type { PermanentFilter } from "../cards/filters";
import type { KickedRefIR } from "./grammar/shared/condition";
import { durationSpec } from "./grammar/shared/duration";
import {
    capitalise,
    type AmountIR,
    type EffectSentenceIR,
    type SubjectIR,
} from "./grammar/shared/effectClause";
import { SELF_MARKER } from "./normalize";
import type { PlayerRefIR } from "./grammar/shared/playerRef";
import type { ZoneRefIR } from "./grammar/shared/zoneRef";

/**
 * A lowering step's outcome.
 *
 * Explicitly tagged rather than `T | string`: `playerRef` legitimately RESOLVES
 * to the string `"controller"` (`EffectPlayerRef` is a string union), so a
 * `typeof x === "string"` error check read every "you draw a card" as the
 * failure `"controller"` and made the card unparsed. A union whose success and
 * failure arms share a runtime type cannot be discriminated by that type.
 */
export type Lowered<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: string };

export function lowered<T>(value: T): Lowered<T> {
    return { ok: true, value };
}

export function unlowerable<T>(reason: string): Lowered<T> {
    return { ok: false, reason };
}

/**
 * What the SITE lowering a sentence knows that the sentence itself cannot.
 *
 * Exactly one thing so far, and it is the CR 107.3 one: whether an `{X}` was
 * announced for this effect at all. The grammar reads the word "X" wherever it
 * reads a count word (`readAmount`), because that is a fact about the span;
 * whether the number exists is a fact about the COST, which lives on the card
 * (a spell's `{X}` pip) or on the ability (an activation cost's), never in the
 * sentence. A site that cannot announce an X refuses the sentence rather than
 * lowering it to a number it would have to invent — an `X` folded to 0 is a
 * card that resolves and does nothing, the exact silent shape this compiler
 * exists to refuse.
 */
export interface SiteOptions {
    /** CR 107.3 — the source announces a value for {X} (it has an `{X}` pip). */
    readonly allowX: boolean;
    /**
     * CR 201.5 — the card's PRINTED name, for the display strings a lowering
     * emits (today: a `mayPay` prompt).
     *
     * The same species of site fact as `allowX`: `normalize.ts` replaced the
     * card's own name with `SELF_MARKER` so the GRAMMAR could bind a REFERENT
     * rather than a string, and a sentence span therefore cannot know what to
     * put back. `lowerSpell.ts` makes the argument in full for a mode's picker
     * label — "{self} deals 5 damage" is never valid output, and it shipped on
     * 18 of 34 modal rows before PR #3044's review caught it. A prompt is read
     * by a player exactly as that label is.
     */
    readonly selfName: string;
    /**
     * CR 702.33e — the kicker costs this site's card prints, with their ids.
     *
     * A site fact for the reason `allowX` is one: "If this spell was kicked"
     * is a fact about the sentence, but whether the card HAS a kicker to have
     * been kicked with, and which id "its {1}{U} kicker" names, are facts about
     * the card's kicker line. Absent = the site reads no kicker at all, and a
     * kicked sentence there is refused rather than lowered into a gate that
     * can never open.
     */
    readonly kickers?: readonly KickerCost[];
    /**
     * What this site's anaphora NAME. "that player" and "that
     * card" are read by the grammar as words; their referent is printed
     * outside the sentence (a trigger head: "each PLAYER'S upkeep", "enchanted
     * creature DIES", issue #4127), so only the site can supply it. Absent =
     * the site introduced no such referent, and a sentence using the word is
     * refused rather than bound to a guess.
     */
    readonly antecedents?: SiteAntecedents;
}

/** The referents a site's anaphora may name (see `SiteOptions.antecedents`). */
export interface SiteAntecedents {
    /** "that player". */
    readonly player?: EffectPlayerRef;
    /** "that card" — a card a zone change put into a graveyard (CR 400.7e). */
    readonly card?: EffectObjectSelector;
}

/** CR 107.3 — an effect magnitude to an `EffectValue`, X gated by the site. */
function lowerAmount(
    amount: AmountIR,
    site: SiteOptions
): Lowered<EffectValue> {
    if (amount.kind === "fixed") return lowered(amount.value);
    return site.allowX
        ? lowered({ X: true })
        : unlowerable(
              "an effect reads X but its source announces no {X} (CR 107.3)"
          );
}

/** Collects the ability's target requirements as the sentences are walked. */
export class TargetSlots {
    private readonly slots: TargetRequirement[] = [];

    /** Announce a target, returning its positional index (CR 601.2c). */
    allocate(requirement: TargetRequirement): Lowered<number> {
        if (this.slots.length > 0)
            // Reached from every ability site and from the spell and per-mode
            // sites, so the reason names the LIMIT rather than one site.
            return unlowerable(
                "grammar v0 allows one target per effect site (CR 601.2c)"
            );
        this.slots.push(requirement);
        return lowered(this.slots.length - 1);
    }

    requirements(): readonly TargetRequirement[] {
        return this.slots;
    }
}

/**
 * The bookkeeping ONE walk over an ability's sentence list owns.
 *
 * Two things now share the walk, for the same reason: both are cross-sentence
 * and both break silently when a second copy exists. Target SLOTS index the
 * requirements the ability declares, so an Op emitted by sentence 2 that
 * pointed into sentence 1's private allocator would dangle. BINDING NAMES are
 * script-wide identifiers (`validateEffectScript` rejects a dangling or
 * duplicated one), so two optional sentences in one ability must not both be
 * called `$may`.
 */
/**
 * CR 601.2c — the SAME announced targets, read a second time.
 *
 * An `upgrade-if-controls` lowers its base effect and its upgraded twin, and
 * both name the one target the ability announced. The twin is lowered through
 * these slots: each allocation must be the requirement the base allocated at
 * that position, and gets the base's index back — never a second slot.
 */
class ReplayedTargetSlots extends TargetSlots {
    private readonly source: TargetSlots;
    private next: number;
    constructor(source: TargetSlots, from: number) {
        super();
        this.source = source;
        this.next = from;
    }
    override allocate(requirement: TargetRequirement): Lowered<number> {
        const prior = this.source.requirements()[this.next];
        if (
            prior === undefined ||
            JSON.stringify(prior) !== JSON.stringify(requirement)
        )
            return unlowerable(
                "the replacement names a target its base effect did not (CR 601.2c)"
            );
        this.next += 1;
        return lowered(this.next - 1);
    }
    override requirements(): readonly TargetRequirement[] {
        return this.source.requirements();
    }
    /** How many of the source's slots the replay has read back. */
    consumed(): number {
        return this.next;
    }
}

export class SentenceWalk {
    readonly targets: TargetSlots;
    private readonly binds: { count: number };

    constructor(
        targets: TargetSlots = new TargetSlots(),
        binds: { count: number } = { count: 0 }
    ) {
        this.targets = targets;
        this.binds = binds;
    }

    /** A walk over the same targets from `from`, sharing binding names. */
    replaying(from: number): SentenceWalk & {
        readonly targets: ReplayedTargetSlots;
    } {
        return new SentenceWalk(
            new ReplayedTargetSlots(this.targets, from),
            this.binds
        ) as SentenceWalk & { readonly targets: ReplayedTargetSlots };
    }
    /**
     * CR 608.2c — the player whose library the last `look-reorder` looked
     * at, when that player was announced as a target: the referent of "That
     * player looks at …" in the sentence after it. Set by that lowering only,
     * so the anaphora binds to nothing it was not written for.
     */
    libraryLookedAt: EffectPlayerRef | null = null;
    /**
     * CR 608.2h — the announced object the last sentence acted on, with the
     * Op that acted on it: the referent of "that creature's mana value" in
     * the sentence after it. The Op is kept (not a copy) so the reader can
     * give it the `bind` that snapshots the object before it changes zone;
     * set only by the lowerings that record it, so the anaphora binds to
     * nothing it was not written for.
     */
    actedOn: {
        /** A `destroy` or announced-target `moveZone` — both carry `bind`. */
        readonly op: { bind?: string };
        readonly requirement: TargetRequirement;
    } | null = null;

    /** A binding name unique within this ability's script. */
    nextBind(prefix: string): string {
        this.binds.count += 1;
        return `$${prefix}${this.binds.count}`;
    }
}

function objectSelector(
    subject: SubjectIR,
    slots: TargetSlots
): Lowered<EffectObjectSelector> {
    if (subject.kind === "self") return lowered({ ref: "$source" });
    if (subject.kind === "player")
        return unlowerable("a player is not an object (CR 109.1)");
    // CR 400.7e — "that card" is a card in a graveyard, which only a zone
    // change can act on; `lowerMoveZone` binds it, every other verb refuses.
    if (subject.kind === "that-card")
        return unlowerable('"that card" is read only as a returned card');
    if (subject.requirement.type === "player")
        return unlowerable("a player is not an object (CR 109.1)");
    const index = slots.allocate(subject.requirement);
    return index.ok ? lowered({ target: index.value }) : index;
}

function playerRef(
    ref: PlayerRefIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectPlayerRef> {
    switch (ref.kind) {
        case "you":
            return lowered("controller");
        // The player the site's head named; none, no binding.
        case "that-player":
            return site.antecedents?.player !== undefined
                ? lowered(site.antecedents.player)
                : unlowerable('"that player" names no player at this site');
        case "target": {
            const requirement: TargetRequirement = ref.opponent
                ? { type: "player", count: 1, controller: "opponent" }
                : { type: "player", count: 1 };
            const index = slots.allocate(requirement);
            return index.ok ? lowered({ target: index.value }) : index;
        }
        // CR 101.4 — "each player" / "each opponent" is a forEach over the
        // player set, and folding it into a single ref would silently make a
        // symmetrical effect one-sided. Refused until the construct is needed.
        case "each-player":
        case "each-opponent":
            return unlowerable('"each player" is not in grammar v0');
    }
}

/**
 * The damage recipient (CR 119.3), which may be an object OR a player —
 * "any target" is either at announcement, so the two cases share one slot.
 */
function damageTarget(
    subject: SubjectIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectObjectSelector | { player: EffectPlayerRef }> {
    if (subject.kind === "player") {
        const player = playerRef(subject.player, slots, site);
        return player.ok ? lowered({ player: player.value }) : player;
    }
    return objectSelector(subject, slots);
}

export function lowerSentence(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const announced = walk.targets.requirements().length;
    const actedOn = walk.actedOn;
    const out = lowerSentenceBody(sentence, walk, site);
    // CR 608.2h — "that creature" names the object the LAST sentence acted
    // on. A sentence that announced a new target without recording itself
    // (a tap, a pump) makes the older referent stale, so it is dropped rather
    // than read past: an X read off the wrong object is a silent misread.
    if (
        walk.targets.requirements().length !== announced &&
        walk.actedOn === actedOn
    )
        walk.actedOn = null;
    return out;
}

function lowerSentenceBody(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const slots = walk.targets;
    switch (sentence.kind) {
        case "pump": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "pump",
                    target: target.value,
                    power: sentence.power,
                    toughness: sentence.toughness,
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        case "grant-ability": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "grantAbility",
                    target: target.value,
                    ability: sentence.keyword.ability,
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        case "deal-damage": {
            const to = damageTarget(sentence.to, slots, site);
            if (!to.ok) return to;
            const amount = lowerAmount(sentence.amount, site);
            if (!amount.ok) return amount;
            return lowered([
                { op: "dealDamage", amount: amount.value, to: to.value },
            ]);
        }
        // CR 615.12 — the game-scoped anti-prevention lock. No fields, no
        // target, no duration argument: the Op is turn-scoped by construction
        // and cleared at CLEANUP (CR 514.2), exactly as Stomp's first line
        // reads it (issue #3303).
        case "suppress-damage-prevention":
            return lowered([{ op: "suppressDamagePrevention" }]);
        case "draw": {
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            return lowered([
                { op: "draw", player: player.value, count: count.value },
            ]);
        }
        case "destroy": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            // CR 701.19c — a "can't be regenerated" clause is a property of
            // the destruction, not a second effect.
            const destroy: Extract<EffectOp, { op: "destroy" }> =
                sentence.cantBeRegenerated
                    ? {
                          op: "destroy",
                          target: target.value,
                          cantBeRegenerated: true,
                      }
                    : { op: "destroy", target: target.value };
            recordActedOn(walk, sentence.subject, destroy);
            return lowered([destroy]);
        }
        case "tap-untap": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "tapUntap",
                    action: sentence.action,
                    target: target.value,
                },
            ]);
        }
        case "regenerate": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([{ op: "regenerate", target: target.value }]);
        }
        case "life": {
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const amount = lowerAmount(sentence.amount, site);
            if (!amount.ok) return amount;
            return lowered([
                sentence.action === "gain"
                    ? {
                          op: "gainLife",
                          player: player.value,
                          amount: amount.value,
                      }
                    : {
                          op: "loseLife",
                          player: player.value,
                          amount: amount.value,
                      },
            ]);
        }
        case "counters": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            return lowered([
                {
                    op: "counters",
                    action: "add",
                    counter: sentence.counter,
                    target: target.value,
                    count: count.value,
                },
            ]);
        }
        case "move-zone": {
            const moved = lowerMoveZone(
                sentence.subject,
                sentence.to,
                slots,
                site
            );
            if (moved.ok)
                recordActedOn(walk, sentence.subject, moved.value[0]!);
            return moved;
        }
        case "create-token":
            return lowerCreateToken(sentence, walk);
        case "optional": {
            // CR 603.2 — an optional triggered ability's controller chooses on
            // resolution, and declining does NOTHING. That is a cost-free
            // `mayPay` (its `cost` OMITTED, issue #680) whose REQUIRED boolean
            // bind an `if` reads: no placeholder Op, no empty mode, no fifth
            // structural construct. The inner sentence is lowered by THIS
            // walk, so "you may tap target creature" allocates its slot once,
            // through the shared allocator, exactly as the bare sentence does.
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            const bind = walk.nextBind("may");
            return lowered([
                {
                    op: "mayPay",
                    // CR 603.2 — "you" on a triggered ability is its
                    // controller; no other site emits this shape today.
                    player: "controller",
                    prompt: `${capitalise(sentence.clause.split(SELF_MARKER).join(site.selfName))}?`,
                    bind,
                },
                {
                    op: "if",
                    predicate: { binding: bind },
                    then: inner.value,
                },
            ]);
        }
        case "loot": {
            // CR 121.1 then CR 701.9a — draw, then discard cards of the
            // controller's choice: the draw / choose-hand-card / discard
            // sequence every hand-written looter writes.
            const draw = lowerAmount(sentence.draw, site);
            if (!draw.ok) return draw;
            const discard = lowerAmount(sentence.discard, site);
            if (!discard.ok) return discard;
            if (typeof discard.value !== "number")
                return unlowerable("a loot discards a printed number of cards");
            const bind = walk.nextBind("discard");
            return lowered([
                { op: "draw", player: "controller", count: draw.value },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: discard.value,
                    prompt:
                        discard.value === 1
                            ? "Discard a card."
                            : `Discard ${countWord(discard.value)} cards.`,
                    bind,
                },
                { op: "discard", player: "controller", cards: { ref: bind } },
            ]);
        }
        case "upgrade-if-controls":
            return lowerUpgrade(sentence, walk, site);
        case "discard-at-random": {
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            return lowered([
                {
                    op: "discardAtRandom",
                    player: player.value,
                    count: count.value,
                },
            ]);
        }
        case "look-distribute":
            return lowerLookDistribute(sentence, site);
        case "look-reorder": {
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            if (sentence.looker === "that-player") {
                // CR 608.2c — "That player" is the player the sentence before
                // looked at; with no such sentence it names no one we can.
                const chooser = walk.libraryLookedAt;
                if (chooser === null)
                    return unlowerable(
                        '"that player" names no player announced before it'
                    );
                const player = playerRef(sentence.library, slots, site);
                if (!player.ok) return player;
                return lowered([
                    {
                        op: "scryReorder",
                        player: player.value,
                        chooser,
                        count: count.value,
                        destination: "none",
                    },
                ]);
            }
            const player = playerRef(sentence.library, slots, site);
            if (!player.ok) return player;
            if (player.value === "controller")
                return lowered([
                    {
                        op: "scryReorder",
                        player: player.value,
                        count: count.value,
                        destination: "none",
                    },
                ]);
            // The library is another player's but the looker is "you": the
            // card overrides CR 401.4's default (the owner arranges), so the
            // controller orders it (`chooser`, the fateseal seam).
            walk.libraryLookedAt = player.value;
            return lowered([
                {
                    op: "scryReorder",
                    player: player.value,
                    chooser: "controller",
                    count: count.value,
                    destination: "none",
                },
            ]);
        }
        case "kicked": {
            // CR 702.33g — a target inside the gate is chosen only if the
            // spell was kicked; a card-level `targetRequirement` would demand
            // it on every cast. Measured on the walk, so a target allocated
            // by the inner sentence is seen however it was reached.
            const before = walk.targets.requirements().length;
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            if (walk.targets.requirements().length !== before)
                return unlowerable(
                    "a target announced only if the spell was kicked has no encoding (CR 702.33g)"
                );
            const left = kickedValue(sentence.kicked, site.kickers ?? []);
            if (!left.ok) return left;
            return lowered([
                {
                    op: "if",
                    predicate: { left: left.value, op: "ge", right: 1 },
                    then: inner.value,
                },
            ]);
        }
        default: {
            const never: never = sentence;
            return unlowerable(
                `no lowering for effect ${JSON.stringify(never)}`
            );
        }
    }
}

/**
 * Lower a sentence behind a gate ("you may", "if this spell was kicked").
 *
 * A library looked at behind a gate may never have been looked at, so it is
 * no antecedent for a "That player" after the gate: the walk's referent is
 * restored to what it was before the gated sentence.
 */
function gatedSentence(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const antecedent = walk.libraryLookedAt;
    const actedOn = walk.actedOn;
    const inner = lowerSentence(sentence, walk, site);
    walk.libraryLookedAt = antecedent;
    walk.actedOn = actedOn;
    return inner;
}

/**
 * CR 608.2c — "<base>. If you control a <A> and a <B>, <upgraded> instead."
 *
 * The replacement is decided as the ability RESOLVES, so it is an `if` over
 * `count` predicates (one per controls clause, each "at least one", read off
 * the controller's battlefield — CR 109.5's "you") rather than a CR 603.4
 * intervening-if. There is no conjunction in the predicate vocabulary and no
 * fifth construct to add one (ADR 0045), so the conjunction is the nesting:
 * `if A { if B { upgraded } else { base } } else { base }`. The base script
 * appears once per `else`; `if` branches see a CLONE of the bindings in scope
 * (`validateEffectScript`), so a bind inside it is legal in both.
 */
function lowerUpgrade(
    sentence: Extract<EffectSentenceIR, { kind: "upgrade-if-controls" }>,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const from = walk.targets.requirements().length;
    const base = lowerSentence(sentence.base, walk, site);
    if (!base.ok) return base;
    const replay = walk.replaying(from);
    const upgraded = lowerSentence(sentence.upgraded, replay, site);
    if (!upgraded.ok) return upgraded;
    if (replay.targets.consumed() !== walk.targets.requirements().length)
        return unlowerable(
            "the replacement does not name every target its base effect did (CR 601.2c)"
        );
    const predicates: EffectPredicate[] = [];
    for (const condition of sentence.conditions) {
        const filter = countFilterOf(condition.filter);
        if (!filter.ok) return filter;
        predicates.push({
            left: {
                count: {
                    zone: "battlefield",
                    controller: "controller",
                    filter: filter.value,
                },
            },
            op: "ge",
            right: condition.atLeast,
        });
    }
    let script: EffectOp[] = upgraded.value;
    for (const predicate of [...predicates].reverse())
        script = [
            {
                op: "if",
                predicate,
                then: script,
                else: structuredClone(base.value),
            },
        ];
    return lowered(script);
}

/**
 * A controls clause's `PermanentFilter` as the `count` construct's
 * `EffectCardFilter` — the two members a condition emits today (CR 205.2a
 * types, CR 105.1 colours). Any other field is refused rather than dropped: a
 * dropped clause counts permanents the card does not mean.
 */
function countFilterOf(filter: PermanentFilter): Lowered<EffectCardFilter> {
    const out: EffectCardFilter = {};
    for (const [key, value] of Object.entries(filter)) {
        if (value === undefined) continue;
        if (key === "types") out.type = [...(value as CardType[])];
        else if (key === "colors") out.color = [...(value as Color[])];
        else
            return unlowerable(
                `a "${key}" clause has no resolution-time count here`
            );
    }
    return lowered(out);
}

/** A small count as the word Oracle text prints ("two"), for a prompt. */
function countWord(n: number): string {
    const words = [
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
    ];
    return words[n] ?? String(n);
}

/** Remember the announced object a sentence acted on (see `actedOn`). */
function recordActedOn(
    walk: SentenceWalk,
    subject: SubjectIR,
    op: EffectOp
): void {
    if (subject.kind !== "target") return;
    if (op.op === "destroy" || (op.op === "moveZone" && "target" in op))
        walk.actedOn = { op, requirement: subject.requirement };
}

/**
 * CR 111.1 — create creature tokens, lowered to `createToken` in the shape
 * every hand-written producer writes: the controller creates them (CR 111.2),
 * the name is the subtypes — a DEVIATION from CR 111.4, which appends the
 * word "Token", kept because it is the catalogue's convention for every
 * unnamed token and the key `token-prints.json` art is looked up by (a name
 * is never read to decide anything here: no card in this form names its own
 * token) — and the art is NOT pinned on the spec: the runtime resolves
 * it per producer from `token-prints.json` (`tokenPrintIdFor`), and the
 * compiled pool's art-completeness guard (`tokenPrintLookup.test.ts`) holds
 * every compiled producer to it.
 *
 * "where X is that <noun>'s mana value" (CR 202.3) reads the object the
 * sentence before acted on, snapshotted by that Op's `bind` before it left
 * the battlefield (CR 608.2h) — the Artifact Mutation shape. A noun that is
 * not the announced object's type names an object we cannot point at.
 */
function lowerCreateToken(
    sentence: Extract<EffectSentenceIR, { kind: "create-token" }>,
    walk: SentenceWalk
): Lowered<EffectOp[]> {
    const { token, count } = sentence;
    // CR 702.1 — a keyword the engine does not implement is a token that
    // silently lacks it (Guard A, #962).
    if (token.keyword !== null && token.keyword.status !== "implemented")
        return unlowerable(
            `the token's keyword "${token.keyword.ability}" is not implemented`
        );
    const spec: EffectTokenSpec = {
        name: token.subtypes.join(" "),
        types: ["Creature"],
        subtypes: [...token.subtypes],
        power: token.power,
        toughness: token.toughness,
        colors: [...token.colors],
    };
    if (token.keyword !== null) spec.staticAbilities = [token.keyword.ability];
    const op: Extract<EffectOp, { op: "createToken" }> = {
        op: "createToken",
        token: spec,
        controller: "controller",
    };
    if (count.kind === "fixed") {
        if (count.value !== 1) op.count = count.value;
        return lowered([op]);
    }
    const actedOn = walk.actedOn;
    if (actedOn === null)
        return unlowerable(
            `"that ${count.noun}" names no object acted on before it (CR 608.2h)`
        );
    const type = actedOn.requirement.type;
    if (typeof type !== "string" || type.toLowerCase() !== count.noun)
        return unlowerable(
            `"that ${count.noun}" is not the ${JSON.stringify(type)} acted on before it`
        );
    const bind = actedOn.op.bind ?? walk.nextBind("that");
    actedOn.op.bind = bind;
    op.count = { ref: `${bind}.manaValue` };
    return lowered([op]);
}

/**
 * CR 702.33d / 702.33f — the value a kicked gate reads.
 *
 * "Kicked" (CR 702.33d) is "any of that spell's kicker costs" paid, which is
 * the stack item's whole kicker tally — `{ kickerCount: true }`, the reading
 * the hand-written catalogue uses for the phrase. "Kicked with its {A}
 * kicker" (CR 702.33f) names ONE of two or more kicker costs by its printed
 * cost, and reads that kicker's own payment record. A cost that matches no
 * kicker, or more than one, is a sentence linked to nothing we can name.
 */
export function kickedValue(
    kicked: KickedRefIR,
    kickers: readonly KickerCost[]
): Lowered<EffectValue> {
    if (kickers.length === 0)
        return unlowerable(
            "a kicked condition on a card that prints no kicker (CR 702.33e)"
        );
    if (kicked.kind === "any") return lowered({ kickerCount: true });
    if (kickers.length < 2)
        return unlowerable(
            'only a card with two or more kicker costs names "its [A] kicker" (CR 702.33f)'
        );
    const printed = manaKey(kicked.mana);
    const named = kickers.filter(
        (k) => k.mana !== undefined && manaKey(k.mana) === printed
    );
    if (named.length !== 1)
        return unlowerable(
            `"its kicker" names ${named.length} of this card's kicker costs (CR 702.33f)`
        );
    return lowered({ additionalCostPaid: named[0]!.id });
}

/** A key-order-insensitive identity for a fixed `ManaCost` (no nested pips). */
function manaKey(mana: ManaCost): string {
    return JSON.stringify(
        Object.entries(mana).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
}

/**
 * CR 401.4 — look at (CR 701.20a: or reveal) the top of your library and route
 * it: `lookDistribute`, the Op every hand-written card of this shape uses.
 *
 * "Put all <Subtype> cards revealed this way into your hand" keeps EVERY
 * matching card: `take` is the whole window and `optional: false`, so the
 * clamp to the matching count (`lookDistribute` keeps at most the filtered
 * cards) makes the keep exactly "all of them". "Put <N> of them" is a pick of
 * N. The rest go to the bottom in the owner's chosen order (CR 401.4) by
 * default, in a random order (`randomBottom`), or to the graveyard.
 */
function lowerLookDistribute(
    sentence: Extract<EffectSentenceIR, { kind: "look-distribute" }>,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const look = lowerAmount(sentence.count, site);
    if (!look.ok) return look;
    const route = sentence.route;
    if (route.kind === "all-of-subtype")
        return lowered([
            {
                op: "lookDistribute",
                player: "controller",
                look: look.value,
                take: look.value,
                keepTo: "hand",
                filter: { subtype: route.subtype },
                optional: false,
                reveal: "window",
            },
        ]);
    const take = lowerAmount(route.count, site);
    if (!take.ok) return take;
    const op: Extract<EffectOp, { op: "lookDistribute" }> = {
        op: "lookDistribute",
        keepTo: "hand",
        player: "controller",
        look: look.value,
        take: take.value,
    };
    if (route.rest === "graveyard") op.destination = "graveyard";
    if (route.rest === "bottom-random-order") op.randomBottom = true;
    return lowered([op]);
}

/**
 * CR 400.6 — a zone change of an object already in play.
 *
 * Only the destinations whose `moveZone` shape is unambiguous are lowered.
 * "to the top of your library" and "to the battlefield" both exist in the
 * engine but read a DIFFERENT source zone than the one this sentence implies,
 * and guessing the source is how a recursion effect becomes a reanimation one.
 */
function lowerMoveZone(
    subject: SubjectIR,
    zone: ZoneRefIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectOp[]> {
    // CR 400.7e — "return that card to its owner's hand": the card the site's
    // zone change put into a graveyard. Only the hand is read — the one
    // destination a printed line asks for — so no other zone pair is claimed.
    if (subject.kind === "that-card") {
        const card = site.antecedents?.card;
        if (card === undefined)
            return unlowerable('"that card" names no card at this site');
        if (zone.zone !== "hand" || zone.owner !== "its-owner")
            return unlowerable(
                '"that card" is returned only to its owner\'s hand in grammar v0'
            );
        return lowered([{ op: "moveZone", target: card, to: "hand" }]);
    }
    const target = objectSelector(subject, slots);
    if (!target.ok) return target;
    if (zone.zone === "hand" && zone.owner === "its-owner")
        return lowered([{ op: "moveZone", target: target.value, to: "hand" }]);
    if (zone.zone === "graveyard" && zone.owner === "its-owner")
        return lowered([
            { op: "moveZone", target: target.value, to: "graveyard" },
        ]);
    if (zone.zone === "exile")
        return lowered([{ op: "moveZone", target: target.value, to: "exile" }]);
    return unlowerable(
        `"${zone.zone}" is not a zone destination in grammar v0`
    );
}

/**
 * Declare the announced targets on the ability (CR 601.2c).
 *
 * Exported, and taking the requirement list as a PARAMETER rather than reading
 * `slots` from the closure, for the reason `routeLineWith` gives one directory
 * over: `TargetSlots.allocate` already refuses the second allocation, so no
 * input to `lowerActivatedAbility` can reach the >1 branch today. A refusal no
 * test can enter is a refusal nobody has watched hold — and this one is the
 * second, independent line of defence, the one that decides what happens if
 * `allocate` ever stops being the first. Injecting the list makes the branch
 * reachable now rather than when #2698's anaphora work allocates twice.
 *
 * >1 is UNLOWERABLE, not a silent drop: the ops already reference `{target: 0}`
 * and `{target: 1}` positionally, so dropping the requirements would emit a
 * definition whose script points at targets nothing declares. An unparsed card
 * costs nothing; a dangling target ref is a card that is broken on the stack.
 */
export function declareTargets(
    ability: { targetRequirement?: TargetRequirement },
    requirements: readonly TargetRequirement[]
): string | null {
    if (requirements.length > 1)
        return `${requirements.length} targets were announced but grammar v0 declares at most one (CR 601.2c)`;
    if (requirements.length === 1) ability.targetRequirement = requirements[0];
    return null;
}
