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
  let isTaskPinnedOpen = false;
  let isLightboxOpen = false;

  // ---------------------------------------------------------------------------
  // Fare Etkileşimi (Hover-Interactive) + Görev Kartı / Lightbox Kilidi
  // ---------------------------------------------------------------------------
  // pointerInside: fare overlay penceresinin (document) içinde mi? Lightbox #overlay-root'un
  // dışında (body altında) olduğu için root yerine tüm document izlenir.
  let pointerInside = false;
  let lastLockSent = null;

  function isHoverAllowed() {
    return !!currentSettings && currentSettings.hoverInteractiveMap !== false && !currentSettings.overlay?.editMode;
  }

  function isInteractionLocked() {
    return isTaskPinnedOpen || isLightboxOpen;
  }

  // Ana sürece kilit durumunu bildirir (yalnızca değiştiğinde)
  function syncInteractionLock() {
    const payload = { locked: isInteractionLocked(), lightbox: isLightboxOpen };
    const key = `${payload.locked}|${payload.lightbox}`;
    if (key === lastLockSent) return;
    lastLockSent = key;
    if (window.tarkovAPI.setInteractionLock) {
      window.tarkovAPI.setInteractionLock(payload);
    }
  }

  // Tek merkezden etkileşim kararı: kilitliyse ASLA tıklama-geçirgen moda dönülmez
  function updateHoverInteractivity() {
    syncInteractionLock();
    if (currentSettings?.overlay?.editMode) {
      rootEl.classList.remove('hover-interactive');
      return; // düzenleme modunda pencere zaten tam etkileşimli
    }
    const wantInteractive = isInteractionLocked() || isMouseDraggingMap || (pointerInside && isHoverAllowed());
    rootEl.classList.toggle('hover-interactive', wantInteractive);
    window.tarkovAPI.setHoverInteractive(wantInteractive);
  }

  function setupHoverInteractivity() {
    const docEl = document.documentElement;

    docEl.addEventListener('mouseenter', () => {
      pointerInside = true;
      updateHoverInteractivity();
    });

    docEl.addEventListener('mouseleave', () => {
      pointerInside = false;
      if (isInteractionLocked() || isMouseDraggingMap) return;
      updateHoverInteractivity();
    });

    // mouseenter kaçırılırsa (ör. DOM değişimi sonrası) ilk harekette telafi et
    document.addEventListener(
      'mousemove',
      () => {
        if (!pointerInside) {
          pointerInside = true;
          updateHoverInteractivity();
        }
      },
      { passive: true }
    );

    window.addEventListener('mouseup', () => {
      if (isMouseDraggingMap) {
        isMouseDraggingMap = false;
        updateHoverInteractivity();
      }
    });
  }

  setupHoverInteractivity();

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

  let baseLayerGroup = null;
  let currentMapLoadId = 0;

  function initOrResetLeafletMap(geoConfig) {
    if (!geoConfig) return;

    // Harita zaten bu haritanın CRS'i ile başlatılmışsa yeniden oluşturma, sadece katmanları temizle
    if (leafletMap && loadedMapKey === geoConfig.normalizedName) {
      if (baseLayerGroup) baseLayerGroup.clearLayers();
      return;
    }

    if (leafletMap) {
      try {
        leafletMap.off();
        leafletMap.remove();
      } catch (_e) {}
      leafletMap = null;
    }

    const crs = buildMapCRS(geoConfig);
    leafletMap = L.map('leaflet-map', {
      crs: crs,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 80
    });

    baseLayerGroup = L.layerGroup().addTo(leafletMap);
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

    // Haritanın boş bir yerine tıklanınca sabit görev kartını kapat
    // (marker ve popup tıklamaları haritaya yayılmaz; sürükleme sonrası click Leaflet tarafından bastırılır)
    leafletMap.on('click', () => {
      if (isTaskPinnedOpen && !isLightboxOpen) {
        closePinnedTaskPopup();
      }
    });

  }

  // Pencere boyutu değişince haritayı yeniden ölç (tek dinleyici; her harita değişiminde eklenmez)
  window.addEventListener('resize', () => {
    if (leafletMap) leafletMap.invalidateSize();
  });

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
    if (!geoConfig) return;

    const loadId = ++currentMapLoadId;

    if (loadedMapKey === geoConfig.normalizedName && loadedRenderStyle === renderStyle && activeBaseLayer) {
      return;
    }

    initOrResetLeafletMap(geoConfig);
    loadedMapKey = geoConfig.normalizedName;
    loadedRenderStyle = renderStyle;

    mapLoading.classList.remove('hidden');
    mapLoading.textContent = `${geoConfig.name} yükleniyor...`;

    if (baseLayerGroup) {
      baseLayerGroup.clearLayers();
    }
    activeBaseLayer = null;
    activeFloorTileLayer = null;
    activeFloorName = null;
    activeSvgElement = null;

    const leafletBounds = L.latLngBounds(window.TarkovGeo.mapBoundsToLeafletBounds(geoConfig.bounds));
    leafletMap.setMinZoom(0.5);
    leafletMap.setMaxZoom(6.5);

    let layerCreated = false;

    // 1. Öncelik: Kullanıcı Uydu (Satellite) seçtiyse ve haritanın tilePath'i varsa
    if (renderStyle === 'satellite' && geoConfig.tilePath) {
      activeBaseLayer = L.tileLayer(geoConfig.tilePath, {
        tileSize: 256,
        bounds: leafletBounds,
        minZoom: 0.5,
        maxZoom: 6.5,
        maxNativeZoom: geoConfig.maxZoom || 5
      });
      activeBaseLayer.addTo(baseLayerGroup);
      layerCreated = true;
    }

    // 2. Öncelik: Eğer Uydu yoksa veya SVG stili seçildiyse ve svgPath varsa
    if (!layerCreated && geoConfig.svgPath) {
      try {
        const res = await window.tarkovAPI.getMapSvg(geoConfig.normalizedName);
        if (loadId !== currentMapLoadId) {
          // Başka bir harita seçildi, eski haritanın SVG'sini iptal et!
          return;
        }

        if (res && res.ok && res.svgText) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = res.svgText.trim();
          const parsedSvg = wrapper.querySelector('svg');

          if (parsedSvg && loadId === currentMapLoadId) {
            const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            if (parsedSvg.getAttribute('viewBox')) {
              svgEl.setAttribute('viewBox', parsedSvg.getAttribute('viewBox'));
            }
            svgEl.innerHTML = parsedSvg.innerHTML;
            activeSvgElement = svgEl;

            activeBaseLayer = L.svgOverlay(svgEl, leafletBounds, {
              interactive: false
            });
            activeBaseLayer.addTo(baseLayerGroup);
            layerCreated = true;
          }
        }
      } catch (_err) {}
    }

    // 3. Fallback: SVG indirilemediyse veya yoksa tilePath dene
    if (!layerCreated && geoConfig.tilePath && loadId === currentMapLoadId) {
      activeBaseLayer = L.tileLayer(geoConfig.tilePath, {
        tileSize: 256,
        bounds: leafletBounds,
        minZoom: 0.5,
        maxZoom: 6.5,
        maxNativeZoom: geoConfig.maxZoom || 5
      });
      activeBaseLayer.addTo(baseLayerGroup);
      layerCreated = true;
    }

    if (loadId === currentMapLoadId) {
      leafletMap.invalidateSize();
      leafletMap.fitBounds(leafletBounds, { animate: false });
      mapLoading.classList.add('hidden');
    }
  }

  /**
   * Haritanın kenarındaki ikonların tooltip'lerinin pencere dışına taşmasını engeller
   */
  function bindSmartTooltip(marker, html, baseOffset = [0, -8], extraClass = '') {
    marker.bindTooltip(html, {
      className: extraClass ? `tarkov-tooltip ${extraClass}` : 'tarkov-tooltip',
      direction: 'top',
      offset: baseOffset,
      interactive: true,
      opacity: 1
    });

    // Leaflet'in kendi "fare çıkınca HEMEN kapat" davranışını kaldır: kapanmayı aşağıdaki
    // gecikmeli mantık yönetir, böylece fare marker'dan tooltip'e geçerken kart kaybolmaz.
    marker.off('mouseout', marker.closeTooltip);
    // Açmayı da biz yapıyoruz: yön (sağ/sol/üst/alt) açmadan ÖNCE hesaplanmalı
    marker.off('mouseover', marker._openTooltip);

    let closeTimer = null;

    function cancelClose() {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    }

    function scheduleClose(delay = 400) {
      cancelClose();
      closeTimer = setTimeout(() => {
        try {
          marker.closeTooltip();
        } catch (_e) {}
      }, delay);
    }

    marker.on('mouseover', () => {
      cancelClose();
      if (!leafletMap) return;
      const tip = marker.getTooltip();
      if (!tip) return;

      const pt = leafletMap.latLngToContainerPoint(marker.getLatLng());
      const sz = leafletMap.getSize();
      if (pt.x < 145) {
        tip.options.direction = 'right';
        tip.options.offset = [10, 0];
      } else if (pt.x > sz.x - 145) {
        tip.options.direction = 'left';
        tip.options.offset = [-10, 0];
      } else if (pt.y < 125) {
        tip.options.direction = 'bottom';
        tip.options.offset = [0, 10];
      } else {
        tip.options.direction = 'top';
        tip.options.offset = baseOffset;
      }

      if (!marker.isTooltipOpen()) {
        marker.openTooltip();
      } else {
        tip.update(); // yön değiştiyse konumu yenile
      }

      // Tooltip DOM elementine fare girdiğinde kapanmayı iptal et
      setTimeout(() => {
        const el = tip.getElement();
        if (el && !el._hasHoverBridge) {
          el._hasHoverBridge = true;
          el.addEventListener('mouseenter', cancelClose);
          el.addEventListener('mouseleave', () => scheduleClose(300));
        }
      }, 30);
    });

    marker.on('mouseout', () => {
      scheduleClose(450);
    });
  }

  /**
   * Aşama 4: Seçili hedef halkasını, oyuncudan hedefe düz rota çizgisini,
   * çoklu rotasyon zincirini (#1 -> #2 -> #3...), mesafe/göreli açı ve kat farkını çizer.
   */
  function renderRouteAndNavigation() {
    if (!leafletMap || !routeLayerGroup) return;
    routeLayerGroup.clearLayers();

    const showRoute = currentSettings?.overlay?.layers?.route !== false;
    const target = currentPlayerState?.activeTarget;
    const cur = currentPlayerState?.current;
    const nav = currentPlayerState?.navInfo;
    const tour = currentPlayerState?.rotationTour || [];

    // Çoklu Otomatik Rotasyon Zincirini Çiz (#1 -> #2 -> #3 -> ...)
    if (showRoute && currentSettings?.autoRotationEnabled !== false && tour.length > 0) {
      for (let i = 0; i < tour.length; i++) {
        const stop = tour[i];
        if (!stop || !stop.position) continue;
        const stopLL = window.TarkovGeo.gamePosToLatLngArray(stop.position);

        // #1'den #2'ye, #2'den #3'e zincirleme önizleme çizgisi
        if (i < tour.length - 1 && tour[i + 1]?.position) {
          const nextStop = tour[i + 1];
          const segWaypoints = window.TarkovGeo.computeSafeRouteWaypoints(
            stop.position,
            nextStop.position,
            currentMapPayload?.hazards || [],
            currentMapPayload?.mapNormalizedName || ''
          );
          const segLLs = segWaypoints.map((pt) => window.TarkovGeo.gamePosToLatLngArray(pt));
          L.polyline(segLLs, {
            color: '#38bdf8',
            weight: 2.0,
            opacity: 0.72,
            dashArray: '4, 6',
            interactive: false
          }).addTo(routeLayerGroup);
        }

        // Sıra numarası rozeti (1, 2, 3...)
        const stepBadge = L.divIcon({
          className: '',
          html: `<div class="tour-step-badge" style="background:${i === 0 ? '#f43f5e' : '#0284c7'}">${i + 1}</div>`,
          iconSize: [16, 16],
          iconAnchor: [-6, 16]
        });
        L.marker(stopLL, { icon: stepBadge, interactive: false, zIndexOffset: 1600 }).addTo(routeLayerGroup);
      }
    }

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
      const tourInfo = tour.length > 1 ? ` • Zincir: 1/${tour.length}` : '';
      targetSummaryEl.textContent = `${nav.horizontalDistance}m • ${nav.relativeText}${tourInfo}`;

      // Sol alt Navigasyon HUD kartı
      navHud.classList.remove('hidden');
      navHudTitle.textContent = `🎯 ${target.title}`;
      navHudDist.textContent = `${nav.horizontalDistance}m`;
      navHudRel.textContent = `${nav.relativeText}${tour.length > 1 ? ` (Sıradaki: ${tour[1].title})` : ''}`;
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
      if (baseLayerGroup) baseLayerGroup.removeLayer(activeFloorTileLayer);
      else if (leafletMap) leafletMap.removeLayer(activeFloorTileLayer);
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
      });
      activeFloorTileLayer.addTo(baseLayerGroup || leafletMap);
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
    hideTaskHoverTooltip(); // eski marker'a bağlı hover kartı kalmasın

    const showLootLayer = currentSettings?.overlay?.layers?.loot !== false;
    const showTasksLayer = currentSettings?.overlay?.layers?.tasks !== false;
    const looseMarkers = currentMapPayload.looseMarkers || [];
    const valuableMarkers = currentMapPayload.valuableMarkers || [];
    const containerMarkers = currentMapPayload.containerMarkers || [];
    const pmcSpawns = currentMapPayload.pmcSpawns || [];
    const scavSpawns = currentMapPayload.scavSpawns || [];
    const bossSpawns = currentMapPayload.bossSpawns || [];
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
    const visitedSet = new Set(currentPlayerState?.visitedTargetIds || []);
    const showPmcSpawns = !!currentMapPayload.showPmcSpawns;
    const showScavSpawns = !!currentMapPayload.showScavSpawns;
    const showBossSpawns = !!currentMapPayload.showBossSpawns;
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

    // 1) Harita Konum İsimleri (Bina ve Bölge Callout Etiketleri — Kutusuz Temiz Konturlu Yazı)
    if (showCallouts) {
      for (const c of callouts) {
        const latLng = window.TarkovGeo.gamePosToLatLngArray({ x: c.x, y: c.y || 0, z: c.z });
        const labelIcon = L.divIcon({
          className: 'callout-div-icon',
          html: `<div class="callout-label" style="cursor:pointer;" title="Tıklayınca rota hedefi yapar">${c.name}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
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
        const isVisited = visitedSet.has(m.id);
        const icon = L.divIcon({
          className: '',
          html: `<div style="position:relative;width:22px;height:22px;border-radius:5px;background:rgba(12,14,18,0.92);border:2px solid ${isVisited ? '#22c55e' : m.color};opacity:${isVisited ? 0.55 : 1};display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 6px rgba(0,0,0,0.85);">
            <img src="${pinImgSrc}" style="width:18px;height:18px;object-fit:contain;" alt="" />
            ${isVisited ? '<span style="position:absolute;top:-5px;right:-5px;background:#16a34a;color:#fff;font-size:8px;font-weight:900;border-radius:50%;width:12px;height:12px;display:flex;align-items:center;justify-content:center;">✓</span>' : ''}
          </div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 750 });
        const priceStr = m.bestPrice ? `${m.bestPrice.toLocaleString('tr-TR')} ₽` : 'Veri yok';
        const slotStr = m.pricePerSlot ? `${m.pricePerSlot.toLocaleString('tr-TR')} ₽/slot` : '-';
        const previewImg = m.baseImageLink || m.iconLink || '../../assets/map-icons/loose_loot.png';

        const safeItemName = (m.itemName || '').replace(/"/g, '&quot;');
        bindSmartTooltip(
          marker,
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${previewImg}" class="task-subthumb" style="width:48px;height:48px;object-fit:contain;background:#0c0e12;border:1px solid ${m.color};border-radius:4px;flex-shrink:0;cursor:zoom-in;" title="Büyütmek için tıkla" data-zoom-src="${previewImg}" data-zoom-caption="${safeItemName}" alt="" />
            <div style="min-width:0;">
              <strong style="color:${m.color}">${m.itemName}</strong> (${m.shortName})<br/>
              <span>En İyi Fiyat: <strong>${priceStr}</strong> (${m.bestSource})</span><br/>
              <span>Slot Başı: ${slotStr} | Kat (Y): ${m.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          [0, -10]
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
        const isVisited = visitedSet.has(v.id);
        const icon = L.divIcon({
          className: '',
          html: `<div style="position:relative;width:22px;height:22px;border-radius:50%;background:rgba(12,14,18,0.92);border:2px solid ${isVisited ? '#22c55e' : v.highlightColor};opacity:${isVisited ? 0.55 : 1};display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 7px ${v.highlightColor};">
            <img src="${pinImgSrc}" style="width:16px;height:16px;object-fit:contain;" alt="" />
            ${isVisited ? '<span style="position:absolute;top:-5px;right:-5px;background:#16a34a;color:#fff;font-size:8px;font-weight:900;border-radius:50%;width:12px;height:12px;display:flex;align-items:center;justify-content:center;">✓</span>' : ''}
          </div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 700 });
        const priceStr = v.bestPrice ? `${v.bestPrice.toLocaleString('tr-TR')} ₽` : '-';
        const previewImg = v.baseImageLink || v.iconLink || '../../assets/map-icons/valuable_bitcoin.webp';

        const safeValName = (v.itemName || '').replace(/"/g, '&quot;');
        bindSmartTooltip(
          marker,
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${previewImg}" class="task-subthumb" style="width:48px;height:48px;object-fit:contain;background:#0c0e12;border:1px solid ${v.highlightColor};border-radius:4px;flex-shrink:0;cursor:zoom-in;" title="Büyütmek için tıkla" data-zoom-src="${previewImg}" data-zoom-caption="${safeValName}" alt="" />
            <div style="min-width:0;">
              <strong style="color:${v.highlightColor}">💎 ${v.itemName} (${v.shortName})</strong><br/>
              <span>Değer: <strong>${priceStr}</strong> (${v.bestSource})</span><br/>
              ${v.otherNames ? `<span style="color:#cbd5e1">Olası Havuz: ${v.otherNames}</span><br/>` : ''}
              <span>Kat (Y): ${v.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          [0, -10]
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

    // 2C) Kategori Kategori Loot Kutuları (Sabitlenen Eşya Pinlerinden BAĞIMSIZ çalışır + Zincirleme Rota Desteği)
    if (enabledCatSet.size > 0) {
      containerMarkers.forEach((c, idx) => {
        if (!c.position) return;
        if (!enabledCatSet.has(c.categoryKey)) return;

        const contId = c.id || `cont_${idx}`; // ana süreçteki haritaya özel kimlik
        const isVisited = visitedSet.has(contId);
        const latLng = window.TarkovGeo.gamePosToLatLngArray(c.position);
        const pinColor = isVisited ? '#22c55e' : c.color || '#f59e0b';
        const iconSrc = `../../assets/map-icons/${c.iconFile || 'container_crate.png'}`;
        const icon = L.divIcon({
          className: '',
          html: `<div style="position:relative;width:20px;height:20px;border-radius:4px;background:rgba(12,14,18,0.88);border:1.5px solid ${pinColor};opacity:${isVisited ? 0.55 : 1};display:flex;align-items:center;justify-content:center;cursor:pointer;">
            <img src="${iconSrc}" style="width:15px;height:15px;object-fit:contain;" alt="" />
            ${isVisited ? '<span style="position:absolute;top:-5px;right:-5px;background:#16a34a;color:#fff;font-size:8px;font-weight:900;border-radius:50%;width:11px;height:11px;display:flex;align-items:center;justify-content:center;">✓</span>' : ''}
          </div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 350 });
        const cName = c.lootContainer?.name || 'Konteyner';
        const catLabel = c.categoryLabel || 'Loot Kutusu';
        bindSmartTooltip(
          marker,
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${iconSrc}" style="width:36px;height:36px;object-fit:contain;background:#0c0e12;border:1px solid ${pinColor};border-radius:4px;padding:3px;flex-shrink:0;" alt="" />
            <div style="min-width:0;">
              <strong style="color:${pinColor}">${cName} ${isVisited ? '(✓ Lootlandı)' : ''}</strong><br/>
              <span>Kategori: ${catLabel}</span><br/>
              <span>Yükseklik (Y): ${c.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer (Ulaşınca sıradaki kutuya geçer)</em>
            </div>
          </div>`,
          [0, -8]
        );

        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: contId,
            title: cName,
            subtitle: catLabel,
            category: 'container',
            color: c.color || '#f59e0b',
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
        bindSmartTooltip(
          marker,
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${keyImg}" style="width:42px;height:42px;object-fit:contain;background:#0c0e12;border:1px solid #93c5fd;border-radius:4px;flex-shrink:0;" alt="" />
            <div style="min-width:0;">
              <strong style="color:#93c5fd">🔑 ${keyTitle}</strong><br/>
              ${lk.needsPower ? `<span style="color:#fde68a">⚡ Önce Elektrik Şalteri Açılmalı</span><br/>` : ''}
              <span>Yükseklik (Y): ${lk.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`,
          [0, -8]
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
        bindSmartTooltip(marker, `<div><strong style="color:#fde68a">🛡 BTR Durağı: ${bs.name}</strong></div>`);
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
        bindSmartTooltip(
          marker,
          `<div><strong style="color:#fbbf24">⚡ Şalter / Güç Kolu</strong><br/><span>${sw.name} (Y: ${sw.position.y.toFixed(1)}m)</span></div>`
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
        bindSmartTooltip(marker, `<div><strong style="color:#f87171">Sabit Ağır Silah (AGS / NSV)</strong></div>`);
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
        bindSmartTooltip(marker, `<div><strong style="color:#fb923c">Harita Geçişi (Transit): ${tr.description || ''}</strong></div>`);
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

    // 5) PMC, Scav ve Boss Doğma Noktaları (Birbirinden Bağımsız Katmanlar)
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
        bindSmartTooltip(
          marker,
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${iconSrc}" style="width:28px;height:28px;object-fit:contain;flex-shrink:0;" alt="" />
            <div>
              <strong style="color:#60a5fa">PMC Doğma Noktası</strong><br/>
              <span>Yükseklik (Y): ${sp.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`
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
        bindSmartTooltip(
          marker,
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${iconSrc}" style="width:28px;height:28px;object-fit:contain;flex-shrink:0;" alt="" />
            <div>
              <strong style="color:${sp.color}">${sp.title}</strong><br/>
              <span>Yükseklik (Y): ${sp.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`
        );
        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: sp.id,
            title: sp.title,
            subtitle: 'Scav / Sniper Spawn',
            category: 'spawn',
            color: sp.color,
            position: sp.position
          });
        });
        marker.addTo(spawnLayerGroup);
      }
    }

    if (showBossSpawns && spawnLayerGroup) {
      for (const sp of bossSpawns) {
        if (!sp.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(sp.position);
        const iconSrc = `../../assets/map-icons/${sp.iconFile || 'spawn_boss.png'}`;
        const icon = L.divIcon({
          className: '',
          html: `<img src="${iconSrc}" style="width:22px;height:22px;cursor:pointer;filter:drop-shadow(0 0 4px #000);" alt="" />`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });
        const marker = L.marker(latLng, { icon, zIndexOffset: 310 });
        bindSmartTooltip(
          marker,
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${iconSrc}" style="width:30px;height:30px;object-fit:contain;flex-shrink:0;" alt="" />
            <div>
              <strong style="color:${sp.color}">💀 ${sp.title}</strong><br/>
              <span>Yükseklik (Y): ${sp.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`
        );
        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: sp.id,
            title: sp.title,
            subtitle: 'Boss / Cultist / Rogue Spawn',
            category: 'spawn',
            color: sp.color,
            position: sp.position
          });
        });
        marker.addTo(spawnLayerGroup);
      }
    }

    // 6) Çıkış (Extract) Noktaları (Anahtar / Yeşil Fişek / Araç Bilgileriyle + Kutusuz Etiket)
    if (showExtracts) {
      for (const ex of extracts) {
        if (!ex.position) continue;
        const latLng = window.TarkovGeo.gamePosToLatLngArray(ex.position);
        const fac = (ex.faction || 'all').toLowerCase();
        const extIconFile = fac === 'pmc' ? 'extract_pmc.png' : fac === 'scav' ? 'extract_scav.png' : 'extract_shared.png';
        const extIconSrc = `../../assets/map-icons/${extIconFile}`;
        const shortCondBadge = ex.requiredKey
          ? ' <span style="color:#93c5fd">🔑</span>'
          : ex.conditionNote && ex.conditionNote.includes('Fişek')
          ? ' <span style="color:#4ade80">🟢</span>'
          : '';

        const labelHtml = showCallouts
          ? `<div style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;width:max-content;"><img src="${extIconSrc}" style="width:18px;height:18px;flex-shrink:0;filter:drop-shadow(0 0 2px #000);" alt="" /><span class="extract-label">${ex.name}${shortCondBadge}</span></div>`
          : `<img src="${extIconSrc}" style="width:18px;height:18px;cursor:pointer;filter:drop-shadow(0 0 2px #000);" alt="" />`;

        const icon = L.divIcon({
          className: '',
          html: labelHtml,
          iconSize: null,
          iconAnchor: [9, 9]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 400 });
        const previewImg = ex.requiredKey?.iconLink || extIconSrc;
        bindSmartTooltip(
          marker,
          `<div style="display:flex;gap:8px;align-items:center;">
            <img src="${previewImg}" style="width:34px;height:34px;object-fit:contain;background:#0c0e12;border:1px solid #10b981;border-radius:4px;flex-shrink:0;" alt="" />
            <div style="min-width:0;">
              <strong style="color:#10b981">Çıkış: ${ex.name}</strong> (${(ex.faction || 'all').toUpperCase()})<br/>
              ${ex.conditionNote ? `<span style="color:#fde68a">${ex.conditionNote}</span><br/>` : ''}
              <span>Yükseklik (Y): ${ex.position.y.toFixed(1)}m</span><br/>
              <em style="color:#fcd34d">Tıklayınca güvenli rota çizer</em>
            </div>
          </div>`
        );

        marker.on('click', () => {
          window.tarkovAPI.setTarget({
            id: `extract_${ex.id}`,
            title: `Çıkış: ${ex.name}`,
            subtitle: ex.conditionNote || `Extract (${(ex.faction || 'all').toUpperCase()})`,
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
        const isVisited = visitedSet.has(tm.id);
        const borderCol = isVisited ? '#22c55e' : tm.isSelectedTask ? '#b57bee' : '#eab308';
        const fallbackIcon = tm.questItemName
          ? '../../assets/map-icons/quest_item.png'
          : '../../assets/map-icons/quest_objective.png';
        const pinImg = tm.questItemIcon || fallbackIcon;

        const icon = L.divIcon({
          className: '',
          html: `<div style="position:relative;width:22px;height:22px;border-radius:5px;background:rgba(18,12,28,0.92);border:2px solid ${borderCol};opacity:${isVisited ? 0.58 : 1};display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 6px rgba(0,0,0,0.9);">
            <img src="${pinImg}" style="width:17px;height:17px;object-fit:contain;" alt="" />
            ${isVisited ? '<span style="position:absolute;top:-5px;right:-5px;background:#16a34a;color:#fff;font-size:8px;font-weight:900;border-radius:50%;width:12px;height:12px;display:flex;align-items:center;justify-content:center;">✓</span>' : ''}
          </div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: 900, bubblingMouseEvents: false });

        // Hover: hafif, tıklanamaz (pointer-events:none) bilgi kartı
        marker.on('mouseover', () => showTaskHoverTooltip(tm, marker));
        marker.on('mouseout', hideTaskHoverTooltip);

        // Tıklama: hover kartını kapat, görev kartını pin üzerinde sabitle
        marker.on('click', (e) => {
          if (e && e.originalEvent) {
            L.DomEvent.stop(e.originalEvent);
          }
          hideTaskHoverTooltip();
          openPinnedTaskPopup(tm, marker);
        });

        marker.addTo(taskLayerGroup);
      }
    }

    // Harita yeniden çizildiyse (ayar/oyuncu güncellemesi) sabit görev kartını koru
    restorePinnedTaskAfterRender(taskMarkers);

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
      updateHoverInteractivity();
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
    // Ana süreç ayar değişiminde pencereyi tıklama-geçirgen yapmış olabilir; mevcut durumu yeniden uygula
    updateHoverInteractivity();
  });

  window.tarkovAPI.onAutoHomeUpdated(renderAutoHomeState);

  window.tarkovAPI.onMapDataUpdated(async (payload) => {
    currentMapPayload = payload;
    await loadMapBaseLayer(payload.geoConfig, payload.mapRenderStyle || 'satellite');
    renderMarkers();
  });

  window.tarkovAPI.onPlayerUpdated((playerState) => {
    const prevVisitedCount = currentPlayerState?.visitedTargetIds?.length || 0;
    currentPlayerState = playerState;
    const nextVisitedCount = currentPlayerState?.visitedTargetIds?.length || 0;
    if (prevVisitedCount !== nextVisitedCount) {
      renderMarkers();
    } else {
      renderPlayerLayer();
    }
    updatePositionTimerText();
  });

  window.tarkovAPI.onShortcutAction((action) => {
    if (action === 'zoomIn') {
      applyZoomDelta(0.6);
    } else if (action === 'zoomOut') {
      applyZoomDelta(-0.6);
    }
  });


  // ---------------------------------------------------------------------------
  // Görev Pini: Hover Bilgi Kartı (hafif, tıklanamaz)
  // ---------------------------------------------------------------------------
  let taskHoverTooltip = null;

  function buildTaskHoverHtml(tm) {
    const chips = [];
    if (tm.questItemName) chips.push(`<span class="task-hover-chip item">📦 ${escapeHtml(tm.questItemName)}</span>`);
    if (tm.requiredKeyName) chips.push(`<span class="task-hover-chip key">🔑 ${escapeHtml(tm.requiredKeyName)}</span>`);
    if (tm.groupSize > 1) chips.push(`<span class="task-hover-chip">🎲 Olası konum (${tm.groupSize} noktadan biri)</span>`);
    const elev = tm.position && typeof tm.position.y === 'number' ? `${tm.position.y.toFixed(1)}m` : '';
    const photoCount = Array.isArray(tm.allLocationImages) ? tm.allLocationImages.length : 0;
    return `<div class="task-hover-tooltip">
        <div class="task-hover-header">
          <span class="task-hover-trader">[${escapeHtml(tm.traderName || 'Trader')}]</span>
          <strong class="task-hover-name">${escapeHtml(tm.taskName || '')}</strong>
          ${elev ? `<span class="task-hover-dist">${elev}</span>` : ''}
        </div>
        ${tm.description ? `<div class="task-hover-desc">${escapeHtml(tm.description)}</div>` : ''}
        ${chips.length ? `<div class="task-hover-chips">${chips.join('')}</div>` : ''}
        <div class="task-hover-hint">👆 Tıkla: Görevi Sabitle${photoCount > 0 ? ' &amp; Fotoğrafları Aç' : ''}</div>
      </div>`;
  }

  function showTaskHoverTooltip(tm, marker) {
    if (!leafletMap || !tm || !marker) return;
    // Bu görev zaten sabitlenmişse hover kartı açma (sabit kartın üstüne binmesin)
    if (pinnedTask && pinnedTask.tm && pinnedTask.tm.id === tm.id) return;
    hideTaskHoverTooltip();

    const latLng = marker.getLatLng();
    const pt = leafletMap.latLngToContainerPoint(latLng);
    const sz = leafletMap.getSize();
    let direction = 'top';
    let offset = [0, -12];
    if (pt.x < 150) {
      direction = 'right';
      offset = [12, 0];
    } else if (pt.x > sz.x - 150) {
      direction = 'left';
      offset = [-12, 0];
    } else if (pt.y < 150) {
      direction = 'bottom';
      offset = [0, 12];
    }

    taskHoverTooltip = L.tooltip({
      className: 'tarkov-tooltip task-smart-tooltip',
      direction,
      offset,
      opacity: 1,
      interactive: false
    })
      .setLatLng(latLng)
      .setContent(buildTaskHoverHtml(tm))
      .addTo(leafletMap);
  }

  function hideTaskHoverTooltip() {
    if (taskHoverTooltip) {
      try {
        taskHoverTooltip.remove();
      } catch (_e) {}
      taskHoverTooltip = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Görev Pini: Tıklayınca Sabitlenen Kart (Pinned Task Popup)
  // ---------------------------------------------------------------------------
  let activeTaskPopup = null;
  let pinnedTask = null; // { tm, photos }

  function collectTaskPhotos(tm) {
    const photos = [];
    const seen = new Set();
    const list = Array.isArray(tm.allLocationImages) && tm.allLocationImages.length > 0
      ? tm.allLocationImages
      : tm.locationImage
        ? [{ localPath: tm.locationImage, caption: 'Görev Konumu' }]
        : [];
    for (const img of list) {
      if (!img || !img.localPath || seen.has(img.localPath)) continue;
      seen.add(img.localPath);
      photos.push({ src: img.localPath, caption: img.caption || '' });
    }
    return photos;
  }

  function buildPhotosHtml(photos) {
    if (photos.length === 0) return '';

    if (photos.length === 1) {
      const p = photos[0];
      const cap = escapeHtml(p.caption || 'Görev Konumu');
      return `
        <div class="task-popup-single-photo" data-zoom-idx="0" title="Tam boyut görmek için tıkla">
          <img src="${escapeHtml(p.src)}" alt="" draggable="false" />
          <span class="popup-photo-badge">📷 Konum</span>
          <span class="popup-zoom-hint">🔍 Tıkla: Tam Boyut</span>
          <div class="popup-photo-caption">${cap}</div>
        </div>`;
    }

    const labels = photos.length === 2 ? ['Konum', 'Detay'] : [];
    const items = photos
      .map((p, idx) => {
        const label = labels[idx] ? ` ${labels[idx]}` : '';
        const cap = escapeHtml(p.caption || `${idx + 1}. Görsel`);
        return `
          <div class="task-popup-photo-item" data-zoom-idx="${idx}" title="${cap}">
            <img src="${escapeHtml(p.src)}" alt="" draggable="false" />
            <span class="popup-photo-badge">📷 #${idx + 1}${label}</span>
            <span class="popup-zoom-hint-mini">🔍 Büyüt</span>
            <div class="popup-photo-caption-mini">${cap}</div>
          </div>`;
      })
      .join('');
    return `<div class="task-popup-multi-photos${photos.length > 2 ? ' is-grid' : ''}">${items}</div>`;
  }

  function buildPinnedCardHtml(tm, photos) {
    const chips = [];
    if (tm.questItemName) {
      chips.push(`<span class="popup-chip item">📦 Eşya: <strong>${escapeHtml(tm.questItemName)}</strong></span>`);
    }
    if (tm.requiredKeyName) {
      chips.push(`<span class="popup-chip key">🔑 Anahtar: <strong>${escapeHtml(tm.requiredKeyName)}</strong></span>`);
    }
    if (tm.position && typeof tm.position.y === 'number') {
      chips.push(`<span class="popup-chip dist">📍 Yükseklik: <strong>${tm.position.y.toFixed(1)}m</strong></span>`);
    }

    const safeName = escapeHtml(tm.taskName || '');
    return `
      <div class="tarkov-pinned-card">
        <div class="pinned-card-header">
          <div class="pinned-card-title">
            <span class="pinned-card-trader">[${escapeHtml(tm.traderName || 'Trader')}]</span>
            <strong class="pinned-card-name" title="${safeName}">${safeName}</strong>
          </div>
          <button type="button" class="btn-pinned-close" data-action="close" title="Kapat (Esc)">✕</button>
        </div>
        ${buildPhotosHtml(photos)}
        <div class="pinned-card-body">
          ${tm.description ? `<div class="pinned-card-desc">${escapeHtml(tm.description)}</div>` : ''}
          ${chips.length > 0 ? `<div class="pinned-card-chips">${chips.join('')}</div>` : ''}
          <div class="pinned-card-actions">
            <button type="button" class="btn-pinned-route" data-action="route">🎯 Rotayı Bu Göreve Çiz</button>
          </div>
        </div>
      </div>`;
  }

  function handlePinnedCardClick(e) {
    if (!pinnedTask) return;
    const tm = pinnedTask.tm;
    const photos = pinnedTask.photos;

    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      L.DomEvent.stop(e);
      const action = actionEl.getAttribute('data-action');
      if (action === 'close') {
        closePinnedTaskPopup();
      } else if (action === 'route') {
        window.tarkovAPI.setTarget({
          id: tm.id,
          title: `Görev: ${tm.taskName}`,
          subtitle: tm.description || tm.traderName,
          category: 'task',
          color: tm.isSelectedTask ? '#a855f7' : '#d97706',
          position: tm.position
        });
        actionEl.textContent = '✓ Rota Çizildi!';
        actionEl.classList.add('is-done');
        setTimeout(() => {
          if (actionEl.isConnected) {
            actionEl.textContent = '🎯 Rotayı Bu Göreve Çiz';
            actionEl.classList.remove('is-done');
          }
        }, 1800);
      }
      return;
    }

    const photoEl = e.target.closest('[data-zoom-idx]');
    if (photoEl) {
      L.DomEvent.stop(e);
      const idx = parseInt(photoEl.getAttribute('data-zoom-idx'), 10) || 0;
      openImageLightbox(photos, idx, tm.taskName || '');
    }
  }

  function openPinnedTaskPopup(tm, marker) {
    if (!leafletMap || !tm || !tm.position) return;

    // Önceki kartı sessizce kaldır (kilit açılıp kapanmasın)
    detachActivePopup();
    hideTaskHoverTooltip();

    const photos = collectTaskPhotos(tm);
    const latLng = marker ? marker.getLatLng() : L.latLng(window.TarkovGeo.gamePosToLatLngArray(tm.position));
    pinnedTask = { tm, photos };
    isTaskPinnedOpen = true;

    const popup = L.popup({
      className: 'tarkov-task-pinned-popup',
      closeButton: false,
      autoClose: false,
      closeOnClick: false,
      closeOnEscapeKey: false, // Esc'yi kendimiz yönetiyoruz (önce lightbox, sonra kart)
      autoPan: true,
      autoPanPadding: [8, 8],
      offset: [0, -12],
      maxWidth: 320,
      minWidth: 260
    })
      .setLatLng(latLng)
      .setContent(buildPinnedCardHtml(tm, photos));

    // Kart herhangi bir nedenle haritadan kalkarsa (harita değişimi vb.) durumu senkronla
    popup.on('remove', () => {
      if (activeTaskPopup !== popup) return;
      activeTaskPopup = null;
      pinnedTask = null;
      isTaskPinnedOpen = false;
      updateHoverInteractivity();
    });

    activeTaskPopup = popup;
    popup.openOn(leafletMap);

    const el = popup.getElement();
    if (el) {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      el.addEventListener('click', handlePinnedCardClick);
    }

    updateHoverInteractivity();
  }

  // Popup'ı durum değiştirmeden kaldırır (yeniden açma / güncelleme için)
  function detachActivePopup() {
    if (!activeTaskPopup) return;
    const p = activeTaskPopup;
    activeTaskPopup = null; // 'remove' dinleyicisi tetiklenmesin
    try {
      p.remove();
    } catch (_e) {}
  }

  function closePinnedTaskPopup() {
    detachActivePopup();
    pinnedTask = null;
    isTaskPinnedOpen = false;
    updateHoverInteractivity();
  }

  // renderMarkers sonrası: sabit görev hâlâ haritadaysa kartı koru, yoksa kapat
  function restorePinnedTaskAfterRender(taskMarkers) {
    if (!pinnedTask) return;
    const fresh = (taskMarkers || []).find((m) => m.id === pinnedTask.tm.id && m.position);
    if (!fresh) {
      closePinnedTaskPopup();
      return;
    }
    pinnedTask.tm = fresh;
    if (!activeTaskPopup || !leafletMap.hasLayer(activeTaskPopup)) {
      openPinnedTaskPopup(fresh, null);
    }
  }

  // ---------------------------------------------------------------------------
  // Görsel Büyütme (Lightbox) - Çoklu Fotoğraf Gezintisi
  // ---------------------------------------------------------------------------
  const lightboxModal = document.getElementById('image-lightbox-modal');
  const lightboxBackdrop = document.getElementById('lightbox-backdrop');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');
  const btnLightboxPrev = document.getElementById('lightbox-prev');
  const btnLightboxNext = document.getElementById('lightbox-next');

  let currentLightboxPhotos = [];
  let currentLightboxIndex = 0;
  let currentLightboxTitle = '';
  let lightboxInWindow = false; // true: fotoğraf ayrı, ekran ortasındaki pencerede gösteriliyor

  function renderLightboxCurrentPhoto() {
    if (currentLightboxPhotos.length === 0) return;
    const cur = currentLightboxPhotos[currentLightboxIndex] || {};
    if (lightboxImg) lightboxImg.src = cur.src || cur.localPath || '';

    if (lightboxCaption) {
      const total = currentLightboxPhotos.length;
      const parts = [];
      if (total > 1) parts.push(`📷 ${currentLightboxIndex + 1}/${total}`);
      if (currentLightboxTitle) parts.push(currentLightboxTitle);
      if (cur.caption) parts.push(cur.caption);
      lightboxCaption.textContent = parts.join(' • ');
      lightboxCaption.style.display = parts.length ? 'block' : 'none';
    }

    const showNav = currentLightboxPhotos.length > 1;
    if (btnLightboxPrev) btnLightboxPrev.style.display = showNav ? 'flex' : 'none';
    if (btnLightboxNext) btnLightboxNext.style.display = showNav ? 'flex' : 'none';
  }

  function prevLightboxPhoto() {
    if (currentLightboxPhotos.length <= 1) return;
    currentLightboxIndex = (currentLightboxIndex - 1 + currentLightboxPhotos.length) % currentLightboxPhotos.length;
    renderLightboxCurrentPhoto();
  }

  function nextLightboxPhoto() {
    if (currentLightboxPhotos.length <= 1) return;
    currentLightboxIndex = (currentLightboxIndex + 1) % currentLightboxPhotos.length;
    renderLightboxCurrentPhoto();
  }

  /**
   * openImageLightbox(photos[], index, title)  -> görev fotoğrafları arasında gezinti
   * openImageLightbox('src', 'caption')        -> tek görsel (geriye dönük uyumluluk)
   */
  function openImageLightbox(photosOrSrc, indexOrCaption = 0, title = '') {
    if (!lightboxModal) return;

    if (Array.isArray(photosOrSrc)) {
      currentLightboxPhotos = photosOrSrc.filter((p) => p && (p.src || p.localPath));
      const idx = typeof indexOrCaption === 'number' ? indexOrCaption : 0;
      currentLightboxIndex = idx >= 0 && idx < currentLightboxPhotos.length ? idx : 0;
      currentLightboxTitle = title || '';
    } else if (photosOrSrc) {
      currentLightboxPhotos = [{ src: photosOrSrc, caption: typeof indexOrCaption === 'string' ? indexOrCaption : '' }];
      currentLightboxIndex = 0;
      currentLightboxTitle = '';
    } else {
      return;
    }
    if (currentLightboxPhotos.length === 0) return;

    hideTaskHoverTooltip();
    isLightboxOpen = true;
    updateHoverInteractivity(); // kilidi lightbox açılmadan ÖNCE uygula

    // Tercih edilen yol: fotoğraf ekranın ortasında, ayrı tam ekran pencerede açılır
    if (window.tarkovAPI.openLightboxWindow) {
      lightboxInWindow = true;
      window.tarkovAPI
        .openLightboxWindow({
          photos: currentLightboxPhotos.map((p) => ({ src: p.src || p.localPath, caption: p.caption || '' })),
          index: currentLightboxIndex,
          title: currentLightboxTitle
        })
        .then((res) => {
          // Ana süreç açamadıysa overlay içi modala geri dön
          if (!res || !res.ok) {
            lightboxInWindow = false;
            showInlineLightbox();
          }
        })
        .catch(() => {
          lightboxInWindow = false;
          showInlineLightbox();
        });
      return;
    }

    lightboxInWindow = false;
    showInlineLightbox();
  }

  function showInlineLightbox() {
    if (!isLightboxOpen) return;
    renderLightboxCurrentPhoto();
    lightboxModal.classList.remove('hidden');
  }

  // fromMain=true: ekran ortasındaki pencere zaten kapandı, ana sürece tekrar bildirme
  function closeImageLightbox(fromMain = false) {
    if (!lightboxModal || !isLightboxOpen) return;
    if (lightboxInWindow && !fromMain && window.tarkovAPI.closeLightboxWindow) {
      window.tarkovAPI.closeLightboxWindow();
    }
    lightboxInWindow = false;
    lightboxModal.classList.add('hidden');
    if (lightboxImg) lightboxImg.removeAttribute('src');
    isLightboxOpen = false;
    currentLightboxPhotos = [];
    currentLightboxIndex = 0;
    currentLightboxTitle = '';
    updateHoverInteractivity(); // görev kartı hâlâ açıksa kilit korunur
  }

  window.openImageLightbox = openImageLightbox;
  window.closeImageLightbox = closeImageLightbox;
  window.openPinnedTaskPopup = openPinnedTaskPopup;
  window.closePinnedTaskPopup = closePinnedTaskPopup;

  function stopAndRun(fn) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
  }

  if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', stopAndRun(() => closeImageLightbox()));
  if (lightboxBackdrop) lightboxBackdrop.addEventListener('click', stopAndRun(() => closeImageLightbox()));
  if (btnLightboxPrev) btnLightboxPrev.addEventListener('click', stopAndRun(prevLightboxPhoto));
  if (btnLightboxNext) btnLightboxNext.addEventListener('click', stopAndRun(nextLightboxPhoto));
  // Görselin kendisine tıklamak modalı kapatmasın; fare tekerleği ile gezinti
  if (lightboxImg) lightboxImg.addEventListener('click', (e) => e.stopPropagation());
  if (lightboxModal) {
    lightboxModal.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.deltaY > 0) nextLightboxPhoto();
        else if (e.deltaY < 0) prevLightboxPhoto();
      },
      { passive: false }
    );
  }

  // Esc: önce lightbox, sonra sabit görev kartı. ←/→: lightbox gezintisi.
  function handleOverlayKeyAction(action) {
    if (action === 'lightboxClosed') {
      closeImageLightbox(true); // görev kartı açıksa açık kalır
    } else if (action === 'closeAll') {
      closeImageLightbox();
      closePinnedTaskPopup();
    } else if (action === 'escape') {
      if (isLightboxOpen) closeImageLightbox();
      else if (isTaskPinnedOpen) closePinnedTaskPopup();
    } else if (action === 'prev') {
      if (isLightboxOpen) prevLightboxPhoto();
    } else if (action === 'next') {
      if (isLightboxOpen) nextLightboxPhoto();
    }
  }

  // Overlay odaklanabilir değilken (oyun modu) tuşlar ana süreçteki geçici global kısayollardan gelir
  if (window.tarkovAPI.onOverlayKeyAction) {
    window.tarkovAPI.onOverlayKeyAction(handleOverlayKeyAction);
  }

  // Düzenleme modunda pencere odaklanabilir; tuşlar doğrudan buraya gelir
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isLightboxOpen || isTaskPinnedOpen) {
        e.preventDefault();
        handleOverlayKeyAction('escape');
      }
    } else if (isLightboxOpen && e.key === 'ArrowLeft') {
      e.preventDefault();
      handleOverlayKeyAction('prev');
    } else if (isLightboxOpen && e.key === 'ArrowRight') {
      e.preventDefault();
      handleOverlayKeyAction('next');
    }
  });

  // Delegated Click: Sayfadaki herhangi bir [data-zoom-src] görsele tıklama
  document.addEventListener('click', (e) => {
    const zoomTarget = e.target.closest('[data-zoom-src]');
    if (zoomTarget) {
      e.stopPropagation();
      e.preventDefault();
      openImageLightbox(zoomTarget.getAttribute('data-zoom-src'), zoomTarget.getAttribute('data-zoom-caption') || '');
    }
  });
})();
