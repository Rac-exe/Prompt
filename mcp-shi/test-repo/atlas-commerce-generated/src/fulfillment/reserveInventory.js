export function reserveInventory(product, requestedQuantity) {
  if (requestedQuantity > product.stock) {
    return { ok: false, remaining: product.stock, reserved: 0 };
  }
  return { ok: true, remaining: product.stock - requestedQuantity, reserved: requestedQuantity };
}

export function reserveBatch(catalog, requests) {
  return requests.map((request) => {
    const product = catalog.products.find((candidate) => candidate.sku === request.sku);
    return reserveInventory(product, request.quantity);
  });
}
