// 导入NestJS所需的装饰器和工具类
import { Controller, Logger, Get, Body, UseGuards, Put, Query } from '@nestjs/common';

// 导入用户服务，用于处理用户相关的业务逻辑
import { UserService } from './user.service';
// 导入JWT认证守卫，用于保护需要认证的路由
import { JwtAuthGuard } from '@/auth/guard/jwt-auth.guard';
// 导入已登录用户装饰器，用于获取当前登录用户信息
import { LoginedUser } from '@/utils/decorators/user.decorator';
// 导入API接口所需的响应和请求类型定义
import {
  BaseResponse,
  CheckSettingsFieldResponse,
  GetUserSettingsResponse,
  UpdateUserSettingsRequest,
  User,
} from '@refly-packages/openapi-schema';
// 导入构建成功响应的工具函数
import { buildSuccessResponse } from '@/utils';
// 导入用户PO对象转换为设置对象的工具函数
import { userPO2Settings } from '@/user/user.dto';

// 定义用户控制器，处理v1/user路径下的请求
@Controller('v1/user')
export class UserController {
  // 创建日志记录器实例，用于记录控制器相关日志
  private logger = new Logger(UserController.name);

  // 通过依赖注入获取UserService实例
  constructor(private userService: UserService) {}

  // 使用JWT认证守卫保护该路由，确保只有已认证用户可以访问
  @UseGuards(JwtAuthGuard)
  // 定义GET请求处理方法，路径为v1/user/settings
  @Get('settings')
  // 获取用户设置的方法，接收当前登录用户作为参数
  async getSettings(@LoginedUser() user: User): Promise<GetUserSettingsResponse> {
    // 调用用户服务获取用户设置信息
    const userPo = await this.userService.getUserSettings(user);
    // 将用户PO对象转换为设置对象
    const settings = userPO2Settings(userPo);

    // 返回成功响应，包含用户设置信息
    return buildSuccessResponse(settings);
  }

  // 使用JWT认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义PUT请求处理方法，路径为v1/user/settings
  @Put('settings')
  // 更新用户设置的方法，接收当前登录用户和请求体作为参数
  async updateSettings(
    @LoginedUser() user: User,
    @Body() body: UpdateUserSettingsRequest,
  ): Promise<BaseResponse> {
    // 调用用户服务更新用户设置
    await this.userService.updateSettings(user, body);
    // 返回成功响应，不包含具体数据
    return buildSuccessResponse();
  }

  // 使用JWT认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义GET请求处理方法，路径为v1/user/checkSettingsField
  @Get('checkSettingsField')
  // 检查设置字段的方法，用于验证用户名或邮箱是否可用
  async checkSettingsField(
    // 获取当前登录用户
    @LoginedUser() user: User,
    // 获取要检查的字段类型，只能是name或email
    @Query('field') field: 'name' | 'email',
    // 获取要检查的字段值
    @Query('value') value: string,
  ): Promise<CheckSettingsFieldResponse> {
    // 调用用户服务检查设置字段
    const result = await this.userService.checkSettingsField(user, { field, value });
    // 返回成功响应，包含检查结果
    return buildSuccessResponse(result);
  }
}
