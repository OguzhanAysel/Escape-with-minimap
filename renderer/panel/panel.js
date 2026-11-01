(function () {
  const SHORTCUT_LABELS = {
    toggleOverlay: 'Overlay Göster / Gizle',
    toggleEditMode: 'Düzenleme Modu Aç / Kapat',
    toggleAutoHome: 'Otomatik HOME Tuşu Aç / Kapat (1 sn)',
    opacityUp: 'Saydamlık Artır',
    opacityDown: 'Saydamlık Azalt',
    toggleFollowMode: 'Takip / Sabit Modu Değiştir',
    nextTarget: 'Sonraki Hedefe Geç',
    nextMap: 'Sonraki Haritaya Geç',
    zoomIn: 'Harita Yakınlaştır',
    zoomOut: 'Harita Uzaklaştır'
  };

  let currentSettings = null;
  let lastShortcutStatus = {};
  let allItems = [];
  let allTasks = [];
  let fuseTasks = null;
  let searchDebounceTimer = null;
  let taskSearchDebounceTimer = null;
  let currentPlayerState = null;
  let candidateTargets = [];

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

  // Sekme Geçişleri
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });

  // DOM Referansları
  const ovStatusPill = document.getElementById('ov-status-pill');
  const btnToggleVisible = document.getElementById('btn-toggle-visible');
  const btnToggleEdit = document.getElementById('btn-toggle-edit');
  const btnToggleAutoHome = document.getElementById('btn-toggle-autohome');
  const selectGamemodeQuick = document.getElementById('select-gamemode-quick');
  const selectMap = document.getElementById('select-map');
  const selectMapStyle = document.getElementById('select-map-style');
  const rangeOpacity = document.getElementById('range-opacity');
  const lblOpacity = document.getElementById('lbl-opacity');

  const chkShowCallouts = document.getElementById('chk-show-callouts');
  const chkLayerLoot = document.getElementById('chk-layer-loot');
  const chkShowContainers = document.getElementById('chk-show-containers');
  const chkShowExtracts = document.getElementById('chk-show-extracts');
  const chkLayerTasks = document.getElementById('chk-layer-tasks');
  const chkShowAllTasks = document.getElementById('chk-show-all-tasks');
  const chkShowAllTasksTab = document.getElementById('chk-show-all-tasks-tab');
  const chkLayerPlayer = document.getElementById('chk-layer-player');
  const chkLayerRoute = document.getElementById('chk-layer-route');
  const chkFollowMode = document.getElementById('chk-follow-mode');
  const chkHoverInteractive = document.getElementById('chk-hover-interactive');

  // Eşya Arama DOM
  const apiStatusBadge = document.getElementById('api-status-badge');
  const btnRefreshApi = document.getElementById('btn-refresh-api');
  const pinnedItemsContainer = document.getElementById('pinned-items-container');
  const btnClearPins = document.getElementById('btn-clear-pins');
  const inputLootSearch = document.getElementById('input-loot-search');
  const selectLootSort = document.getElementById('select-loot-sort');
  const chkOnlyWithSpawns = document.getElementById('chk-only-with-spawns');
  const lootResultsInfo = document.getElementById('loot-results-info');
  const lootResultsGrid = document.getElementById('loot-results-grid');

  // Aşama 3 & 4: Oyuncu Konum, Oto-Home & Rota DOM
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

  // Aşama 5: Görevler & OCR DOM
  const btnClearActiveTasks = document.getElementById('btn-clear-active-tasks');
  const ocrDropzone = document.getElementById('ocr-dropzone');
  const inputOcrFile = document.getElementById('input-ocr-file');
  const btnOcrBrowse = document.getElementById('btn-ocr-browse');
  const ocrStatusBox = document.getElementById('ocr-status-box');
  const ocrMatchesList = document.getElementById('ocr-matches-list');
  const btnPinAllTaskItems = document.getElementById('btn-pin-all-task-items');
  const taskRequiredItemsBox = document.getElementById('task-required-items-box');
  const inputTaskSearch = document.getElementById('input-task-search');
  const selectTaskTrader = document.getElementById('select-task-trader');
  const selectTaskFilter = document.getElementById('select-task-filter');
  const tasksCountInfo = document.getElementById('tasks-count-info');
  const tasksListContainer = document.getElementById('tasks-list-container');

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

  function renderAutoHomeUI(st) {
    if (!st) return;
    const sec = ((st.intervalMs || 1000) / 1000).toFixed(1).replace('.0', '');
    if (st.active) {
      btnToggleAutoHome.textContent = `Oto-Home (Alt+H): AÇIK (${sec} sn)`;
      btnToggleAutoHome.className = 'btn btn-warning active';
      plAutoHomeStatus.textContent = `AÇIK (Her ${sec} sn'de bir HOME basılıyor)`;
      plAutoHomeStatus.style.color = '#86efac';
    } else {
      btnToggleAutoHome.textContent = `Oto-Home (Alt+H): KAPALI (${sec} sn)`;
      btnToggleAutoHome.className = 'btn btn-secondary';
      plAutoHomeStatus.textContent = 'KAPALI (Alt+H ile başlatın)';
      plAutoHomeStatus.style.color = '#94a3b8';
    }
  }

  function renderTargetSelectDropdown() {
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
        rtRelativeDir.textContent = `${nav.relativeText} (Hedef Açısı: ${nav.targetBearing}°)`;
        rtElevation.textContent = nav.elevationText;
      } else {
        rtDistance.textContent = 'Oyuncu konumu bekleniyor';
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
    plCoords.textContent = `X: ${cur.position.x.toFixed(1)} | Y: ${cur.position.y.toFixed(1)}m | Z: ${cur.position.z.toFixed(1)}`;
    plYaw.textContent = `${cur.yaw}° (${cur.compass}) — İz: ${(currentPlayerState.trail || []).length}/10`;
  }

  setInterval(renderPlayerStatusCard, 1000);

  function renderPinnedItemsBar() {
    const pinned = (currentSettings && currentSettings.pinnedItems) || [];
    if (pinned.length === 0) {
      pinnedItemsContainer.innerHTML = `<span class="muted small">Henüz eşya seçilmedi. Aşağıdaki kartlardan "Haritada Pinle" butonuna tıklayın.</span>`;
      return;
    }

    pinnedItemsContainer.innerHTML = '';
    for (const p of pinned) {
      const chip = document.createElement('div');
      chip.className = 'pin-chip';
      chip.innerHTML = `
        <span class="pin-chip-dot" style="background:${p.color}"></span>
        <span>${p.name} <small class="muted">(${p.shortName || ''})</small></span>
        <button class="pin-chip-remove" title="Pini Kaldır">✕</button>
      `;
      chip.querySelector('.pin-chip-remove').addEventListener('click', () => {
        window.tarkovAPI.togglePinItem(p);
      });
      pinnedItemsContainer.appendChild(chip);
    }
  }

  function renderLootResults() {
    if (!allItems || allItems.length === 0) {
      lootResultsInfo.textContent = 'Eşya verisi henüz yüklenmedi...';
      lootResultsGrid.innerHTML = '';
      return;
    }

    const q = normalizeTr(inputLootSearch.value);
    const onlyWithSpawns = chkOnlyWithSpawns.checked;
    const sortBy = selectLootSort.value;
    const activeMap = (currentSettings && currentSettings.selectedMap) || 'customs';
    const modeLabel = (currentSettings && currentSettings.gameMode) === 'pve' ? 'PvE Zone' : 'PvP Regular';
    const pinnedIds = new Set(((currentSettings && currentSettings.pinnedItems) || []).map((x) => x.id));

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
    const shown = filtered.slice(0, 60);

    lootResultsInfo.textContent = `[${modeLabel}] Toplam ${totalMatches.toLocaleString('tr-TR')} eşya bulundu (İlk ${shown.length} gösteriliyor). Aktif harita: ${activeMap.toUpperCase()}`;
    lootResultsGrid.innerHTML = '';

    for (const item of shown) {
      const isPinned = pinnedIds.has(item.id);
      const pinEntry = ((currentSettings && currentSettings.pinnedItems) || []).find((x) => x.id === item.id);
      const card = document.createElement('div');
      card.className = 'item-card' + (isPinned ? ' pinned' : '');

      const fleaBetter = item.fleaPrice > 0 && item.fleaPrice >= item.bestTrader.priceRUB;
      const traderBetter = item.bestTrader.priceRUB > 0 && item.bestTrader.priceRUB > item.fleaPrice;

      const avgSub = item.fleaAvg24hPrice
        ? `<div class="muted" style="font-size:10px">24s Ort: ${formatRub(item.fleaAvg24hPrice)}</div>`
        : '';

      const mapPillsHtml = (item.mapSpawnsSummary && item.mapSpawnsSummary.length > 0)
        ? item.mapSpawnsSummary
            .map((ms) => {
              const isCurrent = ms.mapNormalizedName === activeMap;
              return `<span class="map-spawn-pill ${isCurrent ? 'active-map' : ''}" data-map="${ms.mapNormalizedName}" title="Bu haritaya geç: ${ms.mapName} (${ms.looseCount} açıkta spawn, ${ms.containerCount} konteyner)">
                ${ms.mapName}: <strong>${ms.looseCount}</strong> spawn
              </span>`;
            })
            .join('')
        : `<span class="muted small">Açıkta (loose) spawn kaydı yok — konteynerlerden çıkabilir</span>`;

      card.innerHTML = `
        <div class="item-card-top">
          <img class="item-icon" src="${item.iconLink || ''}" alt="" loading="lazy" />
          <div class="item-title-box">
            <div class="item-name" title="${item.name}">${item.name}</div>
            <div class="item-meta">Kısa: <strong>${item.shortName || '-'}</strong> • Boyut: ${item.width}x${item.height} (${item.slots} slot)</div>
            <div class="item-meta">En İyi Satış (${modeLabel}): <strong style="color:#86efac">${item.bestOverallSource}</strong></div>
          </div>
          <button class="btn btn-sm ${isPinned ? 'btn-warning active' : 'btn-primary'} btn-pin-toggle">
            ${isPinned ? `✓ Pinli` : '+ Haritada Pinle'}
          </button>
        </div>

        <div class="item-prices-grid">
          <div class="price-box ${fleaBetter ? 'best-choice' : ''}">
            <span class="price-label">Flea (Anlık En Düşük) ${fleaBetter ? '★' : ''}</span>
            <span class="price-val">${formatRub(item.fleaPrice)}</span>
            ${avgSub}
          </div>
          <div class="price-box ${traderBetter ? 'best-choice' : ''}">
            <span class="price-label">${item.bestTrader.name} ${traderBetter ? '★' : ''}</span>
            <span class="price-val">${formatRub(item.bestTrader.priceRUB)}</span>
          </div>
          <div class="price-box">
            <span class="price-label">Slot Başı Değer</span>
            <span class="price-val slot-badge">${formatRub(item.pricePerSlot)}/slot</span>
          </div>
        </div>

        <div class="item-maps-list">
          ${mapPillsHtml}
        </div>
      `;

      if (isPinned && pinEntry) {
        card.style.borderColor = pinEntry.color;
      }

      card.querySelector('.btn-pin-toggle').addEventListener('click', () => {
        window.tarkovAPI.togglePinItem({
          id: item.id,
          name: item.name,
          shortName: item.shortName,
          iconLink: item.iconLink
        });
      });

      card.querySelectorAll('.map-spawn-pill[data-map]').forEach((pill) => {
        pill.addEventListener('click', () => {
          const targetMap = pill.dataset.map;
          if (targetMap) {
            window.tarkovAPI.updateSettings({ selectedMap: targetMap });
          }
        });
      });

      lootResultsGrid.appendChild(card);
    }
  }

  async function fetchAndPrepareItems(forceRefresh = false) {
    apiStatusBadge.textContent = forceRefresh ? 'API Yenileniyor...' : 'Yükleniyor...';
    apiStatusBadge.className = 'pill pill-gray';

    const loadRes = await window.tarkovAPI.loadApiData({ forceRefresh });
    if (!loadRes || !loadRes.ok) {
      apiStatusBadge.textContent = 'Hata / Çevrimdışı';
      lootResultsInfo.textContent = `Veri yüklenemedi: ${loadRes?.error || 'Bilinmeyen hata'}`;
      return;
    }

    const [itemsRes, tasksRes] = await Promise.all([
      window.tarkovAPI.getItems(),
      window.tarkovAPI.getTasks()
    ]);

    if (tasksRes && tasksRes.ok) {
      allTasks = (tasksRes.tasks || []).map((t) => ({
        ...t,
        _normName: normalizeTr(t.name),
        _normTrader: normalizeTr(t.trader?.name)
      }));
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

      const timeStr = loadRes.updatedAt ? new Date(loadRes.updatedAt).toLocaleTimeString() : '';
      const modeTag = (loadRes.gameMode || currentSettings?.gameMode) === 'pve' ? 'PvE' : 'PvP';
      apiStatusBadge.textContent = `${modeTag} • ${loadRes.fromCache ? 'Önbellek' : 'Canlı API'} (${allItems.length} Eşya • ${timeStr})`;
      apiStatusBadge.className = 'pill pill-green';
      renderLootResults();
    }
  }

  // AŞAMA 5: Görevleri Harita Bazında Gruplama, Gerekli Eşyalar Özeti ve OCR Eşleştirme
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

  function renderTasksSection() {
    if (!tasksListContainer) return;
    const activeMap = (currentSettings && currentSettings.selectedMap) || 'customs';
    const activeSet = new Set((currentSettings && currentSettings.activeTaskIds) || []);
    const completedObjSet = new Set((currentSettings && currentSettings.completedObjectiveIds) || []);
    const q = normalizeTr(inputTaskSearch ? inputTaskSearch.value : '');
    const traderFilter = selectTaskTrader ? selectTaskTrader.value : 'all';
    const modeFilter = selectTaskFilter ? selectTaskFilter.value : 'map_first';

    // 1) Gerekli Eşyalar ve Anahtarlar Özeti
    const reqItemsMap = new Map();
    const activeTasksObjects = allTasks.filter((t) => activeSet.has(t.id));

    for (const t of activeTasksObjects) {
      for (const nk of t.neededKeys || []) {
        for (const k of nk.keys || []) {
          if (!reqItemsMap.has(k.id)) {
            reqItemsMap.set(k.id, { ...k, count: 1, fir: false, isKey: true, taskNames: [t.name] });
          }
        }
      }
      for (const obj of t.objectives || []) {
        if (completedObjSet.has(obj.id)) continue;
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
              isKey: false,
              taskNames: [t.name]
            });
          }
        }
      }
    }

    if (taskRequiredItemsBox) {
      const reqList = [...reqItemsMap.values()];
      if (reqList.length === 0) {
        taskRequiredItemsBox.innerHTML = `<span class="muted small">Seçili görevler için gereken eşya veya anahtar bulunmuyor. Aşağıdan görev seçin veya "Bu Haritanın Tüm Görevlerini Göster" kutusunu işaretleyin.</span>`;
      } else {
        taskRequiredItemsBox.innerHTML = '';
        for (const rItem of reqList) {
          const div = document.createElement('div');
          div.className = 'task-req-item';
          div.innerHTML = `
            <img src="${rItem.iconLink || ''}" alt="" />
            <div>
              <div><strong>${rItem.shortName || rItem.name}</strong> × ${rItem.count} ${rItem.fir ? '<span style="color:#fde68a">(FIR)</span>' : ''} ${rItem.isKey ? '<span style="color:#38bdf8">(Anahtar)</span>' : ''}</div>
              <div class="muted" style="font-size:10.5px">${rItem.taskNames.join(', ')}</div>
            </div>
          `;
          taskRequiredItemsBox.appendChild(div);
        }
      }
    }

    // 2) Görev Listesi Filtreleme & Haritaya Göre Sıralama
    let filtered = allTasks.filter((t) => {
      if (traderFilter !== 'all' && t.trader?.name !== traderFilter) return false;
      const onMap = doesTaskBelongToMap(t, activeMap);
      if (modeFilter === 'only_map' && !onMap) return false;
      if (modeFilter === 'only_active' && !activeSet.has(t.id)) return false;
      if (!q) return true;
      const inObj = (t.objectives || []).some((o) => normalizeTr(o.description).includes(q));
      return t._normName.includes(q) || t._normTrader.includes(q) || inObj;
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
      tasksCountInfo.textContent = `${filtered.length} görev (${activeSet.size} seçili)`;
    }

    const shown = filtered.slice(0, 50);
    tasksListContainer.innerHTML = '';

    for (const task of shown) {
      const isSelected = activeSet.has(task.id);
      const onCurrentMap = doesTaskBelongToMap(task, activeMap);
      const card = document.createElement('div');
      card.className = `task-card ${isSelected ? 'active-task' : ''} ${onCurrentMap ? 'current-map-task' : ''}`;

      const mapTag = task.map ? task.map.name : onCurrentMap ? activeMap.toUpperCase() : 'Herhangi / Çoklu Harita';

      const keysList = (task.neededKeys || []).flatMap((nk) => nk.keys || []);
      const keysHtml =
        keysList.length > 0
          ? `<div class="small" style="color:#93c5fd">🔑 Gereken Anahtar: ${keysList.map((k) => k.shortName || k.name).join(', ')}</div>`
          : '';

      card.innerHTML = `
        <div class="card-header-flex">
          <div>
            <div class="item-name">${task.name}</div>
            <div class="item-meta">
              <strong style="color:#d6b678">${task.trader?.name || 'Trader'}</strong> • Harita: <strong>${mapTag}</strong> • Min Sv: ${task.minPlayerLevel || 1}
            </div>
          </div>
          <button class="btn btn-sm ${isSelected ? 'btn-warning active' : 'btn-primary'} btn-task-toggle">
            ${isSelected ? '✓ Haritada Seçili' : '+ Görevi Seç (Pinle)'}
          </button>
        </div>
        ${keysHtml}
        <div class="task-obj-list"></div>
      `;

      card.querySelector('.btn-task-toggle').addEventListener('click', () => {
        window.tarkovAPI.toggleTask(task.id);
      });

      const objListEl = card.querySelector('.task-obj-list');
      for (const obj of task.objectives || []) {
        const isDone = completedObjSet.has(obj.id);
        const pos = getObjectivePositionOnMap(obj, task, activeMap);
        const row = document.createElement('div');
        row.className = `task-obj-row ${isDone ? 'completed' : ''}`;

        const firBadge = obj.foundInRaid ? `<strong style="color:#fde68a">[FIR ×${obj.count || 1}]</strong> ` : '';
        const locHtml = pos
          ? `<button class="btn btn-sm btn-secondary btn-obj-route" title="Bu hedefe rota çiz">🎯 Rota Yap (${pos.y.toFixed(0)}m)</button>`
          : `<span class="pill pill-gray" style="font-size:10px">Konum verisi yok</span>`;

        row.innerHTML = `
          <label class="checkbox-label" style="flex:1;align-items:flex-start;">
            <input type="checkbox" class="chk-obj-done" ${isDone ? 'checked' : ''} style="margin-top:3px;" />
            <span>${firBadge}${obj.description || obj.type}</span>
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
              color: '#a855f7',
              position: pos
            });
          });
        }

        objListEl.appendChild(row);
      }

      tasksListContainer.appendChild(card);
    }
  }

  // Yerel Görüntü Ön İşleme (Gri Tonlama + Kontrast) ve Tesseract.js OCR + Fuse.js Eşleştirme
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
    try {
      ocrStatusBox.textContent = 'Görüntü ön işleniyor (Gri tonlama + kontrast) ve yerel OCR çalıştırılıyor...';
      ocrMatchesList.innerHTML = '';

      const dataUrl = await preprocessImageForOCR(fileOrBlob);
      if (!window.Tesseract) {
        ocrStatusBox.textContent = 'Tesseract.js yüklenemedi.';
        return;
      }

      const result = await window.Tesseract.recognize(dataUrl, 'eng', {});
      const rawText = (result && result.data && result.data.text) || '';
      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ\s'-]/g, ' ').trim())
        .filter((l) => l.length >= 4);

      if (lines.length === 0 || !fuseTasks) {
        ocrStatusBox.textContent = 'Görüntüde görev satırı tespit edilemedi. Aşağıdaki arama kutusundan elle seçebilirsiniz.';
        return;
      }

      const matchedTaskIds = [];
      const seenTasks = new Set();

      for (const line of lines) {
        const hits = fuseTasks.search(line);
        if (hits.length > 0 && hits[0].score <= 0.45) {
          const top = hits[0];
          if (seenTasks.has(top.item.id)) continue;
          seenTasks.add(top.item.id);

          const confidence = Math.round((1 - top.score) * 100);
          if (confidence >= 60) {
            matchedTaskIds.push(top.item.id);
          }

          const row = document.createElement('div');
          row.className = 'ocr-match-row';
          row.innerHTML = `
            <div>
              <span class="muted">"${line}"</span> → <strong>${top.item.name}</strong> (${top.item.trader?.name || ''})
              <span class="pill ${confidence >= 70 ? 'pill-green' : 'pill-gray'}">%${confidence} güven</span>
            </div>
            <button class="btn btn-sm btn-primary btn-ocr-add">+ Ekle</button>
          `;
          row.querySelector('.btn-ocr-add').addEventListener('click', () => {
            window.tarkovAPI.toggleTask(top.item.id);
          });
          ocrMatchesList.appendChild(row);
        }
      }

      if (matchedTaskIds.length > 0) {
        await window.tarkovAPI.setActiveTasks(matchedTaskIds);
        ocrStatusBox.textContent = `✓ OCR tamamlandı: ${matchedTaskIds.length} görev otomatik eşleştirildi ve haritaya pinlendi!`;
      } else {
        ocrStatusBox.textContent = 'Yüksek güvenli eşleşme bulunamadı. Aşağıdaki listeden görevleri seçebilirsiniz.';
      }
    } catch (err) {
      ocrStatusBox.textContent = `OCR hatası: ${err.message || err}`;
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

    ovStatusPill.textContent = ov.visible ? 'Açık' : 'Gizli';
    ovStatusPill.className = 'pill ' + (ov.visible ? 'pill-green' : 'pill-gray');

    btnToggleEdit.textContent = `Düzenleme Modu: ${ov.editMode ? 'AÇIK' : 'Kapalı'}`;
    btnToggleEdit.classList.toggle('active', !!ov.editMode);

    selectGamemodeQuick.value = settings.gameMode || 'pve';
    setGamemode.value = settings.gameMode || 'pve';

    selectMap.value = settings.selectedMap || 'customs';
    selectMapStyle.value = settings.mapRenderStyle || 'satellite';

    const opPct = Math.round((ov.opacity || 0.9) * 100);
    rangeOpacity.value = opPct;
    lblOpacity.textContent = `%${opPct}`;

    const layers = ov.layers || {};
    if (chkShowCallouts) chkShowCallouts.checked = settings.showMapCallouts !== false;
    chkLayerLoot.checked = !!layers.loot;
    chkShowContainers.checked = !!settings.showMapContainers;
    chkShowExtracts.checked = settings.showMapExtracts !== false;
    chkLayerTasks.checked = !!layers.tasks;
    if (chkShowAllTasks) chkShowAllTasks.checked = !!settings.showAllMapTasksOnOverlay;
    if (chkShowAllTasksTab) chkShowAllTasksTab.checked = !!settings.showAllMapTasksOnOverlay;
    chkLayerPlayer.checked = !!layers.player;
    chkLayerRoute.checked = !!layers.route;
    chkFollowMode.checked = !!ov.followMode;
    if (chkHoverInteractive) chkHoverInteractive.checked = settings.hoverInteractiveMap !== false;

    setLanguage.value = settings.language || 'tr';
    setLevel.value = settings.playerLevel || 15;
    setScreenshotsDir.value = settings.screenshotsDir || '';
    setDeleteSs.checked = !!settings.deleteScreenshotsAfterRead;
    if (chkMoveTrigger) chkMoveTrigger.checked = !!settings.movePositionTrigger;
    if (chkAutoDetectLogs) chkAutoDetectLogs.checked = settings.autoDetectMapFromLogs !== false;
    chkAutoDetectMap.checked = !!settings.autoDetectMapFromCoords;
    chkAutoNearestTarget.checked = !!settings.autoNearestTarget;
    selectAutoHomeInterval.value = String(settings.autoHomeIntervalMs || 1000);

    const yOff = settings.yawOffset || 0;
    setYawOffset.value = yOff;
    lblYawOffset.textContent = `${yOff}°`;
    rangeYawOffsetQuick.value = yOff;
    lblYawOffsetQuick.textContent = `${yOff}°`;

    codeOverlayBounds.textContent = `Konum: (${ov.x ?? 'Otomatik'}, ${ov.y ?? 'Otomatik'}) | Boyut: ${ov.width}x${ov.height}px | Saydamlık: %${opPct}`;

    renderShortcutsForm(settings.shortcuts, lastShortcutStatus);
    renderPinnedItemsBar();
    renderTasksSection();

    if (prevLang && (prevLang !== settings.language || prevMode !== settings.gameMode)) {
      fetchAndPrepareItems(false);
    } else if (allItems.length > 0) {
      renderLootResults();
    }
  }

  // Olay Dinleyicileri
  inputLootSearch.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(renderLootResults, 180);
  });

  selectLootSort.addEventListener('change', renderLootResults);
  chkOnlyWithSpawns.addEventListener('change', renderLootResults);

  btnRefreshApi.addEventListener('click', () => {
    fetchAndPrepareItems(true);
  });

  btnClearPins.addEventListener('click', () => {
    window.tarkovAPI.clearPinnedItems();
  });

  btnToggleVisible.addEventListener('click', () => {
    if (!currentSettings) return;
    const nextVis = !currentSettings.overlay.visible;
    window.tarkovAPI.updateSettings({
      overlay: {
        visible: nextVis,
        editMode: nextVis ? currentSettings.overlay.editMode : false
      }
    });
  });

  btnToggleEdit.addEventListener('click', () => {
    if (!currentSettings) return;
    const nextEdit = !currentSettings.overlay.editMode;
    window.tarkovAPI.updateSettings({
      overlay: {
        visible: true,
        editMode: nextEdit
      }
    });
  });

  btnToggleAutoHome.addEventListener('click', async () => {
    const st = await window.tarkovAPI.toggleAutoHome();
    renderAutoHomeUI(st);
  });

  selectAutoHomeInterval.addEventListener('change', () => {
    window.tarkovAPI.updateSettings({
      autoHomeIntervalMs: Number(selectAutoHomeInterval.value) || 1000
    });
  });

  selectGamemodeQuick.addEventListener('change', () => {
    window.tarkovAPI.updateSettings({ gameMode: selectGamemodeQuick.value });
  });

  selectMap.addEventListener('change', () => {
    window.tarkovAPI.updateSettings({ selectedMap: selectMap.value });
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
    window.tarkovAPI.updateSettings({
      showMapCallouts: chkShowCallouts ? chkShowCallouts.checked : true,
      showMapContainers: chkShowContainers.checked,
      showMapExtracts: chkShowExtracts.checked,
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
    chkShowContainers,
    chkShowExtracts,
    chkLayerTasks,
    chkShowAllTasks,
    chkLayerPlayer,
    chkLayerRoute,
    chkFollowMode,
    chkHoverInteractive
  ]
    .filter(Boolean)
    .forEach((el) => {
      el.addEventListener('change', updateLayers);
    });

  if (chkShowAllTasksTab) {
    chkShowAllTasksTab.addEventListener('change', () => {
      if (chkShowAllTasks) chkShowAllTasks.checked = chkShowAllTasksTab.checked;
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
      clearTimeout(taskSearchDebounceTimer);
      taskSearchDebounceTimer = setTimeout(renderTasksSection, 150);
    });
  }
  if (selectTaskTrader) selectTaskTrader.addEventListener('change', renderTasksSection);
  if (selectTaskFilter) selectTaskFilter.addEventListener('change', renderTasksSection);

  if (btnClearActiveTasks) {
    btnClearActiveTasks.addEventListener('click', () => {
      window.tarkovAPI.clearActiveTasks();
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
    ocrDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      ocrDropzone.classList.add('dragover');
    });
    ocrDropzone.addEventListener('dragleave', () => {
      ocrDropzone.classList.remove('dragover');
    });
    ocrDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      ocrDropzone.classList.remove('dragover');
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
          processTaskScreenshotOCR(blob);
        }
        break;
      }
    }
  });

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
      testParseResult.className = 'parse-result-box ok small';
      testParseResult.innerHTML = `
        <strong>✓ Başarıyla Parse Edildi ve Haritada Gösterildi!</strong><br/>
        • Konum: X = <strong>${res.position.x}</strong>, Y (Yükseklik) = <strong>${res.position.y}</strong>, Z = <strong>${res.position.z}</strong><br/>
        • Hesaplanan Yön (Yaw): <strong>${res.yaw}° (${res.compass})</strong>
      `;
    } else {
      testParseResult.className = 'parse-result-box err small';
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
      testParseResult.className = 'parse-result-box err small';
      testParseResult.innerHTML = `<strong>Bilgi:</strong> ${res?.error || 'Klasörde görüntü bulunamadı.'}`;
    } else {
      testParseResult.className = 'parse-result-box ok small';
      testParseResult.innerHTML = `<strong>✓ Klasördeki son görüntü okundu:</strong> ${res.filename}`;
    }
  });

  btnClearTrail.addEventListener('click', () => {
    window.tarkovAPI.clearPlayerTrail();
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
    }
  });

  btnResetShortcuts.addEventListener('click', async () => {
    const res = await window.tarkovAPI.resetDefaultShortcuts();
    if (res && res.status) {
      lastShortcutStatus = res.status;
      applySettingsToUI(res.settings);
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

  window.tarkovAPI.onNewLog((entry) => {
    prependLogEntry(entry);
  });
})();
