import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { money, num } from '../lib/format';
import { downloadCsv, csvDate } from '../lib/csv';
import { Icon } from '../components/icons/Icons';
import { HistoryFilter } from '../components/HistoryFilter';
import { PhotoSlot } from '../components/PhotoSlot';
import type { CustomerCreditRow, CreditPaymentRow, AddCreditPaymentInput, PaymentModeRow, CreditMetrics } from '../lib/types';

const STATUS_TONES: Record<string, string> = {
  Ouvert: 'warn', Partiel: 'info', 'En retard': 'danger', Soldé: 'good',
};

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

// ---------------------------------------------------------------------------
// Modal remboursement crédit
// ---------------------------------------------------------------------------
function CreditPaymentModal({ credit, paymentModes, onSave, onClose }: {
  credit: CustomerCreditRow;
  paymentModes: PaymentModeRow[];
  onSave: (input: AddCreditPaymentInput) => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState<number | ''>(credit.remaining);
  const [mode, setMode] = useState(paymentModes[0]?.value ?? 'Comptant');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('Montant invalide.'); return; }
    if (amt > credit.remaining + 0.01) { setError(`Maximum ${money(credit.remaining)}.`); return; }
    setError(null); setBusy(true);
    try {
      const selectedMode = paymentModes.find((m) => m.value === mode);
      await onSave({ credit_id: credit.id, amount: amt, mode_label: mode,
        treasury_account_id: selectedMode?.treasury_account_id });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 380 }}>
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Enregistrer un remboursement</div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{credit.client_name}</div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px',
            background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)', fontSize: 13 }}>
            <span style={{ color: 'var(--cr-ink-2)' }}>Solde restant</span>
            <span className="mono" style={{ fontWeight: 700 }}>{money(credit.remaining)}</span>
          </div>
          <div className="cr-field">
            <label className="cr-label">Montant remboursé (GNF)</label>
            <input className="cr-input mono" type="number" min="0" max={credit.remaining}
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
// Volet détail crédit
// ---------------------------------------------------------------------------
function CreditDetail({ credit, paymentModes, onClose, onPayment }: {
  credit: CustomerCreditRow;
  paymentModes: PaymentModeRow[];
  onClose: () => void;
  onPayment: (input: AddCreditPaymentInput) => Promise<void>;
}) {
  const [payments, setPayments] = useState<CreditPaymentRow[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.clients.listCreditPayments(credit.id)
      .then(setPayments)
      .finally(() => setLoading(false));
  }, [credit.id]);

  const handlePayment = async (input: AddCreditPaymentInput) => {
    await onPayment(input);
    // Recharger les paiements
    const updated = await api.clients.listCreditPayments(credit.id);
    setPayments(updated);
    setShowModal(false);
  };

  const tone = STATUS_TONES[credit.status] ?? 'neutral';
  return (
    <div className="stock-detail" style={{ width: 300 }}>
      <div className="stock-detail-head">
        <PhotoSlot entityType="client" entityId={credit.client_id} name={credit.client_name} shape="circle" size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{credit.client_name}</div>
          {credit.sale_ref && <div className="mono" style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{credit.sale_ref}</div>}
        </div>
        <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div style={{ padding: '12px 16px' }}>
        <span className={`badge badge-${tone}`}>{credit.status}</span>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--cr-ink-2)' }}>Montant initial</span>
          <span className="mono">{money(credit.initial)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
          <span style={{ color: 'var(--cr-ink-2)' }}>Remboursé</span>
          <span className="mono" style={{ color: 'var(--cr-good)' }}>{money(credit.paid)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, marginTop: 6 }}>
          <span>Restant dû</span>
          <span className="mono" style={{ color: credit.remaining > 0 ? 'var(--cr-danger)' : 'var(--cr-good)' }}>
            {money(credit.remaining)}
          </span>
        </div>
        {credit.status !== 'Soldé' && (
          <button className="cr-btn cr-btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
            onClick={() => setShowModal(true)}>
            <Icon name="coin" size={14} /> Enregistrer un paiement
          </button>
        )}
      </div>
      <div className="stock-detail-body" style={{ padding: '8px 16px' }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
          Historique paiements
        </div>
        {loading ? <span className="spinner" /> : payments.length === 0 ? (
          <div style={{ color: 'var(--cr-ink-3)', fontSize: 13 }}>Aucun paiement enregistré.</div>
        ) : payments.map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
            <div>
              <div>{p.mode_label}</div>
              <div style={{ color: 'var(--cr-ink-3)', fontSize: 11 }}>{formatDate(p.paid_at)}{p.paid_by && ` · ${p.paid_by}`}</div>
            </div>
            <span className="mono" style={{ color: 'var(--cr-good)', fontWeight: 500 }}>+{money(p.amount)}</span>
          </div>
        ))}
      </div>
      {showModal && (
        <CreditPaymentModal credit={credit} paymentModes={paymentModes}
          onSave={handlePayment} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Crédits clients
// ---------------------------------------------------------------------------
export function CustomerCreditsView() {
  const [credits, setCredits] = useState<CustomerCreditRow[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentModeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Tous');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CustomerCreditRow | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [metrics, setMetrics] = useState<CreditMetrics | null>(null);

  const loadMetrics = () => api.clients.getCreditMetrics().then(setMetrics).catch(() => {});
  useEffect(() => { api.sales.listPaymentModes().then(setPaymentModes).catch(() => {}); loadMetrics(); }, []);

  const fetchPage = async (reset: boolean, f = from, t = to) => {
    setLoading(true);
    try {
      const off = reset ? 0 : credits.length;
      const r = await api.clients.listCredits({ from: f || null, to: t || null, offset: off, limit: 50 });
      setCredits((prev) => reset ? r : [...prev, ...r]);
      setHasMore(r.length === 50);
    } finally { setLoading(false); }
  };
  const resetFilter = () => { setFrom(''); setTo(''); fetchPage(true, '', ''); };
  useEffect(() => { fetchPage(true); /* eslint-disable-next-line */ }, []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await api.clients.listCredits({ from: from || null, to: to || null, offset: 0, limit: 10000 });
      downloadCsv(
        `credits-clients-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Client', 'Ticket', 'Date', 'Statut', 'Initial', 'Remboursé', 'Restant'],
        all.map((c) => [c.client_name, c.sale_ref ?? '', csvDate(c.created_at), c.status,
          Math.round(c.initial), Math.round(c.paid), Math.round(c.remaining)]),
      );
    } finally { setExporting(false); }
  };

  const filtered = credits.filter((c) => {
    const matchFilter = filter === 'Tous' || c.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || c.client_name.toLowerCase().includes(q) || (c.sale_ref ?? '').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  const handlePayment = async (input: AddCreditPaymentInput) => {
    await api.clients.addCreditPayment(input);
    setCredits((prev) => prev.map((c) => {
      if (c.id !== input.credit_id) return c;
      const newRemaining = Math.max(0, c.remaining - input.amount);
      return { ...c, paid: c.paid + input.amount, remaining: newRemaining,
        status: newRemaining <= 0.01 ? 'Soldé' : 'Partiel' };
    }));
    if (selected?.id === input.credit_id) {
      setSelected((s) => s ? { ...s, paid: s.paid + input.amount,
        remaining: Math.max(0, s.remaining - input.amount),
        status: Math.max(0, s.remaining - input.amount) <= 0.01 ? 'Soldé' : 'Partiel' } : s);
    }
    loadMetrics();
  };

  if (loading && credits.length === 0) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Total créances', value: money(metrics?.total_due ?? 0), tone: (metrics?.total_due ?? 0) > 0 ? 'warn' : undefined },
          { label: 'En retard', value: money(metrics?.overdue ?? 0), tone: (metrics?.overdue ?? 0) > 0 ? 'danger' : undefined },
          { label: 'Crédits ouverts', value: num(metrics?.open_count ?? 0) },
          { label: 'Soldés', value: num(metrics?.settled_count ?? 0) },
        ].map((k) => (
          <div key={k.label} className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600,
              color: k.tone === 'warn' ? 'var(--cr-warn)' : k.tone === 'danger' ? 'var(--cr-danger)' : 'var(--cr-ink-1)' }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Recherche — sous les KPIs, à droite */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div className="cr-input-wrap" style={{ width: 220 }}>
          <Icon name="search" size={14} className="cr-input-icon" />
          <input className="cr-input" style={{ height: 32, fontSize: 13 }} placeholder="Client, ticket…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Filtres d'état à gauche · filtre dates/export à droite */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['Tous', 'Ouvert', 'Partiel', 'En retard', 'Soldé'].map((f) => (
            <button key={f} className="cr-btn cr-btn-ghost"
              style={{ height: 30, padding: '0 12px', fontSize: 12.5,
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
        <div className="cr-card" style={{ flex: 1, padding: 0, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="screen-placeholder" style={{ height: 200 }}>
              <Icon name="credits" size={32} /><p>Aucun crédit.</p>
            </div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Client</th><th>Ticket</th><th>Date</th><th>Statut</th>
                  <th style={{ textAlign: 'right' }}>Initial</th>
                  <th style={{ textAlign: 'right' }}>Restant</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className={`stock-row${selected?.id === c.id ? ' selected' : ''}`}
                    onClick={() => setSelected(selected?.id === c.id ? null : c)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PhotoSlot entityType="client" entityId={c.client_id} name={c.client_name} shape="circle" size={28} />
                        <span style={{ fontWeight: 500 }}>{c.client_name}</span>
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{c.sale_ref ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{formatDate(c.created_at)}</td>
                    <td><span className={`badge badge-${STATUS_TONES[c.status] ?? 'neutral'}`}>{c.status}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(c.initial)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600,
                      color: c.remaining > 0 ? 'var(--cr-danger)' : 'var(--cr-good)' }}>
                      {money(c.remaining)}
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
        {selected && (
          <CreditDetail credit={selected} paymentModes={paymentModes}
            onClose={() => setSelected(null)} onPayment={handlePayment} />
        )}
      </div>
    </div>
  );
}
