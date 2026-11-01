/**
 * Escape from Tarkov Ekran Görüntüsü Dosya Adı Parser'ı ve Quaternion -> Yaw (Yön) Hesaplayıcı
 *
 * AÇIKLAMA (Tarkov Screenshot Dosya Adı Formatı):
 * Oyun içinde ekran görüntüsü tuşuna (Home / PrintScreen) basıldığında Tarkov şu formatta bir dosya oluşturur:
 *   Örnek 1 (Standart EFT formatı):
 *     "2026-11-01[17-25]_-245.12, 4.50, -112.80_0.00123, 0.85412, -0.00451, 0.52004_12.45 (0).png"
 *   Örnek 2 (Alternatif ayraç veya boşluklu format):
 *     "2026-11-01[17-25]_142.3, 1.2, -88.4_0.0, -0.38268, 0.0, 0.92388_0.png"
 *
 * Dosya adındaki bileşenler:
 * 1) Tarih ve Saat: YYYY-MM-DD[HH-mm]
 * 2) Oyuncu 3B Konumu (Unity World Space): x, y, z
 *    - x: Doğu/Batı (metre)
 *    - y: Yükseklik/Kat (metre)
 *    - z: Kuzey/Güney (metre)
 * 3) Kamera / Oyuncu Yönü (Unity Quaternion): qx, qy, qz, qw
 *    - Unity Y-yukarı (Y-up), sol-elli (left-handed) koordinat sistemi kullanır.
 *    - Yatay düzlemdeki (XZ) bakış açısı (Yaw / Heading):
 *      siny_cosp = 2 * (qw * qy + qx * qz)
 *      cosy_cosp = 1 - 2 * (qx * qx + qy * qy)
 *      yawRad = Math.atan2(siny_cosp, cosy_cosp)
 *      yawDeg = (yawRad * 180 / Math.PI + 360) % 360
 */

const path = require('path');
const { MAP_CONFIGS } = require('../geo/coordinates');

// Sadece Tarkov koordinatlı ekran görüntüsü dosya adlarını eşleştiren düzenli ifade (Regex).
// Güvenli silme işlemi yalnızca bu desene tam uyan `.png` veya `.jpg` dosyalarında çalışır.
const TARKOV_SCREENSHOT_REGEX =
  /^(?:(\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\])_)?\s*(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)\s*_\s*(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)(?:_.*)?\.(?:png|jpg|jpeg)$/i;

/**
 * Unity Quaternion (qx, qy, qz, qw) değerlerinden yatay bakış açısını (Yaw: 0..360 derece) hesaplar.
 * @param {number} qx
 * @param {number} qy
 * @param {number} qz
 * @param {number} qw
 * @param {number} yawOffsetDeg - Kullanıcının ayarladığı ofset (-180..+180)
 * @returns {number} 0..360 derece arası yön açısı
 */
function quaternionToYawDegrees(qx, qy, qz, qw, yawOffsetDeg = 0) {
  // Quaternion normalize et (olası yuvarlama hatalarına karşı)
  const norm = Math.hypot(qx, qy, qz, qw);
  const nx = norm > 0 ? qx / norm : 0;
  const ny = norm > 0 ? qy / norm : 0;
  const nz = norm > 0 ? qz / norm : 0;
  const nw = norm > 0 ? qw / norm : 1;

  // Unity Y-ekseni etrafındaki dönüş (Yaw / Heading)
  const sinyCosp = 2 * (nw * ny + nx * nz);
  const cosyCosp = 1 - 2 * (nx * nx + ny * ny);
  const yawRad = Math.atan2(sinyCosp, cosyCosp);

  let yawDeg = (yawRad * 180) / Math.PI;
  yawDeg = (yawDeg + Number(yawOffsetDeg || 0)) % 360;
  if (yawDeg < 0) yawDeg += 360;

  return Number(yawDeg.toFixed(1));
}

/**
 * Derece cinsinden yön açısını 8 ana pusula yönüne (K, KD, D, GD, G, GB, B, KB) çevirir.
 * @param {number} deg
 * @returns {string}
 */
function degreesToCompassLabel(deg) {
  const dirs = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  const norm = ((deg % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return dirs[idx];
}

/**
 * Tarkov ekran görüntüsü dosya adını parse eder.
 * Format tutmazsa açık ve anlaşılır bir hata mesajı döndürür.
 *
 * @param {string} filenameOrPath - Dosya adı veya tam yolu
 * @param {number} yawOffsetDeg - Kullanıcı yön ofseti (-180..+180)
 */
function parseScreenshotFilename(filenameOrPath, yawOffsetDeg = 0) {
  if (!filenameOrPath || typeof filenameOrPath !== 'string') {
    return {
      ok: false,
      error: 'Dosya adı boş veya geçersiz.'
    };
  }

  const baseName = path.basename(filenameOrPath.trim());
  const match = baseName.match(TARKOV_SCREENSHOT_REGEX);

  if (!match) {
    return {
      ok: false,
      filename: baseName,
      error:
        'Dosya adı Tarkov koordinat formatına uymuyor. Beklenen format: "YYYY-MM-DD[HH-mm]_X, Y, Z_QX, QY, QZ, QW_...png"'
    };
  }

  const toNum = (str) => parseFloat(String(str).replace(',', '.'));

  const dateTag = match[1] || null;
  const x = toNum(match[2]);
  const y = toNum(match[3]);
  const z = toNum(match[4]);
  const qx = toNum(match[5]);
  const qy = toNum(match[6]);
  const qz = toNum(match[7]);
  const qw = toNum(match[8]);

  if ([x, y, z, qx, qy, qz, qw].some((v) => Number.isNaN(v))) {
    return {
      ok: false,
      filename: baseName,
      error: 'Dosya adındaki koordinat veya quaternion değerleri sayıya dönüştürülemedi.'
    };
  }

  const rawYaw = quaternionToYawDegrees(qx, qy, qz, qw, 0);
  const yaw = quaternionToYawDegrees(qx, qy, qz, qw, yawOffsetDeg);

  return {
    ok: true,
    filename: baseName,
    dateTag,
    position: { x, y, z },
    quaternion: { qx, qy, qz, qw },
    rawYaw,
    yaw,
    compass: degreesToCompassLabel(yaw),
    timestamp: Date.now()
  };
}

/**
 * Koordinat (x, y, z) ve API harita verisindeki gerçek noktalara (lootLoose, lootContainers, extracts)
 * en yakın mesafeyi hesaplayarak oyuncunun hangi haritada olduğunu tahmin eder.
 *
 * Not: Kullanıcı dilerse bu otomatik harita tahminini açıp kapatabilir; elle seçim her zaman önceliklidir.
 *
 * @param {{x: number, y: number, z: number}} position
 * @param {Array} apiMaps - API'den gelen harita listesi
 * @param {string} currentMap - Şu an seçili harita (yakınlık eşitse mevcut haritayı korur)
 * @returns {{ mapNormalizedName: string, confidence: string } | null}
 */
function detectMapFromPosition(position, apiMaps = [], currentMap = 'customs', trail = []) {
  if (!position || typeof position.x !== 'number' || typeof position.z !== 'number') {
    return null;
  }

  // 1) Önce mevcut seçili haritanın sınırları (bounds) içinde miyiz kontrol et!
  // Tarkov haritalarının hepsi (0,0,0) merkezli olduğu için merkez bölgelerde sınırlar kesişir.
  // Eğer oyuncu mevcut haritanın sınırlarının dışına çıkmadıysa (veya son izlerle birlikte
  // başka haritaya ait kesin bir bölgede değilse) haritayı yanlışlıkla Streets'e atlatma!
  const currentCfg = MAP_CONFIGS[currentMap];
  if (currentCfg && currentCfg.bounds && currentCfg.bounds.length >= 2) {
    const cMinX = Math.min(currentCfg.bounds[0][0], currentCfg.bounds[1][0]);
    const cMaxX = Math.max(currentCfg.bounds[0][0], currentCfg.bounds[1][0]);
    const cMinZ = Math.min(currentCfg.bounds[0][1], currentCfg.bounds[1][1]);
    const cMaxZ = Math.max(currentCfg.bounds[0][1], currentCfg.bounds[1][1]);

    const insideCurrentBounds =
      position.x >= cMinX && position.x <= cMaxX && position.z >= cMinZ && position.z <= cMaxZ;

    if (insideCurrentBounds) {
      return { mapNormalizedName: currentMap, confidence: 'kept-current-bounds' };
    }
  }

  // 2) Mevcut haritanın sınırları DIŞINDAYSAK hangi haritaların sınırları içine düştüğümüzü bul
  const candidates = [];
  for (const [normName, cfg] of Object.entries(MAP_CONFIGS)) {
    if (!cfg.bounds || cfg.bounds.length < 2) continue;
    const minX = Math.min(cfg.bounds[0][0], cfg.bounds[1][0]);
    const maxX = Math.max(cfg.bounds[0][0], cfg.bounds[1][0]);
    const minZ = Math.min(cfg.bounds[0][1], cfg.bounds[1][1]);
    const maxZ = Math.max(cfg.bounds[0][1], cfg.bounds[1][1]);

    if (position.x >= minX && position.x <= maxX && position.z >= minZ && position.z <= maxZ) {
      candidates.push(normName);
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { mapNormalizedName: candidates[0], confidence: 'high' };
  }

  // 3) Birden fazla aday varsa tüm iz noktalarının (trail + current) 3B (X, Y*5, Z) toplam hatasını karşılaştır
  const samplePoints = [...(Array.isArray(trail) ? trail.slice(-4) : []), position];
  let bestMap = candidates[0];
  let bestTotalScore = Infinity;

  if (Array.isArray(apiMaps) && apiMaps.length > 0) {
    for (const mapNorm of candidates) {
      const mData = apiMaps.find((m) => m.normalizedName === mapNorm);
      if (!mData) continue;

      const points = [
        ...(mData.lootContainers || []).map((c) => c.position),
        ...(mData.lootLoose || []).map((l) => l.position),
        ...(mData.extracts || []).map((e) => e.position)
      ].filter(Boolean);

      if (points.length === 0) continue;

      let sumMinDist = 0;
      for (const sp of samplePoints) {
        let minD = Infinity;
        for (const pt of points) {
          const dx = pt.x - sp.x;
          const dy = (pt.y - (sp.y || 0)) * 5.0; // Yükseklik (terrain elevation) en ayırt edici eksendir
          const dz = pt.z - sp.z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < minD) minD = d;
        }
        sumMinDist += Math.sqrt(minD);
      }

      if (sumMinDist < bestTotalScore) {
        bestTotalScore = sumMinDist;
        bestMap = mapNorm;
      }
    }
  }

  return {
    mapNormalizedName: bestMap,
    confidence: 'AutoBounds'
  };
}

module.exports = {
  TARKOV_SCREENSHOT_REGEX,
  quaternionToYawDegrees,
  degreesToCompassLabel,
  parseScreenshotFilename,
  detectMapFromPosition
};
