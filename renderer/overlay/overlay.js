(function () {
  const rootEl = document.getElementById('overlay-root');
  const mapBadge = document.getElementById('map-badge');
  const autohomeBadge = document.getElementById('autohome-badge');
  const editBadge = document.getElementById('edit-badge');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnFit = document.getElementById('btn-fit');
  const btnLock = document.getElementById('btn-lock');
  const opacityStatus = document.getElementById('opacity-status');
  const posStatus = document.getElementById('pos-status');
  const pinnedLegend = document.getElementById('pinned-legend');
  const mapLoading = document.getElementById('map-loading');

  const compassDirEl = document.getElementById('compass-dir');
  const compassDegEl = document.getElementById('compass-deg');
  const relArrowEl = document.getElementById('rel-arrow');
  const targetSummaryEl = document.getElementById('target-summary');

  const navHud = document.getElementById('nav-hud');
  const navHudTitle = document.getElementById('nav-hud-title');
  const navHudDist = document.getElementById('nav-hud-dist');
  const navHudRel = document.getElementById('nav-hud-rel');
  const navHudElev = document.getElementById('nav-hud-elev');

  let currentSettings = null;
  let currentMapPayload = null;
  let currentPlayerState = null;

  let leafletMap = null;
  let activeBaseLayer = null;
  let calloutLayerGroup = null;
  let looseLayerGroup = null;
  let containerLayerGroup = null;
  let extractLayerGroup = null;
  let taskLayerGroup = null;
  let playerLayerGroup = null;
  let routeLayerGroup = null;
  let loadedMapKey = null;
  let loadedRenderStyle = null;
  let isMouseDraggingMap = false;

  // Fareyi Overlay üzerine götürdüğünüzde haritayı doğrudan sürükleyip yakınlaştırabilme (Hover-Interactive)
  function setupHoverInteractivity() {
    rootEl.addEventListener('mouseenter', () => {
      if (currentSettings && currentSettings.hoverInteractiveMap !== false && !currentSettings.overlay?.editMode) {
        rootEl.classList.add('hover-interactive');
        window.tarkovAPI.setHoverInteractive(true);
      }
    });

    rootEl.addEventListener('mouseleave', () => {
      if (!isMouseDraggingMap && !currentSettings?.overlay?.editMode) {
        rootEl.classList.remove('hover-interactive');
        window.tarkovAPI.setHoverInteractive(false);
      }
    });

    window.addEventListener('mouseup', () => {
      if (isMouseDraggingMap) {
        isMouseDraggingMap = false;
        if (!rootEl.matches(':hover') && !currentSettings?.overlay?.editMode) {
          rootEl.classList.remove('hover-interactive');
          window.tarkovAPI.setHoverInteractive(false);
        }
      }
    });
  }

  setupHoverInteractivity();

  function buildMapCRS(geoConfig) {
    let scaleX = 1;
    let scaleY = -1;
    let marginX = 0;
    let marginY = 0;

    if (geoConfig && Array.isArray(geoConfig.transform)) {
      scaleX = geoConfig.transform[0];
      marginX = geoConfig.transform[1];
      scaleY = geoConfig.transform[2] * -1;
      marginY = geoConfig.transform[3];
    }

    const rot = (geoConfig && geoConfig.coordinateRotation) || 180;

    return L.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(scaleX, marginX, scaleY, marginY),
      projection: L.extend({}, L.Projection.LonLat, {
        project: (latLng) => {
          const r = window.TarkovGeo.rotateLatLng(latLng.lat, latLng.lng, rot);
          return L.Projection.LonLat.project(L.latLng(r.lat, r.lng));
        },
        unproject: (point) => {
          const unp = L.Projection.LonLat.unproject(point);
          const r = window.TarkovGeo.rotateLatLng(unp.lat, unp.lng, -rot);
          return L.latLng(r.lat, r.lng);
        }
      })
    });
  }

  function ensureLeafletInitialized() {
    if (leafletMap) return;
    leafletMap = L.map('leaflet-map', {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 80
    });

    calloutLayerGroup = L.layerGroup().addTo(leafletMap);
    extractLayerGroup = L.layerGroup().addTo(leafletMap);
    containerLayerGroup = L.layerGroup().addTo(leafletMap);
    looseLayerGroup = L.layerGroup().addTo(leafletMap);
    taskLayerGroup = L.layerGroup().addTo(leafletMap);
    routeLayerGroup = L.layerGroup().addTo(leafletMap);
    playerLayerGroup = L.layerGroup().addTo(leafletMap);

    leafletMap.on('dragstart', () => {
      isMouseDraggingMap = true;
    });

    window.addEventListener('resize', () => {
      if (leafletMap) leafletMap.invalidateSize();
    });
  }

  function applyZoomDelta(delta) {
    if (!leafletMap) return;
    const center =
      currentSettings?.overlay?.followMode && currentPlayerState?.current?.position
        ? window.TarkovGeo.gamePosToLatLngArray(currentPlayerState.current.position)
        : leafletMap.getCenter();
    const nextZoom = Math.max(0.5, Math.min(6.5, leafletMap.getZoom() + delta));
    leafletMap.setView(center, nextZoom, { animate: true });
  }

  async function loadMapBaseLayer(geoConfig, renderStyle = 'satellite') {
    ensureLeafletInitialized();
    if (!geoConfig) return;

    if (loadedMapKey === geoConfig.normalizedName && loadedRenderStyle === renderStyle && activeBaseLayer) {
      return;
    }

    loadedMapKey = geoConfig.normalizedName;
    loadedRenderStyle = renderStyle;

    mapLoading.classList.remove('hidden');
    mapLoading.textContent = `${geoConfig.name} yükleniyor...`;

    if (activeBaseLayer) {
      leafletMap.removeLayer(activeBaseLayer);
      activeBaseLayer = null;
    }

    leafletMap.options.crs = buildMapCRS(geoConfig);
    const leafletBounds = L.latLngBounds(window.TarkovGeo.mapBoundsToLeafletBounds(geoConfig.bounds));
    leafletMap.setMinZoom(0.5);
    leafletMap.setMaxZoom(6.5);

    let layerCreated = false;

    if (renderStyle === 'satellite' && geoConfig.tilePath) {
      activeBaseLayer = L.tileLayer(geoConfig.tilePath, {
        tileSize: 256,
        bounds: leafletBounds,
        minZoom: 0.5,
        maxZoom: 6.5,
        maxNativeZoom: geoConfig.maxZoom || 5
      }).addTo(leafletMap);
      layerCreated = true;
    }

    if (!layerCreated && geoConfig.svgPath) {
      try {
        const res = await window.tarkovAPI.getMapSvg(geoConfig.normalizedName);
        if (res && res.ok && res.svgText) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = res.svgText.trim();
          const parsedSvg = wrapper.querySelector('svg');

          if (parsedSvg) {
            const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            if (parsedSvg.getAttribute('viewBox')) {
              svgEl.setAttribute('viewBox', parsedSvg.getAttribute('viewBox'));
            }
            svgEl.innerHTML = parsedSvg.innerHTML;

            activeBaseLayer = L.svgOverlay(svgEl, leafletBounds, {
              interactive: false
            }).addTo(leafletMap);
            layerCreated = true;
          }
        }
      } catch (_err) {}
    }

    if (!layerCreated && geoConfig.tilePath) {
      activeBaseLayer = L.tileLayer(geoConfig.tilePath, {
        tileSize: 256,
        bounds: leafletBounds,
        minZoom: 0.5,
        maxZoom: 6.5,
        maxNativeZoom: geoConfig.maxZoom || 5
      }).addTo(leafletMap);
    }

    leafletMap.invalidateSize();
    leafletMap.fitBounds(leafletBounds, { animate: false });
    mapLoading.classList.add('hidden');
  }

  /**
   * Aşama 4: Seçili hedef halkasını, oyuncudan hedefe düz rota çizgisini,
   * mesafe/göreli açı ("35° sağda", "arkanızda") ve kat farkını ("yukarıda/aşağıda") çizer.
   */
  function renderRouteAndNavigation() {
    if (!leafletMap || !routeLayerGroup) return;
    routeLayerGroup.clearLayers();

    const showRoute = currentSettings?.overlay?.layers?.route !== false;
    const target = currentPlayerState?.activeTarget;
    const cur = currentPlayerState?.current;
    const nav = currentPlayerState?.navInfo;

    if (!target || !target.position || !showRoute) {
      navHud.classList.add('hidden');
      relArrowEl.classList.add('hidden');
      targetSummaryEl.textContent = 'Hedef Yok';
      return;
    }

    const targetLatLng = window.TarkovGeo.gamePosToLatLngArray(target.position);

    // Hedef etrafında kırmızı/pembe vurgu halkası
    const ringIcon = L.divIcon({
      className: '',
      html: `<div class="target-pulse-ring"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    L.marker(targetLatLng, { icon: ringIcon, interactive: false, zIndexOffset: 1500 }).addTo(routeLayerGroup);

    if (cur && cur.position && nav) {
      const playerLatLng = window.TarkovGeo.gamePosToLatLngArray(cur.position);

      // Oyuncudan hedefe düz rota çizgisi
      L.polyline([playerLatLng, targetLatLng], {
        color: '#f43f5e',
        weight: 2.5,
        opacity: 0.9,
        dashArray: '6, 5',
        interactive: false
      }).addTo(routeLayerGroup);

      // Üst pusula çubuğu ve dönen ok
      relArrowEl.classList.remove('hidden');
      relArrowEl.style.transform = `rotate(${nav.relativeAngle}deg)`;
      targetSummaryEl.textContent = `${nav.horizontalDistance}m • ${nav.relativeText}`;

      // Sol alt Navigasyon HUD kartı
      navHud.classList.remove('hidden');
      navHudTitle.textContent = `🎯 ${target.title}`;
      navHudDist.textContent = `${nav.horizontalDistance}m`;
      navHudRel.textContent = nav.relativeText;
      navHudElev.textContent = nav.elevationText;
      navHudElev.className = `nav-elev ${nav.elevationStatus}`;
    } else {
      relArrowEl.classList.add('hidden');
      targetSummaryEl.textContent = `${target.title} (Konum bekleniyor)`;
      navHud.classList.remove('hidden');
      navHudTitle.textContent = `🎯 ${target.title}`;
      navHudDist.textContent = 'Konum bekleniyor';
      navHudRel.textContent = `(Y: ${target.position.y.toFixed(1)}m)`;
      navHudElev.textContent = '';
    }
  }

  function renderPlayerLayer() {
    if (!leafletMap || !playerLayerGroup) return;
    playerLayerGroup.clearLayers();

    const showPlayer = currentSettings?.overlay?.layers?.player !== false;
    if (!showPlayer || !currentPlayerState || !currentPlayerState.current) {
      renderRouteAndNavigation();
      return;
    }

    const cur = currentPlayerState.current;
    const trail = currentPlayerState.trail || [];
    const geoConfig = currentMapPayload?.geoConfig;

    const trailLatLngs = [];
    trail.forEach((pt, idx) => {
      const ll = window.TarkovGeo.gamePosToLatLngArray(pt);
      trailLatLngs.push(ll);
      const opacity = Math.max(0.2, ((idx + 1) / (trail.length + 1)) * 0.75);
      const size = 6 + Math.round(((idx + 1) / (trail.length + 1)) * 3);

      const dotIcon = L.divIcon({
        className: '',
        html: `<div class="player-trail-dot" style="width:${size}px;height:${size}px;opacity:${opacity};"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      L.marker(ll, { icon: dotIcon, interactive: false }).addTo(playerLayerGroup);
    });

    const curLatLng = window.TarkovGeo.gamePosToLatLngArray(cur.position);
    if (trailLatLngs.length > 0) {
      trailLatLngs.push(curLatLng);
      L.polyline(trailLatLngs, {
        color: '#38bdf8',
        weight: 1.5,
        opacity: 0.45,
        dashArray: '4, 4',
        interactive: false
      }).addTo(playerLayerGroup);
    }

    let addRotation = geoConfig ? geoConfig.coordinateRotation || 180 : 180;
    if (addRotation === 90 || addRotation === 270) {
      addRotation += 180;
    }
    const visualRotation = ((cur.yaw || 0) + addRotation) % 360;

    const arrowSvg = `
      <div class="player-marker-wrapper" style="transform: rotate(${visualRotation}deg);">
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="M12 2 L20 20 L12 16 L4 20 Z" fill="#38bdf8" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
      </div>
    `;

    const playerIcon = L.divIcon({
      className: '',
      html: arrowSvg,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const pMarker = L.marker(curLatLng, {
      icon: playerIcon,
      zIndexOffset: 2000
    });

    pMarker.bindTooltip(
      `<div>
        <strong style="color:#38bdf8">Oyuncu Konumu</strong><br/>
        <span>X: ${cur.position.x.toFixed(1)} | Y (Kat): ${cur.position.y.toFixed(1)}m | Z: ${cur.position.z.toFixed(1)}</span><br/>
        <span>Yön: ${cur.yaw}° (${cur.compass})</span>
      </div>`,
      { className: 'tarkov-tooltip', direction: 'top', offset: [0, -10] }
    );

    pMarker.addTo(playerLayerGroup);

    if (compassDirEl) compassDirEl.textContent = cur.compass || 'K';
    if (compassDegEl) compassDegEl.textContent = `${Math.round(cur.yaw || 0)}°`;

    if (currentSettings?.overlay?.followMode) {
      leafletMap.panTo(curLatLng, { animate: true });
    }

    renderRouteAndNavigation();
  }

  function getObjectiveBadgeSymbol(type) {
    if (!type) return '★';
    if (type.includes('shoot')) return '⚔';
    if (type.includes('mark')) return '📡';
    if (type.includes('Item') || type.includes('find')) return '📦';
    if (type.includes('plant')) return '📥';
    if (type.includes('visit')) return '👁';
    if (type.includes('extract')) return '🚪';
    return '★';
  }

  function renderMarkers() {
    if (!leafletMap || !currentMapPayload) return;

    calloutLayerGroup.clearLayers();
    looseLayerGroup.clearLayers();
    containerLayerGroup.clearLayers();
    extractLayerGroup.clearLayers();
    taskLayerGroup.clearLayers();

    const showLootLayer = currentSettings?.overlay?.layers?.loot !== false;
    const showTasksLayer = currentSettings?.overlay?.layers?.tasks !== false;
    const looseMarkers = currentMapPayload.looseMarkers || [];
    const containerMarkers = currentMapPayload.containerMarkers || [];
    const extracts = currentMapPayload.extracts || [];
    const callouts = currentMapPayload.callouts || [];
    const taskMarkers = currentMapPayload.taskMarkers || [];
    const showContainers = !!currentMapPayload.showMapContainers;
    const showExtracts = currentMapPayload.showMapExtracts !== false;
    const showCallouts = currentMapPayload.showMapCallouts !== false;

    // 1) Harita Konum İsimleri (Bina ve Bölge Callout Etiketleri)
    if (showCallouts) {
      for (const c of callouts) {
        const latLng = window.TarkovGeo.gamePosToLatLngArray({ x: c.x, y: c.y || 0, z: c.z });
        const labelIcon = L.divIcon({
          className: '',
          html: `<div class="callout-label" style="cursor:pointer;" title="Tıklayınca rota hedefi yapar">${c.name}</div>`,
          iconSize: [0, 0],
          iconAnchor: [35, 8]
        });

        const cMarker = L.marker(latLng, { icon: labelIcon, zIndexOffset: 200 });
        cMarker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: `callout_${c.name}`,
            title: c.name,
            subtitle: 'Bölge / Konum',
            category: 'callout',
            color: '#fde68a',
            position: { x: c.x, y: c.y || 0, z: c.z }
          });
        });
        cMarker.addTo(calloutLayerGroup);
      }
    }

    if (showLootLayer) {
      for (const m of looseMarkers) {
        const latLng = window.TarkovGeo.gamePosToLatLngArray(m.position);
        const icon = L.divIcon({
          className: '',
          html: `<div class="loot-pin-circle" style="width:11px;height:11px;background:${m.color};cursor:pointer;"></div>`,
          iconSize: [11, 11],
          iconAnchor: [5.5, 5.5]
        });

        const marker = L.marker(latLng, { icon });
        const priceStr = m.bestPrice ? `${m.bestPrice.toLocaleString('tr-TR')} ₽` : 'Veri yok';
        const slotStr = m.pricePerSlot ? `${m.pricePerSlot.toLocaleString('tr-TR')} ₽/slot` : '-';

        marker.bindTooltip(
          `<div>
            <strong style="color:${m.color}">${m.itemName}</strong> (${m.shortName})<br/>
            <span>En İyi Fiyat: ${priceStr} (${m.bestSource})</span><br/>
            <span>Slot Başı: ${slotStr} | Kat (Y): ${m.position.y.toFixed(1)}m</span><br/>
            <em style="color:#fcd34d">Tıklayınca rota hedefi yapar</em>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -6] }
        );

        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: m.id,
            title: `${m.shortName || m.itemName}`,
            subtitle: `Eşya Spawn (${priceStr})`,
            category: 'loot',
            color: m.color,
            position: m.position
          });
        });

        marker.addTo(looseLayerGroup);
      }

      if (showContainers) {
        containerMarkers.forEach((c, idx) => {
          if (!c.position) return;
          const latLng = window.TarkovGeo.gamePosToLatLngArray(c.position);
          const icon = L.divIcon({
            className: '',
            html: `<div class="container-pin-square" style="cursor:pointer;"></div>`,
            iconSize: [9, 9],
            iconAnchor: [4.5, 4.5]
          });

          const marker = L.marker(latLng, { icon });
          const cName = c.lootContainer?.name || 'Container';
          marker.bindTooltip(
            `<div>
              <strong style="color:#fbbf24">${cName}</strong><br/>
              <span>Yükseklik (Y): ${c.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca rota hedefi yapar</em>
            </div>`,
            { className: 'tarkov-tooltip', direction: 'top', offset: [0, -5] }
          );

          marker.on('click', () => {
            window.tarkovAPI.setTarget({
              id: `cont_${idx}`,
              title: cName,
              subtitle: 'Konteyner',
              category: 'container',
              color: '#f59e0b',
              position: c.position
            });
          });

          marker.addTo(containerLayerGroup);
        });
      }
    }

    // Çıkış (Extract) Noktaları + İsim Etiketleri
    if (showExtracts) {
      for (const ex of extracts) {
        if (!ex.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(ex.position);
        const labelHtml = showCallouts
          ? `<div style="display:flex;align-items:center;gap:4px;"><div class="extract-pin-diamond" style="cursor:pointer;flex-shrink:0;"></div><span class="extract-label">${ex.name}</span></div>`
          : `<div class="extract-pin-diamond" style="cursor:pointer;"></div>`;

        const icon = L.divIcon({
          className: '',
          html: labelHtml,
          iconSize: [10, 10],
          iconAnchor: [5, 5]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 400 });
        marker.bindTooltip(
          `<div>
            <strong style="color:#10b981">Çıkış: ${ex.name}</strong> (${(ex.faction || 'all').toUpperCase()})<br/>
            <span>Yükseklik (Y): ${ex.position.y.toFixed(1)}m</span><br/>
            <em style="color:#fcd34d">Tıklayınca rota hedefi yapar</em>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -6] }
        );

        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: `extract_${ex.id}`,
            title: `Çıkış: ${ex.name}`,
            subtitle: `Extract (${(ex.faction || 'all').toUpperCase()})`,
            category: 'extract',
            color: '#10b981',
            position: ex.position
          });
        });

        marker.addTo(extractLayerGroup);
      }
    }

    // AŞAMA 5: Görev Hedefi Pinleri
    if (showTasksLayer && taskMarkers.length > 0) {
      for (const tm of taskMarkers) {
        if (!tm.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(tm.position);
        const sym = getObjectiveBadgeSymbol(tm.objectiveType);
        const cls = tm.isSelectedTask ? 'task-pin-marker' : 'task-pin-marker unselected-task';

        const icon = L.divIcon({
          className: '',
          html: `<div class="${cls}" title="${tm.taskName}">${sym}</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 900 });
        marker.bindTooltip(
          `<div>
            <strong style="color:#c084fc">[${tm.traderName}] ${tm.taskName}</strong><br/>
            <span>${tm.description || ''}</span><br/>
            ${tm.questItemName ? `<span style="color:#fde68a">Görev Eşyası: ${tm.questItemName}</span><br/>` : ''}
            <span>Yükseklik (Y): ${tm.position.y.toFixed(1)}m</span><br/>
            <em style="color:#fcd34d">Tıklayınca rota hedefi yapar</em>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -9] }
        );

        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: tm.id,
            title: `Görev: ${tm.taskName}`,
            subtitle: tm.description || tm.traderName,
            category: 'task',
            color: tm.isSelectedTask ? '#a855f7' : '#d97706',
            position: tm.position
          });
        });

        marker.addTo(taskLayerGroup);
      }
    }

    renderLegend(
      currentMapPayload.pinnedItems || [],
      looseMarkers,
      showContainers,
      containerMarkers.length,
      showTasksLayer ? taskMarkers.length : 0
    );
    renderPlayerLayer();
  }

  function renderLegend(pinnedItems, looseMarkers, showContainers, containerCount, taskMarkerCount = 0) {
    if ((!pinnedItems || pinnedItems.length === 0) && !showContainers && taskMarkerCount === 0) {
      pinnedLegend.classList.add('hidden');
      pinnedLegend.innerHTML = '';
      return;
    }

    pinnedLegend.classList.remove('hidden');
    pinnedLegend.innerHTML = '';

    for (const item of pinnedItems) {
      const countOnMap = looseMarkers.filter((m) => m.itemId === item.id).length;
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `<span class="legend-dot" style="background:${item.color}"></span><span>${item.shortName || item.name}: <strong>${countOnMap}</strong></span>`;
      pinnedLegend.appendChild(row);
    }

    if (taskMarkerCount > 0) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `<span class="legend-dot" style="background:#a855f7"></span><span>Görev Hedefi: <strong>${taskMarkerCount}</strong></span>`;
      pinnedLegend.appendChild(row);
    }

    if (showContainers) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `<span class="legend-sq"></span><span>Konteyner: <strong>${containerCount}</strong></span>`;
      pinnedLegend.appendChild(row);
    }
  }

  function renderSettings(settings) {
    if (!settings || !settings.overlay) return;
    currentSettings = settings;
    const ov = settings.overlay;

    mapBadge.textContent = (settings.selectedMap || 'customs').toUpperCase();

    if (ov.editMode) {
      rootEl.classList.add('edit-mode');
      editBadge.classList.remove('hidden');
      btnZoomIn.classList.remove('hidden');
      btnZoomOut.classList.remove('hidden');
      btnFit.classList.remove('hidden');
      btnLock.classList.remove('hidden');
    } else {
      rootEl.classList.remove('edit-mode');
      editBadge.classList.add('hidden');
      btnZoomIn.classList.add('hidden');
      btnZoomOut.classList.add('hidden');
      btnFit.classList.add('hidden');
      btnLock.classList.add('hidden');
    }

    const modeLabel = settings.gameMode === 'pve' ? 'PvE' : 'PvP';
    opacityStatus.textContent = `${modeLabel} • %${Math.round((ov.opacity || 0.9) * 100)}`;
    renderMarkers();
  }

  function renderAutoHomeState(st) {
    if (!st) return;
    if (st.active) {
      autohomeBadge.textContent = `OTO-HOME: AÇIK (${(st.intervalMs / 1000).toFixed(0)}sn)`;
      autohomeBadge.className = 'badge autohome-on';
    } else {
      autohomeBadge.textContent = 'OTO-HOME: KAPALI (Alt+H)';
      autohomeBadge.className = 'badge autohome-off';
    }
  }

  function updatePositionTimerText() {
    if (!currentPlayerState || !currentPlayerState.current) {
      posStatus.textContent = 'Konum: Home (Alt+H) bekleniyor';
      return;
    }
    const cur = currentPlayerState.current;
    const diffSec = Math.max(0, Math.floor((Date.now() - (cur.timestamp || Date.now())) / 1000));
    posStatus.textContent = `X:${cur.position.x.toFixed(0)} Z:${cur.position.z.toFixed(0)} Y:${cur.position.y.toFixed(1)}m (${diffSec}sn önce)`;
  }

  setInterval(updatePositionTimerText, 1000);

  btnLock.addEventListener('click', () => {
    window.tarkovAPI.updateSettings({
      overlay: { editMode: false }
    });
  });

  btnZoomIn.addEventListener('click', () => applyZoomDelta(0.6));
  btnZoomOut.addEventListener('click', () => applyZoomDelta(-0.6));

  btnFit.addEventListener('click', () => {
    if (leafletMap && currentMapPayload && currentMapPayload.geoConfig) {
      const b = L.latLngBounds(window.TarkovGeo.mapBoundsToLeafletBounds(currentMapPayload.geoConfig.bounds));
      leafletMap.fitBounds(b, { animate: true });
    }
  });

  window.tarkovAPI.getSettings().then((res) => {
    if (res && res.settings) {
      renderSettings(res.settings);
    }
  });

  window.tarkovAPI.getAutoHomeState().then(renderAutoHomeState);

  window.tarkovAPI.getOverlayMapPayload().then(async (res) => {
    if (res && res.ok && res.payload) {
      currentMapPayload = res.payload;
      await loadMapBaseLayer(res.payload.geoConfig, res.payload.mapRenderStyle || 'satellite');
      renderMarkers();
    }
  });

  window.tarkovAPI.getPlayerState().then((st) => {
    if (st) {
      currentPlayerState = st;
      renderPlayerLayer();
      updatePositionTimerText();
    }
  });

  window.tarkovAPI.onSettingsUpdated((settings) => {
    renderSettings(settings);
  });

  window.tarkovAPI.onAutoHomeUpdated(renderAutoHomeState);

  window.tarkovAPI.onMapDataUpdated(async (payload) => {
    currentMapPayload = payload;
    await loadMapBaseLayer(payload.geoConfig, payload.mapRenderStyle || 'satellite');
    renderMarkers();
  });

  window.tarkovAPI.onPlayerUpdated((playerState) => {
    currentPlayerState = playerState;
    renderPlayerLayer();
    updatePositionTimerText();
  });

  window.tarkovAPI.onShortcutAction((action) => {
    if (action === 'zoomIn') {
      applyZoomDelta(0.6);
    } else if (action === 'zoomOut') {
      applyZoomDelta(-0.6);
    }
  });
})();
