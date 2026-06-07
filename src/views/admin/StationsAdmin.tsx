import { useState, useEffect, useCallback, useId } from 'react';
import { api } from '../../lib/api';
import { Icon } from '../../components/icons/Icons';
import type { PosteRow, CreatePosteInput } from '../../lib/types';

const POSTE_TYPES = ['Caisse', 'Stock', 'Administration', 'Annexe'];

function PosteForm({ poste, onSave, onClose }: {
  poste: PosteRow | null;
  onSave: (input: CreatePosteInput, id?: string) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const isEdit = poste !== null;
  const [name, setName] = useState(poste?.name ?? '');
  const [posteType, setPosteType] = useState(poste?.poste_type ?? 'Caisse');
  const [os, setOs] = useState(poste?.os ?? '');
  const [scanner, setScanner] = useState(poste?.scanner ?? false);
  const [printer, setPrinter] = useState(poste?.printer ?? '');
  const [drawer, setDrawer] = useState(poste?.drawer ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) { setError('Le nom est requis.'); return; }
    setError(null); setBusy(true);
    try {
      await onSave({ name: name.trim(), poste_type: posteType, os: os.trim() || undefined,
        scanner, printer: printer.trim() || undefined, drawer }, poste?.id);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 420 }}>
        <div className="modal-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>{isEdit ? 'Modifier le poste' : 'Nouveau poste'}</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="cr-field">
            <label className="cr-label" htmlFor={`${uid}-n`}>Nom du poste *</label>
            <input id={`${uid}-n`} className="cr-input" value={name}
              onChange={(e) => setName(e.target.value)} placeholder="Ex : Caisse comptoir" autoFocus />
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Type</label>
              <select className="cr-input" value={posteType} onChange={(e) => setPosteType(e.target.value)}>
                {POSTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="cr-field">
              <label className="cr-label">Système</label>
              <input className="cr-input" value={os} onChange={(e) => setOs(e.target.value)}
                placeholder="Ex : Windows 11" />
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label">Imprimante</label>
            <input className="cr-input" value={printer} onChange={(e) => setPrinter(e.target.value)}
              placeholder="Ex : Thermique 80 mm (laisser vide si aucune)" />
          </div>
          <label className="setting-row" onClick={() => setScanner((v) => !v)}>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Scanner code-barres</div>
            <div className={`toggle-switch${scanner ? ' on' : ''}`} />
          </label>
          <label className="setting-row" onClick={() => setDrawer((v) => !v)}>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Tiroir-caisse</div>
            <div className={`toggle-switch${drawer ? ' on' : ''}`} />
          </label>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : isEdit ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StationsAdmin() {
  const [postes, setPostes] = useState<PosteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editPoste, setEditPoste] = useState<PosteRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPostes(await api.admin.listPostes()); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = async (input: CreatePosteInput, id?: string) => {
    if (id) {
      await api.admin.updatePoste({ id, ...input });
      setPostes((prev) => prev.map((p) => p.id === id ? { ...p, ...input } : p));
    } else {
      const p = await api.admin.createPoste(input);
      setPostes((prev) => [...prev, p]);
    }
    setShowForm(false); setEditPoste(null);
  };

  const handleDelete = async (p: PosteRow) => {
    if (!confirm(`Supprimer le poste « ${p.name} » ?`)) return;
    await api.admin.deletePoste(p.id);
    setPostes((prev) => prev.filter((x) => x.id !== p.id));
  };

  if (loading) return <div style={{ padding: 40 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Postes & terminaux</div>
          <div style={{ fontSize: 12.5, color: 'var(--cr-ink-3)' }}>
            Les périphériques sont liés au poste (machine), pas à l'utilisateur.
          </div>
        </div>
        <button className="cr-btn cr-btn-primary" onClick={() => { setEditPoste(null); setShowForm(true); }}>
          <Icon name="plus" size={14} /> Ajouter un poste
        </button>
      </div>

      {postes.length === 0 ? (
        <div className="cr-card" style={{ textAlign: 'center', padding: 32, color: 'var(--cr-ink-3)' }}>
          <Icon name="pos" size={32} style={{ margin: '0 auto 12px', opacity: .3 }} />
          <p>Aucun poste enregistré. Ce poste actuel peut être ajouté pour le suivi.</p>
        </div>
      ) : (
        postes.map((p) => (
          <div key={p.id} className="poste-card">
            <div style={{ width: 40, height: 40, background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cr-ink-2)' }}>
              <Icon name="pos" size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                <span className={`badge badge-${p.status === 'online' ? 'good' : 'neutral'}`}>
                  {p.status === 'online' ? 'En ligne' : 'Hors ligne'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>
                {p.poste_type ?? '—'}{p.os && ` · ${p.os}`}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className={`poste-device${p.scanner ? ' on' : ''}`}>
                  <Icon name="search" size={11} /> Scanner {p.scanner ? '✓' : '—'}
                </span>
                <span className={`poste-device${p.printer ? ' on' : ''}`}>
                  <Icon name="printer" size={11} /> {p.printer ?? 'Aucune imprimante'}
                </span>
                <span className={`poste-device${p.drawer ? ' on' : ''}`}>
                  <Icon name="cash" size={11} /> Tiroir {p.drawer ? '✓' : '—'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="topbar-btn" onClick={() => { setEditPoste(p); setShowForm(true); }} title="Modifier">
                <Icon name="edit" size={14} />
              </button>
              <button className="topbar-btn" onClick={() => handleDelete(p)} title="Supprimer"
                style={{ color: 'var(--cr-danger)' }}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        ))
      )}

      {showForm && <PosteForm poste={editPoste} onSave={handleSave} onClose={() => { setShowForm(false); setEditPoste(null); }} />}
    </div>
  );
}
