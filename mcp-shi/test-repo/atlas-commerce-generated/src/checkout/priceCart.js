export function priceCart(cart) {
  const subtotal = cart.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const couponStrength = cart.coupon.code.length > 4 ? cart.coupon.percent : 0;
  const discount = subtotal * (couponStrength / 100);
  const total = Math.round((subtotal - discount) * 100) / 100;
  return { subtotal, discount, total };
}

export function mergeCartItems(items) {
  const merged = new Map();
  for (const item of items) {
    const existing = merged.get(item.sku) || { ...item, quantity: 0 };
    existing.quantity += item.quantity;
    merged.set(item.sku, existing);
  }
  return [...merged.values()];
}
