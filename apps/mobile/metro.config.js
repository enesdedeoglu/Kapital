// Monorepo: Metro hem paket kökünü hem depo kökünü izlemeli, yoksa workspace
// bağımlılıkları (@kapital/shared) ve pnpm'in kök node_modules'ü çözülmez.
//
// ★ disableHierarchicalLookup KULLANILMIYOR: pnpm sembolik bağ kurar ve
// hiyerarşik aramayı kapatmak paket çözümünü kırıyor (bundle isteği yanıtsız
// kalıyordu, /status 200 dönse bile).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
