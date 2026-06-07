# 📋 MODIFICATIONS COMPLÈTES - PLAN DÉTAILLÉ

## 🔴 **CRITIQUES (À faire d'abord)**

### **FIX #1 - Dépense sans compte BLOQUÉE**
**Fichier** : `src-tauri/src/commands/expenses.rs`

**Changement** :
```rust
// Avant : ❌ Compte optionnel
if let Some(ref account_id) = input.treasury_account_id { ... }

// Après : ✅ Compte obligatoire
if input.treasury_account_id.is_none() {
    return Err(KomersaError::Validation(
        "Le compte débité est obligatoire. Sélectionnez un compte de trésorerie.".into(),
    ));
}
```

---

### **FIX #2 - Caisse obligatoire par défaut**
**Fichier** : `src-tauri/src/commands/settings.rs`

**Changement** :
```rust
// À la création du commerce :
conn.execute(
    "INSERT INTO settings (key, commerce_id, value) VALUES (?, ?, ?)",
    rusqlite::params!["require_cash_open", &commerce_id, "1"],
)?;
```

```tsx
// Frontend : src/views/SettingsView.tsx
const [requireCashOpen, setRequireCashOpen] = useState(true); // Par défaut TRUE
```

---

### **FIX #3 - Plafond crédit APPLIQUÉ**
**Fichier** : `src-tauri/src/commands/sales.rs`

**Changement** :
```rust
// Vérifier plafond crédit AVANT de créer la vente
if credit_amount > 0.0 {
    let (credit_limit, current_credit): (f64, f64) = conn.query_row(
        "SELECT c.credit_limit, COALESCE(SUM(cc.remaining), 0)
         FROM clients c
         LEFT JOIN customer_credits cc ON cc.client_id = c.id AND cc.status != 'Soldé'
         WHERE c.id = ?1 AND c.commerce_id = ?2",
        rusqlite::params![client_id, sess.commerce_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap_or((0.0, 0.0));

    if current_credit + credit_amount > credit_limit + 0.01 {
        return Err(KomersaError::Validation(format!(
            "Crédit client dépassé : plafond {} GNF, utilisation actuelle {} GNF, demande {} GNF.",
            credit_limit as i64, current_credit as i64, credit_amount as i64
        )));
    }
}
```

---

### **FIX #4 - Remboursement fournisseur avec HISTORIQUE**
**Fichier** : `src-tauri/src/commands/purchases.rs`

**Changement** :
```rust
// Créer table : supplier_debt_payments
// (Elle existe déjà mais n'était jamais alimentée)

#[tauri::command]
pub fn add_debt_payment(...) -> KomersaResult<()> {
    // ✅ Insérer dans l'historique
    conn.execute(
        "INSERT INTO supplier_debt_payments
           (id, debt_id, amount, mode_label, treasury_account_id, paid_by, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        ...
    )?;
    
    // ✅ Débiter le compte
    if let Some(ref account_id) = input.treasury_account_id {
        crate::commands::treasury::ensure_balance(...)?;
        conn.execute("UPDATE treasury_accounts SET balance=balance-?2...")?;
    }
}
```

---

### **FIX #5 - Remboursement client COMPTANT → CAISSE**
**Fichier** : `src-tauri/src/commands/clients.rs`

**Changement** :
```rust
#[tauri::command]
pub fn add_credit_payment(...) -> KomersaResult<()> {
    // Si comptant :
    let target_account = if input.mode_label == "Comptant" {
        let cash_session: Option<String> = conn.query_row(
            "SELECT id FROM cash_sessions WHERE seller_id=?1 AND status='open' LIMIT 1",
            [&sess.account_id], |r| r.get(0),
        ).ok();
        
        // ✅ BLOQUER si pas de caisse ET pas de compte spécifié
        if cash_session.is_none() && input.treasury_account_id.is_none() {
            return Err(KomersaError::Validation(
                "Comptant accepté seulement si caisse ouverte OU compte spécifié.".into(),
            ));
        }
        
        input.treasury_account_id.clone()
    } else {
        input.treasury_account_id.clone()
    };

    // ✅ Débiter le compte
    if let Some(ref account_id) = target_account {
        crate::commands::treasury::ensure_balance(&conn, &sess.commerce_id, account_id, input.amount.round())?;
        conn.execute("UPDATE treasury_accounts SET balance=balance+?2...")?;
    }
}
```

---

### **FIX #6 - Permission annulation → Message d'erreur**
**Fichier** : `src/views/POSView.tsx`

**Changement** :
```tsx
const handleCancelSale = async (saleId: string) => {
  try {
    await api.sales.cancelSale({ sale_id: saleId, reason: undefined });
    // ... reload ...
  } catch (e) {
    // ✅ Afficher l'erreur (y compris permission denied)
    const msg = String(e).includes('Permission') 
      ? 'Vous n\'avez pas la permission d\'annuler une vente.'
      : String(e);
    showToast(msg, 'error');  // Toast visible
  }
};
```

---

## 🟡 **IMPORTANTS (Phase 1)**

### **FIX #7 - Quantité produit simple → ProductPicker**
**Fichier** : `src/views/POSView.tsx`

**Changement** :
```tsx
// Avant : ❌
const onProductClick = (product: ProductRow) => {
    const hasChoices = product.variants.length > 0 || product.units.length > 0;
    if (hasChoices) { setPicker(product); return; }
    // Sinon : ajout direct direct
    pushItem(...);
};

// Après : ✅ Toujours ouvrir le ProductPicker
const onProductClick = (product: ProductRow) => {
    setPicker(product);  // Toujours, même pour produit simple
};
```

---

### **FIX #8 - Ajustement stock avec déclinaison**
**Fichier** : `src/components/stock/AdjustStockModal.tsx` (NOUVEAU)

**Créer ce composant** :
```tsx
export function AdjustStockModal({ product, onSave, onClose }: {
  product: ProductRow;
  onSave: (input: AdjustStockInput) => Promise<void>;
  onClose: () => void;
}) {
  const [variant, setVariant] = useState('');  // ✅ NOUVEAU
  const [qty, setQty] = useState('');
  const [type, setType] = useState('Entrée');
  
  const handleSave = async () => {
    await onSave({
      product_id: product.id,
      adjustment_type: type,
      qty: Number(qty),
      variant: variant || undefined,  // ✅ Optionnel
    });
  };

  return (
    <div className="modal">
      {/* ✅ Choisir la déclinaison */}
      {product.variants.length > 0 && (
        <div className="cr-field">
          <label>Déclinaison (optionnel)</label>
          <select value={variant} onChange={(e) => setVariant(e.target.value)}>
            <option value="">— Tout le produit —</option>
            {product.variants.map((v) => (
              <option key={v.id} value={v.value}>{v.value}</option>
            ))}
          </select>
        </div>
      )}
      
      {/* Type + Quantité */}
      <div className="cr-field">
        <label>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option>Entrée</option>
          <option>Sortie</option>
          <option>Correction</option>
        </select>
      </div>
      
      <div className="cr-field">
        <label>Quantité</label>
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      
      <button onClick={handleSave}>Valider</button>
    </div>
  );
}
```

**Backend** : `src-tauri/src/commands/catalog.rs`
```rust
#[derive(Deserialize)]
pub struct AdjustStockInput {
    pub product_id: String,
    pub qty: f64,
    pub adjustment_type: String,
    pub note: Option<String>,
    pub variant: Option<String>,  // ✅ NOUVEAU
}

pub fn adjust_stock(...) -> KomersaResult<f64> {
    if let Some(ref v) = input.variant {
        // Ajuster la déclinaison spécifique
        conn.execute(
            "UPDATE product_variants SET stock = stock + ?2 WHERE product_id=?1 AND value=?3",
            ...
        )?;
    } else {
        // Ajuster le produit global
        conn.execute(
            "UPDATE products SET stock = stock + ?2...",
            ...
        )?;
    }
}
```

---

### **FIX #9 - Catégorie dépense LIBRE**
**Fichier** : `src/views/ExpensesView.tsx`

**Changement** :
```tsx
// Avant : ❌ Select fermé
<select className="cr-input" value={category} onChange={(e) => setCategory(e.target.value)}>
    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
</select>

// Après : ✅ Input libre + datalist
<input
    className="cr-input"
    list="category-list"
    value={category}
    onChange={(e) => setCategory(e.target.value)}
    placeholder="Ex : Fournitures"
/>
<datalist id="category-list">
    {allCategories.map((c) => <option key={c} value={c} />)}
</datalist>
```

---

### **FIX #10 - Remboursement client vers CAISSE (✓ Déjà fixé au #5)**

---

### **FIX #11 - Facture : Ajouter PHONE + EMAIL**
**Fichier** : `src/components/receipt/Receipt.tsx`

**Changement** :
```tsx
export function Receipt({ sale, client }: { sale: SaleRow; client?: ClientFull }) {
  return (
    <div className="receipt">
      {client && (
        <div>
          <div>{client.name}</div>
          {/* ✅ NOUVEAU */}
          {client.phone && <div>{client.phone}</div>}
          {client.email && <div>{client.email}</div>}
        </div>
      )}
      ...
    </div>
  );
}
```

---

### **FIX #12 - Historique ventes : MÀJ STATUT**
**Fichier** : `src/views/SalesHistoryView.tsx`

**Changement** :
```tsx
const handleCreditPayment = async () => {
  await api.clients.addCreditPayment(...);
  
  // ✅ Recharger les ventes (le statut peut avoir changé)
  const updated = await api.sales.listSales();
  setSales(updated);
};
```

---

### **FIX #13 - Crédit client : EXPORT HTML + PRINT**
**Fichier** : `src/views/CustomerCreditsView.tsx`

**Changement** :
```tsx
const handleExportHTML = () => {
  const html = `
    <html>
      <head>
        <title>Situation des crédits</title>
        <style>
          body { font-family: Arial; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
          th { background-color: #f5f5f5; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Situation des crédits clients</h1>
        <p>Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
        <table>
          <tr>
            <th>Client</th>
            <th>Initial</th>
            <th>Payé</th>
            <th>Restant</th>
            <th>Statut</th>
          </tr>
          ${credits.map((c) => `<tr>
            <td>${c.client_name}</td>
            <td>${c.initial} GNF</td>
            <td>${c.paid} GNF</td>
            <td>${c.remaining} GNF</td>
            <td>${c.status}</td>
          </tr>`).join('')}
        </table>
      </body>
    </html>
  `;
  
  const w = window.open();
  w?.document.write(html);
  w?.document.close();
  w?.print();  // ✅ Ouvre dialogue d'impression
};
```

**Ajouter bouton** :
```tsx
<button onClick={handleExportHTML} className="cr-btn">
  <Icon name="download" size={14} /> Export HTML & Impression
</button>
```

---

## 📊 **RÉSUMÉ**

| # | Type | Fichier | Tâche |
|---|------|---------|-------|
| 1 | Critique | expenses.rs | Compte obligatoire |
| 2 | Critique | settings.rs | Caisse par défaut TRUE |
| 3 | Critique | sales.rs | Plafond crédit bloquant |
| 4 | Critique | purchases.rs | Historique remboursement |
| 5 | Critique | clients.rs | Remboursement → caisse |
| 6 | Critique | POSView.tsx | Message permission |
| 7 | Important | POSView.tsx | ProductPicker toujours |
| 8 | Important | AdjustStockModal.tsx | Choix déclinaison |
| 9 | Important | ExpensesView.tsx | Catégorie libre |
| 10 | - | clients.rs | (Inclus dans FIX #5) |
| 11 | Important | Receipt.tsx | Phone + Email |
| 12 | Important | SalesHistoryView.tsx | Recharge après paiement |
| 13 | Important | CustomerCreditsView.tsx | Export HTML + Print |

---

## ✅ **INSTALLATION**

1. Créer branche : `git checkout -b fix/all-issues`
2. Copier les modifications
3. Tester localement
4. Commit : `git commit -m "Fix: All 13 issues fixed"`
5. Push : `git push origin fix/all-issues`
6. Créer PR

