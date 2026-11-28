// Gives oxfmt and oxlint `resolveConfigFromFile` on a `vite-plus` older than 1.5.0.
//
// With `VP_VERSION`, both load `vite.config.*` with `resolveConfigFromFile` of the repo's `vite-plus`
// (since oxc-project/oxc#28801).
// Vite+ runs them at the versions it pins, so the function always exists there.
// But CI runs the latest oxfmt and oxlint with each repo's `vite-plus`, which can be older.
//
// Usage: `NODE_OPTIONS="--import <this file>"`
// - `import("vite-plus")` from oxfmt or oxlint gets `./vite-plus.mjs`
// - It falls back to `resolveConfig`, the API used before oxc-project/oxc#28801
// - A no-op with `vite-plus` >= 1.5.0; remove once every repo is there
import { registerHooks } from "node:module";

const WRAPPER = new URL("./vite-plus.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== "vite-plus") return next(specifier, context);

    const parent = context.parentURL ?? "";
    // The wrapper's own import: resolve from where oxfmt or oxlint imported it
    if (parent.startsWith(`${WRAPPER}?`)) {
      const from = new URL(parent).searchParams.get("from");
      return next(specifier, { ...context, parentURL: from });
    }
    if (/\/node_modules\/(oxfmt|oxlint)\//.test(parent)) {
      return { url: `${WRAPPER}?from=${encodeURIComponent(parent)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
