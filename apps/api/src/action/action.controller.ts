// 导入 NestJS 的控制器、GET 请求装饰器、查询参数装饰器和守卫装饰器
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
// 导入动作结果响应的接口定义
import { GetActionResultResponse } from '@refly-packages/openapi-schema';
// 导入已登录用户装饰器
import { LoginedUser } from '@/utils/decorators/user.decorator';
// 导入 Prisma 的用户模型，并重命名为 UserModel
import { User as UserModel } from '@prisma/client';
// 导入构建成功响应的工具函数
import { buildSuccessResponse } from '@/utils/response';
// 导入动作服务
import { ActionService } from '@/action/action.service';
// 导入动作结果 PO 到 DTO 的转换函数
import { actionResultPO2DTO } from '@/action/action.dto';
// 导入 JWT 认证守卫
import { JwtAuthGuard } from '@/auth/guard/jwt-auth.guard';

// 定义控制器路由前缀为 'v1/action'
@Controller('v1/action')
// 导出动作控制器类
export class ActionController {
  // 构造函数，注入动作服务
  constructor(private readonly actionService: ActionService) {}

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义 GET 请求路由 '/result'
  @Get('/result')
  // 获取动作结果的异步方法
  async getActionResult(
    // 使用 @LoginedUser 装饰器获取当前登录用户
    @LoginedUser() user: UserModel,
    // 使用 @Query 装饰器获取查询参数 resultId
    @Query('resultId') resultId: string,
    // 方法返回值类型为 GetActionResultResponse
  ): Promise<GetActionResultResponse> {
    // 调用服务层方法获取动作结果
    const result = await this.actionService.getActionResult(user, { resultId });
    // 将结果转换为 DTO 并构建成功响应
    return buildSuccessResponse(actionResultPO2DTO(result));
  }
}
