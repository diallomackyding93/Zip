import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { money, moneyShort, num } from '../lib/format';
import { Icon } from '../components/icons/Icons';
import { canAccessScreen } from '../lib/access';
import type { DashboardSnapshot, AlertRow, NavItemId } from '../lib/types';

// ---------------------------------------------------------------------------
// Courbe de tendance lissée (aire + dégradé + min/max + pic annoté + moyenne)
// ---------------------------------------------------------------------------
function TrendChart({ data }: { data: number[] }) {
  const n = data.length;
  if (n < 2) return null;

  const W = 720, H = 210;
  const padL = 6, padR = 6, padT = 16, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(...data);
  const avg = data.reduce((s, v) => s + v, 0) / n;
  const yMax = max > 0 ? max * 1.12 : 1;

  const x = (i: number) => padL + (i / (n - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const pts: [number, number][] = data.map((v, i) => [x(i), y(v)]);

  // Lissage Catmull-Rom → Bézier cubique
  let line = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    line += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${line} L ${x(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  // Pic (max) annoté
  const peakIdx = data.indexOf(max);
  const peak = pts[peakIdx];

  // Dates de l'axe X (les n derniers jours terminant aujourd'hui)
  const today = new Date();
  const dateAt = (i: number) => {
    const d = new Date(today); d.setDate(today.getDate() - (n - 1 - i));
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  };
  const xLabelIdx = [0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1];

  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cr-accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--cr-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grille horizontale + labels Y */}
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const gy = padT + plotH - f * plotH;
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--cr-border)" strokeWidth="1" strokeDasharray={i === 0 ? '0' : '3 4'} />
            <text x={padL + 2} y={gy - 3} fontSize="10" fill="var(--cr-ink-3)" fontFamily="var(--cr-font-mono)">
              {moneyShort(yMax * f)}
            </text>
          </g>
        );
      })}

      {/* Moyenne */}
      <line x1={padL} y1={y(avg)} x2={W - padR} y2={y(avg)} stroke="var(--cr-accent)" strokeWidth="1" strokeDasharray="2 4" opacity="0.5" />

      {/* Aire + ligne */}
      <path d={area} fill="url(#trendGrad)" />
      <path d={line} fill="none" stroke="var(--cr-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

      {/* Pic annoté */}
      <circle cx={peak[0]} cy={peak[1]} r="4" fill="var(--cr-surface)" stroke="var(--cr-accent)" strokeWidth="2.5" />
      <g transform={`translate(${Math.min(Math.max(peak[0], 50), W - 60)}, ${Math.max(peak[1] - 34, 4)})`}>
        <rect x="-46" y="-2" width="92" height="26" rx="6" fill="var(--cr-ink-1)" />
        <text x="0" y="15" textAnchor="middle" fontSize="11" fill="#fff" fontFamily="var(--cr-font-mono)">
          {dateAt(peakIdx)} · {moneyShort(max)}
        </text>
      </g>

      {/* Labels X */}
      {xLabelIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
          fontSize="10" fill="var(--cr-ink-3)" fontFamily="var(--cr-font-mono)">
          {dateAt(i)}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Assistant KOMERSA — recommandations (issues du moteur d'alertes)
// ---------------------------------------------------------------------------
const SEV_MAP: Record<string, { label: string; tone: string }> = {
  Critique: { label: 'Urgent', tone: 'danger' },
  Attention: { label: 'Important', tone: 'warn' },
  Info: { label: 'Moyenne', tone: 'info' },
};
const CAT_ICONS: Record<string, string> = {
  Stock: 'box', 'Crédit client': 'credits', 'Dette fournisseur': 'debts',
  Caisse: 'cash', Système: 'settings', Synchronisation: 'refresh',
};

function Assistant({ alerts, onNavigate }: { alerts: AlertRow[]; onNavigate?: (id: NavItemId) => void }) {
  const shown = alerts.slice(0, 4); // carte figée : 4 recommandations max
  return (
    <div className="cr-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--cr-accent-lt)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cr-accent)' }}>
          <Icon name="settings" size={16} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Assistant KOMERSA</div>
        </div>
        <span className="badge badge-neutral">{shown.length} action(s) prioritaire(s)</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {shown.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--cr-good)', fontSize: 13 }}>
            <Icon name="check" size={16} /> Tout est sous contrôle. Aucune action prioritaire.
          </div>
        ) : (
          <>
            {shown.map((a, i) => {
              const sev = SEV_MAP[a.severity] ?? { label: a.severity, tone: 'info' };
              return (
                <div key={a.id} className="assistant-row" style={{ borderBottom: i < shown.length - 1 ? '1px solid var(--cr-border)' : 'none' }}>
                  <span className={`badge badge-${sev.tone}`} style={{ width: 72, justifyContent: 'center', flexShrink: 0 }}>{sev.label}</span>
                  <span className="assistant-ic"><Icon name={CAT_ICONS[a.category ?? ''] ?? 'alerts'} size={16} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{a.title}</div>
                    {a.detail && <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detail}</div>}
                  </div>
                  <button className="cr-btn cr-btn-secondary" style={{ height: 30, fontSize: 12.5, flexShrink: 0 }}
                    onClick={() => onNavigate?.('alerts')}>
                    Traiter <Icon name="chevronRight" size={13} />
                  </button>
                </div>
              );
            })}
            {/* L'espace restant devient un signal positif (jamais de vide ni d'écartèlement). */}
            <div style={{ flex: 1, minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--cr-ink-3)', fontSize: 12.5 }}>
              <Icon name="check" size={14} style={{ color: 'var(--cr-good)' }} /> Rien d'autre d'urgent à signaler.
            </div>
          </>
        )}
      </div>

      <button className="assistant-all" onClick={() => onNavigate?.('alerts')}>
        Voir toutes les recommandations <Icon name="chevronRight" size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version allégée — pour les comptes sans « voir les rapports » (caissier, vendeur).
// Aucun chiffre financier : salutation + raccourcis vers les écrans autorisés.
const SHORTCUTS: { id: NavItemId; label: string; icon: string }[] = [
  { id: 'pos', label: 'Nouvelle vente', icon: 'pos' },
  { id: 'sales', label: 'Ventes', icon: 'sales' },
  { id: 'cash', label: 'Caisse', icon: 'cash' },
  { id: 'customer_credits', label: 'Crédits clients', icon: 'credits' },
  { id: 'clients', label: 'Clients', icon: 'clients' },
  { id: 'stock', label: 'Stock', icon: 'stock' },
  { id: 'inventory', label: 'Inventaire', icon: 'inventory' },
  { id: 'expenses', label: 'Dépenses', icon: 'expenses' },
];

function DashboardLite({ onNavigate, userName, permissions }: {
  onNavigate?: (id: NavItemId) => void; userName?: string; permissions: string[];
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const shortcuts = SHORTCUTS.filter((s) => canAccessScreen(s.id, permissions));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.3px' }}>
          {greeting}{userName ? `, ${userName.split(' ')[0]}` : ''}
        </div>
        <div style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>Bienvenue. Accès rapide à vos écrans.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        {shortcuts.map((s) => (
          <button key={s.id} className="cr-card" onClick={() => onNavigate?.(s.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left', padding: '16px 18px' }}>
            <span style={{ width: 40, height: 40, background: 'var(--cr-accent-lt)', borderRadius: 'var(--cr-r-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cr-accent)', flexShrink: 0 }}>
              <Icon name={s.icon} size={20} />
            </span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
interface DashboardProps {
  onNavigate?: (id: NavItemId) => void;
  userName?: string;
  canViewReports: boolean;
  permissions: string[];
}

export function Dashboard({ onNavigate, userName, canViewReports, permissions }: DashboardProps) {
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [lastRead, setLastRead] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const s = await api.reports.getDashboard();
      setSnap(s);
      // Assistant : régénère puis prend les 4 alertes prioritaires
      await api.alerts.generate().catch(() => {});
      const a = await api.alerts.list().catch(() => []);
      setAlerts(a.filter((x) => x.status !== 'Résolue').slice(0, 4));
      setLastRead(new Date());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    if (canViewReports) load();
    else setLoading(false); // version allégée : pas d'appel au snapshot
  }, [load, canViewReports]);

  // Actualisation automatique toutes les 60 s (vue globale, indépendante du poste).
  useEffect(() => {
    if (!canViewReports) return;
    const id = window.setInterval(() => load(), 60000);
    return () => window.clearInterval(id);
  }, [load, canViewReports]);

  const saveGoal = async () => {
    const v = Math.max(0, Math.round(Number(String(goalInput).replace(/[^0-9.]/g, '')) || 0));
    await api.settings.setSetting({ key: 'dashboard_month_goal', value: String(v) });
    setEditingGoal(false);
    const s = await api.reports.getDashboard();
    setSnap(s);
  };

  if (!canViewReports) return <DashboardLite onNavigate={onNavigate} userName={userName} permissions={permissions} />;
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;
  if (error) return <div className="cr-card" style={{ color: 'var(--cr-danger)' }}>{error}</div>;
  if (!snap) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const monthName = new Date().toLocaleDateString('fr-FR', { month: 'long' });

  // Graphe : 30 derniers jours
  const series = snap.sales_by_day.slice(-30);

  // Objectif
  const goal = snap.month_goal;
  const pct = goal > 0 ? Math.min(100, Math.round((snap.month_sales / goal) * 100)) : 0;
  const reste = Math.max(0, goal - snap.month_sales);
  const cadence = snap.days_remaining > 0 ? reste / snap.days_remaining : reste;

  // Comparaison vs hier
  const vs = snap.yesterday_sales > 0
    ? Math.round(((snap.today_sales - snap.yesterday_sales) / snap.yesterday_sales) * 100) : null;
  const lastReadStr = lastRead ? lastRead.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';

  // Cartes figées : 4 lignes max chacune (le reste reste accessible via les écrans dédiés).
  const lowItems = snap.low_stock_items.slice(0, 4);
  const topItems = snap.top_products.slice(0, 4);

  // 6 cartes du milieu (2 rangées de 3)
  const midCards: { label: string; value: string; sub: string; icon: string; nav?: NavItemId }[] = [
    { label: 'Mois en cours', value: money(snap.month_sales), sub: 'CA confirmé, crédit inclus', icon: 'reports' },
    { label: 'Caisses ouvertes', value: money(snap.cash_expected), sub: `${num(snap.open_sessions)} caisse(s) · global`, icon: 'cash', nav: 'cash' },
    { label: 'Crédits clients', value: money(snap.customer_debts), sub: 'créances clients', icon: 'credits', nav: 'customer_credits' },
    { label: 'Dettes fournisseurs', value: money(snap.supplier_debts), sub: 'à surveiller', icon: 'debts', nav: 'supplier_debts' },
    { label: 'Encaissé du mois', value: money(snap.month_collected), sub: 'hors crédit client', icon: 'treasury' },
    { label: 'Stock faible', value: `${num(snap.low_stock_count)} produits`, sub: 'à réassortir', icon: 'box', nav: 'stock' },
  ];
  const MidCard = ({ c }: { c: typeof midCards[number] }) => (
    <div className="cr-card" style={{ flex: 1, minWidth: 220, cursor: c.nav && onNavigate ? 'pointer' : 'default' }}
      onClick={() => c.nav && onNavigate?.(c.nav)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--cr-accent-lt)', color: 'var(--cr-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={c.icon} size={14} /></span>
        <span style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{c.label}</span>
      </div>
      <div className="mono num-display" style={{ fontSize: 23, fontWeight: 600 }}>{c.value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)', marginTop: 2 }}>{c.sub}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* En-tête : titre + actualisation */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Tableau de bord</h2>
          <div style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>
            {greeting}{userName ? `, ${userName.split(' ')[0]}` : ''} · vue globale du commerce, indépendante de la caisse ouverte sur ce poste.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Dernière lecture · {lastReadStr}</span>
          <button className="cr-btn cr-btn-primary" onClick={() => load()} disabled={refreshing}>
            {refreshing ? <span className="spinner" /> : <><Icon name="refresh" size={14} /> Actualiser</>}
          </button>
        </div>
      </div>

      {/* Rangée 1 : ventes du jour + tendance/objectif */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="cr-card" style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Ventes du jour</div>
          <div className="mono num-display" style={{ fontSize: 32, fontWeight: 600, marginTop: 6 }}>{money(snap.today_sales)}</div>
          {vs !== null && (
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
                background: vs >= 0 ? 'var(--cr-good-lt)' : 'var(--cr-danger-lt)',
                color: vs >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)' }}>
                {vs >= 0 ? '↑' : '↓'} {Math.abs(vs)} % vs hier
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 16 }}>
            {[
              { ic: 'sales', label: 'Tickets', val: num(snap.today_tickets) },
              { ic: 'pos', label: 'Panier moyen', val: `${moneyShort(snap.avg_basket)}` },
              { ic: 'cash', label: '1er ticket', val: snap.first_ticket_time ?? '—' },
            ].map((m) => (
              <div key={m.label} style={{ flex: 1, background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)', padding: '10px 12px' }}>
                <Icon name={m.ic} size={14} style={{ color: 'var(--cr-ink-3)' }} />
                <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{m.val}</div>
                <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="cr-card" style={{ flex: 1.6, minWidth: 360 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="cr-card-title">Tendance · 30 derniers jours</div>
            <span style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>30 jours suivis</span>
          </div>
          <TrendChart data={series} />
          <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--cr-border)' }}>
            {editingGoal ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="cr-input mono" type="number" min="0" placeholder="Objectif du mois (GNF)"
                  value={goalInput} onChange={(e) => setGoalInput(e.target.value)} autoFocus style={{ flex: 1 }} />
                <button className="cr-btn cr-btn-primary" onClick={saveGoal}>Enregistrer</button>
                <button className="cr-btn cr-btn-ghost" onClick={() => setEditingGoal(false)}>Annuler</button>
              </div>
            ) : goal > 0 ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--cr-ink-3)', fontWeight: 600 }}>
                    Objectif {monthName} · <b style={{ color: 'var(--cr-accent)' }}>{pct} %</b>
                    <button className="dash-goal-edit" onClick={() => { setGoalInput(String(goal)); setEditingGoal(true); }} title="Modifier l'objectif">
                      <Icon name="edit" size={11} />
                    </button>
                  </span>
                  <span className="mono" style={{ fontWeight: 600 }}>{moneyShort(snap.month_sales)} / {moneyShort(goal)} GNF</span>
                </div>
                <div className="dash-goal-bar"><i style={{ width: `${pct}%` }} /></div>
                <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 8 }}>
                  Reste <strong style={{ color: 'var(--cr-accent)' }}>{money(reste)}</strong> à faire en {snap.days_remaining} jour(s)
                  {snap.days_remaining > 0 && <> · Cadence visée <strong>{moneyShort(cadence)}/jour</strong></>}
                </div>
              </>
            ) : (
              <button className="cr-btn cr-btn-secondary" onClick={() => { setGoalInput(''); setEditingGoal(true); }}>
                <Icon name="plus" size={14} /> Définir un objectif mensuel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Rangées 2 et 3 : 6 indicateurs */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {midCards.slice(0, 3).map((c) => <MidCard key={c.label} c={c} />)}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {midCards.slice(3, 6).map((c) => <MidCard key={c.label} c={c} />)}
      </div>

      {/* Rangée 4 : Assistant (gauche) aligné sur Stock à surveiller + Top produits (droite).
          Hauteurs égalisées par align-items: stretch ; responsive via flex-wrap + minWidth. */}
      <div className="dash-bottom-row">
        <div className="dash-assistant-col">
          <Assistant alerts={alerts} onNavigate={onNavigate} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="cr-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: onNavigate ? 'pointer' : 'default' }}
            onClick={() => onNavigate?.('stock')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div className="cr-card-title">Stock à surveiller</div>
              <span style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{lowItems.length} sur {num(snap.low_stock_count)}</span>
            </div>
            <div style={{ flex: 1 }}>
              {lowItems.length === 0 ? (
                <div style={{ color: 'var(--cr-ink-3)', fontSize: 13 }}>Aucun produit sous le seuil.</div>
              ) : lowItems.map((it, i) => {
                const ratio = it.stock_min > 0 ? Math.min(1, it.stock / it.stock_min) : 1;
                const tone = it.stock <= 0 ? 'var(--cr-danger)' : 'var(--cr-warn)';
                return (
                  <div key={i} style={{ padding: '7px 0', borderBottom: i < lowItems.length - 1 ? '1px solid var(--cr-border)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                      <span className="mono" style={{ color: 'var(--cr-ink-3)', flexShrink: 0 }}>{num(it.stock)} / {num(it.stock_min)}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--cr-bg)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(4, ratio * 100)}%`, background: tone, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="cr-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: onNavigate ? 'pointer' : 'default' }}
            onClick={() => onNavigate?.('reports')}>
            <div className="cr-card-title" style={{ marginBottom: 10 }}>Top produits · 30 jours</div>
            <div style={{ flex: 1 }}>
              {topItems.length === 0 ? (
                <div style={{ color: 'var(--cr-ink-3)', fontSize: 13 }}>Aucune vente sur la période.</div>
              ) : topItems.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                  borderBottom: i < topItems.length - 1 ? '1px solid var(--cr-border)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product_name}</div>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{num(p.qty)}×</span>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 13, width: 92, textAlign: 'right' }}>{money(p.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Pied informatif */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
        fontSize: 11.5, color: 'var(--cr-ink-3)', borderTop: '1px solid var(--cr-border)', paddingTop: 12 }}>
        <span>Actualisation automatique · 60 s · CA = ventes confirmées (crédit inclus)</span>
        <span>Dernière lecture · {lastReadStr}</span>
      </div>
    </div>
  );
}
