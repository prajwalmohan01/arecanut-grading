'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// This legacy test file exercises the optional data.gov.in fallback path.
process.env.MARKET_PRICE_SOURCE = 'data_gov_in';

const MarketPriceCache = require('../../models/MarketPriceCache');
const {
  getLiveMarketPrice,
  parseDate,
  queryFromSettings,
  normalizeRecord,
  normalizePublicRecord,
  resolveFilterIds,
  selectPrice,
  publicPrice,
  resetPublicFilterCache,
} = require('../../services/marketPriceService');
const { defaultSettings } = require('../../services/settingsService');

const KEY_NAMES = ['DATA_GOV_IN_API_KEY', 'AGMARKNET_API_KEY'];

function liveSettings(overrides = {}) {
  const settings = defaultSettings();
  settings.pricing.mode = 'live';
  settings.pricing.live = {
    ...settings.pricing.live,
    state: 'Kerala',
    district: 'Kozhikode',
    market: 'Kozhikode',
    commodity: 'Arecanut(Betelnut/Supari)',
    variety: '',
    marketGrade: '',
    priceField: 'modal',
    refreshMinutes: 360,
    ...overrides,
  };
  return settings;
}

function rawRecord(overrides = {}) {
  return {
    state: 'Kerala',
    district: 'Kozhikode',
    market: 'Kozhikode',
    commodity: 'Arecanut(Betelnut/Supari)',
    variety: 'Other',
    grade: 'FAQ',
    arrival_date: '29/10/2026',
    min_price: '15000',
    max_price: '17000',
    modal_price: '16000',
    ...overrides,
  };
}

function mockCache(t, options = {}) {
  const originalFindOne = MarketPriceCache.findOne;
  const originalCreate = MarketPriceCache.create;
  const created = [];
  MarketPriceCache.findOne = async () => options.cached || null;
  MarketPriceCache.create = async (doc) => {
    created.push(doc);
    return doc;
  };
  t.after(() => {
    MarketPriceCache.findOne = originalFindOne;
    MarketPriceCache.create = originalCreate;
  });
  return created;
}

function mockFetch(t, handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
  t.after(() => {
    global.fetch = original;
  });
  return calls;
}

function snapshotEnv() {
  return Object.fromEntries(KEY_NAMES.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  KEY_NAMES.forEach((name) => {
    if (snapshot[name] === undefined) delete process.env[name];
    else process.env[name] = snapshot[name];
  });
}

test('AGMARKNET dates, filters, and records normalize safely', () => {
  assert.equal(parseDate('29/10/2026'), '2026-10-29');
  assert.equal(parseDate('2026-10-29T00:00:00'), '2026-10-29');
  assert.equal(parseDate(''), null);

  const settings = liveSettings({ state: 'kerala' });
  assert.equal(queryFromSettings(settings).state, 'kerala');

  const record = normalizeRecord(rawRecord({ min_price: '15,000' }));
  assert.equal(record.arrivalDate, '2026-10-29');
  assert.equal(record.minPricePerQuintal, 15000);
  assert.equal(record.modalPricePerQuintal, 16000);
});

test('market selection uses the latest day and median of quotes', () => {
  const query = queryFromSettings(liveSettings({ market: '' }));
  const records = [
    normalizeRecord(rawRecord({ arrival_date: '28/10/2026', modal_price: '99999' })),
    normalizeRecord(rawRecord({ market: 'A', modal_price: '15000' })),
    normalizeRecord(rawRecord({ market: 'B', modal_price: '16000' })),
    normalizeRecord(rawRecord({ market: 'C', modal_price: '17000' })),
  ];
  const selection = selectPrice(records, query);
  assert.equal(selection.latestDate, '2026-10-29');
  assert.equal(selection.selected.market, 'B');
  assert.equal(selection.selectionMethod, 'median_of_latest_day_records');

  const exactQuery = queryFromSettings(liveSettings({ market: 'C' }));
  const exact = selectPrice(records, exactQuery);
  assert.equal(exact.selected.market, 'C');
  assert.equal(exact.selectionMethod, 'latest_matching_market_record');

  const price = publicPrice(selection.selected, query, new Date(), new Date());
  assert.equal(price.pricePerQuintal, 16000);
  assert.equal(price.pricePerKg, 160);
});

test('fresh cache is served without a network call', async (t) => {
  const env = snapshotEnv();
  t.after(() => restoreEnv(env));
  process.env.DATA_GOV_IN_API_KEY = 'unit-test-market-key';
  const selected = normalizeRecord(
    rawRecord({ arrival_date: '29/10/2026', modal_price: '16000' })
  );
  const fetchedAt = new Date(Date.now() - 5 * 60000);
  const expiresAt = new Date(Date.now() + 60 * 60000);
  const cached = {
    selected,
    records: [selected],
    fetchedAt,
    expiresAt,
  };
  mockCache(t, { cached });
  const calls = mockFetch(t, async () => {
    throw new Error('network must not be called for fresh cache');
  });

  const result = await getLiveMarketPrice(liveSettings());
  assert.equal(calls.length, 0);
  assert.equal(result.status, 'live');
  assert.equal(result.cached, true);
  assert.equal(result.price.pricePerKg, 160);
  assert.equal(result.query.state, 'Kerala');
});

test('live fetch quotes per quintal and stores a bounded cache record', async (t) => {
  const env = snapshotEnv();
  t.after(() => restoreEnv(env));
  process.env.DATA_GOV_IN_API_KEY = 'unit-test-market-key';
  const created = mockCache(t, { cached: null });
  const calls = mockFetch(
    t,
    async () =>
      new Response(
        JSON.stringify({
          total: 3,
          count: 3,
          records: [
            rawRecord({ market: 'A', modal_price: '15000' }),
            rawRecord({ market: 'B', modal_price: '16000' }),
            rawRecord({ market: 'C', modal_price: '17000' }),
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
  );

  const result = await getLiveMarketPrice(liveSettings({ market: '' }));
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.searchParams.get('api-key'), 'unit-test-market-key');
  assert.equal(requestUrl.searchParams.get('filters[state]'), 'Kerala');
  assert.equal(requestUrl.searchParams.get('filters[district]'), 'Kozhikode');
  assert.equal(requestUrl.searchParams.get('filters[commodity]'), 'Arecanut(Betelnut/Supari)');

  assert.equal(result.status, 'live');
  assert.equal(result.selectionMethod, 'median_of_latest_day_records');
  assert.equal(result.matches, 3);
  assert.equal(result.price.pricePerKg, 160);
  assert.equal(created.length, 1);
  assert.equal(created[0].records.length, 3);
  assert.equal(created[0].selected.modalPricePerQuintal, 16000);
  assert.ok(created[0].expiresAt.getTime() > Date.now());
});

test('failed refresh falls back to the last cached quote and records the error', async (t) => {
  const env = snapshotEnv();
  t.after(() => restoreEnv(env));
  process.env.DATA_GOV_IN_API_KEY = 'unit-test-market-key';
  const selected = normalizeRecord(rawRecord({ modal_price: '15500' }));
  const cached = {
    selected,
    records: [selected],
    fetchedAt: new Date(Date.now() - 24 * 60 * 60000),
    expiresAt: new Date(Date.now() - 60 * 60000),
    lastError: null,
    save: async () => {
      cached.saved = true;
    },
  };
  mockCache(t, { cached });
  mockFetch(
    t,
    async () =>
      new Response(JSON.stringify({ error: 'source unavailable' }), { status: 503 })
  );

  const result = await getLiveMarketPrice(liveSettings(), { force: true });
  assert.equal(result.status, 'stale');
  assert.equal(result.cached, true);
  assert.equal(result.price.pricePerKg, 155);
  assert.match(result.error, /last successfully cached quote/);
  assert.equal(cached.saved, true);
  assert.match(cached.lastError, /HTTP 503/);
});

test('market network errors redact the API key', async (t) => {
  const env = snapshotEnv();
  t.after(() => restoreEnv(env));
  const key = 'unit-test-market-secret-in-url';
  process.env.DATA_GOV_IN_API_KEY = key;
  mockCache(t, { cached: null });
  mockFetch(t, async (url) => {
    throw new Error(`request failed for ${url}`);
  });

  await assert.rejects(
    getLiveMarketPrice(liveSettings()),
    (error) =>
      error.code === 'network_error' &&
      error.message.includes('[redacted-key]') &&
      !error.message.includes(key)
  );
});

test('live pricing refuses to invent a quote when no key or cache exists', async (t) => {
  const env = snapshotEnv();
  const originalFindOne = MarketPriceCache.findOne;
  t.after(() => {
    restoreEnv(env);
    MarketPriceCache.findOne = originalFindOne;
  });
  KEY_NAMES.forEach((name) => {
    delete process.env[name];
  });
  MarketPriceCache.findOne = async () => null;
  const calls = mockFetch(t, async () => {
    throw new Error('network must not be called without a key');
  });

  await assert.rejects(
    getLiveMarketPrice(liveSettings()),
    (error) =>
      error.code === 'not_configured' &&
      /will not invent a market price|No price is invented/i.test(error.message)
  );
  assert.equal(calls.length, 0);
});

function filtersPayload() {
  return {
    status: 'success',
    data: {
      state_data: [
        { state_id: 17, state_name: 'Keralam' },
        { state_id: 16, state_name: 'Karnataka' },
      ],
      district_data: [
        { id: 275, state_id: 17, district_name: 'Kannur' },
        { id: 279, state_id: 17, district_name: 'Kozhikode(Calicut)' },
      ],
      market_data: [
        { id: 130, mkt_name: 'Payyannur Market', state_id: 17, district_id: 275 },
        { id: 129, mkt_name: 'Kannur Market', state_id: 17, district_id: 275 },
        { id: 124, mkt_name: 'Vengeri(Kozhikode) Market', state_id: 17, district_id: 279 },
      ],
      cmdt_data: [
        { cmdt_id: 118, cmdt_name: 'Arecanut(Betelnut/Supari)', cmdt_group_id: 11 },
      ],
      variety_data: [
        { id: 347, cmdt_id: [118], variety_name: 'Chali' },
      ],
      grade_data: [
        { grade_id: 11, cmdt_id: [118], grade_name: 'Grade B' },
      ],
    },
  };
}

function dashboardRecord(date) {
  const [year, month, day] = date.split('-');
  return {
    as_on: '36000.00',
    cumm_arr: '1.50',
    cmdt_name: 'Arecanut(Betelnut/Supari)',
    state_name: 'Keralam',
    district_name: 'Kannur',
    market_name: 'Payyannur Market',
    reported_date: `${day}-${month}-${year}`,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withPublicSource(t) {
  const env = snapshotEnv();
  const previousSource = process.env.MARKET_PRICE_SOURCE;
  process.env.MARKET_PRICE_SOURCE = 'agmarknet_public';
  KEY_NAMES.forEach((name) => {
    delete process.env[name];
  });
  resetPublicFilterCache();
  t.after(() => {
    restoreEnv(env);
    process.env.MARKET_PRICE_SOURCE = previousSource || 'data_gov_in';
    resetPublicFilterCache();
  });
}

test('public AGMARKNET dashboard resolves names and quotes the weighted average', async (t) => {
  withPublicSource(t);
  const created = mockCache(t, { cached: null });
  const calls = mockFetch(t, async (url, options) => {
    if (url.includes('/daily-price-arrival/filters')) {
      return jsonResponse(filtersPayload());
    }
    const body = JSON.parse(options.body);
    assert.equal(body.dashboard, 'cumm_data_sp');
    assert.equal(body.commodity[0], 118);
    assert.deepEqual(body.state, [17]);
    assert.deepEqual(body.district, [275]);
    assert.deepEqual(body.market, [130]);
    assert.equal(options.headers.Origin, 'https://agmarknet.gov.in');
    return jsonResponse({
      status: 'success',
      pagination: { total_count: 1 },
      data: { records: [dashboardRecord(body.date)] },
    });
  });

  const result = await getLiveMarketPrice(
    liveSettings({
      state: 'Kerala',
      district: 'Kannur',
      market: 'Payyannur',
    }),
    { date: '2026-10-29' }
  );

  assert.equal(calls.length, 2);
  assert.equal(result.status, 'live');
  assert.equal(result.source, 'agmarknet_public');
  assert.equal(result.sourceDate, '2026-10-29');
  assert.equal(result.price.sourceId, 'agmarknet_public');
  assert.equal(result.price.priceField, 'weighted_average');
  assert.equal(result.price.pricePerQuintal, 36000);
  assert.equal(result.price.pricePerKg, 360);
  assert.equal(result.price.arrivalDate, '2026-10-29');
  assert.equal(result.price.arrivalMetricTonnes, 1.5);
  assert.equal(result.price.minPricePerQuintal, null);
  assert.equal(result.price.maxPricePerQuintal, null);
  assert.equal(created.length, 1);
  assert.equal(created[0].source, 'agmarknet_public');
  assert.equal(created[0].selected.weightedAveragePricePerQuintal, 36000);
});

test('public AGMARKNET dashboard reports no records instead of inventing a quote', async (t) => {
  withPublicSource(t);
  mockCache(t, { cached: null });
  const calls = mockFetch(t, async (url) => {
    if (url.includes('/daily-price-arrival/filters')) {
      return jsonResponse(filtersPayload());
    }
    return jsonResponse({
      status: 'success',
      pagination: { total_count: 0 },
      data: { records: [] },
    });
  });

  await assert.rejects(
    getLiveMarketPrice(liveSettings(), { date: '2026-10-29' }),
    (error) =>
      error.code === 'no_records' &&
      /No price is invented/i.test(error.message)
  );
  assert.equal(calls.length, 2);
});

test('public source falls back to data.gov.in when its key is configured', async (t) => {
  withPublicSource(t);
  process.env.DATA_GOV_IN_API_KEY = 'unit-test-market-key';
  const created = mockCache(t, { cached: null });
  mockFetch(t, async (url) => {
    if (url.includes('/daily-price-arrival/filters')) {
      return jsonResponse({ detail: 'temporarily unavailable' }, 503);
    }
    return jsonResponse({
      total: 1,
      count: 1,
      records: [rawRecord({ modal_price: '35500' })],
    });
  });

  const result = await getLiveMarketPrice(
    liveSettings({ state: 'Kerala', district: 'Kannur', market: 'Payyannur' }),
    { date: '2026-10-29' }
  );

  assert.equal(result.status, 'live');
  assert.equal(result.source, 'data_gov_in');
  assert.equal(result.fallbackFrom, 'agmarknet_public');
  assert.match(result.fallbackReason, /HTTP 503/);
  assert.equal(result.price.pricePerKg, 355);
  assert.equal(created[0].source, 'data_gov_in');
});

test('public record normalization parses AGMARKNET dates and arrival values', () => {
  const record = normalizePublicRecord({
    state_name: 'Keralam',
    district_name: 'Kannur',
    market_name: 'Payyannur Market',
    cmdt_name: 'Arecanut(Betelnut/Supari)',
    reported_date: '29-10-2026',
    as_on: '36,000.00',
    cumm_arr: '1.50',
  });
  assert.equal(record.arrivalDate, '2026-10-29');
  assert.equal(record.modalPricePerQuintal, null);
  assert.equal(record.weightedAveragePricePerQuintal, 36000);
  assert.equal(record.arrivalMetricTonnes, 1.5);
});
