// 导入 NestJS 的依赖注入、服务和日志相关装饰器
import { Inject, Injectable, Logger } from '@nestjs/common';
// 导入 BullMQ 队列类型
import { Queue } from 'bullmq';
// 导入 BullMQ 队列注入装饰器
import { InjectQueue } from '@nestjs/bullmq';
// 导入 Node.js 加密模块的 UUID 生成函数
import { randomUUID } from 'node:crypto';
// 导入 Yjs 协同编辑库
import * as Y from 'yjs';
// 导入 Express 请求类型
import { Request } from 'express';
// 导入 WebSocket 类型
import { WebSocket } from 'ws';
// 导入 Hocuspocus 服务器，用于实时协作
import { Server, Hocuspocus } from '@hocuspocus/server';
// 导入 MinIO 内部服务标识符
import { MINIO_INTERNAL } from '@/common/minio.service';
// 导入 MinIO 服务
import { MinioService } from '@/common/minio.service';
// 导入检索增强生成服务
import { RAGService } from '@/rag/rag.service';
// 导入 Prisma 客户端生成的类型
import { CodeArtifact, Prisma } from '@prisma/client';
// 导入 OpenAPI 架构中定义的类型
import { UpsertCodeArtifactRequest, User } from '@refly-packages/openapi-schema';
// 导入订阅服务
import { SubscriptionService } from '@/subscription/subscription.service';
// 导入杂项服务
import { MiscService } from '@/misc/misc.service';
// 导入配置服务
import { ConfigService } from '@nestjs/config';
// 导入 Redis 服务
import { RedisService } from '@/common/redis.service';
// 导入 Elasticsearch 服务
import { ElasticsearchService } from '@/common/elasticsearch.service';
// 导入 Prisma 服务
import { PrismaService } from '@/common/prisma.service';
// 导入工具函数
import {
  // 生成代码工件 ID 的函数
  genCodeArtifactID,
  // ID 前缀常量
  IDPrefix,
  // 增量更新 Markdown 的函数
  incrementalMarkdownUpdate,
  // 将 Yjs 状态转换为 Markdown 的函数
  state2Markdown,
} from '@refly-packages/utils';
// 导入流转换为缓冲区的工具函数
import { streamToBuffer } from '@/utils/stream';
// 导入协作上下文类型和类型判断函数
import { CollabContext, isCanvasContext, isDocumentContext } from './collab.dto';
// 导入 Hocuspocus Redis 扩展
import { Redis } from '@hocuspocus/extension-redis';
// 导入同步画布实体队列常量
import { QUEUE_SYNC_CANVAS_ENTITY } from '@/utils/const';
// 导入毫秒转换库
import ms from 'ms';
// 导入并发限制库
import pLimit from 'p-limit';

// 标记为可注入的服务
@Injectable()
// 导出协作服务类
export class CollabService {
  // 创建私有日志记录器实例
  private logger = new Logger(CollabService.name);
  // 声明私有 Hocuspocus 服务器实例
  private server: Hocuspocus;

  // 构造函数，注入所需的服务
  constructor(
    // 注入 RAG 服务
    private rag: RAGService,
    // 注入 Prisma 服务
    private prisma: PrismaService,
    // 注入 Redis 服务
    private redis: RedisService,
    // 注入 Elasticsearch 服务
    private elasticsearch: ElasticsearchService,
    // 注入配置服务
    private config: ConfigService,
    // 注入杂项服务
    private miscService: MiscService,
    // 注入订阅服务
    private subscriptionService: SubscriptionService,
    // 注入 MinIO 服务（使用特定标识符）
    @Inject(MINIO_INTERNAL) private minio: MinioService,
    // 注入画布队列
    @InjectQueue(QUEUE_SYNC_CANVAS_ENTITY) private canvasQueue: Queue,
  ) {
    // 配置 Hocuspocus 服务器
    this.server = Server.configure({
      // 设置 WebSocket 服务器端口
      port: this.config.get<number>('wsPort'),
      // 设置认证回调
      onAuthenticate: (payload) => this.authenticate(payload),
      // 设置加载文档回调
      onLoadDocument: (payload) => this.loadDocument(payload),
      // 设置存储文档回调
      onStoreDocument: (payload) => this.storeDocument(payload),
      // 设置卸载文档后回调
      afterUnloadDocument: async (payload) => {
        // 记录文档卸载日志
        this.logger.log(`afterUnloadDocument ${payload.documentName}`);
      },
      // 设置断开连接回调
      onDisconnect: async (payload) => {
        // 记录断开连接日志
        this.logger.log(`onDisconnect ${payload.documentName}`);
      },
      // 设置扩展
      extensions: [new Redis({ redis: this.redis })],
    });
  }

  // 处理 WebSocket 连接的方法
  handleConnection(connection: WebSocket, request: Request) {
    // 将连接和请求传递给 Hocuspocus 服务器处理
    this.server.handleConnection(connection, request);
  }

  // 为用户签发协作令牌
  async signCollabToken(user: User) {
    // 生成随机 UUID 作为令牌
    const token = randomUUID();
    // 获取令牌过期时间配置并转换为毫秒
    const tokenExpiry = ms(String(this.config.get('auth.collab.tokenExpiry')));
    // 计算过期时间戳
    const expiresAt = Date.now() + tokenExpiry;
    // 将令牌存储到 Redis，设置过期时间，值为用户 ID
    await this.redis.setex(`collab:token:${token}`, tokenExpiry / 1000, user.uid);

    // 返回令牌和过期时间
    return { token, expiresAt };
  }

  // 验证协作令牌的私有方法
  private async validateCollabToken(token: string): Promise<string | null> {
    // 从 Redis 获取令牌对应的用户 ID
    return this.redis.get(`collab:token:${token}`);
  }

  // 认证用户并获取协作上下文
  async authenticate({ token, documentName }: { token: string; documentName: string }) {
    // 首先从 Redis 验证令牌
    const uid = await this.validateCollabToken(token);
    // 如果令牌无效或已过期，抛出错误
    if (!uid) {
      throw new Error('Invalid or expired collab token');
    }

    // 查找用户
    const user = await this.prisma.user.findFirst({
      where: { uid },
    });
    // 如果用户不存在，抛出错误
    if (!user) {
      throw new Error('user not found');
    }

    // 声明协作上下文变量
    let context: CollabContext;
    // 如果文档名以文档前缀开头
    if (documentName.startsWith(IDPrefix.DOCUMENT)) {
      // 查找文档
      let doc = await this.prisma.document.findFirst({
        where: { docId: documentName, deletedAt: null },
      });
      // 如果文档不存在，创建新文档
      if (!doc) {
        doc = await this.prisma.document.create({
          data: {
            docId: documentName,
            uid: user.uid,
            title: '',
          },
        });
        // 记录文档创建日志
        this.logger.log(`document created: ${documentName}`);

        // 同步用户存储使用情况
        await this.subscriptionService.syncStorageUsage({
          uid: user.uid,
          timestamp: new Date(),
        });
      }
      // 设置文档上下文
      context = { user, entity: doc, entityType: 'document' };
    }
    // 如果文档名以画布前缀开头
    else if (documentName.startsWith(IDPrefix.CANVAS)) {
      // 查找画布
      let canvas = await this.prisma.canvas.findFirst({
        where: { canvasId: documentName, deletedAt: null },
      });
      // 如果画布不存在，创建新画布
      if (!canvas) {
        canvas = await this.prisma.canvas.create({
          data: {
            canvasId: documentName,
            uid: user.uid,
            title: '',
          },
        });
        // 记录画布创建日志
        this.logger.log(`canvas created: ${documentName}`);
      }
      // 设置画布上下文
      context = { user, entity: canvas, entityType: 'canvas' };
    }
    // 如果文档名不符合已知前缀，抛出错误
    else {
      throw new Error(`unknown document name: ${documentName}`);
    }

    // 检查用户是否有权限访问该实体
    if (context.entity.uid !== user.uid) {
      throw new Error(`user not authorized: ${documentName}`);
    }

    // 记录文档连接日志
    this.logger.log(`document connected: ${documentName}`);

    // 返回上下文数据，用于其他钩子
    return context;
  }

  // 加载文档内容
  async loadDocument({
    document,
    documentName,
    context,
  }: {
    document: Y.Doc;
    documentName: string;
    context: CollabContext;
  }) {
    // 从上下文中获取实体
    const { entity } = context;
    // 获取状态存储键
    const { stateStorageKey } = entity;

    // 如果状态存储键不存在，记录警告并返回 null
    if (!stateStorageKey) {
      this.logger.warn(`stateStorageKey not found for ${documentName}`);
      return null;
    }

    try {
      // 从 MinIO 获取对象
      const readable = await this.minio.client.getObject(stateStorageKey);
      // 将流转换为缓冲区
      const state = await streamToBuffer(readable);
      // 将状态应用到 Yjs 文档
      Y.applyUpdate(document, state);

      // 获取标题
      const title = document.getText('title')?.toJSON();
      // 如果标题不存在，插入实体标题
      if (!title) {
        document.getText('title').insert(0, entity.title);
      }
    } catch (err) {
      // 记录获取状态失败的错误
      this.logger.error(`fetch state failed for ${stateStorageKey}, err: ${err.stack}`);
      return null;
    }
  }

  // 存储文档实体的私有方法
  private async storeDocumentEntity({
    state,
    document,
    context,
  }: {
    state: Buffer;
    document: Y.Doc;
    context: Extract<CollabContext, { entityType: 'document' }>;
  }) {
    // 从上下文中获取用户和文档
    const { user, entity: doc } = context;

    // 如果文档不存在，记录警告并返回
    if (!doc) {
      this.logger.warn(`document is empty for context: ${JSON.stringify(context)}`);
      return;
    }

    // 获取标题
    const title = document.getText('title').toJSON();

    // 将状态转换为 Markdown 内容
    const content = state2Markdown(state);
    // 确定存储键，如果不存在则创建新的
    const storageKey = doc.storageKey || `doc/${doc.docId}.txt`;
    // 确定状态存储键，如果不存在则创建新的
    const stateStorageKey = doc.stateStorageKey || `state/${doc.docId}`;

    // 将内容和状态保存到对象存储
    await Promise.all([
      this.minio.client.putObject(storageKey, content),
      this.minio.client.putObject(stateStorageKey, state),
    ]);

    // 准备文档更新数据
    const docUpdates: Prisma.DocumentUpdateInput = {};
    // 如果存储键不存在，添加到更新数据
    if (!doc.storageKey) {
      docUpdates.storageKey = storageKey;
    }
    // 如果状态存储键不存在，添加到更新数据
    if (!doc.stateStorageKey) {
      docUpdates.stateStorageKey = stateStorageKey;
    }
    // 如果内容预览发生变化，更新内容预览
    if (doc.contentPreview !== content.slice(0, 500)) {
      docUpdates.contentPreview = content.slice(0, 500);
    }
    // 如果标题发生变化，更新标题
    if (doc.title !== title) {
      docUpdates.title = title;
    }

    // 重新计算存储大小
    const [storageStat, stateStorageStat] = await Promise.all([
      this.minio.client.statObject(storageKey),
      this.minio.client.statObject(stateStorageKey),
    ]);
    // 更新存储大小
    docUpdates.storageSize = storageStat.size + stateStorageStat.size;

    // 重新索引内容到 Elasticsearch 和向量存储
    const [, { size }] = await Promise.all([
      this.elasticsearch.upsertDocument({
        id: doc.docId,
        content,
        title,
        uid: doc.uid,
        updatedAt: new Date().toJSON(),
      }),
      this.rag.indexDocument(user, {
        pageContent: content,
        metadata: {
          nodeType: 'document',
          title: doc.title,
          docId: doc.docId,
        },
      }),
    ]);
    // 更新向量大小
    docUpdates.vectorSize = size;

    // 更新文档
    const updatedDoc = await this.prisma.document.update({
      where: { docId: doc.docId },
      data: docUpdates,
    });
    // 更新上下文中的实体
    context.entity = updatedDoc;
  }

  // 存储画布实体的私有方法
  private async storeCanvasEntity({
    document,
    context,
  }: {
    state: Buffer;
    document: Y.Doc;
    context: Extract<CollabContext, { entityType: 'canvas' }>;
  }) {
    // 从上下文中获取用户和画布
    const { user, entity: canvas } = context;

    // 如果画布不存在，记录警告并返回
    if (!canvas) {
      this.logger.warn(`canvas is empty for context: ${JSON.stringify(context)}`);
      return;
    }

    // 清理画布文档
    const cleanedDocument = await this.cleanCanvasDocument(user, canvas.canvasId, document);
    // 将清理后的文档编码为状态更新
    const cleanedState = Buffer.from(Y.encodeStateAsUpdate(cleanedDocument));
    // 获取标题
    const title = cleanedDocument.getText('title').toJSON();

    // 确定状态存储键，如果不存在则创建新的
    const stateStorageKey = canvas.stateStorageKey || `state/${canvas.canvasId}`;
    // 将状态保存到对象存储
    await this.minio.client.putObject(stateStorageKey, cleanedState);

    // 获取状态存储统计信息
    const stateStorageStat = await this.minio.client.statObject(stateStorageKey);

    // 准备画布更新数据
    const canvasUpdates: Prisma.CanvasUpdateInput = {
      // 更新存储大小
      storageSize: stateStorageStat.size,
    };
    // 如果状态存储键不存在，添加到更新数据
    if (!canvas.stateStorageKey) {
      canvasUpdates.stateStorageKey = stateStorageKey;
    }
    // 如果标题发生变化，更新标题
    if (canvas.title !== title) {
      canvasUpdates.title = title;
    }
    // 记录画布更新日志
    this.logger.log(`canvas ${canvas.canvasId} updates: ${JSON.stringify(canvasUpdates)}`);

    // 更新画布
    const updatedCanvas = await this.prisma.canvas.update({
      where: { canvasId: canvas.canvasId, uid: user.uid },
      data: canvasUpdates,
    });
    // 更新上下文中的实体
    context.entity = updatedCanvas;

    // 更新 Elasticsearch 中的画布索引
    await this.elasticsearch.upsertCanvas({
      id: canvas.canvasId,
      title,
      uid: canvas.uid,
      updatedAt: new Date().toJSON(),
    });

    // 添加同步画布实体任务，带有去重功能
    await this.canvasQueue.add(
      'syncCanvasEntity',
      { canvasId: canvas.canvasId },
      {
        // 使用一致的任务 ID 进行去重
        jobId: canvas.canvasId,
        // 完成后移除任务
        removeOnComplete: true,
        // 失败后移除任务
        removeOnFail: true,
      },
    );
  }

  // 存储文档
  async storeDocument({ document, context }: { document: Y.Doc; context: CollabContext }) {
    // 将文档编码为状态更新
    const state = Buffer.from(Y.encodeStateAsUpdate(document));

    // 如果是文档上下文，调用存储文档实体方法
    if (isDocumentContext(context)) {
      return this.storeDocumentEntity({ state, document, context });
    }
    // 如果是画布上下文，调用存储画布实体方法
    if (isCanvasContext(context)) {
      return this.storeCanvasEntity({ state, document, context });
    }
    // 如果上下文类型未知，记录警告并返回 null
    this.logger.warn(`unknown context entity type: ${JSON.stringify(context)}`);
    return null;
  }

  /**
   * 清理画布文档，移除旧版代码工件节点并处理它们
   * @param user - 执行清理的用户
   * @param canvasId - 画布 ID
   * @param document - 要清理的画布文档
   * @returns 清理后的文档
   */
  async cleanCanvasDocument(user: User, canvasId: string, document: Y.Doc) {
    // 获取节点数组
    const nodes = document.getArray('nodes').toJSON() ?? [];
    // 过滤出旧版代码工件节点
    const legacyArtifactNodes = nodes.filter(
      (node) =>
        node.type === 'codeArtifact' &&
        node.data?.entityId &&
        (node.data?.contentPreview || node.data?.metadata?.code),
    );

    // 如果没有旧版节点，直接返回文档
    if (!legacyArtifactNodes.length) {
      return document;
    }

    // 获取锁以防止并发处理
    const releaseLock = await this.redis.acquireLock(`code-artifact-process:${canvasId}`);

    // 如果获取锁失败，记录警告并返回文档
    if (!releaseLock) {
      this.logger.warn(`failed to acquire lock to clean canvas: ${canvasId}`);
      return document;
    }

    try {
      // 创建并发限制器，最多同时处理 5 个任务
      const limit = pLimit(5);
      // 并行处理所有旧版代码工件节点
      const processedArtifacts = await Promise.all(
        legacyArtifactNodes.map((node) =>
          limit(() =>
            this.processLegacyCodeArtifact(user, node.data?.entityId, {
              title: node.data?.metadata?.title,
              type: node.data?.metadata?.type,
              language: node.data?.metadata?.language,
              content: node.data?.contentPreview || node.data?.metadata?.code,
            }),
          ),
        ),
      );
      // 创建处理后的工件映射
      const processedArtifactMap = new Map<string, CodeArtifact>();
      // 将处理后的工件添加到映射中
      for (const artifact of processedArtifacts) {
        const { originArtifactId, newArtifact } = artifact;
        if (newArtifact) {
          processedArtifactMap.set(originArtifactId, newArtifact);
        }
      }

      // 清理节点
      const cleanNodes = nodes.map((node: any) => {
        // 如果是代码工件节点且已处理
        if (node.type === 'codeArtifact' && processedArtifactMap.has(node.data?.entityId)) {
          // 获取新工件
          const newArtifact = processedArtifactMap.get(node.data?.entityId);
          // 获取状态
          const status = node.data?.metadata?.status;
          // 返回更新后的节点
          return {
            ...node,
            data: {
              ...node.data,
              // 更新实体 ID
              entityId: newArtifact.artifactId,
              // 移除内容预览
              contentPreview: undefined,
              metadata: {
                ...node.data.metadata,
                // 移除代码
                code: undefined,
                // 转换状态，将 'finished' 转换为 'finish'
                status: status === 'finished' ? 'finish' : status,
              },
            },
          };
        }
        // 如果不需要处理，返回原节点
        return node;
      });

      // 在事务中更新文档节点
      document.transact(() => {
        // 删除所有节点
        document.getArray('nodes').delete(0, document.getArray('nodes').length);
        // 插入清理后的节点
        document.getArray('nodes').insert(0, cleanNodes);
      });

      // 返回清理后的文档
      return document;
    } finally {
      // 释放锁
      await releaseLock();
    }
  }

  // 处理旧版代码工件
  async processLegacyCodeArtifact(
    user: User,
    artifactId: string,
    param: UpsertCodeArtifactRequest,
  ) {
    try {
      // 生成新的代码工件 ID
      const newArtifactId = genCodeArtifactID();
      // 确定存储键
      const storageKey = `code-artifact/${newArtifactId}`;
      // 创建或更新代码工件
      const newArtifact = await this.prisma.codeArtifact.upsert({
        where: { artifactId },
        create: {
          artifactId: newArtifactId,
          uid: user.uid,
          storageKey,
          type: param.type,
          language: param.language,
          title: param.title,
        },
        update: {},
      });
      // 如果有内容，保存到对象存储
      if (param.content) {
        await this.minio.client.putObject(storageKey, param.content);
      }
      // 返回原始工件 ID 和新工件
      return { originArtifactId: artifactId, newArtifact };
    } catch (err) {
      // 记录处理失败的错误
      this.logger.error(`failed to process legacy code artifact: ${artifactId}, err: ${err.stack}`);
      // 返回原始工件 ID 和 null
      return { originArtifactId: artifactId, newArtifact: null };
    }
  }

  // 打开直接连接
  async openDirectConnection(documentName: string, context?: CollabContext) {
    // 调用服务器打开直接连接
    return this.server.openDirectConnection(documentName, context);
  }

  // 修改文档
  async modifyDocument(documentName: string, update: string) {
    // 打开直接连接并获取文档
    const { document } = await this.server.openDirectConnection(documentName);
    // 增量更新 Markdown
    incrementalMarkdownUpdate(document, update);
  }
}
