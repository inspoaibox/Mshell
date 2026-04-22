/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  root: true,
  extends: [
    'plugin:vue/vue3-essential',
    'eslint:recommended',
    '@vue/eslint-config-typescript',
    '@vue/eslint-config-prettier/skip-formatting'
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-useless-escape': 'off',
    'no-control-regex': 'off',
    'no-empty': 'warn',
    'no-unused-vars': 'warn',
    'no-constant-condition': 'warn',
    'no-undef': 'warn',
    'no-async-promise-executor': 'warn',
    'no-inner-declarations': 'warn',
    'vue/no-dupe-keys': 'warn',
    'no-case-declarations': 'warn',
    'vue/no-side-effects-in-computed-properties': 'warn'
  }
}
