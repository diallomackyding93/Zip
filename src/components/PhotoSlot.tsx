import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { Icon } from './icons/Icons';
import type { PhotoEntityType } from '../lib/types';

// ---------------------------------------------------------------------------
// PhotoStore — cache + persistance (backend) + diffusion entre instances.
// Reproduit le PhotoStore de la maquette (qui utilisait localStorage) ; ici la
// persistance passe par le backend Rust (set/get/delete_photo).
// La même entité affiche la même photo partout (Stock, POS, Clients, Membres…).
// ---------------------------------------------------------------------------
type Key = string;
const keyOf = (t: PhotoEntityType, id: string): Key => `${t}:${id}`;

const cache = new Map<Key, string | null>();
const inflight = new Map<Key, Promise<string | null>>();
const listeners = new Set<(key: Key) => void>();

function emit(key: Key) { listeners.forEach((fn) => fn(key)); }

export const PhotoStore = {
  /** Valeur en cache (undefined si jamais chargée). */
  peek(t: PhotoEntityType, id: string): string | null | undefined {
    return cache.get(keyOf(t, id));
  },
  /** Charge depuis le backend (dédupliqué). */
  async load(t: PhotoEntityType, id: string): Promise<string | null> {
    const k = keyOf(t, id);
    if (cache.has(k)) return cache.get(k)!;
    if (inflight.has(k)) return inflight.get(k)!;
    const p = api.photos.get(t, id)
      .then((v) => { cache.set(k, v ?? null); inflight.delete(k); return v ?? null; })
      .catch(() => { cache.set(k, null); inflight.delete(k); return null; });
    inflight.set(k, p);
    return p;
  },
  async set(t: PhotoEntityType, id: string, dataUrl: string) {
    const k = keyOf(t, id);
    cache.set(k, dataUrl);
    emit(k);
    await api.photos.set(t, id, dataUrl);
  },
  async clear(t: PhotoEntityType, id: string) {
    const k = keyOf(t, id);
    cache.set(k, null);
    emit(k);
    await api.photos.delete(t, id);
  },
  subscribe(fn: (key: Key) => void) { listeners.add(fn); return () => listeners.delete(fn); },
};

// ---------------------------------------------------------------------------
// downscaleImage — redimensionne un File en JPEG borné (canvas), comme la maquette.
// ---------------------------------------------------------------------------
export function downscaleImage(file: File, maxDim = 480, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      const ctx = c.getContext('2d');
      if (!ctx) { reject(new Error('canvas')); return; }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.onload = () => { img.src = reader.result as string; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Lightbox global (agrandissement) — comme la maquette.
// ---------------------------------------------------------------------------
export function openLightbox(src: string) {
  if (!src) return;
  const back = document.createElement('div');
  back.className = 'photo-lightbox';
  const img = document.createElement('img');
  img.src = src;
  back.appendChild(img);
  back.addEventListener('click', () => back.remove());
  document.body.appendChild(back);
}

// ---------------------------------------------------------------------------
// Hook : suit la photo d'une entité, se met à jour quand elle change ailleurs.
// ---------------------------------------------------------------------------
function useEntityPhoto(t: PhotoEntityType, id: string): string | null {
  const disabled = !id || id === '__none__';
  const [url, setUrl] = useState<string | null>(() => disabled ? null : (PhotoStore.peek(t, id) ?? null));
  useEffect(() => {
    if (disabled) { setUrl(null); return; }
    let active = true;
    PhotoStore.load(t, id).then((v) => { if (active) setUrl(v); });
    const unsub = PhotoStore.subscribe((k) => { if (k === keyOf(t, id)) setUrl(PhotoStore.peek(t, id) ?? null); });
    return () => { active = false; unsub(); };
  }, [t, id, disabled]);
  return url;
}

function initialsOf(name: string): string {
  return (name || '').split(/[\s·]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
}

// ---------------------------------------------------------------------------
// PhotoSlot — fidèle à la maquette : clic ou glisser-déposer, lightbox au clic,
// repli initiales (personne) / icône (produit), overlay d'ajout, état busy.
// ---------------------------------------------------------------------------
interface PhotoSlotProps {
  /** Mode lié (persistance backend immédiate) : requis hors brouillon. */
  entityType?: PhotoEntityType;
  entityId?: string;
  /** Mode brouillon (création) : la photo est tenue par le parent, pas persistée. */
  draft?: boolean;
  value?: string | null;
  onChange?: (dataUrl: string | null) => void;
  /** Nom (pour initiales et title) — entités "personne". */
  name?: string;
  /** Icône de repli — entités "objet" (produit, compte…). */
  fallbackIcon?: string;
  kind?: 'person' | 'product';
  shape?: 'circle' | 'square';
  size?: number;
  editable?: boolean;
  zoomable?: boolean;
}

export function PhotoSlot({
  entityType, entityId, draft = false, value = null, onChange,
  name, fallbackIcon, kind, shape, size = 40, editable = false, zoomable = true,
}: PhotoSlotProps) {
  // En mode brouillon, l'image vient des props (contrôlé) ; sinon du store backend.
  const boundUrl = useEntityPhoto(
    draft ? 'product' : (entityType ?? 'product'),
    draft || !entityId ? '__none__' : entityId,
  );
  const url = draft ? value : boundUrl;

  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const resolvedKind = kind ?? (fallbackIcon ? 'product' : 'person');
  const sh = shape ?? (resolvedKind === 'product' ? 'square' : 'circle');

  const handleFile = useCallback((file: File | undefined) => {
    if (!file || !/^image\//.test(file.type)) return;
    setBusy(true);
    downscaleImage(file)
      .then((dataUrl) => {
        if (draft) onChange?.(dataUrl);
        else if (entityType && entityId) return PhotoStore.set(entityType, entityId, dataUrl);
      })
      .finally(() => setBusy(false));
  }, [draft, onChange, entityType, entityId]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDrag(false);
    handleFile(e.dataTransfer.files?.[0]);
  };
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (url && zoomable && !e.altKey) { openLightbox(url); return; }
    if (editable) inputRef.current?.click();
  };
  const onRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Retirer cette photo ?')) return;
    if (draft) onChange?.(null);
    else if (entityType && entityId) PhotoStore.clear(entityType, entityId);
  };

  const radius = sh === 'circle' ? '50%' : `${Math.max(6, size * 0.22)}px`;

  return (
    <span
      className={`photo-slot ${sh} ${url ? 'has-img' : 'empty'} ${drag ? 'dragover' : ''} kind-${resolvedKind}`}
      style={{ width: size, height: size, borderRadius: radius, fontSize: `${Math.max(10, size * 0.34)}px` }}
      onClick={onClick}
      onDragOver={editable ? (e) => { e.preventDefault(); setDrag(true); } : undefined}
      onDragLeave={editable ? () => setDrag(false) : undefined}
      onDrop={editable ? onDrop : undefined}
      title={editable
        ? (url ? 'Cliquer pour agrandir · Alt+clic pour remplacer' : 'Glisser une image ou cliquer pour ajouter')
        : (name || '')}
    >
      {url
        ? <img src={url} alt={name || ''} style={{ borderRadius: radius }} />
        : <span className="photo-fallback">
            {resolvedKind === 'product'
              ? <Icon name={fallbackIcon ?? 'box'} size={Math.round(size * 0.42)} />
              : initialsOf(name ?? '')}
          </span>}
      {editable && !url ? <span className="photo-add"><Icon name="plus" size={Math.max(10, size * 0.3)} /></span> : null}
      {editable && url ? <button className="photo-rm" onClick={onRemove} title="Retirer la photo"><Icon name="x" size={Math.max(9, size * 0.26)} /></button> : null}
      {busy ? <span className="photo-busy" /> : null}
      {editable ? (
        <input ref={inputRef} type="file" accept="image/*" hidden
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
      ) : null}
    </span>
  );
}
