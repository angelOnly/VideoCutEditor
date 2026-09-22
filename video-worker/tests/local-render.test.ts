import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { command } from '../src/infrastructure/process.js';
import { readJson } from '../src/infrastructure/files.js';

test(
  '本机控制器真实子进程：模型提前返回后自动续轮并保留人工等待账本',
  { skip: process.platform !== 'darwin' || !process.env.STAGE_TEST_PYTHON },
  async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'local-render-loop-'));
    try {
      const toolkit = path.resolve('../claude-code-video-toolkit'),
        python = process.env.STAGE_TEST_PYTHON!;
      const request = (
        await command(python, [
          '-c',
          [
            'import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from two_stage import init_job,read,write,storyboard,confirm',
            'p=Path(sys.argv[2])',
            '[(p/n).write_text(t) for n,t in [("script.md","第一句。"),("req.md","保留原稿"),("template.md","测试模板")]]',
            'a=Path(init_job(p/"job",{"taskId":"local_test","scriptFile":str(p/"script.md"),"requirementsFile":str(p/"req.md"),"templateFile":str(p/"template.md"),"assets":[],"limits":{"executionSeconds":14400,"repairRounds":0},"outputSpec":{"width":320,"height":240,"fps":30}})["request"])',
            'write(p/"response.json",{"status":"candidate","scenes":[{"text":"第一句。"}],"error":None});storyboard(a,p/"response.json")',
            'print(confirm(a,a.parent/"plan.json",0,"测试确认")["request"])',
          ].join(';'),
          path.join(toolkit, 'tools'),
          temp,
        ])
      ).trim();
      const r = await readJson(request),
        fake = path.join(temp, 'fake-codex.mjs');
      const job = path.resolve(request, '../../..');
      await mkdir(path.join(job, 'project'), { recursive: true });
      await writeFile(
        fake,
        `#!${process.execPath}
import readline from 'node:readline';
const request=${JSON.stringify(r)};let round=0,finish;
for await(const line of readline.createInterface({input:process.stdin})){
 const m=JSON.parse(line);if(['write-test','preflight-test'].includes(m.id)){if(m.result?.success!==false)process.exit(7);finish();continue;}if(!m.id||!m.method)continue;let result={};
 if(m.method==='account/read')result={account:{type:'chatgpt'}};
 if(m.method.startsWith('thread/'))result={thread:{id:'fake-thread'},activePermissionProfile:{id:'videocut'}};
 if(m.method==='turn/start')result={turn:{id:'turn-'+(++round)}};
 console.log(JSON.stringify({id:m.id,result}));
 if(m.method==='turn/start'){
  const turnId=result.turn.id,threadId='fake-thread';
  console.log(JSON.stringify({method:'turn/started',params:{threadId,turn:result.turn}}));
  finish=()=>{const response={contractVersion:request.contractVersion,taskId:request.taskId,runId:request.runId,stage:'render',status:round===1?'continue_required':'human_required',artifact:null,error:{code:round===1?'PRODUCTION_INCOMPLETE':'SHARED_PIPELINE_ERROR',message:'测试反馈',retryable:false}};
  console.log(JSON.stringify({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',text:JSON.stringify(response)}}}));
  console.log(JSON.stringify({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}}));
  };
  if(round===1)console.log(JSON.stringify({id:'write-test',method:'item/tool/call',params:{threadId,turnId,tool:'video_exec',arguments:{command:'echo ok > project/allowed.txt; echo bad > .control/policy.json'}}}));
  else console.log(JSON.stringify({id:'preflight-test',method:'item/tool/call',params:{threadId,turnId,tool:'video_media',arguments:{command:'preflight',project:'project'}}}));
 }
}
`,
        { mode: 0o700 },
      );
      const modules = path.join(temp, 'modules');
      await mkdir(modules);
      for (const name of ['remotion', '@remotion/renderer', '@remotion/bundler']) {
        await mkdir(path.join(modules, name), { recursive: true });
        await writeFile(
          path.join(modules, name, 'package.json'),
          JSON.stringify({ version: '4.0.425' }),
        );
      }
      // 不能用 /bin/echo 作为浏览器路径：向上推导应用根会变成 /，掩盖读取权限缺失。
      const browser = path.join(temp, 'Test.app/Contents/MacOS/browser');
      await mkdir(path.dirname(browser), { recursive: true });
      await copyFile('/bin/echo', browser);
      let output = '';
      try {
        await command(
          process.execPath,
          [
            '--import',
            'tsx',
            'scripts/local-render.ts',
            '--request',
            request,
            '--python',
            python,
            '--modules',
            modules,
            '--browser',
            browser,
            '--codex',
            fake,
          ],
          { timeout: 30000 },
        );
      } catch (e: any) {
        assert.equal(e.exitCode, 2, e.message);
        output = e.stdout;
      }
      const state = await readJson(path.resolve(request, '../../../.control/local-recovery.json'));
      assert.equal(state.status, 'waiting_human');
      assert.equal(state.loop.iteration, 2);
      assert.equal(state.repairs, 0);
      assert.equal(state.issue.code, 'HUMAN_REVIEW_REQUESTED');
      assert.equal(state.issue.evidence.code, 'INVALID_CONTRACT');
      assert.ok(state.elapsedSeconds > 0);
      assert.match(output, /"action":"continue"/);
      assert.equal(
        (await readJson(path.join(job, '.control/policy.json'))).budgetOwner,
        'local-driver',
      );
      assert.equal(await command('/bin/cat', [path.join(job, 'project/allowed.txt')]), 'ok\n');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
);
