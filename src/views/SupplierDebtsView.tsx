import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { money, num } from '../lib/format';
import { downloadCsv, csvDate } from '../lib/csv';
import { Icon } from '../components/icons/Icons';
import { HistoryFilter } from '../components/HistoryFilter';
import { InvoiceGallery } from '../components/InvoiceGallery';
import type { SupplierDebtRow, AddDebtPaymentInput, PaymentModeRow, DebtMetrics } from '../lib/types';

const STATUS_TONES: Record<string, string> = {
  Ouverte: 'warn', Partiel: 'info', 'En retard': 'danger', Soldée: 'good',
};

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

// ---------------------------------------------------------------------------
// Modal paiement dette
// ---------------------------------------------------------------------------
function DebtPaymentModal({ debt, paymentModes, onSave, onClose }: {
  debt: SupplierDebtRow;
  paymentModes: PaymentModeRow[];
  onSave: (input: AddDebtPaymentInput) => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState<number | ''>(debt.remaining);
  const [mode, setMode] = useState(paymentModes.find((m) => m.value !== 'Crédit client')?.value ?? 'Comptant');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('Montant invalide.'); return; }
    if (amt > debt.remaining + 0.01) { setError(`Maximum : ${money(debt.remaining)}.`); return; }
    setError(null); setBusy(true);
    try {
      const selectedMode = paymentModes.find((m) => m.value === mode);
      await onSave({ debt_id: debt.id, amount: amt, mode_label: mode,
        treasury_account_id: selectedMode?.treasury_account_id });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 380 }}>
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Paiement fournisseur</div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{debt.supplier_name}</div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px',
            background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)', fontSize: 13 }}>
            <span style={{ color: 'var(--cr-ink-2)' }}>Restant dû</span>
            <span className="mono" style={{ fontWeight: 700, color: 'var(--cr-danger)' }}>{money(debt.remaining)}</span>
          </div>
          <div className="cr-field">
            <label className="cr-label">Montant payé (GNF)</label>
            <input className="cr-input mono" type="number" min="0" max={debt.remaining}
              value={amount} onChange={(e) => { setAmount(e.target.value === '' ? '' : Number(e.target.value)); setError(null); }}
              autoFocus />
          </div>
          <div className="cr-field">
            <label className="cr-label">Mode de paiement</label>
            <select className="cr-input" value={mode} onChange={(e) => setMode(e.target.value)}>
              {paymentModes.filter((m) => m.value !== 'Crédit client').map((m) => (
                <option key={m.value} value={m.value}>{m.value}</option>
              ))}
            </select>
          </div>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy || !amount}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Valider le paiement'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Volet détail dette (résumé + documents/justificatifs)
// ---------------------------------------------------------------------------
function DebtDetailPanel({ debt, onClose, onPay }: {
  debt: SupplierDebtRow;
  onClose: () => void;
  onPay: () => void;
}) {
  return (
    <div className="stock-detail" style={{ width: 300 }}>
      <div className="stock-detail-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{debt.supplier_name}</div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{debt.invoice_ref ?? debt.purchase_ref ?? '—'}</div>
        </div>
        <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="stock-detail-body" style={{ padding: '12px 16px' }}>
        <span className={`badge badge-${STATUS_TONES[debt.status] ?? 'neutral'}`} style={{ marginBottom: 12, display: 'inline-block' }}>{debt.status}</span>
        <table className="detail-table">
          <tbody>
            {debt.invoice_date && <tr><td>Date facture</td><td>{formatDate(debt.invoice_date)}</td></tr>}
            {debt.due_date && <tr><td>Échéance</td><td style={{ color: debt.status === 'En retard' ? 'var(--cr-danger)' : 'inherit' }}>{formatDate(debt.due_date)}</td></tr>}
            <tr><td>Montant initial</td><td className="mono">{money(debt.initial)}</td></tr>
            <tr><td>Payé</td><td className="mono" style={{ color: 'var(--cr-good)' }}>{money(debt.paid)}</td></tr>
            {debt.remaining > 0 && <tr><td>Restant</td><td className="mono" style={{ color: 'var(--cr-danger)' }}>{money(debt.remaining)}</td></tr>}
          </tbody>
        </table>

        {debt.status !== 'Soldée' && (
          <button className="cr-btn cr-btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={onPay}>
            Payer
          </button>
        )}

        <div style={{ marginTop: 14 }}>
          <InvoiceGallery key={debt.id} ownerType="supplier_debt" ownerId={debt.id} label="Documents" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Dettes fournisseurs
// ---------------------------------------------------------------------------
export function SupplierDebtsView() {
  const [debts, setDebts] = useState<SupplierDebtRow[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentModeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Tous');
  const [search, setSearch] = useState('');
  const [payingDebt, setPayingDebt] = useState<SupplierDebtRow | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [metrics, setMetrics] = useState<DebtMetrics | null>(null);

  const loadMetrics = () => api.purchases.getDebtMetrics().then(setMetrics).catch(() => {});
  useEffect(() => { api.sales.listPaymentModes().then(setPaymentModes).catch(() => {}); loadMetrics(); }, []);

  const fetchPage = async (reset: boolean, f = from, t = to) => {
    setLoading(true);
    try {
      const off = reset ? 0 : debts.length;
      const r = await api.purchases.listDebts({ from: f || null, to: t || null, offset: off, limit: 50 });
      setDebts((prev) => reset ? r : [...prev, ...r]);
      setHasMore(r.length === 50);
    } finally { setLoading(false); }
  };
  const resetFilter = () => { setFrom(''); setTo(''); fetchPage(true, '', ''); };
  useEffect(() => { fetchPage(true); /* eslint-disable-next-line */ }, []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await api.purchases.listDebts({ from: from || null, to: to || null, offset: 0, limit: 10000 });
      downloadCsv(
        `dettes-fournisseurs-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Fournisseur', 'Commande', 'Facture', 'Date', 'Statut', 'Initial', 'Payé', 'Restant'],
        all.map((d) => [d.supplier_name, d.purchase_ref ?? '', d.invoice_ref ?? '', csvDate(d.created_at),
          d.status, Math.round(d.initial), Math.round(d.paid), Math.round(d.remaining)]),
      );
    } finally { setExporting(false); }
  };

  const filtered = debts.filter((d) => {
    const matchFilter = filter === 'Tous' || d.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || d.supplier_name.toLowerCase().includes(q) || (d.purchase_ref ?? '').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  const handlePayment = async (input: AddDebtPaymentInput) => {
    await api.purchases.addDebtPayment(input);
    setDebts((prev) => prev.map((d) => {
      if (d.id !== input.debt_id) return d;
      const newRemaining = Math.max(0, d.remaining - input.amount);
      return { ...d, paid: d.paid + input.amount, remaining: newRemaining,
        status: newRemaining <= 0.01 ? 'Soldée' : 'Partiel' };
    }));
    setPayingDebt(null);
    loadMetrics();
  };

  if (loading && debts.length === 0) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Total dettes', value: money(metrics?.total_due ?? 0), tone: (metrics?.total_due ?? 0) > 0 ? 'danger' : undefined },
          { label: 'En retard', value: money(metrics?.overdue ?? 0), tone: (metrics?.overdue ?? 0) > 0 ? 'danger' : undefined },
          { label: 'Factures ouvertes', value: num(metrics?.open_count ?? 0) },
          { label: 'Soldées', value: num(metrics?.settled_count ?? 0) },
        ].map((k) => (
          <div key={k.label} className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600,
              color: k.tone === 'danger' ? 'var(--cr-danger)' : 'var(--cr-ink-1)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Recherche — sous les KPIs, à droite */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div className="cr-input-wrap" style={{ width: 220 }}>
          <Icon name="search" size={14} className="cr-input-icon" />
          <input className="cr-input" style={{ height: 32, fontSize: 13 }} placeholder="Fournisseur, réf…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Filtres d'état à gauche · filtre dates/export à droite */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['Tous', 'Ouverte', 'Partiel', 'En retard', 'Soldée'].map((f) => (
            <button key={f} className="cr-btn cr-btn-ghost"
              style={{ height: 30, padding: '0 10px', fontSize: 12.5,
                background: filter === f ? 'var(--cr-accent-lt)' : undefined,
                color: filter === f ? 'var(--cr-accent)' : undefined }}
              onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <HistoryFilter
            from={from} to={to} setFrom={setFrom} setTo={setTo}
            onApply={() => fetchPage(true)} onReset={resetFilter}
            onExport={exportCsv} loading={loading} exporting={exporting}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
      <div className="cr-card" style={{ padding: 0, overflow: 'auto', flex: 1, minWidth: 0 }}>
        {filtered.length === 0 ? (
          <div className="screen-placeholder" style={{ height: 200 }}>
            <Icon name="debts" size={32} /><p>Aucune dette fournisseur.</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th>Fournisseur</th><th>Commande</th><th>Facture</th><th>Échéance</th>
                <th>Statut</th>
                <th style={{ textAlign: 'right' }}>Initial</th>
                <th style={{ textAlign: 'right' }}>Restant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className={`stock-row${selected === d.id ? ' selected' : ''}`}
                  onClick={() => setSelected(selected === d.id ? null : d.id)}>
                  <td style={{ fontWeight: 500 }}>{d.supplier_name}</td>
                  <td className="mono" style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{d.purchase_ref ?? '—'}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{d.invoice_ref ?? '—'}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {d.due_date ? (
                      <span style={{ color: d.status === 'En retard' ? 'var(--cr-danger)' : 'inherit' }}>
                        {formatDate(d.due_date)}
                      </span>
                    ) : '—'}
                  </td>
                  <td><span className={`badge badge-${STATUS_TONES[d.status] ?? 'neutral'}`}>{d.status}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(d.initial)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 600,
                    color: d.remaining > 0 ? 'var(--cr-danger)' : 'var(--cr-good)' }}>
                    {d.remaining > 0 ? money(d.remaining) : '✓'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {d.status !== 'Soldée' && (
                      <button className="cr-btn cr-btn-secondary"
                        style={{ height: 28, fontSize: 12, padding: '0 10px' }}
                        onClick={() => setPayingDebt(d)}>
                        Payer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hasMore && (
          <button className="cr-btn cr-btn-ghost" style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
            onClick={() => fetchPage(false)} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Charger plus'}
          </button>
        )}
      </div>

        {selected && (() => {
          const d = debts.find((x) => x.id === selected);
          return d ? (
            <DebtDetailPanel debt={d} onClose={() => setSelected(null)} onPay={() => setPayingDebt(d)} />
          ) : null;
        })()}
      </div>

      {payingDebt && (
        <DebtPaymentModal debt={payingDebt} paymentModes={paymentModes}
          onSave={handlePayment} onClose={() => setPayingDebt(null)} />
      )}
    </div>
  );
}
