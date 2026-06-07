import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { money, moneyShort, num } from '../lib/format';
import { Icon } from '../components/icons/Icons';
import { ReportPreviewModal } from '../components/ReportPreviewModal';
import type { ReportDoc, ReportSection } from '../components/ReportPreviewModal';
import type { ReportData, DayPoint, TopProduct } from '../lib/types';

// Blocs disponibles pour un rapport personnalisé.
const REPORT_BLOCKS: { key: string; label: string }[] = [
  { key: 'synthese', label: 'Synthèse des ventes' },
  { key: 'marge', label: 'Marge brute' },
  { key: 'paiements', label: 'Répartition des paiements' },
  { key: 'top', label: 'Top produits' },
  { key: 'categories', label: 'Ventes par catégorie' },
  { key: 'caisse', label: 'Caisse & mouvements' },
  { key: 'stock', label: 'Stock critique' },
  { key: 'achats', label: 'Achats & fournisseurs' },
];
type OutFormat = 'pdf' | 'html' | 'csv';

const PERIODS = [
  { id: 'today', label: "Aujourd'hui" },
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: 'month', label: 'Ce mois' },
  { id: 'year', label: 'Année' },
  { id: 'custom', label: 'Personnalisé' },
];

const TONE_COLORS = ['#d2592f', '#185fa5', '#1d9e75', '#ba7517', '#5f6469', '#e24b4a', '#3a6ea5', '#137a52'];

// --- CSV helpers -----------------------------------------------------------
function csvCell(v: string | number): string {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function saveCsv(filename: string, lines: string[]) {
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

function exportReportCsv(data: ReportData, periodLabel: string) {
  const lines: string[] = [];
  lines.push(`Rapport KOMERSA;${periodLabel}`);
  lines.push('');
  lines.push('Indicateur;Valeur');
  lines.push(`Chiffre d'affaires;${Math.round(data.total_sales)}`);
  lines.push(`Tickets;${data.tickets}`);
  lines.push(`Marge estimée;${Math.round(data.margin)}`);
  lines.push(`Panier moyen;${Math.round(data.avg_ticket)}`);
  lines.push(`Achats;${Math.round(data.purchases)}`);
  lines.push(`Dette achats;${Math.round(data.purchases_due)}`);
  lines.push(`Valeur du stock;${Math.round(data.stock_value)}`);
  lines.push(`Produits sous seuil;${data.low_stock_count}`);
  lines.push('');
  lines.push('Mode de paiement;Montant');
  data.payment_modes.forEach((m) => lines.push(`${csvCell(m.mode_label)};${Math.round(m.amount)}`));
  lines.push('');
  lines.push('Catégorie;Montant');
  data.categories.forEach((c) => lines.push(`${csvCell(c.mode_label)};${Math.round(c.amount)}`));
  lines.push('');
  lines.push("Top produits;Quantité;Chiffre d'affaires");
  data.top_products.forEach((p) => lines.push(`${csvCell(p.product_name)};${p.qty};${Math.round(p.amount)}`));
  saveCsv(`rapport-komersa-${stamp()}.csv`, lines);
}

// Plage de dates correspondant à la période (pour les exports ciblés).
function periodRange(period: string, from: string, to: string): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const minus = (days: number) => { const d = new Date(today); d.setDate(d.getDate() - days); return iso(d); };
  switch (period) {
    case 'today': return { from: iso(today), to: iso(today) };
    case '7d': return { from: minus(6), to: iso(today) };
    case 'month': return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case 'year': return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
    case 'custom': return { from, to };
    default: return { from: minus(29), to: iso(today) };
  }
}

// ---------------------------------------------------------------------------
// Graphe d'évolution du CA (aire lissée)
// ---------------------------------------------------------------------------
function AreaChart({ points }: { points: DayPoint[] }) {
  const data = points.map((p) => p.amount);
  const n = data.length;
  if (n < 2) {
    return <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cr-ink-3)', fontSize: 13 }}>
      Pas assez de données pour un graphe sur cette période.
    </div>;
  }
  const W = 720, H = 210, padL = 6, padR = 6, padT = 16, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...data, 1);
  const yMax = max * 1.12;
  const x = (i: number) => padL + (i / (n - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const pts: [number, number][] = data.map((v, i) => [x(i), y(v)]);

  let line = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    line += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${line} L ${x(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const fmt = (d: string) => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; };
  const labelIdx = [...new Set([0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1])];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 210 }}>
      <defs>
        <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cr-accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--cr-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const gy = padT + plotH - f * plotH;
        return <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy}
          stroke="var(--cr-border)" strokeWidth="1" strokeDasharray={i === 0 ? '0' : '3 4'} />;
      })}
      <path d={area} fill="url(#repGrad)" />
      <path d={line} fill="none" stroke="var(--cr-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {labelIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
          fontSize="10" fill="var(--cr-ink-3)" fontFamily="var(--cr-font-mono)">{fmt(points[i].date)}</text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Donut (modes de paiement)
// ---------------------------------------------------------------------------
function Donut({ data }: { data: { label: string; amount: number }[] }) {
  const total = data.reduce((s, d) => s + d.amount, 0);
  if (total === 0) return <div style={{ color: 'var(--cr-ink-3)', fontSize: 13 }}>Aucune donnée.</div>;
  let offset = 0;
  const radius = 54, circumference = 2 * Math.PI * radius;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
        <g transform="rotate(-90 70 70)">
          {data.map((d, i) => {
            const dash = (d.amount / total) * circumference;
            const seg = <circle key={i} cx="70" cy="70" r={radius} fill="none"
              stroke={TONE_COLORS[i % TONE_COLORS.length]} strokeWidth="18"
              strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} />;
            offset += dash;
            return seg;
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" fontSize="11" fill="var(--cr-ink-3)">Total</text>
        <text x="70" y="82" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--cr-ink-1)" fontFamily="var(--cr-font-mono)">{moneyShort(total)}</text>
      </svg>
      <div style={{ flex: 1 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: TONE_COLORS[i % TONE_COLORS.length], flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{d.label}</span>
            <span style={{ color: 'var(--cr-ink-3)', fontSize: 11, width: 32, textAlign: 'right' }}>{Math.round((d.amount / total) * 100)}%</span>
            <span className="mono" style={{ fontWeight: 500, width: 56, textAlign: 'right' }}>{moneyShort(d.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top produits (barres horizontales)
// ---------------------------------------------------------------------------
function TopProductsBars({ items }: { items: TopProduct[] }) {
  if (items.length === 0) return <div style={{ color: 'var(--cr-ink-3)', fontSize: 13 }}>Aucune vente sur la période.</div>;
  const max = Math.max(...items.map((p) => p.amount), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
          <span className="mono" style={{ color: 'var(--cr-ink-3)', width: 14 }}>{i + 1}</span>
          <span style={{ width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product_name}</span>
          <div style={{ flex: 1, height: 8, background: 'var(--cr-bg)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(p.amount / max) * 100}%`, background: 'var(--cr-accent)', borderRadius: 4 }} />
          </div>
          <span className="mono" style={{ fontWeight: 600, width: 54, textAlign: 'right' }}>{moneyShort(p.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ventes par catégorie (barres verticales)
// ---------------------------------------------------------------------------
function CategoryBars({ items }: { items: { mode_label: string; amount: number }[] }) {
  if (items.length === 0) return <div style={{ color: 'var(--cr-ink-3)', fontSize: 13 }}>Aucune donnée.</div>;
  const top = items.slice(0, 6);
  const max = Math.max(...top.map((c) => c.amount), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 180, paddingTop: 8 }}>
      {top.map((c, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
          <div className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{moneyShort(c.amount)}</div>
          <div style={{ width: '64%', height: `${Math.max(3, (c.amount / max) * 100)}%`, background: 'var(--cr-accent)', borderRadius: '4px 4px 0 0' }} />
          <div style={{ fontSize: 11, color: 'var(--cr-ink-3)', textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.mode_label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Rapports
// ---------------------------------------------------------------------------
const todayIso = () => new Date().toISOString().slice(0, 10);

export function ReportsView() {
  const [period, setPeriod] = useState('7d');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [commerce, setCommerce] = useState<{ name: string; city?: string }>({ name: 'KOMERSA' });
  const [busyReport, setBusyReport] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReportDoc | null>(null);

  // Constructeur de rapport personnalisé
  const [customName, setCustomName] = useState('');
  const [customBlocks, setCustomBlocks] = useState<Set<string>>(new Set(['synthese', 'marge', 'paiements', 'top']));
  const [customFormat, setCustomFormat] = useState<OutFormat>('pdf');
  const [customBusy, setCustomBusy] = useState(false);
  const toggleBlock = (k: string) => setCustomBlocks((prev) => {
    const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n;
  });

  const load = useCallback(async (p: string, f: string, t: string) => {
    setLoading(true);
    try {
      setData(await api.reports.getReport(p === 'custom' ? { period: 'custom', from: f, to: t } : { period: p }));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (period !== 'custom') load(period, from, to); }, [period, load, from, to]);
  useEffect(() => {
    api.settings.getCommerceInfo().then((i) => setCommerce({ name: i.short_name || i.name, city: i.city })).catch(() => {});
  }, []);

  const periodLabel = period === 'custom' ? `${from} → ${to}` : (PERIODS.find((p) => p.id === period)?.label ?? period);

  // --- Aperçus de rapport (« Rapports disponibles ») -----------------------
  const pct = (a: number, t: number) => (t > 0 ? Math.round((a / t) * 100) : 0);
  const docBase = (title: string) => ({
    title, periodLabel, commerceName: commerce.name, commerceCity: commerce.city,
  });

  const docComplet = (d: ReportData): ReportDoc => {
    const totalModes = d.payment_modes.reduce((s, m) => s + m.amount, 0) || 1;
    return {
      ...docBase('Rapport complet'),
      kpis: [
        { label: "Chiffre d'affaires", value: money(d.total_sales) },
        { label: 'Tickets', value: num(d.tickets) },
        { label: 'Panier moyen', value: money(d.avg_ticket) },
        { label: 'Marge estimée', value: money(d.margin) },
      ],
      sections: [
        { title: 'Répartition des paiements', head: ['Mode', 'Montant', 'Part'],
          rows: d.payment_modes.map((m) => [m.mode_label, money(m.amount), `${pct(m.amount, totalModes)} %`]) },
        { title: 'Top produits', head: ['Produit', 'Qté', 'CA'],
          rows: d.top_products.map((p) => [p.product_name, num(p.qty), money(p.amount)]) },
        { title: 'Ventes par catégorie', head: ['Catégorie', 'CA'],
          rows: d.categories.map((c) => [c.mode_label, money(c.amount)]) },
      ],
    };
  };

  const docVentes = (d: ReportData): ReportDoc => ({
    ...docBase('Rapport des ventes'),
    kpis: [
      { label: "Chiffre d'affaires", value: money(d.total_sales) },
      { label: 'Tickets', value: num(d.tickets) },
      { label: 'Panier moyen', value: money(d.avg_ticket) },
    ],
    sections: [
      { title: 'Ventes par jour', head: ['Date', 'CA net'],
        rows: d.series.map((p) => [p.date, money(p.amount)]) },
      { title: 'Top produits', head: ['Produit', 'Qté', 'CA'],
        rows: d.top_products.map((p) => [p.product_name, num(p.qty), money(p.amount)]) },
    ],
  });

  // Sections réutilisables nécessitant un chargement (caisse, stock).
  const caisseSection = async (): Promise<ReportSection> => {
    const r = periodRange(period, from, to);
    const sessions = await api.cash.listSessions({ from: r.from, to: r.to, offset: 0, limit: 10000 }).catch(() => []);
    return {
      title: 'Caisse & mouvements', head: ['Session', 'Vendeur', 'Statut', 'Attendu', 'Compté', 'Écart'],
      align: ['l', 'l', 'l', 'r', 'r', 'r'],
      rows: sessions.map((s) => [
        s.session_ref, s.seller_name, s.status,
        s.cash_expected != null ? money(s.cash_expected) : '—',
        s.counted_cash != null ? money(s.counted_cash) : '—',
        s.gap != null ? money(s.gap) : '—',
      ]),
    };
  };
  const stockSection = async (): Promise<ReportSection> => {
    const products = await api.catalog.listProducts().catch(() => []);
    const low = products.filter((p) => p.stock_min > 0 && p.stock <= p.stock_min);
    return {
      title: 'Stock critique', head: ['Produit', 'Stock', 'Seuil', 'Coût', 'Valeur'],
      align: ['l', 'r', 'r', 'r', 'r'],
      rows: low.map((p) => [p.name, num(p.stock), num(p.stock_min), money(p.cost), money(p.stock * p.cost)]),
    };
  };

  const docCaisse = async (d: ReportData): Promise<ReportDoc> => ({
    ...docBase('Rapport de caisse'),
    kpis: [{ label: 'Caisse attendue', value: money(d.cash_expected) }],
    sections: [await caisseSection()],
  });
  const docStock = async (d: ReportData): Promise<ReportDoc> => ({
    ...docBase('Rapport de stock critique'),
    kpis: [
      { label: 'Produits sous seuil', value: num(d.low_stock_count) },
      { label: 'Valeur du stock', value: money(d.stock_value) },
    ],
    sections: [await stockSection()],
  });

  // Construit un rapport personnalisé à partir des blocs cochés.
  const buildCustomDoc = async (d: ReportData): Promise<ReportDoc> => {
    const has = (k: string) => customBlocks.has(k);
    const totalModes = d.payment_modes.reduce((s, m) => s + m.amount, 0) || 1;
    const kpis: ReportDoc['kpis'] = [];
    if (has('synthese')) kpis.push(
      { label: "Chiffre d'affaires", value: money(d.total_sales) },
      { label: 'Tickets', value: num(d.tickets) },
      { label: 'Panier moyen', value: money(d.avg_ticket) },
    );
    if (has('marge')) kpis.push({ label: 'Marge brute', value: money(d.margin) });
    if (has('achats')) kpis.push(
      { label: 'Achats', value: money(d.purchases) },
      { label: 'Dette achats', value: money(d.purchases_due) },
    );
    const sections: ReportSection[] = [];
    if (has('paiements')) sections.push({
      title: 'Répartition des paiements', head: ['Mode', 'Montant', 'Part'],
      rows: d.payment_modes.map((m) => [m.mode_label, money(m.amount), `${pct(m.amount, totalModes)} %`]),
    });
    if (has('top')) sections.push({
      title: 'Top produits', head: ['Produit', 'Qté', 'CA'],
      rows: d.top_products.map((p) => [p.product_name, num(p.qty), money(p.amount)]),
    });
    if (has('categories')) sections.push({
      title: 'Ventes par catégorie', head: ['Catégorie', 'CA'],
      rows: d.categories.map((c) => [c.mode_label, money(c.amount)]),
    });
    if (has('caisse')) sections.push(await caisseSection());
    if (has('stock')) sections.push(await stockSection());
    return {
      ...docBase(customName.trim() || 'Rapport personnalisé'),
      kpis, sections,
    };
  };

  // Export CSV d'un document (pour le format CSV du rapport personnalisé).
  const docToCsv = (doc: ReportDoc) => {
    const lines: string[] = [`${doc.title};${doc.periodLabel}`, ''];
    if (doc.kpis.length) {
      lines.push('Indicateur;Valeur');
      doc.kpis.forEach((k) => lines.push(`${csvCell(k.label)};${csvCell(k.value)}`));
      lines.push('');
    }
    doc.sections.forEach((s) => {
      lines.push(s.head.map(csvCell).join(';'));
      s.rows.forEach((r) => lines.push(r.map(csvCell).join(';')));
      lines.push('');
    });
    saveCsv(`${doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp()}.csv`, lines);
  };

  const runCustom = async () => {
    if (customBlocks.size === 0) return;
    setCustomBusy(true);
    try {
      const d = await api.reports.getReport({ period: 'custom', from, to });
      const doc = await buildCustomDoc(d);
      if (customFormat === 'csv') docToCsv(doc);
      else setPreview(doc); // PDF/HTML : aperçu (impression + export HTML)
    } finally { setCustomBusy(false); }
  };

  const openReport = async (id: string, build: (d: ReportData) => ReportDoc | Promise<ReportDoc>) => {
    if (!data) return;
    setBusyReport(id);
    try { setPreview(await build(data)); } finally { setBusyReport(null); }
  };

  const reports = data ? [
    { id: 'complet', name: 'Rapport complet', type: 'Complet', icon: 'reports', build: docComplet },
    { id: 'ventes', name: 'Ventes par jour & top produits', type: 'Ventes', icon: 'sales', build: docVentes },
    { id: 'caisse', name: 'Caisse et mouvements', type: 'Caisse', icon: 'cash', build: docCaisse },
    { id: 'stock', name: 'Stock critique et inventaire', type: 'Stock', icon: 'box', build: docStock },
  ] : [];

  // --- Résumé rapide --------------------------------------------------------
  const bestDay = data && data.series.length
    ? data.series.reduce((b, p) => (p.amount > b.amount ? p : b), data.series[0]) : null;
  const fmtDay = (d: string) => { try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); } catch { return d; } };
  const marginPct = data && data.total_sales > 0 ? Math.round((data.margin / data.total_sales) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* En-tête + période */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Rapports</h2>
          <div style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>Analyse des ventes, de la caisse, du stock, des achats et de l'inventaire.</div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PERIODS.map((p) => (
            <button key={p.id} className="cr-btn cr-btn-ghost"
              style={{ height: 32, padding: '0 14px', fontSize: 13,
                background: period === p.id ? 'var(--cr-accent-lt)' : undefined,
                color: period === p.id ? 'var(--cr-accent)' : undefined }}
              onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>

      {period === 'custom' && (
        <div className="cr-card" style={{ maxWidth: 720 }}>
          <div style={{ textTransform: 'uppercase', letterSpacing: '.5px', fontSize: 11, color: 'var(--cr-accent)', fontWeight: 600 }}>Nouveau rapport personnalisé</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{customName.trim() || 'Rapport sans nom'}</div>
          <div style={{ fontSize: 13, color: 'var(--cr-ink-3)', marginBottom: 16 }}>Choisissez la période et le contenu.</div>

          <label className="cr-label">Nom du rapport</label>
          <input className="cr-input" placeholder="Ex. Bilan mensuel — direction" value={customName}
            onChange={(e) => setCustomName(e.target.value)} style={{ marginBottom: 16 }} />

          <label className="cr-label">Période</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16 }}>
            <input className="cr-input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ height: 34, fontSize: 13, width: 160 }} />
            <span style={{ color: 'var(--cr-ink-3)' }}>→</span>
            <input className="cr-input" type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} style={{ height: 34, fontSize: 13, width: 160 }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <label className="cr-label" style={{ margin: 0 }}>Contenu</label>
            <span style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{customBlocks.size} / {REPORT_BLOCKS.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {REPORT_BLOCKS.map((b) => {
              const on = customBlocks.has(b.key);
              return (
                <button key={b.key} onClick={() => toggleBlock(b.key)} className="cr-card"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
                    borderColor: on ? 'var(--cr-accent)' : undefined, background: on ? 'var(--cr-accent-lt)' : undefined }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${on ? 'var(--cr-accent)' : 'var(--cr-border)'}`,
                    background: on ? 'var(--cr-accent)' : '#fff', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <Icon name="check" size={12} />}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{b.label}</span>
                </button>
              );
            })}
          </div>

          <label className="cr-label">Format de sortie</label>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--cr-bg)', borderRadius: 8, padding: 4, width: 'fit-content' }}>
            {(['pdf', 'html', 'csv'] as OutFormat[]).map((f) => (
              <button key={f} onClick={() => setCustomFormat(f)} className="cr-btn cr-btn-ghost"
                style={{ height: 30, padding: '0 20px', fontSize: 13, textTransform: 'uppercase',
                  background: customFormat === f ? 'var(--cr-surface)' : 'transparent',
                  color: customFormat === f ? 'var(--cr-accent)' : 'var(--cr-ink-3)',
                  fontWeight: customFormat === f ? 600 : 400 }}>{f}</button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--cr-border)', paddingTop: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{customBlocks.size} bloc(s) · {from} → {to} · {customFormat.toUpperCase()}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="cr-btn cr-btn-secondary" onClick={() => setPeriod('30d')}>Annuler</button>
              <button className="cr-btn cr-btn-primary" disabled={customBusy || customBlocks.size === 0} onClick={runCustom}>
                {customBusy ? <span className="spinner" /> : customFormat === 'csv'
                  ? <><Icon name="download" size={14} /> Télécharger CSV</>
                  : <><Icon name="printer" size={14} /> Aperçu avant impression</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {period !== 'custom' && (loading || !data ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240 }}><span className="spinner" /></div>
      ) : (
        <>
          {/* KPI enrichis */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { label: "Chiffre d'affaires", value: money(data.total_sales), sub: `${num(data.tickets)} tickets`, icon: 'sales', tone: 'good' },
              { label: 'Marge estimée', value: money(data.margin), sub: `${marginPct} % du CA`, icon: 'reports', tone: 'good' },
              { label: 'Panier moyen', value: money(data.avg_ticket), sub: 'par ticket', icon: 'pos' },
              { label: 'Achats', value: moneyShort(data.purchases), sub: `${moneyShort(data.purchases_due)} dette`, icon: 'purchases', tone: 'danger' },
              { label: 'Stock critique', value: `${num(data.low_stock_count)} produits`, sub: `${moneyShort(data.stock_value)} valeur`, icon: 'box', tone: data.low_stock_count > 0 ? 'warn' : undefined },
            ].map((k) => (
              <div key={k.label} className="cr-card" style={{ flex: 1, minWidth: 170 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--cr-accent-lt)', color: 'var(--cr-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={k.icon} size={14} />
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{k.label}</span>
                </div>
                <div className="mono" style={{ fontSize: 19, fontWeight: 700,
                  color: k.tone === 'good' ? 'var(--cr-good)' : k.tone === 'danger' ? 'var(--cr-danger)' : k.tone === 'warn' ? 'var(--cr-warn)' : 'var(--cr-ink-1)' }}>{k.value}</div>
                <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)', marginTop: 2 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Barre d'actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>Rapport · <b style={{ color: 'var(--cr-ink-1)' }}>{periodLabel}</b></span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="cr-btn cr-btn-secondary" onClick={() => exportReportCsv(data, periodLabel)}>
                <Icon name="download" size={14} /> CSV
              </button>
              <button className="cr-btn cr-btn-secondary" onClick={() => setPreview(docComplet(data))}>
                <Icon name="printer" size={14} /> Imprimer / PDF
              </button>
            </div>
          </div>

          {/* Évolution CA + modes de paiement */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div className="cr-card" style={{ flex: 2, minWidth: 360 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <div className="cr-card-title">Évolution du chiffre d'affaires</div>
                <span className="mono" style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{periodLabel}</span>
              </div>
              <AreaChart points={data.series} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}><span style={{ color: 'var(--cr-accent)' }}>●</span> CA net</span>
                <span className="mono" style={{ fontWeight: 700 }}>{money(data.total_sales)}</span>
              </div>
            </div>
            <div className="cr-card" style={{ flex: 1, minWidth: 300 }}>
              <div className="cr-card-title" style={{ marginBottom: 16 }}>Modes de paiement</div>
              <Donut data={data.payment_modes.map((m) => ({ label: m.mode_label, amount: m.amount }))} />
            </div>
          </div>

          {/* Top produits + catégories */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="cr-card" style={{ flex: 2, minWidth: 360 }}>
              <div className="cr-card-title" style={{ marginBottom: 12 }}>Top produits <span style={{ fontWeight: 400, color: 'var(--cr-ink-3)', fontSize: 12 }}>· par CA</span></div>
              <TopProductsBars items={data.top_products.slice(0, 5)} />
            </div>
            <div className="cr-card" style={{ flex: 1, minWidth: 300 }}>
              <div className="cr-card-title" style={{ marginBottom: 4 }}>Ventes par catégorie</div>
              <CategoryBars items={data.categories} />
            </div>
          </div>

          {/* Rapports disponibles + résumé rapide */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="cr-card" style={{ flex: 2, minWidth: 360 }}>
              <div className="cr-card-title" style={{ marginBottom: 12 }}>Rapports disponibles</div>
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th style={{ width: 90 }}>Type</th>
                    <th style={{ width: 110 }}>Période</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="stock-row" style={{ cursor: 'default' }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Icon name={r.icon} size={15} /> <span style={{ fontWeight: 500 }}>{r.name}</span>
                        </div>
                      </td>
                      <td><span className="badge badge-neutral">{r.type}</span></td>
                      <td style={{ color: 'var(--cr-ink-3)', fontSize: 12.5 }}>{periodLabel}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="cr-btn cr-btn-secondary" style={{ height: 28, fontSize: 12 }}
                          disabled={busyReport === r.id} onClick={() => openReport(r.id, r.build)}>
                          {busyReport === r.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <><Icon name="reports" size={12} /> Ouvrir</>}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cr-card" style={{ flex: 1, minWidth: 300 }}>
              <div className="cr-card-title" style={{ marginBottom: 12 }}>Résumé rapide</div>
              {[
                { ic: 'sales', label: 'Meilleure journée', main: bestDay ? fmtDay(bestDay.date) : '—', val: bestDay ? moneyShort(bestDay.amount) : '—' },
                { ic: 'box', label: 'Produit le plus vendu', main: data.top_qty?.product_name ?? '—', val: data.top_qty ? `${num(data.top_qty.qty)} u.` : '—' },
                { ic: 'cash', label: 'Caisse attendue', main: 'Sessions ouvertes', val: moneyShort(data.cash_expected) },
                { ic: 'purchases', label: 'Achats période', main: `${moneyShort(data.purchases_due)} dette`, val: moneyShort(data.purchases) },
                { ic: 'box', label: 'Stock critique', main: `${num(data.low_stock_count)} produit(s)`, val: moneyShort(data.stock_value) },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < 4 ? '1px solid var(--cr-border)' : 'none' }}>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--cr-bg)', color: 'var(--cr-ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name={r.ic} size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{r.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.main}</div>
                  </div>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>

        </>
      ))}

      {preview && <ReportPreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
