// 导入 NestJS 的依赖注入装饰器、日志记录器和模块初始化接口
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// 导入配置服务，用于获取应用配置
import { ConfigService } from '@nestjs/config';
// 导入 Redis 客户端库
import Redis from 'ioredis';

// 标记为可注入的服务类
@Injectable()
// 定义 Redis 服务类，继承自 Redis 客户端并实现 OnModuleInit 接口
export class RedisService extends Redis implements OnModuleInit {
  // 创建日志记录器实例
  private readonly logger = new Logger(RedisService.name);
  // 定义初始化超时时间为 10 秒
  private readonly INIT_TIMEOUT = 10000;

  // 构造函数，注入配置服务
  constructor(private configService: ConfigService) {
    // 调用父类构造函数，配置 Redis 连接
    super({
      // 从配置中获取 Redis 主机地址
      host: configService.getOrThrow('redis.host'),
      // 从配置中获取 Redis 端口
      port: configService.getOrThrow('redis.port'),
      // 从配置中获取 Redis 密码，如果未设置则为 undefined
      password: configService.get('redis.password') || undefined,
    });
  }

  // 模块初始化时执行的方法
  async onModuleInit() {
    // 创建 Redis ping 测试承诺
    const initPromise = this.ping();
    // 创建超时承诺
    const timeoutPromise = new Promise((_, reject) => {
      // 设置超时定时器
      setTimeout(() => {
        reject(`Redis connection timed out after ${this.INIT_TIMEOUT}ms`);
      }, this.INIT_TIMEOUT);
    });

    try {
      // 使用 Promise.race 竞争执行连接测试和超时
      await Promise.race([initPromise, timeoutPromise]);
      // 记录连接成功日志
      this.logger.log('Redis connection established');
    } catch (error) {
      // 记录连接失败错误并重新抛出
      this.logger.error(`Failed to establish Redis connection: ${error}`);
      throw error;
    }
  }

  // 获取分布式锁的方法
  async acquireLock(key: string) {
    try {
      // 生成唯一的锁标识符，使用进程ID和时间戳
      const token = `${process.pid}-${Date.now()}`;
      // 尝试设置锁，使用 NX（只在键不存在时设置）和 10 秒过期时间
      const success = await this.set(key, token, 'EX', 10, 'NX');

      // 如果成功获取锁
      if (success) {
        // 返回释放锁的函数
        return async () => await this.releaseLock(key, token);
      }
      // 如果获取锁失败，返回 null
      return null;
    } catch (err) {
      // 记录获取锁失败的警告
      this.logger.warn('Error acquiring lock:', err);
      return null;
    }
  }

  // 释放分布式锁的方法
  async releaseLock(key: string, token: string) {
    try {
      // 定义 Lua 脚本，确保只释放由当前进程获取的锁
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      // 执行 Lua 脚本
      const success = await this.eval(script, 1, key, token);

      // 如果成功释放锁
      if (success === 1) {
        return true;
      }
      // 如果锁不存在或已被其他进程释放
      return false;
    } catch (err) {
      // 记录释放锁失败的错误
      this.logger.error('Error releasing lock:', err);
      throw false;
    }
  }
}
