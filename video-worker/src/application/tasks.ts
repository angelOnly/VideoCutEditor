import type { Config, Tenant } from '../config.js';
import { normalizeAnalysisRequest, normalizeRenderRequest } from '../contracts/ifeng.js';
import { fail } from '../domain/task.js';
import { TaskRepository } from '../infrastructure/task-repository.js';
export class Tasks {
  constructor(
    public repo: TaskRepository,
    private config: Config,
  ) {}
  async analysis(tenant: Tenant, body: unknown) {
    const { input, source } = normalizeAnalysisRequest(body);
    const template = this.config.templates[input.plugin.templateId];
    if (!template && !this.config.customTemplateApiBaseUrl)
      fail('TEMPLATE_UNSUPPORTED', '未配置模板来源');
    return this.repo.submit(tenant.id, 'analysis', structuredClone(input), {
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
      // 保留平台原始请求，便于追查网页到 Worker 的字段映射。
      sourceRequest: structuredClone(source),
    });
  }
  async render(tenant: Tenant, body: unknown) {
    const taskId =
      typeof body === 'object' && body !== null && 'taskId' in body
        ? String((body as { taskId: unknown }).taskId)
        : '';
    const current = await this.repo.currentConfig(tenant.id, taskId);
    const { input } = normalizeRenderRequest(body, {
      planVersion: current.planVersion,
      templateId: current.config.templateId,
      digitalHumanAccountId: current.config.digitalHumanAccountId,
    });
    return this.repo.submit(tenant.id, 'render', structuredClone(input), null);
  }
}
