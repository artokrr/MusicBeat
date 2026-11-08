"""Capture original GL code from the task baseline, restoring edits even on failure.
Run only in MusicBeat-look with the dedicated Vite on 3230 and no live captures.
"""
import subprocess
from pathlib import Path
assert Path.cwd().name == 'MusicBeat-look'
assert subprocess.check_output(['git','branch','--show-current'],text=True).strip() == 'pixel-look'
paths=['client/src/game/gl/'+n+'.ts' for n in ['material','renderer','weather']]
saved={p:Path(p).read_bytes() for p in paths}
try:
 for p in paths: Path(p).write_bytes(subprocess.check_output(['git','show','816fcbc:'+p]))
 with open('tools/out/look-head.log','w') as f:
  subprocess.run(['node','tools/shot.mjs','--url','http://localhost:3230/?nointro','--out','tools/out/look-head/capture.png','--after','tools/look-checks.js','--port','9534'],stdout=f,stderr=f,check=True)
finally:
 for p,b in saved.items():Path(p).write_bytes(b)
