// CR 608.2 (issue #5525) — the RESOLUTION CHECKPOINT of an object on
// the stack, lowered into a `ScenarioSpec` and rebuilt from one.
//
// An object partway through resolving carries two facts a declared stack did
// not use to hold: WHERE its body stopped (`StackItem.resolutionStep` — a
// `resolveSteps` index, or an Effect Script's pre-order Op position) and the
// ANSWERS already collected inside this resolution (`collectedChoices`, keyed
// `${step}:${choiceId}`, every value a flat `string[]`). The Pending Choice
// the position is suspended on is deliberately NOT declared: the engine's
// resume contract is "re-run the checkpointed Op, which reads its answer from
// `collectedChoices` or re-enqueues the same choice", so the rebuild replays
// the checkpoint and the choice regenerates with its live candidate list
// (`buildStateFromScenario` → `resolveTopOfStack`).
//
// The collected answers are where the ids live, and they are flat strings:
// a snapshot binding is `[power, toughness, controller, id, manaValue, owner,
// …]`, a picks binding is instance ids, a number binding a tagged numeral.
// Instance ids are plain numerals too (`allocInstanceId`), so a value can
// NEVER be classified by looking at it — "2" is a power or the second object
// allocated. Each entry is classified by the FAMILY of the binding its key
// names, read off the script's own declarations (`bindingDeclarationsOf`, the
// same authority the static validator types refs with). A key whose family
// this module cannot establish is refused BY NAME, never carried verbatim:
// a numeral copied across a rebuild that reassigns every id would read as a
// different object with nothing reporting it.

import type { CardDefinition, EffectOp } from "../cards/types";
import { tryGetDefinition } from "../cards";
import type { StackItem } from "./state";
import { bindingDeclarationsOf } from "./effects/validate";
import { childOpArrays } from "./ai/effectOpChildren";
import { SNAP_CONTROLLER, SNAP_ID, SNAP_OWNER } from "./effects/interpreter";
import type {
    ScenarioEventValue,
    ScenarioObjectRef,
    ScenarioResolutionCheckpoint,
} from "../debugScenarioSpec";

/** The families a binding declaration can join (`validate.ts`'s
 *  `BindingKind`, read through the exported declaration row). */
type BindingFamily = ReturnType<
    typeof bindingDeclarationsOf
>[number]["binding"];

/** The two implicit snapshot bindings every Effect Script seeds on a fresh
 *  entry (`seedSourceBindings`): never declared by an Op, always a snapshot. */
const IMPLICIT_SNAPSHOT_BINDINGS = new Set(["$source", "$host"]);

/** Snapshot slots holding a PLAYER id (controller, owner — `""` when the
 *  snapshotted object had none) and the slot holding the snapshotted object's
 *  own id (an instance id for a permanent / card target, the PLAYER's id for a
 *  player target) — the interpreter's own layout constants, never a copy. */
const SNAPSHOT_PLAYER_SLOTS = new Set([SNAP_CONTROLLER, SNAP_OWNER]);
const SNAPSHOT_ID_SLOT = SNAP_ID;

export type CollectedAnswerLoweringPorts = {
    /** One live instance id → the spec's reference, or `undefined` when the
     *  spec cannot name the object (a refusal, never a dropped slot). */
    object: (instanceId: string) => ScenarioObjectRef | undefined;
    /** One live player id → its seat, or `undefined` for no such player. */
    player: (playerId: string) => "me" | "opp" | undefined;
};

export type CollectedAnswerRebuildPorts = {
    object: (ref: ScenarioObjectRef) => string;
    player: (seat: "me" | "opp") => string;
};

export type ResolutionCheckpointLowering =
    | { ok: true; checkpoint: ScenarioResolutionCheckpoint }
    | {
          /** Every blocking fact, in the stack blocker's `field` vocabulary:
           *  `collectedChoices:<key>` per answer the spec cannot carry. */
          ok: false;
          fields: string[];
      };

/** The Effect Script an object on the stack resolves through, read off its
 *  definition: the card's own for a spell, the named ability's for an
 *  activated or triggered ability. `undefined` for an imperative body, a
 *  granted or engine-synthesised ability, or a definition the catalogue does
 *  not hold — whose collected answers then have no declared family and refuse
 *  (only the implicit snapshots still lower). A chosen MODE's script is not
 *  looked up: `chosenModeId` is stack residue and refuses the item upstream. */
export function effectScriptOfStackItem(
    item: StackItem
): EffectOp[] | undefined {
    const cardId = (item.card as { id?: string }).id;
    const def: CardDefinition | undefined = cardId
        ? (tryGetDefinition(cardId) ?? undefined)
        : undefined;
    if (!def) return undefined;
    if (item.abilityId !== undefined) {
        return def.activatedAbilities?.find((a) => a.id === item.abilityId)
            ?.effects;
    }
    if (item.triggeredAbilityId !== undefined) {
        return def.triggeredAbilities?.find(
            (a) => a.id === item.triggeredAbilityId
        )?.effects;
    }
    return def.effects;
}

/** Every binding name a script declares, anywhere in its nested tree, with
 *  the family its declaring Op gives it. A name declared twice under two
 *  families (legal across sibling scopes) is recorded as ambiguous and
 *  refused like an unknown one — the key does not say which Op wrote it. */
export function collectedAnswerFamilies(
    script: readonly EffectOp[] | undefined
): Map<string, BindingFamily | "ambiguous"> {
    const families = new Map<string, BindingFamily | "ambiguous">();
    const walk = (ops: readonly EffectOp[]): void => {
        for (const op of ops) {
            const record = op as unknown as Record<string, unknown>;
            for (const declaration of bindingDeclarationsOf(op.op)) {
                const name = record[declaration.field];
                if (typeof name !== "string") continue;
                const known = families.get(name);
                families.set(
                    name,
                    known === undefined || known === declaration.binding
                        ? declaration.binding
                        : "ambiguous"
                );
            }
            for (const child of childOpArrays(op)) walk(child);
        }
    };
    if (script) walk(script);
    return families;
}

/** `${step}:${choiceId}` → the choice id (which may itself contain `:`). */
function choiceIdOfKey(key: string): string {
    const colon = key.indexOf(":");
    return colon === -1 ? key : key.slice(colon + 1);
}

/**
 * Lower one checkpointed stack item's resolution state. `item` is the TOP of
 * the stack with `resolutionStep` set (the caller's precondition — CR 608.1,
 * only the top object resolves); every collected answer is classified by its
 * key's binding family and lowered slot by slot, or the whole checkpoint
 * refuses, naming each key it could not carry.
 */
export function lowerResolutionCheckpoint(
    item: StackItem,
    ports: CollectedAnswerLoweringPorts
): ResolutionCheckpointLowering {
    const step = item.resolutionStep;
    if (step === undefined) return { ok: false, fields: ["resolutionStep"] };
    const families = collectedAnswerFamilies(effectScriptOfStackItem(item));
    const collected: Record<string, ScenarioEventValue[]> = {};
    const fields: string[] = [];
    for (const [key, values] of Object.entries(
        item.collectedChoices ?? {}
    ).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const lowered = lowerAnswer(key, values, families, ports);
        if (lowered === undefined) fields.push(`collectedChoices:${key}`);
        else collected[key] = lowered;
    }
    if (fields.length > 0) return { ok: false, fields };
    return {
        ok: true,
        checkpoint: {
            step,
            ...(Object.keys(collected).length > 0 ? { collected } : {}),
        },
    };
}

function lowerAnswer(
    key: string,
    values: string[],
    families: Map<string, BindingFamily | "ambiguous">,
    ports: CollectedAnswerLoweringPorts
): ScenarioEventValue[] | undefined {
    // An EMPTY answer carries no id whatever its family: a barred pick
    // (`choiceFeedsBarredAction`), a `choice` that found nothing to offer.
    if (values.length === 0) return [];
    const choiceId = choiceIdOfKey(key);
    const family = IMPLICIT_SNAPSHOT_BINDINGS.has(choiceId)
        ? "snapshot"
        : families.get(choiceId);
    const scalar = (value: string): ScenarioEventValue => ({
        kind: "scalar",
        value,
    });
    const player = (value: string): ScenarioEventValue | undefined => {
        if (value === "") return scalar(value);
        const seat = ports.player(value);
        return seat ? { kind: "player", seat } : undefined;
    };
    const object = (value: string): ScenarioEventValue | undefined => {
        const ref = ports.object(value);
        return ref ? { kind: "object", ref } : undefined;
    };
    switch (family) {
        case "snapshot": {
            const out: ScenarioEventValue[] = [];
            for (const [slot, value] of values.entries()) {
                const lowered = SNAPSHOT_PLAYER_SLOTS.has(slot)
                    ? player(value)
                    : slot === SNAPSHOT_ID_SLOT
                      ? (object(value) ?? player(value))
                      : scalar(value);
                if (lowered === undefined) return undefined;
                out.push(lowered);
            }
            return out;
        }
        case "picks": {
            const out: ScenarioEventValue[] = [];
            for (const value of values) {
                const lowered = object(value);
                if (lowered === undefined) return undefined;
                out.push(lowered);
            }
            return out;
        }
        case "player": {
            const out: ScenarioEventValue[] = [];
            for (const value of values) {
                const lowered = player(value);
                if (lowered === undefined) return undefined;
                out.push(lowered);
            }
            return out;
        }
        case "number":
        case "boolean":
            return values.map(scalar);
        // `list` / `iterated` have no per-entry shape this module can vouch
        // for; an unknown or ambiguous name has no family at all. All refuse.
        default:
            return undefined;
    }
}

/** The inverse: every declared answer back to the engine's flat `string[]`,
 *  with each reference resolved against the REBUILT board. A declared kind
 *  this store never writes (`objects`, `target`) is a spec no lowering
 *  produced, and throws. */
export function rebuildCollectedChoices(
    declared: ScenarioResolutionCheckpoint,
    ports: CollectedAnswerRebuildPorts
): Record<string, string[]> | undefined {
    if (!declared.collected) return undefined;
    const out: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(declared.collected)) {
        out[key] = values.map((value) => {
            switch (value.kind) {
                case "scalar":
                    return String(value.value);
                case "player":
                    return ports.player(value.seat);
                case "object":
                    return ports.object(value.ref);
                default:
                    throw new Error(
                        `buildStateFromScenario: the collected answer "${key}" declares a "${value.kind}" value, which a resolution checkpoint never carries.`
                    );
            }
        });
    }
    return out;
}
