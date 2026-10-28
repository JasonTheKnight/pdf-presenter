import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

const isPresenter = document.body.classList.contains('presenter');
const slideSurface = document.getElementById('slideSurface');
const canvas = document.getElementById('pdfCanvas');
const context = canvas.getContext('2d', { alpha: false });
const annotationLayer = document.getElementById('annotationLayer');
const laserPointer = document.getElementById('laserPointer');
const emptyState = document.getElementById('emptyState');
const emptyStateMessage = document.getElementById('emptyStateMessage');
const openPdfButton = document.getElementById('openPdfButton');
const firstButton = document.getElementById('firstButton');
const previousButton = document.getElementById('previousButton');
const nextButton = document.getElementById('nextButton');
const pageStatus = document.getElementById('pageStatus');
const displaySelect = document.getElementById('displaySelect');
const refreshDisplaysButton = document.getElementById('refreshDisplaysButton');
const presentButton = document.getElementById('presentButton');
const stopButton = document.getElementById('stopButton');
const toolButtons = Array.from(document.querySelectorAll('.tool-button'));
const clearAnnotationsButton = document.getElementById('clearAnnotationsButton');
const notesEditor = document.getElementById('notesEditor');
const notesSaveStatus = document.getElementById('notesSaveStatus');
const nextSlidePreview = document.getElementById('nextSlidePreview');
const nextSlideCanvas = document.getElementById('nextSlideCanvas');
const nextSlideMessage = document.getElementById('nextSlideMessage');
const nextSlideStatus = document.getElementById('nextSlideStatus');
const nextSlidePageControl = document.getElementById('nextSlidePageControl');
const nextSlidePageInput = document.getElementById('nextSlidePageInput');
const syncNextSlideButton = document.getElementById('syncNextSlideButton');
const workshopConnectPrompt = document.getElementById('workshopConnectPrompt');
const showWorkshopFormButton = document.getElementById('showWorkshopFormButton');
const workshopUrlForm = document.getElementById('workshopUrlForm');
const workshopUrlInput = document.getElementById('workshopUrlInput');
const workshopUrlError = document.getElementById('workshopUrlError');
const workshopFrame = document.getElementById('workshopFrame');
const disconnectWorkshopButton = document.getElementById('disconnectWorkshopButton');
const presenterLayout = document.querySelector('.presenter-layout');
const sidebarResizeHandle = document.getElementById('sidebarResizeHandle');

const workshopUrlStorageKey = 'pdf-presenter.workshop-timer-url';
const collapsedPanelsStorageKey = 'pdf-presenter.collapsed-panels';
const sidebarWidthStorageKey = 'pdf-presenter.sidebar-width';
const sidebarMinWidth = 240;
const sidebarMaxWidth = 720;

let pdfDocument = null;
let pdfPath = null;
let pdfName = null;
let currentPage = 1;
let pageCount = 0;
let isPresenting = false;
let renderRequestId = 0;
let nextSlideRenderRequestId = 0;
let selectedPreviewPage = null;
let resizeTimer = null;
let lastLaserPointer = null;
let pendingLaserPointer = null;
let laserFrame = null;
let activeTool = 'pointer';
let annotations = [];
let draftAnnotation = null;
let notes = {};
let notesSaveTimer = null;
let isUpdatingNotesEditor = false;

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function showPresenterMessage(message, status = message) {
  if (!isPresenter) return;

  if (pageStatus) pageStatus.textContent = status;
  if (emptyState) emptyState.hidden = false;
  if (emptyStateMessage) emptyStateMessage.textContent = message;
}

function updatePresenterControls() {
  if (!isPresenter) return;

  const hasPdf = Boolean(pdfDocument);
  firstButton.disabled = !hasPdf || currentPage <= 1;
  previousButton.disabled = !hasPdf || currentPage <= 1;
  nextButton.disabled = !hasPdf || currentPage >= pageCount;
  displaySelect.disabled = !hasPdf;
  refreshDisplaysButton.disabled = !hasPdf;
  presentButton.disabled = !hasPdf || isPresenting;
  presentButton.hidden = isPresenting;
  stopButton.hidden = !isPresenting;
  if (clearAnnotationsButton) clearAnnotationsButton.disabled = !hasPdf || annotations.length === 0;
  if (notesEditor) notesEditor.disabled = !hasPdf;
  updateNotesEditor();
  pageStatus.textContent = hasPdf ? `${pdfName} - ${currentPage} / ${pageCount}` : 'No PDF open';
}

function setNotesSaveStatus(status) {
  if (!notesSaveStatus) return;

  notesSaveStatus.textContent = status;
}

function updateNotesEditor() {
  if (!isPresenter || !notesEditor) return;

  isUpdatingNotesEditor = true;
  notesEditor.value = pdfDocument ? notes[String(currentPage)] || '' : '';
  isUpdatingNotesEditor = false;

  if (!pdfDocument) {
    setNotesSaveStatus('No PDF open');
  } else {
    setNotesSaveStatus(`Page ${currentPage}`);
  }
}

async function renderNextSlide() {
  if (!isPresenter || !nextSlideCanvas || !nextSlidePreview) return;

  const requestId = ++nextSlideRenderRequestId;
  const nextPage = selectedPreviewPage ?? currentPage + 1;

  if (!pdfDocument) {
    nextSlideCanvas.hidden = true;
    nextSlideMessage.hidden = false;
    nextSlideMessage.textContent = 'No PDF open';
    nextSlideStatus.textContent = '';
    nextSlideStatus.hidden = false;
    nextSlidePageControl.hidden = true;
    syncNextSlideButton.hidden = true;
    return;
  }

  nextSlidePageInput.max = String(pageCount);
  nextSlidePageInput.value = nextPage <= pageCount ? String(nextPage) : '';
  nextSlidePageInput.placeholder = nextPage > pageCount ? '—' : '';
  nextSlidePageControl.hidden = false;
  syncNextSlideButton.hidden = selectedPreviewPage === null;
  nextSlideStatus.hidden = true;

  if (selectedPreviewPage === null && nextPage > pageCount) {
    nextSlideCanvas.hidden = true;
    nextSlideMessage.hidden = false;
    nextSlideMessage.textContent = 'End of presentation';
    return;
  }

  nextSlideCanvas.hidden = true;
  nextSlideMessage.hidden = false;
  nextSlideMessage.textContent = 'Loading preview...';

  const pdfPage = await pdfDocument.getPage(nextPage);
  if (requestId !== nextSlideRenderRequestId) return;

  const viewport = pdfPage.getViewport({ scale: 1 });
  const availableWidth = Math.max(nextSlidePreview.clientWidth - 2, 100);
  const availableHeight = Math.max(nextSlidePreview.clientHeight - 2, 60);
  const cssScale = Math.min(availableWidth / viewport.width, availableHeight / viewport.height);
  const scaledViewport = pdfPage.getViewport({ scale: cssScale });
  const pixelRatio = window.devicePixelRatio || 1;
  const renderedCanvas = document.createElement('canvas');
  const previewContext = renderedCanvas.getContext('2d', { alpha: false });

  renderedCanvas.width = Math.floor(scaledViewport.width * pixelRatio);
  renderedCanvas.height = Math.floor(scaledViewport.height * pixelRatio);
  previewContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  previewContext.fillStyle = '#ffffff';
  previewContext.fillRect(0, 0, scaledViewport.width, scaledViewport.height);

  await pdfPage.render({
    canvasContext: previewContext,
    viewport: scaledViewport
  }).promise;

  if (requestId !== nextSlideRenderRequestId) return;
  nextSlideCanvas.width = renderedCanvas.width;
  nextSlideCanvas.height = renderedCanvas.height;
  nextSlideCanvas.style.width = `${Math.floor(scaledViewport.width)}px`;
  nextSlideCanvas.style.height = `${Math.floor(scaledViewport.height)}px`;
  nextSlideCanvas.getContext('2d', { alpha: false }).drawImage(renderedCanvas, 0, 0);
  nextSlideMessage.hidden = true;
  nextSlideCanvas.hidden = false;
}

async function refreshNotes() {
  if (!isPresenter || !pdfPath) return;

  notes = await window.pdfPresenter.getNotes();
  updateNotesEditor();
}

function scheduleNoteSave() {
  if (!isPresenter || !pdfDocument || !notesEditor) return;

  const pageToSave = currentPage;
  const noteToSave = notesEditor.value;
  notes[String(pageToSave)] = noteToSave;
  setNotesSaveStatus('Saving...');
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(async () => {
    try {
      notes = await window.pdfPresenter.setNote(pageToSave, noteToSave);
      if (pageToSave === currentPage) {
        setNotesSaveStatus(`Saved page ${pageToSave}`);
      }
    } catch (error) {
      console.error(error);
      setNotesSaveStatus('Could not save');
    }
  }, 350);
}

function showOpenError(error) {
  console.error(error);
  if (slideSurface) slideSurface.hidden = true;
  showPresenterMessage(
    error?.message || String(error) || 'The selected file could not be opened.',
    'Could not open PDF'
  );
}

function applyLaserPointer(pointer) {
  lastLaserPointer = pointer;

  if (!laserPointer) return;

  if (!pointer?.visible || !pdfDocument) {
    laserPointer.hidden = true;
    return;
  }

  laserPointer.style.left = `${pointer.x * 100}%`;
  laserPointer.style.top = `${pointer.y * 100}%`;
  laserPointer.hidden = false;
}

function setActiveTool(tool) {
  activeTool = tool;

  toolButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
  slideSurface?.classList.toggle('drawing-mode', tool !== 'pointer');

  if (tool !== 'pointer') {
    sendLaserPointer({ visible: false });
  }
}

function sendLaserPointer(pointer) {
  pendingLaserPointer = pointer;

  if (laserFrame) return;

  laserFrame = requestAnimationFrame(() => {
    laserFrame = null;
    window.pdfPresenter.setLaserPointer(pendingLaserPointer);
  });
}

function pointerFromMouseEvent(event) {
  const bounds = slideSurface.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;

  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return { visible: false };
  }

  return { visible: true, x, y };
}

function slidePointFromMouseEvent(event) {
  const bounds = slideSurface.getBoundingClientRect();

  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
  };
}

function svgCoordinate(value) {
  return value * 1000;
}

function createAnnotationElement(annotation) {
  if (annotation.type === 'line') {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', svgCoordinate(annotation.x1));
    line.setAttribute('y1', svgCoordinate(annotation.y1));
    line.setAttribute('x2', svgCoordinate(annotation.x2));
    line.setAttribute('y2', svgCoordinate(annotation.y2));
    line.classList.add('annotation-shape', 'annotation-line');
    return line;
  }

  const x = Math.min(annotation.x1, annotation.x2);
  const y = Math.min(annotation.y1, annotation.y2);
  const width = Math.abs(annotation.x2 - annotation.x1);
  const height = Math.abs(annotation.y2 - annotation.y1);
  const rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rectangle.setAttribute('x', svgCoordinate(x));
  rectangle.setAttribute('y', svgCoordinate(y));
  rectangle.setAttribute('width', svgCoordinate(width));
  rectangle.setAttribute('height', svgCoordinate(height));
  rectangle.classList.add('annotation-shape', 'annotation-rectangle');
  return rectangle;
}

function renderAnnotations() {
  if (!annotationLayer) return;

  annotationLayer.replaceChildren();

  [...annotations, draftAnnotation]
    .filter(Boolean)
    .filter((annotation) => annotation.page === currentPage)
    .forEach((annotation) => {
      annotationLayer.appendChild(createAnnotationElement(annotation));
    });

  updatePresenterControls();
}

function waitForLayout() {
  return new Promise((resolve) => {
    let attempts = 0;

    const check = () => {
      const stage = slideSurface.parentElement;
      attempts += 1;

      if ((stage.clientWidth > 0 && stage.clientHeight > 0 && attempts >= 2) || attempts > 20) {
        resolve();
        return;
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

async function renderPage(page) {
  if (!pdfDocument) return;

  const requestId = ++renderRequestId;
  currentPage = Math.max(1, Math.min(page, pageCount));
  updatePresenterControls();
  renderNextSlide().catch((error) => {
    console.error('Could not render next slide preview:', error);
    if (nextSlideMessage) nextSlideMessage.textContent = 'Preview unavailable';
  });
  await waitForLayout();

  const pdfPage = await pdfDocument.getPage(currentPage);
  if (requestId !== renderRequestId) return;

  const stage = slideSurface.parentElement;
  const padding = isPresenter ? 16 : 0;
  const availableWidth = Math.max(stage.clientWidth - padding * 2, 100);
  const availableHeight = Math.max(stage.clientHeight - padding * 2, 100);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const cssScale = Math.min(availableWidth / viewport.width, availableHeight / viewport.height);
  const scaledViewport = pdfPage.getViewport({ scale: cssScale });
  const pixelRatio = window.devicePixelRatio || 1;

  canvas.width = Math.floor(scaledViewport.width * pixelRatio);
  canvas.height = Math.floor(scaledViewport.height * pixelRatio);
  const cssWidth = Math.floor(scaledViewport.width);
  const cssHeight = Math.floor(scaledViewport.height);

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  slideSurface.style.width = `${cssWidth}px`;
  slideSurface.style.height = `${cssHeight}px`;
  slideSurface.hidden = false;

  if (emptyState) emptyState.hidden = true;
  applyLaserPointer(lastLaserPointer);
  renderAnnotations();

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, scaledViewport.width, scaledViewport.height);

  await pdfPage.render({
    canvasContext: context,
    viewport: scaledViewport
  }).promise;
}

async function loadPdf(payload) {
  if (!payload?.path) return;

  pdfDocument = null;
  annotations = [];
  draftAnnotation = null;
  notes = {};
  pdfPath = payload.path;
  pdfName = payload.name;
  currentPage = payload.page || 1;
  selectedPreviewPage = null;
  pageCount = payload.pageCount || 0;

  if (slideSurface) slideSurface.hidden = true;
  applyLaserPointer({ visible: false });
  renderAnnotations();
  updatePresenterControls();
  renderNextSlide().catch(console.error);
  showPresenterMessage(`Loading ${pdfName}...`, `Loading ${pdfName}...`);

  const pdfData = base64ToBytes(await window.pdfPresenter.readPdf(pdfPath));
  pdfDocument = await pdfjsLib.getDocument({ data: pdfData }).promise;
  pageCount = pdfDocument.numPages;
  await refreshNotes();
  await renderPage(currentPage);
}

function goToPage(page) {
  if (!pdfDocument) return;
  window.pdfPresenter.setPage(Math.max(1, Math.min(page, pageCount)));
}

function isEditableElement(element) {
  return Boolean(element?.closest?.('textarea, input, select, [contenteditable="true"]'));
}

async function refreshDisplays() {
  if (!isPresenter) return;

  const selectedDisplayId = displaySelect.value;
  const displays = await window.pdfPresenter.listDisplays();
  displaySelect.innerHTML = '';

  displays.forEach((display) => {
    const option = document.createElement('option');
    option.value = String(display.id);
    option.textContent = `${display.label}${display.isPrimary ? ' - primary' : ''}`;
    displaySelect.appendChild(option);
  });

  if (selectedDisplayId && displays.some((display) => String(display.id) === selectedDisplayId)) {
    displaySelect.value = selectedDisplayId;
  }
}

function bindPresenterControls() {
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (isEditableElement(event.target)) return;

      window.pdfPresenter.bringPresentationToFront();
    },
    true
  );

  openPdfButton.addEventListener('click', async () => {
    try {
      const payload = await window.pdfPresenter.openPdf();
      if (payload) await loadPdf(payload);
    } catch (error) {
      showOpenError(error);
    }
  });
  firstButton.addEventListener('click', () => goToPage(1));
  previousButton.addEventListener('click', () => goToPage(currentPage - 1));
  nextButton.addEventListener('click', () => goToPage(currentPage + 1));
  refreshDisplaysButton.addEventListener('click', () => {
    refreshDisplays().catch(showOpenError);
  });
  presentButton.addEventListener('click', () => {
    window.pdfPresenter.startPresentation(Number(displaySelect.value), currentPage);
  });
  stopButton.addEventListener('click', () => window.pdfPresenter.stopPresentation());
  toolButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveTool(button.dataset.tool));
  });
  clearAnnotationsButton.addEventListener('click', () => {
    window.pdfPresenter.clearAnnotations();
  });
  notesEditor.addEventListener('input', () => {
    if (!isUpdatingNotesEditor) {
      scheduleNoteSave();
    }
  });
  const selectPreviewPage = () => {
    if (!pdfDocument) return;
    const page = Number.parseInt(nextSlidePageInput.value, 10);
    selectedPreviewPage = Math.max(1, Math.min(Number.isFinite(page) ? page : currentPage + 1, pageCount));
    renderNextSlide().catch(showOpenError);
  };
  nextSlidePageInput.addEventListener('change', selectPreviewPage);
  nextSlidePageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectPreviewPage();
      nextSlidePageInput.select();
    }
  });
  syncNextSlideButton.addEventListener('click', () => {
    selectedPreviewPage = null;
    renderNextSlide().catch(showOpenError);
  });

  slideSurface.addEventListener('pointermove', (event) => {
    if (!pdfDocument) return;
    if (activeTool === 'pointer') {
      sendLaserPointer(pointerFromMouseEvent(event));
      return;
    }

    if (!draftAnnotation) return;

    const point = slidePointFromMouseEvent(event);
    draftAnnotation = {
      ...draftAnnotation,
      x2: point.x,
      y2: point.y
    };
    renderAnnotations();
  });
  slideSurface.addEventListener('mouseleave', () => {
    sendLaserPointer({ visible: false });
  });
  slideSurface.addEventListener('pointerdown', (event) => {
    if (!pdfDocument || activeTool === 'pointer') return;

    event.preventDefault();
    slideSurface.setPointerCapture(event.pointerId);
    sendLaserPointer({ visible: false });
    const point = slidePointFromMouseEvent(event);
    draftAnnotation = {
      type: activeTool,
      page: currentPage,
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y
    };
    renderAnnotations();
  });
  slideSurface.addEventListener('pointerup', (event) => {
    if (!draftAnnotation) return;

    event.preventDefault();
    const point = slidePointFromMouseEvent(event);
    const annotation = {
      ...draftAnnotation,
      x2: point.x,
      y2: point.y
    };
    draftAnnotation = null;
    renderAnnotations();

    const width = Math.abs(annotation.x2 - annotation.x1);
    const height = Math.abs(annotation.y2 - annotation.y1);
    if (width > 0.002 || height > 0.002) {
      window.pdfPresenter.addAnnotation(annotation);
    }
  });
  slideSurface.addEventListener('pointercancel', () => {
    draftAnnotation = null;
    renderAnnotations();
  });
}

function normalizeWorkshopUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) throw new Error('Enter a URL to connect.');

  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(candidate) ? candidate : `https://${candidate}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Use an http or https URL.');
  }

  return url.href;
}

function connectWorkshopTimer(url) {
  localStorage.setItem(workshopUrlStorageKey, url);
  workshopFrame.src = url;
  workshopFrame.hidden = false;
  workshopConnectPrompt.hidden = true;
  workshopUrlForm.hidden = true;
  disconnectWorkshopButton.hidden = false;
}

function bindWorkshopTimer() {
  if (!isPresenter || !workshopFrame) return;

  const savedUrl = localStorage.getItem(workshopUrlStorageKey);
  if (savedUrl) {
    workshopUrlInput.value = savedUrl;
    connectWorkshopTimer(savedUrl);
  }

  showWorkshopFormButton.addEventListener('click', () => {
    workshopConnectPrompt.hidden = true;
    workshopUrlForm.hidden = false;
    workshopUrlInput.focus();
  });

  workshopUrlForm.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const url = normalizeWorkshopUrl(workshopUrlInput.value);
      workshopUrlInput.value = url;
      workshopUrlError.hidden = true;
      connectWorkshopTimer(url);
    } catch (error) {
      workshopUrlError.textContent = error.message;
      workshopUrlError.hidden = false;
    }
  });

  disconnectWorkshopButton.addEventListener('click', () => {
    localStorage.removeItem(workshopUrlStorageKey);
    workshopFrame.removeAttribute('src');
    workshopFrame.hidden = true;
    disconnectWorkshopButton.hidden = true;
    workshopUrlForm.hidden = true;
    workshopConnectPrompt.hidden = false;
  });
}

function bindCollapsiblePanels() {
  if (!isPresenter) return;

  const panels = Array.from(document.querySelectorAll('[data-collapsible-panel]'));
  let collapsedPanels = new Set();

  try {
    collapsedPanels = new Set(JSON.parse(localStorage.getItem(collapsedPanelsStorageKey) || '[]'));
  } catch {
    localStorage.removeItem(collapsedPanelsStorageKey);
  }

  panels.forEach((panel) => {
    const panelName = panel.dataset.collapsiblePanel;
    const toggle = panel.querySelector('.panel-toggle');
    const heading = panel.querySelector('h2')?.textContent || 'section';

    const setCollapsed = (isCollapsed) => {
      panel.classList.toggle('is-collapsed', isCollapsed);
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} ${heading}`);

      if (isCollapsed) collapsedPanels.add(panelName);
      else collapsedPanels.delete(panelName);

      localStorage.setItem(collapsedPanelsStorageKey, JSON.stringify([...collapsedPanels]));

      if (pdfDocument && !document.querySelector('[data-collapsible-panel="next-slide"]')?.classList.contains('is-collapsed')) {
        requestAnimationFrame(() => renderNextSlide().catch(showOpenError));
      }
    };

    setCollapsed(collapsedPanels.has(panelName));
    toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('is-collapsed')));
  });
}

function bindSidebarResize() {
  if (!isPresenter || !presenterLayout || !sidebarResizeHandle) return;

  const maximumWidth = () => Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, window.innerWidth * 0.55));
  const clampWidth = (width) => Math.round(Math.max(sidebarMinWidth, Math.min(width, maximumWidth())));
  const setWidth = (width, save = false) => {
    const nextWidth = clampWidth(width);
    presenterLayout.style.setProperty('--sidebar-width', `${nextWidth}px`);
    sidebarResizeHandle.setAttribute('aria-valuenow', String(nextWidth));
    sidebarResizeHandle.setAttribute('aria-valuemax', String(Math.round(maximumWidth())));
    if (save) localStorage.setItem(sidebarWidthStorageKey, String(nextWidth));

    if (pdfDocument) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderPage(currentPage).catch(showOpenError), 60);
    }
  };

  setWidth(Number(localStorage.getItem(sidebarWidthStorageKey)) || 320);

  sidebarResizeHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    event.preventDefault();
    sidebarResizeHandle.setPointerCapture(event.pointerId);
    presenterLayout.classList.add('is-resizing');
  });

  sidebarResizeHandle.addEventListener('pointermove', (event) => {
    if (!sidebarResizeHandle.hasPointerCapture(event.pointerId)) return;
    setWidth(window.innerWidth - event.clientX);
  });

  const finishResize = (event) => {
    if (!sidebarResizeHandle.hasPointerCapture(event.pointerId)) return;
    sidebarResizeHandle.releasePointerCapture(event.pointerId);
    presenterLayout.classList.remove('is-resizing');
    const width = parseFloat(getComputedStyle(presenterLayout).getPropertyValue('--sidebar-width'));
    setWidth(width, true);
  };

  sidebarResizeHandle.addEventListener('pointerup', finishResize);
  sidebarResizeHandle.addEventListener('pointercancel', finishResize);
  sidebarResizeHandle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const currentWidth = parseFloat(getComputedStyle(presenterLayout).getPropertyValue('--sidebar-width'));
    const step = event.shiftKey ? 50 : 10;
    if (event.key === 'Home') setWidth(sidebarMinWidth, true);
    if (event.key === 'End') setWidth(maximumWidth(), true);
    if (event.key === 'ArrowLeft') setWidth(currentWidth + step, true);
    if (event.key === 'ArrowRight') setWidth(currentWidth - step, true);
  });

  window.addEventListener('resize', () => {
    const width = parseFloat(getComputedStyle(presenterLayout).getPropertyValue('--sidebar-width'));
    setWidth(width);
  });
}

window.addEventListener('keydown', (event) => {
  if (isEditableElement(event.target)) return;

  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    goToPage(currentPage - 1);
  }

  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault();
    goToPage(currentPage + 1);
  }

  if (event.key === 'Escape' && (isPresenting || !isPresenter)) {
    event.preventDefault();
    window.pdfPresenter.stopPresentation();
  }
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderPage(currentPage).catch(showOpenError);
  }, 80);
});

window.pdfPresenter.onPdfOpened((payload) => {
  loadPdf(payload).catch(showOpenError);
});

window.pdfPresenter.onSetPage((page) => {
  renderPage(page).catch(showOpenError);
});

window.pdfPresenter.onPresentationStarted(() => {
  isPresenting = true;
  updatePresenterControls();
});

window.pdfPresenter.onPresentationStopped(() => {
  isPresenting = false;
  updatePresenterControls();
});

window.pdfPresenter.onPdfError((message) => {
  showOpenError(new Error(message));
});

window.pdfPresenter.onLaserPointer((pointer) => {
  applyLaserPointer(pointer);
});

window.pdfPresenter.onAnnotationsSync((nextAnnotations) => {
  annotations = nextAnnotations;
  renderAnnotations();
});

if (isPresenter) {
  bindPresenterControls();
  bindWorkshopTimer();
  bindCollapsiblePanels();
  bindSidebarResize();
  refreshDisplays();
  setActiveTool('pointer');
}

window.pdfPresenter.getState().then((state) => {
  isPresenting = state.isPresenting;
  updatePresenterControls();

  if (state.path && isPresenter) {
    loadPdf(state).catch(showOpenError);
  }

  window.pdfPresenter.getAnnotations().then((nextAnnotations) => {
    annotations = nextAnnotations;
    renderAnnotations();
  });
});
