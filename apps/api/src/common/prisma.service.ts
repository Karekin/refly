// 导入 NestJS 的依赖注入装饰器、日志记录器和模块初始化接口
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// 导入 Prisma 客户端
import { PrismaClient } from '@prisma/client';

// 标记为可注入的服务
@Injectable()
// 定义 Prisma 服务类，继承自 PrismaClient 并实现 OnModuleInit 接口
export class PrismaService extends PrismaClient implements OnModuleInit {
  // 创建日志记录器实例
  private logger = new Logger(PrismaService.name);
  // 定义数据库连接初始化超时时间为 10 秒
  private readonly INIT_TIMEOUT = 10000;

  // 构造函数
  constructor() {
    // 调用父类构造函数，配置日志选项
    super({
      // 配置日志记录
      log: [
        {
          // 设置日志发送方式为事件
          emit: 'event',
          // 设置记录查询级别的日志
          level: 'query',
        },
      ],
    });
  }

  // 模块初始化时执行的方法
  async onModuleInit() {
    // 创建数据库连接初始化承诺
    const initPromise = this.connectToDatabase();
    // 创建超时承诺
    const timeoutPromise = new Promise((_, reject) => {
      // 设置超时定时器
      setTimeout(() => {
        // 超时后拒绝承诺
        reject(`Database connection timed out after ${this.INIT_TIMEOUT}ms`);
      }, this.INIT_TIMEOUT);
    });

    try {
      // 使用 Promise.race 竞争执行数据库连接和超时
      await Promise.race([initPromise, timeoutPromise]);
      // 连接成功后记录日志
      this.logger.log('Database connection initialized successfully');
    } catch (error) {
      // 连接失败时记录错误日志
      this.logger.error(`Failed to initialize database connection: ${error}`);
      // 抛出错误
      throw error;
    }
  }

  // 连接数据库的方法
  async connectToDatabase() {
    // 建立数据库连接
    await this.$connect();
    // 记录连接成功日志
    this.logger.log('Connected to database');

    // 监听查询事件
    this.$on('query' as never, (e: any) => {
      // 仅在生产环境下记录查询日志
      if (process.env.NODE_ENV === 'production') {
        // 记录查询语句、参数和执行时间
        this.logger.log(`query: ${e.query}, param: ${e.params}, duration: ${e.duration}ms`);
      }
    });
  }
}
