import { useState } from 'react';
import { Icon } from '../icons/Icons';
import { num } from '../../lib/format';
import type { ProductRow, AdjustStockInput } from '../../lib/types';

interface AdjustStockModalProps {
  product: ProductRow;
  onSave: (input: AdjustStockInput) => Promise<void>;
  onClose: () => void;
}

type AdjustType = 'Entrée' | 'Sortie' | 'Correction';

export function AdjustStockModal({ product, onSave, onClose }: AdjustStockModalProps) {
  const [type, setType] = useState<AdjustType>('Entrée');
  const [qty, setQty] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qtyNum = Number(qty) || 0;
  const newStock = type === 'Entrée'
    ? product.stock + qtyNum
    : type === 'Sortie'
      ? product.stock - qtyNum
      : qtyNum;

  const handleSave = async () => {
    if (!qty || qtyNum <= 0) { setError('Saisissez une quantité valide.'); return; }
    if (type === 'Sortie' && qtyNum > product.stock) {
      setError(`Stock insuffisant (${num(product.stock)} ${product.base_unit} disponible).`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSave({
        product_id: product.id,
        qty: qtyNum,
        adjustment_type: type,
        note: note.trim() || undefined,
      });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 380 }}>
        {/* Header */}
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Ajustement de stock</div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{product.name}</div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div className="modal-body">
          {/* Stock actuel */}
          <div style={{
            background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)',
            padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, color: 'var(--cr-ink-2)' }}>Stock actuel</span>
            <span className="mono" style={{ fontWeight: 600, fontSize: 16 }}>
              {num(product.stock)} <span style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>{product.base_unit}</span>
            </span>
          </div>

          {/* Type d'ajustement */}
          <div className="cr-field">
            <label className="cr-label">Type d'opération</label>
            <div className="auth-tabs">
              {(['Entrée', 'Sortie', 'Correction'] as AdjustType[]).map((t) => (
                <button
                  key={t}
                  className={`auth-tab${type === t ? ' active' : ''}`}
                  onClick={() => { setType(t); setError(null); }}
                  style={{ fontSize: 12.5 }}
                >
                  {t}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
              {type === 'Entrée' && 'Réception de marchandises, retour fournisseur…'}
              {type === 'Sortie' && 'Perte, casse, usage interne…'}
              {type === 'Correction' && 'Corriger le stock après un inventaire physique.'}
            </div>
          </div>

          {/* Quantité */}
          <div className="cr-field">
            <label className="cr-label">
              {type === 'Correction' ? `Nouveau stock (${product.base_unit})` : `Quantité (${product.base_unit})`}
            </label>
            <input
              className="cr-input mono"
              type="number"
              min="0"
              step="1"
              value={qty}
              onChange={(e) => { setQty(e.target.value === '' ? '' : Number(e.target.value)); setError(null); }}
              autoFocus
            />
          </div>

          {/* Aperçu nouveau stock */}
          {qtyNum > 0 && (
            <div style={{
              background: newStock < 0 ? 'var(--cr-danger-lt)' : 'var(--cr-good-lt)',
              borderRadius: 'var(--cr-r)', padding: '10px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, color: 'var(--cr-ink-2)' }}>Nouveau stock</span>
              <span className="mono" style={{
                fontWeight: 700, fontSize: 18,
                color: newStock < 0 ? 'var(--cr-danger)' : 'var(--cr-good)',
              }}>
                {num(Math.max(0, newStock))} {product.base_unit}
              </span>
            </div>
          )}

          {/* Note */}
          <div className="cr-field">
            <label className="cr-label">Note (optionnel)</label>
            <input
              className="cr-input"
              placeholder="Ex : Réception commande ACH-0312"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && <div className="cr-error">{error}</div>}
        </div>

        {/* Footer */}
        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            className="cr-btn cr-btn-primary"
            onClick={handleSave}
            disabled={busy || !qty || qtyNum <= 0}
          >
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Valider l\'ajustement'}
          </button>
        </div>
      </div>
    </div>
  );
}
