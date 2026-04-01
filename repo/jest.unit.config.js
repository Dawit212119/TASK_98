module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/unit_tests'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverage: false,
  verbose: true
};
