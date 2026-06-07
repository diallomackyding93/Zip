import { money, num } from '../lib/format';
import type { ReportData } from '../lib/types';

interface ReportPrintProps {
  data: ReportData;
  periodLabel: string;
  commerceName: string;
  commerceCity?: string;
}

// Rapport A4 imprimable — rendu hors écran, visible seulement à l'impression.
export function ReportPrint({ data, periodLabel, commerceName, commerceCity }: ReportPrintProps) {
  const totalModes = data.payment_modes.reduce((s, m) => s + m.amount, 0) || 1;
  const totalCats = data.categories.reduce((s, c) => s + c.amount, 0) || 1;
  const now = new Date().toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="report-print">
      <div className="rpt-head">
        <div>
          <div className="rpt-title">{commerceName}</div>
          {commerceCity && <div className="rpt-sub">{commerceCity}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>Rapport — {periodLabel}</div>
          <div className="rpt-sub">Édité le {now}</div>
        </div>
      </div>

      <div className="rpt-metrics">
        <div className="rpt-metric"><em>Chiffre d'affaires</em><b>{money(data.total_sales)}</b></div>
        <div className="rpt-metric"><em>Tickets</em><b>{num(data.tickets)}</b></div>
        <div className="rpt-metric"><em>Marge brute</em><b>{money(data.margin)}</b></div>
        <div className="rpt-metric"><em>Panier moyen</em><b>{money(data.avg_ticket)}</b></div>
        <div className="rpt-metric"><em>Achats</em><b>{money(data.purchases)}</b></div>
      </div>

      <div className="rpt-section">
        <h3>Répartition par mode de paiement</h3>
        <table className="rpt-table">
          <thead><tr><th>Mode</th><th className="r">Montant</th><th className="r">Part</th></tr></thead>
          <tbody>
            {data.payment_modes.length === 0 ? (
              <tr><td colSpan={3}>Aucune donnée.</td></tr>
            ) : data.payment_modes.map((m, i) => (
              <tr key={i}>
                <td>{m.mode_label}</td>
                <td className="r">{money(m.amount)}</td>
                <td className="r">{Math.round((m.amount / totalModes) * 100)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rpt-section">
        <h3>Ventes par catégorie</h3>
        <table className="rpt-table">
          <thead><tr><th>Catégorie</th><th className="r">Montant</th><th className="r">Part</th></tr></thead>
          <tbody>
            {data.categories.length === 0 ? (
              <tr><td colSpan={3}>Aucune donnée.</td></tr>
            ) : data.categories.map((c, i) => (
              <tr key={i}>
                <td>{c.mode_label}</td>
                <td className="r">{money(c.amount)}</td>
                <td className="r">{Math.round((c.amount / totalCats) * 100)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rpt-section">
        <h3>Top produits</h3>
        <table className="rpt-table">
          <thead><tr><th>#</th><th>Produit</th><th className="r">Quantité</th><th className="r">Chiffre d'affaires</th></tr></thead>
          <tbody>
            {data.top_products.length === 0 ? (
              <tr><td colSpan={4}>Aucune vente sur la période.</td></tr>
            ) : data.top_products.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{p.product_name}</td>
                <td className="r">{num(p.qty)}</td>
                <td className="r">{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rpt-foot">Rapport généré par KOMERSA · {commerceName}</div>
    </div>
  );
}
