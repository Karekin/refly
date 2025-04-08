import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import pLimit from 'p-limit';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { MINIO_INTERNAL } from '@/common/minio.service';
import { MinioService } from '@/common/minio.service';
import { PrismaService } from '@/common/prisma.service';
import { MiscService } from '@/misc/misc.service';
import { CollabService } from '@/collab/collab.service';
import { CodeArtifactService } from '@/code-artifact/code-artifact.service';
import { ElasticsearchService } from '@/common/elasticsearch.service';
import { CanvasNotFoundError, ParamsError, StorageQuotaExceeded } from '@refly-packages/errors';
import {
  AutoNameCanvasRequest,
  DeleteCanvasRequest,
  DuplicateCanvasRequest,
  Entity,
  EntityType,
  ListCanvasesData,
  RawCanvasData,
  UpsertCanvasRequest,
  User,
  CanvasNode,
} from '@refly-packages/openapi-schema';
import { Prisma } from '@prisma/client';
import { genCanvasID } from '@refly-packages/utils';
import { DeleteKnowledgeEntityJobData } from '@/knowledge/knowledge.dto';
import { QUEUE_DELETE_KNOWLEDGE_ENTITY } from '@/utils/const';
import { AutoNameCanvasJobData } from './canvas.dto';
import { streamToBuffer } from '@/utils';
import { SubscriptionService } from '@/subscription/subscription.service';
import { KnowledgeService } from '@/knowledge/knowledge.service';
import { ActionService } from '@/action/action.service';
import { generateCanvasTitle, CanvasContentItem } from './canvas-title-generator';

// 定义Canvas服务类，处理与画布相关的所有操作
@Injectable()
export class CanvasService {
  // 创建日志记录器，用于记录服务的操作日志
  private logger = new Logger(CanvasService.name);

  // 构造函数，注入所需的服务和依赖
  constructor(
    private prisma: PrismaService, // Prisma数据库服务
    private elasticsearch: ElasticsearchService, // Elasticsearch搜索服务
    private collabService: CollabService, // 协作服务
    private miscService: MiscService, // 杂项服务
    private actionService: ActionService, // 动作服务
    private knowledgeService: KnowledgeService, // 知识服务
    private codeArtifactService: CodeArtifactService, // 代码工件服务
    private subscriptionService: SubscriptionService, // 订阅服务
    @Inject(MINIO_INTERNAL) private minio: MinioService, // Minio对象存储服务
    @InjectQueue(QUEUE_DELETE_KNOWLEDGE_ENTITY)
    private deleteKnowledgeQueue: Queue<DeleteKnowledgeEntityJobData>, // 删除知识实体的任务队列
  ) {}

  /**
   * 列出用户的画布
   * @param user 当前用户
   * @param param 分页参数
   * @returns 画布列表
   */
  async listCanvases(user: User, param: ListCanvasesData['query']) {
    const { page, pageSize } = param;

    // 查询数据库，获取用户的画布列表
    const canvases = await this.prisma.canvas.findMany({
      where: {
        uid: user.uid, // 用户ID
        deletedAt: null, // 仅获取未删除的画布
      },
      orderBy: { updatedAt: 'desc' }, // 按更新时间降序排列
      skip: (page - 1) * pageSize, // 分页起始位置
      take: pageSize, // 每页数量
    });

    // 为每个画布生成预览图URL（如果存在预览图存储键）
    return canvases.map((canvas) => ({
      ...canvas,
      minimapUrl: canvas.minimapStorageKey
        ? this.miscService.generateFileURL({ storageKey: canvas.minimapStorageKey })
        : undefined,
    }));
  }

  /**
   * 获取画布详情
   * @param user 当前用户
   * @param canvasId 画布ID
   * @returns 画布详情
   */
  async getCanvasDetail(user: User, canvasId: string) {
    // 查询数据库，获取指定ID的画布
    const canvas = await this.prisma.canvas.findFirst({
      where: { canvasId, uid: user.uid, deletedAt: null },
    });

    // 如果画布不存在，抛出异常
    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    // 为画布生成预览图URL（如果存在预览图存储键）
    return {
      ...canvas,
      minimapUrl: canvas.minimapStorageKey
        ? this.miscService.generateFileURL({ storageKey: canvas.minimapStorageKey })
        : undefined,
    };
  }

  /**
   * 获取画布的Yjs文档（用于实时协作）
   * @param stateStorageKey 画布状态存储键
   * @returns Yjs文档或null
   */
  async getCanvasYDoc(stateStorageKey: string) {
    if (!stateStorageKey) {
      return null;
    }

    try {
      // 从Minio获取画布状态对象
      const readable = await this.minio.client.getObject(stateStorageKey);
      if (!readable) {
        throw new Error('Canvas state not found');
      }

      // 将流转换为缓冲区
      const state = await streamToBuffer(readable);
      if (!state?.length) {
        throw new Error('Canvas state is empty');
      }

      // 创建Yjs文档并应用状态更新
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);

      return doc;
    } catch (error) {
      // 记录警告日志并返回null
      this.logger.warn(`Error getting canvas YDoc for key ${stateStorageKey}: ${error?.message}`);
      return null;
    }
  }

  /**
   * 保存画布的Yjs文档状态
   * @param stateStorageKey 画布状态存储键
   * @param doc Yjs文档
   */
  async saveCanvasYDoc(stateStorageKey: string, doc: Y.Doc) {
    // 将Yjs文档状态编码为更新，并存储到Minio
    await this.minio.client.putObject(stateStorageKey, Buffer.from(Y.encodeStateAsUpdate(doc)));
  }

  /**
   * 获取画布的原始数据
   * @param user 当前用户
   * @param canvasId 画布ID
   * @returns 画布原始数据
   */
  async getCanvasRawData(user: User, canvasId: string): Promise<RawCanvasData> {
    // 查询数据库，获取画布的基本信息
    const canvas = await this.prisma.canvas.findFirst({
      select: {
        title: true,
        uid: true,
        stateStorageKey: true,
        minimapStorageKey: true,
      },
      where: {
        canvasId,
        uid: user.uid,
        deletedAt: null,
      },
    });

    // 如果画布不存在，抛出异常
    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    // 获取用户信息
    const userPo = await this.prisma.user.findUnique({
      select: {
        name: true,
        nickname: true,
        avatar: true,
      },
      where: { uid: user.uid },
    });

    // 获取Yjs文档
    const doc = await this.getCanvasYDoc(canvas.stateStorageKey);

    // 构建并返回画布原始数据
    return {
      title: canvas.title,
      nodes: doc?.getArray('nodes').toJSON() ?? [], // 节点数据
      edges: doc?.getArray('edges').toJSON() ?? [], // 边数据
      owner: {
        uid: canvas.uid,
        name: userPo?.name,
        nickname: userPo?.nickname,
        avatar: userPo?.avatar,
      },
      minimapUrl: canvas.minimapStorageKey
        ? this.miscService.generateFileURL({ storageKey: canvas.minimapStorageKey })
        : undefined,
    };
  }

  /**
   * 复制画布
   * @param user 当前用户
   * @param param 复制参数
   * @param options 选项（如检查所有权）
   * @returns 新画布
   */
  async duplicateCanvas(
    user: User,
    param: DuplicateCanvasRequest,
    options?: { checkOwnership?: boolean },
  ) {
    const { title, canvasId, duplicateEntities } = param;

    // 查询原始画布
    const canvas = await this.prisma.canvas.findFirst({
      where: {
        canvasId,
        deletedAt: null,
        uid: options?.checkOwnership ? user.uid : undefined,
      },
    });

    // 如果画布不存在，抛出异常
    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    // 创建新的Yjs文档并应用原始画布状态
    const doc = new Y.Doc();
    if (canvas.stateStorageKey) {
      const readable = await this.minio.client.getObject(canvas.stateStorageKey);
      const state = await streamToBuffer(readable);
      Y.applyUpdate(doc, state);
    }

    // 提取节点数据并筛选出需要复制的实体节点
    const nodes: CanvasNode[] = doc.getArray('nodes').toJSON();
    const libEntityNodes = nodes.filter((node) =>
      ['document', 'resource', 'codeArtifact'].includes(node.type),
    );

    // 如果需要复制实体，检查存储配额
    if (duplicateEntities) {
      const { available } = await this.subscriptionService.checkStorageUsage(user);
      if (available < libEntityNodes.length) {
        throw new StorageQuotaExceeded();
      }
    }

    // 生成新画布ID和标题
    const newCanvasId = genCanvasID();
    const newTitle = title || canvas.title;
    this.logger.log(`Duplicating canvas ${canvasId} to ${newCanvasId} with ${newTitle}`);

    // 设置新画布的状态存储键
    const stateStorageKey = `state/${newCanvasId}`;

    // 创建新画布记录
    const newCanvas = await this.prisma.canvas.create({
      data: {
        uid: user.uid,
        canvasId: newCanvasId,
        title: newTitle,
        status: 'duplicating',
        stateStorageKey,
      },
    });

    // 用于跟踪实体替换关系（原始实体ID到新实体ID的映射）
    const replaceEntityMap: Record<string, string> = {};

    // 如果需要复制实体，限制并发操作数量
    if (duplicateEntities) {
      const limit = pLimit(5);

      // 复制每个实体节点
      await Promise.all(
        libEntityNodes.map((node) =>
          limit(async () => {
            const entityType = node.type;
            const { entityId } = node.data;

            // 根据实体类型进行复制
            switch (entityType) {
              case 'document': {
                const doc = await this.knowledgeService.duplicateDocument(user, {
                  docId: entityId,
                  title: node.data?.title,
                });
                if (doc) {
                  node.data.entityId = doc.docId; // 更新节点中的实体ID
                  replaceEntityMap[entityId] = doc.docId; // 记录替换关系
                }
                break;
              }
              case 'resource': {
                const resource = await this.knowledgeService.duplicateResource(user, {
                  resourceId: entityId,
                  title: node.data?.title,
                });
                if (resource) {
                  node.data.entityId = resource.resourceId;
                  replaceEntityMap[entityId] = resource.resourceId;
                }
                break;
              }
              case 'codeArtifact': {
                const codeArtifact = await this.codeArtifactService.duplicateCodeArtifact(
                  user,
                  entityId,
                );
                if (codeArtifact) {
                  node.data.entityId = codeArtifact.artifactId;
                  replaceEntityMap[entityId] = codeArtifact.artifactId;
                }
                break;
              }
            }
          }),
        ),
      );
    }

    // 复制动作结果
    const actionResultIds = nodes
      .filter((node) => node.type === 'skillResponse')
      .map((node) => node.data.entityId);
    await this.actionService.duplicateActionResults(user, {
      sourceResultIds: actionResultIds,
      targetId: newCanvasId,
      targetType: 'canvas',
      replaceEntityMap,
    });

    // 更新节点中的实体ID引用
    for (const node of nodes) {
      if (node.type !== 'skillResponse') {
        continue;
      }

      const { entityId, metadata } = node.data;
      if (entityId) {
        node.data.entityId = replaceEntityMap[entityId]; // 替换实体ID
      }
      if (Array.isArray(metadata.contextItems)) {
        metadata.contextItems = metadata.contextItems.map((item) => {
          if (item.entityId && replaceEntityMap[item.entityId]) {
            item.entityId = replaceEntityMap[item.entityId]; // 替换上下文中的实体ID
          }
          return item;
        });
      }
    }

    // 如果原始画布不属于当前用户，复制文件
    if (canvas.uid !== user.uid) {
      await this.miscService.duplicateFilesNoCopy(user, {
        sourceEntityId: canvasId,
        sourceEntityType: 'canvas',
        sourceUid: user.uid,
        targetEntityId: newCanvasId,
        targetEntityType: 'canvas',
      });
    }

    // 更新Yjs文档中的标题和节点数据
    doc.transact(() => {
      doc.getText('title').delete(0, doc.getText('title').length);
      doc.getText('title').insert(0, title);

      doc.getArray('nodes').delete(0, doc.getArray('nodes').length);
      doc.getArray('nodes').insert(0, nodes);
    });

    // 保存新的Yjs文档状态
    await this.minio.client.putObject(stateStorageKey, Buffer.from(Y.encodeStateAsUpdate(doc)));

    // 更新画布状态为已完成
    await this.prisma.canvas.update({
      where: { canvasId: newCanvasId },
      data: { status: 'ready' },
    });

    // 记录复制操作
    await this.prisma.duplicateRecord.create({
      data: {
        uid: user.uid,
        sourceId: canvasId,
        targetId: newCanvasId,
        entityType: 'canvas',
        status: 'finish',
      },
    });

    this.logger.log(`Successfully duplicated canvas ${canvasId} to ${newCanvasId}`);

    return newCanvas;
  }

  /**
   * 创建新画布
   * @param user 当前用户
   * @param param 创建参数
   * @returns 新画布
   */
  async createCanvas(user: User, param: UpsertCanvasRequest) {
    const canvasId = genCanvasID(); // 生成新画布ID
    const stateStorageKey = `state/${canvasId}`; // 设置状态存储键

    // 创建画布数据库记录
    const canvas = await this.prisma.canvas.create({
      data: {
        uid: user.uid,
        canvasId,
        title: param.title,
        stateStorageKey,
      },
    });

    // 创建Yjs文档并设置标题
    const ydoc = new Y.Doc();
    ydoc.getText('title').insert(0, param.title);

    // 保存Yjs文档状态
    await this.saveCanvasYDoc(stateStorageKey, ydoc);

    // 记录日志
    this.logger.log(`created canvas data: ${JSON.stringify(ydoc.toJSON())}`);

    // 同步到Elasticsearch
    await this.elasticsearch.upsertCanvas({
      id: canvas.canvasId,
      title: canvas.title,
      createdAt: canvas.createdAt.toJSON(),
      updatedAt: canvas.updatedAt.toJSON(),
      uid: canvas.uid,
    });

    return canvas;
  }

  /**
   * 更新画布
   * @param user 当前用户
   * @param param 更新参数
   * @returns 更新后的画布
   */
  async updateCanvas(user: User, param: UpsertCanvasRequest) {
    const { canvasId, title, minimapStorageKey } = param;

    // 查询画布记录
    const canvas = await this.prisma.canvas.findUnique({
      where: { canvasId, uid: user.uid, deletedAt: null },
    });
    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    // 准备更新数据
    const originalMinimap = canvas.minimapStorageKey;
    const updates: Prisma.CanvasUpdateInput = {};

    if (title !== undefined) {
      updates.title = title;
    }
    if (minimapStorageKey !== undefined) {
      // 绑定预览图文件到画布
      const minimapFile = await this.miscService.findFileAndBindEntity(minimapStorageKey, {
        entityId: canvasId,
        entityType: 'canvas',
      });
      if (!minimapFile) {
        throw new ParamsError('Minimap file not found');
      }
      updates.minimapStorageKey = minimapFile.storageKey;
    }

    // 执行更新操作
    const updatedCanvas = await this.prisma.$transaction(async (tx) => {
      const canvas = await tx.canvas.update({
        where: { canvasId, uid: user.uid, deletedAt: null },
        data: updates,
      });
      return canvas;
    });

    if (!updatedCanvas) {
      throw new CanvasNotFoundError();
    }

    // 如果更新了标题，同步到Yjs文档
    if (title !== undefined) {
      const connection = await this.collabService.openDirectConnection(canvasId, {
        user,
        entity: updatedCanvas,
        entityType: 'canvas',
      });
      connection.document.transact(() => {
        const title = connection.document.getText('title');
        title.delete(0, title.length);
        title.insert(0, param.title);
      });
      await connection.disconnect();
    }

    // 如果更换了预览图，删除旧的预览图
    if (
      originalMinimap &&
      minimapStorageKey !== undefined &&
      minimapStorageKey !== originalMinimap
    ) {
      await this.minio.client.removeObject(originalMinimap);
    }

    // 同步到Elasticsearch
    await this.elasticsearch.upsertCanvas({
      id: updatedCanvas.canvasId,
      title: updatedCanvas.title,
      updatedAt: updatedCanvas.updatedAt.toJSON(),
      uid: updatedCanvas.uid,
    });

    return updatedCanvas;
  }

  /**
   * 删除画布
   * @param user 当前用户
   * @param param 删除参数
   */
  async deleteCanvas(user: User, param: DeleteCanvasRequest) {
    const { uid } = user;
    const { canvasId } = param;

    // 查询画布记录
    const canvas = await this.prisma.canvas.findFirst({
      where: { canvasId, uid, deletedAt: null },
    });
    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    // 准备清理操作
    const cleanups: Promise<any>[] = [
      // 软删除画布记录
      this.prisma.canvas.update({
        where: { canvasId },
        data: { deletedAt: new Date() },
      }),
      // 从Elasticsearch删除
      this.elasticsearch.deleteCanvas(canvas.canvasId),
    ];

    // 如果存在状态存储键，删除状态文件
    if (canvas.stateStorageKey) {
      cleanups.push(this.minio.client.removeObject(canvas.stateStorageKey));
    }

    // 如果需要删除所有相关文件，添加删除实体的任务
    if (param.deleteAllFiles) {
      const relations = await this.prisma.canvasEntityRelation.findMany({
        where: { canvasId, deletedAt: null },
      });
      const entities = relations.map((r) => ({
        entityId: r.entityId,
        entityType: r.entityType as EntityType,
      }));
      this.logger.log(`Entities to be deleted: ${JSON.stringify(entities)}`);

      for (const entity of entities) {
        cleanups.push(
          this.deleteKnowledgeQueue.add(
            'deleteKnowledgeEntity',
            {
              uid: canvas.uid,
              entityId: entity.entityId,
              entityType: entity.entityType,
            },
            {
              jobId: entity.entityId,
              removeOnComplete: true,
              removeOnFail: true,
              attempts: 3,
            },
          ),
        );
      }
    }

    // 执行所有清理操作
    await Promise.all(cleanups);
  }

  /**
   * 同步画布与实体的关系
   * @param canvasId 画布ID
   */
  async syncCanvasEntityRelation(canvasId: string) {
    // 查询画布记录
    const canvas = await this.prisma.canvas.findUnique({
      where: { canvasId },
    });
    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    // 加载Yjs文档
    const ydoc = new Y.Doc();
    await this.collabService.loadDocument({
      document: ydoc,
      documentName: canvas.canvasId,
      context: {
        user: { uid: canvas.uid },
        entity: canvas,
        entityType: 'canvas',
      },
    });
    const nodes = ydoc.getArray('nodes').toJSON();

    // 提取实体信息
    const entities: Entity[] = nodes
      .map((node) => ({
        entityId: node.data?.entityId,
        entityType: node.type,
      }))
      .filter((entity) => entity.entityId && entity.entityType);

    // 查询现有的关系记录
    const existingRelations = await this.prisma.canvasEntityRelation.findMany({
      where: { canvasId, deletedAt: null },
    });

    // 找出需要删除的关系（软删除）
    const entityIds = new Set(entities.map((e) => e.entityId));
    const relationsToRemove = existingRelations.filter(
      (relation) => !entityIds.has(relation.entityId),
    );

    // 找出需要创建的新关系
    const existingEntityIds = new Set(existingRelations.map((r) => r.entityId));
    const relationsToCreate = entities.filter((entity) => !existingEntityIds.has(entity.entityId));

    // 执行批量更新和创建操作
    await Promise.all([
      // 软删除不需要的关系
      this.prisma.canvasEntityRelation.updateMany({
        where: {
          canvasId,
          entityId: { in: relationsToRemove.map((r) => r.entityId) },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      }),
      // 创建新的关系
      this.prisma.canvasEntityRelation.createMany({
        data: relationsToCreate.map((entity) => ({
          canvasId,
          entityId: entity.entityId,
          entityType: entity.entityType,
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  /**
   * 从画布中删除实体节点
   * @param entities 实体列表
   */
  async deleteEntityNodesFromCanvases(entities: Entity[]) {
    this.logger.log(`Deleting entity nodes from canvases: ${JSON.stringify(entities)}`);

    // 查询与实体相关的画布
    const relations = await this.prisma.canvasEntityRelation.findMany({
      where: {
        entityId: { in: entities.map((e) => e.entityId) },
        entityType: { in: entities.map((e) => e.entityType) },
        deletedAt: null,
      },
      distinct: ['canvasId'],
    });

    const canvasIds = relations.map((r) => r.canvasId);
    if (canvasIds.length === 0) {
      this.logger.log(`No related canvases found for entities: ${JSON.stringify(entities)}`);
      return;
    }
    this.logger.log(`Found related canvases: ${JSON.stringify(canvasIds)}`);

    // 限制并发操作数量，避免资源耗尽
    const limit = pLimit(3);
    await Promise.all(
      canvasIds.map((canvasId) =>
        limit(async () => {
          // 查询画布记录
          const canvas = await this.prisma.canvas.findUnique({
            where: { canvasId },
          });
          if (!canvas) return;

          // 打开协作连接，获取Yjs文档
          const connection = await this.collabService.openDirectConnection(canvasId, {
            user: { uid: canvas.uid },
            entity: canvas,
            entityType: 'canvas',
          });

          // 移除匹配的节点
          connection.document.transact(() => {
            const nodes = connection.document.getArray('nodes');
            const toRemove: number[] = [];

            nodes.forEach((node: any, index: number) => {
              const entityId = node?.data?.entityId;
              const entityType = node?.type;

              if (entityId && entityType) {
                const matchingEntity = entities.find(
                  (e) => e.entityId === entityId && e.entityType === entityType,
                );
                if (matchingEntity) {
                  toRemove.push(index); // 记录需要移除的节点索引
                }
              }
            });

            // 按逆序移除节点，避免索引错误
            toRemove.reverse();
            for (const index of toRemove) {
              nodes.delete(index, 1);
            }
          });

          await connection.disconnect();

          // 更新关系记录，软删除相关实体
          await this.prisma.canvasEntityRelation.updateMany({
            where: {
              canvasId,
              entityId: { in: entities.map((e) => e.entityId) },
              entityType: { in: entities.map((e) => e.entityType) },
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          });
        }),
      ),
    );
  }

  /**
   * 自动生成画布标题
   * @param user 当前用户
   * @param param 自动生成参数
   * @returns 生成的标题
   */
  async autoNameCanvas(user: User, param: AutoNameCanvasRequest) {
    const { canvasId, directUpdate = false } = param;

    // 查询画布记录
    const canvas = await this.prisma.canvas.findFirst({
      where: { canvasId, uid: user.uid, deletedAt: null },
    });
    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    // 获取动作结果数据
    const results = await this.prisma.actionResult.findMany({
      select: { title: true, input: true, version: true, resultId: true },
      where: { targetId: canvasId, targetType: 'canvas' },
    });

    // 收集内容项用于标题生成
    const contentItems: CanvasContentItem[] = await Promise.all(
      results.map(async (result) => {
        const { resultId, version, input, title } = result;
        const steps = await this.prisma.actionStep.findMany({
          where: { resultId, version },
        });
        const parsedInput = JSON.parse(input ?? '{}');
        const question = parsedInput?.query ?? title;
        const answer = steps.map((s) => s.content.slice(0, 500)).join('\n');

        return {
          question,
          answer,
        };
      }),
    );

    // 如果没有动作结果，尝试获取与画布关联的实体内容
    if (contentItems.length === 0) {
      const relations = await this.prisma.canvasEntityRelation.findMany({
        where: { canvasId, entityType: { in: ['resource', 'document'] }, deletedAt: null },
      });

      const documents = await this.prisma.document.findMany({
        select: { title: true, contentPreview: true },
        where: { docId: { in: relations.map((r) => r.entityId) } },
      });

      const resources = await this.prisma.resource.findMany({
        select: { title: true, contentPreview: true },
        where: { resourceId: { in: relations.map((r) => r.entityId) } },
      });

      contentItems.push(
        ...documents.map((d) => ({
          title: d.title,
          contentPreview: d.contentPreview,
        })),
        ...resources.map((r) => ({
          title: r.title,
          contentPreview: r.contentPreview,
        })),
      );
    }

    // 如果仍然没有内容，返回空标题
    if (contentItems.length === 0) {
      return { title: '' };
    }

    // 获取默认模型并生成标题
    const defaultModel = await this.subscriptionService.getDefaultModel();
    this.logger.log(`Using default model for auto naming: ${defaultModel?.name}`);

    const newTitle = await generateCanvasTitle(contentItems, defaultModel, this.logger);

    // 如果需要直接更新，执行更新操作
    if (directUpdate && newTitle) {
      await this.updateCanvas(user, {
        canvasId,
        title: newTitle,
      });
    }

    return { title: newTitle };
  }

  /**
   * 从队列中处理自动命名任务
   * @param jobData 任务数据
   */
  async autoNameCanvasFromQueue(jobData: AutoNameCanvasJobData) {
    const { uid, canvasId } = jobData;
    const user = await this.prisma.user.findFirst({ where: { uid } });
    if (!user) {
      this.logger.warn(`user not found for uid ${uid} when auto naming canvas: ${canvasId}`);
      return;
    }

    // 执行自动命名并记录日志
    const result = await this.autoNameCanvas(user, { canvasId, directUpdate: true });
    this.logger.log(`Auto named canvas ${canvasId} with title: ${result.title}`);
  }
}
