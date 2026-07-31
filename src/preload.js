const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfPresenter', {
  openPdf: () => ipcRenderer.invoke('dialog:open-pdf'),
  listDisplays: () => ipcRenderer.invoke('display:list'),
  startPresentation: (displayId, page) => ipcRenderer.invoke('presentation:start', { displayId, page }),
  stopPresentation: () => ipcRenderer.invoke('presentation:stop'),
  bringPresentationToFront: () => ipcRenderer.invoke('presentation:bring-to-front'),
  setPage: (page) => ipcRenderer.invoke('pdf:set-page', page),
  setLaserPointer: (pointer) => ipcRenderer.invoke('laser:set-pointer', pointer),
  addAnnotation: (annotation) => ipcRenderer.invoke('annotations:add', annotation),
  clearAnnotations: () => ipcRenderer.invoke('annotations:clear'),
  getAnnotations: () => ipcRenderer.invoke('annotations:get'),
  getPageUrl: (page) => ipcRenderer.invoke('pdf:get-page-url', page),
  readPdf: (filePath) => ipcRenderer.invoke('pdf:read', filePath),
  getState: () => ipcRenderer.invoke('pdf:get-state'),
  onPdfOpened: (callback) => {
    ipcRenderer.on('pdf:opened', (_event, payload) => callback(payload));
  },
  onSetPage: (callback) => {
    ipcRenderer.on('pdf:set-page', (_event, page) => callback(page));
  },
  onPresentationStarted: (callback) => {
    ipcRenderer.on('presentation:started', () => callback());
  },
  onPresentationStopped: (callback) => {
    ipcRenderer.on('presentation:stopped', () => callback());
  },
  onPdfError: (callback) => {
    ipcRenderer.on('pdf:error', (_event, message) => callback(message));
  },
  onLaserPointer: (callback) => {
    ipcRenderer.on('laser:pointer', (_event, pointer) => callback(pointer));
  },
  onAnnotationsSync: (callback) => {
    ipcRenderer.on('annotations:sync', (_event, annotations) => callback(annotations));
  }
});
