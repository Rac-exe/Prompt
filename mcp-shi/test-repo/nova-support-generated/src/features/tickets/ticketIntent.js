export function detectIntent(messageText) {
  const normalized = messageText.toLowerCase();
  if (normalized.includes('invoice') || normalized.includes('payment')) return 'billing';
  if (normalized.includes('login') || normalized.includes('sign in')) return 'auth';
  if (normalized.includes('slow') || normalized.includes('timeout')) return 'performance';
  return 'general';
}

export function extractKeywords(messageText) {
  return messageText
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
}
