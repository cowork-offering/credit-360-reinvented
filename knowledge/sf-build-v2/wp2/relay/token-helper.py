#!/usr/bin/python3 -I
"""Prints "TOKEN INSTANCE" for the bankinggpt org and nothing else, for c360-relay.
Mints from Banksy's PlatformCLI refresh token. Never logs either half."""
import json, sys, urllib.parse, urllib.request
cfg = {}
for line in open('/opt/brain/secrets/salesforce.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); cfg[k.strip()] = v.strip()
inst = cfg['SF_INSTANCE_URL'].rstrip('/')
body = urllib.parse.urlencode({'grant_type': 'refresh_token', 'client_id': cfg['SF_CLIENT_ID'],
                               'refresh_token': cfg['SF_REFRESH_TOKEN']}).encode()
try:
    with urllib.request.urlopen(urllib.request.Request(inst + '/services/oauth2/token', data=body), timeout=20) as r:
        j = json.loads(r.read())
except Exception as e:
    sys.stderr.write('mint failed: %s\n' % type(e).__name__); sys.exit(2)
print(j['access_token'], j.get('instance_url', inst))
