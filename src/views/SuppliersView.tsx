import { useState, useEffect, useCallback, useId } from 'react';
import { api } from '../lib/api';
import { money, moneyShort, num } from '../lib/format';
import { Icon } from '../components/icons/Icons';
import { PhotoSlot, PhotoStore } from '../components/PhotoSlot';
import type { SupplierFull, CreateSupplierInput, UpdateSupplierInput, PhotoDraft, PurchaseRow } from '../lib/types';

const STATUS_TONES: Record<string, string> = { Clé: 'warn', Actif: 'good', Inactif: 'neutral' };
const CATEGORIES = ['Pagnes', 'Bazins', 'Dentelles', 'Accessoires', 'Voiles', 'Divers'];

function formatDate(iso?: string) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

// ---------------------------------------------------------------------------
// Formulaire fournisseur (drawer) — avec photo en brouillon
// ---------------------------------------------------------------------------
function SupplierForm({ supplier, onSave, onClose }: {
  supplier: SupplierFull | null;
  onSave: (input: CreateSupplierInput | UpdateSupplierInput, photo?: PhotoDraft) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const isEdit = supplier !== null;
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [city, setCity] = useState(supplier?.city ?? '');
  const [category, setCategory] = useState(supplier?.category ?? '');
  const [note, setNote] = useState(supplier?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoDirty, setPhotoDirty] = useState(false);
  useEffect(() => { if (supplier) api.photos.get('supplier', supplier.id).then(setPhoto).catch(() => {}); }, [supplier]);

  const handleSave = async () => {
    if (!name.trim()) { setError('Le nom est requis.'); return; }
    setError(null); setBusy(true);
    try {
      const photoArg = { dataUrl: photo, dirty: photoDirty };
      if (isEdit && supplier) {
        await onSave({ id: supplier.id, name: name.trim(), phone: phone || undefined,
          email: email || undefined, city: city || undefined, category: category || undefined,
          note: note || undefined }, photoArg);
      } else {
        await onSave({ name: name.trim(), phone: phone || undefined, email: email || undefined,
          city: city || undefined, category: category || undefined, note: note || undefined }, photoArg);
      }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="form-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="form-drawer">
        <div className="form-drawer-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>{isEdit ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="form-drawer-body">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <PhotoSlot draft value={photo} onChange={(v) => { setPhoto(v); setPhotoDirty(true); }}
              name={name} shape="circle" size={64} editable />
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', lineHeight: 1.5 }}>
              Logo du fournisseur (optionnel)<br />Cliquer ou glisser une image.
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label" htmlFor={`${uid}-n`}>Nom *</label>
            <input id={`${uid}-n`} className="cr-input" value={name}
              onChange={(e) => setName(e.target.value)} placeholder="Ex : Wax CI" autoFocus />
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Téléphone</label>
              <input className="cr-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+224 …" />
            </div>
            <div className="cr-field">
              <label className="cr-label">E-mail</label>
              <input className="cr-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@…" />
            </div>
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Ville</label>
              <input className="cr-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex : Conakry · Madina" />
            </div>
            <div className="cr-field">
              <label className="cr-label">Catégorie</label>
              <input className="cr-input" list={`${uid}-cat`} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Choisir ou créer…" />
              <datalist id={`${uid}-cat`}>{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label">Note</label>
            <input className="cr-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optionnel" />
          </div>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="form-drawer-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : isEdit ? 'Enregistrer' : 'Créer le fournisseur'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Volet détail fournisseur
// ---------------------------------------------------------------------------
function SupplierDetail({ supplier, purchases, onEdit, onClose }: {
  supplier: SupplierFull;
  purchases: PurchaseRow[];
  onEdit: () => void;
  onClose: () => void;
}) {
  const recent = purchases.filter((p) => p.supplier_id === supplier.id).slice(0, 6);
  return (
    <div className="stock-detail" style={{ width: 300 }}>
      <div className="stock-detail-head">
        <PhotoSlot entityType="supplier" entityId={supplier.id} name={supplier.name} shape="circle" size={44} editable />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{supplier.name}</div>
          <span className={`badge badge-${STATUS_TONES[supplier.status] ?? 'neutral'}`}>{supplier.status}</span>
        </div>
        <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="stock-detail-body" style={{ padding: '12px 16px' }}>
        <table className="detail-table">
          <tbody>
            <tr><td>Téléphone</td><td>{supplier.phone ?? '—'}</td></tr>
            <tr><td>E-mail</td><td>{supplier.email ?? '—'}</td></tr>
            <tr><td>Ville</td><td>{supplier.city ?? '—'}</td></tr>
            <tr><td>Catégorie</td><td>{supplier.category ?? '—'}</td></tr>
            <tr><td>Achats cumulés</td><td className="mono">{money(supplier.total_purchases)}</td></tr>
            <tr><td>Commandes</td><td className="mono">{num(supplier.orders_count)}</td></tr>
            <tr><td>Solde dû</td><td className="mono" style={{ color: supplier.balance_due > 0 ? 'var(--cr-danger)' : 'var(--cr-good)' }}>{money(supplier.balance_due)}</td></tr>
            <tr><td>Dernière commande</td><td style={{ fontSize: 12 }}>{formatDate(supplier.last_order)}</td></tr>
            {supplier.note && <tr><td>Note</td><td style={{ fontSize: 12 }}>{supplier.note}</td></tr>}
          </tbody>
        </table>

        {recent.length > 0 && (
          <>
            <div style={{ marginTop: 14, fontSize: 11.5, fontWeight: 600, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
              Commandes récentes
            </div>
            {recent.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                <div>
                  <span className="mono">{p.purchase_ref}</span>
                  <div style={{ color: 'var(--cr-ink-3)', fontSize: 11 }}>{p.state} · {formatDate(p.ordered_at)}</div>
                </div>
                <span className="mono">{moneyShort(p.amount)} GNF</span>
              </div>
            ))}
          </>
        )}

        <button className="cr-btn cr-btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={onEdit}>
          <Icon name="edit" size={14} /> Modifier
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Fournisseurs
// ---------------------------------------------------------------------------
export function SuppliersView() {
  const [suppliers, setSuppliers] = useState<SupplierFull[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Tous');
  const [selected, setSelected] = useState<SupplierFull | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editSupplier, setEditSupplier] = useState<SupplierFull | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([api.catalog.listSuppliersFull(), api.purchases.list()]);
      setSuppliers(s); setPurchases(p);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const categories = Array.from(new Set(suppliers.map((s) => s.category).filter(Boolean))) as string[];
  const filtered = suppliers.filter((s) => {
    const matchCat = catFilter === 'Tous' || s.category === catFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || s.name.toLowerCase().includes(q)
      || (s.phone ?? '').includes(q) || (s.city ?? '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const totalDue = suppliers.reduce((s, x) => s + x.balance_due, 0);
  const totalPurchases = suppliers.reduce((s, x) => s + x.total_purchases, 0);

  const handleSave = async (input: CreateSupplierInput | UpdateSupplierInput, photo?: PhotoDraft) => {
    let savedId: string;
    if ('id' in input) {
      await api.catalog.updateSupplier(input as UpdateSupplierInput);
      savedId = (input as UpdateSupplierInput).id;
    } else {
      const created = await api.catalog.createSupplier(input as CreateSupplierInput);
      savedId = created.id;
    }
    if (photo?.dirty) {
      if (photo.dataUrl) await PhotoStore.set('supplier', savedId, photo.dataUrl);
      else await PhotoStore.clear('supplier', savedId);
    }
    setShowForm(false); setEditSupplier(null);
    await load();
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Fournisseurs', value: num(suppliers.length) },
          { label: 'Achats cumulés', value: money(totalPurchases) },
          { label: 'Dettes ouvertes', value: money(totalDue), tone: totalDue > 0 ? 'danger' : undefined },
          { label: 'Fournisseurs clés', value: num(suppliers.filter((s) => s.status === 'Clé').length) },
        ].map((k) => (
          <div key={k.label} className="cr-card" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: k.tone === 'danger' ? 'var(--cr-danger)' : 'var(--cr-ink-1)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['Tous', ...categories].map((c) => (
            <button key={c} className="cr-btn cr-btn-ghost"
              style={{ height: 30, padding: '0 12px', fontSize: 12.5,
                background: catFilter === c ? 'var(--cr-accent-lt)' : undefined,
                color: catFilter === c ? 'var(--cr-accent)' : undefined }}
              onClick={() => setCatFilter(c)}>{c}</button>
          ))}
        </div>
        <div className="cr-input-wrap" style={{ width: 200, marginLeft: 'auto' }}>
          <Icon name="search" size={14} className="cr-input-icon" />
          <input className="cr-input" style={{ height: 32, fontSize: 13 }} placeholder="Nom, ville, téléphone…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="cr-btn cr-btn-primary" onClick={() => { setEditSupplier(null); setShowForm(true); }}>
          <Icon name="plus" size={14} /> Nouveau fournisseur
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div className="cr-card" style={{ flex: 1, minWidth: 0, padding: 0, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="screen-placeholder" style={{ height: 200 }}>
              <Icon name="suppliers" size={32} /><p>Aucun fournisseur.</p>
            </div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Fournisseur</th><th>Catégorie</th><th>Téléphone</th>
                  <th style={{ textAlign: 'right' }}>Achats</th>
                  <th style={{ textAlign: 'right' }}>Solde dû</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className={`stock-row${selected?.id === s.id ? ' selected' : ''}`}
                    onClick={() => setSelected(selected?.id === s.id ? null : s)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PhotoSlot entityType="supplier" entityId={s.id} name={s.name} shape="circle" size={30} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{s.name}</div>
                          {s.city && <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{s.city}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{s.category ? <span className="badge badge-neutral">{s.category}</span> : '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{s.phone ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{moneyShort(s.total_purchases)} GNF</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600,
                      color: s.balance_due > 0 ? 'var(--cr-danger)' : 'var(--cr-ink-3)' }}>
                      {s.balance_due > 0 ? money(s.balance_due) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <SupplierDetail supplier={selected} purchases={purchases}
            onEdit={() => { setEditSupplier(selected); setShowForm(true); }}
            onClose={() => setSelected(null)} />
        )}
      </div>

      {showForm && (
        <SupplierForm supplier={editSupplier} onSave={handleSave} onClose={() => { setShowForm(false); setEditSupplier(null); }} />
      )}
    </div>
  );
}
