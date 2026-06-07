import { useState, useEffect } from 'react';
import { Icon } from '../icons/Icons';
import { GlobalSearch } from './GlobalSearch';
import type { NavItemId } from '../../lib/types';

const SCREEN_TITLES: Record<NavItemId, string> = {
  dashboard: 'Tableau de bord',
  sales: 'Ventes',
  pos: 'Nouvelle vente',
  cash: 'Caisse',
  treasury: 'Trésorerie',
  customer_credits: 'Crédits clients',
  supplier_debts: 'Dettes fournisseurs',
  expenses: 'Dépenses',
  stock: 'Stock',
  purchases: 'Achats',
  inventory: 'Inventaire',
  clients: 'Clients',
  suppliers: 'Fournisseurs',
  reports: 'Rapports',
  alerts: 'Alertes',
  audit: "Journal d'audit",
  settings: 'Paramètres',
};

interface TopbarProps {
  screen: NavItemId;
  alertCount?: number;
  onNavigate: (id: NavItemId) => void;
  permissions: string[];
}

export function Topbar({ screen, alertCount = 0, onNavigate, permissions }: TopbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  // Raccourci clavier Ctrl/Cmd+K pour ouvrir la recherche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="topbar">
      <h1 className="topbar-title">{SCREEN_TITLES[screen]}</h1>

      <div className="topbar-actions">
        <button className="topbar-search-trigger" title="Rechercher (Ctrl+K)" onClick={() => setSearchOpen(true)}>
          <Icon name="search" size={15} />
          <span>Rechercher…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <button
          className="topbar-btn"
          title="Alertes"
          onClick={() => onNavigate('alerts')}
        >
          <Icon name="bell" size={16} />
          {alertCount > 0 && <span className="topbar-notif-dot" />}
        </button>
      </div>

      {searchOpen && (
        <GlobalSearch onNavigate={onNavigate} onClose={() => setSearchOpen(false)} permissions={permissions} />
      )}
    </header>
  );
}
