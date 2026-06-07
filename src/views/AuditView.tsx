import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { downloadCsv, csvDate } from '../lib/csv';
import { HistoryFilter } from '../components/HistoryFilter';
import type { AuditRow } from '../lib/types';

// Type d'action → libellé + tonalité.
const ACTIONS: Record<string, { label: string; tone: string }> = {
  role_change: { label: 'Rôle', tone: 'warn' },
  permission_change: { label: 'Permission', tone: 'warn' },
  member_status: { label: 'Statut membre', tone: 'warn' },
  sale_cancel: { label: 'Annulation vente', tone: 'danger' },
  cash_close: { label: 'Clôture caisse', tone: 'info' },
  handover_validate: { label: 'Validation remise', tone: 'good' },
  treasury_transfer: { label: 'Transfert', tone: 'info' },
  supplier_payment: { label: 'Paiement fournisseur', tone: 'info' },
  expense: { label: 'Dépense', tone: 'danger' },
  stock_adjust: { label: 'Ajustement stock', tone: 'neutral' },
  backup: { label: 'Sauvegarde', tone: 'neutral' },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

const PAGE = 50;

export function AuditView() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchPage = async (reset: boolean, f = from, t = to, a = action) => {
    setLoading(true);
    try {
      const offset = reset ? 0 : rows.length;
      const r = await api.audit.list({ from: f || null, to: t || null, action: a || null, offset, limit: PAGE });
      setRows((prev) => reset ? r : [...prev, ...r]);
      setHasMore(r.length === PAGE);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchPage(true); /* eslint-disable-next-line */ }, []);
  // Recharger quand le filtre de type change.
  useEffect(() => { fetchPage(true, from, to, action); /* eslint-disable-next-line */ }, [action]);

  const resetFilter = () => { setFrom(''); setTo(''); setAction(''); fetchPage(true, '', '', ''); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await api.audit.list({ from: from || null, to: to || null, action: action || null, offset: 0, limit: 10000 });
      downloadCsv(
        `journal-audit-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Date', 'Utilisateur', 'Action', 'Détail', 'Référence', 'Montant'],
        all.map((r) => [
          csvDate(r.created_at), r.account_name,
          ACTIONS[r.action]?.label ?? r.action, r.detail, r.entity_ref ?? '',
          r.amount != null ? Math.round(r.amount) : '',
        ]),
      );
    } finally { setExporting(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Journal d'audit</h2>
        <div style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>
          Historique des actions sensibles. Lecture seule — consultable par les responsables.
        </div>
      </div>

      {/* Filtres : type d'action à gauche · dates/export à droite */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="cr-field" style={{ minWidth: 220 }}>
          <label className="cr-label">Type d'action</label>
          <select className="cr-input" value={action} onChange={(e) => setAction(e.target.value)}
            style={{ height: 34, fontSize: 13 }}>
            <option value="">Toutes les actions</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <HistoryFilter
            from={from} to={to} setFrom={setFrom} setTo={setTo}
            onApply={() => fetchPage(true)} onReset={resetFilter}
            onExport={exportCsv} loading={loading} exporting={exporting}
          />
        </div>
      </div>

      <div className="cr-card" style={{ padding: 0 }}>
        {loading && rows.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><span className="spinner" /></div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--cr-ink-3)', fontSize: 13 }}>
            Aucune action enregistrée sur la période.
          </div>
        ) : (
          <div>
            {rows.map((r, i) => {
              const a = ACTIONS[r.action] ?? { label: r.action, tone: 'neutral' };
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                  borderBottom: i < rows.length - 1 ? '1px solid var(--cr-border)' : 'none' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--cr-ink-3)', width: 96, flexShrink: 0 }}>{formatDate(r.created_at)}</span>
                  <span className={`badge badge-${a.tone}`} style={{ width: 130, justifyContent: 'center', flexShrink: 0 }}>{a.label}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5 }}>{r.detail}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
                      par {r.account_name}{r.entity_ref ? ` · ${r.entity_ref}` : ''}
                    </div>
                  </div>
                  {r.amount != null && (
                    <span className="mono" style={{ fontWeight: 600, fontSize: 13, flexShrink: 0 }}>{money(r.amount)}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hasMore && (
          <button className="cr-btn cr-btn-ghost" style={{ width: '100%', justifyContent: 'center', padding: 10 }}
            onClick={() => fetchPage(false)} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Charger plus'}
          </button>
        )}
      </div>
    </div>
  );
}
