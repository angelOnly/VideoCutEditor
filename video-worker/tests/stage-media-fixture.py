"""只生成当前测试的色块/正弦音，不读取任何历史样片，不访问供应商。"""
import sys
import subprocess
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from two_stage import load_request, read, local, digest, json_digest, write
from stage_media import ffmpeg, extract_frames, project_fingerprint
request_path=Path(sys.argv[2]);root,r=load_request(request_path,'render');plan=read(local(root,r['confirmation']['planFile']))
m={k:r[k] for k in ('contractVersion','taskId','runId','stage')}
m.update(confirmedPlanSha256=r['confirmation']['planSha256'],planVersion=r['confirmation']['planVersion'],scenes=[],wholeVideo=None,quality=f'render/{r["runId"]}/review.json')
review={**{k:m[k] for k in ('contractVersion','taskId','runId','stage','confirmedPlanSha256')},'passed':True,'humanListeningPerformed':False,'limitations':['合成媒体机械测试，不能代替效果验收'],'scenes':[]}
folder=root/'output'/r['runId'];folder.mkdir(parents=True)
encoder='libx264' if 'libx264' in subprocess.check_output(['ffmpeg','-hide_banner','-encoders'],stderr=subprocess.DEVNULL,text=True) else 'h264_videotoolbox'
for i,s in enumerate(plan['scenes']):
 wav=folder/(s['id']+'.wav');video=folder/(s['id']+'.mp4')
 ffmpeg('-f','lavfi','-i',f'sine=frequency={440+i*220}:sample_rate=48000','-t','1',wav)
 ffmpeg('-f','lavfi','-i',f'color=c={"blue" if i==0 else "red"}:s=320x240:r=10','-i',wav,'-t','1','-c:v',encoder,*(['-allow_sw','1'] if encoder == 'h264_videotoolbox' else []),'-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-c:a','aac',video)
 evidence=extract_frames(root,r,s['id'],video,10)
 m['scenes'].append({'id':s['id'],'text':s['text'],'path':str(video.relative_to(root)),'sha256':digest(video),'frames':10,'durationSeconds':1,
 'usedResources':[{'id':'voice','kind':'generated','path':str(wav.relative_to(root)),'sha256':digest(wav)}],
 'resolvedVisualBlocks':[{'id':'block','startFrame':0,'endFrameExclusive':10}],
 'audio':{'text':s['text'],'path':str(wav.relative_to(root)),'sha256':digest(wav)},'captions':[{'text':s['text'],'startSeconds':0,'endSeconds':1}], 'evidence':evidence})
 review['scenes'].append({'id':s['id'],'videoSha256':digest(video),'viewedFrames':[0,5,9],'passed':True,'notes':'测试证据'})
timeline={'fps':r['outputSpec']['fps'],'scenes':[]}
for index,scene in enumerate(m['scenes']):
 timeline['scenes'].append({'id':scene['id'],'startFrame':index*10,'endFrameExclusive':(index+1)*10,
  'utterances':[{'id':scene['id']+'_tts','text':scene['text'],'src':scene['audio']['path'],'startFrame':0,'endFrameExclusive':10}],
  'captions':[{'utteranceId':scene['id']+'_tts','text':scene['text'],'startFrame':0,'endFrameExclusive':10}]})
write(root/'render'/r['runId']/'timeline.json',timeline)
review['timelineSha256']=digest(root/'render'/r['runId']/'timeline.json')
for scene in review['scenes']:
 scene['narrationChecks']=[{'utteranceIds':[scene['id']+'_tts'],'mode':'hold','startFrame':0,
  'endFrameExclusive':10,'expected':'合成色块保持','observed':'首尾颜色一致','viewedFrames':[0,9],'passed':True}]
write(root/m['quality'],review);write(root/'output/manifest.json',m)
(root/'project').mkdir(exist_ok=True)
(root/'project/fixture.ts').write_text('// 合成媒体测试工程；不代表真实模板效果。\n')
