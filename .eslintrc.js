module.exports = {
  env: {
    es2021: true
  },
  extends: [
    'standard-with-typescript'
  ],
  overrides: [
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.json'
  },
  ignorePatterns: ['dist', 'src/reportWebVitals.ts'],
  rules: {
    '@typescript-eslint/semi': 'off',
    '@typescript-eslint/no-dynamic-delete': 'off',
    '@typescript-eslint/comma-dangle': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/consistent-type-imports': 'off'
  }
}
