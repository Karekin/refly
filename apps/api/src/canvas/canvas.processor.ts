// 导入 BullMQ 的处理器装饰器和工作主机基类
import { Processor, WorkerHost } from '@nestjs/bullmq';
// 导入 NestJS 的日志记录器
import { Logger } from '@nestjs/common';
// 导入 BullMQ 的任务类型
import { Job } from 'bullmq';

// 导入画布服务
import { CanvasService } from './canvas.service';
// 导入队列常量
import {
  // 清除画布实体队列名称
  QUEUE_CLEAR_CANVAS_ENTITY,
  // 同步画布实体队列名称
  QUEUE_SYNC_CANVAS_ENTITY,
  // 自动命名画布队列名称
  QUEUE_AUTO_NAME_CANVAS,
} from '@/utils/const';
// 导入任务数据接口
import {
  // 删除画布节点任务数据接口
  DeleteCanvasNodesJobData,
  // 同步画布实体任务数据接口
  SyncCanvasEntityJobData,
  // 自动命名画布任务数据接口
  AutoNameCanvasJobData,
} from './canvas.dto';

// 使用处理器装饰器，指定处理同步画布实体队列
@Processor(QUEUE_SYNC_CANVAS_ENTITY)
// 导出同步画布实体处理器类，继承自工作主机基类
export class SyncCanvasEntityProcessor extends WorkerHost {
  // 创建私有的只读日志记录器实例
  private readonly logger = new Logger(SyncCanvasEntityProcessor.name);

  // 构造函数，注入画布服务
  constructor(private canvasService: CanvasService) {
    super();
  }

  // 处理任务的异步方法
  async process(job: Job<SyncCanvasEntityJobData>) {
    // 记录任务数据日志
    this.logger.log(`[${QUEUE_SYNC_CANVAS_ENTITY}] job: ${JSON.stringify(job.data)}`);

    try {
      // 调用服务同步画布实体关系
      await this.canvasService.syncCanvasEntityRelation(job.data.canvasId);
    } catch (error) {
      // 记录错误日志
      this.logger.error(`[${QUEUE_SYNC_CANVAS_ENTITY}] error: ${error?.stack}`);
      // 重新抛出错误
      throw error;
    }
  }
}

// 使用处理器装饰器，指定处理清除画布实体队列
@Processor(QUEUE_CLEAR_CANVAS_ENTITY)
// 导出清除画布实体处理器类，继承自工作主机基类
export class ClearCanvasEntityProcessor extends WorkerHost {
  // 创建私有的日志记录器实例
  private logger = new Logger(ClearCanvasEntityProcessor.name);

  // 构造函数，注入画布服务
  constructor(private canvasService: CanvasService) {
    super();
  }

  // 处理任务的异步方法
  async process(job: Job<DeleteCanvasNodesJobData>) {
    // 从任务数据中解构实体数组
    const { entities } = job.data;

    try {
      // 调用服务从画布中删除实体节点
      await this.canvasService.deleteEntityNodesFromCanvases(entities);
    } catch (error) {
      // 记录错误日志
      this.logger.error(`[${QUEUE_CLEAR_CANVAS_ENTITY}] error ${job.id}: ${error?.stack}`);
      // 重新抛出错误
      throw error;
    }
  }
}

// 使用处理器装饰器，指定处理自动命名画布队列
@Processor(QUEUE_AUTO_NAME_CANVAS)
// 导出自动命名画布处理器类，继承自工作主机基类
export class AutoNameCanvasProcessor extends WorkerHost {
  // 创建私有的日志记录器实例
  private logger = new Logger(AutoNameCanvasProcessor.name);

  // 构造函数，注入画布服务
  constructor(private canvasService: CanvasService) {
    super();
  }

  // 处理任务的异步方法
  async process(job: Job<AutoNameCanvasJobData>) {
    // 记录处理任务的日志
    this.logger.log(`Processing auto name canvas job ${job.id} for canvas ${job.data.canvasId}`);
    // 调用服务从队列中处理自动命名画布
    await this.canvasService.autoNameCanvasFromQueue(job.data);
  }
}
