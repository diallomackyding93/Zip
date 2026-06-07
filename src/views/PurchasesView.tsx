import { useState, useEffect, useId } from 'react';
import { api } from '../lib/api';
import { money, moneyShort, num } from '../lib/format';
import { downloadCsv, csvDate } from '../lib/csv';
import { Icon } from '../components/icons/Icons';
import { HistoryFilter } from '../components/HistoryFilter';
import { InvoiceGallery } from '../components/InvoiceGallery';
import type { PurchaseRow, PurchaseDetail, CreatePurchaseInput, PurchaseItemInput, SupplierRow, ProductRow, TreasuryAccountRow, PurchaseMetrics } from '../lib/types';

const STATE_TONES: Record<string, string> = {
  Reçu: 'good', 'À payer': 'danger', 'Réception partielle': 'warn', Commandé: 'info',
};

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

// ---------------------------------------------------------------------------
// Formulaire achat (drawer)
// ---------------------------------------------------------------------------
function PurchaseForm({ suppliers, products, accounts, onSave, onClose }: {
  suppliers: SupplierRow[];
  products: ProductRow[];
  accounts: TreasuryAccountRow[];
  onSave: (input: CreatePurchaseInput) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const [supplierName, setSupplierName] = useState('');
  const [mode, setMode] = useState('Comptant');
  const [accountId, setAccountId] = useState<string>(() => accounts[0]?.id ?? '');
  const [receiveNow, setReceiveNow] = useState(true);
  const [note, setNote] = useState('');
  const [idemKey] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState<(PurchaseItemInput & { _key: number })[]>([{ _key: 0, product_name: '', qty: 1, unit_cost: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(1);

  const total = items.reduce((s, it) => s + it.qty * it.unit_cost, 0);

  const addLine = () => { setItems((prev) => [...prev, { _key: nextKey, product_name: '', qty: 1, unit_cost: 0 }]); setNextKey((k) => k + 1); };
  const removeLine = (key: number) => setItems((prev) => prev.filter((it) => it._key !== key));
  const updateLine = (key: number, patch: Partial<PurchaseItemInput>) =>
    setItems((prev) => prev.map((it) => it._key === key ? { ...it, ...patch } : it));

  const selectProduct = (key: number, name: string) => {
    const p = products.find((x) => x.name === name);
    updateLine(key, { product_name: name, product_id: p?.id,
      unit_cost: p?.cost ?? 0, unit_name: p?.base_unit, variant: undefined });
  };

  const handleSave = async () => {
    if (!supplierName.trim()) { setError('Le fournisseur est requis.'); return; }
    if (items.some((it) => !it.product_name.trim())) { setError('Tous les articles doivent avoir un nom.'); return; }
    if (items.some((it) => it.qty <= 0 || it.unit_cost <= 0)) { setError('Quantité et coût doivent être > 0.'); return; }
    // Produit à stock distinct par déclinaison : exiger le choix de la déclinaison.
    const missingVariant = items.find((it) => {
      const prod = products.find((p) => p.id === it.product_id);
      return prod && prod.variants.some((v) => v.stock != null) && !it.variant;
    });
    if (missingVariant) {
      setError(`Choisissez la déclinaison pour « ${missingVariant.product_name} » (stock distinct par déclinaison).`);
      return;
    }
    setError(null); setBusy(true);
    try {
      const sup = suppliers.find((s) => s.name === supplierName);
      const isCredit = mode.includes('Crédit');
      await onSave({
        supplier_id: sup?.id, supplier_name: supplierName.trim(),
        mode_label: mode, receive_now: receiveNow, note: note || undefined,
        items: items.map(({ _key, ...it }) => it),
        treasury_account_id: isCredit ? undefined : (accountId || undefined),
        idempotency_key: idemKey,
      });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="form-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="form-drawer" style={{ width: 580 }}>
        <div className="form-drawer-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>Nouvel achat</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="form-drawer-body">
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label" htmlFor={`${uid}-sup`}>Fournisseur *</label>
              <input id={`${uid}-sup`} className="cr-input" list={`${uid}-sup-list`}
                value={supplierName} onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Choisir ou créer…" autoFocus />
              <datalist id={`${uid}-sup-list`}>{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </div>
            <div className="cr-field">
              <label className="cr-label">Mode de paiement</label>
              <select className="cr-input" value={mode} onChange={(e) => setMode(e.target.value)}>
                {['Comptant', 'Crédit fournisseur', 'Mobile Money', 'Virement'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {!mode.includes('Crédit') && (
            <div className="cr-field">
              <label className="cr-label">Compte débité</label>
              <select className="cr-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— Aucun (non suivi en trésorerie) —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
              <div className="cr-hint" style={{ marginTop: 4 }}>L'argent sort de ce compte si l'achat est réceptionné/payé.</div>
            </div>
          )}

          <label className="module-toggle" onClick={() => setReceiveNow((v) => !v)}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>Réception immédiate</div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Mise en stock dès l'enregistrement</div>
            </div>
            <div className={`toggle-switch${receiveNow ? ' on' : ''}`} />
          </label>

          <div className="form-section-title">Articles commandés</div>
          {items.map((it) => {
            const prod = products.find((p) => p.id === it.product_id);
            const dvars = prod?.variants.filter((v) => v.stock != null) ?? [];
            return (
            <div key={it._key} className="unit-row" style={{ alignItems: 'flex-end' }}>
              <div className="cr-field" style={{ flex: 3 }}>
                <input className="cr-input" list={`${uid}-prod-list`} placeholder="Produit"
                  value={it.product_name} onChange={(e) => selectProduct(it._key, e.target.value)} />
                <datalist id={`${uid}-prod-list`}>{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
                {dvars.length > 0 && (
                  <select className="cr-input" style={{ marginTop: 6, height: 32, fontSize: 12.5 }}
                    value={it.variant ?? ''} onChange={(e) => updateLine(it._key, { variant: e.target.value || undefined })}>
                    <option value="">— Choisir la déclinaison —</option>
                    {dvars.map((v) => <option key={v.value} value={v.value}>{v.value}</option>)}
                  </select>
                )}
              </div>
              <div className="cr-field" style={{ flex: 1 }}>
                <input className="cr-input mono" type="number" min="0.01" step="0.01" placeholder="Qté"
                  value={it.qty} onChange={(e) => updateLine(it._key, { qty: Number(e.target.value) })} />
              </div>
              <div className="cr-field" style={{ flex: 2 }}>
                <input className="cr-input mono" type="number" min="0" placeholder="Coût unit."
                  value={it.unit_cost} onChange={(e) => updateLine(it._key, { unit_cost: Number(e.target.value) })} />
              </div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600, minWidth: 90, textAlign: 'right', paddingBottom: 4 }}>
                {moneyShort(it.qty * it.unit_cost)} GNF
              </div>
              {items.length > 1 && (
                <button className="cr-btn cr-btn-ghost" style={{ height: 38, padding: '0 8px' }} onClick={() => removeLine(it._key)}>
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
            );
          })}
          <button className="cr-btn cr-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={addLine}>
            <Icon name="plus" size={13} /> Ajouter un article
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15,
            padding: '10px 14px', background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)' }}>
            <span>Total commande</span>
            <span className="mono">{money(total)}</span>
          </div>

          <div className="cr-field">
            <label className="cr-label">Note</label>
            <input className="cr-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optionnel" />
          </div>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="form-drawer-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} />
              : receiveNow ? 'Réceptionner et enregistrer' : 'Enregistrer la commande'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Volet détail achat
// ---------------------------------------------------------------------------
function PurchaseDetailPanel({ purchaseId, onReceived, onClose }: { purchaseId: string; onReceived: () => void; onClose: () => void }) {
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [receiving, setReceiving] = useState(false);

  useEffect(() => {
    api.purchases.getDetail(purchaseId).then(setDetail).finally(() => setLoading(false));
  }, [purchaseId]);

  const handleReceive = async () => {
    if (!confirm('Réceptionner cette commande ? Le stock sera mis à jour et le paiement enregistré.')) return;
    setReceiving(true);
    try {
      await api.purchases.receive({ purchase_id: purchaseId });
      onReceived();
    } catch (e) { alert(String(e)); } finally { setReceiving(false); }
  };

  if (loading) return <div className="stock-detail"><div style={{ padding: 20 }}><span className="spinner" /></div></div>;
  if (!detail) return null;
  const { purchase: p, items } = detail;

  return (
    <div className="stock-detail" style={{ width: 300 }}>
      <div className="stock-detail-head">
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>{p.purchase_ref}</div>
          <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{p.supplier_name}</div>
        </div>
        <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="stock-detail-body" style={{ padding: '12px 16px' }}>
        <span className={`badge badge-${STATE_TONES[p.state] ?? 'neutral'}`} style={{ marginBottom: 12, display: 'inline-block' }}>{p.state}</span>
        <table className="detail-table">
          <tbody>
            <tr><td>Commandé le</td><td>{formatDate(p.ordered_at)}</td></tr>
            {p.received_at && <tr><td>Reçu le</td><td>{formatDate(p.received_at)}</td></tr>}
            <tr><td>Mode</td><td>{p.mode_label ?? '—'}</td></tr>
            <tr><td>Montant total</td><td className="mono">{money(p.amount)}</td></tr>
            <tr><td>Payé</td><td className="mono" style={{ color: 'var(--cr-good)' }}>{money(p.paid)}</td></tr>
            {p.remaining > 0 && <tr><td>Restant</td><td className="mono" style={{ color: 'var(--cr-danger)' }}>{money(p.remaining)}</td></tr>}
          </tbody>
        </table>
        <div style={{ marginTop: 12, fontSize: 11.5, fontWeight: 600, color: 'var(--cr-ink-3)',
          textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Articles</div>
        {items.map((it) => (
          <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 500 }}>{it.product_name}</div>
              <div style={{ color: 'var(--cr-ink-3)', fontSize: 11 }}>{it.qty} {it.unit_name ?? ''} × {money(it.unit_cost)}</div>
            </div>
            <span className="mono">{money(it.line_total)}</span>
          </div>
        ))}

        {p.state === 'Commandé' && (
          <button className="cr-btn cr-btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
            onClick={handleReceive} disabled={receiving}>
            {receiving ? <span className="spinner" style={{ borderTopColor: '#fff' }} />
              : <><Icon name="check" size={14} /> Réceptionner</>}
          </button>
        )}

        <div style={{ marginTop: 14 }}>
          <InvoiceGallery key={p.id} ownerType="purchase" ownerId={p.id} label="Documents" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Achats
// ---------------------------------------------------------------------------
export function PurchasesView() {
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [accounts, setAccounts] = useState<TreasuryAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Tous');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [metrics, setMetrics] = useState<PurchaseMetrics | null>(null);
  const loadMetrics = () => api.purchases.getMetrics().then(setMetrics).catch(() => {});
  useEffect(() => {
    Promise.all([api.catalog.listSuppliers(), api.catalog.listProducts(),
      api.treasury.listAccounts().catch(() => [] as TreasuryAccountRow[])])
      .then(([s, pr, acc]) => { setSuppliers(s); setProducts(pr); setAccounts(acc); }).catch(() => {});
    loadMetrics();
  }, []);

  const fetchPage = async (reset: boolean, f = from, t = to) => {
    setLoading(true);
    try {
      const off = reset ? 0 : purchases.length;
      const r = await api.purchases.list({ from: f || null, to: t || null, offset: off, limit: 50 });
      setPurchases((prev) => reset ? r : [...prev, ...r]);
      setHasMore(r.length === 50);
    } finally { setLoading(false); }
  };
  const resetFilter = () => { setFrom(''); setTo(''); fetchPage(true, '', ''); };
  useEffect(() => { fetchPage(true); /* eslint-disable-next-line */ }, []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await api.purchases.list({ from: from || null, to: to || null, offset: 0, limit: 10000 });
      downloadCsv(
        `achats-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Référence', 'Fournisseur', 'Date', 'Statut', 'Mode', 'Montant', 'Payé', 'Restant'],
        all.map((p) => [p.purchase_ref, p.supplier_name, csvDate(p.ordered_at), p.state,
          p.mode_label ?? '', Math.round(p.amount), Math.round(p.paid), Math.round(p.remaining)]),
      );
    } finally { setExporting(false); }
  };

  const filtered = purchases.filter((p) => {
    const matchFilter = filter === 'Tous' || p.state === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || p.purchase_ref.toLowerCase().includes(q) || p.supplier_name.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  const handleCreate = async (input: CreatePurchaseInput) => {
    const p = await api.purchases.create(input);
    setPurchases((prev) => [p, ...prev]);
    setShowForm(false);
    loadMetrics();
  };

  if (loading && purchases.length === 0) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Total commandes', value: money(metrics?.total_amount ?? 0) },
          { label: 'Commandes', value: num(metrics?.count ?? 0) },
          { label: 'Dettes ouvertes', value: money(metrics?.total_due ?? 0), tone: (metrics?.total_due ?? 0) > 0 ? 'danger' : undefined },
          { label: 'Fournisseurs actifs', value: num(suppliers.length) },
        ].map((k) => (
          <div key={k.label} className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600,
              color: k.tone === 'danger' ? 'var(--cr-danger)' : 'var(--cr-ink-1)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Recherche + action — sous les KPIs, à droite */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
        <div className="cr-input-wrap" style={{ width: 220 }}>
          <Icon name="search" size={14} className="cr-input-icon" />
          <input className="cr-input" style={{ height: 32, fontSize: 13 }} placeholder="Réf, fournisseur…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="cr-btn cr-btn-primary" onClick={() => setShowForm(true)}>
          <Icon name="plus" size={14} /> Nouvel achat
        </button>
      </div>

      {/* Filtres d'état à gauche · filtre dates/export à droite */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['Tous', 'Commandé', 'Réception partielle', 'Reçu', 'À payer'].map((f) => (
            <button key={f} className="cr-btn cr-btn-ghost"
              style={{ height: 30, padding: '0 10px', fontSize: 12,
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
              <Icon name="purchases" size={32} /><p>Aucune commande.</p>
            </div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Référence</th><th>Fournisseur</th><th>Date</th><th>Statut</th>
                  <th>Mode</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                  <th style={{ textAlign: 'right' }}>Restant</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className={`stock-row${selected === p.id ? ' selected' : ''}`}
                    onClick={() => setSelected(selected === p.id ? null : p.id)}>
                    <td className="mono" style={{ fontWeight: 600 }}>{p.purchase_ref}</td>
                    <td style={{ fontWeight: 500 }}>{p.supplier_name}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{formatDate(p.ordered_at)}</td>
                    <td><span className={`badge badge-${STATE_TONES[p.state] ?? 'neutral'}`}>{p.state}</span></td>
                    <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{p.mode_label ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(p.amount)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600,
                      color: p.remaining > 0 ? 'var(--cr-danger)' : 'var(--cr-good)' }}>
                      {p.remaining > 0 ? money(p.remaining) : '✓'}
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
          <PurchaseDetailPanel
            purchaseId={selected}
            onReceived={() => { setSelected(null); fetchPage(true); loadMetrics(); }}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {showForm && (
        <PurchaseForm suppliers={suppliers} products={products} accounts={accounts}
          onSave={handleCreate} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}
