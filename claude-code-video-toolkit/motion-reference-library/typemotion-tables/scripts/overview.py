"""将本库已生成的最终分镜排列为总览，便于人工检查。"""
from pathlib import Path
import json
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
cases=json.loads((root/'catalog.json').read_text())
with tempfile.NamedTemporaryFile(mode='w',suffix='.txt') as listing:
    for c in cases:
        listing.write("file '"+str(root/'cases'/c['id']/f"frames/{c['frames'][-1]:03}.png").replace("'","'\\''")+"'\n")
    listing.flush()
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',listing.name,'-vf','scale=320:180,tile=4x11:color=0xfaf9f6','-frames:v','1','-update','1',str(root/'overview.jpg')],check=True)
