// 从 OpenAPI 架构中导入动作相关的接口定义
import {
  ActionResult,
  ActionStep,
  ActionType,
  EntityType,
  ModelTier,
} from '@refly-packages/openapi-schema';

// 从 Prisma 客户端导入数据模型，并重命名以避免命名冲突
import {
  ActionResult as ActionResultModel,
  ActionStep as ActionStepModel,
  ModelInfo as ModelInfoModel,
} from '@prisma/client';

// 导入工具函数 pick，用于选择对象的特定属性
import { pick } from '@/utils';
// 导入模型信息的 PO 到 DTO 转换函数
import { modelInfoPO2DTO } from '@/misc/misc.dto';

// 定义动作详情类型，继承自 ActionResultModel 并添加可选的步骤和模型信息
export type ActionDetail = ActionResultModel & {
  // 可选的动作步骤数组
  steps?: ActionStepModel[];
  // 可选的模型信息
  modelInfo?: ModelInfoModel;
};

// 定义动作步骤的持久化对象（PO）到数据传输对象（DTO）的转换函数
export function actionStepPO2DTO(step: ActionStepModel): ActionStep {
  return {
    // 使用 pick 函数选择基本属性
    ...pick(step, ['name', 'content', 'reasoningContent']),
    // 将日志字符串解析为数组，如果为空则返回空数组
    logs: JSON.parse(step.logs || '[]'),
    // 将工件字符串解析为数组，如果为空则返回空数组
    artifacts: JSON.parse(step.artifacts || '[]'),
    // 将结构化数据字符串解析为对象，如果为空则返回空对象
    structuredData: JSON.parse(step.structuredData || '{}'),
    // 将令牌使用情况字符串解析为数组，如果为空则返回空数组
    tokenUsage: JSON.parse(step.tokenUsage || '[]'),
  };
}

// 定义动作结果的持久化对象（PO）到数据传输对象（DTO）的转换函数
export function actionResultPO2DTO(result: ActionDetail): ActionResult {
  return {
    // 使用 pick 函数选择基本属性
    ...pick(result, ['resultId', 'version', 'title', 'targetId', 'status']),
    // 类型转换为 ActionType 枚举
    type: result.type as ActionType,
    // 等级转换为 ModelTier 枚举
    tier: result.tier as ModelTier,
    // 目标类型转换为 EntityType 枚举
    targetType: result.targetType as EntityType,
    // 将输入字符串解析为对象，如果为空则返回空对象
    input: JSON.parse(result.input || '{}'),
    // 将动作元数据字符串解析为对象，如果为空则返回空对象
    actionMeta: JSON.parse(result.actionMeta || '{}'),
    // 将上下文字符串解析为对象，如果为空则返回空对象
    context: JSON.parse(result.context || '{}'),
    // 将模板配置字符串解析为对象，如果为空则返回空对象
    tplConfig: JSON.parse(result.tplConfig || '{}'),
    // 将运行时配置字符串解析为对象，如果为空则返回空对象
    runtimeConfig: JSON.parse(result.runtimeConfig || '{}'),
    // 将历史记录字符串解析为数组，如果为空则返回空数组
    history: JSON.parse(result.history || '[]'),
    // 将错误信息字符串解析为数组，如果为空则返回空数组
    errors: JSON.parse(result.errors || '[]'),
    // 将创建时间转换为 JSON 字符串
    createdAt: result.createdAt.toJSON(),
    // 将更新时间转换为 JSON 字符串
    updatedAt: result.updatedAt.toJSON(),
    // 如果存在步骤，则将每个步骤转换为 DTO
    steps: result.steps?.map(actionStepPO2DTO),
    // 如果存在模型信息，则转换为 DTO，否则返回 undefined
    modelInfo: result.modelInfo ? modelInfoPO2DTO(result.modelInfo) : undefined,
  };
}
