import { Icon } from './icons/Icons';

// Barre réutilisable : filtre par dates (Du / Au) + Appliquer + Tout + Export CSV.
// Le parent gère le chargement ; ce composant ne fait que l'UI.
export function HistoryFilter({ from, to, setFrom, setTo, onApply, onReset, onExport, loading, exporting }: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  onApply: () => void;
  onReset: () => void;
  onExport: () => void;
  loading?: boolean;
  exporting?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="cr-field" style={{ margin: 0 }}>
        <label className="cr-label" style={{ fontSize: 11 }}>Du</label>
        <input className="cr-input" type="date" value={from} max={to || undefined}
          onChange={(e) => setFrom(e.target.value)} style={{ height: 32, fontSize: 12.5, width: 140 }} />
      </div>
      <div className="cr-field" style={{ margin: 0 }}>
        <label className="cr-label" style={{ fontSize: 11 }}>Au</label>
        <input className="cr-input" type="date" value={to} min={from || undefined}
          onChange={(e) => setTo(e.target.value)} style={{ height: 32, fontSize: 12.5, width: 140 }} />
      </div>
      <button className="cr-btn cr-btn-secondary" style={{ height: 32 }} onClick={onApply} disabled={loading}>Appliquer</button>
      {(from || to) && (
        <button className="cr-btn cr-btn-ghost" style={{ height: 32 }} onClick={onReset}>Tout</button>
      )}
      <button className="cr-btn cr-btn-secondary" style={{ height: 32 }} onClick={onExport} disabled={exporting}>
        <Icon name="download" size={13} /> CSV
      </button>
    </div>
  );
}
