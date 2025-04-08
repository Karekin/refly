// 导入动作详情类型定义
import { ActionDetail } from '@/action/action.dto';
// 导入 Prisma 服务，用于数据库操作
import { PrismaService } from '@/common/prisma.service';
// 导入订阅服务
import { SubscriptionService } from '@/subscription/subscription.service';
// 导入 NestJS 的依赖注入装饰器
import { Injectable } from '@nestjs/common';
// 导入动作结果未找到错误类
import { ActionResultNotFoundError } from '@refly-packages/errors';
// 导入 Prisma 的动作结果模型
import { ActionResult } from '@prisma/client';
// 导入实体类型、获取动作结果数据和用户接口
import { EntityType, GetActionResultData, User } from '@refly-packages/openapi-schema';
// 导入批量替换正则、生成动作结果ID和选择属性的工具函数
import { batchReplaceRegex, genActionResultID, pick } from '@refly-packages/utils';
// 导入并发限制工具
import pLimit from 'p-limit';

// 标记为可注入的服务类
@Injectable()
export class ActionService {
  // 构造函数，注入所需的服务
  constructor(
    // 注入 Prisma 服务
    private readonly prisma: PrismaService,
    // 注入订阅服务
    private subscriptionService: SubscriptionService,
  ) {}

  // 获取动作结果的方法
  async getActionResult(user: User, param: GetActionResultData['query']): Promise<ActionDetail> {
    // 解构参数，获取结果ID和版本号
    const { resultId, version } = param;

    // 查找符合条件的第一个动作结果
    const result = await this.prisma.actionResult.findFirst({
      where: {
        resultId,
        version,
        uid: user.uid,
      },
      // 按版本号降序排序
      orderBy: { version: 'desc' },
    });
    // 如果未找到结果，抛出错误
    if (!result) {
      throw new ActionResultNotFoundError();
    }

    // 如果结果状态为执行中且最后更新时间超过3分钟，将其标记为失败
    if (result.status === 'executing' && result.updatedAt < new Date(Date.now() - 1000 * 60 * 3)) {
      // 更新动作结果状态
      const updatedResult = await this.prisma.actionResult.update({
        where: {
          pk: result.pk,
          status: 'executing',
        },
        data: {
          status: 'failed',
          errors: `["Execution timeout"]`,
        },
      });
      return updatedResult;
    }

    // 获取模型列表
    const modelList = await this.subscriptionService.getModelList();
    // 查找匹配的模型信息
    const modelInfo = modelList.find((model) => model.name === result.modelName);

    // 获取该结果的所有步骤
    const steps = await this.prisma.actionStep.findMany({
      where: {
        resultId: result.resultId,
        version: result.version,
        deletedAt: null,
      },
      // 按步骤顺序升序排序
      orderBy: { order: 'asc' },
    });

    // 返回完整的动作结果信息
    return { ...result, steps, modelInfo };
  }

  // 复制动作结果的方法
  async duplicateActionResults(
    user: User,
    param: {
      sourceResultIds: string[]; // 源结果ID数组
      targetId: string; // 目标ID
      targetType: EntityType; // 目标类型
      replaceEntityMap: Record<string, string>; // 实体替换映射
    },
    options?: { checkOwnership?: boolean }, // 可选的所有权检查选项
  ) {
    // 解构参数
    const { sourceResultIds, targetId, targetType, replaceEntityMap } = param;

    // 获取所有指定的动作结果
    const allResults = await this.prisma.actionResult.findMany({
      where: {
        resultId: { in: sourceResultIds },
      },
      orderBy: { version: 'desc' },
    });

    // 如果没有找到结果，返回空数组
    if (!allResults?.length) {
      return [];
    }

    // 过滤出每个结果ID的最新版本
    const latestResultsMap = new Map<string, ActionResult>();
    for (const result of allResults) {
      if (
        !latestResultsMap.has(result.resultId) ||
        latestResultsMap.get(result.resultId).version < result.version
      ) {
        latestResultsMap.set(result.resultId, result);
      }
    }

    // 将 Map 转换为数组
    const filteredOriginalResults = Array.from(latestResultsMap.values());

    // 如果没有过滤后的结果，返回空数组
    if (!filteredOriginalResults.length) {
      return [];
    }

    // 为每个源结果ID生成新的结果ID
    for (const sourceResultId of sourceResultIds) {
      replaceEntityMap[sourceResultId] = genActionResultID();
    }

    // 创建并发限制器，最多同时处理5个请求
    const limit = pLimit(5);

    // 并行处理每个原始结果
    const newResultsPromises = filteredOriginalResults.map((originalResult) =>
      limit(async () => {
        // 解构原始结果的关键信息
        const { resultId, version, context, history } = originalResult;

        // 检查用户是否有权限访问该结果
        if (options?.checkOwnership && user.uid !== originalResult.uid) {
          // 查询共享记录数量
          const shareCnt = await this.prisma.shareRecord.count({
            where: {
              entityId: resultId,
              entityType: 'skillResponse',
              deletedAt: null,
            },
          });

          // 如果没有共享记录，跳过该结果
          if (shareCnt === 0) {
            return null;
          }
        }

        // 获取新的结果ID
        const newResultId = replaceEntityMap[resultId];

        // 获取原始步骤
        const originalSteps = await this.prisma.actionStep.findMany({
          where: {
            resultId,
            version,
            deletedAt: null,
          },
          orderBy: { order: 'asc' },
        });

        // 创建新的动作结果
        const newResult = await this.prisma.actionResult.create({
          data: {
            // 复制原始结果的基本属性
            ...pick(originalResult, [
              'type',
              'title',
              'tier',
              'modelName',
              'input',
              'actionMeta',
              'tplConfig',
              'runtimeConfig',
              'locale',
              'status',
              'errors',
            ]),
            // 替换上下文中的实体引用
            context: batchReplaceRegex(JSON.stringify(context), replaceEntityMap),
            // 替换历史记录中的实体引用
            history: batchReplaceRegex(JSON.stringify(history), replaceEntityMap),
            resultId: newResultId,
            uid: user.uid,
            targetId,
            targetType,
            duplicateFrom: resultId,
            version: 0, // 新副本的版本号重置为0
          },
        });

        // 如果存在原始步骤，创建新的步骤
        if (originalSteps?.length > 0) {
          await this.prisma.actionStep.createMany({
            data: originalSteps.map((step) => ({
              // 复制步骤的基本属性
              ...pick(step, [
                'order',
                'name',
                'content',
                'reasoningContent',
                'structuredData',
                'logs',
                'tokenUsage',
              ]),
              resultId: newResult.resultId,
              // 替换工件中的实体引用
              artifacts: batchReplaceRegex(JSON.stringify(step.artifacts), replaceEntityMap),
              version: 0, // 新副本的版本号重置为0
            })),
          });
        }

        return newResult;
      }),
    );

    // 等待所有Promise完成并过滤掉null结果（因访问检查而跳过的结果）
    const results = await Promise.all(newResultsPromises);

    return results.filter((result) => result !== null);
  }
}
