import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth, getCurrentUserId } from "./auth";
import type { Doc, Id } from "./_generated/dataModel";
import { foldCardName } from "./cards/textNormalize";

/**
 * Preferred printing per card (issue #8755): the Print ID a user picked for a
 * card in the deck builder's results grid, keyed to the authenticated user and
 * the folded card name (`foldCardName`). `listMyCardPrints` feeds the whole
 * grid from ONE subscription; `setMyCardPrint` upserts one card's row.
 *
 * A preference is presentation only: it picks which printing a result cell
 * shows and adds. The client falls back to `defaultEdition` when the preferred
 * printing's Set is outside the Format's allowed Sets or an active Set filter,
 * and deck legality stays server-side (ADR 0140) — nothing here is trusted by
 * deck validation.
 *
 * As in `userSettings.ts`, the handlers are thin passthroughs to pure
 * functions the test file drives directly (no convex-test harness).
 */

/** The grid reads every preference in one query; the bound keeps it a
 *  bounded read (Convex guidelines) far above any real collection. */
export const MAX_CARD_PRINT_PREFERENCES = 5000;

/** Argument caps: a Scryfall UUID is 36 characters, a Set code a handful, the
 *  longest printed card name well under 200. */
const MAX_CARD_NAME_LENGTH = 200;
const MAX_PRINT_ID_LENGTH = 64;
const MAX_SET_CODE_LENGTH = 16;

export type CardPrintPreference = {
    cardKey: string;
    printId: string;
    setCode: string;
};

const cardPrintPreferenceValidator = v.object({
    cardKey: v.string(),
    printId: v.string(),
    setCode: v.string(),
});

/** Strips a stored row down to the wire shape. */
export function projectCardPrintPreference(
    row: Doc<"userCardPrints">
): CardPrintPreference {
    return { cardKey: row.cardKey, printId: row.printId, setCode: row.setCode };
}

/** Validates the mutation's arguments and folds the card name into its key.
 *  Throws on an empty or oversized field. */
export function normalizeCardPrintArgs(args: {
    cardName: string;
    printId: string;
    setCode: string;
}): CardPrintPreference {
    const cardKey = foldCardName(args.cardName);
    const printId = args.printId.trim();
    const setCode = args.setCode.trim().toLowerCase();
    if (cardKey === "" || args.cardName.length > MAX_CARD_NAME_LENGTH)
        throw new Error("Invalid card name");
    if (printId === "" || printId.length > MAX_PRINT_ID_LENGTH)
        throw new Error("Invalid print id");
    if (setCode === "" || setCode.length > MAX_SET_CODE_LENGTH)
        throw new Error("Invalid set code");
    return { cardKey, printId, setCode };
}

/** Patch the caller's existing row for this card, or insert one. Pure — the
 *  handler supplies only `ctx.db` I/O around this decision. */
export function resolveCardPrintWrite(
    existing: Doc<"userCardPrints"> | null,
    userId: Id<"users">,
    pref: CardPrintPreference
):
    | {
          kind: "patch";
          id: Id<"userCardPrints">;
          patch: { printId: string; setCode: string };
      }
    | { kind: "insert"; row: CardPrintPreference & { userId: Id<"users"> } }
    | { kind: "none" } {
    if (existing) {
        if (
            existing.printId === pref.printId &&
            existing.setCode === pref.setCode
        )
            return { kind: "none" };
        return {
            kind: "patch",
            id: existing._id,
            patch: { printId: pref.printId, setCode: pref.setCode },
        };
    }
    return { kind: "insert", row: { userId, ...pref } };
}

export const listMyCardPrints = query({
    args: {},
    returns: v.array(cardPrintPreferenceValidator),
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return [];
        const rows = await ctx.db
            .query("userCardPrints")
            .withIndex("by_user_and_card", (q) => q.eq("userId", userId))
            .take(MAX_CARD_PRINT_PREFERENCES);
        return rows.map(projectCardPrintPreference);
    },
});

export const setMyCardPrint = mutation({
    args: { cardName: v.string(), printId: v.string(), setCode: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        // Throws for an unauthenticated caller: no row is ever written
        // without an owner, and the owner is never a client argument.
        const userId = await getCurrentUserId(ctx);
        const pref = normalizeCardPrintArgs(args);
        const existing = await ctx.db
            .query("userCardPrints")
            .withIndex("by_user_and_card", (q) =>
                q.eq("userId", userId).eq("cardKey", pref.cardKey)
            )
            .unique();
        const write = resolveCardPrintWrite(existing, userId, pref);
        if (write.kind === "patch") {
            await ctx.db.patch(write.id, write.patch);
        } else if (write.kind === "insert") {
            await ctx.db.insert("userCardPrints", write.row);
        }
        return null;
    },
});
