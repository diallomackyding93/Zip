import { useState, useEffect, useCallback, useId } from 'react';
import { api } from '../lib/api';
import { num } from '../lib/format';
import { Icon } from '../components/icons/Icons';
import { PhotoSlot } from '../components/PhotoSlot';
import type {
  InventorySessionRow, InventoryCountRow, CreateInventorySessionInput, CategoryRow,
} from '../lib/types';

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

// ---------------------------------------------------------------------------
// Formulaire nouvelle session (drawer)
// ---------------------------------------------------------------------------
function SessionForm({ categories, onSave, onClose }: {
  categories: CategoryRow[];
  onSave: (input: CreateInventorySessionInput) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<'all' | 'category' | 'alert'>('all');
  const [scopeValue, setScopeValue] = useState(categories[0]?.name ?? '');
  const [blindCount, setBlindCount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim()) { setError('L\'intitulé est requis.'); return; }
    setError(null); setBusy(true);
    try {
      await onSave({ title: title.trim(), scope,
        scope_value: scope === 'category' ? scopeValue : undefined, blind_count: blindCount });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="form-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="form-drawer" style={{ width: 460 }}>
        <div className="form-drawer-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>Nouvelle session d'inventaire</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="form-drawer-body">
          <div className="cr-field">
            <label className="cr-label" htmlFor={`${uid}-t`}>Intitulé *</label>
            <input id={`${uid}-t`} className="cr-input" value={title}
              onChange={(e) => setTitle(e.target.value)} placeholder="Ex : Inventaire général — juin" autoFocus />
          </div>
          <div className="cr-field">
            <label className="cr-label">Périmètre</label>
            <div className="auth-tabs">
              <button className={`auth-tab${scope === 'all' ? ' active' : ''}`} onClick={() => setScope('all')}>Tout le stock</button>
              <button className={`auth-tab${scope === 'category' ? ' active' : ''}`} onClick={() => setScope('category')}>Par catégorie</button>
              <button className={`auth-tab${scope === 'alert' ? ' active' : ''}`} onClick={() => setScope('alert')}>Sous le seuil</button>
            </div>
          </div>
          {scope === 'category' && (
            <div className="cr-field">
              <label className="cr-label">Catégorie</label>
              <select className="cr-input" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}
          <label className="module-toggle" onClick={() => setBlindCount((v) => !v)}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>Comptage à l'aveugle</div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
                Masquer le stock théorique pendant le comptage
              </div>
            </div>
            <div className={`toggle-switch${blindCount ? ' on' : ''}`} />
          </label>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="form-drawer-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Démarrer la session'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vue de comptage d'une session
// ---------------------------------------------------------------------------
function CountingView({ session, blindCount, onBack, onClose }: {
  session: InventorySessionRow;
  blindCount: boolean;
  onBack: () => void;
  onClose: (sessionId: string) => Promise<void>;
}) {
  const [counts, setCounts] = useState<InventoryCountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setCounts(await api.inventory.listCounts(session.id)); }
    finally { setLoading(false); }
  }, [session.id]);
  useEffect(() => { load(); }, [load]);

  const saveCount = async (countId: string, value: string) => {
    if (value === '') return;
    const qty = Number(value);
    const variance = await api.inventory.saveCount({ count_id: countId, counted_qty: qty });
    setCounts((prev) => prev.map((c) => c.id === countId
      ? { ...c, counted_qty: qty, variance } : c));
  };

  const countedCount = counts.filter((c) => c.counted_qty != null).length;
  const varianceCount = counts.filter((c) => c.variance != null && c.variance !== 0).length;
  const isClosed = session.status === 'closed';

  const filtered = counts.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.product_name.toLowerCase().includes(q) || c.product_code.toLowerCase().includes(q);
  });

  const handleClose = async () => {
    if (!confirm(`Clôturer l'inventaire ? Le stock sera ajusté pour ${countedCount} produit(s) compté(s).`)) return;
    setClosing(true);
    try { await onClose(session.id); } finally { setClosing(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Header */}
      <div className="cr-card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button className="cr-btn cr-btn-ghost" onClick={onBack} style={{ padding: '0 8px' }}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{session.title}</div>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
            {session.responsible_name} · {formatDate(session.created_at)}
            {blindCount && ' · Comptage à l\'aveugle'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{countedCount}/{counts.length}</div>
            <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>Comptés</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: varianceCount > 0 ? 'var(--cr-warn)' : 'var(--cr-good)' }}>
              {varianceCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>Écarts</div>
          </div>
          {!isClosed && (
            <button className="cr-btn cr-btn-primary" onClick={handleClose}
              disabled={closing || countedCount === 0}>
              {closing ? <span className="spinner" style={{ borderTopColor: '#fff' }} />
                : <><Icon name="check" size={14} /> Clôturer & ajuster</>}
            </button>
          )}
          {isClosed && <span className="badge badge-good">Clôturé</span>}
        </div>
      </div>

      {/* Recherche */}
      <div className="cr-input-wrap" style={{ width: 240 }}>
        <Icon name="search" size={14} className="cr-input-icon" />
        <input className="cr-input" style={{ height: 32, fontSize: 13 }} placeholder="Rechercher un produit…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Table de comptage */}
      <div className="cr-card" style={{ flex: 1, padding: 0, overflow: 'auto', minHeight: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th>Produit</th>
                {!blindCount && <th style={{ textAlign: 'right' }}>Stock théorique</th>}
                <th style={{ textAlign: 'center' }}>Compté</th>
                <th style={{ textAlign: 'right' }}>Écart</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const hasVariance = c.variance != null && c.variance !== 0;
                return (
                  <tr key={c.id} className="stock-row" style={{ cursor: 'default' }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PhotoSlot entityType="product" entityId={c.product_id} fallbackIcon="box" size={30} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>
                            {c.product_name}
                            {c.variant_value && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{c.variant_value}</span>}
                          </div>
                          <div className="mono" style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{c.product_code}</div>
                        </div>
                      </div>
                    </td>
                    {!blindCount && (
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--cr-ink-2)' }}>
                        {c.system_qty != null ? num(c.system_qty) : '—'}
                      </td>
                    )}
                    <td style={{ textAlign: 'center' }}>
                      <input
                        className="cr-input mono"
                        type="number" min="0"
                        style={{ width: 90, height: 32, textAlign: 'center', fontSize: 13 }}
                        defaultValue={c.counted_qty ?? ''}
                        placeholder="—"
                        disabled={isClosed}
                        onBlur={(e) => saveCount(c.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      />
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600,
                      color: c.variance == null ? 'var(--cr-ink-3)'
                        : hasVariance ? (c.variance > 0 ? 'var(--cr-good)' : 'var(--cr-danger)')
                        : 'var(--cr-good)' }}>
                      {c.variance == null ? '—'
                        : c.variance === 0 ? '✓'
                        : `${c.variance > 0 ? '+' : ''}${num(c.variance)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Inventaire
// ---------------------------------------------------------------------------
export function InventoryView() {
  const [sessions, setSessions] = useState<InventorySessionRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [activeSession, setActiveSession] = useState<InventorySessionRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([api.inventory.listSessions(), api.catalog.listCategories()]);
      setSessions(s); setCategories(c);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (input: CreateInventorySessionInput) => {
    const s = await api.inventory.createSession(input);
    setSessions((prev) => [s, ...prev]);
    setShowForm(false);
    setActiveSession(s);
  };

  const handleClose = async (sessionId: string) => {
    await api.inventory.closeSession(sessionId);
    await load();
    setActiveSession(null);
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  // Vue de comptage
  if (activeSession) {
    return (
      <CountingView
        session={activeSession}
        blindCount={activeSession.blind_count}
        onBack={() => { setActiveSession(null); load(); }}
        onClose={handleClose}
      />
    );
  }

  const openSessions = sessions.filter((s) => s.status === 'open');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="cr-card" style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>Sessions ouvertes</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: openSessions.length > 0 ? 'var(--cr-warn)' : 'var(--cr-ink-1)' }}>{num(openSessions.length)}</div>
        </div>
        <div className="cr-card" style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>Sessions totales</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{num(sessions.length)}</div>
        </div>
        <div className="cr-card" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <button className="cr-btn cr-btn-primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={14} /> Nouvelle session
          </button>
        </div>
      </div>

      <div className="cr-card" style={{ flex: 1, padding: 0, overflow: 'auto' }}>
        {sessions.length === 0 ? (
          <div className="screen-placeholder" style={{ height: 200 }}>
            <Icon name="inventory" size={32} /><p>Aucune session d'inventaire. Créez-en une pour commencer le comptage.</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th>Session</th><th>Périmètre</th><th>Responsable</th><th>Date</th>
                <th style={{ textAlign: 'center' }}>Progression</th>
                <th style={{ textAlign: 'center' }}>Écarts</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="stock-row" onClick={() => setActiveSession(s)}>
                  <td style={{ fontWeight: 500 }}>{s.title}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>
                    {s.scope === 'all' ? 'Tout le stock'
                      : s.scope === 'category' ? `Cat. ${s.scope_value}`
                      : 'Sous le seuil'}
                    {s.blind_count && ' · aveugle'}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{s.responsible_name ?? '—'}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{formatDate(s.created_at)}</td>
                  <td className="mono" style={{ textAlign: 'center' }}>{s.counted_lines}/{s.total_lines}</td>
                  <td className="mono" style={{ textAlign: 'center', color: s.variances > 0 ? 'var(--cr-warn)' : 'var(--cr-ink-3)' }}>
                    {s.variances > 0 ? s.variances : '—'}
                  </td>
                  <td>
                    <span className={`badge badge-${s.status === 'open' ? 'warn' : 'good'}`}>
                      {s.status === 'open' ? 'En cours' : 'Terminé'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <SessionForm categories={categories} onSave={handleCreate} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}
