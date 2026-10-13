// Shared folder-tree helpers (route files may only export HTTP handlers).

// Breadth-first subtree ids (self + descendants), cycle-safe. Null on DB error.
export async function subtreeIds(db: { from(t: string): any }, rootId: string): Promise<string[] | null> {
  const order: string[] = [rootId];
  const seen = new Set<string>(order);
  try {
    for (let i = 0, frontier = [rootId]; frontier.length && i < 50; i++) {
      const next: string[] = [];
      for (let j = 0; j < frontier.length; j += 200) {
        const { data, error } = await db.from("folders").select("id").in("parent", frontier.slice(j, j + 200));
        if (error) return null;
        for (const k of (data ?? []) as { id: string }[]) {
          if (!seen.has(k.id)) { seen.add(k.id); next.push(k.id); }
        }
      }
      frontier = next;
      order.push(...frontier);
    }
    return order;
  } catch {
    return null;
  }
}
