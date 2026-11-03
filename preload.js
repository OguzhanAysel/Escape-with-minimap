const { contextBridge, ipcRenderer } = require('electron');

// Dar ve güvenli IPC köprüsü (contextIsolation: true, nodeIntegration: false)
contextBridge.exposeInMainWorld('tarkovAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  validateAndRegisterShortcuts: (shortcuts) => ipcRenderer.invoke('shortcuts:validateAndRegister', shortcuts),
  resetDefaultShortcuts: () => ipcRenderer.invoke('shortcuts:resetDefaults'),

  // API & Eşya Arama & Harita
  loadApiData: (opts) => ipcRenderer.invoke('api:loadData', opts),
  getItems: () => ipcRenderer.invoke('api:getItems'),
  getOverlayMapPayload: () => ipcRenderer.invoke('api:getOverlayMapPayload'),
  getMapSvg: (mapNormalizedName) => ipcRenderer.invoke('api:getMapSvg', mapNormalizedName),
  togglePinItem: (item) => ipcRenderer.invoke('loot:togglePinItem', item),
  clearPinnedItems: () => ipcRenderer.invoke('loot:clearPinnedItems'),

  // Aşama 3: Oyuncu Konum & Ekran Görüntüsü Parser & Otomatik Home (Alt+H)
  getPlayerState: () => ipcRenderer.invoke('player:getState'),
  testScreenshotFilename: (filename) => ipcRenderer.invoke('player:testFilename', filename),
  scanLatestScreenshot: () => ipcRenderer.invoke('player:scanLatestScreenshot'),
  clearPlayerTrail: () => ipcRenderer.invoke('player:clearTrail'),
  getAutoHomeState: () => ipcRenderer.invoke('autohome:get'),
  toggleAutoHome: (forceState) => ipcRenderer.invoke('autohome:toggle', forceState),

  // Aşama 4: Hedef Seçimi & Rota & Zincirleme Rotasyon
  setTarget: (targetObj) => ipcRenderer.invoke('target:set', targetObj),
  nextTarget: () => ipcRenderer.invoke('target:next'),
  clearTarget: () => ipcRenderer.invoke('target:clear'),
  clearVisitedTargets: () => ipcRenderer.invoke('target:clearVisited'),
  startRotation: (opts) => ipcRenderer.invoke('target:startRotation', opts),
  getLatestScreenshotDataUrl: () => ipcRenderer.invoke('screenshot:getLatestDataUrl'),

  // Fare Üzerine Gelince Harita Etkileşimi
  setHoverInteractive: (interactive) => ipcRenderer.invoke('overlay:setHoverInteractive', interactive),
  // Sabit görev kartı / lightbox açıkken overlay etkileşimini kilitler (+ geçici Esc/←/→ kısayolları)
  setInteractionLock: (payload) => ipcRenderer.invoke('overlay:setInteractionLock', payload),
  // Ekran ortasında görsel büyütme penceresi (Lightbox)
  openLightboxWindow: (payload) => ipcRenderer.invoke('lightbox:open', payload),
  closeLightboxWindow: () => ipcRenderer.invoke('lightbox:close'),
  onLightboxShow: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('lightbox:show', listener);
    return () => ipcRenderer.removeListener('lightbox:show', listener);
  },
  onLightboxHide: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('lightbox:hide', listener);
    return () => ipcRenderer.removeListener('lightbox:hide', listener);
  },
  onLightboxNav: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('lightbox:nav', listener);
    return () => ipcRenderer.removeListener('lightbox:nav', listener);
  },
  onOverlayKeyAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('overlay:keyAction', listener);
    return () => ipcRenderer.removeListener('overlay:keyAction', listener);
  },

  // Aşama 5: Görevler & OCR & Görev Eşyalarını Pinleme
  getTasks: () => ipcRenderer.invoke('api:getTasks'),
  toggleTask: (taskId) => ipcRenderer.invoke('tasks:toggleTask', taskId),
  toggleCompletedTask: (taskId) => ipcRenderer.invoke('tasks:toggleCompletedTask', taskId),
  setActiveTasks: (taskIdsArray) => ipcRenderer.invoke('tasks:setActiveTasks', taskIdsArray),
  clearActiveTasks: () => ipcRenderer.invoke('tasks:clearActiveTasks'),
  toggleObjective: (objectiveId) => ipcRenderer.invoke('tasks:toggleObjective', objectiveId),
  pinMultipleItems: (itemsArray) => ipcRenderer.invoke('loot:pinMultipleItems', itemsArray),

  getLogs: () => ipcRenderer.invoke('logs:get'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),

  onSettingsUpdated: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('settings:updated', listener);
    return () => ipcRenderer.removeListener('settings:updated', listener);
  },

  onMapDataUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('map:dataUpdated', listener);
    return () => ipcRenderer.removeListener('map:dataUpdated', listener);
  },

  onPlayerUpdated: (callback) => {
    const listener = (_event, playerState) => callback(playerState);
    ipcRenderer.on('player:updated', listener);
    return () => ipcRenderer.removeListener('player:updated', listener);
  },

  onAutoHomeUpdated: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('autohome:updated', listener);
    return () => ipcRenderer.removeListener('autohome:updated', listener);
  },

  onShortcutAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('shortcut:action', listener);
    return () => ipcRenderer.removeListener('shortcut:action', listener);
  },

  onNewLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('log:new', listener);
    return () => ipcRenderer.removeListener('log:new', listener);
  }
});
