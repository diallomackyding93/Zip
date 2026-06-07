import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { Icon } from './icons/Icons';
import { downscaleImage, openLightbox } from './PhotoSlot';
import type { AttachmentRow, AttachmentOwner } from '../lib/types';

interface InvoiceGalleryProps {
  /** Mode lié : type + id du propriétaire (dépense, achat, dette). */
  ownerType?: AttachmentOwner;
  ownerId?: string;
  /** Mode brouillon (création) : la liste est tenue par le parent. */
  draft?: boolean;
  value?: string[];                         // data URLs (brouillon)
  onChange?: (urls: string[]) => void;      // brouillon
  label?: string;
  max?: number;
}

// Galerie de justificatifs (photos multiples) — dépenses / achats / dettes.
// Bound (ownerType + ownerId) : ajout/suppression persistés via le backend.
// Draft : la liste de data URLs est gérée par le parent (création).
export function InvoiceGallery({ ownerType, ownerId, draft = false, value = [], onChange, label = 'Justificatifs', max = 6 }: InvoiceGalleryProps) {
  const [items, setItems] = useState<AttachmentRow[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mode lié : charger depuis le backend.
  const load = useCallback(async () => {
    if (draft || !ownerType || !ownerId) return;
    try { setItems(await api.attachments.list(ownerType, ownerId)); } catch { /* ignore */ }
  }, [draft, ownerType, ownerId]);
  useEffect(() => { load(); }, [load]);

  const list = draft ? value.map((u, i) => ({ id: String(i), data_url: u })) : items;

  const addFiles = async (files: FileList) => {
    const room = max - list.length;
    const arr = Array.from(files).filter((f) => /^image\//.test(f.type)).slice(0, room);
    if (!arr.length) return;
    setBusy(true);
    try {
      const urls = await Promise.all(arr.map((f) => downscaleImage(f, 900, 0.8)));
      if (draft) {
        onChange?.([...value, ...urls]);
      } else if (ownerType && ownerId) {
        const added: AttachmentRow[] = [];
        for (const u of urls) added.push(await api.attachments.add(ownerType, ownerId, u));
        setItems((prev) => [...prev, ...added]);
      }
    } finally { setBusy(false); }
  };

  const remove = async (idx: number, att: { id: string }) => {
    if (draft) {
      onChange?.(value.filter((_, i) => i !== idx));
    } else {
      await api.attachments.delete(att.id);
      setItems((prev) => prev.filter((x) => x.id !== att.id));
    }
  };

  return (
    <div className={`invoice-gallery${drag ? ' dragover' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
      <div className="invoice-gallery-head">
        <span className="invoice-gallery-label">
          <Icon name="expenses" size={14} /> {label} <small>{list.length}/{max}</small>
        </span>
        {list.length < max && (
          <button className="invoice-gallery-add" onClick={() => inputRef.current?.click()}>+ Ajouter</button>
        )}
      </div>
      <div className="invoice-thumbs">
        {list.map((u, i) => (
          <span className="invoice-thumb" key={u.id}>
            <img src={u.data_url} alt="" onClick={() => openLightbox(u.data_url)} />
            <button className="invoice-thumb-rm" onClick={() => remove(i, u)} aria-label="Retirer"><Icon name="x" size={11} /></button>
          </span>
        ))}
        {list.length < max && (
          <button className="invoice-drop" onClick={() => inputRef.current?.click()}>
            {busy ? <span className="spinner" /> : <Icon name="plus" size={18} />}
            <small>{drag ? 'Déposez ici' : 'Glisser une photo'}</small>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}
