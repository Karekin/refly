// 导入 MinioConfig 配置接口
import { MinioConfig } from '@/config/app.config';
// 导入 NestJS 的依赖注入装饰器、日志记录器和模块初始化接口
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
// 导入 Minio 客户端，并重命名为 MinioClient
import { Client as MinioClient } from 'minio';
// 导入 Node.js 的可读流类型
import { Readable } from 'node:stream';

// 定义内部对象存储常量，仅供 API 服务器内部使用
export const MINIO_INTERNAL = 'minio-internal';

// 定义外部对象存储常量，通常用于公共访问
export const MINIO_EXTERNAL = 'minio-external';

// 定义代理 Minio 客户端类型，自动处理桶名参数
type ProxiedMinioClient = {
  [K in keyof MinioClient]: MinioClient[K] extends (bucket: string, ...args: infer P) => infer R
    ? (...args: P) => R
    : MinioClient[K];
};

// 标记为可注入的服务类，并实现模块初始化接口
@Injectable()
export class MinioService implements OnModuleInit {
  // 创建日志记录器实例
  private readonly logger = new Logger(MinioService.name);
  // 声明私有的 Minio 客户端实例
  private _client: MinioClient;
  // 声明私有的代理客户端实例
  private proxiedClient: ProxiedMinioClient;
  // 定义初始化超时时间为 10 秒
  private readonly INIT_TIMEOUT = 10000;

  // 构造函数，注入 Minio 配置
  constructor(@Inject('MINIO_CONFIG') private config: MinioConfig) {
    // 初始化 Minio 客户端
    this._client = new MinioClient({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });

    // 创建代理客户端，自动处理桶名参数
    this.proxiedClient = new Proxy(this._client, {
      get: (target, prop: keyof MinioClient) => {
        const value = target[prop];
        if (typeof value === 'function') {
          // 特殊处理 getObject 方法
          if (prop === 'getObject') {
            return async (...args: any[]) => {
              try {
                // 尝试使用配置的桶名调用方法
                return await value.call(target, this.config.bucket, ...args);
              } catch (error: any) {
                // 如果对象不存在，返回空流而不是抛出错误
                if (error?.code === 'NoSuchKey' || error?.code === 'NotFound') {
                  this.logger.warn(
                    `Object not found: ${args[0] ?? 'unknown key'}, returning empty data`,
                  );
                  return Readable.from(Buffer.from(''));
                }

                // 对于其他错误，尝试不使用桶名直接调用或重新抛出错误
                try {
                  return await value.call(target, ...args);
                } catch (innerError: any) {
                  if (innerError?.code === 'NoSuchKey' || innerError?.code === 'NotFound') {
                    this.logger.warn(
                      `Object not found (direct call): ${args[0] ?? 'unknown key'}, returning empty data`,
                    );
                    return Readable.from(Buffer.from(''));
                  }
                  throw innerError;
                }
              }
            };
          }

          // 默认处理其他方法
          return (...args: any[]) => {
            try {
              // 尝试使用配置的桶名调用方法
              return value.call(target, this.config.bucket, ...args);
            } catch (_error) {
              // 如果失败，尝试不使用桶名直接调用
              return value.call(target, ...args);
            }
          };
        }
        return value;
      },
    }) as unknown as ProxiedMinioClient;
  }

  // 模块初始化时执行的方法
  async onModuleInit() {
    // 创建初始化桶的承诺
    const initPromise = this.initializeBuckets();
    // 创建超时承诺
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(`Minio initialization timed out after ${this.INIT_TIMEOUT}ms`);
      }, this.INIT_TIMEOUT);
    });

    try {
      // 使用 Promise.race 竞争执行初始化和超时
      await Promise.race([initPromise, timeoutPromise]);
    } catch (error) {
      // 记录初始化失败的错误并重新抛出
      this.logger.error(`Failed to initialize Minio bucket ${this.config.bucket}: ${error}`);
      throw error;
    }
  }

  // 初始化存储桶的方法
  async initializeBuckets() {
    try {
      // 检查存储桶是否存在
      const exists = await this._client.bucketExists(this.config.bucket);
      if (!exists) {
        // 如果不存在，尝试创建存储桶
        this.logger.log(`Bucket ${this.config.bucket} does not exist, try to create it`);
        await this._client.makeBucket(this.config.bucket);
      }
      // 记录初始化成功日志
      this.logger.log(`Bucket ${this.config.bucket} initialized`);
    } catch (error: any) {
      // 如果存储桶已存在，记录日志并继续
      if (error?.code === 'BucketAlreadyExists' || error?.code === 'BucketAlreadyOwnedByYou') {
        this.logger.log(`Bucket ${this.config.bucket} already exists`);
        return;
      }
      // 记录创建失败的错误并重新抛出
      this.logger.error(`Failed to create bucket ${this.config.bucket}: ${error?.message}`);
      throw error;
    }
  }

  // 获取代理客户端的方法
  get client(): ProxiedMinioClient {
    return this.proxiedClient;
  }

  // 复制文件的方法
  async duplicateFile(sourceStorageKey: string, targetStorageKey: string) {
    // 获取源文件的数据流
    const sourceStream = await this.client.getObject(sourceStorageKey);

    // 检查是否获取到了空流（表示源文件不存在）
    if (sourceStream instanceof Readable) {
      // 将流转换为缓冲区以检查是否为空
      const chunks: Buffer[] = [];
      for await (const chunk of sourceStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      // 合并所有缓冲区
      const buffer = Buffer.concat(chunks);
      // 如果缓冲区为空，表示源文件不存在
      if (buffer.length === 0) {
        this.logger.warn(
          `Source object ${sourceStorageKey} is empty or doesn't exist, skipping duplication`,
        );
        return null;
      }

      // 如果有内容，创建新的流并上传
      return await this.client.putObject(targetStorageKey, Readable.from(buffer));
    }

    // 正常情况 - 直接上传流
    return await this.client.putObject(targetStorageKey, sourceStream);
  }
}
