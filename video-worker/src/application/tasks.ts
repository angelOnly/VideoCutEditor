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
    if (!template && !this.config.customTemplateApiBaseUrl)
      fail('TEMPLATE_UNSUPPORTED', '未配置模板来源');
    return this.repo.submit(tenant.id, 'analysis', structuredClone(body), {
      executionProtocol: 'video-pipeline-io/1',
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
    });
  }
  async render(tenant: Tenant, body: unknown) {
    const input = renderRequest.parse(body);
    return this.repo.submit(tenant.id, 'render', structuredClone(body), null);
  }
}
