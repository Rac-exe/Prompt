import { createCatalog } from './catalog/createCatalog.js';
import { priceCart } from './checkout/priceCart.js';

const catalog = createCatalog();
const cart = priceCart({ items: [{ sku: 'starter', quantity: 2, unitPrice: 25 }], coupon: { code: 'SAVE10', percent: 10 } });
console.log(JSON.stringify({ products: catalog.products.length, total: cart.total }));
