const fs = require('fs');
const path = require('path');
const { MAP_CONFIGS } = require('../geo/coordinates');

const GRAPHQL_ENDPOINT = 'https://api.tarkov.dev/graphql';
const JSON_MIRROR_ENDPOINT = 'https://json.tarkov.dev/';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 saat önbellek süresi

/**
 * 1) Şema Introspection Sorgusu (__schema, __type)
 * Map, Item, Task ve TaskObjective* tiplerinin alanlarını doğrular.
 */
const INTROSPECTION_QUERY = `
query IntrospectTarkovSchema {
  MapType: __type(name: "Map") {
    name
    fields { name }
  }
  ItemType: __type(name: "Item") {
    name
    fields { name }
  }
  TaskType: __type(name: "Task") {
    name
    fields { name }
  }
  TaskObjectiveType: __type(name: "TaskObjective") {
    name
    possibleTypes { name }
    fields { name }
  }
}
`;

/**
 * 2) Şema Introspection ile doğrulanmış GraphQL Sorgusu
 * - maps: id, name, normalizedName, lootLoose { position { x y z } items { id } }, lootContainers { position { x y z } lootContainer { id name normalizedName } }, extracts, locks
 * - items: id, name, shortName, normalizedName, width, height, iconLink, avg24hPrice, lastLowPrice, sellFor { price priceRUB currency vendor { name normalizedName } }
 * - tasks: id, name, normalizedName, trader { name }, map { id name normalizedName }, neededKeys { keys { id name shortName iconLink } map { id normalizedName } }, objectives { id type description optional maps { id name normalizedName } ... on TaskObjectiveItem { count foundInRaid items { id name shortName iconLink } zones { id position { x y z } map { id normalizedName } } } ... on TaskObjectiveQuestItem { count questItem { id name shortName iconLink } possibleLocations { map { id normalizedName } positions { x y z } } zones { id position { x y z } map { id normalizedName } } } ... on TaskObjectiveMark { markerItem { id name shortName iconLink } zones { id position { x y z } map { id normalizedName } } } ... on TaskObjectiveShoot { count targetNames shotType zoneNames zones { id position { x y z } map { id normalizedName } } } ... on TaskObjectiveBasic { zones { id position { x y z } map { id normalizedName } } } ... on TaskObjectiveUseItem { count zones { id position { x y z } map { id normalizedName } } } ... on TaskObjectiveExtract { exitName zoneNames } }
 */
function buildGraphQLDataQuery(lang = 'tr', gameMode = 'regular') {
  return `
  query TarkovOverlayData {
    maps(lang: ${lang}, gameMode: ${gameMode}) {
      id
      name
      normalizedName
      raidDuration
      players
      lootLoose {
        position { x y z }
        items { id }
      }
      lootContainers {
        position { x y z }
        lootContainer {
          id
          name
          normalizedName
        }
      }
      extracts {
        id
        name
        faction
        position { x y z }
      }
      transits {
        id
        description
        position { x y z }
      }
    }
    items(lang: ${lang}, gameMode: ${gameMode}) {
      id
      name
      shortName
      normalizedName
      width
      height
      iconLink
      baseImageLink
      avg24hPrice
      lastLowPrice
      types
      sellFor {
        price
        priceRUB
        currency
        vendor {
          name
          normalizedName
        }
      }
    }
    tasks(lang: ${lang}, gameMode: ${gameMode}) {
      id
      name
      normalizedName
      minPlayerLevel
      wikiLink
      trader {
        id
        name
        normalizedName
      }
      map {
        id
        name
        normalizedName
      }
      neededKeys {
        map { id normalizedName }
        keys { id name shortName iconLink }
      }
      taskRequirements {
        task { id name normalizedName }
        status
      }
      objectives {
        id
        type
        description
        optional
        maps { id name normalizedName }
        ... on TaskObjectiveBasic {
          zones { id position { x y z } map { id normalizedName } }
          requiredKeys { id name shortName iconLink }
        }
        ... on TaskObjectiveItem {
          count
          foundInRaid
          items { id name shortName iconLink }
          zones { id position { x y z } map { id normalizedName } }
          requiredKeys { id name shortName iconLink }
        }
        ... on TaskObjectiveQuestItem {
          count
          questItem { id name shortName iconLink }
          possibleLocations {
            map { id normalizedName }
            positions { x y z }
          }
          zones { id position { x y z } map { id normalizedName } }
          requiredKeys { id name shortName iconLink }
        }
        ... on TaskObjectiveMark {
          markerItem { id name shortName iconLink }
          zones { id position { x y z } map { id normalizedName } }
          requiredKeys { id name shortName iconLink }
        }
        ... on TaskObjectiveShoot {
          count
          targetNames
          shotType
          zoneNames
          zones { id position { x y z } map { id normalizedName } }
          requiredKeys { id name shortName iconLink }
        }
        ... on TaskObjectiveUseItem {
          count
          zoneNames
          zones { id position { x y z } map { id normalizedName } }
          requiredKeys { id name shortName iconLink }
        }
        ... on TaskObjectiveExtract {
          count
          exitName
          zoneNames
          requiredKeys { id name shortName iconLink }
        }
      }
    }
  }
  `;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GraphQL sunucusu (api.tarkov.dev/graphql) Cloudflare 503 döndürdüğünde,
 * resmi tarkov.dev ön yüzünün kullandığı json.tarkov.dev statik veri uç noktalarından
 * birebir aynı şemayı oluşturur.
 */
async function fetchFromOfficialTarkovDevJsonMirror(lang = 'tr', gameMode = 'regular', logFn = () => {}) {
  const mode = gameMode === 'pve' ? 'pve' : 'regular';
  const primaryLang = lang === 'tr' ? 'tr' : 'en';

  logFn('info', `Tarkov.dev statik veri katmanından (${mode}, dil: ${primaryLang}) veriler indiriliyor...`);

  const fetchLocalized = async (endpointPath) => {
    const [baseRes, langRes, enRes] = await Promise.all([
      fetchJsonWithTimeout(`${JSON_MIRROR_ENDPOINT}${endpointPath}`),
      fetchJsonWithTimeout(`${JSON_MIRROR_ENDPOINT}${endpointPath}_${primaryLang}`).catch(() => null),
      primaryLang !== 'en'
        ? fetchJsonWithTimeout(`${JSON_MIRROR_ENDPOINT}${endpointPath}_en`).catch(() => null)
        : Promise.resolve(null)
    ]);
    const dictPrimary = (langRes && langRes.data) || {};
    const dictFallback = (enRes && enRes.data) || {};
    const tr = (key) => {
      if (!key || typeof key !== 'string') return key || '';
      return dictPrimary[key] ?? dictFallback[key] ?? key;
    };
    return { data: baseRes.data, tr };
  };

  const [mapsBundle, itemsBundle, tradersBundle, tasksBundle] = await Promise.all([
    fetchLocalized(`${mode}/maps`),
    fetchLocalized(`${mode}/items`),
    fetchLocalized(`${mode}/traders`),
    fetchLocalized(`${mode}/tasks`)
  ]);

  // 1) Traders sözlüğü
  const tradersById = {};
  for (const [id, rawTrader] of Object.entries(tradersBundle.data || {})) {
    tradersById[id] = {
      id,
      name: tradersBundle.tr(rawTrader.name),
      normalizedName: rawTrader.normalizedName
    };
  }

  // 2) Items sözlüğü ve listesi
  const flea = itemsBundle.data.fleaMarket || {
    name: 'Flea Market',
    normalizedName: 'flea-market',
    minPlayerLevel: 15,
    sellOfferFeeRate: 0.05,
    sellRequirementFeeRate: 0.05
  };

  const itemsById = {};
  const itemsList = [];

  for (const rawItem of Object.values(itemsBundle.data.items || {})) {
    if (rawItem.types && rawItem.types.includes('disabled')) continue;

    const sellFor = [];
    const fleaPrice = rawItem.lastLowPrice || rawItem.avg24hPrice || 0;
    if (fleaPrice > 0 && !(rawItem.types || []).includes('noFlea')) {
      sellFor.push({
        price: fleaPrice,
        priceRUB: fleaPrice,
        currency: 'RUB',
        vendor: {
          name: 'Flea Market',
          normalizedName: 'flea-market'
        }
      });
    }

    for (const offer of rawItem.sellToTrader || []) {
      const trInfo = tradersById[offer.trader] || { name: 'Trader', normalizedName: 'trader' };
      sellFor.push({
        price: offer.price,
        priceRUB: offer.priceRUB,
        currency: offer.currency || 'RUB',
        vendor: {
          name: trInfo.name,
          normalizedName: trInfo.normalizedName
        }
      });
    }

    const itemObj = {
      id: rawItem.id,
      name: itemsBundle.tr(rawItem.name),
      shortName: itemsBundle.tr(rawItem.shortName),
      normalizedName: rawItem.normalizedName,
      width: rawItem.width || 1,
      height: rawItem.height || 1,
      iconLink: rawItem.iconLink || rawItem.baseImageLink || '',
      baseImageLink: rawItem.baseImageLink || rawItem.iconLink || '',
      avg24hPrice: rawItem.avg24hPrice || 0,
      lastLowPrice: rawItem.lastLowPrice || 0,
      basePrice: rawItem.basePrice || 0,
      minLevelForFlea: rawItem.minLevelForFlea || 15,
      types: rawItem.types || [],
      sellFor
    };

    itemsById[itemObj.id] = itemObj;
    itemsList.push(itemObj);
  }

  // 3) Maps ve Loot
  const containersDict = mapsBundle.data.lootContainers || {};
  const mapsById = {};
  const mapsList = [];

  for (const rawMap of Object.values(mapsBundle.data.maps || {})) {
    const geoConfig = MAP_CONFIGS[rawMap.normalizedName] || null;
    const mapObj = {
      id: rawMap.id,
      name: mapsBundle.tr(rawMap.name),
      normalizedName: rawMap.normalizedName,
      raidDuration: rawMap.raidDuration,
      players: rawMap.players,
      bounds: geoConfig ? geoConfig.bounds : null,
      coordinateRotation: geoConfig ? geoConfig.coordinateRotation : 180,
      transform: geoConfig ? geoConfig.transform : null,
      svgPath: geoConfig ? geoConfig.svgPath : null,
      svgLayer: geoConfig ? geoConfig.svgLayer : null,
      tilePath: geoConfig ? geoConfig.tilePath : null,
      lootLoose: (rawMap.lootLoose || []).map((ll) => ({
        position: ll.position,
        items: (ll.items || []).map((id) => ({ id: typeof id === 'string' ? id : id.id }))
      })),
      lootContainers: (rawMap.lootContainers || []).map((lc) => {
        const cId = typeof lc.lootContainer === 'string' ? lc.lootContainer : lc.lootContainer?.id;
        const cRaw = containersDict[cId] || {};
        return {
          position: lc.position,
          lootContainer: {
            id: cId,
            name: mapsBundle.tr(cRaw.name) || 'Container',
            normalizedName: cRaw.normalizedName || 'container'
          }
        };
      }),
      extracts: (rawMap.extracts || []).map((ex) => ({
        id: ex.id,
        name: mapsBundle.tr(ex.name),
        faction: ex.faction,
        position: ex.position
      })),
      transits: (rawMap.transits || []).map((trItem) => ({
        id: trItem.id,
        description: mapsBundle.tr(trItem.description),
        position: trItem.position
      }))
    };

    mapsById[mapObj.id] = mapObj;
    mapsList.push(mapObj);
  }

  // 4) Tasks & Objectives
  const questItemsDict = tasksBundle.data.questItems || {};
  const tasksList = [];

  for (const rawTask of Object.values(tasksBundle.data.tasks || {})) {
    const trader = tradersById[rawTask.trader] || { id: rawTask.trader, name: 'Trader', normalizedName: 'trader' };
    const taskMap = rawTask.map && mapsById[rawTask.map]
      ? { id: rawTask.map, name: mapsById[rawTask.map].name, normalizedName: mapsById[rawTask.map].normalizedName }
      : null;

    const neededKeys = (rawTask.neededKeys || []).map((nk) => {
      const mInfo = nk.map && mapsById[nk.map]
        ? { id: nk.map, normalizedName: mapsById[nk.map].normalizedName, name: mapsById[nk.map].name }
        : null;
      const keys = (nk.keys || [])
        .map((kId) => {
          const it = itemsById[kId];
          return it ? { id: it.id, name: it.name, shortName: it.shortName, iconLink: it.iconLink } : null;
        })
        .filter(Boolean);
      return { map: mInfo, keys };
    });

    const taskRequirements = (rawTask.taskRequirements || []).map((req) => ({
      taskId: typeof req.task === 'string' ? req.task : req.task?.id,
      status: req.status || ['complete']
    })).filter((r) => r.taskId);

    const objectives = (rawTask.objectives || []).map((obj) => {
      const objMaps = (obj.maps || [])
        .map((mId) => {
          const m = mapsById[mId];
          return m ? { id: m.id, name: m.name, normalizedName: m.normalizedName } : null;
        })
        .filter(Boolean);

      const zones = (obj.zones || []).map((z) => {
        const zm = z.map && mapsById[z.map]
          ? { id: z.map, normalizedName: mapsById[z.map].normalizedName, name: mapsById[z.map].name }
          : null;
        return {
          id: z.id,
          position: z.position,
          outline: z.outline || [],
          map: zm
        };
      });

      const possibleLocations = (obj.possibleLocations || []).map((loc) => {
        const lm = loc.map && mapsById[loc.map]
          ? { id: loc.map, normalizedName: mapsById[loc.map].normalizedName, name: mapsById[loc.map].name }
          : null;
        return {
          map: lm,
          positions: loc.positions || []
        };
      });

      const objItems = (obj.items || (obj.item ? [obj.item] : []))
        .map((itemId) => {
          const id = typeof itemId === 'string' ? itemId : itemId.id;
          const it = itemsById[id];
          return it ? { id: it.id, name: it.name, shortName: it.shortName, iconLink: it.iconLink } : null;
        })
        .filter(Boolean);

      let questItem = null;
      if (obj.questItem) {
        const qId = typeof obj.questItem === 'string' ? obj.questItem : obj.questItem.id;
        const qRaw = questItemsDict[qId];
        if (qRaw) {
          questItem = {
            id: qRaw.id,
            name: tasksBundle.tr(qRaw.name),
            shortName: tasksBundle.tr(qRaw.shortName),
            iconLink: qRaw.iconLink || qRaw.baseImageLink || ''
          };
        }
      }

      let markerItem = null;
      if (obj.markerItem) {
        const mId = typeof obj.markerItem === 'string' ? obj.markerItem : obj.markerItem.id;
        const mIt = itemsById[mId];
        if (mIt) {
          markerItem = { id: mIt.id, name: mIt.name, shortName: mIt.shortName, iconLink: mIt.iconLink };
        }
      }

      const requiredKeys = (obj.requiredKeys || []).map((keyGroup) =>
        (Array.isArray(keyGroup) ? keyGroup : [keyGroup])
          .map((kId) => {
            const id = typeof kId === 'string' ? kId : kId.id;
            const it = itemsById[id];
            return it ? { id: it.id, name: it.name, shortName: it.shortName, iconLink: it.iconLink } : null;
          })
          .filter(Boolean)
      );

      return {
        id: obj.id,
        type: obj.type,
        description: tasksBundle.tr(obj.description),
        optional: !!obj.optional,
        count: obj.count || 1,
        foundInRaid: !!obj.foundInRaid,
        maps: objMaps,
        zones,
        possibleLocations,
        items: objItems,
        questItem,
        markerItem,
        requiredKeys,
        exitName: obj.exitName ? tasksBundle.tr(obj.exitName) : null
      };
    });

    tasksList.push({
      id: rawTask.id,
      name: tasksBundle.tr(rawTask.name),
      normalizedName: rawTask.normalizedName,
      minPlayerLevel: rawTask.minPlayerLevel || 1,
      wikiLink: rawTask.wikiLink || '',
      trader,
      map: taskMap,
      neededKeys,
      taskRequirements,
      objectives
    });
  }

  return {
    maps: mapsList,
    items: itemsList,
    tasks: tasksList,
    fleaMarket: flea
  };
}

/**
 * Ham API verisini zenginleştirir:
 * - Fiyat & Slot başı değer hesabı: fiyat / (genişlik * yükseklik)
 * - Flea vs En İyi Trader karşılaştırması
 * - Eşyaların hangi haritada kaç loose loot noktasında çıktığının indekslenmesi
 */
function enrichDataset(rawDataset) {
  const maps = rawDataset.maps || [];
  const items = rawDataset.items || [];
  const tasks = rawDataset.tasks || [];

  // Harita bazında loose loot eşya spawn sayıları ve konumları indeksi:
  // itemMapSpawns[itemId][mapNormalizedName] = [{ x, y, z }, ...]
  const itemMapSpawns = {};
  const mapContainerCounts = {};

  for (const m of maps) {
    const normMap = m.normalizedName;
    const geo = MAP_CONFIGS[normMap];
    if (geo) {
      m.bounds = m.bounds || geo.bounds;
      m.coordinateRotation = m.coordinateRotation ?? geo.coordinateRotation;
      m.transform = m.transform || geo.transform;
      m.svgPath = m.svgPath || geo.svgPath;
      m.svgLayer = m.svgLayer || geo.svgLayer;
      m.tilePath = m.tilePath || geo.tilePath;
    }

    mapContainerCounts[normMap] = (m.lootContainers || []).length;

    for (const ll of m.lootLoose || []) {
      if (!ll.position || !ll.items) continue;
      for (const itRef of ll.items) {
        const itemId = typeof itRef === 'string' ? itRef : itRef.id;
        if (!itemId) continue;
        if (!itemMapSpawns[itemId]) itemMapSpawns[itemId] = {};
        if (!itemMapSpawns[itemId][normMap]) itemMapSpawns[itemId][normMap] = [];
        itemMapSpawns[itemId][normMap].push(ll.position);
      }
    }
  }

  // Eşya fiyat, slot başı değer ve harita spawn özetlerini hesapla
  const enrichedItems = items.map((item) => {
    const slots = Math.max(1, (item.width || 1) * (item.height || 1));
    const sellFor = item.sellFor || [];

    const fleaEntry = sellFor.find((s) => s.vendor?.normalizedName === 'flea-market');
    const fleaPrice = fleaEntry
      ? (fleaEntry.priceRUB || fleaEntry.price || 0)
      : (item.lastLowPrice || item.avg24hPrice || 0);
    const fleaAvg24hPrice = item.avg24hPrice || 0;
    const fleaLastLowPrice = item.lastLowPrice || 0;

    const traderEntries = sellFor
      .filter((s) => s.vendor?.normalizedName !== 'flea-market')
      .sort((a, b) => (b.priceRUB || 0) - (a.priceRUB || 0));

    const bestTrader = traderEntries[0]
      ? {
          name: traderEntries[0].vendor?.name || 'Trader',
          normalizedName: traderEntries[0].vendor?.normalizedName || 'trader',
          priceRUB: traderEntries[0].priceRUB || 0,
          price: traderEntries[0].price || 0,
          currency: traderEntries[0].currency || 'RUB'
        }
      : { name: 'Yok', normalizedName: 'none', priceRUB: 0, price: 0, currency: 'RUB' };

    const bestOverallPrice = Math.max(fleaPrice, bestTrader.priceRUB);
    const bestOverallSource = bestOverallPrice === 0
      ? 'Satılamaz'
      : fleaPrice >= bestTrader.priceRUB
        ? 'Flea Market'
        : bestTrader.name;

    const pricePerSlot = Math.round(bestOverallPrice / slots);

    // Eşyanın çıkabildiği haritalar (çoktan aza sıralı)
    const spawnsByMapObj = itemMapSpawns[item.id] || {};
    const mapSpawnsSummary = Object.entries(spawnsByMapObj)
      .map(([mapNorm, positions]) => {
        const mInfo = maps.find((m) => m.normalizedName === mapNorm);
        return {
          mapNormalizedName: mapNorm,
          mapName: mInfo ? mInfo.name : mapNorm,
          looseCount: positions.length,
          containerCount: mapContainerCounts[mapNorm] || 0
        };
      })
      .sort((a, b) => b.looseCount - a.looseCount);

    return {
      ...item,
      slots,
      fleaPrice,
      fleaAvg24hPrice,
      fleaLastLowPrice,
      bestTrader,
      bestOverallPrice,
      bestOverallSource,
      pricePerSlot,
      mapSpawnsSummary
    };
  });

  return {
    maps,
    items: enrichedItems,
    tasks,
    itemMapSpawns,
    updatedAt: new Date().toISOString()
  };
}

class TarkovDataService {
  constructor(userDataPath, logFn) {
    this.userDataPath = userDataPath;
    this.cacheDir = path.join(userDataPath, 'cache');
    this.log = logFn || (() => {});
    this.currentData = null;
    this.lastCacheKey = null;
  }

  getCacheFilePath(lang, gameMode) {
    return path.join(this.cacheDir, `tarkov_data_${gameMode}_${lang}.json`);
  }

  getSvgCachePath(mapNorm) {
    return path.join(this.cacheDir, `map_${mapNorm}.svg`);
  }

  /**
   * 1. Önce 6 saatlik disk önbelleğini kontrol eder (forceRefresh = false ise).
   * 2. Önbellek yoksa veya süresi dolmuşsa:
   *    - İlk iş olarak api.tarkov.dev/graphql üzerinde Introspection (__schema, __type) çalıştırır,
   *    - Ardından GraphQL sorgusunu çalıştırır; GraphQL 503 dönerse resmi tarkov.dev JSON mirror'ından çeker.
   * 3. Sonucu userData/cache altına kaydeder. Çevrimdışıysa süresi geçmiş önbelleği kullanır.
   */
  async loadData({ lang = 'tr', gameMode = 'regular', forceRefresh = false } = {}) {
    const cacheFile = this.getCacheFilePath(lang, gameMode);
    const cacheKey = `${gameMode}_${lang}`;

    if (!forceRefresh && this.currentData && this.lastCacheKey === cacheKey) {
      return {
        ok: true,
        fromCache: true,
        offlineFallback: false,
        updatedAt: this.currentData.updatedAt,
        data: this.currentData
      };
    }

    // Disk önbelleği kontrolü
    if (!forceRefresh && fs.existsSync(cacheFile)) {
      try {
        const stat = fs.statSync(cacheFile);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < CACHE_TTL_MS) {
          const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
          this.currentData = enrichDataset(raw);
          this.lastCacheKey = cacheKey;
          this.log('info', `Veriler disk önbelleğinden yüklendi (${Math.round(ageMs / 60000)} dk önce güncellendi).`, cacheFile);
          return {
            ok: true,
            fromCache: true,
            offlineFallback: false,
            updatedAt: raw.updatedAt || new Date(stat.mtimeMs).toISOString(),
            data: this.currentData
          };
        }
      } catch (err) {
        this.log('warn', 'Önbellek dosyası okunamadı, yeniden indirilecek.', err.message);
      }
    }

    // Uzak API'den çekmeyi dene
    try {
      let rawDataset = null;

      // Adım A: GraphQL Introspection (__schema, __type) + Sorgu dene
      try {
        this.log('info', 'api.tarkov.dev/graphql üzerinde şema introspection (__type) kontrol ediliyor...');
        const introRes = await fetchJsonWithTimeout(
          GRAPHQL_ENDPOINT,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: INTROSPECTION_QUERY })
          },
          8000
        );

        if (introRes && introRes.data && introRes.data.MapType) {
          const mapFields = introRes.data.MapType.fields.map((f) => f.name);
          this.log('info', `GraphQL Introspection başarılı. Map alanları doğrulandı (${mapFields.length} alan).`);

          const gqlQuery = buildGraphQLDataQuery(lang, gameMode);
          const gqlRes = await fetchJsonWithTimeout(
            GRAPHQL_ENDPOINT,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: gqlQuery })
            },
            25000
          );

          if (gqlRes && gqlRes.data && gqlRes.data.maps && gqlRes.data.items) {
            rawDataset = {
              maps: gqlRes.data.maps,
              items: gqlRes.data.items,
              tasks: gqlRes.data.tasks || [],
              updatedAt: new Date().toISOString()
            };
            this.log('info', 'Veriler api.tarkov.dev/graphql üzerinden başarıyla çekildi.');
          }
        } else if (introRes && introRes.errors) {
          throw new Error(JSON.stringify(introRes.errors));
        }
      } catch (gqlErr) {
        this.log('warn', `api.tarkov.dev/graphql yanıt vermedi (${gqlErr.message}), resmi tarkov.dev statik veri sunucusuna geçiliyor...`);
      }

      // Adım B: GraphQL 503 / geçici bakım durumunda resmi tarkov.dev JSON uç noktasını kullan
      if (!rawDataset) {
        const mirrorData = await fetchFromOfficialTarkovDevJsonMirror(lang, gameMode, this.log);
        rawDataset = {
          ...mirrorData,
          updatedAt: new Date().toISOString()
        };
      }

      // Disk önbelleğine kaydet
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(rawDataset), 'utf-8');
      this.log('info', `API verileri önbelleğe kaydedildi (${rawDataset.items.length} eşya, ${rawDataset.maps.length} harita, ${rawDataset.tasks.length} görev).`, cacheFile);

      this.currentData = enrichDataset(rawDataset);
      this.lastCacheKey = cacheKey;

      return {
        ok: true,
        fromCache: false,
        offlineFallback: false,
        updatedAt: rawDataset.updatedAt,
        data: this.currentData
      };
    } catch (fetchErr) {
      this.log('error', 'API verisi indirilemedi, çevrimdışı önbellek kontrol ediliyor.', fetchErr.message);

      // Çevrimdışıyken süresi dolmuş da olsa disk önbelleğini kullan
      if (fs.existsSync(cacheFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
          this.currentData = enrichDataset(raw);
          this.lastCacheKey = cacheKey;
          this.log('warn', 'Çevrimdışı mod: Süresi geçmiş disk önbelleği kullanılıyor.', cacheFile);
          return {
            ok: true,
            fromCache: true,
            offlineFallback: true,
            updatedAt: raw.updatedAt,
            data: this.currentData
          };
        } catch (readErr) {
          this.log('error', 'Çevrimdışı önbellek okunamadı.', readErr.message);
        }
      }

      return {
        ok: false,
        error: `Veri alınamadı ve yerel önbellek bulunamadı: ${fetchErr.message}`
      };
    }
  }

  /**
   * Harita SVG dosyasını indirir ve yerel önbelleğe yazar (çevrimdışı kullanım için).
   */
  async getMapSvg(mapNormalizedName) {
    const geo = MAP_CONFIGS[mapNormalizedName];
    if (!geo || !geo.svgPath) {
      return { ok: false, reason: 'Bu harita için SVG katmanı tanımlı değil (Tile katmanı kullanılıyor).' };
    }

    const svgCacheFile = this.getSvgCachePath(mapNormalizedName);
    if (fs.existsSync(svgCacheFile)) {
      try {
        const stat = fs.statSync(svgCacheFile);
        if (Date.now() - stat.mtimeMs < 7 * 24 * 60 * 60 * 1000) {
          return { ok: true, svgText: fs.readFileSync(svgCacheFile, 'utf-8'), fromCache: true };
        }
      } catch (_e) {
        // ignore
      }
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(geo.svgPath, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const svgText = await res.text();
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(svgCacheFile, svgText, 'utf-8');
      return { ok: true, svgText, fromCache: false };
    } catch (err) {
      if (fs.existsSync(svgCacheFile)) {
        return { ok: true, svgText: fs.readFileSync(svgCacheFile, 'utf-8'), fromCache: true };
      }
      return { ok: false, reason: err.message };
    }
  }
}

module.exports = {
  TarkovDataService
};
