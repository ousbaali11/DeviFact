// Embarque les polices DejaVu et le profil couleur sRGB dans un module
// TypeScript (assets-embarques.ts), pour que la fonction generate-facturx ne
// dépende d'aucun fichier annexe au déploiement.
//
// Pourquoi : les « static_files » de supabase/config.toml sont silencieusement
// omis par le CLI Supabase (2.90 et suivants) quand Docker n'est pas
// disponible sur la machine qui déploie — la fonction cherchait alors
// assets/DejaVuSans.ttf et échouait (signalements supabase/cli #4554, #5169).
//
// À relancer seulement si un fichier de ce dossier change :
//   node supabase/functions/generate-facturx/assets/embarquer.cjs
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const files = [
  ["FONT_REGULAR_B64", "DejaVuSans.ttf"],
  ["FONT_BOLD_B64", "DejaVuSans-Bold.ttf"],
  ["ICC_PROFILE_B64", "sRGB-v2-micro.icc"],
];
let out = `// assets-embarques.ts — GÉNÉRÉ par assets/embarquer.cjs, ne pas modifier à la main.
//
// Polices DejaVu Sans (licence : assets/LICENSE-DejaVu.txt) et profil couleur
// sRGB embarqués en base64 : PDF/A-3 exige des polices incorporées et un
// profil de sortie, et le déploiement ne doit dépendre d'aucun fichier
// annexe (voir assets/embarquer.cjs).

`;
for (const [name, file] of files) {
  const buf = fs.readFileSync(path.join(dir, file));
  out += `export const ${name} = "${buf.toString("base64")}";\n`;
}
out += `
export function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const EMBEDDED_ASSETS_INFO = ${JSON.stringify(Object.fromEntries(files.map(([n, f]) => [f, fs.statSync(path.join(dir, f)).size])))};
`;
fs.writeFileSync(path.join(dir, "..", "assets-embarques.ts"), out, "utf8");
console.log("assets-embarques.ts :", out.length, "caractères ;", files.map(([, f]) => `${f} ${fs.statSync(path.join(dir, f)).size} o`).join(", "));
