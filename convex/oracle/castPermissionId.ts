/**
 * The IDENTITY of a board cast permission (CR 601.3 / 118.9) — issue #3268.
 *
 * Every other static id in this codebase is card-scoped (`<card>-<what>`),
 * because every other static is a private handle: nothing outside the card
 * reads it. `StaticCastPermission.id` is not that. `collectCastPermissions`
 * (`gre/castPermissions.ts`) deduplicates by the BARE id across BOTH
 * battlefields, so the id names the OFFERED CAST OPTION rather than the card
 * offering it — and CR 118.9a says a caster announces one alternative cost,
 * not one per permanent granting the same one. Three cards printing "You may
 * cast creature spells as though they had flash." must therefore collapse to
 * ONE entry in the cast picker and ONE branch in the Bot's enumeration; a
 * card-scoped id would show three.
 *
 * So the id is DERIVED FROM THE CLAUSE. Same permission, same id, whichever
 * card prints it.
 *
 * ── Why a digest and not a readable slug ──────────────────────────────────
 *
 * A slug builder has to enumerate the fields it renders, and the day
 * `EffectCardFilter` grows one the builder forgets, two DIFFERENT permissions
 * share an id. Under a dedupe keyed on that id the consequence is not an
 * error — it is the SILENT SUPPRESSION of the second permission, the same
 * fail-open shape `EffectCardFilter` itself was bitten by. A digest over the
 * whole of {@link CastPermissionTerms} cannot forget a field: a new field
 * changes the digest by itself.
 *
 * The readable prefix in front of it (`any-player-creature-…`) is cosmetic —
 * it makes a log line legible and it cannot cause a collision, because the
 * digest that follows it is computed over everything.
 *
 * ── Canonicalised, so one permission has one id ───────────────────────────
 *
 * The terms are serialized through the SAME two canonicalisers the gold
 * harness compares definitions with (`gates.ts`): `sortKeys` for key ORDER,
 * `canonicaliseShorthands` for the "single X is shorthand for one X" fields.
 * Without the second, a hand-written `type: "Creature"` and the compiler's
 * `type: ["Creature"]` are the same filter with two different ids — which is
 * exactly the split identity this module exists to prevent, arriving through
 * a spelling difference instead of a forgotten field.
 *
 * ── A card still writes its id as a LITERAL ───────────────────────────────
 *
 * Cards are DATA (ADR 0045): a definition that called this function would make
 * the compiler round trip a tautology — both sides computing the same value
 * proves nothing about whether the compiler READ the sentence. The literal is
 * asserted against this derivation catalogue-wide instead, by
 * `cards/__tests__/castPermissionIds.test.ts`.
 */

import type { EffectCardFilter, StaticCastPermission } from "../cards/types";
import { fnv1a32 } from "../lib/hash";
import { canonicaliseShorthands, sortKeys } from "./gates";

/**
 * A permission's TERMS — everything the id is derived from.
 *
 * Two fields are out, and only two. `id`, because deriving an id from a value
 * containing itself is circular. And `label`, because it is UI COPY (issue
 * #3284): the short row name the cast picker shows instead of the printed
 * paragraph, which an author writes and no grammar can derive. Folding a
 * card-scoped label into a clause-scoped identity would stop two cards
 * offering the SAME permission under different copy from collapsing to one
 * cast option, which is the whole point of deriving the id at all.
 *
 * `oracleText` stays IN, and the split #3284 made is what lets it: it is the
 * printed sentence, card data, and the compiler emits exactly the sentence it
 * read. Two cards printing one permission print one sentence.
 *
 * Everything else is in, by construction rather than by enumeration.
 */
export type CastPermissionTerms = Omit<StaticCastPermission, "id" | "label">;

/** The terms of a declared permission — see {@link CastPermissionTerms}. */
export function castPermissionTerms(
    permission: StaticCastPermission
): CastPermissionTerms {
    // Copy-then-delete rather than a rest destructure: the terms must be
    // "everything the permission carries EXCEPT those two", so a field added
    // to `StaticCastPermission` later is part of the digest without an edit
    // here — the same fail-closed shape `expandCompiledStatics` uses one field
    // over.
    const terms: CastPermissionTerms & { id?: string; label?: string } = {
        ...permission,
    };
    delete terms.id;
    delete terms.label;
    return terms;
}

/** A filter field as a slug fragment: lowercase, non-alphanumerics folded. */
function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * The class name the readable prefix shows — the filter's first card type,
 * else its first subtype, else `spell`.
 *
 * Recurses into `any[]` (the OR-across-dimensions clause list a compound
 * sentence lowers to) so "creature and enchantment spells" reads as
 * `creature` rather than as the bare `spell` every compound would otherwise
 * collapse to. Cosmetic in every branch: the digest is what distinguishes.
 */
function primaryClass(filter: EffectCardFilter): string {
    const first = <T>(value: T | T[] | undefined): T | undefined =>
        Array.isArray(value) ? value[0] : value;
    const type = first(filter.type);
    if (type !== undefined) return slug(type);
    const subtype = first(filter.subtype);
    if (subtype !== undefined) return slug(subtype);
    for (const clause of filter.any ?? []) {
        const nested = primaryClass(clause);
        if (nested !== "spell") return nested;
    }
    return "spell";
}

/** The 32-bit digest, as eight lowercase hex characters. */
function digest(terms: CastPermissionTerms): string {
    const canonical = JSON.stringify(canonicaliseShorthands(sortKeys(terms)));
    return (fnv1a32(canonical) >>> 0).toString(16).padStart(8, "0");
}

/**
 * `<grantee>-<primary class>-<digest>` — the id a permission printing this
 * clause carries, on every card that prints it.
 */
export function deriveCastPermissionId(terms: CastPermissionTerms): string {
    return `${terms.grantee}-${primaryClass(terms.filter)}-${digest(terms)}`;
}
