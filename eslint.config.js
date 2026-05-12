import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
// Note: react-refresh plugin removed — was Vite-specific, this is a Next.js project
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // ── Workspace isolation guardrail ────────────────────────────────────────
  // Non-HR workspace folders (src/workspaces/<team>/) are bounded zones:
  //  - They MAY import from src/workspaces/_shared/ (the shared shell).
  //  - They MAY NOT import from another workspace folder.
  //  - They MAY NOT reach into HR Hub code (src/components, src/data,
  //    src/hooks, src/lib, src/services, src/utils, src/App).
  // If a workspace needs a primitive from HR, COPY it into the workspace
  // folder (duplicate, don't generalize) or propose moving it to _shared/.
  // ─────────────────────────────────────────────────────────────────────────
  {
    files: ['src/workspaces/{command-center,payroll,gix}/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '../../App', '../../../App',
              '../../components/**', '../../../components/**',
              '../../data/**', '../../../data/**',
              '../../hooks/**', '../../../hooks/**',
              '../../lib/**', '../../../lib/**',
              '../../services/**', '../../../services/**',
              '../../utils/**', '../../../utils/**',
            ],
            message: 'Workspace modules cannot import from HR Hub code (src/components, src/data, src/lib, etc.). Copy the primitive into your workspace folder, or propose moving it to src/workspaces/_shared/.',
          },
          {
            group: [
              '../command-center/**', '../payroll/**', '../gix/**',
              '../../command-center/**', '../../payroll/**', '../../gix/**',
            ],
            message: 'Workspace modules cannot import from another workspace folder. Each team owns its own code.',
          },
        ],
      }],
    },
  },
])
