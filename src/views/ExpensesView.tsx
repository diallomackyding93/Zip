import { useState, useEffect, useId } from 'react';
import { api } from '../lib/api';
import { money, moneyShort, num } from '../lib/format';
import { downloadCsv, csvDate } from '../lib/csv';
import { Icon } from '../components/icons/Icons';
import { HistoryFilter } from '../components/HistoryFilter';
import { InvoiceGallery } from '../components/InvoiceGallery';
import type {
  ExpenseRow, ExpenseMetrics, CategoryTotal, CreateExpenseInput,
  TreasuryAccountRow,
} from '../lib/types';

const STATUS_TONES: Record<string, string> = {
  Validée: 'good', Justifiée: 'info', 'En attente': 'warn',
};

const CATEGORIES = ['Loyer', 'Énergie', 'Télécom', 'Transport', 'Fournitures', 'Maintenance', 'Salaires', 'Autres'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

// ---------------------------------------------------------------------------
// Formulaire dépense (drawer)
// ---------------------------------------------------------------------------
function ExpenseForm({ accounts, onSave, onClose }: {
  accounts: TreasuryAccountRow[];
  onSave: (input: CreateExpenseInput, attachments: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const [label, setLabel] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [category, setCategory] = useState('Fournitures');
  const [amount, setAmount] = useState<number | ''>('');
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState('Validée');
  const [recurring, setRecurring] = useState(false);
  const [note, setNote] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!label.trim()) { setError('Le libellé est requis.'); return; }
    if (!amount || Number(amount) <= 0) { setError('Montant invalide.'); return; }
    setError(null); setBusy(true);
    try {
      const acc = accounts.find((a) => a.id === accountId);
      await onSave({
        label: label.trim(),
        beneficiary: beneficiary.trim() || undefined,
        category, amount: Number(amount),
        mode_label: acc ? acc.title : undefined,
        treasury_account_id: accountId || undefined,
        status, recurring, note: note.trim() || undefined,
        expense_date: expenseDate,
      }, attachments);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="form-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="form-drawer">
        <div className="form-drawer-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>Nouvelle dépense</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="form-drawer-body">
          <div className="cr-field">
            <label className="cr-label" htmlFor={`${uid}-l`}>Libellé *</label>
            <input id={`${uid}-l`} className="cr-input" value={label}
              onChange={(e) => setLabel(e.target.value)} placeholder="Ex : Loyer boutique — mai" autoFocus />
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Bénéficiaire</label>
              <input className="cr-input" value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)} placeholder="Ex : SOGEL Immobilier" />
            </div>
            <div className="cr-field">
              <label className="cr-label">Catégorie</label>
              <select className="cr-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Montant (GNF) *</label>
              <input className="cr-input mono" type="number" min="0" value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div className="cr-field">
              <label className="cr-label">Date</label>
              <input className="cr-input" type="date" value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Compte débité</label>
              <select className="cr-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— Aucun (suivi seul) —</option>
                {accounts.filter((a) => a.active).map((a) => (
                  <option key={a.id} value={a.id}>{a.title}</option>
                ))}
              </select>
            </div>
            <div className="cr-field">
              <label className="cr-label">Statut</label>
              <select className="cr-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                {['Validée', 'Justifiée', 'En attente'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {accountId && (
            <div className="cr-hint" style={{ color: 'var(--cr-warn)' }}>
              <Icon name="alerts" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Le solde du compte sélectionné sera diminué de ce montant.
            </div>
          )}
          <label className="module-toggle" onClick={() => setRecurring((v) => !v)}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>Dépense récurrente</div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Loyer, salaire, abonnement…</div>
            </div>
            <div className={`toggle-switch${recurring ? ' on' : ''}`} />
          </label>
          <div className="cr-field">
            <label className="cr-label">Note</label>
            <input className="cr-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optionnel" />
          </div>
          <div className="cr-field">
            <label className="cr-label">Justificatifs</label>
            <InvoiceGallery draft value={attachments} onChange={setAttachments} />
          </div>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="form-drawer-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Dépenses
// ---------------------------------------------------------------------------
export function ExpensesView() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [metrics, setMetrics] = useState<ExpenseMetrics | null>(null);
  const [categories, setCategories] = useState<CategoryTotal[]>([]);
  const [accounts, setAccounts] = useState<TreasuryAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Toutes');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<ExpenseRow | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Métriques + catégories + comptes : chargés une fois.
  useEffect(() => {
    Promise.all([api.expenses.getMetrics(), api.expenses.listCategories(), api.treasury.listAccounts()])
      .then(([m, c, a]) => { setMetrics(m); setCategories(c); setAccounts(a); }).catch(() => {});
  }, []);

  const fetchPage = async (reset: boolean, f = from, t = to) => {
    setLoading(true);
    try {
      const off = reset ? 0 : expenses.length;
      const r = await api.expenses.list({ from: f || null, to: t || null, offset: off, limit: 50 });
      setExpenses((prev) => reset ? r : [...prev, ...r]);
      setHasMore(r.length === 50);
    } finally { setLoading(false); }
  };
  const resetFilter = () => { setFrom(''); setTo(''); fetchPage(true, '', ''); };
  useEffect(() => { fetchPage(true); /* eslint-disable-next-line */ }, []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await api.expenses.list({ from: from || null, to: to || null, offset: 0, limit: 10000 });
      downloadCsv(
        `depenses-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Libellé', 'Bénéficiaire', 'Catégorie', 'Date', 'Compte', 'Statut', 'Montant'],
        all.map((e) => [e.label, e.beneficiary ?? '', e.category ?? '', csvDate(e.expense_date),
          e.treasury_account_title ?? '', e.status, Math.round(e.amount)]),
      );
    } finally { setExporting(false); }
  };

  const catTabs = ['Toutes', ...CATEGORIES];
  const filtered = expenses.filter((e) => {
    const matchCat = catFilter === 'Toutes' || e.category === catFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || e.label.toLowerCase().includes(q)
      || (e.beneficiary ?? '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const handleCreate = async (input: CreateExpenseInput, attachments: string[]) => {
    const exp = await api.expenses.create(input);
    // Persister les justificatifs (brouillon) une fois l'id connu
    for (const url of attachments) {
      await api.attachments.add('expense', exp.id, url).catch(() => {});
    }
    setExpenses((prev) => [exp, ...prev]);
    setShowForm(false);
    api.expenses.getMetrics().then(setMetrics).catch(() => {});
    api.expenses.listCategories().then(setCategories).catch(() => {});
  };

  const handleDelete = async (e: ExpenseRow) => {
    if (!confirm(`Supprimer la dépense « ${e.label} » ?`)) return;
    await api.expenses.delete(e.id);
    setExpenses((prev) => prev.filter((x) => x.id !== e.id));
    if (selected?.id === e.id) setSelected(null);
    api.expenses.getMetrics().then(setMetrics).catch(() => {});
  };

  if (loading && expenses.length === 0) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      {metrics && (
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>Total 30 jours</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{money(metrics.total_month)}</div>
          </div>
          <div className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>Dépenses</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{num(metrics.count)}</div>
          </div>
          <div className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>En attente</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: metrics.pending > 0 ? 'var(--cr-warn)' : 'var(--cr-ink-1)' }}>{num(metrics.pending)}</div>
          </div>
          <div className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>Récurrentes</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{num(metrics.recurring)}</div>
          </div>
        </div>
      )}

      {/* Recherche + action — sous les KPIs, à droite */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
        <div className="cr-input-wrap" style={{ width: 220 }}>
          <Icon name="search" size={14} className="cr-input-icon" />
          <input className="cr-input" style={{ height: 32, fontSize: 13 }} placeholder="Libellé, bénéficiaire…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="cr-btn cr-btn-primary" onClick={() => setShowForm(true)}>
          <Icon name="plus" size={14} /> Nouvelle dépense
        </button>
      </div>

      {/* Catégories à gauche · filtre dates/export à droite */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {catTabs.map((c) => (
            <button key={c} className="cr-btn cr-btn-ghost"
              style={{ height: 30, padding: '0 11px', fontSize: 12.5,
                background: catFilter === c ? 'var(--cr-accent-lt)' : undefined,
                color: catFilter === c ? 'var(--cr-accent)' : undefined }}
              onClick={() => setCatFilter(c)}>{c}</button>
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
              <Icon name="expenses" size={32} /><p>Aucune dépense.</p>
            </div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Libellé</th><th>Catégorie</th><th>Date</th><th>Compte</th>
                  <th>Statut</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className={`stock-row${selected?.id === e.id ? ' selected' : ''}`}
                    onClick={() => setSelected(selected?.id === e.id ? null : e)}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{e.label}</div>
                      {e.beneficiary && <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{e.beneficiary}</div>}
                    </td>
                    <td><span className="badge badge-neutral">{e.category ?? '—'}</span></td>
                    <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{formatDate(e.expense_date)}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{e.treasury_account_title ?? '—'}</td>
                    <td>
                      <span className={`badge badge-${STATUS_TONES[e.status] ?? 'neutral'}`}>{e.status}</span>
                      {e.recurring && <span className="badge badge-info" style={{ marginLeft: 4 }}>↻</span>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{money(e.amount)}</td>
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

        {/* Détail / catégories */}
        <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {selected ? (
            <div className="cr-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{selected.label}</div>
                <button className="topbar-btn" onClick={() => setSelected(null)}><Icon name="x" size={15} /></button>
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>{money(selected.amount)}</div>
              <table className="detail-table">
                <tbody>
                  <tr><td>Référence</td><td className="mono">{selected.expense_ref ?? '—'}</td></tr>
                  <tr><td>Bénéficiaire</td><td>{selected.beneficiary ?? '—'}</td></tr>
                  <tr><td>Catégorie</td><td>{selected.category ?? '—'}</td></tr>
                  <tr><td>Mode</td><td>{selected.mode_label ?? '—'}</td></tr>
                  <tr><td>Date</td><td>{formatDate(selected.expense_date)}</td></tr>
                  <tr><td>Statut</td><td>{selected.status}</td></tr>
                  <tr><td>Saisi par</td><td>{selected.created_by_name ?? '—'}</td></tr>
                  {selected.note && <tr><td>Note</td><td>{selected.note}</td></tr>}
                </tbody>
              </table>

              <div style={{ marginTop: 14 }}>
                <InvoiceGallery key={selected.id} ownerType="expense" ownerId={selected.id} />
              </div>

              <button className="cr-btn cr-btn-danger" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                onClick={() => handleDelete(selected)}>
                <Icon name="trash" size={14} /> Supprimer
              </button>
            </div>
          ) : (
            categories.length > 0 && (
              <div className="cr-card">
                <div className="cr-card-title" style={{ marginBottom: 12 }}>Par catégorie</div>
                {categories.map((c) => (
                  <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between',
                    padding: '7px 0', borderBottom: '1px solid var(--cr-border)', fontSize: 13 }}>
                    <span>{c.category}</span>
                    <span className="mono" style={{ fontWeight: 500 }}>{moneyShort(c.amount)} GNF</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {showForm && (
        <ExpenseForm accounts={accounts} onSave={handleCreate} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}
