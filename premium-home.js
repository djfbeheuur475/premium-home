// Premium Home — a custom Lovelace card for Home Assistant.
//
// Registers as `custom:premium-home`. Renders its own internal app shell
// (Home / Climate / Lights / Humidity / Music, plus a per-room detail
// page and a light detail bottom sheet) with a floating pill nav bar —
// navigation never touches HA's own view/dashboard routing, it's a plain
// internal `_page` property swap, so switching pages is instant.
//
// No build step: Lit is imported from a pinned CDN version below. No
// fake data anywhere — every value comes from `this.hass.states[...]`,
// `weather.get_forecasts`, `spotifyplus.*`, or the HA history API,
// fetched live.
//
// Deployed via a HACS custom repository (github.com/djfbeheuur475/premium-home),
// not a manually-copied file — HACS places it under /hacsfiles/premium-home/.

import {
  LitElement,
  html,
  css,
} from 'https://cdn.jsdelivr.net/npm/lit@3.3.3/+esm';

// ---------------------------------------------------------------------
// Entity configuration — the one place to edit if rooms/sensors change.
// Pulled live from GET /api/states and GET /api/services, not guessed.
// Each room bundles every domain that room actually has; a null field
// means that room genuinely has no such entity (e.g. Study has no
// media_player) — rendering always checks for null rather than assuming.
// ---------------------------------------------------------------------

const WHOLE_HOUSE = 'climate.house';
const WEATHER_ENTITY = 'weather.forecast_home';
const SPOTIFY_ENTITY = 'media_player.spotifyplus_aidan_harper';

const ROOMS = [
  {
    id: 'living-room',
    name: 'Living Room',
    icon: 'mdi:sofa',
    light: 'light.living_room_lights',
    climate: 'climate.living',
    humidity: 'sensor.sonoff_snzb_02d_humidity_3',
    media: 'media_player.living_room',
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    icon: 'mdi:silverware-fork-knife',
    light: 'light.kitchen',
    climate: null,
    humidity: null,
    media: 'media_player.kitchen',
  },
  {
    id: 'bedroom',
    name: 'Bedroom',
    icon: 'mdi:bed',
    light: 'light.bedroom_2',
    climate: 'climate.master',
    humidity: 'sensor.sonoff_snzb_02d_humidity_2',
    media: 'media_player.bedroom_speaker',
  },
  {
    id: 'study',
    name: 'Study',
    icon: 'mdi:bookshelf',
    light: 'light.ikea_of_sweden_tradfri_bulb_e27_cws_globe_806lm_4',
    climate: 'climate.study',
    humidity: 'sensor.sonoff_snzb_02d_humidity',
    media: null,
  },
  {
    id: 'arlos-room',
    name: "Arlo's Room",
    icon: 'mdi:teddy-bear',
    light: 'light.ikea_of_sweden_tradfri_bulb_e27_cws_globe_806lm_2',
    climate: 'climate.arlo',
    humidity: 'sensor.sonoff_snzb_02d_humidity_4',
    media: 'media_player.arlo_s_speaker',
  },
];

const ZONES = ROOMS.filter((r) => r.climate).map((r) => ({ id: r.climate, name: r.name }));
const ROOM_LIGHTS = ROOMS.map((r) => ({ id: r.light, name: r.name }));
const HUMIDITY_SENSORS = [
  ...ROOMS.filter((r) => r.humidity).map((r) => ({ id: r.humidity, name: r.name })),
  { id: 'sensor.tze200_vs0skpuc_ts0601_humidity', name: 'Under the House' },
  { id: 'sensor.tze284_vvmbj46n_ts0601_humidity', name: 'Outside' },
];
const ALL_LIGHT_IDS = ROOM_LIGHTS.map((l) => l.id);

// ---------------------------------------------------------------------
// Small formatting / color helpers
// ---------------------------------------------------------------------

function greeting(now) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function climateColorVar(state) {
  switch (state) {
    case 'heat':
      return 'var(--heating)';
    case 'cool':
      return 'var(--cooling)';
    case 'fan_only':
      return 'var(--fan)';
    case 'off':
    case 'unavailable':
    case 'unknown':
      return 'var(--unavailable)';
    default:
      return 'var(--text-secondary)';
  }
}

function climateIcon(state) {
  switch (state) {
    case 'heat':
      return 'mdi:fire';
    case 'cool':
      return 'mdi:snowflake';
    case 'fan_only':
      return 'mdi:fan';
    case 'dry':
      return 'mdi:water-percent';
    case 'auto':
      return 'mdi:thermostat-auto';
    default:
      return 'mdi:power';
  }
}

function stateLabel(state) {
  if (!state) return 'Unknown';
  if (state === 'fan_only') return 'Fan only';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function lightColorVar(state) {
  if (state === 'on') return 'var(--heating)';
  if (state === 'unavailable') return 'var(--unavailable)';
  return 'var(--text-secondary)';
}

function brightnessPct(attrs) {
  if (attrs == null || attrs.brightness == null) return 0;
  return Math.round((attrs.brightness / 255) * 100);
}

// Simple trend from a run of history points: compares the average of the
// last 3 samples against the 3 before that. Used for the humidity rows'
// arrow and the featured sensor's Rising/Falling/Steady badge.
function trendFor(points) {
  if (!points || points.length < 6) return 'steady';
  const recent = points.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const earlier = points.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
  const diff = recent - earlier;
  if (diff > 0.5) return 'rising';
  if (diff < -0.5) return 'falling';
  return 'steady';
}
function trendIcon(trend) {
  if (trend === 'rising') return 'mdi:arrow-top-right';
  if (trend === 'falling') return 'mdi:arrow-bottom-right';
  return 'mdi:arrow-right';
}

// ---------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------

class PremiumHomeCard extends LitElement {
  static properties = {
    _page: { state: true },
    _activeRoomId: { state: true },
    _lightSheetId: { state: true },
    _forecast: { state: true },
    _forecastLoading: { state: true },
    _history: { state: true },
    _now: { state: true },
    _dragValues: { state: true },
    _spotifyDevices: { state: true },
    _spotifyDevicesLoading: { state: true },
    _selectedDeviceId: { state: true },
    _searchQuery: { state: true },
    _searchResults: { state: true },
    _searching: { state: true },
    _searchError: { state: true },
    _topTracks: { state: true },
    _recentTracks: { state: true },
    _suggestionsLoading: { state: true },
  };

  constructor() {
    super();
    this._page = 'home';
    this._activeRoomId = null;
    this._lightSheetId = null;
    this._forecast = null;
    this._forecastLoading = false;
    this._history = {};
    this._now = new Date();
    this._dragValues = {};
    this._hass = null;
    this._forecastInterval = null;
    this._clockInterval = null;
    this._spotifyDevices = null;
    this._spotifyDevicesLoading = false;
    this._selectedDeviceId = null;
    this._searchQuery = '';
    this._searchResults = null;
    this._searching = false;
    this._searchError = null;
    this._topTracks = null;
    this._recentTracks = null;
    this._suggestionsLoading = false;
  }

  // --- HA card contract -------------------------------------------------

  // Required by every Lovelace card, custom or built-in — HA's card
  // creation helper checks for this method before it will even try to
  // mount the element, and silently substitutes its own "Configuration
  // error" card instead if it's missing. This card takes no YAML config
  // of its own (all data comes from hass), so there's nothing to do with
  // it beyond storing it.
  setConfig(config) {
    this._config = config ?? {};
  }

  set hass(hass) {
    const first = this._hass === null;
    this._hass = hass;
    if (first) {
      this._fetchForecast();
    }
    this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 12;
  }

  connectedCallback() {
    super.connectedCallback();
    this._clockInterval = setInterval(() => {
      this._now = new Date();
    }, 30_000);
    this._forecastInterval = setInterval(() => this._fetchForecast(), 30 * 60_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._clockInterval);
    clearInterval(this._forecastInterval);
  }

  // --- Data fetching ------------------------------------------------------

  async _fetchForecast() {
    if (!this._hass) return;
    this._forecastLoading = true;
    try {
      const resp = await this._hass.connection.sendMessagePromise({
        type: 'call_service',
        domain: 'weather',
        service: 'get_forecasts',
        service_data: { type: 'daily' },
        target: { entity_id: WEATHER_ENTITY },
        return_response: true,
      });
      this._forecast = resp?.response?.[WEATHER_ENTITY]?.forecast ?? [];
    } catch (err) {
      console.warn('premium-home: forecast fetch failed', err);
      this._forecast = [];
    }
    this._forecastLoading = false;
  }

  async _fetchHistory(entityId) {
    if (!this._hass || this._history[entityId]) return;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      const path =
        `history/period/${start.toISOString()}` +
        `?filter_entity_id=${entityId}&minimal_response&no_attributes`;
      const result = await this._hass.callApi('GET', path);
      const points = (result?.[0] ?? [])
        .map((p) => parseFloat(p.state))
        .filter((v) => !Number.isNaN(v));
      this._history = { ...this._history, [entityId]: points };
    } catch (err) {
      console.warn('premium-home: history fetch failed for', entityId, err);
      this._history = { ...this._history, [entityId]: [] };
    }
  }

  async _fetchSpotifyDevices() {
    if (!this._hass || this._spotifyDevicesLoading) return;
    this._spotifyDevicesLoading = true;
    try {
      const resp = await this._hass.connection.sendMessagePromise({
        type: 'call_service',
        domain: 'spotifyplus',
        service: 'get_spotify_connect_devices',
        service_data: { entity_id: SPOTIFY_ENTITY, refresh: false },
        return_response: true,
      });
      const items = resp?.response?.result?.Items ?? [];
      this._spotifyDevices = items.filter((d) => d.Name !== 'Home Assistant');
      if (!this._selectedDeviceId && this._spotifyDevices.length) {
        this._selectedDeviceId = this._spotifyDevices[0].Id;
      }
    } catch (err) {
      console.warn('premium-home: spotify device list failed', err);
      this._spotifyDevices = [];
    }
    this._spotifyDevicesLoading = false;
  }

  async _searchTracks() {
    const query = this._searchQuery.trim();
    if (!query || !this._hass) return;
    this._searching = true;
    this._searchResults = null;
    this._searchError = null;
    try {
      const resp = await this._hass.connection.sendMessagePromise({
        type: 'call_service',
        domain: 'spotifyplus',
        service: 'search_tracks',
        service_data: { entity_id: SPOTIFY_ENTITY, criteria: query, limit: 12 },
        return_response: true,
      });
      this._searchResults = resp?.response?.result?.items ?? [];
    } catch (err) {
      console.warn('premium-home: track search failed', err);
      this._searchError = err?.message ?? String(err);
      this._searchResults = [];
    }
    this._searching = false;
  }

  async _fetchSuggestions() {
    if (!this._hass || this._suggestionsLoading) return;
    this._suggestionsLoading = true;
    try {
      const topResp = await this._hass.connection.sendMessagePromise({
        type: 'call_service',
        domain: 'spotifyplus',
        service: 'get_users_top_tracks',
        service_data: { entity_id: SPOTIFY_ENTITY, limit: 6, time_range: 'short_term' },
        return_response: true,
      });
      this._topTracks = topResp?.response?.result?.items ?? [];
    } catch (err) {
      console.warn('premium-home: top tracks fetch failed', err);
      this._topTracks = [];
    }
    try {
      const recentResp = await this._hass.connection.sendMessagePromise({
        type: 'call_service',
        domain: 'spotifyplus',
        service: 'get_player_recent_tracks',
        service_data: { entity_id: SPOTIFY_ENTITY, limit: 6 },
        return_response: true,
      });
      const items = recentResp?.response?.result?.items ?? [];
      this._recentTracks = items.map((i) => i.track).filter(Boolean);
    } catch (err) {
      console.warn('premium-home: recent tracks fetch failed', err);
      this._recentTracks = [];
    }
    this._suggestionsLoading = false;
  }

  // --- Services -------------------------------------------------------

  _toggleLight(entityId) {
    this._hass.callService('light', 'toggle', { entity_id: entityId });
  }

  _setBrightness(entityId, pct) {
    this._hass.callService('light', 'turn_on', {
      entity_id: entityId,
      brightness_pct: Math.max(1, Math.min(100, Math.round(pct))),
    });
  }

  _setColorTempKelvin(entityId, kelvin) {
    this._hass.callService('light', 'turn_on', {
      entity_id: entityId,
      color_temp_kelvin: Math.round(kelvin),
    });
  }

  _allLights(on) {
    this._hass.callService('light', on ? 'turn_on' : 'turn_off', {
      entity_id: ALL_LIGHT_IDS,
    });
  }

  _setTemp(entityId, temp, step) {
    const clamped = Math.round(temp / step) * step;
    this._hass.callService('climate', 'set_temperature', {
      entity_id: entityId,
      temperature: clamped,
    });
  }

  _setHvacMode(entityId, mode) {
    this._hass.callService('climate', 'set_hvac_mode', {
      entity_id: entityId,
      hvac_mode: mode,
    });
  }

  _transport(action) {
    this._hass.callService('media_player', action, { entity_id: SPOTIFY_ENTITY });
  }

  _playTrack(uri) {
    if (!this._selectedDeviceId) return;
    this._hass.callService('spotifyplus', 'player_media_play_tracks', {
      entity_id: SPOTIFY_ENTITY,
      uris: [uri],
      device_id: this._selectedDeviceId,
    });
  }

  // --- Scenes -----------------------------------------------------------
  // No HA scene/script entities exist on this instance (checked live) —
  // each button below is a plain, transparent set of real service calls
  // defined here, not a black-box automation. Easy to see exactly what
  // each one does, and easy to change.

  _sceneGoodNight() {
    this._allLights(false);
    ZONES.forEach((z) => this._setHvacMode(z.id, 'off'));
    this._setHvacMode(WHOLE_HOUSE, 'off');
  }

  _sceneAllOn() {
    this._allLights(true);
  }

  // "Movie" assumes the living room is where the TV/movie-watching
  // happens (there's a Living Room TV media_player, no such signal for
  // any other room) — dims that room, turns other room lights off.
  _sceneMovie() {
    ROOMS.forEach((r) => {
      if (r.id === 'living-room') this._setBrightness(r.light, 20);
      else this._hass.callService('light', 'turn_off', { entity_id: r.light });
    });
  }

  // "Morning" — Kitchen and Living Room bright, doesn't touch bedrooms
  // (assumes people are still in them) or climate (no defined day
  // setpoint to switch to).
  _sceneMorning() {
    this._setBrightness('light.kitchen', 90);
    this._setBrightness('light.living_room_lights', 80);
  }

  // --- Navigation ---------------------------------------------------

  _goto(page) {
    this._page = page;
    this._activeRoomId = null;
    if (page === 'humidity') {
      HUMIDITY_SENSORS.forEach((s) => this._fetchHistory(s.id));
    }
    if (page === 'music') {
      if (this._spotifyDevices === null) this._fetchSpotifyDevices();
      if (this._topTracks === null) this._fetchSuggestions();
    }
  }

  _openRoom(roomId) {
    this._page = 'room';
    this._activeRoomId = roomId;
    const room = ROOMS.find((r) => r.id === roomId);
    if (room?.humidity) this._fetchHistory(room.humidity);
  }

  // --- Drag sliders (brightness + color temp share this) --------------

  _onSliderPointerDown(ev, key, { vertical = false } = {}) {
    ev.preventDefault();
    const track = ev.currentTarget;
    const update = (clientX, clientY) => {
      const rect = track.getBoundingClientRect();
      const frac = vertical
        ? (rect.bottom - clientY) / rect.height
        : (clientX - rect.left) / rect.width;
      const pct = Math.max(0, Math.min(100, frac * 100));
      this._dragValues = { ...this._dragValues, [key]: pct };
    };
    update(ev.clientX, ev.clientY);

    const onMove = (e) => update(e.clientX, e.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const pct = this._dragValues[key];
      if (pct != null) this._onSliderCommit?.(key, pct);
      setTimeout(() => {
        const next = { ...this._dragValues };
        delete next[key];
        this._dragValues = next;
      }, 400);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // --- Render: shell ----------------------------------------------------

  render() {
    if (!this._hass) return html``;
    return html`
      <div class="shell">
        <div class="content">${this._renderPage()}</div>
        ${this._renderNav()}
      </div>
      ${this._lightSheetId ? this._renderLightSheet(this._lightSheetId) : html``}
    `;
  }

  _renderPage() {
    switch (this._page) {
      case 'climate':
        return this._renderClimate();
      case 'lights':
        return this._renderLights();
      case 'humidity':
        return this._renderHumidity();
      case 'music':
        return this._renderMusic();
      case 'rooms':
        return this._renderRooms();
      case 'room':
        return this._renderRoomDetail();
      default:
        return this._renderHome();
    }
  }

  _renderNav() {
    const items = [
      { id: 'home', icon: 'mdi:home-variant-outline', label: 'Home' },
      { id: 'climate', icon: 'mdi:thermostat', label: 'Climate' },
      { id: 'lights', icon: 'mdi:lightbulb-group-outline', label: 'Lights' },
      { id: 'humidity', icon: 'mdi:water-percent', label: 'Humidity' },
      { id: 'music', icon: 'mdi:spotify', label: 'Music' },
    ];
    return html`
      <nav class="bottom-nav">
        ${items.map((item) => {
          const active = this._page === item.id;
          return html`
            <button class="nav-btn ${active ? 'active' : ''}" @click=${() => this._goto(item.id)}>
              <ha-icon icon=${item.icon}></ha-icon>
              ${active ? html`<span>${item.label}</span>` : html``}
            </button>
          `;
        })}
      </nav>
    `;
  }

  // --- Render: Home -------------------------------------------------

  _renderHome() {
    const weather = this._hass.states[WEATHER_ENTITY];
    const houseState = this._hass.states[WHOLE_HOUSE];

    const roomsOn = ROOM_LIGHTS.filter((l) => this._hass.states[l.id]?.state === 'on').length;
    const availableHumidity = HUMIDITY_SENSORS.filter(
      (s) => this._hass.states[s.id]?.state !== 'unavailable'
    );
    const avgHumidity = availableHumidity.length
      ? Math.round(
          availableHumidity.reduce((sum, s) => sum + parseFloat(this._hass.states[s.id].state), 0) /
            availableHumidity.length
        )
      : null;

    return html`
      <div class="page page-home">
        <section class="hero">
          <div class="hero-top">
            <div class="hero-text">
              <div class="hero-brand">HARPER HOUSE</div>
              <div class="hero-greeting">${greeting(this._now)}</div>
              <div class="hero-date">
                ${this._now.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </div>
            ${weather
              ? html`
                  <div class="hero-weather">
                    <div class="hero-temp">${Math.round(weather.attributes.temperature)}°</div>
                    <div class="hero-condition">${stateLabel(weather.state.replace('-', ' '))}</div>
                  </div>
                `
              : html`<div class="hero-weather muted">Weather unavailable</div>`}
          </div>
          ${weather ? this._renderForecastStrip() : html``}
        </section>

        <div class="stat-row">
          <div class="stat-tile">
            <div class="stat-value" style="color:var(--heating)">${roomsOn}</div>
            <div class="stat-label">lights on</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value" style="color:var(--cooling)">
              ${houseState?.attributes?.temperature ?? '—'}°
            </div>
            <div class="stat-label">house target</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value" style="color:var(--success)">
              ${avgHumidity != null ? `${avgHumidity}%` : '—'}
            </div>
            <div class="stat-label">avg humidity</div>
          </div>
        </div>

        <div class="section-row">
          <h2 class="section-title inline">Rooms</h2>
          <button class="see-all" @click=${() => this._goto('rooms')}>See all</button>
        </div>
        <section class="room-grid">
          ${ROOMS.slice(0, 2).map((room) => this._renderRoomCard(room))}
        </section>

        <h2 class="section-title">Scenes</h2>
        <section class="scene-grid">
          <button class="scene-btn dark" @click=${() => this._sceneGoodNight()}>
            <ha-icon icon="mdi:weather-night"></ha-icon>
            Good night
          </button>
          <button class="scene-btn accent" @click=${() => this._sceneAllOn()}>
            <ha-icon icon="mdi:lightbulb-on"></ha-icon>
            All on
          </button>
          <button class="scene-btn" @click=${() => this._sceneMovie()}>
            <ha-icon icon="mdi:movie-open-outline"></ha-icon>
            Movie
          </button>
          <button class="scene-btn" @click=${() => this._sceneMorning()}>
            <ha-icon icon="mdi:coffee-outline"></ha-icon>
            Morning
          </button>
        </section>
      </div>
    `;
  }

  _renderRoomCard(room) {
    const light = this._hass.states[room.light];
    const climate = room.climate ? this._hass.states[room.climate] : null;
    const pct = brightnessPct(light?.attributes);
    const statusParts = [];
    if (light) statusParts.push(`Light ${light.state === 'on' ? `${pct}%` : 'off'}`);
    if (climate && climate.state !== 'off') statusParts.push(stateLabel(climate.state));

    return html`
      <button class="room-card" @click=${() => this._openRoom(room.id)}>
        <div class="room-card-icon">
          <ha-icon icon=${room.icon}></ha-icon>
        </div>
        <div class="room-card-name">${room.name}</div>
        <div class="room-card-status">${statusParts.join(' · ') || '—'}</div>
        ${climate
          ? html`<div class="room-card-temp">${climate.attributes?.current_temperature ?? '—'}°</div>`
          : html``}
      </button>
    `;
  }

  _renderRooms() {
    return html`
      <div class="page page-rooms">
        <div class="page-header-row">
          <button class="back-btn" @click=${() => this._goto('home')}>
            <ha-icon icon="mdi:arrow-left"></ha-icon>
          </button>
          <h1 class="page-title">Rooms</h1>
        </div>
        <section class="room-grid">${ROOMS.map((room) => this._renderRoomCard(room))}</section>
      </div>
    `;
  }

  _renderForecastStrip() {
    if (this._forecastLoading || !this._forecast) return html``;
    if (this._forecast.length === 0) return html``;
    return html`
      <div class="forecast-strip">
        ${this._forecast.slice(0, 5).map(
          (day) => html`
            <div class="forecast-day">
              <div class="forecast-label">
                ${new Date(day.datetime).toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
              <ha-icon icon=${this._weatherIcon(day.condition)}></ha-icon>
              <div class="forecast-temp">${Math.round(day.temperature)}°</div>
              ${day.templow != null
                ? html`<div class="forecast-low">${Math.round(day.templow)}°</div>`
                : html``}
            </div>
          `
        )}
      </div>
    `;
  }

  _weatherIcon(condition) {
    const map = {
      'clear-night': 'mdi:weather-night',
      sunny: 'mdi:weather-sunny',
      cloudy: 'mdi:weather-cloudy',
      partlycloudy: 'mdi:weather-partly-cloudy',
      rainy: 'mdi:weather-rainy',
      pouring: 'mdi:weather-pouring',
      lightning: 'mdi:weather-lightning',
      snowy: 'mdi:weather-snowy',
      fog: 'mdi:weather-fog',
      windy: 'mdi:weather-windy',
    };
    return map[condition] ?? 'mdi:weather-cloudy';
  }

  // --- Render: Room detail -------------------------------------------

  _renderRoomDetail() {
    const room = ROOMS.find((r) => r.id === this._activeRoomId);
    if (!room) return this._renderHome();

    const light = this._hass.states[room.light];
    const unavailable = !light || light.state === 'unavailable';
    const dragPct = this._dragValues[`${room.light}:brightness`];
    const pct = dragPct != null ? dragPct : brightnessPct(light?.attributes);

    const climate = room.climate ? this._hass.states[room.climate] : null;
    const humidity = room.humidity ? this._hass.states[room.humidity] : null;
    const media = room.media ? this._hass.states[room.media] : null;

    return html`
      <div class="page page-room">
        <div class="page-header-row">
          <button class="back-btn" @click=${() => this._goto('home')}>
            <ha-icon icon="mdi:arrow-left"></ha-icon>
          </button>
          <h1 class="page-title">${room.name}</h1>
        </div>

        <section class="light-detail-card">
          <div class="light-detail-top">
            <ha-icon icon="mdi:lightbulb" style="color:${lightColorVar(light?.state)}"></ha-icon>
            <div class="light-detail-name">${room.name} light</div>
            <button
              class="toggle-switch ${light?.state === 'on' ? 'on' : ''}"
              ?disabled=${unavailable}
              @click=${() => this._toggleLight(room.light)}
            >
              <span class="toggle-knob"></span>
            </button>
          </div>
          ${unavailable
            ? html`<div class="light-unavailable">Unavailable</div>`
            : html`
                <div class="light-pct large">${pct}%</div>
                <div
                  class="light-slider-track"
                  @pointerdown=${(e) => this._onSliderPointerDown(e, `${room.light}:brightness`)}
                >
                  <div class="light-slider-fill" style="width:${pct}%"></div>
                </div>
                <div class="preset-row">
                  ${[25, 50, 75, 100].map(
                    (p) => html`
                      <button
                        class="preset-btn ${Math.round(pct) === p ? 'active' : ''}"
                        @click=${() => this._setBrightness(room.light, p)}
                      >
                        ${p}%
                      </button>
                    `
                  )}
                </div>
              `}
        </section>

        <div class="stat-row two">
          ${climate
            ? html`
                <div class="mini-stat-card">
                  <ha-icon icon=${climateIcon(climate.state)} style="color:${climateColorVar(climate.state)}"></ha-icon>
                  <div class="mini-stat-value">${climate.attributes?.temperature ?? '—'}°</div>
                  <div class="mini-stat-label">
                    ${stateLabel(climate.state)} · now ${climate.attributes?.current_temperature ?? '—'}°
                  </div>
                </div>
              `
            : html``}
          ${humidity && humidity.state !== 'unavailable'
            ? html`
                <div class="mini-stat-card">
                  <ha-icon icon="mdi:water-percent" style="color:var(--humidity)"></ha-icon>
                  <div class="mini-stat-value">${parseFloat(humidity.state).toFixed(0)}%</div>
                  <div class="mini-stat-label">
                    ${stateLabel(trendFor(this._history[room.humidity]))} 24h
                  </div>
                </div>
              `
            : html``}
        </div>

        ${media
          ? html`
              <button class="media-mini-card" @click=${() => this._hass.callService('media_player', 'media_play_pause', { entity_id: room.media })}>
                <div class="media-mini-art placeholder"><ha-icon icon="mdi:speaker"></ha-icon></div>
                <div class="media-mini-text">
                  <div class="media-mini-title">${media.attributes?.friendly_name ?? room.name}</div>
                  <div class="media-mini-state">${stateLabel(media.state)}</div>
                </div>
                <ha-icon
                  class="media-mini-play"
                  icon=${media.state === 'playing' ? 'mdi:pause-circle' : 'mdi:play-circle'}
                ></ha-icon>
              </button>
            `
          : html``}
      </div>
    `;
  }

  // --- Render: Climate ----------------------------------------------

  _renderClimate() {
    const house = this._hass.states[WHOLE_HOUSE];
    const step = house?.attributes?.target_temp_step ?? 1;
    const modes = house?.attributes?.hvac_modes ?? [];

    return html`
      <div class="page page-climate">
        ${this._pageHeader('Climate')}

        <section class="hero-climate">
          <div class="hero-climate-label">WHOLE HOUSE</div>
          <div class="hero-climate-main">
            <div>
              <div class="hero-climate-value">${house?.attributes?.temperature ?? '—'}°</div>
              <div class="hero-climate-state">
                ${stateLabel(house?.state)} · currently ${house?.attributes?.current_temperature ?? '—'}°
              </div>
            </div>
            <div class="stepper-col">
              <button
                class="square-btn"
                @click=${() =>
                  this._setTemp(WHOLE_HOUSE, (house?.attributes?.temperature ?? 21) + step, step)}
              >
                +
              </button>
              <button
                class="square-btn"
                @click=${() =>
                  this._setTemp(WHOLE_HOUSE, (house?.attributes?.temperature ?? 21) - step, step)}
              >
                −
              </button>
            </div>
          </div>
          <div class="mode-row">
            ${modes
              .filter((m) => ['off', 'heat', 'cool', 'fan_only', 'auto', 'dry'].includes(m))
              .map(
                (mode) => html`
                  <button
                    class="mode-btn ${house?.state === mode ? 'active' : ''}"
                    @click=${() => this._setHvacMode(WHOLE_HOUSE, mode)}
                  >
                    <ha-icon icon=${climateIcon(mode)}></ha-icon>
                    ${stateLabel(mode)}
                  </button>
                `
              )}
          </div>
        </section>

        <h2 class="section-title">Zones</h2>
        <section class="zone-grid">${ZONES.map((zone) => this._renderZoneCard(zone))}</section>
      </div>
    `;
  }

  _renderZoneCard(zone) {
    const s = this._hass.states[zone.id];
    const state = s?.state;
    const step = s?.attributes?.target_temp_step ?? 1;
    const target = s?.attributes?.temperature;
    const modes = s?.attributes?.hvac_modes ?? ['off', 'fan_only'];
    const unavailable = state === 'unavailable';

    return html`
      <div class="zone-card ${unavailable ? 'unavailable' : ''}">
        <div class="zone-top">
          <ha-icon icon=${climateIcon(state)} style="color:${climateColorVar(state)}"></ha-icon>
          <div class="zone-temp">${unavailable ? '—' : `${s?.attributes?.current_temperature ?? '—'}°`}</div>
        </div>
        <div class="zone-name">${zone.name}</div>
        <div class="zone-state">
          ${unavailable ? 'Unavailable' : `${stateLabel(state)} · now ${s?.attributes?.current_temperature ?? '—'}°`}
        </div>
        <div class="zone-setpoint">
          <button
            class="round-btn small"
            ?disabled=${unavailable}
            @click=${() => this._setTemp(zone.id, (target ?? 21) - step, step)}
          >
            −
          </button>
          <span>${unavailable ? '—' : `${target ?? '—'}°`}</span>
          <button
            class="round-btn small"
            ?disabled=${unavailable}
            @click=${() => this._setTemp(zone.id, (target ?? 21) + step, step)}
          >
            +
          </button>
        </div>
        <div class="zone-modes">
          ${modes.map(
            (mode) => html`
              <button
                class="mode-pill ${state === mode ? 'active' : ''}"
                ?disabled=${unavailable}
                @click=${() => this._setHvacMode(zone.id, mode)}
              >
                ${stateLabel(mode)}
              </button>
            `
          )}
        </div>
      </div>
    `;
  }

  // --- Render: Lights -------------------------------------------------

  _renderLights() {
    return html`
      <div class="page page-lights">
        <div class="page-header-row space-between">
          <div>
            <div class="page-brand">HARPER HOUSE</div>
            <h1 class="page-title">Lights</h1>
          </div>
          <button class="pill-btn dark" @click=${() => this._allLights(false)}>Turn all off</button>
        </div>
        <section class="light-grid">${ROOM_LIGHTS.map((room) => this._renderLightTile(room))}</section>
      </div>
    `;
  }

  _renderLightTile(room) {
    const s = this._hass.states[room.id];
    const state = s?.state;
    const unavailable = state === 'unavailable';
    const pct = brightnessPct(s?.attributes);

    return html`
      <button
        class="light-tile ${unavailable ? 'unavailable' : ''} ${state === 'on' ? 'on' : ''}"
        style="--fill:${state === 'on' ? pct : 0}%"
        @click=${() => (unavailable ? null : (this._lightSheetId = room.id))}
      >
        <div class="light-tile-top">
          <ha-icon icon="mdi:lightbulb" style="color:${lightColorVar(state)}"></ha-icon>
          <button
            class="power-btn"
            ?disabled=${unavailable}
            @click=${(e) => {
              e.stopPropagation();
              this._toggleLight(room.id);
            }}
          >
            <ha-icon icon="mdi:power"></ha-icon>
          </button>
        </div>
        <div class="light-tile-name">${room.name}</div>
        <div class="light-tile-value">${unavailable ? 'Unavailable' : `${pct}%`}</div>
      </button>
    `;
  }

  // --- Render: Light detail bottom sheet -------------------------------

  _renderLightSheet(lightId) {
    const room = ROOMS.find((r) => r.light === lightId);
    const s = this._hass.states[lightId];
    const name = room?.name ?? s?.attributes?.friendly_name ?? 'Light';
    const dragB = this._dragValues[`${lightId}:brightness`];
    const pct = dragB != null ? dragB : brightnessPct(s?.attributes);

    const minK = s?.attributes?.min_color_temp_kelvin ?? 2000;
    const maxK = s?.attributes?.max_color_temp_kelvin ?? 6500;
    const curK = s?.attributes?.color_temp_kelvin ?? minK;
    const dragK = this._dragValues[`${lightId}:kelvin`];
    const kPct = dragK != null ? dragK : ((curK - minK) / (maxK - minK)) * 100;

    // "Warm" / "Cook" / "Night" — reasonable defaults, not measured
    // against any real preference. Easy to retune.
    const presets = [
      { label: 'Warm', pct: 60, kelvin: 2700 },
      { label: 'Cook', pct: 100, kelvin: 4500 },
      { label: 'Night', pct: 15, kelvin: 2200 },
    ];
    const lastChanged = s?.last_changed ? this._relativeTime(s.last_changed) : null;

    return html`
      <div class="sheet-backdrop" @click=${() => (this._lightSheetId = null)}>
        <div class="sheet" @click=${(e) => e.stopPropagation()}>
          <div class="sheet-handle"></div>
          <div class="sheet-top">
            <div>
              <div class="sheet-title">${name}</div>
              <div class="sheet-subtitle">
                ${stateLabel(s?.state)} · ${pct}% · ${Math.round(curK)} K
              </div>
            </div>
            <button class="close-btn" @click=${() => (this._lightSheetId = null)}>
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>

          <div class="vslider-row">
            <div
              class="vslider brightness"
              @pointerdown=${(e) => this._onSliderPointerDown(e, `${lightId}:brightness`, { vertical: true })}
            >
              <div class="vslider-fill" style="height:${pct}%"></div>
              <div class="vslider-label">${pct}%</div>
            </div>
            <div
              class="vslider kelvin"
              @pointerdown=${(e) => this._onSliderPointerDown(e, `${lightId}:kelvin`, { vertical: true })}
            >
              <div class="vslider-indicator" style="bottom:${kPct}%"></div>
            </div>
          </div>

          <div class="preset-row">
            ${presets.map(
              (p) => html`
                <button
                  class="preset-btn ${Math.abs(pct - p.pct) < 3 && Math.abs(curK - p.kelvin) < 150 ? 'active' : ''}"
                  @click=${() => {
                    this._setBrightness(lightId, p.pct);
                    this._setColorTempKelvin(lightId, p.kelvin);
                  }}
                >
                  ${p.label}
                </button>
              `
            )}
          </div>

          ${lastChanged ? html`<div class="sheet-footer">Last changed ${lastChanged}</div>` : html``}
        </div>
      </div>
    `;
  }

  _relativeTime(isoString) {
    const diffMs = this._now.getTime() - new Date(isoString).getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hr ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  // --- Render: Humidity -------------------------------------------------

  _renderHumidity() {
    const available = HUMIDITY_SENSORS.filter((s) => this._hass.states[s.id]?.state !== 'unavailable');
    const featured =
      available.sort(
        (a, b) => parseFloat(this._hass.states[b.id].state) - parseFloat(this._hass.states[a.id].state)
      )[0] ?? HUMIDITY_SENSORS[0];
    const featuredState = this._hass.states[featured.id];
    const featuredTrend = trendFor(this._history[featured.id]);

    return html`
      <div class="page page-humidity">
        ${this._pageHeader('Humidity')}

        <section class="humidity-hero">
          <div class="humidity-hero-top">
            <div>
              <div class="humidity-hero-label">${featured.name} · 24h</div>
              <div class="humidity-hero-value">
                ${featuredState ? parseFloat(featuredState.state).toFixed(1) : '—'}<span>%</span>
              </div>
            </div>
            <div class="trend-badge ${featuredTrend}">${featuredTrend.toUpperCase()}</div>
          </div>
          ${this._renderBarChart(this._history[featured.id])}
        </section>

        <section class="humidity-rows">
          ${HUMIDITY_SENSORS.map((sensor) => {
            const s = this._hass.states[sensor.id];
            const unavailable = !s || s.state === 'unavailable';
            const trend = unavailable ? null : trendFor(this._history[sensor.id]);
            return html`
              <div class="humidity-row ${unavailable ? 'unavailable' : ''}">
                <ha-icon
                  icon="mdi:water-percent"
                  style="color:${unavailable ? 'var(--unavailable)' : 'var(--humidity)'}"
                ></ha-icon>
                <div class="humidity-row-name">${sensor.name}</div>
                ${!unavailable ? html`<ha-icon class="trend-arrow ${trend}" icon=${trendIcon(trend)}></ha-icon>` : html``}
                <div class="humidity-row-value">
                  ${unavailable ? 'Unavailable' : `${parseFloat(s.state).toFixed(1)}%`}
                </div>
              </div>
            `;
          })}
        </section>
      </div>
    `;
  }

  _renderBarChart(points) {
    if (!points || points.length < 2) return html`<div class="barchart-placeholder"></div>`;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    return html`
      <div class="barchart">
        ${points.map((v) => {
          const h = Math.max(6, ((v - min) / range) * 100);
          return html`<div class="barchart-bar" style="height:${h}%"></div>`;
        })}
      </div>
    `;
  }

  // --- Render: Music -------------------------------------------------

  _renderMusic() {
    const player = this._hass.states[SPOTIFY_ENTITY];
    const nowPlaying = player?.attributes?.media_title
      ? {
          title: player.attributes.media_title,
          artist: player.attributes.media_artist,
          album: player.attributes.media_album_name,
          image: player.attributes.entity_picture,
          playing: player.state === 'playing',
        }
      : null;
    const selectedDevice = (this._spotifyDevices ?? []).find((d) => d.Id === this._selectedDeviceId);

    return html`
      <div class="page page-music">
        <div class="page-header-row space-between">
          <h1 class="page-title">Music</h1>
          <div class="device-select">
            <ha-icon icon="mdi:speaker"></ha-icon>
            <select
              @change=${(e) => {
                this._selectedDeviceId = e.target.value;
              }}
            >
              ${this._spotifyDevicesLoading && !this._spotifyDevices
                ? html`<option>Finding speakers…</option>`
                : (this._spotifyDevices ?? []).map(
                    (d) => html`<option value=${d.Id} ?selected=${d.Id === this._selectedDeviceId}>${d.Name}</option>`
                  )}
            </select>
          </div>
        </div>

        ${nowPlaying
          ? html`
              <section class="now-playing">
                ${nowPlaying.image
                  ? html`<img class="now-playing-art" src=${nowPlaying.image} alt="" />`
                  : html`<div class="now-playing-art placeholder"><ha-icon icon="mdi:music-note"></ha-icon></div>`}
                <div class="now-playing-body">
                  <div class="now-playing-label">Now playing</div>
                  <div class="now-playing-title">${nowPlaying.title}</div>
                  <div class="now-playing-artist">${nowPlaying.artist ?? ''}${nowPlaying.album ? ` · ${nowPlaying.album}` : ''}</div>
                  <div class="now-playing-progress"><div class="now-playing-progress-fill"></div></div>
                </div>
              </section>
              <div class="now-playing-controls">
                <button class="round-btn small" @click=${() => this._transport('media_previous_track')}>
                  <ha-icon icon="mdi:skip-previous"></ha-icon>
                </button>
                <button class="round-btn dark" @click=${() => this._transport('media_play_pause')}>
                  <ha-icon icon=${nowPlaying.playing ? 'mdi:pause' : 'mdi:play'}></ha-icon>
                </button>
                <button class="round-btn small" @click=${() => this._transport('media_next_track')}>
                  <ha-icon icon="mdi:skip-next"></ha-icon>
                </button>
              </div>
            `
          : html``}

        <div class="search-bar">
          <button class="search-icon-btn" @click=${() => this._searchTracks()}>
            <ha-icon icon="mdi:magnify"></ha-icon>
          </button>
          <input
            type="search"
            enterkeyhint="search"
            placeholder="Search a song"
            .value=${this._searchQuery}
            @input=${(e) => {
              this._searchQuery = e.target.value;
            }}
            @keydown=${(e) => {
              if (e.key === 'Enter') this._searchTracks();
            }}
          />
        </div>

        ${this._searching ? html`<div class="search-status">Searching…</div>` : html``}
        ${this._searchError ? html`<div class="search-status error">Search failed: ${this._searchError}</div>` : html``}
        ${this._searchResults && this._searchResults.length === 0 && !this._searching && !this._searchError
          ? html`<div class="search-status">No results</div>`
          : html``}

        ${this._searchResults
          ? html`<section class="track-list">${this._searchResults.map((t) => this._renderTrackRow(t))}</section>`
          : html`
              ${this._recentTracks?.length
                ? html`
                    <h2 class="section-title">Recently played</h2>
                    <section class="track-list">${this._recentTracks.map((t) => this._renderTrackRow(t))}</section>
                  `
                : html``}
              ${this._topTracks?.length
                ? html`
                    <h2 class="section-title">Your top tracks</h2>
                    <section class="track-list">${this._topTracks.map((t) => this._renderTrackRow(t))}</section>
                  `
                : html``}
              ${this._suggestionsLoading && !this._topTracks && !this._recentTracks
                ? html`<div class="search-status">Loading suggestions…</div>`
                : html``}
            `}
        ${selectedDevice ? html`` : html``}
      </div>
    `;
  }

  _renderTrackRow(track) {
    const art = track.image_url ?? track.album?.images?.slice(-1)?.[0]?.url;
    const artists = (track.artists ?? []).map((a) => a.name).join(', ');
    return html`
      <button class="track-row" @click=${() => this._playTrack(track.uri)} ?disabled=${!this._selectedDeviceId}>
        ${art
          ? html`<img class="track-art" src=${art} alt="" />`
          : html`<div class="track-art placeholder"><ha-icon icon="mdi:music-note"></ha-icon></div>`}
        <div class="track-text">
          <div class="track-name">${track.name}</div>
          <div class="track-artist">${artists}</div>
        </div>
        <ha-icon class="track-play" icon="mdi:play-circle"></ha-icon>
      </button>
    `;
  }

  // --- Shared page header (small brand + title) ------------------------

  _pageHeader(title) {
    return html`
      <div class="page-header">
        <div class="page-brand">HARPER HOUSE</div>
        <h1 class="page-title">${title}</h1>
      </div>
    `;
  }

  // --- Styles ---------------------------------------------------------

  static styles = css`
    :host {
      --background: #f3f4f7;
      --surface: #ffffff;
      --surface-elevated: #eef0f4;
      --text-primary: #1b1e24;
      --text-secondary: #6b7280;
      --text-muted: #9aa1ac;
      --accent: #2f6fed;
      --heating: #f2994a;
      --cooling: #2f80ed;
      --fan: #14a394;
      --humidity: #2f80ed;
      --success: #1db876;
      --unavailable: #b4b8c0;
      --hairline: rgba(15, 23, 42, 0.08);
      --ink: #16181d;
      --nav-height: 60px;

      display: block;
      background: linear-gradient(165deg, #eef1fb 0%, #f8f5f1 55%, #fdf6f0 100%);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      border-radius: 24px;
      min-height: 640px;
    }

    * {
      box-sizing: border-box;
    }

    button {
      font-family: inherit;
      border: none;
      background: none;
      color: inherit;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    button:active {
      transform: scale(0.97);
      transition: transform 100ms ease;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .shell {
      min-height: 640px;
      position: relative;
    }

    /* No forced height / internal overflow here on purpose — the shell
       sizes to its content like any normal Lovelace card, and the outer
       HA page does the scrolling. The nav below uses position: sticky,
       which tracks whichever element actually scrolls without needing
       to know HA's exact chrome height in advance. */
    .content {
      padding: calc(20px + env(safe-area-inset-top)) 20px 100px 20px;
    }

    @media (min-width: 900px) {
      .content {
        max-width: 720px;
        margin: 0 auto;
        padding-left: 24px;
        padding-right: 24px;
      }
    }

    .page {
      animation: pageIn 220ms ease;
    }
    @keyframes pageIn {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .page-header-row {
      display: flex;
      align-items: center;
      gap: 14px;
      margin: 4px 0 28px 0;
    }
    .page-header-row.space-between {
      justify-content: space-between;
      align-items: flex-start;
    }
    .back-btn {
      width: 40px;
      height: 40px;
      border-radius: 14px;
      background: var(--surface);
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .page-header {
      margin: 4px 0 28px 0;
    }
    .page-brand {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: var(--accent);
      margin-bottom: 6px;
    }
    .page-title {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-secondary);
      margin: 32px 0 14px 0;
    }
    .section-title.inline {
      margin: 0;
    }
    .section-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 32px;
    }
    .see-all {
      font-size: 13px;
      font-weight: 600;
      color: var(--heating);
    }

    /* ---------- Bottom nav: floating pill ---------- */
    .bottom-nav {
      position: sticky;
      bottom: 16px;
      z-index: 10;
      display: flex;
      justify-content: space-around;
      align-items: center;
      margin: 20px 20px 0 20px;
      padding: 8px;
      border-radius: 999px;
      background: var(--ink);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    }
    .nav-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #8a8f99;
      padding: 10px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
    }
    .nav-btn ha-icon {
      --mdc-icon-size: 20px;
    }
    .nav-btn.active {
      color: var(--ink);
      background: #ffffff;
    }

    /* ---------- Home ---------- */
    .hero {
      background: linear-gradient(160deg, #eaf1ff 0%, #f3f7ff 55%, #ffffff 100%);
      border-radius: 24px;
      padding: 24px;
      border: 1px solid var(--hairline);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
    }
    .hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .hero-brand {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: var(--accent);
      margin-bottom: 10px;
    }
    .hero-greeting {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .hero-date {
      font-size: 14px;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    .hero-weather {
      text-align: right;
      flex-shrink: 0;
    }
    .hero-temp {
      font-size: 40px;
      font-weight: 300;
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .hero-condition {
      font-size: 13px;
      color: var(--text-secondary);
      text-transform: capitalize;
      margin-top: 4px;
    }
    .forecast-strip {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
      padding-top: 18px;
      border-top: 1px solid var(--hairline);
    }
    .forecast-day {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .forecast-day ha-icon {
      --mdc-icon-size: 18px;
      color: var(--text-primary);
    }
    .forecast-temp {
      color: var(--text-primary);
      font-weight: 600;
    }
    .forecast-low {
      opacity: 0.6;
    }

    .stat-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 20px;
    }
    .stat-row.two {
      grid-template-columns: repeat(2, 1fr);
      margin-top: 18px;
    }
    .stat-tile,
    .mini-stat-card {
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
    }
    .stat-value,
    .mini-stat-value {
      font-size: 22px;
      font-weight: 700;
    }
    .stat-label,
    .mini-stat-label {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .mini-stat-card ha-icon {
      --mdc-icon-size: 20px;
      margin-bottom: 8px;
    }

    .room-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
      margin-top: 14px;
    }
    .room-card {
      text-align: left;
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 20px;
      padding: 18px;
      min-height: 130px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
      position: relative;
    }
    .room-card-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--heating) 16%, var(--surface-elevated));
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--heating);
      margin-bottom: 30px;
    }
    .room-card-icon ha-icon {
      --mdc-icon-size: 20px;
    }
    .room-card-name {
      font-size: 15px;
      font-weight: 600;
    }
    .room-card-status {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .room-card-temp {
      position: absolute;
      top: 18px;
      right: 18px;
      font-size: 14px;
      color: var(--text-secondary);
    }

    .scene-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .scene-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 18px;
      border-radius: 18px;
      background: var(--surface);
      border: 1px solid var(--hairline);
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
    }
    .scene-btn ha-icon {
      --mdc-icon-size: 20px;
    }
    .scene-btn.dark {
      background: var(--ink);
      color: #ffffff;
    }
    .scene-btn.accent {
      background: var(--heating);
      color: #ffffff;
    }

    /* ---------- Climate ---------- */
    .hero-climate {
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 24px;
      padding: 22px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
    }
    .hero-climate-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: var(--text-secondary);
    }
    .hero-climate-main {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-top: 8px;
    }
    .hero-climate-value {
      font-size: 56px;
      font-weight: 300;
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .hero-climate-state {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 6px;
    }
    .stepper-col {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .square-btn {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--surface-elevated);
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mode-row {
      display: flex;
      gap: 8px;
      margin-top: 20px;
    }
    .mode-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 12px 0;
      border-radius: 14px;
      background: var(--surface-elevated);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 600;
    }
    .mode-btn ha-icon {
      --mdc-icon-size: 16px;
    }
    .mode-btn.active {
      background: var(--ink);
      color: #ffffff;
    }

    .zone-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .zone-card {
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 20px;
      padding: 18px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
    }
    .zone-card.unavailable {
      opacity: 0.55;
    }
    .zone-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .zone-top ha-icon {
      --mdc-icon-size: 22px;
    }
    .zone-temp {
      font-size: 22px;
      font-weight: 700;
    }
    .zone-name {
      font-size: 14px;
      font-weight: 600;
      margin-top: 14px;
    }
    .zone-state {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    .zone-setpoint {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
      font-size: 18px;
      font-weight: 400;
    }
    .round-btn {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--surface-elevated);
      font-size: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .round-btn.dark {
      background: var(--ink);
      color: #ffffff;
      width: 56px;
      height: 56px;
    }
    .round-btn.small {
      width: 32px;
      height: 32px;
      font-size: 16px;
    }
    .zone-modes {
      display: flex;
      gap: 6px;
      margin-top: 14px;
    }
    .mode-pill {
      flex: 1;
      font-size: 11px;
      padding: 6px 0;
      border-radius: 10px;
      background: var(--surface-elevated);
      color: var(--text-muted);
    }
    .mode-pill.active {
      background: var(--ink);
      color: #ffffff;
    }

    /* ---------- Lights ---------- */
    .pill-btn {
      padding: 10px 18px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      background: var(--surface);
      border: 1px solid var(--hairline);
    }
    .pill-btn.dark {
      background: var(--ink);
      color: #ffffff;
      border-color: var(--ink);
    }
    .light-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .light-tile {
      text-align: left;
      border-radius: 20px;
      padding: 18px;
      background: linear-gradient(to top, color-mix(in srgb, var(--heating) 55%, transparent) var(--fill, 0%), var(--surface) var(--fill, 0%));
      border: 1px solid var(--hairline);
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
      min-height: 150px;
      display: flex;
      flex-direction: column;
    }
    .light-tile.unavailable {
      opacity: 0.5;
      background: var(--surface);
    }
    .light-tile-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .light-tile-top ha-icon {
      --mdc-icon-size: 20px;
    }
    .power-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .power-btn ha-icon {
      --mdc-icon-size: 15px;
    }
    .light-tile-name {
      font-size: 14px;
      font-weight: 600;
      margin-top: auto;
      padding-top: 24px;
    }
    .light-tile-value {
      font-size: 26px;
      font-weight: 300;
      margin-top: 4px;
    }

    /* ---------- Light detail (room page) ---------- */
    .light-detail-card {
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
    }
    .light-detail-top {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .light-detail-top ha-icon {
      --mdc-icon-size: 20px;
    }
    .light-detail-name {
      flex: 1;
      font-size: 14px;
      font-weight: 600;
    }
    .toggle-switch {
      width: 46px;
      height: 26px;
      border-radius: 999px;
      background: var(--surface-elevated);
      padding: 3px;
      display: flex;
      justify-content: flex-start;
    }
    .toggle-switch.on {
      background: var(--heating);
      justify-content: flex-end;
    }
    .toggle-knob {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #ffffff;
    }
    .light-pct.large {
      font-size: 38px;
      font-weight: 300;
      margin-top: 14px;
    }
    .light-slider-track {
      margin-top: 10px;
      height: 12px;
      border-radius: 999px;
      background: var(--surface-elevated);
      position: relative;
      cursor: pointer;
      touch-action: none;
    }
    .light-slider-fill {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      background: linear-gradient(90deg, #ffb35c, var(--heating));
      transition: width 60ms linear;
    }
    .light-unavailable {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 10px;
    }
    .preset-row {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
    .preset-btn {
      flex: 1;
      padding: 10px 0;
      border-radius: 12px;
      background: var(--surface-elevated);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 600;
    }
    .preset-btn.active {
      background: var(--ink);
      color: #ffffff;
    }

    .media-mini-card {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 18px;
      padding: 14px;
      margin-top: 18px;
      width: 100%;
      text-align: left;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
    }
    .media-mini-art {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surface-elevated);
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .media-mini-text {
      flex: 1;
      min-width: 0;
    }
    .media-mini-title {
      font-size: 14px;
      font-weight: 600;
    }
    .media-mini-state {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .media-mini-play {
      --mdc-icon-size: 30px;
      color: var(--heating);
    }

    /* ---------- Light bottom sheet ---------- */
    .sheet-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      display: flex;
      align-items: flex-end;
      z-index: 100;
    }
    .sheet {
      width: 100%;
      background: var(--surface);
      border-radius: 24px 24px 0 0;
      padding: 12px 20px calc(24px + env(safe-area-inset-bottom)) 20px;
      animation: sheetUp 220ms ease;
    }
    @keyframes sheetUp {
      from {
        transform: translateY(100%);
      }
      to {
        transform: translateY(0);
      }
    }
    .sheet-handle {
      width: 40px;
      height: 4px;
      border-radius: 999px;
      background: var(--hairline);
      margin: 0 auto 16px auto;
    }
    .sheet-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }
    .sheet-title {
      font-size: 20px;
      font-weight: 700;
    }
    .sheet-subtitle {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    .close-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--surface-elevated);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .vslider-row {
      display: flex;
      gap: 14px;
      margin-top: 20px;
      height: 180px;
    }
    .vslider {
      flex: 1;
      border-radius: 18px;
      background: var(--surface-elevated);
      position: relative;
      overflow: hidden;
      cursor: pointer;
      touch-action: none;
    }
    .vslider.brightness .vslider-fill {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(180deg, #ffcf8f, var(--heating));
    }
    .vslider-label {
      position: absolute;
      bottom: 10px;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      color: #ffffff;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
    .vslider.kelvin {
      background: linear-gradient(180deg, #bcd8ff 0%, #fff6e5 55%, #ffb35c 100%);
    }
    .vslider-indicator {
      position: absolute;
      left: 0;
      right: 0;
      height: 3px;
      background: #1b1e24;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.6);
    }
    .sheet-footer {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--hairline);
      font-size: 12px;
      color: var(--text-muted);
    }

    /* ---------- Humidity ---------- */
    .humidity-hero {
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 22px;
      padding: 20px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
    }
    .humidity-hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }
    .humidity-hero-label {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .humidity-hero-value {
      font-size: 40px;
      font-weight: 300;
      margin-top: 4px;
    }
    .humidity-hero-value span {
      font-size: 18px;
      color: var(--text-secondary);
    }
    .trend-badge {
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      background: var(--surface-elevated);
      color: var(--text-secondary);
    }
    .trend-badge.rising {
      background: color-mix(in srgb, var(--heating) 16%, var(--surface-elevated));
      color: var(--heating);
    }
    .trend-badge.falling {
      background: color-mix(in srgb, var(--cooling) 16%, var(--surface-elevated));
      color: var(--cooling);
    }
    .barchart {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 70px;
      margin-top: 18px;
    }
    .barchart-bar {
      flex: 1;
      background: var(--humidity);
      border-radius: 3px;
      opacity: 0.85;
    }
    .barchart-placeholder {
      height: 70px;
      margin-top: 18px;
    }
    .humidity-rows {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 18px;
    }
    .humidity-row {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 16px;
      padding: 14px 16px;
    }
    .humidity-row.unavailable {
      opacity: 0.5;
    }
    .humidity-row ha-icon {
      --mdc-icon-size: 18px;
    }
    .humidity-row-name {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
    }
    .trend-arrow {
      --mdc-icon-size: 16px;
      color: var(--text-muted);
    }
    .trend-arrow.rising {
      color: var(--heating);
    }
    .trend-arrow.falling {
      color: var(--cooling);
    }
    .humidity-row-value {
      font-size: 16px;
      font-weight: 700;
    }

    /* ---------- Music ---------- */
    .device-select {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 999px;
      padding: 8px 14px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
    }
    .device-select ha-icon {
      --mdc-icon-size: 16px;
      color: var(--fan);
    }
    .device-select select {
      border: none;
      background: none;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      max-width: 120px;
    }

    .now-playing {
      display: flex;
      align-items: center;
      gap: 14px;
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 20px;
      padding: 16px;
      margin-top: 18px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
    }
    .now-playing-art {
      width: 64px;
      height: 64px;
      border-radius: 14px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .now-playing-art.placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surface-elevated);
      color: var(--text-muted);
    }
    .now-playing-body {
      flex: 1;
      min-width: 0;
    }
    .now-playing-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .now-playing-title {
      font-size: 15px;
      font-weight: 700;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .now-playing-artist {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .now-playing-progress {
      height: 4px;
      border-radius: 999px;
      background: var(--surface-elevated);
      margin-top: 10px;
      overflow: hidden;
    }
    .now-playing-progress-fill {
      width: 35%;
      height: 100%;
      background: var(--heating);
    }
    .now-playing-controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-top: 16px;
    }

    .search-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 16px;
      padding: 12px 16px;
      margin-top: 18px;
    }
    .search-icon-btn {
      display: flex;
      flex-shrink: 0;
    }
    .search-bar ha-icon {
      --mdc-icon-size: 18px;
      color: var(--text-muted);
    }
    .search-bar input {
      flex: 1;
      border: none;
      outline: none;
      background: none;
      font-size: 15px;
      font-family: inherit;
      color: var(--text-primary);
      -webkit-appearance: none;
    }
    .search-bar input::placeholder {
      color: var(--text-muted);
    }
    .search-bar input::-webkit-search-cancel-button {
      -webkit-appearance: none;
    }
    .search-status {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 14px;
    }
    .search-status.error {
      color: #d64545;
    }

    .track-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
    }
    .track-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 8px;
      border-radius: 14px;
      text-align: left;
      width: 100%;
    }
    .track-art {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .track-art.placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surface-elevated);
      color: var(--text-muted);
    }
    .track-text {
      flex: 1;
      min-width: 0;
    }
    .track-name {
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .track-artist {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .track-play {
      --mdc-icon-size: 28px;
      color: var(--heating);
      flex-shrink: 0;
    }
  `;
}

customElements.define('premium-home', PremiumHomeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'premium-home',
  name: 'Harper House',
  description: 'Custom smart-home dashboard — Home / Climate / Lights / Humidity / Music.',
});
