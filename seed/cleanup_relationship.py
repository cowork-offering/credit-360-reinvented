#!/usr/bin/env python3
"""Remove exactly the records one manifest holds, and nothing else.

    read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST
    python3 seed/cleanup_relationship.py <slug> --dry-run
    python3 seed/cleanup_relationship.py <slug> --confirm <slug>

THE ONLY SOURCE OF TRUTH IS THE MANIFEST. This script never queries "everything
that looks seeded" and never deletes by tag. It reads ids, resolves each one,
and refuses any id that is not in the file it was handed. An id passed on the
command line is not a thing this script accepts.

ORDER IS THE MANIFEST'S OWN, REVERSED. seed_relationship.py appends every id in
creation order, so walking that list backwards is by construction a safe
dependency order: nothing is deleted before the rows that point at it.

--dry-run resolves every id against the org first and prints what would go,
including anything already gone. Nothing is deleted without --confirm <slug>,
because the one gesture this script must never make by accident is the real one.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
from sfrest import SfError, delete, q, soql_in  # noqa: E402

# nCino mints these beside our records and they must go with them, ahead of the
# rows they hang off. They are in the manifest's `derived` block, never inferred.
DERIVED_FIRST = ['LLC_BI__Loan_Collateral_Aggregate__c', 'LLC_BI__Loan_Detail__c',
                 'LLC_BI__Connection__c']


def grouped(entries):
    """The manifest order, reversed, collapsed into consecutive same-object runs
    so each run is one composite call and the ordering between runs is kept."""
    runs = []
    for e in reversed(entries):
        if runs and runs[-1][0] == e['object']:
            runs[-1][1].append(e['id'])
        else:
            runs.append((e['object'], [e['id']]))
    return runs


def resolve(obj, ids):
    """Which of these ids the org still holds. A missing id is not an error: a
    half-run, a re-run and a partial cleanup all produce them."""
    if not ids:
        return set()
    try:
        return {r['Id'] for r in q(f'SELECT Id FROM {obj} WHERE Id IN {soql_in(ids)}')}
    except SfError as e:
        print(f'  {obj}: NOT QUERYABLE {e.code}')
        return set()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('slug')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--confirm', help='repeat the slug to actually delete')
    ap.add_argument('--manifest-dir', default=os.path.join(HERE, 'manifests'))
    args = ap.parse_args()

    if not args.dry_run and args.confirm != args.slug:
        raise SystemExit('refusing to delete without --confirm ' + args.slug
                         + '  (or pass --dry-run)')

    path = os.path.join(args.manifest_dir, f'{args.slug}.json')
    with open(path) as f:
        man = json.load(f)
    print(f'manifest {path}')
    print(f'relationship {man.get("relationship")}  account {man.get("account")}')

    # THE DERIVED ROWS GO FIRST, and only the ones this manifest wrote down. A
    # pledge cannot be deleted while its aggregate expects it and an aggregate
    # nobody recorded is somebody else's record.
    plan = []
    for obj in DERIVED_FIRST:
        ids = man.get('derived', {}).get(obj, [])
        if ids:
            plan.append((obj, ids, 'org-minted'))
    for obj, ids in grouped(man.get('order', [])):
        plan.append((obj, ids, 'seeded'))

    total, alive_total = 0, 0
    resolved = []
    for obj, ids, kind in plan:
        alive = resolve(obj, ids)
        resolved.append((obj, ids, alive, kind))
        total += len(ids)
        alive_total += len(alive)
        gone = len(ids) - len(alive)
        print(f'  {obj:44s} {len(alive):4d} live'
              + (f'  ({gone} already gone)' if gone else '') + f'   [{kind}]')

    print(f'\n{alive_total} records to delete, {total - alive_total} already gone, '
          f'{total} in the manifest')

    if args.dry_run:
        print('\ndry run: nothing was deleted. Re-run with --confirm ' + args.slug)
        return

    print()
    removed, failures = 0, []
    for obj, ids, alive, _kind in resolved:
        live = [i for i in ids if i in alive]
        if not live:
            continue
        done, errs = delete(live)
        # ENTITY_IS_DELETED IS SUCCESS, NOT FAILURE. A master-detail parent takes its
        # children with it (an aggregate cascades its pledges) and a connection takes
        # its reciprocal, so by the time the reversed order reaches a child it can
        # already be gone. Reporting that as thirteen refusals hid a clean cleanup
        # behind a non-zero exit on the first proof run.
        cascaded = [e for e in errs
                    if any(x.get('statusCode') == 'ENTITY_IS_DELETED' for x in e['errors'])]
        errs = [e for e in errs if e not in cascaded]
        removed += len(done) + len(cascaded)
        for e in errs:
            failures.append({'object': obj, **e})
        print(f'  {obj:44s} deleted {len(done)}/{len(live)}'
              + (f'  ({len(cascaded)} already cascaded)' if cascaded else '')
              + (f'  {len(errs)} REFUSED' if errs else ''))
        for e in errs[:5]:
            print(f'      {e["id"]}: {json.dumps(e["errors"])[:250]}')

    # THE AGGREGATE SWEEP, and its fence. Deleting a pledge can mint a fresh
    # aggregate on the way out, so the manifest's aggregate list can be stale by
    # the time we reach it. Only aggregates that belong to a loan THIS manifest
    # created are swept, so an orphan from somebody else's run is left alone.
    our_loans = list(man.get('records', {}).get('LLC_BI__Loan__c', {}).values())
    if our_loans:
        stragglers = q(f'SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM '
                       f'LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c IN '
                       f'{soql_in(our_loans)}')
        leftover = sorted({s['LLC_BI__Loan_Collateral_Aggregate__c'] for s in stragglers
                           if s['LLC_BI__Loan_Collateral_Aggregate__c']})
        if leftover:
            done, errs = delete(leftover)
            print(f'  {"aggregate sweep (our loans only)":44s} deleted {len(done)}/{len(leftover)}')
            removed += len(done)

    man['cleanedAt'] = __import__('datetime').datetime.now(
        __import__('datetime').timezone.utc).isoformat(timespec='seconds')
    man['cleanupRemoved'] = removed
    man['cleanupFailures'] = failures
    with open(path, 'w') as f:
        json.dump(man, f, indent=2)

    print(f'\nremoved {removed} records')
    if failures:
        print(f'{len(failures)} REFUSED - the manifest keeps them; re-run to retry')
        sys.exit(1)
    left = sum(len(resolve(o, i)) for o, i, _, _ in resolved)
    print(f'still resolvable from this manifest: {left}')
    if left:
        sys.exit(1)
    print('the relationship is gone. The manifest is kept as the receipt.')


if __name__ == '__main__':
    main()
