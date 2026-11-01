const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const { TarkovDataService } = require('./src/api/tarkovApi');
const { MAP_CONFIGS, MAP_CALLOUTS, calculateNavigationToTarget } = require('./src/geo/coordinates');
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

function computeRotationTour() {
  if (!currentSettings || !currentSettings.autoRotationEnabled) {
    rotationTour = activeTarget ? [activeTarget] : [];
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

  const mainPool = [];
  const seenCoords = new Set();
  for (const c of candidateTargets) {
    if (!c || !c.position || visitedTargetIds.has(c.id)) continue;
    if (c.category === 'extract') continue;
    if (!rotCats.has(c.category)) continue;
    if (c.category === 'task' && activeTaskIdsSet.size > 0 && !c.isSelectedTask) continue;

    const coordKey = `${Math.round(c.position.x / 4)}_${Math.round(c.position.z / 4)}`;
    if (seenCoords.has(coordKey) && (!activeTarget || activeTarget.id !== c.id)) continue;
    seenCoords.add(coordKey);
    mainPool.push(c);
  }

  const tour = [];
  const usedIds = new Set();
  let curPos = refPos;

  if (activeTarget && !visitedTargetIds.has(activeTarget.id) && activeTarget.position) {
    tour.push(activeTarget);
    usedIds.add(activeTarget.id);
    curPos = activeTarget.position;
  }

  const maxMainStops = 5;
  while (tour.length < maxMainStops) {
    let best = null;
    let bestDist = Infinity;
    for (const cand of mainPool) {
      if (usedIds.has(cand.id)) continue;
      // Görev hedeflerine hafif öncelik bonusu ver
      const rawDist = Math.hypot(cand.position.x - curPos.x, cand.position.z - curPos.z);
      const weightedDist = cand.category === 'task' && cand.isSelectedTask ? rawDist * 0.85 : rawDist;
      if (weightedDist < bestDist) {
        bestDist = weightedDist;
        best = cand;
      }
    }
    if (!best) break;
    tour.push(best);
    usedIds.add(best.id);
    curPos = best.position;
  }

  // Eğer rotasyonda Çıkış (Extract) seçiliyse, son durağa en yakın PMC/Shared çıkışı zincirin sonuna ekle
  if (rotCats.has('extract') && (tour.length > 0 || mainPool.length === 0)) {
    const extStart = tour.length > 0 ? tour[tour.length - 1].position : curPos;
    let bestExt = null;
    let bestExtDist = Infinity;
    for (const c of candidateTargets) {
      if (c.category !== 'extract' || !c.position || visitedTargetIds.has(c.id) || usedIds.has(c.id)) continue;
      if (c.faction === 'scav') continue;
      const d = Math.hypot(c.position.x - extStart.x, c.position.z - extStart.z);
      if (d < bestExtDist) {
        bestExtDist = d;
        bestExt = c;
      }
    }
    if (bestExt) {
      tour.push(bestExt);
    }
  }

  if (!activeTarget && tour.length > 0 && (currentSettings.autoNearestTarget || currentSettings.autoRotationEnabled)) {
    activeTarget = tour[0];
  }

  rotationTour = tour;
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
    const d = Math.hypot(t.position.x - p.x, t.position.z - p.z);
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
    visitedTargetIds.add(activeTarget.id);
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
      const buf = fs.readFileSync(fullFilePath);
      const ext = path.extname(fullFilePath).toLowerCase() === '.jpg' ? 'jpeg' : 'png';
      lastCapturedScreenshot = {
        filename: path.basename(fullFilePath),
        dataUrl: `data:image/${ext};base64,${buf.toString('base64')}`,
        timestamp: Date.now()
      };
    } catch (_e) {
      // ignore
    }
  }

  // Oyuncu aktif hedefe <= 16 metre yaklaştıysa otomatik olarak tamamlandı işaretle ve sıradaki hedefe geç!
  if (activeTarget && activeTarget.position && parsed.position) {
    const distToActive = Math.hypot(
      activeTarget.position.x - parsed.position.x,
      activeTarget.position.z - parsed.position.z
    );
    if (distToActive <= 16) {
      const prevCat = activeTarget.category;
      const doneTitle = activeTarget.title;
      visitedTargetIds.add(activeTarget.id);
      activeTarget = null;
      computeRotationTour();
      if (!activeTarget) {
        selectNearestTargetToPlayer(false, prevCat);
      }
      addLog(
        'info',
        `Hedefe ulaşıldı (${distToActive.toFixed(1)}m <= 16m): "${doneTitle}" tamamlandı, sıradaki en yakın hedefe geçildi.`
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
      playerState.trail = [];
      activeTarget = null;
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
    lastDetectedLogSignature = signature;

    const mappedNorm = SCENE_TO_MAP[presetKey];
    if (mappedNorm && mappedNorm !== currentSettings.selectedMap) {
      const oldMap = currentSettings.selectedMap;
      currentSettings.selectedMap = mappedNorm;
      playerState.trail = [];
      activeTarget = null;
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
    const cId = `cont_${idx}`;
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
            pointsOnMap.push({ position: z.position, zoneId: z.id });
          }
        }
        for (const loc of obj.possibleLocations || []) {
          const lMapNorm = loc.map?.normalizedName || task.map?.normalizedName;
          if (doesMapMatch(lMapNorm) && Array.isArray(loc.positions)) {
            for (const p of loc.positions) {
              if (p) pointsOnMap.push({ position: p, zoneId: null });
            }
          }
        }

        pointsOnMap.forEach((pt, idx) => {
          const markerId = `task_${task.id}_${obj.id}_${idx}`;
          const firstKey = obj.requiredKeys?.[0]?.[0] || task.neededKeys?.[0]?.keys?.[0] || null;
          const isMapPhoto = (c = '', orig = '') => {
            const t = `${c} ${orig}`.toLowerCase();
            return t.includes('marked on map') || t.includes('on map') || t.includes('harita') || t.includes('map.png') || t.includes('map.jpg') || t.includes('overview') || t.includes('layout');
          };
          const locImages = (Array.isArray(task.locationImages) ? task.locationImages : []).filter(img => img && !isMapPhoto(img.caption, img.originalName));
          const bestLocImg = locImages[0]?.localPath || null;
          const tMarker = {
            id: markerId,
            taskId: task.id,
            taskName: task.name,
            taskImageLink: task.taskImageLink || '',
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
            position: pt.position
          };
          taskMarkers.push(tMarker);

          nextCandidates.push({
            id: markerId,
            title: `Görev: ${task.name}`,
            subtitle: obj.description || task.trader?.name || 'Görev Hedefi',
            category: 'task',
            isSelectedTask: isTaskSelected,
            color: isTaskSelected ? '#a855f7' : '#eab308',
            position: pt.position
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
  }

  if (ov.editMode) {
    overlayWindow.setIgnoreMouseEvents(false);
    overlayWindow.setFocusable(true);
    overlayWindow.setResizable(true);
  } else {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setFocusable(false);
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
    return { ok: true, activeTarget, rotationTour };
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
          const ext = path.extname(latest.full).toLowerCase() === '.jpg' ? 'jpeg' : 'png';
          return {
            ok: true,
            filename: latest.name,
            dataUrl: `data:image/${ext};base64,${buf.toString('base64')}`
          };
        }
      }
    }
    if (lastCapturedScreenshot && lastCapturedScreenshot.dataUrl) {
      return {
        ok: true,
        filename: lastCapturedScreenshot.filename,
        dataUrl: lastCapturedScreenshot.dataUrl
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
    if (interactive) {
      overlayWindow.setIgnoreMouseEvents(false);
    } else {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    }
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
