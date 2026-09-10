# Super PDP — notes d'intégration (lecture de la documentation, septembre 2026)

Synthèse de la documentation officielle (https://www.superpdp.tech/documentation,
articles servis par `api.superpdp.tech/internal/articles`), de la spécification
OpenAPI (`https://api.superpdp.tech/openapi/superpdp.json`, version 1.30.0.beta)
et des exemples officiels (https://github.com/superpdp/examples). Aucune
intégration n'est encore réalisée : ce document prépare le travail.

## 1. Bac à sable

1. Créer un compte sur https://www.superpdp.tech (bouton « Connexion » →
   « Créer un compte »). Le compte reçoit automatiquement deux entreprises
   fictives de bac à sable : **Burger Queen** (vendeur) et **Tricatel**
   (acheteur).
2. Menu « Applications » → « Nouvelle application… » → choisir l'entreprise →
   Créer. Noter `client_id` et `client_secret` (affichés une seule fois).
   Répéter pour la seconde entreprise.
3. Le mode (bac à sable ou production) est déterminé par la clé d'application :
   impossible de toucher la production par erreur avec une clé bac à sable.
4. Adresses électroniques du bac à sable : format `315143296_XXX` (en
   production : le SIREN).
5. Script officiel de bout en bout (Node.js) :
   `curl https://raw.githubusercontent.com/superpdp/examples/refs/heads/main/quick_start.js`.

## 2. Ce qu'il faut côté Chantiflow

**Point structurant : la route `POST /v1.beta/companies` (enrôler une
entreprise) est réservée aux experts-comptables.** Un logiciel multi-clients
comme Chantiflow doit utiliser le flux **OAuth 2.1 Authorization Code** : chaque
artisan possède son propre compte Super PDP (son SIREN, sa ligne d'annuaire) et
autorise Chantiflow à agir pour lui. La doc précise qu'un logiciel de
facturation n'est pas un « tiers facturant » et n'a donc pas besoin de mandat.

Conséquences :

- Pour Chantiflow (l'éditeur) : un compte Super PDP, l'entreprise éditrice
  déclarée (SIREN), et une **application OAuth « Confidentielle »** en
  production avec l'URL de redirection de Chantiflow. En marque grise, c'est
  Chantiflow qui paie (0,01 € HT par facture, gratuit jusqu'à 1 000
  factures/mois) et refacture librement.
- Pour chaque artisan : un compte Super PDP relié à son SIREN (le SIREN doit
  figurer dans l'annuaire de la facturation électronique, sinon contacter le
  SIE), le régime de TVA renseigné (`monthly`, `quarterly`, `simplified`,
  `vat_exemption`, nécessaire au e-reporting), et une ligne d'annuaire pour
  recevoir (Super PDP la crée dans l'annuaire DGFiP et Peppol).
- Le flux d'autorisation peut pré-remplir l'inscription :
  `login_hint`, `superpdp_company_number` + `superpdp_company_number_scheme=fr_siren`,
  `superpdp_send_and_receive` (`any` / `send` / `receive`).
- Jetons : `access_token` valable 30 minutes, `refresh_token` valable 1 an avec
  rotation à chaque usage (à stocker chiffré par organisation, côté serveur).
  Révocation : `POST /oauth2/revoke`.

Endpoints OAuth : `https://api.superpdp.tech/oauth2/authorize`,
`https://api.superpdp.tech/oauth2/token`. Pas de scopes (laisser vide).

## 3. Envoyer une facture déjà générée en Factur-X

Base : `https://api.superpdp.tech/v1.beta/`, en-tête `Authorization: Bearer <access_token>`.

1. **Valider avant d'envoyer** — `POST /validation_reports` (multipart, champ
   `file`) → `data[0].is_valid` et le détail par référentiel (XSD CII D22B,
   Schematron EN 16931, règles françaises). Public, sans authentification.
   Notre fichier de test passe sans aucune remarque.
2. **Vérifier que le client peut recevoir** — `GET /french_directory/companies?number=<SIREN>`
   et `GET /french_directory/entries` : si l'adresse n'est pas dans l'annuaire,
   l'envoi échoue en `pre-check: receiver address does not exist`.
3. **Envoyer** — `POST /invoices` avec le PDF Factur-X en corps brut
   (`Content-Type: application/pdf`) ou en multipart. Paramètres utiles :
   `external_id` (notre identifiant de document, 36 caractères max) et
   `processing_rule` (`B2B`, `B2C`, `B2BInt`). Réponse 200 = fichier accepté
   syntaxiquement, avec un `id` ; la validation et la transmission sont
   **asynchrones**.
4. **Suivre** — `GET /invoices/{id}` (l'attribut `en_invoice` apparaît quand la
   facture est traitée) puis `GET /invoice_events?starting_after_id=<dernier id>`
   pour récupérer sans trou tous les événements (identifiants strictement
   croissants, pagination `has_after`). Pas de webhooks dans l'API : c'est du
   polling, à faire par exemple dans une tâche planifiée.
5. **Statuts** (`fr:*`, officiels) : 200 déposée, 201 émise, 202 reçue,
   203 mise à disposition, 204 prise en charge, 205 approuvée, 206 approuvée
   partiellement, 207 en litige, 208 suspendue, 209 complétée, 210 refusée,
   211 paiement transmis, 212 encaissée, 213 rejetée, 501 irrecevable.
   Statuts internes `api:*` : `uploaded`, `validated`, `invalid`, `sent`,
   `rejected`, `accepted`…
6. **Encaissement** — quand l'artisan marque la facture « payée », envoyer
   `POST /invoice_events` avec `{ invoice_id, status_code: "fr:212" }`
   (sans détail, le montant total est repris). Ce message alimente le
   e-reporting des paiements, obligatoire pour les prestations de services.
7. **E-reporting** — pour une facture B2B envoyée via Super PDP, la
   transmission à l'administration (flux 1) est automatique. Les factures B2C
   peuvent être envoyées de la même manière (note BAR = B2C), Super PDP en
   extrait les données de transaction ; attention, les factures B2C
   **mixtes** (biens + services) ne sont pas gérées.
8. **Réception** — `GET /invoices?direction=in&starting_after_id=…` pour
   récupérer les factures fournisseurs, `GET /invoices/{id}/download` pour le
   fichier (formats `original`, `factur-x`, `cii`, `ubl`).

## 4. Correspondance avec ce qui existe déjà

| Chantiflow | Super PDP |
|---|---|
| Bouton « Télécharger au format Factur-X » | `POST /invoices` avec le même fichier |
| Statut « payée » d'une facture | événement `fr:212` |
| Note BAR B2B / B2C / B2BINT (déjà dans le XML) | paramètre `processing_rule` |
| `has_vat_on_debits` (option débits, page Mon entreprise) | champ `has_vat_on_debits` de l'entreprise |
| Client sans SIREN (particulier / étranger) | e-reporting B2C ou `b2bint_invoices` |

## 5. Alternatives et suite

- API AFNOR (XP Z12-013) aussi disponible chez Super PDP : interopérable entre
  plateformes mais bas niveau (XML brut, CDAR en XML). À garder pour plus tard
  si l'on veut pouvoir changer de plateforme sans redéveloppement.
- Super PDP propose aussi `POST /invoices/convert?from=en16931&to=factur-x`
  (JSON + PDF → Factur-X) : notre générateur reste indépendant, mais cette
  route peut servir de contrôle croisé.
