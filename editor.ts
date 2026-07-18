// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

interface Bounds { x: number; y: number; width: number; height: number; }
interface Color  { red: number; green: number; blue: number; alpha: number; }

type ItemType =
  | 'rect' | 'disk' | 'screen' | 'text' | 'image'
  | 'led7seg' | 'led14seg' | 'group';

interface LayoutItem {
  id: string;
  type: ItemType;
  name: string;
  bounds: Bounds;
  color: Color;
  screenIndex?: number;
  textString?: string;
  textAlign?: number;
  imageFile?: string;
  groupRef?: string;
  inputtag?: string;
  inputmask?: number;
  defstate?: number;
}

interface ViewDef    { id: string; name: string; items: LayoutItem[]; }
interface ElementDef { id: string; name: string; components: LayoutItem[]; }
interface LayoutDoc  { views: ViewDef[]; elements: ElementDef[]; }

// ─────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────

let doc: LayoutDoc = { views: [], elements: [] };
let currentViewId: string | null = null;
let selectedItemId: string | null = null;
let currentTool: 'select' | 'pan' = 'select';
let snapEnabled = true;
const SNAP = 8;

let canvasW = 1, canvasH = 1;
let viewOffX = 0, viewOffY = 0;
let viewScale = 1;

let isDragging   = false;
let isResizing   = false;
let resizeHandle = '';
let dragStartX   = 0, dragStartY = 0;
let dragItemOrig: Bounds | null = null;

let isPanning   = false;
let panStartX   = 0, panStartY   = 0;
let panOriginX  = 0, panOriginY  = 0;

let currentTab        = 'props';
let dragPaletteType: string | null = null;

// ─────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────

function genId() { return Math.random().toString(36).slice(2, 9); }
// Snap to a sensible grid in world-space.
// If coordinates are small (MAME fractional, e.g. 0–10 range), snap to 0.01.
// If coordinates are large (pixel-space, e.g. 100s), snap to 8px.
function snapWorld(v: number): number {
  if (!snapEnabled) return Math.round(v * 1000) / 1000;
  const v_abs = Math.abs(v);
  if (v_abs < 50) {
    // fractional MAME coords — snap to 0.01
    return Math.round(v * 100) / 100;
  }
  // pixel coords — snap to 8
  return Math.round(v / 8) * 8;
}
function snap(v: number) { return snapWorld(v); }
function esc(s: string)  { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function $(id: string): HTMLElement { return document.getElementById(id) as HTMLElement; }

// ─────────────────────────────────────────────────────────────────
// CANVAS SETUP
// ─────────────────────────────────────────────────────────────────

const canvas    = document.getElementById('mainCanvas') as HTMLCanvasElement;
const ctx       = canvas.getContext('2d')!;
const container = document.getElementById('canvasContainer')!;

function resizeCanvas() {
  if (syncCanvasSize()) render();
}
window.addEventListener('resize', resizeCanvas);

function syncCanvasSize(): boolean {
  // offsetWidth/Height are reliable even for flex children with no explicit size.
  // Fall back to getBoundingClientRect if those are zero.
  let w = container.offsetWidth;
  let h = container.offsetHeight;
  if (w === 0 || h === 0) {
    const r = container.getBoundingClientRect();
    w = Math.round(r.width);
    h = Math.round(r.height);
  }
  if (w === 0 || h === 0) return false;
  canvasW = w;
  canvasH = h;
  // Only resize the canvas pixel buffer if dimensions actually changed,
  // to avoid clearing in-flight frames.
  if (canvas.width !== canvasW || canvas.height !== canvasH) {
    canvas.width  = canvasW;
    canvas.height = canvasH;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────

function init() {
  const v: ViewDef = { id: genId(), name: 'Default', items: [] };
  doc.views.push(v);
  currentViewId = v.id;
  refreshViewsList();
  refreshLayers();
  requestAnimationFrame(fitView);

  // snap button visual
  $('snapBtn').style.color       = 'var(--accent)';
  $('snapBtn').style.borderColor = 'var(--accent)';

  renderProps();
}

// ─────────────────────────────────────────────────────────────────
// TOOL SWITCHING
// ─────────────────────────────────────────────────────────────────

function setTool(t: 'select' | 'pan') {
  currentTool = t;
  $('toolSelect').style.color = t === 'select' ? 'var(--accent)' : 'var(--text2)';
  $('toolPan').style.color    = t === 'pan'    ? 'var(--accent)' : 'var(--text2)';
  canvas.style.cursor = t === 'pan' ? 'grab' : 'crosshair';
}

function toggleSnap() {
  snapEnabled = !snapEnabled;
  $('snapBtn').style.color       = snapEnabled ? 'var(--accent)' : 'var(--text2)';
  $('snapBtn').style.borderColor = snapEnabled ? 'var(--accent)' : 'var(--border)';
}

// ─────────────────────────────────────────────────────────────────
// VIEW MANAGEMENT
// ─────────────────────────────────────────────────────────────────

function currentView(): ViewDef | null {
  return doc.views.find(v => v.id === currentViewId) || null;
}

function addView() {
  const name = prompt('View name:', `View ${doc.views.length + 1}`);
  if (!name) return;
  const v: ViewDef = { id: genId(), name, items: [] };
  doc.views.push(v);
  currentViewId  = v.id;
  selectedItemId = null;
  refreshViewsList();
  refreshLayers();
  updateViewLabel();
  fitView();
}

function selectView(id: string) {
  currentViewId  = id;
  selectedItemId = null;
  refreshViewsList();
  refreshLayers();
  updateViewLabel();
  renderProps();
  fitView();
}

function deleteView(id: string) {
  if (!confirm('Delete this view?')) return;
  doc.views = doc.views.filter(v => v.id !== id);
  if (currentViewId === id) {
    currentViewId  = doc.views[0]?.id || null;
    selectedItemId = null;
  }
  refreshViewsList();
  refreshLayers();
  updateViewLabel();
  render();
}

function renameView(id: string) {
  const v = doc.views.find(x => x.id === id);
  if (!v) return;
  const n = prompt('New name:', v.name);
  if (n) { v.name = n; refreshViewsList(); updateViewLabel(); }
}

function refreshViewsList() {
  const el = $('viewsList');
  el.innerHTML = '';
  doc.views.forEach(v => {
    const d = document.createElement('div');
    d.className = 'view-item' + (v.id === currentViewId ? ' active' : '');
    d.innerHTML =
      `<span>${esc(v.name)}</span>` +
      `<span class="view-actions">` +
        `<button class="btn-icon sm" onclick="renameView('${v.id}')">✎</button>` +
        `<button class="btn-icon sm danger" onclick="deleteView('${v.id}')">✕</button>` +
      `</span>`;
    d.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      selectView(v.id);
    });
    el.appendChild(d);
  });
}

function updateViewLabel() {
  const v = currentView();
  $('viewLabel').innerHTML = v ? `View: <strong>${esc(v.name)}</strong>` : 'No view selected';
  const hasItems = v && v.items.length > 0;
  $('emptyState').style.display = hasItems ? 'none' : 'flex';
}

// ─────────────────────────────────────────────────────────────────
// ITEM MANAGEMENT
// ─────────────────────────────────────────────────────────────────

type Defaults = Partial<LayoutItem> & { bounds: Bounds; color: Color };

function createItem(type: string, x: number, y: number): LayoutItem {
  const defaults: Record<string, Defaults> = {
    rect:     { bounds:{x,y,width:120,height:60},  color:{red:0.8,green:0.8,blue:0.8,alpha:1} },
    disk:     { bounds:{x,y,width:80,height:80},   color:{red:1,green:0.4,blue:0.3,alpha:1} },
    screen:   { bounds:{x,y,width:320,height:240}, color:{red:1,green:1,blue:1,alpha:1}, screenIndex:0 },
    text:     { bounds:{x,y,width:140,height:32},  color:{red:1,green:1,blue:1,alpha:1}, textString:'Label', textAlign:0 },
    image:    { bounds:{x,y,width:100,height:100}, color:{red:1,green:1,blue:1,alpha:1}, imageFile:'image.png' },
    led7seg:  { bounds:{x,y,width:48,height:72},   color:{red:1,green:0.3,blue:0.1,alpha:1}, defstate:63 },
    led14seg: { bounds:{x,y,width:48,height:72},   color:{red:1,green:0.3,blue:0.1,alpha:1}, defstate:0 },
    group:    { bounds:{x,y,width:200,height:150}, color:{red:1,green:1,blue:1,alpha:1}, groupRef:'mygroup' },
  };
  const d = defaults[type] || defaults.rect;
  return {
    id: genId(),
    type: type as ItemType,
    name: `${type}_${genId().slice(0,4)}`,
    ...d,
  };
}

function addItemAt(type: string, canvasX: number, canvasY: number) {
  const v = currentView();
  if (!v) { alert('Create a view first.'); return; }
  const item = createItem(type, snap(toWorldX(canvasX)), snap(toWorldY(canvasY)));
  v.items.push(item);
  selectedItemId = item.id;
  refreshLayers();
  renderProps();
  updateXmlPreview();
  render();
  updateViewLabel();
}

function deleteSelected() {
  if (!selectedItemId) return;
  const v = currentView();
  if (!v) return;
  v.items     = v.items.filter(i => i.id !== selectedItemId);
  selectedItemId = null;
  refreshLayers();
  renderProps();
  updateXmlPreview();
  render();
  updateViewLabel();
}

function selectedItem(): LayoutItem | null {
  if (!selectedItemId) return null;
  return currentView()?.items.find(i => i.id === selectedItemId) || null;
}

// ─────────────────────────────────────────────────────────────────
// LAYERS
// ─────────────────────────────────────────────────────────────────

function refreshLayers() {
  const el = $('layersList');
  el.innerHTML = '';
  const v = currentView();
  if (!v) return;
  [...v.items].reverse().forEach(item => {
    const d = document.createElement('div');
    d.className = 'layer-item' + (item.id === selectedItemId ? ' selected' : '');
    d.innerHTML =
      `<span class="badge type-${item.type}">${item.type}</span>` +
      `<span class="layer-name">${esc(item.name)}</span>`;

    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    d.addEventListener('click', () => {
      // Delay the single-click action so a double-click can cancel it.
      clickTimer = setTimeout(() => {
        selectedItemId = item.id;
        refreshLayers();
        renderProps();
        render();
      }, 220);
    });

    d.addEventListener('dblclick', () => {
      // Cancel the single-click action.
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      selectedItemId = item.id;
      jumpToItem(item);
      // Rebuild layers after jump so selection highlight updates.
      refreshLayers();
      renderProps();
      render();
    });

    el.appendChild(d);
  });
}

// Pan/zoom so the given item is centred and comfortably visible.
function jumpToItem(item: LayoutItem) {
  syncCanvasSize();
  if (canvasW === 0 || canvasH === 0) return;
  const pad    = 80;
  const scaleX = (canvasW - pad * 2) / item.bounds.width;
  const scaleY = (canvasH - pad * 2) / item.bounds.height;
  // Use a reasonable zoom: fit the item, but cap at 10× the fit-all scale.
  const allItems = currentView()?.items ?? [];
  if (allItems.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  allItems.forEach(i => {
    minX = Math.min(minX, i.bounds.x);
    minY = Math.min(minY, i.bounds.y);
    maxX = Math.max(maxX, i.bounds.x + i.bounds.width);
    maxY = Math.max(maxY, i.bounds.y + i.bounds.height);
  });
  const fitAllScale = Math.min(
    (canvasW - 120) / (maxX - minX || 1),
    (canvasH - 120) / (maxY - minY || 1)
  );
  viewScale = Math.min(scaleX, scaleY, fitAllScale * 10);
  viewOffX  = canvasW / 2 - (item.bounds.x + item.bounds.width  / 2) * viewScale;
  viewOffY  = canvasH / 2 - (item.bounds.y + item.bounds.height / 2) * viewScale;
  $('zoomInfo').textContent = `${Math.round(viewScale * 100)}%`;
}

// ─────────────────────────────────────────────────────────────────
// COORDINATE TRANSFORMS
// ─────────────────────────────────────────────────────────────────

function toWorldX(cx: number) { return (cx - viewOffX) / viewScale; }
function toWorldY(cy: number) { return (cy - viewOffY) / viewScale; }
function toCanvasX(wx: number) { return wx * viewScale + viewOffX; }
function toCanvasY(wy: number) { return wy * viewScale + viewOffY; }

function zoom(factor: number) {
  const cx = canvasW / 2, cy = canvasH / 2;
  viewOffX = cx - factor * (cx - viewOffX);
  viewOffY = cy - factor * (cy - viewOffY);
  viewScale *= factor;
  $('zoomInfo').textContent = `${Math.round(viewScale * 100)}%`;
  render();
}

function fitView() {
  if (!syncCanvasSize()) {
    // Dimensions not ready yet — retry after a paint.
    requestAnimationFrame(fitView);
    return;
  }

  const v = currentView();
  if (!v || v.items.length === 0) {
    viewScale = 1; viewOffX = 40; viewOffY = 40;
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    v.items.forEach(i => {
      minX = Math.min(minX, i.bounds.x);
      minY = Math.min(minY, i.bounds.y);
      maxX = Math.max(maxX, i.bounds.x + i.bounds.width);
      maxY = Math.max(maxY, i.bounds.y + i.bounds.height);
    });
    const pad    = 60;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    viewScale = Math.min(
      (canvasW - pad * 2) / rangeX,
      (canvasH - pad * 2) / rangeY
    );
    viewOffX = canvasW / 2 - (minX + rangeX / 2) * viewScale;
    viewOffY = canvasH / 2 - (minY + rangeY / 2) * viewScale;
  }
  $('zoomInfo').textContent = `${Math.round(viewScale * 100)}%`;
  render();
}

// ─────────────────────────────────────────────────────────────────
// RENDERING
// ─────────────────────────────────────────────────────────────────

function render() {
  ctx.clearRect(0, 0, canvasW, canvasH);
  drawGrid();
  currentView()?.items.forEach(item => drawItem(item));
  updateViewLabel();
}

function drawGrid() {
  // Choose a world-space grid step that results in 15–60px between lines on screen.
  const minPx = 15, maxPx = 60;
  const rawStep = minPx / viewScale;
  // Round to a nice number: 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50 ...
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let niceStep: number;
  if      (normalized < 1.5) niceStep = 1;
  else if (normalized < 3.5) niceStep = 2;
  else if (normalized < 7.5) niceStep = 5;
  else                        niceStep = 10;
  const worldStep = niceStep * magnitude;
  const screenStep = worldStep * viewScale;
  if (screenStep < 1) return; // too dense, skip

  // World coordinate of canvas left/top edge
  const worldLeft = toWorldX(0);
  const worldTop  = toWorldY(0);

  // First grid line left of canvas
  const startX = Math.floor(worldLeft / worldStep) * worldStep;
  const startY = Math.floor(worldTop  / worldStep) * worldStep;

  ctx.strokeStyle = '#1a1d26';
  ctx.lineWidth   = 0.5;
  for (let wx = startX; toCanvasX(wx) < canvasW; wx += worldStep) {
    const cx = toCanvasX(wx);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvasH); ctx.stroke();
  }
  for (let wy = startY; toCanvasY(wy) < canvasH; wy += worldStep) {
    const cy = toCanvasY(wy);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(canvasW, cy); ctx.stroke();
  }

  // Axes (world origin lines)
  ctx.strokeStyle = '#3a3f55';
  ctx.lineWidth   = 1;
  const ox = toCanvasX(0);
  const oy = toCanvasY(0);
  if (ox >= 0 && ox <= canvasW) {
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, canvasH); ctx.stroke();
  }
  if (oy >= 0 && oy <= canvasH) {
    ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(canvasW, oy); ctx.stroke();
  }

  // Coord labels along axes when zoomed in enough
  if (screenStep > 40) {
    ctx.fillStyle = '#3a3f55';
    ctx.font      = '9px IBM Plex Mono, monospace';
    ctx.textAlign = 'left';
    for (let wx = startX; toCanvasX(wx) < canvasW; wx += worldStep) {
      const cx = toCanvasX(wx);
      const label = Number(wx.toPrecision(6)).toString();
      ctx.fillText(label, cx + 2, Math.min(Math.max(oy + 10, 10), canvasH - 4));
    }
    ctx.textAlign = 'left';
    for (let wy = startY; toCanvasY(wy) < canvasH; wy += worldStep) {
      if (Math.abs(wy) < worldStep * 0.01) continue; // skip 0, already shown on X axis
      const cy = toCanvasY(wy);
      const label = Number(wy.toPrecision(6)).toString();
      ctx.fillText(label, Math.min(Math.max(ox + 2, 2), canvasW - 40), cy - 2);
    }
  }
}

function rgba(c: Color, alphaOverride?: number): string {
  return `rgba(${Math.round(c.red*255)},${Math.round(c.green*255)},${Math.round(c.blue*255)},${alphaOverride ?? c.alpha})`;
}

function drawItem(item: LayoutItem) {
  const bx = toCanvasX(item.bounds.x);
  const by = toCanvasY(item.bounds.y);
  const bw = item.bounds.width  * viewScale;
  const bh = item.bounds.height * viewScale;
  const sel = item.id === selectedItemId;

  ctx.save();

  switch (item.type) {
    case 'rect':
      ctx.fillStyle   = rgba(item.color, item.color.alpha * 0.6);
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = sel ? '#e8ff4a' : rgba(item.color);
      ctx.lineWidth   = sel ? 2 : 1;
      ctx.strokeRect(bx, by, bw, bh);
      break;

    case 'disk':
      ctx.beginPath();
      ctx.ellipse(bx+bw/2, by+bh/2, bw/2, bh/2, 0, 0, Math.PI*2);
      ctx.fillStyle   = rgba(item.color, item.color.alpha * 0.6);
      ctx.fill();
      ctx.strokeStyle = sel ? '#e8ff4a' : rgba(item.color);
      ctx.lineWidth   = sel ? 2 : 1;
      ctx.stroke();
      break;

    case 'screen':
      ctx.fillStyle = '#000';
      ctx.fillRect(bx, by, bw, bh);
      for (let sy = by; sy < by+bh; sy += Math.max(2, bh/60)) {
        ctx.fillStyle = 'rgba(0,255,80,0.04)';
        ctx.fillRect(bx, sy, bw, Math.max(1, bh/120));
      }
      ctx.strokeStyle = sel ? '#e8ff4a' : '#4af0ff';
      ctx.lineWidth   = sel ? 2 : 1;
      ctx.strokeRect(bx, by, bw, bh);
      if (bh > 20) {
        ctx.fillStyle = '#4af0ff';
        ctx.font      = `${clamp(Math.floor(bh * 0.1), 9, 14)}px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`SCREEN ${item.screenIndex ?? 0}`, bx+bw/2, by+bh/2+4);
      }
      break;

    case 'text':
      ctx.fillStyle = 'rgba(20,22,30,0.7)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = sel ? '#e8ff4a' : '#b48cff';
      ctx.lineWidth   = sel ? 2 : 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
      if (bh > 10) {
        const fs = clamp(Math.floor(bh * 0.55), 9, 20);
        ctx.fillStyle = rgba(item.color);
        ctx.font      = `${fs}px "IBM Plex Sans", sans-serif`;
        ctx.textAlign = item.textAlign === 1 ? 'left' : item.textAlign === 2 ? 'right' : 'center';
        const tx      = item.textAlign === 1 ? bx+4 : item.textAlign === 2 ? bx+bw-4 : bx+bw/2;
        ctx.fillText(item.textString || '', tx, by + bh/2 + fs*0.35, bw-8);
      }
      break;

    case 'image':
      ctx.fillStyle = '#13151f';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255,200,74,0.06)';
      ctx.fillRect(bx+2, by+2, bw-4, bh-4);
      ctx.strokeStyle = sel ? '#e8ff4a' : '#ffc84a';
      ctx.lineWidth   = sel ? 2 : 1;
      ctx.strokeRect(bx, by, bw, bh);
      // cross
      ctx.strokeStyle = 'rgba(255,200,74,0.25)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx+bw, by+bh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx+bw, by); ctx.lineTo(bx, by+bh); ctx.stroke();
      if (bh > 16) {
        ctx.fillStyle = '#ffc84a';
        ctx.font      = `${clamp(Math.floor(bh*0.15), 8, 12)}px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(item.imageFile || '', bx+bw/2, by+bh-6, bw-8);
      }
      break;

    case 'led7seg':
    case 'led14seg':
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(bx, by, bw, bh);
      drawLed7Seg(bx + bw*0.1, by + bh*0.06, bw*0.8, bh*0.88, rgba(item.color), item.defstate ?? 63);
      ctx.strokeStyle = sel ? '#e8ff4a' : rgba(item.color, 0.4);
      ctx.lineWidth   = sel ? 2 : 1;
      ctx.strokeRect(bx, by, bw, bh);
      break;

    case 'group':
      ctx.fillStyle = 'rgba(200,200,200,0.04)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = sel ? '#e8ff4a' : '#666';
      ctx.lineWidth   = sel ? 2 : 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
      ctx.fillStyle = '#888';
      ctx.font      = '10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`group: ${item.groupRef || '?'}`, bx+6, by+14);
      break;
  }

  // name label
  const labelText = item.name;
  ctx.font = '9px "IBM Plex Mono", monospace';
  const lw = ctx.measureText(labelText).width + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(bx, by, Math.min(lw, bw), 13);
  ctx.fillStyle = sel ? '#e8ff4a' : '#7a7f9a';
  ctx.textAlign = 'left';
  ctx.fillText(labelText, bx+4, by+9, bw-8);

  if (sel) drawHandles(bx, by, bw, bh);
  ctx.restore();
}

function drawHandles(bx: number, by: number, bw: number, bh: number) {
  const hs = 6;
  const pts: [number, number][] = [
    [bx, by], [bx+bw/2, by], [bx+bw, by],
    [bx+bw, by+bh/2],
    [bx+bw, by+bh], [bx+bw/2, by+bh], [bx, by+bh],
    [bx, by+bh/2],
  ];
  pts.forEach(([hx, hy]) => {
    ctx.fillStyle   = '#0d0e12';
    ctx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
    ctx.strokeStyle = '#e8ff4a';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(hx-hs/2, hy-hs/2, hs, hs);
  });
}

function drawLed7Seg(x: number, y: number, w: number, h: number, color: string, state: number) {
  const sw  = w * 0.14;
  const gap = sw * 0.3;
  const segs: Array<() => void> = [
    () => ctx.fillRect(x+gap+sw, y,                 w-2*gap-2*sw, sw),           // top
    () => ctx.fillRect(x+w-sw,   y+gap+sw,          sw, h/2-2*gap-sw),           // top-right
    () => ctx.fillRect(x+w-sw,   y+h/2+gap,         sw, h/2-2*gap-sw),           // bot-right
    () => ctx.fillRect(x+gap+sw, y+h-sw,            w-2*gap-2*sw, sw),           // bottom
    () => ctx.fillRect(x,        y+h/2+gap,         sw, h/2-2*gap-sw),           // bot-left
    () => ctx.fillRect(x,        y+gap+sw,          sw, h/2-2*gap-sw),           // top-left
    () => ctx.fillRect(x+gap+sw, y+h/2-sw/2,        w-2*gap-2*sw, sw),           // middle
  ];
  segs.forEach((draw, i) => {
    ctx.fillStyle = (state & (1 << i)) ? color : 'rgba(80,20,5,0.7)';
    draw();
  });
}

// ─────────────────────────────────────────────────────────────────
// HIT TESTING & HANDLES
// ─────────────────────────────────────────────────────────────────

const HANDLE_DIRS = ['nw','n','ne','e','se','s','sw','w'] as const;
type HandleDir = typeof HANDLE_DIRS[number];
const HANDLE_CURSORS: Record<HandleDir, string> = {
  nw:'nw-resize', n:'n-resize', ne:'ne-resize', e:'e-resize',
  se:'se-resize', s:'s-resize', sw:'sw-resize', w:'w-resize',
};

function getHandle(item: LayoutItem, mx: number, my: number): HandleDir | null {
  const bx = toCanvasX(item.bounds.x), by = toCanvasY(item.bounds.y);
  const bw = item.bounds.width * viewScale, bh = item.bounds.height * viewScale;
  const hs = 7;
  const pts: [number, number, HandleDir][] = [
    [bx,      by,      'nw'], [bx+bw/2, by,      'n'], [bx+bw, by,      'ne'],
    [bx+bw,   by+bh/2, 'e'],
    [bx+bw,   by+bh,   'se'], [bx+bw/2, by+bh,   's'], [bx,    by+bh,   'sw'],
    [bx,      by+bh/2, 'w'],
  ];
  for (const [hx, hy, dir] of pts) {
    if (Math.abs(mx-hx) < hs && Math.abs(my-hy) < hs) return dir;
  }
  return null;
}

function hitTest(mx: number, my: number): LayoutItem | null {
  const v = currentView();
  if (!v) return null;
  for (let i = v.items.length - 1; i >= 0; i--) {
    const item = v.items[i];
    const bx = toCanvasX(item.bounds.x), by = toCanvasY(item.bounds.y);
    const bw = item.bounds.width * viewScale, bh = item.bounds.height * viewScale;
    if (mx >= bx && mx <= bx+bw && my >= by && my <= by+bh) return item;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// MOUSE EVENTS
// ─────────────────────────────────────────────────────────────────

canvas.addEventListener('mousedown', e => {
  canvas.focus();
  const mx = e.offsetX, my = e.offsetY;

  if (currentTool === 'pan' || e.button === 1) {
    isPanning = true;
    panStartX = mx; panStartY = my;
    panOriginX = viewOffX; panOriginY = viewOffY;
    canvas.style.cursor = 'grabbing';
    return;
  }

  // resize handle?
  if (selectedItemId) {
    const sel = selectedItem();
    if (sel) {
      const h = getHandle(sel, mx, my);
      if (h) {
        isResizing = true; resizeHandle = h;
        dragStartX = mx; dragStartY = my;
        dragItemOrig = { ...sel.bounds };
        return;
      }
    }
  }

  const hit = hitTest(mx, my);
  if (hit) {
    selectedItemId = hit.id;
    isDragging = true;
    dragStartX = mx; dragStartY = my;
    dragItemOrig = { ...hit.bounds };
  } else {
    selectedItemId = null;
  }
  refreshLayers();
  renderProps();
  render();
});

canvas.addEventListener('mousemove', e => {
  const mx = e.offsetX, my = e.offsetY;

  if (isPanning) {
    viewOffX = panOriginX + mx - panStartX;
    viewOffY = panOriginY + my - panStartY;
    render(); return;
  }

  if (isResizing) {
    const item = selectedItem();
    if (!item || !dragItemOrig) return;
    const dx = (mx - dragStartX) / viewScale;
    const dy = (my - dragStartY) / viewScale;
    let { x, y, width, height } = dragItemOrig;
    const h = resizeHandle;
    if (h.includes('e')) { width  = snap(Math.max(8, width + dx)); }
    if (h.includes('s')) { height = snap(Math.max(8, height + dy)); }
    if (h.includes('w')) { const nw = snap(Math.max(8, width - dx)); x = snap(x + width - nw); width = nw; }
    if (h.includes('n')) { const nh = snap(Math.max(8, height - dy)); y = snap(y + height - nh); height = nh; }
    item.bounds = { x, y, width, height };
    renderProps(); updateXmlPreview(); render(); return;
  }

  if (isDragging && selectedItemId) {
    const item = selectedItem();
    if (!item || !dragItemOrig) return;
    item.bounds.x = snap(dragItemOrig.x + (mx - dragStartX) / viewScale);
    item.bounds.y = snap(dragItemOrig.y + (my - dragStartY) / viewScale);
    renderProps(); updateXmlPreview(); render(); return;
  }

  // cursor hints
  if (selectedItemId) {
    const sel = selectedItem();
    if (sel) {
      const h = getHandle(sel, mx, my);
      if (h) { canvas.style.cursor = HANDLE_CURSORS[h]; return; }
    }
  }
  canvas.style.cursor = hitTest(mx, my) ? 'move' : 'crosshair';
});

canvas.addEventListener('mouseup', () => {
  isDragging = false; isResizing = false; isPanning = false;
  canvas.style.cursor = currentTool === 'pan' ? 'grab' : 'crosshair';
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.1 : 0.91;
  viewOffX = e.offsetX - f * (e.offsetX - viewOffX);
  viewOffY = e.offsetY - f * (e.offsetY - viewOffY);
  viewScale *= f;
  $('zoomInfo').textContent = `${Math.round(viewScale * 100)}%`;
  render();
}, { passive: false });

canvas.setAttribute('tabindex', '0');
canvas.addEventListener('keydown', e => {
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === 'h' || e.key === 'H') setTool('pan');
  if (e.key === 'f' || e.key === 'F') fitView();
  const item = selectedItem();
  if (item) {
    const d = e.shiftKey ? SNAP * 4 : SNAP;
    if (e.key === 'ArrowLeft')  { item.bounds.x -= d; e.preventDefault(); }
    if (e.key === 'ArrowRight') { item.bounds.x += d; e.preventDefault(); }
    if (e.key === 'ArrowUp')    { item.bounds.y -= d; e.preventDefault(); }
    if (e.key === 'ArrowDown')  { item.bounds.y += d; e.preventDefault(); }
    renderProps(); updateXmlPreview(); render();
  }
});

// ─────────────────────────────────────────────────────────────────
// DRAG FROM PALETTE
// ─────────────────────────────────────────────────────────────────

function paletteDragStart(e: DragEvent) {
  const el = (e.target as HTMLElement).closest('[data-type]') as HTMLElement | null;
  dragPaletteType = el?.dataset.type || null;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
}

function canvasDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

function canvasDrop(e: DragEvent) {
  e.preventDefault();
  if (!dragPaletteType) return;
  const rect = canvas.getBoundingClientRect();
  addItemAt(dragPaletteType, e.clientX - rect.left, e.clientY - rect.top);
  dragPaletteType = null;
}

// ─────────────────────────────────────────────────────────────────
// PROPERTIES PANEL
// ─────────────────────────────────────────────────────────────────

function renderProps() {
  if (currentTab !== 'props') { updateXmlPreview(); return; }
  const area = $('tabPropsContent');
  const item = selectedItem();

  if (!item) {
    const v = currentView();
    area.innerHTML = v
      ? `<div class="prop-group">
           <div class="prop-group-title">View</div>
           <div class="prop-row">
             <span class="prop-label">name</span>
             <input type="text" value="${esc(v.name)}" oninput="onViewNameChange(this.value)">
           </div>
         </div>
         <p class="no-sel">Select an element to edit its properties.</p>`
      : '<p class="no-sel">No view selected.</p>';
    return;
  }

  const c  = item.color;
  const b  = item.bounds;
  let extra = '';

  if (item.type === 'screen') {
    extra = `<div class="prop-group">
      <div class="prop-group-title">Screen</div>
      <div class="prop-row"><span class="prop-label">index</span>
        <input type="number" value="${item.screenIndex ?? 0}" min="0" max="15"
          oninput="onPropNum('screenIndex',this.value)">
      </div></div>`;
  } else if (item.type === 'text') {
    extra = `<div class="prop-group">
      <div class="prop-group-title">Text</div>
      <div class="prop-row"><span class="prop-label">string</span>
        <input type="text" value="${esc(item.textString||'')}" oninput="onPropStr('textString',this.value)">
      </div>
      <div class="prop-row"><span class="prop-label">align</span>
        <select onchange="onPropNum('textAlign',this.value)">
          <option value="0"${item.textAlign===0?' selected':''}>Center</option>
          <option value="1"${item.textAlign===1?' selected':''}>Left</option>
          <option value="2"${item.textAlign===2?' selected':''}>Right</option>
          <option value="3"${item.textAlign===3?' selected':''}>Stretch</option>
        </select>
      </div></div>`;
  } else if (item.type === 'image') {
    extra = `<div class="prop-group">
      <div class="prop-group-title">Image</div>
      <div class="prop-row"><span class="prop-label">file</span>
        <input type="text" value="${esc(item.imageFile||'')}" oninput="onPropStr('imageFile',this.value)">
      </div></div>`;
  } else if (item.type === 'group') {
    extra = `<div class="prop-group">
      <div class="prop-group-title">Group</div>
      <div class="prop-row"><span class="prop-label">ref</span>
        <input type="text" value="${esc(item.groupRef||'')}" oninput="onPropStr('groupRef',this.value)">
      </div></div>`;
  } else if (item.type === 'led7seg' || item.type === 'led14seg') {
    extra = `<div class="prop-group">
      <div class="prop-group-title">LED display</div>
      <div class="prop-row"><span class="prop-label">defstate</span>
        <input type="number" value="${item.defstate ?? 0}" min="0"
          oninput="onPropNum('defstate',this.value)">
      </div></div>`;
  }

  area.innerHTML = `
    <div class="prop-group">
      <div class="prop-group-title">Identity</div>
      <div class="prop-row"><span class="prop-label">name</span>
        <input type="text" value="${esc(item.name)}" oninput="onPropStr('name',this.value);refreshLayers()">
      </div>
      <div class="prop-row"><span class="prop-label">type</span>
        <span class="type-tag type-${item.type}">${item.type}</span>
      </div>
    </div>
    <div class="prop-group">
      <div class="prop-group-title">Bounds</div>
      <div class="prop-row"><span class="prop-label">x</span>
        <input type="number" value="${b.x}" oninput="onBounds('x',this.value)">
        <span class="prop-label ml">y</span>
        <input type="number" value="${b.y}" oninput="onBounds('y',this.value)">
      </div>
      <div class="prop-row"><span class="prop-label">w</span>
        <input type="number" value="${b.width}" min="1" oninput="onBounds('width',this.value)">
        <span class="prop-label ml">h</span>
        <input type="number" value="${b.height}" min="1" oninput="onBounds('height',this.value)">
      </div>
    </div>
    <div class="prop-group">
      <div class="prop-group-title">Color (0.0 – 1.0)</div>
      <div class="prop-row"><span class="prop-label">R</span>
        <input type="number" step="0.01" min="0" max="1" value="${c.red.toFixed(3)}" oninput="onColor('red',this.value)">
        <span class="prop-label ml">G</span>
        <input type="number" step="0.01" min="0" max="1" value="${c.green.toFixed(3)}" oninput="onColor('green',this.value)">
      </div>
      <div class="prop-row"><span class="prop-label">B</span>
        <input type="number" step="0.01" min="0" max="1" value="${c.blue.toFixed(3)}" oninput="onColor('blue',this.value)">
        <span class="prop-label ml">A</span>
        <input type="number" step="0.01" min="0" max="1" value="${c.alpha.toFixed(3)}" oninput="onColor('alpha',this.value)">
      </div>
      <div class="prop-row"><span class="prop-label">pick</span>
        <input type="color" value="${colorToHex(c)}" oninput="onColorPick(this.value)">
        <span class="hex-label">${colorToHex(c)}</span>
      </div>
    </div>
    ${extra}
    <div class="prop-group">
      <div class="prop-group-title">I/O Binding</div>
      <div class="prop-row"><span class="prop-label">inputtag</span>
        <input type="text" value="${esc(item.inputtag||'')}" placeholder="e.g. IN0" oninput="onPropStr('inputtag',this.value)">
      </div>
      <div class="prop-row"><span class="prop-label">mask</span>
        <input type="text" value="${item.inputmask !== undefined ? '0x'+item.inputmask.toString(16) : ''}"
          placeholder="0x01" oninput="onPropHex('inputmask',this.value)">
      </div>
    </div>
    <div class="prop-group">
      <button class="btn btn-danger full" onclick="deleteSelected()">✕  Delete element</button>
    </div>`;
}

// ─── prop callbacks (called from inline HTML) ───

function onViewNameChange(val: string) {
  const v = currentView();
  if (v) { v.name = val; refreshViewsList(); updateViewLabel(); }
}
function onPropStr(key: string, val: string) {
  const item = selectedItem(); if (!item) return;
  (item as unknown as Record<string, unknown>)[key] = val;
  render(); updateXmlPreview();
}
function onPropNum(key: string, val: string) {
  const item = selectedItem(); if (!item) return;
  const n = parseFloat(val); if (isNaN(n)) return;
  (item as unknown as Record<string, unknown>)[key] = n;
  render(); updateXmlPreview();
}
function onPropHex(key: string, val: string) {
  const item = selectedItem(); if (!item) return;
  const n = parseInt(val, val.startsWith('0x') || val.startsWith('0X') ? 16 : 10);
  if (!isNaN(n)) (item as unknown as Record<string, unknown>)[key] = n;
  updateXmlPreview();
}
function onBounds(key: string, val: string) {
  const item = selectedItem(); if (!item) return;
  const n = parseFloat(val); if (isNaN(n)) return;
  (item.bounds as unknown as Record<string, unknown>)[key] = n;
  render(); updateXmlPreview();
}
function onColor(key: string, val: string) {
  const item = selectedItem(); if (!item) return;
  const n = parseFloat(val); if (isNaN(n)) return;
  (item.color as unknown as Record<string, unknown>)[key] = clamp(n, 0, 1);
  render(); updateXmlPreview();
}
function onColorPick(hex: string) {
  const item = selectedItem(); if (!item) return;
  item.color.red   = parseInt(hex.slice(1,3), 16) / 255;
  item.color.green = parseInt(hex.slice(3,5), 16) / 255;
  item.color.blue  = parseInt(hex.slice(5,7), 16) / 255;
  renderProps(); render(); updateXmlPreview();
}

function colorToHex(c: Color): string {
  return '#' +
    Math.round(c.red*255).toString(16).padStart(2,'0') +
    Math.round(c.green*255).toString(16).padStart(2,'0') +
    Math.round(c.blue*255).toString(16).padStart(2,'0');
}

// ─────────────────────────────────────────────────────────────────
// XML GENERATION
// ─────────────────────────────────────────────────────────────────

function fmtBounds(b: Bounds) {
  return `x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"`;
}
function fmtColor(c: Color) {
  return `red="${c.red.toFixed(3)}" green="${c.green.toFixed(3)}" blue="${c.blue.toFixed(3)}" alpha="${c.alpha.toFixed(3)}"`;
}
function fmtInnerBounds(b: Bounds) {
  return `x="0" y="0" width="${b.width}" height="${b.height}"`;
}

function elementDef(item: LayoutItem): string | null {
  const ib = fmtInnerBounds(item.bounds);
  const col = fmtColor(item.color);
  const n = esc(item.name);
  switch (item.type) {
    case 'rect':
      return `    <element name="${n}">\n        <rect>\n            <bounds ${ib} />\n            <color ${col} />\n        </rect>\n    </element>`;
    case 'disk':
      return `    <element name="${n}">\n        <disk>\n            <bounds ${ib} />\n            <color ${col} />\n        </disk>\n    </element>`;
    case 'text':
      return `    <element name="${n}">\n        <text string="${esc(item.textString||'')}" align="${item.textAlign??0}">\n            <bounds ${ib} />\n            <color ${col} />\n        </text>\n    </element>`;
    case 'image':
      return `    <element name="${n}">\n        <image file="${esc(item.imageFile||'')}">\n            <bounds ${ib} />\n        </image>\n    </element>`;
    case 'led7seg':
      return `    <element name="${n}" defstate="${item.defstate??0}">\n        <led7seg>\n            <bounds ${ib} />\n            <color ${col} />\n        </led7seg>\n    </element>`;
    case 'led14seg':
      return `    <element name="${n}" defstate="${item.defstate??0}">\n        <led14seg>\n            <bounds ${ib} />\n            <color ${col} />\n        </led14seg>\n    </element>`;
    default:
      return null;
  }
}

function viewItemXml(item: LayoutItem, ind = '        '): string {
  const b = fmtBounds(item.bounds);
  const n = esc(item.name);
  if (item.type === 'screen') {
    return `${ind}<screen index="${item.screenIndex??0}">\n${ind}    <bounds ${b} />\n${ind}</screen>`;
  }
  if (item.type === 'group') {
    return `${ind}<group ref="${esc(item.groupRef||item.name)}">\n${ind}    <bounds ${b} />\n${ind}</group>`;
  }
  let extra = '';
  if (item.inputtag) extra += ` inputtag="${esc(item.inputtag)}"`;
  if (item.inputmask !== undefined) extra += ` inputmask="0x${item.inputmask.toString(16)}"`;
  return `${ind}<element name="${n}" ref="${n}"${extra}>\n${ind}    <bounds ${b} />\n${ind}</element>`;
}

function generateXML(): string {
  const allItems = doc.views.flatMap(v => v.items);
  const defs = allItems
    .filter(i => i.type !== 'screen' && i.type !== 'group')
    .map(elementDef)
    .filter(Boolean) as string[];

  let xml = `<?xml version="1.0" encoding="utf-8"?>\n<mamelayout version="2">\n`;
  if (defs.length) {
    xml += `\n    <!-- Element definitions -->\n` + defs.join('\n\n') + '\n';
  }
  doc.views.forEach(v => {
    xml += `\n    <view name="${esc(v.name)}">\n`;
    v.items.forEach(i => { xml += viewItemXml(i) + '\n'; });
    xml += `    </view>\n`;
  });
  xml += `\n</mamelayout>\n`;
  return xml;
}

// ─────────────────────────────────────────────────────────────────
// XML PREVIEW
// ─────────────────────────────────────────────────────────────────

function syntaxHL(xml: string): string {
  return xml
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/(&lt;\/?[\w:]+)/g,  '<span class="xt">$1</span>')
    .replace(/(\w[\w-]*)=(&quot;[^&]*&quot;)/g, '<span class="xa">$1</span>=<span class="xv">$2</span>')
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="xc">$1</span>');
}

function updateXmlPreview() {
  if (currentTab !== 'xml') return;
  $('xmlPreview').innerHTML = syntaxHL(generateXML());
}

// ─────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────

function switchTab(tab: string) {
  currentTab = tab;
  $('tabProps').className = 'tab' + (tab==='props' ? ' active' : '');
  $('tabXml').className   = 'tab' + (tab==='xml'   ? ' active' : '');
  $('tabPropsContent').style.display = tab==='props' ? 'block' : 'none';
  $('tabXmlContent').style.display   = tab==='xml'   ? 'block' : 'none';
  if (tab === 'xml') updateXmlPreview(); else renderProps();
}

// ─────────────────────────────────────────────────────────────────
// IMPORT / EXPORT
// ─────────────────────────────────────────────────────────────────

function exportXML() {
  const blob = new Blob([generateXML()], { type: 'text/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'layout.lay';
  a.click();
}

function copyXML() {
  navigator.clipboard.writeText(generateXML()).then(() => {
    const btn = document.querySelector('.btn-copy') as HTMLElement;
    if (!btn) return;
    const orig = btn.textContent || '';
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1600);
  });
}

function importXML() {
  const modal = $('importModal');
  modal.style.display = 'flex';
  ($('importText') as HTMLTextAreaElement).value = '';
}

function closeModal(id: string) {
  $(id).style.display = 'none';
}

function doImport() {
  const text = ($('importText') as HTMLTextAreaElement).value.trim();
  if (!text) return;
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');
    const parseErr = xmlDoc.querySelector('parsererror');
    if (parseErr) throw new Error(parseErr.textContent || 'XML parse error');
    parseLayoutDoc(xmlDoc);
    closeModal('importModal');
  } catch (err: unknown) {
    alert('Import failed: ' + (err instanceof Error ? err.message : String(err)));
  }
}

function parseLayoutDoc(xmlDoc: Document) {
  const newDoc: LayoutDoc = { views: [], elements: [] };
  const elemDefs: Record<string, ElementDef> = {};

  // ── parse element definitions ──
  xmlDoc.querySelectorAll('mamelayout > element').forEach(el => {
    const name     = el.getAttribute('name') || genId();
    const defstate = parseInt(el.getAttribute('defstate') || '0');
    const def: ElementDef = { id: genId(), name, components: [] };

    el.querySelectorAll('rect,disk,text,image,led7seg,led14seg').forEach(comp => {
      // For multi-state elements pick the "on" state (state=1) color if present,
      // otherwise fall back to the first color child.
      const stateAttr = comp.getAttribute('state');
      const compState = stateAttr !== null ? parseInt(stateAttr) : null;

      // Find the color child. Some elements embed color as child, some as attribute.
      const colorEl = comp.querySelector(':scope > color');
      const color   = parseColorEl(colorEl);

      const bounds  = parseBoundsEl(comp.querySelector(':scope > bounds'));
      const ci: LayoutItem = {
        id: genId(), name,
        type: comp.tagName.toLowerCase() as ItemType,
        bounds, color,
        defstate,
      };
      if (comp.tagName === 'text') {
        ci.textString = comp.getAttribute('string') || '';
        ci.textAlign  = parseInt(comp.getAttribute('align') || '0');
      }
      if (comp.tagName === 'image') ci.imageFile = comp.getAttribute('file') || '';

      // Only add the component that represents the "on"/"active" state for display.
      // If compState is null (no state attr) or 1, we include it.
      // If compState === 0 (dim/off state) and there's also a state=1 component, skip it.
      // We'll resolve this after collecting all components.
      (ci as LayoutItem & { _state?: number })._state = compState ?? -1;
      def.components.push(ci);
    });

    // For elements with state-based rects: prefer the state=1 component for display color.
    // Collapse multi-state sets into a single representative component.
    const byType = new Map<string, Array<LayoutItem & { _state?: number }>>();
    for (const c of def.components as Array<LayoutItem & { _state?: number }>) {
      const key = c.type;
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(c);
    }
    def.components = [];
    byType.forEach(group => {
      // pick state=1 if available, else state=-1, else first
      const onState = group.find(c => c._state === 1);
      const noState = group.find(c => c._state === -1);
      const picked  = onState ?? noState ?? group[0];
      delete (picked as unknown as Record<string,unknown>)._state;
      def.components.push(picked);
    });

    elemDefs[name] = def;
    newDoc.elements.push(def);
  });

  // ── parse views ──
  xmlDoc.querySelectorAll('mamelayout > view').forEach(vEl => {
    const view: ViewDef = { id: genId(), name: vEl.getAttribute('name') || 'View', items: [] };
    parseViewChildren(vEl, view, elemDefs, {});
    newDoc.views.push(view);
  });

  if (newDoc.views.length === 0) newDoc.views.push({ id: genId(), name: 'Default', items: [] });
  doc            = newDoc;
  currentViewId  = doc.views[0].id;
  selectedItemId = null;
  refreshViewsList();
  refreshLayers();
  updateViewLabel();
  renderProps();
  // Defer fit so the modal has closed and the canvas has its real dimensions.
  requestAnimationFrame(fitView);
}

// Recursively parse children of a view or repeat block, expanding params.
function parseViewChildren(
  parent: Element,
  view: ViewDef,
  elemDefs: Record<string, ElementDef>,
  params: Record<string, number | string>
) {
  for (const child of Array.from(parent.children)) {
    switch (child.tagName.toLowerCase()) {

      case 'screen': {
        const idx = parseInt(subParams(child.getAttribute('index') || '0', params));
        view.items.push({
          id: genId(), type: 'screen',
          name: `screen${idx}`,
          bounds: parseBoundsEl(child.querySelector('bounds')),
          color:  {red:1,green:1,blue:1,alpha:1},
          screenIndex: idx,
        });
        break;
      }

      case 'element': {
        const ref    = subParams(child.getAttribute('ref') || child.getAttribute('name') || '', params);
        const iname  = subParams(child.getAttribute('name') || ref, params);
        const def    = elemDefs[ref];
        const base   = def?.components[0];
        const bounds = parseBoundsEl(child.querySelector('bounds'));
        view.items.push({
          id: genId(),
          type:       base?.type || 'rect',
          name:       iname,
          bounds,
          color:      base?.color || {red:1,green:1,blue:1,alpha:1},
          defstate:   base?.defstate,
          textString: base?.textString,
          textAlign:  base?.textAlign,
          imageFile:  base?.imageFile,
          inputtag:   child.getAttribute('inputtag')  || undefined,
          inputmask:  child.hasAttribute('inputmask')
                        ? parseMAMEInt(child.getAttribute('inputmask')!)
                        : undefined,
        });
        break;
      }

      case 'group': {
        const ref    = subParams(child.getAttribute('ref') || '', params);
        const bounds = parseBoundsEl(child.querySelector('bounds'));
        view.items.push({
          id: genId(), type: 'group',
          name: ref || 'group',
          bounds,
          color: {red:1,green:1,blue:1,alpha:1},
          groupRef: ref,
        });
        break;
      }

      case 'repeat': {
        const count = parseInt(child.getAttribute('count') || '1');
        // collect param elements inside this repeat
        const paramEls = Array.from(child.querySelectorAll(':scope > param'));
        // build initial param state for this repeat scope
        const repParams: Record<string, { val: number|string; increment: number; lshift: number; rshift: number; isGen: boolean }> = {};
        paramEls.forEach(p => {
          const pname = p.getAttribute('name') || '';
          if (p.getAttribute('start') !== null) {
            repParams[pname] = {
              val:       parseMAMENum(p.getAttribute('start')!, params),
              increment: parseFloat(p.getAttribute('increment') || '0'),
              lshift:    parseInt(p.getAttribute('lshift') || '0'),
              rshift:    parseInt(p.getAttribute('rshift') || '0'),
              isGen: true,
            };
          }
          // value params inside repeat inherit outer scope
        });

        for (let iter = 0; iter < count; iter++) {
          // build merged params for this iteration
          const iterParams: Record<string, number|string> = { ...params };
          // apply value params from the repeat element (re-evaluate each iter for inner params)
          paramEls.forEach(p => {
            const pname = p.getAttribute('name') || '';
            if (p.getAttribute('value') !== null) {
              iterParams[pname] = subParams(p.getAttribute('value')!, iterParams);
            }
          });
          // apply generator params current values
          Object.entries(repParams).forEach(([pname, state]) => {
            iterParams[pname] = typeof state.val === 'number'
              ? String(Math.round(state.val * 1e9) / 1e9)   // avoid float noise
              : state.val;
          });

          // recurse into non-param children
          const inner = document.createElement('div');
          Array.from(child.children).forEach(c => {
            if (c.tagName.toLowerCase() !== 'param') inner.appendChild(c.cloneNode(true));
          });
          parseViewChildren(inner, view, elemDefs, iterParams);

          // advance generator params
          Object.values(repParams).forEach(state => {
            if (!state.isGen) return;
            let v = typeof state.val === 'string' ? parseFloat(state.val) : state.val as number;
            v += state.increment;
            if (state.lshift) v = (v as number) * Math.pow(2, state.lshift);
            if (state.rshift) v = Math.floor((v as number) / Math.pow(2, state.rshift));
            state.val = v;
          });
        }
        break;
      }
    }
  }
}

// Substitute ~paramname~ tokens in a string
function subParams(s: string, params: Record<string, number|string>): string {
  return s.replace(/~(\w+)~/g, (_, name) => String(params[name] ?? `~${name}~`));
}

// Parse a MAME integer (decimal, #decimal, $hex, 0xhex)
function parseMAMEInt(s: string): number {
  s = s.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16);
  if (s.startsWith('$'))  return parseInt(s.slice(1), 16);
  if (s.startsWith('#'))  return parseInt(s.slice(1), 10);
  return parseInt(s, 10);
}

// Parse a MAME number that might be a param-substituted string
function parseMAMENum(s: string, params: Record<string, number|string>): number|string {
  const sub = subParams(s, params);
  const n = parseFloat(sub);
  return isNaN(n) ? sub : n;
}

function parseBoundsEl(el: Element | null): Bounds {
  if (!el) return { x:0, y:0, width:1, height:1 };
  const left   = el.getAttribute('left');
  const right  = el.getAttribute('right');
  const top    = el.getAttribute('top');
  const bottom = el.getAttribute('bottom');
  const x      = el.getAttribute('x');
  const y      = el.getAttribute('y');
  const xc     = el.getAttribute('xc');
  const yc     = el.getAttribute('yc');
  const w      = el.getAttribute('width');
  const h      = el.getAttribute('height');

  let bx: number, by: number, bw: number, bh: number;

  // horizontal
  if (left !== null && right !== null) {
    bx = parseFloat(left); bw = parseFloat(right) - bx;
  } else if (x !== null && w !== null) {
    bx = parseFloat(x); bw = parseFloat(w);
  } else if (xc !== null && w !== null) {
    bw = parseFloat(w); bx = parseFloat(xc) - bw / 2;
  } else if (left !== null && w !== null) {
    bx = parseFloat(left); bw = parseFloat(w);
  } else if (x !== null) {
    bx = parseFloat(x); bw = w !== null ? parseFloat(w) : 1;
  } else if (left !== null) {
    bx = parseFloat(left); bw = 1;
  } else {
    bx = 0; bw = w !== null ? parseFloat(w) : 1;
  }

  // vertical
  if (top !== null && bottom !== null) {
    by = parseFloat(top); bh = parseFloat(bottom) - by;
  } else if (y !== null && h !== null) {
    by = parseFloat(y); bh = parseFloat(h);
  } else if (yc !== null && h !== null) {
    bh = parseFloat(h); by = parseFloat(yc) - bh / 2;
  } else if (top !== null && h !== null) {
    by = parseFloat(top); bh = parseFloat(h);
  } else if (y !== null) {
    by = parseFloat(y); bh = h !== null ? parseFloat(h) : 1;
  } else if (top !== null) {
    by = parseFloat(top); bh = 1;
  } else {
    by = 0; bh = h !== null ? parseFloat(h) : 1;
  }

  return { x: bx, y: by, width: Math.max(bw, 0.001), height: Math.max(bh, 0.001) };
}
function parseColorEl(el: Element | null): Color {
  if (!el) return {red:1,green:1,blue:1,alpha:1};
  return {
    red:   parseFloat(el.getAttribute('red')   || '1'),
    green: parseFloat(el.getAttribute('green') || '1'),
    blue:  parseFloat(el.getAttribute('blue')  || '1'),
    alpha: parseFloat(el.getAttribute('alpha') || '1'),
  };
}

// ─────────────────────────────────────────────────────────────────
// EXPOSE TO WINDOW (for inline HTML handlers)
// ─────────────────────────────────────────────────────────────────

const W = window as unknown as Record<string, unknown>;
W.setTool          = setTool;
W.toggleSnap       = toggleSnap;
W.zoom             = zoom;
W.fitView          = fitView;
W.addView          = addView;
W.selectView       = selectView;
W.deleteView       = deleteView;
W.renameView       = renameView;
W.deleteSelected   = deleteSelected;
W.paletteDragStart = paletteDragStart;
W.canvasDragOver   = canvasDragOver;
W.canvasDrop       = canvasDrop;
W.switchTab        = switchTab;
W.exportXML        = exportXML;
W.copyXML          = copyXML;
W.importXML        = importXML;
W.closeModal       = closeModal;
W.doImport         = doImport;
W.onViewNameChange = onViewNameChange;
W.onPropStr        = onPropStr;
W.onPropNum        = onPropNum;
W.onPropHex        = onPropHex;
W.onBounds         = onBounds;
W.onColor          = onColor;
W.onColorPick      = onColorPick;
W.refreshLayers    = refreshLayers;

// ─────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────

init();
