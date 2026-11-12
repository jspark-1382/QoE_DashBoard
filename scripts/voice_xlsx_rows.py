"""Stream projected CDR cells while retaining physical row numbers and row identity."""
from __future__ import annotations

import hashlib
import json
import zipfile

try:
    from lxml import etree as ET
except ImportError:
    from xml.etree import ElementTree as ET

from openpyxl.utils.datetime import from_excel, MAC_EPOCH, WINDOWS_EPOCH
from mdt_pipeline import NS, _sheet_path

TIME_COLUMNS = {'4. START TIME', '5. END TIME'}


def elements(source, tag):
    if ET.__name__.startswith('lxml'):
        return ET.iterparse(source, events=('end',), tag=tag)
    return ((event, node) for event, node in ET.iterparse(source, events=('end',)) if node.tag == tag)


def cdr_rows(path, required, columns):
    """Yield (sheet row, projected values, full-source-row SHA256).

    Numeric Excel timestamps use the workbook epoch and millisecond rounding,
    just as openpyxl does. Contract identifiers remain original cell text.
    The fingerprint includes every header column, not only displayed columns.
    """
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            with archive.open('xl/sharedStrings.xml') as source:
                for _, node in elements(source, NS + 'si'):
                    if node.tag == NS + 'si':
                        strings.append(''.join(t.text or '' for t in node.iter(NS + 't')))
                        node.clear()
                        if hasattr(node, 'getparent'):
                            while node.getprevious() is not None:
                                del node.getparent()[0]
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        properties = workbook.find(NS + 'workbookPr')
        epoch = MAC_EPOCH if properties is not None and properties.get('date1904') in ('1', 'true') else WINDOWS_EPOCH
        headers = None
        with archive.open(_sheet_path(archive)) as source:
            for _, node in elements(source, NS + 'row'):
                if node.tag != NS + 'row':
                    continue
                row_number = int(node.get('r'))
                values = {}
                kinds = {}
                for cell in node:
                    column = ''.join(c for c in cell.get('r', '') if c.isalpha())
                    kind = cell.get('t')
                    value = cell.findtext(NS + 'v', default='')
                    if kind == 's' and value:
                        value = strings[int(value)]
                    elif kind == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.iter(NS + 't'))
                    values[column] = value or ''
                    kinds[column] = kind
                node.clear()
                if hasattr(node, 'getparent'):
                    while node.getprevious() is not None:
                        del node.getparent()[0]
                if headers is None:
                    headers = {col: str(value).strip() for col, value in values.items() if str(value).strip()}
                    if not set(required) <= set(headers.values()):
                        raise ValueError(f'{path.name}: SIP CDR 필수 컬럼 누락: {sorted(set(required) - set(headers.values()))}')
                    continue
                signature = hashlib.sha256(json.dumps(sorted((name, values.get(col, '')) for col, name in headers.items()),
                                                      ensure_ascii=False, separators=(',', ':')).encode()).digest()
                projected = {}
                for col, name in headers.items():
                    if name not in columns:
                        continue
                    value = values.get(col, '')
                    if name in TIME_COLUMNS and value and kinds.get(col) not in ('s', 'inlineStr'):
                        if kinds.get(col) == 'd':
                            from datetime import datetime
                            value = datetime.fromisoformat(value)
                        else:
                            try:
                                value = from_excel(float(value), epoch)
                            except (ValueError, OverflowError):
                                value = None
                    projected[name] = value
                yield row_number, projected, signature
