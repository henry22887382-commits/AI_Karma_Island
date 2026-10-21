import test from 'node:test';
import assert from 'node:assert/strict';
import { renderObserverMarkup, type ObserverSnapshot } from './observer.ts';

const snapshot: ObserverSnapshot = {
  worldTime: { day: 2, timeT: 73, phase: '白天' },
  simulation: { running: false, speedLabel: '暫停中', freshAt: '2026-10-20T10:00:00+08:00' },
  map: {
    nodes: [{ id: '1', label: '', labelStatus: '未逐點命名', regionDescription: '西側沙灘', x: 132, y: 558, residents: ['1.1'], objects: [] }],
    edges: [],
  },
  residents: [{ id: '1.1', generation: 1, model: '待設定', nodeId: '1', hp: 30, hunger: 5, sleep: 3, inventory: [], equipment: [], lastAction: '醒來' }],
  events: [{ id: 'ev-1', day: 2, timeT: 73, nodeId: '1', actorId: '1.1', description: '居民醒來', visibility: 'public' }],
  biographies: [{ residentId: '0.1', displayName: '已故居民', text: '一段只供玩家查看的傳記' }],
  availableSpeedOptions: [],
};

test('renders a readonly observer map, resident detail, objective timeline and player biography', () => {
  const html = renderObserverMarkup(snapshot);
  assert.match(html, /主島地圖/);
  assert.match(html, /viewBox="0 0 991 823"/);
  assert.match(html, /未逐點命名/);
  assert.match(html, /島民 1\.1/);
  assert.match(html, /事件時間線/);
  assert.match(html, /只供玩家查看的傳記/);
  assert.match(html, /資料更新/);
});

test('does not invent speed multipliers when the source has not configured them', () => {
  const html = renderObserverMarkup(snapshot);
  assert.match(html, /調速倍率尚未設定/);
  assert.doesNotMatch(html, /data-control="speed"/);
});

test('escapes untrusted event and biography text before placing it in the DOM', () => {
  const event = snapshot.events[0];
  const biography = snapshot.biographies[0];
  assert.ok(event);
  assert.ok(biography);
  const html = renderObserverMarkup({
    ...snapshot,
    events: [{ ...event, description: '<script>alert(1)</script>' }],
    biographies: [{ ...biography, text: '<img src=x onerror=alert(1)>' }],
  });
  assert.doesNotMatch(html, /<script>|<img /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});

test('compresses model settings to one visible slot while retaining all ten editable forms and budget status', () => {
  const html = renderObserverMarkup(snapshot, { activeTab: 'settings' });
  assert.equal((html.match(/data-model-settings/g) ?? []).length, 10);
  assert.equal((html.match(/data-model-settings[^>]* hidden/g) ?? []).length, 9);
  assert.equal((html.match(/<option value="\d+"/g) ?? []).length, 10);
  assert.match(html, /data-slot-select/);
  assert.match(html, /本月已結算/);
  assert.match(html, /US\$20\.0000/);
});
