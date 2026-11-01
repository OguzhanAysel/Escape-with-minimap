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
  let activeFloorTileLayer = null;
  let activeFloorName = null;
  let activeSvgElement = null;
  let calloutLayerGroup = null;
  let spawnLayerGroup = null;
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
    spawnLayerGroup = L.layerGroup().addTo(leafletMap);
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
    if (activeFloorTileLayer) {
      leafletMap.removeLayer(activeFloorTileLayer);
      activeFloorTileLayer = null;
    }
    activeFloorName = null;
    activeSvgElement = null;

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
            activeSvgElement = svgEl;

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
      const waypoints =
        Array.isArray(nav.waypoints) && nav.waypoints.length >= 2
          ? nav.waypoints
          : window.TarkovGeo.computeSafeRouteWaypoints(
              cur.position,
              target.position,
              currentMapPayload?.hazards || [],
              currentMapPayload?.mapNormalizedName || ''
            );

      const routeLatLngs = waypoints.map((pt) => window.TarkovGeo.gamePosToLatLngArray(pt));

      // Oyuncudan hedefe mayın ve engellerin etrafından dolaşan güvenli rota çizgisi
      L.polyline(routeLatLngs, {
        color: '#f43f5e',
        weight: 2.8,
        opacity: 0.92,
        dashArray: '7, 5',
        interactive: false
      }).addTo(routeLayerGroup);

      // Ara dönüş noktalarına küçük yön düğümleri koy
      if (routeLatLngs.length > 2) {
        for (let i = 1; i < routeLatLngs.length - 1; i++) {
          const wpIcon = L.divIcon({
            className: '',
            html: `<div style="width:7px;height:7px;border-radius:50%;background:#fbbf24;border:1.5px solid #111;"></div>`,
            iconSize: [7, 7],
            iconAnchor: [3.5, 3.5]
          });
          L.marker(routeLatLngs[i], { icon: wpIcon, interactive: false }).addTo(routeLayerGroup);
        }
      }

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

  /**
   * Oyuncunun 3B yüksekliğine (Y) ve bina sınırına göre otomatik kat katmanı değiştirir
   * (Örn: Dorms 2. Kat / 3. Kat, Reserve D-2 Bunkers, Factory Tunnels / 3. Kat Ofis, Labs 2. Kat vb.)
   */
  function updateDynamicFloorLayer(geoConfig, playerPos) {
    if (!leafletMap || !geoConfig) return;
    const detectedFloor = playerPos ? window.TarkovGeo.detectActiveFloorLayer(geoConfig, playerPos) : null;
    const nextFloorName = detectedFloor ? detectedFloor.name : null;

    const baseMapTitle = (currentSettings?.selectedMap || geoConfig.normalizedName || 'customs').toUpperCase();
    mapBadge.textContent = nextFloorName ? `${baseMapTitle} • ${nextFloorName.toUpperCase()}` : baseMapTitle;

    if (nextFloorName === activeFloorName) return;
    activeFloorName = nextFloorName;

    if (activeFloorTileLayer) {
      leafletMap.removeLayer(activeFloorTileLayer);
      activeFloorTileLayer = null;
    }

    const leafletBounds = L.latLngBounds(window.TarkovGeo.mapBoundsToLeafletBounds(geoConfig.bounds));

    // Uydu / Tile haritası katmanı varsa üst katman olarak bindir
    if (detectedFloor && detectedFloor.tilePath && loadedRenderStyle === 'satellite') {
      activeFloorTileLayer = L.tileLayer(detectedFloor.tilePath, {
        tileSize: 256,
        bounds: leafletBounds,
        minZoom: 0.5,
        maxZoom: 6.5,
        maxNativeZoom: geoConfig.maxZoom || 5,
        zIndex: 5
      }).addTo(leafletMap);
    }

    // SVG haritası katmanı varsa ilgili kat grubunu (<g id="Second_Floor"> vb.) öne çıkar
    if (activeSvgElement && Array.isArray(geoConfig.layers)) {
      for (const lyr of geoConfig.layers) {
        if (!lyr.svgLayer) continue;
        const gEl = activeSvgElement.querySelector(`#${lyr.svgLayer}`);
        if (gEl) {
          if (detectedFloor && detectedFloor.svgLayer === lyr.svgLayer) {
            gEl.style.display = 'inline';
            gEl.style.opacity = '1';
          } else {
            gEl.style.opacity = '0.18';
          }
        }
      }
    }
  }

  function renderPlayerLayer() {
    if (!leafletMap || !playerLayerGroup) return;
    playerLayerGroup.clearLayers();

    const geoConfig = currentMapPayload?.geoConfig;
    const showPlayer = currentSettings?.overlay?.layers?.player !== false;
    if (!showPlayer || !currentPlayerState || !currentPlayerState.current) {
      updateDynamicFloorLayer(geoConfig, null);
      renderRouteAndNavigation();
      return;
    }

    const cur = currentPlayerState.current;
    const trail = currentPlayerState.trail || [];
    updateDynamicFloorLayer(geoConfig, cur.position);

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

  function buildNaturalOrganicContour(outlinePoints, seedIdx = 0) {
    if (!Array.isArray(outlinePoints) || outlinePoints.length < 3) return [];
    let cx = 0;
    let cz = 0;
    for (const p of outlinePoints) {
      cx += p.x;
      cz += p.z;
    }
    cx /= outlinePoints.length;
    cz /= outlinePoints.length;

    // 1) Dikdörtgen köşelerin arasına dışbükey kavisli orta noktalar ve doğal arazi dalgalanması ekle
    const enriched = [];
    const n = outlinePoints.length;
    for (let i = 0; i < n; i++) {
      const p1 = outlinePoints[i];
      const p2 = outlinePoints[(i + 1) % n];
      // Köşeyi merkeze doğru hafif yuvarla
      enriched.push({
        x: p1.x * 0.88 + cx * 0.12,
        y: p1.y || 0,
        z: p1.z * 0.88 + cz * 0.12
      });
      // Kenar ortasını dışa doğru doğal bombe ile şişir
      const mx = (p1.x + p2.x) * 0.5;
      const mz = (p1.z + p2.z) * 0.5;
      const vx = mx - cx;
      const vz = mz - cz;
      const wave = 1.08 + 0.06 * Math.sin(seedIdx * 1.7 + i * 2.3);
      enriched.push({
        x: cx + vx * wave,
        y: p1.y || 0,
        z: cz + vz * wave
      });
    }

    // 2) 3 aşamalı Chaikin Corner-Cutting ile tamamen pürüzsüz organik eğriye dönüştür
    let pts = enriched;
    for (let iter = 0; iter < 3; iter++) {
      const next = [];
      const len = pts.length;
      for (let i = 0; i < len; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % len];
        next.push({
          x: 0.75 * a.x + 0.25 * b.x,
          y: a.y || 0,
          z: 0.75 * a.z + 0.25 * b.z
        });
        next.push({
          x: 0.25 * a.x + 0.75 * b.x,
          y: a.y || 0,
          z: 0.25 * a.z + 0.75 * b.z
        });
      }
      pts = next;
    }
    return pts;
  }

  function renderMarkers() {
    if (!leafletMap || !currentMapPayload) return;

    calloutLayerGroup.clearLayers();
    if (spawnLayerGroup) spawnLayerGroup.clearLayers();
    looseLayerGroup.clearLayers();
    containerLayerGroup.clearLayers();
    extractLayerGroup.clearLayers();
    taskLayerGroup.clearLayers();

    const showLootLayer = currentSettings?.overlay?.layers?.loot !== false;
    const showTasksLayer = currentSettings?.overlay?.layers?.tasks !== false;
    const looseMarkers = currentMapPayload.looseMarkers || [];
    const valuableMarkers = currentMapPayload.valuableMarkers || [];
    const containerMarkers = currentMapPayload.containerMarkers || [];
    const pmcSpawns = currentMapPayload.pmcSpawns || [];
    const scavSpawns = currentMapPayload.scavSpawns || [];
    const hazards = currentMapPayload.hazards || [];
    const locks = currentMapPayload.locks || [];
    const switches = currentMapPayload.switches || [];
    const stationaryWeapons = currentMapPayload.stationaryWeapons || [];
    const btrStops = currentMapPayload.btrStops || [];
    const transits = currentMapPayload.transits || [];
    const extracts = currentMapPayload.extracts || [];
    const callouts = currentMapPayload.callouts || [];
    const taskMarkers = currentMapPayload.taskMarkers || [];
    const showContainers = !!currentMapPayload.showMapContainers;
    const enabledCatSet = new Set(currentMapPayload.enabledContainerCategories || []);
    const showPmcSpawns = !!currentMapPayload.showPmcSpawns;
    const showScavSpawns = !!currentMapPayload.showScavSpawns;
    const showValuableSpawns = !!currentMapPayload.showValuableSpawns;
    const showMapLocks = !!currentMapPayload.showMapLocks;
    const showMapHazards = currentMapPayload.showMapHazards !== false;
    const showMapUtilities = !!currentMapPayload.showMapUtilities;
    const showExtracts = currentMapPayload.showMapExtracts !== false;
    const showCallouts = currentMapPayload.showMapCallouts !== false;

    // 0) Mayın Tarlaları & Sniper Sınır Bölgeleri (Doğal Organik Konturlu Çizim)
    if (showMapHazards && spawnLayerGroup) {
      const placedHazardIcons = [];
      hazards.forEach((hz, hzIdx) => {
        const isMine = (hz.hazardType || '').includes('mine');
        const polyColor = isMine ? '#ef4444' : '#f97316';
        if (Array.isArray(hz.outline) && hz.outline.length >= 3) {
          const organicWorldPts = buildNaturalOrganicContour(hz.outline, hzIdx);
          const latLngs = organicWorldPts.map((pt) => window.TarkovGeo.gamePosToLatLngArray(pt));
          const poly = L.polygon(latLngs, {
            color: polyColor,
            weight: 1.6,
            opacity: 0.72,
            dashArray: '6, 5',
            lineJoin: 'round',
            lineCap: 'round',
            fillColor: polyColor,
            fillOpacity: 0.14,
            interactive: true
          });
          poly.bindTooltip(
            `<div>
              <strong style="color:${polyColor}">⚠ ${isMine ? 'Mayınlı Arazi Bölgesi' : 'Sniper Ateş Bölgesi'}</strong><br/>
              <span>Rota sistemi bu bölgenin etrafından güvenli dolaşır</span>
            </div>`,
            { className: 'tarkov-tooltip', sticky: true }
          );
          poly.addTo(spawnLayerGroup);
        }
        if (hz.position) {
          // Aynı bölgede üst üste binen kuru kafa ikonlarını 45m yarıçapında tekleştir
          const tooClose = placedHazardIcons.some(
            (p) => Math.hypot(p.x - hz.position.x, p.z - hz.position.z) < 45
          );
          if (!tooClose) {
            placedHazardIcons.push(hz.position);
            const hzLatLng = window.TarkovGeo.gamePosToLatLngArray(hz.position);
            const hzIconFile = hz.hazardType === 'mortar' ? 'hazard_mortar.png' : 'hazard.png';
            const hzIcon = L.divIcon({
              className: '',
              html: `<img src="../../assets/map-icons/${hzIconFile}" style="width:16px;height:16px;opacity:0.9;filter:drop-shadow(0 0 3px #000);" alt="" />`,
              iconSize: [16, 16],
              iconAnchor: [8, 8]
            });
            const hzMarker = L.marker(hzLatLng, { icon: hzIcon, interactive: false });
            hzMarker.addTo(spawnLayerGroup);
          }
        }
      });
    }

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
      // 2A) Kullanıcının Sabitlediği Eşyalar (Mini Eşya İkonu + Görsel Tooltip)
      for (const m of looseMarkers) {
        const latLng = window.TarkovGeo.gamePosToLatLngArray(m.position);
        const pinImgSrc = m.iconLink || '../../assets/map-icons/loose_loot.png';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:22px;height:22px;border-radius:5px;background:rgba(12,14,18,0.92);border:2px solid ${m.color};display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 6px rgba(0,0,0,0.85);">
            <img src="${pinImgSrc}" style="width:18px;height:18px;object-fit:contain;" alt="" />
          </div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 750 });
        const priceStr = m.bestPrice ? `${m.bestPrice.toLocaleString('tr-TR')} ₽` : 'Veri yok';
        const slotStr = m.pricePerSlot ? `${m.pricePerSlot.toLocaleString('tr-TR')} ₽/slot` : '-';
        const previewImg = m.baseImageLink || m.iconLink || '../../assets/map-icons/loose_loot.png';

        marker.bindTooltip(
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${previewImg}" style="width:46px;height:46px;object-fit:contain;background:#0c0e12;border:1px solid ${m.color};border-radius:4px;" alt="" />
            <div>
              <strong style="color:${m.color}">${m.itemName}</strong> (${m.shortName})<br/>
              <span>En İyi Fiyat: <strong>${priceStr}</strong> (${m.bestSource})</span><br/>
              <span>Slot Başı: ${slotStr} | Kat (Y): ${m.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -10] }
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
    }

    // 2B) Değerli Eşya Tahmini Spawnları (Sabitlenen Eşya Pinlerinden BAĞIMSIZ çalışır)
    if (showValuableSpawns) {
      for (const v of valuableMarkers) {
        if (!v.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(v.position);
        const pinImgSrc = v.iconLink || '../../assets/map-icons/valuable_bitcoin.webp';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:22px;height:22px;border-radius:50%;background:rgba(12,14,18,0.92);border:2px solid ${v.highlightColor};display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 7px ${v.highlightColor};">
            <img src="${pinImgSrc}" style="width:16px;height:16px;object-fit:contain;" alt="" />
          </div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 700 });
        const priceStr = v.bestPrice ? `${v.bestPrice.toLocaleString('tr-TR')} ₽` : '-';
        const previewImg = v.baseImageLink || v.iconLink || '../../assets/map-icons/valuable_bitcoin.webp';

        marker.bindTooltip(
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${previewImg}" style="width:48px;height:48px;object-fit:contain;background:#0c0e12;border:1px solid ${v.highlightColor};border-radius:4px;" alt="" />
            <div>
              <strong style="color:${v.highlightColor}">💎 ${v.itemName} (${v.shortName})</strong><br/>
              <span>Değer: <strong>${priceStr}</strong> (${v.bestSource})</span><br/>
              ${v.otherNames ? `<span style="color:#cbd5e1">Olası Havuz: ${v.otherNames}</span><br/>` : ''}
              <span>Kat (Y): ${v.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -10] }
        );

        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: v.id,
            title: `💎 ${v.shortName || v.itemName}`,
            subtitle: `Değerli Eşya (${priceStr})`,
            category: 'loot',
            color: v.highlightColor,
            position: v.position
          });
        });

        marker.addTo(looseLayerGroup);
      }
    }

    // 2C) Kategori Kategori Loot Kutuları (Sabitlenen Eşya Pinlerinden BAĞIMSIZ çalışır)
    if (enabledCatSet.size > 0) {
      containerMarkers.forEach((c, idx) => {
        if (!c.position) return;
        if (!enabledCatSet.has(c.categoryKey)) return;

        const latLng = window.TarkovGeo.gamePosToLatLngArray(c.position);
        const pinColor = c.color || '#f59e0b';
        const iconSrc = `../../assets/map-icons/${c.iconFile || 'container_crate.png'}`;
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:20px;height:20px;border-radius:4px;background:rgba(12,14,18,0.88);border:1.5px solid ${pinColor};display:flex;align-items:center;justify-content:center;cursor:pointer;">
            <img src="${iconSrc}" style="width:15px;height:15px;object-fit:contain;" alt="" />
          </div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 350 });
        const cName = c.lootContainer?.name || 'Konteyner';
        const catLabel = c.categoryLabel || 'Loot Kutusu';
        marker.bindTooltip(
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${iconSrc}" style="width:36px;height:36px;object-fit:contain;background:#0c0e12;border:1px solid ${pinColor};border-radius:4px;padding:3px;" alt="" />
            <div>
              <strong style="color:${pinColor}">${cName}</strong><br/>
              <span>Kategori: ${catLabel}</span><br/>
              <span>Yükseklik (Y): ${c.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -8] }
        );

        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: `cont_${idx}`,
            title: cName,
            subtitle: catLabel,
            category: 'container',
            color: pinColor,
            position: c.position
          });
        });

        marker.addTo(containerLayerGroup);
      });
    }

    // 3) Kilitli Kapılar & Gereken Anahtarlar (Locks)
    if (showMapLocks && spawnLayerGroup) {
      locks.forEach((lk, idx) => {
        if (!lk.position) return;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(lk.position);
        const keyImg = lk.key?.iconLink || '../../assets/map-icons/lock.png';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:20px;height:20px;border-radius:4px;background:rgba(12,14,18,0.9);border:1.5px solid #93c5fd;display:flex;align-items:center;justify-content:center;cursor:pointer;">
            <img src="../../assets/map-icons/lock.png" style="width:14px;height:14px;object-fit:contain;" alt="" />
          </div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        const marker = L.marker(latLng, { icon, zIndexOffset: 380 });
        const keyTitle = lk.key ? `${lk.key.name} (${lk.key.shortName || ''})` : 'Kilitli Kapı';
        marker.bindTooltip(
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${keyImg}" style="width:42px;height:42px;object-fit:contain;background:#0c0e12;border:1px solid #93c5fd;border-radius:4px;" alt="" />
            <div>
              <strong style="color:#93c5fd">🔑 ${keyTitle}</strong><br/>
              ${lk.needsPower ? `<span style="color:#fde68a">⚡ Önce Elektrik Şalteri Açılmalı</span><br/>` : ''}
              <span>Yükseklik (Y): ${lk.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -8] }
        );
        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: `lock_${idx}`,
            title: `🔑 ${lk.key?.shortName || keyTitle}`,
            subtitle: keyTitle,
            category: 'lock',
            color: '#93c5fd',
            position: lk.position
          });
        });
        marker.addTo(spawnLayerGroup);
      });
    }

    // 4) BTR Durakları, Elektrik Şalterleri, Sabit Silahlar & Harita Geçişleri (Transits)
    if (showMapUtilities && spawnLayerGroup) {
      for (const bs of btrStops) {
        if (!bs.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(bs.position);
        const icon = L.divIcon({
          className: '',
          html: `<img src="../../assets/map-icons/btr_stop.png" style="width:20px;height:20px;cursor:pointer;filter:drop-shadow(0 0 3px #000);" alt="" />`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        const marker = L.marker(latLng, { icon, zIndexOffset: 420 });
        marker.bindTooltip(`<div><strong style="color:#fde68a">🛡 BTR Durağı: ${bs.name}</strong></div>`, {
          className: 'tarkov-tooltip',
          direction: 'top'
        });
        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: bs.id,
            title: `BTR: ${bs.name}`,
            subtitle: 'BTR Durağı',
            category: 'utility',
            color: '#fde68a',
            position: bs.position
          });
        });
        marker.addTo(spawnLayerGroup);
      }

      for (const sw of switches) {
        if (!sw.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(sw.position);
        const icon = L.divIcon({
          className: '',
          html: `<img src="../../assets/map-icons/switch.png" style="width:18px;height:18px;cursor:pointer;filter:drop-shadow(0 0 3px #000);" alt="" />`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        const marker = L.marker(latLng, { icon, zIndexOffset: 410 });
        marker.bindTooltip(
          `<div><strong style="color:#fbbf24">⚡ Şalter / Güç Kolu</strong><br/><span>${sw.name} (Y: ${sw.position.y.toFixed(1)}m)</span></div>`,
          { className: 'tarkov-tooltip', direction: 'top' }
        );
        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: sw.id,
            title: `⚡ ${sw.name}`,
            subtitle: 'Şalter / Güç Kolu',
            category: 'utility',
            color: '#fbbf24',
            position: sw.position
          });
        });
        marker.addTo(spawnLayerGroup);
      }

      for (const stw of stationaryWeapons) {
        if (!stw.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(stw.position);
        const icon = L.divIcon({
          className: '',
          html: `<img src="../../assets/map-icons/stationarygun.png" style="width:18px;height:18px;cursor:pointer;filter:drop-shadow(0 0 3px #000);" alt="" />`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        const marker = L.marker(latLng, { icon, zIndexOffset: 390 });
        marker.bindTooltip(`<div><strong style="color:#f87171">Sabit Ağır Silah (AGS / NSV)</strong></div>`, {
          className: 'tarkov-tooltip',
          direction: 'top'
        });
        marker.addTo(spawnLayerGroup);
      }

      for (const tr of transits) {
        if (!tr.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(tr.position);
        const icon = L.divIcon({
          className: '',
          html: `<img src="../../assets/map-icons/extract_transit.png" style="width:20px;height:20px;cursor:pointer;filter:drop-shadow(0 0 3px #000);" alt="" />`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        const marker = L.marker(latLng, { icon, zIndexOffset: 430 });
        marker.bindTooltip(`<div><strong style="color:#fb923c">Harita Geçişi (Transit): ${tr.description || ''}</strong></div>`, {
          className: 'tarkov-tooltip',
          direction: 'top'
        });
        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: tr.id,
            title: `Transit: ${tr.description || 'Geçiş'}`,
            subtitle: 'Haritalar Arası Geçiş',
            category: 'extract',
            color: '#fb923c',
            position: tr.position
          });
        });
        marker.addTo(spawnLayerGroup);
      }
    }

    // 5) PMC ve Scav / Boss Doğma Noktaları (Resmi tarkov.dev İkonlarıyla)
    if (showPmcSpawns && spawnLayerGroup) {
      for (const sp of pmcSpawns) {
        if (!sp.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(sp.position);
        const iconSrc = `../../assets/map-icons/${sp.iconFile || 'spawn_pmc.png'}`;
        const icon = L.divIcon({
          className: '',
          html: `<img src="${iconSrc}" style="width:20px;height:20px;cursor:pointer;filter:drop-shadow(0 0 3px #000);" alt="" />`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        const marker = L.marker(latLng, { icon, zIndexOffset: 300 });
        marker.bindTooltip(
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${iconSrc}" style="width:28px;height:28px;object-fit:contain;" alt="" />
            <div>
              <strong style="color:#60a5fa">PMC Doğma Noktası</strong><br/>
              <span>Yükseklik (Y): ${sp.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -8] }
        );
        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: sp.id,
            title: 'PMC Doğma Noktası',
            subtitle: 'PMC Spawn',
            category: 'spawn',
            color: '#3b82f6',
            position: sp.position
          });
        });
        marker.addTo(spawnLayerGroup);
      }
    }

    if (showScavSpawns && spawnLayerGroup) {
      for (const sp of scavSpawns) {
        if (!sp.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(sp.position);
        const iconSrc = `../../assets/map-icons/${sp.iconFile || 'spawn_scav.png'}`;
        const icon = L.divIcon({
          className: '',
          html: `<img src="${iconSrc}" style="width:20px;height:20px;cursor:pointer;filter:drop-shadow(0 0 3px #000);" alt="" />`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        const marker = L.marker(latLng, { icon, zIndexOffset: 280 });
        marker.bindTooltip(
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${iconSrc}" style="width:28px;height:28px;object-fit:contain;" alt="" />
            <div>
              <strong style="color:${sp.color}">${sp.title}</strong><br/>
              <span>Yükseklik (Y): ${sp.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -8] }
        );
        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: sp.id,
            title: sp.title,
            subtitle: 'Scav / Boss Spawn',
            category: 'spawn',
            color: sp.color,
            position: sp.position
          });
        });
        marker.addTo(spawnLayerGroup);
      }
    }

    // 6) Çıkış (Extract) Noktaları (Resmi tarkov.dev extract_pmc / extract_scav / extract_shared İkonlarıyla)
    if (showExtracts) {
      for (const ex of extracts) {
        if (!ex.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(ex.position);
        const fac = (ex.faction || 'all').toLowerCase();
        const extIconFile = fac === 'pmc' ? 'extract_pmc.png' : fac === 'scav' ? 'extract_scav.png' : 'extract_shared.png';
        const extIconSrc = `../../assets/map-icons/${extIconFile}`;

        const labelHtml = showCallouts
          ? `<div style="display:flex;align-items:center;gap:4px;cursor:pointer;"><img src="${extIconSrc}" style="width:18px;height:18px;flex-shrink:0;filter:drop-shadow(0 0 2px #000);" alt="" /><span class="extract-label">${ex.name}</span></div>`
          : `<img src="${extIconSrc}" style="width:18px;height:18px;cursor:pointer;filter:drop-shadow(0 0 2px #000);" alt="" />`;

        const icon = L.divIcon({
          className: '',
          html: labelHtml,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 400 });
        marker.bindTooltip(
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${extIconSrc}" style="width:26px;height:26px;object-fit:contain;" alt="" />
            <div>
              <strong style="color:#10b981">Çıkış: ${ex.name}</strong> (${(ex.faction || 'all').toUpperCase()})<br/>
              <span>Yükseklik (Y): ${ex.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -8] }
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

    // 7) Görev Hedefi Pinleri (Seçili Görevler veya Haritanın Tüm Görevleri — birbirinden bağımsız)
    if ((showTasksLayer || currentMapPayload.showAllMapTasksOnOverlay) && taskMarkers.length > 0) {
      for (const tm of taskMarkers) {
        if (!tm.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(tm.position);
        const borderCol = tm.isSelectedTask ? '#b57bee' : '#eab308';
        const fallbackIcon = tm.questItemName
          ? '../../assets/map-icons/quest_item.png'
          : '../../assets/map-icons/quest_objective.png';
        const pinImg = tm.questItemIcon || fallbackIcon;

        const icon = L.divIcon({
          className: '',
          html: `<div style="width:22px;height:22px;border-radius:5px;background:rgba(18,12,28,0.92);border:2px solid ${borderCol};display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 6px rgba(0,0,0,0.9);" title="${tm.taskName}">
            <img src="${pinImg}" style="width:17px;height:17px;object-fit:contain;" alt="" />
          </div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 900 });
        const previewImg = tm.questItemImage || tm.questItemIcon || tm.taskImageLink || fallbackIcon;

        marker.bindTooltip(
          `<div style="display:flex;gap:8px;align-items:center;max-width:320px;">
            <img src="${previewImg}" style="width:52px;height:52px;object-fit:contain;background:#0c0e12;border:1px solid ${borderCol};border-radius:4px;flex-shrink:0;" alt="" />
            <div>
              <strong style="color:#c084fc">[${tm.traderName}] ${tm.taskName}</strong><br/>
              <span>${tm.description || ''}</span><br/>
              ${tm.questItemName ? `<span style="color:#fde68a">📦 Garanti Görev Eşyası: <strong>${tm.questItemName}</strong></span><br/>` : ''}
              ${tm.requiredKeyName ? `<span style="color:#93c5fd">🔑 Anahtar: <strong>${tm.requiredKeyName}</strong></span><br/>` : ''}
              <span>Kat / Yükseklik (Y): ${tm.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          { className: 'tarkov-tooltip', direction: 'top', offset: [0, -10] }
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
