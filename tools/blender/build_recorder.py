"""Unbranded portable cassette recorder. Shared boxes keep CPU fallback aligned."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import *

if __name__ == '__main__':
    reset()
    parts=json.loads((ROOT/'client/src/game/scene/recorder-parts.json').read_text())
    for i,p in enumerate(parts):
        if p['group'] != 0: continue
        name='recorder_'+p['name']
        PALETTE[name]=tuple(p['color'])
        box(name,p['center'],p['size'],name)
    print('RECORDER_STATS',json.dumps(export_asset('cassette_recorder')))
