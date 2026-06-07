import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { money, num } from '../lib/format';
import { downloadCsv, csvDate } from '../lib/csv';
import { Icon } from '../components/icons/Icons';
import { HistoryFilter } from '../components/HistoryFilter';
import { PhotoSlot } from '../components/PhotoSlot';
import { Receipt, receiptHtml, type ReceiptData } from '../components/pos/Receipt';
import type { SaleRow, SaleDetail, PaymentModeRow, SalesMetrics } from '../lib/types';

interface TicketCfg { header?: string; footer?: string; showSeller: boolean; showClient: boolean }

const STATE_TONES: Record<string, string> = {
  'Payée': 'good',
  'Crédit': 'warn',
  'Paiement partiel': 'warn',
  'Retour partiel': 'info',
  'Annulée': 'danger',
};

const FILTERS = ['Tous', 'Payée', 'Crédit', 'Paiement partiel', 'Retour partiel', 'Annulée'];

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

// ---------------------------------------------------------------------------
// Modale de retour / remboursement
// ---------------------------------------------------------------------------
function ReturnModal({ detail, onClose, onDone }: {
  detail: SaleDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { sale, items } = detail;
  const ratio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [modes, setModes] = useState<PaymentModeRow[]>([]);
  const [refundMode, setRefundMode] = useState('Comptant');
  const [cashSessionId, setCashSessionId] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sales.listPaymentModes().then((m) => {
      const usable = m.filter((x) => x.value !== 'Crédit client');
      setModes(usable);
      // Pré-sélectionner le 1er mode de paiement réellement utilisé sur la vente
      const used = usable.find((x) => sale.payment_labels.includes(x.value));
      setRefundMode(used?.value ?? 'Comptant');
    }).catch(() => {});
    api.cash.getOpenSession().then((s) => setCashSessionId(s?.id)).catch(() => {});
  }, [sale.payment_labels]);

  const setQty = (id: string, max: number, raw: number) => {
    const q = Math.max(0, Math.min(max, Math.round(raw * 1000) / 1000));
    setQtys((prev) => ({ ...prev, [id]: q }));
  };

  const refundTotal = items.reduce((s, it) => s + (qtys[it.id] ?? 0) * it.unit_price * ratio, 0);
  const anyQty = items.some((it) => (qtys[it.id] ?? 0) > 0);

  const handleSave = async () => {
    if (!anyQty) { setError('Indiquez au moins une quantité à retourner.'); return; }
    setError(null); setBusy(true);
    try {
      const account = modes.find((m) => m.value === refundMode)?.treasury_account_id;
      await api.sales.createReturn({
        sale_id: sale.id,
        items: items.filter((it) => (qtys[it.id] ?? 0) > 0).map((it) => ({ sale_item_id: it.id, qty: qtys[it.id] })),
        reason: reason || undefined,
        refund_mode: refundMode,
        refund_account_id: account,
        cash_session_id: account ? undefined : cashSessionId,
      });
      onDone();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 440 }}>
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Retour d'articles</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{sale.ref}</div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          {items.map((it) => {
            const q = qtys[it.id] ?? 0;
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{it.product_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>
                    {it.qty} {it.unit_name} vendus × {money(it.unit_price)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button className="cr-btn cr-btn-ghost" style={{ width: 26, height: 26, padding: 0, justifyContent: 'center' }}
                    onClick={() => setQty(it.id, it.qty, q - 1)} disabled={q <= 0}>−</button>
                  <input className="cr-input mono" type="number" min="0" max={it.qty} value={q}
                    onChange={(e) => setQty(it.id, it.qty, Number(e.target.value))}
                    style={{ width: 58, height: 28, textAlign: 'center', fontSize: 13 }} />
                  <button className="cr-btn cr-btn-ghost" style={{ width: 26, height: 26, padding: 0, justifyContent: 'center' }}
                    onClick={() => setQty(it.id, it.qty, q + 1)} disabled={q >= it.qty}>+</button>
                </div>
              </div>
            );
          })}

          <div className="cr-field" style={{ marginTop: 6 }}>
            <label className="cr-label">Remboursement via</label>
            <select className="cr-input" value={refundMode} onChange={(e) => setRefundMode(e.target.value)}>
              {modes.map((m) => <option key={m.value} value={m.value}>{m.value}</option>)}
            </select>
          </div>
          <div className="cr-field">
            <label className="cr-label">Motif (optionnel)</label>
            <input className="cr-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Article défectueux, erreur…" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15,
            padding: '10px 14px', background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)' }}>
            <span>Montant remboursé</span>
            <span className="mono">{money(Math.round(refundTotal))}</span>
          </div>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy || !anyQty}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Valider le retour'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Volet de détail d'une vente
// ---------------------------------------------------------------------------
function SaleDetailPanel({ saleId, commerce, ticketCfg, onClose, onCancel, onReturned }: {
  saleId: string;
  commerce: { name: string; city?: string };
  ticketCfg: TicketCfg;
  onClose: () => void;
  onCancel: (id: string) => void;
  onReturned: (id: string) => void;
}) {
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showReturn, setShowReturn] = useState(false);

  const reload = () => api.sales.getSaleDetail(saleId).then(setDetail).catch(() => {});

  useEffect(() => {
    api.sales.getSaleDetail(saleId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [saleId]);

  const handleCancel = async () => {
    if (!detail) return;
    setCancelling(true);
    try {
      await api.sales.cancelSale({ sale_id: saleId, reason: cancelReason || undefined });
      onCancel(saleId);
    } finally {
      setCancelling(false);
      setShowCancel(false);
    }
  };

  if (loading) return (
    <div className="stock-detail" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
      <span className="spinner" />
    </div>
  );
  if (!detail) return null;

  const { sale, items, payments } = detail;
  const tone = STATE_TONES[sale.state] ?? 'neutral';

  const receiptData: ReceiptData = {
    ref: sale.ref,
    date: (() => { try { return new Date(sale.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return sale.created_at; } })(),
    commerceName: commerce.name, commerceCity: commerce.city,
    seller: sale.seller_name, client: sale.client_name,
    items: items.map((it) => ({
      name: it.product_name, variant: it.variant, unit: it.unit_name ?? '',
      qty: it.qty, unitPrice: it.unit_price, total: it.line_total,
    })),
    subtotal: sale.subtotal, discount: sale.discount, total: sale.total,
    payments: payments.map((p) => ({ label: p.mode_label, amount: p.amount })),
    header: ticketCfg.header, footer: ticketCfg.footer,
    showSeller: ticketCfg.showSeller, showClient: ticketCfg.showClient,
  };

  return (
    <div className="stock-detail" style={{ width: 300 }}>
      <div className="stock-detail-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }} className="mono">{sale.ref}</div>
          <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{formatDate(sale.created_at)}</div>
        </div>
        <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      <div style={{ padding: '10px 16px 6px' }}>
        <span className={`badge badge-${tone}`}>{sale.state}</span>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>
            Vendeur : <strong>{sale.seller_name}</strong>
          </div>
          {sale.client_name && (
            <div style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>
              Client : <strong>{sale.client_name}</strong>
            </div>
          )}
        </div>
      </div>

      <div className="stock-detail-body" style={{ padding: '0 16px 12px' }}>
        {/* Lignes */}
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
          Articles
        </div>
        {items.map((it) => (
          <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <PhotoSlot entityType="product" entityId={it.product_id ?? '__none__'} fallbackIcon="box" size={28} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{it.product_name}</div>
                <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>
                  {it.qty} {it.unit_name} × {money(it.unit_price)}
                  {it.orig_price && it.orig_price !== it.unit_price && (
                    <span style={{ marginLeft: 4, textDecoration: 'line-through', color: 'var(--cr-ink-3)' }}>
                      {money(it.orig_price)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="mono" style={{ fontWeight: 500 }}>{money(it.line_total)}</div>
          </div>
        ))}

        <div style={{ borderTop: '1px solid var(--cr-border)', marginTop: 8, paddingTop: 8 }}>
          {sale.discount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--cr-good)', marginBottom: 4 }}>
              <span>Remise</span><span className="mono">- {money(sale.discount)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
            <span>Total</span><span className="mono">{money(sale.total)}</span>
          </div>
          {sale.returned_total > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--cr-warn)', marginTop: 4 }}>
                <span>Remboursé (retour)</span><span className="mono">- {money(sale.returned_total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 13 }}>
                <span>Net</span><span className="mono">{money(sale.total - sale.returned_total)}</span>
              </div>
            </>
          )}
        </div>

        {/* Paiements */}
        <div style={{ marginTop: 12, fontSize: 11.5, fontWeight: 600, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
          Paiements
        </div>
        {payments.map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ color: 'var(--cr-ink-2)' }}>{p.mode_label}</span>
            <span className="mono">{money(p.amount)}</span>
          </div>
        ))}
        {sale.remaining > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--cr-danger)' }}>
            <span>Reste dû</span>
            <span className="mono">{money(sale.remaining)}</span>
          </div>
        )}

        {/* Retour d'articles */}
        {sale.state !== 'Annulée' && (
          <button
            className="cr-btn cr-btn-secondary"
            style={{ width: '100%', justifyContent: 'center', fontSize: 12, marginTop: 16 }}
            onClick={() => setShowReturn(true)}
          >
            <Icon name="purchases" size={13} /> Retour / remboursement
          </button>
        )}

        {/* Annulation */}
        {sale.state !== 'Annulée' && (
          <div style={{ marginTop: 10 }}>
            {showCancel ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  className="cr-input"
                  placeholder="Motif (optionnel)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  style={{ fontSize: 12.5 }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="cr-btn cr-btn-secondary" style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}
                    onClick={() => setShowCancel(false)} disabled={cancelling}>
                    Annuler
                  </button>
                  <button className="cr-btn cr-btn-danger" style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}
                    onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? <span className="spinner" /> : 'Confirmer'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="cr-btn"
                style={{ width: '100%', justifyContent: 'center', fontSize: 12,
                  color: 'var(--cr-danger)', background: 'var(--cr-danger-lt)',
                  border: '1px solid var(--cr-danger)', fontWeight: 600 }}
                onClick={() => setShowCancel(true)}
              >
                <Icon name="x" size={13} /> Annuler la vente
              </button>
            )}
          </div>
        )}

        {/* Imprimer / exporter le reçu (en bas) */}
        <div style={{ display: 'flex', gap: 6, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--cr-border)' }}>
          <button
            className="cr-btn cr-btn-secondary"
            style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}
            onClick={() => window.print()}
          >
            <Icon name="printer" size={13} /> Imprimer / PDF
          </button>
          <button
            className="cr-btn cr-btn-secondary"
            style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}
            onClick={() => {
              const blob = new Blob([receiptHtml(receiptData)], { type: 'text/html;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `recu-${sale.ref}.html`;
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Icon name="download" size={13} /> Exporter HTML
          </button>
        </div>
      </div>

      {showReturn && (
        <ReturnModal
          detail={detail}
          onClose={() => setShowReturn(false)}
          onDone={() => { setShowReturn(false); reload(); onReturned(saleId); }}
        />
      )}

      {/* Reçu imprimable (hors écran, visible uniquement à l'impression) */}
      <Receipt data={receiptData} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historique des ventes
// ---------------------------------------------------------------------------
export function SalesView() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Tous');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [commerce, setCommerce] = useState<{ name: string; city?: string }>({ name: 'KOMERSA' });
  const [ticketCfg, setTicketCfg] = useState<TicketCfg>({ showSeller: true, showClient: true });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [metrics, setMetrics] = useState<SalesMetrics | null>(null);

  const loadMetrics = () => api.sales.getMetrics().then(setMetrics).catch(() => {});
  useEffect(() => { loadMetrics(); }, []);

  useEffect(() => {
    Promise.all([api.settings.getCommerceInfo(), api.settings.getSettings()]).then(([info, st]) => {
      setCommerce({ name: info.short_name || info.name, city: info.city });
      const truthy = (v: string | undefined, def: boolean) => v === undefined ? def : (v === 'true' || v === '1');
      setTicketCfg({
        header: st.ticket_header || undefined, footer: st.ticket_footer || undefined,
        showSeller: truthy(st.ticket_show_seller, true), showClient: truthy(st.ticket_show_client, true),
      });
    }).catch(() => {});
  }, []);

  // Chargement paginé + filtre dates (f/t explicites pour éviter le state périmé).
  const fetchPage = async (reset: boolean, f = from, t = to) => {
    setLoading(true);
    try {
      const off = reset ? 0 : sales.length;
      const r = await api.sales.listSales({ from: f || null, to: t || null, offset: off, limit: 50 });
      setSales((prev) => reset ? r : [...prev, ...r]);
      setHasMore(r.length === 50);
    } finally { setLoading(false); }
  };
  const resetFilter = () => { setFrom(''); setTo(''); fetchPage(true, '', ''); };

  useEffect(() => { fetchPage(true); /* eslint-disable-next-line */ }, []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await api.sales.listSales({ from: from || null, to: to || null, offset: 0, limit: 10000 });
      downloadCsv(
        `ventes-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Référence', 'Date', 'Client', 'Vendeur', 'Mode', 'État', 'Total', 'Remboursé', 'Net'],
        all.map((s) => [
          s.ref, csvDate(s.created_at), s.client_name ?? 'Comptoir', s.seller_name,
          s.payment_labels, s.state, Math.round(s.total), Math.round(s.returned_total ?? 0),
          Math.round(s.total - (s.returned_total ?? 0)),
        ]),
      );
    } finally { setExporting(false); }
  };

  const filtered = sales.filter((s) => {
    const matchFilter = filter === 'Tous' || s.state === filter;
    const q = search.toLowerCase();
    const matchSearch = !q
      || s.ref.toLowerCase().includes(q)
      || (s.client_name ?? '').toLowerCase().includes(q)
      || s.seller_name.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  if (loading && sales.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
      <span className="spinner" />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      {/* KPIs (calculés côté serveur sur tout l'historique) */}
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: "CA aujourd'hui", value: money(metrics?.today_ca ?? 0) },
          { label: 'Tickets du jour', value: num(metrics?.today_tickets ?? 0) },
          { label: 'Panier moyen', value: money(metrics?.avg_basket ?? 0) },
          { label: 'Créances ouvertes', value: num(metrics?.open_credits ?? 0) + ' ticket(s)' },
        ].map((k) => (
          <div key={k.label} className="cr-card" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Recherche — sous les KPIs, à droite */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div className="cr-input-wrap" style={{ width: 220 }}>
          <Icon name="search" size={14} className="cr-input-icon" />
          <input className="cr-input" style={{ height: 32, fontSize: 13 }}
            placeholder="Ref, client, vendeur…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Une seule ligne : filtres d'état à gauche · filtre dates/export à droite */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f}
              className="cr-btn cr-btn-ghost"
              style={{
                height: 30, padding: '0 12px', fontSize: 12.5,
                background: filter === f ? 'var(--cr-accent-lt)' : undefined,
                color: filter === f ? 'var(--cr-accent)' : undefined,
              }}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
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

      {/* Table + détail */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div className="cr-card" style={{ flex: 1, minWidth: 0, padding: 0, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="screen-placeholder" style={{ height: 200 }}>
              <Icon name="sales" size={32} />
              <p>Aucune vente enregistrée.</p>
            </div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Vendeur</th>
                  <th>Mode</th>
                  <th>État</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className={`stock-row${selected === s.id ? ' selected' : ''}`}
                    onClick={() => setSelected(selected === s.id ? null : s.id)}
                  >
                    <td className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{s.ref}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)', whiteSpace: 'nowrap' }}>
                      {formatDate(s.created_at)}
                    </td>
                    <td style={{ fontSize: 13 }}>{s.client_name ?? <span style={{ color: 'var(--cr-ink-3)' }}>Comptoir</span>}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{s.seller_name}</td>
                    <td style={{ fontSize: 12 }}>{s.payment_labels}</td>
                    <td>
                      <span className={`badge badge-${STATE_TONES[s.state] ?? 'neutral'}`}>
                        {s.state}
                      </span>
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                      {money(s.total)}
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
          <SaleDetailPanel
            saleId={selected}
            commerce={commerce}
            ticketCfg={ticketCfg}
            onClose={() => setSelected(null)}
            onCancel={(id) => {
              setSales((prev) => prev.map((s) => s.id === id ? { ...s, state: 'Annulée' } : s));
              setSelected(null);
              loadMetrics();
            }}
            onReturned={(id) => {
              setSales((prev) => prev.map((s) => s.id === id ? { ...s, state: 'Retour partiel' } : s));
              loadMetrics();
            }}
          />
        )}
      </div>
    </div>
  );
}
