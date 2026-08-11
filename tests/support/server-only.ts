// Test stub for the `server-only` package.
//
// The real `server-only` module throws unless it is resolved through the React
// Server Components condition. Under Vitest (plain Node) that condition is not
// active, so importing a server-only application module would throw at import
// time. Aliasing `server-only` to this empty module lets tests import and
// exercise server-only code (e.g. the transaction helper) without weakening the
// production guard, which still applies in the real Next.js build.
export {};
