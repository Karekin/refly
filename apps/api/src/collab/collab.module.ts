// 导入 NestJS 的模块装饰器
import { Module } from '@nestjs/common';
// 导入 BullMQ 模块，用于处理队列任务
import { BullModule } from '@nestjs/bullmq';
// 导入协作网关，用于处理 WebSocket 连接
import { CollabGateway } from './collab.gateway';
// 导入公共模块，包含共享服务和组件
import { CommonModule } from '@/common/common.module';
// 导入 RAG（检索增强生成）模块
import { RAGModule } from '@/rag/rag.module';
// 导入杂项模块，包含辅助功能
import { MiscModule } from '@/misc/misc.module';
// 导入订阅模块，处理用户订阅相关功能
import { SubscriptionModule } from '@/subscription/subscription.module';
// 导入同步画布实体队列常量
import { QUEUE_SYNC_CANVAS_ENTITY } from '@/utils/const';
// 导入协作服务，处理协作业务逻辑
import { CollabService } from './collab.service';
// 导入协作控制器，处理 HTTP 请求
import { CollabController } from './collab.controller';

// 使用 @Module 装饰器定义协作模块
@Module({
  // 导入其他模块
  imports: [
    // 导入公共模块，提供基础服务
    CommonModule,
    // 导入 RAG 模块，提供检索增强生成功能
    RAGModule,
    // 导入杂项模块，提供辅助功能
    MiscModule,
    // 导入订阅模块，处理用户订阅
    SubscriptionModule,
    // 注册 BullMQ 队列，用于同步画布实体
    BullModule.registerQueue({ name: QUEUE_SYNC_CANVAS_ENTITY }),
  ],
  // 声明该模块的提供者
  providers: [CollabGateway, CollabService],
  // 导出协作服务，使其可以被其他模块使用
  exports: [CollabService],
  // 声明该模块的控制器
  controllers: [CollabController],
})
// 导出协作模块类
export class CollabModule {}
