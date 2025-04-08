// 导入 NestJS 的模块装饰器
import { Module } from '@nestjs/common';
// 导入 BullMQ 模块，用于处理队列任务
import { BullModule } from '@nestjs/bullmq';
// 导入画布控制器
import { CanvasController } from './canvas.controller';
// 导入画布服务
import { CanvasService } from './canvas.service';
// 导入画布相关的处理器
import {
  // 清除画布实体处理器
  ClearCanvasEntityProcessor,
  // 同步画布实体处理器
  SyncCanvasEntityProcessor,
  // 自动命名画布处理器
  AutoNameCanvasProcessor,
} from './canvas.processor';
// 导入协作模块
import { CollabModule } from '@/collab/collab.module';
// 导入删除知识实体队列常量
import { QUEUE_DELETE_KNOWLEDGE_ENTITY } from '@/utils/const';
// 导入公共模块
import { CommonModule } from '@/common/common.module';
// 导入杂项模块
import { MiscModule } from '@/misc/misc.module';
// 导入订阅模块
import { SubscriptionModule } from '@/subscription/subscription.module';
// 导入知识模块
import { KnowledgeModule } from '@/knowledge/knowledge.module';
// 导入动作模块
import { ActionModule } from '@/action/action.module';
// 导入代码工件模块
import { CodeArtifactModule } from '@/code-artifact/code-artifact.module';

// 使用 @Module 装饰器定义画布模块
@Module({
  // 导入其他模块
  imports: [
    // 导入公共模块
    CommonModule,
    // 导入协作模块
    CollabModule,
    // 导入杂项模块
    MiscModule,
    // 导入知识模块
    KnowledgeModule,
    // 导入动作模块
    ActionModule,
    // 导入代码工件模块
    CodeArtifactModule,
    // 导入订阅模块
    SubscriptionModule,
    // 注册 BullMQ 队列
    BullModule.registerQueue({
      // 设置队列名称为删除知识实体队列
      name: QUEUE_DELETE_KNOWLEDGE_ENTITY,
    }),
  ],
  // 声明该模块的控制器
  controllers: [CanvasController],
  // 声明该模块的提供者（服务和处理器）
  providers: [
    // 画布服务
    CanvasService,
    // 同步画布实体处理器
    SyncCanvasEntityProcessor,
    // 清除画布实体处理器
    ClearCanvasEntityProcessor,
    // 自动命名画布处理器
    AutoNameCanvasProcessor,
  ],
  // 导出画布服务，使其可以被其他模块使用
  exports: [CanvasService],
})
// 导出画布模块类
export class CanvasModule {}
