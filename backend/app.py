"""
AquaLight backend — serves the React dist and provides the /api/deploy endpoint.
Writes automations.yaml to HA config dir via a sudoed wrapper script.
"""
import glob
import json
import os
import subprocess
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='../dist', static_url_path='')

HA_CONFIG = os.environ.get('HA_CONFIG', os.path.expanduser('~/.homeassistant'))
HA_URL    = os.environ.get('HA_URL',    'http://localhost:8123')
HA_TOKEN  = os.environ.get('HA_TOKEN',  '')

# ── Static serving ────────────────────────────────────────────────────────────

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    full = os.path.join(app.static_folder, path)
    if path and os.path.exists(full):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')

# ── Deploy endpoint ───────────────────────────────────────────────────────────

@app.route('/api/deploy', methods=['POST'])
def deploy():
    data = request.get_json(force=True)
    yaml_content = data.get('yaml', '').strip()
    if not yaml_content:
        return jsonify({'error': 'No YAML provided'}), 400

    automations = os.path.join(HA_CONFIG, 'automations.yaml')

    # Backup via wrapper script (handles sudo file access)
    from datetime import date
    iso = date.today().isoformat()
    backup = os.path.join(HA_CONFIG, f'automations_{iso}.yaml.bak')
    try:
        subprocess.run(['sudo', 'cp', automations, backup], check=True, capture_output=True)
        # Keep last 5 backups
        baks = sorted(glob.glob(os.path.join(HA_CONFIG, 'automations_*.yaml.bak')), reverse=True)
        for old in baks[5:]:
            subprocess.run(['sudo', 'rm', old], capture_output=True)
    except subprocess.CalledProcessError:
        pass  # No existing file or no permission — continue

    # Write new content via sudo tee (safest way to write as another user's file)
    try:
        subprocess.run(
            ['sudo', 'tee', automations],
            input=yaml_content.encode(),
            capture_output=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        return jsonify({'error': f'Write failed: {e.stderr.decode()}'}), 500

    # Reload HA automations via REST API
    reload = _reload_ha()

    return jsonify({'success': True, 'backup': backup, 'reload': reload})


def _reload_ha():
    if not HA_TOKEN:
        return {'status': 'skipped', 'reason': 'HA_TOKEN not set'}
    try:
        import urllib.request
        req = urllib.request.Request(
            f'{HA_URL}/api/services/automation/reload',
            data=b'{}',
            headers={
                'Authorization': f'Bearer {HA_TOKEN}',
                'Content-Type': 'application/json',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return {'status': 'reloaded', 'code': r.status}
    except Exception as e:
        return {'status': 'error', 'reason': str(e)}


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5175))
    app.run(host='0.0.0.0', port=port, debug=False)
