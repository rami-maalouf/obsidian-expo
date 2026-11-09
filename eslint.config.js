const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  // the website is its own package with its own dependencies
  { ignores: ['dist/**', '.expo/**', 'website/**'] },
]);
