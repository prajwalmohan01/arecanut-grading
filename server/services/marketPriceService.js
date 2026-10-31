'use strict';

const crypto = require('crypto');
const { config } = require('../config');
const MarketPriceCache = require('../models/MarketPriceCache');

const DATA_GOV_IN_SOURCE_URL =
  'https://api.data.gov.in/resource/' + config.marketResourceId;
const PUBLIC_SOURCE_URL = 'https://agmarknet.gov.in/';
const PUBLIC_SOURCE_LABEL = 'AGMARKNET 2.0 public dashboard';
const DATA_GOV_IN_SOURCE_LABEL = 'AGMARKNET (data.gov.in)';
const MANDI_API_BASE_URL = 'https://mandi-api.onrender.com/v1';
const MANDI_API_LABEL = 'Mandi Price API (data.gov.in)';
const MARKET_SOURCES = ['agmarknet_public', 'mandi_api', 'data_gov_in'];
const AGMARKNET_HEADERS = {
  Accept: 'application/json',
  Origin: 'https://agmarknet.gov.in',
  Referer: 'https://agmarknet.gov.in/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const FILTERS_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number(config.marketFiltersCacheMinutes || 360) * 60 * 1000
);
let filtersCache = { at: 0, data: null };
let filtersPromise = null;

class MarketPriceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MarketPriceError';
    this.statusCode = options.statusCode || 503;
    this.code = options.code || 'market_unavailable';
    this.stale = Boolean(options.stale);
    this.cache = options.cache || null;
    this.expose = true;
  }
}

function apiKey() {
  return String(
    process.env.DATA_GOV_IN_API_KEY || process.env.AGMARKNET_API_KEY || ''
  ).trim();
}

function hasMarketKey() {
  return Boolean(apiKey());
}

function marketSource() {
  const configured = String(
    process.env.MARKET_PRICE_SOURCE || config.marketSource || 'agmarknet_public'
  )
    .trim()
    .toLowerCase();
  return MARKET_SOURCES.includes(configured) ? configured : 'agmarknet_public';
}

function sourceMeta(source) {
  if (source === 'data_gov_in') {
    return {
      label: DATA_GOV_IN_SOURCE_LABEL,
      url:
        'https://www.data.gov.in/resource/current-daily-price-various-commodities-various-markets-mandi',
      licence: 'Government Open Data License - India',
    };
  }
  if (source === 'mandi_api') {
    return {
      label: MANDI_API_LABEL,
      url: 'https://mandi-api.vercel.app/',
      licence: 'Government Open Data License - India',
    };
  }
  return {
    label: PUBLIC_SOURCE_LABEL,
    url: PUBLIC_SOURCE_URL,
    licence: 'Government of India public data',
  };
}

function normalizeCacheSource(source) {
  return source === 'agmarknet' || source === 'data_gov_in' || source === 'mandi_api'
    ? 'data_gov_in'
    : 'agmarknet_public';
}

function redactKey(text) {
  const key = apiKey();
  const value = String(text || '');
  return (key ? value.split(key).join('[redacted-key]') : value).slice(0, 500);
}

function normalizeState(value) {
  const text = String(value || '').trim();
  const aliases = {
    kerala: 'Keralam',
    keralam: 'Keralam',
    karnataka: 'Karnataka',
    'tamil nadu': 'Tamil Nadu',
    tamilnadu: 'Tamil Nadu',
  };
  return aliases[text.toLowerCase()] || text;
}

function queryFromSettings(settings) {
  const live = settings.pricing.live || {};
  return {
    state: String(live.state || '').trim(),
    district: String(live.district || '').trim(),
    market: String(live.market || '').trim(),
    commodity: String(live.commodity || 'Arecanut(Betelnut/Supari)').trim(),
    variety: String(live.variety || '').trim(),
    marketGrade: String(live.marketGrade || '').trim(),
    priceField: ['modal', 'min', 'max'].includes(live.priceField)
      ? live.priceField
      : 'modal',
  };
}

function cacheKeyFor(query, source = marketSource()) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...query, source }))
    .digest('hex');
}

function parseDate(value) {
  const text = String(value || '').trim();
  const slashOrDash = text.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (slashOrDash) return `${slashOrDash[3]}-${slashOrDash[2]}-${slashOrDash[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return text || null;
}

function numeric(value) {
  const number = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function recordDate(record) {
  return parseDate(record.arrival_date || record.arrivalDate || record.date);
}

function normalizeRecord(record) {
  return {
    state: String(record.state || '').trim(),
    district: String(record.district || '').trim(),
    market: String(record.market || '').trim(),
    commodity: String(record.commodity || '').trim(),
    variety: String(record.variety || '').trim(),
    marketGrade: String(record.grade || '').trim(),
    arrivalDate: recordDate(record),
    minPricePerQuintal: numeric(record.min_price),
    maxPricePerQuintal: numeric(record.max_price),
    modalPricePerQuintal: numeric(record.modal_price),
    weightedAveragePricePerQuintal: null,
    arrivalMetricTonnes: null,
  };
}

function normalizePublicRecord(record) {
  const weightedAverage = numeric(record.as_on);
  return {
    state: String(record.state_name || '').trim(),
    district: String(record.district_name || '').trim(),
    market: String(record.market_name || '').trim(),
    commodity: String(record.cmdt_name || '').trim(),
    variety: String(record.variety_name || '').trim(),
    marketGrade: String(record.grade_name || '').trim(),
    arrivalDate: parseDate(record.reported_date),
    minPricePerQuintal: null,
    maxPricePerQuintal: null,
    modalPricePerQuintal: null,
    weightedAveragePricePerQuintal: weightedAverage,
    arrivalMetricTonnes: numeric(record.cumm_arr),
  };
}

function priceValue(record, field) {
  if (field === 'min') return record.minPricePerQuintal;
  if (field === 'max') return record.maxPricePerQuintal;
  // The public dashboard publishes only a weighted average. The default
  // "modal" preference falls back to it, while data.gov.in records keep their
  // real modal value.
  return record.modalPricePerQuintal ?? record.weightedAveragePricePerQuintal;
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function marketNameMatches(recordMarket, queryMarket) {
  const left = normalizedName(recordMarket);
  const right = normalizedName(queryMarket);
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function selectPrice(records, query) {
  const usable = records.filter((record) => {
    const value = priceValue(record, query.priceField);
    return Number.isFinite(value) && value > 0;
  });
  if (!usable.length) {
    return { selected: null, selectionMethod: 'no_usable_price', latestDate: null };
  }

  const dates = usable
    .map((record) => record.arrivalDate)
    .filter(Boolean)
    .sort()
    .reverse();
  const latestDate = dates[0] || null;
  const latest = latestDate
    ? usable.filter((record) => record.arrivalDate === latestDate)
    : usable;
  const sorted = [...latest].sort(
    (a, b) => priceValue(a, query.priceField) - priceValue(b, query.priceField)
  );

  if (query.market) {
    const exact = latest.find(
      (record) =>
        marketNameMatches(record.market, query.market) &&
        (!query.variety ||
          normalizedName(record.variety) === normalizedName(query.variety)) &&
        (!query.marketGrade ||
          normalizedName(record.marketGrade) === normalizedName(query.marketGrade))
    );
    return {
      selected: exact || sorted[Math.floor((sorted.length - 1) / 2)],
      selectionMethod: exact
        ? 'latest_matching_market_record'
        : 'latest_median_when_market_not_found',
      latestDate,
      matches: latest.length,
    };
  }

  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  return {
    selected: median,
    selectionMethod: latest.length > 1 ? 'median_of_latest_day_records' : 'single_latest_record',
    latestDate,
    matches: latest.length,
  };
}

function todayInIndia(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(now)
    .reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function remainingTimeout(deadline, fallback) {
  const remaining = Number.isFinite(deadline) ? deadline - Date.now() : fallback;
  return Math.max(1000, Math.min(Number(fallback) || 20000, remaining));
}

async function requestJson(url, options = {}) {
  const timeoutMs = Math.max(
    2000,
    Number(options.timeoutMs || config.marketTimeoutMs) || 20000
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new MarketPriceError(
        `The ${options.sourceLabel || 'market price'} request failed with HTTP ${response.status}.`,
        { code: options.errorCode || 'upstream_error', statusCode: 502 }
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new MarketPriceError(
        `The ${options.sourceLabel || 'market price'} source returned invalid JSON.`,
        { code: 'invalid_response', statusCode: 502 }
      );
    }
  } catch (error) {
    if (error instanceof MarketPriceError) throw error;
    if (error && error.name === 'AbortError') {
      throw new MarketPriceError(
        `The ${options.sourceLabel || 'market price'} request timed out after ${timeoutMs} ms.`,
        { code: 'timeout', statusCode: 504 }
      );
    }
    throw new MarketPriceError(
      `The ${options.sourceLabel || 'market price'} request failed: ${redactKey(
        error.message || error
      ).slice(0, 240)}`,
      { code: 'network_error', statusCode: 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function loadPublicFilters() {
  if (filtersCache.data && Date.now() - filtersCache.at < FILTERS_TTL_MS) {
    return filtersCache.data;
  }
  if (filtersPromise) return filtersPromise;
  filtersPromise = (async () => {
    const payload = await requestJson(
      `${config.marketPublicBaseUrl}/daily-price-arrival/filters`,
      {
        method: 'GET',
        headers: AGMARKNET_HEADERS,
        sourceLabel: 'AGMARKNET public filters',
        errorCode: 'filters_unavailable',
      }
    );
    const data = payload && payload.data ? payload.data : payload;
    if (!data || !Array.isArray(data.cmdt_data) || !Array.isArray(data.state_data)) {
      throw new MarketPriceError(
        'The AGMARKNET public filters response did not contain the expected data.',
        { code: 'invalid_response', statusCode: 502 }
      );
    }
    filtersCache = { at: Date.now(), data };
    return data;
  })().finally(() => {
    filtersPromise = null;
  });
  return filtersPromise;
}

function filterScore(row, name, fields) {
  let score = Infinity;
  fields.forEach((field) => {
    const candidate = normalizedName(row[field]);
    if (!candidate) return;
    if (candidate === name) score = Math.min(score, 0);
    else if (candidate.startsWith(name) || name.startsWith(candidate)) {
      score = Math.min(score, 1);
    } else if (candidate.includes(name) || name.includes(candidate)) {
      score = Math.min(score, 2);
    }
  });
  return score;
}

function selectFilterEntry(rows, name, fields, label, predicate) {
  const needle = normalizedName(name);
  const pool = (rows || []).filter((row) => !predicate || predicate(row));
  const scored = pool
    .map((row) => ({ row, score: filterScore(row, needle, fields) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score);
  if (!scored.length) {
    throw new MarketPriceError(
      `No AGMARKNET ${label} matched "${name}". Check the spelling or leave the field blank.`,
      { code: 'unknown_filter', statusCode: 400 }
    );
  }
  const bestScore = scored[0].score;
  const best = scored.filter((item) => item.score === bestScore);
  if (best.length > 1 && bestScore > 0) {
    const choices = best
      .slice(0, 5)
      .map((item) => String(item.row[fields[0]] || '').trim())
      .filter(Boolean)
      .join(', ');
    throw new MarketPriceError(
      `Multiple AGMARKNET ${label} entries matched "${name}": ${choices}. Enter a more specific value.`,
      { code: 'ambiguous_filter', statusCode: 400 }
    );
  }
  return best[0].row;
}

function resolveFilterIds(query, filters) {
  const state = query.state
    ? selectFilterEntry(
        filters.state_data,
        normalizeState(query.state),
        ['state_name'],
        'state'
      )
    : null;
  const district = query.district
    ? selectFilterEntry(
        filters.district_data,
        query.district,
        ['district_name'],
        'district',
        (row) => !state || Number(row.state_id) === Number(state.state_id)
      )
    : null;
  const market = query.market
    ? selectFilterEntry(
        filters.market_data,
        query.market,
        ['mkt_name'],
        'market',
        (row) =>
          (!state || Number(row.state_id) === Number(state.state_id)) &&
          (!district || Number(row.district_id) === Number(district.id))
      )
    : null;
  const commodity = selectFilterEntry(
    filters.cmdt_data,
    query.commodity,
    ['cmdt_name'],
    'commodity'
  );
  const commodityId = Number(commodity.cmdt_id);
  const belongsToCommodity = (row) => {
    if (!Array.isArray(row.cmdt_id) || row.cmdt_id.length === 0) return true;
    return row.cmdt_id.map(Number).includes(commodityId);
  };
  const variety = query.variety
    ? selectFilterEntry(
        filters.variety_data,
        query.variety,
        ['variety_name'],
        'variety',
        belongsToCommodity
      )
    : null;
  const grade = query.marketGrade
    ? selectFilterEntry(
        filters.grade_data,
        query.marketGrade,
        ['grade_name'],
        'grade',
        belongsToCommodity
      )
    : null;

  return {
    state,
    district,
    market,
    commodity,
    variety,
    grade,
    commodityId,
    commodityGroupId: Number(commodity.cmdt_group_id),
  };
}

function dashboardPayload(resolved, date) {
  return {
    dashboard: 'cumm_data_sp',
    date,
    group: resolved.commodityGroupId ? [resolved.commodityGroupId] : [100000],
    commodity: [resolved.commodityId],
    state: resolved.state ? [Number(resolved.state.state_id)] : [100006],
    district: resolved.district ? [Number(resolved.district.id)] : [100007],
    market: resolved.market ? [Number(resolved.market.id)] : [100009],
    market_type: [100004],
    grades: resolved.grade ? [Number(resolved.grade.grade_id)] : [100011],
    variety: resolved.variety ? [Number(resolved.variety.id)] : [100021],
    type: '0',
    format: 'json',
    page: 1,
    limit: 100,
  };
}

async function fetchPublicDashboard(resolved, date, deadline) {
  const payload = await requestJson(`${config.marketPublicBaseUrl}/dashboard-data/`, {
    method: 'POST',
    headers: AGMARKNET_HEADERS,
    body: dashboardPayload(resolved, date),
    timeoutMs: remainingTimeout(deadline, config.marketTimeoutMs),
    sourceLabel: 'AGMARKNET public dashboard',
  });
  if (payload && payload.status === false) {
    throw new MarketPriceError(
      `The AGMARKNET public dashboard rejected the request: ${String(
        payload.message || 'unknown error'
      ).slice(0, 240)}`,
      { code: 'upstream_error', statusCode: 502 }
    );
  }
  const records = payload && payload.data && payload.data.records;
  if (!Array.isArray(records)) {
    throw new MarketPriceError(
      'The AGMARKNET public dashboard response did not contain price records.',
      { code: 'invalid_response', statusCode: 502 }
    );
  }
  const normalized = records
    .map(normalizePublicRecord)
    .filter((record) => record.commodity && record.arrivalDate);
  return {
    records: normalized,
    total: Number(payload.pagination && payload.pagination.total_count) || normalized.length,
    date,
  };
}

async function fetchFromPublicAgmarknet(query, options = {}) {
  if (query.priceField === 'min' || query.priceField === 'max') {
    throw new MarketPriceError(
      'The public AGMARKNET dashboard publishes weighted average prices only. Choose the modal / weighted-average option, or configure the optional data.gov.in fallback for minimum or maximum quotes.',
      { code: 'unsupported_price_field', statusCode: 400 }
    );
  }

  const filters = await loadPublicFilters();
  const resolved = resolveFilterIds(query, filters);
  const deadline =
    Date.now() +
    Math.max(Number(config.marketTimeoutMs) || 20000, 5000);
  const lookbackDays = Math.min(
    Math.max(Number(config.marketLookbackDays) || 7, 0),
    14
  );
  const dates = options.date
    ? [String(options.date).slice(0, 10)]
    : Array.from({ length: lookbackDays + 1 }, (_value, index) =>
        addDays(todayInIndia(), -index)
      );

  for (const date of dates) {
    const payload = await fetchPublicDashboard(resolved, date, deadline);
    if (payload.records.length) {
      return {
        ...payload,
        source: 'agmarknet_public',
        sourceUrl: PUBLIC_SOURCE_URL,
        resolved,
      };
    }
    if (Date.now() >= deadline) break;
  }

  const place = [query.market, query.district, query.state]
    .filter(Boolean)
    .join(', ');
  throw new MarketPriceError(
    `AGMARKNET has no ${query.commodity} quote published for ${
      place || 'the configured filters'
    } in the last ${dates.length} day(s). No price is invented.`,
    { code: 'no_records', statusCode: 404 }
  );
}

async function fetchFromDataGovIn(query) {
  const key = apiKey();
  if (!key) {
    throw new MarketPriceError(
      'The data.gov.in fallback is selected, but DATA_GOV_IN_API_KEY (or AGMARKNET_API_KEY) is not set on the server. No price is invented.',
      { code: 'not_configured', statusCode: 503 }
    );
  }

  const params = new URLSearchParams();
  params.set('api-key', key);
  params.set('format', 'json');
  params.set('limit', '500');
  if (query.state) params.set('filters[state]', query.state);
  if (query.district) params.set('filters[district]', query.district);
  if (query.market) params.set('filters[market]', query.market);
  if (query.commodity) params.set('filters[commodity]', query.commodity);
  if (query.variety) params.set('filters[variety]', query.variety);
  if (query.marketGrade) params.set('filters[grade]', query.marketGrade);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(Number(config.marketTimeoutMs) || 20000, 2000)
  );
  try {
    const response = await fetch(`${DATA_GOV_IN_SOURCE_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new MarketPriceError(
        `The AGMARKNET/data.gov.in request failed with HTTP ${response.status}.`,
        { code: 'upstream_error', statusCode: 502 }
      );
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MarketPriceError('The market price source returned invalid JSON.', {
        code: 'invalid_response',
        statusCode: 502,
      });
    }
    const rawRecords = Array.isArray(payload.records) ? payload.records : [];
    const records = rawRecords.map(normalizeRecord).filter((record) => record.commodity);
    return {
      records,
      total: Number(payload.total) || records.length,
      count: Number(payload.count) || records.length,
      source: 'data_gov_in',
    };
  } catch (error) {
    if (error instanceof MarketPriceError) throw error;
    if (error && error.name === 'AbortError') {
      throw new MarketPriceError(
        `The market price request timed out after ${config.marketTimeoutMs} ms.`,
        { code: 'timeout', statusCode: 504 }
      );
    }
    throw new MarketPriceError(
      `The market price request failed: ${redactKey(error.message || error).slice(0, 240)}`,
      { code: 'network_error', statusCode: 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromMandiApi(query) {
  const state = query.state;
  const commodity = query.commodity;
  
  if (!state || !commodity) {
    throw new MarketPriceError(
      'Mandi API requires both state and commodity parameters.',
      { code: 'missing_params', statusCode: 400 }
    );
  }

  const params = new URLSearchParams();
  params.set('state', state);
  params.set('commodity', commodity);
  
  // Optional parameters
  if (query.district) params.set('district', query.district);
  if (query.market) params.set('market', query.market);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(Number(config.marketTimeoutMs) || 20000, 2000)
  );
  
  try {
    const response = await fetch(`${MANDI_API_BASE_URL}/prices?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new MarketPriceError(
        `The Mandi API request failed with HTTP ${response.status}.`,
        { code: 'upstream_error', statusCode: 502 }
      );
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MarketPriceError('The Mandi API returned invalid JSON.', {
        code: 'invalid_response',
        statusCode: 502,
      });
    }
    
    if (!payload.success) {
      throw new MarketPriceError(
        `The Mandi API returned an error: ${payload.error?.message || 'Unknown error'}`,
        { code: 'upstream_error', statusCode: 502 }
      );
    }
    
    const records = Array.isArray(payload.data) ? payload.data : [];
    const normalized = records.map(normalizeMandiApiRecord).filter((record) => record.commodity);
    
    if (!normalized.length) {
      const place = [query.market, query.district, query.state]
        .filter(Boolean)
        .join(', ');
      throw new MarketPriceError(
        `The Mandi API has no ${query.commodity} quote published for ${
          place || 'the configured filters'
        }. No price is invented.`,
        { code: 'no_records', statusCode: 404 }
      );
    }
    
    return {
      records: normalized,
      total: normalized.length,
      count: normalized.length,
      source: 'mandi_api',
      sourceUrl: MANDI_API_BASE_URL,
      date: payload.meta?.date || new Date().toISOString().split('T')[0],
    };
  } catch (error) {
    if (error instanceof MarketPriceError) throw error;
    if (error && error.name === 'AbortError') {
      throw new MarketPriceError(
        `The Mandi API request timed out after ${config.marketTimeoutMs} ms.`,
        { code: 'timeout', statusCode: 504 }
      );
    }
    throw new MarketPriceError(
      `The Mandi API request failed: ${redactKey(error.message || error).slice(0, 240)}`,
      { code: 'network_error', statusCode: 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMandiApiRecord(record) {
  return {
    state: String(record.state || '').trim(),
    district: String(record.district || '').trim(),
    market: String(record.market || '').trim(),
    commodity: String(record.commodity || '').trim(),
    variety: String(record.variety || '').trim(),
    marketGrade: String(record.grade || '').trim(),
    arrivalDate: String(record.arrival_date || record.date || '').trim(),
    minPricePerQuintal: numeric(record.min_price),
    maxPricePerQuintal: numeric(record.max_price),
    modalPricePerQuintal: numeric(record.modal_price),
    weightedAveragePricePerQuintal: numeric(record.modal_price), // API returns modal price
    arrivalMetricTonnes: numeric(record.arrival),
  };
}

async function fetchMarket(query, options = {}) {
  const source = marketSource();
  if (source === 'data_gov_in') {
    return fetchFromDataGovIn(query);
  }
  if (source === 'mandi_api') {
    return fetchFromMandiApi(query);
  }

  try {
    return await fetchFromPublicAgmarknet(query, options);
  } catch (error) {
    // First fallback: try Mandi API (keyless, covers 5 states including Karnataka)
    try {
      const fallback = await fetchFromMandiApi(query);
      return {
        ...fallback,
        source: 'mandi_api',
        fallbackFrom: 'agmarknet_public',
        fallbackReason: error.message,
      };
    } catch (mandiError) {
      // Second fallback: try data.gov.in (requires API key)
      if (!hasMarketKey()) throw mandiError;
      try {
        const fallback = await fetchFromDataGovIn(query);
        return {
          ...fallback,
          source: 'data_gov_in',
          fallbackFrom: 'agmarknet_public',
          fallbackReason: `${error.message} Mandi API fallback also failed: ${mandiError.message}`,
        };
      } catch (fallbackError) {
        throw new MarketPriceError(
          `${error.message} Mandi API fallback failed: ${mandiError.message}. The optional data.gov.in fallback also failed: ${fallbackError.message}`,
          {
            code: error.code || 'market_unavailable',
            statusCode: error.statusCode || 503,
          }
        );
      }
    }
  }
}

function publicPrice(selected, query, fetchedAt, expiresAt, source = 'agmarknet_public') {
  if (!selected) return null;
  const value = priceValue(selected, query.priceField);
  if (!Number.isFinite(value) || value <= 0) return null;
  const meta = sourceMeta(source);
  const weightedAverage = Number.isFinite(selected.weightedAveragePricePerQuintal)
    ? selected.weightedAveragePricePerQuintal
    : null;
  return {
    source: meta.label,
    sourceId: source,
    sourceUrl: meta.url,
    licence: meta.licence,
    priceField: weightedAverage !== null && query.priceField === 'modal'
      ? 'weighted_average'
      : query.priceField,
    pricePerQuintal: Math.round(value * 100) / 100,
    pricePerKg: Math.round((value / 100) * 10000) / 10000,
    unit: 'INR/quintal',
    state: selected.state,
    district: selected.district,
    market: selected.market,
    commodity: selected.commodity,
    variety: selected.variety,
    marketGrade: selected.marketGrade,
    arrivalDate: selected.arrivalDate,
    minPricePerQuintal: selected.minPricePerQuintal,
    maxPricePerQuintal: selected.maxPricePerQuintal,
    modalPricePerQuintal: selected.modalPricePerQuintal,
    weightedAveragePricePerQuintal: weightedAverage,
    arrivalMetricTonnes: Number.isFinite(selected.arrivalMetricTonnes)
      ? selected.arrivalMetricTonnes
      : null,
    fetchedAt,
    expiresAt,
    note:
      source === 'data_gov_in'
        ? 'AGMARKNET prices are daily mandi quotes, conventionally rupees per quintal. They are not a guaranteed transaction price.'
        : 'The AGMARKNET 2.0 public dashboard publishes daily weighted-average mandi prices. The value is not a real-time transaction price and may lag the physical market.',
  };
}

function cacheResult(cached, query, now, status, extra = {}) {
  const source = normalizeCacheSource(cached.source);
  return {
    status,
    fresh: status === 'live',
    cached: true,
    source,
    query,
    selected: cached.selected,
    price: publicPrice(cached.selected, query, cached.fetchedAt, cached.expiresAt, source),
    records: (cached.records || []).slice(0, 25),
    fetchedAt: cached.fetchedAt,
    expiresAt: cached.expiresAt,
    ageMinutes: Math.max(
      0,
      Math.floor((now - new Date(cached.fetchedAt).getTime()) / 60000)
    ),
    ...extra,
  };
}

async function getLiveMarketPrice(settings, options = {}) {
  const query = queryFromSettings(settings);
  const source = marketSource();
  const cacheKey = cacheKeyFor(query, source);
  const now = Date.now();
  const cached = await MarketPriceCache.findOne({ cacheKey });
  const fresh = cached && cached.expiresAt && cached.expiresAt.getTime() > now;

  if (cached && fresh && !options.force) {
    return cacheResult(cached, query, now, 'live', {
      note:
        'Served from the server cache. AGMARKNET updates are daily and the cache refresh interval is controlled by the administrator.',
    });
  }

  try {
    const payload = await fetchMarket(query, options);
    const selection = selectPrice(payload.records, query);
    const fetchedAt = new Date();
    const expiresAt = new Date(
      fetchedAt.getTime() +
        Math.max(15, Number(settings.pricing.live.refreshMinutes) || 360) * 60000
    );
    const selected = selection.selected;
    if (cached) {
      cached.source = payload.source || source;
      cached.records = payload.records.slice(0, 100);
      cached.selected = selected;
      cached.query = query;
      cached.fetchedAt = fetchedAt;
      cached.expiresAt = expiresAt;
      cached.lastError = null;
      await cached.save();
    } else {
      await MarketPriceCache.create({
        cacheKey,
        source: payload.source || source,
        query,
        records: payload.records.slice(0, 100),
        selected,
        fetchedAt,
        expiresAt,
      });
    }

    const sourceKey = payload.source || source;
    return {
      status: 'live',
      fresh: true,
      cached: false,
      source: sourceKey,
      query,
      selected,
      selectionMethod: selection.selectionMethod,
      matches: selection.matches || 0,
      price: publicPrice(selected, query, fetchedAt, expiresAt, sourceKey),
      records: payload.records.slice(0, 25),
      fetchedAt,
      expiresAt,
      ageMinutes: 0,
      sourceTotal: payload.total,
      sourceDate: payload.date || null,
      sourceLookbackDays: payload.lookbackDays || 0,
      fallbackFrom: payload.fallbackFrom || null,
      fallbackReason: payload.fallbackReason || null,
      note:
        sourceKey === 'data_gov_in'
          ? 'Fetched from the optional data.gov.in AGMARKNET fallback. Quotes are daily and may lag the physical market.'
          : 'Fetched from the AGMARKNET 2.0 public dashboard without an API key. Quotes are daily and may lag the physical market.',
    };
  } catch (error) {
    if (cached) {
      cached.lastError = redactKey(error.message || error);
      await cached.save();
      const result = cacheResult(cached, query, now, 'stale', {
        error: `${redactKey(error.message)} Showing the last successfully cached quote instead.`,
      });
      return result;
    }
    if (error instanceof MarketPriceError) throw error;
    throw new MarketPriceError(String(error.message || error), {
      code: 'market_unavailable',
      statusCode: 503,
    });
  }
}

async function marketStatus(settings) {
  const query = queryFromSettings(settings);
  const source = marketSource();
  const cacheKey = cacheKeyFor(query, source);
  const cached = await MarketPriceCache.findOne({ cacheKey }).lean();
  const meta = sourceMeta(source);
  return {
    source: meta.label,
    sourceKey: source,
    sourceUrl: meta.url,
    licence: meta.licence,
    publicSource: source === 'agmarknet_public',
    requiresApiKey: source === 'data_gov_in',
    apiKeyConfigured: hasMarketKey(),
    fallbackApiKeyConfigured: source === 'agmarknet_public' && hasMarketKey(),
    canRefresh: source === 'agmarknet_public' || hasMarketKey(),
    keyEnvHint:
      'Optional data.gov.in fallback: DATA_GOV_IN_API_KEY or AGMARKNET_API_KEY',
    unit: 'INR/quintal',
    query,
    cache: cached
      ? {
          fetchedAt: cached.fetchedAt,
          expiresAt: cached.expiresAt,
          fresh: cached.expiresAt && new Date(cached.expiresAt).getTime() > Date.now(),
          recordCount: (cached.records || []).length,
          lastError: cached.lastError || null,
        }
      : null,
    note:
      source === 'data_gov_in'
        ? 'Uses the official data.gov.in AGMARKNET daily mandi-price resource. A free data.gov.in API key is required.'
        : 'Uses the AGMARKNET 2.0 public daily price dashboard. No API key is required. The dashboard publishes weighted-average daily values, not real-time transaction prices. A configured data.gov.in key is used only as an optional fallback.',
  };
}

function resetPublicFilterCache() {
  filtersCache = { at: 0, data: null };
  filtersPromise = null;
}

module.exports = {
  MarketPriceError,
  getLiveMarketPrice,
  marketStatus,
  hasMarketKey,
  marketSource,
  queryFromSettings,
  parseDate,
  normalizeRecord,
  normalizePublicRecord,
  normalizeState,
  resolveFilterIds,
  dashboardPayload,
  todayInIndia,
  addDays,
  selectPrice,
  publicPrice,
  resetPublicFilterCache,
};
