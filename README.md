# AquaLight

Visual editor for Chihiros aquarium light schedules, generating Home Assistant
`automations.yaml` entries. React / TypeScript / Vite frontend, Flask backend.

## Lights

Every light is one entry in a registry rather than a hardcoded branch:

- `src/lights.ts` — the full typed registry (transport, schedule kind, header
  strings, storage key, DLI, defaults). This is the file to edit.
- `backend/lights.json` — only the identity the backend also needs (`id`,
  `prefix`, `presetId`). `KNOWN_PREFIXES` and the valid preset devices derive
  from it.
- `src/__tests__/lights.test.ts` — fails if those two disagree.

`prefix` is what the merge keys on: a deploy replaces exactly the entries whose
id starts with the owning light's prefix and leaves every other entry alone.

`scheduleKind` selects the state shape, the editor and the generator:

| kind | shape | editor | generator |
|------|-------|--------|-----------|
| `siesta` | `ScheduleState` — cycling WRGB with optional spotlight fill | Timeline + CycleControls + ChannelEditor | `generateYaml` |
| `ramp` | `NanoScheduleState` — one peak with sunrise/sunset ramps | NanoEditor | `generateNanoYaml` |

`transport` selects the command emitter, shared across lights rather than
duplicated per light: `light_entities` (four HA entities, `brightness_pct`),
`mqtt` (flat 0-100 JSON via `mqtt.publish`), `ha_light` (one entity,
`rgbw_color`).

Adding a light means an entry in both files and nothing else.

## Development

Production and dev run on the same host (robix). They are kept apart by port
and by automations path — dev never reads or writes production state:

|          | production            | dev                                  |
|----------|-----------------------|--------------------------------------|
| frontend | nginx :80 (`aqualight.robix`) | vite :5174 (`127.0.0.1` only) |
| backend  | :5175                 | :5185                                |
| automations | `~/.homeassistant/automations.yaml` | `/tmp/aqualight-dev/automations.yaml` |
| HA calls | enabled via `HA_TOKEN` | none (`HA_TOKEN` empty)             |

```sh
./dev/run-dev.sh            # start both; seeds the scratch file if absent
./dev/run-dev.sh --reseed   # re-copy the live automations.yaml first
```

From another machine, tunnel rather than exposing the dev server:

```sh
ssh -L 5174:127.0.0.1:5174 -L 5185:127.0.0.1:5185 robix
```

### Environment

| var | default | notes |
|-----|---------|-------|
| `AUTOMATIONS_PATH` | `$HA_CONFIG/automations.yaml` | full path to the file the backend merges into |
| `HA_CONFIG` | `~/.homeassistant` | only supplies the `AUTOMATIONS_PATH` default |
| `PORT` | `5175` | backend listen port |
| `PRESETS_DIR` | `backend/presets` | saved preset JSON files |
| `HA_TOKEN` | *(empty)* | empty disables every call to Home Assistant |
| `AQUALIGHT_API` | `http://localhost:5175` | where the vite dev server proxies `/api` |
| `AQUALIGHT_PORT` | `5173` | vite dev server port |

Backups are written next to `AUTOMATIONS_PATH` (5 most recent kept), so dev
backups land in the scratch directory. The backend writes the file directly
when it owns it and falls back to `sudo cp` / `sudo tee` for the root-owned
production file.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
