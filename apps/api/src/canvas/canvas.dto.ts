// 从 Prisma 客户端导入画布模型，并重命名为 CanvasModel
import { Canvas as CanvasModel } from '@prisma/client';
// 从 OpenAPI 架构中导入画布和实体接口定义
import { Canvas, Entity } from '@refly-packages/openapi-schema';
// 导入工具函数 pick，用于选择对象的特定属性
import { pick } from '@/utils';

// 定义同步画布实体任务数据接口
export interface SyncCanvasEntityJobData {
  // 画布ID
  canvasId: string;
}

// 定义删除画布节点任务数据接口
export interface DeleteCanvasNodesJobData {
  // 要删除的实体数组
  entities: Entity[];
}

// 定义自动命名画布任务数据接口
export interface AutoNameCanvasJobData {
  // 用户ID
  uid: string;
  // 画布ID
  canvasId: string;
}

// 定义画布持久化对象（PO）到数据传输对象（DTO）的转换函数
// 参数类型为 CanvasModel 并扩展了可选的 minimapUrl 属性
export function canvasPO2DTO(canvas: CanvasModel & { minimapUrl?: string }): Canvas {
  return {
    // 使用 pick 函数选择需要的属性
    ...pick(canvas, ['canvasId', 'title', 'minimapUrl', 'minimapStorageKey']),
    // 将创建时间转换为 JSON 字符串
    createdAt: canvas.createdAt.toJSON(),
    // 将更新时间转换为 JSON 字符串
    updatedAt: canvas.updatedAt.toJSON(),
  };
}
