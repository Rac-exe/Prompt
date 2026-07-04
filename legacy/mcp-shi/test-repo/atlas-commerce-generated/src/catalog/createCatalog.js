export function createCatalog() {
  return {
    products: [
      { sku: 'starter', name: 'Starter Kit', stock: 12, price: 25 },
      { sku: 'pro', name: 'Pro Kit', stock: 6, price: 80 },
    ],
  };
}

export function findProduct(catalog, sku) {
  return catalog.products.find((product) => product.sku === sku) || null;
}
