import type { Config, Tenant } from '../config.js';
import { analysisRequest, renderRequest } from '../contracts/ifeng.js';
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
    if (!template) fail('TEMPLATE_UNSUPPORTED', '模板未准入');
    return this.repo.submit(tenant.id, 'analysis', input, {
      templateId: input.plugin.templateId,
      templateVersion: template.version,
      templatePath: template.path,
      runtimeVersion: this.config.runtimeVersion,
      outputSpec: input.outputSpec,
      digitalHumanAccountId: input.digitalHumanAccounId,
      digitalHumanId: input.plugin.digitalHumanId,
      script: input.script,
      narration: input.narration,
      tts: {
        provider: 'doubao',
        voiceId: this.config.ttsVoice,
        resourceId: this.config.ttsResourceId,
      },
    });
  }
  async render(tenant: Tenant, body: unknown) {
    return this.repo.submit(tenant.id, 'render', renderRequest.parse(body), null);
  }
}
