// Draft Signal read (PRD #1616, ADR 0134, issue #3736): what the packs coming
// back to a seat say about the seats upstream of it. A pack that reaches a seat
// with N cards already removed has been picked over by the seats between it and
// the pack's origin; if blue power is still plentiful in it, nobody upstream
// wanted blue.
//
// Pure data, no registry and no Convex: the card facts (`power`, colours,
// archetypes) are injected as `GetSignalFacts`, so the Draft Lab, the replay
// and a future live path share the ONE fold. The read is a property of the
// packs alone — it never looks at the seat's Pool; the Pool only decides how
// much the scorer trusts it (`botDrafter.ts`, `settledness`).
//
// Per passing direction (`passDirection`, CR-free draft convention) there is
// one accumulator per colour and one per Archetype id. Per pack and axis value:
//
//   (share of the pack's remaining power on that value − expected share)
//     × cards removed upstream
//
// An untouched pack (nothing removed) weighs 0. Expected share is COMPUTED from
// the pack generator config (variant weight × slot count × sheet card weight),
// uniform over the pool for a cube — never authored.
import type { Color } from "../cards/types";
import { ARCHETYPE_REGISTRY } from "./archetypeRegistry";
import type { BoosterConfig } from "./boosterTypes";
import { isCubeSource } from "./cubeSource";
import type { DraftPackCard } from "./eventTypes";

/** The five colours a Draft Signal tracks. Colourless is no axis value. */
export const SIGNAL_COLOURS = ["W", "U", "B", "R", "G"] as const;
export type SignalColour = (typeof SIGNAL_COLOURS)[number];

/** Pass direction of a booster round (`draftEngine.ts#passDirection`). */
export type SignalDirection = 1 | -1;

/** What the fold needs to know about one card. `power` is the context-free
 *  base term (`baseRating`), never a contextual score. */
export interface CardSignalFacts {
    power: number;
    /** Colour identity; a multicolour card splits its power evenly across
     *  these, a colourless card (empty) contributes to no colour. */
    colours: readonly Color[];
    /** Archetype ids from the Card Profile; empty without a profile. */
    archetypes: readonly string[];
}

/** Resolves a pack card's `scryfallId` to its facts, or `null` if unresolvable. */
export type GetSignalFacts = (scryfallId: string) => CardSignalFacts | null;

/** Per-axis-value accumulators of one passing direction. */
export interface SignalAxes {
    colour: Partial<Record<SignalColour, number>>;
    archetype: Record<string, number>;
}

/** The Draft Signal read: one `SignalAxes` per passing direction. */
export interface DraftSignalRead {
    left: SignalAxes;
    right: SignalAxes;
}

/** Expected power share of each axis value in a fresh pack of one source. */
export interface ExpectedShares {
    colour: Record<SignalColour, number>;
    archetype: Record<string, number>;
}

export function emptyAxes(): SignalAxes {
    return { colour: {}, archetype: {} };
}

export function emptyDraftSignalRead(): DraftSignalRead {
    return { left: emptyAxes(), right: emptyAxes() };
}

function axesFor(read: DraftSignalRead, direction: SignalDirection) {
    return direction === 1 ? read.left : read.right;
}

/** Power each axis value holds in a set of cards (colour split evenly). */
function powerByAxis(
    cards: readonly { facts: CardSignalFacts; weight: number }[]
): {
    colour: Record<SignalColour, number>;
    archetype: Record<string, number>;
    total: number;
} {
    const colour = Object.fromEntries(
        SIGNAL_COLOURS.map((c) => [c, 0])
    ) as Record<SignalColour, number>;
    const archetype: Record<string, number> = {};
    let total = 0;
    for (const { facts, weight } of cards) {
        const power = facts.power * weight;
        total += power;
        const colours = facts.colours.filter((c): c is SignalColour =>
            (SIGNAL_COLOURS as readonly string[]).includes(c)
        );
        for (const c of colours) colour[c] += power / colours.length;
        for (const a of facts.archetypes) {
            archetype[a] = (archetype[a] ?? 0) + power;
        }
    }
    return { colour, archetype, total };
}

function toShares(p: ReturnType<typeof powerByAxis>): ExpectedShares {
    const div = p.total > 0 ? p.total : 1;
    const colour = Object.fromEntries(
        SIGNAL_COLOURS.map((c) => [c, p.colour[c] / div])
    ) as Record<SignalColour, number>;
    const archetype: Record<string, number> = {};
    for (const [a, v] of Object.entries(p.archetype)) archetype[a] = v / div;
    return { colour, archetype };
}

/** Expected shares for ONE pack source, derived from the generator config:
 *  each card's expected presence is (variant weight / total) × slot count ×
 *  (card weight / sheet total weight); a cube is uniform over its pool.
 *  `null` when the source has nothing to derive from (no config, empty pool). */
export function computeExpectedShares(
    sourceKey: string,
    getConfig: (setCode: string) => BoosterConfig | null,
    cubePool: readonly string[] | undefined,
    getFacts: GetSignalFacts
): ExpectedShares | null {
    const weighted: { facts: CardSignalFacts; weight: number }[] = [];
    if (isCubeSource(sourceKey)) {
        for (const id of cubePool ?? []) {
            const facts = getFacts(id);
            if (facts) weighted.push({ facts, weight: 1 });
        }
    } else {
        const config = getConfig(sourceKey);
        if (!config || config.boostersTotalWeight <= 0) return null;
        const presence = new Map<string, number>();
        for (const variant of config.boosters) {
            const variantP = variant.weight / config.boostersTotalWeight;
            for (const [sheetName, count] of Object.entries(variant.contents)) {
                const sheet = config.sheets[sheetName];
                if (!sheet || sheet.totalWeight <= 0) continue;
                for (const [id, w] of Object.entries(sheet.cards)) {
                    presence.set(
                        id,
                        (presence.get(id) ?? 0) +
                            variantP * count * (w / sheet.totalWeight)
                    );
                }
            }
        }
        for (const [id, weight] of presence) {
            const facts = getFacts(id);
            if (facts) weighted.push({ facts, weight });
        }
    }
    if (weighted.length === 0) return null;
    const p = powerByAxis(weighted);
    return p.total > 0 ? toShares(p) : null;
}

/** Context the fold needs beyond the pack itself. */
export interface PackSignalContext {
    /** Passing direction of the round the pack was received in. */
    direction: SignalDirection;
    /** Cards removed upstream: pack size at deal minus current size. */
    removedUpstream: number;
}

/** Folds one received pack into the read. Pure; returns a new read. */
export function foldPackIntoRead(
    read: DraftSignalRead,
    pack: readonly DraftPackCard[],
    context: PackSignalContext,
    expected: ExpectedShares | null,
    getFacts: GetSignalFacts
): DraftSignalRead {
    if (!expected || context.removedUpstream <= 0) return read;
    const cards = pack.flatMap((c) => {
        const facts = getFacts(c.scryfallId);
        return facts ? [{ facts, weight: 1 }] : [];
    });
    const p = powerByAxis(cards);
    if (p.total <= 0) return read;
    const shares = toShares(p);
    const w = context.removedUpstream;

    const prev = axesFor(read, context.direction);
    const colour = { ...prev.colour };
    for (const c of SIGNAL_COLOURS) {
        colour[c] =
            (colour[c] ?? 0) + (shares.colour[c] - expected.colour[c]) * w;
    }
    const archetype = { ...prev.archetype };
    // Every registered Archetype is an axis value, so a pack with none of it
    // left (share 0) correctly reads as "taken".
    const ids = new Set([
        ...ARCHETYPE_REGISTRY.map((r) => r.id),
        ...Object.keys(shares.archetype),
    ]);
    for (const a of ids) {
        archetype[a] =
            (archetype[a] ?? 0) +
            ((shares.archetype[a] ?? 0) - (expected.archetype[a] ?? 0)) * w;
    }
    const next: SignalAxes = { colour, archetype };
    return context.direction === 1
        ? { left: next, right: read.right }
        : { left: read.left, right: next };
}

/** One seat's running Draft Signal state: the read plus, per round, the size
 *  of the first pack the seat saw (its own, untouched — the pack size at deal). */
export interface SeatSignalState {
    read: DraftSignalRead;
    dealtSizeByRound: Readonly<Record<number, number>>;
}

export function emptySeatSignalState(): SeatSignalState {
    return { read: emptyDraftSignalRead(), dealtSizeByRound: {} };
}

/** Observes the pack a seat is about to pick from in `round` (0-based),
 *  deriving `removedUpstream` from the first pack it saw that round. */
export function observePack(
    state: SeatSignalState,
    pack: readonly DraftPackCard[],
    round: number,
    direction: SignalDirection,
    expected: ExpectedShares | null,
    getFacts: GetSignalFacts
): SeatSignalState {
    const dealt = state.dealtSizeByRound[round] ?? pack.length;
    return {
        read: foldPackIntoRead(
            state.read,
            pack,
            { direction, removedUpstream: Math.max(0, dealt - pack.length) },
            expected,
            getFacts
        ),
        dealtSizeByRound: { ...state.dealtSizeByRound, [round]: dealt },
    };
}

/** Weight of the direction opposite to the current round's. */
export const OTHER_DIRECTION_WEIGHT = 0.5;

/** The read of one axis value as the scorer sees it: current direction at full
 *  weight, the other direction reduced. */
export function effectiveSignal(
    read: DraftSignalRead,
    current: SignalDirection,
    axis: "colour" | "archetype",
    value: string
): number {
    const get = (a: SignalAxes) =>
        axis === "colour"
            ? (a.colour[value as SignalColour] ?? 0)
            : (a.archetype[value] ?? 0);
    const other = current === 1 ? read.right : read.left;
    return get(axesFor(read, current)) + OTHER_DIRECTION_WEIGHT * get(other);
}

/** What a scorer needs from a seat's Draft Signal. */
export interface DraftSignalInput {
    read: DraftSignalRead;
    /** Passing direction of the round being picked in. */
    direction: SignalDirection;
}
