import { money, num } from '../../lib/format';

export interface ReceiptData {
  ref: string;
  date: string;
  commerceName: string;
  commerceCity?: string;
  seller?: string;
  client?: string;
  items: { name: string; variant?: string; unit: string; qty: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  total: number;
  payments: { label: string; amount: number }[];
  /** Config tickets (Paramètres → Tickets) */
  header?: string;       // ligne libre sous la ville (adresse, téléphone…)
  footer?: string;       // message de pied (par défaut « Merci de votre visite ! »)
  showSeller?: boolean;  // afficher le vendeur (défaut true)
  showClient?: boolean;  // afficher le client (défaut true)
}

// Reçu thermique 80 mm — rendu hors écran, visible seulement à l'impression (CSS @media print).
export function Receipt({ data }: { data: ReceiptData }) {
  const received = data.payments.filter((p) => p.label !== 'Crédit client').reduce((s, p) => s + p.amount, 0);
  const credit = data.payments.filter((p) => p.label === 'Crédit client').reduce((s, p) => s + p.amount, 0);
  return (
    <div className="receipt-print">
      <div className="rcp-center rcp-name">{data.commerceName}</div>
      {data.commerceCity && <div className="rcp-center rcp-sub">{data.commerceCity}</div>}
      {data.header && <div className="rcp-center rcp-sub">{data.header}</div>}
      <div className="rcp-sep" />

      <div className="rcp-line"><span>Reçu</span><span>{data.ref}</span></div>
      <div className="rcp-line"><span>Date</span><span>{data.date}</span></div>
      {data.showSeller !== false && data.seller && <div className="rcp-line"><span>Vendeur</span><span>{data.seller}</span></div>}
      {data.showClient !== false && <div className="rcp-line"><span>Client</span><span>{data.client || 'Comptoir'}</span></div>}
      <div className="rcp-sep" />

      {data.items.map((it, i) => (
        <div key={i} className="rcp-item">
          <div className="rcp-item-name">{it.name}{it.variant ? ` · ${it.variant}` : ''}</div>
          <div className="rcp-line">
            <span>{num(it.qty)} {it.unit} × {money(it.unitPrice)}</span>
            <span>{money(it.total)}</span>
          </div>
        </div>
      ))}
      <div className="rcp-sep" />

      <div className="rcp-line"><span>Sous-total</span><span>{money(data.subtotal)}</span></div>
      {data.discount > 0 && <div className="rcp-line"><span>Remise</span><span>- {money(data.discount)}</span></div>}
      <div className="rcp-line rcp-total"><span>TOTAL</span><span>{money(data.total)}</span></div>
      <div className="rcp-sep" />

      {data.payments.map((p, i) => (
        <div key={i} className="rcp-line"><span>{p.label}</span><span>{money(p.amount)}</span></div>
      ))}
      {received > data.total && (
        <div className="rcp-line"><span>Rendu</span><span>{money(received - data.total)}</span></div>
      )}
      {credit > 0 && (
        <div className="rcp-line"><span>Reste dû (crédit)</span><span>{money(credit)}</span></div>
      )}

      <div className="rcp-sep" />
      <div className="rcp-center rcp-foot">{data.footer || 'Merci de votre visite !'}</div>
      <div className="rcp-center rcp-foot rcp-small">KOMERSA</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Génère un reçu HTML autonome (fichier .html à exporter / partager).
// ---------------------------------------------------------------------------
export function receiptHtml(data: ReceiptData): string {
  const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const received = data.payments.filter((p) => p.label !== 'Crédit client').reduce((s, p) => s + p.amount, 0);
  const credit = data.payments.filter((p) => p.label === 'Crédit client').reduce((s, p) => s + p.amount, 0);
  const line = (l: string, r: string) => `<div class="l"><span>${esc(l)}</span><span>${esc(r)}</span></div>`;
  const sep = '<div class="sep"></div>';

  const items = data.items.map((it) =>
    `<div class="it"><div class="nm">${esc(it.name)}${it.variant ? ` · ${esc(it.variant)}` : ''}</div>`
    + `<div class="l"><span>${num(it.qty)} ${esc(it.unit)} × ${esc(money(it.unitPrice))}</span><span>${esc(money(it.total))}</span></div></div>`,
  ).join('');
  const pays = data.payments.map((p) => line(p.label, money(p.amount))).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Reçu ${esc(data.ref)}</title>
<style>
  body{margin:0;background:#f0f2f4;font-family:'Courier New',monospace;color:#111;padding:20px;}
  .receipt{width:300px;margin:0 auto;background:#fff;padding:18px 16px;box-shadow:0 2px 10px rgba(0,0,0,.1);font-size:12.5px;line-height:1.5;}
  .center{text-align:center;}
  .name{font-weight:700;font-size:15px;}
  .sub{color:#555;font-size:11.5px;}
  .sep{border-top:1px dashed #999;margin:8px 0;}
  .l{display:flex;justify-content:space-between;gap:8px;}
  .it{margin:4px 0;}
  .nm{font-weight:600;}
  .total{font-weight:700;font-size:14px;}
  .foot{margin-top:2px;}
  .small{font-size:10px;color:#888;}
  @media print{body{background:#fff;padding:0;}.receipt{box-shadow:none;width:auto;}}
</style></head>
<body><div class="receipt">
  <div class="center name">${esc(data.commerceName)}</div>
  ${data.commerceCity ? `<div class="center sub">${esc(data.commerceCity)}</div>` : ''}
  ${data.header ? `<div class="center sub">${esc(data.header)}</div>` : ''}
  ${sep}
  ${line('Reçu', data.ref)}
  ${line('Date', data.date)}
  ${(data.showSeller !== false && data.seller) ? line('Vendeur', data.seller) : ''}
  ${(data.showClient !== false) ? line('Client', data.client || 'Comptoir') : ''}
  ${sep}
  ${items}
  ${sep}
  ${line('Sous-total', money(data.subtotal))}
  ${data.discount > 0 ? line('Remise', '- ' + money(data.discount)) : ''}
  <div class="l total"><span>TOTAL</span><span>${esc(money(data.total))}</span></div>
  ${sep}
  ${pays}
  ${received > data.total ? line('Rendu', money(received - data.total)) : ''}
  ${credit > 0 ? line('Reste dû (crédit)', money(credit)) : ''}
  ${sep}
  <div class="center foot">${esc(data.footer || 'Merci de votre visite !')}</div>
  <div class="center foot small">KOMERSA</div>
</div></body></html>`;
}
