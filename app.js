// Official City boundary; request WGS84 coordinates for D3's geographic projection.
const boundaryURL = 'https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/7/query?where=1%3D1&outFields=CITY&outSR=4326&f=geojson';

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAYBACK_MS = 20000;
const SPEED = DAY_MS / PLAYBACK_MS;

// LA, August 11, 2026, PDT. Civil twilight and solar times from Griffith
// Observatory's 2026 sunrise/sunset table. Palettes are Weather-inspired.
const SKY_STOPS = [
  [0, ['#101318', '#1b222c', '#252d38']],
  [345, ['#181e29', '#343b48', '#51474f']], // Civil dawn, 05:45
  [372, ['#283441', '#5b515c', '#796258']], // Sunrise, 06:12
  [432, ['#283c4d', '#354d60', '#466075']],
  [778, ['#2b4055', '#395569', '#4a667b']], // Solar noon, 12:58
  [1124, ['#2d394a', '#514d5d', '#716057']],
  [1184, ['#242e40', '#574957', '#7e6052']], // Sunset, 19:44
  [1211, ['#181e29', '#333542', '#4b404a']], // Civil dusk, 20:11
  [1271, ['#101318', '#1b222c', '#252d38']],
  [1440, ['#101318', '#1b222c', '#252d38']]
];

function skyGradient(time) {
  const minutes = ((time % DAY_MS) + DAY_MS) % DAY_MS / 60000;
  const end = SKY_STOPS.findIndex(stop => stop[0] > minutes);
  const [startTime, startColors] = SKY_STOPS[end - 1];
  const [endTime, endColors] = SKY_STOPS[end];
  const progress = (minutes - startTime) / (endTime - startTime);
  const blend = progress * progress * (3 - 2 * progress);
  const colors = startColors.map((color, i) => {
    const channels = [1, 3, 5].map(offset => {
      const start = parseInt(color.slice(offset, offset + 2), 16);
      const finish = parseInt(endColors[i].slice(offset, offset + 2), 16);
      return Math.round(start + (finish - start) * blend);
    });
    return `rgb(${channels.join(', ')})`;
  });
  return `linear-gradient(180deg, ${colors[0]} 0%, ${colors[1]} 65%, ${colors[2]} 100%)`;
}

// Parse wall-clock fields explicitly, independent of the viewer's time zone.
function eventTime(value) {
  const match = value.trim().match(/^8\/11\/2026 (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (!match) return null;
  const [, hour, minute, second, period] = match;
  if (+hour < 1 || +hour > 12 || +minute > 59 || +second > 59) return null;
  return ((+hour % 12 + (period === 'PM' ? 12 : 0)) * 3600 + +minute * 60 + +second) * 1000;
}

class SensorPlayback {
  constructor(events, ids) {
    this.events = events;
    this.ids = ids;
    this.reset();
  }
  reset() {
    this.cursor = 0;
    this.states = new Map(this.ids.map(id => [id, { state: null }]));
    this.advance(0);
  }
  advance(time) {
    while (this.cursor < this.events.length && this.events[this.cursor].time <= time) {
      const event = this.events[this.cursor++];
      const sensor = this.states.get(event.id);
      sensor.state = event.state;
    }
  }
}

function occupancyRhythm(states, sensors) {
  const occupied = sensors.reduce((count, sensor) =>
    count + (states.get(sensor.SpaceID.trim())?.state === 'OCCUPIED' ? 1 : 0), 0);
  const ratio = sensors.length ? occupied / sensors.length : 0;
  return { occupied, total: sensors.length, ratio, bpm: 40 + 200 * ratio };
}

class ParkingSound {
  constructor(audio = new Audio('assets/looperman-dark-synth-seamless.wav')) {
    this.audio = audio;
    this.audio.preload = 'auto';
    this.audio.loop = true;
    this.audio.volume = 0.65;
    this.audio.preservesPitch = true;
    this.audio.webkitPreservesPitch = true;
    this.rate = 1;
    this.appliedRate = 1;
    this.lastRateUpdate = null;
    this.previousPulse = null;
    this.starting = false;
    this.wanted = false;
  }
  clear(reset = false) {
    this.wanted = false;
    this.audio.pause();
    this.previousPulse = null;
    if (reset) {
      if (this.audio.currentTime > 0) this.audio.currentTime = 0;
      this.rate = 1;
      this.appliedRate = 1;
      this.lastRateUpdate = null;
      this.audio.playbackRate = 1;
    }
  }
  async resume() {
    this.wanted = true;
    if (this.starting || !this.audio.paused) return;
    this.starting = true;
    try {
      await this.audio.play();
      // A pause or mute can arrive while the track is loading.
      if (!this.wanted) this.audio.pause();
    } finally {
      this.starting = false;
    }
  }
  pulse(snapshot, now) {
    // Keep the song recognizable, with gentle changes instead of the synth's
    // extreme BPM range. Native media playback preserves the original pitch.
    const target = 0.8 + 0.6 * snapshot.ratio;
    const elapsed = this.previousPulse === null ? 16 : Math.min(100, Math.max(0, now - this.previousPulse));
    this.previousPulse = now;
    this.rate += (target - this.rate) * (1 - Math.exp(-elapsed / 250));
    // WebKit can interrupt audio on each playbackRate assignment. Keep the
    // occupancy smoothing, but apply meaningful changes at most twice a second
    // and only after playback has started.
    const nextRate = Math.round(this.rate * 50) / 50;
    if (!this.audio.paused && !this.starting &&
        (this.lastRateUpdate === null || now - this.lastRateUpdate >= 500) &&
        Math.abs(nextRate - this.appliedRate) >= 0.019) {
      this.audio.playbackRate = nextRate;
      this.appliedRate = nextRate;
      this.lastRateUpdate = now;
    }
    if (this.audio.paused && !this.starting) this.resume().catch(() => {});
  }
}

function startPlayback(events, sensors, points, initiallyPlaying = true, soundView = () => ({ sensors })) {
  const model = new SensorPlayback(events, sensors.map(d => d.SpaceID.trim()));
  const clock = document.querySelector('#clock');
  const toggle = document.querySelector('#play-pause');
  const restart = document.querySelector('#restart');
  const recordingFrame = document.querySelector('.recording-frame');
  const soundToggle = document.querySelector('#sound-toggle');
  let sound;
  let soundEnabled = false;
  let simulated = 0;
  let playing = initiallyPlaying;
  let held = false;
  let previous = performance.now();
  let frame;

  function soundFailed(error) {
    soundEnabled = false;
    sound?.clear();
    soundToggle.setAttribute('aria-pressed', 'false');
    soundToggle.setAttribute('aria-label', 'Retry enabling sound');
    soundToggle.textContent = 'Retry sound';
    console.warn('Audio playback failed:', error);
  }

  if (soundToggle) {
    soundToggle.disabled = false;
    soundToggle.addEventListener('click', async () => {
      soundEnabled = !soundEnabled;
      soundToggle.setAttribute('aria-pressed', String(soundEnabled));
      soundToggle.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Enable sound');
      soundToggle.textContent = soundEnabled ? 'Sound on' : 'Sound off';
      if (!soundEnabled) { sound?.clear(); return; }
      try {
        if (!sound) {
          sound = new ParkingSound();
        }
        if (playing) await sound.resume();
      } catch (error) {
        soundFailed(error);
      }
    });
  }

  function updateToggle() {
    toggle.textContent = playing ? 'Ⅱ' : '▶';
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    toggle.setAttribute('title', playing ? 'Pause' : 'Play');
  }
  function paint() {
    if (recordingFrame) recordingFrame.style.backgroundImage = skyGradient(simulated);
    const seconds = Math.floor(simulated / 1000);
    clock.textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(value => String(value).padStart(2, '0')).join(':');
    points.attr('class', d => {
      const sensor = model.states.get(d.SpaceID.trim());
      const state = sensor.state ? sensor.state.toLowerCase() : 'unestablished';
      return `sensor ${state}`;
    });
  }
  function tick(now) {
    const next = simulated + (held ? 0 : (now - previous) * SPEED);
    previous = now;
    if (next >= DAY_MS) { model.reset(); }
    simulated = next % DAY_MS;
    model.advance(simulated);
    if (soundEnabled && sound && !held) {
      const view = soundView();
      sound.pulse(occupancyRhythm(model.states, view.sensors), now);
    }
    paint();
    frame = requestAnimationFrame(tick);
  }
  toggle.disabled = restart.disabled = false;
  toggle.addEventListener('click', () => {
    playing = !playing;
    updateToggle();
    if (playing) {
      if (soundEnabled && sound) sound.resume().catch(soundFailed);
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    } else { cancelAnimationFrame(frame); sound?.clear(); }
  });
  restart.addEventListener('click', () => {
    simulated = 0;
    model.reset();
    sound?.clear(true);
    if (playing && soundEnabled && sound) sound.resume().catch(soundFailed);
    previous = performance.now();
    paint(); // Restart preserves the current play/pause choice.
  });
  updateToggle();
  paint();
  if (playing) frame = requestAnimationFrame(tick);
  return {
    hold(value) { held = value; previous = performance.now(); },
    play() {
      if (playing) return;
      playing = true;
      updateToggle();
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
}

// Load with a timeout so an unavailable CDN cannot leave the page blank.
function loadD3() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => reject(new Error('D3 download timed out. Check your connection and reload.')), 12000);
    script.src = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js';
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('D3 could not download. Check your connection and reload.')); };
    document.head.append(script);
  });
}

async function main() {
  const status = document.querySelector('#status');
  if (location.protocol === 'file:') {
    throw new Error('Serve this folder with python3 -m http.server 8000, then open http://localhost:8000. Browsers block CSV loading from file URLs.');
  }
  await loadD3();
  if (!window.d3) throw new Error('D3 could not load. Check your internet connection.');

  const boundaryRequest = d3.json(boundaryURL)
    .then(data => {
      if (data.type !== 'FeatureCollection' || !data.features.length) {
        throw new Error('No boundary returned');
      }
      // ArcGIS GeoJSON winding can make D3 interpret LA as the rest of Earth.
      // Normalize each polygon to D3's small-area spherical winding convention.
      for (const feature of data.features) {
        const geometry = feature.geometry;
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] :
          geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
        for (const coordinates of polygons) {
          if (d3.geoArea({ type: 'Polygon', coordinates }) > 2 * Math.PI) {
            coordinates.forEach(ring => ring.reverse());
          }
        }
      }
      return data;
    })
    .catch(() => null);

  status.textContent = 'Loading sensor locations…';
  const rows = await d3.csv('sensor_locations.csv');
  const sensors = rows.flatMap(row => {
    if (!row.latitude.trim() || !row.longitude.trim()) return [];
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    // Mercator cannot project the poles. Preserve all other valid coordinates,
    // including duplicate locations: each CSV row remains an individual point.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude <= -90 || latitude >= 90 || longitude < -180 || longitude > 180) return [];
    return [{ ...row, coordinates: [longitude, latitude] }];
  });
  if (!sensors.length) throw new Error('No valid latitude/longitude points found.');

  let cityBoundary = null;
  status.textContent = 'Loading city outline and activity…';
  cityBoundary = await boundaryRequest;
  if (!cityBoundary) throw new Error('The LA outline is unavailable. Check your connection and reload.');

  const svg = d3.select('#map');
  const boundary = svg.append('path').attr('class', 'boundary');
  const points = svg.append('g').selectAll('circle')
    .data(sensors).join('circle').attr('class', 'sensor').attr('r', 2);
  points.append('title').text(d => `${d.SpaceID} · ${d.BlockFace}`);
  const inset = d3.select('#locator');
  const insetBoundary = inset.append('path').attr('class', 'boundary');
  const insetWindow = inset.append('path').attr('class', 'locator-window');
  const extent = data => ({ type: 'MultiPoint', coordinates: data.map(d => d.coordinates) });
  const areas = [
    { name: 'Hollywood', bounds: [-118.36, -118.30, 34.08, 34.12] },
    { name: 'Westwood Village', bounds: [-118.46, -118.42, 34.045, 34.08] },
    { name: 'Venice', bounds: [-118.49, -118.43, 33.97, 34.01] },
    { name: 'USC / Expo Park', bounds: [-118.31, -118.27, 34.01, 34.04] },
    { name: 'Downtown LA', bounds: [-118.275, -118.225, 34.025, 34.075] }
  ].map(area => ({ ...area, data: sensors.filter(d => {
    const [w, e, south, north] = area.bounds;
    const [lon, lat] = d.coordinates;
    return lon >= w && lon <= e && lat >= south && lat <= north;
  }) }));
  const regional = sensors.filter(d => {
    const [lon, lat] = d.coordinates;
    return lon >= -118.52 && lon <= -118.20 && lat >= 33.95 && lat <= 34.14;
  });
  // Fit the actual coverage, rather than extra empty geographic margins.
  const frames = [cityBoundary, extent(regional), extent(regional)];
  const names = ['Los Angeles', 'Central LA & the Westside', 'Neighborhood spotlights'];
  const cards = d3.select('#neighborhood-grid').selectAll('button').data(areas).join('button')
    .attr('class', (_, i) => `neighborhood-card area-${i}`)
    .attr('aria-label', d => `Open ${d.name}`).attr('disabled', true);
  cards.append('h2').text(d => d.name);
  const closeups = [];
  cards.each(function(area, index) {
    const map = d3.select(this).append('svg').attr('role', 'img')
      .attr('aria-label', `${area.name} parking sensor activity, north up`);
    const dots = map.append('g').selectAll('circle').data(area.data).join('circle')
      .attr('class', 'sensor').attr('r', 2);
    dots.append('title').text(d => `${d.SpaceID} · ${d.BlockFace}`);
    closeups.push({ map, dots, area });
    d3.select(this).on('click', () => selectArea(index));
  });
  function drawComparison() {
    const fits = closeups.map(({ map, area }) => {
      const { width, height } = map.node().getBoundingClientRect();
      if (width <= 8 || height <= 8) return null;
      return d3.geoMercator().fitExtent([[4, 4], [width - 4, height - 4]], extent(area.data));
    });
    if (fits.some(fit => !fit)) return;
    const sharedScale = Math.min(...fits.map(fit => fit.scale()));
    closeups.forEach(({ map, dots }, i) => {
      const { width, height } = map.node().getBoundingClientRect();
      const fit = fits[i];
      const center = fit.invert([width / 2, height / 2]);
      const camera = d3.geoMercator().scale(sharedScale).center(center).translate([width / 2, height / 2]);
      map.attr('viewBox', `0 0 ${width} ${height}`).attr('data-map-scale', sharedScale);
      dots.attr('cx', d => camera(d.coordinates)[0]).attr('cy', d => camera(d.coordinates)[1]);
    });
  }
  new ResizeObserver(drawComparison).observe(document.querySelector('#neighborhood-grid'));
  const projection = d3.geoMercator();
  const path = d3.geoPath(projection);
  const locatorProjection = d3.geoMercator().fitExtent([[8, 8], [112, 172]], cityBoundary);
  const locatorPath = d3.geoPath(locatorProjection);
  insetBoundary.attr('d', locatorPath(cityBoundary));
  let stage = 0;
  let selectedArea = 0;
  let moving = false;
  let playback;
  const enter = document.querySelector('#enter-area');
  const back = document.querySelector('#back');

  function paintMap() {
    // Let the SVG viewport crop the real outline; polygon clipping would add
    // artificial city-border segments along the rectangular viewport edges.
    boundary.attr('d', d3.geoPath(d3.geoMercator().scale(projection.scale()).translate(projection.translate()))(cityBoundary));
    points.attr('cx', d => projection(d.coordinates)[0]).attr('cy', d => projection(d.coordinates)[1])
      .attr('r', stage <= 1 ? 1 : 2);
    const { width, height } = svg.node().getBoundingClientRect();
    const corners = [[0, 0], [width, 0], [width, height], [0, height], [0, 0]]
      .map(point => projection.invert(point));
    insetWindow.attr('d', locatorPath({ type: 'LineString', coordinates: corners }));

  }
  function updateLabels() {
    document.querySelector('#context').textContent = 'LA DOT parking sensor data';
    document.querySelector('#locator-wrap').hidden = stage === 0 || stage === 2;
    document.querySelector('#neighborhood-grid').hidden = stage !== 2;
    svg.style('visibility', stage === 2 ? 'hidden' : 'visible');
    enter.hidden = stage !== 0;
    enter.textContent = 'Zoom in';
    enter.setAttribute('aria-label', stage === 0 ? 'Zoom in to Central LA and the Westside' : 'Zoom in to neighborhood spotlights');
    back.hidden = stage !== 1;
    document.querySelector('.zoom-controls').hidden = stage !== 0;
    back.textContent = stage === 1 ? 'Zoom out' : 'All areas';
    document.querySelector('#area-selector').hidden = stage === 0;
    document.querySelector('#comparison-note').hidden = stage !== 2;
    document.querySelectorAll('#area-selector button').forEach(button => {
      button.disabled = moving || !playback;
      button.setAttribute('aria-pressed', String(button.dataset.view === (stage === 2 ? 'compare' : stage === 3 ? String(selectedArea) : 'all')));
    });
    svg.attr('aria-label', `${stage === 3 ? areas[selectedArea].name : names[stage]} parking sensor locations, north up`);
    const shown = stage === 0 ? sensors.length : stage === 3 ? areas[selectedArea].data.length : regional.length;
    status.textContent = `${shown.toLocaleString()} sensor locations · ` +
      (stage === 0 ? 'Zoom in to explore' : '24 hours in 20 seconds');
  }
  function fitted() {
    const { width, height } = svg.node().getBoundingClientRect();
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    return d3.geoMercator().fitExtent([[8, 8], [width - 8, height - 8]], stage === 3 ? extent(areas[selectedArea].data) : frames[stage]);
  }
  function render() {
    svg.interrupt();
    const dest = fitted();
    projection.scale(dest.scale()).translate(dest.translate());
    const { width, height } = svg.node().getBoundingClientRect();
    projection.clipExtent([[0, 0], [width, height]]);
    moving = false;
    enter.disabled = !playback;
    back.disabled = false;
    playback?.hold(false);
    paintMap();
    updateLabels();
    if (stage === 2) drawComparison();
  }
  function navigate(next) {
    if (moving) return;
    moving = true;
    playback.hold(true);
    const previousStage = stage;
    stage = next;
    updateLabels();
    if (stage === 2 || previousStage === 2) {
      render();
      return;
    }
    enter.disabled = back.disabled = true;
    const dest = fitted();
    const scale = d3.interpolateNumber(projection.scale(), dest.scale());
    const translate = d3.interpolateArray(projection.translate(), dest.translate());
    svg.transition().duration(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1100)
      .ease(d3.easeCubicInOut).tween('camera', () => t => {
        projection.scale(scale(t)).translate(translate(t));
        paintMap();
      }).on('end', () => {
        moving = false;
        enter.disabled = back.disabled = false;
        playback.hold(false);
        updateLabels();
      });
  }
  function selectArea(index) {
    if (moving || !playback) return;
    selectedArea = index;
    navigate(3);
  }
  const selector = d3.select('#area-selector');
  const options = [
    { label: 'Zoom out', view: 'city' }, { label: 'All areas', view: 'all' }, { label: 'Compare areas', view: 'compare' },
    ...areas.map((area, i) => ({ label: ['Hollywood', 'Westwood', 'Venice', 'USC / Expo', 'DTLA'][i], view: String(i) }))
  ];
  selector.selectAll('div').data([options.slice(0, 3), options.slice(3)]).join('div')
    .attr('class', 'option-row').selectAll('button').data(d => d).join('button').attr('data-view', d => d.view).text(d => d.label).on('click', (_, d) => {
    if (d.view === 'city') navigate(0);
    else if (d.view === 'all') navigate(1);
    else if (d.view === 'compare') navigate(2);
    else selectArea(Number(d.view));
  });
  enter.addEventListener('click', () => navigate(1));
  back.addEventListener('click', () => navigate(stage === 1 ? 0 : 1));
  updateLabels();
  render();
  enter.disabled = true;
  // Revealing navigation resizes the map; do not cancel its camera transition
  // or release the playback hold in response to that layout change.
  new ResizeObserver(() => { if (!moving) render(); }).observe(svg.node());
  const eventRows = await d3.csv('one-day-state-change.csv');
  const locationIds = new Set(sensors.map(d => d.SpaceID.trim()));
  let unmatched = 0;
  let invalid = 0;
  const events = [];
  for (const row of eventRows) {
    const id = row.SpaceID.trim();
    const time = eventTime(row.EventTime_Local);
    const state = row.OccupancyState.trim();
    if (time === null || !['VACANT', 'OCCUPIED'].includes(state)) { invalid++; continue; }
    if (!locationIds.has(id)) { unmatched++; continue; }
    events.push({ id, time, state });
  }
  events.sort((a, b) => a.time - b.time); // Equal timestamps retain CSV order.
  const comparisonSensors = [...new Set(areas.flatMap(area => area.data))];
  function soundView() {
    if (stage === 2) return { sensors: comparisonSensors };
    const { width, height } = svg.node().getBoundingClientRect();
    const visible = sensors.filter(sensor => {
      const [x, y] = projection(sensor.coordinates);
      return x >= 0 && y >= 0 && x <= width && y <= height;
    });
    return { sensors: visible };
  }
  playback = startPlayback(events, sensors, d3.selectAll('.sensor'), false, soundView);
  enter.disabled = false;
  cards.attr('disabled', null);
  updateLabels();
  console.info(`${unmatched} events without locations skipped; ${invalid} invalid events skipped.`);
}

main().catch(error => {
  document.querySelector('#status').textContent = `Unable to load map: ${error.message}`;
});
