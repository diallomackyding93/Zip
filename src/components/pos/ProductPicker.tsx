import { useState } from 'react';
import { Icon } from '../icons/Icons';
import { money, num } from '../../lib/format';
import { resolvePrice, unitFactor } from '../../lib/pricing';
import type { ProductRow } from '../../lib/types';

interface ProductPickerProps {
  product: ProductRow;
  onAdd: (product: ProductRow, variant: string | undefined, unitName: string, qty: number) => void;
  onClose: () => void;
}

export function ProductPicker({ product, onAdd, onClose }: ProductPickerProps) {
  const hasVariants = product.variants.length > 0;
  const units = [product.base_unit, ...product.units.map((u) => u.name)];
  const hasUnits = product.units.length > 0;

  const [variant, setVariant] = useState<string | undefined>(hasVariants ? product.variants[0].value : undefined);
  const [unitName, setUnitName] = useState(product.base_unit);
  const [qty, setQty] = useState(1);

  const price = resolvePrice(product, unitName, variant);
  const factor = unitFactor(product, unitName);
  const lineTotal = price * qty;

  // Stock de la déclinaison sélectionnée (si stock distinct), sinon stock produit.
  const selectedVariant = product.variants.find((v) => v.value === variant);
  const availableStock = selectedVariant?.stock != null ? selectedVariant.stock : product.stock;

  const handleAdd = () => {
    if (qty <= 0) return;
    onAdd(product, variant, unitName, qty);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ width: 420 }}>
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{product.name}</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{product.code}</div>
          </div>
          <button className="topbar-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div className="modal-body">
          {/* Déclinaison */}
          {hasVariants && (
            <div className="cr-field">
              <label className="cr-label">Déclinaison</label>
              <div className="picker-options">
                {product.variants.map((v) => (
                  <button key={v.value}
                    className={`picker-chip${variant === v.value ? ' on' : ''}`}
                    onClick={() => setVariant(v.value)}>
                    {v.value}
                    {v.stock != null && <small> · {num(v.stock)}</small>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Unité */}
          {hasUnits && (
            <div className="cr-field">
              <label className="cr-label">Unité de vente</label>
              <div className="picker-options">
                {units.map((u) => (
                  <button key={u}
                    className={`picker-chip${unitName === u ? ' on' : ''}`}
                    onClick={() => setUnitName(u)}>
                    {u}
                    <small> · {money(resolvePrice(product, u, variant))}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantité */}
          <div className="cr-field">
            <label className="cr-label">Quantité ({unitName})</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="ticket-qty-btn" style={{ width: 32, height: 32 }}
                onClick={() => setQty((q) => Math.max(1, q - 1))}><Icon name="chevronLeft" size={14} /></button>
              <input className="cr-input mono" type="number" min="0.01" step="any"
                style={{ width: 90, height: 36, textAlign: 'center' }}
                value={qty} onChange={(e) => setQty(Number(e.target.value))} />
              <button className="ticket-qty-btn" style={{ width: 32, height: 32 }}
                onClick={() => setQty((q) => q + 1)}><Icon name="chevronRight" size={14} /></button>
              {factor !== 1 && (
                <span style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
                  = {num(qty * factor)} {product.base_unit}
                </span>
              )}
            </div>
            <div className="cr-hint">Stock disponible : {num(availableStock)} {product.base_unit}</div>
            {qty * factor > availableStock && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4,
                fontSize: 12, color: 'var(--cr-warn)' }}>
                <Icon name="alerts" size={13} />
                Cette quantité dépasse le stock ({num(qty * factor)} &gt; {num(availableStock)} {product.base_unit}).
              </div>
            )}
          </div>

          {/* Récap */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--cr-bg)', borderRadius: 'var(--cr-r)', padding: '12px 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--cr-ink-2)' }}>
              {money(price)} × {num(qty)}
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{money(lineTotal)}</div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="cr-btn cr-btn-secondary" onClick={onClose}>Annuler</button>
          <button className="cr-btn cr-btn-primary" onClick={handleAdd} disabled={qty <= 0}>
            <Icon name="plus" size={14} /> Ajouter au ticket
          </button>
        </div>
      </div>
    </div>
  );
}
