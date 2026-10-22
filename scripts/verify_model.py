#!/usr/bin/env python3
import json
import hashlib
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
ML = os.path.join(ROOT, 'ml_service')
WEIGHTS = os.path.join(ML, 'weights', 'best.pt')
META = os.path.join(ML, 'model_metadata.json')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest().upper()


def main():
    if not os.path.exists(WEIGHTS):
        print(f'MISSING: {WEIGHTS}')
        sys.exit(1)
    if not os.path.exists(META):
        print(f'MISSING: {META}')
        sys.exit(1)
    meta = json.load(open(META))
    expected = (meta.get('sha256') or '').upper()
    actual = sha256(WEIGHTS)
    print(f'Model: {meta.get("id")} v{meta.get("version")}')
    print(f'Expected: {expected}')
    print(f'Actual:   {actual}')
    print(f'Match:    {expected == actual}')
    if expected != actual:
        sys.exit(2)
    sys.exit(0)


if __name__ == '__main__':
    main()
