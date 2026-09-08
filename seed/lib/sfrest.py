"""REST plumbing shared by the seed, verify and cleanup scripts.

THE TOKEN NEVER LEAVES THE ENVIRONMENT. It is read from os.environ on every
call, never stored on an object, never printed, never written to a manifest and
never passed on a command line:

    read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST

Every failure carries the org's own message. A seeding agent reading a stack
trace needs the validation rule's words, not a status code.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

V = 'v62.0'


class SfError(Exception):
    """An HTTP-level failure. `body` is the org's own response, verbatim."""

    def __init__(self, method, path, code, body):
        self.code = code
        self.body = body
        super().__init__(f'{method} {path.split("?")[0]} -> {code}\n{body[:2000]}')


def call(method, path, body=None, retries=3):
    tok, inst = os.environ['TOK'], os.environ['INST']
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        inst + path, method=method,
        headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'},
        data=data)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            text = e.read().decode('utf-8', 'replace')
            # UNABLE_TO_LOCK_ROW and the request limits are the org being busy,
            # not the payload being wrong. Everything else is ours to fix.
            transient = e.code in (500, 503) or 'UNABLE_TO_LOCK_ROW' in text or 'REQUEST_LIMIT' in text
            if transient and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise SfError(method, path, e.code, text)
        except urllib.error.URLError as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise SfError(method, path, 0, str(e))


def q(soql):
    """Every page of a query, not the first two thousand rows of it."""
    out = []
    res = call('GET', f'/services/data/{V}/query?q=' + urllib.parse.quote(soql))
    out.extend(res['records'])
    while not res.get('done') and res.get('nextRecordsUrl'):
        res = call('GET', res['nextRecordsUrl'])
        out.extend(res['records'])
    return out


def q_ids(soql):
    return [r['Id'] for r in q(soql)]


def describe(obj):
    return call('GET', f'/services/data/{V}/sobjects/{obj}/describe')


def soql_in(ids):
    """An IN list, or a literal that matches nothing, because f-string building
    an empty `IN ()` is a syntax error the org reports as a malformed query."""
    return "('" + "','".join(ids) + "')" if ids else "('000000000000000AAA')"


def create(obj, records, all_or_none=False):
    """Composite create, 200 at a time. Returns (ids, errors).

    allOrNone defaults to FALSE on purpose: a seeding run that dies on record 4
    of 40 leaves a manifest that can be cleaned, and the caller decides whether
    a partial batch is fatal. Errors come back per record with the index of the
    input row, so a brief can name the row that was refused.
    """
    ids, errors = [], []
    for start in range(0, len(records), 200):
        chunk = records[start:start + 200]
        payload = [dict(r, attributes={'type': obj}) for r in chunk]
        res = call('POST', f'/services/data/{V}/composite/sobjects',
                   {'allOrNone': all_or_none, 'records': payload})
        for offset, r in enumerate(res):
            if r.get('success'):
                ids.append(r['id'])
            else:
                ids.append(None)
                errors.append({'object': obj, 'index': start + offset,
                               'record': chunk[offset], 'errors': r.get('errors')})
    return ids, errors


def update(obj, records):
    """Composite patch. Records must carry Id. Returns errors only."""
    errors = []
    for start in range(0, len(records), 200):
        chunk = records[start:start + 200]
        payload = [dict(r, attributes={'type': obj}) for r in chunk]
        res = call('PATCH', f'/services/data/{V}/composite/sobjects',
                   {'allOrNone': False, 'records': payload})
        for offset, r in enumerate(res):
            if not r.get('success'):
                errors.append({'object': obj, 'index': start + offset,
                               'record': chunk[offset], 'errors': r.get('errors')})
    return errors


def delete(ids, all_or_none=False):
    """Composite delete, 200 at a time. Returns (deleted_ids, errors)."""
    done, errors = [], []
    for start in range(0, len(ids), 200):
        chunk = ids[start:start + 200]
        res = call('DELETE',
                   f'/services/data/{V}/composite/sobjects?ids=' + ','.join(chunk)
                   + f'&allOrNone={"true" if all_or_none else "false"}')
        for offset, r in enumerate(res):
            if r.get('success'):
                done.append(chunk[offset])
            else:
                errors.append({'id': chunk[offset], 'errors': r.get('errors')})
    return done, errors


def invoke(apex_class, inputs):
    """One of the org's own @InvocableMethod read tools, called the way the
    connector calls it. Returns the first row's outputValues."""
    res = call('POST', f'/services/data/{V}/actions/custom/apex/{apex_class}',
               {'inputs': inputs})
    row = res[0]
    if not row.get('isSuccess'):
        raise SfError('POST', apex_class, 200, json.dumps(row.get('errors')))
    return row['outputValues']
