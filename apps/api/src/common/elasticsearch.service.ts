// 导入 NestJS 的依赖注入装饰器、日志记录器和模块初始化接口
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// 导入配置服务
import { ConfigService } from '@nestjs/config';
// 导入 Elasticsearch 客户端
import { Client } from '@elastic/elasticsearch';
// 导入搜索请求和用户接口
import { SearchRequest, User } from '@refly-packages/openapi-schema';

// 定义资源文档接口，用于存储资源相关信息
interface ResourceDocument {
  id: string;
  title?: string;
  content?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  uid: string;
}

// 定义文档接口，用于存储文档相关信息
interface DocumentDocument {
  id: string;
  title?: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
  uid: string;
}

// 定义画布接口，用于存储画布相关信息
interface CanvasDocument {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  uid: string;
}

// 定义通用的 Elasticsearch 分析器设置
const commonSettings = {
  analysis: {
    analyzer: {
      // 使用 ICU 分析器作为默认分析器，支持多语言分析
      default: {
        type: 'icu_analyzer',
      },
    },
  },
};

// 导出索引配置，包含资源、文档和画布三种类型的索引设置
export const indexConfig = {
  // 资源索引配置
  resource: {
    index: 'refly_resources',
    settings: commonSettings,
    properties: {
      title: { type: 'text' },
      content: { type: 'text' },
      url: { type: 'keyword' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
      uid: { type: 'keyword' },
    },
  },
  // 文档索引配置
  document: {
    index: 'refly_documents',
    settings: commonSettings,
    properties: {
      title: { type: 'text' },
      content: { type: 'text' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
      uid: { type: 'keyword' },
    },
  },
  // 画布索引配置
  canvas: {
    index: 'refly_canvases',
    settings: commonSettings,
    properties: {
      title: { type: 'text' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
      uid: { type: 'keyword' },
    },
  },
};

// 定义索引配置值类型，用于类型检查
type IndexConfigValue = (typeof indexConfig)[keyof typeof indexConfig];

// 定义搜索命中接口，包含搜索结果的元数据和源数据
interface SearchHit<T> {
  _index: string;
  _id: string;
  _score: number;
  _source: T;
  highlight?: {
    [key: string]: string[];
  };
}

// 定义搜索响应接口，包含搜索结果的统计信息和命中列表
interface SearchResponse<T> {
  hits: {
    total: {
      value: number;
      relation: string;
    };
    max_score: number;
    hits: SearchHit<T>[];
  };
}

// 标记为可注入的服务类，并实现模块初始化接口
@Injectable()
export class ElasticsearchService implements OnModuleInit {
  // 创建日志记录器实例
  private readonly logger = new Logger(ElasticsearchService.name);
  // 定义初始化超时时间为 10 秒
  private readonly INIT_TIMEOUT = 10000;

  // 声明 Elasticsearch 客户端实例
  private client: Client;

  // 构造函数，注入配置服务
  constructor(private configService: ConfigService) {
    // 初始化 Elasticsearch 客户端
    this.client = new Client({
      node: this.configService.getOrThrow('elasticsearch.url'),
      auth: {
        username: this.configService.get('elasticsearch.username'),
        password: this.configService.get('elasticsearch.password'),
      },
    });
  }

  // 模块初始化时执行的方法
  async onModuleInit() {
    // 创建索引初始化承诺
    const initPromise = this.initializeIndices();
    // 创建超时承诺
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(`Elasticsearch initialization timed out after ${this.INIT_TIMEOUT}ms`);
      }, this.INIT_TIMEOUT);
    });

    try {
      // 使用 Promise.race 竞争执行初始化和超时
      await Promise.race([initPromise, timeoutPromise]);
      // 记录初始化成功日志
      this.logger.log('Elasticsearch indices initialized successfully');
    } catch (error) {
      // 记录初始化失败错误并重新抛出
      this.logger.error(`Failed to initialize Elasticsearch indices: ${error}`);
      throw error;
    }
  }

  // 初始化所有索引的私有方法
  private async initializeIndices() {
    // 遍历所有索引配置并确保索引存在
    for (const config of Object.values(indexConfig)) {
      await this.ensureIndexExists(config);
    }
  }

  // 确保索引存在的私有方法
  private async ensureIndexExists(indexConfig: IndexConfigValue) {
    // 检查索引是否存在
    const { body: indexExists } = await this.client.indices.exists({ index: indexConfig.index });
    this.logger.log(`Index exists for ${indexConfig.index}: ${indexExists}`);

    // 如果索引不存在，创建新索引
    if (!indexExists) {
      try {
        // 创建索引并设置映射
        const { body } = await this.client.indices.create({
          index: indexConfig.index,
          body: {
            settings: indexConfig.settings,
            mappings: {
              properties: indexConfig.properties,
            },
          },
        });
        this.logger.log(`Index created successfully: ${JSON.stringify(body)}`);
      } catch (error) {
        // 记录创建索引失败的错误
        this.logger.error(`Error creating index ${indexConfig.index}: ${error}`);
      }
    } else {
      // 记录索引已存在的日志
      this.logger.log(`Index already exists: ${indexConfig.index}`);
    }
  }

  // 更新或插入文档的私有方法
  private async upsertESDoc<T extends { id: string }>(index: string, document: T) {
    try {
      // 执行更新操作，如果文档不存在则创建
      const result = await this.client.update({
        index,
        id: document.id,
        body: {
          doc: document,
          doc_as_upsert: true,
        },
        retry_on_conflict: 3,
      });
      this.logger.log(`Document upserted successfully, index: ${index}, id: ${document.id}`);
      return result;
    } catch (error) {
      // 记录更新失败的错误并重新抛出
      this.logger.error(`Error upserting document ${document.id} to index ${index}: ${error}`);
      throw error;
    }
  }

  // 更新或插入资源文档的方法
  async upsertResource(resource: ResourceDocument) {
    return this.upsertESDoc(indexConfig.resource.index, resource);
  }

  // 更新或插入普通文档的方法
  async upsertDocument(document: DocumentDocument) {
    return this.upsertESDoc(indexConfig.document.index, document);
  }

  // 更新或插入画布文档的方法
  async upsertCanvas(canvas: CanvasDocument) {
    return this.upsertESDoc(indexConfig.canvas.index, canvas);
  }

  // 删除资源的方法
  async deleteResource(resourceId: string) {
    return this.client.delete(
      {
        index: indexConfig.resource.index,
        id: resourceId,
      },
      { ignore: [404] }, // 忽略 404 错误（文档不存在）
    );
  }

  // 删除文档的方法
  async deleteDocument(docId: string) {
    return this.client.delete(
      {
        index: indexConfig.document.index,
        id: docId,
      },
      { ignore: [404] }, // 忽略 404 错误（文档不存在）
    );
  }

  // 删除画布的方法
  async deleteCanvas(canvasId: string) {
    return this.client.delete(
      {
        index: indexConfig.canvas.index,
        id: canvasId,
      },
      { ignore: [404] }, // 忽略 404 错误（文档不存在）
    );
  }

  // 复制资源的方法
  async duplicateResource(resourceId: string, newId: string, user: User): Promise<void> {
    try {
      // 获取源资源文档
      const { body } = await this.client.get<{ _source: ResourceDocument }>(
        {
          index: indexConfig.resource.index,
          id: resourceId,
        },
        { ignore: [404] },
      );

      // 如果源文档不存在，记录警告并返回
      if (!body?._source) {
        this.logger.warn(`Resource ${resourceId} not found`);
        return;
      }

      // 获取源文档数据
      const sourceDoc = body._source;
      // 创建新的资源文档，更新必要的字段
      const duplicatedDoc: ResourceDocument = {
        ...sourceDoc,
        id: newId,
        uid: user.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 保存新的资源文档
      await this.upsertResource(duplicatedDoc);
    } catch (error) {
      // 记录复制失败的错误并重新抛出
      this.logger.error(`Error duplicating resource ${resourceId}: ${error}`);
      throw error;
    }
  }

  // 复制文档的方法
  async duplicateDocument(documentId: string, newId: string, user: User): Promise<void> {
    try {
      // 获取源文档
      const { body } = await this.client.get<{ _source: DocumentDocument }>(
        {
          index: indexConfig.document.index,
          id: documentId,
        },
        { ignore: [404] },
      );

      // 如果源文档不存在，记录警告并返回
      if (!body?._source) {
        this.logger.warn(`Document ${documentId} not found`);
        return;
      }

      // 获取源文档数据
      const sourceDoc = body._source;
      // 创建新的文档，更新必要的字段
      const duplicatedDoc: DocumentDocument = {
        ...sourceDoc,
        id: newId,
        uid: user.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 保存新的文档
      await this.upsertDocument(duplicatedDoc);
    } catch (error) {
      // 记录复制失败的错误并重新抛出
      this.logger.error(`Error duplicating document ${documentId}: ${error}`);
      throw error;
    }
  }

  // 搜索资源的方法
  async searchResources(user: User, req: SearchRequest) {
    // 解构搜索请求参数
    const { query, limit, entities } = req;
    // 执行搜索请求
    const { body } = await this.client.search<SearchResponse<ResourceDocument>>({
      index: indexConfig.resource.index,
      body: {
        query: {
          bool: {
            must: [
              // 匹配用户ID
              { match: { uid: user.uid } },
              // 多字段匹配查询
              {
                multi_match: {
                  query,
                  fields: ['title^2', 'content'], // title 字段权重加倍
                  type: 'most_fields',
                },
              },
            ],
            // 如果指定了实体ID，添加过滤条件
            ...(entities?.length > 0 && {
              filter: [{ terms: { _id: entities.map((entity) => entity.entityId) } }],
            }),
          },
        },
        size: limit,
        // 配置高亮显示
        highlight: {
          fields: {
            title: {},
            content: {},
          },
        },
      },
    });

    // 返回搜索结果
    return body.hits.hits;
  }

  // 搜索文档的方法
  async searchDocuments(user: User, req: SearchRequest) {
    // 解构搜索请求参数
    const { query, limit, entities } = req;
    // 执行搜索请求
    const { body } = await this.client.search<SearchResponse<DocumentDocument>>({
      index: indexConfig.document.index,
      body: {
        query: {
          bool: {
            must: [
              // 匹配用户ID
              { match: { uid: user.uid } },
              // 多字段匹配查询
              {
                multi_match: {
                  query,
                  fields: ['title^2', 'content'], // title 字段权重加倍
                  type: 'most_fields',
                },
              },
            ],
            // 如果指定了实体ID，添加过滤条件
            ...(entities?.length > 0 && {
              filter: [{ terms: { _id: entities.map((entity) => entity.entityId) } }],
            }),
          },
        },
        size: limit,
        // 配置高亮显示
        highlight: {
          fields: {
            title: {},
            content: {},
          },
        },
      },
    });

    // 返回搜索结果
    return body.hits.hits;
  }

  // 搜索画布的方法
  async searchCanvases(user: User, req: SearchRequest) {
    // 解构搜索请求参数
    const { query, limit, entities } = req;
    // 执行搜索请求
    const { body } = await this.client.search<SearchResponse<CanvasDocument>>({
      index: indexConfig.canvas.index,
      body: {
        query: {
          bool: {
            must: [
              // 匹配用户ID
              { match: { uid: user.uid } },
              // 仅在标题字段中搜索
              {
                multi_match: {
                  query,
                  fields: ['title'],
                  type: 'most_fields',
                },
              },
            ],
            // 如果指定了实体ID，添加过滤条件
            ...(entities?.length > 0 && {
              filter: [{ terms: { _id: entities.map((entity) => entity.entityId) } }],
            }),
          },
        },
        size: limit,
        // 配置高亮显示
        highlight: {
          fields: {
            title: {},
          },
        },
      },
    });

    // 返回搜索结果
    return body.hits.hits;
  }
}
