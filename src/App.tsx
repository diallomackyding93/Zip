import { useState, useEffect, useRef } from 'react';
import { api } from './lib/api';
import { LoginView } from './views/auth/LoginView';
import { LockScreen } from './views/auth/LockScreen';
import { SetupWizard } from './views/SetupWizard';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Dashboard } from './views/Dashboard';
import { StockView } from './views/StockView';
import { POSView, clearPosCart } from './views/POSView';
import { SalesView } from './views/SalesView';
import { CashView } from './views/CashView';
import { TreasuryView } from './views/TreasuryView';
import { ClientsView } from './views/ClientsView';
import { SuppliersView } from './views/SuppliersView';
import { CustomerCreditsView } from './views/CustomerCreditsView';
import { PurchasesView } from './views/PurchasesView';
import { SupplierDebtsView } from './views/SupplierDebtsView';
import { ExpensesView } from './views/ExpensesView';
import { InventoryView } from './views/InventoryView';
import { ReportsView } from './views/ReportsView';
import { AlertsView } from './views/AlertsView';
import { AuditView } from './views/AuditView';
import { SettingsView } from './views/SettingsView';
import { Icon } from './components/icons/Icons';
import { canAccessScreen } from './lib/access';
import type { SessionInfo, NavItemId } from './lib/types';

type AuthStage = 'loading' | 'setup' | 'login' | 'app';

// Écran placeholder pour toutes les vues non encore implémentées
function ScreenPlaceholder({ id }: { id: NavItemId }) {
  const labels: Record<NavItemId, string> = {
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
  return (
    <div className="screen-placeholder">
      <Icon name="box" size={40} />
      <h3>{labels[id]}</h3>
      <p>Écran en cours de développement.</p>
    </div>
  );
}

export function App() {
  const [stage, setStage] = useState<AuthStage>('loading');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [screen, setScreen] = useState<NavItemId>('dashboard');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const [locked, setLocked] = useState(false);

  // Verrouillage automatique après inactivité (poste partagé laissé ouvert).
  const IDLE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

  // Vérification initiale : setup nécessaire ? session déjà active ?
  useEffect(() => {
    (async () => {
      try {
        const status = await api.setup.getStatus();
        if (status.needs_setup) {
          setStage('setup');
          return;
        }
        // Session persistée ? (pas en Phase 1 — toujours login)
        setStage('login');
      } catch {
        setStage('login');
      }
    })();
  }, []);

  const handleLoginSuccess = async (s: SessionInfo) => {
    setSession(s);
    const perms = await api.auth.listMyPermissions().catch(() => [] as string[]);
    setPermissions(perms);
    setScreen('dashboard'); // on atterrit toujours sur le Tableau de bord
    setStage('app');
  };

  // Rafraîchir les permissions sans déconnexion : au retour du focus sur la
  // fenêtre + périodiquement. Permet qu'un changement de droits fait depuis un
  // autre poste s'applique vite (les fenêtres partagent la même base).
  useEffect(() => {
    if (stage !== 'app') return;
    let alive = true;
    const refresh = () => {
      api.auth.listMyPermissions().then((p) => { if (alive) setPermissions(p); }).catch(() => {});
      api.alerts.getMetrics().then((m) => { if (alive) setAlertCount(m.total); }).catch(() => {});
    };
    refresh(); // au démarrage de la session
    const onFocus = () => refresh();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(refresh, 45000);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(id);
    };
  }, [stage]);

  // Si l'écran courant devient interdit (droit retiré), revenir au Tableau de bord.
  useEffect(() => {
    if (stage === 'app' && !canAccessScreen(screen, permissions)) {
      setScreen('dashboard');
    }
  }, [permissions, screen, stage]);

  // Détection d'inactivité → verrouillage de la session.
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    if (stage !== 'app') return;
    const bump = () => { lastActivityRef.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = window.setInterval(() => {
      if (!locked && Date.now() - lastActivityRef.current >= IDLE_LOCK_MS) setLocked(true);
    }, 15000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(id);
    };
  }, [stage, locked, IDLE_LOCK_MS]);

  const handleUnlock = () => { lastActivityRef.current = Date.now(); setLocked(false); };

  const handleLogout = async () => {
    await api.auth.logout();
    clearPosCart(); // ne pas laisser le panier d'un utilisateur au suivant
    setSession(null);
    setPermissions([]);
    setLocked(false);
    setStage('login');
  };

  if (stage === 'loading') {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--cr-bg)',
      }}>
        <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
      </div>
    );
  }

  if (stage === 'setup') {
    return <SetupWizard onComplete={handleLoginSuccess} />;
  }

  if (stage === 'login') {
    return <LoginView onSuccess={handleLoginSuccess} />;
  }

  // stage === 'app'
  if (!session) return null;

  return (
    <>
    <div className="app-frame">
      <Sidebar
        activeScreen={screen}
        onNavigate={setScreen}
        commerceName={session.commerce_name}
        commerceColor="#d2592f"
        commerceInitials={session.commerce_name
          .split(/[\s·]+/)
          .filter(Boolean)
          .map((w: string) => w[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()}
        userRole={session.role}
        userName={session.account_name}
        onLogout={handleLogout}
        permissions={permissions}
        alertCount={alertCount}
      />

      <div className="main-area">
        <Topbar
          screen={screen}
          alertCount={alertCount}
          onNavigate={setScreen}
          permissions={permissions}
        />

        <main key={screen} className="screen-content">
          {!canAccessScreen(screen, permissions) ? (
            <div className="screen-placeholder">
              <Icon name="lock" size={40} />
              <h3>Accès refusé</h3>
              <p>Vous n'avez pas la permission de consulter cet écran.</p>
            </div>
          ) : screen === 'dashboard' ? (
            <Dashboard onNavigate={setScreen} userName={session.account_name}
              canViewReports={permissions.includes('voir_rapports')} permissions={permissions} />
          ) : screen === 'stock' ? (
            <StockView />
          ) : screen === 'pos' ? (
            <POSView />
          ) : screen === 'sales' ? (
            <SalesView />
          ) : screen === 'cash' ? (
            <CashView />
          ) : screen === 'treasury' ? (
            <TreasuryView />
          ) : screen === 'clients' ? (
            <ClientsView />
          ) : screen === 'suppliers' ? (
            <SuppliersView />
          ) : screen === 'customer_credits' ? (
            <CustomerCreditsView />
          ) : screen === 'purchases' ? (
            <PurchasesView />
          ) : screen === 'supplier_debts' ? (
            <SupplierDebtsView />
          ) : screen === 'expenses' ? (
            <ExpensesView />
          ) : screen === 'inventory' ? (
            <InventoryView />
          ) : screen === 'reports' ? (
            <ReportsView />
          ) : screen === 'alerts' ? (
            <AlertsView />
          ) : screen === 'audit' ? (
            <AuditView />
          ) : screen === 'settings' ? (
            <SettingsView />
          ) : (
            <ScreenPlaceholder id={screen} />
          )}
        </main>
      </div>
    </div>
    {locked && (
      <LockScreen
        accountId={session.account_id}
        accountName={session.account_name}
        onUnlock={handleUnlock}
        onLogout={handleLogout}
      />
    )}
    </>
  );
}
