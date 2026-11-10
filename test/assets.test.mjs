import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
const root = fileURLToPath(new URL('../public/', import.meta.url));

test('page scripts parse and every local HTML asset resolves inside the package', () => {
  for (const page of ['index.html', 'admin.html', 'booking-status.html']) {
    const html = readFileSync(resolve(root, page), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const value = match[1]; if (!value || /^(?:https?:|mailto:|#)/.test(value)) continue;
      assert.ok(existsSync(resolve(root, value.split('#')[0])), page + ': missing ' + value);
    }
    for (const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      const source = script[1].match(/src="([^"]+)"/);
      assert.doesNotThrow(() => new Script(source ? readFileSync(resolve(root, source[1]), 'utf8') : script[2], { filename: source ? source[1] : page + ':inline' }));
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); assert.equal(ids.length, new Set(ids).size, page + ': duplicate IDs');
  }
});
test('booking and status controls referenced by scripts exist in their pages', () => {
  for (const [page, file] of [['index.html', 'booking.js'], ['booking-status.html', 'status.js'], ['admin.html', 'admin.js']]) {
    const html = readFileSync(resolve(root, page), 'utf8'), js = readFileSync(resolve(root, 'assets', file), 'utf8');
    for (const [, id] of js.matchAll(/(?<![.\w])(?:get|document\.getElementById)\('([^']+)'\)/g)) {
      if (id.startsWith('rate-')) continue;
      assert.ok(html.includes('id="' + id + '"'), file + ': missing control ' + id);
    }
  }
});
