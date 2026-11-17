"use strict";
// Live imagery is requested through Esri's SDK. No provider imagery is stored
// in the repository or service worker; the existing terrain remains available.
(() => {
  const terrainButton = document.getElementById("terrain-map");
  const satelliteButton = document.getElementById("satellite-map");
  const status = document.getElementById("basemap-status");
  const credits = document.querySelector(".map-credits");
  const originalCredits = credits.innerHTML;
  const satellite = node("image", {class:"satellite-image",preserveAspectRatio:"none",visibility:"hidden","aria-hidden":"true"});
  base.append(satellite);
  const bounds = {xmin:28,ymin:26,xmax:39,ymax:34,spatialReference:{wkid:4326}};
  let wanted = "terrain", ready = false, loading = null, copyright = "Esri, Earthstar Geographics, and the GIS User Community";

  function position() {
    const [x,y] = project([bounds.xmin,bounds.ymax]);
    const [right,bottom] = project([bounds.xmax,bounds.ymin]);
    Object.entries({x,y,width:right-x,height:bottom-y}).forEach(([k,v]) => satellite.setAttribute(k,v));
  }
  document.addEventListener("map-area-change",position);
  position();

  function applyMode() {
    const active = wanted === "satellite" && ready;
    satellite.setAttribute("visibility",active ? "visible" : "hidden");
    svg.classList.toggle("satellite-active",active);
    terrainButton.setAttribute("aria-pressed",String(!active));
    satelliteButton.setAttribute("aria-pressed",String(active));
    credits.innerHTML = originalCredits;
    if (active) {
      const link = document.createElement("a");
      link.href = "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9";
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "satellite-credit";
      link.textContent = copyright;
      credits.replaceChildren(link);
    }
  }

  function sdk() {
    return new Promise((resolve,reject) => {
      if (window.require?.toUrl) return resolve(window.require);
      const script = document.createElement("script");
      script.src = "https://js.arcgis.com/4.34/";
      script.onload = () => resolve(window.require);
      script.onerror = () => {script.remove(); reject(new Error("SDK load failed"));};
      document.head.append(script);
    });
  }

  async function loadImagery() {
    const require = await sdk();
    const [MapImageLayer,Extent] = await new Promise((resolve,reject) => require(
      ["esri/layers/MapImageLayer","esri/geometry/Extent"],(...modules) => resolve(modules),reject));
    const layer = new MapImageLayer({url:"https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"});
    await layer.load();
    if (layer.copyright) copyright = layer.copyright;
    const image = await layer.fetchImage(new Extent(bounds),1980,1440);
    // Keep the returned live service image in browser memory only.
    satellite.setAttribute("href",image.src);
    await new Promise((resolve,reject) => {
      const check = new Image();
      check.onload = resolve; check.onerror = reject; check.src = image.src;
    });
    ready = true;
  }

  async function choose(mode) {
    wanted = mode;
    status.hidden = true;
    applyMode();
    if (mode !== "satellite" || ready) return;
    status.textContent = "위성 지도를 불러오는 중입니다…";
    status.hidden = false;
    satelliteButton.setAttribute("aria-busy","true");
    try {
      loading ||= loadImagery();
      await loading;
      status.hidden = true;
      applyMode();
    } catch (error) {
      loading = null;
      if (wanted === "satellite") {
        wanted = "terrain";
        applyMode();
        status.textContent = "위성 지도를 불러오지 못해 지형 지도를 표시합니다. 위성 지도 버튼으로 다시 시도하세요.";
        status.hidden = false;
      }
    } finally {
      satelliteButton.removeAttribute("aria-busy");
    }
  }
  terrainButton.addEventListener("click",() => choose("terrain"));
  satelliteButton.addEventListener("click",() => choose("satellite"));
  choose("satellite");
})();
