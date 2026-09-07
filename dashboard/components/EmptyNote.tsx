/** The empty-state sentence every section renders the same way — a read that
 *  SUCCEEDED and found nothing, which `Unavailable` is not. */
export function EmptyNote({ children }: { children: string }) {
    return <p className="text-muted-foreground text-xs">{children}</p>;
}
