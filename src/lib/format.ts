/** Formate un montant GNF : 1 245 000 GNF */
export function money(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  return n.toLocaleString('fr-FR').replace(/ /g, ' ') + ' GNF';
}

/** Formate un montant en version courte : 1,2M / 450k / 80 */
export function moneyShort(amount: number): string {
  const n = Math.abs(Number(amount) || 0);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.', ',') + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'k';
  return String(Math.round(n));
}

/** Formate un nombre avec espaces : 1 245 */
export function num(value: number): string {
  return (Number(value) || 0).toLocaleString('fr-FR').replace(/ /g, ' ');
}

/** Retourne le statut stock d'un produit */
export function stockStatus(stock: number, stockMin: number): { label: string; tone: string } {
  if (stock <= 0) return { label: 'Rupture', tone: 'danger' };
  if (stockMin > 0 && stock <= stockMin) return { label: 'Stock faible', tone: 'warn' };
  return { label: 'En stock', tone: 'good' };
}
