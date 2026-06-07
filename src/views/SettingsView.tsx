import { useState, useEffect, useCallback } from 'react';
import { save, open } from '@tauri-apps/api/dialog';
import { api } from '../lib/api';
import { Icon } from '../components/icons/Icons';
import { MembersAdmin } from './admin/MembersAdmin';
import { StationsAdmin } from './admin/StationsAdmin';
import { LicenseAdmin } from './admin/LicenseAdmin';
import type { CommerceInfo, DbInfo } from '../lib/types';

const CURRENCIES = ['GNF', 'XOF', 'XAF', 'EUR', 'USD'];

const SECTIONS = [
  { id: 'commerce', label: 'Commerce', icon: 'home', group: 'Général' },
  { id: 'rules', label: 'Règles de caisse', icon: 'cash', group: 'Général' },
  { id: 'tickets', label: 'Tickets', icon: 'printer', group: 'Général' },
  { id: 'modules', label: 'Modules', icon: 'settings', group: 'Général' },
  { id: 'maintenance', label: 'Maintenance', icon: 'refresh', group: 'Général' },
  { id: 'members', label: 'Membres', icon: 'clients', group: 'Administration' },
  { id: 'stations', label: 'Postes', icon: 'pos', group: 'Administration' },
  { id: 'license', label: 'Licence', icon: 'shield', group: 'Administration' },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

// Toggle de paramètre
function SettingToggle({ label, hint, value, onChange }: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting-row" onClick={() => onChange(!value)}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13.5 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div className={`toggle-switch${value ? ' on' : ''}`} />
    </div>
  );
}

// Sauvegarde / restauration de la base locale
function BackupSection() {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const loadInfo = () => api.backup.getInfo().then(setInfo).catch(() => {});
  useEffect(() => { loadInfo(); }, []);

  const fmtSize = (b: number) => b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`;

  const doBackup = async () => {
    const dest = await save({
      title: 'Enregistrer la sauvegarde',
      defaultPath: `komersa-sauvegarde-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'Base KOMERSA', extensions: ['db'] }],
    });
    if (!dest) return;
    setBusy('backup'); setMsg(null);
    try {
      await api.backup.save(dest);
      setMsg({ text: 'Sauvegarde enregistrée avec succès.', ok: true });
      loadInfo();
    } catch (e) { setMsg({ text: String(e), ok: false }); }
    finally { setBusy(null); }
  };

  const doRestore = async () => {
    const src = await open({
      title: 'Choisir une sauvegarde à restaurer',
      multiple: false,
      filters: [{ name: 'Base KOMERSA', extensions: ['db'] }],
    });
    if (!src || typeof src !== 'string') return;
    if (!window.confirm(
      'Restaurer cette sauvegarde remplacera TOUTES les données actuelles. '
      + 'La restauration sera appliquée au prochain démarrage de KOMERSA. Continuer ?'
    )) return;
    setBusy('restore'); setMsg(null);
    try {
      await api.backup.restore(src);
      setMsg({ text: 'Restauration préparée. Fermez puis relancez KOMERSA pour l\'appliquer.', ok: true });
    } catch (e) { setMsg({ text: String(e), ok: false }); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px',
      background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="box" size={16} />
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>Base de données locale</div>
        <span className="badge badge-good" style={{ marginLeft: 'auto' }}>Active</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', wordBreak: 'break-all' }}>
        {info ? info.path : 'Chargement…'}
      </div>
      {info && (
        <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
          Taille : <strong>{fmtSize(info.size_bytes)}</strong>
          {info.modified && <> · Modifiée le <strong>{info.modified}</strong></>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <button className="cr-btn cr-btn-primary" onClick={doBackup} disabled={busy !== null}>
          {busy === 'backup' ? <span className="spinner" /> : <><Icon name="download" size={14} /> Sauvegarder</>}
        </button>
        <button className="cr-btn cr-btn-secondary" onClick={doRestore} disabled={busy !== null}>
          {busy === 'restore' ? <span className="spinner" /> : <><Icon name="refresh" size={14} /> Restaurer une sauvegarde</>}
        </button>
      </div>
      {msg && (
        <div style={{ fontSize: 12.5, marginTop: 2, color: msg.ok ? 'var(--cr-good)' : 'var(--cr-danger)' }}>
          {msg.text}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)', marginTop: 2 }}>
        La sauvegarde est un fichier <code>.db</code> autonome. Conservez-le en lieu sûr (clé USB, cloud…).
      </div>
    </div>
  );
}

export function SettingsView() {
  const [section, setSection] = useState<SectionId>('commerce');
  const [commerce, setCommerce] = useState<CommerceInfo | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Champs commerce
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [commerceType, setCommerceType] = useState('');
  const [city, setCity] = useState('');
  const [currency, setCurrency] = useState('GNF');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([api.settings.getCommerceInfo(), api.settings.getSettings()]);
      setCommerce(c); setSettings(s);
      setName(c.name); setShortName(c.short_name ?? '');
      setCommerceType(c.commerce_type ?? ''); setCity(c.city ?? ''); setCurrency(c.currency);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 2500); };

  const isOn = (key: string, def = false) => {
    const v = settings[key];
    if (v === undefined) return def;
    return v === 'true' || v === '1';
  };

  const toggleSetting = async (key: string, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: String(value) }));
    try {
      await api.settings.setSetting({ key, value: String(value) });
      flash('Paramètre enregistré.');
    } catch (e) {
      flash(String(e));
      load(); // resync en cas d'échec (ex. permission)
    }
  };

  const setTextLocal = (key: string, value: string) =>
    setSettings((prev) => ({ ...prev, [key]: value }));
  const saveText = async (key: string) => {
    try {
      await api.settings.setSetting({ key, value: settings[key] ?? '' });
      flash('Paramètre enregistré.');
    } catch (e) { flash(String(e)); load(); }
  };

  const saveCommerce = async () => {
    setSaving(true);
    try {
      await api.settings.updateCommerceInfo({
        name: name.trim(), short_name: shortName.trim() || undefined,
        commerce_type: commerceType.trim() || undefined,
        city: city.trim() || undefined, currency,
      });
      flash('Informations enregistrées.');
    } catch (e) {
      flash(String(e));
    } finally { setSaving(false); }
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}><span className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%' }}>
      {/* Sous-navigation */}
      <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {['Général', 'Administration'].map((grp) => (
          <div key={grp}>
            <div className="nav-group-label" style={{ paddingLeft: 14 }}>{grp}</div>
            {SECTIONS.filter((s) => s.group === grp).map((s) => (
              <button key={s.id}
                className={`settings-nav-item${section === s.id ? ' active' : ''}`}
                onClick={() => setSection(s.id)}>
                <Icon name={s.icon} size={16} />
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {section === 'members' && <MembersAdmin />}
        {section === 'stations' && <StationsAdmin />}
        {section === 'license' && <LicenseAdmin />}

        {section === 'commerce' && (
          <div className="cr-card" style={{ maxWidth: 560 }}>
            <div className="cr-card-title" style={{ marginBottom: 4 }}>Informations du commerce</div>
            <div className="cr-card-subtitle" style={{ marginBottom: 20 }}>
              Ces données apparaissent sur les tickets et rapports.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="cr-field">
                <label className="cr-label">Nom du commerce *</label>
                <input className="cr-input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-row-2">
                <div className="cr-field">
                  <label className="cr-label">Nom court</label>
                  <input className="cr-input" value={shortName} onChange={(e) => setShortName(e.target.value)} />
                </div>
                <div className="cr-field">
                  <label className="cr-label">Devise</label>
                  <select className="cr-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row-2">
                <div className="cr-field">
                  <label className="cr-label">Secteur d'activité</label>
                  <input className="cr-input" value={commerceType} onChange={(e) => setCommerceType(e.target.value)} />
                </div>
                <div className="cr-field">
                  <label className="cr-label">Ville / Quartier</label>
                  <input className="cr-input" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
              </div>
              <button className="cr-btn cr-btn-primary" style={{ alignSelf: 'flex-start' }}
                onClick={saveCommerce} disabled={saving}>
                {saving ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}

        {section === 'rules' && (
          <div className="cr-card" style={{ maxWidth: 560 }}>
            <div className="cr-card-title" style={{ marginBottom: 4 }}>Règles de caisse</div>
            <div className="cr-card-subtitle" style={{ marginBottom: 20 }}>
              Contrôles appliqués par le cœur métier, pas seulement par l'interface.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <SettingToggle
                label="Exiger une caisse ouverte pour vendre"
                hint="Bloque l'encaissement si aucune session de caisse n'est ouverte."
                value={isOn('require_cash_open')}
                onChange={(v) => toggleSetting('require_cash_open', v)}
              />
              <SettingToggle
                label="Confirmer chaque vente à crédit"
                hint="Demande une validation supplémentaire avant une vente à crédit."
                value={isOn('confirm_credit_sale')}
                onChange={(v) => toggleSetting('confirm_credit_sale', v)}
              />
              <SettingToggle
                label="Alerter en cas d'écart de caisse"
                hint="Signale un écart à la clôture de caisse."
                value={isOn('alert_cash_gap', true)}
                onChange={(v) => toggleSetting('alert_cash_gap', v)}
              />
            </div>
          </div>
        )}

        {section === 'tickets' && (
          <div className="cr-card" style={{ maxWidth: 560 }}>
            <div className="cr-card-title" style={{ marginBottom: 4 }}>Tickets de caisse</div>
            <div className="cr-card-subtitle" style={{ marginBottom: 20 }}>
              Personnalisez le reçu imprimé (format thermique 80 mm).
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="cr-field">
                <label className="cr-label">En-tête (sous le nom du commerce)</label>
                <input className="cr-input" placeholder="Ex : Marché Madina · Tél 620 00 00 00"
                  value={settings.ticket_header ?? ''}
                  onChange={(e) => setTextLocal('ticket_header', e.target.value)}
                  onBlur={() => saveText('ticket_header')} />
                <div className="cr-hint" style={{ marginTop: 4 }}>Adresse, téléphone ou slogan. Laisser vide pour masquer.</div>
              </div>
              <div className="cr-field">
                <label className="cr-label">Message de pied de ticket</label>
                <input className="cr-input" placeholder="Merci de votre visite !"
                  value={settings.ticket_footer ?? ''}
                  onChange={(e) => setTextLocal('ticket_footer', e.target.value)}
                  onBlur={() => saveText('ticket_footer')} />
                <div className="cr-hint" style={{ marginTop: 4 }}>Par défaut : « Merci de votre visite ! »</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <SettingToggle label="Afficher le vendeur" hint="Imprime le nom du vendeur sur le ticket."
                  value={isOn('ticket_show_seller', true)} onChange={(v) => toggleSetting('ticket_show_seller', v)} />
                <SettingToggle label="Afficher le client" hint="Imprime le client (ou « Comptoir ») sur le ticket."
                  value={isOn('ticket_show_client', true)} onChange={(v) => toggleSetting('ticket_show_client', v)} />
              </div>
            </div>
          </div>
        )}

        {section === 'modules' && (
          <div className="cr-card" style={{ maxWidth: 560 }}>
            <div className="cr-card-title" style={{ marginBottom: 4 }}>Modules activables</div>
            <div className="cr-card-subtitle" style={{ marginBottom: 20 }}>
              Activez uniquement ce dont votre commerce a besoin.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <SettingToggle label="Gestion des crédits clients" hint="Ventes à crédit et suivi des remboursements."
                value={isOn('module_credits', true)} onChange={(v) => toggleSetting('module_credits', v)} />
              <SettingToggle label="Gestion de la trésorerie" hint="Comptes, transferts, modes de paiement."
                value={isOn('module_treasury', true)} onChange={(v) => toggleSetting('module_treasury', v)} />
              <SettingToggle label="Inventaire" hint="Sessions de comptage et ajustement de stock."
                value={isOn('module_inventory', true)} onChange={(v) => toggleSetting('module_inventory', v)} />
              <SettingToggle label="Multi-unités de vente" hint="Carton, paquet, mètre… par produit."
                value={isOn('module_multi_units', true)} onChange={(v) => toggleSetting('module_multi_units', v)} />
            </div>
            <div className="cr-hint" style={{ marginTop: 16 }}>
              Note : ces modules sont des préférences d'affichage. Les données restent en base même si désactivés.
            </div>
          </div>
        )}

        {section === 'maintenance' && (
          <div className="cr-card" style={{ maxWidth: 560 }}>
            <div className="cr-card-title" style={{ marginBottom: 4 }}>Maintenance</div>
            <div className="cr-card-subtitle" style={{ marginBottom: 20 }}>
              Sauvegarde et informations système.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <BackupSection />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13.5 }}>Synchronisation cloud</div>
                  <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>Phase 2 — non disponible en local-first</div>
                </div>
                <span className="badge badge-neutral">Hors ligne</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 4 }}>
                Devise actuelle : <strong>{commerce?.currency}</strong> · Commerce : <strong>{commerce?.name}</strong>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notice */}
      {notice && (
        <div className="toast-wrap">
          <div className="toast toast-success">{notice}</div>
        </div>
      )}
    </div>
  );
}
