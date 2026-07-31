const { app, BrowserWindow, dialog, ipcMain, screen, Menu } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');

let presenterWindow;
let presentationWindow;
let currentPdfPath = null;
let currentPage = 1;
let currentPdfPageCount = 0;
let annotations = [];

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createPresenterWindow() {
  presenterWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 760,
    minHeight: 520,
    title: 'PDF Presenter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      plugins: true,
      webSecurity: false
    }
  });

  presenterWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  presenterWindow.on('focus', () => {
    bringPresentationToFront();
  });

  presenterWindow.on('closed', () => {
    presenterWindow = null;
    closePresentationWindow();
  });
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openPdfDialog()
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openPdfDialog({ notifyRenderer = true } = {}) {
  if (!presenterWindow) return;

  const result = await dialog.showOpenDialog(presenterWindow, {
    title: 'Open PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF files', extensions: ['pdf'] }]
  });

  if (result.canceled || result.filePaths.length === 0) return;

  return openPdf(result.filePaths[0], 1, { notifyRenderer });
}

async function getPdfDetails(filePath, page) {
  const bytes = await fs.readFile(filePath);
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = document.getPageCount();
  currentPdfPageCount = pageCount;

  return {
    path: filePath,
    url: pathToFileURL(filePath).href,
    name: path.basename(filePath),
    page,
    pageCount
  };
}

async function getSinglePagePdfUrl(filePath, page) {
  if (filePath !== currentPdfPath) {
    throw new Error('The requested PDF is not open in this app.');
  }

  const sourceStat = await fs.stat(filePath);
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${filePath}:${sourceStat.mtimeMs}:${sourceStat.size}`)
    .digest('hex');
  const safePage = Math.max(1, Math.min(page, currentPdfPageCount || page));
  const cacheDir = path.join(app.getPath('userData'), 'page-cache', cacheKey);
  const pagePath = path.join(cacheDir, `page-${safePage}.pdf`);

  if (!(await fileExists(pagePath))) {
    const sourceBytes = await fs.readFile(filePath);
    const sourceDocument = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    const pageCount = sourceDocument.getPageCount();
    const clampedPage = Math.max(1, Math.min(safePage, pageCount));
    const singlePageDocument = await PDFDocument.create();
    const [copiedPage] = await singlePageDocument.copyPages(sourceDocument, [clampedPage - 1]);
    singlePageDocument.addPage(copiedPage);

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(pagePath, await singlePageDocument.save());
  }

  return pathToFileURL(pagePath).href;
}

async function openPdf(filePath, page, { notifyRenderer = true } = {}) {
  currentPdfPath = filePath;
  currentPage = page;
  annotations = [];

  const payload = await getPdfDetails(filePath, page);

  if (notifyRenderer) {
    presenterWindow?.webContents.send('pdf:opened', payload);
    presentationWindow?.webContents.send('pdf:opened', payload);
    broadcastAnnotations();
  }

  return payload;
}

function setPage(page) {
  currentPage = page;
  presenterWindow?.webContents.send('pdf:set-page', page);
  presentationWindow?.webContents.send('pdf:set-page', page);
}

function setLaserPointer(pointer) {
  presenterWindow?.webContents.send('laser:pointer', pointer);
  presentationWindow?.webContents.send('laser:pointer', pointer);
}

function broadcastAnnotations() {
  presenterWindow?.webContents.send('annotations:sync', annotations);
  presentationWindow?.webContents.send('annotations:sync', annotations);
}

function addAnnotation(annotation) {
  annotations = [
    ...annotations,
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: annotation.type,
      page: annotation.page,
      x1: annotation.x1,
      y1: annotation.y1,
      x2: annotation.x2,
      y2: annotation.y2
    }
  ];
  broadcastAnnotations();
}

function clearAnnotations() {
  annotations = [];
  broadcastAnnotations();
}

function getDisplayPayload() {
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: `Screen ${index + 1} (${display.size.width}x${display.size.height})`,
    bounds: display.bounds,
    isPrimary: display.id === screen.getPrimaryDisplay().id
  }));
}

function closePresentationWindow() {
  if (!presentationWindow) return;

  const windowToClose = presentationWindow;
  presentationWindow = null;
  windowToClose.close();
  presenterWindow?.webContents.send('presentation:stopped');
}

function bringPresentationToFront() {
  if (!presentationWindow || presentationWindow.isDestroyed()) return;

  if (!presentationWindow.isVisible()) {
    presentationWindow.showInactive();
  }

  presentationWindow.moveTop();
}

function startPresentation(displayId, page) {
  if (!currentPdfPath) return;

  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find((display) => display.id === displayId) || screen.getPrimaryDisplay();
  const { x, y, width, height } = targetDisplay.bounds;

  closePresentationWindow();
  currentPage = page || currentPage;

  presentationWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#111111',
    title: 'PDF Presentation',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      plugins: true,
      webSecurity: false
    }
  });

  presentationWindow.loadFile(path.join(__dirname, 'renderer', 'presentation.html'));

  presentationWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      closePresentationWindow();
    }
  });

  presentationWindow.once('ready-to-show', () => {
    let payloadSent = false;
    const sendInitialPayload = () => {
      if (payloadSent || !presentationWindow) return;
      payloadSent = true;

      getPdfDetails(currentPdfPath, currentPage)
        .then((payload) => {
          presentationWindow?.webContents.send('pdf:opened', payload);
          presentationWindow?.webContents.send('annotations:sync', annotations);
        })
        .catch((error) => presenterWindow?.webContents.send('pdf:error', error.message));
    };

    presentationWindow.show();
    setTimeout(sendInitialPayload, 120);
    presenterWindow?.webContents.send('presentation:started');
  });

  presentationWindow.on('closed', () => {
    presentationWindow = null;
    presenterWindow?.webContents.send('presentation:stopped');
  });
}

app.whenReady().then(() => {
  createMenu();
  createPresenterWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPresenterWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:open-pdf', () => openPdfDialog({ notifyRenderer: false }));
ipcMain.handle('display:list', () => getDisplayPayload());
ipcMain.handle('presentation:start', (_event, { displayId, page }) => startPresentation(displayId, page));
ipcMain.handle('presentation:stop', () => closePresentationWindow());
ipcMain.handle('presentation:bring-to-front', () => bringPresentationToFront());
ipcMain.handle('pdf:set-page', (_event, page) => setPage(page));
ipcMain.handle('pdf:get-page-url', (_event, page) => getSinglePagePdfUrl(currentPdfPath, page));
ipcMain.handle('laser:set-pointer', (_event, pointer) => setLaserPointer(pointer));
ipcMain.handle('annotations:add', (_event, annotation) => addAnnotation(annotation));
ipcMain.handle('annotations:clear', () => clearAnnotations());
ipcMain.handle('annotations:get', () => annotations);
ipcMain.handle('pdf:read', async (_event, filePath) => {
  if (filePath !== currentPdfPath) {
    throw new Error('The requested PDF is not open in this app.');
  }

  return (await fs.readFile(filePath)).toString('base64');
});
ipcMain.handle('pdf:get-state', async () => {
  if (!currentPdfPath) {
    return {
      path: null,
      url: null,
      name: null,
      page: currentPage,
      pageCount: 0,
      isPresenting: Boolean(presentationWindow)
    };
  }

  return {
    ...(await getPdfDetails(currentPdfPath, currentPage)),
    isPresenting: Boolean(presentationWindow)
  };
});
