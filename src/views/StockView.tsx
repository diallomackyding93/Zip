import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { money, moneyShort, num, stockStatus } from '../lib/format';
import { Icon } from '../components/icons/Icons';
import { ProductForm } from '../components/stock/ProductForm';
import { AdjustStockModal } from '../components/stock/AdjustStockModal';
import { ReorderModal } from '../components/stock/ReorderModal';
import { PhotoSlot, PhotoStore } from '../components/PhotoSlot';
import type {
  ProductRow, CategoryRow, SupplierRow, StockMetrics, TreasuryAccountRow,
  CreateProductInput, UpdateProductInput, AdjustStockInput, CreatePurchaseInput, PhotoDraft,
} from '../lib/types';

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------
function KpiCard({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: string;
}) {
  return (
    <div className="cr-card" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 6 }}>{label}</div>
      <div className={`mono`} style={{
        fontSize: 22, fontWeight: 600,
        color: tone === 'danger' ? 'var(--cr-danger)'
          : tone === 'warn' ? 'var(--cr-warn)'
          : 'var(--cr-ink-1)',
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne de produit dans la table
// ---------------------------------------------------------------------------
function ProductTableRow({
  product, selected, onClick, onAdjust, onEdit,
}: {
  product: ProductRow;
  selected: boolean;
  onClick: () => void;
  onAdjust: () => void;
  onEdit: () => void;
}) {
  const status = stockStatus(product.stock, product.stock_min);
  return (
    <tr
      className={`stock-row${selected ? ' selected' : ''}`}
      onClick={onClick}
    >
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PhotoSlot entityType="product" entityId={product.id} fallbackIcon="box" size={30} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontWeight: 500, fontSize: 13.5 }}>{product.name}</span>
            <span style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>{product.code}</span>
          </div>
        </div>
      </td>
      <td>
        {product.category_name ? (
          <span className="badge badge-neutral" style={{ fontSize: 11 }}>
            {product.category_name}
          </span>
        ) : '—'}
      </td>
      <td>
        <span className={`badge badge-${status.tone}`}>{status.label}</span>
      </td>
      <td className="mono" style={{ textAlign: 'right', fontSize: 13.5 }}>
        <strong>{num(product.stock)}</strong>
        <span style={{ color: 'var(--cr-ink-3)', fontSize: 11.5, marginLeft: 3 }}>
          {product.base_unit}
        </span>
      </td>
      <td style={{ color: 'var(--cr-ink-2)', fontSize: 12 }}>
        {product.stock_min > 0 ? num(product.stock_min) : '—'}
      </td>
      <td className="mono" style={{ textAlign: 'right', fontSize: 13 }}>
        {moneyShort(product.price)} GNF
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <button
            className="topbar-btn"
            title="Ajuster le stock"
            onClick={onAdjust}
            style={{ width: 28, height: 28 }}
          >
            <Icon name="edit" size={13} />
          </button>
          <button
            className="topbar-btn"
            title="Modifier le produit"
            onClick={onEdit}
            style={{ width: 28, height: 28 }}
          >
            <Icon name="settings" size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Volet de détail produit
// ---------------------------------------------------------------------------
function ProductDetail({
  product, onClose, onEdit, onAdjust, onReorder,
}: {
  product: ProductRow;
  onClose: () => void;
  onEdit: () => void;
  onAdjust: () => void;
  onReorder: () => void;
}) {
  const status = stockStatus(product.stock, product.stock_min);
  const [tab, setTab] = useState<'info' | 'units' | 'variants'>('info');

  return (
    <div className="stock-detail">
      {/* Header */}
      <div className="stock-detail-head">
        <PhotoSlot entityType="product" entityId={product.id}
          fallbackIcon="box" shape="square" size={44} editable />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{product.name}</div>
          <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{product.code}</div>
        </div>
        <button className="topbar-btn" onClick={onClose} title="Fermer">
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Stock indicator */}
      <div className="stock-detail-stock">
        <div>
          <div style={{ fontSize: 11, color: 'var(--cr-ink-3)', marginBottom: 2 }}>Stock actuel</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--cr-ink-1)' }}>
            {num(product.stock)}
            <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--cr-ink-2)', marginLeft: 5 }}>
              {product.base_unit}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={`badge badge-${status.tone}`}>{status.label}</span>
          {product.stock_min > 0 && (
            <div style={{ fontSize: 11, color: 'var(--cr-ink-3)', marginTop: 4 }}>
              Seuil : {num(product.stock_min)}
            </div>
          )}
        </div>
      </div>

      {/* Actions rapides */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px 12px' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cr-btn cr-btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={onEdit}>
            <Icon name="edit" size={14} /> Modifier
          </button>
          <button className="cr-btn cr-btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onAdjust}>
            <Icon name="plus" size={14} /> Ajuster stock
          </button>
        </div>
        <button className="cr-btn cr-btn-secondary" style={{ justifyContent: 'center',
          ...(status.tone === 'danger' || status.tone === 'warn'
            ? { borderColor: 'var(--cr-accent)', color: 'var(--cr-accent)' } : {}) }} onClick={onReorder}>
          <Icon name="purchases" size={14} /> Réassort{status.tone === 'danger' || status.tone === 'warn' ? ' conseillé' : ''}
        </button>
      </div>

      {/* Onglets */}
      <div className="stock-detail-tabs">
        {(['info', 'units', 'variants'] as const).map((t) => (
          <button
            key={t}
            className={`stock-detail-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'info' ? 'Infos' : t === 'units' ? `Unités (${product.units.length})` : `Déclinaisons (${product.variants.length})`}
          </button>
        ))}
      </div>

      <div className="stock-detail-body">
        {tab === 'info' && (
          <table className="detail-table">
            <tbody>
              <tr><td>Catégorie</td><td>{product.category_name ?? '—'}</td></tr>
              <tr><td>Fournisseur</td><td>{product.supplier_name ?? '—'}</td></tr>
              <tr><td>Unité de base</td><td>{product.base_unit}</td></tr>
              <tr><td>Coût d'achat</td><td className="mono">{money(product.cost)}</td></tr>
              <tr><td>Prix de vente</td><td className="mono">{money(product.price)}</td></tr>
              <tr><td>Marge brute</td><td className="mono" style={{ color: 'var(--cr-good)' }}>
                {product.cost > 0
                  ? `${Math.round(((product.price - product.cost) / product.price) * 100)} %`
                  : '—'}
              </td></tr>
              <tr><td>Valeur stock</td><td className="mono">{money(product.stock * product.cost)}</td></tr>
              {product.stock_max && <tr><td>Stock max</td><td>{num(product.stock_max)}</td></tr>}
            </tbody>
          </table>
        )}

        {tab === 'units' && (
          product.units.length === 0 ? (
            <div style={{ color: 'var(--cr-ink-3)', fontSize: 13, padding: '12px 0' }}>
              Unité de base uniquement : {product.base_unit}
            </div>
          ) : (
            <table className="detail-table">
              <thead><tr><th>Unité</th><th>Facteur</th><th>Prix</th></tr></thead>
              <tbody>
                {product.units.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td className="mono">{u.factor === 1 ? 'base' : `×${u.factor}`}</td>
                    <td className="mono">{moneyShort(u.price)} GNF</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === 'variants' && (
          product.variants.length === 0 ? (
            <div style={{ color: 'var(--cr-ink-3)', fontSize: 13, padding: '12px 0' }}>
              Aucune déclinaison configurée.
            </div>
          ) : (
            <table className="detail-table">
              <thead><tr><th>Déclinaison</th><th>Stock</th><th>Prix</th></tr></thead>
              <tbody>
                {product.variants.map((v) => (
                  <tr key={v.id}>
                    <td>{v.value}</td>
                    <td className="mono">{v.stock != null ? num(v.stock) : '—'}</td>
                    <td className="mono">{v.price != null ? `${moneyShort(v.price)} GNF` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran Stock principal
// ---------------------------------------------------------------------------
export function StockView() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [accounts, setAccounts] = useState<TreasuryAccountRow[]>([]);
  const [metrics, setMetrics] = useState<StockMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string>('Tous');
  const [selected, setSelected] = useState<ProductRow | null>(null);

  // Formulaire création / modification
  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductRow | null>(null);

  // Modale ajustement stock
  const [adjustProduct, setAdjustProduct] = useState<ProductRow | null>(null);

  // Modale réassort (→ commande d'achat)
  const [reorderProduct, setReorderProduct] = useState<ProductRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, p, c, s, acc] = await Promise.all([
        api.catalog.getStockMetrics(),
        api.catalog.listProducts(),
        api.catalog.listCategories(),
        api.catalog.listSuppliers(),
        api.treasury.listAccounts().catch(() => [] as TreasuryAccountRow[]),
      ]);
      setMetrics(m);
      setProducts(p);
      setCategories(c);
      setSuppliers(s);
      setAccounts(acc);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filtrage
  const filtered = products.filter((p) => {
    const matchCat = activeCat === 'Tous' || p.category_name === activeCat;
    const q = search.toLowerCase();
    const matchSearch = !q
      || p.name.toLowerCase().includes(q)
      || p.code.toLowerCase().includes(q)
      || (p.supplier_name ?? '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  // Catégories uniques présentes dans les produits
  const catTabs = ['Tous', ...categories.map((c) => c.name)];

  const openCreate = () => { setEditProduct(null); setFormOpen(true); };
  const openEdit = (p: ProductRow) => { setEditProduct(p); setFormOpen(true); };
  const openAdjust = (p: ProductRow) => setAdjustProduct(p);

  const handleFormSave = async (input: CreateProductInput | UpdateProductInput, photo?: PhotoDraft) => {
    let savedId: string;
    if ('id' in input) {
      const updated = await api.catalog.updateProduct(input as UpdateProductInput);
      setProducts((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      if (selected?.id === updated.id) setSelected(updated);
      savedId = updated.id;
    } else {
      const created = await api.catalog.createProduct(input as CreateProductInput);
      setProducts((prev) => [created, ...prev]);
      savedId = created.id;
    }
    // Persister la photo (mode brouillon) une fois l'id connu
    if (photo?.dirty) {
      if (photo.dataUrl) await PhotoStore.set('product', savedId, photo.dataUrl);
      else await PhotoStore.clear('product', savedId);
    }
    setFormOpen(false);
    api.catalog.getStockMetrics().then(setMetrics).catch(() => {});
  };

  const handleAdjustSave = async (input: AdjustStockInput) => {
    const newStock = await api.catalog.adjustStock(input);
    setProducts((prev) =>
      prev.map((p) => p.id === input.product_id ? { ...p, stock: newStock } : p)
    );
    if (selected?.id === input.product_id) setSelected((s) => s ? { ...s, stock: newStock } : s);
    setAdjustProduct(null);
    api.catalog.getStockMetrics().then(setMetrics).catch(() => {});
  };

  const handleReorder = async (input: CreatePurchaseInput) => {
    await api.purchases.create(input);
    setReorderProduct(null);
    // Réception immédiate → le stock a changé : recharger produits + métriques
    const [p, m] = await Promise.all([api.catalog.listProducts(), api.catalog.getStockMetrics()]);
    setProducts(p);
    setMetrics(m);
    if (selected) setSelected(p.find((x) => x.id === selected.id) ?? null);
  };

  const handleDelete = async (p: ProductRow) => {
    if (!confirm(`Supprimer « ${p.name} » ? Cette action est irréversible.`)) return;
    await api.catalog.deleteProduct(p.id);
    setProducts((prev) => prev.filter((x) => x.id !== p.id));
    if (selected?.id === p.id) setSelected(null);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <span className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="cr-card" style={{ color: 'var(--cr-danger)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Icon name="alerts" size={16} /> {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      {/* KPIs */}
      {metrics && (
        <div style={{ display: 'flex', gap: 12 }}>
          <KpiCard label="Produits actifs" value={num(metrics.total)} />
          <KpiCard
            label="Stock faible"
            value={num(metrics.low_stock)}
            tone={metrics.low_stock > 0 ? 'warn' : undefined}
          />
          <KpiCard
            label="Rupture"
            value={num(metrics.rupture)}
            tone={metrics.rupture > 0 ? 'danger' : undefined}
          />
          <KpiCard
            label="Valeur du stock"
            value={moneyShort(metrics.stock_value)}
            sub="GNF au coût d'achat"
          />
        </div>
      )}

      {/* Barre de contrôles */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Filtres catégories */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {catTabs.map((cat) => (
            <button
              key={cat}
              className={`cr-btn cr-btn-ghost${activeCat === cat ? ' active-filter' : ''}`}
              style={{
                height: 30, padding: '0 12px', fontSize: 12.5,
                background: activeCat === cat ? 'var(--cr-accent-lt)' : undefined,
                color: activeCat === cat ? 'var(--cr-accent)' : undefined,
              }}
              onClick={() => setActiveCat(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Recherche */}
        <div className="cr-input-wrap" style={{ width: 200 }}>
          <Icon name="search" size={14} className="cr-input-icon" />
          <input
            className="cr-input"
            style={{ height: 32, fontSize: 13 }}
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button className="cr-btn cr-btn-primary" onClick={openCreate}>
          <Icon name="plus" size={14} /> Nouveau produit
        </button>
      </div>

      {/* Table + volet de détail */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* Table */}
        <div className="cr-card" style={{ flex: 1, minWidth: 0, padding: 0, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="screen-placeholder" style={{ height: 200 }}>
              <Icon name="box" size={32} />
              <p>{search ? 'Aucun produit ne correspond à la recherche.' : 'Aucun produit dans cette catégorie.'}</p>
            </div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th>Statut</th>
                  <th style={{ textAlign: 'right' }}>Stock</th>
                  <th>Seuil</th>
                  <th style={{ textAlign: 'right' }}>Prix</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <ProductTableRow
                    key={p.id}
                    product={p}
                    selected={selected?.id === p.id}
                    onClick={() => setSelected(selected?.id === p.id ? null : p)}
                    onAdjust={() => openAdjust(p)}
                    onEdit={() => openEdit(p)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Volet de détail */}
        {selected && (
          <ProductDetail
            product={selected}
            onClose={() => setSelected(null)}
            onEdit={() => openEdit(selected)}
            onAdjust={() => openAdjust(selected)}
            onReorder={() => setReorderProduct(selected)}
          />
        )}
      </div>

      {/* Formulaire produit (drawer) */}
      {formOpen && (
        <ProductForm
          product={editProduct}
          categories={categories}
          suppliers={suppliers}
          onSave={handleFormSave}
          onClose={() => setFormOpen(false)}
          onDelete={editProduct ? () => handleDelete(editProduct) : undefined}
        />
      )}

      {/* Modale ajustement stock */}
      {adjustProduct && (
        <AdjustStockModal
          product={adjustProduct}
          onSave={handleAdjustSave}
          onClose={() => setAdjustProduct(null)}
        />
      )}

      {/* Modale réassort */}
      {reorderProduct && (
        <ReorderModal
          product={reorderProduct}
          suppliers={suppliers}
          accounts={accounts}
          onSave={handleReorder}
          onClose={() => setReorderProduct(null)}
        />
      )}
    </div>
  );
}
