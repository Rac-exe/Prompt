import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCartItems, priceCart } from '../src/checkout/priceCart.js';

test('cart pricing works without an active coupon', () => {
  const result = priceCart({ items: [{ sku: 'starter', quantity: 2, unitPrice: 25 }], coupon: null });
  assert.equal(result.total, 50);
});

test('cart pricing accepts catalog product price fields', () => {
  const result = priceCart({ items: [{ sku: 'pro', quantity: 2, price: 80 }], coupon: null });
  assert.equal(result.total, 160);
});

test('cart pricing ignores coupons without a usable percent', () => {
  const result = priceCart({
    items: [{ sku: 'starter', quantity: 2, unitPrice: 25 }],
    coupon: { code: 'SAVE10' },
  });
  assert.equal(result.total, 50);
});

test('cart merging keeps the newest price when duplicate items are re-added', () => {
  const result = mergeCartItems([
    { sku: 'starter', quantity: 1, unitPrice: 25 },
    { sku: 'starter', quantity: 2, unitPrice: 20 },
  ]);
  assert.deepEqual(result, [{ sku: 'starter', quantity: 3, unitPrice: 20 }]);
});
