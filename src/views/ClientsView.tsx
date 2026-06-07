import { useState, useEffect, useCallback, useId } from 'react';
import { api } from '../lib/api';
import { money, moneyShort, num } from '../lib/format';
import { Icon } from '../components/icons/Icons';
import { PhotoSlot, PhotoStore } from '../components/PhotoSlot';
import type { ClientFull, CreateClientInput, UpdateClientInput, PhotoDraft } from '../lib/types';

const GROUP_TONES: Record<string, string> = { VIP: 'warn', Nouveau: 'info', Régulier: 'neutral' };

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

// ---------------------------------------------------------------------------
// Formulaire client (drawer)
// ---------------------------------------------------------------------------
function ClientForm({ client, onSave, onClose }: {
  client: ClientFull | null;
  onSave: (input: CreateClientInput | UpdateClientInput, photo?: PhotoDraft) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const isEdit = client !== null;
  const [name, setName] = useState(client?.name ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [email, setEmail] = useState(client?.email ?? '');
  const [city, setCity] = useState(client?.city ?? '');
  const [groupName, setGroupName] = useState(client?.group_name ?? 'Régulier');
  const [creditLimit, setCreditLimit] = useState(client?.credit_limit ?? 0);
  const [note, setNote] = useState(client?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoDirty, setPhotoDirty] = useState(false);
  useEffect(() => { if (client) api.photos.get('client', client.id).then(setPhoto).catch(() => {}); }, [client]);

  const handleSave = async () => {
    if (!name.trim()) { setError('Le nom est requis.'); return; }
    setError(null); setBusy(true);
    try {
      const photoArg = { dataUrl: photo, dirty: photoDirty };
      if (isEdit && client) {
        await onSave({ id: client.id, name: name.trim(), phone: phone || undefined,
          email: email || undefined, city: city || undefined, group_name: groupName,
          credit_limit: creditLimit, note: note || undefined }, photoArg);
      } else {
        await onSave({ name: name.trim(), phone: phone || undefined, email: email || undefined,
          city: city || undefined, group_name: groupName, credit_limit: creditLimit,
          note: note || undefined }, photoArg);
      }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="form-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="form-drawer">
        <div className="form-drawer-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>{isEdit ? 'Modifier le client' : 'Nouveau client'}</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="form-drawer-body">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <PhotoSlot draft value={photo} onChange={(v) => { setPhoto(v); setPhotoDirty(true); }}
              name={name} shape="circle" size={64} editable />
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', lineHeight: 1.5 }}>
              Photo du client (optionnel)<br />Cliquer ou glisser une image.
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label" htmlFor={`${uid}-n`}>Nom complet *</label>
            <input id={`${uid}-n`} className="cr-input" value={name}
              onChange={(e) => setName(e.target.value)} placeholder="Ex : Aïssata Barry" autoFocus />
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Téléphone</label>
              <input className="cr-input" type="tel" value={phone}
                onChange={(e) => setPhone(e.target.value)} placeholder="+224 6xx xx xx xx" />
            </div>
            <div className="cr-field">
              <label className="cr-label">E-mail</label>
              <input className="cr-input" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="prenom@exemple.gn" />
            </div>
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Ville / Quartier</label>
              <input className="cr-input" value={city} onChange={(e) => setCity(e.target.value)}
                placeholder="Ex : Conakry · Ratoma" />
            </div>
            <div className="cr-field">
              <label className="cr-label">Groupe</label>
              <select className="cr-input" value={groupName} onChange={(e) => setGroupName(e.target.value)}>
                {['Régulier', 'VIP', 'Nouveau'].map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label">Plafond crédit (GNF)</label>
            <input className="cr-input mono" type="number" min="0" value={creditLimit}
              onChange={(e) => setCreditLimit(Number(e.target.value))} />
            <div className="cr-hint">0 = aucun plafond défini</div>
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
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} />
              : isEdit ? 'Enregistrer' : 'Créer le client'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Volet détail client
// ---------------------------------------------------------------------------
function ClientDetail({ client, onEdit, onClose }: {
  client: ClientFull; onEdit: () => void; onClose: () => void;
}) {
  return (
    <div className="stock-detail" style={{ width: 280 }}>
      <div className="stock-detail-head">
        <PhotoSlot entityType="client" entityId={client.id}
          name={client.name} shape="circle" size={44} editable />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{client.name}</div>
          <span className={`badge badge-${GROUP_TONES[client.group_name] ?? 'neutral'}`}>{client.group_name}</span>
        </div>
        <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="stock-detail-body" style={{ padding: '12px 16px' }}>
        <table className="detail-table">
          <tbody>
            <tr><td>Téléphone</td><td>{client.phone ?? '—'}</td></tr>
            <tr><td>E-mail</td><td>{client.email ?? '—'}</td></tr>
            <tr><td>Ville</td><td>{client.city ?? '—'}</td></tr>
            <tr><td>Achats 30j</td><td className="mono">{money(client.purchases30d)}</td></tr>
            <tr><td>Crédit ouvert</td><td className="mono" style={{ color: client.credit_remaining > 0 ? 'var(--cr-warn)' : 'inherit' }}>
              {money(client.credit_remaining)}
            </td></tr>
            {client.credit_limit > 0 && <tr><td>Plafond crédit</td><td className="mono">{money(client.credit_limit)}</td></tr>}
            <tr><td>Dernier achat</td><td style={{ fontSize: 12 }}>{client.last_purchase ? formatDate(client.last_purchase) : '—'}</td></tr>
            <tr><td>Client depuis</td><td style={{ fontSize: 12 }}>{formatDate(client.created_at)}</td></tr>
            {client.note && <tr><td>Note</td><td style={{ fontSize: 12 }}>{client.note}</td></tr>}
          </tbody>
        </table>
        <button className="cr-btn cr-btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={onEdit}>
          <Icon name="edit" size={14} /> Modifier
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Clients
// ---------------------------------------------------------------------------
export function ClientsView() {
  const [clients, setClients] = useState<ClientFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('Tous');
  const [selected, setSelected] = useState<ClientFull | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState<ClientFull | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setClients(await api.clients.listFull()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = clients.filter((c) => {
    const matchGroup = groupFilter === 'Tous' || c.group_name === groupFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q)
      || (c.phone ?? '').includes(q) || (c.city ?? '').toLowerCase().includes(q);
    return matchGroup && matchSearch;
  });

  const handleSave = async (input: CreateClientInput | UpdateClientInput, photo?: PhotoDraft) => {
    let savedId: string;
    if ('id' in input) {
      await api.clients.update(input as UpdateClientInput);
      savedId = (input as UpdateClientInput).id;
      setClients((prev) => prev.map((c) => c.id === savedId
        ? { ...c, ...input, group_name: input.group_name ?? c.group_name,
            credit_limit: input.credit_limit ?? c.credit_limit } : c));
    } else {
      const created = await api.clients.create(input as CreateClientInput);
      savedId = created.id;
      setClients((prev) => [created, ...prev]);
    }
    if (photo?.dirty) {
      if (photo.dataUrl) await PhotoStore.set('client', savedId, photo.dataUrl);
      else await PhotoStore.clear('client', savedId);
    }
    setShowForm(false); setEditClient(null);
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  const totalCredit = clients.reduce((s, c) => s + c.credit_remaining, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Clients actifs', value: num(clients.filter((c) => c.status === 'Actif').length) },
          { label: 'Achats 30j (total)', value: money(clients.reduce((s, c) => s + c.purchases30d, 0)) },
          { label: 'Créances ouvertes', value: money(totalCredit), tone: totalCredit > 0 ? 'warn' : undefined },
          { label: 'Clients VIP', value: num(clients.filter((c) => c.group_name === 'VIP').length) },
        ].map((k) => (
          <div key={k.label} className="cr-card" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: k.tone === 'warn' ? 'var(--cr-warn)' : 'var(--cr-ink-1)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['Tous', 'VIP', 'Régulier', 'Nouveau'].map((g) => (
            <button key={g} className="cr-btn cr-btn-ghost"
              style={{ height: 30, padding: '0 12px', fontSize: 12.5,
                background: groupFilter === g ? 'var(--cr-accent-lt)' : undefined,
                color: groupFilter === g ? 'var(--cr-accent)' : undefined }}
              onClick={() => setGroupFilter(g)}>{g}</button>
          ))}
        </div>
        <div className="cr-input-wrap" style={{ width: 200, marginLeft: 'auto' }}>
          <Icon name="search" size={14} className="cr-input-icon" />
          <input className="cr-input" style={{ height: 32, fontSize: 13 }} placeholder="Nom, téléphone…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="cr-btn cr-btn-primary" onClick={() => { setEditClient(null); setShowForm(true); }}>
          <Icon name="userPlus" size={14} /> Nouveau client
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div className="cr-card" style={{ flex: 1, minWidth: 0, padding: 0, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="screen-placeholder" style={{ height: 200 }}>
              <Icon name="clients" size={32} /><p>Aucun client.</p>
            </div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Client</th><th>Groupe</th><th>Téléphone</th>
                  <th style={{ textAlign: 'right' }}>Achats 30j</th>
                  <th style={{ textAlign: 'right' }}>Crédit ouvert</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className={`stock-row${selected?.id === c.id ? ' selected' : ''}`}
                    onClick={() => setSelected(selected?.id === c.id ? null : c)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PhotoSlot entityType="client" entityId={c.id} name={c.name} shape="circle" size={30} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{c.name}</div>
                          {c.city && <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{c.city}</div>}
                        </div>
                      </div>
                    </td>
                    <td><span className={`badge badge-${GROUP_TONES[c.group_name] ?? 'neutral'}`}>{c.group_name}</span></td>
                    <td style={{ fontSize: 12.5, color: 'var(--cr-ink-2)' }}>{c.phone ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{moneyShort(c.purchases30d)} GNF</td>
                    <td className="mono" style={{ textAlign: 'right',
                      color: c.credit_remaining > 0 ? 'var(--cr-warn)' : 'var(--cr-ink-3)' }}>
                      {c.credit_remaining > 0 ? money(c.credit_remaining) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {selected && (
          <ClientDetail
            client={selected}
            onEdit={() => { setEditClient(selected); setShowForm(true); }}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {showForm && (
        <ClientForm client={editClient} onSave={handleSave} onClose={() => { setShowForm(false); setEditClient(null); }} />
      )}
    </div>
  );
}
