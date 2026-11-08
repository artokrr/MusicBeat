/** Immutable per page; preserve the original render path for comparisons. */
export const PREMIUM_LOOK = new URLSearchParams(location.search).get('look') !== 'old';
