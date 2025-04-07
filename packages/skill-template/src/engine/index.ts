// 导入 SkillRunnableConfig 类型，用于配置技能运行时
import { SkillRunnableConfig } from '../base';
// 导入 FakeListChatModel 用于测试目的
import { FakeListChatModel } from '@langchain/core/utils/testing';
// 导入 ChatDeepSeek 模型及其输入类型
import { ChatDeepSeek, ChatDeepSeekInput } from './chat-deepseek';
// 导入 Document 类型，用于处理文档数据
import { Document } from '@langchain/core/documents';
// 导入各种请求和响应类型，用于与 Refly API 交互
import {
  CreateLabelClassRequest,
  CreateLabelClassResponse,
  CreateLabelInstanceRequest,
  CreateLabelInstanceResponse,
  CreateResourceResponse,
  GetResourceDetailResponse,
  SearchRequest,
  SearchResponse,
  UpdateResourceResponse,
  UpsertResourceRequest,
  User,
  UpsertCanvasRequest,
  CreateCanvasResponse,
  ResourceType,
  InMemorySearchResponse,
  SearchOptions,
  WebSearchRequest,
  WebSearchResponse,
  ListCanvasesData,
  AddReferencesRequest,
  AddReferencesResponse,
  DeleteReferencesRequest,
  DeleteReferencesResponse,
  GetResourceDetailData,
  BatchCreateResourceResponse,
  SearchResult,
  RerankResponse,
  BatchWebSearchRequest,
  GetDocumentDetailData,
  UpsertDocumentRequest,
  ListDocumentsData,
  CreateDocumentResponse,
  GetDocumentDetailResponse,
  ListDocumentsResponse,
  ListCanvasesResponse,
  DeleteCanvasResponse,
  DeleteCanvasRequest,
  DeleteDocumentResponse,
  DeleteDocumentRequest,
} from '@refly-packages/openapi-schema';
// 导入 BaseChatModel 类型，作为聊天模型的基础类型
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

// TODO: unify with frontend
// 定义内容节点类型，表示不同类型的内容
export type ContentNodeType =
  | 'resource'
  | 'document'
  | 'extensionWeblink'
  | 'resourceSelection'
  | 'documentSelection'
  | 'urlSource';

// 定义节点元数据接口，包含节点的基本信息
export interface NodeMeta {
  // 节点标题
  title: string;
  // 节点类型
  nodeType: ContentNodeType;
  // 可选的 URL
  url?: string;
  // 可选的画布 ID
  canvasId?: string;
  // 可选的资源 ID
  resourceId?: string;
  // 可选的资源类型
  resourceType?: ResourceType;
  // 允许添加任意其他字段
  [key: string]: any; // any other fields
}

// 定义 Refly 服务接口，包含与 Refly 平台交互的所有方法
export interface ReflyService {
  // 创建画布方法
  createCanvas: (user: User, req: UpsertCanvasRequest) => Promise<CreateCanvasResponse>;
  // 列出用户的所有画布
  listCanvases: (user: User, param: ListCanvasesData['query']) => Promise<ListCanvasesResponse>;
  // 删除画布
  deleteCanvas: (user: User, req: DeleteCanvasRequest) => Promise<DeleteCanvasResponse>;
  // 获取文档详情
  getDocumentDetail: (
    user: User,
    req: GetDocumentDetailData['query'],
  ) => Promise<GetDocumentDetailResponse>;
  // 创建文档
  createDocument: (user: User, req: UpsertDocumentRequest) => Promise<CreateDocumentResponse>;
  // 列出文档
  listDocuments: (user: User, param: ListDocumentsData['query']) => Promise<ListDocumentsResponse>;
  // 删除文档
  deleteDocument: (user: User, req: DeleteDocumentRequest) => Promise<DeleteDocumentResponse>;
  // 获取资源详情
  getResourceDetail: (
    user: User,
    req: GetResourceDetailData['query'],
  ) => Promise<GetResourceDetailResponse>;
  // 创建资源
  createResource: (user: User, req: UpsertResourceRequest) => Promise<CreateResourceResponse>;
  // 批量创建资源
  batchCreateResource: (
    user: User,
    req: UpsertResourceRequest[],
  ) => Promise<BatchCreateResourceResponse>;
  // 更新资源
  updateResource: (user: User, req: UpsertResourceRequest) => Promise<UpdateResourceResponse>;
  // 创建标签类
  createLabelClass: (user: User, req: CreateLabelClassRequest) => Promise<CreateLabelClassResponse>;
  // 创建标签实例
  createLabelInstance: (
    user: User,
    req: CreateLabelInstanceRequest,
  ) => Promise<CreateLabelInstanceResponse>;
  // 网络搜索
  webSearch: (
    user: User,
    req: WebSearchRequest | BatchWebSearchRequest,
  ) => Promise<WebSearchResponse>;
  // 搜索资源
  search: (user: User, req: SearchRequest, options?: SearchOptions) => Promise<SearchResponse>;
  // 重新排序搜索结果
  rerank: (
    query: string,
    results: SearchResult[],
    options?: { topN?: number; relevanceThreshold?: number },
  ) => Promise<RerankResponse>;
  // 添加引用
  addReferences: (user: User, req: AddReferencesRequest) => Promise<AddReferencesResponse>;
  // 删除引用
  deleteReferences: (user: User, req: DeleteReferencesRequest) => Promise<DeleteReferencesResponse>;
  // 内存中搜索并索引内容
  inMemorySearchWithIndexing: (
    user: User,
    options: {
      // 要搜索的内容，可以是字符串或文档对象
      content: string | Document<any> | Array<Document<any>>;
      // 可选的查询字符串
      query?: string;
      // 可选的返回结果数量
      k?: number;
      // 可选的文档过滤函数
      filter?: (doc: Document<NodeMeta>) => boolean;
      // 是否需要分块
      needChunk?: boolean;
      // 可选的额外元数据
      additionalMetadata?: Record<string, any>;
    },
  ) => Promise<InMemorySearchResponse>;

  // 爬取 URL 并获取其内容的新方法
  crawlUrl: (
    user: User,
    url: string,
  ) => Promise<{ title?: string; content?: string; metadata?: Record<string, any> }>;
}

// 定义技能引擎选项接口
export interface SkillEngineOptions {
  // 默认模型名称
  defaultModel?: string;
}

// 定义日志记录器接口
export interface Logger {
  /**
   * 写入 'error' 级别的日志
   */
  error(message: any, stack?: string, context?: string): void;
  error(message: any, ...optionalParams: [...any, string?, string?]): void;
  /**
   * 写入 'log' 级别的日志
   */
  log(message: any, context?: string): void;
  log(message: any, ...optionalParams: [...any, string?]): void;
  /**
   * 写入 'warn' 级别的日志
   */
  warn(message: any, context?: string): void;
  warn(message: any, ...optionalParams: [...any, string?]): void;
  /**
   * 写入 'debug' 级别的日志
   */
  debug(message: any, context?: string): void;
  debug(message: any, ...optionalParams: [...any, string?]): void;
}

// 定义技能引擎类，用于管理技能的执行
export class SkillEngine {
  // 私有配置属性
  private config: SkillRunnableConfig;

  // 构造函数，初始化技能引擎
  constructor(
    // 日志记录器
    public logger: Logger,
    // Refly 服务实例
    public service: ReflyService,
    // 可选的引擎选项
    private options?: SkillEngineOptions,
  ) {
    this.options = options;
  }

  // 设置引擎选项的方法
  setOptions(options: SkillEngineOptions) {
    this.options = options;
  }

  // 配置技能运行时的方法
  configure(config: SkillRunnableConfig) {
    this.config = config;
  }

  // 创建聊天模型实例的方法
  chatModel(params?: Partial<ChatDeepSeekInput>, useDefaultChatModel = false): BaseChatModel {
    // 如果设置了模拟 LLM 响应环境变量，返回假的聊天模型
    if (process.env.MOCK_LLM_RESPONSE) {
      return new FakeListChatModel({
        responses: ['This is a test'],
        sleep: 100,
      });
    }

    // 获取配置
    const config = this.config?.configurable;

    // 返回 ChatDeepSeek 模型实例
    return new ChatDeepSeek({
      // 根据参数决定使用哪个模型
      model: useDefaultChatModel
        ? this.options.defaultModel
        : config.modelInfo?.name || this.options.defaultModel,
      // 使用环境变量中的 API 密钥
      apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
      // 配置选项
      configuration: {
        // 如果使用 OpenRouter API，设置基础 URL
        baseURL: process.env.OPENROUTER_API_KEY && 'https://openrouter.ai/api/v1',
        // 设置默认请求头
        defaultHeaders: {
          'HTTP-Referer': 'https://refly.ai',
          'X-Title': 'Refly',
        },
      },
      // 合并传入的参数
      ...params,
      // 是否包含推理过程
      include_reasoning: config?.modelInfo?.capabilities?.reasoning,
    });
  }
}
