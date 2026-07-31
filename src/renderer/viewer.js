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
const previousButton = document.getElementById('previousButton');
const nextButton = document.getElementById('nextButton');
const pageStatus = document.getElementById('pageStatus');
const displaySelect = document.getElementById('displaySelect');
const presentButton = document.getElementById('presentButton');
const stopButton = document.getElementById('stopButton');
const toolButtons = Array.from(document.querySelectorAll('.tool-button'));
const clearAnnotationsButton = document.getElementById('clearAnnotationsButton');
const notesEditor = document.getElementById('notesEditor');
const notesSaveStatus = document.getElementById('notesSaveStatus');

let pdfDocument = null;
let pdfPath = null;
let pdfName = null;
let currentPage = 1;
let pageCount = 0;
let isPresenting = false;
let renderRequestId = 0;
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
  previousButton.disabled = !hasPdf || currentPage <= 1;
  nextButton.disabled = !hasPdf || currentPage >= pageCount;
  displaySelect.disabled = !hasPdf;
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
  pageCount = payload.pageCount || 0;

  if (slideSurface) slideSurface.hidden = true;
  applyLaserPointer({ visible: false });
  renderAnnotations();
  updatePresenterControls();
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

  const displays = await window.pdfPresenter.listDisplays();
  displaySelect.innerHTML = '';

  displays.forEach((display) => {
    const option = document.createElement('option');
    option.value = String(display.id);
    option.textContent = `${display.label}${display.isPrimary ? ' - primary' : ''}`;
    displaySelect.appendChild(option);
  });
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
  previousButton.addEventListener('click', () => goToPage(currentPage - 1));
  nextButton.addEventListener('click', () => goToPage(currentPage + 1));
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
