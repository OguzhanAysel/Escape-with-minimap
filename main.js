const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const { TarkovDataService } = require('./src/api/tarkovApi');
const { classifyTaskImage } = require('./src/taskImageFilter');
const {
  MAP_CONFIGS,
  MAP_CALLOUTS,
  calculateNavigationToTarget,
  buildObstacleAabbs,
  isPointInsideBox,
  doesSegmentIntersectBox
} = require('./src/geo/coordinates');
const {
  TARKOV_SCREENSHOT_REGEX,
  parseScreenshotFilename,
  quaternionToYawDegrees,
  degreesToCompassLabel,
  detectMapFromPosition
} = require('./src/parsers/screenshotParser');

let panelWindow = null;
let overlayWindow = null;
let dataService = null;
let screenshotWatcher = null;
let watchedDirPath = null;

// Otomatik Home tuşu döngüsü (Alt+H ile açılır/kapanır)
let autoHomeActive = false;
let autoHomeTimer = null;
let keySenderProc = null;

// Oyuncu konum ve iz durumu (Son 10 konum soluk iz olarak saklanır)
let playerState = {
  current: null,
  trail: []
};

// Aşama 4: Seçili Rota Hedefi ve Haritadaki Aday Hedefler
let activeTarget = null; // { id, title, subtitle, category, color, position: {x,y,z} }
let candidateTargets = [];
let visitedTargetIds = new Set();
let rotationTour = [];
let lastCapturedScreenshot = null; // Envanter analizi için silinmeden önce bellekte tutulan son ekran görüntüsü

// Overlay'de sabit görev kartı veya lightbox açıkken fare etkileşimini kilitleyen durum.
// locked=true iken overlay ASLA tıklama-geçirgen (ignoreMouseEvents) moda dönmez.
let overlayInteractionLock = { locked: false, lightbox: false };
// Kilit açıkken geçici olarak kaydedilen global tuşlar (overlay focusable:false olduğu için
// klavye olayları renderer'a ulaşmaz; Esc / ← / → bu yolla iletilir, oyunun odağı çalınmaz).
const LOCK_SHORTCUT_ACTIONS = { Escape: 'escape', Left: 'prev', Right: 'next' };
const lockShortcutsActive = new Set();

/**
 * Görev görselini sınıflandırır ve dosyanın gerçekten var olduğunu doğrular.
 * Yalnızca 'photo' (oyun içi ekran görüntüsü) dönenler overlay'de gösterilir;
 * 2D harita krokileri ('map'), eşya ikonları ve küçük not görselleri ('icon') elenir.
 */
const taskImageFileInfoCache = new Map();
function getTaskImageFileInfo(localPath) {
  if (taskImageFileInfoCache.has(localPath)) return taskImageFileInfoCache.get(localPath);
  let info = { exists: false, bytes: 0 };
  try {
    // localPath renderer/overlay/index.html'e göre görelidir ("../../assets/task-locations/x.webp")
    const abs = path.join(__dirname, 'renderer', 'overlay', localPath);
    const st = fs.statSync(abs);
    info = { exists: st.isFile(), bytes: st.size };
  } catch (_e) {}
  taskImageFileInfoCache.set(localPath, info);
  return info;
}

function isDisplayableTaskPhoto(img) {
  if (!img || !img.localPath) return false;
  const info = getTaskImageFileInfo(img.localPath);
  if (!info.exists) return false;
  return classifyTaskImage(img, info) === 'photo';
}

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

const ITEM_COLORS = [
  '#38bdf8', // Mavi
  '#f59e0b', // Turuncu
  '#22c55e', // Yeşil
  '#ec4899', // Pembe
  '#a855f7', // Mor
  '#ef4444', // Kırmızı
  '#14b8a6', // Turkuaz
  '#eab308'  // Sarı
];

const DEFAULT_SETTINGS = {
  gameMode: 'pve', // Varsayılan olarak PvE Zone (Kullanıcı PvE oynuyor)
  language: 'tr',
  playerLevel: 15,
  screenshotsDir: 'C:\\Users\\Jetira\\Documents\\Escape from Tarkov\\Screenshots',
  deleteScreenshotsAfterRead: true,
  autoDetectMapFromCoords: false, // Varsayılan kapalı: Streets ile merkez koordinatlar çakıştığı için harita seçimi kullanıcıda
  mapRenderStyle: 'satellite',
  autoHomeIntervalMs: 3000, // Varsayılan: 3 saniyede bir Home tuşu
  yawOffset: 0,
  autoNearestTarget: false,
  autoRotationEnabled: true,
  rotationCategories: ['task', 'container', 'loot', 'extract'],
  rotationMaxStops: 5, // çıkış hariç en fazla durak
  rotationRaidMinutesLeft: 0, // 0 = süre sınırı yok; > 0 ise rota bu sürede çıkışa yetişecek şekilde kısalır
  rotationAvoidConditionalExtracts: true, // anahtar / ücret / fişek / co-op isteyen çıkışları sona bırakma
  rotationAvoidHazards: true, // mayın / sniper / nehir engelini kesen hatları cezalandır
  rotationPreferValuableLoot: true, // pahalı loot'u öncele
  selectedMap: 'customs',
  tarkovLogsDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Escape from Tarkov\\build\\Logs',
  autoDetectMapFromLogs: true,
  movePositionTrigger: false,
  moveTriggerCooldownMs: 4000,
  showMapContainers: true,
  enabledContainerCategories: ['safe', 'pc', 'cache', 'weapon', 'medical', 'jacket', 'drawer', 'bag', 'tech'],
  showPmcSpawns: false,
  showScavSpawns: false,
  showBossSpawns: false,
  showValuableSpawns: true,
  showMapLocks: false,
  showMapHazards: true,
  showMapUtilities: true,
  showMapExtracts: true,
  showMapCallouts: true,
  hoverInteractiveMap: true,
  showAllMapTasksOnOverlay: true,
  layersV3Migrated: true,
  layersV4Migrated: true,
  activeTaskIds: [],
  completedTaskIds: [],
  completedObjectiveIds: [],
  pinnedItems: [],
  overlay: {
    x: null,
    y: null,
    width: 460,
    height: 460,
    opacity: 0.9,
    visible: true,
    editMode: false,
    followMode: true,
    zoom: 2.5,
    layers: {
      loot: true,
      tasks: true,
      player: true,
      route: true
    }
  },
  shortcuts: {
    toggleOverlay: 'Alt+M',
    toggleEditMode: 'Alt+E',
    opacityUp: 'Alt+Up',
    opacityDown: 'Alt+Down',
    toggleFollowMode: 'Alt+F',
    nextTarget: 'Alt+N',
    nextMap: 'Alt+G',
    toggleAutoHome: 'Alt+H',
    zoomIn: 'Alt+8',
    zoomOut: 'Alt+9'
  }
};

let currentSettings = null;
let logs = [];

function addLog(level, message, details = '') {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    details: typeof details === 'object' ? JSON.stringify(details) : String(details || '')
  };
  logs.unshift(entry);
  if (logs.length > 250) logs.pop();
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('log:new', entry);
  }
}

/**
 * Arka planda düşük gecikmeli tek bir PowerShell/C# SendInput + GetAsyncKeyState süreci tutar;
 * - Auto-Home açıkken periyodik VK_HOME (0x24 / ScanCode 0x47) gönderir.
 * - "Yalnızca Hareket Halindeyken Konum Al" (movePositionTrigger) açıkken, sadece W/A/S/D tuşuna
 *   basıldığında (veya O tuşuyla çıkışlara bakıldığında) cooldown süresiyle 1 kez HOME basar;
 *   böylece envanterdeyken veya sabit dururken gereksiz ekran görüntüsü bildirimi çıkmaz.
 */
function ensureKeySenderProcess() {
  if (keySenderProc && !keySenderProc.killed) return keySenderProc;

  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinKeySender {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
    public const int KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const int KEYEVENTF_KEYUP = 0x0002;
    public const byte VK_HOME = 0x24;
    public const byte SCAN_HOME = 0x47;
    public static void TapHome() {
        keybd_event(VK_HOME, SCAN_HOME, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
        System.Threading.Thread.Sleep(25);
        keybd_event(VK_HOME, SCAN_HOME, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
    public static bool IsMovingOrCheckingExits() {
        int[] keys = new int[] { 0x57, 0x41, 0x53, 0x44, 0x4F }; // W, A, S, D, O
        foreach (int k in keys) {
            if ((GetAsyncKeyState(k) & 0x8000) != 0) return true;
        }
        return false;
    }
}
"@
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq "HOME") {
        [WinKeySender]::TapHome()
    } elseif ($line -eq "HOME_IF_MOVING") {
        if ([WinKeySender]::IsMovingOrCheckingExits()) {
            [WinKeySender]::TapHome()
        }
    }
}
`;

  try {
    keySenderProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore']
    });
    keySenderProc.on('exit', () => {
      keySenderProc = null;
    });
  } catch (err) {
    addLog('error', 'Auto-Home tuş servisi başlatılamadı.', err.message);
  }
  return keySenderProc;
}

function triggerSingleHomeKey(onlyIfMoving = false) {
  const proc = ensureKeySenderProcess();
  if (proc && proc.stdin && !proc.stdin.destroyed) {
    try {
      proc.stdin.write(onlyIfMoving ? 'HOME_IF_MOVING\n' : 'HOME\n');
    } catch (_e) {
      // ignore
    }
  }
}

function setAutoHomeState(enable) {
  autoHomeActive = !!enable;
  if (autoHomeTimer) {
    clearInterval(autoHomeTimer);
    autoHomeTimer = null;
  }

  if (autoHomeActive) {
    const onlyMoving = !!currentSettings.movePositionTrigger;
    const intervalMs = Math.max(500, Number(currentSettings.autoHomeIntervalMs) || 1000);
    ensureKeySenderProcess();
    triggerSingleHomeKey(onlyMoving);
    autoHomeTimer = setInterval(() => {
      if (autoHomeActive) {
        triggerSingleHomeKey(!!currentSettings.movePositionTrigger);
      }
    }, intervalMs);
    const modeDesc = onlyMoving
      ? `Akıllı Hareket Modu: Yalnızca W/A/S/D/O basılıyken her ${(intervalMs / 1000).toFixed(1)} sn'de bir`
      : `Her ${(intervalMs / 1000).toFixed(1)} saniyede bir`;
    addLog('info', `Otomatik HOME tuşu AÇILDI (${modeDesc}).`);
  } else {
    addLog('info', 'Otomatik HOME tuşu KAPATILDI.');
  }

  broadcastAutoHomeState();
}

function broadcastAutoHomeState() {
  const payload = {
    active: autoHomeActive,
    intervalMs: currentSettings ? currentSettings.autoHomeIntervalMs || 1000 : 1000
  };
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('autohome:updated', payload);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('autohome:updated', payload);
  }
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const mergedShortcuts = {
        ...DEFAULT_SETTINGS.shortcuts,
        ...(parsed.shortcuts || {})
      };
      // Türkçe klavyede çalışmayan Alt+= ve Alt+- kısayollarını otomatik Alt+8 / Alt+9'a yükselt
      if (mergedShortcuts.zoomIn === 'Alt+=') mergedShortcuts.zoomIn = 'Alt+8';
      if (mergedShortcuts.zoomOut === 'Alt+-') mergedShortcuts.zoomOut = 'Alt+9';

      const isV3 = !!parsed.layersV3Migrated;
      const isV4 = !!parsed.layersV4Migrated;
      const rawCats = parsed.enabledContainerCategories;
      let normCats = ['safe', 'pc', 'cache', 'weapon', 'medical', 'jacket', 'drawer', 'bag', 'tech'];
      if (isV4) {
        if (Array.isArray(rawCats)) {
          normCats = rawCats;
        } else if (rawCats && typeof rawCats === 'object') {
          normCats = Object.keys(rawCats).filter((k) => !!rawCats[k]);
        }
      }

      currentSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        layersV3Migrated: true,
        layersV4Migrated: true,
        autoRotationEnabled: parsed.autoRotationEnabled !== undefined ? !!parsed.autoRotationEnabled : true,
        rotationCategories: Array.isArray(parsed.rotationCategories)
          ? parsed.rotationCategories
          : ['task', 'container', 'loot', 'extract'],
        // Streets takılmasını önlemek için autoDetectMapFromCoords'u güvenli modda başlat
        autoDetectMapFromCoords: parsed.autoDetectUserExplicit ? !!parsed.autoDetectMapFromCoords : false,
        gameMode: parsed.gameModeUserExplicit ? parsed.gameMode : 'pve',
        autoHomeIntervalMs: parsed.intervalUserExplicit ? parsed.autoHomeIntervalMs : 3000,
        showMapCallouts: parsed.showMapCallouts !== undefined ? !!parsed.showMapCallouts : true,
        hoverInteractiveMap: parsed.hoverInteractiveMap !== undefined ? !!parsed.hoverInteractiveMap : true,
        showAllMapTasksOnOverlay: isV3 ? !!parsed.showAllMapTasksOnOverlay : true,
        showPmcSpawns: !!parsed.showPmcSpawns,
        showScavSpawns: !!parsed.showScavSpawns,
        showBossSpawns: !!parsed.showBossSpawns,
        showValuableSpawns: isV3 ? !!parsed.showValuableSpawns : true,
        showMapLocks: !!parsed.showMapLocks,
        showMapHazards: parsed.showMapHazards !== undefined ? !!parsed.showMapHazards : true,
        showMapUtilities: isV3 ? !!parsed.showMapUtilities : true,
        showMapContainers: normCats.length > 0,
        enabledContainerCategories: normCats,
        activeTaskIds: Array.isArray(parsed.activeTaskIds) ? parsed.activeTaskIds : [],
        completedTaskIds: Array.isArray(parsed.completedTaskIds) ? parsed.completedTaskIds : [],
        completedObjectiveIds: Array.isArray(parsed.completedObjectiveIds) ? parsed.completedObjectiveIds : [],
        pinnedItems: Array.isArray(parsed.pinnedItems) ? parsed.pinnedItems : [],
        overlay: {
          ...DEFAULT_SETTINGS.overlay,
          ...(parsed.overlay || {}),
          zoom: typeof parsed.overlay?.zoom === 'number' && parsed.overlay.zoom >= 0.5 ? parsed.overlay.zoom : 2.5,
          layers: {
            ...DEFAULT_SETTINGS.overlay.layers,
            ...((parsed.overlay && parsed.overlay.layers) || {}),
            loot: isV3 ? parsed.overlay?.layers?.loot !== false : true,
            tasks: isV3 ? parsed.overlay?.layers?.tasks !== false : true
          }
        },
        shortcuts: mergedShortcuts
      };
      saveSettings();
      addLog('info', 'Ayarlar diskten yüklendi (PvE modu aktif).', SETTINGS_FILE);
    } else {
      currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      saveSettings();
      addLog('info', 'Varsayılan ayarlar oluşturuldu (PvE modu aktif).', SETTINGS_FILE);
    }
  } catch (err) {
    currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    addLog('error', 'Ayarlar okunurken hata oluştu, varsayılanlar yüklendi.', err.message);
  }
  return currentSettings;
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2), 'utf-8');
  } catch (err) {
    addLog('error', 'Ayarlar kaydedilemedi.', err.message);
  }
}

function broadcastState() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('settings:updated', currentSettings);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('settings:updated', currentSettings);
  }
}

/**
 * Harita veya raid değiştiğinde çağrılır: önceki haritanın / raid'in "gezildi" (✓) işaretleri,
 * aktif hedef, oyuncu izi ve rota önbelleği temizlenir.
 */
function resetRaidProgress(reason = '') {
  visitedTargetIds.clear();
  activeTarget = null;
  playerState.trail = [];
  rotationCache = null;
  lastFloorWarnTargetId = null;
  if (reason) addLog('info', `Gezilen hedefler sıfırlandı (${reason}).`);
}

// ---------------------------------------------------------------------------
// Rota mesafesi: kat (Y) farkı dahil + "olası konum" gruplaması
// ---------------------------------------------------------------------------
const FLOOR_HEIGHT_PENALTY = 4; // 1 m yükseklik farkı ≈ 4 m yatay yürüme (merdiven bulma, kat değiştirme)
const ARRIVAL_RADIUS_XZ = 16; // hedefe bu kadar yatay yaklaşınca "ulaşıldı"
const ARRIVAL_MAX_DY = 2.5; // ...ama yalnızca aynı kattaysa (yükseklik farkı en fazla 2.5 m)
const DEDUPE_GRID_XZ = 4; // aynı noktadaki mükerrer hedefleri birleştirme ızgarası (m)
const DEDUPE_GRID_Y = 2.5; // ...farklı katlar birleştirilmez
let lastFloorWarnTargetId = null;

function verticalDelta(a, b) {
  return a && b && typeof a.y === 'number' && typeof b.y === 'number' ? Math.abs(a.y - b.y) : 0;
}

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// Rota sıralamasında kullanılan "yürüme maliyeti": yatay mesafe + kat farkı cezası
function routeDistance(a, b) {
  return horizontalDistance(a, b) + verticalDelta(a, b) * FLOOR_HEIGHT_PENALTY;
}

// Aynı görev hedefinin alternatif konumları (possibleLocations) tek grup sayılır
function getTargetGroupKey(t) {
  if (!t) return null;
  if (t.groupId) return t.groupId;
  const c = candidateTargets.find((x) => x.id === t.id);
  return (c && c.groupId) || t.id;
}

// Hedefi (ve grubundaki tüm alternatif konumları) ziyaret edildi işaretle
function markTargetVisited(t) {
  if (!t || !t.id) return;
  visitedTargetIds.add(t.id);
  const g = getTargetGroupKey(t);
  if (g && g !== t.id) {
    for (const c of candidateTargets) {
      if (c.groupId === g) visitedTargetIds.add(c.id);
    }
  }
}

// Rotasyon planlayıcı ayarları
const ROT_WALK_SPEED_MPS = 3.2; // ortalama hareket hızı (koşu + köşe kontrolü + durmalar)
const ROT_STOP_SECONDS = 25; // her durakta loot / görev için harcanan süre
const HAZARD_SEGMENT_PENALTY = 120; // mayın / sniper / nehir engelini kesen her hat için ek maliyet (m)
const CONDITIONAL_EXTRACT_PENALTY = 250; // anahtar / ücret / fişek / co-op isteyen çıkışlar için ek maliyet (m)
const EXTRACT_PULL = 0.35; // duraklar seçilirken çıkış yönüne çekme kuvveti
const EXTRACT_CANDIDATES = 4; // ayrıntılı planlanacak en fazla çıkış sayısı
const EXACT_ORDER_MAX = 6; // bu kadar veya daha az durakta sıralama kesin (tüm permütasyonlar) hesaplanır

function getRotationOptions() {
  const s = currentSettings || {};
  const maxStops = Number.isFinite(+s.rotationMaxStops) ? Math.round(+s.rotationMaxStops) : 5;
  const raidMin = Number.isFinite(+s.rotationRaidMinutesLeft) ? +s.rotationRaidMinutesLeft : 0;
  return {
    maxStops: Math.max(1, Math.min(10, maxStops)),
    raidMinutesLeft: Math.max(0, Math.min(60, raidMin)), // 0 = süre sınırı yok
    avoidConditionalExtracts: s.rotationAvoidConditionalExtracts !== false,
    avoidHazards: s.rotationAvoidHazards !== false,
    preferValuableLoot: s.rotationPreferValuableLoot !== false
  };
}

function isConditionalExtract(c) {
  if (!c) return false;
  if (c.requiresKey) return true;
  const note = String(c.subtitle || '');
  return /Anahtar|Fişe|Ücretli|Ortak|Koşullu/i.test(note);
}

let rotationCache = null;
let rotationInfo = null; // { totalMeters, etaMinutes, stops, hazardCrossings, extractTitle }

function computeRotationTour() {
  rotationInfo = null;
  if (!currentSettings || !currentSettings.autoRotationEnabled) {
    rotationTour = activeTarget ? [activeTarget] : [];
    return rotationTour;
  }

  const opts = getRotationOptions();

  // Önbellek: girdiler (oyuncu ~5 m içinde, aktif hedef, ziyaret edilenler, aday listesi, ayarlar) aynıysa yeniden hesaplama
  const pp = playerState.current?.position;
  const cacheKey = [
    pp ? `${Math.round(pp.x / 5)},${Math.round(pp.z / 5)},${Math.round((pp.y || 0) / 2)}` : '-',
    activeTarget ? activeTarget.id : '-',
    visitedTargetIds.size,
    currentSettings.selectedMap,
    JSON.stringify(opts),
    (currentSettings.rotationCategories || []).join(','),
    (currentSettings.activeTaskIds || []).length
  ].join('|');
  if (rotationCache && rotationCache.key === cacheKey && rotationCache.candidates === candidateTargets) {
    rotationTour = rotationCache.tour.slice();
    rotationInfo = rotationCache.info;
    if (!activeTarget && rotationTour.length > 0) activeTarget = rotationTour[0];
    return rotationTour;
  }

  const rotCats = new Set(currentSettings.rotationCategories || ['task', 'container', 'loot', 'extract']);
  const activeTaskIdsSet = new Set(currentSettings.activeTaskIds || []);
  const mapNorm = currentSettings.selectedMap || 'customs';
  const geo = MAP_CONFIGS[mapNorm] || MAP_CONFIGS['customs'];

  // Başlangıç referans noktası: oyuncu konumu -> aktif hedef -> harita merkezi
  let refPos = playerState.current?.position || activeTarget?.position || null;
  if (!refPos && geo && Array.isArray(geo.bounds)) {
    refPos = {
      x: (geo.bounds[0][0] + geo.bounds[1][0]) * 0.5,
      y: 0,
      z: (geo.bounds[0][1] + geo.bounds[1][1]) * 0.5
    };
  }
  if (!refPos) {
    rotationTour = activeTarget ? [activeTarget] : [];
    return rotationTour;
  }

  // --- Tehlike bölgeleri (mayın, sniper sınırı, nehir/göl) -> hat maliyeti ---
  let hazardBoxes = [];
  if (opts.avoidHazards) {
    try {
      const ds = dataService ? dataService.currentData : null;
      const apiMap = ds && Array.isArray(ds.maps) ? ds.maps.find((m) => m.normalizedName === mapNorm) : null;
      hazardBoxes = buildObstacleAabbs((apiMap && apiMap.hazards) || [], mapNorm);
    } catch (_e) {
      hazardBoxes = [];
    }
  }
  const hazardCrossings = (a, b) => {
    let n = 0;
    for (const bx of hazardBoxes) {
      if (isPointInsideBox(a.x, a.z, bx) || isPointInsideBox(b.x, b.z, bx)) continue;
      if (doesSegmentIntersectBox(a.x, a.z, b.x, b.z, bx)) n++;
    }
    return n;
  };
  // Hat maliyeti önbelleği (konum nesnesi kimliğine göre): permütasyon / 2-opt aynı hatları defalarca sorar
  const legCache = new Map();
  const legCost = (a, b) => {
    let row = legCache.get(a);
    if (!row) {
      row = new Map();
      legCache.set(a, row);
    }
    let v = row.get(b);
    if (v === undefined) {
      v = routeDistance(a, b) + (hazardBoxes.length ? hazardCrossings(a, b) * HAZARD_SEGMENT_PENALTY : 0);
      row.set(b, v);
    }
    return v;
  };

  // --- Aday havuzu: mükerrerler (aynı nokta + aynı kat) birleştirilir, olası konumlar gruplanır ---
  const groups = new Map(); // groupKey -> [aday...]
  const seenCoords = new Set();
  for (const c of candidateTargets) {
    if (!c || !c.position || visitedTargetIds.has(c.id)) continue;
    if (c.category === 'extract') continue;
    if (!rotCats.has(c.category)) continue;
    if (c.category === 'task' && activeTaskIdsSet.size > 0 && !c.isSelectedTask) continue;

    const yBand = typeof c.position.y === 'number' ? Math.round(c.position.y / DEDUPE_GRID_Y) : 0;
    const coordKey = `${Math.round(c.position.x / DEDUPE_GRID_XZ)}_${Math.round(c.position.z / DEDUPE_GRID_XZ)}_${yBand}`;
    if (seenCoords.has(coordKey) && (!activeTarget || activeTarget.id !== c.id)) continue;
    seenCoords.add(coordKey);

    const key = c.groupId || c.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  // --- Değerli loot önceliği: pahalı eşyalar "daha yakın" sayılır ---
  let maxLootValue = 0;
  for (const members of groups.values()) {
    for (const m of members) if (m.category === 'loot' && m.value > maxLootValue) maxLootValue = m.value;
  }
  const preferFactor = (c) => {
    let f = 1;
    if (c.category === 'task' && c.isSelectedTask) f *= 0.85;
    if (opts.preferValuableLoot && c.category === 'loot' && maxLootValue > 0 && c.value > 0) {
      f *= 1 - 0.35 * Math.sqrt(c.value / maxLootValue);
    }
    return f;
  };

  // --- Sabit başlangıç: kullanıcı/oyun tarafından seçilmiş aktif hedef ---
  const fixedStart = activeTarget && !visitedTargetIds.has(activeTarget.id) && activeTarget.position ? activeTarget : null;
  const fixedGroup = fixedStart ? getTargetGroupKey(fixedStart) : null;
  const stopMeters = ROT_STOP_SECONDS * ROT_WALK_SPEED_MPS;
  const budgetMeters = opts.raidMinutesLeft > 0 ? opts.raidMinutesLeft * 60 * ROT_WALK_SPEED_MPS : Infinity;

  // Yolun toplam maliyeti: ref -> [duraklar] -> (çıkış)
  const pathCost = (stops, endPos) => {
    let cost = 0;
    let cur = refPos;
    for (let i = 0; i < stops.length; i++) {
      const pos = stops[i].position;
      cost += legCost(cur, pos) + stopMeters;
      cur = pos;
    }
    if (endPos) cost += legCost(cur, endPos);
    return cost;
  };
  // Sabit ilk durak (aktif hedef) sonrası sıralanabilir kısmın maliyeti
  const seqCost = (seq, endPos) => {
    let cost = 0;
    let cur = fixedStart ? fixedStart.position : refPos;
    for (let i = 0; i < seq.length; i++) {
      const pos = seq[i].position;
      cost += legCost(cur, pos);
      cur = pos;
    }
    if (endPos) cost += legCost(cur, endPos);
    return cost;
  };

  // 2-opt: kesişen rota parçalarını ters çevirerek toplam yolu kısaltır (ilk sabit durak hariç)
  const twoOpt = (seq, endPos) => {
    const head = fixedStart ? [fixedStart] : [];
    let bestSeq = seq.slice();
    let bestCost = pathCost(head.concat(bestSeq), endPos);
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 0; i < bestSeq.length - 1; i++) {
        for (let k = i + 1; k < bestSeq.length; k++) {
          const cand = bestSeq.slice(0, i).concat(bestSeq.slice(i, k + 1).reverse(), bestSeq.slice(k + 1));
          const c = pathCost(head.concat(cand), endPos);
          if (c + 0.01 < bestCost) {
            bestSeq = cand;
            bestCost = c;
            improved = true;
          }
        }
      }
    }
    return bestSeq;
  };

  // Kesin çözüm: durak sayısı küçükken (<= 6 -> en fazla 720 sıralama) tüm permütasyonları dener
  const exactOrder = (seq, endPos) => {
    const arr = seq.slice();
    let bestSeq = arr.slice();
    let bestCost = seqCost(arr, endPos);
    const c = new Array(arr.length).fill(0);
    let i = 0;
    while (i < arr.length) {
      if (c[i] < i) {
        const j = i % 2 === 0 ? 0 : c[i];
        [arr[j], arr[i]] = [arr[i], arr[j]];
        const cost = seqCost(arr, endPos);
        if (cost + 0.01 < bestCost) {
          bestCost = cost;
          bestSeq = arr.slice();
        }
        c[i]++;
        i = 0;
      } else {
        c[i] = 0;
        i++;
      }
    }
    return bestSeq;
  };

  // Or-opt: tek bir durağı rotada başka bir sıraya taşımayı dener (2-opt'un kaçırdığı "geri dönüşleri" düzeltir)
  const orOpt = (seq, endPos) => {
    const head = fixedStart ? [fixedStart] : [];
    let bestSeq = seq.slice();
    let bestCost = pathCost(head.concat(bestSeq), endPos);
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 0; i < bestSeq.length; i++) {
        const node = bestSeq[i];
        const rest = bestSeq.slice(0, i).concat(bestSeq.slice(i + 1));
        for (let j = 0; j <= rest.length; j++) {
          if (j === i) continue;
          const cand = rest.slice(0, j).concat([node], rest.slice(j));
          const c = pathCost(head.concat(cand), endPos);
          if (c + 0.01 < bestCost) {
            bestSeq = cand;
            bestCost = c;
            improved = true;
          }
        }
      }
    }
    return bestSeq;
  };

  // Gruplu duraklarda komşulara göre en uygun alternatif konumu seç
  const repickMembers = (seq, endPos) => {
    const out = seq.slice();
    for (let i = 0; i < out.length; i++) {
      const key = out[i].groupId || out[i].id;
      const members = groups.get(key) || [out[i]];
      if (members.length < 2) continue;
      const prev = i === 0 ? (fixedStart ? fixedStart.position : refPos) : out[i - 1].position;
      const next = i < out.length - 1 ? out[i + 1].position : endPos;
      let best = out[i];
      let bestC = Infinity;
      for (const m of members) {
        const c = legCost(prev, m.position) + (next ? legCost(m.position, next) : 0);
        if (c < bestC) {
          bestC = c;
          best = m;
        }
      }
      out[i] = best;
    }
    return out;
  };

  const planFor = (ext) => {
    const endPos = ext ? ext.position : null;
    const usedGroups = new Set(fixedGroup ? [fixedGroup] : []);
    const rejected = new Set();
    const seq = [];
    let cur = fixedStart ? fixedStart.position : refPos;
    let acc = fixedStart ? legCost(refPos, fixedStart.position) + stopMeters : 0;
    const slots = opts.maxStops - (fixedStart ? 1 : 0);

    while (seq.length < slots) {
      const curToEnd = endPos ? routeDistance(cur, endPos) : 0;
      let best = null;
      let bestScore = Infinity;
      for (const [key, members] of groups) {
        if (usedGroups.has(key)) continue;
        for (const m of members) {
          if (rejected.has(m.id)) continue;
          const pf = preferFactor(m);
          // Çıkışa çekme terimi ucuz (tehlikesiz) mesafeyle hesaplanır
          const pull = endPos ? EXTRACT_PULL * (routeDistance(m.position, endPos) - curToEnd) : 0;
          // Alt sınır: tehlike cezası yalnızca ekler; alt sınır bile kötüyse pahalı hesaba girme
          if (routeDistance(cur, m.position) * pf + pull >= bestScore) continue;
          const score = legCost(cur, m.position) * pf + pull;
          if (score < bestScore) {
            bestScore = score;
            best = m;
          }
        }
      }
      if (!best) break;
      // Süre bütçesi: bu durak + (varsa) çıkışa dönüş sığmıyorsa bu adayı ele
      const need = acc + legCost(cur, best.position) + stopMeters + (endPos ? legCost(best.position, endPos) : 0);
      if (need > budgetMeters) {
        rejected.add(best.id);
        continue;
      }
      acc += legCost(cur, best.position) + stopMeters;
      seq.push(best);
      usedGroups.add(best.groupId || best.id);
      cur = best.position;
    }

    let improvedSeq = seq;
    for (let pass = 0; pass < 3; pass++) {
      // Az durakta tüm sıralamaları dene (kesin en kısa), fazlasında 2-opt + or-opt
      const ordered = improvedSeq.length <= EXACT_ORDER_MAX ? exactOrder(improvedSeq, endPos) : orOpt(twoOpt(improvedSeq, endPos), endPos);
      const repicked = repickMembers(ordered, endPos);
      const changed = repicked.some((m, i) => m !== ordered[i]);
      improvedSeq = repicked;
      if (!changed) break; // alternatif konum değişmediyse sıralama zaten en iyi
    }
    const stops = (fixedStart ? [fixedStart] : []).concat(improvedSeq);
    let cost = pathCost(stops, endPos);
    if (ext && opts.avoidConditionalExtracts && isConditionalExtract(ext)) cost += CONDITIONAL_EXTRACT_PENALTY;
    return { stops, ext, cost, fits: pathCost(stops, endPos) <= budgetMeters };
  };

  // --- Çıkış seçimi: her uygun çıkış için rota planla, en iyisini al ---
  let extractOptions = [null];
  if (rotCats.has('extract')) {
    const exts = candidateTargets.filter(
      (c) => c.category === 'extract' && c.position && !visitedTargetIds.has(c.id) && c.faction !== 'scav'
    );
    if (exts.length > 0) extractOptions = exts;
  }

  // Performans: çok çıkış varsa önce çıkışsız kaba bir plan yap, ona en yakın EXTRACT_CANDIDATES çıkışı değerlendir
  if (extractOptions.length > EXTRACT_CANDIDATES && extractOptions[0]) {
    const rough = planFor(null).stops;
    const pts = rough.length > 0 ? rough.map((t) => t.position) : [refPos];
    const score = (ext) => {
      let best = Infinity;
      for (const p of pts) best = Math.min(best, routeDistance(p, ext.position));
      return best + (opts.avoidConditionalExtracts && isConditionalExtract(ext) ? CONDITIONAL_EXTRACT_PENALTY : 0);
    };
    extractOptions = extractOptions
      .map((e) => ({ e, d: score(e) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, EXTRACT_CANDIDATES)
      .map((x) => x.e);
  }

  let bestPlan = null;
  for (const ext of extractOptions) {
    const plan = planFor(ext);
    if (
      !bestPlan ||
      (plan.fits && !bestPlan.fits) ||
      (plan.fits === bestPlan.fits && plan.stops.length > bestPlan.stops.length) ||
      (plan.fits === bestPlan.fits && plan.stops.length === bestPlan.stops.length && plan.cost < bestPlan.cost)
    ) {
      bestPlan = plan;
    }
  }

  const tour = bestPlan ? bestPlan.stops.slice() : [];
  if (bestPlan && bestPlan.ext) tour.push(bestPlan.ext);

  // Özet bilgi (panel / overlay için)
  if (tour.length > 0) {
    let meters = 0;
    let crossings = 0;
    let cur = refPos;
    for (const t of tour) {
      meters += routeDistance(cur, t.position);
      if (hazardBoxes.length) crossings += hazardCrossings(cur, t.position);
      cur = t.position;
    }
    const stopCount = bestPlan.stops.length;
    rotationInfo = {
      totalMeters: Math.round(meters),
      etaMinutes: Math.round(((meters / ROT_WALK_SPEED_MPS + stopCount * ROT_STOP_SECONDS) / 60) * 10) / 10,
      stops: stopCount,
      hazardCrossings: crossings,
      extractTitle: bestPlan.ext ? bestPlan.ext.title : null,
      budgetLimited: Number.isFinite(budgetMeters)
    };
  }

  if (!activeTarget && tour.length > 0 && (currentSettings.autoNearestTarget || currentSettings.autoRotationEnabled)) {
    activeTarget = tour[0];
  }

  rotationTour = tour;
  rotationCache = { key: cacheKey, candidates: candidateTargets, tour: tour.slice(), info: rotationInfo };
  return rotationTour;
}

function broadcastPlayerState() {
  // Otomatik rotasyon ve en yakın hedef zincirini güncelle
  computeRotationTour();
  if (currentSettings.autoNearestTarget && playerState.current && candidateTargets.length > 0 && !activeTarget) {
    selectNearestTargetToPlayer(false);
  }

  const mapNorm = currentSettings ? currentSettings.selectedMap || 'customs' : 'customs';
  const ds = dataService ? dataService.currentData : null;
  const apiMap = ds && Array.isArray(ds.maps) ? ds.maps.find((m) => m.normalizedName === mapNorm) : null;
  const mapHazards = (apiMap && apiMap.hazards) || [];

  const navInfo =
    playerState.current && activeTarget
      ? calculateNavigationToTarget(
          playerState.current.position,
          playerState.current.yaw,
          activeTarget.position,
          mapHazards,
          mapNorm
        )
      : null;

  const payload = {
    ...playerState,
    activeTarget,
    navInfo,
    rotationTour,
    rotationInfo,
    visitedTargetIds: [...visitedTargetIds]
  };

  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('player:updated', payload);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('player:updated', payload);
  }
}

function selectNearestTargetToPlayer(shouldBroadcast = true, filterCategory = null) {
  if (candidateTargets.length === 0) {
    return null;
  }
  const mapNorm = currentSettings ? currentSettings.selectedMap || 'customs' : 'customs';
  const geo = MAP_CONFIGS[mapNorm] || MAP_CONFIGS['customs'];
  const p =
    playerState.current?.position ||
    activeTarget?.position ||
    (geo && Array.isArray(geo.bounds)
      ? { x: (geo.bounds[0][0] + geo.bounds[1][0]) * 0.5, y: 0, z: (geo.bounds[0][1] + geo.bounds[1][1]) * 0.5 }
      : { x: 0, y: 0, z: 0 });

  let best = null;
  let bestDist = Infinity;

  for (const t of candidateTargets) {
    if (!t.position || visitedTargetIds.has(t.id)) continue;
    if (filterCategory && t.category !== filterCategory) continue;
    const d = routeDistance(t.position, p);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }

  if (best) {
    activeTarget = best;
    if (shouldBroadcast) broadcastPlayerState();
  }
  return best;
}

function cycleNextTarget() {
  if (!candidateTargets || candidateTargets.length === 0) {
    addLog('info', 'Bu haritada seçilebilir hedef (pinlenmiş eşya, kutu veya çıkış) bulunmuyor.');
    return null;
  }

  const prevCat = activeTarget ? activeTarget.category : null;
  if (activeTarget && activeTarget.id) {
    markTargetVisited(activeTarget);
    addLog('info', `Hedef tamamlandı / lootlandı işaretlendi: ${activeTarget.title}`);
    activeTarget = null;
  }

  computeRotationTour();
  if (!activeTarget) {
    selectNearestTargetToPlayer(false, prevCat) || selectNearestTargetToPlayer(false, null);
  }
  broadcastPlayerState();
  if (activeTarget) {
    addLog('info', `Sıradaki en yakın hedefe geçildi: ${activeTarget.title}`);
  }
  return activeTarget;
}

async function handleParsedPlayerPosition(parsed, fullFilePath = null) {
  if (!parsed || !parsed.ok) {
    addLog('warn', 'Ekran görüntüsü dosya adı parse edilemedi.', parsed ? parsed.error : '');
    return parsed;
  }

  if (playerState.current && playerState.current.position) {
    playerState.trail.push({
      ...playerState.current.position,
      timestamp: playerState.current.timestamp
    });
    if (playerState.trail.length > 10) {
      playerState.trail.shift();
    }
  }

  playerState.current = parsed;

  // Ekran görüntüsü silinmeden önce envanter analizi için belleğe al
  if (fullFilePath && fs.existsSync(fullFilePath)) {
    try {
      // Ham baytlar tutulur; base64'e yalnızca envanter analizi istendiğinde çevrilir
      // (her 3 sn'de gelen ekran görüntüsünü base64 yapmak boşa CPU/bellek harcıyordu)
      const buf = fs.readFileSync(fullFilePath);
      const ext = /\.jpe?g$/i.test(fullFilePath) ? 'jpeg' : 'png';
      lastCapturedScreenshot = {
        filename: path.basename(fullFilePath),
        ext,
        buffer: buf,
        timestamp: Date.now()
      };
    } catch (_e) {
      // ignore
    }
  }

  // Oyuncu aktif hedefe yatayda <= 16 m ve AYNI KATTA (dy <= 2.5 m) ise tamamlandı işaretle, sıradakine geç
  if (activeTarget && activeTarget.position && parsed.position) {
    const distToActive = horizontalDistance(activeTarget.position, parsed.position);
    const dyToActive = verticalDelta(activeTarget.position, parsed.position);
    if (distToActive <= ARRIVAL_RADIUS_XZ && dyToActive > ARRIVAL_MAX_DY) {
      if (lastFloorWarnTargetId !== activeTarget.id) {
        lastFloorWarnTargetId = activeTarget.id;
        const dir = activeTarget.position.y > parsed.position.y ? 'yukarıda' : 'aşağıda';
        addLog(
          'info',
          `Hedefin hemen yakınındasınız ama farklı kattasınız: "${activeTarget.title}" ${dyToActive.toFixed(1)} m ${dir}.`
        );
      }
    }
    if (distToActive <= ARRIVAL_RADIUS_XZ && dyToActive <= ARRIVAL_MAX_DY) {
      const prevCat = activeTarget.category;
      const doneTitle = activeTarget.title;
      markTargetVisited(activeTarget);
      lastFloorWarnTargetId = null;
      activeTarget = null;
      computeRotationTour();
      if (!activeTarget) {
        selectNearestTargetToPlayer(false, prevCat);
      }
      addLog(
        'info',
        `Hedefe ulaşıldı (${distToActive.toFixed(1)} m, kat farkı ${dyToActive.toFixed(1)} m): "${doneTitle}" tamamlandı, sıradaki en yakın hedefe geçildi.`
      );
    }
  }

  if (currentSettings.autoDetectMapFromCoords && dataService && dataService.currentData) {
    const detected = detectMapFromPosition(
      parsed.position,
      dataService.currentData.maps,
      currentSettings.selectedMap,
      playerState.trail
    );
    if (detected && detected.mapNormalizedName && detected.mapNormalizedName !== currentSettings.selectedMap) {
      const oldMap = currentSettings.selectedMap;
      currentSettings.selectedMap = detected.mapNormalizedName;
      resetRaidProgress();
      saveSettings();
      broadcastState();
      await broadcastOverlayMapData();
      addLog(
        'info',
        `Koordinattan harita otomatik algılandı: ${oldMap.toUpperCase()} -> ${detected.mapNormalizedName.toUpperCase()}`
      );
    }
  }

  broadcastPlayerState();
  addLog(
    'info',
    `Konum güncellendi: X:${parsed.position.x.toFixed(1)}, Y:${parsed.position.y.toFixed(1)}, Z:${parsed.position.z.toFixed(1)} | Yön: ${parsed.yaw}° (${parsed.compass})`,
    parsed.filename
  );

  if (fullFilePath && currentSettings.deleteScreenshotsAfterRead) {
    try {
      const dirOfFile = path.resolve(path.dirname(fullFilePath));
      const targetDir = path.resolve(currentSettings.screenshotsDir);
      const baseName = path.basename(fullFilePath);

      if (dirOfFile.toLowerCase() === targetDir.toLowerCase() && TARKOV_SCREENSHOT_REGEX.test(baseName)) {
        setTimeout(() => {
          fs.unlink(fullFilePath, (unlinkErr) => {
            if (unlinkErr && unlinkErr.code !== 'ENOENT') {
              addLog('error', `Ekran görüntüsü silinemedi: ${baseName}`, unlinkErr.message);
            }
          });
        }, 200);
      }
    } catch (delErr) {
      addLog('error', 'Ekran görüntüsü silme kontrolünde hata oluştu.', delErr.message);
    }
  }

  return parsed;
}

function setupScreenshotWatcher() {
  const dir = (currentSettings.screenshotsDir || '').trim();
  if (!dir) return;

  if (screenshotWatcher && watchedDirPath === dir) {
    return;
  }

  if (screenshotWatcher) {
    screenshotWatcher.close().catch(() => {});
    screenshotWatcher = null;
  }

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      addLog('info', `Ekran görüntüsü klasörü oluşturuldu: ${dir}`);
    }
  } catch (mkdirErr) {
    addLog('warn', `Ekran görüntüsü klasörü oluşturulamadı (${dir}): ${mkdirErr.message}`);
  }

  watchedDirPath = dir;

  try {
    screenshotWatcher = chokidar.watch(dir, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 40
      }
    });

    screenshotWatcher.on('add', (filePath) => {
      const baseName = path.basename(filePath);
      if (!/\.(png|jpg|jpeg)$/i.test(baseName)) return;

      const parsed = parseScreenshotFilename(baseName, currentSettings.yawOffset || 0);
      if (!parsed.ok) {
        addLog('warn', `Yeni görüntü algılandı ancak koordinat formatına uymuyor: ${baseName}`, parsed.error);
        return;
      }
      handleParsedPlayerPosition(parsed, filePath);
    });

    screenshotWatcher.on('error', (err) => {
      addLog('error', `Klasör izleme hatası (${dir})`, err.message);
    });

    addLog('info', `Ekran görüntüsü klasörü izleniyor (Home / PrintScreen): ${dir}`);
  } catch (watchErr) {
    addLog('error', `Klasör izleyici başlatılamadı: ${dir}`, watchErr.message);
  }
}

// Tarkov Resmi Log Dosyasından (%100 Kesin) Raid Haritası Algılayıcı
let logPollTimer = null;
let lastDetectedLogSignature = '';

const SCENE_TO_MAP = {
  'customs_preset': 'customs',
  'bigmap': 'customs',
  'woods_preset': 'woods',
  'woods': 'woods',
  'shopping_mall': 'interchange',
  'interchange': 'interchange',
  'factory_day_preset': 'factory',
  'factory_night_preset': 'factory',
  'factory': 'factory',
  'shoreline_preset': 'shoreline',
  'shoreline': 'shoreline',
  'rezerv_base_preset': 'reserve',
  'rezervbase': 'reserve',
  'reserve': 'reserve',
  'lighthouse_preset': 'lighthouse',
  'lighthouse': 'lighthouse',
  'city_preset': 'streets-of-tarkov',
  'tarkovstreets': 'streets-of-tarkov',
  'sandbox_preset': 'ground-zero',
  'sandbox_high_preset': 'ground-zero',
  'sandbox_start_preset': 'ground-zero',
  'laboratory_preset': 'the-lab',
  'laboratory': 'the-lab'
};

function checkTarkovApplicationLogsForMap() {
  if (!currentSettings || !currentSettings.autoDetectMapFromLogs) return;
  const logsRoot = (currentSettings.tarkovLogsDir || '').trim();
  if (!logsRoot || !fs.existsSync(logsRoot)) return;

  try {
    const folders = fs
      .readdirSync(logsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('log_'))
      .map((d) => {
        const full = path.join(logsRoot, d.name);
        return { name: d.name, full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (folders.length === 0) return;
    const latestFolder = folders[0].full;
    const appLogFile = fs
      .readdirSync(latestFolder)
      .find((f) => f.includes('application') && f.endsWith('.log'));

    if (!appLogFile) return;
    const fullLogPath = path.join(latestFolder, appLogFile);
    const stat = fs.statSync(fullLogPath);
    const readSize = Math.min(stat.size, 65536);
    const fd = fs.openSync(fullLogPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const content = buf.toString('utf8');
    const matches = [...content.matchAll(/scene preset path:maps\/([a-z0-9_]+)\.bundle/gi)];
    if (matches.length === 0) return;

    const lastMatch = matches[matches.length - 1];
    const presetKey = (lastMatch[1] || '').toLowerCase();
    const signature = `${appLogFile}_${matches.length}_${presetKey}`;

    if (signature === lastDetectedLogSignature) return;
    const isFirstRead = lastDetectedLogSignature === '';
    lastDetectedLogSignature = signature;

    const mappedNorm = SCENE_TO_MAP[presetKey];
    if (mappedNorm && mappedNorm === currentSettings.selectedMap && !isFirstRead) {
      // Aynı haritada yeni raid: önceki raid'in ✓ işaretleri bu raid için geçersiz
      resetRaidProgress(`${mappedNorm.toUpperCase()} haritasında yeni raid algılandı`);
      broadcastPlayerState();
      broadcastOverlayMapData();
    } else if (mappedNorm && mappedNorm !== currentSettings.selectedMap) {
      const oldMap = currentSettings.selectedMap;
      currentSettings.selectedMap = mappedNorm;
      resetRaidProgress();
      saveSettings();
      broadcastState();
      broadcastOverlayMapData();
      addLog('info', `Tarkov oyun logundan yeni raid haritası otomatik algılandı: ${oldMap.toUpperCase()} -> ${mappedNorm.toUpperCase()} (${presetKey})`);
    }
  } catch (_err) {
    // ignore read lock
  }
}

function setupTarkovLogMapWatcher() {
  if (logPollTimer) {
    clearInterval(logPollTimer);
    logPollTimer = null;
  }
  checkTarkovApplicationLogsForMap();
  logPollTimer = setInterval(checkTarkovApplicationLogsForMap, 3000);
}

async function buildOverlayMapPayload() {
  const mapNorm = currentSettings.selectedMap || 'customs';
  const geoConfig = MAP_CONFIGS[mapNorm] || MAP_CONFIGS['customs'];

  if (!dataService || !dataService.currentData) {
    await dataService.loadData({
      lang: currentSettings.language,
      gameMode: currentSettings.gameMode,
      forceRefresh: false
    });
  }

  const ds = dataService.currentData;
  const apiMap = ds ? ds.maps.find((m) => m.normalizedName === mapNorm) : null;

  const pinnedList = currentSettings.pinnedItems || [];
  const looseMarkers = [];
  const nextCandidates = [];

  if (ds && ds.itemMapSpawns) {
    for (const pItem of pinnedList) {
      const positions = (ds.itemMapSpawns[pItem.id] && ds.itemMapSpawns[pItem.id][mapNorm]) || [];
      const fullItem = ds.items.find((i) => i.id === pItem.id);
      positions.forEach((pos, idx) => {
        const markerId = `loot_${pItem.id}_${idx}`;
        const markerObj = {
          id: markerId,
          itemId: pItem.id,
          itemName: fullItem ? fullItem.name : pItem.name,
          shortName: fullItem ? fullItem.shortName : pItem.shortName,
          iconLink: (fullItem && fullItem.iconLink) || pItem.iconLink || '',
          baseImageLink: (fullItem && fullItem.baseImageLink) || (fullItem && fullItem.iconLink) || pItem.iconLink || '',
          color: pItem.color || '#38bdf8',
          pricePerSlot: fullItem ? fullItem.pricePerSlot : 0,
          bestPrice: fullItem ? fullItem.bestOverallPrice : 0,
          bestSource: fullItem ? fullItem.bestOverallSource : '',
          position: pos
        };
        looseMarkers.push(markerObj);
        nextCandidates.push({
          id: markerId,
          title: `${markerObj.shortName || markerObj.itemName}`,
          subtitle: `Eşya Spawn (${markerObj.bestPrice.toLocaleString('tr-TR')} ₽)`,
          category: 'loot',
          color: markerObj.color,
          value: markerObj.bestPrice || 0,
          position: pos
        });
      });
    }
  }

  // Değerli Eşya (Bitcoin, LEDX, GPU, İstihbarat, Tetriz vb.) Tahmini Spawnları
  const valuableMarkers = [];
  if (ds && apiMap && Array.isArray(apiMap.lootLoose)) {
    const itemsByIdMap = new Map((ds.items || []).map((it) => [it.id, it]));
    const VALUABLE_KEYWORDS = [
      'bitcoin',
      'ledx',
      'graphics-card',
      'tetriz',
      'folder-with-intelligence',
      'virtex',
      'vpx-flash',
      'portable-defibrillator',
      'rooster',
      'bronze-lion',
      'roler',
      'prokill',
      'gp-coin',
      'marked',
      'keycard',
      'military-flash-drive',
      'uhf-rfid',
      'microcontroller-board'
    ];
    const isValuableItem = (it) => {
      if (!it) return false;
      const nn = (it.normalizedName || '').toLowerCase();
      if (VALUABLE_KEYWORDS.some((kw) => nn.includes(kw))) return true;
      return (it.pricePerSlot || 0) >= 85000 && (it.bestOverallPrice || 0) >= 110000;
    };

    const gridDedup = new Map();
    apiMap.lootLoose.forEach((ll, idx) => {
      if (!ll || !ll.position || !Array.isArray(ll.items)) return;
      let topValuable = null;
      const otherValuables = [];
      for (const ref of ll.items) {
        const it = itemsByIdMap.get(ref.id);
        if (isValuableItem(it)) {
          otherValuables.push(it);
          if (!topValuable || (it.bestOverallPrice || 0) > (topValuable.bestOverallPrice || 0)) {
            topValuable = it;
          }
        }
      }
      if (!topValuable) return;
      // Aynı noktadaki çoklu spawn'ları 3m yarıçapında birleştir
      const cellKey = `${Math.round(ll.position.x / 3)}_${Math.round(ll.position.z / 3)}_${topValuable.id}`;
      if (gridDedup.has(cellKey)) return;
      gridDedup.set(cellKey, true);

      const isBtc = (topValuable.normalizedName || '').includes('bitcoin');
      const isLedx = (topValuable.normalizedName || '').includes('ledx');
      const isGpu = (topValuable.normalizedName || '').includes('graphics-card');
      const isIntel = (topValuable.normalizedName || '').includes('intelligence');

      valuableMarkers.push({
        id: `val_${idx}`,
        itemId: topValuable.id,
        itemName: topValuable.name,
        shortName: topValuable.shortName,
        iconLink: topValuable.iconLink,
        baseImageLink: topValuable.baseImageLink || topValuable.iconLink,
        bestPrice: topValuable.bestOverallPrice || 0,
        bestSource: topValuable.bestOverallSource || 'Flea Market',
        pricePerSlot: topValuable.pricePerSlot || 0,
        otherNames: otherValuables
          .slice(0, 5)
          .map((x) => x.shortName || x.name)
          .join(', '),
        highlightColor: isBtc ? '#facc15' : isLedx ? '#f43f5e' : isGpu ? '#22c55e' : isIntel ? '#38bdf8' : '#e879f9',
        position: ll.position
      });
    });
  }

  const rawContainers = (apiMap && apiMap.lootContainers) ? apiMap.lootContainers : [];
  const classifyContainer = (normName = '') => {
    const n = String(normName).toLowerCase();
    if (n.includes('register')) {
      return { key: 'safe', label: 'Kasa & Yazar Kasa', color: '#facc15', iconFile: 'container_cash-register.png' };
    }
    if (n.includes('safe') || n.includes('stash')) {
      return { key: 'safe', label: 'Kasa & Yazar Kasa', color: '#facc15', iconFile: 'container_safe.png' };
    }
    if (n.includes('pc-block')) {
      return { key: 'pc', label: 'Bilgisayar (PC Bloğu)', color: '#38bdf8', iconFile: 'container_pc-block.png' };
    }
    if (n.includes('buried-barrel')) {
      return { key: 'cache', label: 'Gizli Zula (Toprak / Varil)', color: '#4ade80', iconFile: 'container_buried-barrel-cache.png' };
    }
    if (n.includes('cache')) {
      return { key: 'cache', label: 'Gizli Zula (Toprak / Varil)', color: '#4ade80', iconFile: 'container_ground-cache.png' };
    }
    if (n.includes('grenade')) {
      return { key: 'weapon', label: 'Silah, Cephane & Bomba Kutusu', color: '#fb923c', iconFile: 'container_grenade-box.png' };
    }
    if (n.includes('ammo')) {
      return { key: 'weapon', label: 'Silah, Cephane & Bomba Kutusu', color: '#fb923c', iconFile: 'container_wooden-ammo-box.png' };
    }
    if (n === 'wooden-crate') {
      return { key: 'weapon', label: 'Silah, Cephane & Bomba Kutusu', color: '#fb923c', iconFile: 'container_wooden-crate.png' };
    }
    if (n.includes('weapon')) {
      return { key: 'weapon', label: 'Silah, Cephane & Bomba Kutusu', color: '#fb923c', iconFile: 'container_weapon-box.png' };
    }
    if (n.includes('medcase')) {
      return { key: 'medical', label: 'Tıbbi Çanta & İlaç Kutusu', color: '#f43f5e', iconFile: 'container_medcase.png' };
    }
    if (n.includes('med')) {
      return { key: 'medical', label: 'Tıbbi Çanta & İlaç Kutusu', color: '#f43f5e', iconFile: 'container_medbag.png' };
    }
    if (n.includes('jacket')) {
      return { key: 'jacket', label: 'Ceket & Kıyafet (Tüm Ceketler)', color: '#a78bfa', iconFile: 'container_jacket.png' };
    }
    if (n.includes('drawer')) {
      return { key: 'drawer', label: 'Çekmece (Filing Cabinet)', color: '#94a3b8', iconFile: 'container_drawer.png' };
    }
    if (n.includes('suitcase')) {
      return { key: 'bag', label: 'Spor Çanta, Valiz & Ceset', color: '#e879f9', iconFile: 'container_plastic-suitcase.png' };
    }
    if (n.includes('body') || n.includes('dead-scav') || n.includes('civilian')) {
      return { key: 'bag', label: 'Spor Çanta, Valiz & Ceset', color: '#e879f9', iconFile: 'container_dead-scav.png' };
    }
    if (n.includes('duffle')) {
      return { key: 'bag', label: 'Spor Çanta, Valiz & Ceset', color: '#e879f9', iconFile: 'container_duffle-bag.png' };
    }
    if (n.includes('toolbox')) {
      return { key: 'tech', label: 'Alet Çantası & Teknik/Erzak Sandığı', color: '#f59e0b', iconFile: 'container_toolbox.png' };
    }
    return { key: 'tech', label: 'Alet Çantası & Teknik/Erzak Sandığı', color: '#f59e0b', iconFile: 'container_crate.png' };
  };

  const enabledCatsArr = Array.isArray(currentSettings.enabledContainerCategories)
    ? currentSettings.enabledContainerCategories
    : currentSettings.enabledContainerCategories && typeof currentSettings.enabledContainerCategories === 'object'
      ? Object.keys(currentSettings.enabledContainerCategories).filter((k) => !!currentSettings.enabledContainerCategories[k])
      : [];
  const enabledCatsSet = new Set(enabledCatsArr);

  const containerMarkers = rawContainers.map((c, idx) => {
    const cat = classifyContainer(c.lootContainer?.normalizedName);
    const cId = `cont_${mapNorm}_${idx}`; // haritaya özel: başka haritadaki aynı sıradaki kutuyla çakışmaz
    if (c.position && enabledCatsSet.has(cat.key)) {
      nextCandidates.push({
        id: cId,
        title: `${c.lootContainer?.name || cat.label}`,
        subtitle: cat.label,
        category: 'container',
        containerCat: cat.key,
        color: cat.color,
        position: c.position
      });
    }
    return {
      ...c,
      id: cId,
      categoryKey: cat.key,
      categoryLabel: cat.label,
      color: cat.color,
      iconFile: cat.iconFile
    };
  });

  if (currentSettings.showValuableSpawns) {
    for (const v of valuableMarkers) {
      if (!v.position) continue;
      nextCandidates.push({
        id: v.id,
        title: `💎 ${v.shortName || v.itemName}`,
        subtitle: `Değerli Eşya (${(v.bestPrice || 0).toLocaleString('tr-TR')} ₽)`,
        category: 'loot',
        color: v.highlightColor,
        position: v.position
      });
    }
  }

  const rawSpawns = (apiMap && apiMap.spawns) ? apiMap.spawns : [];
  const pmcSpawns = [];
  const scavSpawns = [];
  const bossSpawns = [];
  rawSpawns.forEach((sp, idx) => {
    if (!sp || !sp.position) return;
    const sides = sp.sides || [];
    const cats = sp.categories || [];
    const isBoss = cats.includes('boss');
    const isSniper = cats.includes('sniper');
    const isRogue = cats.includes('rogue');
    const isCultist = cats.includes('cultist-priest');
    const isBossGroup = isBoss || isRogue || isCultist;
    const isScav = sides.includes('scav') || cats.includes('bot') || isSniper;
    const isPmc =
      sides.includes('pmc') ||
      cats.includes('botpmc') ||
      (sides.includes('all') && cats.includes('player') && !sides.includes('scav'));

    if (isPmc) {
      pmcSpawns.push({
        id: `spawn_pmc_${idx}`,
        title: 'PMC Doğma Noktası',
        iconFile: 'spawn_pmc.png',
        zoneName: sp.zoneName || '',
        position: sp.position,
        color: '#38bdf8'
      });
    } else if (isBossGroup) {
      const label = isBoss
        ? 'Boss Doğma Noktası'
        : isCultist
          ? 'Cultist (Tarikatçı) Doğma Noktası'
          : 'Rogue / Raider Doğma Noktası';
      const iconFile = isBoss
        ? 'spawn_boss.png'
        : isCultist
          ? 'spawn_cultist-priest.png'
          : 'spawn_rogue.png';
      bossSpawns.push({
        id: `spawn_boss_${idx}`,
        title: label,
        iconFile,
        subType: isBoss ? 'boss' : isCultist ? 'cultist' : 'rogue',
        zoneName: sp.zoneName || '',
        position: sp.position,
        color: '#ef4444'
      });
    } else if (isScav) {
      const label = isSniper ? 'Sniper Scav Doğma Noktası' : 'Scav Doğma Noktası';
      const iconFile = isSniper ? 'spawn_sniper_scav.png' : 'spawn_scav.png';
      const color = isSniper ? '#f97316' : '#fb7185';
      scavSpawns.push({
        id: `spawn_scav_${idx}`,
        title: label,
        iconFile,
        subType: isSniper ? 'sniper' : 'scav',
        zoneName: sp.zoneName || '',
        position: sp.position,
        color
      });
    }
  });

  const hazards = (apiMap && apiMap.hazards) ? apiMap.hazards : [];
  const locks = (apiMap && apiMap.locks) ? apiMap.locks : [];
  const switches = (apiMap && apiMap.switches) ? apiMap.switches : [];
  const stationaryWeapons = (apiMap && apiMap.stationaryWeapons) ? apiMap.stationaryWeapons : [];
  const btrStops = (apiMap && apiMap.btrStops) ? apiMap.btrStops : [];

  const extracts = ((apiMap && apiMap.extracts) ? apiMap.extracts : []).map((ex, i) => {
    const eId = ex.id || `extract_${i}`;
    let requiredKey = null;
    if (ex.position && Array.isArray(locks)) {
      const nearLock = locks.find(
        (lk) =>
          lk.position &&
          lk.key &&
          Math.hypot(lk.position.x - ex.position.x, lk.position.z - ex.position.z) <= 28
      );
      if (nearLock && nearLock.key) {
        requiredKey = nearLock.key;
      }
    }
    const nameUpper = (ex.name || '').toUpperCase();
    let conditionNote = '';
    if (requiredKey) {
      conditionNote = `🔑 Anahtar: ${requiredKey.shortName || requiredKey.name}`;
    } else if (nameUpper.includes('ZB-016')) {
      conditionNote = '🟢 Sığınak / Yeşil İşaret Fişeği (Koşullu)';
    } else if (nameUpper.includes('FLARE')) {
      conditionNote = '🟢 Yeşil İşaret Fişeği Gerekli';
    } else if (nameUpper.includes('CO-OP')) {
      conditionNote = '🤝 PMC + Scav Ortak Çıkış';
    } else if (nameUpper.includes('ARAÇ') || nameUpper.includes('V-EX')) {
      conditionNote = '🚕 Ücretli Araç Çıkışı (RUB)';
    }
    return {
      ...ex,
      id: eId,
      requiredKey,
      conditionNote
    };
  });
  const transits = ((apiMap && apiMap.transits) ? apiMap.transits : []).map((trItem, i) => ({
    ...trItem,
    id: trItem.id || `transit_${i}`
  }));
  const callouts = MAP_CALLOUTS[mapNorm] || [];

  for (const ex of extracts) {
    if (!ex.position) continue;
    nextCandidates.push({
      id: `extract_${ex.id}`,
      title: `Çıkış: ${ex.name}${ex.requiredKey ? ` (🔑 ${ex.requiredKey.shortName || 'Anahtarlı'})` : ''}`,
      subtitle: ex.conditionNote || `Extract (${(ex.faction || 'all').toUpperCase()})`,
      category: 'extract',
      faction: (ex.faction || 'all').toLowerCase(),
      requiresKey: !!ex.requiredKey,
      color: '#10b981',
      position: ex.position
    });
  }

  // AŞAMA 5: Görev Hedefi Pinleri (Seçili Görevler veya Bu Haritanın Tüm Görevleri)
  const taskMarkers = [];
  const activeTaskIdsSet = new Set(currentSettings.activeTaskIds || []);
  const completedTaskIdsSet = new Set(currentSettings.completedTaskIds || []);
  const completedObjSet = new Set(currentSettings.completedObjectiveIds || []);
  const showSelectedTasks = currentSettings?.overlay?.layers?.tasks !== false;
  const showAllTasks = !!currentSettings.showAllMapTasksOnOverlay;

  const doesMapMatch = (mNorm) => {
    if (!mNorm) return false;
    if (mNorm === mapNorm) return true;
    if (mapNorm === 'ground-zero' && mNorm.startsWith('ground-zero')) return true;
    if (mapNorm === 'factory' && mNorm.includes('factory')) return true;
    return false;
  };

  if (ds && Array.isArray(ds.tasks) && (showSelectedTasks || showAllTasks)) {
    for (const task of ds.tasks) {
      if (completedTaskIdsSet.has(task.id)) continue;
      const isTaskSelected = activeTaskIdsSet.has(task.id);
      if (isTaskSelected && !showSelectedTasks && !showAllTasks) continue;
      if (!isTaskSelected && !showAllTasks) continue;

      for (const obj of task.objectives || []) {
        const isObjCompleted = completedObjSet.has(obj.id);
        if (isObjCompleted) continue;

        const pointsOnMap = [];
        for (const z of obj.zones || []) {
          const zMapNorm = z.map?.normalizedName || task.map?.normalizedName;
          if (doesMapMatch(zMapNorm) && z.position) {
            pointsOnMap.push({ position: z.position, zoneId: z.id, source: 'zone' });
          }
        }
        for (const loc of obj.possibleLocations || []) {
          const lMapNorm = loc.map?.normalizedName || task.map?.normalizedName;
          if (doesMapMatch(lMapNorm) && Array.isArray(loc.positions)) {
            for (const p of loc.positions) {
              if (p) pointsOnMap.push({ position: p, zoneId: null, source: 'possible' });
            }
          }
        }

        // "Olası konumlar" aynı eşyanın alternatif spawn noktalarıdır: biri bulununca hepsi kapanır.
        // (Birden fazla olası nokta varsa tek grup; zone'lar kendi başına durak olarak kalır.)
        const possibleCount = pointsOnMap.filter((x) => x.source === 'possible').length;
        const possibleGroupId = possibleCount > 1 ? `taskgrp_${task.id}_${obj.id}` : null;

        pointsOnMap.forEach((pt, idx) => {
          const markerId = `task_${task.id}_${obj.id}_${idx}`;
          const groupId = pt.source === 'possible' && possibleGroupId ? possibleGroupId : null;
          const firstKey = obj.requiredKeys?.[0]?.[0] || task.neededKeys?.[0]?.keys?.[0] || null;
          // Yalnızca gerçek oyun içi ekran görüntüleri: 2D harita krokileri ve eşya ikonları elenir
          const locImages = (Array.isArray(task.locationImages) ? task.locationImages : [])
            .filter(isDisplayableTaskPhoto)
            .map((img) => ({ localPath: img.localPath, caption: img.caption || '' }));
          const bestLocImg = locImages[0]?.localPath || null;
          const tMarker = {
            id: markerId,
            taskId: task.id,
            taskName: task.name,
            taskImageLink: '', // 2D harita şeması olabileceği için asla görev fotoğrafı olarak kullanılmaz
            locationImage: bestLocImg,
            allLocationImages: locImages,
            traderName: task.trader?.name || 'Trader',
            objectiveId: obj.id,
            objectiveType: obj.type,
            description: obj.description,
            isSelectedTask: isTaskSelected,
            questItemName: obj.questItem?.name || obj.markerItem?.name || null,
            questItemIcon:
              obj.questItem?.iconLink ||
              obj.markerItem?.iconLink ||
              obj.items?.[0]?.iconLink ||
              firstKey?.iconLink ||
              '',
            questItemImage:
              bestLocImg ||
              obj.questItem?.image512pxLink ||
              obj.questItem?.iconLink ||
              obj.markerItem?.iconLink ||
              '',
            requiredKeyName: firstKey ? `${firstKey.name} (${firstKey.shortName || ''})` : null,
            requiredKeyIcon: firstKey ? firstKey.iconLink : null,
            position: pt.position,
            groupId,
            groupSize: groupId ? possibleCount : 1
          };
          taskMarkers.push(tMarker);

          nextCandidates.push({
            id: markerId,
            title: `Görev: ${task.name}`,
            subtitle: obj.description || task.trader?.name || 'Görev Hedefi',
            category: 'task',
            isSelectedTask: isTaskSelected,
            color: isTaskSelected ? '#a855f7' : '#eab308',
            position: pt.position,
            groupId,
            groupSize: groupId ? possibleCount : 1
          });
        });
      }
    }
  }

  candidateTargets = nextCandidates;

  // Eğer aktif hedef bu haritada yoksa temizle veya otomatik en yakını seç
  if (activeTarget && !candidateTargets.some((c) => c.id === activeTarget.id)) {
    activeTarget = null;
  }
  computeRotationTour();
  if (currentSettings.autoNearestTarget && !activeTarget && candidateTargets.length > 0) {
    selectNearestTargetToPlayer(false);
  }

  return {
    mapNormalizedName: mapNorm,
    mapName: apiMap ? apiMap.name : geoConfig.name,
    geoConfig,
    mapRenderStyle: currentSettings.mapRenderStyle || 'satellite',
    looseMarkers,
    valuableMarkers,
    containerMarkers,
    pmcSpawns,
    scavSpawns,
    bossSpawns,
    hazards,
    locks,
    switches,
    stationaryWeapons,
    btrStops,
    extracts,
    transits,
    callouts,
    taskMarkers,
    candidateTargets,
    rotationTour,
    visitedTargetIds: [...visitedTargetIds],
    showMapContainers: !!currentSettings.showMapContainers,
    enabledContainerCategories: enabledCatsArr,
    showPmcSpawns: !!currentSettings.showPmcSpawns,
    showScavSpawns: !!currentSettings.showScavSpawns,
    showBossSpawns: !!currentSettings.showBossSpawns,
    showValuableSpawns: !!currentSettings.showValuableSpawns,
    showMapLocks: !!currentSettings.showMapLocks,
    showMapHazards: currentSettings.showMapHazards !== false,
    showMapUtilities: !!currentSettings.showMapUtilities,
    showMapExtracts: currentSettings.showMapExtracts !== false,
    showMapCallouts: currentSettings.showMapCallouts !== false,
    showAllMapTasksOnOverlay: !!currentSettings.showAllMapTasksOnOverlay,
    pinnedItems: pinnedList
  };
}

async function broadcastOverlayMapData() {
  try {
    const payload = await buildOverlayMapPayload();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('map:dataUpdated', payload);
    }
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send('map:dataUpdated', payload);
    }
    broadcastPlayerState();
  } catch (err) {
    addLog('error', 'Overlay harita verisi hazırlanırken hata oluştu.', err.message);
  }
}

function applyOverlayWindowState() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const ov = currentSettings.overlay;

  overlayWindow.setOpacity(Math.max(0.15, Math.min(1.0, ov.opacity)));

  if (ov.visible) {
    overlayWindow.showInactive();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    overlayWindow.hide();
    // Overlay gizlenince açık görev kartı / lightbox kilidini bırak
    if (overlayInteractionLock.locked) {
      overlayInteractionLock = { locked: false, lightbox: false };
      closeLightboxWindow(false);
      sendOverlayKeyAction('closeAll');
    }
  }

  if (ov.editMode) {
    overlayWindow.setIgnoreMouseEvents(false);
    overlayWindow.setFocusable(true);
    overlayWindow.setResizable(true);
  } else {
    // Görev kartı veya lightbox açıkken etkileşim kesilmez (ayar güncellemeleri bile kilidi bozmaz)
    const keepInteractive =
      ov.visible && overlayInteractionLock.locked && currentSettings.hoverInteractiveMap !== false;
    if (keepInteractive) {
      overlayWindow.setIgnoreMouseEvents(false);
    } else {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    overlayWindow.setFocusable(false);
  }
  syncLockShortcuts();
  // setAlwaysOnTop çağrısı overlay'i öne almış olabilir; açık lightbox her zaman en üstte kalsın
  if (lightboxOpen && lightboxWindow && !lightboxWindow.isDestroyed()) {
    lightboxWindow.moveTop();
  }
}

// ---------------------------------------------------------------------------
// Ekran Ortasında Görsel Büyütme Penceresi (Lightbox)
// Overlay küçük bir pencere olduğu için fotoğraf, overlay'in bulunduğu monitörü kaplayan
// ayrı, şeffaf, odak çalmayan (focusable:false) bir pencerede ekranın ortasında gösterilir.
// ---------------------------------------------------------------------------
let lightboxWindow = null;
let lightboxReady = false;
let lightboxOpen = false;
let pendingLightboxPayload = null;

function getLightboxWindow() {
  if (lightboxWindow && !lightboxWindow.isDestroyed()) return lightboxWindow;

  lightboxReady = false;
  lightboxWindow = new BrowserWindow({
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // oyunun odağını çalmaz; Esc / ← / → global kısayollardan gelir
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  lightboxWindow.setAlwaysOnTop(true, 'screen-saver');
  lightboxWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lightboxWindow.loadFile(path.join(__dirname, 'renderer', 'lightbox', 'index.html'));

  lightboxWindow.webContents.on('did-finish-load', () => {
    lightboxReady = true;
    if (pendingLightboxPayload && lightboxOpen) {
      lightboxWindow.webContents.send('lightbox:show', pendingLightboxPayload);
    }
    pendingLightboxPayload = null;
  });

  lightboxWindow.on('closed', () => {
    const wasOpen = lightboxOpen;
    lightboxWindow = null;
    lightboxReady = false;
    lightboxOpen = false;
    if (wasOpen) sendOverlayKeyAction('lightboxClosed');
  });

  return lightboxWindow;
}

function sanitizeLightboxPayload(payload) {
  const photos = (Array.isArray(payload?.photos) ? payload.photos : [])
    .map((p) => ({
      src: String(p?.src || ''),
      caption: String(p?.caption || '').slice(0, 300)
    }))
    // Yalnızca uygulamanın kendi görselleri veya tarkov.dev görselleri
    .filter((p) => p.src.startsWith('../../assets/') || /^https:\/\/([a-z0-9-]+\.)*tarkov\.dev\//i.test(p.src))
    .slice(0, 12);
  const index = Number.isInteger(payload?.index) ? Math.max(0, Math.min(photos.length - 1, payload.index)) : 0;
  return { photos, index, title: String(payload?.title || '').slice(0, 200) };
}

function openLightboxWindow(rawPayload) {
  const payload = sanitizeLightboxPayload(rawPayload);
  if (payload.photos.length === 0) return false;

  const win = getLightboxWindow();
  // Overlay hangi monitördeyse o monitörün tamamını kapla (fotoğraf ekranın ortasında)
  let display = screen.getPrimaryDisplay();
  try {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      display = screen.getDisplayMatching(overlayWindow.getBounds());
    } else {
      display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    }
  } catch (_e) {}
  win.setBounds(display.bounds);

  lightboxOpen = true;
  if (lightboxReady) {
    win.webContents.send('lightbox:show', payload);
  } else {
    pendingLightboxPayload = payload;
  }
  win.setIgnoreMouseEvents(false);
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  return true;
}

function closeLightboxWindow(notifyOverlay = true) {
  if (!lightboxOpen) return;
  lightboxOpen = false;
  pendingLightboxPayload = null;
  if (lightboxWindow && !lightboxWindow.isDestroyed()) {
    lightboxWindow.webContents.send('lightbox:hide');
    lightboxWindow.hide();
  }
  if (notifyOverlay) sendOverlayKeyAction('lightboxClosed');
}

// Geçici kilit kısayolları: lightbox penceresi açıksa tuşlar ona, değilse overlay'e gider
function routeLockKey(action) {
  if (lightboxOpen && lightboxWindow && !lightboxWindow.isDestroyed()) {
    if (action === 'escape') {
      closeLightboxWindow(true);
    } else {
      lightboxWindow.webContents.send('lightbox:nav', action);
    }
    return;
  }
  sendOverlayKeyAction(action);
}

function sendOverlayKeyAction(action) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:keyAction', action);
  }
}

/**
 * Kilit durumuna göre Esc (ve lightbox açıksa ← / →) global kısayollarını kaydeder/kaldırır.
 * Kullanıcının kendi kısayolları bu tuşları kullanıyorsa onlara dokunulmaz.
 */
function syncLockShortcuts() {
  const want = new Set();
  const visible = !!currentSettings?.overlay?.visible;
  if (overlayInteractionLock.locked && visible) {
    want.add('Escape');
    if (overlayInteractionLock.lightbox) {
      want.add('Left');
      want.add('Right');
    }
  }

  for (const acc of [...lockShortcutsActive]) {
    if (!want.has(acc)) {
      try {
        globalShortcut.unregister(acc);
      } catch (_e) {}
      lockShortcutsActive.delete(acc);
    }
  }

  for (const acc of want) {
    if (lockShortcutsActive.has(acc)) continue;
    try {
      if (globalShortcut.isRegistered(acc)) continue;
      const ok = globalShortcut.register(acc, () => routeLockKey(LOCK_SHORTCUT_ACTIONS[acc]));
      if (ok) lockShortcutsActive.add(acc);
    } catch (_e) {}
  }
}

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW } = primaryDisplay.workAreaSize;

  const ov = currentSettings.overlay;
  const x = typeof ov.x === 'number' ? ov.x : screenW - ov.width - 30;
  const y = typeof ov.y === 'number' ? ov.y : 30;

  overlayWindow = new BrowserWindow({
    x,
    y,
    width: ov.width || 460,
    height: ov.height || 460,
    minWidth: 240,
    minHeight: 240,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay', 'index.html'));

  overlayWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[Overlay Web] (lvl ${level}) ${message} [${sourceId}:${line}]`);
  });

  overlayWindow.on('moved', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const [nx, ny] = overlayWindow.getPosition();
    currentSettings.overlay.x = nx;
    currentSettings.overlay.y = ny;
    saveSettings();
    broadcastState();
  });

  overlayWindow.on('resized', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const [nw, nh] = overlayWindow.getSize();
    currentSettings.overlay.width = nw;
    currentSettings.overlay.height = nh;
    saveSettings();
    broadcastState();
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    applyOverlayWindowState();
    broadcastState();
    broadcastOverlayMapData();
    broadcastAutoHomeState();
  });
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'Tarkov Yardımcı Harita — Kontrol Paneli',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0c0e12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  panelWindow.loadFile(path.join(__dirname, 'renderer', 'panel', 'index.html'));

  panelWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[Panel Web] (lvl ${level}) ${message} [${sourceId}:${line}]`);
  });
  panelWindow.show();
  panelWindow.focus();

  panelWindow.on('closed', () => {
    panelWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
    }
    app.quit();
  });

  panelWindow.webContents.on('did-finish-load', () => {
    broadcastState();
    broadcastPlayerState();
    broadcastAutoHomeState();
  });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  lockShortcutsActive.clear(); // unregisterAll geçici kilit tuşlarını da kaldırdı; sonda yeniden senkronlanır
  const sc = currentSettings.shortcuts;
  const statusReport = {};

  const seen = new Map();
  for (const [action, acc] of Object.entries(sc)) {
    if (!acc || !acc.trim()) {
      statusReport[action] = { ok: false, reason: 'Boş kısayol' };
      continue;
    }
    const norm = acc.trim().toLowerCase();
    if (seen.has(norm)) {
      const conflictWith = seen.get(norm);
      statusReport[action] = { ok: false, reason: `'${conflictWith}' ile çakışıyor (${acc})` };
      addLog('warn', `Kısayol çakışması: ${action} ve ${conflictWith} aynı tuşa (${acc}) atanmış.`);
      continue;
    }
    seen.set(norm, action);
  }

  const handlers = {
    toggleOverlay: () => {
      currentSettings.overlay.visible = !currentSettings.overlay.visible;
      if (!currentSettings.overlay.visible && currentSettings.overlay.editMode) {
        currentSettings.overlay.editMode = false;
      }
      saveSettings();
      applyOverlayWindowState();
      broadcastState();
    },
    toggleEditMode: () => {
      if (!currentSettings.overlay.visible) {
        currentSettings.overlay.visible = true;
      }
      currentSettings.overlay.editMode = !currentSettings.overlay.editMode;
      saveSettings();
      applyOverlayWindowState();
      broadcastState();
    },
    opacityUp: () => {
      currentSettings.overlay.opacity = Math.min(1.0, Math.round((currentSettings.overlay.opacity + 0.1) * 100) / 100);
      saveSettings();
      applyOverlayWindowState();
      broadcastState();
    },
    opacityDown: () => {
      currentSettings.overlay.opacity = Math.max(0.2, Math.round((currentSettings.overlay.opacity - 0.1) * 100) / 100);
      saveSettings();
      applyOverlayWindowState();
      broadcastState();
    },
    toggleFollowMode: () => {
      currentSettings.overlay.followMode = !currentSettings.overlay.followMode;
      saveSettings();
      broadcastState();
    },
    nextTarget: () => {
      cycleNextTarget();
    },
    nextMap: () => {
      const mapOrder = Object.keys(MAP_CONFIGS);
      const idx = mapOrder.indexOf(currentSettings.selectedMap);
      const nextIdx = (idx + 1) % mapOrder.length;
      currentSettings.selectedMap = mapOrder[nextIdx];
      resetRaidProgress();
      saveSettings();
      broadcastState();
      broadcastOverlayMapData();
    },
    toggleAutoHome: () => {
      setAutoHomeState(!autoHomeActive);
    },
    zoomIn: () => {
      const curZ = typeof currentSettings.overlay.zoom === 'number' ? currentSettings.overlay.zoom : 2.5;
      currentSettings.overlay.zoom = Math.min(6.5, Math.round((curZ + 0.5) * 100) / 100);
      saveSettings();
      broadcastState();
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('shortcut:action', 'zoomIn');
      }
      addLog('info', `Harita yakınlaştırıldı (Zoom: ${currentSettings.overlay.zoom})`);
    },
    zoomOut: () => {
      const curZ = typeof currentSettings.overlay.zoom === 'number' ? currentSettings.overlay.zoom : 2.5;
      currentSettings.overlay.zoom = Math.max(0.5, Math.round((curZ - 0.5) * 100) / 100);
      saveSettings();
      broadcastState();
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('shortcut:action', 'zoomOut');
      }
      addLog('info', `Harita uzaklaştırıldı (Zoom: ${currentSettings.overlay.zoom})`);
    }
  };

  for (const [action, callback] of Object.entries(handlers)) {
    if (statusReport[action] && !statusReport[action].ok) continue;
    const accelerator = sc[action];
    if (!accelerator) continue;

    try {
      const registered = globalShortcut.register(accelerator, callback);
      if (!registered) {
        statusReport[action] = { ok: false, reason: 'Sistem veya başka uygulama tarafından kullanılıyor' };
      } else {
        statusReport[action] = { ok: true, accelerator };
      }
    } catch (err) {
      statusReport[action] = { ok: false, reason: `Geçersiz tuş dizimi: ${err.message}` };
    }
  }

  syncLockShortcuts();
  return statusReport;
}

function setupIPC() {
  ipcMain.handle('settings:get', () => {
    return {
      settings: currentSettings,
      userDataPath: app.getPath('userData'),
      settingsFilePath: SETTINGS_FILE
    };
  });

  ipcMain.handle('settings:update', async (_event, partial) => {
    if (!partial || typeof partial !== 'object') return { ok: false };

    const prevLang = currentSettings.language;
    const prevMode = currentSettings.gameMode;
    const prevMap = currentSettings.selectedMap;
    const prevShowContainers = currentSettings.showMapContainers;
    const prevEnabledContainerCats = JSON.stringify(currentSettings.enabledContainerCategories || []);
    const prevShowPmcSpawns = currentSettings.showPmcSpawns;
    const prevShowScavSpawns = currentSettings.showScavSpawns;
    const prevShowValuableSpawns = currentSettings.showValuableSpawns;
    const prevShowMapLocks = currentSettings.showMapLocks;
    const prevShowMapHazards = currentSettings.showMapHazards;
    const prevShowMapUtilities = currentSettings.showMapUtilities;
    const prevShowExtracts = currentSettings.showMapExtracts;
    const prevShowCallouts = currentSettings.showMapCallouts;
    const prevShowAllTasks = currentSettings.showAllMapTasksOnOverlay;
    const prevRenderStyle = currentSettings.mapRenderStyle;
    const prevScreenshotsDir = currentSettings.screenshotsDir;
    const prevYawOffset = currentSettings.yawOffset;
    const prevInterval = currentSettings.autoHomeIntervalMs;

    if (partial.gameMode !== undefined) {
      currentSettings.gameModeUserExplicit = true;
    }
    if (partial.autoDetectMapFromCoords !== undefined) {
      currentSettings.autoDetectUserExplicit = true;
    }
    if (partial.autoHomeIntervalMs !== undefined) {
      currentSettings.intervalUserExplicit = true;
    }

    if (partial.overlay) {
      currentSettings.overlay = {
        ...currentSettings.overlay,
        ...partial.overlay,
        layers: {
          ...currentSettings.overlay.layers,
          ...(partial.overlay.layers || {})
        }
      };
    }

    let shortcutsChanged = false;
    if (partial.shortcuts) {
      currentSettings.shortcuts = {
        ...currentSettings.shortcuts,
        ...partial.shortcuts
      };
      shortcutsChanged = true;
    }

    if (Array.isArray(partial.pinnedItems)) {
      currentSettings.pinnedItems = partial.pinnedItems;
    }
    if (Array.isArray(partial.activeTaskIds)) {
      currentSettings.activeTaskIds = partial.activeTaskIds;
    }
    if (Array.isArray(partial.completedObjectiveIds)) {
      currentSettings.completedObjectiveIds = partial.completedObjectiveIds;
    }
    if (Array.isArray(partial.enabledContainerCategories)) {
      currentSettings.enabledContainerCategories = partial.enabledContainerCategories;
      currentSettings.showMapContainers = partial.enabledContainerCategories.length > 0;
    } else if (partial.enabledContainerCategories && typeof partial.enabledContainerCategories === 'object') {
      const enabledArr = Object.keys(partial.enabledContainerCategories).filter(
        (k) => !!partial.enabledContainerCategories[k]
      );
      currentSettings.enabledContainerCategories = enabledArr;
      currentSettings.showMapContainers = enabledArr.length > 0;
    }

    if (Array.isArray(partial.rotationCategories)) {
      currentSettings.rotationCategories = partial.rotationCategories;
    }

    const topKeys = [
      'gameMode',
      'language',
      'playerLevel',
      'screenshotsDir',
      'deleteScreenshotsAfterRead',
      'autoDetectMapFromCoords',
      'mapRenderStyle',
      'autoHomeIntervalMs',
      'yawOffset',
      'autoNearestTarget',
      'autoRotationEnabled',
      'rotationMaxStops',
      'rotationRaidMinutesLeft',
      'rotationAvoidConditionalExtracts',
      'rotationAvoidHazards',
      'rotationPreferValuableLoot',
      'selectedMap',
      'tarkovLogsDir',
      'autoDetectMapFromLogs',
      'movePositionTrigger',
      'showMapContainers',
      'showPmcSpawns',
      'showScavSpawns',
      'showBossSpawns',
      'showValuableSpawns',
      'showMapLocks',
      'showMapHazards',
      'showMapUtilities',
      'showMapExtracts',
      'showMapCallouts',
      'hoverInteractiveMap',
      'showAllMapTasksOnOverlay'
    ];
    for (const key of topKeys) {
      if (partial[key] !== undefined) {
        currentSettings[key] = partial[key];
      }
    }
    if (partial.selectedMap && partial.selectedMap !== prevMap) {
      visitedTargetIds.clear();
    }

    saveSettings();
    applyOverlayWindowState();
    const shortcutStatus = shortcutsChanged ? registerShortcuts() : null;

    if (currentSettings.screenshotsDir !== prevScreenshotsDir) {
      setupScreenshotWatcher();
    }

    if (autoHomeActive && currentSettings.autoHomeIntervalMs !== prevInterval) {
      setAutoHomeState(true);
    }

    if (currentSettings.yawOffset !== prevYawOffset && playerState.current && playerState.current.quaternion) {
      const q = playerState.current.quaternion;
      playerState.current.yaw = quaternionToYawDegrees(q.qx, q.qy, q.qz, q.qw, currentSettings.yawOffset);
      playerState.current.compass = degreesToCompassLabel(playerState.current.yaw);
    }

    broadcastState();
    broadcastPlayerState();

    if (currentSettings.language !== prevLang || currentSettings.gameMode !== prevMode) {
      await dataService.loadData({
        lang: currentSettings.language,
        gameMode: currentSettings.gameMode,
        forceRefresh: false
      });
    }

    await broadcastOverlayMapData();
    broadcastPlayerState();

    return { ok: true, settings: currentSettings, shortcutStatus };
  });

  ipcMain.handle('shortcuts:validateAndRegister', (_event, newShortcuts) => {
    if (newShortcuts && typeof newShortcuts === 'object') {
      currentSettings.shortcuts = {
        ...currentSettings.shortcuts,
        ...newShortcuts
      };
      saveSettings();
    }
    const status = registerShortcuts();
    broadcastState();
    return { ok: true, status, settings: currentSettings };
  });

  ipcMain.handle('shortcuts:resetDefaults', () => {
    currentSettings.shortcuts = { ...DEFAULT_SETTINGS.shortcuts };
    saveSettings();
    const status = registerShortcuts();
    broadcastState();
    return { ok: true, status, settings: currentSettings };
  });

  ipcMain.handle('api:loadData', async (_event, opts = {}) => {
    const res = await dataService.loadData({
      lang: currentSettings.language,
      gameMode: currentSettings.gameMode,
      forceRefresh: !!opts.forceRefresh
    });
    if (res.ok) {
      await broadcastOverlayMapData();
    }
    return {
      ok: res.ok,
      fromCache: res.fromCache,
      offlineFallback: res.offlineFallback,
      updatedAt: res.updatedAt,
      error: res.error,
      gameMode: currentSettings.gameMode
    };
  });

  ipcMain.handle('api:getItems', async () => {
    if (!dataService.currentData) {
      const res = await dataService.loadData({
        lang: currentSettings.language,
        gameMode: currentSettings.gameMode
      });
      if (!res.ok) return { ok: false, error: res.error, items: [] };
    }
    return {
      ok: true,
      items: dataService.currentData.items,
      updatedAt: dataService.currentData.updatedAt,
      gameMode: currentSettings.gameMode
    };
  });

  ipcMain.handle('api:getOverlayMapPayload', async () => {
    const payload = await buildOverlayMapPayload();
    return { ok: true, payload };
  });

  ipcMain.handle('api:getMapSvg', async (_event, mapNormalizedName) => {
    return await dataService.getMapSvg(mapNormalizedName || currentSettings.selectedMap);
  });

  ipcMain.handle('loot:togglePinItem', async (_event, item) => {
    if (!item || !item.id) return { ok: false };
    const list = [...(currentSettings.pinnedItems || [])];
    const existingIdx = list.findIndex((x) => x.id === item.id);
    if (existingIdx >= 0) {
      list.splice(existingIdx, 1);
      addLog('info', `Eşya harita pin listesinden çıkarıldı: ${item.name}`);
    } else {
      const usedColors = new Set(list.map((x) => x.color));
      const nextColor = ITEM_COLORS.find((c) => !usedColors.has(c)) || ITEM_COLORS[list.length % ITEM_COLORS.length];
      list.push({
        id: item.id,
        name: item.name,
        shortName: item.shortName,
        iconLink: item.iconLink,
        color: nextColor
      });
      addLog('info', `Eşya haritaya pinlendi: ${item.name} (${nextColor})`);
    }
    currentSettings.pinnedItems = list;
    saveSettings();
    broadcastState();
    await broadcastOverlayMapData();
    return { ok: true, pinnedItems: list };
  });

  ipcMain.handle('loot:clearPinnedItems', async () => {
    currentSettings.pinnedItems = [];
    saveSettings();
    broadcastState();
    await broadcastOverlayMapData();
    return { ok: true, pinnedItems: [] };
  });

  // AŞAMA 3 & AUTO-HOME IPC
  ipcMain.handle('player:getState', () => {
    const navInfo =
      playerState.current && activeTarget
        ? calculateNavigationToTarget(
            playerState.current.position,
            playerState.current.yaw,
            activeTarget.position
          )
        : null;
    return { ...playerState, activeTarget, navInfo };
  });

  ipcMain.handle('player:testFilename', async (_event, sampleFilename) => {
    const parsed = parseScreenshotFilename(sampleFilename, currentSettings.yawOffset || 0);
    if (parsed.ok) {
      await handleParsedPlayerPosition(parsed, null);
    }
    return parsed;
  });

  ipcMain.handle('player:clearTrail', () => {
    playerState.trail = [];
    broadcastPlayerState();
    return { ok: true };
  });

  ipcMain.handle('player:scanLatestScreenshot', async () => {
    const dir = (currentSettings.screenshotsDir || '').trim();
    if (!dir || !fs.existsSync(dir)) {
      return { ok: false, error: `Klasör bulunamadı: ${dir}` };
    }
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
      .map((f) => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        return { name: f, full, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      return { ok: false, error: 'Klasörde henüz ekran görüntüsü dosyası yok.' };
    }

    const latest = files[0];
    const parsed = parseScreenshotFilename(latest.name, currentSettings.yawOffset || 0);
    if (parsed.ok) {
      await handleParsedPlayerPosition(parsed, latest.full);
    }
    return parsed;
  });

  ipcMain.handle('autohome:get', () => ({
    active: autoHomeActive,
    intervalMs: currentSettings.autoHomeIntervalMs || 1000
  }));

  ipcMain.handle('autohome:toggle', (_event, forceState) => {
    const next = typeof forceState === 'boolean' ? forceState : !autoHomeActive;
    setAutoHomeState(next);
    return { active: autoHomeActive, intervalMs: currentSettings.autoHomeIntervalMs || 1000 };
  });

  // AŞAMA 4: Hedef Seçimi ve Rota Çizgisi IPC
  ipcMain.handle('target:set', (_event, targetObj) => {
    activeTarget = targetObj || null;
    if (activeTarget) {
      addLog('info', `Rota hedefi seçildi: ${activeTarget.title}`);
    }
    broadcastPlayerState();
    return { ok: true, activeTarget };
  });

  ipcMain.handle('target:next', () => {
    const next = cycleNextTarget();
    return { ok: true, activeTarget: next };
  });

  ipcMain.handle('target:clear', () => {
    activeTarget = null;
    broadcastPlayerState();
    return { ok: true };
  });

  ipcMain.handle('target:clearVisited', async () => {
    visitedTargetIds.clear();
    activeTarget = null;
    await broadcastOverlayMapData();
    broadcastPlayerState();
    addLog('info', 'Gezilen / lootlanan hedef listesi sıfırlandı.');
    return { ok: true };
  });

  ipcMain.handle('target:startRotation', async (_event, opts = {}) => {
    currentSettings.autoRotationEnabled = true;
    if (Array.isArray(opts.categories) && opts.categories.length > 0) {
      currentSettings.rotationCategories = opts.categories;
    }
    if (opts.resetVisited) {
      visitedTargetIds.clear();
    }
    activeTarget = null;
    saveSettings();
    await broadcastOverlayMapData();
    computeRotationTour();
    if (!activeTarget && rotationTour.length > 0) {
      activeTarget = rotationTour[0];
    }
    broadcastState();
    broadcastPlayerState();
    return { ok: true, activeTarget, rotationTour, tour: rotationTour, rotationInfo };
  });

  ipcMain.handle('screenshot:getLatestDataUrl', async () => {
    const dir = (currentSettings.screenshotsDir || '').trim();
    if (dir && fs.existsSync(dir)) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
        .map((f) => {
          const full = path.join(dir, f);
          const st = fs.statSync(full);
          return { name: f, full, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        const latest = files[0];
        if (!lastCapturedScreenshot || latest.mtime >= lastCapturedScreenshot.timestamp - 2000) {
          const buf = fs.readFileSync(latest.full);
          const ext = /\.jpe?g$/i.test(latest.full) ? 'jpeg' : 'png';
          return {
            ok: true,
            filename: latest.name,
            dataUrl: `data:image/${ext};base64,${buf.toString('base64')}`
          };
        }
      }
    }
    if (lastCapturedScreenshot && lastCapturedScreenshot.buffer) {
      return {
        ok: true,
        filename: lastCapturedScreenshot.filename,
        dataUrl: `data:image/${lastCapturedScreenshot.ext};base64,${lastCapturedScreenshot.buffer.toString('base64')}`
      };
    }
    return {
      ok: false,
      error: 'Ekran görüntüsü klasöründe henüz görüntü bulunamadı. Oyun içinde envanter açıkken ekran görüntüsü (PrintScreen / Home) alın veya Ctrl+V ile yapıştırın.'
    };
  });

  // Fare Overlay Üzerine Geldiğinde Sürükleme / Yakınlaştırma İçin Geçici Etkileşim IPC
  ipcMain.handle('overlay:setHoverInteractive', (_event, interactive) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false };
    if (currentSettings.overlay.editMode) return { ok: true };
    if (!currentSettings.hoverInteractiveMap) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      return { ok: true };
    }
    // Sabit görev kartı / lightbox açıkken "etkileşimi kapat" istekleri yok sayılır
    if (interactive || overlayInteractionLock.locked) {
      overlayWindow.setIgnoreMouseEvents(false);
    } else {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    return { ok: true };
  });

  // Ekran ortasında görsel büyütme penceresi
  ipcMain.handle('lightbox:open', (_event, payload) => ({ ok: openLightboxWindow(payload) }));
  ipcMain.handle('lightbox:close', () => {
    closeLightboxWindow(true);
    return { ok: true };
  });

  // Sabit görev kartı / lightbox açık-kapalı bildirimi: etkileşim kilidi + geçici Esc/←/→ kısayolları
  ipcMain.handle('overlay:setInteractionLock', (_event, payload) => {
    const locked = !!(payload && payload.locked);
    const lightbox = locked && !!(payload && payload.lightbox);
    overlayInteractionLock = { locked, lightbox };

    if (overlayWindow && !overlayWindow.isDestroyed() && !currentSettings.overlay.editMode) {
      if (locked && currentSettings.hoverInteractiveMap !== false) {
        overlayWindow.setIgnoreMouseEvents(false);
      }
      // Kilit kalkınca renderer, fare pencere dışındaysa setHoverInteractive(false) gönderir
    }
    syncLockShortcuts();
    return { ok: true };
  });

  // AŞAMA 5: Görev Listesi, Görev Seçimi ve Görev Eşyalarını Pinleme IPC
  ipcMain.handle('api:getTasks', async () => {
    if (!dataService.currentData) {
      const res = await dataService.loadData({
        lang: currentSettings.language,
        gameMode: currentSettings.gameMode
      });
      if (!res.ok) return { ok: false, error: res.error, tasks: [] };
    }
    return {
      ok: true,
      tasks: dataService.currentData.tasks || [],
      updatedAt: dataService.currentData.updatedAt,
      gameMode: currentSettings.gameMode
    };
  });

  /**
   * Bir görev aktif (açık) olduğunda, onun açılması için bitirilmesi şart olan (taskRequirements)
   * tüm geçmiş ön koşul görevlerini ve onların alt hedeflerini özyinelemeli (recursive) olarak bulur.
   */
  function collectPrerequisiteCompletedIds(seedTaskIds) {
    const tasks = (dataService && dataService.currentData && dataService.currentData.tasks) || [];
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    const autoCompletedTasks = new Set(currentSettings.completedTaskIds || []);
    const autoCompletedObjs = new Set(currentSettings.completedObjectiveIds || []);

    const queue = [...seedTaskIds];
    const visited = new Set(seedTaskIds);

    while (queue.length > 0) {
      const curId = queue.shift();
      const t = tasksById.get(curId);
      if (!t || !Array.isArray(t.taskRequirements)) continue;

      for (const req of t.taskRequirements) {
        const reqId = req.taskId || req.task?.id;
        if (!reqId) continue;
        const statuses = req.status || ['complete'];
        if (statuses.includes('complete') || statuses.includes(' any')) {
          autoCompletedTasks.add(reqId);
          const reqTask = tasksById.get(reqId);
          if (reqTask && Array.isArray(reqTask.objectives)) {
            for (const o of reqTask.objectives) {
              if (o && o.id) autoCompletedObjs.add(o.id);
            }
          }
          if (!visited.has(reqId)) {
            visited.add(reqId);
            queue.push(reqId);
          }
        }
      }
    }

    return {
      completedTaskIds: [...autoCompletedTasks],
      completedObjectiveIds: [...autoCompletedObjs]
    };
  }

  ipcMain.handle('tasks:toggleTask', async (_event, taskId) => {
    if (!taskId) return { ok: false };
    const list = new Set(currentSettings.activeTaskIds || []);
    const compTasks = new Set(currentSettings.completedTaskIds || []);

    if (list.has(taskId)) {
      list.delete(taskId);
    } else {
      list.add(taskId);
      compTasks.delete(taskId); // Aktif seçilen görev tamamlanmış listesindeyse çıkar
      currentSettings.completedTaskIds = [...compTasks];
      const prereqs = collectPrerequisiteCompletedIds([taskId]);
      currentSettings.completedTaskIds = prereqs.completedTaskIds.filter((id) => !list.has(id));
      currentSettings.completedObjectiveIds = prereqs.completedObjectiveIds;
    }
    currentSettings.activeTaskIds = [...list];
    saveSettings();
    broadcastState();
    await broadcastOverlayMapData();
    return {
      ok: true,
      activeTaskIds: currentSettings.activeTaskIds,
      completedTaskIds: currentSettings.completedTaskIds
    };
  });

  ipcMain.handle('tasks:toggleCompletedTask', async (_event, taskId) => {
    if (!taskId) return { ok: false };
    const comp = new Set(currentSettings.completedTaskIds || []);
    const act = new Set(currentSettings.activeTaskIds || []);
    const compObjs = new Set(currentSettings.completedObjectiveIds || []);
    const tasks = (dataService && dataService.currentData && dataService.currentData.tasks) || [];
    const targetTask = tasks.find((t) => t.id === taskId);

    if (comp.has(taskId)) {
      comp.delete(taskId);
      if (targetTask) {
        for (const o of targetTask.objectives || []) compObjs.delete(o.id);
      }
    } else {
      comp.add(taskId);
      act.delete(taskId);
      if (targetTask) {
        for (const o of targetTask.objectives || []) compObjs.add(o.id);
      }
    }

    currentSettings.completedTaskIds = [...comp];
    currentSettings.activeTaskIds = [...act];
    currentSettings.completedObjectiveIds = [...compObjs];
    saveSettings();
    broadcastState();
    await broadcastOverlayMapData();
    return {
      ok: true,
      completedTaskIds: currentSettings.completedTaskIds,
      activeTaskIds: currentSettings.activeTaskIds
    };
  });

  ipcMain.handle('tasks:setActiveTasks', async (_event, taskIdsArray) => {
    if (!Array.isArray(taskIdsArray)) return { ok: false };
    const merged = new Set([...(currentSettings.activeTaskIds || []), ...taskIdsArray]);
    currentSettings.activeTaskIds = [...merged];

    const prevCompCount = (currentSettings.completedTaskIds || []).length;
    const prereqs = collectPrerequisiteCompletedIds(currentSettings.activeTaskIds);
    currentSettings.completedTaskIds = prereqs.completedTaskIds.filter((id) => !merged.has(id));
    currentSettings.completedObjectiveIds = prereqs.completedObjectiveIds;
    const newlyCompletedCount = Math.max(0, currentSettings.completedTaskIds.length - prevCompCount);

    saveSettings();
    broadcastState();
    await broadcastOverlayMapData();
    addLog(
      'info',
      `Görev listesi güncellendi (${currentSettings.activeTaskIds.length} aktif görev, ${currentSettings.completedTaskIds.length} eski ön koşul görevi otomatik tamamlandı olarak işaretlendi).`
    );
    return {
      ok: true,
      activeTaskIds: currentSettings.activeTaskIds,
      completedTaskIds: currentSettings.completedTaskIds,
      newlyCompletedCount
    };
  });

  ipcMain.handle('tasks:clearActiveTasks', async () => {
    currentSettings.activeTaskIds = [];
    currentSettings.completedTaskIds = [];
    currentSettings.completedObjectiveIds = [];
    saveSettings();
    broadcastState();
    await broadcastOverlayMapData();
    addLog('info', 'Aktif ve tamamlanan görev listesi temizlendi.');
    return { ok: true, activeTaskIds: [], completedTaskIds: [] };
  });

  ipcMain.handle('tasks:toggleObjective', async (_event, objectiveId) => {
    if (!objectiveId) return { ok: false };
    const list = new Set(currentSettings.completedObjectiveIds || []);
    if (list.has(objectiveId)) {
      list.delete(objectiveId);
    } else {
      list.add(objectiveId);
    }
    currentSettings.completedObjectiveIds = [...list];
    saveSettings();
    broadcastState();
    await broadcastOverlayMapData();
    return { ok: true, completedObjectiveIds: currentSettings.completedObjectiveIds };
  });

  ipcMain.handle('loot:pinMultipleItems', async (_event, itemsArray) => {
    if (!Array.isArray(itemsArray) || itemsArray.length === 0) return { ok: false };
    const list = [...(currentSettings.pinnedItems || [])];
    let addedCount = 0;

    for (const item of itemsArray) {
      if (!item || !item.id) continue;
      if (list.some((x) => x.id === item.id)) continue;
      const usedColors = new Set(list.map((x) => x.color));
      const nextColor = ITEM_COLORS.find((c) => !usedColors.has(c)) || ITEM_COLORS[list.length % ITEM_COLORS.length];
      list.push({
        id: item.id,
        name: item.name,
        shortName: item.shortName,
        iconLink: item.iconLink,
        color: nextColor
      });
      addedCount++;
    }

    if (addedCount > 0) {
      currentSettings.pinnedItems = list;
      saveSettings();
      broadcastState();
      await broadcastOverlayMapData();
      addLog('info', `${addedCount} görev eşyası harita pin listesine eklendi.`);
    }
    return { ok: true, pinnedItems: list, addedCount };
  });

  ipcMain.handle('logs:get', () => logs);
  ipcMain.handle('logs:clear', () => {
    logs = [];
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  loadSettings();
  dataService = new TarkovDataService(app.getPath('userData'), addLog);
  setupIPC();
  createPanelWindow();
  createOverlayWindow();
  registerShortcuts();
  setupScreenshotWatcher();
  setupTarkovLogMapWatcher();

  addLog('info', 'Uygulama başlatıldı (PvE Flea Fiyatları, Konum İsimleri, Görev OCR ve Harita Pinleri).');
  await dataService.loadData({
    lang: currentSettings.language,
    gameMode: currentSettings.gameMode,
    forceRefresh: false
  });
  await broadcastOverlayMapData();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  setAutoHomeState(false);
  if (logPollTimer) {
    clearInterval(logPollTimer);
    logPollTimer = null;
  }
  if (keySenderProc) {
    try {
      keySenderProc.kill();
    } catch (_e) {}
  }
  if (screenshotWatcher) {
    screenshotWatcher.close().catch(() => {});
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
