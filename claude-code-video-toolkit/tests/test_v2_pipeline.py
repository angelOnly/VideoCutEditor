"""Synthetic fixtures for the trusted v2 gate; not production perceptual reviews."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.claude/skills/video-pipeline/scripts'))
from validation_common import Invalid,sha256
from validate_segments import validate

@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg required')
class SegmentsGateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        for d in ('input','output/scenes','output/frames'): (self.root/d).mkdir(parents=True,exist_ok=True)
        self.scene={'id':'scene_001','content':'测试稿件。','dur':1,'visualPlan':{'description':'测试','layoutPreset':'full_frame','animationPreset':'none'},'extraData':{'keywordList':[],'digitalHumanId':'','videoInfoList':[],'picInfoList':[]}}
        self.task={'schemaVersion':2,'jobId':'run-test','taskId':'task-test','operation':'render','mode':'auto','planVersion':2,'input':{'script':'input/script.txt','assetManifest':'input/assets.json','confirmedPlan':'input/confirmed-plan.json','narrationAssetId':None},'template':{'id':'ifeng-scenes-v1','version':'1','path':'/opt/template'},'renderSelection':{'sceneIds':['scene_001'],'reuseManifest':'input/reuse.json'},'output':{'width':320,'height':240,'fps':10,'requireAudio':True},'limits':{'deadline':'2099-01-01T00:00:00Z','repairRounds':1},'tts':{'provider':'doubao','voiceId':'test','resourceId':'seed-tts-2.0'},'threadId':None,'requirements':'','digitalHumanId':''}
        (self.root/'input/script.txt').write_text(self.scene['content'])
        audio=self.root/'input/audio.wav'
        self.cmd(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1',str(audio)])
        video=self.root/'output/scenes/scene_001.mp4'
        self.cmd(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=10','-i',str(audio),'-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(video)])
        self.cmd(['ffmpeg','-v','error','-i',str(video),'-frames:v','1',str(self.root/'output/frames/one.jpg')])
        clip={'id':'scene_001','text':self.scene['content'],'path':'input/audio.wav','sha256':sha256(audio),'durationSec':1}
        self.manifest={'schemaVersion':2,'jobId':'run-test','planVersion':2,'scenes':[{'id':'scene_001','content':self.scene['content'],'path':'output/scenes/scene_001.mp4','durationSec':1,'frames':10,'extraData':self.scene['extraData'],'audio':clip,'sha256':sha256(video),'evidence':['output/frames/one.jpg']*3}]}
        for name,value in [('task.json',self.task),('input/assets.json',{'assets':[]}),('input/confirmed-plan.json',{'dataList':[self.scene]}),('input/audio-manifest.json',{'clips':[clip]}),('output/render-manifest.json',self.manifest),('output/quality-review.json',{'jobId':'run-test','passed':True,'sceneIds':['scene_001']})]: self.write(name,value)
    def cmd(self,argv):subprocess.run(argv,check=True,capture_output=True)
    def write(self,name,value):(self.root/name).write_text(json.dumps(value))
    def test_valid(self):self.assertEqual(validate(self.root)['sceneCount'],1)
    def test_wrong_run(self):
        self.manifest['jobId']='another';self.write('output/render-manifest.json',self.manifest)
        with self.assertRaises(Invalid):validate(self.root)
    def test_wrong_scene(self):
        self.manifest['scenes'][0]['id']='other';self.write('output/render-manifest.json',self.manifest)
        with self.assertRaises(Invalid):validate(self.root)
    def test_wrong_text(self):
        self.manifest['scenes'][0]['content']='模型擅改';self.write('output/render-manifest.json',self.manifest)
        with self.assertRaises(Invalid):validate(self.root)
    def test_wrong_audio(self):
        self.cmd(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','1',str(self.root/'input/audio.wav')])
        clip=self.manifest['scenes'][0]['audio'];clip['sha256']=sha256(self.root/'input/audio.wav')
        self.write('input/audio-manifest.json',{'clips':[clip]});self.write('output/render-manifest.json',self.manifest)
        with self.assertRaises(Invalid):validate(self.root)
    def test_no_visual_review(self):
        self.write('output/quality-review.json',{'jobId':'run-test','passed':False,'sceneIds':['scene_001']})
        with self.assertRaises(Invalid):validate(self.root)
    def test_bad_video(self):
        video=self.root/'output/scenes/scene_001.mp4';video.write_bytes(b'not a video');self.manifest['scenes'][0]['sha256']=sha256(video);self.write('output/render-manifest.json',self.manifest)
        with self.assertRaises(Invalid):validate(self.root)
    def test_escape(self):
        self.manifest['scenes'][0]['path']='../../other.mp4';self.write('output/render-manifest.json',self.manifest)
        with self.assertRaises(Invalid):validate(self.root)

if __name__=='__main__':unittest.main()
