# Passage en production de Super PDP — procédure

Ce document décrit comment faire passer Chantiflow des envois de test (bac à
sable) aux envois réels de factures électroniques via Super PDP. **Rien ici
n'est exécuté par le code** : chaque étape est une action manuelle, décidée et
faite par le responsable du site. Tant que la variable `SUPERPDP_ALLOW_PRODUCTION`
n'est pas à `true`, le site refuse toute entreprise en production, à la
connexion, à l'envoi et à la relecture.

Guide de fonctionnement et dépannage : `SUPER-PDP.md`.

---

## 1. Décision et périmètre

- **La bascule est globale au site.** Une seule application Super PDP est
  configurée côté serveur (secrets `SUPERPDP_CLIENT_ID` / `SUPERPDP_CLIENT_SECRET`).
  Après la bascule, tout compte connecté depuis Mon entreprise, pour toute
  organisation, l'est en production. Une bascule par organisation demanderait
  deux jeux de secrets et un choix par entreprise : non retenu (décision du
  30/09/2026).
- **Ce qui change pour les utilisateurs** : les pièces envoyées via Super PDP
  sont réellement transmises au client et à l'administration (obligation de
  facturation électronique) ; un envoi ne s'annule pas ; une erreur se corrige
  par un avoir puis une nouvelle pièce, jamais par une suppression.
- **Qui décide** : le responsable du site, après le parcours de test en bac à
  sable validé de bout en bout (guide, section 2) et cette liste de
  prérequis entièrement cochée.
- **Quand** : de préférence en début de journée ouvrée, avec le temps de
  suivre la première facture réelle jusqu'à son statut « Reçue ».

## 2. Prérequis (liste à cocher)

### Côté Super PDP (tableau de bord, interrupteur « Bac à sable » éteint)

- [ ] L'application de **production** existe (identifiant client `01a0d903…`),
      rattachée à la vraie entreprise (SIREN réel), et non à une entreprise de
      test.
- [ ] Son adresse de retour est exactement `https://www.chantiflow.fr/?superpdp=retour`.
- [ ] Le `client_secret` de production est disponible (il ne s'affiche qu'à la
      création : le régénérer si besoin).
- [ ] La vraie entreprise est **vérifiée** (statut `verified` dans
      « Sessions » ou sur la fiche entreprise) ; sinon l'envoi sera refusé.
- [ ] Ses lignes d'annuaire (France et Peppol) sont au statut OK.

### Côté Chantiflow, page Mon entreprise

- [ ] Pays : France.
- [ ] SIRET réel à 14 chiffres.
- [ ] Numéro de TVA réel : `FR` + 11 caractères (le numéro de test à 15 chiffres
      utilisé en bac à sable ne passera pas les contrôles de fond).
- [ ] Adresse complète : rue, code postal, ville.
- [ ] IBAN et BIC (coordonnées de paiement dans le Factur-X).
- [ ] Catégorie d'opération par défaut cohérente avec l'activité.

### Côté données

- [ ] Les fiches clients professionnels français portent un **vrai SIRET**
      (14 chiffres) et un numéro de TVA avec préfixe pays. Plus aucune adresse
      de test (`0225:315143296_…`) dans un champ SIRET.
- [ ] Les pièces de test envoyées en bac à sable sont archivées ou clairement
      identifiées ; elles resteront marquées « bac à sable » dans le journal.
- [ ] Les utilisateurs ont été prévenus de la date et de ce qui change.

### Côté technique

- [ ] Parcours de test en bac à sable validé de bout en bout : connexion,
      envoi, statut « Reçue », encaissement, refus puis renvoi.
- [ ] Table `pdp_journal` en place (script étape 4) et journal visible.
- [ ] Tâche planifiée `superpdp-sync-events-quotidien` active (Supabase →
      Database → Cron).
- [ ] Les trois fonctions Super PDP et le front sont à jour du dernier
      déploiement validé.

## 3. Bascule, pas à pas

Ne passer à l'étape suivante que si le résultat attendu est constaté.

1. **Sauvegarder** les valeurs actuelles des secrets `SUPERPDP_CLIENT_ID`
   et `SUPERPDP_CLIENT_SECRET` (bac à sable) dans un gestionnaire de mots de
   passe, pour un retour arrière rapide. Ne jamais les mettre dans le dépôt.
2. **Déconnecter** le compte de test dans Chantiflow, page Mon entreprise,
   carte Super PDP → « Déconnecter ». Attendu : la carte propose
   « Connecter mon compte Super PDP ».
3. **Remplacer les secrets** dans Supabase (Edge Functions → Secrets) :
   `SUPERPDP_CLIENT_ID` et `SUPERPDP_CLIENT_SECRET` par ceux de l'application de
   production ; `SUPERPDP_ALLOW_PRODUCTION` = `true`.
4. **Redéployer** les trois fonctions `superpdp-oauth`, `superpdp-send-invoice`
   et `superpdp-sync-events` (les secrets sont lus au démarrage). Attendu : les
   déploiements réussissent.
5. **Vérifier l'autorisation du site** : recharger Mon entreprise ; la carte
   affiche « Envois réels autorisés sur le site : oui ».
6. **Reconnecter** : « Connecter mon compte Super PDP » ; sur la page Super
   PDP, se connecter avec le compte de la vraie entreprise (interrupteur bac à
   sable éteint). En production, le SIREN de Mon entreprise est transmis à
   l'autorisation pour pré-remplir. Attendu : la carte affiche le nom de la
   vraie entreprise, « SIREN … », badge **Production**, aucun message
   « Connexion à refaire ».
7. **Relire** : bouton « Actualiser » sur une pièce, ou attendre la tâche
   quotidienne. Attendu : aucune erreur sur la carte.

## 4. Première facture réelle

1. Choisir un **client réel déjà inscrit** à l'annuaire de la facturation
   électronique (sinon l'envoi est bloqué en production, c'est voulu), avec un
   montant faible et un contact prévenu.
2. Préparer la facture : statut « envoyée », catégorie d'opération, TVA avec
   préfixe pays sur les deux parties. Télécharger d'abord le Factur-X et
   l'ouvrir pour un dernier contrôle visuel.
3. Menu Exporter → « Envoyer via Super PDP » → la confirmation indique
   **(production)**. Attendu : badge « Déposée », contenu figé, ligne
   « Envoi » au journal marquée production.
4. Suivre : « Actualiser » jusqu'à « Émise » puis « Reçue » (selon la
   plateforme du client, quelques minutes à quelques heures).
5. Au paiement : passer la facture « payée » ; attendu : badge
   « encaissement transmis » (événement `fr:212`) et ligne « Encaissement »
   au journal.
6. En cas de **refus** (bandeau rouge) : lire le motif traduit, corriger,
   « Renvoyer ». Si le motif vient de la plateforme du client, le contacter
   avant de renvoyer.

## 5. Retour arrière et incidents

- **Suspendre les envois réels** : `SUPERPDP_ALLOW_PRODUCTION` = `false`, puis
  redéployer les trois fonctions. Effet immédiat : connexion, envoi et
  relecture refusés pour les comptes en production, avec le message
  « Compte Super PDP en production : les envois réels ne sont pas encore
  autorisés ». Rien n'est perdu : les pièces déjà transmises restent
  transmises et leur suivi reprend à la réactivation.
- **Revenir au bac à sable** : remettre les secrets sauvegardés à l'étape 1,
  redéployer, déconnecter puis reconnecter avec l'entreprise de test.
- **Facture envoyée par erreur** : établir un avoir sur cette facture et le
  transmettre via Super PDP ; ne jamais supprimer la facture (la ligne
  d'envoi et le journal sont conservés comme preuve, une pièce supprimée est
  signalée au journal).
- **Compte révoqué ou jeton expiré** : la carte affiche « Connexion à
  refaire » → bouton « Reconnecter ».
- **Support Super PDP** : fournir l'identifiant de l'application, le SIREN,
  le numéro de dépôt (`invoiceId` visible au journal) et l'identifiant externe
  de la pièce ; le journal conserve le texte d'origine des erreurs.

## 6. Journal des bascules

| Date | Action | Par | Résultat |
|---|---|---|---|
| | | | |
