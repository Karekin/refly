// 从 @nestjs/common 包中导入 Module 装饰器，用于定义 NestJS 模块
import { Module } from '@nestjs/common';
// 导入 UserService 服务，用于处理用户相关的业务逻辑
import { UserService } from './user.service';
// 导入 UserController 控制器，用于处理用户相关的 HTTP 请求
import { UserController } from './user.controller';
// 导入 CommonModule 公共模块，提供通用功能
import { CommonModule } from '@/common/common.module';
// 导入 SubscriptionModule 订阅模块，处理用户订阅相关功能
import { SubscriptionModule } from '@/subscription/subscription.module';
// 导入 MiscModule 杂项模块，提供其他辅助功能
import { MiscModule } from '@/misc/misc.module';

// 使用 @Module 装饰器定义 UserModule 模块
@Module({
  // 导入其他模块，使其导出的提供者在本模块中可用
  imports: [CommonModule, MiscModule, SubscriptionModule],
  // 定义模块中的服务提供者
  providers: [UserService],
  // 导出 UserService，使其可以被其他导入本模块的模块使用
  exports: [UserService],
  // 定义模块中的控制器
  controllers: [UserController],
})
// 导出 UserModule 类，使其可以被其他模块导入
export class UserModule {}
