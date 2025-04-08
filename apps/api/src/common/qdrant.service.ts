// 导入 NestJS 相关依赖
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// 导入配置服务，用于获取应用配置
import { ConfigService } from '@nestjs/config';
// 导入 Qdrant 客户端，用于与 Qdrant 向量数据库交互
import { QdrantClient } from '@qdrant/js-client-rest';
// 导入自定义的 DTO 类型定义
import { Filter, PointStruct, ScrollRequest } from './qdrant.dto';

// 声明为可注入服务，并实现 OnModuleInit 接口以在模块初始化时执行操作
@Injectable()
export class QdrantService implements OnModuleInit {
  // 创建日志记录器实例
  private readonly logger = new Logger(QdrantService.name);
  // 设置初始化超时时间为 10 秒
  private readonly INIT_TIMEOUT = 10000; // 10 seconds timeout

  // 声明集合名称变量
  private collectionName: string;
  // 声明 Qdrant 客户端变量
  private client: QdrantClient;

  // 构造函数，注入配置服务
  constructor(private configService: ConfigService) {
    // 初始化 Qdrant 客户端
    this.client = new QdrantClient({
      // 从配置中获取主机地址
      host: this.configService.getOrThrow('vectorStore.host'),
      // 从配置中获取端口号
      port: this.configService.getOrThrow('vectorStore.port'),
      // 从配置中获取 API 密钥，如果不存在则为 undefined
      apiKey: this.configService.get('vectorStore.apiKey') || undefined,
    });
    // 设置集合名称为 'refly_vectors'
    this.collectionName = 'refly_vectors';
  }

  // 静态方法，用于估算点数据的大小（字节数）
  static estimatePointsSize(points: PointStruct[]): number {
    // 使用 reduce 方法累加每个点的大小
    return points.reduce((acc, point) => {
      // 估算向量大小（每个浮点数占 4 字节）
      const vectorSize = (point.vector as number[]).length * 4;

      // 估算载荷（payload）大小，通过将对象转为 JSON 字符串再计算字节长度
      const payloadSize = new TextEncoder().encode(JSON.stringify(point.payload)).length;

      // 估算 ID 大小（UTF-8 编码）
      const idSize = new TextEncoder().encode(String(point.id)).length;

      // 累加当前点的总大小（向量大小 + 载荷大小 + ID 大小）
      return acc + vectorSize + payloadSize + idSize;
    }, 0);
  }

  // 模块初始化时执行的方法
  async onModuleInit() {
    // 创建初始化集合的 Promise
    const initPromise = this.initializeCollection();
    // 创建超时 Promise，如果初始化时间过长则拒绝
    const timeoutPromise = new Promise((_, reject) => {
      // 设置超时定时器
      setTimeout(() => {
        // 超时后拒绝 Promise 并提供错误信息
        reject(`Qdrant initialization timed out after ${this.INIT_TIMEOUT}ms`);
      }, this.INIT_TIMEOUT);
    });

    try {
      // 使用 Promise.race 竞争执行，哪个先完成就返回哪个结果
      await Promise.race([initPromise, timeoutPromise]);
      // 初始化成功后记录日志
      this.logger.log('Qdrant collection initialized successfully');
    } catch (error) {
      // 初始化失败时记录错误日志
      this.logger.error(`Failed to initialize Qdrant collection: ${error}`);
      // 抛出错误，中断应用启动
      throw error;
    }
  }

  // 初始化集合的方法
  async initializeCollection() {
    // 检查集合是否已存在
    const { exists } = await this.client.collectionExists(this.collectionName);

    // 如果集合不存在，则创建新集合
    if (!exists) {
      // 创建集合，设置向量大小、距离度量和存储选项
      const res = await this.client.createCollection(this.collectionName, {
        // 向量配置
        vectors: {
          // 从配置中获取向量维度
          size: this.configService.getOrThrow<number>('embeddings.dimensions'),
          // 使用余弦相似度作为距离度量
          distance: 'Cosine',
          // 启用磁盘存储
          on_disk: true,
        },
        // HNSW 索引配置（用于近似最近邻搜索）
        hnsw_config: { payload_m: 16, m: 0, on_disk: true },
        // 启用载荷磁盘存储
        on_disk_payload: true,
      });
      // 记录集合创建成功的日志
      this.logger.log(`collection create success: ${res}`);
    } else {
      // 如果集合已存在，记录日志
      this.logger.log(`collection already exists: ${this.collectionName}`);
    }

    // 创建载荷索引，用于加速按租户 ID 过滤的查询
    await Promise.all([
      this.client.createPayloadIndex(this.collectionName, {
        // 索引字段名称
        field_name: 'tenantId',
        // 索引字段类型为关键字
        field_schema: 'keyword',
      }),
    ]);
  }

  // 批量保存数据点的方法
  async batchSaveData(points: PointStruct[]) {
    // 调用 Qdrant 客户端的 upsert 方法插入或更新数据点
    return this.client.upsert(this.collectionName, {
      // 等待操作完成
      wait: true,
      // 要保存的数据点
      points,
    });
  }

  // 批量删除数据点的方法
  async batchDelete(filter: Filter) {
    // 调用 Qdrant 客户端的 delete 方法删除符合过滤条件的数据点
    return this.client.delete(this.collectionName, {
      // 等待操作完成
      wait: true,
      // 删除条件过滤器
      filter,
    });
  }

  // 搜索相似向量的方法
  async search(
    // 搜索参数
    args: {
      // 查询字符串
      query: string;
      // 可选的查询向量
      vector?: number[];
      // 可选的结果数量限制
      limit?: number;
    },
    // 过滤条件
    filter: Filter,
  ) {
    // 调用 Qdrant 客户端的 search 方法执行向量搜索
    return this.client.search(this.collectionName, {
      // 查询向量
      vector: args.vector,
      // 结果数量限制，默认为 10
      limit: args.limit || 10,
      // 过滤条件
      filter,
    });
  }

  // 滚动获取数据点的方法（用于分页获取大量数据）
  async scroll(param: ScrollRequest) {
    // 存储所有获取到的数据点
    const points = [];
    // 当前偏移量，从传入参数的偏移量开始
    let currentOffset = param.offset;

    // 循环获取所有页的数据
    while (true) {
      // 调用 Qdrant 客户端的 scroll 方法获取一页数据
      const response = await this.client.scroll(this.collectionName, {
        // 展开传入的参数
        ...param,
        // 使用当前偏移量
        offset: currentOffset,
      });

      // 将获取到的数据点添加到结果数组中
      points.push(...response.points);

      // 如果没有下一页，则退出循环
      if (!response.next_page_offset) {
        break;
      }
      // 更新偏移量为下一页的偏移量
      currentOffset = response.next_page_offset;
    }

    // 返回所有获取到的数据点
    return points;
  }
}
