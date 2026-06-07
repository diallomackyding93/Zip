import { useState, useEffect, useCallback, useId } from 'react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { Icon } from '../components/icons/Icons';
import { PhotoSlot, PhotoStore } from '../components/PhotoSlot';
import type {
  TreasuryAccountRow, TreasurySummary, TransferRow, HandoverRow, AccountMovementRow,
  CreateAccountInput, CreateTransferInput, PhotoDraft,
} from '../lib/types';

const KIND_LABEL: Record<string, string> = {
  sale: 'Vente', sale_cancel: 'Annulation vente', return: 'Remboursement retour',
  credit_payment: 'Encaissement crédit', debt_payment: 'Paiement fournisseur',
  expense: 'Dépense', expense_cancel: 'Annulation dépense', purchase: 'Achat',
  transfer_in: 'Transfert reçu', transfer_out: 'Transfert émis', cash_deposit: 'Remise de caisse',
};

function fmtMvtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

const MVT_PAGE = 50;

function csvCellT(v: string | number): string {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportAccountCsv(account: TreasuryAccountRow, rows: AccountMovementRow[]) {
  const lines: string[] = [];
  lines.push(`Relevé de compte;${csvCellT(account.title)}`);
  lines.push(`Solde actuel;${Math.round(account.balance)}`);
  lines.push('');
  lines.push('Date;Type;Libellé;Montant');
  rows.forEach((m) => lines.push(
    `${m.created_at};${csvCellT(KIND_LABEL[m.kind] || m.kind)};${csvCellT(m.label || '')};${Math.round(m.amount)}`,
  ));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `releve-${account.title.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Relevé des mouvements d'un compte de trésorerie (filtre dates + pagination + export).
function AccountMovementsModal({ account, onClose }: { account: TreasuryAccountRow; onClose: () => void }) {
  const [rows, setRows] = useState<AccountMovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = async (reset: boolean) => {
    setLoading(true);
    try {
      const off = reset ? 0 : rows.length;
      const r = await api.treasury.listAccountMovements(account.id, from || null, to || null, off, MVT_PAGE);
      setRows((prev) => reset ? r : [...prev, ...r]);
      setHasMore(r.length === MVT_PAGE);
    } catch { if (rows.length === 0) setRows([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [account.id]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const all = await api.treasury.listAccountMovements(account.id, from || null, to || null, 0, 10000);
      exportAccountCsv(account, all);
    } finally { setExporting(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 480, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PhotoSlot entityType="treasury" entityId={account.id} fallbackIcon="coin" kind="product" shape="square" size={32} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{account.title}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Solde : {money(account.balance)}</div>
            </div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        {/* Barre de filtre par dates + export */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '10px 16px', borderBottom: '1px solid var(--cr-border)', flexWrap: 'wrap' }}>
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
          <button className="cr-btn cr-btn-secondary" style={{ height: 32 }} onClick={() => load(true)} disabled={loading}>Appliquer</button>
          {(from || to) && (
            <button className="cr-btn cr-btn-ghost" style={{ height: 32 }}
              onClick={() => { setFrom(''); setTo(''); setTimeout(() => load(true), 0); }}>Tout</button>
          )}
          <button className="cr-btn cr-btn-secondary" style={{ height: 32, marginLeft: 'auto' }}
            onClick={handleExport} disabled={exporting}>
            <Icon name="download" size={13} /> CSV
          </button>
        </div>

        <div className="modal-body" style={{ overflow: 'auto' }}>
          {rows.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 2px', borderBottom: '1px solid var(--cr-border)' }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: m.amount >= 0 ? 'var(--cr-good-lt)' : 'var(--cr-danger-lt)',
                color: m.amount >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)' }}>
                <Icon name={m.amount >= 0 ? 'download' : 'chevronRight'} size={14} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{m.label || KIND_LABEL[m.kind] || m.kind}</div>
                <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>
                  {m.amount >= 0 ? 'Entrée' : 'Sortie'} · {KIND_LABEL[m.kind] || m.kind} · {fmtMvtDate(m.created_at)}
                </div>
              </div>
              <div className="mono" style={{ fontWeight: 600, color: m.amount >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)' }}>
                {m.amount >= 0 ? '+' : ''}{money(m.amount)}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><span className="spinner" /></div>
          )}
          {!loading && rows.length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--cr-ink-3)', fontSize: 13 }}>
              Aucun mouvement sur la période.
            </div>
          )}
          {!loading && hasMore && (
            <button className="cr-btn cr-btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => load(false)}>Charger plus</button>
          )}
        </div>
        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

// Couleur / icône par type de compte (conforme maquette)
const TYPE_COLOR: Record<string, string> = {
  cash: 'var(--ink-2)', bank: '#3a6ea5', momo: '#e6743f', card: '#3a6ea5', other: 'var(--ink-2)',
};
const TYPE_ICON: Record<string, string> = {
  cash: 'cash', bank: 'treasury', momo: 'wallet', card: 'coin', other: 'coin',
};
const ACCOUNT_TYPES = [
  { value: 'cash', label: 'Espèces / Coffre', icon: 'cash' },
  { value: 'bank', label: 'Banque', icon: 'treasury' },
  { value: 'momo', label: 'Mobile Money', icon: 'wallet' },
  { value: 'card', label: 'Carte bancaire', icon: 'coin' },
  { value: 'other', label: 'Autre', icon: 'coin' },
];

// Sparkline douce dérivée du solde (comme store.js de la maquette, faute d'historique)
function genSpark(balance: number): number[] {
  const b = (Number(balance) || 0) / 1_000_000;
  return [b * 0.96, b * 0.97, b * 0.99, b * 0.98, b, b, b].map((x) => Math.max(0, x));
}

// MiniSpark — copie du composant SVG de la maquette
function MiniSpark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const W = 100, H = 34;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - 4 - ((v - min) / range) * (H - 8);
    return [x, y] as [number, number];
  });
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${W} ${H} L0 ${H} Z`;
  return (
    <svg className="t-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity="0.1" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={1.8} fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Carte de compte — conforme maquette (icône teintée, solde, badges, sparkline, gear)
// ---------------------------------------------------------------------------
function AccountCard({ a, selected, onSelect, onEdit }: {
  a: TreasuryAccountRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (a: TreasuryAccountRow) => void;
}) {
  const color = TYPE_COLOR[a.account_type] || 'var(--ink-2)';
  return (
    <button className={`card t-account ${selected ? 'selected' : ''} ${!a.active ? 'is-inactive' : ''}`}
      onClick={() => onSelect(a.id)}>
      <div className="t-account-head">
        <PhotoSlot entityType="treasury" entityId={a.id}
          fallbackIcon={TYPE_ICON[a.account_type] || 'coin'} kind="product" shape="square" size={30} editable />
        <div className="t-account-title">
          <strong>{a.title}</strong>
          <small>{a.subtitle || ' '}</small>
        </div>
        <span className="t-account-edit" role="button" tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onEdit(a); }} title="Modifier le compte">
          <Icon name="settings" size={14} />
        </span>
      </div>
      <div className="t-account-balance">{money(a.balance)}</div>
      <div className="t-account-badges">
        {a.as_payment
          ? <span className="t-account-badge pay"><Icon name="check" size={11} />Moyen de paiement</span>
          : <span className="t-account-badge muted">Compte interne</span>}
        {!a.active ? <span className="t-account-badge off">Inactif</span> : null}
      </div>
      <MiniSpark values={genSpark(a.balance)} color={color} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Formulaire compte (drawer) — création + édition (toggles live)
// ---------------------------------------------------------------------------
function AccountForm({ account, onSave, onTogglePayment, onToggleActive, onDelete, onClose }: {
  account: TreasuryAccountRow | null;
  onSave: (input: CreateAccountInput, id: string | undefined, photo: PhotoDraft) => Promise<void>;
  onTogglePayment: (id: string) => Promise<boolean>;
  onToggleActive: (id: string) => Promise<boolean>;
  onDelete: (account: TreasuryAccountRow) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const isEdit = account !== null;
  const [title, setTitle] = useState(account?.title ?? '');
  const [subtitle, setSubtitle] = useState(account?.subtitle ?? '');
  const [accountType, setAccountType] = useState(account?.account_type ?? 'cash');
  const [balance, setBalance] = useState(account?.balance ?? 0);
  const [asPayment, setAsPayment] = useState(account?.as_payment ?? false);
  const [active, setActive] = useState(account?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoDirty, setPhotoDirty] = useState(false);
  useEffect(() => { if (account) api.photos.get('treasury', account.id).then(setPhoto).catch(() => {}); }, [account]);

  const handleSave = async () => {
    if (!title.trim()) { setError('Le nom du compte est requis.'); return; }
    setError(null); setBusy(true);
    try {
      await onSave({ title: title.trim(), subtitle: subtitle.trim() || undefined,
        account_type: accountType, balance, as_payment: asPayment }, account?.id,
        { dataUrl: photo, dirty: photoDirty });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const togglePay = async () => {
    if (isEdit && account) { const v = await onTogglePayment(account.id); setAsPayment(v); }
    else setAsPayment((v) => !v);
  };
  const toggleAct = async () => {
    if (isEdit && account) { const v = await onToggleActive(account.id); setActive(v); }
  };

  return (
    <div className="form-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="form-drawer">
        <div className="form-drawer-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>{isEdit ? 'Modifier le compte' : 'Nouveau compte'}</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="form-drawer-body">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <PhotoSlot draft value={photo} onChange={(v) => { setPhoto(v); setPhotoDirty(true); }}
              fallbackIcon={ACCOUNT_TYPES.find((t) => t.value === accountType)?.icon ?? 'coin'}
              kind="product" shape="square" size={56} editable />
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', lineHeight: 1.5 }}>
              Logo du compte (optionnel)<br />Ex : Orange Money, NSIA…
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label">Type de compte</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ACCOUNT_TYPES.map((t) => (
                <button key={t.value}
                  className={`cr-btn ${accountType === t.value ? 'cr-btn-primary' : 'cr-btn-secondary'}`}
                  style={{ height: 32, fontSize: 12.5 }}
                  onClick={() => setAccountType(t.value)}>
                  <Icon name={t.icon} size={13} /> {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label" htmlFor={`${uid}-t`}>Nom du compte *</label>
            <input id={`${uid}-t`} className="cr-input" value={title}
              onChange={(e) => setTitle(e.target.value)} placeholder="Ex : Orange Money Marchand" autoFocus />
          </div>
          <div className="cr-field">
            <label className="cr-label">Précision (optionnel)</label>
            <input className="cr-input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Ex : Compte courant pro" />
          </div>
          {!isEdit && (
            <div className="cr-field">
              <label className="cr-label">Solde initial (GNF)</label>
              <input className="cr-input mono" type="number" min="0" value={balance}
                onChange={(e) => setBalance(Number(e.target.value))} />
            </div>
          )}
          <label className="module-toggle" onClick={togglePay}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>Moyen de paiement</div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Proposé au POS lors de l'encaissement</div>
            </div>
            <div className={`toggle-switch${asPayment ? ' on' : ''}`} />
          </label>
          {isEdit && (
            <label className="module-toggle" onClick={toggleAct}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>Compte actif</div>
                <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Un compte inactif est exclu de la trésorerie nette</div>
              </div>
              <div className={`toggle-switch${active ? ' on' : ''}`} />
            </label>
          )}
          {isEdit && account && Math.abs(account.balance) < 0.01 && (
            <button className="cr-btn cr-btn-danger" style={{ alignSelf: 'flex-start' }}
              onClick={() => onDelete(account)} disabled={busy}>
              <Icon name="trash" size={14} /> Supprimer définitivement
            </button>
          )}
          {isEdit && account && Math.abs(account.balance) >= 0.01 && (
            <div className="cr-hint">Pour supprimer ce compte, son solde doit d'abord être à zéro.</div>
          )}
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="form-drawer-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Fermer</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : isEdit ? 'Enregistrer' : 'Créer le compte'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal transfert
// ---------------------------------------------------------------------------
function TransferModal({ accounts, onSave, onClose }: {
  accounts: TreasuryAccountRow[];
  onSave: (input: CreateTransferInput) => Promise<void>;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(accounts[0]?.id ?? '');
  const [to, setTo] = useState(accounts[1]?.id ?? '');
  const [amount, setAmount] = useState<number | ''>('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromAcc = accounts.find((a) => a.id === from);

  const handleSave = async () => {
    if (!amount || Number(amount) <= 0) { setError('Saisissez un montant.'); return; }
    if (from === to) { setError('Les deux comptes doivent être différents.'); return; }
    setError(null); setBusy(true);
    try {
      await onSave({ from_account_id: from, to_account_id: to, amount: Number(amount), title: title.trim() || undefined });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 400 }}>
        <div className="modal-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>Transfert entre comptes</div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row-2">
            <div className="cr-field">
              <label className="cr-label">Compte source</label>
              <select className="cr-input" value={from} onChange={(e) => setFrom(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
              {fromAcc && <div className="cr-hint mono">Solde : {money(fromAcc.balance)}</div>}
            </div>
            <div className="cr-field">
              <label className="cr-label">Compte destinataire</label>
              <select className="cr-input" value={to} onChange={(e) => setTo(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
          </div>
          <div className="cr-field">
            <label className="cr-label">Montant (GNF) *</label>
            <input className="cr-input mono" type="number" min="0" value={amount}
              onChange={(e) => { setAmount(e.target.value === '' ? '' : Number(e.target.value)); setError(null); }} autoFocus />
          </div>
          <div className="cr-field">
            <label className="cr-label">Libellé (optionnel)</label>
            <input className="cr-input" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex : Dépôt espèces en banque" />
          </div>
          {error && <div className="cr-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleSave} disabled={busy || !amount}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Trésorerie — layout d'origine (simple) + comptes en cartes maquette
// ---------------------------------------------------------------------------
export function TreasuryView() {
  const [summary, setSummary] = useState<TreasurySummary | null>(null);
  const [accounts, setAccounts] = useState<TreasuryAccountRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acctForm, setAcctForm] = useState<{ account: TreasuryAccountRow | null } | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [selAccount, setSelAccount] = useState<string>('all');
  const [movAccount, setMovAccount] = useState<TreasuryAccountRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a, t, h] = await Promise.all([
        api.treasury.getSummary(), api.treasury.listAccounts(),
        api.treasury.listTransfers(), api.treasury.listPendingHandovers(),
      ]);
      setSummary(s); setAccounts(a); setTransfers(t); setHandovers(h);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function formatDate(iso: string) {
    try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  }

  const handleSaveAccount = async (input: CreateAccountInput, id: string | undefined, photo: PhotoDraft) => {
    let savedId: string;
    if (id) {
      await api.treasury.updateAccount({ id, title: input.title, subtitle: input.subtitle,
        account_type: input.account_type, note: input.note });
      savedId = id;
    } else {
      const created = await api.treasury.createAccount(input);
      savedId = created.id;
    }
    // Le compte est créé : on ferme et on recharge AVANT la photo, pour qu'un éventuel
    // échec photo ne bloque pas et ne pousse pas à recréer (donc dupliquer) le compte.
    setAcctForm(null);
    const [s, a] = await Promise.all([api.treasury.getSummary(), api.treasury.listAccounts()]);
    setSummary(s); setAccounts(a);
    if (photo.dirty) {
      try {
        if (photo.dataUrl) await PhotoStore.set('treasury', savedId, photo.dataUrl);
        else await PhotoStore.clear('treasury', savedId);
      } catch (e) { console.error('Logo non enregistré :', e); }
    }
  };

  const handleDeleteAccount = async (account: TreasuryAccountRow) => {
    if (!confirm(`Supprimer définitivement le compte « ${account.title} » ?`)) return;
    try {
      await api.treasury.deleteAccount(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setAcctForm(null);
      api.treasury.getSummary().then(setSummary).catch(() => {});
    } catch (e) { alert(String(e)); }
  };

  const handleTogglePayment = async (id: string) => {
    const val = await api.treasury.toggleAsPayment(id);
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, as_payment: val } : a));
    return val;
  };
  const handleToggleActive = async (id: string) => {
    const val = await api.treasury.toggleActive(id);
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, active: val } : a));
    api.treasury.getSummary().then(setSummary).catch(() => {});
    return val;
  };

  const handleTransfer = async (input: CreateTransferInput) => {
    const t = await api.treasury.createTransfer(input);
    setTransfers((prev) => [t, ...prev]);
    setShowTransferModal(false);
    const [s, a] = await Promise.all([api.treasury.getSummary(), api.treasury.listAccounts()]);
    setSummary(s); setAccounts(a);
  };

  const handleValidateHandover = async (h: HandoverRow) => {
    const cashAcc = accounts.find((a) => a.account_type === 'cash' && a.active);
    if (!cashAcc) { alert('Créez d\'abord un compte espèces actif pour recevoir la remise.'); return; }
    setValidatingId(h.id);
    try {
      await api.treasury.validateHandover({ handover_id: h.id, cash_account_id: cashAcc.id });
      setHandovers((prev) => prev.filter((x) => x.id !== h.id));
      const [s, a] = await Promise.all([api.treasury.getSummary(), api.treasury.listAccounts()]);
      setSummary(s); setAccounts(a);
    } finally { setValidatingId(null); }
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Synthèse (layout d'origine) */}
      {summary && (
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'Trésorerie nette', value: money(summary.net_treasury), tone: 'good' },
            { label: 'Liquidités (esp. + mobile)', value: money(summary.liquid_assets) },
            { label: 'Créances clients', value: money(summary.receivables), tone: summary.receivables > 0 ? 'warn' : undefined },
            { label: 'Dettes fournisseurs', value: money(summary.payables), tone: summary.payables > 0 ? 'danger' : undefined },
          ].map((k) => (
            <div key={k.label} className="cr-card" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>{k.label}</div>
              <div className="mono" style={{
                fontSize: 18, fontWeight: 700,
                color: k.tone === 'good' ? 'var(--cr-good)' : k.tone === 'warn' ? 'var(--cr-warn)'
                  : k.tone === 'danger' ? 'var(--cr-danger)' : 'var(--cr-ink-1)',
              }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Remises en attente (layout d'origine) */}
      {handovers.length > 0 && (
        <div className="cr-card">
          <div className="cr-card-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge badge-warn">Remises en attente</span>
            {handovers.length} session(s) clôturée(s) non validée(s)
          </div>
          {handovers.map((h) => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--cr-border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }} className="mono">{h.session_ref}</div>
                <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{h.seller_name} · {formatDate(h.created_at)}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>
                <div className="mono">Compté : <strong>{money(h.counted)}</strong></div>
                <div style={{ color: h.gap >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)', fontSize: 12 }}>
                  Écart : {h.gap >= 0 ? '+' : ''}{money(h.gap)}
                </div>
              </div>
              <button className="cr-btn cr-btn-primary" style={{ height: 32, fontSize: 12.5 }}
                onClick={() => handleValidateHandover(h)} disabled={validatingId === h.id}>
                {validatingId === h.id ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Valider'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="cr-btn cr-btn-primary" onClick={() => setAcctForm({ account: null })}>
          <Icon name="plus" size={14} /> Nouveau compte
        </button>
        {accounts.filter((a) => a.active).length >= 2 && (
          <button className="cr-btn cr-btn-secondary" onClick={() => setShowTransferModal(true)}>
            <Icon name="refresh" size={14} /> Transfert
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Comptes — EN CARTES CONFORMES MAQUETTE */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {accounts.length === 0 ? (
            <div className="cr-card" style={{ textAlign: 'center', padding: 32, color: 'var(--cr-ink-3)' }}>
              <Icon name="treasury" size={32} style={{ margin: '0 auto 12px', opacity: .3 }} />
              <p>Aucun compte de trésorerie. Cliquez sur « Nouveau compte » pour commencer.</p>
            </div>
          ) : (
            <div className="t-accounts">
              {accounts.map((a) => (
                <AccountCard key={a.id} a={a} selected={selAccount === a.id}
                  onSelect={(id) => { setSelAccount(id); const acc = accounts.find((x) => x.id === id); if (acc) setMovAccount(acc); }}
                  onEdit={(acct) => setAcctForm({ account: acct })} />
              ))}
            </div>
          )}
        </div>

        {/* Transferts récents (layout d'origine) */}
        {transfers.length > 0 && (
          <div className="cr-card" style={{ width: 320, flexShrink: 0 }}>
            <div className="cr-card-title" style={{ marginBottom: 12 }}>Transferts récents</div>
            {transfers.slice(0, 8).map((t) => (
              <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--cr-border)', fontSize: 13 }}>
                <div style={{ fontWeight: 500 }}>{t.title ?? `${t.from_account_title} → ${t.to_account_title}`}</div>
                <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
                  {t.from_account_title} → {t.to_account_title} · {formatDate(t.created_at)}
                </div>
                <div className="mono" style={{ fontWeight: 600, color: 'var(--cr-info)' }}>{money(t.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {acctForm && (
        <AccountForm account={acctForm.account}
          onSave={handleSaveAccount}
          onTogglePayment={handleTogglePayment}
          onToggleActive={handleToggleActive}
          onDelete={handleDeleteAccount}
          onClose={() => setAcctForm(null)} />
      )}
      {showTransferModal && (
        <TransferModal accounts={accounts.filter((a) => a.active)} onSave={handleTransfer} onClose={() => setShowTransferModal(false)} />
      )}
      {movAccount && (
        <AccountMovementsModal account={movAccount} onClose={() => setMovAccount(null)} />
      )}
    </div>
  );
}
