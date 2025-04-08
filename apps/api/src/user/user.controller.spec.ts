// 导入 NestJS 测试模块，用于创建测试环境
import { Test, TestingModule } from '@nestjs/testing';
// 导入要测试的 UserController 控制器
import { UserController } from './user.controller';
// 导入 UserService 服务，用于在测试中模拟
import { UserService } from './user.service';
// 导入 createMock 函数，用于创建模拟对象
import { createMock } from '@golevelup/ts-jest';
// 导入 JwtService，用于处理 JWT 令牌
import { JwtService } from '@nestjs/jwt';
// 导入 ConfigService，用于访问应用配置
import { ConfigService } from '@nestjs/config';

// 描述 UserController 的测试套件
describe('UserController', () => {
  // 声明 controller 变量，用于存储 UserController 实例
  let controller: UserController;

  // 创建 UserService 的模拟实例
  const userService = createMock<UserService>();
  // 创建 JwtService 的模拟实例
  const jwtService = createMock<JwtService>();
  // 创建 ConfigService 的模拟实例
  const configService = createMock<ConfigService>();

  // 在每个测试用例执行前的准备工作
  beforeEach(async () => {
    // 创建测试模块
    const module: TestingModule = await Test.createTestingModule({
      // 注册要测试的控制器
      controllers: [UserController],
      // 注册测试所需的服务提供者
      providers: [
        // 提供 UserService 的模拟实现
        { provide: UserService, useValue: userService },
        // 提供 JwtService 的模拟实现
        { provide: JwtService, useValue: jwtService },
        // 提供 ConfigService 的模拟实现
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    // 从测试模块中获取 UserController 实例
    controller = module.get<UserController>(UserController);
  });

  // 测试用例：验证控制器是否被正确定义
  it('should be defined', () => {
    // 断言控制器实例已被定义
    expect(controller).toBeDefined();
  });
});
