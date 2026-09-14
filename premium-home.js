// Premium Home — a custom Lovelace card for Home Assistant.
//
// Registers as `custom:premium-home`. Renders its own internal app shell
// (Home / Climate / Lights / Humidity) with a bottom nav bar — navigation
// never touches HA's own view/dashboard routing, it's a plain internal
// `_page` property swap, so switching pages is instant and never reloads
// anything.
//
// No build step: Lit is imported from a pinned CDN version below. No
// fake data anywhere — every value comes from `this.hass.states[...]`,
// `weather.get_forecasts`, or the HA history API, fetched live.
//
// Drop this file at: /config/www/premium-home/premium-home.js
// Then it's served by HA at: /local/premium-home/premium-home.js

import {
  LitElement,
  html,
  css,
} from 'https://cdn.jsdelivr.net/npm/lit@3.3.3/+esm';

// ---------------------------------------------------------------------
// Entity configuration — the one place to edit if rooms/sensors change.
// Pulled live from GET /api/states on 2026-09-14, not guessed.
// ---------------------------------------------------------------------

const WHOLE_HOUSE = 'climate.house';

const ZONES = [
  { id: 'climate.living', name: 'Living Room' },
  { id: 'climate.master', name: 'Bedroom' },
  { id: 'climate.study', name: 'Study' },
  { id: 'climate.arlo', name: "Arlo's Room" },
];

const ROOM_LIGHTS = [
  { id: 'light.kitchen', name: 'Kitchen' },
  { id: 'light.living_room_lights', name: 'Living Room' },
  { id: 'light.ikea_of_sweden_tradfri_bulb_e27_cws_globe_806lm_2', name: "Arlo's Room" },
  { id: 'light.ikea_of_sweden_tradfri_bulb_e27_cws_globe_806lm_4', name: 'Study' },
  { id: 'light.bedroom_2', name: 'Bedroom' },
];

const HUMIDITY_SENSORS = [
  { id: 'sensor.sonoff_snzb_02d_humidity_3', name: 'Living Room' },
  { id: 'sensor.sonoff_snzb_02d_humidity_2', name: 'Bedroom' },
  { id: 'sensor.sonoff_snzb_02d_humidity', name: 'Study' },
  { id: 'sensor.sonoff_snzb_02d_humidity_4', name: "Arlo's Room" },
  { id: 'sensor.tze200_vs0skpuc_ts0601_humidity', name: 'Under the House' },
  { id: 'sensor.tze284_vvmbj46n_ts0601_humidity', name: 'Outside' },
];

const WEATHER_ENTITY = 'weather.forecast_home';

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

function humidityColor() {
  return 'var(--humidity)';
}

function brightnessPct(attrs) {
  if (attrs == null || attrs.brightness == null) return 0;
  return Math.round((attrs.brightness / 255) * 100);
}

// ---------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------

class PremiumHomeCard extends LitElement {
  static properties = {
    _page: { state: true },
    _forecast: { state: true },
    _forecastLoading: { state: true },
    _history: { state: true },
    _now: { state: true },
    _dragBrightness: { state: true },
  };

  constructor() {
    super();
    this._page = 'home';
    this._forecast = null;
    this._forecastLoading = false;
    this._history = {};
    this._now = new Date();
    this._dragBrightness = {};
    this._hass = null;
    this._forecastInterval = null;
    this._clockInterval = null;
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

  _goto(page) {
    this._page = page;
    if (page === 'humidity') {
      HUMIDITY_SENSORS.forEach((s) => this._fetchHistory(s.id));
    }
  }

  // --- Brightness slider (custom drag control) -------------------------

  _onSliderPointerDown(ev, entityId) {
    ev.preventDefault();
    const track = ev.currentTarget;
    const update = (clientX) => {
      const rect = track.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(0, Math.min(100, pct));
      this._dragBrightness = { ...this._dragBrightness, [entityId]: clamped };
    };
    update(ev.clientX);

    const onMove = (e) => update(e.clientX);
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const finalPct = this._dragBrightness[entityId];
      if (finalPct != null) this._setBrightness(entityId, finalPct);
      // Clear the local drag override shortly after — the real state
      // update from HA will have arrived by then and takes over.
      setTimeout(() => {
        const next = { ...this._dragBrightness };
        delete next[entityId];
        this._dragBrightness = next;
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
    ];
    return html`
      <nav class="bottom-nav">
        ${items.map(
          (item) => html`
            <button
              class="nav-btn ${this._page === item.id ? 'active' : ''}"
              @click=${() => this._goto(item.id)}
            >
              <ha-icon icon=${item.icon}></ha-icon>
              <span>${item.label}</span>
            </button>
          `
        )}
      </nav>
    `;
  }

  // --- Render: Home -------------------------------------------------

  _renderHome() {
    const weather = this._hass.states[WEATHER_ENTITY];
    const houseState = this._hass.states[WHOLE_HOUSE];
    const userName = this._hass.user?.name;

    const roomsOn = ROOM_LIGHTS.filter(
      (l) => this._hass.states[l.id]?.state === 'on'
    ).length;
    const availableHumidity = HUMIDITY_SENSORS.filter(
      (s) => this._hass.states[s.id]?.state !== 'unavailable'
    ).length;

    return html`
      <div class="page page-home">
        <section class="hero">
          <div class="hero-text">
            <div class="hero-greeting">
              ${greeting(this._now)}${userName ? html`, ${userName}` : ''}
            </div>
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
                ${this._renderForecastStrip()}
              `
            : html`<div class="hero-weather muted">Weather unavailable</div>`}
        </section>

        <section class="quick-actions">
          <button class="pill" @click=${() => this._allLights(true)}>
            <ha-icon icon="mdi:lightbulb-on"></ha-icon>
            All Lights On
          </button>
          <button class="pill" @click=${() => this._allLights(false)}>
            <ha-icon icon="mdi:lightbulb-off-outline"></ha-icon>
            All Lights Off
          </button>
        </section>

        <section class="summary-cards">
          <button class="summary-card" @click=${() => this._goto('climate')}>
            <ha-icon icon="mdi:thermostat" style="color:${climateColorVar(houseState?.state)}"></ha-icon>
            <div class="summary-text">
              <div class="summary-title">Climate</div>
              <div class="summary-sub">
                Whole house ${houseState?.attributes?.temperature ?? '—'}° ·
                ${stateLabel(houseState?.state)}
              </div>
            </div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>

          <button class="summary-card" @click=${() => this._goto('lights')}>
            <ha-icon icon="mdi:lightbulb-group-outline" style="color:var(--heating)"></ha-icon>
            <div class="summary-text">
              <div class="summary-title">Lights</div>
              <div class="summary-sub">${roomsOn} room${roomsOn === 1 ? '' : 's'} on</div>
            </div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>

          <button class="summary-card" @click=${() => this._goto('humidity')}>
            <ha-icon icon="mdi:water-percent" style="color:var(--humidity)"></ha-icon>
            <div class="summary-text">
              <div class="summary-title">Humidity</div>
              <div class="summary-sub">${availableHumidity} sensor${availableHumidity === 1 ? '' : 's'}</div>
            </div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>
        </section>
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
      'partlycloudy': 'mdi:weather-partly-cloudy',
      rainy: 'mdi:weather-rainy',
      pouring: 'mdi:weather-pouring',
      lightning: 'mdi:weather-lightning',
      snowy: 'mdi:weather-snowy',
      fog: 'mdi:weather-fog',
      windy: 'mdi:weather-windy',
    };
    return map[condition] ?? 'mdi:weather-cloudy';
  }

  // --- Render: Climate ----------------------------------------------

  _renderClimate() {
    const house = this._hass.states[WHOLE_HOUSE];
    const step = house?.attributes?.target_temp_step ?? 1;
    const modes = house?.attributes?.hvac_modes ?? [];

    return html`
      <div class="page page-climate">
        <h1 class="page-title">Climate</h1>

        <section class="hero-climate" style="--state-color:${climateColorVar(house?.state)}">
          <div class="hero-climate-top">
            <ha-icon icon=${climateIcon(house?.state)}></ha-icon>
            <div>
              <div class="hero-climate-name">Whole House</div>
              <div class="hero-climate-state">
                ${stateLabel(house?.state)} · Currently ${house?.attributes?.current_temperature ?? '—'}°
              </div>
            </div>
          </div>

          <div class="hero-climate-setpoint">
            <button
              class="round-btn"
              @click=${() =>
                this._setTemp(WHOLE_HOUSE, (house?.attributes?.temperature ?? 21) - step, step)}
            >
              −
            </button>
            <div class="setpoint-value">${house?.attributes?.temperature ?? '—'}°</div>
            <button
              class="round-btn"
              @click=${() =>
                this._setTemp(WHOLE_HOUSE, (house?.attributes?.temperature ?? 21) + step, step)}
            >
              +
            </button>
          </div>

          <div class="hero-climate-modes">
            ${modes.map(
              (mode) => html`
                <button
                  class="mode-chip ${house?.state === mode ? 'active' : ''}"
                  style="--mode-color:${climateColorVar(mode)}"
                  @click=${() => this._setHvacMode(WHOLE_HOUSE, mode)}
                >
                  <ha-icon icon=${climateIcon(mode)}></ha-icon>
                </button>
              `
            )}
          </div>
        </section>

        <h2 class="section-title">Zones</h2>
        <section class="zone-grid">
          ${ZONES.map((zone) => this._renderZoneCard(zone))}
        </section>
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
      <div class="zone-card ${unavailable ? 'unavailable' : ''}" style="--state-color:${climateColorVar(state)}">
        <div class="zone-top">
          <ha-icon icon=${climateIcon(state)}></ha-icon>
          <div class="zone-name">${zone.name}</div>
        </div>
        <div class="zone-state">
          ${unavailable ? 'Unavailable' : stateLabel(state)}
          ${!unavailable ? html`· ${s?.attributes?.current_temperature ?? '—'}°` : ''}
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
        <h1 class="page-title">Lights</h1>
        <section class="light-grid">
          ${ROOM_LIGHTS.map((room) => this._renderLightCard(room))}
        </section>
      </div>
    `;
  }

  _renderLightCard(room) {
    const s = this._hass.states[room.id];
    const state = s?.state;
    const unavailable = state === 'unavailable';
    const dragPct = this._dragBrightness[room.id];
    const pct = dragPct != null ? dragPct : brightnessPct(s?.attributes);

    return html`
      <div class="light-card ${unavailable ? 'unavailable' : ''} ${state === 'on' ? 'on' : ''}">
        <div class="light-top">
          <ha-icon icon="mdi:lightbulb" style="color:${lightColorVar(state)}"></ha-icon>
          <button
            class="power-btn"
            ?disabled=${unavailable}
            @click=${() => this._toggleLight(room.id)}
          >
            <ha-icon icon="mdi:power"></ha-icon>
          </button>
        </div>
        <div class="light-name">${room.name}</div>
        ${unavailable
          ? html`<div class="light-unavailable">Unavailable</div>`
          : html`
              <div class="light-pct">${pct}%</div>
              <div
                class="light-slider-track"
                @pointerdown=${(e) => this._onSliderPointerDown(e, room.id)}
              >
                <div class="light-slider-fill" style="width:${pct}%"></div>
              </div>
            `}
      </div>
    `;
  }

  // --- Render: Humidity -------------------------------------------------

  _renderHumidity() {
    return html`
      <div class="page page-humidity">
        <h1 class="page-title">Humidity</h1>
        <section class="humidity-list">
          ${HUMIDITY_SENSORS.map((sensor) => this._renderHumidityCard(sensor))}
        </section>
      </div>
    `;
  }

  _renderHumidityCard(sensor) {
    const s = this._hass.states[sensor.id];
    const unavailable = !s || s.state === 'unavailable';
    const points = this._history[sensor.id];

    return html`
      <div class="humidity-card ${unavailable ? 'unavailable' : ''}">
        <div class="humidity-top">
          <ha-icon icon="mdi:water-outline" style="color:${unavailable ? 'var(--unavailable)' : humidityColor()}"></ha-icon>
          <div class="humidity-name">${sensor.name}</div>
        </div>
        ${unavailable
          ? html`<div class="humidity-unavailable">Unavailable</div>`
          : html`
              <div class="humidity-value">${parseFloat(s.state).toFixed(1)}<span>%</span></div>
              ${this._renderSparkline(points)}
            `}
      </div>
    `;
  }

  _renderSparkline(points) {
    if (!points || points.length < 2) {
      return html`<div class="sparkline-placeholder"></div>`;
    }
    const w = 100;
    const h = 24;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const step = w / (points.length - 1);
    const coords = points
      .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
      .join(' ');
    return html`
      <svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polyline points=${coords} fill="none" stroke="var(--humidity)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }

  // --- Styles ---------------------------------------------------------

  static styles = css`
    :host {
      --background: #0b0e14;
      --surface: #151a24;
      --surface-elevated: #1c2230;
      --text-primary: #f5f6f8;
      --text-secondary: #9aa3b2;
      --text-muted: #5c6472;
      --accent: #5ac8fa;
      --heating: #ff9f45;
      --cooling: #4a90e2;
      --fan: #2dd4bf;
      --humidity: #4a90e2;
      --success: #34d399;
      --unavailable: #5c6472;
      --nav-height: 64px;

      display: block;
      background: var(--background);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      border-radius: 24px;
      overflow: hidden;
      height: 100%;
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
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 640px;
      position: relative;
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: calc(20px + env(safe-area-inset-top)) 20px
        calc(var(--nav-height) + env(safe-area-inset-bottom) + 24px) 20px;
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

    .page-title {
      font-size: 22px;
      font-weight: 600;
      margin: 4px 0 28px 0;
      letter-spacing: -0.01em;
    }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-secondary);
      margin: 36px 0 14px 0;
    }

    /* ---------- Bottom nav ---------- */
    .bottom-nav {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      justify-content: space-around;
      align-items: center;
      height: calc(var(--nav-height) + env(safe-area-inset-bottom));
      padding-bottom: env(safe-area-inset-bottom);
      background: rgba(21, 26, 36, 0.92);
      backdrop-filter: blur(16px);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    /* Fallback: if an ancestor breaks fixed positioning, this rule keeps
       the nav pinned to the bottom of the flex shell instead of floating
       away. */
    :host(:not(.js-fixed-ok)) .bottom-nav {
      position: sticky;
    }
    .nav-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      color: var(--text-muted);
      font-size: 11px;
      padding: 6px 14px;
      border-radius: 14px;
      transition: color 150ms ease;
    }
    .nav-btn ha-icon {
      --mdc-icon-size: 22px;
    }
    .nav-btn.active {
      color: var(--accent);
    }

    /* ---------- Home ---------- */
    .hero {
      background: linear-gradient(160deg, #1b2340 0%, #202a4d 60%, #16203d 100%);
      border-radius: 24px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    .hero-greeting {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .hero-date {
      font-size: 14px;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    .hero-weather {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-top: 22px;
    }
    .hero-temp {
      font-size: 44px;
      font-weight: 300;
      letter-spacing: -0.02em;
    }
    .hero-condition {
      font-size: 15px;
      color: var(--text-secondary);
      text-transform: capitalize;
    }
    .forecast-strip {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
      padding-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
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
      font-weight: 500;
    }
    .forecast-low {
      opacity: 0.6;
    }

    .quick-actions {
      display: flex;
      gap: 12px;
      margin-top: 28px;
    }
    .pill {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px;
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 18px;
      font-size: 14px;
      font-weight: 500;
    }
    .pill ha-icon {
      --mdc-icon-size: 18px;
      color: var(--heating);
    }

    .summary-cards {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-top: 28px;
    }
    .summary-card {
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 20px;
      padding: 18px 20px;
      text-align: left;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
    }
    .summary-card ha-icon:first-child {
      --mdc-icon-size: 24px;
      flex-shrink: 0;
    }
    .summary-text {
      flex: 1;
    }
    .summary-title {
      font-size: 15px;
      font-weight: 500;
    }
    .summary-sub {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .chevron {
      --mdc-icon-size: 18px;
      color: var(--text-muted);
    }

    /* ---------- Climate ---------- */
    .hero-climate {
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 24px;
      padding: 24px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }
    .hero-climate-top {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .hero-climate-top ha-icon {
      --mdc-icon-size: 28px;
      color: var(--state-color);
    }
    .hero-climate-name {
      font-size: 17px;
      font-weight: 600;
    }
    .hero-climate-state {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .hero-climate-setpoint {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 28px;
      margin: 28px 0;
    }
    .setpoint-value {
      font-size: 56px;
      font-weight: 300;
      letter-spacing: -0.02em;
      min-width: 120px;
      text-align: center;
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
    .round-btn.small {
      width: 32px;
      height: 32px;
      font-size: 16px;
    }
    .hero-climate-modes {
      display: flex;
      justify-content: center;
      gap: 10px;
    }
    .mode-chip {
      width: 40px;
      height: 40px;
      border-radius: 14px;
      background: var(--surface-elevated);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }
    .mode-chip ha-icon {
      --mdc-icon-size: 18px;
    }
    .mode-chip.active {
      background: color-mix(in srgb, var(--mode-color) 20%, var(--surface-elevated));
      color: var(--mode-color);
    }

    .zone-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .zone-card {
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 20px;
      padding: 18px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
    }
    .zone-card.unavailable {
      opacity: 0.55;
    }
    .zone-top {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .zone-top ha-icon {
      --mdc-icon-size: 18px;
      color: var(--state-color);
    }
    .zone-name {
      font-size: 14px;
      font-weight: 500;
    }
    .zone-state {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 6px;
    }
    .zone-setpoint {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
      font-size: 18px;
      font-weight: 400;
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
      background: color-mix(in srgb, var(--state-color) 22%, var(--surface-elevated));
      color: var(--state-color);
    }

    /* ---------- Lights ---------- */
    .light-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .light-card {
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
      transition: box-shadow 200ms ease;
    }
    .light-card.on {
      box-shadow: 0 4px 20px color-mix(in srgb, var(--heating) 18%, transparent);
    }
    .light-card.unavailable {
      opacity: 0.5;
    }
    .light-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .light-top > ha-icon {
      --mdc-icon-size: 20px;
    }
    .power-btn {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--surface-elevated);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .power-btn ha-icon {
      --mdc-icon-size: 16px;
    }
    .light-name {
      font-size: 14px;
      font-weight: 500;
      margin-top: 16px;
    }
    .light-pct {
      font-size: 26px;
      font-weight: 300;
      margin-top: 4px;
    }
    .light-unavailable {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 8px;
    }
    .light-slider-track {
      margin-top: 14px;
      height: 10px;
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

    /* ---------- Humidity ---------- */
    .humidity-list {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .humidity-card {
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
    }
    .humidity-card.unavailable {
      opacity: 0.5;
    }
    .humidity-top {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .humidity-top ha-icon {
      --mdc-icon-size: 18px;
    }
    .humidity-name {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .humidity-value {
      font-size: 30px;
      font-weight: 300;
      margin-top: 12px;
    }
    .humidity-value span {
      font-size: 16px;
      color: var(--text-secondary);
      margin-left: 2px;
    }
    .humidity-unavailable {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 12px;
    }
    .sparkline {
      width: 100%;
      height: 24px;
      margin-top: 12px;
      opacity: 0.8;
    }
    .sparkline-placeholder {
      height: 24px;
      margin-top: 12px;
    }
  `;
}

customElements.define('premium-home', PremiumHomeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'premium-home',
  name: 'Premium Home',
  description: 'Custom smart-home dashboard — Home / Climate / Lights / Humidity.',
});
