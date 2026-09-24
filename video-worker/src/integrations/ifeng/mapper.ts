import type { Stage, Run } from '../../domain/task.js';
export function accepted(run: Run) {
  return {
    status: 0,
    msg: 'accepted',
    data: {
      taskId: run.input.taskId,
      runId: run.id,
      state: run.state,
      stage: run.stage,
      planVersion: run.plan_version,
    },
  };
}
export function callback(eventId: string, run: Run, task: any, result: any, error: any = null) {
  const config = run.prepared?.taskConfig ?? task.config;
  const common = {
    schemaVersion: 2,
    eventId,
    requestId: run.request_id,
    taskId: task.external_id,
    runId: run.id,
    planVersion: run.plan_version,
    status: error ? 1 : 0,
    msg: error?.message ?? '',
  };
  if (error) return { ...common, error };
  return {
    ...common,
    ...(run.stage === 'render' ? { resultVersion: task.result_version } : {}),
    dataInfo: {
      templateId: config.templateId,
      ...(run.stage === 'analysis'
        ? {
            durationMode: 'estimated',
            previews: [],
          }
        : {
            sceneCount: result.dataList.filter((item: any) => item.extraData?.kind !== 'wholeVideo')
              .length,
            ...config.outputSpec,
          }),
    },
    dataList: result.dataList,
    ...(run.stage === 'analysis' ? { plan: {} } : {}),
  };
}
export const callbackPath = (stage: Stage) =>
  '/ai_video_director/' +
  (stage === 'analysis'
    ? 'getAiVideoEditingAnalysisDataCallback'
    : 'getAiVideoEditingDataCallback');
