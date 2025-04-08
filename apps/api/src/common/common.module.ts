// 导入 NestJS 的模块装饰器
import { Module } from '@nestjs/common';
// 导入配置服务，用于获取应用配置
import { ConfigService } from '@nestjs/config';
// 导入 Prisma 服务，用于数据库操作
import { PrismaService } from './prisma.service';
// 导入 MinIO 相关的常量和服务，用于对象存储
import { MINIO_EXTERNAL, MINIO_INTERNAL, MinioService } from './minio.service';
// 导入 Redis 服务，用于缓存管理
import { RedisService } from './redis.service';
// 导入 Qdrant 服务，用于向量搜索
import { QdrantService } from './qdrant.service';
// 导入 Elasticsearch 服务，用于全文搜索
import { ElasticsearchService } from './elasticsearch.service';

// 使用 @Module 装饰器定义公共模块
@Module({
  // 定义模块的提供者（服务）
  providers: [
    // 注册 Prisma 服务
    PrismaService,
    // 注册 Redis 服务
    RedisService,
    // 注册 Qdrant 服务
    QdrantService,
    // 注册 Elasticsearch 服务
    ElasticsearchService,
    // 注册内部 MinIO 服务，使用工厂函数创建实例
    {
      // 提供者的标识符
      provide: MINIO_INTERNAL,
      // 工厂函数，接收配置服务作为参数
      useFactory: (configService: ConfigService) =>
        // 创建新的 MinIO 服务实例，使用内部配置
        new MinioService(configService.getOrThrow('minio.internal')),
      // 注入配置服务
      inject: [ConfigService],
    },
    // 注册外部 MinIO 服务，使用工厂函数创建实例
    {
      // 提供者的标识符
      provide: MINIO_EXTERNAL,
      // 工厂函数，接收配置服务作为参数
      useFactory: (configService: ConfigService) =>
        // 创建新的 MinIO 服务实例，使用外部配置
        new MinioService(configService.getOrThrow('minio.external')),
      // 注入配置服务
      inject: [ConfigService],
    },
  ],
  // 导出服务，使其可以被其他模块使用
  exports: [
    // 导出 Prisma 服务
    PrismaService,
    // 导出 Redis 服务
    RedisService,
    // 导出 Qdrant 服务
    QdrantService,
    // 导出 Elasticsearch 服务
    ElasticsearchService,
    // 导出内部 MinIO 服务
    MINIO_INTERNAL,
    // 导出外部 MinIO 服务
    MINIO_EXTERNAL,
  ],
})
// 导出公共模块类
export class CommonModule {}
