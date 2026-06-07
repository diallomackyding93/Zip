import { Icon } from '../icons/Icons';
import type { NavItemId, NavEntry } from '../../lib/types';
import { isNavGroup } from '../../lib/types';
import { canAccessScreen } from '../../lib/access';

const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: 'home' },
  {
    group: 'Opérations',
    items: [
      { id: 'sales', label: 'Ventes', icon: 'sales' },
      { id: 'pos', label: 'Nouvelle vente', icon: 'pos' },
      { id: 'cash', label: 'Caisse', icon: 'cash' },
      { id: 'treasury', label: 'Trésorerie', icon: 'treasury' },
      { id: 'customer_credits', label: 'Crédits clients', icon: 'credits' },
      { id: 'supplier_debts', label: 'Dettes fournisseurs', icon: 'debts' },
      { id: 'expenses', label: 'Dépenses', icon: 'expenses' },
    ],
  },
  {
    group: 'Marchandise',
    items: [
      { id: 'stock', label: 'Stock', icon: 'stock' },
      { id: 'purchases', label: 'Achats', icon: 'purchases' },
      { id: 'inventory', label: 'Inventaire', icon: 'inventory' },
    ],
  },
  {
    group: 'Contacts',
    items: [
      { id: 'clients', label: 'Clients', icon: 'clients' },
      { id: 'suppliers', label: 'Fournisseurs', icon: 'suppliers' },
    ],
  },
  {
    group: 'Analyse',
    items: [
      { id: 'reports', label: 'Rapports', icon: 'reports' },
      { id: 'alerts', label: 'Alertes', icon: 'alerts' },
      { id: 'audit', label: "Journal d'audit", icon: 'shield' },
      { id: 'settings', label: 'Paramètres', icon: 'settings' },
    ],
  },
];

interface SidebarProps {
  activeScreen: NavItemId;
  onNavigate: (id: NavItemId) => void;
  commerceName: string;
  commerceColor: string;
  commerceInitials: string;
  userRole: string;
  userName: string;
  onLogout: () => void;
  alertCount?: number;
  permissions: string[];
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Sidebar({
  activeScreen,
  onNavigate,
  commerceName,
  commerceColor,
  commerceInitials,
  userRole,
  userName,
  onLogout,
  alertCount = 0,
  permissions,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* Marque */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">K</div>
        <span className="sidebar-brand-name">KOMERSA</span>
      </div>

      {/* Commerce actif */}
      <div className="sidebar-commerce" title={commerceName}>
        <div
          className="sidebar-commerce-avatar"
          style={{ background: commerceColor }}
        >
          {commerceInitials}
        </div>
        <div className="sidebar-commerce-info">
          <div className="sidebar-commerce-name">{commerceName}</div>
          <div className="sidebar-commerce-role">{userRole}</div>
        </div>
        <Icon name="chevronRight" size={14} style={{ color: 'var(--cr-ink-3)', flexShrink: 0 }} />
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav" role="navigation">
        {NAV.map((entry, i) => {
          if (isNavGroup(entry)) {
            const items = entry.items.filter((item) => canAccessScreen(item.id, permissions));
            if (items.length === 0) return null;
            return (
              <div key={i}>
                <div className="nav-group-label">{entry.group}</div>
                {items.map((item) => {
                  const badge = item.id === 'alerts' && alertCount > 0
                    ? String(alertCount)
                    : undefined;
                  return (
                    <button
                      key={item.id}
                      className={`nav-item${activeScreen === item.id ? ' active' : ''}`}
                      onClick={() => onNavigate(item.id)}
                      title={item.label}
                    >
                      <span className="nav-item-icon">
                        <Icon name={item.icon} size={17} />
                      </span>
                      <span className="nav-item-label">{item.label}</span>
                      {badge && (
                        <span className="nav-item-badge">{badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          }

          // Item racine (Tableau de bord)
          if (!canAccessScreen(entry.id, permissions)) return null;
          return (
            <button
              key={entry.id}
              className={`nav-item${activeScreen === entry.id ? ' active' : ''}`}
              onClick={() => onNavigate(entry.id)}
              title={entry.label}
            >
              <span className="nav-item-icon">
                <Icon name={entry.icon} size={17} />
              </span>
              <span className="nav-item-label">{entry.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Pied : utilisateur + déconnexion */}
      <div className="sidebar-footer">
        <div className="sidebar-user-avatar">{initials(userName)}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{userName}</div>
          <div className="sidebar-user-role">{userRole}</div>
        </div>
        <button
          className="sidebar-logout-btn"
          onClick={onLogout}
          title="Déconnexion"
        >
          <Icon name="lock" size={15} />
        </button>
      </div>
    </aside>
  );
}
