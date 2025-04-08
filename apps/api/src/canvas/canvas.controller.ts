// 导入 NestJS 的核心装饰器和管道
import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
// 导入 JWT 认证守卫
import { JwtAuthGuard } from '@/auth/guard/jwt-auth.guard';
// 导入画布服务
import { CanvasService } from './canvas.service';
// 导入已登录用户装饰器
import { LoginedUser } from '@/utils/decorators/user.decorator';
// 导入画布 PO 到 DTO 的转换函数
import { canvasPO2DTO } from '@/canvas/canvas.dto';
// 导入构建成功响应的工具函数
import { buildSuccessResponse } from '@/utils';
// 导入相关的接口和类型定义
import {
  User,
  UpsertCanvasRequest,
  DeleteCanvasRequest,
  AutoNameCanvasRequest,
  AutoNameCanvasResponse,
  DuplicateCanvasRequest,
} from '@refly-packages/openapi-schema';

// 定义控制器路由前缀为 'v1/canvas'
@Controller('v1/canvas')
// 导出画布控制器类
export class CanvasController {
  // 构造函数，注入画布服务
  constructor(private canvasService: CanvasService) {}

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义获取画布列表的 GET 请求路由
  @Get('list')
  // 获取画布列表的异步方法
  async listCanvases(
    // 获取当前登录用户
    @LoginedUser() user: User,
    // 获取页码参数，默认值为1，并转换为数字类型
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    // 获取每页大小参数，默认值为10，并转换为数字类型
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
  ) {
    // 调用服务获取画布列表
    const canvases = await this.canvasService.listCanvases(user, { page, pageSize });
    // 将画布列表转换为 DTO 并构建成功响应
    return buildSuccessResponse(canvases.map(canvasPO2DTO));
  }

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义获取画布详情的 GET 请求路由
  @Get('detail')
  // 获取画布详情的异步方法
  async getCanvasDetail(@LoginedUser() user: User, @Query('canvasId') canvasId: string) {
    // 调用服务获取画布详情
    const canvas = await this.canvasService.getCanvasDetail(user, canvasId);
    // 将画布详情转换为 DTO 并构建成功响应
    return buildSuccessResponse(canvasPO2DTO(canvas));
  }

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义获取画布原始数据的 GET 请求路由
  @Get('data')
  // 获取画布原始数据的异步方法
  async getCanvasData(@LoginedUser() user: User, @Query('canvasId') canvasId: string) {
    // 调用服务获取画布原始数据
    const data = await this.canvasService.getCanvasRawData(user, canvasId);
    // 构建成功响应
    return buildSuccessResponse(data);
  }

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义复制画布的 POST 请求路由
  @Post('duplicate')
  // 复制画布的异步方法
  async duplicateCanvas(@LoginedUser() user: User, @Body() body: DuplicateCanvasRequest) {
    // 调用服务复制画布，并检查所有权
    const canvas = await this.canvasService.duplicateCanvas(user, body, { checkOwnership: true });
    // 将复制的画布转换为 DTO 并构建成功响应
    return buildSuccessResponse(canvasPO2DTO(canvas));
  }

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义创建画布的 POST 请求路由
  @Post('create')
  // 创建画布的异步方法
  async createCanvas(@LoginedUser() user: User, @Body() body: UpsertCanvasRequest) {
    // 调用服务创建画布
    const canvas = await this.canvasService.createCanvas(user, body);
    // 将创建的画布转换为 DTO 并构建成功响应
    return buildSuccessResponse(canvasPO2DTO(canvas));
  }

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义更新画布的 POST 请求路由
  @Post('update')
  // 更新画布的异步方法
  async updateCanvas(@LoginedUser() user: User, @Body() body: UpsertCanvasRequest) {
    // 调用服务更新画布
    const canvas = await this.canvasService.updateCanvas(user, body);
    // 将更新的画布转换为 DTO 并构建成功响应
    return buildSuccessResponse(canvasPO2DTO(canvas));
  }

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义删除画布的 POST 请求路由
  @Post('delete')
  // 删除画布的异步方法
  async deleteCanvas(@LoginedUser() user: User, @Body() body: DeleteCanvasRequest) {
    // 调用服务删除画布
    await this.canvasService.deleteCanvas(user, body);
    // 构建空的成功响应
    return buildSuccessResponse({});
  }

  // 使用 JWT 认证守卫保护该路由
  @UseGuards(JwtAuthGuard)
  // 定义自动命名画布的 POST 请求路由
  @Post('autoName')
  // 自动命名画布的异步方法
  async autoNameCanvas(
    // 获取当前登录用户
    @LoginedUser() user: User,
    // 获取请求体数据
    @Body() body: AutoNameCanvasRequest,
    // 方法返回值类型为 AutoNameCanvasResponse
  ): Promise<AutoNameCanvasResponse> {
    // 调用服务自动命名画布
    const data = await this.canvasService.autoNameCanvas(user, body);
    // 构建成功响应
    return buildSuccessResponse(data);
  }
}
