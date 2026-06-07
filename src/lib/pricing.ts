import type { ProductRow } from './types';

/** Nombre d'unités de base par unité vendue (1 balle = 20 rouleaux → 20). */
export function unitFactor(product: ProductRow, unitName: string): number {
  if (!unitName || unitName === product.base_unit) return 1;
  return product.units.find((u) => u.name === unitName)?.factor ?? 1;
}

/**
 * Prix d'un couple (unité, déclinaison). Ordre de résolution :
 * 1. matrice de prix (unité × déclinaison) si renseignée ;
 * 2. prix de l'unité (multi-unités) ;
 * 3. prix de base de la déclinaison (déclinaison sans multi-unité) ;
 * 4. prix du produit.
 */
export function resolvePrice(product: ProductRow, unitName: string, variantValue?: string): number {
  const u = unitName || product.base_unit;
  if (variantValue) {
    const cell = product.prices.find((p) => p.unit === u && p.variant === variantValue);
    if (cell) return cell.price;
  }
  if (u !== product.base_unit) {
    const unit = product.units.find((x) => x.name === u);
    if (unit) return unit.price;
  }
  if (variantValue) {
    const v = product.variants.find((x) => x.value === variantValue);
    if (v && v.price != null) return v.price;
  }
  return product.price;
}
