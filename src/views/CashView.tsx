import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { money, num } from '../lib/format';
import { downloadCsv, csvDate } from '../lib/csv';
import { Icon } from '../components/icons/Icons';
import { HistoryFilter } from '../components/HistoryFilter';
import { ClotureModal } from '../components/cash/ClotureModal';
import { MovementModal } from '../components/cash/MovementModal';
import type {
  CashSessionInfo, CashMovementRow, CashSessionSummary, AddMovementInput, TreasuryAccountRow,
} from '../lib/types';

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function elapsedSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function durationBetween(a: string, b: string): string {
  const diff = new Date(b).getTime() - new Date(a).getTime();
  if (isNaN(diff) || diff < 0) return '—';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// ---------------------------------------------------------------------------
// Détail d'une session (fermée ou ouverte) : stats + mouvements
// ---------------------------------------------------------------------------
function SessionDetailModal({ session, onClose }: {
  session: CashSessionSummary;
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.cash.listMovements(session.id)
      .then(setMovements).catch(() => setMovements([])).finally(() => setLoading(false));
  }, [session.id]);

  const open = session.status === 'open';
  const stats: { label: string; value: string; tone?: string }[] = [
    { label: 'Fond initial', value: money(session.initial_fund) },
    { label: 'Ouverte le', value: formatDate(session.opened_at) },
    { label: 'Clôturée le', value: session.closed_at ? formatDate(session.closed_at) : '—' },
    { label: 'Durée', value: session.closed_at ? durationBetween(session.opened_at, session.closed_at) : elapsedSince(session.opened_at) },
    { label: 'Espèces attendues', value: session.cash_expected != null ? money(session.cash_expected) : '—' },
    { label: 'Compté', value: session.counted_cash != null ? money(session.counted_cash) : '—' },
  ];

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 540, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="cash-recent-dot" style={open
              ? { background: 'var(--cr-good-lt)', color: 'var(--cr-good)' } : undefined}>
              <Icon name={open ? 'unlock' : 'lock'} size={15} />
            </div>
            <div>
              <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{session.session_ref}</div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{session.seller_name}</div>
            </div>
            <span className={`badge badge-${open ? 'good' : 'neutral'}`} style={{ marginLeft: 4 }}>
              {open ? 'Ouverte' : 'Clôturée'}
            </span>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div className="modal-body" style={{ overflow: 'auto' }}>
          {/* Grille de stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)', padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--cr-ink-3)', marginBottom: 3 }}>{s.label}</div>
                <div className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Écart en évidence */}
          {session.gap != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', marginTop: 12, borderRadius: 'var(--cr-r)',
              background: session.gap >= 0 ? 'var(--cr-good-lt)' : 'var(--cr-danger-lt)' }}>
              <span style={{ fontWeight: 600, color: session.gap >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)' }}>
                Écart de caisse
              </span>
              <span className="mono" style={{ fontWeight: 700, fontSize: 15,
                color: session.gap >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)' }}>
                {session.gap >= 0 ? '+' : ''}{money(session.gap)}
              </span>
            </div>
          )}

          {/* Mouvements */}
          <div style={{ marginTop: 16, fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>
            Mouvements{!loading ? ` (${movements.length})` : ''}
          </div>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><span className="spinner" /></div>
          ) : (() => {
            const fundRow: CashMovementRow = {
              id: '__fund__', movement_type: 'Fond initial', detail: 'Ouverture de caisse',
              mode_label: 'Espèces', amount: session.initial_fund, seller_name: session.seller_name, created_at: session.opened_at,
            };
            const list = session.initial_fund > 0 ? [...movements, fundRow] : movements;
            return list.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--cr-ink-3)', fontSize: 13 }}>
                Aucun mouvement sur cette session.
              </div>
            ) : (
              list.map((m) => <MovementRow key={m.id} mvt={m} />)
            );
          })()}
        </div>

        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran d'ouverture (aucune session active)
// ---------------------------------------------------------------------------
function OpenSessionPanel({ onOpen }: { onOpen: (fund: number) => Promise<void> }) {
  const [fund, setFund] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CashSessionSummary | null>(null);

  // Sessions : chargement paginé + filtre dates + export (self-fetch).
  const [sessions, setSessions] = useState<CashSessionSummary[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sessLoading, setSessLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchSessions = async (reset: boolean, f = from, t = to) => {
    setSessLoading(true);
    try {
      const off = reset ? 0 : sessions.length;
      const r = await api.cash.listSessions({ from: f || null, to: t || null, offset: off, limit: 50 });
      setSessions((prev) => reset ? r : [...prev, ...r]);
      setHasMore(r.length === 50);
    } finally { setSessLoading(false); }
  };
  const resetFilter = () => { setFrom(''); setTo(''); fetchSessions(true, '', ''); };
  useEffect(() => { fetchSessions(true); /* eslint-disable-next-line */ }, []);

  const exportSessionsCsv = async () => {
    setExporting(true);
    try {
      const all = await api.cash.listSessions({ from: from || null, to: to || null, offset: 0, limit: 10000 });
      downloadCsv(
        `caisses-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Session', 'Vendeur', 'Statut', 'Ouverte', 'Clôturée', 'Fond', 'Attendu', 'Compté', 'Écart'],
        all.map((s) => [s.session_ref, s.seller_name, s.status, csvDate(s.opened_at),
          s.closed_at ? csvDate(s.closed_at) : '', Math.round(s.initial_fund),
          s.cash_expected != null ? Math.round(s.cash_expected) : '',
          s.counted_cash != null ? Math.round(s.counted_cash) : '',
          s.gap != null ? Math.round(s.gap) : '']),
      );
    } finally { setExporting(false); }
  };

  const handleOpen = async () => {
    setBusy(true);
    setError(null);
    try {
      await onOpen(Number(fund) || 0);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const todayLabel = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const last = sessions.find((s) => s.status === 'closed' && s.counted_cash != null);

  return (
    <div className="cash-closed">
      {/* Hero d'ouverture */}
      <div className="cash-hero">
        <div className="cash-hero-top">
          <div className="cash-hero-badge"><Icon name="lock" size={26} /></div>
          <div style={{ flex: 1 }}>
            <div className="cash-hero-title">Caisse fermée</div>
            <div className="cash-hero-sub" style={{ textTransform: 'capitalize' }}>{todayLabel}</div>
          </div>
          <span className="badge badge-neutral">Aucune session active</span>
        </div>

        <div className="cash-hero-form">
          <label className="cr-label" htmlFor="cash-fund">Fond de caisse initial (GNF)</label>
          <div className="cash-hero-row">
            <input
              id="cash-fund"
              className="cr-input mono"
              type="number" min="0" step="1000"
              placeholder="0 — laisser vide si aucun fond"
              value={fund}
              onChange={(e) => setFund(e.target.value === '' ? '' : Number(e.target.value))}
              autoFocus
            />
            <button
              className="cr-btn cr-btn-primary"
              onClick={handleOpen}
              disabled={busy}
            >
              {busy
                ? <span className="spinner" style={{ borderTopColor: '#fff' }} />
                : <><Icon name="unlock" size={16} /> Ouvrir la session</>}
            </button>
          </div>
          <div className="cr-hint">Espèces déjà présentes dans le tiroir avant ouverture.</div>
          {error && <div className="cr-error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      </div>

      {/* Récap de la dernière clôture */}
      {last && (
        <div className="cash-last" style={{ cursor: 'pointer' }} onClick={() => setDetail(last)}
          title="Voir le détail de la session">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 180 }}>
            <div className="cash-recent-dot" style={{ background: 'var(--cr-good-lt)', color: 'var(--cr-good)' }}>
              <Icon name="check" size={16} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--cr-ink-3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Dernière clôture</div>
              <div className="mono" style={{ fontWeight: 600 }}>{last.session_ref}</div>
              <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
                {last.closed_at ? formatDate(last.closed_at) : ''} · {last.seller_name}
              </div>
            </div>
          </div>
          <div className="cash-last-stat">
            <small>Attendu</small>
            <span className="mono">{last.cash_expected != null ? money(last.cash_expected) : '—'}</span>
          </div>
          <div className="cash-last-stat">
            <small>Compté</small>
            <span className="mono">{money(last.counted_cash ?? 0)}</span>
          </div>
          <div className="cash-last-stat">
            <small>Écart</small>
            <span className="mono" style={{ color: (last.gap ?? 0) >= 0 ? 'var(--cr-good)' : 'var(--cr-danger)' }}>
              {(last.gap ?? 0) >= 0 ? '+' : ''}{money(last.gap ?? 0)}
            </span>
          </div>
        </div>
      )}

      {/* Sessions de caisse — filtre dates + pagination + export */}
      <div className="cr-card">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="cr-card-title">Sessions de caisse</div>
          <div style={{ marginLeft: 'auto' }}>
            <HistoryFilter
              from={from} to={to} setFrom={setFrom} setTo={setTo}
              onApply={() => fetchSessions(true)} onReset={resetFilter}
              onExport={exportSessionsCsv} loading={sessLoading} exporting={exporting}
            />
          </div>
        </div>
        {sessLoading && sessions.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><span className="spinner" /></div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--cr-ink-3)', fontSize: 13 }}>
            Aucune session sur la période.
          </div>
        ) : (
          <div className="cash-recent-list">
            {sessions.map((s) => {
              const open = s.status === 'open';
              return (
                <div key={s.id} className="cash-recent-row" style={{ cursor: 'pointer' }}
                  onClick={() => setDetail(s)} title="Voir le détail de la session">
                  <div className="cash-recent-dot" style={open
                    ? { background: 'var(--cr-good-lt)', color: 'var(--cr-good)' }
                    : undefined}>
                    <Icon name={open ? 'unlock' : 'lock'} size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{s.session_ref}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
                      {s.seller_name} · {formatDate(s.opened_at)}
                      {s.closed_at ? ` → ${formatDate(s.closed_at)}` : ''}
                    </div>
                  </div>
                  {open ? (
                    <span className="badge badge-good">Ouverte</span>
                  ) : s.gap != null ? (
                    <span className={`badge badge-${s.gap >= 0 ? 'good' : 'danger'}`}>
                      écart {s.gap >= 0 ? '+' : ''}{money(s.gap)}
                    </span>
                  ) : (
                    <span className="badge badge-neutral">Clôturée</span>
                  )}
                  <Icon name="chevronRight" size={14} style={{ color: 'var(--cr-ink-3)' }} />
                </div>
              );
            })}
          </div>
        )}
        {hasMore && (
          <button className="cr-btn cr-btn-ghost" style={{ width: '100%', justifyContent: 'center', padding: '10px', marginTop: 6 }}
            onClick={() => fetchSessions(false)} disabled={sessLoading}>
            {sessLoading ? <span className="spinner" /> : 'Charger plus'}
          </button>
        )}
      </div>

      {detail && <SessionDetailModal session={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne de mouvement
// ---------------------------------------------------------------------------
function MovementRow({ mvt }: { mvt: CashMovementRow }) {
  const isPositive = mvt.amount > 0;
  // Visuel basé sur le sens réel du montant : entrée = vert, sortie = rouge.
  const toneColor = isPositive ? 'var(--cr-good)' : 'var(--cr-danger)';

  return (
    <div className="cash-mvt-row">
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: isPositive ? 'var(--cr-good-lt)' : 'var(--cr-danger-lt)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: toneColor,
      }}>
        <Icon name={isPositive ? 'plus' : 'chevronRight'} size={14} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {mvt.movement_type}
          {mvt.sale_ref && (
            <span className="mono" style={{ marginLeft: 6, fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
              {mvt.sale_ref}
            </span>
          )}
        </div>
        {mvt.detail && (
          <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{mvt.detail}</div>
        )}
        <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>
          {mvt.seller_name} · {mvt.mode_label ?? ''} · {formatDate(mvt.created_at)}
        </div>
      </div>

      <div className="mono" style={{
        fontWeight: 600, fontSize: 14,
        color: isPositive ? 'var(--cr-good)' : 'var(--cr-danger)',
        flexShrink: 0,
      }}>
        {isPositive ? '+' : ''}{money(mvt.amount)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session ouverte
// ---------------------------------------------------------------------------
function ActiveSession({
  info, movements, accounts, canDeposit, onAddMovement, onClose,
}: {
  info: CashSessionInfo;
  movements: CashMovementRow[];
  accounts: TreasuryAccountRow[];
  canDeposit: boolean;
  onAddMovement: (input: AddMovementInput) => Promise<void>;
  onClose: (counted: number, accountId?: string) => Promise<void>;
}) {
  const [showCloture, setShowCloture] = useState(false);
  const [showMvt, setShowMvt] = useState<'Apport' | 'Sortie' | null>(null);

  const totalByMode = info.by_mode.reduce((sum, m) => sum + m.amount, 0);

  // Fond initial affiché comme un mouvement (ouverture), en bas de liste (plus ancien).
  const fundRow: CashMovementRow = {
    id: '__fund__', movement_type: 'Fond initial', detail: 'Ouverture de caisse',
    mode_label: 'Espèces', amount: info.initial_fund, seller_name: info.seller_name, created_at: info.opened_at,
  };
  const displayMovements = info.initial_fund > 0 ? [...movements, fundRow] : movements;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Header session */}
      <div className="cr-card" style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
          <div style={{
            width: 40, height: 40, background: 'var(--cr-good-lt)', borderRadius: 'var(--cr-r-lg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cr-good)',
          }}>
            <Icon name="unlock" size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }} className="mono">{info.session_ref}</div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
              Ouverte {formatDate(info.opened_at)} · {elapsedSince(info.opened_at)} · {info.seller_name}
            </div>
          </div>
          <span className="badge badge-good" style={{ marginLeft: 8 }}>Session ouverte</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cr-btn cr-btn-secondary" onClick={() => setShowMvt('Apport')}>
            <Icon name="plus" size={14} /> Apport
          </button>
          <button className="cr-btn cr-btn-secondary" onClick={() => setShowMvt('Sortie')}>
            <Icon name="chevronRight" size={14} /> Sortie
          </button>
          <button className="cr-btn cr-btn-danger" onClick={() => setShowCloture(true)}>
            <Icon name="lock" size={14} /> Clôturer
          </button>
        </div>
      </div>

      {/* KPIs par mode */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="cr-card" style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 4 }}>Fond initial</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{money(info.initial_fund)}</div>
        </div>
        <div className="cr-card" style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 4 }}>Espèces attendues</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{money(info.cash_expected)}</div>
        </div>
        <div className="cr-card" style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 4 }}>Total encaissé</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{money(totalByMode)}</div>
        </div>
        <div className="cr-card" style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 4 }}>Tickets</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{num(info.sales_count)}</div>
        </div>
      </div>

      {/* Encaissements par mode + mouvements côte à côte */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* Modes de paiement */}
        <div className="cr-card" style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="cr-card-title" style={{ marginBottom: 12 }}>Par mode</div>
          {info.by_mode.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>Aucune vente enregistrée.</div>
          ) : (
            info.by_mode.map((m) => (
              <div key={m.mode_label} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '8px 0', borderBottom: '1px solid var(--cr-border)', fontSize: 13,
              }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{m.mode_label}</div>
                  <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>{m.count} ticket(s)</div>
                </div>
                <div className="mono" style={{ fontWeight: 600 }}>{money(m.amount)}</div>
              </div>
            ))
          )}
        </div>

        {/* Liste des mouvements */}
        <div className="cr-card" style={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid var(--cr-border)', fontWeight: 600, fontSize: 14 }}>
            Mouvements ({movements.length})
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
            {displayMovements.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--cr-ink-3)', fontSize: 13 }}>
                Aucun mouvement enregistré.
              </div>
            ) : (
              displayMovements.map((m) => <MovementRow key={m.id} mvt={m} />)
            )}
          </div>
        </div>
      </div>

      {showCloture && (
        <ClotureModal
          sessionRef={info.session_ref}
          cashExpected={info.cash_expected}
          initialFund={info.initial_fund}
          accounts={accounts}
          canDeposit={canDeposit}
          onConfirm={async (counted, accountId) => { await onClose(counted, accountId); setShowCloture(false); }}
          onClose={() => setShowCloture(false)}
        />
      )}

      {showMvt && (
        <MovementModal
          defaultType={showMvt}
          onSave={async (input) => { await onAddMovement(input); setShowMvt(null); }}
          onClose={() => setShowMvt(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Caisse
// ---------------------------------------------------------------------------
export function CashView() {
  const [openSession, setOpenSession] = useState<CashSessionInfo | null>(null);
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [accounts, setAccounts] = useState<TreasuryAccountRow[]>([]);
  const [canDeposit, setCanDeposit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sess, accs, canDep] = await Promise.all([
        api.cash.getOpenSession(),
        api.treasury.listAccounts().catch(() => [] as TreasuryAccountRow[]),
        api.auth.hasPermission('transferts_tresorerie').catch(() => false),
      ]);
      setOpenSession(sess);
      setAccounts(accs);
      setCanDeposit(canDep);
      if (sess) {
        const mvts = await api.cash.listMovements(sess.id);
        setMovements(mvts);
      } else {
        setMovements([]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleOpen = async (fund: number) => {
    const sess = await api.cash.openSession({ initial_fund: fund });
    setOpenSession(sess);
    setMovements([]);
  };

  const handleAddMovement = async (input: AddMovementInput) => {
    const mvt = await api.cash.addMovement(input);
    setMovements((prev) => [mvt, ...prev]);
    // Recharger les stats de la session
    if (openSession) {
      api.cash.getOpenSession().then(setOpenSession).catch(() => {});
    }
  };

  const handleClose = async (counted: number, accountId?: string) => {
    if (!openSession) return;
    await api.cash.closeSession({ session_id: openSession.id, counted_cash: counted, treasury_account_id: accountId });
    // Le dépôt a modifié un compte de trésorerie → recharger la liste des comptes.
    api.treasury.listAccounts().then(setAccounts).catch(() => {});
    setOpenSession(null);
    setMovements([]);
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
      <span className="spinner" />
    </div>
  );

  if (error) return (
    <div className="cr-card" style={{ color: 'var(--cr-danger)', display: 'flex', gap: 8, alignItems: 'center' }}>
      <Icon name="alerts" size={16} /> {error}
    </div>
  );

  if (!openSession) {
    return <OpenSessionPanel onOpen={handleOpen} />;
  }

  return (
    <ActiveSession
      info={openSession}
      movements={movements}
      accounts={accounts}
      canDeposit={canDeposit}
      onAddMovement={handleAddMovement}
      onClose={handleClose}
    />
  );
}
