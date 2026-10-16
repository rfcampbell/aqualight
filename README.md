# AquaLight

Visual editor for Chihiros aquarium light schedules, generating Home Assistant
`automations.yaml` entries. React / TypeScript / Vite frontend, Flask backend.

## Lights

Every light is one entry in a registry rather than a hardcoded branch:

- `src/lights.ts` — the full typed registry (transport, spotlight, header
  strings, storage key, DLI, defaults). This is the file to edit.
- `backend/lights.json` — only the identity the backend also needs (`id`,
  `prefix`, `presetId`). `KNOWN_PREFIXES` and the valid preset devices derive
  from it.
- `src/__tests__/lights.test.ts` — fails if those two disagree.

`prefix` is what the merge keys on: a deploy replaces exactly the entries whose
id starts with the owning light's prefix and leaves every other entry alone.

Every light uses one schedule shape, `RampScheduleState` (`src/types.ts`):
ramp up from `rampUpStart` to a held peak (`peakStart`–`peakEnd`, levels
`peakRgbw`), ramp down to off at `rampDownEnd`, in `stepMinutes` steps. One
editor (`RampEditor`), one generator (`generateRampYaml`). Step *i* of *n*
lands at `rampUpStart + i·step`, so the light reaches peak at `peakStart` and
is off at `rampDownEnd`. Nano and display output is held byte-for-byte against
YAML frozen before spotlight support (`src/utils/__tests__/golden/ramp-*`).

A light with `spotlight` in the registry (only the 100P) also carries
`spotlightBrightness` (brightness_pct), `spotlightLeadMinutes` and
`spotlightTailMinutes`: the spotlight is on from lead-before-ramp-up to
`peakStart`, and from `peakEnd` to tail-after-ramp-down. Deploy is refused
while the waypoints are out of order or a spotlight window crosses midnight
(`rampProblems` in `src/utils/ramp.ts`).

The 100P ran a siesta cycle, then briefly a "solid" mode; both are gone.
`normalizeState` converts a solid-mode snapshot or preset to the ramp shape
and rejects siesta ones. `parity.test.ts` checks the converted 100P against
the automations HA was running on 2026-10-16: identical spotlight, WRGB
ramps one 3-min step later.

### Saved state

- **Browser:** every edit saves the whole schedule under the light's
  `storage.key`. Stored state that doesn't fit is removed on load.
- **HA:** each deploy embeds the schedule as a `# AQUALIGHT_STATE:<prefix>=`
  line in automations.yaml. On open the editor loads that snapshot when it
  exists and fits, otherwise the browser's copy, otherwise registry defaults.
  So undeployed edits are replaced by the deployed schedule on reload once a
  snapshot exists; the Presets bar says which source is showing.
- **PPFD** for the DLI estimate is registry data (`dli`), not editable state.

`transport` selects the command emitter, shared across lights rather than
duplicated per light: `light_entities` (four HA entities, `brightness_pct`),
`mqtt` (flat 0-100 JSON via `mqtt.publish`), `ha_light` (one entity,
`rgbw_color`).

Adding a light means an entry in both files and nothing else.

### Display (WRGB II Pro 90) — wired, not yet tuned

`display` drives `light.dywpro90e2e042ecb9fb_{red,green,blue,white}` (paired in
HA via chihiros-led-control as DYWPRO90E2E042ECB9FB). Its ramp waypoints are
still copied from the nano and its DLI values are unmeasured, all marked `TODO`
in `src/lights.ts`; `dli.todo` is set so nothing mistakes the numbers for
measurements. Remaining: set the real waypoints and measure PPFD.

A registry entry can carry `placeholder: true` (in `backend/lights.json`) while
its entity ids are invented; the backend refuses to deploy it. No light is
currently marked.

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
