import { Icon } from './icons/Icons';

// Document de rapport générique : en-tête + KPI + sections tabulaires.
export interface ReportKpi { label: string; value: string; }
export interface ReportSection {
  title: string;
  head: string[];
  rows: (string | number)[][];
  align?: ('l' | 'r')[]; // par défaut : 1re colonne à gauche, le reste à droite
}
export interface ReportDoc {
  title: string;
  periodLabel: string;
  commerceName: string;
  commerceCity?: string;
  contact?: string;
  kpis: ReportKpi[];
  sections: ReportSection[];
}

const colClass = (s: ReportSection, i: number) =>
  (s.align ? (s.align[i] === 'r' ? 'r' : '') : (i === 0 ? '' : 'r'));

function editedAt(): string {
  return new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// --- Export HTML autonome ---------------------------------------------------
function esc(v: string | number): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function docToHtml(doc: ReportDoc): string {
  const kpis = doc.kpis.map((k) =>
    `<div class="kpi"><em>${esc(k.label)}</em><b>${esc(k.value)}</b></div>`).join('');
  const sections = doc.sections.map((s) => {
    const head = s.head.map((h, i) => `<th class="${colClass(s, i)}">${esc(h)}</th>`).join('');
    const body = s.rows.length === 0
      ? `<tr><td colspan="${s.head.length}">Aucune donnée.</td></tr>`
      : s.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${colClass(s, i)}">${esc(c)}</td>`).join('')}</tr>`).join('');
    return `<section><h3>${esc(s.title)}</h3><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
  }).join('');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(doc.title)} — ${esc(doc.commerceName)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color:#1a1d21; margin:0; padding:28px 34px; font-size:12px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #23262b; padding-bottom:12px; margin-bottom:16px; }
  .title { font-size:18px; font-weight:700; } .sub { font-size:11px; color:#5f6469; }
  .kpis { display:flex; gap:10px; margin-bottom:18px; }
  .kpi { flex:1; border:1px solid #e2e5e9; border-radius:8px; padding:10px 12px; }
  .kpi em { font-style:normal; font-size:10px; color:#5f6469; display:block; margin-bottom:3px; }
  .kpi b { font-size:15px; }
  h3 { color:#d2592f; font-size:11px; letter-spacing:.5px; text-transform:uppercase; margin:18px 0 8px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:#5f6469; border-bottom:1px solid #e2e5e9; padding:6px 4px; }
  td { padding:6px 4px; border-bottom:1px solid #f0f1f3; }
  th.r, td.r { text-align:right; }
  .foot { margin-top:24px; padding-top:12px; border-top:1px solid #e2e5e9; display:flex; justify-content:space-between; font-size:10px; color:#5f6469; }
</style></head><body>
<div class="head">
  <div><div class="title">${esc(doc.commerceName)}</div>${doc.commerceCity ? `<div class="sub">${esc(doc.commerceCity)}</div>` : ''}</div>
  <div style="text-align:right"><div style="font-weight:600">${esc(doc.title)}</div><div class="sub">Période · ${esc(doc.periodLabel)} · édité le ${editedAt()}</div></div>
</div>
<div class="kpis">${kpis}</div>
${sections}
<div class="foot"><span>${esc(doc.commerceName)}${doc.contact ? ' · ' + esc(doc.contact) : ''}</span><span>KOMERSA · document généré automatiquement</span></div>
</body></html>`;
}

function exportHtml(doc: ReportDoc) {
  const blob = new Blob([docToHtml(doc)], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
export function ReportPreviewModal({ doc, onClose }: { doc: ReportDoc; onClose: () => void }) {
  return (
    <div className="report-preview-overlay">
      <div className="report-preview-bar">
        <span className="title"><Icon name="reports" size={16} /> Rapport · aperçu avant impression</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="cr-btn cr-btn-secondary" onClick={onClose}>
            <Icon name="x" size={14} /> Fermer
          </button>
          <button className="cr-btn cr-btn-secondary" onClick={() => exportHtml(doc)}>
            <Icon name="download" size={14} /> Exporter HTML
          </button>
          <button className="cr-btn cr-btn-primary" onClick={() => window.print()}>
            <Icon name="printer" size={14} /> Imprimer / PDF
          </button>
        </div>
      </div>

      <div className="report-preview-scroll">
        <div className="report-sheet">
          <div className="rs-head">
            <div>
              <div className="rs-title">{doc.commerceName}</div>
              {doc.commerceCity && <div className="rs-sub">{doc.commerceCity}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{doc.title}</div>
              <div className="rs-sub">Période · {doc.periodLabel} · édité le {editedAt()}</div>
            </div>
          </div>

          <div className="rs-kpis">
            {doc.kpis.map((k, i) => (
              <div key={i} className="rs-kpi"><em>{k.label}</em><b>{k.value}</b></div>
            ))}
          </div>

          {doc.sections.map((s, si) => (
            <section key={si}>
              <h3>{s.title}</h3>
              <table>
                <thead><tr>{s.head.map((h, i) => <th key={i} className={colClass(s, i)}>{h}</th>)}</tr></thead>
                <tbody>
                  {s.rows.length === 0 ? (
                    <tr><td colSpan={s.head.length}>Aucune donnée.</td></tr>
                  ) : s.rows.map((r, ri) => (
                    <tr key={ri}>{r.map((c, i) => <td key={i} className={colClass(s, i)}>{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}

          <div className="rs-foot">
            <span>{doc.commerceName}{doc.contact ? ` · ${doc.contact}` : ''}</span>
            <span>KOMERSA · document généré automatiquement</span>
          </div>
        </div>
      </div>
    </div>
  );
}
