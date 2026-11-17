"use strict";
const get = (id) => document.getElementById(id);
const svg = get("map");
const mapWrap = svg.parentElement;
const stopTooltip = document.createElement("div");
stopTooltip.className = "stop-tooltip";
stopTooltip.setAttribute("role", "tooltip");
stopTooltip.hidden = true;
mapWrap.append(stopTooltip);
const width = 960, height = 630;
let project;
function fitProjection(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([,y]) => y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const south = Math.min(...ys), north = Math.max(...ys);
  const yScale = Math.min(760 / Math.max(.36, (right - left) * .86), 455 / Math.max(.36, north - south));
  return ([lon,lat]) => [
    width / 2 + (lon - (left + right) / 2) * yScale * .86,
    height / 2 - (lat - (south + north) / 2) * yScale
  ];
}
const coords = (id) => cities[id].slice(1);
const node = (tag, attrs) => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
};
const button = (label, action) => {
  const element = document.createElement("button");
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
};
const latLon = (token) => token.startsWith("@") ? token.slice(1).split(",").map(Number) : coords(token);

const base = get("base");
base.append(node("rect", {x:-960,y:-630,width:2880,height:1890,fill:"url(#grid)"}));
const coastline = node("path", {fill:"#34484a",stroke:"#679094","stroke-width":1.25,"vector-effect":"non-scaling-stroke"});
const inlandWater = node("path", {fill:"#173846",stroke:"#628790","stroke-width":1,"vector-effect":"non-scaling-stroke"});
const mapRelief = makeRelief("main-relief");
base.prepend(coastline,mapRelief.layer,inlandWater);
const geography = [
  ["애굽",31.85,30.42],["시나이반도",33.77,29.7],["수에즈만",32.9,29.13,"water-label"],
  ["아카바만",34.66,28.92,"water-label"],["네게브",34.82,30.9],["에돔",35.65,30.13],
  ["모압",35.96,31.5],["사해",35.48,31.65,"water-label"],["요단강",35.62,32.04,"water-label"],
  ["가나안",34.98,32.04],["지중해",33.15,31.4,"water-label"]
];
let geoNodes = [];
const geographyLayer = node("g", {"aria-hidden":"true"});
get("markers").before(geographyLayer);

// Geographic edges of the rectified elevation raster.
const reliefBounds = {west:29.7, south:27.3, east:38.4, north:33.1};
function makeRelief(id) {
  const clipShape = node("path", {});
  const clip = node("clipPath", {id});
  clip.append(clipShape);
  const layer = node("g", {"aria-hidden":"true",class:"relief-layer"});
  const image = node("image", {
    href:"terrain-relief.webp", preserveAspectRatio:"none", "clip-path":`url(#${id})`
  });
  const defs = node("defs", {});
  defs.append(clip);
  layer.append(defs,image);
  return {layer,image,clipShape};
}
function drawRelief({image,clipShape}, projection, landPath) {
  const {west,south,east,north} = reliefBounds;
  const [left,top] = projection([west,north]);
  const [right,bottom] = projection([east,south]);
  image.setAttribute("x", left);
  image.setAttribute("y", top);
  image.setAttribute("width", right - left);
  image.setAttribute("height", bottom - top);
  clipShape.setAttribute("d", landPath);
}

function polygonPath(rings, projection) {
  return rings.map(ring => ring.map(projection).map(([x,y], i) =>
    `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z").join("");
}
const jordan = node("polyline", {class:"jordan-river","aria-hidden":"true"});
base.append(jordan);
function setMapArea(points) {
  project = fitProjection(points);
  const landPath = polygonPath(land, project);
  coastline.setAttribute("d", landPath);
  drawRelief(mapRelief, project, landPath);
  inlandWater.setAttribute("d", polygonPath(lakes, project));
  jordan.setAttribute("points", [[35.56,32.67],[35.56,32.54],[35.55,32.35],[35.55,32.13],[35.54,31.99],[35.55,31.85],[35.55,31.77]].map(project).map(p=>p.join(",")).join(" "));
  geoNodes = geography.map(([label, lon, lat, type]) => {
    const text = node("text", {class:type || "cartography","text-anchor":"middle"});
    text.textContent = label;
    return {text,point:project([lon,lat])};
  });
  geographyLayer.replaceChildren(...geoNodes.map(({text}) => text));
}
const track = node("polyline", {class:"track", "aria-hidden":"true"});
const traveledTrack = node("polyline", {class:"traveled-track", "aria-hidden":"true"});
get("route").append(track,traveledTrack);
const labels = node("g", {"aria-hidden":"true", "pointer-events":"none"});
get("markers").before(labels);

let journey = 0;
let selected = 0;
let scale = 1, offsetX = 0, offsetY = 0;
let pins = [], linePoints = [];
let hoveredPin = null, focusedPin = null, pinnedTooltip = null;
let routeStops = [];
const traveler = node("g", {class:"traveler","aria-hidden":"true",visibility:"hidden"});
// The cloud floats above the route, below the map's labels and pins.
traveler.append(
  node("path", {class:"cloud-tether",d:"M0 -3 V-14"}),
  node("circle", {class:"cloud-position",r:4}),
  node("path", {class:"cloud-shape",d:"M-15 -14a9 9 0 0 1-1-18 12 12 0 0 1 23-3 10.5 10.5 0 1 1 8 21Z M-10 -21h20"})
);
labels.before(traveler);
let arrivalMarker = null;
const travelSpeed = 115;
const stopDuration = 5000;
const zoomDuration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450;
const playButton = get("play");
const restartButton = get("restart");
const travelStatus = get("travel-status");
let trip = null;
let frame = 0;
let running = false;
let previousTime = null;
const tabs = journeys.map((entry, i) => {
  const tab = button(entry.title, () => selectJourney(i));
  if (entry.shortTitle) {
    const full = document.createElement("span");
    full.className = "tab-full";
    full.textContent = entry.title;
    const short = document.createElement("span");
    short.className = "tab-short";
    short.textContent = entry.shortTitle;
    tab.setAttribute("aria-label", entry.title);
    tab.replaceChildren(full,short);
  }
  document.querySelector(".tabs").append(tab);
  return tab;
});
const markerLayer = get("markers"), stops = document.querySelector(".stops");
let stopButtons = [];
const label = node("text", {class:"label"});
labels.append(label);
const visible = ([x,y]) => x > 10 && x < width - 10 && y > 10 && y < height - 10;
const transform = ([x,y]) => [x * scale + offsetX, y * scale + offsetY];

function nearbyPin(event, radius) {
  const mapMatrix = svg.getScreenCTM();
  if (!mapMatrix) return null;
  let nearest = null;
  let closestDistance = radius;
  pins.forEach(({displayPoint, onMap}, index) => {
    if (!onMap) return;
    const [x,y] = displayPoint;
    const distance = Math.hypot(x * mapMatrix.a + mapMatrix.e - event.clientX,
      y * mapMatrix.d + mapMatrix.f - event.clientY);
    if (distance < closestDistance) {
      closestDistance = distance;
      nearest = index;
    }
  });
  return nearest;
}

function updateStopTooltip() {
  const target = hoveredPin ?? focusedPin ?? pinnedTooltip;
  const pin = pins[target];
  const matrix = pin?.onMap ? svg.getScreenCTM() : null;
  stopTooltip.hidden = !matrix;
  label.setAttribute("visibility", pins[selected]?.onMap && (!matrix || target !== selected) ? "visible" : "hidden");
  if (!matrix) return;
  const [x,y] = pin.displayPoint;
  const bounds = mapWrap.getBoundingClientRect();
  const anchorX = x * matrix.a + matrix.e - bounds.left;
  const anchorY = y * matrix.d + matrix.f - bounds.top;
  if (stopTooltip.textContent !== pin.name) stopTooltip.textContent = pin.name;
  const tooltipWidth = stopTooltip.offsetWidth;
  const tooltipHeight = stopTooltip.offsetHeight;
  const gap = 10 + 11.5 * matrix.d;
  const left = Math.max(6, Math.min(bounds.width - tooltipWidth - 6, anchorX - tooltipWidth / 2));
  const above = anchorY - tooltipHeight - gap;
  const top = above >= 6 ? above : Math.min(bounds.height - tooltipHeight - 6, anchorY + gap);
  stopTooltip.style.left = `${left}px`;
  stopTooltip.style.top = `${top}px`;
}

function selectMapPin(index) {
  hoveredPin = focusedPin = null;
  pinnedTooltip = index;
  inspectStop(index);
}

function drawMap() {
  drawTraveler();
  base.setAttribute("transform", `translate(${offsetX} ${offsetY}) scale(${scale})`);
  track.setAttribute("points", linePoints.map(transform).map(point => point.join(",")).join(" "));
  geoNodes.forEach(({text, point}) => {
    const [x,y] = transform(point);
    text.setAttribute("x", x);
    text.setAttribute("y", y);
  });
  const placed = [];
  pins.forEach((pin) => {
    const {marker, connector, point} = pin;
    const source = transform(point);
    const pos = [...source];
    while (visible(source) && placed.some(([x,y]) => Math.hypot(x-pos[0],y-pos[1]) < 36)) {
      pos[1] += source[1] > height / 2 ? -18 : 18;
    }
    if (visible(source)) placed.push(pos);
    pin.displayPoint = pos;
    pin.onMap = visible(source) && visible(pos);
    connector.setAttribute("x1", source[0]);
    connector.setAttribute("y1", source[1]);
    connector.setAttribute("x2", pos[0]);
    connector.setAttribute("y2", pos[1]);
    connector.setAttribute("visibility", visible(source) ? "visible" : "hidden");
    marker.setAttribute("transform", `translate(${pos.join(" ")})`);
    marker.setAttribute("visibility", pin.onMap ? "visible" : "hidden");
  });
  const [x,y] = pins[selected].displayPoint;
  const onRight = x < width * .79;
  label.setAttribute("text-anchor", onRight ? "start" : "end");
  label.setAttribute("x", x + (onRight ? 18 : -18));
  label.setAttribute("y", y - 17);
  updateStopTooltip();
  get("minus").disabled = scale === 1;
  get("plus").disabled = scale === 4;
  svg.classList.toggle("zoomed", scale > 1);
}

function openDetail(i) {
  if (pinnedTooltip !== i) pinnedTooltip = null;
  selected = i;
  const [id, refs, activity, verse, keyVerse] = journeys[journey].stops[i];
  const [book, verseRef] = keyVerse.split(" ");
  const [chapter, verseStart] = verseRef.split(":");
  const verseSlug = verseStart.split(/[–,]/)[0];
  const url = (code, passage) => `https://www.bible.com/ko/bible/88/${code}.${passage}.KRV`;
  const chapterRefs = [...new Set(refs.split(";").map(ref => ref.trim().split(":")[0]))];
  const readable = (ref) => ref.replace(/^(\w+) /, (_, code) => books[code] + " ");
  const readableRefs = refs.split("; ").map(readable).join(" · ");
  get("detail").innerHTML = `<p class="index">${i + 1} / ${pins.length} 방문지</p>
  <div class="detail-heading"><h2>${cities[id][0]}</h2><p class="ref">${readableRefs}</p></div>
  <div class="activity-heading"><h3>주요 사건</h3>
  <button type="button" class="detail-toggle" aria-controls="detail-more" aria-expanded="false">말씀 요약·본문 보기</button></div>
  <p class="activity">${activity}</p>
  <p class="place-note">지도 위치 · ${cities[id][3]}</p>
  ${placePreview(id)}
  <div id="detail-more">
  <div class="verse-box"><h3>말씀 요약</h3><p class="verse">${verse}</p><span class="verse-ref">${readable(keyVerse)}</span></div>
  <div class="chapter-links"><a class="read" href="${url(book, chapter + "." + verseSlug)}" target="_blank" rel="noopener">관련 말씀 읽기 ↗</a>
  ${chapterRefs.map(ref => `<a class="read" href="${url(...ref.split(" "))}" target="_blank" rel="noopener">${readable(ref)}장 ↗</a>`).join("")}</div></div>`;
  get("detail").scrollTop = 0;
  pins.forEach(({marker}, index) => {
    marker.classList.toggle("selected", i === index);
    marker.setAttribute("aria-pressed", String(i === index));
    stopButtons[index].setAttribute("aria-current", String(i === index));
  });
  get("prev").disabled = i === 0;
  get("next").disabled = i === pins.length - 1;
  label.textContent = cities[id][0];
  const point = pins[i].point;
  if (!visible(transform(point))) {
    offsetX = width / 2 - point[0] * scale;
    offsetY = height / 2 - point[1] * scale;
    clampPan();
  }
  drawMap();
}

function selectJourney(i) {
  hoveredPin = focusedPin = pinnedTooltip = null;
  resetTravel();
  journey = i;
  const entry = journeys[i];
  document.documentElement.style.setProperty("--accent",entry.color);
  tabs.forEach((tab, j) => tab.setAttribute("aria-pressed", String(i === j)));
  get("journey").textContent = entry.title;
  get("range").textContent = entry.range;
  get("intro").textContent = entry.intro;
  scale = 1; offsetX = 0; offsetY = 0;
  const route = entry.path.split(" ");
  const points = route.map(latLon);
  setMapArea(points);
  linePoints = points.map(project);
  routeStops = route.map(id => entry.stops.findIndex(([cityId]) => cityId === id));
  markerLayer.replaceChildren();
  track.parentElement.querySelectorAll("line").forEach((line) => line.remove());
  stops.replaceChildren();
  stopButtons = [];
  pins = entry.stops.map(([id], index) => {
    const name = cities[id][0];
    const marker = node("g", {class:"pin", role:"button",tabindex:"0","aria-label":`${index + 1}. ${name}`});
    const hit = node("circle",{r:18,fill:"transparent"});
    const connector = node("line",{stroke:entry.color,"stroke-width":1.5,"aria-hidden":"true"});
    track.after(connector);
    const dot = node("circle",{r:11.5,class:"dot"});
    const text = node("text",{y:0});
    text.textContent = index + 1;
    const arrivalRing = node("circle",{r:17,class:"arrival-ring","aria-hidden":"true"});
    marker.append(hit,arrivalRing,dot,text);
    marker.addEventListener("focus", () => {
      if (!marker.matches(":focus-visible")) return;
      focusedPin = index;
      updateStopTooltip();
    });
    marker.addEventListener("blur", () => {
      if (focusedPin !== index) return;
      focusedPin = null;
      updateStopTooltip();
    });
    marker.addEventListener("click", () => selectMapPin(index));
    marker.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        selectMapPin(index);
      }
    });
    markerLayer.append(marker);
    const stop = button(name, () => inspectStop(index));
    const number = document.createElement("span");
    number.textContent = index + 1;
    stop.prepend(number);
    stopButtons.push(stop);
    stops.append(stop);
    return {name,marker,connector,point:project(coords(id))};
  });
  openDetail(0);
}

function clampPan() {
  offsetX = Math.min(0, Math.max(width - width * scale, offsetX));
  offsetY = Math.min(0, Math.max(height - height * scale, offsetY));
}
function zoom(factor) {
  pauseTravel();
  const next = Math.max(1, Math.min(4, scale * factor));
  const [x,y] = transform(pins[selected].point);
  const center = visible([x,y]) ? [x,y] : [width / 2,height / 2];
  offsetX = center[0] - (center[0] - offsetX) * next / scale;
  offsetY = center[1] - (center[1] - offsetY) * next / scale;
  scale = next;
  clampPan();
  drawMap();
}
get("plus").onclick = () => zoom(1.6);
get("minus").onclick = () => zoom(1 / 1.6);
get("reset").onclick = () => { pauseTravel(); scale = 1; offsetX = 0; offsetY = 0; drawMap(); };
get("prev").onclick = () => inspectStop(selected - 1);
get("next").onclick = () => inspectStop(selected + 1);
let pan = null;
let didDrag = false;
svg.addEventListener("pointerdown", (event) => {
  didDrag = false;
  if (scale === 1 || event.button !== 0 || event.target.closest(".pin")) return;
  pauseTravel();
  svg.setPointerCapture(event.pointerId);
  const ratio = svg.getScreenCTM().a;
  pan = {id:event.pointerId, x:event.clientX, y:event.clientY, offsetX, offsetY,ratio};
});
svg.addEventListener("pointermove", (event) => {
  if (pan?.id !== event.pointerId) {
    if (event.pointerType === "touch") return;
    const nearest = nearbyPin(event, 19);
    if (nearest !== hoveredPin) {
      hoveredPin = nearest;
      updateStopTooltip();
    }
    return;
  }
  if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 5) didDrag = true;
  hoveredPin = null;
  offsetX = pan.offsetX + (event.clientX - pan.x) / pan.ratio;
  offsetY = pan.offsetY + (event.clientY - pan.y) / pan.ratio;
  clampPan();
  drawMap();
});
svg.addEventListener("lostpointercapture", () => { pan = null; });
svg.addEventListener("pointerleave", () => {
  hoveredPin = null;
  updateStopTooltip();
});
svg.addEventListener("click", (event) => {
  if (didDrag || event.target.closest(".pin")) return;
  const nearest = nearbyPin(event, 17);
  if (nearest !== null) {
    selectMapPin(nearest);
    return;
  }
  hoveredPin = focusedPin = pinnedTooltip = null;
  updateStopTooltip();
});
window.addEventListener("resize", updateStopTooltip);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || stopTooltip.hidden) return;
  hoveredPin = focusedPin = pinnedTooltip = null;
  updateStopTooltip();
});
function inspectStop(index) {
  pauseTravel();
  openDetail(index);
}

function drawTraveler() {
  const moving = trip?.phase === "moving";
  traveler.setAttribute("visibility", moving ? "visible" : "hidden");
  const nextArrival = trip && !moving ? pins[routeStops[trip.leg]]?.marker : null;
  if (arrivalMarker !== nextArrival) {
    arrivalMarker?.classList.remove("travel-arrival");
    nextArrival?.classList.add("travel-arrival");
    arrivalMarker = nextArrival;
  }
  if (!trip) {
    traveledTrack.removeAttribute("points");
    return;
  }
  if (moving) traveler.setAttribute("transform", `translate(${transform(trip.point).join(" ")})`);
  const points = linePoints.slice(0, trip.leg + 1);
  if (moving) points.push(trip.point);
  traveledTrack.setAttribute("points", points.map(transform).map(point => point.join(",")).join(" "));
}

function updatePlaybackControls() {
  playButton.textContent = running ? "Ⅱ 일시정지" : trip?.phase === "finished" ? "▶ 다시 재생" : trip ? "▶ 계속 재생" : "▶ 여정 재생";
  restartButton.disabled = !trip;
}

function pauseTravel() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(frame);
  drawTraveler();
  travelStatus.textContent = "재생을 일시정지했습니다.";
  updatePlaybackControls();
}

function resetTravel() {
  pauseTravel();
  trip = null;
  travelStatus.textContent = "재생하면 선택한 여정을 자동으로 따라갑니다.";
  updatePlaybackControls();
}

function playTravel(restart = false) {
  if (restart || !trip || trip.phase === "finished") {
    resetTravel();
    trip = {leg:0, point:linePoints[0], phase:"moving", elapsed:0, status:"이동 중"};
    setTravelView(0);
    openDetail(routeStops[0]);
  } else if (trip.phase === "stopped") {
    openDetail(routeStops[trip.leg]);
  }
  running = true;
  previousTime = null;
  travelStatus.textContent = trip.status;
  updatePlaybackControls();
  frame = requestAnimationFrame(advanceTravel);
}

function setTravelView(closeUp) {
  const previousView = [scale, offsetX, offsetY];
  if (journeys[journey].entire) closeUp = 0;
  scale = 1 + 1.5 * closeUp;
  offsetX = (width / 2 - trip.point[0] * 2.5) * closeUp;
  offsetY = (height / 2 - trip.point[1] * 2.5) * closeUp;
  clampPan();
  if (scale !== previousView[0] || offsetX !== previousView[1] || offsetY !== previousView[2]) drawMap();
  else drawTraveler();
}

function arrive() {
  const index = routeStops[trip.leg];
  trip.phase = "stopped";
  trip.elapsed = 0;
  trip.status = `${cities[journeys[journey].stops[index][0]][0]} 도착 · 5초간 정차`;
  travelStatus.textContent = trip.status;
  openDetail(index);
}

function advanceTravel(now) {
  // Cap gaps between frames so returning to the browser does not skip a stop.
  const delta = previousTime === null ? 0 : Math.min(now - previousTime, 100);
  previousTime = now;
  if (trip.phase === "moving") {
    trip.elapsed += delta;
    while (trip.leg < linePoints.length - 1) {
      const [x,y] = linePoints[trip.leg];
      const end = linePoints[trip.leg + 1];
      const duration = Math.hypot(end[0] - x, end[1] - y) / travelSpeed * 1000;
      if (trip.elapsed < duration) {
        const progress = trip.elapsed / duration;
        trip.point = [x + (end[0] - x) * progress, y + (end[1] - y) * progress];
        break;
      }
      trip.elapsed -= duration;
      trip.leg++;
      trip.point = end;
      if (routeStops[trip.leg] >= 0) {
        arrive();
        break;
      }
    }
    if (scale === 1) drawTraveler();
    else setTravelView(0);
  } else if (trip.phase === "stopped") {
    trip.elapsed += delta;
    const finalStop = trip.leg === linePoints.length - 1;
    const zoomIn = zoomDuration ? Math.min(1, trip.elapsed / zoomDuration) : 1;
    const zoomOut = !finalStop && zoomDuration ? Math.min(1, Math.max(0, (stopDuration - trip.elapsed) / zoomDuration)) : 1;
    const amount = Math.min(zoomIn, zoomOut);
    setTravelView(amount * amount * (3 - 2 * amount));
    if (trip.elapsed >= stopDuration) {
      trip.elapsed = 0;
      trip.phase = finalStop ? "finished" : "moving";
      trip.status = "이동 중";
      if (finalStop) {
        trip.status = journeys[journey].entire ? "여리고 도착 · 전체 여정 완료" : "이 구간의 여정을 마쳤습니다.";
      }
      travelStatus.textContent = trip.status;
      if (finalStop) {
        running = false;
        updatePlaybackControls();
        return;
      }
      setTravelView(0);
    }
  }
  frame = requestAnimationFrame(advanceTravel);
}

const placeDialog = get("place-dialog");
function placeImage(id, photo) {
  if (photo) return `<img src="place-photos/${id}.webp" alt="${photo.caption}" decoding="async">`;
  return `<img src="place-terrain/${id}.webp" alt="${cities[id][0]} 주변의 입체 지형" decoding="async">`;
}
function placePreview(id) {
  const photo = placePhotos[id];
  const caption = photo?.caption ?? `${cities[id][0]} 주변 입체 지형`;
  const kind = photo?.kind ?? (photo ? "현대 사진" : "입체 지형");
  return `<button type="button" class="place-preview" data-place="${id}" aria-label="${caption} 크게 보기">
    <span class="place-thumb">${placeImage(id, photo)}</span>
    <span class="place-preview-copy"><strong>${caption}</strong><span>${kind} · 크게 보기 ↗</span></span>
  </button>`;
}
function openPlaceImage(id) {
  const photo = placePhotos[id];
  const note = photo?.note ?? "현대 표고 데이터로 그린 주변 지형입니다. 북쪽은 그림의 뒤편이며, 높낮이는 알아보기 쉽게 3배로 강조했습니다.";
  const credit = photo
    ? `<a href="${photo.source}" target="_blank" rel="noopener">사진 원본 ↗</a> · ${photo.credit}${photo.license ? ` · <a href="${photo.license}" target="_blank" rel="noopener">라이선스 ↗</a>` : ""}`
    : "지형 데이터 · USGS / Mapzen Terrain Tiles";
  pauseTravel();
  get("place-image-title").textContent = photo?.caption ?? `${cities[id][0]} 주변 입체 지형`;
  get("place-image-content").innerHTML = `${placeImage(id, photo)}<p>${note}</p><p class="place-credit">${credit}</p>`;
  placeDialog.showModal();
}

get("detail").addEventListener("click", (event) => {
  const preview = event.target.closest(".place-preview");
  if (preview) {
    openPlaceImage(preview.dataset.place);
    return;
  }
  const toggle = event.target.closest(".detail-toggle");
  if (!toggle) return;
  const expanded = get("detail-more").classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = expanded ? "말씀 요약·본문 접기" : "말씀 요약·본문 보기";
});

playButton.onclick = () => running ? pauseTravel() : playTravel();
restartButton.onclick = () => playTravel(true);
const research = get("research");
const candidateMap = get("candidate-map");
const compareProjection = ([lon,lat]) => [(lon - 32.35) * 139, (30.62 - lat) * 130];
const comparisonLand = polygonPath(land, compareProjection);
const comparisonRelief = makeRelief("comparison-relief");
drawRelief(comparisonRelief, compareProjection, comparisonLand);
candidateMap.append(
  node("rect",{width:480,height:300,fill:"#173846"}),
  node("path",{d:comparisonLand,fill:"#34484a",stroke:"#679094"}),
  comparisonRelief.layer
);
const candidateControls = [];
function selectCandidate(index) {
  const candidate = candidates[index];
  candidateControls.forEach(({control, dot},i) => {
    control.setAttribute("aria-pressed", String(i === index));
    dot.classList.toggle("candidate-selected", i === index);
  });
  get("candidate-detail").innerHTML = `<p class="candidate-type">${candidate.type}</p>
    <h4>${candidate.name}</h4><p class="ref">${candidate.location}</p>
    <p>${candidate.summary}</p><p>${candidate.limit}</p>
    <a href="${candidate.href}" target="_blank" rel="noopener">${candidate.source} ↗</a>`;
}
candidates.forEach(({name,point},i) => {
  const [x,y] = compareProjection(point);
  const marker = node("g",{transform:`translate(${x} ${y})`,"aria-hidden":"true",class:"candidate-dot"});
  marker.append(node("circle",{r:12}));
  const text = node("text",{y:1});
  text.textContent = i + 1;
  marker.append(text);
  marker.addEventListener("click", () => selectCandidate(i));
  candidateMap.append(marker);
  const control = button(`${i + 1}. ${name}`, () => selectCandidate(i));
  get("candidate-list").append(control);
  candidateControls.push({control,dot:marker});
});
get("compare").onclick = () => {
  pauseTravel();
  research.showModal();
};
selectCandidate(0);
selectJourney(0);
