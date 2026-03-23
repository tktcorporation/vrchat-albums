declare global {
  const __SENTRY_RELEASE__: string;
}

// oxlint-disable-next-line require-module-specifiers -- empty export needed for TypeScript module augmentation (declare global)
export type {};
