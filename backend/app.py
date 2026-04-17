"""
AquaLight backend — serves the React dist, deploys automations.yaml, and
provides live device test endpoints for WRGB (MQTT) and Spotlight (HA API).
"""
import glob
import json
import os
import subprocess
import urllib.request
from datetime import date
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

@app.route('/api/deploy', methods=['POST'])
def deploy():
    data = request.get_json(force=True)
    yaml_content = data.get('yaml', '').strip()
    if not yaml_content:
        return jsonify({'error': 'No YAML provided'}), 400

    automations = os.path.join(HA_CONFIG, 'automations.yaml')
    iso    = date.today().isoformat()
    backup = os.path.join(HA_CONFIG, f'automations_{iso}.yaml.bak')

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
            input=yaml_content.encode(),
            capture_output=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        return jsonify({'error': f'Write failed: {e.stderr.decode()}'}), 500

    return jsonify({'success': True, 'backup': backup, 'reload': _reload_ha()})


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
