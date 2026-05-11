"""
AquaLight backend — serves the React dist, deploys automations.yaml, and
provides live device test endpoints for WRGB (MQTT) and Spotlight (HA API).
"""
import glob
import io
import json
import os
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

def _merge_automations(existing_bytes: bytes, incoming_text: str, prefix: str) -> tuple[dict, bytes]:
    """
    Parse existing automations and incoming YAML, then:
    - Validate all incoming IDs start with `prefix`
    - Remove existing entries whose ID starts with `prefix`
    - Preserve all other existing entries (including other known and unknown prefixes)
    - Append incoming entries at the end
    Returns (summary_dict, merged_yaml_bytes).
    """
    ryaml = YAML()
    ryaml.preserve_quotes = True

    existing = ryaml.load(existing_bytes) or []
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

    summary = {
        'kept':    len(kept),
        'removed': len(removed),
        'added':   len(incoming),
    }
    return summary, buf.getvalue()


@app.route('/api/deploy', methods=['POST'])
def deploy():
    data     = request.get_json(force=True)
    yaml_content = data.get('yaml', '').strip()
    prefix   = data.get('prefix', '').strip()
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
        summary, merged_bytes = _merge_automations(existing_bytes, yaml_content, prefix)
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
