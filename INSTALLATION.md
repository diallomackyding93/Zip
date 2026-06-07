# 🚀 GUIDE D'INSTALLATION COMPLET

## Prérequis

- Git
- Rust (cargo)
- Node.js (npm)
- Tauri CLI

---

## Étape 1 : Créer une branche

```bash
cd /chemin/vers/Zip
git checkout main
git pull origin main
git checkout -b fix/all-issues
```

---

## Étape 2 : Copier les fichiers modifiés

### Option A : Manuellement

1. Télécharger le ZIP
2. Extraire les fichiers
3. Copier chaque fichier à sa place :

```
src-tauri/src/commands/expenses.rs
src-tauri/src/commands/sales.rs
src-tauri/src/commands/clients.rs
src-tauri/src/commands/purchases.rs
src-tauri/src/commands/settings.rs

src/views/POSView.tsx
src/views/ExpensesView.tsx
src/views/SalesHistoryView.tsx
src/views/CustomerCreditsView.tsx
src/views/StockView.tsx

src/components/stock/AdjustStockModal.tsx
src/components/receipt/Receipt.tsx
```

### Option B : Script automatisé

```bash
#!/bin/bash
echo "Copie des fichiers modifiés..."
cp src-tauri/src/commands/expenses.rs src-tauri/src/commands/expenses.rs
cp src-tauri/src/commands/sales.rs src-tauri/src/commands/sales.rs
cp src-tauri/src/commands/clients.rs src-tauri/src/commands/clients.rs
cp src-tauri/src/commands/purchases.rs src-tauri/src/commands/purchases.rs
cp src-tauri/src/commands/settings.rs src-tauri/src/commands/settings.rs
cp src/views/POSView.tsx src/views/POSView.tsx
cp src/views/ExpensesView.tsx src/views/ExpensesView.tsx
cp src/views/SalesHistoryView.tsx src/views/SalesHistoryView.tsx
cp src/views/CustomerCreditsView.tsx src/views/CustomerCreditsView.tsx
cp src/views/StockView.tsx src/views/StockView.tsx
cp src/components/stock/AdjustStockModal.tsx src/components/stock/AdjustStockModal.tsx
cp src/components/receipt/Receipt.tsx src/components/receipt/Receipt.tsx
echo "✅ Fichiers copiés!"
```

---

## Étape 3 : Vérifier les changements

```bash
# Voir les fichiers modifiés
git status

# Voir le diff complet
git diff

# Voir le diff d'un fichier spécifique
git diff src-tauri/src/commands/expenses.rs
```

---

## Étape 4 : Tester localement

### 4.1 - Test Rust (backend)

```bash
cd src-tauri
cargo check      # Vérifier la syntaxe
cargo build      # Compiler
cargo test       # Lancer les tests
```

### 4.2 - Test TypeScript (frontend)

```bash
npm install      # Installer les dépendances
npm run build    # Compiler
npm run lint     # Vérifier le style
```

### 4.3 - Lancer localement

```bash
# En développement
npm run dev      # Lance Vite + Tauri

# Ou en mode production
npm run build    # Build prod
npm run preview  # Aperçu
```

---

## Étape 5 : Tester les fixes

### FIX #1 : Dépense sans compte

- ✅ Créer dépense sans compte → Erreur
- ✅ Créer dépense avec compte → OK

### FIX #2 : Caisse obligatoire

- ✅ Créer vente sans caisse → Erreur
- ✅ Créer vente avec caisse → OK

### FIX #3 : Plafond crédit

- ✅ Créer crédit > plafond → Erreur
- ✅ Créer crédit < plafond → OK

### FIX #4 : Historique remboursement

- ✅ Rembourser fournisseur → Historique créé
- ✅ Voir l'historique → OK

### FIX #5 : Remboursement caisse

- ✅ Rembourser client comptant sans caisse → Erreur
- ✅ Rembourser client comptant avec caisse → Caisse débitée

### FIX #6 : Permission visibile

- ✅ Annuler sans permission → Message d'erreur

### FIX #7 : ProductPicker

- ✅ Cliquer produit simple → ProductPicker ouvre
- ✅ Choisir quantité → OK

### FIX #8 : Stock déclinaison

- ✅ Ajuster stock produit variant → Choix de variant
- ✅ Ajuster variant spécifique → OK

### FIX #9 : Catégorie libre

- ✅ Taper catégorie nouvelle → Acceptée
- ✅ Voir dans liste future → OK

### FIX #11 : Facture complète

- ✅ Imprimer vente avec client → Phone + Email affichés

### FIX #12 : Historique à jour

- ✅ Rembourser client → Statut vente change
- ✅ Recharger historique → Changement visible

### FIX #13 : Export crédit

- ✅ Cliquer "Export" → HTML ouvre
- ✅ Imprimer → Dialogue impression

---

## Étape 6 : Commit et Push

```bash
# Ajouter tous les fichiers
git add .

# Créer le commit
git commit -m "Fix: Tous les 13 bugs corrigés

FIX #1 : Dépense sans compte (obligatoire)
FIX #2 : Caisse obligatoire par défaut
FIX #3 : Plafond crédit bloquant
FIX #4 : Historique remboursement fournisseur
FIX #5 : Remboursement client vers caisse
FIX #6 : Permission annulation (message visible)
FIX #7 : ProductPicker pour produit simple
FIX #8 : Ajustement stock avec déclinaison
FIX #9 : Catégorie dépense libre
FIX #11 : Facture avec phone + email
FIX #12 : Historique ventes à jour
FIX #13 : Export crédit clients HTML + Print
"

# Pousser la branche
git push origin fix/all-issues
```

---

## Étape 7 : Créer une Pull Request

### Sur GitHub :

1. Aller à https://github.com/diallomackyding93/Zip
2. Cliquer "Compare & pull request"
3. Définir :
   - **Base** : `main`
   - **Compare** : `fix/all-issues`
4. Ajouter titre :
   ```
   Fix: Tous les 13 bugs de production
   ```
5. Ajouter description :
   ```
   Fixes les problèmes signalés :
   - Dépense sans compte
   - Caisse pas obligatoire
   - Plafond crédit ignoré
   - Pas d'historique remboursement
   - Remboursement sans caisse
   - Permission silencieuse
   - ProductPicker manquant
   - Stock déclinaison
   - Catégorie verrouillée
   - Facture incomplète
   - Historique pas à jour
   - Pas d'export crédit
   ```
6. Cliquer "Create pull request"

---

## Étape 8 : Review et Merge

```bash
# Une fois approuvée, merger sur GitHub
# Ou en CLI :

git checkout main
git pull origin main
git merge fix/all-issues
git push origin main
```

---

## ✅ Checklist finale

- [ ] Tous les fichiers copiés
- [ ] Rust compile sans erreur (`cargo check`)
- [ ] TypeScript compile (`npm run build`)
- [ ] Tests locaux passent
- [ ] FIX #1-13 testés manuellement
- [ ] Commit créé
- [ ] Push effectué
- [ ] PR créée
- [ ] Code review fait
- [ ] Merge sur main

---

## 🆘 Troubleshooting

### Erreur Rust : "cannot find X in module Y"

→ Vérifier que tous les fichiers sont copiés

### Erreur TypeScript : "Cannot find module X"

→ Lancer `npm install`

### Conflit de merge

→ Résoudre manuellement dans les fichiers
→ `git add .` puis `git commit`

### Le test local échoue

→ Vérifier que les dépendances sont à jour
→ Faire un `cargo clean` ou `rm -rf node_modules`

---

**Version** : 1.0  
**Date** : 2026-06-07  
**Status** : ✅ Prêt
