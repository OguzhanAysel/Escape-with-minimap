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
    { name: 'Kale / Fortress (ZB-1013)', x: 40, y: 2, z: -20 },
    { name: 'Crackhouse (Tıbbi Bina)', x: -65, y: 2, z: -92 },
    { name: 'Big Red (Gümrük Deposu)', x: -245, y: 2, z: -105 },
    { name: 'Yeni Benzinlik (New Gas)', x: 425, y: 2, z: 45 },
    { name: 'Eski Benzinlik (Old Gas)', x: 311, y: 1, z: -165 },
    { name: 'İnşaat (Construction / Cep)', x: 155, y: 1, z: -30 },
    { name: 'RUAF Kontrol Noktası', x: -10, y: 1, z: -135 },
    { name: 'USEC Stash (Yeşil Ekran Binası)', x: 350, y: 2, z: -95 },
    { name: 'Askeri Kontrol Noktası (Military CP)', x: 585, y: 2, z: 75 },
    { name: 'ZB-1011 Sığınağı', x: 540, y: 1, z: -115 },
    { name: 'ZB-1012 Sığınağı', x: 390, y: 1, z: -115 },
    { name: 'Depo 4 (Warehouse 4 / Power)', x: 245, y: 2, z: -80 },
    { name: 'Depo 17 (Warehouse 17)', x: 115, y: 2, z: -130 },
    { name: 'Garajlar (Storage Garages)', x: -315, y: 2, z: -40 },
    { name: 'Römork Parkı (Trailer Park)', x: -345, y: 2, z: -155 },
    { name: 'Kaçakçı Teknesi (Smuggler Boat)', x: 35, y: -2, z: 165 }
  ],
  'woods': [
    { name: 'Kereste Fabrikası (Sawmill)', x: -2, y: 8, z: -139 },
    { name: 'Eski Kereste (Old Sawmill)', x: -495, y: 21, z: -263 },
    { name: 'Tren Deposu (Train Depot)', x: -633, y: 8, z: 141 },
    { name: 'USEC Kampı (USEC Camp)', x: 345, y: 25, z: -435 },
    { name: 'USEC Kontrol Noktası (SUV)', x: 240, y: -2, z: -65 },
    { name: 'FOB / Tıbbi Kamp (Emercom Base)', x: -139, y: -6, z: 243 },
    { name: 'Scav Sığınağı & Konvoy (Scav Bunker)', x: 200, y: 23, z: -710 },
    { name: 'Batık Köy (Sunken Village)', x: -176, y: 12, z: -667 },
    { name: 'Scav Kasabası (Car Extract Köyü)', x: -420, y: 15, z: -480 },
    { name: 'Scav Evi (Scav House)', x: 414, y: -12, z: 242 },
    { name: 'Keskin Nişancı Kayası (Sniper Rock)', x: -65, y: 38, z: -200 },
    { name: 'Merkez Kavşak (Junction)', x: -94, y: 26, z: -389 },
    { name: 'Dağ Zulası (Mountain Stash)', x: -210, y: 31, z: -214 },
    { name: 'ZB-014 (Anahtarlı Sığınak)', x: 447, y: -13, z: 62 },
    { name: 'ZB-016 (Doğu Sığınağı)', x: -389, y: 4, z: 18 },
    { name: 'Eski İstasyon (Old Station)', x: -518, y: 10, z: 149 },
    { name: 'Ölü Adamın Yeri (Dead Man Place)', x: 195, y: -16, z: 259 },
    { name: 'Uçak Enkazı (Plane Crash)', x: -265, y: 14, z: -45 }
  ],
  'interchange': [
    { name: 'ULTRA AVM Merkez (Kiba / Brutal)', x: 15, y: 28, z: -35 },
    { name: 'IDEA Mağazası', x: 25, y: 28, z: -243 },
    { name: 'OLI Mağazası', x: -3, y: 28, z: 100 },
    { name: 'Goshan Mağazası', x: -62, y: 28, z: -99 },
    { name: 'Elektrik Santrali (Power Station)', x: -252, y: 22, z: -367 },
    { name: 'TECHLIGHT / Texho / Rasmussen', x: -15, y: 37, z: 55 },
    { name: 'Mantis / Emercom Tıbbi', x: 20, y: 28, z: -10 },
    { name: 'Ulusal / Brutal / Killa Bölgesi', x: 5, y: 28, z: -65 },
    { name: 'Güvenli Oda (#11SR Keycard)', x: -48, y: 21, z: 44 },
    { name: 'Scav Kampı (Co-Op)', x: -97, y: 22, z: -73 }
  ],
  'factory': [
    { name: '3. Kat Ofisler & Kasa (Office)', x: 18, y: 8, z: 35 },
    { name: 'Pompa Odası (Pumping Station)', x: -8, y: 1, z: 12 },
    { name: 'Tıbbi Çadır (Med Tent)', x: -18, y: 1, z: -55 },
    { name: 'Yeraltı Tünelleri & Mahzen', x: 55, y: -3, z: -25 },
    { name: 'Kapı 3 (Gate 3)', x: 58, y: 1, z: 61 },
    { name: 'Kapı 0 (Gate 0)', x: -45, y: 1, z: 35 },
    { name: 'Postacı Cesedi (Postman Pat)', x: 12, y: 1, z: 22 }
  ],
  'shoreline': [
    { name: 'Sanatoryum Batı Kanadı (West Wing)', x: -295, y: -2, z: -95 },
    { name: 'Sanatoryum Doğu Kanadı (East Wing)', x: -185, y: -2, z: -95 },
    { name: 'Sanatoryum Yönetim (Admin)', x: -255, y: -2, z: -145 },
    { name: 'Hava İstasyonu (Weather Station)', x: -210, y: 15, z: 165 },
    { name: 'İskele & Tekne (Pier Boat)', x: -325, y: -60, z: 475 },
    { name: 'Hidroelektrik Santrali (Power)', x: -225, y: -26, z: 85 },
    { name: 'Lüks Villalar (Cottages / Sanitar)', x: 215, y: -25, z: 145 },
    { name: 'Köy (Village / Svetliy)', x: 385, y: -25, z: 125 },
    { name: 'Bataklık Köyü (Swamp)', x: 295, y: -22, z: -185 },
    { name: 'Kaçakçı Kampı (Smuggler Base)', x: -580, y: -5, z: -260 },
    { name: 'Benzin İstasyonu (Gas Station)', x: -290, y: -55, z: 345 },
    { name: 'Scav Adası (Scav Island)', x: 185, y: -60, z: 420 },
    { name: 'Radyo Kulesi (Radio Tower)', x: -435, y: 18, z: 95 }
  ],
  'reserve': [
    { name: 'Radar Kubbesi (Dome / Queen)', x: -9, y: 28, z: 200 },
    { name: 'D-2 Yeraltı Sığınağı', x: -121, y: -18, z: 172 },
    { name: 'Yeraltı Komuta Odası (Bunker)', x: -115, y: -14, z: 34 },
    { name: 'Kara Piyon (Black Pawn - RB-BK)', x: -105, y: -4, z: 25 },
    { name: 'Ak Piyon (White Pawn)', x: -35, y: -4, z: 75 },
    { name: 'Karavezir (Black Bishop - Drop Down)', x: -45, y: -4, z: -10 },
    { name: 'Ak Vezir (White Bishop - Tıbbi)', x: -115, y: -4, z: -45 },
    { name: 'Şah (King - Sunucu Binası)', x: 5, y: -4, z: 15 },
    { name: 'Ak At & Kara At (Knights - Garaj)', x: 75, y: -4, z: -15 },
    { name: 'Tren İstasyonu (Rook)', x: 135, y: -6, z: -140 },
    { name: 'Hermetik Sığınak Kapısı (Bunker Door)', x: 65, y: -6, z: -120 },
    { name: 'Kazan Dairesi (Heating Pipe)', x: -35, y: -6, z: -180 }
  ],
  'lighthouse': [
    { name: 'Su Arıtma Tesisi (Rogue Camp)', x: -50, y: 4, z: -575 },
    { name: 'Bina 1 (Rogue KuzeyDoğu)', x: 35, y: 4, z: -640 },
    { name: 'Bina 2 (Rogue Batı)', x: -145, y: 4, z: -640 },
    { name: 'Bina 3 (Rogue GüneyDoğu)', x: 35, y: 4, z: -520 },
    { name: 'Tren İstasyonu & Zırhlı Tren', x: -6, y: 4, z: -870 },
    { name: 'Mavi Köşk (USEC Chalet)', x: -95, y: 42, z: -45 },
    { name: 'Üst Köşk (Pride Chalet)', x: -70, y: 58, z: 132 },
    { name: 'Köy (Hillside Village)', x: 15, y: 6, z: -380 },
    { name: 'Sahil Evleri (Merin / Landing)', x: 130, y: 2, z: 280 },
    { name: 'Deniz Feneri Yarımadası (Lightkeeper)', x: 165, y: 8, z: 540 }
  ],
  'streets-of-tarkov': [
    { name: 'LexOs Oto Galeri (Kaban)', x: 55, y: 2, z: 135 },
    { name: 'Concordia Apartmanları', x: -165, y: 2, z: 285 },
    { name: 'Chekannaya 15 (Chek 15)', x: -35, y: 2, z: 215 },
    { name: 'Pinewood Otel', x: -114, y: 2, z: 65 },
    { name: 'Klimov AVM (Kollontay)', x: -164, y: 2, z: -6 },
    { name: 'Beluga Restoran', x: -120, y: 2, z: -155 },
    { name: 'Terk Edilmiş Fabrika (Marked Room)', x: 15, y: 2, z: 45 },
    { name: 'Kardinal Apartmanları & Banka', x: 105, y: 2, z: -161 },
    { name: 'Sinema (Rodina Cinema)', x: -245, y: 2, z: 210 },
    { name: 'Postane & Tarbank', x: 131, y: 2, z: 232 },
    { name: 'Çökmüş Vinç (Collapsed Crane)', x: 216, y: 2, z: 273 }
  ],
  'ground-zero': [
    { name: 'TerraGroup Merkez Binası', x: -21, y: 24, z: -25 },
    { name: 'Tarbank Şubesi', x: 40, y: 24, z: 141 },
    { name: 'Empire Binası (Utyos)', x: 57, y: 24, z: 131 },
    { name: 'Capital Insight (AGS)', x: 101, y: 24, z: 276 },
    { name: 'Nakatani Plaza', x: -16, y: 24, z: 335 },
    { name: 'Fusion Restoran', x: 4, y: 24, z: 210 },
    { name: 'Şarap Dükkanı (Wine Store)', x: 117, y: 24, z: 27 },
    { name: 'Skyside Binası', x: 191, y: 24, z: 133 },
    { name: 'Mira Bulvarı (Yeşil Fişek Çıkışı)', x: 218, y: 24, z: -39 },
    { name: 'Emercom Tıbbi Çadırı', x: 156, y: 25, z: -83 }
  ],
  'the-lab': [
    { name: 'Yönetici Ofisleri (Manager Office)', x: -171, y: 1, z: -283 },
    { name: 'Yeşil / Siyah Odası & Dome', x: -172, y: 1, z: -371 },
    { name: 'Kırmızı / Mor Odası (Red / Violet)', x: -183, y: 5, z: -313 },
    { name: 'Sanitar Odası & İnsan Deney Alanı', x: -132, y: 1, z: -348 },
    { name: 'Sunucu Odası (Server Room)', x: -127, y: 1, z: -309 },
    { name: 'Otopark Kapısı (Parking Gate)', x: -231, y: 1, z: -458 },
    { name: 'Hangar Kapısı (Hangar Gate)', x: -170, y: 1, z: -219 },
    { name: 'Kargo Asansörü (Cargo Elevator)', x: -112, y: 1, z: -409 },
    { name: 'Tıbbi Blok Asansörü', x: -112, y: -3, z: -344 },
    { name: 'Ana Asansör (Main Elevator)', x: -283, y: -3, z: -335 }
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
 * Haritalardaki geçilemeyen nehir / göl / duvar engelleri (Köprü geçişlerini açık bırakır)
 */
const STATIC_MAP_OBSTACLES = {
  customs: [
    // Nehir: Köprüler (z: [-110,-75], [-35,10], [45,75], [115,145]) dışındaki su kesimleri
    { minX: -120, maxX: -80, minZ: -250, maxZ: -112 },
    { minX: -120, maxX: -80, minZ: -73, maxZ: -36 },
    { minX: -120, maxX: -80, minZ: 12, maxZ: 43 },
    { minX: -120, maxX: -80, minZ: 77, maxZ: 113 },
    { minX: -120, maxX: -80, minZ: 147, maxZ: 260 }
  ],
  woods: [
    // Güney Merkez Gölü (Sawyer Lake)
    { minX: -175, maxX: 165, minZ: -420, maxZ: -215 }
  ],
  shoreline: [
    // Merkez Nehir: Köprüler (z: [-130,-85], [20,75], [275,360]) dışındaki su kesimleri
    { minX: -108, maxX: -68, minZ: -380, maxZ: -132 },
    { minX: -108, maxX: -68, minZ: -83, maxZ: 18 },
    { minX: -108, maxX: -68, minZ: 77, maxZ: 273 }
  ]
};

function buildObstacleAabbs(hazards = [], mapNorm = '') {
  const boxes = [];
  const margin = 6; // Mayın/Sniper bölgelerinden 6m güvenli mesafe

  for (const hz of hazards || []) {
    if (Array.isArray(hz.outline) && hz.outline.length >= 3) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const pt of hz.outline) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
      if (Number.isFinite(minX)) {
        boxes.push({
          minX: minX - margin,
          maxX: maxX + margin,
          minZ: minZ - margin,
          maxZ: maxZ + margin
        });
      }
    } else if (hz.position) {
      const r = 16;
      boxes.push({
        minX: hz.position.x - r,
        maxX: hz.position.x + r,
        minZ: hz.position.z - r,
        maxZ: hz.position.z + r
      });
    }
  }

  const staticBoxes = STATIC_MAP_OBSTACLES[mapNorm] || [];
  for (const sb of staticBoxes) {
    boxes.push(sb);
  }
  return boxes;
}

function isPointInsideBox(x, z, box) {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

function doesSegmentIntersectBox(x1, z1, x2, z2, box) {
  // Liang-Barsky segment-AABB kesişim testi
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const p = [-dx, dx, -dz, dz];
  const q = [x1 - box.minX, box.maxX - x1, z1 - box.minZ, box.maxZ - z1];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

function isLineOfSightClear(x1, z1, x2, z2, boxes) {
  for (const b of boxes) {
    // Başlangıç veya bitiş noktasının kendisi kutu içindeyse o kutuyu atla ki oyuncu sıkışmasın
    if (isPointInsideBox(x1, z1, b) || isPointInsideBox(x2, z2, b)) continue;
    if (doesSegmentIntersectBox(x1, z1, x2, z2, b)) return false;
  }
  return true;
}

/**
 * Mayın tarlaları, sniper sınırları ve nehir/göl engellerinin etrafından dolaşan
 * hızlı A* + Line-of-Sight yumuşatmalı güvenli rota noktaları üretir.
 */
function computeSafeRouteWaypoints(startPos, targetPos, hazards = [], mapNorm = '') {
  if (!startPos || !targetPos) return [];
  const boxes = buildObstacleAabbs(hazards, mapNorm);
  if (boxes.length === 0 || isLineOfSightClear(startPos.x, startPos.z, targetPos.x, targetPos.z, boxes)) {
    return [startPos, targetPos];
  }

  const geo = MAP_CONFIGS[mapNorm];
  let minX = Math.min(startPos.x, targetPos.x) - 180;
  let maxX = Math.max(startPos.x, targetPos.x) + 180;
  let minZ = Math.min(startPos.z, targetPos.z) - 180;
  let maxZ = Math.max(startPos.z, targetPos.z) + 180;

  if (geo && Array.isArray(geo.bounds)) {
    minX = Math.min(geo.bounds[0][0], geo.bounds[1][0]);
    maxX = Math.max(geo.bounds[0][0], geo.bounds[1][0]);
    minZ = Math.min(geo.bounds[0][1], geo.bounds[1][1]);
    maxZ = Math.max(geo.bounds[0][1], geo.bounds[1][1]);
  }

  const GRID_N = 56;
  const stepX = (maxX - minX) / GRID_N;
  const stepZ = (maxZ - minZ) / GRID_N;
  if (stepX <= 0.1 || stepZ <= 0.1) return [startPos, targetPos];

  const toCell = (x, z) => ({
    cx: Math.max(0, Math.min(GRID_N, Math.round((x - minX) / stepX))),
    cz: Math.max(0, Math.min(GRID_N, Math.round((z - minZ) / stepZ)))
  });
  const toWorld = (cx, cz) => ({
    x: minX + cx * stepX,
    y: startPos.y ?? 0,
    z: minZ + cz * stepZ
  });

  const startCell = toCell(startPos.x, startPos.z);
  const goalCell = toCell(targetPos.x, targetPos.z);
  const keyOf = (cx, cz) => cx * (GRID_N + 1) + cz;
  const startKey = keyOf(startCell.cx, startCell.cz);
  const goalKey = keyOf(goalCell.cx, goalCell.cz);

  const isCellBlocked = (cx, cz) => {
    const k = keyOf(cx, cz);
    if (k === startKey || k === goalKey) return false;
    const wx = minX + cx * stepX;
    const wz = minZ + cz * stepZ;
    for (const b of boxes) {
      if (isPointInsideBox(wx, wz, b)) return true;
    }
    return false;
  };

  const open = [{ cx: startCell.cx, cz: startCell.cz, k: startKey, f: 0 }];
  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const closed = new Set();
  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414]
  ];

  let found = false;
  let iter = 0;
  while (open.length > 0 && iter < 3600) {
    iter++;
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (cur.k === goalKey) {
      found = true;
      break;
    }
    if (closed.has(cur.k)) continue;
    closed.add(cur.k);

    const curG = gScore.get(cur.k) ?? Infinity;
    for (const [dx, dz, cost] of dirs) {
      const nx = cur.cx + dx;
      const nz = cur.cz + dz;
      if (nx < 0 || nx > GRID_N || nz < 0 || nz > GRID_N) continue;
      const nk = keyOf(nx, nz);
      if (closed.has(nk) || isCellBlocked(nx, nz)) continue;

      const tentativeG = curG + cost;
      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, cur);
        gScore.set(nk, tentativeG);
        const h = Math.hypot(goalCell.cx - nx, goalCell.cz - nz);
        open.push({ cx: nx, cz: nz, k: nk, f: tentativeG + h });
      }
    }
  }

  if (!found) {
    return [startPos, targetPos];
  }

  const rawPoints = [targetPos];
  let traceKey = goalKey;
  while (cameFrom.has(traceKey)) {
    const prev = cameFrom.get(traceKey);
    if (prev.k === startKey) break;
    rawPoints.push(toWorld(prev.cx, prev.cz));
    traceKey = prev.k;
  }
  rawPoints.push(startPos);
  rawPoints.reverse();

  // Line-of-Sight String Pulling ile gereksiz ara noktaları temizle
  const smoothed = [rawPoints[0]];
  let anchorIdx = 0;
  while (anchorIdx < rawPoints.length - 1) {
    let nextIdx = anchorIdx + 1;
    for (let testIdx = rawPoints.length - 1; testIdx > anchorIdx + 1; testIdx--) {
      if (isLineOfSightClear(rawPoints[anchorIdx].x, rawPoints[anchorIdx].z, rawPoints[testIdx].x, rawPoints[testIdx].z, boxes)) {
        nextIdx = testIdx;
        break;
      }
    }
    smoothed.push(rawPoints[nextIdx]);
    anchorIdx = nextIdx;
  }

  return smoothed;
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
 * @param {Array} [hazards]
 * @param {string} [mapNorm]
 */
function calculateNavigationToTarget(playerPos, playerYawDeg, targetPos, hazards = [], mapNorm = '') {
  if (!playerPos || !targetPos) return null;

  const waypoints = computeSafeRouteWaypoints(playerPos, targetPos, hazards, mapNorm);
  const steerPoint = waypoints.length >= 2 ? waypoints[1] : targetPos;

  let pathDistance = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    pathDistance += Math.hypot(waypoints[i + 1].x - waypoints[i].x, waypoints[i + 1].z - waypoints[i].z);
  }

  const dx = steerPoint.x - playerPos.x;
  const dz = steerPoint.z - playerPos.z;
  const dy = (targetPos.y ?? 0) - (playerPos.y ?? 0);

  const horizontalDistance = Math.round(pathDistance || Math.hypot(targetPos.x - playerPos.x, targetPos.z - playerPos.z));
  const totalDistance = Math.round(Math.hypot(horizontalDistance, dy));
  const elevationDiff = Number(dy.toFixed(1));

  // Unity koordinatlarında (+Z = 0°, +X = 90°) ilk güvenli dönüş noktasına mutlak açı (bearing):
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
    relativeText,
    waypoints
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
    computeSafeRouteWaypoints,
    detectActiveFloorLayer,
    // Rotasyon planlayıcısı (main.js) tehlike bölgesi maliyeti için kullanır
    buildObstacleAabbs,
    isPointInsideBox,
    doesSegmentIntersectBox
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
    computeSafeRouteWaypoints,
    detectActiveFloorLayer
  };
}
