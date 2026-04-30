const { getDefaultConfig } = require('expo/metro-config');

/** Fallback if package.json still has "react-native" -> src (see scripts/patch-safe-area-context.cjs). */
function safeAreaMain() {
  try {
    return require.resolve('react-native-safe-area-context/lib/commonjs/index.js', { paths: [__dirname] });
  } catch {
    return null;
  }
}

const config = getDefaultConfig(__dirname);

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const mainFile = safeAreaMain();
  if (mainFile && moduleName === 'react-native-safe-area-context') {
    return { type: 'sourceFile', filePath: mainFile };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
