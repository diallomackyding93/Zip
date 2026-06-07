import { useState } from 'react';
import { Icon } from '../components/icons/Icons';
import { api } from '../lib/api';
import type { SessionInfo } from '../lib/types';

interface SetupWizardProps {
  onComplete: (session: SessionInfo) => void;
}

type Step = 'commerce' | 'admin';

const CURRENCIES = ['GNF', 'XOF', 'XAF', 'EUR', 'USD'];

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>('commerce');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Étape 1 — Commerce
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [commerceType, setCommerceType] = useState('');
  const [city, setCity] = useState('');
  const [currency, setCurrency] = useState('GNF');
  const [commerceId, setCommerceId] = useState('');

  // Étape 2 — Administrateur
  const [adminName, setAdminName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const submitCommerce = async () => {
    if (!name.trim()) { setError('Le nom du commerce est requis.'); return; }
    setError(null);
    setBusy(true);
    try {
      const result = await api.setup.createCommerce({
        name: name.trim(),
        short_name: shortName.trim() || undefined,
        commerce_type: commerceType.trim() || undefined,
        city: city.trim() || undefined,
        currency,
      });
      setCommerceId(result.commerce_id);
      setStep('admin');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitAdmin = async () => {
    if (!adminName.trim()) { setError('Votre nom est requis.'); return; }
    if (!phone.trim() && !email.trim()) { setError('Un téléphone ou un e-mail est requis.'); return; }
    if (password.length < 6) { setError('Mot de passe : 6 caractères minimum.'); return; }
    if (pin && (pin.length !== 4 || !/^\d{4}$/.test(pin))) {
      setError('Code PIN : exactement 4 chiffres.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.setup.createAdminAccount({
        commerce_id: commerceId,
        name: adminName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        password,
        pin: pin || undefined,
      });
      // Connexion automatique après setup
      const session = await api.auth.login({
        identifier: phone.trim() || email.trim(),
        password,
      });
      onComplete(session);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-wrap">
      <div className="setup-card">
        {/* En-tête */}
        <div className="setup-header">
          <div className="setup-header-brand">
            <div className="setup-mark">K</div>
            <span style={{ fontWeight: 600, fontSize: 16 }}>KOMERSA</span>
            <span style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginLeft: 4 }}>
              — Premier démarrage
            </span>
          </div>

          <div className="setup-steps">
            <div className={`setup-step${step === 'commerce' ? ' active' : ' done'}`}>
              <div className="setup-step-num">
                {step === 'commerce' ? '1' : <Icon name="check" size={10} />}
              </div>
              Commerce
            </div>
            <div className="setup-step-sep" />
            <div className={`setup-step${step === 'admin' ? ' active' : ''}`}>
              <div className="setup-step-num">2</div>
              Compte propriétaire
            </div>
          </div>
        </div>

        {/* Corps */}
        {step === 'commerce' ? (
          <div className="setup-body">
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                Informations sur votre commerce
              </div>
              <div style={{ fontSize: 13, color: 'var(--cr-ink-2)' }}>
                Ces données s'affichent sur les tickets et rapports.
              </div>
            </div>

            <div className="cr-field">
              <label className="cr-label">Nom du commerce *</label>
              <input
                className="cr-input"
                placeholder="Ex : Maison Diallo · Textiles"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="setup-row">
              <div className="cr-field">
                <label className="cr-label">Nom court</label>
                <input
                  className="cr-input"
                  placeholder="Ex : Maison Diallo"
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                />
              </div>
              <div className="cr-field">
                <label className="cr-label">Devise *</label>
                <select
                  className="cr-input"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="cr-field">
              <label className="cr-label">Secteur d'activité</label>
              <input
                className="cr-input"
                placeholder="Ex : Textile · Prêt-à-porter"
                value={commerceType}
                onChange={(e) => setCommerceType(e.target.value)}
              />
            </div>

            <div className="cr-field">
              <label className="cr-label">Ville / Quartier</label>
              <input
                className="cr-input"
                placeholder="Ex : Conakry · Madina"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            {error && <div className="cr-error">{error}</div>}
          </div>
        ) : (
          <div className="setup-body">
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                Votre compte propriétaire
              </div>
              <div style={{ fontSize: 13, color: 'var(--cr-ink-2)' }}>
                Ce compte aura un accès complet à l'application.
              </div>
            </div>

            <div className="cr-field">
              <label className="cr-label">Votre nom complet *</label>
              <input
                className="cr-input"
                placeholder="Ex : Mariama Diallo"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="setup-row">
              <div className="cr-field">
                <label className="cr-label">Téléphone</label>
                <input
                  className="cr-input"
                  type="tel"
                  placeholder="+224 6xx xx xx xx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="cr-field">
                <label className="cr-label">E-mail</label>
                <input
                  className="cr-input"
                  type="email"
                  placeholder="prenom@exemple.gn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="cr-field">
              <label className="cr-label">Mot de passe * (6 caractères min.)</label>
              <div className="cr-input-wrap">
                <Icon
                  name={showPwd ? 'eye-off' : 'eye'}
                  size={15}
                  className="cr-input-icon"
                  style={{ left: 'auto', right: 11, cursor: 'pointer', pointerEvents: 'auto' }}
                  onClick={() => setShowPwd((v) => !v)}
                />
                <input
                  className="cr-input"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Votre mot de passe"
                  style={{ paddingLeft: 12, paddingRight: 36 }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="cr-field">
              <label className="cr-label">Code PIN (optionnel — 4 chiffres pour déverrouillage rapide)</label>
              <input
                className="cr-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="4 chiffres"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>

            {error && <div className="cr-error">{error}</div>}
          </div>
        )}

        {/* Pied */}
        <div className="setup-footer">
          {step === 'admin' && (
            <button
              className="cr-btn cr-btn-secondary"
              onClick={() => { setStep('commerce'); setError(null); }}
              disabled={busy}
            >
              Retour
            </button>
          )}
          <button
            className="cr-btn cr-btn-primary"
            onClick={step === 'commerce' ? submitCommerce : submitAdmin}
            disabled={busy}
          >
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : (
              step === 'commerce' ? 'Continuer' : 'Créer mon commerce'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
