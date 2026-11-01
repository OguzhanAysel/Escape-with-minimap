/**
 * Escape from Tarkov Oyun Dünyası (3D Unity) <-> Leaflet 2D Harita Koordinat Dönüşümü
 * ve Hedef Mesafe / Göreli Yön / Kat Farkı Hesaplamaları (Aşama 2, 3, 4)
 */

const MAP_CONFIGS = {
  'customs': {
    name: 'Customs',
    normalizedName: 'customs',
    svgPath: 'https://assets.tarkov.dev/maps/svg/Customs.svg',
    svgLayer: 'Ground_Level',
    tilePath: 'https://assets.tarkov.dev/maps/customs_0.16/main/{z}/{x}/{y}.png',
    coordinateRotation: 180,
    bounds: [[698, -307], [-372, 237]],
    transform: [0.239, 168.65, 0.239, 136.35],
    minZoom: 1,
    maxZoom: 6,
    layers: [
      {
        name: '2. Kat',
        svgLayer: 'Second_Floor',
        tilePath: 'https://assets.tarkov.dev/maps/customs_0.16/2nd/{z}/{x}/{y}.png',
        extents: [
          { height: [2.7, 6.2], bounds: [[[243, 190], [165, 125]], [[116, -83], [72, -170]], [[580, -104], [532, -134]], [[73, 57], [22, -38]]] },
          { height: [5.5, 100], bounds: [[[-199, -90], [-223, -131]], [[239, 3], [169, -160]], [[584, -46], [556, -92]]] }
        ]
      },
      {
        name: '3. Kat',
        svgLayer: 'Third_Floor',
        tilePath: 'https://assets.tarkov.dev/maps/customs_0.16/3rd/{z}/{x}/{y}.png',
        extents: [
          { height: [5.7, 100], bounds: [[[243, 190], [165, 125]]] },
          { height: [7.7, 11.3], bounds: [[[73, -73], [22, -38]]] }
        ]
      },
      {
        name: 'Yeraltı / Sığınak',
        svgLayer: 'Underground_Level',
        tilePath: 'https://assets.tarkov.dev/maps/customs_0.16/underground/{z}/{x}/{y}.png',
        extents: [
          { height: [-1000, 0.4], bounds: [[[635, -137], [620, -125]], [[473, -122], [458, -110]], [[314, -173], [308, -184]], [[219, -158], [193, -137]]] }
        ]
      }
    ]
  },
  'woods': {
    name: 'Woods',
    normalizedName: 'woods',
    svgPath: 'https://assets.tarkov.dev/maps/svg/Woods.svg',
    svgLayer: 'Ground_Level',
    tilePath: 'https://assets.tarkov.dev/maps/woods/main_0.16/{z}/{x}/{y}.png',
    coordinateRotation: 180,
    bounds: [[646, -914], [-761, 442]],
    transform: [0.1855, 112.95, 0.1855, 167.85],
    minZoom: 1,
    maxZoom: 6,
    layers: []
  },
  'interchange': {
    name: 'Interchange',
    normalizedName: 'interchange',
    svgPath: 'https://assets.tarkov.dev/maps/svg/Interchange.svg',
    svgLayer: 'Ground_Level',
    tilePath: 'https://assets.tarkov.dev/maps/interchange/main/{z}/{x}/{y}.png',
    coordinateRotation: 180,
    bounds: [[598, -442], [-433, 426]],
    transform: [0.265, 150.6, 0.265, 134.6],
    minZoom: 1,
    maxZoom: 6,
    layers: [
      {
        name: 'AVM 1. Kat (Mağazalar)',
        svgLayer: 'First_Floor',
        tilePath: null,
        extents: [{ height: [25, 34], bounds: [[[120, 218], [-222, -327]]] }]
      },
      {
        name: 'AVM 2. Kat (Üst Kat)',
        svgLayer: 'Second_Floor',
        tilePath: null,
        extents: [{ height: [34, 1000], bounds: [[[120, 218], [-222, -327]]] }]
      }
    ]
  },
  'factory': {
    name: 'Factory',
    normalizedName: 'factory',
    svgPath: 'https://assets.tarkov.dev/maps/svg/Factory.svg',
    svgLayer: 'Ground_Floor',
    tilePath: 'https://assets.tarkov.dev/maps/factory/main/{z}/{x}/{y}.png',
    coordinateRotation: 90,
    bounds: [[77, -64.5], [-65.5, 67.4]],
    transform: [1.629, 119.9, 1.629, 139.3],
    minZoom: 1,
    maxZoom: 6,
    layers: [
      {
        name: '2. Kat (Catwalk)',
        svgLayer: 'Second_Floor',
        tilePath: 'https://assets.tarkov.dev/maps/factory/2nd/{z}/{x}/{y}.png',
        extents: [{ height: [3, 6] }]
      },
      {
        name: '3. Kat (Ofisler)',
        svgLayer: 'Third_Floor',
        tilePath: 'https://assets.tarkov.dev/maps/factory/3rd/{z}/{x}/{y}.png',
        extents: [{ height: [6, 1000] }]
      },
      {
        name: 'Yeraltı Tünelleri',
        svgLayer: 'Basement',
        tilePath: 'https://assets.tarkov.dev/maps/factory/tunnels/{z}/{x}/{y}.png',
        extents: [{ height: [-1000, -1] }]
      }
    ]
  },
  'shoreline': {
    name: 'Shoreline',
    normalizedName: 'shoreline',
    svgPath: 'https://assets.tarkov.dev/maps/svg/Shoreline.svg',
    svgLayer: 'Ground_Level',
    tilePath: 'https://assets.tarkov.dev/maps/shoreline/main_summer/{z}/{x}/{y}.png',
    coordinateRotation: 180,
    bounds: [[504, -415], [-1056, 618]],
    transform: [0.16, 83.2, 0.16, 111.1],
    minZoom: 1,
    maxZoom: 6,
    layers: [
      {
        name: 'Sanatoryum 2. Kat',
        svgLayer: 'Second_Floor',
        tilePath: null,
        extents: [{ height: [-1, 2], bounds: [[[-100, -40], [-350, -180]]] }]
      },
      {
        name: 'Sanatoryum 3. Kat / Çatı',
        svgLayer: 'Third_Floor',
        tilePath: null,
        extents: [{ height: [2, 1000], bounds: [[[-100, -40], [-350, -180]]] }]
      },
      {
        name: 'Sanatoryum Bodrum',
        svgLayer: 'Underground_Level',
        tilePath: null,
        extents: [{ height: [-1000, -5], bounds: [[[-137, -68], [-268, -163]]] }]
      }
    ]
  },
  'reserve': {
    name: 'Reserve',
    normalizedName: 'reserve',
    svgPath: 'https://assets.tarkov.dev/maps/svg/Reserve.svg',
    svgLayer: 'Ground_Level',
    tilePath: 'https://assets.tarkov.dev/maps/reserve/main/{z}/{x}/{y}.png',
    coordinateRotation: 180,
    bounds: [[289, -293], [-303, 244]],
    transform: [0.395, 122, 0.395, 137.65],
    minZoom: 1,
    maxZoom: 6,
    layers: [
      {
        name: 'Yeraltı Sığınakları (D-2 / Bunkers)',
        svgLayer: 'Bunkers',
        tilePath: 'https://assets.tarkov.dev/maps/reserve/bunkers/{z}/{x}/{y}.png',
        extents: [{ height: [-1000, -6.5] }]
      },
      {
        name: '2. Kat',
        svgLayer: null,
        tilePath: 'https://assets.tarkov.dev/maps/reserve/2nd/{z}/{x}/{y}.png',
        extents: [
          { height: [22.1, 25.7], bounds: [[[1, 164], [-17, 199]]] },
          { height: [-3.5, -0.64], bounds: [[[-77, 26], [-177, 106]], [[-104, -37], [-177, 5]], [[99, -50], [-2, 7]]] }
        ]
      },
      {
        name: '3. Kat',
        svgLayer: null,
        tilePath: 'https://assets.tarkov.dev/maps/reserve/3rd/{z}/{x}/{y}.png',
        extents: [
          { height: [25.7, 29.3], bounds: [[[1, 164], [-17, 199]]] },
          { height: [-0.64, 2.23], bounds: [[[-77, 26], [-177, 106]], [[-104, -37], [-177, 5]], [[99, -50], [-2, 7]]] }
        ]
      }
    ]
  },
  'lighthouse': {
    name: 'Lighthouse',
    normalizedName: 'lighthouse',
    svgPath: 'https://assets.tarkov.dev/maps/svg/Lighthouse.svg',
    svgLayer: 'Ground_Level',
    tilePath: null,
    coordinateRotation: 180,
    bounds: [[515, -998], [-545, 725]],
    transform: [0.2, 0, 0.2, 0],
    minZoom: 1,
    maxZoom: 6,
    layers: []
  },
  'streets-of-tarkov': {
    name: 'Streets of Tarkov',
    normalizedName: 'streets-of-tarkov',
    svgPath: 'https://assets.tarkov.dev/maps/svg/StreetsOfTarkov.svg',
    svgLayer: 'Ground_Level',
    tilePath: null,
    coordinateRotation: 180,
    bounds: [[323, -295], [-280, 532]],
    transform: [0.38, 0, 0.38, 0],
    minZoom: 1,
    maxZoom: 6,
    layers: [
      {
        name: '2. Kat',
        svgLayer: 'Second_Floor',
        tilePath: null,
        extents: [{ height: [10, 15] }]
      },
      {
        name: '3. Kat',
        svgLayer: 'Third_Floor',
        tilePath: null,
        extents: [{ height: [15, 20] }]
      },
      {
        name: 'Yeraltı',
        svgLayer: 'Underground_Level',
        tilePath: null,
        extents: [{ height: [-1000, -6] }]
      }
    ]
  },
  'ground-zero': {
    name: 'Ground Zero',
    normalizedName: 'ground-zero',
    svgPath: 'https://assets.tarkov.dev/maps/svg/GroundZero.svg',
    svgLayer: 'Ground_Level',
    tilePath: 'https://assets.tarkov.dev/maps/groundzero/main_summer/{z}/{x}/{y}.png',
    coordinateRotation: 180,
    bounds: [[249, -124], [-99, 364]],
    transform: [0.524, 167.3, 0.524, 65.1],
    minZoom: 1,
    maxZoom: 6,
    layers: [
      {
        name: '2. Kat',
        svgLayer: 'Second_Floor',
        tilePath: 'https://assets.tarkov.dev/maps/groundzero/2nd/{z}/{x}/{y}.png',
        extents: [{ height: [28, 32.3] }]
      },
      {
        name: '3. Kat',
        svgLayer: 'Third_Floor',
        tilePath: 'https://assets.tarkov.dev/maps/groundzero/3rd/{z}/{x}/{y}.png',
        extents: [{ height: [32.3, 1000] }]
      },
      {
        name: 'Yeraltı Otopark / Geçit (Garage)',
        svgLayer: 'Underground_Level',
        tilePath: 'https://assets.tarkov.dev/maps/groundzero/garage/{z}/{x}/{y}.png',
        extents: [{ height: [-1000, 21] }]
      }
    ]
  },
  'the-lab': {
    name: 'The Lab',
    normalizedName: 'the-lab',
    svgPath: null,
    svgLayer: null,
    tilePath: 'https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png',
    coordinateRotation: 270,
    bounds: [[-80, -477], [-287, -193]],
    transform: [0.575, 281.2, 0.575, 193.7],
    minZoom: 1,
    maxZoom: 6,
    layers: [
      {
        name: '2. Kat (Üst Ofisler)',
        svgLayer: null,
        tilePath: 'https://assets.tarkov.dev/maps/labs_v4/2nd/{z}/{x}/{y}.png',
        extents: [{ height: [3, 1000] }]
      },
      {
        name: 'Teknik Bodrum Katı (Technical)',
        svgLayer: null,
        tilePath: 'https://assets.tarkov.dev/maps/labs_v4/technical/{z}/{x}/{y}.png',
        extents: [{ height: [-1000, -0.9] }]
      }
    ]
  }
};

/**
 * Haritalar üzerindeki önemli bina, bölge (callout) ve ilgi noktası (POI) koordinatları
 * (Oyun içi Unity X, Y, Z koordinatları).
 */
const MAP_CALLOUTS = {
  'customs': [
    { name: '3 Katlı Yurt (3-Story Dorms)', x: 176, y: 2, z: 175 },
    { name: '2 Katlı Yurt (2-Story Dorms)', x: 205, y: 2, z: 140 },
    { name: 'Kale / Fortress (Stronghold)', x: 40, y: 2, z: -20 },
    { name: 'Crackhouse (Tıbbi Bina)', x: -65, y: 2, z: -92 },
    { name: 'Big Red (Gümrük Deposu)', x: -245, y: 2, z: -105 },
    { name: 'Yeni Benzinlik (New Gas)', x: 425, y: 2, z: 45 },
    { name: 'Eski Benzinlik (Old Gas)', x: 280, y: 1, z: -145 },
    { name: 'İnşaat (Construction)', x: 155, y: 1, z: -30 },
    { name: 'RUAF Kontrol Noktası', x: -55, y: 1, z: -15 },
    { name: 'USEC Stash (Yeşil Ekran Binası)', x: 350, y: 2, z: -95 },
    { name: 'Askeri Kontrol Noktası (Checkpoint)', x: 585, y: 2, z: 75 }
  ],
  'woods': [
    { name: 'Kereste Fabrikası (Sawmill)', x: -35, y: -14, z: -215 },
    { name: 'USEC Kampı (USEC Camp)', x: -335, y: 18, z: 325 },
    { name: 'FOB / Tıbbi Kamp (Emercom)', x: 265, y: -6, z: -165 },
    { name: 'Scav Kasabası (Village)', x: 415, y: -10, z: 315 },
    { name: 'Batık Köy (Sunken Village)', x: 105, y: -11, z: 420 },
    { name: 'Scav Sığınağı (Scav Bunker)', x: -210, y: 5, z: 380 },
    { name: 'Keskin Nişancı Kayası (Sniper Rock)', x: 35, y: 34, z: -100 },
    { name: 'Eski Kereste (Old Sawmill)', x: 375, y: -6, z: 50 }
  ],
  'interchange': [
    { name: 'ULTRA AVM Merkez (Kiba / Brutal)', x: 15, y: 28, z: -35 },
    { name: 'OLI Mağazası', x: -10, y: 28, z: -205 },
    { name: 'IDEA Mağazası', x: 35, y: 28, z: 195 },
    { name: 'Goshan Mağazası', x: 145, y: 28, z: -25 },
    { name: 'Elektrik Santrali (Power Station)', x: 365, y: 22, z: 225 },
    { name: 'TECHLIGHT / Rasmussen', x: -35, y: 37, z: -120 }
  ],
  'factory': [
    { name: '3. Kat Ofisler (Office)', x: 18, y: 8, z: 35 },
    { name: 'Pompa Odası (Pumping Station)', x: -8, y: 1, z: 12 },
    { name: 'Tıbbi Çadır (Med Tent)', x: -25, y: 1, z: -10 },
    { name: 'Yeraltı Tünelleri', x: 5, y: -3, z: -15 }
  ],
  'shoreline': [
    { name: 'Sanatoryum (Health Resort - Batı)', x: -295, y: -2, z: -95 },
    { name: 'Sanatoryum (Health Resort - Doğu)', x: -185, y: -2, z: -95 },
    { name: 'Hava İstasyonu (Weather Station)', x: -210, y: 15, z: 165 },
    { name: 'İskele & Tekne (Pier)', x: -325, y: -60, z: 475 },
    { name: 'Hidroelektrik Santrali', x: -225, y: -26, z: 85 },
    { name: 'Köy (Cottages / Village)', x: 265, y: -25, z: 125 },
    { name: 'Kaçakçı Kampı (Smuggler Base)', x: -360, y: -5, z: -340 }
  ],
  'reserve': [
    { name: 'Radar Kubbesi (Dome / Queen)', x: -75, y: 28, z: 195 },
    { name: 'D-2 Yeraltı Komuta Binası', x: -55, y: -14, z: 5 },
    { name: 'Kara Piyon (Black Pawn)', x: -105, y: -4, z: 25 },
    { name: 'Ak Piyon (White Pawn)', x: -35, y: -4, z: 75 },
    { name: 'Karavezir (Black Bishop)', x: -45, y: -4, z: -10 },
    { name: 'Şah (King - Sunucu Binası)', x: 5, y: -4, z: 15 },
    { name: 'Ak At & Kara At (Knights)', x: 75, y: -4, z: -15 },
    { name: 'Tren İstasyonu (Rook)', x: 145, y: -6, z: -115 }
  ],
  'lighthouse': [
    { name: 'Su Arıtma Tesisi (Rogue Camp)', x: 45, y: 4, z: -615 },
    { name: 'Mavi Köşk (UseC Chalet)', x: -95, y: 42, z: -45 },
    { name: 'Üst Köşk (Resort Chalet)', x: -125, y: 58, z: 135 },
    { name: 'Köy (Hillside Village)', x: 85, y: 6, z: -215 },
    { name: 'Deniz Feneri Yarımadası', x: -245, y: 8, z: 580 }
  ],
  'streets-of-tarkov': [
    { name: 'LexOs Oto Galeri (Kaban)', x: 55, y: 2, z: 135 },
    { name: 'Concordia Apartmanları', x: -165, y: 2, z: 285 },
    { name: 'Chekannaya 15', x: -35, y: 2, z: 215 },
    { name: 'Pinewood Otel', x: 155, y: 2, z: 15 },
    { name: 'Beluga Restoran & AVM', x: 145, y: 2, z: -155 },
    { name: 'Terk Edilmiş Fabrika (Marked)', x: 15, y: 2, z: 45 },
    { name: 'Kardinal Apartmanları', x: 165, y: 2, z: 395 }
  ],
  'ground-zero': [
    { name: 'TerraGroup Merkez Binası', x: 95, y: 24, z: 25 },
    { name: 'Tarbank Şubesi', x: 15, y: 24, z: 165 },
    { name: 'Empire Binası', x: 75, y: 24, z: 145 },
    { name: 'Capital Insight', x: 35, y: 24, z: 265 },
    { name: 'Nakatani Plaza', x: 95, y: 24, z: 315 },
    { name: 'Emercom Tıbbi Çadırı', x: 156, y: 25, z: -83 }
  ],
  'the-lab': [
    { name: 'Yönetici Ofisleri (Manager Office)', x: -185, y: 1, z: -335 },
    { name: 'Yeşil / Siyah Odası (Dome)', x: -225, y: 1, z: -365 },
    { name: 'Kırmızı / Mor Odası', x: -215, y: 5, z: -285 },
    { name: 'Otopark Kapısı (Parking Gate)', x: -145, y: 1, z: -275 },
    { name: 'Kargo Asansörü (Hangar Gate)', x: -145, y: 1, z: -395 }
  ]
};

function gamePosToLatLngArray(position) {
  if (!position || typeof position.x !== 'number' || typeof position.z !== 'number') {
    return [0, 0];
  }
  return [position.z, position.x];
}

function mapBoundsToLeafletBounds(bounds) {
  if (!bounds || bounds.length < 2) {
    return [[-500, -500], [500, 500]];
  }
  return [
    [bounds[0][1], bounds[0][0]],
    [bounds[1][1], bounds[1][0]]
  ];
}

function rotateLatLng(lat, lng, rotationDeg) {
  if (!rotationDeg) return { lat, lng };
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotatedX = lng * cos - lat * sin;
  const rotatedY = lng * sin + lat * cos;
  return { lat: rotatedY, lng: rotatedX };
}

/**
 * AŞAMA 4: Oyuncu konumundan ve bakış açısından (Yaw) seçili hedefe olan:
 * - Yatay mesafeyi (metre),
 * - Dikey yükseklik (Y) farkını ve kat etiketini ("yukarıda" / "aşağıda" / "aynı kat"),
 * - Oyuncunun baktığı yöne göre hedefin göreli açısını (-180..+180) ve Türkçe yön açıklamasını
 *   ("35° sağda", "20° solda", "tam karşıda", "arkanızda") hesaplar.
 *
 * @param {{x: number, y?: number, z: number}} playerPos
 * @param {number} playerYawDeg - Oyuncunun baktığı açı (0..360)
 * @param {{x: number, y?: number, z: number}} targetPos
 */
function calculateNavigationToTarget(playerPos, playerYawDeg, targetPos) {
  if (!playerPos || !targetPos) return null;

  const dx = targetPos.x - playerPos.x;
  const dz = targetPos.z - playerPos.z;
  const dy = (targetPos.y ?? 0) - (playerPos.y ?? 0);

  const horizontalDistance = Math.round(Math.hypot(dx, dz));
  const totalDistance = Math.round(Math.hypot(dx, dy, dz));
  const elevationDiff = Number(dy.toFixed(1));

  // Unity koordinatlarında (+Z = 0°, +X = 90°) hedefe mutlak açı (bearing):
  let targetBearing = (Math.atan2(dx, dz) * 180) / Math.PI;
  targetBearing = (targetBearing + 360) % 360;

  // Oyuncunun baktığı yöne (playerYawDeg) göre göreli açı (-180..+180)
  // Pozitif = Sağda, Negatif = Solda
  let relativeAngle = targetBearing - (playerYawDeg || 0);
  while (relativeAngle > 180) relativeAngle -= 360;
  while (relativeAngle < -180) relativeAngle += 360;
  relativeAngle = Math.round(relativeAngle);

  const absRel = Math.abs(relativeAngle);
  let relativeText = '';
  if (absRel <= 10) {
    relativeText = 'Tam karşıda';
  } else if (absRel >= 155) {
    relativeText = `Arkanızda (${absRel}°)`;
  } else if (relativeAngle > 0) {
    relativeText = `${absRel}° sağda`;
  } else {
    relativeText = `${absRel}° solda`;
  }

  // Çok katlı binalar için Y farkı kontrolü (±2.2 metre eşiği)
  let elevationText = 'Aynı hizada';
  let elevationStatus = 'same'; // 'up' | 'down' | 'same'
  if (elevationDiff >= 2.2) {
    elevationText = `▲ ${elevationDiff}m yukarıda`;
    elevationStatus = 'up';
  } else if (elevationDiff <= -2.2) {
    elevationText = `▼ ${Math.abs(elevationDiff)}m aşağıda`;
    elevationStatus = 'down';
  }

  return {
    horizontalDistance,
    totalDistance,
    elevationDiff,
    elevationText,
    elevationStatus,
    targetBearing: Math.round(targetBearing),
    relativeAngle,
    relativeText
  };
}

/**
 * Oyuncunun 3B konumuna (X, Y, Z) göre bulunduğu binadaki kat katmanını (2. Kat, 3. Kat, Yeraltı / Sığınak vb.)
 * tarkov.dev'in resmi kat yükseklik (height) ve bina sınır (bounds) verileriyle tespit eder.
 */
function detectActiveFloorLayer(geoConfig, position) {
  if (!geoConfig || !Array.isArray(geoConfig.layers) || geoConfig.layers.length === 0 || !position) {
    return null;
  }

  const px = position.x;
  const py = position.y ?? 0;
  const pz = position.z;

  for (const layer of geoConfig.layers) {
    if (!Array.isArray(layer.extents)) continue;
    for (const ext of layer.extents) {
      if (!Array.isArray(ext.height) || ext.height.length < 2) continue;
      const minY = Math.min(ext.height[0], ext.height[1]);
      const maxY = Math.max(ext.height[0], ext.height[1]);
      if (py < minY || py > maxY) continue;

      if (!Array.isArray(ext.bounds) || ext.bounds.length === 0) {
        return layer;
      }

      for (const box of ext.bounds) {
        if (!Array.isArray(box) || box.length < 2) continue;
        const p1 = box[0];
        const p2 = box[1];
        if (!Array.isArray(p1) || !Array.isArray(p2)) continue;
        const minX = Math.min(p1[0], p2[0]);
        const maxX = Math.max(p1[0], p2[0]);
        const minZ = Math.min(p1[1], p2[1]);
        const maxZ = Math.max(p1[1], p2[1]);

        if (px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) {
          return layer;
        }
      }
    }
  }

  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAP_CONFIGS,
    MAP_CALLOUTS,
    gamePosToLatLngArray,
    mapBoundsToLeafletBounds,
    rotateLatLng,
    calculateNavigationToTarget,
    detectActiveFloorLayer
  };
}

if (typeof window !== 'undefined') {
  window.TarkovGeo = {
    MAP_CONFIGS,
    MAP_CALLOUTS,
    gamePosToLatLngArray,
    mapBoundsToLeafletBounds,
    rotateLatLng,
    calculateNavigationToTarget,
    detectActiveFloorLayer
  };
}
