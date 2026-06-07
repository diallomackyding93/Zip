import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { money, moneyShort, num, stockStatus } from '../lib/format';
import { resolvePrice, unitFactor } from '../lib/pricing';
import { Icon } from '../components/icons/Icons';
import { PhotoSlot } from '../components/PhotoSlot';
import { EncaissementModal } from '../components/pos/EncaissementModal';
import { ProductPicker } from '../components/pos/ProductPicker';
import { Receipt, type ReceiptData } from '../components/pos/Receipt';
import type {
  ProductRow, CategoryRow, PaymentModeRow, ClientRow,
  TicketItem, SalePaymentInput,
} from '../lib/types';

// ---------------------------------------------------------------------------
// Ligne de ticket
// ---------------------------------------------------------------------------
function TicketLine({
  item, onQtySet, onPriceChange, onRemove,
}: {
  item: TicketItem;
  onQtySet: (qty: number) => void;
  onPriceChange: (price: number) => void;
  onRemove: () => void;
}) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(String(item.unit_price));
  const [editingQty, setEditingQty] = useState(false);
  const [qtyInput, setQtyInput] = useState(String(item.qty));
  const priceModified = item.unit_price !== item.orig_price;

  const commitPrice = () => {
    const v = Number(priceInput);
    if (v > 0) onPriceChange(v);
    else setPriceInput(String(item.unit_price));
    setEditingPrice(false);
  };
  const commitQty = () => {
    const v = Number(String(qtyInput).replace(',', '.'));
    if (v > 0) onQtySet(v);
    else setQtyInput(String(item.qty));
    setEditingQty(false);
  };

  return (
    <div className="ticket-line">
      {/* Rangée 1 : photo + nom + déclinaison/unité + retirer */}
      <div className="ticket-line-head">
        <PhotoSlot entityType="product" entityId={item.product_id} fallbackIcon="box" size={34} />
        <div className="ticket-line-info">
          <div className="ticket-line-name">{item.product_name}</div>
          <div className="ticket-line-sub">
            {item.variant && <span>{item.variant} · </span>}{item.unit_name}
          </div>
        </div>
        <button className="ticket-remove" onClick={onRemove} title="Retirer">
          <Icon name="x" size={12} />
        </button>
      </div>

      {/* Rangée 2 :  Q (gauche)   PU (centré)   Total (droite) */}
      <div className="ticket-line-controls">
        {/* Quantité cliquable — à gauche */}
        {editingQty ? (
          <input className="cr-input mono ticket-inline-input tlc-qty" type="number" min="0" step="any" autoFocus
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => { if (e.key === 'Enter') commitQty(); if (e.key === 'Escape') setEditingQty(false); }} />
        ) : (
          <button className="ticket-qxp-qty tlc-qty" title="Cliquer pour saisir la quantité"
            onClick={() => { setQtyInput(String(item.qty)); setEditingQty(true); }}>
            {num(item.qty)}
          </button>
        )}

        {/* Prix unitaire cliquable — centré */}
        {editingPrice ? (
          <input className="cr-input mono ticket-inline-input tlc-pu" type="number" min="0" autoFocus
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => { if (e.key === 'Enter') commitPrice(); if (e.key === 'Escape') setEditingPrice(false); }} />
        ) : (
          <button className="ticket-qxp-pu tlc-pu" title="Cliquer pour modifier le prix unitaire"
            onClick={() => { setPriceInput(String(item.unit_price)); setEditingPrice(true); }}>
            {priceModified && <s>{moneyShort(item.orig_price)}</s>}
            <span className={`mono${priceModified ? ' price-modified' : ''}`}>{num(item.unit_price)}</span>
          </button>
        )}

        {/* Total — à droite */}
        <span className="ticket-line-total mono">{money(item.qty * item.unit_price)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panier persistant en mémoire : survit à la navigation entre écrans.
// Vidé à la validation de la vente ou via « Vider ».
// ---------------------------------------------------------------------------
type PosCart = {
  items: TicketItem[];
  discount: number;
  discountMode: 'GNF' | '%';
  discountInput: string;
  selectedClientId?: string;
};
const posCart: PosCart = { items: [], discount: 0, discountMode: 'GNF', discountInput: '', selectedClientId: undefined };
export function clearPosCart() {
  posCart.items = []; posCart.discount = 0; posCart.discountMode = 'GNF';
  posCart.discountInput = ''; posCart.selectedClientId = undefined;
}

// ---------------------------------------------------------------------------
// POS principal
// ---------------------------------------------------------------------------
export function POSView() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentModeRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Ticket — restauré depuis le store persistant (survit à la navigation).
  const [items, setItems] = useState<TicketItem[]>(posCart.items);
  const [discount, setDiscount] = useState(posCart.discount);
  const [discountMode, setDiscountMode] = useState<'GNF' | '%'>(posCart.discountMode);
  const [discountInput, setDiscountInput] = useState(posCart.discountInput);
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>(posCart.selectedClientId);
  const [clientSearch, setClientSearch] = useState('');

  // Sauvegarder le panier en cours à chaque changement.
  useEffect(() => {
    posCart.items = items;
    posCart.discount = discount;
    posCart.discountMode = discountMode;
    posCart.discountInput = discountInput;
    posCart.selectedClientId = selectedClientId;
  }, [items, discount, discountMode, discountInput, selectedClientId]);

  // Filtres catalogue
  const [activeCat, setActiveCat] = useState('Tous');
  const [search, setSearch] = useState('');

  // Modales
  const [showEncaissement, setShowEncaissement] = useState(false);
  const [lastSaleRef, setLastSaleRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<ProductRow | null>(null);
  const [cashSessionId, setCashSessionId] = useState<string | undefined>();
  const [commerce, setCommerce] = useState<{ name: string; city?: string }>({ name: 'KOMERSA' });
  const [sellerName, setSellerName] = useState<string | undefined>();
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [ticketCfg, setTicketCfg] = useState<{ header?: string; footer?: string; showSeller: boolean; showClient: boolean }>({ showSeller: true, showClient: true });
  const saleKeyRef = useRef<string>('');

  // Toast transitoire (ex. stock insuffisant à l'ajout au panier).
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c, pm, cl, sess, info, auth, st] = await Promise.all([
        api.catalog.listProducts(),
        api.catalog.listCategories(),
        api.sales.listPaymentModes(),
        api.sales.listClients(),
        api.cash.getOpenSession(),
        api.settings.getCommerceInfo(),
        api.auth.getSession(),
        api.settings.getSettings(),
      ]);
      setProducts(p);
      setCategories(c);
      setPaymentModes(pm);
      setClients(cl);
      setCashSessionId(sess?.id);
      setCommerce({ name: info.short_name || info.name, city: info.city });
      setSellerName(auth?.account_name);
      const truthy = (v: string | undefined, def: boolean) => v === undefined ? def : (v === 'true' || v === '1');
      setTicketCfg({
        header: st.ticket_header || undefined,
        footer: st.ticket_footer || undefined,
        showSeller: truthy(st.ticket_show_seller, true),
        showClient: truthy(st.ticket_show_client, true),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---------------------------------------------------------------------------
  // Calculs ticket
  // ---------------------------------------------------------------------------
  const subtotal = items.reduce((s, it) => s + it.qty * it.unit_price, 0);
  const discountAmount = discountMode === '%'
    ? Math.round(subtotal * Math.min(100, Math.max(0, discount)) / 100)
    : Math.min(discount, subtotal);
  const total = Math.max(0, subtotal - discountAmount);

  // ---------------------------------------------------------------------------
  // Gestion remise
  // ---------------------------------------------------------------------------
  const applyDiscount = (raw: string, mode: 'GNF' | '%') => {
    const v = Number(raw) || 0;
    setDiscountInput(raw);
    setDiscount(mode === '%' ? Math.min(100, v) : Math.min(subtotal, v));
  };

  // ---------------------------------------------------------------------------
  // Gestion catalogue → ticket
  // ---------------------------------------------------------------------------
  // Clic produit : si déclinaisons ou plusieurs unités → ouvrir le sélecteur ;
  // sinon ajout direct (unité de base, sans déclinaison).
  const onProductClick = (product: ProductRow) => {
    const hasChoices = product.variants.length > 0 || product.units.length > 0;
    if (hasChoices) { setPicker(product); return; }
    pushItem({
      product_id: product.id, product_code: product.code, product_name: product.name,
      unit_name: product.base_unit, unit_factor: 1, qty: 1,
      unit_price: product.price, orig_price: product.price,
    });
  };

  // Stock de base disponible pour un produit (Infinity si hors catalogue).
  const stockOf = (pid: string) => {
    const p = products.find((x) => x.id === pid);
    return p ? p.stock : Infinity;
  };
  const baseFactor = (it: TicketItem) => (it.unit_factor > 0 ? it.unit_factor : 1);

  // Ajout effectif au ticket (regroupe les lignes identiques produit+déclinaison+unité),
  // en plafonnant la quantité cumulée du produit à son stock disponible. Si la demande
  // dépasse le disponible, on plafonne ET on prévient l'utilisateur.
  const pushItem = (item: TicketItem) => {
    const stock = stockOf(item.product_id);
    const factor = baseFactor(item);
    const idx = items.findIndex((it) =>
      it.product_id === item.product_id && it.variant === item.variant && it.unit_name === item.unit_name);
    const baseOthers = items.reduce((s, it, i) =>
      (it.product_id === item.product_id && i !== idx) ? s + it.qty * baseFactor(it) : s, 0);
    const currentQty = idx >= 0 ? items[idx].qty : 0;
    const desired = currentQty + item.qty;
    const maxLineQty = Math.max(0, (stock - baseOthers) / factor);

    // Si la quantité demandée dépasse le disponible : on n'ajoute RIEN, on prévient.
    if (desired > maxLineQty + 1e-6) {
      const unit = products.find((p) => p.id === item.product_id)?.base_unit ?? '';
      const remaining = Math.max(0, stock - baseOthers);
      showToast(remaining > 0
        ? `Stock insuffisant : ${num(remaining)} ${unit} restant(s).`
        : `Stock épuisé : ${num(stock)} ${unit} au total.`);
      return;
    }

    setItems((prev) => {
      const i2 = prev.findIndex((it) =>
        it.product_id === item.product_id && it.variant === item.variant && it.unit_name === item.unit_name);
      if (i2 >= 0) return prev.map((it, i) => i === i2 ? { ...it, qty: desired } : it);
      return [...prev, { ...item, qty: desired }];
    });
  };

  // Confirmation du sélecteur → résout le prix (matrice) et ajoute au ticket.
  const handlePickerAdd = (product: ProductRow, variant: string | undefined, unitName: string, qty: number) => {
    const factor = unitFactor(product, unitName);
    const price = resolvePrice(product, unitName, variant);
    pushItem({
      product_id: product.id, product_code: product.code, product_name: product.name,
      variant, unit_name: unitName, unit_factor: factor, qty,
      unit_price: price, orig_price: price,
    });
    setPicker(null);
  };

  const setItemQty = (idx: number, qty: number) => {
    if (qty <= 0) return;
    const line = items[idx];
    if (!line) return;
    const stock = stockOf(line.product_id);
    const factor = baseFactor(line);
    const baseOthers = items.reduce((s, it, i) =>
      (it.product_id === line.product_id && i !== idx) ? s + it.qty * baseFactor(it) : s, 0);
    const maxLineQty = Math.max(0, (stock - baseOthers) / factor);

    // Quantité demandée au-delà du disponible : on refuse, on garde la valeur courante.
    if (qty > maxLineQty + 1e-6) {
      const unit = products.find((p) => p.id === line.product_id)?.base_unit ?? '';
      const remaining = Math.max(0, stock - baseOthers);
      showToast(`Stock insuffisant : ${num(remaining)} ${unit} restant(s).`);
      return;
    }
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, qty } : it));
  };

  const updatePrice = (idx: number, price: number) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, unit_price: price } : it));
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetTicket = () => {
    setItems([]);
    setDiscount(0);
    setDiscountInput('');
    setSelectedClientId(undefined);
    setClientSearch('');
    setLastSaleRef(null);
    setLastReceipt(null);
    clearPosCart();
  };

  // ---------------------------------------------------------------------------
  // Encaissement
  // ---------------------------------------------------------------------------
  const handleConfirmSale = async (payments: SalePaymentInput[]) => {
    setBusy(true);
    // Jeton anti-doublon : stable tant que l'encaissement n'a pas abouti (rejeu/double-clic = même vente).
    if (!saleKeyRef.current) saleKeyRef.current = crypto.randomUUID();
    try {
      const sale = await api.sales.createSale({
        client_id: selectedClientId,
        items: items.map((it) => ({
          product_id: it.product_id,
          product_code: it.product_code,
          product_name: it.product_name,
          variant: it.variant,
          unit_name: it.unit_name,
          unit_factor: it.unit_factor,
          qty: it.qty,
          unit_price: it.unit_price,
          orig_price: it.unit_price !== it.orig_price ? it.orig_price : undefined,
        })),
        payments,
        discount: discountAmount,
        cash_session_id: cashSessionId,
        idempotency_key: saleKeyRef.current,
      });
      saleKeyRef.current = '';
      // Capturer le reçu (snapshot du ticket) pour impression
      setLastReceipt({
        ref: sale.ref,
        date: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        commerceName: commerce.name, commerceCity: commerce.city, seller: sellerName,
        client: selectedClient?.name,
        items: items.map((it) => ({
          name: it.product_name, variant: it.variant, unit: it.unit_name,
          qty: it.qty, unitPrice: it.unit_price, total: it.qty * it.unit_price,
        })),
        subtotal, discount: discountAmount, total,
        payments: payments.map((p) => ({ label: p.mode_label, amount: p.amount })),
        header: ticketCfg.header, footer: ticketCfg.footer,
        showSeller: ticketCfg.showSeller, showClient: ticketCfg.showClient,
      });
      setLastSaleRef(sale.ref);
      setShowEncaissement(false);
      // Vente validée : vider le panier persistant (ne pas le retrouver en revenant).
      clearPosCart();
      // Recharger les stocks après vente
      api.catalog.listProducts().then(setProducts).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtres catalogue
  // ---------------------------------------------------------------------------
  const filteredProducts = products.filter((p) => {
    // On n'écarte plus les ruptures : elles s'affichent désactivées (cf. carte produit).
    const matchCat = activeCat === 'Tous' || p.category_name === activeCat;
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const catTabs = ['Tous', ...categories.map((c) => c.name)];
  const selectedClient = clients.find((c) => c.id === selectedClientId);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <span className="spinner" />
      </div>
    );
  }

  // Écran de succès
  if (lastSaleRef) {
    return (
      <div className="pos-success">
        <div className="pos-success-card">
          <div style={{
            width: 56, height: 56, background: 'var(--cr-good-lt)', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--cr-good)', marginBottom: 12,
          }}>
            <Icon name="check" size={28} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Vente enregistrée</div>
          <div className="mono" style={{ fontSize: 15, color: 'var(--cr-ink-2)', marginBottom: 20 }}>
            {lastSaleRef}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            <button className="cr-btn cr-btn-secondary cr-btn-lg" onClick={() => window.print()}
              style={{ justifyContent: 'center', width: '100%' }}>
              <Icon name="printer" size={15} /> Imprimer le reçu
            </button>
            <button className="cr-btn cr-btn-primary cr-btn-lg" onClick={resetTicket}
              style={{ justifyContent: 'center', width: '100%' }}>
              <Icon name="plus" size={15} /> Nouvelle vente
            </button>
          </div>
        </div>
        {lastReceipt && <Receipt data={lastReceipt} />}
      </div>
    );
  }

  return (
    <div className="pos-layout">
      {/* ===== CATALOGUE (gauche) ===== */}
      <div className="pos-catalog">
        {/* Filtres */}
        <div className="pos-catalog-bar">
          <div className="cr-input-wrap" style={{ flex: 1 }}>
            <Icon name="search" size={14} className="cr-input-icon" />
            <input
              className="cr-input"
              style={{ height: 34 }}
              placeholder="Rechercher un produit…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="pos-cat-tabs">
          {catTabs.map((cat) => (
            <button
              key={cat}
              className={`pos-cat-tab${activeCat === cat ? ' active' : ''}`}
              onClick={() => setActiveCat(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Grille produits */}
        <div className="pos-catalog-grid">
          {filteredProducts.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 32, color: 'var(--cr-ink-3)' }}>
              Aucun produit disponible.
            </div>
          ) : (
            filteredProducts.map((p) => {
              const status = stockStatus(p.stock, p.stock_min);
              const rupture = p.stock <= 0;
              return (
                <button key={p.id} className="pos-product-card" disabled={rupture}
                  onClick={() => !rupture && onProductClick(p)}
                  style={rupture ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                  <PhotoSlot entityType="product" entityId={p.id} fallbackIcon="box" size={40} />
                  <div style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'center', lineHeight: 1.3 }}>
                    {p.name}
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--cr-accent)', fontWeight: 600 }}>
                    {moneyShort(p.price)} GNF
                  </div>
                  <div style={{ fontSize: 10.5, color: rupture ? 'var(--cr-danger)' : `var(--cr-${status.tone})` }}>
                    {rupture ? 'Rupture' : `${num(p.stock)} ${p.base_unit}`}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ===== TICKET (droite) ===== */}
      <div className="pos-ticket">
        <div className="pos-ticket-head">
          <span style={{ fontWeight: 600, fontSize: 14 }}>Ticket en cours</span>
          {items.length > 0 && (
            <button className="cr-btn cr-btn-ghost" style={{ height: 28, padding: '0 10px', fontSize: 12 }}
              onClick={resetTicket}>
              Vider
            </button>
          )}
        </div>

        {/* Lignes du ticket */}
        <div className="pos-ticket-items">
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--cr-ink-3)', fontSize: 13 }}>
              Cliquez sur un produit pour l'ajouter
            </div>
          ) : (
            items.map((item, idx) => (
              <TicketLine
                key={`${item.product_id}-${item.variant ?? ''}-${idx}`}
                item={item}
                onQtySet={(v) => setItemQty(idx, v)}
                onPriceChange={(p) => updatePrice(idx, p)}
                onRemove={() => removeItem(idx)}
              />
            ))
          )}
        </div>

        {/* Résumé financier */}
        {items.length > 0 && (
          <div className="pos-ticket-summary">
            <div className="pos-summary-row">
              <span>Sous-total</span>
              <span className="mono">{money(subtotal)}</span>
            </div>

            {/* Remise */}
            <div className="pos-summary-row">
              <span>Remise</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div className="auth-tabs" style={{ width: 80, borderRadius: 5 }}>
                  <button className={`auth-tab${discountMode === 'GNF' ? ' active' : ''}`}
                    style={{ fontSize: 11 }} onClick={() => { setDiscountMode('GNF'); applyDiscount(discountInput, 'GNF'); }}>
                    GNF
                  </button>
                  <button className={`auth-tab${discountMode === '%' ? ' active' : ''}`}
                    style={{ fontSize: 11 }} onClick={() => { setDiscountMode('%'); applyDiscount(discountInput, '%'); }}>
                    %
                  </button>
                </div>
                <input
                  className="cr-input mono"
                  style={{ width: 90, height: 30, fontSize: 12, textAlign: 'right' }}
                  type="number" min="0"
                  placeholder="0"
                  value={discountInput}
                  onChange={(e) => applyDiscount(e.target.value, discountMode)}
                />
              </div>
            </div>

            {discountAmount > 0 && (
              <div className="pos-summary-row" style={{ color: 'var(--cr-good)', fontSize: 12 }}>
                <span>Économie</span>
                <span className="mono">- {money(discountAmount)}</span>
              </div>
            )}

            <div className="pos-summary-total">
              <span>TOTAL</span>
              <span className="mono num-display">{money(total)}</span>
            </div>

            {/* Client */}
            <div className="cr-field" style={{ marginTop: 8 }}>
              <label className="cr-label">Client (optionnel)</label>
              <input
                className="cr-input"
                list="pos-clients-list"
                placeholder="Rechercher un client…"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  const found = clients.find(
                    (c) => c.name.toLowerCase() === e.target.value.toLowerCase()
                  );
                  setSelectedClientId(found?.id);
                }}
              />
              <datalist id="pos-clients-list">
                {clients.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
              {selectedClient && (
                <div style={{ fontSize: 11.5, color: 'var(--cr-ink-3)' }}>
                  {selectedClient.group_name}
                  {selectedClient.credit_limit > 0 && ` · plafond crédit ${moneyShort(selectedClient.credit_limit)} GNF`}
                </div>
              )}
            </div>

            {/* Bouton encaisser */}
            <button
              className="cr-btn cr-btn-primary cr-btn-lg"
              style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              onClick={() => setShowEncaissement(true)}
              disabled={busy || items.length === 0}
            >
              <Icon name="cash" size={16} /> Encaisser {money(total)}
            </button>
          </div>
        )}
      </div>

      {/* Modale encaissement */}
      {showEncaissement && (
        <EncaissementModal
          total={total}
          paymentModes={paymentModes}
          clientId={selectedClientId}
          onConfirm={handleConfirmSale}
          onClose={() => setShowEncaissement(false)}
        />
      )}

      {picker && (
        <ProductPicker
          product={picker}
          onAdd={handlePickerAdd}
          onClose={() => setPicker(null)}
        />
      )}

      {toast && (
        <div className="toast-wrap">
          <div className="toast toast-error">{toast}</div>
        </div>
      )}
    </div>
  );
}
