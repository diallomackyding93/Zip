import { useState } from 'react';
import { Icon } from '../icons/Icons';
import { money, num } from '../../lib/format';
import type { TreasuryAccountRow } from '../../lib/types';

// Coupures GNF réelles (du plus grand au plus petit)
const COUPURES = [50000, 20000, 10000, 5000, 2000, 1000, 500];

interface ClotureModalProps {
  sessionRef: string;
  cashExpected: number;
  initialFund: number;
  accounts: TreasuryAccountRow[];
  /** L'utilisateur peut-il déposer directement en trésorerie ? (droit Transferts trésorerie) */
  canDeposit: boolean;
  onConfirm: (counted: number, accountId?: string) => Promise<void>;
  onClose: () => void;
}

export function ClotureModal({ sessionRef, cashExpected, initialFund, accounts, canDeposit, onConfirm, onClose }: ClotureModalProps) {
  // 'direct' = saisir le montant total · 'denoms' = compter par coupures
  const [mode, setMode] = useState<'direct' | 'denoms'>('direct');
  const [direct, setDirect] = useState('');
  const [counts, setCounts] = useState<Record<number, string>>({});
  // Aucun compte choisi par défaut : l'utilisateur autorisé doit le sélectionner.
  const [accountId, setAccountId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countedDenoms = COUPURES.reduce((sum, c) => sum + c * (Number(counts[c]) || 0), 0);
  const counted = mode === 'direct' ? (Number(direct) || 0) : countedDenoms;
  const gap = counted - cashExpected;

  // L'utilisateur doit avoir saisi quelque chose (évite le clic réflexe),
  // mais un tiroir réellement vide (compté = 0) reste clôturable.
  const touched = mode === 'direct'
    ? direct.trim() !== ''
    : COUPURES.some((c) => (counts[c] ?? '') !== '');

  const deposit = counted; // tout le compté part au compte (fond initial inclus)

  const handleConfirm = async () => {
    // Tout écart, même minime, déclenche une confirmation explicite.
    if (gap !== 0) {
      const nature = gap > 0 ? 'excédent' : 'manquant';
      const ok = window.confirm(
        `Écart de caisse : ${gap >= 0 ? '+' : ''}${money(gap)} (${nature}).\n`
        + `Attendu ${money(cashExpected)} · compté ${money(counted)}.\n\n`
        + `Confirmer la clôture malgré l'écart ?`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await onConfirm(counted, accountId || undefined);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 440 }}>
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Clôture de caisse</div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{sessionRef}</div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div className="modal-body">
          {/* Sélecteur de mode de comptage */}
          <div className="cloture-modes">
            <button type="button" className={mode === 'direct' ? 'on' : ''} onClick={() => setMode('direct')}>
              Saisir le montant total
            </button>
            <button type="button" className={mode === 'denoms' ? 'on' : ''} onClick={() => setMode('denoms')}>
              Compter par coupures
            </button>
          </div>

          {mode === 'direct' ? (
            <div className="cr-field">
              <label className="cr-label">Montant total compté en caisse (GNF)</label>
              <input
                className="cr-input mono"
                type="number" min="0" step="1"
                style={{ fontSize: 18, fontWeight: 600, height: 46 }}
                value={direct}
                placeholder="0"
                autoFocus
                onChange={(e) => { setDirect(e.target.value); setError(null); }}
              />
              <div className="cr-hint" style={{ marginTop: 4 }}>
                Saisissez directement le total des espèces, sans détailler les coupures.
              </div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 11, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Coupure</th>
                  <th style={{ textAlign: 'center', padding: '6px 0', fontSize: 11, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Nombre</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 11, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Sous-total</th>
                </tr>
              </thead>
              <tbody>
                {COUPURES.map((c) => {
                  const n = Number(counts[c]) || 0;
                  return (
                    <tr key={c} style={{ borderBottom: '1px solid var(--cr-border)' }}>
                      <td style={{ padding: '8px 0' }}>
                        <span className="mono" style={{ fontWeight: 500 }}>{num(c)} GNF</span>
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                        <input
                          className="cr-input mono"
                          type="number" min="0" step="1"
                          style={{ width: 70, height: 32, textAlign: 'center', fontSize: 13 }}
                          value={counts[c] ?? ''}
                          placeholder="0"
                          onChange={(e) => { setCounts((prev) => ({ ...prev, [c]: e.target.value })); setError(null); }}
                        />
                      </td>
                      <td style={{ padding: '8px 0', textAlign: 'right' }}>
                        <span className="mono" style={{ color: n > 0 ? 'var(--cr-ink-1)' : 'var(--cr-ink-3)' }}>
                          {n > 0 ? money(c * n) : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Résumé */}
          <div style={{
            background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)',
            padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--cr-ink-2)' }}>Espèces attendues</span>
              <span className="mono" style={{ fontWeight: 600 }}>{money(cashExpected)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
              <span>Total compté</span>
              <span className="mono">{money(counted)}</span>
            </div>
            {counted > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 13,
                paddingTop: 8, borderTop: '1px solid var(--cr-border)',
              }}>
                <span style={{ color: gap >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)' }}>Écart</span>
                <span className="mono" style={{ fontWeight: 600, color: gap >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)' }}>
                  {gap >= 0 ? '+' : ''}{money(gap)}
                </span>
              </div>
            )}
          </div>

          {/* Où déposer la recette (selon les droits de l'utilisateur) */}
          {canDeposit ? (
            <div className="cr-field" style={{ marginTop: 14 }}>
              <label className="cr-label">Déposer la recette dans *</label>
              <select className="cr-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— Choisir un compte —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
              <div className="cr-hint" style={{ marginTop: 4 }}>
                {accountId
                  ? `${money(deposit)} iront dans ce compte (tout le contenu compté, fond initial de ${money(initialFund)} inclus).`
                  : 'Choisissez le compte de destination pour pouvoir clôturer.'}
              </div>
            </div>
          ) : (
            <div className="se-info-box" style={{ background: 'var(--cr-info-lt)', color: 'var(--cr-info)',
              padding: '10px 12px', borderRadius: 'var(--cr-r)', fontSize: 12.5, marginTop: 14 }}>
              <Icon name="shield" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              Votre clôture sera <strong>soumise à confirmation</strong> d'un responsable avant que la recette n'entre en trésorerie.
            </div>
          )}

          {error && <div className="cr-error">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleConfirm}
            disabled={busy || !touched || (canDeposit && !accountId)}>
            {busy
              ? <span className="spinner" style={{ borderTopColor: '#fff' }} />
              : <><Icon name="lock" size={14} /> Clôturer la caisse</>}
          </button>
        </div>
      </div>
    </div>
  );
}
