const { existsSync, readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { execSync } = require('node:child_process');

const DEFAULT_CONFIG_FILES = [
  '.oxlintrc.json',
];

function isRelativePath(spec) {
  return typeof spec === 'string' && (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/'));
}

function stripJsonComments(content) {
  // Remove /* ... */ block comments and // line comments
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function parseJsPluginsFromConfig(configPath) {
  if (!existsSync(configPath)) return [];
  try {
    let raw = readFileSync(configPath, 'utf8');
    raw = stripJsonComments(raw);
    const obj = JSON.parse(raw);
    const plugins = obj && Array.isArray(obj.jsPlugins) ? obj.jsPlugins : [];

    const specifiers = [];
    for (const it of plugins) {
      if (!it) continue;
      if (typeof it === 'string') {
        specifiers.push(it);
      } else if (typeof it === 'object' && it !== null) {
        if (typeof it.specifier === 'string') specifiers.push(it.specifier);
        else if (typeof it.name === 'string') specifiers.push(it.name);
      }
    }

    return specifiers;
  } catch (e) {
    console.warn(`Could not parse oxlint config at ${configPath}: ${e.message}`);
    return [];
  }
}

function filterInstallablePlugins(specifiers) {
  // Install only non-relative specifiers that are either:
  // - packages starting with "eslint-plugin-"
  // - scoped packages (start with @) that contain a slash and the substring "plugin"
  return Array.from(new Set(specifiers))
    .filter((s) => typeof s === 'string')
    .filter((s) => !isRelativePath(s))
    .filter((s) => {
      if (/^eslint-plugin-/.test(s)) {
        return true;
      }
      if (/^@/.test(s) && s.includes('/') && s.toLowerCase().includes('plugin')) {
        return true;
      }
      return false;
    });
}

function findConfigPathFromCommand(repoPath, command) {
  // Look for -c <path> or --config <path>
  const m = command.match(/(?:^|\s)-(?:c)\s+([^\s]+)/);
  if (m && m[1]) {
    return resolve(repoPath, m[1]);
  }
  const m2 = command.match(/(?:^|\s)--config\s+([^\s]+)/);
  if (m2 && m2[1]) {
    return resolve(repoPath, m2[1]);
  }
  return null;
}

function findDefaultConfigFile(repoPath) {
  for (const f of DEFAULT_CONFIG_FILES) {
    const p = join(repoPath, f);
    if (existsSync(p)) return p;
  }
  return null;
}

function installPackages(packages, options = {}) {
  const exec = options.exec || execSync;
  const dryRun = options.dryRun || false;
  if (!packages || packages.length === 0) return;
  const cmd = `npm install -g ${packages.join(' ')}`;
  if (dryRun) {
    console.log(`[dryRun] ${cmd}`);
    return;
  }
  console.log(`Installing global npm packages: ${packages.join(', ')}`);
  exec(cmd, { stdio: 'inherit' });
}

function prepareOxlintJsPlugins(repoPath, command) {
  // Prefer explicit -c/--config path
  const configFromCommand = findConfigPathFromCommand(repoPath, command);
  let configPath = null;
  if (configFromCommand && existsSync(configFromCommand)) {
    configPath = configFromCommand;
  } else {
    configPath = findDefaultConfigFile(repoPath);
  }

  if (!configPath) {
    return; // nothing to do
  }

  const specifiers = parseJsPluginsFromConfig(configPath);
  const toInstall = filterInstallablePlugins(specifiers);
  if (toInstall.length === 0) return;

  installPackages(toInstall);
}

module.exports = {
  parseJsPluginsFromConfig,
  filterInstallablePlugins,
  findConfigPathFromCommand,
  findDefaultConfigFile,
  installPackages,
  prepareOxlintJsPlugins,
};
