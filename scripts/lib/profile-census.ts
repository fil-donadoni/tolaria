// Profile Census seed validator — the mechanical half of the
// `.claude/skills/profile-census/` contract (PRD #8772): what a census pass
// may write into a checked-in Card Profile seed file, judged by comparing the
// file BEFORE the pass with the file AFTER it.
//
// Pure and offline: no git, no network, no database. The CLI
// (`scripts/profile-census-check.ts`) reads the two files and hands them
// here; the tests hand fixtures. The rules:
//
//   1. A `reviewed: true` row is the human's: the census never changes it,
//      never deletes it, never writes one. A row the pass wrote or changed
//      ships `reviewed: false`.
//   2. Every row the pass wrote or changed carries a census rationale
//      (`censusRationaleErrors`, `convex/limited/cardProfilesCore.ts`).
//   3. Every id in the AFTER file is registered: a Capability in
//      `CAPABILITY_REGISTRY`, an Archetype in the catalogue seed, a card id a
//      real card — the same validators the seed guards run, so the census
//      and CI can never disagree on a legal row.
//   4. The census writes tags, never Combo Edges (their own PRD #8414).
//   5. A delta pass (`rows`) changes only the tags it names: on every row it
//      touches, the tags outside `rows` are exactly the BEFORE tags.
import {
    censusRationaleErrors,
    validateCardArchetypeFile,
    validateCardCapabilityFile,
    type CardArchetypeFile,
    type CardArchetypes,
    type CardCapabilities,
    type CardCapabilityFile,
} from "../../convex/limited/cardProfilesCore";

export type CensusLayer = "capabilities" | "archetypes";

/** One census write to check. `before` is `null` for a scope that had no
 *  seed file yet. `rows` set = a delta pass. */
export type CensusWrite =
    | {
          layer: "capabilities";
          before: CardCapabilityFile | null;
          after: CardCapabilityFile;
          rows?: readonly string[];
      }
    | {
          layer: "archetypes";
          before: CardArchetypeFile | null;
          after: CardArchetypeFile;
          rows?: readonly string[];
      };

type Row = CardCapabilities | CardArchetypes;

/** A row's tags as `<field>:<id>` strings — `provides:x` and `requires:x`
 *  are different facts, so a delta that moves `x` across sides changes it. */
function tagsOf(layer: CensusLayer, row: Row | undefined): Set<string> {
    if (row === undefined) return new Set();
    if (layer === "archetypes") {
        return new Set(
            (row as CardArchetypes).archetypes.map((a) => `archetypes:${a}`)
        );
    }
    const caps = row as CardCapabilities;
    return new Set([
        ...caps.provides.map((c) => `provides:${c}`),
        ...caps.requires.map((c) => `requires:${c}`),
    ]);
}

/** Order-insensitive structural equality over the plain JSON a seed row is. */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) =>
        v !== null && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(
                  Object.entries(v as Record<string, unknown>).sort(
                      ([a], [b]) => a.localeCompare(b)
                  )
              )
            : v
    );
}

function rowsOf(layer: CensusLayer, file: CensusWrite["after"] | null) {
    if (file === null) return {} as Record<string, Row>;
    return layer === "capabilities"
        ? (file as CardCapabilityFile).capabilities
        : (file as CardArchetypeFile).archetypes;
}

/** Every reason this census write must be refused, or `[]`. Pure. */
export function censusWriteErrors(write: CensusWrite): string[] {
    const { layer } = write;
    const errors =
        write.layer === "capabilities"
            ? validateCardCapabilityFile(write.after).errors
            : validateCardArchetypeFile(write.after).errors;
    if (
        write.layer === "archetypes" &&
        write.before !== null &&
        write.before.scope !== write.after.scope
    ) {
        errors.push(
            `scope changed from "${write.before.scope}" to "${write.after.scope}"`
        );
    }
    const before = rowsOf(layer, write.before);
    const after = rowsOf(layer, write.after);
    const delta = write.rows === undefined ? null : new Set<string>(write.rows);

    for (const [cardId, old] of Object.entries(before)) {
        if (!old.reviewed) continue;
        const now = after[cardId];
        if (now === undefined) {
            errors.push(`"${cardId}": the census deleted a reviewed row`);
        } else if (canonical(now) !== canonical(old)) {
            errors.push(`"${cardId}": the census wrote onto a reviewed row`);
        }
    }

    const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const cardId of ids) {
        const old = before[cardId];
        const now = after[cardId];
        if (old?.reviewed) continue; // rule 1 above already judged it
        if (now !== undefined && canonical(now) !== canonical(old)) {
            if (now.reviewed) {
                errors.push(
                    `"${cardId}": the census wrote reviewed: true — only a human reviews`
                );
            }
            for (const error of censusRationaleErrors(now.rationale)) {
                errors.push(`"${cardId}": ${error}`);
            }
            if (
                layer === "capabilities" &&
                canonical((now as CardCapabilities).comboEdges ?? []) !==
                    canonical(
                        (old as CardCapabilities | undefined)?.comboEdges ?? []
                    )
            ) {
                errors.push(
                    `"${cardId}": the census wrote a Combo Edge — it writes tags only`
                );
            }
        }
        if (delta !== null) {
            const was = tagsOf(layer, old);
            const is = tagsOf(layer, now);
            for (const tag of new Set([...was, ...is])) {
                if (was.has(tag) === is.has(tag)) continue;
                const id = tag.slice(tag.indexOf(":") + 1);
                if (!delta.has(id)) {
                    errors.push(
                        `"${cardId}": the delta changed ${tag}, outside its rows (${[...delta].join(", ")})`
                    );
                }
            }
        }
    }
    return errors;
}
