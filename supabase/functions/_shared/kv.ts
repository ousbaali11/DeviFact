// _shared/kv.ts
//
// Mise à jour d'une ligne kv_store (documents d'une organisation) par une
// fonction serveur, SANS écraser une écriture faite entre-temps par un
// membre depuis le site : lecture, modification, écriture conditionnelle sur
// updated_at ; si quelqu'un a écrit entre-temps, on relit et on rejoue la
// modification (même principe que src/storage-adapter.js côté site).
//
// mutate(value) reçoit une copie de la valeur courante et renvoie la
// nouvelle valeur, ou null pour ne rien écrire.

export type KvUpdateResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "missing" | "unchanged" | "conflict" | string };

export async function updateKvValue<T = any>(
  dbAdmin: any,
  organizationId: string,
  key: string,
  mutate: (value: T) => T | null,
  attempts = 4,
): Promise<KvUpdateResult<T>> {
  for (let i = 0; i < attempts; i++) {
    const { data: row, error: readError } = await dbAdmin
      .from("kv_store").select("value, updated_at")
      .eq("organization_id", organizationId).eq("key", key).eq("shared", false)
      .maybeSingle();
    if (readError) return { ok: false, reason: readError.message };
    if (!row) return { ok: false, reason: "missing" };
    const next = mutate(structuredClone(row.value));
    if (next === null || next === undefined) return { ok: false, reason: "unchanged" };
    let query = dbAdmin
      .from("kv_store").update({ value: next, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId).eq("key", key).eq("shared", false);
    query = row.updated_at === null || row.updated_at === undefined ? query.is("updated_at", null) : query.eq("updated_at", row.updated_at);
    const { data: updated, error } = await query.select("updated_at");
    if (error) return { ok: false, reason: error.message };
    if (Array.isArray(updated) && updated.length === 1) return { ok: true, value: next };
    // Quelqu'un a écrit entre-temps : nouvel essai sur la version fraîche.
  }
  return { ok: false, reason: "conflict" };
}
