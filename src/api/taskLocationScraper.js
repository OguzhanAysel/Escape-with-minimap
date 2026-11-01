/**
 * Tarkov Fandom Wiki üzerinden görevlerin gerçek konum/oda/kasa/anahtar yer fotoğraflarını
 * (Location Images / Guide Galleries) çeker ve yerel assets/task-locations/ klasörüne kaydeder.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'task-locations');
const MAPPING_FILE = path.join(ASSETS_DIR, 'task_locations_map.json');

function httpsGetJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'TarkovMapOverlay/1.0 (Desktop App)' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (_e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function downloadImage(url, destPath) {
  return new Promise((resolve) => {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
      return resolve(true);
    }
    const cleanUrl = url.split('/revision/latest')[0];
    https.get(cleanUrl, { headers: { 'User-Agent': 'TarkovMapOverlay/1.0 (Desktop App)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location, destPath).then(resolve);
      }
      if (res.statusCode !== 200) return resolve(false);
      const stream = fs.createWriteStream(destPath);
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        resolve(true);
      });
      stream.on('error', () => resolve(false));
    }).on('error', () => resolve(false));
  });
}

async function scrapeSingleTask(t, mapping) {
  if (!t.wikiLink) return null;
  const pageName = t.wikiLink.split('/wiki/')[1];
  if (!pageName) return null;
  if (mapping[t.id] && mapping[t.id].length > 0) return null;

  const parseUrl = `https://escapefromtarkov.fandom.com/api.php?action=parse&page=${encodeURIComponent(
    pageName
  )}&redirects=1&prop=wikitext&format=json`;

  const res = await httpsGetJson(parseUrl);
  const wt = res?.parse?.wikitext?.['*'] || '';
  if (!wt) return null;

  // Gallery içindeki veya Guide bölümündeki resimleri yakala
  const galleryMatches = [...wt.matchAll(/File:([^|\n\]]+)(?:\|([^\n\]]*))?/gi)];
  const validImages = [];

  for (const m of galleryMatches) {
    const fn = m[1].trim();
    const cap = (m[2] || '').trim();
    const lower = fn.toLowerCase();
    if (
      lower.includes('icon') ||
      lower.includes('banner') ||
      lower.endsWith('.gif') ||
      lower.includes('trader')
    ) {
      continue;
    }
    validImages.push({ filename: fn, caption: cap });
  }

  if (validImages.length === 0) return null;

  // Resimlerin gerçek CDN URL'lerini al (en fazla 4 tane)
  const chosenImages = validImages.slice(0, 4);
  const titles = chosenImages.map((x) => 'File:' + encodeURIComponent(x.filename)).join('|');
  const queryUrl = `https://escapefromtarkov.fandom.com/api.php?action=query&titles=${titles}&prop=imageinfo&iiprop=url&format=json`;
  const qRes = await httpsGetJson(queryUrl);
  const pages = qRes?.query?.pages || {};

  const downloadedEntries = [];
  for (const imgItem of chosenImages) {
    const pageObj = Object.values(pages).find(
      (p) => p.title?.toLowerCase() === ('file:' + imgItem.filename).toLowerCase().replace(/_/g, ' ')
    );
    const cdnUrl = pageObj?.imageinfo?.[0]?.url;
    if (!cdnUrl) continue;

    const safeExt = path.extname(imgItem.filename) || '.png';
    const safeName = `${t.id}_${downloadedEntries.length}${safeExt}`;
    const destPath = path.join(ASSETS_DIR, safeName);

    const ok = await downloadImage(cdnUrl, destPath);
    if (ok) {
      downloadedEntries.push({
        localPath: `../../assets/task-locations/${safeName}`,
        caption: imgItem.caption || 'Görev Konum Görseli',
        originalName: imgItem.filename
      });
    }
  }

  if (downloadedEntries.length > 0) {
    mapping[t.id] = downloadedEntries;
    fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf-8');
    console.log(`[✓] "${t.name}" (${t.normalizedName}) -> ${downloadedEntries.length} konum görseli indirildi.`);
    return downloadedEntries;
  }
  return null;
}

async function scrapeTaskLocationImages(tasksList, maxTasks = 500, concurrency = 4) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  let mapping = {};
  if (fs.existsSync(MAPPING_FILE)) {
    try {
      mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
    } catch (_e) {}
  }

  const tasksToScrape = tasksList.filter((t) => t.wikiLink && (!mapping[t.id] || mapping[t.id].length === 0));
  console.log(`[Task Location Scraper] Toplam ${tasksList.length} görevden eksik olan ${tasksToScrape.length} görev taranıyor...`);

  let count = 0;
  for (let i = 0; i < tasksToScrape.length; i += concurrency) {
    if (count >= maxTasks) break;
    const batch = tasksToScrape.slice(i, i + concurrency);
    await Promise.allSettled(batch.map((task) => scrapeSingleTask(task, mapping)));
    count += batch.length;
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('[Task Location Scraper] Tamamlandı!');
  return mapping;
}

module.exports = {
  scrapeTaskLocationImages,
  MAPPING_FILE
};
