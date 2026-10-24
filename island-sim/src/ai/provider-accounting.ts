/** Provider billing behavior is selected from the configured endpoint, not a shared price schema. */
export type ProviderAccountingAdapter =
  | { readonly kind: 'openrouter'; readonly usageKind: 'per-response-cost'; readonly accountUsageKind: 'credits-api' }
  | { readonly kind: 'unpriced'; readonly usageKind: 'unknown'; readonly accountUsageKind: 'unknown' };

export function providerAccountingAdapter(baseUrl: string): ProviderAccountingAdapter {
  let url: URL;
  try { url = new URL(baseUrl); } catch {
    return { kind: 'unpriced', usageKind: 'unknown', accountUsageKind: 'unknown' };
  }
  if (url.hostname.toLowerCase() === 'openrouter.ai') {
    return { kind: 'openrouter', usageKind: 'per-response-cost', accountUsageKind: 'credits-api' };
  }
  return { kind: 'unpriced', usageKind: 'unknown', accountUsageKind: 'unknown' };
}
