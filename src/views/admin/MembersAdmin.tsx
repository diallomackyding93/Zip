import { useState, useEffect, useCallback, useId } from 'react';
import { api } from '../../lib/api';
import { Icon } from '../../components/icons/Icons';
import { PhotoSlot, PhotoStore } from '../../components/PhotoSlot';
import { money } from '../../lib/format';
import type { MemberRow, PermissionEntry, CreateMemberInput, PhotoDraft, ActivityRow } from '../../lib/types';

const ROLES = [
  'Propriétaire', 'Administrateur', 'Responsable des ventes',
  'Caissier', 'Gestionnaire de stock', 'Comptable', 'Vendeur',
];

const STATUS_TONES: Record<string, string> = {
  Actif: 'good', Invité: 'info', Suspendu: 'warn', Désactivé: 'neutral',
};

// ---------------------------------------------------------------------------
// Formulaire création membre
// ---------------------------------------------------------------------------
function MemberForm({ onSave, onClose }: {
  onSave: (input: CreateMemberInput, photo?: PhotoDraft) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Vendeur');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) { setError('Le nom est requis.'); return; }
    if (!phone.trim() && !email.trim()) { setError('Un téléphone ou e-mail est requis.'); return; }
    if (password.length < 6) { setError('Mot de passe : 6 caractères minimum.'); return; }
    setError(null); setBusy(true);
    try {
      await onSave({ name: name.trim(), phone: phone.trim() || undefined,
        email: email.trim() || undefined, role, password, pin: pin || undefined },
        { dataUrl: photo, dirty: photo !== null });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="form-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="form-drawer">
        <div className="form-drawer-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>Ajouter un membre</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="form-drawer-body">
          <div className="se-info-box" style={{ background: 'var(--cr-info-lt)', color: 'var(--cr-info)',
            padding: '10px 12px', borderRadius: 'var(--cr-r)', fontSize: 12.5 }}>
            <Icon name="shield" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Le membre pourra se connecter immédiatement avec ces identifiants. Les permissions sont vérifiées par le cœur métier local.
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <PhotoSlot draft value={photo} onChange={setPhoto} name={name} shape="circle" size={64} editable />
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', lineHeight: 1.5 }}>
              Photo du membre (optionnel)<br />Cliquer ou glisser une image.
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label" htmlFor={`${uid}-n`}>Nom complet *</label>
            <input id={`${uid}-n`} className="cr-input" value={name}
              onChange={(e) => setName(e.target.value)} placeholder="Ex : Saïkou Touré" autoFocus />
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
          <div className="cr-field">
            <label className="cr-label">Rôle</label>
            <select className="cr-input" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Mot de passe * (6 car. min)</label>
              <input className="cr-input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="cr-field">
              <label className="cr-label">Code PIN (4 chiffres)</label>
              <input className="cr-input" type="password" inputMode="numeric" maxLength={4}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Optionnel" />
            </div>
          </div>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="form-drawer-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Créer le membre'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panneau permissions d'un membre
// ---------------------------------------------------------------------------
function PermissionsPanel({ member }: { member: MemberRow }) {
  const [perms, setPerms] = useState<PermissionEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPerms(await api.admin.getMemberPermissions(member.membership_id)); }
    finally { setLoading(false); }
  }, [member.membership_id]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (p: PermissionEntry) => {
    // Cycle : si effective → forcer refus ; sinon forcer autorisation
    const next = !p.effective;
    // Si on revient exactement au défaut du rôle, on efface l'override
    const granted: boolean | null = next === p.role_default ? null : next;
    await api.admin.setMemberPermission({
      membership_id: member.membership_id, permission: p.key, granted,
    });
    setPerms((prev) => prev.map((x) => x.key === p.key
      ? { ...x, effective: next, overridden: granted !== null } : x));
  };

  if (loading) return <div style={{ padding: 20 }}><span className="spinner" /></div>;

  // Grouper
  const groups = Array.from(new Set(perms.map((p) => p.group)));

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 12 }}>
        Modèle du rôle <strong>{member.role}</strong> + exceptions. Une exception est signalée par un point.
      </div>
      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px',
            color: 'var(--cr-ink-3)', marginBottom: 4 }}>{g}</div>
          {perms.filter((p) => p.group === g).map((p) => (
            <div key={p.key} className="perm-row">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 450 }}>
                  {p.label}
                  {p.overridden && <span className="status-dot dot-warn" style={{ marginLeft: 6, verticalAlign: 'middle' }} title="Exception définie" />}
                </div>
              </div>
              <div className={`toggle-switch${p.effective ? ' on' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => toggle(p)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panneau Activité d'un membre
// ---------------------------------------------------------------------------
const ACT_ICON: Record<string, string> = { sale: 'sales', expense: 'expenses', cash: 'cash' };

function formatActDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function ActivityPanel({ member }: { member: MemberRow }) {
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.admin.getMemberActivity(member.membership_id)
      .then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, [member.membership_id]);

  if (loading) return <div style={{ padding: 20 }}><span className="spinner" /></div>;
  if (items.length === 0) return (
    <div style={{ color: 'var(--cr-ink-3)', fontSize: 13, padding: '12px 0' }}>
      Aucune activité enregistrée pour ce membre.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
          <span className="alert-icon tone-info" style={{ width: 28, height: 28 }}>
            <Icon name={ACT_ICON[a.kind] ?? 'box'} size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{a.label}</div>
            <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>{formatActDate(a.at)}</div>
          </div>
          {a.amount != null && <span className="mono" style={{ fontWeight: 500 }}>{money(a.amount)}</span>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panneau Sécurité d'un membre (réinitialisation du code PIN)
// ---------------------------------------------------------------------------
function SecurityPanel({ member, onFlash }: { member: MemberRow; onFlash: (m: string) => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    if (pin.length !== 4) { setError('Le code PIN doit comporter 4 chiffres.'); return; }
    setError(null); setBusy(true);
    try {
      await api.admin.resetMemberPin({ membership_id: member.membership_id, pin });
      setPin('');
      onFlash('Code PIN réinitialisé.');
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="se-info-box" style={{ background: 'var(--cr-bg)', padding: '10px 12px',
        borderRadius: 'var(--cr-r)', fontSize: 12.5, color: 'var(--cr-ink-2)' }}>
        <Icon name="shield" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
        Définissez un nouveau code PIN à 4 chiffres pour la connexion rapide de ce membre. L'ancien code est immédiatement remplacé.
      </div>
      <div className="cr-field">
        <label className="cr-label">Nouveau code PIN (4 chiffres)</label>
        <input className="cr-input mono" type="password" inputMode="numeric" maxLength={4}
          value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null); }}
          placeholder="••••" style={{ letterSpacing: 4, width: 120 }} />
      </div>
      {error && <div className="cr-error">{error}</div>}
      <button className="cr-btn cr-btn-primary" style={{ alignSelf: 'flex-start' }}
        onClick={reset} disabled={busy || pin.length !== 4}>
        {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Réinitialiser le PIN'}
      </button>
      <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
        Authentification à deux facteurs (2FA) : prévue en Phase 2 (synchronisation cloud).
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vue Membres
// ---------------------------------------------------------------------------
export function MembersAdmin() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const [tab, setTab] = useState<'infos' | 'perms' | 'activity' | 'security'>('infos');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setMembers(await api.admin.listMembers()); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 2500); };

  const handleCreate = async (input: CreateMemberInput, photo?: PhotoDraft) => {
    const m = await api.admin.createMember(input);
    if (photo?.dirty && photo.dataUrl) await PhotoStore.set('account', m.account_id, photo.dataUrl);
    setMembers((prev) => [...prev, m]);
    setShowForm(false);
    flash('Membre créé.');
  };

  const setStatus = async (m: MemberRow, status: string) => {
    try {
      await api.admin.updateMemberStatus({ membership_id: m.membership_id, mstatus: status });
      setMembers((prev) => prev.map((x) => x.membership_id === m.membership_id ? { ...x, mstatus: status } : x));
      if (selected?.membership_id === m.membership_id) setSelected({ ...m, mstatus: status });
      flash(`Statut : ${status}.`);
    } catch (e) { flash(String(e)); }
  };

  const setRole = async (m: MemberRow, role: string) => {
    try {
      await api.admin.updateMemberRole({ membership_id: m.membership_id, role });
      setMembers((prev) => prev.map((x) => x.membership_id === m.membership_id ? { ...x, role } : x));
      if (selected?.membership_id === m.membership_id) setSelected({ ...m, role });
      flash(`Rôle : ${role}.`);
    } catch (e) { flash(String(e)); }
  };

  if (loading) return <div style={{ padding: 40 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Membres du commerce</div>
            <div style={{ fontSize: 12.5, color: 'var(--cr-ink-3)' }}>
              {members.length} membre(s) · le rôle et le statut appartiennent à ce commerce
            </div>
          </div>
          <button className="cr-btn cr-btn-primary" onClick={() => setShowForm(true)}>
            <Icon name="userPlus" size={14} /> Ajouter
          </button>
        </div>

        <div className="se-info-box" style={{ background: 'var(--cr-bg)', padding: '8px 12px',
          borderRadius: 'var(--cr-r)', fontSize: 12, color: 'var(--cr-ink-2)' }}>
          <Icon name="shield" size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Les permissions ne sont pas seulement masquées : elles sont vérifiées par le cœur métier local à chaque action.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
          {members.map((m) => (
            <div key={m.membership_id} className={`member-card${selected?.membership_id === m.membership_id ? ' selected' : ''}`}
              onClick={() => { setSelected(m); setTab('infos'); }}>
              <PhotoSlot entityType="account" entityId={m.account_id}
                name={m.name} shape="circle" size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{m.role}</div>
              </div>
              <span className={`badge badge-${STATUS_TONES[m.mstatus] ?? 'neutral'}`}>{m.mstatus}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Détail membre */}
      {selected && (
        <div className="cr-card" style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <PhotoSlot entityType="account" entityId={selected.account_id}
              name={selected.name} shape="circle" size={48} editable />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{selected.name}</div>
              <span className={`badge badge-${STATUS_TONES[selected.mstatus] ?? 'neutral'}`}>{selected.mstatus}</span>
            </div>
            <button className="topbar-btn" onClick={() => setSelected(null)}><Icon name="x" size={15} /></button>
          </div>

          <div className="stock-detail-tabs" style={{ margin: '0 -20px 12px', padding: '0 20px', flexWrap: 'wrap' }}>
            <button className={`stock-detail-tab${tab === 'infos' ? ' active' : ''}`} onClick={() => setTab('infos')}>Infos & rôle</button>
            <button className={`stock-detail-tab${tab === 'perms' ? ' active' : ''}`} onClick={() => setTab('perms')}>Permissions</button>
            <button className={`stock-detail-tab${tab === 'activity' ? ' active' : ''}`} onClick={() => setTab('activity')}>Activité</button>
            <button className={`stock-detail-tab${tab === 'security' ? ' active' : ''}`} onClick={() => setTab('security')}>Sécurité</button>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {tab === 'perms' ? (
              <PermissionsPanel member={selected} />
            ) : tab === 'activity' ? (
              <ActivityPanel member={selected} />
            ) : tab === 'security' ? (
              <SecurityPanel member={selected} onFlash={flash} />
            ) : (
              <div>
                <table className="detail-table" style={{ marginBottom: 16 }}>
                  <tbody>
                    <tr><td>Téléphone</td><td>{selected.phone ?? '—'}</td></tr>
                    <tr><td>E-mail</td><td>{selected.email ?? '—'}</td></tr>
                  </tbody>
                </table>

                <div className="cr-field" style={{ marginBottom: 12 }}>
                  <label className="cr-label">Rôle</label>
                  <select className="cr-input" value={selected.role}
                    onChange={(e) => setRole(selected, e.target.value)}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                <div className="cr-field">
                  <label className="cr-label">Accès au commerce</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['Actif', 'Suspendu', 'Désactivé'].map((s) => (
                      <button key={s}
                        className={`cr-btn ${selected.mstatus === s ? 'cr-btn-primary' : 'cr-btn-secondary'}`}
                        style={{ height: 30, fontSize: 12 }}
                        onClick={() => setStatus(selected, s)}>{s}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && <MemberForm onSave={handleCreate} onClose={() => setShowForm(false)} />}
      {notice && <div className="toast-wrap"><div className="toast toast-success">{notice}</div></div>}
    </div>
  );
}
