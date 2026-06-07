# Changelog — KOMERSA

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/).
Versionnage : `MAJEUR.MINEUR.CORRECTIF`.

---

## [0.1.0] — 2026-06-05 — Phase 1 (local-first)

Première base officielle de KOMERSA : application desktop **Tauri (Rust) + React/TypeScript**,
base **SQLite locale**, **base vierge** (aucune donnée de démonstration). Fonctionne hors-ligne.

### Modules métier
- **Ventes / POS** : panier persistant, paiements mixtes (espèces, Mobile Money, crédit client),
  reçus imprimables, retours, annulation. Contrôle de stock : impossible de vendre au-delà du disponible.
- **Caisse par vendeur** : chaque utilisateur ouvre/clôture **sa** caisse ; clôture → remise des
  fonds vers un compte de trésorerie (confirmation responsable selon les droits).
- **Trésorerie** : comptes créés par l'utilisateur, soldes, transferts inter-comptes, relevés.
- **Crédits clients**, **achats**, **dettes fournisseurs**, **dépenses**.
- **Stock**, **inventaire**, **clients**, **fournisseurs**, **photos** (produits/clients/comptes).
- **Rapports** : CA, marge, modes de paiement, catégories, top produits, évolution ; aperçu
  imprimable, export **PDF / HTML / CSV**, **rapport personnalisé** par blocs.
- **Alertes** : stock faible/rupture, échéances crédits/dettes, écart de caisse, vente à perte,
  stock dormant, plafond de crédit, objectif mensuel, caisse fermée, etc.
- **Tableau de bord** : KPI du jour/mois, tendance 30 jours, objectif, indicateurs, assistant.

### Multi-commerce / utilisateurs
- Commerces, comptes, membres, **rôles & permissions** (appliqués **côté Rust**, pas seulement
  à l'écran), invitations, postes, licence (structure prête pour la Phase 2).
- **Sélecteur de profils** à la connexion (photo + nom), reconnexion par mot de passe ou PIN.
- **Verrouillage de session** par inactivité (re-saisie PIN/mot de passe).
- Navigation **filtrée par permission** : un utilisateur ne voit que les écrans autorisés.

### Sécurité & intégrité
- Jamais de **solde de trésorerie négatif** (`ensure_balance`, refuse aussi un compte invalide).
- Jamais de **stock négatif** ; **anti-double-encaissement** (clé d'idempotence).
- **Vente à crédit** : client obligatoire. Clés étrangères SQLite activées.
- **Anti auto-escalade** : interdiction de modifier son propre rôle / ses propres permissions.
- Revalidation du **statut du membership** à chaque contrôle (compte suspendu = accès coupé).
- **Journal d'audit** append-only des actions sensibles (rôles, permissions, annulations,
  clôtures, remises, transferts, paiements fournisseur, dépenses, ajustements de stock, sauvegardes).

### Sauvegarde
- **Sauvegarde / restauration locale** de la base (Paramètres → Maintenance) : export `.db`
  cohérent (`VACUUM INTO`), restauration appliquée au démarrage suivant, emplacement de la base affiché.

### Technique
- Polices embarquées **offline** : Manrope (UI), JetBrains Mono (chiffres), Playfair Display (grands montants).
- Migrations SQLite incrémentales (schéma à `0016`).
- Dépôt git initialisé, `.gitignore` (exclut `node_modules`, `dist`, `src-tauri/target`, `*.db`).

### Hors périmètre (Phase 2)
Synchronisation cloud (Supabase), activation/licence en ligne, applications web & mobile,
planification & modèles de rapports enregistrés, regroupement jour/semaine/mois.
