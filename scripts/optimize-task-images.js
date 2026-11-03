#!/usr/bin/env node
/**
 * Görev konum görsellerini (assets/task-locations/*.png|jpg) WebP'ye dönüştürür ve
 * task_locations_map.json içindeki yolları günceller.
 *
 * Kullanım:
 *   npm run optimize-images                 -> dönüştür + mapping'i güncelle (orijinaller kalır)
 *   npm run optimize-images -- --delete-originals   -> başarılı dönüşümden sonra PNG/JPG'leri sil
 *   npm run optimize-images -- --quality=85 --max-width=1920
 *
 * Her görsele ayrıca `kind` ('photo' | 'map' | 'icon'), `width`, `height` alanları eklenir.
 * Overlay yalnızca kind === 'photo' olanları gösterir (main.js -> classifyTaskImage).
 * Script tekrar çalıştırılabilir: zaten .webp olan girişler yalnızca yeniden sınıflandırılır.
 */
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (_e) {
  console.error('[!] "sharp" bulunamadı. Önce şunu çalıştırın:  npm install --save-dev sharp');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'task-locations');
const MAPPING_FILE = path.join(DIR, 'task_locations_map.json');

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const DELETE_ORIGINALS = args.includes('--delete-originals');
const QUALITY = Math.max(40, Math.min(100, parseInt(argVal('quality', '82'), 10) || 82));
const MAX_WIDTH = Math.max(640, parseInt(argVal('max-width', '1920'), 10) || 1920);

const RASTER_EXT = /\.(png|jpe?g)$/i;
const { classifyTaskImage } = require('../src/taskImageFilter');


const fmt = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

(async () => {
  if (!fs.existsSync(MAPPING_FILE)) {
    console.error(`[!] Mapping dosyası yok: ${MAPPING_FILE}`);
    process.exit(1);
  }

  const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
  const needsConversion = Object.values(mapping)
    .flat()
    .some((img) => img && img.localPath && RASTER_EXT.test(img.localPath));
  let backup = null;
  if (needsConversion) {
    backup = MAPPING_FILE.replace(/\.json$/, `.backup-${Date.now()}.json`);
    fs.copyFileSync(MAPPING_FILE, backup);
  }

  const converted = new Map(); // kaynak dosya adı -> { webpName, width, height }
  const toDelete = new Set();
  let before = 0;
  let after = 0;
  let failed = 0;
  const counts = { photo: 0, map: 0, icon: 0 };

  const entries = Object.values(mapping).flat().filter((img) => img && img.localPath);
  console.log(`[i] ${entries.length} görsel girişi işleniyor (kalite=${QUALITY}, max genişlik=${MAX_WIDTH})...`);

  for (const img of entries) {
    const fname = path.basename(img.localPath);
    const src = path.join(DIR, fname);

    if (RASTER_EXT.test(fname)) {
      let info = converted.get(fname);
      if (!info) {
        if (!fs.existsSync(src)) {
          console.warn(`  [-] Bulunamadı, atlandı: ${fname}`);
          failed++;
          continue;
        }
        const webpName = fname.replace(RASTER_EXT, '.webp');
        const dest = path.join(DIR, webpName);
        try {
          const meta = await sharp(src).metadata();
          await sharp(src)
            .rotate()
            .resize({ width: MAX_WIDTH, withoutEnlargement: true })
            .webp({ quality: QUALITY, effort: 5, smartSubsample: true })
            .toFile(dest);
          before += fs.statSync(src).size;
          after += fs.statSync(dest).size;
          info = { webpName, width: Math.min(meta.width || 0, MAX_WIDTH), height: meta.height || 0 };
          if (meta.width > MAX_WIDTH) info.height = Math.round((meta.height * MAX_WIDTH) / meta.width);
          converted.set(fname, info);
          toDelete.add(src);
        } catch (err) {
          console.warn(`  [!] Dönüştürülemedi: ${fname} (${err.message})`);
          failed++;
          continue;
        }
      }
      img.localPath = `../../assets/task-locations/${info.webpName}`;
      img.width = info.width;
      img.height = info.height;
    } else if (/\.webp$/i.test(fname)) {
      if ((!img.width || !img.height) && fs.existsSync(src)) {
        const meta = await sharp(src).metadata();
        img.width = meta.width || 0;
        img.height = meta.height || 0;
      }
      // Önceki çalıştırmadan kalan orijinaller (--delete-originals ile temizlenir)
      const base = fname.replace(/\.webp$/i, '');
      for (const ext of ['.png', '.PNG', '.jpg', '.jpeg', '.JPG']) {
        const leftover = path.join(DIR, base + ext);
        if (fs.existsSync(leftover)) toDelete.add(leftover);
      }
    }

    const outFile = path.join(DIR, path.basename(img.localPath));
    const bytes = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
    // Küçük dosya eşiği orijinal boyuta göre değerlendirilir (WebP sonrası her şey küçülür)
    const srcBytes = fs.existsSync(src) ? fs.statSync(src).size : bytes;
    delete img.kind; // yeniden sınıflandır
    img.kind = classifyTaskImage(img, { width: img.width, bytes: srcBytes });
    counts[img.kind]++;
  }

  fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf-8');

  if (DELETE_ORIGINALS) {
    for (const f of toDelete) {
      try {
        fs.unlinkSync(f);
      } catch (_e) {}
    }
  }

  console.log('');
  console.log(`[✓] ${converted.size} dosya WebP'ye dönüştürüldü: ${fmt(before)} -> ${fmt(after)}` +
    (before ? ` (%${Math.round((1 - after / before) * 100)} küçüldü)` : ''));
  console.log(`[i] Sınıflandırma: ${counts.photo} fotoğraf, ${counts.map} harita krokisi, ${counts.icon} ikon (yalnızca fotoğraflar gösterilir)`);
  if (failed) console.log(`[!] ${failed} görsel işlenemedi (yukarıdaki uyarılara bakın).`);
  console.log(backup ? `[i] Mapping güncellendi, yedek: ${path.basename(backup)}` : '[i] Mapping zaten WebP; yalnızca sınıflandırma tazelendi.');
  console.log(
    DELETE_ORIGINALS
      ? '[i] Orijinal PNG/JPG dosyaları silindi.'
      : '[i] Orijinal PNG/JPG dosyaları duruyor (build bunları zaten dışlar). Silmek için: --delete-originals'
  );
})();
