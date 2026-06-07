import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { Icon } from '../../components/icons/Icons';
import type { LicenseInfo } from '../../lib/types';

const STATUS_INFO: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'good' },
  grace: { label: 'Période de grâce', tone: 'warn' },
  expired: { label: 'Expirée', tone: 'danger' },
};

function Gauge({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const tone = pct >= 100 ? 'var(--cr-danger)' : pct >= 80 ? 'var(--cr-warn)' : 'var(--cr-good)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
        <span style={{ color: 'var(--cr-ink-2)' }}>{label}</span>
        <span className="mono" style={{ fontWeight: 600 }}>{used} / {max}</span>
      </div>
      <div className="gauge"><div className="gauge-fill" style={{ width: `${pct}%`, background: tone }} /></div>
    </div>
  );
}

export function LicenseAdmin() {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.admin.getLicense().then(setLicense).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40 }}><span className="spinner" /></div>;
  if (!license) return null;

  const status = STATUS_INFO[license.status] ?? { label: license.status, tone: 'neutral' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
      {/* Carte licence */}
      <div className="cr-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{ width: 48, height: 48, background: 'var(--cr-accent-lt)', borderRadius: 'var(--cr-r-lg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cr-accent)' }}>
            <Icon name="shield" size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Forfait {license.plan}</div>
            <div style={{ fontSize: 12.5, color: 'var(--cr-ink-3)' }}>Édité par KOMERSA</div>
          </div>
          <span className={`badge badge-${status.tone}`}>{status.label}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Gauge used={license.used_users} max={license.max_users} label="Utilisateurs" />
          <Gauge used={license.used_postes} max={license.max_postes} label="Postes" />
        </div>
      </div>

      {/* Détails */}
      <div className="cr-card">
        <div className="cr-card-title" style={{ marginBottom: 12 }}>Détails de la licence</div>
        <table className="detail-table">
          <tbody>
            <tr><td>Statut</td><td>{status.label}</td></tr>
            <tr><td>Activée le</td><td>{license.activated_at ? new Date(license.activated_at).toLocaleDateString('fr-FR') : '—'}</td></tr>
            <tr><td>Renouvellement</td><td>{license.renew_at ? new Date(license.renew_at).toLocaleDateString('fr-FR') : '—'}</td></tr>
            <tr><td>Dernière vérification</td><td>{license.last_check_at ? new Date(license.last_check_at).toLocaleDateString('fr-FR') : '—'}</td></tr>
            <tr><td>Période de grâce hors ligne</td><td>{license.grace_days} jours</td></tr>
          </tbody>
        </table>
      </div>

      {/* Note Phase 1 */}
      <div className="se-info-box" style={{ background: 'var(--cr-info-lt)', color: 'var(--cr-info)',
        padding: '12px 14px', borderRadius: 'var(--cr-r)', fontSize: 12.5, lineHeight: 1.5 }}>
        <Icon name="shield" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
        <strong>Phase 1 — licence locale.</strong> La licence est vérifiée localement sur cet appareil.
        L'activation et la vérification en ligne (console éditeur, renouvellement à distance) arriveront en Phase 2.
        La caisse n'est jamais bloquée par une coupure réseau.
      </div>
    </div>
  );
}
