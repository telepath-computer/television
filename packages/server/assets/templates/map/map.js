// Store snapshots supply places; the page owns the camera, open panel, and
// selected key. The list remains mounted while details replace it visually.
import { getStore, onConnectionStatusChanged, onValue, ref } from '/sdk/v1/resources.js';
import { icons } from './vendor/lucide/icons.js';

const L = window.L;
const byId = (id) => document.getElementById(id);
const app = document.querySelector('.app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const narrow = matchMedia('(max-width: 640px)');
const svgNamespace = 'http://www.w3.org/2000/svg';
const categoryColors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'neutral'];
const stableKey = /^[A-Za-z][A-Za-z0-9_-]*$/;
const maxMapZoom = 19;
const pinSize = L.point(38, 48);
const pinAnchor = L.point(19, 46);
export const map = L.map('map', {
  zoomControl: false, worldCopyJump: true, inertia: !reducedMotion.matches,
  zoomAnimation: !reducedMotion.matches, fadeAnimation: !reducedMotion.matches,
}).setView([20, 0], 2);
const service = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const standard = L.tileLayer(`${service}World_Street_Map/MapServer/tile/{z}/{y}/{x}`, { maxZoom: maxMapZoom, className: 'street-tiles', attribution: 'Tiles © Esri' });
const imagery = L.tileLayer(`${service}World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: maxMapZoom, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community' });
const labels = L.tileLayer(`${service}Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: maxMapZoom, attribution: 'Labels © Esri' });
let places = [], markers = [], rows = [], selectedKey = null;
let visibleIndices = [];
let selectionOrigin = 'list', selectionOriginKey = null, listScrollTop = 0, sidebarOpen = true;
let locationSignature = '', storedBasemap, storedSidebar, basemap = 'standard', mapTitle = '';
let sheetState = 'half', sheetHeight = 0, sheetPointer = null, sheetWheel = null;
let sheetWheelTimer, suppressSheetClickUntil = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgNode(tag, attributes) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function placeGlyph(name) {
  const icon = typeof name === 'string' && Object.hasOwn(icons, name) ? name : 'pin';
  const svg = svgNode('svg', { viewBox: '0 0 24 24', class: 'glyph pin-glyph', 'aria-hidden': 'true', 'data-icon': icon });
  for (const [tag, attributes] of icons[icon]) svg.append(svgNode(tag, attributes));
  return svg;
}

function categoryGlyph(place) {
  const glyph = placeGlyph(place.icon);
  glyph.classList.add('category-glyph');
  return glyph;
}

// Resolve category defaults once per snapshot, independently of place order.
// Only automatic categories consume palette slots; explicit colours stay fixed.
function readCategories(value) {
  const categories = new Map();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return categories;
  let automaticColor = 0;
  for (const key of Object.keys(value).sort()) {
    const category = value[key];
    if (!stableKey.test(key) || !category || typeof category.name !== 'string' || !category.name) continue;
    categories.set(key, {
      name: category.name,
      icon: typeof category.icon === 'string' && Object.hasOwn(icons, category.icon) ? category.icon : 'pin',
      color: categoryColors.includes(category.color) ? category.color : categoryColors[automaticColor++ % categoryColors.length],
    });
  }
  return categories;
}

// Later writes bypass schema validation. URLs must remain passive image/credit
// references, and local paths must stay inside the copied artifact folder.
function httpsURL(value) {
  if (typeof value !== 'string' || !value.startsWith('https://') || /[\s\u0000-\u001f]/.test(value)) return null;
  try { return new URL(value).protocol === 'https:' ? value : null; } catch { return null; }
}

function photoURL(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('https://')) return httpsURL(value);
  const path = value.startsWith('./') ? value.slice(2) : value;
  if (path !== path.trim() || /[\\:%?#\u0000-\u001f]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return path;
}

function thumbnail(place) {
  const url = photoURL(place.photo);
  if (!url) return null;
  const frame = element('span', 'thumbnail');
  frame.append(placeGlyph(place.icon));
  const image = element('img');
  image.src = url;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('error', () => image.remove(), { once: true });
  frame.append(image);
  return frame;
}

function setBasemap(next) {
  basemap = next;
  const visible = next === 'standard' ? [standard] : next === 'satellite' ? [imagery] : [imagery, labels];
  [standard, imagery, labels].forEach((layer) => {
    if (!visible.includes(layer)) map.removeLayer(layer);
    else if (!map.hasLayer(layer)) layer.addTo(map);
  });
  byId('layer-label').textContent = next[0].toUpperCase() + next.slice(1);
  document.querySelectorAll('[data-basemap]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.basemap === next)));
}

// The map stays behind the translucent panel. Its camera uses the remaining
// visible area, rather than centring places underneath the panel or sheet.
function cameraOffset() {
  const panel = byId('sidebar');
  if (panel.hidden) return L.point(0, 0);
  const open = panel.dataset.open === 'true';
  if (narrow.matches) return L.point(0, -sheetHeight / 2);
  return open ? L.point((panel.offsetWidth + 32) / 2, 0) : L.point(0, 0);
}

function sidebarHeaderHeight() {
  return document.querySelector(selectedKey === null ? '.sidebar-header' : '.detail-bar').offsetHeight + 1;
}

function measureSidebarHeader() {
  app.style.setProperty('--sidebar-header-height', `${sidebarHeaderHeight()}px`);
  if (!narrow.matches) return;
  const heights = sheetHeights();
  app.style.setProperty('--sheet-half-height', `${heights.half}px`);
  if (!sheetPointer?.dragging && !sheetWheel) setSheetHeight(heights[sheetState]);
}

// The live height is shared by the sheet, map credit, and camera padding.
// Below half height the panel translates, keeping its whole header visible.
function sheetHeights() {
  const collapsed = sidebarHeaderHeight();
  const expanded = Math.max(collapsed, app.clientHeight - 96);
  return { collapsed, half: Math.max(collapsed, Math.min(app.clientHeight * .48, 430, expanded)), expanded };
}

function setSheetHeight(height) {
  sheetHeight = height;
  app.style.setProperty('--sheet-height', `${height}px`);
}

function settleSheet(velocity = 0, direction = 0, previousOffset = cameraOffset()) {
  const heights = Object.entries(sheetHeights());
  let nearest = heights.reduce((best, entry) => Math.abs(entry[1] - sheetHeight) < Math.abs(best[1] - sheetHeight) ? entry : best);
  if (velocity < -1.5) nearest = heights[0];
  else if (direction || Math.abs(velocity) > .45) {
    const upward = (direction || velocity) > 0;
    nearest = (upward ? heights.find(([, height]) => height > sheetHeight + 1) : heights.findLast(([, height]) => height < sheetHeight - 1)) || nearest;
  }
  sheetState = nearest[0];
  sidebarOpen = sheetState !== 'collapsed';
  delete app.dataset.sheetDragging;
  syncSidebar();
  if (!sidebarOpen && byId('sidebar-surface').contains(document.activeElement)) byId('sidebar-toggle').focus({ preventScroll: true });
  if (!previousOffset.equals(cameraOffset())) {
    if (selectedKey === null) fit();
    else reframe(previousOffset);
  }
}

// Own vertical touch movement throughout a gesture so the same swipe can
// cross the boundary between sheet movement and list scrolling in either direction.
function moveSheet(delta, scroll) {
  const { collapsed, expanded } = sheetHeights();
  if (scroll && delta < 0) {
    const consumed = Math.min(scroll.scrollTop, -delta);
    scroll.scrollTop -= consumed;
    delta += consumed;
  }
  const previous = sheetHeight;
  setSheetHeight(Math.max(collapsed, Math.min(expanded, sheetHeight + delta)));
  const movement = sheetHeight - previous;
  if (scroll && delta > 0) scroll.scrollTop += delta - movement;
  return movement;
}

function finishSheetPointer(event) {
  if (event.type === 'lostpointercapture' && event.target !== byId('sidebar')) return;
  if (!sheetPointer || event.pointerId !== sheetPointer.id) return;
  const pointer = sheetPointer;
  sheetPointer = null;
  if (byId('sidebar').hasPointerCapture(pointer.id)) byId('sidebar').releasePointerCapture(pointer.id);
  if (!pointer.dragging) {
    if (pointer.interruptedWheel !== undefined) settleSheet(0, pointer.interruptedWheel, pointer.offset);
    return;
  }
  suppressSheetClickUntil = performance.now() + 400;
  const velocity = event.type === 'pointerup' && event.timeStamp - pointer.time < 100 ? pointer.velocity : 0;
  settleSheet(velocity, 0, pointer.offset);
}

function cancelSheetInput() {
  const pointer = sheetPointer;
  sheetPointer = null;
  sheetWheel = null;
  clearTimeout(sheetWheelTimer);
  if (pointer?.dragging) suppressSheetClickUntil = performance.now() + 400;
  if (pointer && byId('sidebar').hasPointerCapture(pointer.id)) byId('sidebar').releasePointerCapture(pointer.id);
  delete app.dataset.sheetDragging;
}

function syncSidebar() {
  const hasPlaces = places.length > 0;
  const open = hasPlaces && sidebarOpen;
  if (!sidebarOpen) sheetState = 'collapsed';
  else if (sheetState === 'collapsed') sheetState = 'half';
  byId('sidebar').hidden = !hasPlaces;
  byId('sidebar').dataset.open = String(open);
  // The tab remains interactive while the panel is closed. On narrow screens,
  // the sheet's header stays visible; only its scrolling content is unavailable.
  byId('sidebar-surface').inert = !open && !narrow.matches;
  byId('sidebar-surface').setAttribute('aria-hidden', String(!open && !narrow.matches));
  for (const id of ['list-scroll', 'detail-scroll']) {
    byId(id).inert = !open;
    byId(id).setAttribute('aria-hidden', String(!open));
  }
  app.dataset.sidebarOpen = String(open);
  app.dataset.hasPlaces = String(hasPlaces);
  byId('sidebar-toggle').setAttribute('aria-expanded', String(open));
  byId('sidebar-toggle').setAttribute('aria-label', open ? 'Hide sidebar' : 'Show sidebar');
  byId('sidebar-toggle').title = open ? 'Hide sidebar' : 'Show sidebar';
  byId('list-view').hidden = selectedKey !== null;
  byId('detail').hidden = selectedKey === null;
  byId('map-title').hidden = !mapTitle || open || (hasPlaces && narrow.matches);
  byId('empty-title').textContent = mapTitle;
  measureSidebarHeader();
}

function reframe(previousOffset, animate = true) {
  const delta = previousOffset.subtract(cameraOffset());
  if (delta.x || delta.y) {
    map.stop();
    map.panBy(delta, { animate: animate && !reducedMotion.matches, duration: .32 });
  }
}

function fit(animate = true) {
  if (!places.length) return;
  const panel = byId('sidebar');
  const open = sidebarOpen && !panel.hidden;
  const left = open && !narrow.matches ? panel.offsetWidth + 60 : 50;
  const uncovered = map.getSize().y - sheetHeight;
  // Expanded leaves little map space: retain room for pin heads while reducing
  // the usual outer padding, rather than fitting beneath the sheet.
  const top = narrow.matches ? Math.min(100, Math.max(50, uncovered - 100)) : 100;
  const bottom = narrow.matches ? sheetHeight + Math.min(open ? 75 : 51, Math.max(6, uncovered - 150)) : 65;
  map.stop();
  map.fitBounds(L.latLngBounds(places.map((place) => [place.lat, place.lng])), {
    paddingTopLeft: [left, top], paddingBottomRight: [50, bottom], maxZoom: 16,
    animate: animate && !reducedMotion.matches, duration: .5,
  });
}

function updateSelection() {
  places.forEach((place, index) => {
    const selected = place.key === selectedKey;
    rows[index].setAttribute('aria-pressed', String(selected));
    markers[index].getElement().setAttribute('aria-pressed', String(selected));
    markers[index].setZIndexOffset(selected ? 1000 : 0);
  });
}

// Keep the query in the mounted field. Store snapshots rebuild rows and pins,
// but filtering changes only their visibility, never the map camera or store.
function applyFilter() {
  const input = byId('place-filter');
  const query = input.value.trim().toLowerCase();
  visibleIndices = [];
  hoverPlace(-1, false);
  places.forEach((place, index) => {
    const matches = !query || [place.title, place.categoryName, place.description]
      .some(value => typeof value === 'string' && value.toLowerCase().includes(query));
    rows[index].parentElement.hidden = !matches;
    markers[index].getElement().hidden = !matches;
    if (matches) visibleIndices.push(index);
  });
  byId('filter-clear').hidden = !input.value;
  byId('no-matches').hidden = !places.length || visibleIndices.length > 0;
  byId('place-count').textContent = query ? `${visibleIndices.length} of ${places.length}` : `${places.length} ${places.length === 1 ? 'place' : 'places'}`;
  spreadMarkers();
}

function updateFilter() {
  applyFilter();
  byId('list-scroll').scrollTop = 0;
  listScrollTop = 0;
}

function clearFilter() {
  byId('place-filter').value = '';
  updateFilter();
  byId('place-filter').focus({ preventScroll: true });
}

function adjacentVisibleIndex(index, direction) {
  const position = visibleIndices.indexOf(index);
  if (position === -1) return direction > 0 ? visibleIndices[0] : visibleIndices.at(-1);
  return visibleIndices[(position + direction + visibleIndices.length) % visibleIndices.length];
}

function renderDetail(place) {
  byId('detail-title').textContent = place.title;
  const categoryLine = byId('detail-category');
  categoryLine.dataset.color = place.color;
  categoryLine.replaceChildren(categoryGlyph(place), element('span', '', place.categoryName));
  categoryLine.hidden = !place.categoryName;
  byId('detail-description').textContent = typeof place.description === 'string' ? place.description : '';
  byId('detail-description').hidden = !byId('detail-description').textContent;
  const photoContainer = byId('detail-photo');
  photoContainer.replaceChildren();
  const url = photoURL(place.photo);
  photoContainer.hidden = !url;
  if (url) {
    const image = element('img');
    image.src = url;
    image.alt = place.title;
    image.addEventListener('error', () => { if (image.parentElement === photoContainer) photoContainer.hidden = true; }, { once: true });
    photoContainer.append(image);
  }
  const fields = byId('detail-fields');
  fields.replaceChildren();
  if (place.fields && typeof place.fields === 'object' && !Array.isArray(place.fields)) {
    for (const [label, value] of Object.entries(place.fields)) {
      const text = value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      const field = element('div', text.length > 45 ? 'field long-value' : 'field');
      field.append(element('dt', '', label), element('dd', '', text || '—'));
      fields.append(field);
    }
  }
  fields.hidden = !fields.children.length;
  const credit = byId('detail-credit');
  credit.replaceChildren();
  if (typeof place.credit?.text === 'string' && place.credit.text) {
    const text = `Photo: ${place.credit.text}`;
    const source = httpsURL(place.credit.url);
    if (source) {
      const link = element('a', '', text);
      link.href = source;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      credit.append(link);
    } else credit.textContent = text;
  }
  credit.hidden = !credit.textContent;
}

function selectPlace(index, origin = 'list') {
  const place = places[index];
  if (!place) return;
  if (selectedKey === null) {
    listScrollTop = byId('list-scroll').scrollTop;
    selectionOrigin = origin;
    selectionOriginKey = place.key;
  }
  selectedKey = place.key;
  sidebarOpen = true;
  hoverPlace(-1, false);
  renderDetail(place);
  syncSidebar();
  updateSelection();
  byId('detail-scroll').scrollTop = 0;
  byId('close-detail').focus({ preventScroll: true });
  byId('selection-status').textContent = `${place.title} selected. Press Escape to return to places.`;
  map.stop();
  const zoom = Math.max(map.getZoom(), 15);
  // Account for the height of the balloon: its geographic anchor is its tip.
  const offset = cameraOffset().add([0, 20]);
  const center = map.unproject(map.project([place.lat, place.lng], zoom).subtract(offset), zoom);
  if (reducedMotion.matches) map.setView(center, zoom, { animate: false });
  else map.flyTo(center, zoom, { duration: .8 });
}

function closeDetail() {
  const index = places.findIndex((place) => place.key === selectionOriginKey);
  selectedKey = null;
  syncSidebar();
  updateSelection();
  byId('list-scroll').scrollTop = listScrollTop;
  const target = visibleIndices.includes(index)
    ? selectionOrigin === 'marker' || !sidebarOpen ? markers[index].getElement() : rows[index]
    : sidebarOpen ? byId('place-filter') : byId('map');
  (target || byId('map')).focus({ preventScroll: true });
  byId('selection-status').textContent = 'Place list.';
}

// At zoom 19, only coordinates whose 38×48px pin hit boxes still overlap count
// as the same place. Fan their icons without changing stored or Leaflet points.
function spreadMarkers() {
  const pending = markers
    .filter(marker => !marker.getElement().hidden)
    .map(marker => ({ marker, projected: map.project(marker.getLatLng(), maxMapZoom) }));
  const groups = [];
  while (pending.length) {
    const group = [pending.shift()];
    for (let candidate = pending.length - 1; candidate >= 0; candidate -= 1) {
      const overlapsGroup = group.every(({ projected }) => {
        const delta = pending[candidate].projected.subtract(projected);
        return Math.abs(delta.x) < pinSize.x && Math.abs(delta.y) < pinSize.y;
      });
      if (overlapsGroup) group.push(pending.splice(candidate, 1)[0]);
    }
    groups.push(group);
  }

  const size = map.getSize();
  const uncovered = narrow.matches && !byId('sidebar').hidden ? size.y - sheetHeight : null;
  groups.forEach((group) => {
    const anchors = group.map(({ marker }) => map.latLngToContainerPoint(marker.getLatLng()));
    const center = anchors.reduce((sum, point) => sum.add(point), L.point(0, 0)).divideBy(group.length);
    const radius = group.length > 1 ? Math.max(20, 16 / Math.sin(Math.PI / group.length)) : 0;
    const top = group.some(({ marker }) => marker.getElement().getAttribute('aria-pressed') === 'true') ? 64 : 48;
    // Above a narrow sheet, keep the compact fan sideways so no pin is pushed
    // under the sheet. Offscreen groups keep the usual circular fan.
    const sideways = uncovered !== null && center.x >= 24 && center.x <= size.x - 24 && center.y >= top && center.y <= uncovered - 2;
    group.forEach(({ marker }, index) => {
      const anchor = anchors[index];
      let point = anchor;
      if (group.length > 1) {
        const offset = sideways
          ? L.point((index - (group.length - 1) / 2) * 32, 0)
          : L.point(Math.cos(-Math.PI / 2 + index * 2 * Math.PI / group.length) * radius, Math.sin(-Math.PI / 2 + index * 2 * Math.PI / group.length) * radius);
        point = center.add(offset);
      }
      const delta = point.subtract(anchor);
      const node = marker.getElement();
      node.style.marginLeft = `${delta.x - pinAnchor.x}px`;
      node.style.marginTop = `${delta.y - pinAnchor.y}px`;
      const tooltip = marker.getTooltip();
      tooltip.options.offset = L.point(delta.x, delta.y - 52);
      if (marker.isTooltipOpen()) tooltip.update();
    });
  });
}

function hoverPlace(index, hovered, fromPin = false) {
  rows.forEach((row, rowIndex) => {
    const active = hovered && rowIndex === index;
    row.classList.toggle('is-hovered', active);
    markers[rowIndex].getElement().classList.toggle('is-hovered', active);
    markers[rowIndex].setZIndexOffset(active ? 2000 : places[rowIndex].key === selectedKey ? 1000 : 0);
    if (active && fromPin) markers[rowIndex].openTooltip();
    else markers[rowIndex].closeTooltip();
  });
  if (hovered && fromPin && sidebarOpen && selectedKey === null) rows[index].scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
}

function render(value) {
  const previousOffset = sheetPointer?.offset || sheetWheel?.offset || cameraOffset();
  cancelSheetInput();
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const wasSidebarOpen = sidebarOpen;
  const active = document.activeElement;
  const focusedKey = active?.dataset.key;
  const focusedMarker = active?.classList.contains('map-pin');
  const detailCreditFocused = byId('detail-credit').contains(active);
  const detailHadFocus = byId('detail').contains(active);
  const detailScrollTop = byId('detail-scroll').scrollTop;
  if (selectedKey === null) listScrollTop = byId('list-scroll').scrollTop;
  delete app.dataset.unreadable;
  byId('error').hidden = true;
  mapTitle = typeof data.title === 'string' ? data.title : '';
  byId('title').textContent = mapTitle || 'Places';
  document.title = mapTitle || 'Map';
  byId('subtitle').textContent = typeof data.subtitle === 'string' ? data.subtitle : '';
  byId('subtitle').hidden = !byId('subtitle').textContent;
  const categories = readCategories(data.categories);
  places = Object.entries(data.places && typeof data.places === 'object' && !Array.isArray(data.places) ? data.places : {})
    .filter(([, place]) => place && Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180)
    .map(([key, place]) => {
      const category = categories.get(place.category);
      const icon = category && typeof place.icon === 'string' && Object.hasOwn(icons, place.icon) ? place.icon : category?.icon || 'pin';
      return { ...place, key, title: typeof place.title === 'string' && place.title ? place.title : 'Untitled place', categoryName: category?.name || '', icon, color: category?.color || 'default' };
    })
    .sort((a, b) => (Number.isFinite(a.order) ? a.order : Infinity) - (Number.isFinite(b.order) ? b.order : Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  markers.forEach((marker) => marker.remove());
  markers = [];
  rows = [];
  byId('place-list').replaceChildren();
  places.forEach((place, index) => {
    const face = element('span', 'pin-face');
    const shape = svgNode('svg', { viewBox: '0 0 44 56', class: 'pin-shape', 'aria-hidden': 'true' });
    shape.append(svgNode('path', { d: 'M22 2C11.5 2 3 10.4 3 21c0 11 13.1 26.4 17.3 31a2.3 2.3 0 0 0 3.4 0C27.9 47.4 41 32 41 21 41 10.4 32.5 2 22 2Z' }));
    face.append(shape);
    if (data.numbered === true) face.append(element('span', 'pin-number', index + 1));
    else face.append(placeGlyph(place.icon));
    const marker = L.marker([place.lat, place.lng], { icon: L.divIcon({ className: 'map-pin', html: face, iconSize: pinSize, iconAnchor: pinAnchor }), keyboard: true }).addTo(map);
    marker.bindTooltip(element('span', '', place.title), { direction: 'top', offset: [0, -52], opacity: 1 });
    const pin = marker.getElement();
    pin.dataset.key = place.key;
    pin.dataset.color = place.color;
    pin.setAttribute('aria-label', place.title);
    pin.setAttribute('aria-pressed', 'false');
    pin.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        selectPlace(index, 'marker');
      }
    });
    marker.on('click', () => selectPlace(index, 'marker'));
    marker.on('mouseover', () => hoverPlace(index, true, true));
    marker.on('mouseout', () => hoverPlace(index, false));
    markers.push(marker);
    const row = element('li', 'place-row');
    const button = element('button', 'place-button');
    button.type = 'button';
    button.dataset.key = place.key;
    button.dataset.color = place.color;
    button.setAttribute('aria-label', place.title);
    button.setAttribute('aria-pressed', 'false');
    const photo = thumbnail(place);
    if (photo) button.append(photo);
    const copy = element('span', 'row-copy');
    const heading = element('span', 'row-title');
    if (data.numbered === true) heading.append(element('span', 'list-badge', `${index + 1}.`));
    heading.append(element('span', '', place.title));
    copy.append(heading);
    if (place.categoryName) {
      const category = element('span', 'row-category category-pill');
      category.append(categoryGlyph(place), element('span', '', place.categoryName));
      copy.append(category);
    }
    if (typeof place.description === 'string' && place.description) copy.append(element('span', 'row-description', place.description));
    button.append(copy);
    button.addEventListener('click', () => selectPlace(index));
    button.addEventListener('mouseenter', () => hoverPlace(index, true));
    button.addEventListener('mouseleave', () => hoverPlace(index, false));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? visibleIndices[0] : event.key === 'End' ? visibleIndices.at(-1) : adjacentVisibleIndex(index, event.key === 'ArrowDown' ? 1 : -1);
      rows[next]?.focus();
      hoverPlace(next, true);
    });
    row.append(button);
    rows.push(button);
    byId('place-list').append(row);
  });
  applyFilter();
  const desiredSidebar = data.sidebar === 'closed' ? 'closed' : 'open';
  if (desiredSidebar !== storedSidebar) { storedSidebar = desiredSidebar; sidebarOpen = desiredSidebar === 'open'; }
  const selected = places.find((place) => place.key === selectedKey);
  if (selected) renderDetail(selected);
  else selectedKey = null;
  syncSidebar();
  updateSelection();
  const restoredIndex = places.findIndex((place) => place.key === focusedKey);
  if (visibleIndices.includes(restoredIndex) && (focusedMarker || (sidebarOpen && selectedKey === null))) (focusedMarker ? markers[restoredIndex].getElement() : rows[restoredIndex]).focus({ preventScroll: true });
  else if (restoredIndex !== -1 && sidebarOpen && selectedKey === null) byId('place-filter').focus({ preventScroll: true });
  else if (focusedKey || (detailHadFocus && (!selected || !sidebarOpen))) byId('map').focus({ preventScroll: true });
  if (detailCreditFocused && selected && sidebarOpen) (byId('detail-credit').querySelector('a') || byId('close-detail')).focus({ preventScroll: true });
  byId('list-scroll').scrollTop = listScrollTop;
  byId('detail-scroll').scrollTop = detailScrollTop;
  byId('empty').hidden = places.length > 0;
  const desiredBasemap = ['standard', 'satellite', 'hybrid'].includes(data.basemap) ? data.basemap : 'standard';
  if (desiredBasemap !== storedBasemap) { storedBasemap = desiredBasemap; basemap = desiredBasemap; }
  setBasemap(basemap);
  const signature = JSON.stringify(places.map((place) => [place.key, place.lat, place.lng]).sort((a, b) => a[0] < b[0] ? -1 : 1));
  if (signature !== locationSignature) { locationSignature = signature; fit(false); }
  else if (!wasSidebarOpen && sidebarOpen && selectedKey === null) fit();
  else reframe(previousOffset);
  spreadMarkers();
}

function closeLayers(restoreFocus = false) {
  byId('layers-menu').hidden = true;
  byId('layers-toggle').setAttribute('aria-expanded', 'false');
  if (restoreFocus) byId('layers-toggle').focus();
}

byId('sidebar').addEventListener('pointerdown', (event) => {
  suppressSheetClickUntil = 0;
  if (!narrow.matches || !event.isPrimary || event.button !== 0) return;
  const scroll = event.target.closest('.sidebar-scroll');
  if (scroll ? event.pointerType === 'mouse' : !event.target.closest('.sidebar-header, .detail-bar, #sidebar-toggle')) return;
  if (!scroll && event.target.closest('input, select, textarea, a, button:not(#sidebar-toggle)')) return;
  const offset = sheetWheel?.offset || cameraOffset();
  const interruptedWheel = sheetWheel?.direction;
  cancelSheetInput();
  sheetPointer = {
    id: event.pointerId, scroll, offset, interruptedWheel, startX: event.clientX, startY: event.clientY,
    y: event.clientY, time: event.timeStamp, velocity: 0, dragging: false,
    height: app.getBoundingClientRect().bottom - byId('sidebar').getBoundingClientRect().top,
  };
});
document.addEventListener('pointermove', (event) => {
  const pointer = sheetPointer;
  if (!pointer || event.pointerId !== pointer.id) return;
  if (!pointer.dragging) {
    const distance = Math.abs(event.clientY - pointer.startY);
    if (distance < 6) return;
    if (Math.abs(event.clientX - pointer.startX) > distance) { finishSheetPointer(event); return; }
    pointer.dragging = true;
    app.dataset.sheetDragging = 'true';
    setSheetHeight(pointer.height);
    byId('sidebar').setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  const movement = moveSheet(pointer.y - event.clientY, pointer.scroll);
  pointer.velocity = movement / Math.max(1, event.timeStamp - pointer.time);
  pointer.y = event.clientY;
  pointer.time = event.timeStamp;
});
for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, finishSheetPointer, true);
byId('sidebar').addEventListener('lostpointercapture', finishSheetPointer);
byId('sidebar').addEventListener('click', (event) => {
  if (event.detail && performance.now() < suppressSheetClickUntil) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
byId('sidebar').addEventListener('wheel', (event) => {
  const scroll = event.target.closest('.sidebar-scroll');
  if (!narrow.matches || !scroll || sheetPointer || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  event.preventDefault();
  if (!sheetWheel) {
    const height = app.getBoundingClientRect().bottom - byId('sidebar').getBoundingClientRect().top;
    sheetWheel = { direction: 0, offset: cameraOffset() };
    app.dataset.sheetDragging = 'true';
    setSheetHeight(height);
  }
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1);
  const movement = moveSheet(delta, scroll);
  if (movement) sheetWheel.direction = Math.sign(movement);
  clearTimeout(sheetWheelTimer);
  sheetWheelTimer = setTimeout(() => {
    const { direction, offset } = sheetWheel;
    sheetWheel = null;
    if (direction) settleSheet(0, direction, offset);
    else delete app.dataset.sheetDragging;
  }, 120);
}, { passive: false });

byId('sidebar-toggle').addEventListener('click', () => {
  const previousOffset = sheetPointer?.offset || sheetWheel?.offset || cameraOffset();
  cancelSheetInput();
  sidebarOpen = !sidebarOpen;
  hoverPlace(-1, false);
  syncSidebar();
  byId('sidebar-toggle').focus({ preventScroll: true });
  if (sidebarOpen && selectedKey === null) fit();
  else reframe(previousOffset);
});
byId('zoom-in').addEventListener('click', () => map.zoomIn(1, { animate: !reducedMotion.matches }));
byId('zoom-out').addEventListener('click', () => map.zoomOut(1, { animate: !reducedMotion.matches }));
byId('place-filter').addEventListener('input', updateFilter);
byId('place-filter').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.isComposing) return;
  event.preventDefault();
  const index = event.key === 'ArrowDown' ? visibleIndices[0] : visibleIndices.at(-1);
  rows[index]?.focus();
  hoverPlace(index, index !== undefined);
});
byId('filter-clear').addEventListener('click', clearFilter);
byId('close-detail').addEventListener('click', closeDetail);
byId('detail').addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  const index = places.findIndex((place) => place.key === selectedKey);
  selectPlace(adjacentVisibleIndex(index, event.key === 'ArrowDown' ? 1 : -1), selectionOrigin);
});
byId('layers-toggle').addEventListener('click', () => {
  const open = byId('layers-menu').hidden;
  byId('layers-menu').hidden = !open;
  byId('layers-toggle').setAttribute('aria-expanded', String(open));
  if (open) byId('layers-menu').querySelector('[aria-pressed="true"]').focus();
});
const layerButtons = [...document.querySelectorAll('[data-basemap]')];
layerButtons.forEach((button, index) => {
  button.addEventListener('click', () => { setBasemap(button.dataset.basemap); closeLayers(true); });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    layerButtons[(index + (event.key === 'ArrowDown' ? 1 : -1) + layerButtons.length) % layerButtons.length].focus();
  });
});
document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.map-toolbar')) closeLayers(); });
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (event.key === 'Escape') {
    if (event.target === byId('place-filter') && event.target.value) { event.preventDefault(); clearFilter(); }
    else if (!byId('layers-menu').hidden) { event.preventDefault(); closeLayers(true); }
    else if (selectedKey !== null) { event.preventDefault(); closeDetail(); }
    return;
  }
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
});
map.on('zoomend moveend', spreadMarkers);
new ResizeObserver(() => { cancelSheetInput(); measureSidebarHeader(); map.invalidateSize({ pan: false }); fit(false); spreadMarkers(); }).observe(byId('map'));
const headerObserver = new ResizeObserver(measureSidebarHeader);
document.querySelectorAll('.sidebar-header, .detail-bar').forEach(header => headerObserver.observe(header));
narrow.addEventListener('change', () => { cancelSheetInput(); syncSidebar(); });
reducedMotion.addEventListener('change', () => { map.stop(); map.options.inertia = !reducedMotion.matches; });

function showUnavailable() {
  app.dataset.unreadable = 'true';
  byId('error').hidden = false;
}

setBasemap('standard');
// A listener that ends on access loss leaves the last map in place. Other
// terminal errors show the unreadable state. A later connection starts a new
// listener and can recover without the page writing to the store.
let listening = false;
function listen() {
  listening = true;
  onValue(ref(getStore()), snapshot => {
    const value = snapshot.val();
    if (value !== null && value !== undefined && (typeof value !== 'object' || Array.isArray(value))) {
      showUnavailable();
      return;
    }
    render(value);
  }, error => {
    listening = false;
    if (error.code === 'no-store') return;
    showUnavailable();
  });
}
listen();
onConnectionStatusChanged(status => {
  if (status === 'connected' && !listening) listen();
});
