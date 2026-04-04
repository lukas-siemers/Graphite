module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Transform import.meta (used by nanoid v5 and other ESM-only packages)
      // so Metro's CommonJS bundler can handle them on web.
      'babel-plugin-transform-import-meta',
    ],
  };
};
