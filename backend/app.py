"""
AquaLight backend — serves the React dist, deploys automations.yaml, and
provides live device test endpoints for WRGB (MQTT) and Spotlight (HA API).
"""
import glob
import io
import json
import os
import re
import subprocess
import urllib.request
from datetime import date
from ruamel.yaml import YAML
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='../dist', static_url_path='')

HA_CONFIG  = os.environ.get('HA_CONFIG',  os.path.expanduser('~/.homeassistant'))
HA_URL     = os.environ.get('HA_URL',     'http://localhost:8123')
HA_TOKEN   = os.environ.get('HA_TOKEN',   '')
MQTT_HOST  = os.environ.get('MQTT_HOST',  'localhost')
MQTT_PORT  = int(os.environ.get('MQTT_PORT', 1883))
MQTT_TOPIC      = os.environ.get('MQTT_TOPIC',      'chihiros/light/set')
MQTT_TOPIC_NANO = os.environ.get('MQTT_TOPIC_NANO', 'chihiros/nano/light/set')
SPOT_ENTITY     = os.environ.get('SPOT_ENTITY',     'light.aquarium_spotlight')
PRESETS_DIR     = os.environ.get('PRESETS_DIR',     os.path.join(os.path.dirname(__file__), 'presets'))

# ── Static serving ─────────────────────────────────────────────────────────────

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    full = os.path.join(app.static_folder, path)
    if path and os.path.exists(full):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')

# ── Deploy ─────────────────────────────────────────────────────────────────────

KNOWN_PREFIXES = ['aquarium_', 'nano_']

# State comment marker. One line per prefix, kept at the top of automations.yaml.
# Format: # AQUALIGHT_STATE:{prefix}={compact json}
_STATE_LINE_RE = re.compile(rb'^# AQUALIGHT_STATE:([a-z_]+)=(.*)$', re.MULTILINE)


def _strip_state_lines(text: bytes) -> bytes:
    """Remove all AQUALIGHT_STATE comment lines from the given bytes."""
    return _STATE_LINE_RE.sub(b'', text).lstrip(b'\n')


def _extract_state_lines(text: bytes) -> dict:
    """Return {prefix: state_dict} for every AQUALIGHT_STATE line found."""
    out = {}
    for m in _STATE_LINE_RE.finditer(text):
        prefix = m.group(1).decode()
        try:
            out[prefix] = json.loads(m.group(2).decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
    return out


def _prepend_state_line(text: bytes, prefix: str, state: dict, existing_states: dict) -> bytes:
    """Prepend one state line per known prefix so cross-device state persists."""
    merged_states = {**existing_states, prefix: state}
    lines = []
    for pfx, st in merged_states.items():
        payload = json.dumps(st, separators=(',', ':'))
        lines.append(f"# AQUALIGHT_STATE:{pfx}={payload}\n".encode())
    return b''.join(lines) + text


def _merge_automations(
    existing_bytes: bytes,
    incoming_text: str,
    prefix: str,
    state: dict | None = None,
) -> tuple[dict, bytes]:
    """
    Parse existing automations and incoming YAML, then:
    - Validate all incoming IDs start with `prefix`
    - Remove existing entries whose ID starts with `prefix`
    - Preserve all other existing entries (including other known and unknown prefixes)
    - Append incoming entries at the end
    - If `state` is given, embed it as a top-of-file AQUALIGHT_STATE comment
      (replacing any prior line for the same prefix, preserving lines for other prefixes)
    Returns (summary_dict, merged_yaml_bytes).
    """
    ryaml = YAML()
    ryaml.preserve_quotes = True

    prior_states = _extract_state_lines(existing_bytes)
    stripped = _strip_state_lines(existing_bytes)

    existing = ryaml.load(stripped) or []
    incoming = ryaml.load(incoming_text) or []

    for item in incoming:
        aid = str(item.get('id', ''))
        if not aid.startswith(prefix):
            raise ValueError(f"Incoming id '{aid}' does not start with declared prefix '{prefix}'")

    kept    = [item for item in existing if not str(item.get('id', '')).startswith(prefix)]
    removed = [str(item.get('id', '')) for item in existing if str(item.get('id', '')).startswith(prefix)]
    merged  = kept + list(incoming)

    buf = io.BytesIO()
    ryaml.dump(merged, buf)
    out = buf.getvalue()

    if state is not None:
        out = _prepend_state_line(out, prefix, state, prior_states)
    elif prior_states:
        # No new state provided but keep any pre-existing state lines intact.
        lines = b''.join(
            f"# AQUALIGHT_STATE:{p}={json.dumps(s, separators=(',', ':'))}\n".encode()
            for p, s in prior_states.items()
        )
        out = lines + out

    summary = {
        'kept':    len(kept),
        'removed': len(removed),
        'added':   len(incoming),
    }
    return summary, out


@app.route('/api/deploy', methods=['POST'])
def deploy():
    data     = request.get_json(force=True)
    yaml_content = data.get('yaml', '').strip()
    prefix   = data.get('prefix', '').strip()
    state    = data.get('state')  # optional; if present, embedded in top-of-file comment
    dry_run  = bool(data.get('dry_run', False))

    if not yaml_content:
        return jsonify({'error': 'No YAML provided'}), 400
    if prefix not in KNOWN_PREFIXES:
        return jsonify({'error': f"Unknown prefix '{prefix}'. Must be one of: {KNOWN_PREFIXES}"}), 400

    automations = os.path.join(HA_CONFIG, 'automations.yaml')
    iso    = date.today().isoformat()
    backup = os.path.join(HA_CONFIG, f'automations_{iso}.yaml.bak')

    try:
        result = subprocess.run(['sudo', 'cat', automations], capture_output=True, check=True)
        existing_bytes = result.stdout
    except Exception:
        existing_bytes = b'[]\n'

    try:
        summary, merged_bytes = _merge_automations(existing_bytes, yaml_content, prefix, state)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if dry_run:
        return jsonify({'dry_run': True, **summary})

    # Backup before writing
    try:
        subprocess.run(['sudo', 'cp', automations, backup], check=True, capture_output=True)
        baks = sorted(glob.glob(os.path.join(HA_CONFIG, 'automations_*.yaml.bak')), reverse=True)
        for old in baks[5:]:
            subprocess.run(['sudo', 'rm', old], capture_output=True)
    except subprocess.CalledProcessError:
        pass

    try:
        subprocess.run(
            ['sudo', 'tee', automations],
            input=merged_bytes,
            capture_output=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        return jsonify({'error': f'Write failed: {e.stderr.decode()}'}), 500

    return jsonify({'success': True, 'backup': backup, **summary, 'reload': _reload_ha()})


def _reload_ha():
    if not HA_TOKEN:
        return {'status': 'skipped', 'reason': 'HA_TOKEN not set'}
    return _ha_call('POST', '/api/services/automation/reload', {})


# ── HA state read ──────────────────────────────────────────────────────────────

@app.route('/api/ha/state')
def get_ha_state():
    """
    Return the AQUALIGHT_STATE snapshot embedded in HA's automations.yaml.
    Query params:
      prefix — 'aquarium_' or 'nano_'; if omitted, returns all found.
    """
    prefix = request.args.get('prefix', '').strip()
    automations = os.path.join(HA_CONFIG, 'automations.yaml')
    try:
        result = subprocess.run(['sudo', 'cat', automations], capture_output=True, check=True)
        existing_bytes = result.stdout
    except Exception as e:
        return jsonify({'exists': False, 'error': str(e)}), 200

    states = _extract_state_lines(existing_bytes)
    if not prefix:
        return jsonify({'exists': bool(states), 'states': states})

    if prefix in states:
        return jsonify({'exists': True, 'state': states[prefix]})
    return jsonify({'exists': False})


# ── Presets ────────────────────────────────────────────────────────────────────

_NAME_RE = re.compile(r'^[A-Za-z0-9_\- ]{1,64}$')


def _preset_path(name: str) -> str:
    return os.path.join(PRESETS_DIR, name + '.json')


@app.route('/api/presets', methods=['GET'])
def list_presets():
    if not os.path.isdir(PRESETS_DIR):
        return jsonify({'presets': []})
    items = []
    for fname in sorted(os.listdir(PRESETS_DIR)):
        if not fname.endswith('.json'):
            continue
        path = os.path.join(PRESETS_DIR, fname)
        try:
            with open(path) as f:
                data = json.load(f)
            items.append({
                'name':     data.get('name', fname[:-5]),
                'device':   data.get('device', 'biotope'),
                'saved_at': data.get('saved_at', ''),
            })
        except (OSError, json.JSONDecodeError):
            continue
    return jsonify({'presets': items})


@app.route('/api/presets', methods=['POST'])
def save_preset():
    data   = request.get_json(force=True)
    name   = str(data.get('name', '')).strip()
    device = str(data.get('device', '')).strip()
    state  = data.get('state')

    if not _NAME_RE.match(name):
        return jsonify({'error': 'Invalid name (letters, digits, space, - and _ only; max 64 chars)'}), 400
    if device not in ('biotope', 'nano'):
        return jsonify({'error': "device must be 'biotope' or 'nano'"}), 400
    if not isinstance(state, dict):
        return jsonify({'error': 'state must be an object'}), 400

    os.makedirs(PRESETS_DIR, exist_ok=True)
    payload = {
        'name':     name,
        'device':   device,
        'state':    state,
        'saved_at': date.today().isoformat(),
    }
    with open(_preset_path(name), 'w') as f:
        json.dump(payload, f, indent=2)

    return jsonify({'ok': True, 'name': name})


@app.route('/api/presets/<name>', methods=['GET'])
def get_preset(name: str):
    if not _NAME_RE.match(name):
        return jsonify({'error': 'Invalid name'}), 400
    path = _preset_path(name)
    if not os.path.exists(path):
        return jsonify({'error': 'Not found'}), 404
    with open(path) as f:
        return jsonify(json.load(f))


@app.route('/api/presets/<name>', methods=['DELETE'])
def delete_preset(name: str):
    if not _NAME_RE.match(name):
        return jsonify({'error': 'Invalid name'}), 400
    path = _preset_path(name)
    if not os.path.exists(path):
        return jsonify({'error': 'Not found'}), 404
    os.remove(path)
    return jsonify({'ok': True})

# ── Device test ────────────────────────────────────────────────────────────────

@app.route('/api/test/wrgb', methods=['POST'])
def test_wrgb():
    data  = request.get_json(force=True)
    state = data.get('state', 'ON').upper()
    if state == 'ON':
        payload = json.dumps({
            'state': 'ON',
            'red':   int(data.get('r', 50)),
            'green': int(data.get('g', 50)),
            'blue':  int(data.get('b', 50)),
            'white': int(data.get('w', 50)),
        })
    else:
        payload = json.dumps({'state': 'OFF'})

    result = _mqtt_publish(MQTT_TOPIC, payload)
    return jsonify(result)


@app.route('/api/test/nano', methods=['POST'])
def test_nano():
    data  = request.get_json(force=True)
    state = data.get('state', 'ON').upper()
    if state == 'ON':
        payload = json.dumps({
            'state': 'ON',
            'red':   int(data.get('r', 0)),
            'green': int(data.get('g', 0)),
            'blue':  int(data.get('b', 0)),
            'white': int(data.get('w', 0)),
        })
    else:
        payload = json.dumps({'state': 'OFF'})

    result = _mqtt_publish(MQTT_TOPIC_NANO, payload)
    return jsonify(result)


@app.route('/api/test/spotlight', methods=['POST'])
def test_spotlight():
    data  = request.get_json(force=True)
    state = data.get('state', 'ON').upper()

    if state == 'ON':
        brightness = int(data.get('brightness', 70))
        result = _ha_call('POST', '/api/services/light/turn_on', {
            'entity_id': SPOT_ENTITY,
            'brightness_pct': brightness,
        })
    else:
        result = _ha_call('POST', '/api/services/light/turn_off', {
            'entity_id': SPOT_ENTITY,
        })

    return jsonify(result)


@app.route('/api/test/light', methods=['POST'])
def test_light():
    """
    Generic HA light service caller. Used by the WRGB four-entity test path.
    Body: { entity_id: str, state: 'ON'|'OFF', brightness_pct?: int }
    """
    data      = request.get_json(force=True)
    entity_id = data.get('entity_id')
    state     = data.get('state', 'ON').upper()
    if not entity_id:
        return jsonify({'ok': False, 'error': 'entity_id required'}), 400

    if state == 'ON':
        brightness = int(data.get('brightness_pct', 100))
        if brightness <= 0:
            result = _ha_call('POST', '/api/services/light/turn_off', {'entity_id': entity_id})
        else:
            result = _ha_call('POST', '/api/services/light/turn_on', {
                'entity_id': entity_id,
                'brightness_pct': brightness,
            })
    else:
        result = _ha_call('POST', '/api/services/light/turn_off', {'entity_id': entity_id})

    return jsonify(result)


# ── Entity registry ────────────────────────────────────────────────────────────

REJECT_SUFFIXES = (
    '_auto_off_enabled',
    '_auto_update_enabled',
    '_led',
    '_power_protection',
    '_overheat_protection',
    '_undervoltage_protection',
    '_overcurrent_protection',
)

import re as _re
_REJECT_ENABLED_RE = _re.compile(r'_[a-z_]+_enabled$')


def _is_feature_toggle(entity_id: str) -> bool:
    if any(entity_id.endswith(s) for s in REJECT_SUFFIXES):
        return True
    if _REJECT_ENABLED_RE.search(entity_id):
        return True
    return False


@app.route('/api/entities')
def list_entities():
    """
    Returns switch entities from HA, filtered to remove feature toggles.
    Query params:
      domain  — comma-separated HA domains to fetch (default: switch)
      raw     — if '1', include feature toggles in results
    """
    domains = request.args.get('domain', 'switch').split(',')
    include_raw = request.args.get('raw', '0') == '1'

    if not HA_TOKEN:
        return jsonify({'error': 'HA_TOKEN not configured'}), 503

    results = []
    for domain in domains:
        domain = domain.strip()
        resp = _ha_call('GET', f'/api/states', {})
        if not resp.get('ok'):
            return jsonify({'error': resp.get('error', 'HA API error')}), 502
        break  # _ha_call doesn't handle GET body; fetch all states once below

    # Fetch all states in one request
    try:
        req = urllib.request.Request(
            f'{HA_URL}/api/states',
            headers={
                'Authorization': f'Bearer {HA_TOKEN}',
                'Content-Type': 'application/json',
            },
            method='GET',
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            all_states = json.loads(r.read())
    except Exception as e:
        return jsonify({'error': str(e)}), 502

    for state in all_states:
        entity_id = state.get('entity_id', '')
        domain_part = entity_id.split('.')[0] if '.' in entity_id else ''
        if domain_part not in domains:
            continue

        attrs = state.get('attributes', {})
        entity = {
            'entity_id': entity_id,
            'friendly_name': attrs.get('friendly_name', ''),
            'device_class': attrs.get('device_class', ''),
            'original_device_class': attrs.get('original_device_class', ''),
            'state': state.get('state', ''),
            'is_feature_toggle': _is_feature_toggle(entity_id),
        }
        if include_raw or not entity['is_feature_toggle']:
            results.append(entity)

    results.sort(key=lambda e: e['entity_id'])
    return jsonify({'entities': results, 'count': len(results)})


# ── Helpers ────────────────────────────────────────────────────────────────────

def _mqtt_publish(topic, payload):
    try:
        import paho.mqtt.publish as mqtt_pub
        mqtt_pub.single(topic, payload=payload, hostname=MQTT_HOST, port=MQTT_PORT)
        return {'ok': True, 'topic': topic, 'payload': payload}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _ha_call(method, path, body):
    if not HA_TOKEN:
        return {'ok': False, 'error': 'HA_TOKEN not set in .env'}
    try:
        req = urllib.request.Request(
            f'{HA_URL}{path}',
            data=json.dumps(body).encode(),
            headers={
                'Authorization': f'Bearer {HA_TOKEN}',
                'Content-Type': 'application/json',
            },
            method=method,
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            return {'ok': True, 'status': r.status}
    except Exception as e:
        return {'ok': False, 'error': str(e)}



if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5175))
    app.run(host='0.0.0.0', port=port, debug=False)
