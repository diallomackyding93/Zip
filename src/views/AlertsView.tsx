import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { num } from '../lib/format';
import { Icon } from '../components/icons/Icons';
import type { AlertRow, AlertMetrics, AlertRuleRow, AlertRuleType } from '../lib/types';

const SEV_TONES: Record<string, string> = { Critique: 'danger', Attention: 'warn', Info: 'info' };

const RULE_TYPE_LABELS: Record<AlertRuleType, string> = {
  stock: 'Stock faible / rupture',
  customer_credit: 'Crédit client en retard',
  credit_due_soon: 'Crédit client à échéance proche',
  credit_limit: 'Plafond de crédit client atteint',
  supplier_debt: 'Dette fournisseur en retard',
  debt_due_soon: 'Dette fournisseur à échéance proche',
  cash_session: 'Caisse ouverte trop longtemps',
  cash_closed: 'Aucune caisse ouverte',
  cash_gap: 'Écart de caisse à la clôture',
  loss_sale: 'Produit vendu à perte',
  dormant_stock: 'Stock dormant (sans vente)',
  low_balance: 'Compte de paiement à sec',
  inventory_variance: "Écarts d'inventaire",
  month_goal: 'Objectif mensuel en retard',
};
const RULE_TYPES: AlertRuleType[] = [
  'stock', 'customer_credit', 'credit_due_soon', 'credit_limit',
  'supplier_debt', 'debt_due_soon', 'cash_session', 'cash_closed',
  'cash_gap', 'loss_sale', 'dormant_stock', 'low_balance',
  'inventory_variance', 'month_goal',
];
const SEVERITIES = ['Critique', 'Attention', 'Info'];

// Lecture du seuil stock depuis trigger_config JSON.
function readThreshold(cfg?: string): string {
  if (!cfg) return '';
  try { const v = JSON.parse(cfg); return v?.threshold != null ? String(v.threshold) : ''; }
  catch { return ''; }
}

// ---------------------------------------------------------------------------
// Formulaire de règle d'alerte (création / édition)
// ---------------------------------------------------------------------------
function AlertRuleForm({ rule, onSave, onClose }: {
  rule: AlertRuleRow | null;
  onSave: (data: { id?: string; label: string; rule_type: AlertRuleType; trigger_config?: string; severity: string; active: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(rule?.label ?? '');
  const [type, setType] = useState<AlertRuleType>(rule?.type ?? 'stock');
  const [severity, setSeverity] = useState(rule?.severity ?? 'Attention');
  const [active, setActive] = useState(rule?.active ?? true);
  const [threshold, setThreshold] = useState(readThreshold(rule?.trigger_config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!label.trim()) { setError('L\'intitulé est requis.'); return; }
    setError(null); setBusy(true);
    try {
      const trigger_config = type === 'stock' && threshold.trim() !== ''
        ? JSON.stringify({ threshold: Number(threshold) })
        : undefined;
      await onSave({ id: rule?.id, label: label.trim(), rule_type: type, trigger_config, severity, active });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 420 }}>
        <div className="modal-head">
          <div style={{ fontWeight: 600, fontSize: 14 }}>{rule ? 'Modifier la règle' : 'Nouvelle règle d\'alerte'}</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="cr-field">
            <label className="cr-label">Intitulé *</label>
            <input className="cr-input" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex : Surveiller le stock de wax" autoFocus />
          </div>
          <div className="cr-field">
            <label className="cr-label">Type de règle</label>
            <select className="cr-input" value={type} onChange={(e) => setType(e.target.value as AlertRuleType)}>
              {RULE_TYPES.map((t) => <option key={t} value={t}>{RULE_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          {type === 'stock' && (
            <div className="cr-field">
              <label className="cr-label">Seuil personnalisé (optionnel)</label>
              <input className="cr-input mono" type="number" min="0" value={threshold}
                onChange={(e) => setThreshold(e.target.value)} placeholder="Ex : 5" />
              <div className="cr-hint" style={{ marginTop: 4 }}>
                Vide = utilise le seuil mini de chaque produit. Sinon, alerte si stock ≤ ce nombre.
              </div>
            </div>
          )}
          <div className="cr-field">
            <label className="cr-label">Sévérité</label>
            <select className="cr-input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <label className="module-toggle" onClick={() => setActive((v) => !v)}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>Règle active</div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Désactivée, cette catégorie d'alerte n'est plus générée.</div>
            </div>
            <div className={`toggle-switch${active ? ' on' : ''}`} />
          </label>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="modal-foot">
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
// Panneau des règles d'alerte
// ---------------------------------------------------------------------------
function RulesPanel() {
  const [rules, setRules] = useState<AlertRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AlertRuleRow | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRules(await api.alerts.listRules()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = async (data: { id?: string; label: string; rule_type: AlertRuleType; trigger_config?: string; severity: string; active: boolean }) => {
    if (data.id) {
      await api.alerts.updateRule({ id: data.id, label: data.label, rule_type: data.rule_type, trigger_config: data.trigger_config, severity: data.severity, active: data.active });
    } else {
      await api.alerts.createRule({ label: data.label, rule_type: data.rule_type, trigger_config: data.trigger_config, severity: data.severity, active: data.active });
    }
    setShowForm(false); setEditing(null);
    await load();
  };

  const toggleActive = async (r: AlertRuleRow) => {
    await api.alerts.updateRule({ id: r.id, label: r.label, rule_type: r.type, trigger_config: r.trigger_config, severity: r.severity, active: !r.active });
    setRules((prev) => prev.map((x) => x.id === r.id ? { ...x, active: !x.active } : x));
  };

  const remove = async (r: AlertRuleRow) => {
    if (!confirm(`Supprimer la règle « ${r.label} » ?`)) return;
    await api.alerts.deleteRule(r.id);
    setRules((prev) => prev.filter((x) => x.id !== r.id));
  };

  return (
    <div className="cr-card" style={{ flex: 1, padding: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--cr-border)' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Règles d'alerte</div>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Activent/désactivent chaque catégorie et imposent leur sévérité.</div>
        </div>
        <button className="cr-btn cr-btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Icon name="plus" size={14} /> Nouvelle règle
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>
      ) : rules.length === 0 ? (
        <div className="screen-placeholder" style={{ height: 200 }}>
          <Icon name="alerts" size={32} />
          <p>Aucune règle personnalisée. Les alertes par défaut restent actives.</p>
        </div>
      ) : (
        <div style={{ padding: 6 }}>
          {rules.map((r) => (
            <div key={r.id} className="alert-row" style={{ cursor: 'default' }}>
              <span className={`alert-icon tone-${SEV_TONES[r.severity] ?? 'info'}`}>
                <Icon name={CAT_ICONS[RULE_TYPE_LABELS[r.type].split(' ')[0]] ?? 'alerts'} size={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{r.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
                  {RULE_TYPE_LABELS[r.type]}{readThreshold(r.trigger_config) ? ` · seuil ${readThreshold(r.trigger_config)}` : ''}
                </div>
              </div>
              <span className={`badge badge-${SEV_TONES[r.severity] ?? 'info'}`}>{r.severity}</span>
              <button className={`toggle-switch${r.active ? ' on' : ''}`} style={{ marginLeft: 10 }}
                onClick={() => toggleActive(r)} title={r.active ? 'Active' : 'Inactive'} />
              <button className="topbar-btn" style={{ marginLeft: 4 }} title="Modifier"
                onClick={() => { setEditing(r); setShowForm(true); }}><Icon name="edit" size={14} /></button>
              <button className="topbar-btn" title="Supprimer" onClick={() => remove(r)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <AlertRuleForm rule={editing} onSave={handleSave} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}
    </div>
  );
}
const CAT_ICONS: Record<string, string> = {
  Stock: 'box', 'Crédit client': 'credits', 'Dette fournisseur': 'debts',
  Caisse: 'cash', Système: 'settings', Synchronisation: 'refresh',
};

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

export function AlertsView() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [metrics, setMetrics] = useState<AlertMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Toutes');
  const [selected, setSelected] = useState<AlertRow | null>(null);
  const [tab, setTab] = useState<'alerts' | 'rules'>('alerts');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Régénère les alertes à partir de l'état réel, puis charge
      await api.alerts.generate();
      const [a, m] = await Promise.all([api.alerts.list(), api.alerts.getMetrics()]);
      setAlerts(a); setMetrics(m);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = alerts.filter((a) => {
    if (filter === 'Toutes') return true;
    if (filter === 'Critiques') return a.severity === 'Critique';
    if (filter === 'À traiter') return a.status === 'À traiter';
    return a.category === filter;
  });

  const categories = Array.from(new Set(alerts.map((a) => a.category).filter(Boolean))) as string[];

  const handleStatus = async (alert: AlertRow, status: string) => {
    await api.alerts.updateStatus({ alert_id: alert.id, status });
    if (status === 'Masquée') {
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      if (selected?.id === alert.id) setSelected(null);
    } else {
      setAlerts((prev) => prev.map((a) => a.id === alert.id ? { ...a, status } : a));
      if (selected?.id === alert.id) setSelected({ ...alert, status });
    }
    api.alerts.getMetrics().then(setMetrics).catch(() => {});
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      {/* Métriques */}
      {metrics && (
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>Critiques</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: metrics.critical > 0 ? 'var(--cr-danger)' : 'var(--cr-ink-1)' }}>{num(metrics.critical)}</div>
          </div>
          <div className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>À surveiller</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: metrics.warning > 0 ? 'var(--cr-warn)' : 'var(--cr-ink-1)' }}>{num(metrics.warning)}</div>
          </div>
          <div className="cr-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>Total actif</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{num(metrics.total)}</div>
          </div>
          <div className="cr-card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <button className="cr-btn cr-btn-secondary" onClick={load}>
              <Icon name="refresh" size={14} /> Actualiser
            </button>
          </div>
        </div>
      )}

      {/* Onglets Alertes / Règles */}
      <div className="auth-tabs" style={{ alignSelf: 'flex-start' }}>
        <button className={`auth-tab${tab === 'alerts' ? ' active' : ''}`} onClick={() => setTab('alerts')}>Alertes</button>
        <button className={`auth-tab${tab === 'rules' ? ' active' : ''}`} onClick={() => setTab('rules')}>Règles</button>
      </div>

      {tab === 'rules' ? (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <RulesPanel />
        </div>
      ) : (
      <>
      {/* Filtres */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {['Toutes', 'Critiques', 'À traiter', ...categories].map((f) => (
          <button key={f} className="cr-btn cr-btn-ghost"
            style={{ height: 30, padding: '0 12px', fontSize: 12.5,
              background: filter === f ? 'var(--cr-accent-lt)' : undefined,
              color: filter === f ? 'var(--cr-accent)' : undefined }}
            onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {/* Liste + détail */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div className="cr-card" style={{ flex: 1, padding: 0, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="screen-placeholder" style={{ height: 200 }}>
              <Icon name="check" size={32} style={{ color: 'var(--cr-good)', opacity: 1 }} />
              <h3>Aucune alerte</h3>
              <p>Tout est sous contrôle. Aucune action requise.</p>
            </div>
          ) : (
            filtered.map((a) => (
              <div key={a.id} className={`alert-row${selected?.id === a.id ? ' selected' : ''}`}
                onClick={() => setSelected(selected?.id === a.id ? null : a)}>
                <span className={`alert-icon tone-${SEV_TONES[a.severity] ?? 'info'}`}>
                  <Icon name={CAT_ICONS[a.category ?? ''] ?? 'alerts'} size={16} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13.5 }}>{a.title}</div>
                  {a.detail && <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detail}</div>}
                  <div style={{ fontSize: 11, color: 'var(--cr-ink-3)', marginTop: 2 }}>
                    {a.category} · {formatDate(a.created_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <span className={`badge badge-${SEV_TONES[a.severity] ?? 'info'}`}>{a.severity}</span>
                  <span className={`badge badge-${a.status === 'À traiter' ? 'danger' : a.status === 'Résolue' ? 'good' : 'neutral'}`} style={{ fontSize: 10 }}>{a.status}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Détail */}
        {selected && (
          <div className="stock-detail" style={{ width: 300 }}>
            <div className="stock-detail-head">
              <div style={{ flex: 1 }}>
                <span className={`badge badge-${SEV_TONES[selected.severity] ?? 'info'}`}>{selected.severity}</span>
              </div>
              <button className="topbar-btn" onClick={() => setSelected(null)}><Icon name="x" size={16} /></button>
            </div>
            <div className="stock-detail-body" style={{ padding: '12px 16px' }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{selected.title}</div>
              {selected.detail && (
                <div style={{ fontSize: 13, color: 'var(--cr-ink-2)', marginBottom: 12, lineHeight: 1.5 }}>
                  {selected.detail}
                </div>
              )}
              {selected.recommendation && (
                <div style={{ background: 'var(--cr-info-lt)', borderRadius: 'var(--cr-r)',
                  padding: '10px 12px', fontSize: 12.5, color: 'var(--cr-info)', marginBottom: 16 }}>
                  <strong>Recommandation</strong><br />{selected.recommendation}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selected.status !== 'Résolue' && (
                  <button className="cr-btn cr-btn-primary" style={{ justifyContent: 'center' }}
                    onClick={() => handleStatus(selected, 'Résolue')}>
                    <Icon name="check" size={14} /> Marquer comme résolue
                  </button>
                )}
                {selected.status === 'À traiter' && (
                  <button className="cr-btn cr-btn-secondary" style={{ justifyContent: 'center' }}
                    onClick={() => handleStatus(selected, 'En surveillance')}>
                    <Icon name="eye" size={14} /> Mettre en surveillance
                  </button>
                )}
                <button className="cr-btn cr-btn-ghost" style={{ justifyContent: 'center', color: 'var(--cr-ink-3)' }}
                  onClick={() => handleStatus(selected, 'Masquée')}>
                  <Icon name="eye-off" size={14} /> Masquer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
