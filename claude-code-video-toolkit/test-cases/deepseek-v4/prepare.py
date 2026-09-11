#!/usr/bin/env python3
"""Prepare a reproducible local-only Codex video test; never makes paid calls."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def prepare(job_id):
    if not job_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in job_id):
        raise ValueError('job-id must contain only ASCII letters, numbers, - or _')
    job = ROOT / 'projects' / job_id
    job.mkdir(parents=True, exist_ok=False)  # Refuse to overwrite existing/paid work.
    (job / 'input').mkdir()
    (job / 'output').mkdir()
    (job / 'quality').mkdir()
    shutil.copy2(HERE / 'script.md', job / 'input/script.md')
    shutil.copy2(ROOT / 'deliverables/财经双人对话视频生成指令.md', job / 'input/layout-reference.md')
    # Copy only the selected source/graphics/SFX; omit all previous episode audio
    # and hardcoded timelines so they cannot accidentally become this episode.
    selected = ['package.json', 'package-lock.json', 'tsconfig.json',
                'src/FinancialIntros.tsx']
    base = ROOT / 'examples/hello-world'
    template = job / 'input/template'
    template.mkdir()
    for name in selected:
        target = template / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(base / name, target)
    for name in ['public/assets/financial-dialogue', 'public/audio/financial-dialogue-v3/sfx',
                 'public/audio/financial-intro']:
        source = base / name
        shutil.copytree(source, template / name,
                        ignore=shutil.ignore_patterns('*.mp3', '*.mp4', '*.mov', '.DS_Store'))
    shutil.copytree(ROOT / 'deliverables/video-generation-guide-assets', job / 'input/layout-frames')
    shutil.copytree(template, job / 'project')
    # A small ready-to-build entry avoids registering old compositions referencing
    # missing audio. The production agent replaces this component before delivery.
    (job / 'project/src/index.ts').write_text("import {registerRoot} from 'remotion';\nimport {RemotionRoot} from './Root';\nregisterRoot(RemotionRoot);\n")
    (job / 'project/src/Root.tsx').write_text("import {AbsoluteFill, Composition} from 'remotion';\nconst Pending = () => <AbsoluteFill>Pending production — do not deliver</AbsoluteFill>;\nexport const RemotionRoot = () => <Composition id=\"DeepSeekV4\" component={Pending} durationInFrames={30} fps={30} width={1920} height={1080}/>;\n")
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    hashes = {str(p.relative_to(template)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in template.rglob('*') if p.is_file()}
    (job / 'input/template-manifest.json').write_text(json.dumps({'sourceCommit': revision, 'files': hashes}, indent=2))
    task = {
        'schemaVersion': 1, 'jobId': job_id, 'mode': 'auto',
        'input': {'script': 'input/script.md', 'narration': None,
                  'assets': [{'path': 'input/template/public/assets/financial-dialogue/' + name,
                              'role': role, 'required': True}
                             for name, role in [('male-chief.png', 'male-avatar'), ('female-host.png', 'female-avatar'), ('logo-dark.png', 'logo')]]},
        'template': {'id': 'local-financial-dialogue-source-test', 'version': revision, 'path': 'input/template'},
        'output': {'width': 1920, 'height': 1080, 'fps': 30, 'requireAudio': True},
        'duration': {'mode': 'audio', 'targetSec': None, 'toleranceSec': 0.1},
        'tts': {'provider': 'doubao', 'roles': {'female': 'zh_female_xiaohe_uranus_bigtts', 'male': 'zh_male_m191_uranus_bigtts'}},
        'limits': {'repairRounds': 10, 'externalAttempts': 10, 'timeoutSec': 14400},
        'editorial': {'preserveOriginal': True, 'factCheck': 'not-performed', 'originalInterviewProvided': False,
                      'subtitleMode': 'sentence-audio-boundaries', 'allowWebAssets': False},
    }
    (job / 'task.json').write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n')
    prompt = f'''使用 $video-pipeline，先读取 .agents/skills/video-pipeline/SKILL.md。
任务目录：{job}。任务文件为该目录下 task.json。只修改这个任务目录，工具库根目录是 {ROOT}。
这是已授权的本地无人值守制作测试；当前仓库自有 FinancialIntros 源码作为本测试允许复用的片头片尾，正文依据指定稿件与布局文档重新创作，不声称已经生产服务准入。
任务已预先复制输入与 project/，保留已安装依赖；读 input/template-manifest.json 核对来源，不触碰共享原件。
读 input/layout-reference.md 及 input/layout-frames 的图片，只复用剪辑视觉。文档中“先规划等确认”“试听三轮”“确认再导出”全部不适用于本任务。

具体制作：
- 1920×1080 / 30fps，双主持人解说。按原文顺序拆成较短句段，角色适当交替；原文问题可给女声、分析给男声；不强行改写成问答、不新增观点。最后原文收束句安排女声。
- script.md 第一行是标题，不必朗读。括号“黄仁勋原采访”是素材提示，不朗读。没有真实采访音视频：该引语由预设普通音色朗读，画面明确写“引述 · 合成旁白”，不得克隆黄仁勋声音或伪造采访。
- 稿件为用户给定测试文本，未做新闻核实；保留原文事实、引语和“升腾”字样，不自行纠正，不把“今天”替换成服务器日期。将这一点记录在质量报告，不自动发布。
- 遵循钩子 → 67帧栏目片头 → 分章节分析 → 末句全屏片尾。不得读取旧财经正文源码或复用旧正文；本期改为 DeepSeek/硬件优化/CUDA生态路径示意，不编造性能数字。
- 女头像右侧、男头像左侧，谁说话谁高亮；关键句8–18字；数据按语义递进。标题卡占独立约1.3秒无旁白区间，与人物UI互斥。最后女声第一字切全屏片尾，语音结束即视频结束。
- 片头/片尾 MOV 未上传，不将其视为必需素材；使用 FinancialIntros.tsx 和已提供 PNG/WAV 重建。主体需新建 DeepSeek 专属组件；Root.tsx 目前是准备占位，必须替换，仅注册 DeepSeekV4。不可渲染旧财报成片或把 Pending 组件交付。
- 必须先完成真实 TTS 再安排时间轴。固定 task.json 中的豆包男女音色，读 tools/generate_dialogue_audio.py 用法。将完整稿件拆为每条最多约35个中文字的自然短句，每段音频独立生成，真实音频边界作为句级字幕边界，不做伪逐字卡拉OK。不读取旧财报 timeline，不调用额外付费对齐服务。
- 所有付费请求禁止无条件重试。复用已验证短句音频；请求结果不明按 EXTERNAL_RESULT_UNKNOWN 失败，不能重发。无凭据则 AUTH_REQUIRED，不生成静音替身。
- 背景音乐未提供，本次省略；只复用 input/template/public 下现成轻量音效，音量以旁白清晰为先，不生成付费音乐。
- 在 project/src 中生成实际入口，Linux 字体使用 Noto Sans CJK SC。只编译本期入口，移除任务副本中未使用且依赖旧音轨的参考 TSX，参考原件在 input/template 留存。
- 从 project/ 使用本地 Remotion CLI 完整渲染 DeepSeekV4 到 {job}/output/video.mp4，H.264/yuv420p/AAC，保存 render.log。
- 检查人物切换、独立章节和片尾等关键帧，并按 Skill 每阶段产物契约留完整 JSON。plan 与 timeline 包含片头/标题卡等实际场景，顺序一致且覆盖首尾。用完整解码与校验脚本检查候选。
- 最多 10 轮工程/画面修复，可安全重试的临时网络故障最多 10 次总尝试，总时限 4 小时；按 Skill 记录修复与重试。不要打开 Studio 等人，不请求确认，不上传成片。最终只返回响应 Schema 的 candidate 或 failed；缺结果不能当成功。
'''
    (job / 'prompt.txt').write_text(prompt, encoding='utf-8')
    print(job)
    return job


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job-id', default='deepseek-v4-test')
    args = parser.parse_args()
    prepare(args.job_id)
