"""不启动 Worker 的输入、制作文件适配和实际媒体交付测试。"""
import os
import sys
import subprocess
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from task_io import prepare, complete_analysis, complete_render, finish
from two_stage import read, write, load_request, StageError, process_signature

class TaskIOTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  (self.root/'work').mkdir();(self.root/'project').mkdir()
  self.analysis=self.message('a','analysis',{'script':'第一句。第二句。','otherRequirements':'保留原文','plugin':{},'outputSpec':{'width':320,'height':240,'fps':10}}, None)
  document=self.root/'input/message-a/template.md';document.write_text('测试模板，按确认文本制作。')
  write(self.root/'input/message-a/attachments.json',{'template':{'document':str(document.relative_to(self.root))},'assets':[],'previousAnalysis':None})
 def message(self, name,stage,raw,previous):
  directory=self.root/'input'/('message-'+name);directory.mkdir(parents=True)
  entry={'protocol':'video-pipeline-io/1','taskId':'test-task','requestId':name,'stage':stage,'requestFile':str((directory/'request.json').relative_to(self.root)),'attachmentsFile':str((directory/'attachments.json').relative_to(self.root)),'resultFile':f'output/{name}/result.json'}
  write(directory/'request.json',raw);write(directory/'attachments.json',{'template':None,'assets':[],'previousAnalysis':str(previous.relative_to(self.root)) if previous else None});write(directory/'task.json',entry)
  return directory/'task.json'
 def analyzed(self):
  write(self.root/'work/text.json',{'status':'candidate','scenes':[{'text':'第一句。'},{'text':'第二句。'}],'error':None})
  return complete_analysis(self.analysis,'work/text.json')
 def test_analysis_and_confirmation_preserve_raw_and_existing_project(self):
  self.analyzed();(self.root/'project/keep').write_text('既有工程')
  body={'dataList':[{'id':'new','content':'  确认文本！？  ','production':{'custom':'明确要求'}}]}
  entry=self.message('r','render',body,self.analysis);before=read(entry.parent/'request.json')
  prepared=prepare(entry);root,request=load_request(self.root/prepared['request'],'render')
  plan=read(root/request['confirmation']['planFile']);self.assertEqual(plan['scenes'][0]['text'],'  确认文本！？  ')
  self.assertEqual(plan['scenes'][0]['production'],{'custom':'明确要求'})
  self.assertEqual(read(entry.parent/'request.json'),before);self.assertEqual((root/'project/keep').read_text(),'既有工程')
  self.assertEqual(prepare(entry),prepared);self.assertFalse((root/'.control').exists())
 def test_actual_media_and_same_task_modification(self):
  self.analyzed()
  for name,text in [('r','第一句。'),('r2','修改后一句。')]:
   entry=self.message(name,'render',{'dataList':[{'id':'scene_001','content':text}]},self.analysis)
   prepared=prepare(entry)
   subprocess.run([sys.executable,str(ROOT.parent/'video-worker/tests/stage-media-fixture.py'),str(ROOT/'tools'),str(self.root/prepared['request'])],check=True,capture_output=True)
   reference=complete_render(entry,'output/manifest.json');result=read(self.root/reference['resultFile'])
   self.assertEqual(result['status'],'completed');self.assertEqual(result['requestId'],name)
   whole, scene = result['result']['dataList']
   self.assertEqual(whole['id'],'whole-video');self.assertEqual(whole['content'],text)
   self.assertEqual(whole['extraData']['kind'],'wholeVideo');self.assertEqual(whole['dur'],1)
   self.assertEqual(scene['id'],'scene_001');self.assertEqual(scene['content'],text)
   self.assertEqual(result['files'][0]['id'],'video-whole')
   self.assertTrue((self.root/result['files'][0]['path']).is_file());self.assertFalse((self.root/'.control').exists())
  self.assertTrue((self.root/'output/r/result.json').exists())
 def test_whole_video_preserves_confirmed_order_and_rejects_corruption(self):
  self.analyzed()
  items=[{'id':'z','content':'先说。','custom':'保留'}, {'id':'a','content':'后说。'}]
  entry=self.message('ordered','render',{'dataList':items},self.analysis)
  prepared=prepare(entry)
  self.assertTrue(read(self.root/prepared['request'])['delivery']['includeWholeVideo'])
  subprocess.run([sys.executable,str(ROOT.parent/'video-worker/tests/stage-media-fixture.py'),str(ROOT/'tools'),str(self.root/prepared['request'])],check=True,capture_output=True)
  original=read(self.root/'output/manifest.json')
  for scenes in [original['scenes'][:1], list(reversed(original['scenes']))]:
   broken=deepcopy(original);broken['scenes']=scenes;write(self.root/'output/manifest.json',broken)
   with self.assertRaises(StageError):complete_render(entry,'output/manifest.json')
   self.assertFalse((self.root/'output/ordered/result.json').exists())
  write(self.root/'output/manifest.json',original)
  reference=complete_render(entry,'output/manifest.json');result=read(self.root/reference['resultFile'])
  data=result['result']['dataList'];manifest=read(self.root/'output/manifest.json')
  self.assertEqual([s['id'] for s in data],['whole-video','z','a'])
  self.assertEqual(data[0]['content'],'先说。\n后说。');self.assertEqual(data[0]['dur'],2)
  self.assertEqual(data[0]['extraData']['sceneCount'],2);self.assertEqual(data[1]['custom'],'保留')
  self.assertEqual(manifest['wholeVideo']['frames'],20)
  self.assertEqual(data[0]['extraData']['sha256'],manifest['wholeVideo']['sha256'])
  complete_render(entry,'output/manifest.json')
  self.assertEqual(read(self.root/reference['resultFile']),result)
  manifest['wholeVideo']['sha256']='0'*64;write(self.root/'output/manifest.json',manifest)
  with self.assertRaises(StageError):complete_render(entry,'output/manifest.json')
 def test_reserved_whole_video_id_rejected(self):
  for id in ['whole', 'whole-video']:
   entry=self.message(id,'render',{'dataList':[{'id':id,'content':'确认。'}]},self.analysis)
   with self.assertRaises(StageError):prepare(entry)
 def test_render_does_not_require_analysis_converter_records(self):
  # Codex 可直接返回分析业务结果，Render 仍应能从原始消息继续。
  entry=self.message('direct','render',{'dataList':[{'id':'one','content':'确认原文。'}]},self.analysis)
  prepared=prepare(entry)
  _, request=load_request(self.root/prepared['request'],'render')
  self.assertEqual(read(self.root/request['confirmation']['planFile'])['scenes'][0]['text'],'确认原文。')
 def test_template_files_are_registered_as_stable_source_assets(self):
  template=self.root/'input/message-a/template';template.mkdir()
  (template/'guide.md').write_text('模板说明');(template/'logo.png').write_bytes(b'template-resource')
  write(self.analysis.parent/'attachments.json',{'template':{'root':'input/message-a/template','document':'input/message-a/template/guide.md'},'assets':[],'previousAnalysis':None})
  first=prepare(self.analysis);_,request=load_request(self.root/first['request'],'analysis')
  assets=read(self.root/request['input']['assetsManifest'])['assets']
  self.assertEqual(len(assets),2)
  for a in assets:
   self.assertEqual(a['kind'],'source');self.assertEqual(request['snapshot'][a['path']],a['sha256'])
  entry=self.message('render-assets','render',{'dataList':[{'id':'one','content':'确认原文。'}]},self.analysis)
  second=prepare(entry);_,request=load_request(self.root/second['request'],'render')
  self.assertEqual(read(self.root/request['input']['assetsManifest'])['assets'],assets)
 def test_failure_and_unknown_charges_do_not_retry(self):
  ref=finish(self.analysis,'needs_input',error={'code':'EXTERNAL_RESULT_UNKNOWN','message':'先核实收费结果'})
  self.assertEqual(read(self.root/ref['resultFile'])['status'],'needs_input')
  with patch.dict(os.environ,{'VIDEOCUT_RENDER_SANDBOX':'native','DOUBAO_TTS_API_KEY':'only-test'}):
   from config import get_doubao_tts_api_key
   with patch('dotenv.load_dotenv',side_effect=AssertionError('不能读取整份环境文件')):
    self.assertEqual(get_doubao_tts_api_key(),'only-test')
 def test_render_cannot_write_terminal_status_while_media_execution_is_active(self):
  entry=self.message('running','render',{'dataList':[{'id':'scene_001','content':'确认。'}]},self.analysis)
  prepared=prepare(entry);request=self.root/prepared['request']
  child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])
  self.addCleanup(lambda: child.poll() is None and child.kill())
  try:
   write(request.parent/'execution.json',{'activeSince':1,'activeAction':'render-batch',
                                          'executor':{'pid':child.pid,'signature':process_signature(child.pid)},'operations':[]})
   for status,kwargs in [
    ('completed',{'result':{}}),
    ('needs_input',{'error':{'code':'MEDIA_EXECUTION_INTERRUPTED','message':'误判'}}),
    ('failed',{'error':{'code':'RENDER_FAILED','message':'误判'}}),
   ]:
    with self.assertRaises(StageError) as error: finish(entry,status,**kwargs)
    self.assertEqual(error.exception.code,'TASK_BUSY')
   self.assertFalse((self.root/'output/running/result.json').exists())
  finally:
   child.terminate();child.wait(timeout=3)
  media_child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True)
  self.addCleanup(lambda: media_child.poll() is None and media_child.kill())
  try:
   work=request.parent/'work';work.mkdir()
   write(work/'scene_001.process.json',{'state':'running','pid':media_child.pid,
                                         'signature':process_signature(media_child.pid)})
   with self.assertRaises(StageError) as error:
    finish(entry,'needs_input',error={'code':'MEDIA_EXECUTION_INTERRUPTED','message':'误判'})
   self.assertEqual(error.exception.code,'TASK_BUSY')
  finally:
   media_child.terminate();media_child.wait(timeout=3)
  ref=finish(entry,'needs_input',error={'code':'RENDER_FAILED','message':'进程已结束'})
  self.assertEqual(read(self.root/ref['resultFile'])['status'],'needs_input')
 def test_render_terminal_status_uses_shared_lock_when_media_pid_is_not_visible(self):
  entry=self.message('isolated','render',{'dataList':[{'id':'scene_001','content':'确认。'}]},self.analysis)
  prepare(entry)
  # 用独立进程持有真实目录锁，模拟隔离命令看不到媒体PID的生产环境。
  code='import fcntl,os,sys,time; fd=os.open(sys.argv[1],os.O_RDONLY|os.O_DIRECTORY); fcntl.flock(fd,fcntl.LOCK_EX); print("ready",flush=True); time.sleep(30)'
  child=subprocess.Popen([sys.executable,'-c',code,str(self.root)],stdout=subprocess.PIPE,text=True)
  self.addCleanup(lambda: child.poll() is None and child.kill())
  try:
   self.assertEqual(child.stdout.readline().strip(),'ready')
   with patch('task_io.active_execution',return_value=None),patch('task_io.active_processes',return_value=[]):
    for status,kwargs in [('completed',{'result':{}}),('needs_input',{'error':{'code':'TEST','message':'误判'}}),('failed',{'error':{'code':'TEST','message':'误判'}})]:
     with self.assertRaises(StageError) as error:finish(entry,status,**kwargs)
     self.assertEqual(error.exception.code,'TASK_BUSY')
    with self.assertRaises(StageError) as error:complete_render(entry,'不存在的清单.json')
    self.assertEqual(error.exception.code,'TASK_BUSY')
   self.assertFalse((self.root/'output/isolated/result.json').exists())
  finally:
   child.terminate();child.wait(timeout=3);child.stdout.close()
  ref=finish(entry,'failed',error={'code':'TEST','message':'媒体已停止'})
  self.assertEqual(read(self.root/ref['resultFile'])['status'],'failed')
if __name__=='__main__':unittest.main()
