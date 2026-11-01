(function () {
  const SHORTCUT_LABELS = {
    toggleOverlay: 'Overlay Göster / Gizle',
    toggleEditMode: 'Düzenleme Modu Aç / Kapat',
    toggleAutoHome: 'Otomatik HOME Tuşu Aç / Kapat',
    opacityUp: 'Saydamlık Artır',
    opacityDown: 'Saydamlık Azalt',
    toggleFollowMode: 'Takip / Sabit Modu Değiştir',
    nextTarget: 'Sonraki Hedefe Geç',
    nextMap: 'Sonraki Haritaya Geç',
    zoomIn: 'Harita Yakınlaştır',
    zoomOut: 'Harita Uzaklaştır'
  };

  const MAP_TR_NAMES = {
    customs: 'Gümrük',
    woods: 'Ormanlık',
    interchange: 'Kavşak',
    factory: 'Fabrika',
    'night-factory': 'Fabrika (Gece)',
    shoreline: 'Sahil',
    reserve: 'Üs',
    lighthouse: 'Deniz Feneri',
    'streets-of-tarkov': 'Tarkov Sokakları',
    'ground-zero': 'Sıfır Noktası',
    'ground-zero-21': 'Sıfır Noktası (21+)',
    'the-lab': 'Laboratuvar'
  };

  function getTurkishMapName(mapNormOrName) {
    if (!mapNormOrName) return 'Çoklu Harita';
    const norm = String(mapNormOrName).toLowerCase().trim().replace(/\s+/g, '-');
    if (MAP_TR_NAMES[norm]) return MAP_TR_NAMES[norm];
    for (const [k, v] of Object.entries(MAP_TR_NAMES)) {
      if (norm.includes(k)) return v;
    }
    return mapNormOrName;
  }

  function isLikelyEnglishText(str) {
    if (!str) return false;
    return /\b(eliminate|find|hand over|locate|mark|survive|extract|plant|reach|obtain|kill|scavs|operatives|raid)\b/i.test(str);
  }

  let currentSettings = null;
  let lastShortcutStatus = {};
  let allItems = [];
  let allTasks = [];
  let fuseTasks = null;
  let searchDebounceTimer = null;
  let taskSearchDebounceTimer = null;
  let currentPlayerState = null;
  let candidateTargets = [];

  // Sayfalama & Kaydırma Durumu
  const PAGE_SIZE = 50;
  let lootVisibleCount = PAGE_SIZE;
  let tasksVisibleCount = PAGE_SIZE;
  const tabScrollPositions = {};
  const collapsedTaskGroups = new Set();
  let lastOcrBlob = null;
  let pendingOcrTaskIds = [];

  function normalizeTr(str) {
    if (!str) return '';
    return String(str)
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .toLowerCase()
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .trim();
  }

  function formatRub(val) {
    if (!val || val <= 0) return '-';
    return `${Math.round(val).toLocaleString('tr-TR')} ₽`;
  }

  // TOAST BİLDİRİM SİSTEMİ (Sağ Alt, 3 sn + Geri Al Desteği)
  const toastContainer = document.getElementById('toast-container');

  function showToast(message, type = 'info', undoCallback = null) {
    if (!toastContainer) return;
    const item = document.createElement('div');
    const typeClass =
      type === 'ok' ? 'toast-ok' : type === 'warn' ? 'toast-warn' : type === 'danger' ? 'toast-danger' : '';
    item.className = `toast-item ${typeClass}`;

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    item.appendChild(textSpan);

    if (typeof undoCallback === 'function') {
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'btn btn-secondary';
      undoBtn.textContent = 'Geri al';
      undoBtn.addEventListener('click', () => {
        undoCallback();
        item.remove();
      });
      item.appendChild(undoBtn);
    }

    toastContainer.appendChild(item);
    setTimeout(() => {
      if (item.parentNode) item.remove();
    }, 3500);
  }

  // SEKME GEÇİŞLERİ (Kaydırma Konumunu Hatırlar)
  const mainScrollArea = document.getElementById('main-scroll-area');
  let currentActiveTabId = 'tab-loot';

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTabId = btn.dataset.tab;
      if (!nextTabId || nextTabId === currentActiveTabId) return;

      if (mainScrollArea) {
        tabScrollPositions[currentActiveTabId] = mainScrollArea.scrollTop;
      }

      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const target = document.getElementById(nextTabId);
      if (target) target.classList.add('active');
      currentActiveTabId = nextTabId;

      if (mainScrollArea) {
        mainScrollArea.scrollTop = tabScrollPositions[nextTabId] || 0;
      }
    });
  });

  // AKORDEON KONTROLLERİ (Katmanlar & Gelişmiş)
  function setupAccordion(btnId, panelId) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
    });
  }

  setupAccordion('btn-acc-layers', 'panel-acc-layers');
  setupAccordion('btn-acc-containers', 'panel-acc-containers');
  setupAccordion('btn-acc-advanced', 'panel-acc-advanced');

  // DOM Referansları
  const ovStatusPill = document.getElementById('ov-status-pill');
  const ovStatusDot = document.getElementById('ov-status-dot');
  const rowToggleVisible = document.getElementById('row-toggle-visible');
  const btnToggleVisible = document.getElementById('btn-toggle-visible');
  const btnToggleEdit = document.getElementById('btn-toggle-edit');
  const rowToggleAutoHome = document.getElementById('row-toggle-autohome');
  const btnToggleAutoHome = document.getElementById('btn-toggle-autohome');
  const autoHomeStatusDot = document.getElementById('autohome-status-dot');
  const autoHomeSubLabel = document.getElementById('autohome-sub-label');

  const selectGamemodeQuick = document.getElementById('select-gamemode-quick');
  const segGamemodeButtons = document.querySelectorAll('.seg-btn[data-gamemode]');
  const selectMap = document.getElementById('select-map');
  const selectMapStyle = document.getElementById('select-map-style');
  const rangeOpacity = document.getElementById('range-opacity');
  const lblOpacity = document.getElementById('lbl-opacity');

  const lblLayersCount = document.getElementById('lbl-layers-count');
  const btnLayersAllOn = document.getElementById('btn-layers-all-on');
  const btnLayersAllOff = document.getElementById('btn-layers-all-off');

  const lblContainersCount = document.getElementById('lbl-containers-count');
  const btnContainersAllOn = document.getElementById('btn-containers-all-on');
  const btnContainersAllOff = document.getElementById('btn-containers-all-off');
  const containerCatCheckboxes = Array.from(document.querySelectorAll('.chk-container-cat'));

  const chkShowCallouts = document.getElementById('chk-show-callouts');
  const chkLayerLoot = document.getElementById('chk-layer-loot');
  const chkShowValuableSpawns = document.getElementById('chk-show-valuable-spawns');
  const chkShowContainers = document.getElementById('chk-show-containers');
  const chkShowExtracts = document.getElementById('chk-show-extracts');
  const chkShowPmcSpawns = document.getElementById('chk-show-pmc-spawns');
  const chkShowScavSpawns = document.getElementById('chk-show-scav-spawns');
  const chkShowBossSpawns = document.getElementById('chk-show-boss-spawns');
  const chkShowHazards = document.getElementById('chk-show-hazards');
  const chkShowLocks = document.getElementById('chk-show-locks');
  const chkShowUtilities = document.getElementById('chk-show-utilities');
  const chkLayerTasks = document.getElementById('chk-layer-tasks');
  const chkShowAllTasks = document.getElementById('chk-show-all-tasks');
  const chkShowAllTasksTab = document.getElementById('chk-show-all-tasks-tab');
  const chkLayerPlayer = document.getElementById('chk-layer-player');
  const chkLayerRoute = document.getElementById('chk-layer-route');
  const chkFollowMode = document.getElementById('chk-follow-mode');
  const chkHoverInteractive = document.getElementById('chk-hover-interactive');

  const navBadgePins = document.getElementById('nav-badge-pins');
  const navBadgeTasks = document.getElementById('nav-badge-tasks');

  // Eşya Arama DOM
  const apiStatusBadge = document.getElementById('api-status-badge');
  const btnRefreshApi = document.getElementById('btn-refresh-api');
  const pinnedItemsContainer = document.getElementById('pinned-items-container');
  const btnClearPins = document.getElementById('btn-clear-pins');
  const inputLootSearch = document.getElementById('input-loot-search');
  const btnClearLootSearch = document.getElementById('btn-clear-loot-search');
  const selectLootSort = document.getElementById('select-loot-sort');
  const chkOnlyWithSpawns = document.getElementById('chk-only-with-spawns');
  const lootResultsInfo = document.getElementById('loot-results-info');
  const lootResultsGrid = document.getElementById('loot-results-grid');
  const lootLoadMoreWrap = document.getElementById('loot-load-more-wrap');
  const btnLootLoadMore = document.getElementById('btn-loot-load-more');

  // Konum, Oto-Home & Rota DOM
  const plAutoHomeStatus = document.getElementById('pl-autohome-status');
  const plLastUpdate = document.getElementById('pl-last-update');
  const plCoords = document.getElementById('pl-coords');
  const plYaw = document.getElementById('pl-yaw');
  const selectAutoHomeInterval = document.getElementById('select-autohome-interval');
  const chkMoveTrigger = document.getElementById('chk-move-trigger');
  const chkAutoDetectLogs = document.getElementById('chk-auto-detect-logs');
  const chkAutoDetectMap = document.getElementById('chk-auto-detect-map');
  const rangeYawOffsetQuick = document.getElementById('range-yaw-offset-quick');
  const lblYawOffsetQuick = document.getElementById('lbl-yaw-offset-quick');

  // Görevler & OCR DOM
  const btnClearActiveTasks = document.getElementById('btn-clear-active-tasks');
  const ocrDropzone = document.getElementById('ocr-dropzone');
  const inputOcrFile = document.getElementById('input-ocr-file');
  const btnOcrBrowse = document.getElementById('btn-ocr-browse');
  const btnOcrRetry = document.getElementById('btn-ocr-retry');
  const ocrProgressWrap = document.getElementById('ocr-progress-wrap');
  const ocrProgressFill = document.getElementById('ocr-progress-fill');
  const ocrProgressPct = document.getElementById('ocr-progress-pct');
  const ocrStatusBox = document.getElementById('ocr-status-box');
  const ocrPreviewBar = document.getElementById('ocr-preview-bar');
  const ocrPreviewSummary = document.getElementById('ocr-preview-summary');
  const btnOcrConfirmAll = document.getElementById('btn-ocr-confirm-all');
  const btnOcrDismiss = document.getElementById('btn-ocr-dismiss');
  const ocrMatchesList = document.getElementById('ocr-matches-list');
  const btnPinAllTaskItems = document.getElementById('btn-pin-all-task-items');
  const taskRequiredItemsBox = document.getElementById('task-required-items-box');
  const inputTaskSearch = document.getElementById('input-task-search');
  const btnClearTaskSearch = document.getElementById('btn-clear-task-search');
  const selectTaskTrader = document.getElementById('select-task-trader');
  const selectTaskFilter = document.getElementById('select-task-filter');
  const tasksCountInfo = document.getElementById('tasks-count-info');
  const tasksListContainer = document.getElementById('tasks-list-container');
  const tasksLoadMoreWrap = document.getElementById('tasks-load-more-wrap');
  const btnTasksLoadMore = document.getElementById('btn-tasks-load-more');

  const rtTargetName = document.getElementById('rt-target-name');
  const rtDistance = document.getElementById('rt-distance');
  const rtRelativeDir = document.getElementById('rt-relative-dir');
  const rtElevation = document.getElementById('rt-elevation');
  const chkAutoNearestTarget = document.getElementById('chk-auto-nearest-target');
  const selectTargetManual = document.getElementById('select-target-manual');
  const btnNextTarget = document.getElementById('btn-next-target');
  const btnClearTarget = document.getElementById('btn-clear-target');

  const inputTestFilename = document.getElementById('input-test-filename');
  const btnTestFilename = document.getElementById('btn-test-filename');
  const btnSampleCustoms = document.getElementById('btn-sample-customs');
  const btnSampleWoods = document.getElementById('btn-sample-woods');
  const testParseResult = document.getElementById('test-parse-result');
  const btnScanLatest = document.getElementById('btn-scan-latest');
  const btnClearTrail = document.getElementById('btn-clear-trail');

  // Ayarlar DOM
  const setGamemode = document.getElementById('set-gamemode');
  const setLanguage = document.getElementById('set-language');
  const setLevel = document.getElementById('set-level');
  const setScreenshotsDir = document.getElementById('set-screenshots-dir');
  const setDeleteSs = document.getElementById('set-delete-ss');
  const setYawOffset = document.getElementById('set-yaw-offset');
  const lblYawOffset = document.getElementById('lbl-yaw-offset');

  const shortcutsForm = document.getElementById('shortcuts-form');
  const btnSaveShortcuts = document.getElementById('btn-save-shortcuts');
  const btnResetShortcuts = document.getElementById('btn-reset-shortcuts');

  const codeSettingsPath = document.getElementById('code-settings-path');
  const codeOverlayBounds = document.getElementById('code-overlay-bounds');
  const logsContainer = document.getElementById('logs-container');
  const btnClearLogs = document.getElementById('btn-clear-logs');

  function updateLayersSummaryBadge() {
    const checkboxes = [
      chkLayerTasks,
      chkShowAllTasks,
      chkLayerLoot,
      chkShowValuableSpawns,
      chkShowExtracts,
      chkShowPmcSpawns,
      chkShowScavSpawns,
      chkShowBossSpawns,
      chkShowHazards,
      chkShowLocks,
      chkShowUtilities,
      chkShowCallouts,
      chkLayerPlayer,
      chkLayerRoute
    ].filter(Boolean);
    const activeCount = checkboxes.filter((c) => c.checked).length;
    if (lblLayersCount) {
      lblLayersCount.textContent = `${activeCount}/${checkboxes.length} açık`;
    }
  }

  function updateContainersSummaryBadge() {
    if (!lblContainersCount) return;
    const activeCount = containerCatCheckboxes.filter((c) => c.checked).length;
    lblContainersCount.textContent = `${activeCount}/${containerCatCheckboxes.length} açık`;
  }

  function renderAutoHomeUI(st) {
    if (!st) return;
    const sec = ((st.intervalMs || 1000) / 1000).toFixed(1).replace('.0', '');
    const isActive = !!st.active;
    if (btnToggleAutoHome) {
      btnToggleAutoHome.setAttribute('aria-checked', String(isActive));
    }
    if (autoHomeStatusDot) {
      autoHomeStatusDot.className = `status-dot ${isActive ? 'status-on' : 'status-off'}`;
    }
    if (autoHomeSubLabel) {
      autoHomeSubLabel.innerHTML = `${isActive ? `Açık (${sec} sn)` : `Kapalı (${sec} sn)`} · <kbd>Alt+H</kbd>`;
    }
    if (plAutoHomeStatus) {
      plAutoHomeStatus.textContent = isActive ? `Açık (Her ${sec} sn)` : 'Kapalı (Alt+H ile başlatın)';
      plAutoHomeStatus.style.color = isActive ? 'var(--ok)' : 'var(--text-2)';
    }
  }

  function renderTargetSelectDropdown() {
    if (!selectTargetManual) return;
    const activeId = currentPlayerState?.activeTarget?.id || '';
    selectTargetManual.innerHTML = `<option value="">-- Hedef Seçin (${candidateTargets.length} nokta mevcut) --</option>`;
    for (const c of candidateTargets) {
      const opt = document.createElement('option');
      opt.value = c.id;
      const catLabel = c.category === 'extract' ? 'ÇIKIŞ' : c.category === 'task' ? 'GÖREV' : 'EŞYA';
      opt.textContent = `[${catLabel}] ${c.title} — (X:${c.position.x.toFixed(0)}, Z:${c.position.z.toFixed(0)}, Y:${c.position.y.toFixed(1)}m)`;
      if (c.id === activeId) opt.selected = true;
      selectTargetManual.appendChild(opt);
    }
  }

  function renderPlayerStatusCard() {
    const target = currentPlayerState?.activeTarget;
    const nav = currentPlayerState?.navInfo;

    if (target) {
      rtTargetName.textContent = target.title;
      if (nav) {
        rtDistance.textContent = `${nav.horizontalDistance} metre`;
        rtRelativeDir.textContent = `${nav.relativeText} (${nav.targetBearing}°)`;
        rtElevation.textContent = nav.elevationText;
      } else {
        rtDistance.textContent = 'Konum bekleniyor';
        rtRelativeDir.textContent = '-';
        rtElevation.textContent = `Hedef Y: ${target.position.y.toFixed(1)}m`;
      }
    } else {
      rtTargetName.textContent = 'Hedef Seçilmedi';
      rtDistance.textContent = '-';
      rtRelativeDir.textContent = '-';
      rtElevation.textContent = '-';
    }

    if (!currentPlayerState || !currentPlayerState.current) {
      plLastUpdate.textContent = 'Henüz konum okunmadı';
      plCoords.textContent = '-';
      plYaw.textContent = '-';
      return;
    }

    const cur = currentPlayerState.current;
    const diffSec = Math.max(0, Math.floor((Date.now() - (cur.timestamp || Date.now())) / 1000));
    plLastUpdate.textContent = `${diffSec} sn önce (${new Date(cur.timestamp).toLocaleTimeString()})`;
    plCoords.textContent = `X:${cur.position.x.toFixed(1)} Y:${cur.position.y.toFixed(1)}m Z:${cur.position.z.toFixed(1)}`;
    plYaw.textContent = `${cur.yaw}° (${cur.compass}) · İz: ${(currentPlayerState.trail || []).length}/10`;
  }

  setInterval(renderPlayerStatusCard, 1000);

  function renderPinnedItemsBar() {
    const pinned = (currentSettings && currentSettings.pinnedItems) || [];
    if (navBadgePins) {
      navBadgePins.textContent = String(pinned.length);
      navBadgePins.className = `chip tabular-nums ${pinned.length > 0 ? 'chip-accent' : 'chip-neutral'}`;
    }

    if (pinned.length === 0) {
      pinnedItemsContainer.innerHTML = `<span class="muted">Henüz eşya sabitlenmedi. Aşağıdaki kartlardan "Haritaya sabitle" butonuna tıklayın.</span>`;
      return;
    }

    pinnedItemsContainer.innerHTML = '';
    for (const p of pinned) {
      const chip = document.createElement('div');
      chip.className = 'pin-chip';
      chip.innerHTML = `
        <span class="pin-chip-dot" style="background:${p.color}"></span>
        <span>${p.name} <small class="muted">(${p.shortName || ''})</small></span>
        <button type="button" class="pin-chip-remove" aria-label="${p.name} sabitlemesini kaldır" title="Kaldır">✕</button>
      `;
      chip.querySelector('.pin-chip-remove').addEventListener('click', () => {
        window.tarkovAPI.togglePinItem(p);
      });
      pinnedItemsContainer.appendChild(chip);
    }
  }

  function renderLootResults() {
    if (!allItems || allItems.length === 0) {
      lootResultsInfo.textContent = 'Yükleniyor...';
      lootResultsGrid.innerHTML = '';
      if (lootLoadMoreWrap) lootLoadMoreWrap.hidden = true;
      return;
    }

    const q = normalizeTr(inputLootSearch.value);
    if (btnClearLootSearch) btnClearLootSearch.hidden = !inputLootSearch.value;

    const onlyWithSpawns = chkOnlyWithSpawns.checked;
    const sortBy = selectLootSort.value;
    const activeMap = (currentSettings && currentSettings.selectedMap) || 'customs';
    const modeLabel = (currentSettings && currentSettings.gameMode) === 'pve' ? 'PvE' : 'PvP';
    const pinnedList = (currentSettings && currentSettings.pinnedItems) || [];
    const pinnedIds = new Set(pinnedList.map((x) => x.id));

    let filtered = allItems.filter((item) => {
      if (onlyWithSpawns && (!item.mapSpawnsSummary || item.mapSpawnsSummary.length === 0)) {
        return false;
      }
      if (!q) return true;
      return item._normName.includes(q) || item._normShort.includes(q);
    });

    filtered.sort((a, b) => {
      if (sortBy === 'price') return (b.bestOverallPrice || 0) - (a.bestOverallPrice || 0);
      if (sortBy === 'spawns') {
        const aMapCount = (a.mapSpawnsSummary.find((m) => m.mapNormalizedName === activeMap)?.looseCount) || 0;
        const bMapCount = (b.mapSpawnsSummary.find((m) => m.mapNormalizedName === activeMap)?.looseCount) || 0;
        if (bMapCount !== aMapCount) return bMapCount - aMapCount;
        return (b.pricePerSlot || 0) - (a.pricePerSlot || 0);
      }
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      return (b.pricePerSlot || 0) - (a.pricePerSlot || 0);
    });

    const totalMatches = filtered.length;
    const shown = filtered.slice(0, lootVisibleCount);

    lootResultsInfo.textContent = `${totalMatches.toLocaleString('tr-TR')} eşya · ${pinnedIds.size} sabitli`;
    lootResultsGrid.innerHTML = '';

    if (lootLoadMoreWrap) {
      const remaining = totalMatches - shown.length;
      lootLoadMoreWrap.hidden = remaining <= 0;
      if (btnLootLoadMore && remaining > 0) {
        btnLootLoadMore.textContent = `Daha fazla göster (+${Math.min(PAGE_SIZE, remaining)} / Kalan: ${remaining})`;
      }
    }

    for (const item of shown) {
      const isPinned = pinnedIds.has(item.id);
      const card = document.createElement('div');
      card.className = 'item-card' + (isPinned ? ' pinned' : '');

      const fleaBetter = item.fleaPrice > 0 && item.fleaPrice >= item.bestTrader.priceRUB;
      const traderBetter = item.bestTrader.priceRUB > 0 && item.bestTrader.priceRUB > item.fleaPrice;

      const avgSub = item.fleaAvg24hPrice
        ? `<div class="muted" style="font-size:var(--fs-xs)">24s Ort: ${formatRub(item.fleaAvg24hPrice)}</div>`
        : '';

      const mapPillsHtml = (item.mapSpawnsSummary && item.mapSpawnsSummary.length > 0)
        ? item.mapSpawnsSummary
            .map((ms) => {
              const isCurrent = ms.mapNormalizedName === activeMap;
              const trMap = getTurkishMapName(ms.mapNormalizedName || ms.mapName);
              return `<button type="button" class="map-spawn-pill tabular-nums ${isCurrent ? 'active-map' : ''}" data-map="${ms.mapNormalizedName}" title="${trMap} haritasına geç (${ms.looseCount} açıkta spawn)">
                ${trMap}: <strong>${ms.looseCount}</strong>
              </button>`;
            })
            .join('')
        : `<span class="muted">Açıkta spawn kaydı yok — konteynerlerden çıkabilir</span>`;

      card.innerHTML = `
        <div class="item-card-top">
          <img class="item-icon" src="${item.iconLink || ''}" alt="" loading="lazy" />
          <div class="item-title-box">
            <div class="item-name" title="${item.name}">${item.name}</div>
            <div class="item-meta">Kısa: <strong>${item.shortName || '-'}</strong> · ${item.width}×${item.height} (${item.slots} slot)</div>
            <div class="item-meta">En İyi Satış (${modeLabel}): <strong style="color:var(--ok)">${item.bestOverallSource}</strong></div>
          </div>
          <button type="button" class="btn ${isPinned ? 'btn-secondary' : 'btn-ghost'} btn-pin-toggle">
            ${isPinned ? 'Sabitlendi ✓' : 'Haritaya sabitle'}
          </button>
        </div>

        <div class="item-prices-grid tabular-nums">
          <div class="price-box ${fleaBetter ? 'best-choice' : ''}">
            <span class="price-label">Flea Market ${fleaBetter ? '★' : ''}</span>
            <span class="price-val">${formatRub(item.fleaPrice)}</span>
            ${avgSub}
          </div>
          <div class="price-box ${traderBetter ? 'best-choice' : ''}">
            <span class="price-label">${item.bestTrader.name} ${traderBetter ? '★' : ''}</span>
            <span class="price-val">${formatRub(item.bestTrader.priceRUB)}</span>
          </div>
          <div class="price-box">
            <span class="price-label">Slot Başı Değer</span>
            <span class="price-val" style="color:var(--accent)">${formatRub(item.pricePerSlot)}</span>
          </div>
        </div>

        <div class="item-maps-list">
          ${mapPillsHtml}
        </div>
      `;

      card.querySelector('.btn-pin-toggle').addEventListener('click', () => {
        window.tarkovAPI.togglePinItem({
          id: item.id,
          name: item.name,
          shortName: item.shortName,
          iconLink: item.iconLink
        });
        showToast(isPinned ? `"${item.shortName || item.name}" haritadan kaldırıldı` : `"${item.shortName || item.name}" haritaya sabitlendi`, 'ok');
      });

      card.querySelectorAll('.map-spawn-pill[data-map]').forEach((pill) => {
        pill.addEventListener('click', () => {
          const targetMap = pill.dataset.map;
          if (targetMap) {
            window.tarkovAPI.updateSettings({ selectedMap: targetMap });
            showToast(`Aktif harita: ${getTurkishMapName(targetMap)}`, 'info');
          }
        });
      });

      lootResultsGrid.appendChild(card);
    }
  }

  async function fetchAndPrepareItems(forceRefresh = false) {
    apiStatusBadge.textContent = forceRefresh ? 'Yenileniyor...' : 'Yükleniyor...';
    apiStatusBadge.className = 'chip chip-neutral';

    const loadRes = await window.tarkovAPI.loadApiData({ forceRefresh });
    if (!loadRes || !loadRes.ok) {
      apiStatusBadge.textContent = 'Çevrimdışı / Hata';
      apiStatusBadge.className = 'chip chip-danger';
      lootResultsInfo.textContent = `Veri yüklenemedi: ${loadRes?.error || 'Bilinmeyen hata'}`;
      return;
    }

    const [itemsRes, tasksRes] = await Promise.all([
      window.tarkovAPI.getItems(),
      window.tarkovAPI.getTasks()
    ]);

    if (tasksRes && tasksRes.ok) {
      allTasks = (tasksRes.tasks || []).map((t) => {
        const objDesc = (t.objectives || []).map((o) => `${o.description || ''} ${o.questItem?.name || ''} ${o.markerItem?.name || ''}`).join(' ');
        const keyNames = (t.neededKeys || []).flatMap((nk) => (nk.keys || []).map((k) => `${k.name || ''} ${k.shortName || ''}`)).join(' ');
        const locCaptions = (t.locationImages || []).map((img) => img.caption || '').join(' ');
        const mapNames = `${t.map?.name || ''} ${t.map?.normalizedName || ''}`;

        return {
          ...t,
          _normName: `${normalizeTr(t.name)} ${normalizeTr(t.normalizedName || '')} ${normalizeTr(t.wikiLink ? t.wikiLink.split('/').pop() : '')} ${normalizeTr(mapNames)} ${normalizeTr(objDesc)} ${normalizeTr(keyNames)} ${normalizeTr(locCaptions)}`,
          _normTrader: normalizeTr(t.trader?.name)
        };
      });
      if (window.Fuse) {
        fuseTasks = new window.Fuse(allTasks, {
          keys: ['name', 'normalizedName', '_normName'],
          includeScore: true,
          threshold: 0.45
        });
      }
      renderTasksSection();
    }

    if (itemsRes && itemsRes.ok) {
      allItems = (itemsRes.items || []).map((it) => ({
        ...it,
        _normName: normalizeTr(it.name),
        _normShort: normalizeTr(it.shortName)
      }));

      const modeTag = (loadRes.gameMode || currentSettings?.gameMode) === 'pve' ? 'PvE' : 'PvP';
      apiStatusBadge.textContent = `${modeTag} · ${allItems.length} eşya`;
      apiStatusBadge.className = 'chip chip-ok tabular-nums';
      renderLootResults();
    }
  }

  // GÖREV YÖNETİMİ VE HARİTA GRUPLAMA
  function doesTaskBelongToMap(task, mapNorm) {
    if (!task) return false;
    if (task.map?.normalizedName === mapNorm) return true;
    if (mapNorm === 'ground-zero' && task.map?.normalizedName?.startsWith('ground-zero')) return true;
    if (mapNorm === 'factory' && task.map?.normalizedName?.includes('factory')) return true;

    for (const obj of task.objectives || []) {
      for (const m of obj.maps || []) {
        if (m.normalizedName === mapNorm) return true;
        if (mapNorm === 'ground-zero' && m.normalizedName?.startsWith('ground-zero')) return true;
      }
      for (const z of obj.zones || []) {
        if (z.map?.normalizedName === mapNorm) return true;
      }
      for (const loc of obj.possibleLocations || []) {
        if (loc.map?.normalizedName === mapNorm) return true;
      }
    }
    return false;
  }

  function getTaskPrimaryMapKey(task, activeMap) {
    if (doesTaskBelongToMap(task, activeMap)) return activeMap;
    if (task.map?.normalizedName) {
      if (task.map.normalizedName.startsWith('ground-zero')) return 'ground-zero';
      if (task.map.normalizedName.includes('factory')) return 'factory';
      return task.map.normalizedName;
    }
    for (const obj of task.objectives || []) {
      if (obj.maps && obj.maps.length === 1 && obj.maps[0].normalizedName) {
        return obj.maps[0].normalizedName;
      }
    }
    return 'any';
  }

  function getObjectivePositionOnMap(obj, task, mapNorm) {
    for (const z of obj.zones || []) {
      const zm = z.map?.normalizedName || task.map?.normalizedName;
      if ((!zm || zm === mapNorm || (mapNorm === 'ground-zero' && zm.startsWith('ground-zero'))) && z.position) {
        return z.position;
      }
    }
    for (const loc of obj.possibleLocations || []) {
      const lm = loc.map?.normalizedName || task.map?.normalizedName;
      if ((!lm || lm === mapNorm || (mapNorm === 'ground-zero' && lm.startsWith('ground-zero'))) && loc.positions?.[0]) {
        return loc.positions[0];
      }
    }
    if (obj.zones?.[0]?.position) return obj.zones[0].position;
    if (obj.possibleLocations?.[0]?.positions?.[0]) return obj.possibleLocations[0].positions[0];
    return null;
  }

  function buildTaskCardElement(task, context) {
    const { activeMap, activeSet, completedTaskSet, completedObjSet, pinnedSet } = context;
    const isSelected = activeSet.has(task.id);
    const isTaskCompleted = completedTaskSet.has(task.id);
    const onCurrentMap = doesTaskBelongToMap(task, activeMap);

    const card = document.createElement('div');
    card.className = `task-card ${isSelected ? 'active-task' : ''} ${isTaskCompleted ? 'completed-task' : ''}`;

    const mapNormKey = task.map?.normalizedName || (onCurrentMap ? activeMap : '');
    const mapTagTr = mapNormKey ? getTurkishMapName(mapNormKey) : 'Çoklu Harita';
    const hasEnglishObj = (task.objectives || []).some((o) => isLikelyEnglishText(o.description));

    // Göreve ait tüm Anahtarlar + İstenen Eşyalar + Özel Görev Eşyaları + İşaretleyiciler
    const detailedReqs = [];
    const seenReqIds = new Set();

    for (const nk of task.neededKeys || []) {
      for (const k of nk.keys || []) {
        if (k && !seenReqIds.has(`key_${k.id}`)) {
          seenReqIds.add(`key_${k.id}`);
          detailedReqs.push({ item: k, badge: 'Anahtar', chipClass: 'chip-neutral', count: 1, canPin: true });
        }
      }
    }

    for (const obj of task.objectives || []) {
      for (const kGroup of obj.requiredKeys || []) {
        for (const k of kGroup || []) {
          if (k && !seenReqIds.has(`key_${k.id}`)) {
            seenReqIds.add(`key_${k.id}`);
            detailedReqs.push({ item: k, badge: 'Anahtar', chipClass: 'chip-neutral', count: 1, canPin: true });
          }
        }
      }
      if (obj.markerItem && !seenReqIds.has(`mark_${obj.markerItem.id}_${obj.id}`)) {
        seenReqIds.add(`mark_${obj.markerItem.id}_${obj.id}`);
        detailedReqs.push({
          item: obj.markerItem,
          badge: 'İşaretleyici',
          chipClass: 'chip-quest',
          count: obj.count || 1,
          canPin: true
        });
      }
      if (obj.questItem && !seenReqIds.has(`qitem_${obj.questItem.id}`)) {
        seenReqIds.add(`qitem_${obj.questItem.id}`);
        detailedReqs.push({
          item: obj.questItem,
          badge: 'Özel Görev Eşyası',
          chipClass: 'chip-quest',
          count: obj.count || 1,
          canPin: false
        });
      }
      if (obj.items && obj.items.length > 0 && (obj.type === 'giveItem' || obj.type === 'findItem' || obj.type === 'plantItem')) {
        const it = obj.items[0];
        const rKey = `item_${it.id}_${obj.type}`;
        if (!seenReqIds.has(rKey)) {
          seenReqIds.add(rKey);
          const label =
            obj.type === 'plantItem'
              ? 'Yerleştir'
              : obj.foundInRaid
                ? 'FIR Eşya'
                : 'Teslim Et';
          detailedReqs.push({
            item: it,
            badge: label,
            chipClass: obj.foundInRaid ? 'chip-warn' : 'chip-ok',
            count: obj.count || 1,
            canPin: true
          });
        }
      }
    }

    card.innerHTML = `
      <div class="task-card-header">
        ${task.taskImageLink ? `<img src="${task.taskImageLink}" class="task-banner-thumb" alt="" loading="lazy" />` : ''}
        <div class="task-title-wrap">
          <div class="task-title-line">
            <span class="task-name">${task.name}</span>
            ${task.normalizedName && task.name !== task.normalizedName ? `<span class="muted" style="font-size:11px;">(${task.normalizedName})</span>` : ''}
            ${isSelected ? '<span class="chip chip-accent">✓ Seçildi</span>' : ''}
            ${isTaskCompleted ? '<span class="chip chip-ok">✓ Yapıldı</span>' : ''}
          </div>
          <div class="task-chips-row">
            <span class="chip chip-neutral">${task.trader?.name || 'Trader'}</span>
            <span class="chip ${onCurrentMap ? 'chip-accent' : 'chip-neutral'}">${mapTagTr}</span>
            <span class="chip chip-neutral tabular-nums">Min. Seviye ${task.minPlayerLevel || 1}</span>
            ${hasEnglishObj ? '<span class="chip chip-neutral" title="Veri kaynağında bu görevin hedefleri İngilizce yer alıyor">EN</span>' : ''}
          </div>
        </div>
        <div class="task-card-actions">
          <button type="button" class="btn btn-ghost btn-task-complete-toggle" title="Görevi tamamlandı olarak işaretle / geri al">
            ${isTaskCompleted ? '✓ Yapıldı' : 'Yapıldı'}
          </button>
          <button type="button" class="btn ${isSelected ? 'btn-secondary' : 'btn-ghost'} btn-task-toggle">
            ${isSelected ? 'Kaldır' : 'Seç ＋'}
          </button>
        </div>
      </div>
      ${Array.isArray(task.locationImages) && task.locationImages.length > 0 ? `
        <div class="task-locations-gallery" style="display:flex;gap:8px;padding:6px 12px;background:rgba(15,23,42,0.7);overflow-x:auto;border-bottom:1px solid var(--border);">
          ${task.locationImages.map(img => {
            const safeCaption = (img.caption || task.name || '').replace(/"/g, '&quot;');
            return `
            <div style="flex-shrink:0;max-width:140px;cursor:zoom-in;" title="Büyütmek için tıkla: ${safeCaption}" data-zoom-src="${img.localPath}" data-zoom-caption="${safeCaption}">
              <img src="${img.localPath}" style="width:140px;height:78px;object-fit:cover;border-radius:4px;border:1px solid rgba(56,189,248,0.5);transition:transform 0.15s;display:block;" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'" alt="" />
              <div style="font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">🔍 ${safeCaption}</div>
            </div>`;
          }).join('')}
        </div>
      ` : ''}
      <div class="task-reqs-holder"></div>
      <div class="task-obj-list"></div>
    `;

    card.querySelector('.btn-task-toggle').addEventListener('click', () => {
      window.tarkovAPI.toggleTask(task.id);
      showToast(
        isSelected
          ? `"${task.name}" seçili görevlerden kaldırıldı`
          : `"${task.name}" seçildi (Önkoşul görevleri otomatik ✓ Yapıldı işaretlendi)`,
        'ok'
      );
    });

    card.querySelector('.btn-task-complete-toggle').addEventListener('click', () => {
      window.tarkovAPI.toggleCompletedTask(task.id);
    });

    const reqsHolder = card.querySelector('.task-reqs-holder');
    if (detailedReqs.length > 0) {
      const detailBox = document.createElement('div');
      detailBox.className = 'task-items-detail-box';
      for (const dr of detailedReqs) {
        const isPinned = pinnedSet.has(dr.item.id);
        const rRow = document.createElement('div');
        rRow.className = 'task-detail-row';
        rRow.innerHTML = `
          <div class="task-detail-left">
            <img src="${dr.item.iconLink || ''}" alt="" loading="lazy" />
            <div>
              <span class="chip ${dr.chipClass}">${dr.badge}</span>
              <strong>${dr.item.name}</strong>
              ${dr.item.shortName ? `<span class="muted">(${dr.item.shortName})</span>` : ''}
              <strong class="tabular-nums">×${dr.count}</strong>
            </div>
          </div>
          ${
            dr.canPin
              ? `<button type="button" class="btn ${isPinned ? 'btn-secondary' : 'btn-ghost'} btn-dr-pin">${isPinned ? 'Sabitlendi ✓' : 'Haritaya sabitle'}</button>`
              : ''
          }
        `;
        const pinBtn = rRow.querySelector('.btn-dr-pin');
        if (pinBtn) {
          pinBtn.addEventListener('click', () => {
            window.tarkovAPI.togglePinItem(dr.item);
            showToast(`"${dr.item.shortName || dr.item.name}" haritaya sabitlendi`, 'ok');
          });
        }
        detailBox.appendChild(rRow);
      }
      reqsHolder.appendChild(detailBox);
    }

    const objListEl = card.querySelector('.task-obj-list');
    for (const obj of task.objectives || []) {
      const isDone = isTaskCompleted || completedObjSet.has(obj.id);
      const pos = getObjectivePositionOnMap(obj, task, activeMap);
      const row = document.createElement('div');
      row.className = `task-obj-row ${isDone ? 'completed' : ''}`;

      const objItemImg =
        obj.questItem?.image512pxLink ||
        obj.questItem?.iconLink ||
        (obj.items && obj.items[0] && obj.items[0].iconLink) ||
        obj.markerItem?.iconLink ||
        null;
      const objItemName =
        obj.questItem?.name ||
        (obj.items && obj.items[0] && obj.items[0].name) ||
        obj.markerItem?.name ||
        null;

      const safeObjItemName = (objItemName || task.name || '').replace(/"/g, '&quot;');
      const itemThumbHtml = objItemImg
        ? `<img src="${objItemImg}" class="task-obj-item-thumb" data-zoom-src="${objItemImg}" data-zoom-caption="${safeObjItemName}" title="Büyütmek için tıkla: ${safeObjItemName}" alt="" style="cursor:zoom-in;" loading="lazy" />`
        : '';
      const itemTagHtml = obj.questItem?.name
        ? `<div style="font-size:11px;color:#fde68a;margin-top:2px;">📦 Alınacak / Bırakılacak Görev Eşyası: <strong>${obj.questItem.name}</strong></div>`
        : '';

      const firBadge = obj.foundInRaid ? `<span class="chip chip-warn tabular-nums">FIR ×${obj.count || 1}</span> ` : '';
      const locHtml = pos
        ? `<button type="button" class="btn btn-secondary btn-obj-route tabular-nums" title="Bu hedefe rota çiz">Rota Yap (${pos.y.toFixed(0)}m)</button>`
        : `<span class="chip chip-neutral" aria-label="Bu hedef için harita konumu bulunmuyor">Konum yok</span>`;

      row.innerHTML = `
        <label class="task-obj-label" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" class="chk-obj-done" ${isDone ? 'checked' : ''} />
          ${itemThumbHtml}
          <div>
            <span>${firBadge}${obj.description || obj.type}</span>
            ${itemTagHtml}
          </div>
        </label>
        ${locHtml}
      `;

      row.querySelector('.chk-obj-done').addEventListener('change', () => {
        window.tarkovAPI.toggleObjective(obj.id);
      });

      const routeBtn = row.querySelector('.btn-obj-route');
      if (routeBtn && pos) {
        routeBtn.addEventListener('click', () => {
          window.tarkovAPI.setTarget({
            id: `task_${task.id}_${obj.id}_0`,
            title: `Görev: ${task.name}`,
            subtitle: obj.description || task.trader?.name,
            category: 'task',
            color: '#b57bee',
            position: pos
          });
          showToast(`Rota hedefi ayarlandı: ${task.name}`, 'ok');
        });
      }

      objListEl.appendChild(row);
    }

    return card;
  }

  function renderTasksSection() {
    if (!tasksListContainer) return;
    const activeMap = (currentSettings && currentSettings.selectedMap) || 'customs';
    const activeSet = new Set((currentSettings && currentSettings.activeTaskIds) || []);
    const completedTaskSet = new Set((currentSettings && currentSettings.completedTaskIds) || []);
    const completedObjSet = new Set((currentSettings && currentSettings.completedObjectiveIds) || []);
    const pinnedSet = new Set(((currentSettings && currentSettings.pinnedItems) || []).map((x) => x.id));
    const q = normalizeTr(inputTaskSearch ? inputTaskSearch.value : '');
    if (btnClearTaskSearch && inputTaskSearch) {
      btnClearTaskSearch.hidden = !inputTaskSearch.value;
    }

    const traderFilter = selectTaskTrader ? selectTaskTrader.value : 'all';
    const modeFilter = selectTaskFilter ? selectTaskFilter.value : 'map_first';

    if (navBadgeTasks) {
      navBadgeTasks.textContent = String(activeSet.size);
      navBadgeTasks.className = `chip tabular-nums ${activeSet.size > 0 ? 'chip-accent' : 'chip-neutral'}`;
    }

    // 1) Gerekli Eşyalar ve Anahtarlar Paneli
    const reqItemsMap = new Map();
    const activeTasksObjects = allTasks.filter((t) => activeSet.has(t.id) && !completedTaskSet.has(t.id));

    for (const t of activeTasksObjects) {
      for (const nk of t.neededKeys || []) {
        for (const k of nk.keys || []) {
          if (!reqItemsMap.has(k.id)) {
            reqItemsMap.set(k.id, { ...k, count: 1, fir: false, role: 'Anahtar', taskNames: [t.name] });
          }
        }
      }
      for (const obj of t.objectives || []) {
        if (completedObjSet.has(obj.id)) continue;

        for (const kGroup of obj.requiredKeys || []) {
          for (const k of kGroup || []) {
            if (k && !reqItemsMap.has(k.id)) {
              reqItemsMap.set(k.id, { ...k, count: 1, fir: false, role: 'Anahtar', taskNames: [t.name] });
            }
          }
        }

        if (obj.markerItem) {
          const m = obj.markerItem;
          const ex = reqItemsMap.get(m.id);
          if (ex) {
            ex.count += 1;
            if (!ex.taskNames.includes(t.name)) ex.taskNames.push(t.name);
          } else {
            reqItemsMap.set(m.id, { ...m, count: 1, fir: false, role: 'İşaretleyici', taskNames: [t.name] });
          }
        }

        if (obj.items && obj.items.length > 0 && (obj.type === 'giveItem' || obj.type === 'findItem' || obj.type === 'plantItem')) {
          const it = obj.items[0];
          const existing = reqItemsMap.get(it.id);
          if (existing) {
            existing.count += obj.count || 1;
            if (!existing.taskNames.includes(t.name)) existing.taskNames.push(t.name);
          } else {
            reqItemsMap.set(it.id, {
              ...it,
              count: obj.count || 1,
              fir: !!obj.foundInRaid,
              role: obj.type === 'plantItem' ? 'Yerleştir' : 'Görev Eşyası',
              taskNames: [t.name]
            });
          }
        }
      }
    }

    if (taskRequiredItemsBox) {
      const reqList = [...reqItemsMap.values()];
      if (btnPinAllTaskItems) {
        btnPinAllTaskItems.hidden = reqList.length === 0;
      }

      if (reqList.length === 0) {
        taskRequiredItemsBox.innerHTML = `
          <div class="empty-state-compact">
            <span>Görev seçin ya da haritanın tüm görevlerini açın.</span>
            <button type="button" id="btn-empty-enable-all-tasks" class="btn btn-secondary">Tüm görevleri göster</button>
          </div>
        `;
        const quickBtn = document.getElementById('btn-empty-enable-all-tasks');
        if (quickBtn) {
          quickBtn.addEventListener('click', () => {
            window.tarkovAPI.updateSettings({ showAllMapTasksOnOverlay: true });
            showToast('Aktif haritanın tüm görevleri haritada gösteriliyor', 'ok');
          });
        }
      } else {
        taskRequiredItemsBox.innerHTML = '';
        for (const rItem of reqList) {
          const isPinned = pinnedSet.has(rItem.id);
          const div = document.createElement('div');
          div.className = 'task-req-item';
          div.innerHTML = `
            <div class="task-req-left">
              <img src="${rItem.iconLink || ''}" alt="" loading="lazy" />
              <div>
                <div>
                  <strong>${rItem.name}</strong> <span class="muted">(${rItem.shortName || ''})</span>
                  <strong class="tabular-nums">×${rItem.count}</strong>
                  ${rItem.fir ? '<span class="chip chip-warn">FIR</span>' : ''}
                  <span class="chip chip-neutral">${rItem.role}</span>
                </div>
                <div class="muted">Görev: ${rItem.taskNames.join(', ')}</div>
              </div>
            </div>
            <button type="button" class="btn ${isPinned ? 'btn-secondary' : 'btn-ghost'} btn-req-pin">
              ${isPinned ? 'Sabitlendi ✓' : 'Aramaya ekle'}
            </button>
          `;
          div.querySelector('.btn-req-pin').addEventListener('click', () => {
            window.tarkovAPI.togglePinItem(rItem);
          });
          taskRequiredItemsBox.appendChild(div);
        }
      }
    }

    // 2) Görev Listesi Filtreleme & Haritaya Göre Gruplama
    let filtered = allTasks.filter((t) => {
      if (traderFilter !== 'all' && t.trader?.name !== traderFilter) return false;
      const onMap = doesTaskBelongToMap(t, activeMap);
      const isDoneTask = completedTaskSet.has(t.id);
      if (modeFilter === 'only_map' && !onMap) return false;
      if (modeFilter === 'only_active' && !activeSet.has(t.id)) return false;
      if (modeFilter === 'hide_completed' && isDoneTask) return false;
      if (modeFilter === 'only_completed' && !isDoneTask) return false;
      if (!q) return true;
      const inObj = (t.objectives || []).some((o) => normalizeTr(o.description).includes(q));
      const inEn = (t.normalizedName || '').toLowerCase().includes(q) || (t.wikiLink || '').toLowerCase().includes(q);
      return t._normName.includes(q) || t._normTrader.includes(q) || inObj || inEn;
    });

    filtered.sort((a, b) => {
      const aActive = activeSet.has(a.id) ? 1 : 0;
      const bActive = activeSet.has(b.id) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;

      const aOnMap = doesTaskBelongToMap(a, activeMap) ? 1 : 0;
      const bOnMap = doesTaskBelongToMap(b, activeMap) ? 1 : 0;
      if (aOnMap !== bOnMap) return bOnMap - aOnMap;

      return (a.minPlayerLevel || 1) - (b.minPlayerLevel || 1);
    });

    if (tasksCountInfo) {
      tasksCountInfo.textContent = `${filtered.length} görev · ${activeSet.size} seçili`;
    }

    const totalMatches = filtered.length;
    const shown = filtered.slice(0, tasksVisibleCount);
    tasksListContainer.innerHTML = '';

    if (tasksLoadMoreWrap) {
      const remaining = totalMatches - shown.length;
      tasksLoadMoreWrap.hidden = remaining <= 0;
      if (btnTasksLoadMore && remaining > 0) {
        btnTasksLoadMore.textContent = `Daha fazla göster (+${Math.min(PAGE_SIZE, remaining)} / Kalan: ${remaining})`;
      }
    }

    const cardContext = { activeMap, activeSet, completedTaskSet, completedObjSet, pinnedSet };

    // Haritaya göre gruplama
    const groupsMap = new Map();
    for (const task of shown) {
      const gKey = isSelectedTaskFirstGroup(task, activeSet)
        ? '__selected__'
        : getTaskPrimaryMapKey(task, activeMap);
      if (!groupsMap.has(gKey)) groupsMap.set(gKey, []);
      groupsMap.get(gKey).push(task);
    }

    for (const [gKey, groupTasks] of groupsMap.entries()) {
      const groupWrap = document.createElement('div');
      groupWrap.className = 'task-map-group';

      const groupTitle =
        gKey === '__selected__'
          ? 'Seçili Aktif Görevler'
          : gKey === 'any'
            ? 'Çoklu Harita / Genel Görevler'
            : `${getTurkishMapName(gKey)}${gKey === activeMap ? ' (Aktif Harita)' : ''}`;

      const isCollapsed = collapsedTaskGroups.has(gKey);
      const headerBtn = document.createElement('button');
      headerBtn.type = 'button';
      headerBtn.className = 'task-group-header';
      headerBtn.setAttribute('aria-expanded', String(!isCollapsed));
      headerBtn.innerHTML = `
        <span>${groupTitle} · <strong class="tabular-nums">${groupTasks.length}</strong></span>
        <span class="muted">${isCollapsed ? 'Göster ▾' : 'Daralt ▴'}</span>
      `;

      const gridEl = document.createElement('div');
      gridEl.className = 'task-group-grid';
      gridEl.hidden = isCollapsed;

      headerBtn.addEventListener('click', () => {
        if (collapsedTaskGroups.has(gKey)) {
          collapsedTaskGroups.delete(gKey);
        } else {
          collapsedTaskGroups.add(gKey);
        }
        renderTasksSection();
      });

      for (const task of groupTasks) {
        gridEl.appendChild(buildTaskCardElement(task, cardContext));
      }

      groupWrap.appendChild(headerBtn);
      groupWrap.appendChild(gridEl);
      tasksListContainer.appendChild(groupWrap);
    }
  }

  function isSelectedTaskFirstGroup(task, activeSet) {
    return activeSet.has(task.id);
  }

  // OCR GÖRÜNTÜ ÖN İŞLEME VE ÖNİZLEME AKIŞI
  function setOcrDropzoneState(state, statusMessage) {
    if (!ocrDropzone) return;
    ocrDropzone.classList.remove('state-ready', 'state-dragover', 'state-processing', 'state-success', 'state-error');
    ocrDropzone.classList.add(`state-${state}`);
    if (ocrStatusBox && statusMessage) {
      ocrStatusBox.textContent = statusMessage;
    }
    if (ocrProgressWrap) {
      ocrProgressWrap.hidden = state !== 'processing';
    }
    if (btnOcrRetry) {
      btnOcrRetry.hidden = state !== 'error';
    }
  }

  async function preprocessImageForOCR(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(fileOrBlob);
      img.onload = () => {
        const scale = img.width < 1000 ? 1.8 : 1.2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
          d[i] = d[i + 1] = d[i + 2] = contrasted;
        }
        ctx.putImageData(imgData, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  async function processTaskScreenshotOCR(fileOrBlob) {
    if (!fileOrBlob || !ocrStatusBox) return;
    lastOcrBlob = fileOrBlob;
    pendingOcrTaskIds = [];

    try {
      setOcrDropzoneState('processing', 'Görüntü ön işleniyor ve yerel OCR çalıştırılıyor...');
      if (ocrProgressFill) ocrProgressFill.style.width = '10%';
      if (ocrProgressPct) ocrProgressPct.textContent = '%10';
      if (ocrPreviewBar) ocrPreviewBar.hidden = true;
      ocrMatchesList.innerHTML = '';

      const dataUrl = await preprocessImageForOCR(fileOrBlob);
      if (!window.Tesseract) {
        setOcrDropzoneState('error', 'Hata: Tesseract.js OCR motoru yüklenemedi.');
        return;
      }

      const result = await window.Tesseract.recognize(dataUrl, 'eng', {
        logger: (m) => {
          if (m && typeof m.progress === 'number') {
            const pct = Math.max(10, Math.min(100, Math.round(m.progress * 100)));
            if (ocrProgressFill) ocrProgressFill.style.width = `${pct}%`;
            if (ocrProgressPct) ocrProgressPct.textContent = `%${pct}`;
          }
        }
      });

      const rawText = (result && result.data && result.data.text) || '';
      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ\s'-]/g, ' ').trim())
        .filter((l) => l.length >= 4);

      if (lines.length === 0 || !fuseTasks) {
        setOcrDropzoneState('error', 'Görüntüde görev satırı okunamadı. Tekrar deneyin veya arama kutusunu kullanın.');
        return;
      }

      const seenTasks = new Set();
      const matchedEntries = [];

      for (const line of lines) {
        const hits = fuseTasks.search(line);
        if (hits.length > 0 && hits[0].score <= 0.45) {
          const top = hits[0];
          if (seenTasks.has(top.item.id)) continue;
          seenTasks.add(top.item.id);

          const confidence = Math.round((1 - top.score) * 100);
          matchedEntries.push({ line, task: top.item, confidence });
          if (confidence >= 60) {
            pendingOcrTaskIds.push(top.item.id);
          }
        }
      }

      if (matchedEntries.length === 0) {
        setOcrDropzoneState('error', 'Eşleşen görev bulunamadı. Daha net bir ekran görüntüsü deneyin.');
        return;
      }

      setOcrDropzoneState('success', `${matchedEntries.length} görev satırı tespit edildi. Aşağıdan onaylayın.`);
      if (ocrPreviewBar && ocrPreviewSummary) {
        ocrPreviewBar.hidden = false;
        ocrPreviewSummary.textContent = `${matchedEntries.length} görev eşleşti (${pendingOcrTaskIds.length} yüksek güven)`;
      }

      for (const entry of matchedEntries) {
        const isHighConf = entry.confidence >= 70;
        const row = document.createElement('div');
        row.className = 'ocr-match-row';
        row.innerHTML = `
          <div>
            <strong>${entry.task.name}</strong>
            <span class="muted">(${entry.task.trader?.name || ''})</span>
            <span class="chip tabular-nums ${isHighConf ? 'chip-ok' : 'chip-warn'}">%${entry.confidence} güven</span>
          </div>
          <button type="button" class="btn btn-secondary btn-ocr-add">Seç ＋</button>
        `;
        row.querySelector('.btn-ocr-add').addEventListener('click', () => {
          window.tarkovAPI.toggleTask(entry.task.id);
          showToast(`"${entry.task.name}" seçildi`, 'ok');
        });
        ocrMatchesList.appendChild(row);
      }
    } catch (err) {
      setOcrDropzoneState('error', `OCR hatası: ${err.message || err}`);
    }
  }

  function renderShortcutsForm(shortcuts, statusMap = {}) {
    shortcutsForm.innerHTML = '';
    for (const [key, label] of Object.entries(SHORTCUT_LABELS)) {
      const val = (shortcuts && shortcuts[key]) || '';
      const st = statusMap[key];

      const wrapper = document.createElement('div');
      wrapper.className = 'shortcut-item';

      const lbl = document.createElement('label');
      lbl.textContent = label;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'mono-input';
      inp.value = val;
      inp.dataset.shortcutKey = key;
      inp.placeholder = 'Örn: Alt+M';

      wrapper.appendChild(lbl);
      wrapper.appendChild(inp);

      if (st) {
        const msg = document.createElement('div');
        msg.className = 'shortcut-status ' + (st.ok ? 'status-ok' : 'status-err');
        msg.textContent = st.ok ? `✓ Aktif (${val})` : `✗ Hata: ${st.reason}`;
        wrapper.appendChild(msg);
      }

      shortcutsForm.appendChild(wrapper);
    }
  }

  function applySettingsToUI(settings) {
    if (!settings) return;
    const prevLang = currentSettings ? currentSettings.language : null;
    const prevMode = currentSettings ? currentSettings.gameMode : null;
    currentSettings = settings;
    const ov = settings.overlay || {};

    const isVisible = !!ov.visible;
    if (ovStatusPill) ovStatusPill.textContent = isVisible ? 'Açık' : 'Gizli';
    if (ovStatusDot) ovStatusDot.className = `status-dot ${isVisible ? 'status-on' : 'status-off'}`;
    if (btnToggleVisible) btnToggleVisible.setAttribute('aria-checked', String(isVisible));

    if (btnToggleEdit) {
      btnToggleEdit.setAttribute('aria-checked', String(!!ov.editMode));
    }

    const gm = settings.gameMode || 'pve';
    if (selectGamemodeQuick) selectGamemodeQuick.value = gm;
    if (setGamemode) setGamemode.value = gm;
    segGamemodeButtons.forEach((btn) => {
      const active = btn.dataset.gamemode === gm;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    });

    selectMap.value = settings.selectedMap || 'customs';
    selectMapStyle.value = settings.mapRenderStyle || 'satellite';

    const opPct = Math.round((ov.opacity || 0.9) * 100);
    rangeOpacity.value = opPct;
    lblOpacity.textContent = `%${opPct}`;

    const layers = ov.layers || {};
    if (chkShowCallouts) chkShowCallouts.checked = settings.showMapCallouts !== false;
    chkLayerLoot.checked = !!layers.loot;
    if (chkShowValuableSpawns) chkShowValuableSpawns.checked = settings.showValuableSpawns !== false;
    chkShowContainers.checked = !!settings.showMapContainers;
    chkShowExtracts.checked = settings.showMapExtracts !== false;
    if (chkShowPmcSpawns) chkShowPmcSpawns.checked = !!settings.showPmcSpawns;
    if (chkShowScavSpawns) chkShowScavSpawns.checked = !!settings.showScavSpawns;
    if (chkShowBossSpawns) chkShowBossSpawns.checked = !!settings.showBossSpawns;
    if (chkShowHazards) chkShowHazards.checked = settings.showMapHazards !== false;
    if (chkShowLocks) chkShowLocks.checked = !!settings.showMapLocks;
    if (chkShowUtilities) chkShowUtilities.checked = settings.showMapUtilities !== false;
    chkLayerTasks.checked = !!layers.tasks;
    if (chkShowAllTasks) chkShowAllTasks.checked = !!settings.showAllMapTasksOnOverlay;
    if (chkShowAllTasksTab) chkShowAllTasksTab.checked = !!settings.showAllMapTasksOnOverlay;
    chkLayerPlayer.checked = !!layers.player;
    chkLayerRoute.checked = !!layers.route;
    chkFollowMode.checked = !!ov.followMode;
    if (chkHoverInteractive) chkHoverInteractive.checked = settings.hoverInteractiveMap !== false;

    const rawCats = settings.enabledContainerCategories;
    const enabledCatSet = new Set(
      Array.isArray(rawCats)
        ? rawCats
        : rawCats && typeof rawCats === 'object'
          ? Object.keys(rawCats).filter((k) => !!rawCats[k])
          : []
    );
    containerCatCheckboxes.forEach((chk) => {
      const cat = chk.dataset.cat;
      if (cat) {
        chk.checked = enabledCatSet.has(cat);
      }
    });
    if (chkShowContainers) {
      chkShowContainers.checked = enabledCatSet.size > 0;
    }

    updateLayersSummaryBadge();
    updateContainersSummaryBadge();

    setLanguage.value = settings.language || 'tr';
    setLevel.value = settings.playerLevel || 15;
    setScreenshotsDir.value = settings.screenshotsDir || '';
    setDeleteSs.checked = !!settings.deleteScreenshotsAfterRead;
    if (chkMoveTrigger) chkMoveTrigger.checked = !!settings.movePositionTrigger;
    if (chkAutoDetectLogs) chkAutoDetectLogs.checked = settings.autoDetectMapFromLogs !== false;
    chkAutoDetectMap.checked = !!settings.autoDetectMapFromCoords;
    chkAutoNearestTarget.checked = !!settings.autoNearestTarget;
    const chkAutoRotationEl = document.getElementById('chk-auto-rotation');
    if (chkAutoRotationEl) chkAutoRotationEl.checked = settings.autoRotationEnabled !== false;
    const rotCatSet = new Set(settings.rotationCategories || ['task', 'container', 'loot']);
    document.querySelectorAll('.chk-rot-cat').forEach((chk) => {
      const cat = chk.dataset.rot;
      if (cat) chk.checked = rotCatSet.has(cat);
    });
    selectAutoHomeInterval.value = String(settings.autoHomeIntervalMs || 1000);

    const yOff = settings.yawOffset || 0;
    setYawOffset.value = yOff;
    lblYawOffset.textContent = `${yOff}°`;
    rangeYawOffsetQuick.value = yOff;
    lblYawOffsetQuick.textContent = `${yOff}°`;

    codeOverlayBounds.textContent = `Konum: (${ov.x ?? 'Otomatik'}, ${ov.y ?? 'Otomatik'}) · Boyut: ${ov.width}×${ov.height}px · Saydamlık: %${opPct}`;

    renderShortcutsForm(settings.shortcuts, lastShortcutStatus);
    renderPinnedItemsBar();
    renderTasksSection();

    if (prevLang && (prevLang !== settings.language || prevMode !== settings.gameMode)) {
      fetchAndPrepareItems(false);
    } else if (allItems.length > 0) {
      renderLootResults();
    }
  }

  // OLAY DİNLEYİCİLERİ VE KLAVYE KISAYOLLARI (Ctrl+K, /, Esc)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (currentActiveTabId === 'tab-tasks' && inputTaskSearch) {
        inputTaskSearch.focus();
        inputTaskSearch.select();
      } else if (inputLootSearch) {
        inputLootSearch.focus();
        inputLootSearch.select();
      }
      return;
    }

    if (e.key === '/' && document.activeElement && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      if (currentActiveTabId === 'tab-tasks' && inputTaskSearch) {
        inputTaskSearch.focus();
      } else if (inputLootSearch) {
        inputLootSearch.focus();
      }
      return;
    }

    if (e.key === 'Escape') {
      if (document.activeElement === inputLootSearch && inputLootSearch.value) {
        inputLootSearch.value = '';
        lootVisibleCount = PAGE_SIZE;
        renderLootResults();
      } else if (document.activeElement === inputTaskSearch && inputTaskSearch.value) {
        inputTaskSearch.value = '';
        tasksVisibleCount = PAGE_SIZE;
        renderTasksSection();
      }
    }
  });

  inputLootSearch.addEventListener('input', () => {
    lootVisibleCount = PAGE_SIZE;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(renderLootResults, 150);
  });

  if (btnClearLootSearch) {
    btnClearLootSearch.addEventListener('click', () => {
      inputLootSearch.value = '';
      lootVisibleCount = PAGE_SIZE;
      renderLootResults();
      inputLootSearch.focus();
    });
  }

  if (btnLootLoadMore) {
    btnLootLoadMore.addEventListener('click', () => {
      lootVisibleCount += PAGE_SIZE;
      renderLootResults();
    });
  }

  selectLootSort.addEventListener('change', () => {
    lootVisibleCount = PAGE_SIZE;
    renderLootResults();
  });

  chkOnlyWithSpawns.addEventListener('change', () => {
    lootVisibleCount = PAGE_SIZE;
    renderLootResults();
  });

  btnRefreshApi.addEventListener('click', () => {
    fetchAndPrepareItems(true);
    showToast('Flea Market fiyatları yenileniyor...', 'info');
  });

  btnClearPins.addEventListener('click', () => {
    const previousPins = ((currentSettings && currentSettings.pinnedItems) || []).slice();
    if (previousPins.length === 0) return;
    window.tarkovAPI.clearPinnedItems();
    showToast(`${previousPins.length} sabitlenen eşya temizlendi`, 'warn', () => {
      window.tarkovAPI.pinMultipleItems(previousPins);
    });
  });

  function handleToggleVisible() {
    if (!currentSettings) return;
    const nextVis = !currentSettings.overlay.visible;
    window.tarkovAPI.updateSettings({
      overlay: {
        visible: nextVis,
        editMode: nextVis ? currentSettings.overlay.editMode : false
      }
    });
    showToast(nextVis ? 'Overlay harita açıldı' : 'Overlay gizlendi (Alt+M ile geri açılır)', 'info');
  }

  if (rowToggleVisible) {
    rowToggleVisible.addEventListener('click', (e) => {
      if (e.target.closest('#btn-toggle-visible')) return;
      handleToggleVisible();
    });
  }
  btnToggleVisible.addEventListener('click', handleToggleVisible);

  btnToggleEdit.addEventListener('click', () => {
    if (!currentSettings) return;
    const nextEdit = !currentSettings.overlay.editMode;
    window.tarkovAPI.updateSettings({
      overlay: {
        visible: true,
        editMode: nextEdit
      }
    });
    showToast(nextEdit ? 'Düzenleme modu açık (Haritayı sürükleyin)' : 'Düzenleme modu kapatıldı', 'info');
  });

  async function handleToggleAutoHome() {
    const st = await window.tarkovAPI.toggleAutoHome();
    renderAutoHomeUI(st);
    showToast(st && st.active ? 'Oto-Konum (Home) başlatıldı' : 'Oto-Konum (Home) durduruldu', 'info');
  }

  if (rowToggleAutoHome) {
    rowToggleAutoHome.addEventListener('click', (e) => {
      if (e.target.closest('#btn-toggle-autohome')) return;
      handleToggleAutoHome();
    });
  }
  btnToggleAutoHome.addEventListener('click', handleToggleAutoHome);

  selectAutoHomeInterval.addEventListener('change', () => {
    window.tarkovAPI.updateSettings({
      autoHomeIntervalMs: Number(selectAutoHomeInterval.value) || 1000
    });
  });

  segGamemodeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.gamemode;
      if (mode) {
        window.tarkovAPI.updateSettings({ gameMode: mode });
        showToast(`Oyun modu: ${mode === 'pve' ? 'PvE Zone' : 'PvP Regular'}`, 'info');
      }
    });
  });

  selectGamemodeQuick.addEventListener('change', () => {
    window.tarkovAPI.updateSettings({ gameMode: selectGamemodeQuick.value });
  });

  selectMap.addEventListener('change', () => {
    tasksVisibleCount = PAGE_SIZE;
    window.tarkovAPI.updateSettings({ selectedMap: selectMap.value });
    showToast(`Harita değiştirildi: ${getTurkishMapName(selectMap.value)}`, 'info');
  });

  selectMapStyle.addEventListener('change', () => {
    window.tarkovAPI.updateSettings({ mapRenderStyle: selectMapStyle.value });
  });

  rangeOpacity.addEventListener('input', () => {
    lblOpacity.textContent = `%${rangeOpacity.value}`;
    window.tarkovAPI.updateSettings({
      overlay: { opacity: Number(rangeOpacity.value) / 100 }
    });
  });

  function updateLayers() {
    updateLayersSummaryBadge();
    updateContainersSummaryBadge();
    const enabledContainerCategories = containerCatCheckboxes
      .filter((chk) => chk.checked && chk.dataset.cat)
      .map((chk) => chk.dataset.cat);
    if (chkShowContainers) {
      chkShowContainers.checked = enabledContainerCategories.length > 0;
    }
    window.tarkovAPI.updateSettings({
      showMapCallouts: chkShowCallouts ? chkShowCallouts.checked : true,
      showValuableSpawns: chkShowValuableSpawns ? chkShowValuableSpawns.checked : true,
      showMapContainers: enabledContainerCategories.length > 0,
      enabledContainerCategories,
      showMapExtracts: chkShowExtracts.checked,
      showPmcSpawns: chkShowPmcSpawns ? chkShowPmcSpawns.checked : false,
      showScavSpawns: chkShowScavSpawns ? chkShowScavSpawns.checked : false,
      showBossSpawns: chkShowBossSpawns ? chkShowBossSpawns.checked : false,
      showMapHazards: chkShowHazards ? chkShowHazards.checked : true,
      showMapLocks: chkShowLocks ? chkShowLocks.checked : false,
      showMapUtilities: chkShowUtilities ? chkShowUtilities.checked : true,
      showAllMapTasksOnOverlay: chkShowAllTasks ? chkShowAllTasks.checked : false,
      hoverInteractiveMap: chkHoverInteractive ? chkHoverInteractive.checked : true,
      overlay: {
        followMode: chkFollowMode.checked,
        layers: {
          loot: chkLayerLoot.checked,
          tasks: chkLayerTasks.checked,
          player: chkLayerPlayer.checked,
          route: chkLayerRoute.checked
        }
      }
    });
  }

  [
    chkShowCallouts,
    chkLayerLoot,
    chkShowValuableSpawns,
    chkShowContainers,
    chkShowExtracts,
    chkShowPmcSpawns,
    chkShowScavSpawns,
    chkShowBossSpawns,
    chkShowHazards,
    chkShowLocks,
    chkShowUtilities,
    chkLayerTasks,
    chkShowAllTasks,
    chkLayerPlayer,
    chkLayerRoute,
    chkFollowMode,
    chkHoverInteractive,
    ...containerCatCheckboxes
  ]
    .filter(Boolean)
    .forEach((el) => {
      el.addEventListener('change', (e) => {
        // Eğer kullanıcı tekil bir konteyner kategorisi seçtiyse ve ana kutu kapalıysa ana kutuyu da açalım
        if (el.classList.contains('chk-container-cat') && el.checked && chkShowContainers && !chkShowContainers.checked) {
          chkShowContainers.checked = true;
        }
        updateLayers();
      });
    });

  if (btnLayersAllOn) {
    btnLayersAllOn.addEventListener('click', () => {
      [
        chkLayerTasks,
        chkShowAllTasks,
        chkLayerLoot,
        chkShowValuableSpawns,
        chkShowExtracts,
        chkShowPmcSpawns,
        chkShowScavSpawns,
        chkShowBossSpawns,
        chkShowHazards,
        chkShowLocks,
        chkShowUtilities,
        chkShowContainers,
        chkShowCallouts,
        chkLayerPlayer,
        chkLayerRoute
      ]
        .filter(Boolean)
        .forEach((c) => {
          c.checked = true;
        });
      updateLayers();
    });
  }

  if (btnLayersAllOff) {
    btnLayersAllOff.addEventListener('click', () => {
      [
        chkLayerTasks,
        chkShowAllTasks,
        chkLayerLoot,
        chkShowValuableSpawns,
        chkShowExtracts,
        chkShowPmcSpawns,
        chkShowScavSpawns,
        chkShowBossSpawns,
        chkShowHazards,
        chkShowLocks,
        chkShowUtilities,
        chkShowContainers,
        chkShowCallouts,
        chkLayerPlayer,
        chkLayerRoute
      ]
        .filter(Boolean)
        .forEach((c) => {
          c.checked = false;
        });
      updateLayers();
    });
  }

  if (btnContainersAllOn) {
    btnContainersAllOn.addEventListener('click', () => {
      containerCatCheckboxes.forEach((c) => {
        c.checked = true;
      });
      if (chkShowContainers) chkShowContainers.checked = true;
      updateLayers();
    });
  }

  if (btnContainersAllOff) {
    btnContainersAllOff.addEventListener('click', () => {
      containerCatCheckboxes.forEach((c) => {
        c.checked = false;
      });
      if (chkShowContainers) chkShowContainers.checked = false;
      updateLayers();
    });
  }

  if (chkShowAllTasksTab) {
    chkShowAllTasksTab.addEventListener('change', () => {
      if (chkShowAllTasks) chkShowAllTasks.checked = chkShowAllTasksTab.checked;
      updateLayersSummaryBadge();
      window.tarkovAPI.updateSettings({ showAllMapTasksOnOverlay: chkShowAllTasksTab.checked });
    });
  }

  if (chkMoveTrigger) {
    chkMoveTrigger.addEventListener('change', () => {
      window.tarkovAPI.updateSettings({ movePositionTrigger: chkMoveTrigger.checked });
    });
  }

  if (chkAutoDetectLogs) {
    chkAutoDetectLogs.addEventListener('change', () => {
      window.tarkovAPI.updateSettings({ autoDetectMapFromLogs: chkAutoDetectLogs.checked });
    });
  }

  if (inputTaskSearch) {
    inputTaskSearch.addEventListener('input', () => {
      tasksVisibleCount = PAGE_SIZE;
      clearTimeout(taskSearchDebounceTimer);
      taskSearchDebounceTimer = setTimeout(renderTasksSection, 150);
    });
  }

  if (btnClearTaskSearch && inputTaskSearch) {
    btnClearTaskSearch.addEventListener('click', () => {
      inputTaskSearch.value = '';
      tasksVisibleCount = PAGE_SIZE;
      renderTasksSection();
      inputTaskSearch.focus();
    });
  }

  if (btnTasksLoadMore) {
    btnTasksLoadMore.addEventListener('click', () => {
      tasksVisibleCount += PAGE_SIZE;
      renderTasksSection();
    });
  }

  if (selectTaskTrader) {
    selectTaskTrader.addEventListener('change', () => {
      tasksVisibleCount = PAGE_SIZE;
      renderTasksSection();
    });
  }

  if (selectTaskFilter) {
    selectTaskFilter.addEventListener('change', () => {
      tasksVisibleCount = PAGE_SIZE;
      renderTasksSection();
    });
  }

  if (btnClearActiveTasks) {
    btnClearActiveTasks.addEventListener('click', () => {
      const prevActiveIds = ((currentSettings && currentSettings.activeTaskIds) || []).slice();
      if (prevActiveIds.length === 0) return;
      window.tarkovAPI.clearActiveTasks();
      showToast(`${prevActiveIds.length} seçili görev temizlendi`, 'warn', () => {
        window.tarkovAPI.setActiveTasks(prevActiveIds);
      });
    });
  }

  if (btnPinAllTaskItems) {
    btnPinAllTaskItems.addEventListener('click', () => {
      const activeSet = new Set((currentSettings && currentSettings.activeTaskIds) || []);
      const completedObjSet = new Set((currentSettings && currentSettings.completedObjectiveIds) || []);
      const itemsToPin = [];
      for (const t of allTasks.filter((tk) => activeSet.has(tk.id))) {
        for (const nk of t.neededKeys || []) {
          for (const k of nk.keys || []) itemsToPin.push(k);
        }
        for (const obj of t.objectives || []) {
          if (completedObjSet.has(obj.id)) continue;
          for (const it of obj.items || []) itemsToPin.push(it);
        }
      }
      if (itemsToPin.length > 0) {
        window.tarkovAPI.pinMultipleItems(itemsToPin);
        showToast(`${itemsToPin.length} görev eşyası/anahtarı aramaya eklendi`, 'ok');
      }
    });
  }

  if (btnOcrConfirmAll) {
    btnOcrConfirmAll.addEventListener('click', async () => {
      if (pendingOcrTaskIds.length === 0) return;
      const res = await window.tarkovAPI.setActiveTasks(pendingOcrTaskIds);
      const autoDoneCount = res?.newlyCompletedCount || 0;
      showToast(
        `${pendingOcrTaskIds.length} görev seçildi` +
          (autoDoneCount > 0 ? ` (${autoDoneCount} önkoşul görevi ✓ Yapıldı işaretlendi)` : ''),
        'ok'
      );
      if (ocrPreviewBar) ocrPreviewBar.hidden = true;
    });
  }

  if (btnOcrDismiss) {
    btnOcrDismiss.addEventListener('click', () => {
      if (ocrPreviewBar) ocrPreviewBar.hidden = true;
      ocrMatchesList.innerHTML = '';
      setOcrDropzoneState('ready', 'Hazır. Ekran görüntüsü yapıştırın veya aşağıdaki listeden görev seçin.');
    });
  }

  if (btnOcrRetry) {
    btnOcrRetry.addEventListener('click', (e) => {
      e.stopPropagation();
      if (lastOcrBlob) {
        processTaskScreenshotOCR(lastOcrBlob);
      } else if (inputOcrFile) {
        inputOcrFile.click();
      }
    });
  }

  if (btnOcrBrowse && inputOcrFile) {
    btnOcrBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      inputOcrFile.click();
    });
    inputOcrFile.addEventListener('change', () => {
      if (inputOcrFile.files && inputOcrFile.files[0]) {
        processTaskScreenshotOCR(inputOcrFile.files[0]);
      }
    });
  }

  if (ocrDropzone) {
    ocrDropzone.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (inputOcrFile) inputOcrFile.click();
    });
    ocrDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      ocrDropzone.classList.add('state-dragover');
    });
    ocrDropzone.addEventListener('dragleave', () => {
      ocrDropzone.classList.remove('state-dragover');
    });
    ocrDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      ocrDropzone.classList.remove('state-dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        processTaskScreenshotOCR(e.dataTransfer.files[0]);
      }
    });
  }

  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          if (currentActiveTabId === 'tab-inventory') {
            loadInventoryScreenshotBlob(blob);
          } else {
            processTaskScreenshotOCR(blob);
          }
        }
        break;
      }
    }
  });

  // ============================================================================
  // OTOMATİK ZİNCİRLEME ROTASYON (GÖREV / LOOT KUTUSU / EŞYA) KONTROLLERİ
  // ============================================================================
  const chkAutoRotation = document.getElementById('chk-auto-rotation');
  const rotCatCheckboxes = Array.from(document.querySelectorAll('.chk-rot-cat'));
  const btnStartRotation = document.getElementById('btn-start-rotation');
  const btnResetRotation = document.getElementById('btn-reset-rotation');
  const btnRouteNearestContainer = document.getElementById('btn-route-nearest-container');
  const btnStartTaskRotation = document.getElementById('btn-start-task-rotation');

  function saveRotationSettings() {
    const rotationCategories = rotCatCheckboxes
      .filter((c) => c.checked && c.dataset.rot)
      .map((c) => c.dataset.rot);
    window.tarkovAPI.updateSettings({
      autoRotationEnabled: chkAutoRotation ? chkAutoRotation.checked : true,
      rotationCategories
    });
  }

  if (chkAutoRotation) {
    chkAutoRotation.addEventListener('change', saveRotationSettings);
  }
  rotCatCheckboxes.forEach((chk) => {
    chk.addEventListener('change', saveRotationSettings);
  });

  if (btnStartRotation) {
    btnStartRotation.addEventListener('click', async () => {
      const rotationCategories = rotCatCheckboxes
        .filter((c) => c.checked && c.dataset.rot)
        .map((c) => c.dataset.rot);
      const res = await window.tarkovAPI.startRotation({ categories: rotationCategories });
      if (res && res.tour && res.tour.length > 0) {
        showToast(`Zincirleme rotasyon başlatıldı (${res.tour.length} hedef sıraya alındı)`, 'ok');
      } else {
        showToast('Haritada seçili kriterlere uygun hedef bulunamadı', 'warn');
      }
    });
  }

  if (btnResetRotation) {
    btnResetRotation.addEventListener('click', async () => {
      await window.tarkovAPI.clearVisitedTargets();
      showToast('Gezilen (✓) hedefler sıfırlandı, rotasyon baştan hesaplandı', 'info');
    });
  }

  if (btnRouteNearestContainer) {
    btnRouteNearestContainer.addEventListener('click', async () => {
      const enabledCats = containerCatCheckboxes.filter((c) => c.checked).map((c) => c.dataset.cat);
      if (enabledCats.length === 0) {
        showToast('Önce en az bir Loot Kutusu kategorisi işaretleyin', 'warn');
        return;
      }
      if (chkAutoRotation) chkAutoRotation.checked = true;
      rotCatCheckboxes.forEach((c) => {
        c.checked = c.dataset.rot === 'container';
      });
      await window.tarkovAPI.clearVisitedTargets();
      const res = await window.tarkovAPI.startRotation({ categories: ['container'] });
      if (res && res.tour && res.tour.length > 0) {
        showToast(
          `En yakın kutuya rota çizildi: ${res.activeTarget?.title || 'Kutu'} (Toplam ${res.tour.length} kutu zincirde)`,
          'ok'
        );
      } else {
        showToast('Bu haritada seçili kategoride kutu bulunamadı', 'warn');
      }
    });
  }

  if (btnStartTaskRotation) {
    btnStartTaskRotation.addEventListener('click', async () => {
      if (chkAutoRotation) chkAutoRotation.checked = true;
      rotCatCheckboxes.forEach((c) => {
        c.checked = c.dataset.rot === 'task' || c.dataset.rot === 'extract';
      });
      await window.tarkovAPI.clearVisitedTargets();
      const res = await window.tarkovAPI.startRotation({ categories: ['task', 'extract'] });
      if (res && res.tour && res.tour.length > 0) {
        showToast(
          `Seçili görevler için en kısa rotasyon başlatıldı (${res.tour.length} durak)`,
          'ok'
        );
      } else {
        showToast('Önce bu haritada en az bir görev seçin veya Haritanın Tüm Görevlerini açın', 'warn');
      }
    });
  }

  // ============================================================================
  // ENVANTER GÖRSELİ DEĞER ANALİZİ (FLEA MARKET VS TÜCCAR ÇİZİM MODÜLÜ)
  // ============================================================================
  const invCanvas = document.getElementById('inv-annotator-canvas');
  const invDropzone = document.getElementById('inv-dropzone');
  const btnInvCaptureLatest = document.getElementById('btn-inv-capture-latest');
  const btnInvBrowse = document.getElementById('btn-inv-browse');
  const btnInvDownload = document.getElementById('btn-inv-download');
  const btnInvClear = document.getElementById('btn-inv-clear');
  const inputInvFile = document.getElementById('input-inv-file');
  const inputInvItemSearch = document.getElementById('input-inv-item-search');
  const invQuickResults = document.getElementById('inv-quick-search-results');
  const invStatusLine = document.getElementById('inv-status-line');
  const invDetectedList = document.getElementById('inv-detected-list');
  const invTotalValueEl = document.getElementById('inv-total-value');
  const invTotalCountEl = document.getElementById('inv-total-count');
  const invFleaValueEl = document.getElementById('inv-flea-value');
  const invFleaCountEl = document.getElementById('inv-flea-count');
  const invTraderValueEl = document.getElementById('inv-trader-value');
  const invTraderCountEl = document.getElementById('inv-trader-count');
  const invModeChip = document.getElementById('inv-mode-chip');

  let invBaseImage = null;
  let invAnnotations = []; // [{ id, item, x, y, w, h, count, sellType: 'flea'|'trader', netFlea, traderPrice, traderName, iconImg }]
  let selectedBrushItem = null;
  const loadedIconCache = new Map();

  function evaluateItemFleaVsTrader(item) {
    const fleaRaw = Number(item.fleaPrice) || 0;
    // Tarkov Flea Market komisyon tahmini (~%8-%10)
    const estFee = Math.round(fleaRaw * 0.085);
    const netFlea = Math.max(0, fleaRaw - estFee);
    const traderPrice = Number(item.bestTrader?.priceRUB) || 0;
    const traderName = item.bestTrader?.name || 'Trader';

    const sellType = netFlea > traderPrice + 1500 ? 'flea' : 'trader';
    const bestNetPrice = sellType === 'flea' ? netFlea : traderPrice;
    const diffProfit = Math.abs(netFlea - traderPrice);

    return {
      sellType,
      fleaRaw,
      netFlea,
      traderPrice,
      traderName,
      bestNetPrice,
      diffProfit
    };
  }

  function loadCachedImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      if (loadedIconCache.has(src)) return resolve(loadedIconCache.get(src));
      const img = new Image();
      img.onload = () => {
        loadedIconCache.set(src, img);
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function addInventoryAnnotation(item, box = null) {
    if (!item || !invCanvas) return;
    const ev = evaluateItemFleaVsTrader(item);
    const iconImg = await loadCachedImage(item.iconLink);

    const slotW = Math.max(68, Math.min(180, (item.width || 1) * 62));
    const slotH = Math.max(62, Math.min(180, (item.height || 1) * 62));

    let x = box?.x;
    let y = box?.y;
    const w = box?.w || slotW;
    const h = box?.h || slotH;

    if (typeof x !== 'number' || typeof y !== 'number') {
      // Otomatik ızgara yerleşimi (Üst banner'ın altından başlar)
      const idx = invAnnotations.length;
      const cols = Math.max(1, Math.floor((invCanvas.width - 40) / 155));
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      x = 24 + col * 152;
      y = 78 + row * 92;
    }

    invAnnotations.push({
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      item,
      x: Math.max(8, Math.min(invCanvas.width - w - 8, x)),
      y: Math.max(62, Math.min(invCanvas.height - h - 8, y)),
      w,
      h,
      count: 1,
      ...ev,
      iconImg
    });

    renderInventoryCanvasAndList();
  }

  function renderInventoryCanvasAndList() {
    if (!invCanvas) return;
    const ctx = invCanvas.getContext('2d');
    const W = invCanvas.width;
    const H = invCanvas.height;

    ctx.clearRect(0, 0, W, H);

    // 1) Arka Plan: Yüklenen Oyun Ekran Görüntüsü veya Tarkov Stash Izgarası
    if (invBaseImage) {
      ctx.drawImage(invBaseImage, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 64) {
        ctx.beginPath();
        ctx.moveTo(gx, 58);
        ctx.lineTo(gx, H);
        ctx.stroke();
      }
      for (let gy = 58; gy < H; gy += 64) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
        ctx.stroke();
      }
      if (invAnnotations.length === 0) {
        ctx.fillStyle = 'rgba(203, 213, 225, 0.45)';
        ctx.font = '600 15px Inter, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          '📸 Oyundaki Envanter Ekran Görüntüsünü Yapıştırın (Ctrl+V) veya "Son Ekran Görüntüsünü Çek" Butonuna Tıklayın',
          W / 2,
          H / 2 - 10
        );
        ctx.font = '13px Inter, Segoe UI, sans-serif';
        ctx.fillText(
          'Görselin üzerine Flea Market (Yeşil) / Tüccar (Altın) kutuları ve Toplam Envanter Değeri otomatik çizilir.',
          W / 2,
          H / 2 + 18
        );
      }
    }

    // Toplam Değerleri Hesapla
    let totalNet = 0;
    let fleaTotal = 0;
    let fleaCount = 0;
    let traderTotal = 0;
    let traderCount = 0;

    for (const ann of invAnnotations) {
      const qty = ann.count || 1;
      totalNet += ann.bestNetPrice * qty;
      if (ann.sellType === 'flea') {
        fleaTotal += ann.netFlea * qty;
        fleaCount += qty;
      } else {
        traderTotal += ann.traderPrice * qty;
        traderCount += qty;
      }
    }

    // 2) Görselin En Üstüne Doğrudan "TOPLAM ENVANTER DEĞERİ" HUD Banner'ı Çiz
    ctx.fillStyle = 'rgba(10, 13, 19, 0.92)';
    ctx.fillRect(0, 0, W, 54);
    ctx.strokeStyle = '#c8a45d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 54);
    ctx.lineTo(W, 54);
    ctx.stroke();

    const modeTxt = currentSettings?.gameMode === 'pve' ? 'PvE' : 'PvP';
    ctx.textAlign = 'left';
    ctx.font = '800 16px Inter, Segoe UI, sans-serif';
    ctx.fillStyle = '#fde047';
    ctx.fillText(`💰 TOPLAM ENVANTER DEĞERİ (${modeTxt}): ${formatRub(totalNet)}`, 16, 24);

    ctx.font = '700 12.5px Inter, Segoe UI, sans-serif';
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`🟢 FLEA MARKET'E KOY (${fleaCount} adet): ${formatRub(fleaTotal)}`, 16, 44);

    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`🟡 TÜCCARA SAT (${traderCount} adet): ${formatRub(traderTotal)}`, 390, 44);

    // 3) Her Eşya İçin Görsel Üzerine Kutu, İkon ve "FLEA vs TÜCCAR" Etiketi Çiz
    for (const ann of invAnnotations) {
      const isFlea = ann.sellType === 'flea';
      const strokeCol = isFlea ? '#22c55e' : '#f59e0b';
      const fillCol = isFlea ? 'rgba(22, 163, 74, 0.20)' : 'rgba(217, 119, 6, 0.20)';
      const badgeBg = isFlea ? 'rgba(6, 78, 59, 0.94)' : 'rgba(120, 53, 15, 0.94)';

      // Kutu dolgusu ve çerçevesi
      ctx.fillStyle = fillCol;
      ctx.fillRect(ann.x, ann.y, ann.w, ann.h);
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 2.4;
      ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);

      // Eşya ikonu varsa sol üste çiz
      if (ann.iconImg) {
        const iconSz = Math.min(34, ann.h - 22);
        if (iconSz >= 18) {
          ctx.drawImage(ann.iconImg, ann.x + 4, ann.y + 4, iconSz, iconSz);
        }
      }

      // Kısa isim + adet
      ctx.textAlign = 'left';
      ctx.font = '800 11.5px Inter, Segoe UI, sans-serif';
      ctx.fillStyle = '#ffffff';
      const titleStr = `${ann.item.shortName || ann.item.name}${ann.count > 1 ? ` ×${ann.count}` : ''}`;
      ctx.fillText(titleStr, ann.x + (ann.iconImg ? 40 : 6), ann.y + 16);

      // Alt Satış Kararı Şeridi (FLEA MARKET vs TÜCCAR)
      const pillH = 20;
      const pillY = ann.y + ann.h - pillH;
      ctx.fillStyle = badgeBg;
      ctx.fillRect(ann.x, pillY, ann.w, pillH);

      ctx.font = '800 10.5px Inter, Segoe UI, sans-serif';
      ctx.fillStyle = isFlea ? '#86efac' : '#fde68a';
      const actionLabel = isFlea
        ? `FLEA: ${formatRub(ann.netFlea * (ann.count || 1))}`
        : `${ann.traderName.toUpperCase()}: ${formatRub(ann.traderPrice * (ann.count || 1))}`;
      ctx.fillText(actionLabel, ann.x + 5, pillY + 14);
    }

    // KPI Kartlarını Güncelle
    if (invTotalValueEl) invTotalValueEl.textContent = totalNet > 0 ? formatRub(totalNet) : '0 ₽';
    if (invTotalCountEl) invTotalCountEl.textContent = `${fleaCount + traderCount} eşya işaretlendi`;
    if (invFleaValueEl) invFleaValueEl.textContent = fleaTotal > 0 ? formatRub(fleaTotal) : '0 ₽';
    if (invFleaCountEl) invFleaCountEl.textContent = `${fleaCount} eşya Flea Market'te daha kârlı`;
    if (invTraderValueEl) invTraderValueEl.textContent = traderTotal > 0 ? formatRub(traderTotal) : '0 ₽';
    if (invTraderCountEl) invTraderCountEl.textContent = `${traderCount} eşya Tüccarda daha kârlı`;
    if (invModeChip) invModeChip.textContent = modeTxt;

    // Sağ Listeyi Güncelle
    if (invDetectedList) {
      if (invAnnotations.length === 0) {
        invDetectedList.innerHTML = `<span class="muted">Henüz eşya eklenmedi. Ekran görüntüsü yapıştırın (<kbd>Ctrl+V</kbd>) veya yukarıdan eşya arayıp seçin.</span>`;
      } else {
        invDetectedList.innerHTML = '';
        invAnnotations.forEach((ann, idx) => {
          const isFlea = ann.sellType === 'flea';
          const row = document.createElement('div');
          row.className = `inv-item-row ${isFlea ? 'sell-flea' : 'sell-trader'}`;
          row.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <img src="${ann.item.iconLink || ''}" style="width:32px;height:32px;object-fit:contain;background:#090b10;border-radius:4px;" alt="" />
              <div style="min-width:0;">
                <div style="font-weight:700;color:var(--text-1);">${ann.item.name} <span class="muted">(${ann.item.shortName || ''})</span></div>
                <div style="font-size:11px;color:${isFlea ? '#4ade80' : '#fbbf24'};font-weight:700;">
                  ${isFlea ? `🟢 FLEA MARKET: ${formatRub(ann.netFlea)} (Tüccar: ${formatRub(ann.traderPrice)})` : `🟡 TÜCCAR (${ann.traderName}): ${formatRub(ann.traderPrice)} (Flea: ${formatRub(ann.netFlea)})`}
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              <button type="button" class="btn btn-ghost btn-inv-qty" style="padding:2px 6px;font-size:11px;" title="Adet artır">×${ann.count || 1} ＋</button>
              <button type="button" class="btn btn-ghost btn-danger-text btn-inv-del" style="padding:2px 6px;font-size:11px;" title="Kaldır">✕</button>
            </div>
          `;
          row.querySelector('.btn-inv-qty').addEventListener('click', () => {
            ann.count = (ann.count || 1) + 1;
            renderInventoryCanvasAndList();
          });
          row.querySelector('.btn-inv-del').addEventListener('click', () => {
            invAnnotations.splice(idx, 1);
            renderInventoryCanvasAndList();
          });
          invDetectedList.appendChild(row);
        });
      }
    }
  }

  function renderQuickInventorySearchChips() {
    if (!invQuickResults || allItems.length === 0) return;
    const q = normalizeTr(inputInvItemSearch ? inputInvItemSearch.value : '');
    let matches = [];
    if (!q) {
      matches = allItems
        .slice()
        .sort((a, b) => (b.bestOverallPrice || 0) - (a.bestOverallPrice || 0))
        .slice(0, 10);
    } else {
      matches = allItems
        .filter((it) => it._normName?.includes(q) || it._normShort?.includes(q))
        .sort((a, b) => (b.bestOverallPrice || 0) - (a.bestOverallPrice || 0))
        .slice(0, 12);
    }

    invQuickResults.innerHTML = '';
    for (const item of matches) {
      const ev = evaluateItemFleaVsTrader(item);
      const isSelectedBrush = selectedBrushItem && selectedBrushItem.id === item.id;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `inv-quick-chip ${isSelectedBrush ? 'selected-brush' : ''}`;
      chip.innerHTML = `
        <img src="${item.iconLink || ''}" style="width:20px;height:20px;object-fit:contain;" alt="" />
        <span><strong>${item.shortName || item.name}</strong></span>
        <span style="color:${ev.sellType === 'flea' ? '#4ade80' : '#fbbf24'};font-weight:700;">
          ${ev.sellType === 'flea' ? '🟢 Flea' : `🟡 ${ev.traderName}`}: ${formatRub(ev.bestNetPrice)}
        </span>
      `;
      chip.title = 'Tıklayınca görsele ekler ve fırça olarak seçer (Görselde istediğiniz slota tıklayarak da yerleştirebilirsiniz)';
      chip.addEventListener('click', () => {
        selectedBrushItem = item;
        renderQuickInventorySearchChips();
        addInventoryAnnotation(item);
        if (invStatusLine) {
          invStatusLine.textContent = `Seçili Fırça: "${item.name}" — Görsel üzerinde istediğiniz envanter slotuna tıklayarak kutuyu o noktaya taşıyabilir veya yeni kutu ekleyebilirsiniz.`;
        }
      });
      invQuickResults.appendChild(chip);
    }
  }

  async function runInventoryImageOCR(imgElement) {
    if (!window.Tesseract || !allItems || allItems.length === 0) return;
    if (invStatusLine) {
      invStatusLine.textContent = '🔍 Görseldeki eşya kısa adları (OCR) taranıyor ve Flea/Tüccar fiyatları hesaplanıyor...';
    }
    try {
      const res = await window.Tesseract.recognize(imgElement, 'eng');
      const words = res?.data?.words || [];
      const shortMap = new Map();
      for (const it of allItems) {
        if (it.shortName && it.shortName.length >= 2) {
          const key = it.shortName.toLowerCase().trim();
          const ex = shortMap.get(key);
          if (!ex || (it.bestOverallPrice || 0) > (ex.bestOverallPrice || 0)) {
            shortMap.set(key, it);
          }
        }
      }

      let foundCount = 0;
      const placedPositions = [];
      for (const w of words) {
        const clean = String(w.text || '')
          .replace(/[^a-zA-Z0-9-]/g, '')
          .toLowerCase()
          .trim();
        if (clean.length < 2) continue;
        const matchedItem = shortMap.get(clean);
        if (matchedItem && w.bbox) {
          const bx = Math.round((w.bbox.x0 / imgElement.width) * invCanvas.width);
          const by = Math.round((w.bbox.y0 / imgElement.height) * invCanvas.height);
          if (by < 55) continue;
          const tooClose = placedPositions.some((p) => Math.hypot(p.x - bx, p.y - by) < 48);
          if (!tooClose) {
            placedPositions.push({ x: bx, y: by });
            await addInventoryAnnotation(matchedItem, {
              x: bx - 6,
              y: by - 4,
              w: Math.max(82, (matchedItem.width || 1) * 60),
              h: Math.max(64, (matchedItem.height || 1) * 58)
            });
            foundCount++;
          }
        }
      }

      if (invStatusLine) {
        invStatusLine.textContent =
          foundCount > 0
            ? `✓ OCR tamamlandı: ${foundCount} eşya görsel üzerinde otomatik kutulandı. Eksik eşyaları üstteki aramadan seçip görsel üzerine tıklayarak ekleyebilirsiniz.`
            : 'Görsel yüklendi. Üstteki arama çubuğundan eşyayı seçip görseldeki slotların üzerine tıklayarak Flea/Tüccar kutularını çizebilirsiniz.';
      }
    } catch (_err) {
      if (invStatusLine) {
        invStatusLine.textContent = 'Görsel yüklendi. Üstteki çubuktan eşya seçip görsel üzerine tıklayarak kutu çizebilirsiniz.';
      }
    }
  }

  function loadInventoryScreenshotDataUrl(dataUrl, labelText = 'Ekran görüntüsü') {
    if (!dataUrl || !invCanvas) return;
    const img = new Image();
    img.onload = async () => {
      invBaseImage = img;
      const aspect = img.width / Math.max(1, img.height);
      invCanvas.width = 960;
      invCanvas.height = Math.round(960 / aspect);
      invAnnotations = [];
      renderInventoryCanvasAndList();
      showToast(`${labelText} yüklendi, envanter analizi yapılıyor...`, 'ok');
      await runInventoryImageOCR(img);
    };
    img.src = dataUrl;
  }

  function loadInventoryScreenshotBlob(blob) {
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        loadInventoryScreenshotDataUrl(reader.result, 'Yapıştırılan envanter görseli');
      }
    };
    reader.readAsDataURL(blob);
  }

  if (btnInvCaptureLatest) {
    btnInvCaptureLatest.addEventListener('click', async () => {
      const res = await window.tarkovAPI.getLatestScreenshotDataUrl();
      if (res && res.ok && res.dataUrl) {
        loadInventoryScreenshotDataUrl(res.dataUrl, res.filename || 'Oyun ekran görüntüsü');
      } else {
        showToast(
          res?.error || 'Klasörde ekran görüntüsü bulunamadı. Oyunda Home / PrtScn tuşuna basın veya Ctrl+V ile yapıştırın.',
          'warn'
        );
      }
    });
  }

  if (btnInvBrowse && inputInvFile) {
    btnInvBrowse.addEventListener('click', () => inputInvFile.click());
    inputInvFile.addEventListener('change', () => {
      if (inputInvFile.files && inputInvFile.files[0]) {
        loadInventoryScreenshotBlob(inputInvFile.files[0]);
      }
    });
  }

  if (btnInvClear) {
    btnInvClear.addEventListener('click', () => {
      invAnnotations = [];
      renderInventoryCanvasAndList();
      showToast('Envanter çizimleri temizlendi', 'info');
    });
  }

  if (btnInvDownload && invCanvas) {
    btnInvDownload.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `tarkov-envanter-analizi-${Date.now()}.png`;
      link.href = invCanvas.toDataURL('image/png');
      link.click();
      showToast('Çizimli envanter görseli indirildi', 'ok');
    });
  }

  if (inputInvItemSearch) {
    inputInvItemSearch.addEventListener('input', renderQuickInventorySearchChips);
  }

  if (invCanvas) {
    invCanvas.addEventListener('click', (e) => {
      const rect = invCanvas.getBoundingClientRect();
      const scaleX = invCanvas.width / rect.width;
      const scaleY = invCanvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      if (selectedBrushItem) {
        addInventoryAnnotation(selectedBrushItem, {
          x: cx - 42,
          y: Math.max(58, cy - 32),
          w: Math.max(92, (selectedBrushItem.width || 1) * 62),
          h: Math.max(66, (selectedBrushItem.height || 1) * 60)
        });
      }
    });

    invCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = invCanvas.getBoundingClientRect();
      const scaleX = invCanvas.width / rect.width;
      const scaleY = invCanvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      for (let i = invAnnotations.length - 1; i >= 0; i--) {
        const a = invAnnotations[i];
        if (cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) {
          invAnnotations.splice(i, 1);
          renderInventoryCanvasAndList();
          break;
        }
      }
    });
  }

  if (invDropzone) {
    invDropzone.addEventListener('dragover', (e) => e.preventDefault());
    invDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadInventoryScreenshotBlob(e.dataTransfer.files[0]);
      }
    });
  }

  [setGamemode, setLanguage, setLevel, setScreenshotsDir, setDeleteSs].forEach((el) => {
    el.addEventListener('change', () => {
      window.tarkovAPI.updateSettings({
        gameMode: setGamemode.value,
        language: setLanguage.value,
        playerLevel: Number(setLevel.value) || 15,
        screenshotsDir: setScreenshotsDir.value.trim(),
        deleteScreenshotsAfterRead: setDeleteSs.checked
      });
    });
  });

  chkAutoDetectMap.addEventListener('change', () => {
    window.tarkovAPI.updateSettings({ autoDetectMapFromCoords: chkAutoDetectMap.checked });
  });

  chkAutoNearestTarget.addEventListener('change', () => {
    window.tarkovAPI.updateSettings({ autoNearestTarget: chkAutoNearestTarget.checked });
  });

  selectTargetManual.addEventListener('change', () => {
    const val = selectTargetManual.value;
    if (!val) {
      window.tarkovAPI.clearTarget();
      return;
    }
    const found = candidateTargets.find((c) => c.id === val);
    if (found) {
      window.tarkovAPI.setTarget(found);
    }
  });

  btnNextTarget.addEventListener('click', () => {
    window.tarkovAPI.nextTarget();
  });

  btnClearTarget.addEventListener('click', () => {
    window.tarkovAPI.clearTarget();
  });

  setYawOffset.addEventListener('input', () => {
    const val = Number(setYawOffset.value) || 0;
    lblYawOffset.textContent = `${val}°`;
    rangeYawOffsetQuick.value = val;
    lblYawOffsetQuick.textContent = `${val}°`;
    window.tarkovAPI.updateSettings({ yawOffset: val });
  });

  rangeYawOffsetQuick.addEventListener('input', () => {
    const val = Number(rangeYawOffsetQuick.value) || 0;
    lblYawOffsetQuick.textContent = `${val}°`;
    setYawOffset.value = val;
    lblYawOffset.textContent = `${val}°`;
    window.tarkovAPI.updateSettings({ yawOffset: val });
  });

  async function runFilenameTest(filenameStr) {
    if (filenameStr !== undefined) {
      inputTestFilename.value = filenameStr;
    }
    const res = await window.tarkovAPI.testScreenshotFilename(inputTestFilename.value);
    if (res && res.ok) {
      testParseResult.className = 'parse-result-box ok';
      testParseResult.innerHTML = `
        <strong>✓ Başarıyla Parse Edildi ve Haritada Gösterildi!</strong><br/>
        • Konum: X = <strong>${res.position.x}</strong>, Y (Yükseklik) = <strong>${res.position.y}</strong>, Z = <strong>${res.position.z}</strong><br/>
        • Hesaplanan Yön (Yaw): <strong>${res.yaw}° (${res.compass})</strong>
      `;
    } else {
      testParseResult.className = 'parse-result-box err';
      testParseResult.innerHTML = `<strong>✗ Format Hatası:</strong> ${res?.error || 'Geçersiz dosya adı'}`;
    }
  }

  btnTestFilename.addEventListener('click', () => runFilenameTest());

  btnSampleCustoms.addEventListener('click', () => {
    runFilenameTest('2026-11-01[17-28]_178.50, 3.20, 182.40_0.0, 0.38268, 0.0, 0.92388_12.1 (0).png');
  });

  btnSampleWoods.addEventListener('click', () => {
    runFilenameTest('2026-11-01[17-29]_-25.40, -14.20, -210.60_0.0, -0.7071, 0.0, 0.7071_15.0 (0).png');
  });

  btnScanLatest.addEventListener('click', async () => {
    const res = await window.tarkovAPI.scanLatestScreenshot();
    if (!res || !res.ok) {
      testParseResult.className = 'parse-result-box err';
      testParseResult.innerHTML = `<strong>Bilgi:</strong> ${res?.error || 'Klasörde görüntü bulunamadı.'}`;
    } else {
      testParseResult.className = 'parse-result-box ok';
      testParseResult.innerHTML = `<strong>✓ Klasördeki son görüntü okundu:</strong> ${res.filename}`;
    }
  });

  btnClearTrail.addEventListener('click', () => {
    window.tarkovAPI.clearPlayerTrail();
    showToast('Oyuncu izleri temizlendi', 'info');
  });

  btnSaveShortcuts.addEventListener('click', async () => {
    const inputs = shortcutsForm.querySelectorAll('input[data-shortcut-key]');
    const nextShortcuts = {};
    inputs.forEach((inp) => {
      nextShortcuts[inp.dataset.shortcutKey] = inp.value.trim();
    });
    const res = await window.tarkovAPI.validateAndRegisterShortcuts(nextShortcuts);
    if (res && res.status) {
      lastShortcutStatus = res.status;
      applySettingsToUI(res.settings);
      showToast('Kısayollar kaydedildi ve kontrol edildi', 'ok');
    }
  });

  btnResetShortcuts.addEventListener('click', async () => {
    const res = await window.tarkovAPI.resetDefaultShortcuts();
    if (res && res.status) {
      lastShortcutStatus = res.status;
      applySettingsToUI(res.settings);
      showToast('Kısayollar varsayılana sıfırlandı', 'info');
    }
  });

  function prependLogEntry(entry) {
    const div = document.createElement('div');
    div.className = `log-entry ${entry.level || 'info'}`;
    const time = new Date(entry.timestamp).toLocaleTimeString();
    div.innerHTML = `<span class="log-time">[${time}]</span> <strong>[${(entry.level || 'INFO').toUpperCase()}]</strong> ${entry.message} ${entry.details ? `<span class="muted">(${entry.details})</span>` : ''}`;
    logsContainer.prepend(div);
  }

  btnClearLogs.addEventListener('click', async () => {
    await window.tarkovAPI.clearLogs();
    logsContainer.innerHTML = '';
    showToast('Günlük temizlendi', 'info');
  });

  // Başlangıç Yüklemesi
  window.tarkovAPI.getSettings().then(async (res) => {
    if (res) {
      codeSettingsPath.textContent = res.settingsFilePath || '';
      const valRes = await window.tarkovAPI.validateAndRegisterShortcuts(res.settings.shortcuts);
      if (valRes && valRes.status) {
        lastShortcutStatus = valRes.status;
      }
      applySettingsToUI(res.settings);
      await fetchAndPrepareItems(false);
    }
  });

  window.tarkovAPI.getAutoHomeState().then(renderAutoHomeUI);

  window.tarkovAPI.getOverlayMapPayload().then((res) => {
    if (res && res.ok && res.payload) {
      candidateTargets = res.payload.candidateTargets || [];
      renderTargetSelectDropdown();
    }
  });

  window.tarkovAPI.getPlayerState().then((st) => {
    if (st) {
      currentPlayerState = st;
      renderPlayerStatusCard();
      renderTargetSelectDropdown();
    }
  });

  window.tarkovAPI.getLogs().then((entries) => {
    logsContainer.innerHTML = '';
    (entries || []).slice().reverse().forEach(prependLogEntry);
  });

  window.tarkovAPI.onSettingsUpdated((settings) => {
    applySettingsToUI(settings);
  });

  window.tarkovAPI.onAutoHomeUpdated(renderAutoHomeUI);

  window.tarkovAPI.onMapDataUpdated((payload) => {
    candidateTargets = (payload && payload.candidateTargets) || [];
    renderTargetSelectDropdown();
  });

  window.tarkovAPI.onPlayerUpdated((st) => {
    currentPlayerState = st;
    renderPlayerStatusCard();
    renderTargetSelectDropdown();
  });

  // Görsel Büyütme Modal (Lightbox)
  const lightboxModal = document.getElementById('image-lightbox-modal');
  const lightboxBackdrop = document.getElementById('lightbox-backdrop');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');

  function openImageLightbox(src, caption = '') {
    if (!lightboxModal || !src) return;
    lightboxImg.src = src;
    if (lightboxCaption) {
      lightboxCaption.textContent = caption;
      lightboxCaption.style.display = caption ? 'block' : 'none';
    }
    lightboxModal.classList.remove('hidden');
  }

  function closeImageLightbox() {
    if (!lightboxModal) return;
    lightboxModal.classList.add('hidden');
    if (lightboxImg) lightboxImg.src = '';
  }

  window.openImageLightbox = openImageLightbox;
  window.closeImageLightbox = closeImageLightbox;

  if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', closeImageLightbox);
  if (lightboxBackdrop) lightboxBackdrop.addEventListener('click', closeImageLightbox);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxModal && !lightboxModal.classList.contains('hidden')) {
      closeImageLightbox();
    }
  });

  // Delegated Click: Paneldeki tüm büyütülebilir görsellere tıklama
  document.addEventListener('click', (e) => {
    const zoomTarget = e.target.closest('[data-zoom-src]');
    if (zoomTarget) {
      e.stopPropagation();
      e.preventDefault();
      const src = zoomTarget.getAttribute('data-zoom-src');
      const caption = zoomTarget.getAttribute('data-zoom-caption') || '';
      openImageLightbox(src, caption);
    }
  });

  window.tarkovAPI.onNewLog((entry) => {
    prependLogEntry(entry);
  });
})();
