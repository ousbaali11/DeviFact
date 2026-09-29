# Super PDP — guide d'intégration Chantiflow

Plateforme Agréée par laquelle les pièces électroniques (factures, factures
d'acompte, avoirs, situations valant facture) sont transmises aux clients
professionnels français. Ce guide décrit le fonctionnement, le parcours de
test en bac à sable et le dépannage ; l'historique des chantiers est en annexe.
La procédure de passage en production est un document à part
(`PRODUCTION-SUPER-PDP.md`), jamais exécutée par le code.

## 1. Fonctionnement

**Fonctions serveur** (`supabase/functions`) :
- `superpdp-oauth` — connexion du compte Super PDP de l'entreprise (OAuth 2.1,
  PKCE) : actions `start`, `callback`, `status` (tout membre actif), `disconnect`.
- `superpdp-send-invoice` — envoi d'une pièce : éligibilité, Factur-X via
  `generate-facturx`, validation `POST /validation_reports`, annuaire,
  `POST /invoices`, enregistrement, journal.
- `superpdp-sync-events` — relecture des événements (tâche quotidienne
  07:00 UTC et bouton « Actualiser »), encaissement `fr:212`, réconciliation,
  statut de vérification, nettoyage.
- `generate-facturx` — fichier Factur-X (PDF/A-3 + XML CII) ; polices et
  profil ICC embarqués dans le code (pas de `static_files`).
- Règles partagées `_shared/superpdp-rules.ts` = `src/pdp-rules.js` (tests
  de parité) : éligibilité, statuts, verrou de contenu, réémission,
  traductions, glossaire, réconciliation.

**Tables** (scripts `supabase/migrations_audit/2026-09-*_super-pdp-*.sql`) :
`pdp_connections` (jetons chiffrés AES-256-GCM, entreprise, statut de
vérification, `last_error` — préfixe `RECONNECT:` = connexion à refaire),
`pdp_oauth_states` (états d'autorisation, 10 minutes), `pdp_invoices` (un
envoi par pièce : dépôt, statut, dernier événement, encaissement, erreur),
`pdp_journal` (une ligne par événement, jamais purgé).

**Champ `pdp` d'une pièce** : `invoiceId`, `externalId`, `env`, `status`,
`statusText`, `sentAt`, `updatedAt`, `error`, `reason`, `attempt`,
`paidEventAt`, `paidEventError`. Piloté par le serveur ; la fusion des
enregistrements concurrents garde la génération la plus récente sans note
de conflit.

**Secrets** : `SUPERPDP_CLIENT_ID`, `SUPERPDP_CLIENT_SECRET`,
`SUPERPDP_TOKEN_KEY` (32 octets base64), `SUPERPDP_API_BASE` (défaut
`https://api.superpdp.tech`), `SUPERPDP_ALLOW_PRODUCTION` (`true` pour accepter
une entreprise en production ; absent = bac à sable seulement), `SITE_URL`,
`CRON_SECRET`.

**Garde-fous** : entreprise en production refusée à la connexion, à l'envoi et
à la relecture tant que `SUPERPDP_ALLOW_PRODUCTION` ≠ `true` ; pièce transmise
= contenu figé (statut, paiements, relances modifiables) ; réémission
seulement après un échec final ; verrou « envoi en cours » libéré après
10 minutes.

## 2. Parcours de test en bac à sable

1. **Mon entreprise** : pays France, SIRET, numéro de TVA avec préfixe `FR`,
   IBAN, ville. Carte « Facturation électronique : Super PDP » →
   « Connecter mon compte Super PDP » → sur la page Super PDP, choisir
   l'entreprise de test **Burger Queen** (bac à sable). La carte affiche
   « Burger Queen · n° 000000002 », badge Bac à sable.
2. **Fiche client** Tricatel : type entreprise, pays France, champ SIRET =
   `0225:315143296_106842` (adresse d'annuaire de test), numéro de TVA avec
   préfixe `FR`, code postal et ville.
3. **Pièce** : facture, facture d'acompte, avoir (facture d'origine + motif) ou
   situation cochée « Vaut facture » ; statut « envoyée » (pastille en haut) ;
   bloc « Facturation électronique » : catégorie d'opération.
4. **Envoyer** : menu Exporter → « Envoyer via Super PDP » → confirmation.
   Badge « Super PDP : Déposée », contenu figé, ligne « Envoi » au journal
   (clic sur le badge).
5. **Suivre** : bouton « Actualiser » ou tâche quotidienne → statuts
   `fr:20x` ; passage « payée » → encaissement `fr:212` (badge « encaissement
   transmis »).
6. **Refus** : bandeau rouge avec le motif en français et « Renvoyer » ;
   corriger puis renvoyer (tentative n° 2, identifiant externe suffixé).

## 3. Dépannage

| Message | Cause | Solution |
|---|---|---|
| « L'application Chantiflow et l'entreprise choisie … même environnement » | Entreprise de production choisie sur la page d'autorisation alors que l'application est en bac à sable | Choisir Burger Queen ; en bac à sable le SIREN n'est plus transmis à l'autorisation |
| « Le vendeur du fichier n'est pas l'entreprise connectée » | Compte connecté ≠ vendeur (ex. Tricatel connecté à la place de Burger Queen) | Déconnecter puis reconnecter le bon compte |
| « aucune adresse d'annuaire Peppol active pour l'entreprise connectée » | En bac à sable le numéro d'entreprise (`000000002`) n'est pas une adresse ; l'adresse vient de l'annuaire | Vérifier les lignes d'annuaire de l'entreprise chez Super PDP |
| `[BR-CO-09]` numéro de TVA sans préfixe pays | TVA sans `FR` dans Mon entreprise ou sur la fiche client (la copie figée sur la pièce n'est plus utilisée pour l'émetteur) | Corriger le numéro (préfixe pays), renvoyer |
| « Non connecté » / « État indisponible » | Jeton de session Chantiflow refusé (expiré ou révoqué) | Le site renouvelle et rejoue ; sinon écran de connexion avec explication ; bouton « Réessayer » sur la carte |
| « Connexion à refaire » sur la carte | Jeton Super PDP révoqué ou expiré (`last_error` préfixé `RECONNECT:`) | Bouton « Reconnecter » |
| « Envoi déjà en cours » | Verrou `api:sending` d'un envoi récent | Attendre ; libéré automatiquement après 10 minutes |
| « Journal indisponible » | Table `pdp_journal` absente | Appliquer le script étape 4 |
| Bandeau « Réaligné » au journal | Pièce en retard sur la table des envois (coupure, enregistrement concurrent) | Rien à faire : réalignement automatique à la relecture |

## 4. Passage en production

Décision à part, jamais déclenchée par le code : procédure écrite dans
`PRODUCTION-SUPER-PDP.md` (prérequis à cocher, bascule pas à pas, première
facture réelle, retour arrière). La carte de Mon entreprise affiche
« Envois réels autorisés sur le site : oui / non » (garde-fou
`SUPERPDP_ALLOW_PRODUCTION`, renvoyé par l'action `status`).

## Annexe — historique des chantiers

# Super PDP — notes d'intégration (lecture de la documentation, septembre 2026)

Synthèse de la documentation officielle (https://www.superpdp.tech/documentation,
articles servis par `api.superpdp.tech/internal/articles`), de la spécification
OpenAPI (`https://api.superpdp.tech/openapi/superpdp.json`, version 1.30.0.beta)
et des exemples officiels (https://github.com/superpdp/examples). Aucune
intégration n'est encore réalisée : ce document prépare le travail.

### 1. Bac à sable

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

### 2. Ce qu'il faut côté Chantiflow

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

### 3. Envoyer une facture déjà générée en Factur-X

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

### 4. Correspondance avec ce qui existe déjà

| Chantiflow | Super PDP |
|---|---|
| Bouton « Télécharger au format Factur-X » | `POST /invoices` avec le même fichier |
| Statut « payée » d'une facture | événement `fr:212` |
| Note BAR B2B / B2C / B2BINT (déjà dans le XML) | paramètre `processing_rule` |
| `has_vat_on_debits` (option débits, page Mon entreprise) | champ `has_vat_on_debits` de l'entreprise |
| Client sans SIREN (particulier / étranger) | e-reporting B2C ou `b2bint_invoices` |

### 5. Alternatives et suite

- API AFNOR (XP Z12-013) aussi disponible chez Super PDP : interopérable entre
  plateformes mais bas niveau (XML brut, CDAR en XML). À garder pour plus tard
  si l'on veut pouvoir changer de plateforme sans redéveloppement.
- Super PDP propose aussi `POST /invoices/convert?from=en16931&to=factur-x`
  (JSON + PDF → Factur-X) : notre générateur reste indépendant, mais cette
  route peut servir de contrôle croisé.

### 6. Réalisé — étape 1 (26/09/2026) : connexion OAuth du compte de l'artisan

- Fonction `superpdp-oauth` (propriétaire seulement) : `start` (état + PKCE
  gardés 10 min dans `pdp_oauth_states`, adresse `/oauth2/authorize`
  pré-remplie avec `login_hint`, `superpdp_company_number` + `fr_siren`),
  `callback` (échange du code côté serveur, lecture de `companies/me` et
  `oauth2_sessions/me`, refus des entreprises en production tant que
  `SUPERPDP_ALLOW_PRODUCTION` ≠ `true`, jetons chiffrés), `status`, `disconnect`.
- Module `_shared/superpdp.ts` : chiffrement AES-256-GCM des jetons
  (`SUPERPDP_TOKEN_KEY`), rafraîchissement avec rotation et écriture
  conditionnelle, `superpdpFetch` pour les étapes suivantes.
- Table `pdp_connections` (script `2026-09-26_super-pdp-etape1.sql`, RLS sans
  politique : clé de service seulement) ; le navigateur ne reçoit qu'un état.
- Site : carte « Facturation électronique : Super PDP » dans Mon entreprise
  (propriétaire, entreprise en France), retour sur `?superpdp=retour`.
- Secrets : `SUPERPDP_CLIENT_ID`, `SUPERPDP_CLIENT_SECRET`, `SUPERPDP_TOKEN_KEY`
  (`openssl rand -base64 32`), `SUPERPDP_API_BASE` (facultatif), `SITE_URL`.
  Adresse de retour à déclarer dans l'application Super PDP :
  `https://www.chantiflow.fr/?superpdp=retour`.

### 7. Réalisé — étape 2 (26/09/2026) : envoi d'une facture

- Fonction `superpdp-send-invoice` (propriétaire ou éditeur) : relit la
  facture et la fiche entreprise en base, applique les règles
  d'éligibilité de `_shared/superpdp-rules.ts` (facture émise, client
  professionnel français avec SIRET, compte connecté et vérifié, bac à
  sable tant que `SUPERPDP_ALLOW_PRODUCTION` ≠ `true`, pas d'envoi en cours
  ou abouti), pose un verrou dans `pdp_invoices`, produit le Factur-X par
  `generate-facturx`, valide (`POST /validation_reports`), vérifie
  l'annuaire (`GET /french_directory/entries`, bloquant en production,
  avertissement en bac à sable), envoie (`POST /invoices` avec
  `processing_rule=B2B` et `external_id` = identifiant du document), puis
  enregistre la ligne `pdp_invoices` et le champ `pdp` du document.
- Bac à sable : les identifiants d'entreprise Super PDP
  (`0225:315143296_106843`, `315143296_106842`) remplacent le SIREN dans
  les adresses électroniques du XML (`sandboxIds` de `generate-facturx`) ;
  celui du client se saisit dans le champ SIRET de sa fiche.
- Site : entrée « Envoyer via Super PDP » du menu Exporter (confirmation),
  badge de statut sur la facture et dans la liste, contenu figé une fois
  transmise (statut, paiements, relances restent modifiables ; un avoir
  corrige). `src/pdp-rules.js` reprend les règles serveur (test de parité).
- Table `pdp_invoices` (script `2026-09-26_super-pdp-etape2.sql`) : lecture
  par les membres, écriture par les fonctions serveur.
- Étape 3 à venir : lecture des événements (`GET /invoice_events`), statuts
  officiels, événement `fr:212` quand la facture passe « payée ».

### 8. Réalisé — étape 3 (26/09/2026) : suivi des statuts et encaissement

- Fonction `superpdp-sync-events` : tâche planifiée quotidienne
  (`superpdp-sync-events-quotidien`, 07:00 UTC, script
  `2026-09-26_super-pdp-etape3.sql`) et action `sync` pour tout membre actif
  (bouton « Actualiser » de l'éditeur) : lecture de
  `GET /invoice_events?starting_after_id=<pdp_connections.last_event_id>`
  page par page, dernier événement par facture (`applyPdpEvents`, règles
  partagées), mise à jour de `pdp_invoices` et du champ `pdp` des documents
  en une écriture par organisation ; une organisation en erreur n'arrête pas
  les autres. Statut affiché = dernier événement reçu.
- Encaissement : quand une facture transmise passe « payée » dans Chantiflow
  (à la main, par la banque ou en ligne), le site appelle l'action `paid`
  (propriétaire, éditeur) → `POST /invoice_events { invoice_id, status_code:
  "fr:212" }`, noté dans `pdp.paidEventAt` et `pdp_invoices.paid_event_at`
  (`shouldSendPaidEvent` : une seule fois, jamais pour un acompte ni un
  paiement partiel). En cas d'échec, `pdp.paidEventError` et la tâche
  quotidienne réessaie.
- Bac à sable seulement tant que `SUPERPDP_ALLOW_PRODUCTION` ≠ `true`.

### 9. Réalisé — points 5 et 6 (26/09/2026) : avoirs, factures d'acompte, situations valant facture

- Factur-X (`facturx.ts`) accepte quatre pièces : facture (380), facture
  d'acompte (386, ligne d'acompte générée par le site reprise telle quelle),
  avoir (381) et situation de travaux valant facture (380). Devis, proforma
  et situation simple restent refusés (« Vaut facture » à cocher).
- Avoir : numéro de la facture d'origine et motif obligatoires (liste des
  manquants), date d'origine en avertissement si absente ;
  `ram:InvoiceReferencedDocument` (numéro + date au format 102) placé après
  la récapitulation monétaire, note « Motif de l'avoir : … », conditions de
  paiement = mode de règlement de l'avoir, en-tête PDF « AVOIR » avec la
  ligne « Facture d'origine » à la place de l'échéance.
- Situation valant facture : une ligne « forfait » par poste au montant de
  CETTE situation (cumul atteint − déjà facturé, postes à 0 ignorés), pas
  de remise globale ; retenue de garantie exprimée dans les conditions de
  paiement (« dont retenue de garantie X % (…) payable à la levée des
  réserves ; net à payer sur cette situation : … ») et acompte versé +
  paiements reçus en `TotalPrepaidAmount` (BR-CO-16 respectée) ; notes
  « Situation de travaux n° N (période) — marché n° … », montant du marché
  et cumul déjà facturé ; catégorie d'opération absente → prestation de
  services avec avertissement.
- Règles partagées (`pdpTransmissibleType`) : envoi via Super PDP ouvert
  aux quatre pièces (un avoir B2B se transmet comme une facture) ;
  encaissement `fr:212` pour facture, facture d'acompte et situation valant
  facture payées en totalité, jamais pour un avoir.
- Site : entrées « Factur-X » et « Envoyer via Super PDP » sur avoirs et
  factures d'acompte (bloc « Facturation électronique » affiché), et dans
  l'éditeur de situation (menu Exporter, badge, bouton Actualiser, bandeau
  de contenu figé, verrou des modifications) ; libellés adaptés à la pièce.
- Tests : Deno `exemple/types-de-pieces.test.ts` (XML et PDF des trois
  pièces, refus), Vitest `src/superpdp-types.test.jsx`.
- Aucun script SQL : `pdp_invoices` et le champ `pdp` servent tels quels.

### 10. Correctif du 29/09/2026 : refus « Application environment do not match company environment »

L'adresse d'autorisation transmettait toujours `superpdp_company_number`
(SIREN de Mon entreprise) + `superpdp_company_number_scheme=fr_siren`.
Super PDP résout ce numéro vers l'entreprise réelle, en production, alors
que l'application Chantiflow (01a0d90e…) est en bac à sable : refus immédiat,
sans page de choix. Schémas acceptés d'après la spécification 1.34.0.beta :
`sandbox`, `fr_siren`, `be_numero_entreprise` ; il n'existe aucun paramètre
d'environnement, c'est le numéro d'entreprise qui détermine l'entreprise
reliée. Désormais le SIREN n'est transmis que si `SUPERPDP_ALLOW_PRODUCTION`
vaut `true` ; en bac à sable, la page d'autorisation laisse choisir
l'entreprise de test (Burger Queen).

### 11. Correctif du 29/09/2026 : « l'entreprise connectée n'a pas d'identifiant de test reconnu (000000001) »

En bac à sable, `GET /companies/me` renvoie un numéro d'entreprise de test
(`number` = « 000000001 » pour Tricatel, « 000000002 » pour Burger Queen,
`number_scheme` = `sandbox`). Les identifiants `315143296_10684x` vus dans le
tableau de bord sont les **adresses d'annuaire Peppol** (`0225:…`), pas le
numéro d'entreprise. L'envoi lit donc désormais `GET /directory_entries` de
l'entreprise connectée (`sandboxSellerFromDirectory` : entrée créée, non
« reply-to ») pour l'adresse du vendeur dans le XML. Le contrôle porte bien
sur l'entreprise **connectée** (vendeur, table `pdp_connections`), jamais sur
le client ; le client garde son adresse de test dans le champ SIRET de sa
fiche. Le 29/09, la connexion enregistrée était Tricatel (choisie sur la page
d'autorisation) : se déconnecter puis se reconnecter en choisissant Burger
Queen.

### 12. Correctif du 29/09/2026 : refus BR-CO-09 (numéro de TVA sans préfixe pays)

Chaque document embarque une copie de l'émetteur prise à sa création, non
modifiable depuis la facture ; le générateur préférait cette copie à Mon
entreprise. Un numéro de TVA corrigé dans Mon entreprise (`FR…`) restait
donc exporté sans préfixe depuis la copie périmée. Désormais, pour
l'émetteur, SIRET et numéro de TVA viennent de Mon entreprise quand elle les
renseigne (copie en secours, avertissement en cas d'écart) ; nom et adresse
gardent la copie. Un numéro de TVA sans préfixe pays sur deux lettres est
bloquant avant tout envoi, émetteur comme client, avec l'endroit où corriger.
Aucun représentant fiscal (BT-63) n'est jamais produit.

### 13. Correctif du 29/09/2026 : « L'entreprise (000000002) liée à cette session ne correspond pas au vendeur de la facture (315143296) »

En bac à sable, l'adresse d'annuaire d'une entreprise de test est
`0225:315143296_<suffixe>` : le préfixe 315143296 est le SIREN de Super PDP,
pas celui de l'entreprise. Le XML mettait ce préfixe en identifiant légal du
vendeur (BT-30) ; Super PDP le compare au numéro de l'entreprise de la
session (`000000002`). Désormais `superpdp-send-invoice` transmet à
`generate-facturx` `sandboxIds.sellerNumber` (numéro de la connexion) et
`buyerNumber` (lu dans `french_directory/entries?number=<adresse du client>`
quand l'annuaire le connaît) : identifiant légal = numéro de test, adresse
électronique = entrée d'annuaire, aucun SIRET réel dans le XML de bac à sable.

### 14. Étape 4, chantier 1 (30/09/2026) : journal des envois

- Table `pdp_journal` (script `2026-09-30_super-pdp-etape4.sql`) : une ligne
  par événement — dépôt (`envoi`), refus de validation ou échec (`erreur`),
  événement relu chez Super PDP (`relecture`), encaissement transmis
  (`encaissement`) — avec pièce, numéro, dépôt Super PDP, statut, détail,
  membre à l'origine (vide = tâche planifiée) et date. Écriture par les
  fonctions serveur seulement (`_shared/pdp-journal.ts`, jamais bloquante),
  lecture par tout membre actif (RLS). Jamais purgé.
- Front : composant `PdpJournal` — historique d'une pièce au clic sur son
  badge Super PDP (éditeur principal et éditeur de situation), vingt derniers
  événements de l'organisation sur la carte Super PDP de Mon entreprise. Table
  absente : message « Journal indisponible » sans casser la page.
- Tests : `src/superpdp-journal.test.jsx`.

### 15. Étape 4, chantier 2 (30/09/2026) : reprise sur erreur

- Bandeau de rejet dans l'éditeur principal et l'éditeur de situation quand
  le statut Super PDP est un échec final (`pdpFailureSummary`, règles
  partagées) : titre (« Fichier refusé par la validation », « Rejetée par la
  plateforme du client », « Refusée par le client », « Rejetée »,
  « Irrecevable », « Envoi en échec »), motif (message d'envoi conservé sur la
  pièce, ou raison transmise par Super PDP avec l'événement — désormais
  enregistrée dans `pdp.reason` par la relecture), consigne, bouton
  « Renvoyer » (même confirmation, avec « Nouvelle tentative (n° N) »),
  croix pour masquer.
- Tentatives : `pdp.attempt` incrémenté à chaque envoi, affiché sur le badge à
  partir de la deuxième ; identifiant externe `pdpExternalId(doc.id, n)`
  (suffixe `-n` dès la deuxième, 36 caractères au plus). Un fichier refusé
  par la validation est enregistré `api:invalid` / « Fichier refusé » (et non
  plus « Envoi en échec »). Journal : tentative mentionnée.
- Verrou « envoi en cours » resté plus de 10 minutes (`STALE_LOCK_MS`) :
  libéré, nouvelle tentative acceptée, ligne de journal « Verrou libéré ».
- Aucun script SQL. Tests : `src/superpdp-reprise.test.jsx`.

### 16. Étape 4, chantier 3 (30/09/2026) : messages en français et glossaire

- Règles partagées (`src/pdp-rules.js` = `_shared/superpdp-rules.ts`, parité
  testée) : `translatePdpMessage(raw, status)` — messages connus de l'API,
  des événements et de la page d'autorisation (environnement, vendeur ≠
  session, entreprise non vérifiée, jeton révoqué, destinataire hors
  annuaire, identifiant externe en double, fichier illisible, refus du
  client avec son détail) → phrase française avec la marche à suivre ;
  codes 429 / 401-403 / 5xx sans message → phrase selon le code ; message
  inconnu conservé, préfixé « Super PDP indique : » ; message déjà en
  français inchangé.
- Glossaire `PDP_RULE_GLOSSARY` (≈ 70 règles EN 16931, BR-CO, BR-S/E/AE/IC/G/Z,
  BR-DEC, BR-CL, profil français) ; `explainValidationFailure(texte)` garde
  l'identifiant de la règle entre crochets, repli « Règle non respectée : … »
  pour une règle inconnue. Appliqué au message d'échec de l'envoi
  (`superpdp-send-invoice`), au motif du bandeau de rejet (`pdpFailureSummary`,
  y compris pour les messages déjà enregistrés en anglais) et à l'erreur de la
  page d'autorisation (carte Super PDP). `apiErrorMessage` traduit et garde le
  texte brut dans les logs ; le journal reçoit la liste brute des règles.
- Tests : `src/superpdp-messages.test.jsx`.

### 17. Étape 4, chantier 5 (30/09/2026) : procédure de production

- Document `PRODUCTION-SUPER-PDP.md` (bascule globale au site, prérequis,
  bascule, première facture réelle, retour arrière, journal des bascules).
- Action `status` de `superpdp-oauth` : champ `allowProduction` ; carte de Mon
  entreprise : ligne `superpdp-allow-production`. Tests :
  `src/superpdp-production.test.jsx`. Aucun SQL, aucun secret modifié.
