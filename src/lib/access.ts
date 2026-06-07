import type { NavItemId } from './types';

// Permissions requises pour accéder à chaque écran (clé de permission backend).
// Un écran est accessible si l'utilisateur possède AU MOINS UNE des permissions listées.
// Liste vide = visible par tous.
export const SCREEN_PERMS: Record<NavItemId, string[]> = {
  // Le tableau de bord est visible par tous : version complète si 'voir_rapports',
  // sinon une version allégée (sans chiffres financiers). Voir Dashboard.tsx.
  dashboard: [],
  sales: ['voir_ventes'],
  pos: ['creer_vente'],
  cash: ['ouvrir_fermer_caisse'],
  treasury: ['voir_tresorerie'],
  customer_credits: ['voir_ventes'],
  supplier_debts: ['paiement_fournisseur', 'voir_tresorerie', 'voir_rapports'],
  expenses: ['gerer_depenses'],
  stock: ['voir_stock'],
  purchases: ['gerer_produits', 'voir_tresorerie', 'voir_rapports'],
  inventory: ['gerer_inventaire'],
  clients: ['voir_ventes'],
  suppliers: ['gerer_produits'],
  reports: ['voir_rapports'],
  alerts: [],
  audit: ['gerer_utilisateurs'],
  settings: ['modifier_parametres'],
};

// Ordre de priorité pour choisir l'écran d'accueil par défaut selon les droits.
const HOME_PRIORITY: NavItemId[] = [
  'dashboard', 'pos', 'sales', 'cash', 'stock', 'treasury',
  'customer_credits', 'supplier_debts', 'expenses', 'purchases',
  'inventory', 'clients', 'suppliers', 'reports', 'alerts', 'settings',
];

export function canAccessScreen(id: NavItemId, perms: string[]): boolean {
  const req = SCREEN_PERMS[id];
  return !req || req.length === 0 || req.some((p) => perms.includes(p));
}

// Premier écran accessible selon les droits (pour l'accueil après connexion).
export function defaultScreen(perms: string[]): NavItemId {
  return HOME_PRIORITY.find((id) => canAccessScreen(id, perms)) ?? 'alerts';
}
