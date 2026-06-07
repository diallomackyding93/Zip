import { useState } from 'react';
import { Icon } from '../../components/icons/Icons';
import { api } from '../../lib/api';

interface LockScreenProps {
  accountId: string;
  accountName: string;
  onUnlock: () => void;
  onLogout: () => void;
}

// Écran de verrouillage par inactivité : la session reste active côté backend,
// mais l'UI est bloquée jusqu'à re-vérification (PIN ou mot de passe) du compte courant.
export function LockScreen({ accountId, accountName, onUnlock, onLogout }: LockScreenProps) {
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = accountName.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  const pressPin = async (digit: string) => {
    if (busy) return;
    if (digit === 'back') { setPin((p) => p.slice(0, -1)); return; }
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      setError(null); setBusy(true);
      try {
        await api.auth.loginPin({ account_id: accountId, pin: next });
        onUnlock();
      } catch (e) { setError(String(e)); setPin(''); } finally { setBusy(false); }
    }
  };

  const handlePassword = async () => {
    if (!password) { setError('Saisissez votre mot de passe.'); return; }
    setError(null); setBusy(true);
    try {
      await api.auth.loginAccount({ account_id: accountId, password });
      onUnlock();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--cr-bg, #f5f6f8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="auth-card" style={{ width: 360 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: '#e8eef7', color: '#185fa5',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 24,
          }}>{initials || '?'}</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>
              <Icon name="lock" size={15} /> Session verrouillée
            </div>
            <div style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>{accountName}</div>
          </div>
        </div>

        {mode === 'pin' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--cr-ink-2)' }}>
              Entrez votre code PIN pour reprendre
            </div>
            <div className="pin-display">
              {[0, 1, 2, 3].map((i) => <div key={i} className={`pin-dot${pin.length > i ? ' filled' : ''}`} />)}
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
            <button className="cr-btn cr-btn-ghost" style={{ justifyContent: 'center' }}
              onClick={() => { setMode('password'); setError(null); setPin(''); }}>
              Utiliser le mot de passe
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
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
                  onKeyDown={(e) => e.key === 'Enter' && handlePassword()} autoFocus />
              </div>
            </div>
            {error && <div className="cr-error">{error}</div>}
            <button className="cr-btn cr-btn-primary cr-btn-lg" style={{ width: '100%', justifyContent: 'center' }}
              onClick={handlePassword} disabled={busy}>
              {busy ? <span className="spinner" /> : 'Déverrouiller'}
            </button>
            <button className="cr-btn cr-btn-ghost" style={{ justifyContent: 'center' }}
              onClick={() => { setMode('pin'); setError(null); setPassword(''); }}>
              Utiliser le code PIN
            </button>
          </div>
        )}

        <button className="cr-btn cr-btn-ghost" style={{ width: '100%', justifyContent: 'center', color: 'var(--cr-ink-3)' }}
          onClick={onLogout}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
