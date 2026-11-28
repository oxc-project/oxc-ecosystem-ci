// Gives oxfmt and oxlint `resolveConfigFromFile` on a `vite-plus` older than 1.5.0.
//
// With `VP_VERSION`, both call it to load `vite.config.*` (since oxc-project/oxc#28801).
// Vite+ pins the oxfmt and oxlint it runs, but CI pairs the latest ones with each repo's `vite-plus`.
//
// Usage: `NODE_OPTIONS="--import <this file>"`
// - `import("vite-plus")` from oxfmt or oxlint gets `./vite-plus.mjs`,
//   which falls back to `resolveConfig`, the API used before that PR
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
