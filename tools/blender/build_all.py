"""blender --background --python tools/blender/build_all.py"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import json
import build_characters
import build_props
from common import MODELS, PALETTE, contract

stats=build_characters.main() | build_props.main()
bones,joints=contract()
manifest={'generator':'tools/blender/build_all.py','units':'metres','source_up':'+Z','source_forward':'+Y',
          'gltf_conversion':'(x,y,z) -> (x,z,-y)','bones':bones,'rest_joints':joints,
          'palette_srgb_255':PALETTE,'assets':stats}
(MODELS/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('ASSETS',json.dumps(stats,indent=2))
