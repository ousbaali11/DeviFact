// generate-facturx/index.ts
//
// Génère, pour une facture du site, un fichier Factur-X (PDF/A-3 avec
// le XML CII EN 16931 embarqué) — préparation à la réforme française de
// la facturation électronique. Cette fonction ne transmet RIEN à une
// Plateforme Agréée : elle produit uniquement le fichier, que la
// personne télécharge. Réservée aux utilisateurs connectés (le fichier
// est calculé à partir des données envoyées par le navigateur, tous les
// montants étant recalculés ici).
//
// Réponse : JSON { fileName, pdfBase64, warnings } — ou 400 avec
// { error, missing: [...] } si des données obligatoires manquent.
//
// Déploiement : les polices et le profil couleur du dossier assets/ sont
// déclarés dans supabase/config.toml (static_files).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildInvoiceModel, buildCiiXml, buildFacturXPdf, facturXFileName, type PdfAssets } from "./facturx.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_BODY_BYTES = 2 * 1024 * 1024; // une facture avec logo en base64 reste bien en dessous

// Chargées une seule fois par instance (démarrage à froid), puis réutilisées.
let assetsPromise: Promise<PdfAssets> | null = null;
function loadAssets(): Promise<PdfAssets> {
  if (!assetsPromise) {
    assetsPromise = (async () => ({
      regularFont: await Deno.readFile(new URL("./assets/DejaVuSans.ttf", import.meta.url)),
      boldFont: await Deno.readFile(new URL("./assets/DejaVuSans-Bold.ttf", import.meta.url)),
      iccProfile: await Deno.readFile(new URL("./assets/sRGB-v2-micro.icc", import.meta.url)),
    }))();
  }
  return assetsPromise;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Non connecté" }, 401);

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "Facture trop volumineuse pour être exportée." }, 413);
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Facture trop volumineuse pour être exportée." }, 413);

    let body: { document?: unknown; companyProfile?: unknown; siteName?: unknown };
    try { body = JSON.parse(raw); } catch { return json({ error: "Requête illisible." }, 400); }

    const siteName = typeof body.siteName === "string" && body.siteName.trim() ? body.siteName.trim().slice(0, 80) : "Chantiflow";
    const { model, missing, warnings } = buildInvoiceModel(body.document, body.companyProfile, siteName);
    if (!model) {
      return json({ error: "Des informations obligatoires manquent pour produire une facture électronique conforme.", missing, warnings }, 400);
    }

    const xml = buildCiiXml(model);
    const pdf = await buildFacturXPdf(model, xml, await loadAssets());
    return json({ fileName: facturXFileName(model.number), pdfBase64: toBase64(pdf), warnings });
  } catch (err) {
    console.error("Erreur generate-facturx", err);
    return json({ error: "Impossible de générer le fichier Factur-X pour l'instant." }, 500);
  }
});
