import { useState, useEffect } from 'react';
import { Icon } from '../../components/icons/Icons';
import { api } from '../../lib/api';
import type { SessionInfo, LoginAccount } from '../../lib/types';

interface LoginViewProps {
  onSuccess: (session: SessionInfo) => void;
}

type Channel = 'phone' | 'email';
type AuthMode = 'password' | 'pin';

// Avatar : photo (data-URL) si disponible, sinon initiales.
function Avatar({ acc, size = 44 }: { acc: LoginAccount; size?: number }) {
  const initials = acc.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (acc.photo_path) {
    return (
      <img src={acc.photo_path} alt=""
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: '#e8eef7', color: '#185fa5',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: Math.round(size * 0.38),
    }}>{initials || '?'}</div>
  );
}

export function LoginView({ onSuccess }: LoginViewProps) {
  // Sélecteur de profils
  const [accounts, setAccounts] = useState<LoginAccount[] | null>(null);
  const [selected, setSelected] = useState<LoginAccount | null>(null);
  const [manual, setManual] = useState(false);

  // Saisie commune
  const [mode, setMode] = useState<AuthMode>('password');
  const [channel, setChannel] = useState<Channel>('phone');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.auth.listAccounts()
      .then((list) => setAccounts(list))
      .catch(() => setAccounts([]));
  }, []);

  const resetInputs = () => { setPassword(''); setPin(''); setError(null); setMode('password'); setShowPwd(false); };

  const pickAccount = (acc: LoginAccount) => {
    setSelected(acc);
    setManual(false);
    resetInputs();
  };

  const backToPicker = () => {
    setSelected(null);
    setManual(false);
    setIdentifier('');
    resetInputs();
  };

  // --- Connexion par compte sélectionné (mot de passe) ---
  const handleAccountPassword = async () => {
    if (!selected || !password) { setError('Saisissez votre mot de passe.'); return; }
    setError(null); setBusy(true);
    try {
      const session = await api.auth.loginAccount({ account_id: selected.account_id, password });
      onSuccess(session);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  // --- Connexion par compte sélectionné (PIN) ---
  const pressPin = async (digit: string) => {
    if (!selected || busy) return;
    if (digit === 'back') { setPin((p) => p.slice(0, -1)); return; }
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      setError(null); setBusy(true);
      try {
        const session = await api.auth.loginPin({ account_id: selected.account_id, pin: next });
        onSuccess(session);
      } catch (e) { setError(String(e)); setPin(''); } finally { setBusy(false); }
    }
  };

  // --- Connexion manuelle (identifiant + mot de passe) ---
  const handleManualPassword = async () => {
    if (!identifier.trim() || !password) {
      setError('Saisissez votre identifiant et votre mot de passe.');
      return;
    }
    setError(null); setBusy(true);
    try {
      const session = await api.auth.login({ identifier: identifier.trim(), password });
      onSuccess(session);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  // Vue : profil sélectionné, saisie manuelle, ou sélecteur de profils.
  const showPicker = !selected && !manual && accounts !== null && accounts.length > 0;
  const showManual = manual || (accounts !== null && accounts.length === 0 && !selected);

  return (
    <div className="auth-wrap">
      {/* Panneau de marque */}
      <aside className="auth-aside">
        <div className="auth-aside-brand">
          <div className="auth-aside-mark">K</div>
          <span className="auth-aside-name">KOMERSA</span>
        </div>

        <div className="auth-aside-mid">
          <h2>Votre commerce,<br />même sans Internet.</h2>
          <p>
            Caisse, stock, trésorerie et crédits fonctionnent en local.
            La connexion sert à synchroniser — jamais à vous bloquer.
          </p>
          <ul className="auth-aside-list">
            <li><span><Icon name="check" size={10} /></span>Identifiants vérifiés en local</li>
            <li><span><Icon name="check" size={10} /></span>Reprise rapide par code PIN</li>
            <li><span><Icon name="check" size={10} /></span>Synchronisation au retour du réseau</li>
          </ul>
        </div>

        <div className="auth-aside-foot">Local-first · GNF · Phase 1</div>
      </aside>

      {/* Formulaire */}
      <main className="auth-main">
        <div className="auth-card">

          {/* État de chargement */}
          {accounts === null && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            </div>
          )}

          {/* --- Sélecteur de profils --- */}
          {showPicker && (
            <>
              <div>
                <div className="auth-card-title">Choisissez votre compte</div>
                <div className="auth-card-subtitle">Cliquez sur votre profil pour vous reconnecter.</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {accounts!.map((acc) => (
                  <button key={acc.account_id} className="cr-card"
                    onClick={() => pickAccount(acc)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                      padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
                      border: '1px solid var(--cr-border, #e2e5e9)', background: '#fff',
                    }}>
                    <Avatar acc={acc} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--cr-ink-1, #1a1d21)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--cr-ink-3, #5f6469)' }}>{acc.role}</div>
                    </div>
                    <Icon name="chevronRight" size={16} />
                  </button>
                ))}
              </div>

              <button className="cr-btn cr-btn-ghost"
                style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                onClick={() => { setManual(true); resetInputs(); }}>
                <Icon name="plus" size={14} /> Un autre compte
              </button>
            </>
          )}

          {/* --- Profil sélectionné : mot de passe ou PIN --- */}
          {selected && (
            <>
              <button className="cr-btn cr-btn-ghost"
                style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: 13 }}
                onClick={backToPicker}>
                <Icon name="chevronLeft" size={14} /> Retour
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Avatar acc={selected} size={72} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--cr-ink-3, #5f6469)' }}>
                    {selected.role} · {selected.commerce_name}
                  </div>
                </div>
              </div>

              {/* Onglets mot de passe / PIN si le compte a un PIN */}
              {selected.has_pin && (
                <div className="auth-tabs">
                  <button className={`auth-tab${mode === 'password' ? ' active' : ''}`}
                    onClick={() => { setMode('password'); setError(null); setPin(''); }}>Mot de passe</button>
                  <button className={`auth-tab${mode === 'pin' ? ' active' : ''}`}
                    onClick={() => { setMode('pin'); setError(null); }}>Code PIN</button>
                </div>
              )}

              {mode === 'password' || !selected.has_pin ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="cr-field">
                    <label className="cr-label">Mot de passe</label>
                    <div className="cr-input-wrap">
                      <Icon name={showPwd ? 'eye-off' : 'eye'} size={15} className="cr-input-icon"
                        style={{ left: 'auto', right: 11, cursor: 'pointer', pointerEvents: 'auto' }}
                        onClick={() => setShowPwd((v) => !v)} />
                      <input className="cr-input" type={showPwd ? 'text' : 'password'}
                        placeholder="Votre mot de passe" value={password}
                        style={{ paddingLeft: 12, paddingRight: 36 }}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAccountPassword()}
                        autoFocus />
                    </div>
                  </div>

                  {error && <div className="cr-error">{error}</div>}

                  <button className="cr-btn cr-btn-primary cr-btn-lg"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={handleAccountPassword} disabled={busy}>
                    {busy ? <span className="spinner" /> : 'Se connecter'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--cr-ink-2)' }}>
                    Entrez votre code PIN à 4 chiffres
                  </div>
                  <div className="pin-display">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className={`pin-dot${pin.length > i ? ' filled' : ''}`} />
                    ))}
                  </div>
                  {error && <div className="cr-error" style={{ textAlign: 'center' }}>{error}</div>}
                  <div className="pin-pad">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                      <button key={d} className="pin-key" onClick={() => pressPin(d)} disabled={busy}>{d}</button>
                    ))}
                    <button className="pin-key del" onClick={() => pressPin('back')} disabled={busy}>⌫</button>
                    <button className="pin-key" onClick={() => pressPin('0')} disabled={busy}>0</button>
                    <div />
                  </div>
                </div>
              )}
            </>
          )}

          {/* --- Connexion manuelle (identifiant + mot de passe) --- */}
          {showManual && (
            <>
              <div>
                <div className="auth-card-title">Connexion</div>
                <div className="auth-card-subtitle">Cet appareil est activé — vérification en local.</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="auth-channel-seg">
                  <button className={`auth-channel-btn${channel === 'phone' ? ' active' : ''}`}
                    onClick={() => setChannel('phone')}>
                    <Icon name="phone" size={13} /> Téléphone
                  </button>
                  <button className={`auth-channel-btn${channel === 'email' ? ' active' : ''}`}
                    onClick={() => setChannel('email')}>
                    <Icon name="mail" size={13} /> E-mail
                  </button>
                </div>

                <div className="cr-field">
                  <label className="cr-label">{channel === 'phone' ? 'Numéro de téléphone' : 'Adresse e-mail'}</label>
                  <div className="cr-input-wrap">
                    <Icon name={channel === 'phone' ? 'phone' : 'mail'} size={15} className="cr-input-icon" />
                    <input className="cr-input" type={channel === 'phone' ? 'tel' : 'email'}
                      placeholder={channel === 'phone' ? '+224 6xx xx xx xx' : 'prenom.nom@exemple.gn'}
                      value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualPassword()} autoFocus />
                  </div>
                </div>

                <div className="cr-field">
                  <label className="cr-label">Mot de passe</label>
                  <div className="cr-input-wrap">
                    <Icon name={showPwd ? 'eye-off' : 'eye'} size={15} className="cr-input-icon"
                      style={{ left: 'auto', right: 11, cursor: 'pointer', pointerEvents: 'auto' }}
                      onClick={() => setShowPwd((v) => !v)} />
                    <input className="cr-input" type={showPwd ? 'text' : 'password'}
                      placeholder="Votre mot de passe" value={password}
                      style={{ paddingLeft: 12, paddingRight: 36 }}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualPassword()} />
                  </div>
                </div>

                {error && <div className="cr-error">{error}</div>}

                <button className="cr-btn cr-btn-primary cr-btn-lg"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={handleManualPassword} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'Se connecter'}
                </button>

                {accounts !== null && accounts.length > 0 && (
                  <button className="cr-btn cr-btn-ghost"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={backToPicker}>
                    <Icon name="chevronLeft" size={14} /> Revenir aux comptes
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
