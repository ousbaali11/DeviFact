# generate-facturx — export Factur-X (facture électronique)

Fonction serveur qui transforme une facture du site en fichier **Factur-X** :
un PDF/A-3 lisible contenant le fichier `factur-x.xml` (syntaxe UN/CEFACT CII,
profil **EN 16931**), c'est-à-dire le format hybride de la réforme française de
la facturation électronique. Elle ne transmet rien à une Plateforme Agréée :
elle produit uniquement le fichier, que la personne télécharge depuis le bouton
« Télécharger au format Factur-X » de l'éditeur de facture.

## Fichiers

- `index.ts` — point d'entrée HTTP (authentification par session, garde-fous,
  réponse JSON `{ fileName, pdfBase64, warnings }` ou `400 { error, missing }`).
- `facturx.ts` — le cœur, sans dépendance Supabase :
  - `buildInvoiceModel(doc, companyProfile)` recalcule tous les montants côté
    serveur et liste les données manquantes (en français, prêtes à afficher) ;
  - `buildCiiXml(model)` produit le XML CII EN 16931, avec les mentions
    françaises (cadre de facturation BT-23, SIREN, adresses électroniques
    schéma 0225, notes PMD/PMT/AAB/BAR, option TVA sur les débits) ;
  - `buildFacturXPdf(model, xml, assets)` produit le PDF/A-3 (polices
    embarquées, profil sRGB, métadonnées XMP Factur-X, pièce jointe
    `factur-x.xml` en relation `Alternative`, identifiant de fichier).
- `assets/` — polices DejaVu Sans (licence libre, voir `LICENSE-DejaVu.txt`)
  et profil couleur sRGB, sources des données embarquées.
- `assets-embarques.ts` — ces mêmes fichiers en base64, générés par
  `assets/embarquer.cjs` : la fonction ne dépend d'aucun fichier annexe au
  déploiement (les `static_files` du CLI sont omis sans Docker, voir
  supabase/cli #4554 et #5169). À régénérer si un fichier d'`assets/` change.

## Déployer

```bash
npx supabase functions deploy generate-facturx --project-ref ieshjvzmpbxtqielhaii
```

## Vérifier un fichier généré

Le fichier a été validé localement avec Mustang 2.26 (veraPDF pour le PDF/A-3b,
XSD + Schematron EN 16931 et règles françaises XP Z12-012 v1.3.0), puis par le
service de validation public de Super PDP (`POST
https://api.superpdp.tech/v1.beta/validation_reports`, champ `file`), qui
applique les mêmes référentiels FNFE. Pour revalider un fichier :

```bash
java -jar Mustang-CLI.jar --action validate --source facture.pdf
```

(Mustang-CLI se télécharge sur Maven Central : `org.mustangproject:Mustang-CLI`.)

## Limites connues (volontaires, à ce stade de préparation)

- Pièces exportées : factures (380), factures d'acompte (386), avoirs (381,
  avec la facture d'origine en `InvoiceReferencedDocument`) et situations de
  travaux valant facture (380 : une ligne par poste au montant de la
  situation, retenue de garantie en conditions de paiement, acompte versé en
  montant prépayé). Pas les devis, proformas ni situations simples.
- Les lignes à 0 % de TVA sont exportées avec le motif d'exonération choisi
  sur la facture (bloc « Facturation électronique ») : franchise en base par
  défaut, ou exportation, livraison intracommunautaire, autoliquidation.
- Les mentions légales (pénalités de retard, indemnité de 40 €, absence
  d'escompte) sont des textes standards codés en dur.
- La remise globale est intégrée aux prix nets des lignes (pas de remise
  document séparée), et chaque ligne est arrondie au centime avant addition,
  ce qui peut décaler le total d'un centime par rapport au PDF classique.
