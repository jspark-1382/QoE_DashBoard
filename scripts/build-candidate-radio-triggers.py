"""Index original MDT trigger events for exact candidate-call measurement lookups."""
import json
import os
from pathlib import Path
import sqlite3
import uuid

from mdt_pipeline import anonymous_id, clean, numeric, parse_timestamp, read_rows


def build(root):
    index = json.loads((root / 'public/voice-query-index.json').read_text('utf-8'))
    with sqlite3.connect((root / index['database']).as_uri() + '?mode=ro', uri=True) as voice:
        meta = json.loads(voice.execute("select json from meta where key='dataset'").fetchone()[0])
    revision = index['sourceRevision']
    assert meta['revision'] == revision
    destination = root / 'outputs/voice-query-data' / (revision + '-radio-triggers.sqlite')
    temporary = destination.with_name(destination.name + '.' + uuid.uuid4().hex + '.tmp')
    database = sqlite3.connect(temporary)
    query = """INSERT INTO triggers VALUES(?,?,?,?,?,?,?,?)
               ON CONFLICT(customer,stamp,cell,pci,frequency) DO UPDATE SET ambiguous=1
               WHERE triggers.origin<>excluded.origin OR triggers.event<>excluded.event"""
    try:
        database.executescript("""
          pragma journal_mode=OFF;
          create table meta(revision text primary key);
          create table triggers(customer text,stamp text,cell text,pci int,frequency int,
            origin text,event text,ambiguous int,primary key(customer,stamp,cell,pci,frequency)) without rowid;
        """)
        for book in meta['sourceWorkbookAudit']['mdt']:
            source = root / 'data/MDT_New' / book['file']
            if source.stat().st_size != book['bytes']:
                raise ValueError('MDT source differs from active build')
            batch = []
            count = 0
            for count, row in enumerate(read_rows(source), 1):
                stamp = parse_timestamp(row.get('occ_dt'))
                cell, contract, origin = (clean(row.get(key)) for key in ('mdt_cell_id','svc_cont_id','lte_vc_div'))
                pci, frequency = numeric(row.get('pci')), numeric(row.get('dlearfcn'))
                if not (stamp and cell and contract and origin and pci is not None and frequency is not None):
                    continue
                event = clean(row.get('trigr_ev')).upper()
                batch.append((anonymous_id('mdt', contract), stamp.isoformat(timespec='milliseconds'), cell,
                              pci, frequency, anonymous_id('stream', origin), event, 0))
                if len(batch) == 5000:
                    database.executemany(query, batch)
                    batch.clear()
            database.executemany(query, batch)
            if count != book['inputRows']:
                raise ValueError('MDT row count differs from active build')
        database.execute("delete from triggers where ambiguous=1 or event not in ('A1','A2','A3','A4','A5','A6','B1_NR','B2_NR')")
        database.execute('insert into meta values(?)', (revision,))
        database.commit()
        database.execute('vacuum')
        print('Unique trigger keys:', database.execute('select count(*) from triggers').fetchone()[0], flush=True)
        database.close()
        os.replace(temporary, destination)
    finally:
        database.close()
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    build(Path(__file__).resolve().parent.parent)
