import { useState } from "react";
import {
    archetypeCatalogueWriteErrors,
    type ArchetypeCatalogueRow,
} from "@convex/limited/archetypeCatalogueCore";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

interface CardProfilesCatalogueFormProps {
    mode: "create" | "edit";
    /** The row being edited; a blank template on create. */
    initial: ArchetypeCatalogueRow;
    catalogue: readonly ArchetypeCatalogueRow[];
    onSubmit: (row: ArchetypeCatalogueRow) => Promise<unknown>;
    onCancel: () => void;
}

/** Add-row / edit-row form of the Archetype Catalogue. It runs the SAME
 *  pure check the mutation runs (`archetypeCatalogueWriteErrors`) and shows
 *  every reason; the mutation's own refusal is shown too, so a write the
 *  client check missed never fails silently. An edit never renames: the id
 *  is the key Card Archetypes reference. */
export default function CardProfilesCatalogueForm({
    mode,
    initial,
    catalogue,
    onSubmit,
    onCancel,
}: CardProfilesCatalogueFormProps) {
    const [row, setRow] = useState(initial);
    const [errors, setErrors] = useState<string[]>([]);
    const [pending, setPending] = useState(false);

    async function submit() {
        const found = archetypeCatalogueWriteErrors(mode, row, catalogue);
        setErrors(found);
        if (found.length > 0) return;
        setPending(true);
        try {
            await onSubmit(row);
            onCancel();
        } catch (error) {
            setErrors([
                error instanceof Error ? error.message : "The write failed",
            ]);
        } finally {
            setPending(false);
        }
    }

    return (
        <form
            aria-label={mode === "create" ? "Add catalogue row" : "Edit row"}
            className="flex flex-col gap-2 rounded-sm border border-border-subtle/30 p-2 text-xs"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <label className="flex flex-col gap-1">
                Row id
                <Input
                    value={row.id}
                    disabled={mode === "edit" || pending}
                    placeholder="kebab-case-id"
                    onChange={(e) => setRow({ ...row, id: e.target.value })}
                />
            </label>
            <label className="flex flex-col gap-1">
                Description (TAG WHEN: … NOT: …)
                <Textarea
                    value={row.description}
                    disabled={pending}
                    onChange={(e) =>
                        setRow({ ...row, description: e.target.value })
                    }
                />
            </label>
            <label className="flex flex-col gap-1">
                Gloss: when
                <Input
                    value={row.gloss.when}
                    disabled={pending}
                    onChange={(e) =>
                        setRow({
                            ...row,
                            gloss: { ...row.gloss, when: e.target.value },
                        })
                    }
                />
            </label>
            <label className="flex flex-col gap-1">
                Gloss: not
                <Input
                    value={row.gloss.not}
                    disabled={pending}
                    onChange={(e) =>
                        setRow({
                            ...row,
                            gloss: { ...row.gloss, not: e.target.value },
                        })
                    }
                />
            </label>
            <label className="flex flex-col gap-1">
                Example card
                <Input
                    value={row.example}
                    disabled={pending}
                    onChange={(e) =>
                        setRow({ ...row, example: e.target.value })
                    }
                />
            </label>
            {errors.length > 0 && (
                <ul role="alert" className="list-disc pl-4 text-danger">
                    {errors.map((reason) => (
                        <li key={reason}>{reason}</li>
                    ))}
                </ul>
            )}
            <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                    {mode === "create" ? "Add row" : "Save row"}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={onCancel}
                >
                    Cancel
                </Button>
            </div>
        </form>
    );
}
