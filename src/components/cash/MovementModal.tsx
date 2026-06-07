import { useState } from 'react';
import { Icon } from '../icons/Icons';
import type { AddMovementInput } from '../../lib/types';

interface MovementModalProps {
  defaultType?: 'Apport' | 'Sortie';
  onSave: (input: AddMovementInput) => Promise<void>;
  onClose: () => void;
}

export function MovementModal({ defaultType = 'Apport', onSave, onClose }: MovementModalProps) {
  const [type, setType] = useState<'Apport' | 'Sortie'>(defaultType);
  const [amount, setAmount] = useState<number | ''>('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!amount || Number(amount) <= 0) { setError('Saisissez un montant valide.'); return; }
    setError(null);
    setBusy(true);
    try {
      await onSave({ movement_type: type, amount: Number(amount), detail: detail.trim() || undefined });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 360 }}>
        <div className="modal-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {type === 'Apport' ? 'Apport en caisse' : 'Sortie de caisse'}
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="auth-tabs">
            <button className={`auth-tab${type === 'Apport' ? ' active' : ''}`}
              onClick={() => setType('Apport')}>
              <Icon name="plus" size={13} /> Apport
            </button>
            <button className={`auth-tab${type === 'Sortie' ? ' active' : ''}`}
              onClick={() => setType('Sortie')}>
              <Icon name="chevronRight" size={13} /> Sortie
            </button>
          </div>

          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
            {type === 'Apport'
              ? 'Ajout d\'espèces dans le tiroir (apport propriétaire, monnaie…)'
              : 'Retrait d\'espèces du tiroir (course, paiement fournisseur…)'}
          </div>

          <div className="cr-field">
            <label className="cr-label">Montant (GNF) *</label>
            <input
              className="cr-input mono"
              type="number" min="0" step="100"
              placeholder="0"
              value={amount}
              onChange={(e) => { setAmount(e.target.value === '' ? '' : Number(e.target.value)); setError(null); }}
              autoFocus
            />
          </div>

          <div className="cr-field">
            <label className="cr-label">Motif (optionnel)</label>
            <input
              className="cr-input"
              placeholder={type === 'Apport' ? 'Ex : Apport propriétaire' : 'Ex : Course transport livraison'}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </div>

          {error && <div className="cr-error">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy || !amount}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  );
}
