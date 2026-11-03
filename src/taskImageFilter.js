/**
 * Görev konum görsellerini sınıflandırır.
 *   'photo' -> oyun içi gerçek ekran görüntüsü (oda, kapı, kasa, zula...)  => overlay'de GÖSTERİLİR
 *   'map'   -> 2D kuşbakışı harita / kroki / kat planı                       => gösterilmez
 *   'icon'  -> wiki eşya ikonu, envanter/modlama ekranı, küçük not görseli  => gösterilmez
 *
 * Hem main.js (çalışma zamanı filtresi) hem scripts/optimize-task-images.js (WebP dönüşümü) kullanır.
 */

const MIN_PHOTO_WIDTH = 200; // px — bunun altı ikon kabul edilir
const MIN_PHOTO_BYTES = 15 * 1024; // 15 KB — bunun altı ikon / not görseli kabul edilir

function stripExt(name) {
  return name.replace(/\.(png|jpe?g|webp|gif)$/i, '');
}

function classifyTaskImage(img, fileInfo = {}) {
  if (!img || !img.localPath) return 'invalid';
  // optimize-task-images.js tarafından önceden sınıflandırıldıysa ona güven
  if (img.kind === 'photo' || img.kind === 'map' || img.kind === 'icon') return img.kind;

  const caption = String(img.caption || '').toLowerCase().trim();
  const orig = String(img.originalName || '').toLowerCase().trim();
  const text = `${caption} ${orig}`;

  // --- İkonlar: wiki "link=" / "800px|" / "frameless" başlıkları, çok küçük görseller ---
  if (/(^|\|)\s*link=/.test(caption) || /\d+px\|/.test(caption) || caption.includes('frameless')) return 'icon';
  const width = typeof img.width === 'number' ? img.width : fileInfo.width;
  if (typeof width === 'number' && width > 0 && width < MIN_PHOTO_WIDTH) return 'icon';
  if (typeof fileInfo.bytes === 'number' && fileInfo.bytes > 0 && fileInfo.bytes < MIN_PHOTO_BYTES) return 'icon';

  // --- 2D harita / kroki / kat planı ---
  const origBase = stripExt(orig);
  if (
    caption.startsWith('[[') || // "[[Customs" -> wiki harita galerisi (kuşbakışı harita)
    caption.includes('locations on') || // "Pieces of fabric locations on Interchange"
    /locations$/.test(origBase) || // "Textile 1 and 2 locations.png"
    text.includes('marked on map') ||
    text.includes('on the map') ||
    text.includes('on map') ||
    text.includes('floor map') ||
    text.includes('floorplan') ||
    text.includes('floor plan') ||
    text.includes('overview') ||
    text.includes('layout') ||
    text.includes('schematic') ||
    text.includes('mapguide') ||
    text.includes('harita') ||
    /\bmap\b(?!\s*marker)/.test(caption) || // "Map marker 1: ..." gerçek ekran görüntüsüdür, elenmez
    /map\d*$/.test(origBase) || // "AdministratorMap.png", "Dorms map2.png"
    /(^|[^a-z])map([^a-z]|$)/.test(origBase)
  ) {
    return 'map';
  }

  return 'photo';
}

module.exports = { classifyTaskImage, MIN_PHOTO_WIDTH, MIN_PHOTO_BYTES };
