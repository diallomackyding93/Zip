import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../../lib/api';
import { money, num } from '../../lib/format';
import { Icon } from '../icons/Icons';
import { PhotoSlot } from '../PhotoSlot';
import { canAccessScreen } from '../../lib/access';
import type { ProductRow, ClientRow, SupplierRow, NavItemId } from '../../lib/types';

interface GlobalSearchProps {
  onNavigate: (id: NavItemId) => void;
  onClose: () => void;
  permissions: string[];
}

// Recherche globale : produits, clients, fournisseurs. Le clic mène à l'écran
// concerné. Données chargées une fois à l'ouverture (filtrage côté client).
// On ne charge/affiche que les catégories auxquelles l'utilisateur a accès.
export function GlobalSearch({ onNavigate, onClose, permissions }: GlobalSearchProps) {
  const canProducts = canAccessScreen('stock', permissions);
  const canClients = canAccessScreen('clients', permissions);
  const canSuppliers = canAccessScreen('suppliers', permissions);
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    (async () => {
      try {
        const [p, c, s] = await Promise.all([
          canProducts ? api.catalog.listProducts() : Promise.resolve([] as ProductRow[]),
          canClients ? api.sales.listClients() : Promise.resolve([] as ClientRow[]),
          canSuppliers ? api.catalog.listSuppliers() : Promise.resolve([] as SupplierRow[]),
        ]);
        setProducts(p); setClients(c); setSuppliers(s);
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fermeture au clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();

  const prodMatches = useMemo(() => !q ? [] : products.filter((p) =>
    p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)).slice(0, 8), [q, products]);
  const clientMatches = useMemo(() => !q ? [] : clients.filter((c) =>
    c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q)).slice(0, 6), [q, clients]);
  const supMatches = useMemo(() => !q ? [] : suppliers.filter((s) =>
    s.name.toLowerCase().includes(q) || (s.phone ?? '').toLowerCase().includes(q)).slice(0, 6), [q, suppliers]);

  const total = prodMatches.length + clientMatches.length + supMatches.length;
  const go = (id: NavItemId) => { onNavigate(id); onClose(); };

  return (
    <div className="search-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-panel">
        <div className="search-input-row">
          <Icon name="search" size={18} />
          <input ref={inputRef} className="search-input" placeholder="Rechercher un produit, un client, un fournisseur…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <kbd className="search-kbd">Échap</kbd>
        </div>

        <div className="search-results">
          {loading && <div className="search-empty"><span className="spinner" /></div>}
          {!loading && !q && (
            <div className="search-empty">Tapez pour rechercher dans tout le commerce.</div>
          )}
          {!loading && q && total === 0 && (
            <div className="search-empty">Aucun résultat pour « {query} ».</div>
          )}

          {prodMatches.length > 0 && (
            <div className="search-group">
              <div className="search-group-title">Produits</div>
              {prodMatches.map((p) => (
                <button key={p.id} className="search-item" onClick={() => go('stock')}>
                  <PhotoSlot entityType="product" entityId={p.id} fallbackIcon="box" size={28} />
                  <div className="search-item-main">
                    <div className="search-item-name">{p.name}</div>
                    <div className="search-item-sub mono">{p.code}</div>
                  </div>
                  <div className="search-item-meta">
                    <span className="mono">{money(p.price)}</span>
                    <span className={`search-item-stock${p.stock <= p.stock_min ? ' low' : ''}`}>{num(p.stock)} {p.base_unit}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {clientMatches.length > 0 && (
            <div className="search-group">
              <div className="search-group-title">Clients</div>
              {clientMatches.map((c) => (
                <button key={c.id} className="search-item" onClick={() => go('clients')}>
                  <PhotoSlot entityType="client" entityId={c.id} name={c.name} shape="circle" size={28} />
                  <div className="search-item-main">
                    <div className="search-item-name">{c.name}</div>
                    <div className="search-item-sub">{c.phone ?? c.group_name}</div>
                  </div>
                  <span className="badge badge-neutral">{c.group_name}</span>
                </button>
              ))}
            </div>
          )}

          {supMatches.length > 0 && (
            <div className="search-group">
              <div className="search-group-title">Fournisseurs</div>
              {supMatches.map((s) => (
                <button key={s.id} className="search-item" onClick={() => go('suppliers')}>
                  <PhotoSlot entityType="supplier" entityId={s.id} name={s.name} shape="circle" size={28} />
                  <div className="search-item-main">
                    <div className="search-item-name">{s.name}</div>
                    <div className="search-item-sub">{s.phone ?? s.city ?? '—'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
