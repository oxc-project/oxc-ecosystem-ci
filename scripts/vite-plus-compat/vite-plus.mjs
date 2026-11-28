// See `./register.mjs`
import * as vitePlus from "vite-plus";

export * from "vite-plus";

export const resolveConfigFromFile =
  vitePlus.resolveConfigFromFile ??
  ((path) => vitePlus.resolveConfig({ configFile: path }, "build"));
