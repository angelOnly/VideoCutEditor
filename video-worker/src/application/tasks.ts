import type { Config, Tenant } from '../config.js';
import { analysisRequest, renderRequest } from '../contracts/ifeng.js';
import { assertStage } from '../contracts/two-stage.js';
import { scenes } from '../contracts/ifeng.js';
import { fail } from '../domain/task.js';
import { TaskRepository } from '../infrastructure/task-repository.js';
export class Tasks {
  constructor(
    public repo: TaskRepository,
    private config: Config,
  ) {}
  async analysis(tenant: Tenant, body: unknown) {
    const input = analysisRequest.parse(body);
    const template = this.config.templates[input.plugin.templateId];
    if (!template && !this.config.templateApiUrl && !this.config.customTemplateApiBaseUrl)
      fail('TEMPLATE_UNSUPPORTED', '未配置模板来源');
    return this.repo.submit(tenant.id, 'analysis', input, {
      executionProtocol: this.config.executionProtocol ?? 'legacy',
      requirements: input.otherRequirements,
      templateId: input.plugin.templateId,
      templateVersion: template?.version,
      templatePath: template?.path,
      runtimeVersion: this.config.runtimeVersion,
      outputSpec: input.outputSpec,
      digitalHumanAccountId: input.digitalHumanAccounId,
      digitalHumanId: input.plugin.digitalHumanId,
      script: input.script,
      narration: input.narration,
      ...(this.config.executionProtocol === 'video-two-stage/1'
        ? {}
        : {
            tts: {
              provider: 'doubao',
              voiceId: this.config.ttsVoice,
              resourceId: this.config.ttsResourceId,
            },
          }),
    });
  }
  async render(tenant: Tenant, body: unknown) {
    const input = renderRequest.parse(body);
    if (input.plan) assertStage(this.config.toolkitRoot, 'plan', input.plan);
    else scenes.parse(input.dataList);
    return this.repo.submit(tenant.id, 'render', input, null);
  }
}
