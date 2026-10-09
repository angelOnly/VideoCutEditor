import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { command } from '../src/infrastructure/process.js';
import { writeJson, readJson } from '../src/infrastructure/files.js';
import { testPluginRoot } from './helpers.js';
test('独立入口不启动 Worker，两条消息复用会话并直接接收结果引用', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'native-local-'));
  try {
    const root = path.join(temp, 'task'),
      entry = path.join(root, 'input/message-one/task.json');
    const task = {
      protocol: 'video-pipeline-io/1',
      taskId: 'task',
      requestId: 'one',
      stage: 'analysis',
      requestFile: 'input/message-one/request.json',
      attachmentsFile: 'input/message-one/attachments.json',
      resultFile: 'output/one/result.json',
    };
    await writeJson(entry, task);
    await writeJson(path.join(root, task.requestFile), { script: '测试' });
    await writeJson(path.join(root, task.attachmentsFile), {});
    const fake = path.join(temp, 'codex'),
      log = path.join(temp, 'calls.jsonl');
    await writeFile(
      fake,
      `#!${process.execPath}
const fs=require('fs'),path=require('path'),rl=require('readline');let root,turn=0;
for(const name of ['DATABASE_URL','POSTGRES_PASSWORD'])if(process.env[name])throw Error('凭据泄漏');
rl.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.id)return;
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
 let result={};
 if(m.method==='account/read')result={account:{type:'chatgpt'}};
 if(m.method==='skills/list')result={data:[{cwd:m.params.cwds[0],skills:['video-pipeline','remotion-best-practices','ffmpeg','directing-motion-art','motion-design-production'].map(name=>({name:'videocut-production:'+name,path:path.join(process.env.TOOLKIT_ROOT,'.agents/skills',name,'SKILL.md'),enabled:true,pluginId:'videocut-production@videocut-internal'})),errors:[]}]};
 if(m.method.startsWith('thread/')){root=m.params.cwd;result={thread:{id:'same-thread'},activePermissionProfile:{id:'videocut'}};if(m.params.dynamicTools)throw Error('不能注册制作工具');}
 if(m.method==='turn/start')result={turn:{id:'turn-'+(++turn)}};
 console.log(JSON.stringify({id:m.id,result}));
 if(m.method==='turn/start'){
  const turnId=result.turn.id,threadId='same-thread',entry=JSON.parse(fs.readFileSync(path.join(root,'input/message-one/task.json')));
  fs.mkdirSync(path.dirname(path.join(root,entry.resultFile)),{recursive:true});fs.writeFileSync(path.join(root,entry.resultFile),JSON.stringify({status:'needs_input'}));
  const reference=Object.fromEntries(['protocol','taskId','requestId','stage','resultFile'].map(k=>[k,entry[k]]));
  console.log(JSON.stringify({method:'turn/started',params:{threadId,turn:{id:turnId}}}));
  console.log(JSON.stringify({method:'item/started',params:{threadId,turnId,item:{type:'commandExecution',id:'native'}}}));
  console.log(JSON.stringify({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',text:JSON.stringify(reference)}}}));
  console.log(JSON.stringify({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}}));
 }
});`,
      { mode: 0o700 },
    );
    const args = [
      '--import',
      'tsx',
      'scripts/local-render.ts',
      '--request',
      entry,
      '--python',
      path.resolve('.venv/bin/python3'),
      '--browser',
      '/usr/bin/true',
      '--codex',
      fake,
      '--plugin',
      testPluginRoot,
    ];
    const first = JSON.parse((await command(process.execPath, args, { timeout: 10000 })).trim());
    assert.equal(first.requestId, 'one');
    await writeJson(entry, {
      ...task,
      stage: 'render',
      requestId: 'two',
      resultFile: 'output/two/result.json',
    });
    const second = JSON.parse((await command(process.execPath, args, { timeout: 10000 })).trim());
    assert.equal(second.requestId, 'two');
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      calls
        .filter((c) => c.method === 'turn/start')
        .map((c) => c.params.input.filter((i: any) => i.type === 'skill').map((i: any) => i.name)),
      [
        ['videocut-production:video-pipeline'],
        [
          'videocut-production:video-pipeline',
          'videocut-production:directing-motion-art',
          'videocut-production:motion-design-production',
        ],
      ],
    );
    assert.equal(calls.filter((c) => c.method === 'thread/start').length, 1);
    assert.equal(calls.filter((c) => c.method === 'thread/resume').length, 1);
    assert.equal(
      (await readJson(path.join(root, 'work/local-session.json'))).threadId,
      'same-thread',
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
