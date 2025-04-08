import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';
import { Document, DocumentInterface } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Embeddings } from '@langchain/core/embeddings';
import { OpenAIEmbeddings } from '@langchain/openai';
import { FireworksEmbeddings } from '@langchain/community/embeddings/fireworks';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { cleanMarkdownForIngest } from '@refly-packages/utils';
import * as avro from 'avsc';

import { SearchResult, User } from '@refly-packages/openapi-schema';
import { HybridSearchParam, ContentPayload, ReaderResult, NodeMeta } from './rag.dto';
import { QdrantService } from '@/common/qdrant.service';
import { Condition, PointStruct } from '@/common/qdrant.dto';
import { genResourceUuid } from '@/utils';
import { JinaEmbeddings } from '@/utils/embeddings/jina';

// Jina Reader服务的URL
const READER_URL =
  '<url id="cvq9uobof8jiogibblsg" type="url" status="parsed" title="" wc="173">https://r.jina.ai/</url> ';

// 定义Jina重排序器的响应格式
interface JinaRerankerResponse {
  results: {
    document: { text: string };
    relevance_score: number;
  }[];
}

// 定义Avro模式，用于向量点的序列化（必须与序列化时使用的模式匹配）
const avroSchema = avro.Type.forSchema({
  type: 'array',
  items: {
    type: 'record',
    name: 'Point',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'vector', type: { type: 'array', items: 'float' } },
      { name: 'payload', type: 'string' }, // JSON字符串格式的负载
      {
        name: 'metadata',
        type: {
          type: 'record',
          name: 'Metadata',
          fields: [
            { name: 'nodeType', type: 'string' },
            { name: 'entityId', type: 'string' },
            { name: 'originalUid', type: 'string' },
          ],
        },
      },
    ],
  },
});

// RAG服务类，负责文档处理、向量索引和搜索
@Injectable()
export class RAGService {
  // 嵌入式向量生成器
  private embeddings: Embeddings;

  // 文本分块器，用于将长文本分割为固定大小的块
  private splitter: RecursiveCharacterTextSplitter;

  // 缓存，用于存储URL到Reader结果的映射
  private cache: LRUCache<string, ReaderResult>;

  // 日志记录器
  private logger = new Logger(RAGService.name);

  // 构造函数，初始化服务
  constructor(
    private config: ConfigService, // 配置服务
    private qdrant: QdrantService, // Qdrant向量数据库服务
  ) {
    // 根据配置选择嵌入式向量提供者
    const provider = this.config.get('embeddings.provider');
    if (provider === 'fireworks') {
      this.embeddings = new FireworksEmbeddings({
        modelName: this.config.getOrThrow('embeddings.modelName'), // 模型名称
        batchSize: this.config.getOrThrow('embeddings.batchSize'), // 批处理大小
        maxRetries: 3, // 最大重试次数
      });
    } else if (provider === 'jina') {
      this.embeddings = new JinaEmbeddings({
        modelName: this.config.getOrThrow('embeddings.modelName'), // 模型名称
        batchSize: this.config.getOrThrow('embeddings.batchSize'), // 批处理大小
        dimensions: this.config.getOrThrow('embeddings.dimensions'), // 向量维度
        apiKey: this.config.getOrThrow('credentials.jina'), // Jina API密钥
        maxRetries: 3, // 最大重试次数
      });
    } else if (provider === 'openai') {
      this.embeddings = new OpenAIEmbeddings({
        modelName: this.config.getOrThrow('embeddings.modelName'), // 模型名称
        batchSize: this.config.getOrThrow('embeddings.batchSize'), // 批处理大小
        dimensions: this.config.getOrThrow('embeddings.dimensions'), // 向量维度
        timeout: 5000, // 超时时间
        maxRetries: 3, // 最大重试次数
      });
    } else {
      throw new Error(`Unsupported embeddings provider: ${provider}`); // 抛出不支持的提供者错误
    }

    // 初始化文本分块器，使用Markdown语言规则
    this.splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
      chunkSize: 1000, // 每块大小
      chunkOverlap: 0, // 块重叠大小
    });

    // 初始化缓存，最大缓存1000个条目
    this.cache = new LRUCache({ max: 1000 });
  }

  // 从远程Reader爬取文档内容
  async crawlFromRemoteReader(url: string): Promise<ReaderResult> {
    // 检查缓存中是否存在该URL的结果
    if (this.cache.get(url)) {
      this.logger.log(`in-mem crawl cache hit: ${url}`); // 记录缓存命中日志
      return this.cache.get(url) as ReaderResult; // 返回缓存结果
    }

    // 记录授权信息
    this.logger.log(
      `Authorization: ${
        this.config.get('credentials.jina')
          ? `Bearer ${this.config.get('credentials.jina')}`
          : undefined
      }`,
    );

    // 发送HTTP请求到Jina Reader服务
    const response = await fetch(READER_URL + url, {
      method: 'GET', // GET请求
      headers: {
        Authorization: this.config.get('credentials.jina')
          ? `Bearer ${this.config.get('credentials.jina')}`
          : undefined, // 授权头
        Accept: 'application/json', // 接受JSON格式响应
      },
    });

    // 检查响应状态
    if (response.status !== 200) {
      throw new Error(
        `call remote reader failed: ${response.status} ${response.statusText} ${response.text}`,
      ); // 抛出远程Reader调用失败错误
    }

    // 解析响应数据
    const data = await response.json();
    if (!data) {
      throw new Error(`invalid data from remote reader: ${response.text}`); // 抛出无效数据错误
    }

    // 记录爬取成功日志
    this.logger.log(`crawl from reader success: ${url}`);
    // 将结果存入缓存
    this.cache.set(url, data);

    return data; // 返回爬取结果
  }

  // 将文本分块
  async chunkText(text: string) {
    // 使用分块器将文本分割为多个块
    return await this.splitter.splitText(cleanMarkdownForIngest(text));
  }

  // 在内存中进行搜索并建立索引
  async inMemorySearchWithIndexing(
    user: User,
    options: {
      content: string | Document<any> | Array<Document<any>>;
      query?: string;
      k?: number;
      filter?: (doc: Document<NodeMeta>) => boolean;
      needChunk?: boolean;
      additionalMetadata?: Record<string, any>;
    },
  ): Promise<DocumentInterface[]> {
    const { content, query, k = 10, filter, needChunk = true, additionalMetadata = {} } = options;
    const { uid } = user;

    // 如果没有查询内容，返回空数组
    if (!query) {
      return [];
    }

    // 创建临时内存向量存储
    const tempMemoryVectorStore = new MemoryVectorStore(this.embeddings);

    // 准备文档
    let documents: Document<any>[];
    if (Array.isArray(content)) {
      // 如果内容是文档数组，更新元数据
      documents = content.map((doc) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          tenantId: uid,
          ...additionalMetadata,
        },
      }));
    } else {
      // 如果内容是字符串或单个文档，创建文档并更新元数据
      let doc: Document<any>;
      if (typeof content === 'string') {
        doc = {
          pageContent: content,
          metadata: {
            tenantId: uid,
            ...additionalMetadata,
          },
        };
      } else {
        doc = {
          ...content,
          metadata: {
            ...content.metadata,
            tenantId: uid,
            ...additionalMetadata,
          },
        };
      }

      // 如果需要分块，将文档内容分块
      const chunks = needChunk ? await this.chunkText(doc.pageContent) : [doc.pageContent];
      let startIndex = 0;
      documents = chunks.map((chunk) => {
        const document = {
          pageContent: chunk.trim(),
          metadata: {
            ...doc.metadata,
            tenantId: uid,
            ...additionalMetadata,
            start: startIndex,
            end: startIndex + chunk.trim().length,
          },
        };

        startIndex += chunk.trim().length;

        return document;
      });
    }

    // 将文档添加到临时向量存储
    await tempMemoryVectorStore.addDocuments(documents);

    // 执行搜索
    const wrapperFilter = (doc: Document<NodeMeta>) => {
      // 检查租户ID是否匹配
      const tenantIdMatch = doc.metadata.tenantId === uid;

      // 如果没有过滤器，只检查租户ID
      if (filter === undefined) {
        return tenantIdMatch;
      }

      // 如果有过滤器，同时检查过滤器和租户ID
      return filter(doc) && tenantIdMatch;
    };

    // 返回相似性搜索结果
    return tempMemoryVectorStore.similaritySearch(query, k, wrapperFilter);
  }

  // 索引文档
  async indexDocument(user: User, doc: Document<NodeMeta>): Promise<{ size: number }> {
    const { uid } = user;
    const { pageContent, metadata } = doc;
    const { nodeType, docId, resourceId } = metadata;
    const entityId = nodeType === 'document' ? docId : resourceId;

    // 获取新分块
    const newChunks = await this.chunkText(pageContent);

    // 获取现有点（使用滚动查询）
    const existingPoints = await this.qdrant.scroll({
      filter: {
        must: [
          { key: 'tenantId', match: { value: uid } },
          { key: nodeType === 'document' ? 'docId' : 'resourceId', match: { value: entityId } },
        ],
      },
      with_payload: true,
      with_vector: true,
    });

    // 创建现有分块的映射，便于快速查找
    const existingChunksMap = new Map(
      existingPoints.map((point) => [
        point.payload.content,
        {
          id: point.id,
          vector: point.vector as number[],
        },
      ]),
    );

    // 准备要插入或更新的点
    const pointsToUpsert: PointStruct[] = [];
    const chunksNeedingEmbeddings: string[] = [];
    const chunkIndices: number[] = [];

    // 确定哪些分块需要新的嵌入式向量
    for (let i = 0; i < newChunks.length; i++) {
      const chunk = newChunks[i];
      const existing = existingChunksMap.get(chunk);

      if (existing) {
        // 重用现有嵌入式向量
        pointsToUpsert.push({
          id: genResourceUuid(`${entityId}-${i}`),
          vector: existing.vector,
          payload: {
            ...metadata,
            seq: i,
            content: chunk,
            tenantId: uid,
          },
        });
      } else {
        // 标记为需要计算新嵌入式向量
        chunksNeedingEmbeddings.push(chunk);
        chunkIndices.push(i);
      }
    }

    // 为需要新嵌入式向量的分块计算嵌入式向量
    if (chunksNeedingEmbeddings.length > 0) {
      const newEmbeddings = await this.embeddings.embedDocuments(chunksNeedingEmbeddings);

      // 创建带有新嵌入式向量的点
      chunkIndices.forEach((originalIndex, embeddingIndex) => {
        pointsToUpsert.push({
          id: genResourceUuid(`${entityId}-${originalIndex}`),
          vector: newEmbeddings[embeddingIndex],
          payload: {
            ...metadata,
            seq: originalIndex,
            content: chunksNeedingEmbeddings[embeddingIndex],
            tenantId: uid,
          },
        });
      });
    }

    // 删除现有点
    if (existingPoints.length > 0) {
      await this.qdrant.batchDelete({
        must: [
          { key: 'tenantId', match: { value: uid } },
          { key: nodeType === 'document' ? 'docId' : 'resourceId', match: { value: entityId } },
        ],
      });
    }

    // 保存新点
    if (pointsToUpsert.length > 0) {
      await this.qdrant.batchSaveData(pointsToUpsert);
    }

    // 返回估计的点大小
    return { size: QdrantService.estimatePointsSize(pointsToUpsert) };
  }

  // 删除资源节点
  async deleteResourceNodes(user: User, resourceId: string) {
    return this.qdrant.batchDelete({
      must: [
        { key: 'tenantId', match: { value: user.uid } },
        { key: 'resourceId', match: { value: resourceId } },
      ],
    });
  }

  // 删除文档节点
  async deleteDocumentNodes(user: User, docId: string) {
    return this.qdrant.batchDelete({
      must: [
        { key: 'tenantId', match: { value: user.uid } },
        { key: 'docId', match: { value: docId } },
      ],
    });
  }

  // 复制文档
  async duplicateDocument(param: {
    sourceUid: string;
    targetUid: string;
    sourceDocId: string;
    targetDocId: string;
  }) {
    const { sourceUid, targetUid, sourceDocId, targetDocId } = param;

    try {
      // 记录复制文档的日志
      this.logger.log(
        `Duplicating document ${sourceDocId} from user ${sourceUid} to user ${targetUid}`,
      );

      // 获取源文档的所有点
      const points = await this.qdrant.scroll({
        filter: {
          must: [
            { key: 'tenantId', match: { value: sourceUid } },
            { key: 'docId', match: { value: sourceDocId } },
          ],
        },
        with_payload: true,
        with_vector: true,
      });

      // 如果没有点，记录警告并返回
      if (!points?.length) {
        this.logger.warn(`No points found for document ${sourceDocId}`);
        return { size: 0, pointsCount: 0 };
      }

      // 准备目标用户的点
      const pointsToUpsert: PointStruct[] = points.map((point) => ({
        ...point,
        id: genResourceUuid(`${sourceUid}-${targetDocId}-${point.payload.seq ?? 0}`),
        payload: {
          ...point.payload,
          tenantId: targetUid,
        },
      }));

      // 计算点的大小
      const size = QdrantService.estimatePointsSize(pointsToUpsert);

      // 执行批量保存操作
      await this.qdrant.batchSaveData(pointsToUpsert);

      // 记录成功日志
      this.logger.log(
        `Successfully duplicated ${pointsToUpsert.length} points for document ${sourceDocId} to user ${targetUid}`,
      );

      // 返回结果
      return {
        size,
        pointsCount: pointsToUpsert.length,
      };
    } catch (error) {
      // 记录错误日志
      this.logger.error(
        `Failed to duplicate document ${sourceDocId} from user ${sourceUid} to ${targetUid}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // 检索内容
  async retrieve(user: User, param: HybridSearchParam): Promise<ContentPayload[]> {
    // 如果没有提供向量，生成查询向量
    if (!param.vector) {
      param.vector = await this.embeddings.embedQuery(param.query);
    }

    // 构建查询条件
    const conditions: Condition[] = [
      {
        key: 'tenantId',
        match: { value: user.uid },
      },
    ];

    // 添加过滤条件
    if (param.filter?.nodeTypes?.length > 0) {
      conditions.push({
        key: 'nodeType',
        match: { any: param.filter?.nodeTypes },
      });
    }
    if (param.filter?.urls?.length > 0) {
      conditions.push({
        key: 'url',
        match: { any: param.filter?.urls },
      });
    }
    if (param.filter?.docIds?.length > 0) {
      conditions.push({
        key: 'docId',
        match: { any: param.filter?.docIds },
      });
    }
    if (param.filter?.resourceIds?.length > 0) {
      conditions.push({
        key: 'resourceId',
        match: { any: param.filter?.resourceIds },
      });
    }
    if (param.filter?.projectIds?.length > 0) {
      conditions.push({
        key: 'projectId',
        match: { any: param.filter?.projectIds },
      });
    }

    // 执行搜索
    const results = await this.qdrant.search(param, { must: conditions });
    return results.map((res) => res.payload as any);
  }

  // 使用Jina重排序器对搜索结果进行重排序
  async rerank(
    query: string,
    results: SearchResult[],
    options?: { topN?: number; relevanceThreshold?: number },
  ): Promise<SearchResult[]> {
    const topN = options?.topN || this.config.get('reranker.topN');
    const relevanceThreshold =
      options?.relevanceThreshold || this.config.get('reranker.relevanceThreshold');

    // 创建内容映射
    const contentMap = new Map<string, SearchResult>();
    for (const r of results) {
      contentMap.set(r.snippets.map((s) => s.text).join('\n\n'), r);
    }

    // 构建请求负载
    const payload = JSON.stringify({
      query,
      model: this.config.get('reranker.model'),
      top_n: topN,
      documents: Array.from(contentMap.keys()),
    });

    try {
      // 发送请求到Jina重排序器
      const res = await fetch('https://api.jina.ai/v1/rerank', {
        method: 'post',
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow('credentials.jina')}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
      const data: JinaRerankerResponse = await res.json();
      this.logger.debug(`Jina reranker results: ${JSON.stringify(data)}`);

      // 返回过滤和映射后的结果
      return data.results
        .filter((r) => r.relevance_score >= relevanceThreshold)
        .map((r) => {
          const originalResult = contentMap.get(r.document.text);
          return {
            ...originalResult,
            relevanceScore: r.relevance_score, // 添加相关性分数
          } as SearchResult;
        });
    } catch (e) {
      // 记录错误并回退到默认排序
      this.logger.error(`Reranker failed, fallback to default: ${e.stack}`);
      return results.map((result, index) => ({
        ...result,
        relevanceScore: 1 - index * 0.1, // 基于原始顺序的简单回退评分
      }));
    }
  }

  // 将向量点序列化为Avro二进制格式
  async serializeToAvro(
    user: User,
    param: {
      docId?: string;
      resourceId?: string;
      nodeType?: 'document' | 'resource';
    },
  ): Promise<{ data: Buffer; pointsCount: number; size: number }> {
    const { docId, resourceId, nodeType = docId ? 'document' : 'resource' } = param;
    const entityId = nodeType === 'document' ? docId : resourceId;

    if (!entityId) {
      throw new Error('Either docId or resourceId must be provided'); // 抛出缺少实体ID的错误
    }

    try {
      // 记录序列化开始日志
      this.logger.log(`Serializing ${nodeType} ${entityId} from user ${user.uid} to Avro binary`);

      // 获取文档的所有点
      const points = await this.qdrant.scroll({
        filter: {
          must: [
            { key: 'tenantId', match: { value: user.uid } },
            { key: nodeType === 'document' ? 'docId' : 'resourceId', match: { value: entityId } },
          ],
        },
        with_payload: true,
        with_vector: true,
      });

      // 如果没有点，记录警告并返回空结果
      if (!points?.length) {
        this.logger.warn(`No points found for ${nodeType} ${entityId}`);
        return { data: Buffer.from([]), pointsCount: 0, size: 0 };
      }

      // 准备要序列化的点
      const pointsForAvro = points.map((point) => ({
        id: point.id,
        vector: point.vector,
        payload: JSON.stringify(point.payload),
        metadata: {
          nodeType,
          entityId,
          originalUid: user.uid,
        },
      }));

      // 将点序列化为Avro二进制
      const avroBuffer = Buffer.from(avroSchema.toBuffer(pointsForAvro));
      const size = avroBuffer.length;

      // 记录成功日志
      this.logger.log(
        `Successfully serialized ${points.length} points for ${nodeType} ${entityId} to Avro binary (${size} bytes)`,
      );

      // 返回结果
      return {
        data: avroBuffer,
        pointsCount: points.length,
        size,
      };
    } catch (error) {
      // 记录错误日志
      this.logger.error(
        `Failed to serialize ${nodeType} ${entityId} from user ${user.uid} to Avro binary: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // 从Avro二进制数据反序列化并保存向量点
  async deserializeFromAvro(
    user: User,
    param: {
      data: Buffer;
      targetDocId?: string;
      targetResourceId?: string;
    },
  ): Promise<{ size: number; pointsCount: number }> {
    const { data, targetDocId, targetResourceId } = param;
    const targetNodeType = targetDocId ? 'document' : 'resource';
    const targetEntityId = targetNodeType === 'document' ? targetDocId : targetResourceId;

    if (!targetEntityId) {
      throw new Error('Either targetDocId or targetResourceId must be provided'); // 抛出缺少目标实体ID的错误
    }

    if (!data || data.length === 0) {
      this.logger.warn('No Avro data provided for deserialization'); // 记录没有提供Avro数据的警告
      return { size: 0, pointsCount: 0 };
    }

    try {
      // 记录反序列化开始日志
      this.logger.log(
        `Deserializing Avro binary to ${targetNodeType} ${targetEntityId} for user ${user.uid}`,
      );

      // 从Avro二进制数据反序列化点
      const deserializedPoints = avroSchema.fromBuffer(data);

      // 如果没有点，记录警告并返回空结果
      if (!deserializedPoints?.length) {
        this.logger.warn('No points found in Avro data');
        return { size: 0, pointsCount: 0 };
      }

      // 准备要保存到Qdrant的点，生成新ID并更新租户信息
      const pointsToUpsert = deserializedPoints.map((point, index) => {
        const payload = JSON.parse(point.payload);

        // 生成新ID
        const id = genResourceUuid(`${targetEntityId}-${index}`);

        // 更新负载
        const updatedPayload = {
          ...payload,
          tenantId: user.uid,
        };

        // 如果点引用了文档或资源，更新其ID
        if (targetNodeType === 'document' && payload.docId) {
          updatedPayload.docId = targetDocId;
        } else if (targetNodeType === 'resource' && payload.resourceId) {
          updatedPayload.resourceId = targetResourceId;
        }

        return {
          id,
          vector: point.vector,
          payload: updatedPayload,
        };
      });

      // 计算点的大小
      const size = QdrantService.estimatePointsSize(pointsToUpsert);

      // 保存点到Qdrant
      await this.qdrant.batchSaveData(pointsToUpsert);

      // 记录成功日志
      this.logger.log(
        `Successfully deserialized ${pointsToUpsert.length} points from Avro binary to ${targetNodeType} ${targetEntityId} for user ${user.uid}`,
      );

      // 返回结果
      return {
        size,
        pointsCount: pointsToUpsert.length,
      };
    } catch (error) {
      // 记录错误日志
      this.logger.error(
        `Failed to deserialize Avro binary to ${targetNodeType} ${targetEntityId} for user ${user.uid}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
