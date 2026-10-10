const test = require('node:test');
const assert = require('node:assert/strict');
const { app, db } = require('../server');

let server;
let base;
let token;
let categories;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
});

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test('health endpoint reports API v2', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.version, '2.0');
});

test('registration creates the built-in collection categories', async () => {
  const email = `qa-${Date.now()}@example.test`;
  const result = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'QA Player', email, password: 'LongPassword123!' }) });
  assert.equal(result.response.status, 201);
  token = result.body.token;
  const list = await request('/api/categories');
  assert.equal(list.response.status, 200);
  categories = list.body.categories;
  assert.deepEqual(categories.map(category => category.systemKey), ['games','comics','cards','pops','figures']);
});

test('creates custom categories and multi-collection items', async () => {
  const createdCategory = await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'LEGO', icon: '🧱', color: '#ffcc00' }) });
  assert.equal(createdCategory.response.status, 201);
  const cardCategory = categories.find(category => category.systemKey === 'cards');
  const createdItem = await request('/api/items', { method: 'POST', body: JSON.stringify({ categoryId: cardCategory.id, title: 'Charizard', series: 'Base Set', reference: '4/102', condition: 'Muito bom', quantity: 1, paid: 40, value: 250, status: 'owned' }) });
  assert.equal(createdItem.response.status, 201);
  assert.equal(createdItem.body.item.series, 'Base Set');
  const list = await request('/api/items');
  assert.equal(list.response.status, 200);
  assert.equal(list.body.items.length, 1);
});

test('legacy Android game sync is mirrored into the v2 item model', async () => {
  const id = crypto.randomUUID();
  const legacy = await request('/api/games/sync', { method: 'POST', body: JSON.stringify({ games: [{ id, title: 'Sonic the Hedgehog', platform: 'Sega Mega Drive', condition: 'Muito bom', paid: 10, value: 30, completeness: 'Completo', region: 'PAL', cover: '', createdAt: '2026-01-02' }], deletedIds: [] }) });
  assert.equal(legacy.response.status, 200);
  assert.equal(legacy.body.games.some(game => game.id === id), true);
  const list = await request('/api/items');
  const mirrored = list.body.items.find(item => item.id === id);
  assert.equal(mirrored.platform, 'Sega Mega Drive');
  assert.equal(categories.find(category => category.id === mirrored.categoryId).systemKey, 'games');
});
