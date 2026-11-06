"""Verify a sidecar's selected inventory against its source manifest.

Legacy manifests have no stationInventory metadata and remain supported.
Once metadata exists, both filename and complete SHA256 are mandatory.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re


def verify_inventory_provenance(manifest: dict, inventory: Path | None,
                                context: str = 'inventory') -> bool:
    meta = manifest.get('meta', {})
    if 'stationInventory' not in meta:
        return False
    prefix = f'Inventory provenance ({context}): '
    declared = meta['stationInventory']
    if not isinstance(declared, dict):
        raise ValueError(prefix+'stationInventory metadata must contain file and sha256')
    filename, digest = declared.get('file'), declared.get('sha256')
    if (not isinstance(filename, str) or not filename or
            not isinstance(digest, str) or re.fullmatch(r'[0-9a-fA-F]{64}', digest) is None):
        raise ValueError(prefix+'stationInventory file/sha256 metadata is incomplete')
    if inventory is None:
        raise ValueError(prefix+'no inventory file was selected')
    inventory = Path(inventory)
    if filename != inventory.name:
        raise ValueError(prefix+'selected file does not match the source manifest')
    if not inventory.is_file():
        raise ValueError(prefix+'selected file does not exist')
    sha = hashlib.sha256()
    with inventory.open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            sha.update(block)
    if sha.hexdigest() != digest.lower():
        raise ValueError(prefix+'selected file sha256 does not match the source manifest')
    return True
