import { useState } from 'react';
import { Icon } from '../icons/Icons';
import { PhotoSlot } from '../PhotoSlot';
import { money } from '../../lib/format';
import type { PaymentModeRow, SalePaymentInput } from '../../lib/types';

interface EncaissementModalProps {
  total: number;
  paymentModes: PaymentModeRow[];
  clientId?: string;
  onConfirm: (payments: SalePaymentInput[]) => Promise<void>;
  onClose: () => void;
}

// Logo du compte de trésorerie associé, sinon icône du mode.
function ModeGlyph({ mode, size = 22 }: { mode: PaymentModeRow; size?: number }) {
  if (mode.treasury_account_id) {
    return <PhotoSlot entityType="treasury" entityId={mode.treasury_account_id} fallbackIcon={mode.icon} kind="product" shape="square" size={size} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: 6, background: 'var(--cr-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cr-ink-2)' }}>
      <Icon name={mode.icon} size={Math.round(size * 0.6)} />
    </span>
  );
}

export function EncaissementModal({ total, paymentModes, clientId, onConfirm, onClose }: EncaissementModalProps) {
  const [mixte, setMixte] = useState(false);

  // --- Paiement unique ---
  const [selected, setSelected] = useState(paymentModes[0]?.value ?? 'Comptant');
  const [received, setReceived] = useState<string>(String(total));

  // --- Paiement mixte ---
  const [amounts, setAmounts] = useState<Record<string, string>>({ [paymentModes[0]?.value ?? 'Comptant']: String(total) });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMode = paymentModes.find((m) => m.value === selected);
  const isCash = selected === 'Comptant';
  const isCredit = selected === 'Crédit client';
  const renduUnique = isCash ? Math.max(0, (Number(received) || 0) - total) : 0;

  // Mixte : totaux
  const totalSaisi = paymentModes.reduce((s, m) => s + (Number(amounts[m.value] || 0)), 0);
  const creditAmount = Number(amounts['Crédit client'] || 0);
  const cashPart = totalSaisi - creditAmount;
  const renduMixte = cashPart > total ? cashPart - total : 0;
  const resteAPayer = Math.max(0, total - totalSaisi);

  const handleConfirm = async () => {
    setError(null);
    let payments: SalePaymentInput[];

    if (!mixte) {
      if (isCredit && !clientId) { setError('Sélectionnez un client pour une vente à crédit.'); return; }
      if (isCash && (Number(received) || 0) < total - 0.01) {
        setError('Le montant reçu est inférieur au total.'); return;
      }
      payments = [{ mode_label: selected, treasury_account_id: selectedMode?.treasury_account_id, amount: total }];
    } else {
      if (totalSaisi < total - 0.01) { setError(`Il manque ${money(resteAPayer)} pour valider.`); return; }
      if (creditAmount > 0 && !clientId) { setError('Sélectionnez un client pour la part à crédit.'); return; }
      payments = paymentModes
        .filter((m) => Number(amounts[m.value] || 0) > 0)
        .map((m) => ({ mode_label: m.value, treasury_account_id: m.treasury_account_id, amount: Number(amounts[m.value] || 0) }));
    }

    setBusy(true);
    try { await onConfirm(payments); }
    catch (e) { setError(String(e)); setBusy(false); }
  };

  const canConfirm = mixte
    ? (totalSaisi >= total - 0.01)
    : (isCredit ? !!clientId : (!isCash || (Number(received) || 0) >= total - 0.01));

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 420 }}>
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Encaissement</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--cr-accent)', marginTop: 2 }}>
              {money(total)}
            </div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div className="modal-body">
          {!mixte ? (
            <>
              {/* Choix d'un mode unique */}
              <div className="cr-label">Mode de paiement</div>
              <div className="pay-grid">
                {paymentModes.map((mode) => {
                  const disabled = mode.value === 'Crédit client' && !clientId;
                  return (
                    <button key={mode.value}
                      className={`pay-mode${selected === mode.value ? ' on' : ''}`}
                      onClick={() => { setSelected(mode.value); setError(null); }}
                      disabled={disabled}
                      title={disabled ? 'Sélectionnez un client' : undefined}>
                      <ModeGlyph mode={mode} size={26} />
                      <span className="pay-mode-name">{mode.value}</span>
                    </button>
                  );
                })}
              </div>

              {/* Montant reçu (espèces) → rendu */}
              {isCash && (
                <div className="cr-field">
                  <label className="cr-label">Montant reçu (GNF)</label>
                  <input className="cr-input mono" type="number" min="0" step="500"
                    value={received} onChange={(e) => { setReceived(e.target.value); setError(null); }} />
                </div>
              )}

              {/* Résumé */}
              <div className="pay-summary">
                <div className="pay-summary-row">
                  <span>Total</span><span className="mono" style={{ fontWeight: 600 }}>{money(total)}</span>
                </div>
                {isCash && renduUnique > 0 && (
                  <div className="pay-summary-row" style={{ paddingTop: 6, borderTop: '1px solid var(--cr-border)' }}>
                    <span style={{ fontWeight: 600 }}>Rendu monnaie</span>
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--cr-accent)', fontSize: 16 }}>{money(renduUnique)}</span>
                  </div>
                )}
                {isCredit && (
                  <div className="pay-summary-row">
                    <span style={{ color: 'var(--cr-warn)' }}>Porté au crédit du client</span>
                    <span className="mono" style={{ color: 'var(--cr-warn)', fontWeight: 600 }}>{money(total)}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Paiement mixte : montant par mode */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {paymentModes.map((mode) => (
                  <div key={mode.value} className="cr-field">
                    <label className="cr-label" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <ModeGlyph mode={mode} size={20} />
                      {mode.value}
                      {mode.value === 'Crédit client' && !clientId && (
                        <span style={{ color: 'var(--cr-warn)', fontSize: 11 }}>(client requis)</span>
                      )}
                    </label>
                    <input className="cr-input mono" type="number" min="0" step="100" placeholder="0"
                      value={amounts[mode.value] || ''}
                      onChange={(e) => { setAmounts((p) => ({ ...p, [mode.value]: e.target.value })); setError(null); }}
                      disabled={mode.value === 'Crédit client' && !clientId} />
                  </div>
                ))}
              </div>
              <div className="pay-summary">
                <div className="pay-summary-row"><span>Total</span><span className="mono">{money(total)}</span></div>
                <div className="pay-summary-row">
                  <span>Saisi</span>
                  <span className="mono" style={{ color: totalSaisi >= total ? 'var(--cr-good)' : 'var(--cr-danger)' }}>{money(totalSaisi)}</span>
                </div>
                {renduMixte > 0 && (
                  <div className="pay-summary-row"><span style={{ fontWeight: 600 }}>Rendu</span><span className="mono" style={{ color: 'var(--cr-accent)', fontWeight: 700 }}>{money(renduMixte)}</span></div>
                )}
                {resteAPayer > 0.01 && (
                  <div className="pay-summary-row"><span style={{ color: 'var(--cr-danger)' }}>Reste</span><span className="mono" style={{ color: 'var(--cr-danger)' }}>{money(resteAPayer)}</span></div>
                )}
              </div>
            </>
          )}

          {/* Bascule mixte */}
          <button className="pay-mixte-toggle" onClick={() => { setMixte((v) => !v); setError(null); }}>
            <Icon name={mixte ? 'chevronLeft' : 'coin'} size={13} />
            {mixte ? 'Revenir au paiement simple' : 'Paiement mixte (plusieurs modes)'}
          </button>

          {error && <div className="cr-error">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary cr-btn-lg" onClick={handleConfirm}
            disabled={busy || !canConfirm} style={{ minWidth: 160, justifyContent: 'center' }}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} />
              : <><Icon name="check" size={15} /> Valider la vente</>}
          </button>
        </div>
      </div>
    </div>
  );
}
