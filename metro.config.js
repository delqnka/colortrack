const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** Metro prefers package.json's "react-native" -> src/index.tsx; broken installs often omit `src/`. `lib/commonjs` is always published. */
const SAFE_AREA_MAIN = path.join(
  __dirname,
  'node_modules',
  'react-native-safe-area-context',
  'lib',
  'commonjs',
  'index.js',
);

const config = getDefaultConfig(__dirname);

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-safe-area-context') {
    return { type: 'sourceFile', filePath: SAFE_AREA_MAIN };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
