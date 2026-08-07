// sync-indices-france/index.ts
//
// Va chercher automatiquement, chez l'INSEE, la dernière valeur de
// chaque indice français suivi (table tracked_indices, country='🇫🇷 FR',
// auto_sync=true), et met à jour la table official_indices.
//
// Source : l'API publique et gratuite de l'INSEE (BDM/SDMX), qui ne
// nécessite aucune clé — https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/{idbank}
// Jusqu'à 400 séries peuvent être demandées en une seule requête en
// séparant les idbank par "+".
//
// Appelée par un déclenchement programmé (voir migration_cron_indices.sql)
// — peut aussi être appelée manuellement depuis l'Admin pour forcer une
// mise à jour immédiate.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Extrait, pour chaque idbank, la dernière observation (période +
// valeur) du XML renvoyé par l'INSEE.
//
// Important : par défaut, l'INSEE répond au format "StructureSpecificData"
// (confirmé par la documentation officielle du service SDMX) — les
// données sont portées par des ATTRIBUTS XML directement sur les
// balises <Series IDBANK="..."> et <Obs TIME_PERIOD="..." OBS_VALUE="..."/>,
// PAS par des éléments enfants imbriqués (ça, c'est l'autre format
// possible, "GenericData", qui n'est utilisé que si explicitement
// demandé). Les deux sont gérés ici, au cas où.
function parseLatestObservations(xml: string): Record<string, { period: string; value: number }> {
  const results: Record<string, { period: string; value: number }> = {};
  const seriesRegex = /<(?:\w+:)?Series\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Series>/g;
  let seriesMatch: RegExpExecArray | null;
  while ((seriesMatch = seriesRegex.exec(xml)) !== null) {
    const attrsStr = seriesMatch[1];
    const body = seriesMatch[2];

    // Format StructureSpecificData (par défaut) : IDBANK en attribut
    // direct sur <Series>. Sinon, on retente au format GenericData
    // (<SeriesKey><Value id="IDBANK" value="..."/></SeriesKey>).
    let idbank = (attrsStr.match(/IDBANK="([^"]+)"/) || [])[1];
    if (!idbank) {
      idbank = (body.match(/<(?:\w+:)?Value\s+id="IDBANK"\s+value="([^"]+)"/) || [])[1];
    }
    if (!idbank) continue;

    let bestPeriod = "";
    let bestValue: number | null = null;

    // Format StructureSpecificData : <Obs TIME_PERIOD="..." OBS_VALUE="..."/>
    const obsAttrRegex = /<(?:\w+:)?Obs\b([^>]*)\/?>/g;
    let obsMatch: RegExpExecArray | null;
    while ((obsMatch = obsAttrRegex.exec(body)) !== null) {
      const obsAttrs = obsMatch[1];
      const period = (obsAttrs.match(/TIME_PERIOD="([^"]+)"/) || [])[1];
      const valueStr = (obsAttrs.match(/OBS_VALUE="([^"]+)"/) || [])[1];
      if (period && valueStr !== undefined) {
        const value = parseFloat(valueStr);
        if (!Number.isNaN(value) && (!bestPeriod || period > bestPeriod)) { bestPeriod = period; bestValue = value; }
      }
    }

    // Format GenericData (au cas où) : <ObsDimension value="..."/> + <ObsValue value="..."/>
    if (!bestPeriod) {
      const obsBlocks = [...body.matchAll(/<(?:\w+:)?Obs\b[\s\S]*?<\/(?:\w+:)?Obs>/gi)];
      for (const ob of obsBlocks) {
        const period = (ob[0].match(/ObsDimension\s+value="([^"]+)"/) || [])[1];
        const valueStr = (ob[0].match(/ObsValue\s+value="([^"]+)"/) || [])[1];
        if (period && valueStr !== undefined) {
          const value = parseFloat(valueStr);
          if (!Number.isNaN(value) && (!bestPeriod || period > bestPeriod)) { bestPeriod = period; bestValue = value; }
        }
      }
    }

    if (bestPeriod && bestValue !== null) {
      results[idbank] = { period: bestPeriod, value: bestValue };
    }
  }
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { data: tracked, error: trackedError } = await dbAdmin
      .from("tracked_indices")
      .select("id, code, idbank")
      .eq("country", "🇫🇷 FR")
      .eq("auto_sync", true)
      .not("idbank", "is", null);

    if (trackedError) throw trackedError;
    if (!tracked || !tracked.length) {
      return new Response(JSON.stringify({ success: true, updated: 0, message: "Aucun indice français à synchroniser." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Une seule requête pour toutes les séries (jusqu'à 400 à la fois).
    const idbanks = tracked.map((t) => t.idbank).join("+");
    const url = `https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/${idbanks}?lastNObservations=1`;
    const resp = await fetch(url, { headers: { Accept: "application/xml" } });
    if (!resp.ok) {
      throw new Error(`Réponse INSEE inattendue : ${resp.status}`);
    }
    const xml = await resp.text();
    const observations = parseLatestObservations(xml);

    let updated = 0;
    const errors: string[] = [];
    for (const t of tracked) {
      const obs = observations[t.idbank!];
      if (!obs) {
        errors.push(`${t.code} (idbank ${t.idbank}) : aucune donnée trouvée dans la réponse INSEE.`);
        continue;
      }
      // "2026-01" (mensuel) -> année/mois ; gère aussi "2026" seul par sécurité.
      const [yearStr, monthStr] = obs.period.split("-");
      const periodYear = parseInt(yearStr, 10);
      const periodMonth = monthStr ? parseInt(monthStr, 10) : 1;
      if (!periodYear || Number.isNaN(obs.value)) {
        errors.push(`${t.code} : période ou valeur invalide (${obs.period} / ${obs.value}).`);
        continue;
      }
      const { error: upsertError } = await dbAdmin.from("official_indices").upsert({
        tracked_index_id: t.id,
        value: obs.value,
        period_year: periodYear,
        period_month: periodMonth,
        status: "definitive",
        source_reference: `idbank ${t.idbank}`,
        updated_by: null, // synchronisation automatique
        updated_at: new Date().toISOString(),
      }, { onConflict: "tracked_index_id,period_year,period_month" });
      if (upsertError) {
        errors.push(`${t.code} : erreur d'enregistrement — ${upsertError.message}`);
      } else {
        updated++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      updated,
      total: tracked.length,
      errors,
      // Extrait du XML brut reçu, uniquement si quelque chose n'a pas
      // été trouvé — pour diagnostiquer immédiatement le format réel
      // si jamais l'INSEE a changé quelque chose, sans avoir à deviner.
      xmlSample: errors.length ? xml.slice(0, 1500) : undefined,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur de synchronisation des indices français :", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
