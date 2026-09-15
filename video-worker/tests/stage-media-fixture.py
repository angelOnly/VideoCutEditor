"""只生成当前测试的色块/正弦音，不读取任何历史样片，不访问供应商。"""
import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from two_stage import load_request, read, local, digest, write
from stage_media import ffmpeg, extract_frames
request_path=Path(sys.argv[2]);root,r=load_request(request_path,'render');plan=read(local(root,r['confirmation']['planFile']))
m={k:r[k] for k in ('contractVersion','taskId','runId','stage')}
m.update(confirmedPlanSha256=r['confirmation']['planSha256'],planVersion=r['confirmation']['planVersion'],scenes=[],wholeVideo=None,quality=f'render/{r["runId"]}/review.json')
review={**{k:m[k] for k in ('contractVersion','taskId','runId','stage','confirmedPlanSha256')},'passed':True,'humanListeningPerformed':False,'limitations':['合成媒体机械测试，不能代替效果验收'],'scenes':[]}
folder=root/'output'/r['runId'];folder.mkdir(parents=True)
for i,s in enumerate(plan['scenes']):
 wav=folder/(s['id']+'.wav');video=folder/(s['id']+'.mp4')
 ffmpeg('-f','lavfi','-i',f'sine=frequency={440+i*220}:sample_rate=48000','-t','1',wav)
 ffmpeg('-f','lavfi','-i',f'color=c={"blue" if i==0 else "red"}:s=320x240:r=10','-i',wav,'-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video)
 evidence=extract_frames(root,r,s['id'],video,10)
 m['scenes'].append({'id':s['id'],'text':s['text'],'path':str(video.relative_to(root)),'sha256':digest(video),'frames':10,'durationSeconds':1,
 'usedResources':[{'id':'voice','kind':'generated','path':str(wav.relative_to(root)),'sha256':digest(wav)}],
 'resolvedVisualBlocks':[{'id':'block','startFrame':0,'endFrameExclusive':10}],
 'audio':{'text':s['text'],'path':str(wav.relative_to(root)),'sha256':digest(wav)},'captions':[{'text':s['text'],'startSeconds':0,'endSeconds':1}], 'evidence':evidence})
 review['scenes'].append({'id':s['id'],'videoSha256':digest(video),'viewedFrames':[0,5,9],'passed':True,'notes':'测试证据'})
write(root/m['quality'],review);write(root/'output/manifest.json',m)
