import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveBatch, reserveInventory } from '../src/fulfillment/reserveInventory.js';

test('inventory can reserve exact available stock', () => {
  const result = reserveInventory({ sku: 'starter', stock: 5 }, 5);
  assert.equal(result.ok, true);
  assert.equal(result.remaining, 0);
});

test('batch reservation reports unavailable SKUs instead of crashing', () => {
  const result = reserveBatch({ products: [{ sku: 'starter', stock: 5 }] }, [
    { sku: 'missing', quantity: 1 },
  ]);
  assert.equal(result[0].ok, false);
  assert.equal(result[0].reserved, 0);
});

test('batch reservation accepts catalog arrays from search results', () => {
  const result = reserveBatch([{ sku: 'starter', stock: 3 }], [
    { sku: 'starter', quantity: 2 },
  ]);
  assert.deepEqual(result, [{ ok: true, remaining: 1, reserved: 2 }]);
});
