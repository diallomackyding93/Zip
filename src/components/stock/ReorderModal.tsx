import { useState } from 'react';
import { money } from '../../lib/format';
import { Icon } from '../icons/Icons';
import type { ProductRow, SupplierRow, TreasuryAccountRow, CreatePurchaseInput } from '../../lib/types';

// Réassort → commande d'achat. Quantité suggérée = cible − stock actuel
// (cible = stock_max si défini, sinon 2× le seuil mini).
export function ReorderModal({ product, suppliers, accounts, onSave, onClose }: {
  product: ProductRow;
  suppliers: SupplierRow[];
  accounts: TreasuryAccountRow[];
  onSave: (input: CreatePurchaseInput) => Promise<void>;
  onClose: () => void;
}) {
  const target = product.stock_max && product.stock_max > 0
    ? product.stock_max
    : (product.stock_min > 0 ? product.stock_min * 2 : product.stock + 1);
  const suggested = Math.max(1, Math.round(target - product.stock));

  const [qty, setQty] = useState<number>(suggested);
  const [unitCost, setUnitCost] = useState<number>(product.cost || 0);
  const [supplierName, setSupplierName] = useState(product.supplier_name ?? '');
  const [mode, setMode] = useState('Crédit fournisseur');
  const [accountId, setAccountId] = useState<string>(() => accounts[0]?.id ?? '');
  const [receiveNow, setReceiveNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());

  const lineTotal = qty * unitCost;

  const handleSave = async () => {
    if (!supplierName.trim()) { setError('Le fournisseur est requis.'); return; }
    if (qty <= 0) { setError('La quantité doit être supérieure à 0.'); return; }
    if (unitCost <= 0) { setError('Le coût unitaire doit être supérieur à 0.'); return; }
    setError(null); setBusy(true);
    try {
      const sup = suppliers.find((s) => s.name === supplierName);
      const isCredit = mode.includes('Crédit');
      await onSave({
        supplier_id: sup?.id, supplier_name: supplierName.trim(),
        mode_label: mode, receive_now: receiveNow,
        note: `Réassort ${product.name}`,
        items: [{
          product_id: product.id, product_name: product.name,
          qty, unit_name: product.base_unit, unit_cost: unitCost,
        }],
        treasury_account_id: isCredit ? undefined : (accountId || undefined),
        idempotency_key: idemKey,
      });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 400 }}>
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Réassort</div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{product.name}</div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px',
            background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)', fontSize: 13 }}>
            <span style={{ color: 'var(--cr-ink-2)' }}>Stock actuel</span>
            <span className="mono"><strong>{product.stock}</strong> {product.base_unit} · seuil {product.stock_min || '—'}</span>
          </div>

          <div className="cr-field">
            <label className="cr-label">Fournisseur *</label>
            <input className="cr-input" list="reorder-sup-list" value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)} placeholder="Choisir ou saisir…" autoFocus />
            <datalist id="reorder-sup-list">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          </div>

          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Quantité ({product.base_unit})</label>
              <input className="cr-input mono" type="number" min="1" value={qty}
                onChange={(e) => setQty(Number(e.target.value))} />
              <div className="cr-hint" style={{ marginTop: 4 }}>Suggéré : {suggested}</div>
            </div>
            <div className="cr-field">
              <label className="cr-label">Coût unitaire</label>
              <input className="cr-input mono" type="number" min="0" value={unitCost}
                onChange={(e) => setUnitCost(Number(e.target.value))} />
            </div>
          </div>

          <div className="cr-field">
            <label className="cr-label">Mode de paiement</label>
            <select className="cr-input" value={mode} onChange={(e) => setMode(e.target.value)}>
              {['Comptant', 'Crédit fournisseur', 'Mobile Money', 'Virement'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {!mode.includes('Crédit') && receiveNow && (
            <div className="cr-field">
              <label className="cr-label">Compte débité</label>
              <select className="cr-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— Aucun (non suivi) —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
          )}

          <label className="module-toggle" onClick={() => setReceiveNow((v) => !v)}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>Réception immédiate</div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Mise en stock dès l'enregistrement</div>
            </div>
            <div className={`toggle-switch${receiveNow ? ' on' : ''}`} />
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15,
            padding: '10px 14px', background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)' }}>
            <span>Total commande</span>
            <span className="mono">{money(lineTotal)}</span>
          </div>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} />
              : receiveNow ? 'Commander et réceptionner' : 'Créer la commande'}
          </button>
        </div>
      </div>
    </div>
  );
}
