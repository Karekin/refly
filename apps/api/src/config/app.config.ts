// 定义 MinIO 对象存储配置接口
export interface MinioConfig {
  // MinIO 服务器地址
  endPoint: string;
  // MinIO 服务器端口
  port: number;
  // 是否使用 SSL 加密连接
  useSSL: boolean;
  // 访问密钥
  accessKey: string;
  // 密钥
  secretKey: string;
  // 存储桶名称
  bucket: string;
}

// 导出默认配置函数
export default () => ({
  // API 服务器端口，默认 5800
  port: Number.parseInt(process.env.PORT) || 5800,
  // WebSocket 服务器端口，默认 5801
  wsPort: Number.parseInt(process.env.WS_PORT) || 5801,
  // 允许跨域访问的源地址
  origin: process.env.ORIGIN || 'http://localhost:5700',
  // 静态文件服务配置
  static: {
    // 公共访问配置
    public: {
      // 公共访问端点
      endpoint: process.env.STATIC_PUBLIC_ENDPOINT || 'http://localhost:5800/v1/misc/public',
    },
    // 私有访问配置
    private: {
      // 私有访问端点
      endpoint: process.env.STATIC_PRIVATE_ENDPOINT || 'http://localhost:5800/v1/misc',
    },
  },
  // 图片处理配置
  image: {
    // 最大图片面积（像素），默认 360000 像素
    maxArea: Number.parseInt(process.env.IMAGE_MAX_AREA) || 600 * 600,
    // 图片负载模式，支持 URL 或 Base64
    payloadMode: process.env.IMAGE_PAYLOAD_MODE || 'base64',
    // 预签名 URL 过期时间，默认 15 分钟
    presignExpiry: Number.parseInt(process.env.IMAGE_PRESIGN_EXPIRY) || 15 * 60,
  },
  // Redis 配置
  redis: {
    // Redis 服务器地址
    host: process.env.REDIS_HOST || 'localhost',
    // Redis 服务器端口
    port: Number.parseInt(process.env.REDIS_PORT) || 6379,
    // Redis 访问密码
    password: process.env.REDIS_PASSWORD || '',
  },
  // MinIO 对象存储配置
  minio: {
    // 内部存储配置
    internal: {
      // 服务器地址
      endPoint: process.env.MINIO_INTERNAL_ENDPOINT || 'localhost',
      // 服务器端口
      port: Number.parseInt(process.env.MINIO_INTERNAL_PORT) || 9000,
      // 是否使用 SSL
      useSSL: process.env.MINIO_INTERNAL_USE_SSL === 'true' || false,
      // 访问密钥
      accessKey: process.env.MINIO_INTERNAL_ACCESS_KEY || 'minioadmin',
      // 密钥
      secretKey: process.env.MINIO_INTERNAL_SECRET_KEY || 'minioadmin',
      // 存储桶名称
      bucket: process.env.MINIO_INTERNAL_BUCKET || 'refly-weblink',
    },
    // 外部存储配置
    external: {
      // 服务器地址
      endPoint: process.env.MINIO_EXTERNAL_ENDPOINT || 'localhost',
      // 服务器端口
      port: Number.parseInt(process.env.MINIO_EXTERNAL_PORT) || 9000,
      // 是否使用 SSL
      useSSL: process.env.MINIO_EXTERNAL_USE_SSL === 'true' || false,
      // 访问密钥
      accessKey: process.env.MINIO_EXTERNAL_ACCESS_KEY || 'minioadmin',
      // 密钥
      secretKey: process.env.MINIO_EXTERNAL_SECRET_KEY || 'minioadmin',
      // 存储桶名称
      bucket: process.env.MINIO_EXTERNAL_BUCKET || 'refly-weblink',
    },
  },
  // 向量存储配置（Qdrant）
  vectorStore: {
    // 服务器地址
    host: process.env.QDRANT_HOST || 'localhost',
    // 服务器端口
    port: Number.parseInt(process.env.QDRANT_PORT) || 6333,
    // API 密钥
    apiKey: process.env.QDRANT_API_KEY,
    // 向量维度
    vectorDim: Number.parseInt(process.env.REFLY_VEC_DIM) || 768,
  },
  // Elasticsearch 配置
  elasticsearch: {
    // 服务器地址
    url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    // 用户名
    username: process.env.ELASTICSEARCH_USERNAME,
    // 密码
    password: process.env.ELASTICSEARCH_PASSWORD,
  },
  // 认证配置
  auth: {
    // 是否跳过验证
    skipVerification: process.env.AUTH_SKIP_VERIFICATION === 'true' || false,
    // 登录重定向 URL
    redirectUrl: process.env.LOGIN_REDIRECT_URL,
    // Cookie 配置
    cookie: {
      // Cookie 域名
      domain: process.env.REFLY_COOKIE_DOMAIN,
      // 是否启用安全 Cookie
      secure: process.env.REFLY_COOKIE_SECURE,
      // 同源策略设置
      sameSite: process.env.REFLY_COOKIE_SAME_SITE,
    },
    // JWT 配置
    jwt: {
      // 密钥
      secret: process.env.JWT_SECRET || 'test',
      // 访问令牌过期时间
      expiresIn: process.env.JWT_EXPIRATION_TIME || '1h',
      // 刷新令牌过期时间
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRATION_TIME || '7d',
    },
    // 协作配置
    collab: {
      // 令牌过期时间
      tokenExpiry: process.env.COLLAB_TOKEN_EXPIRY || '1h',
    },
    // 邮箱认证配置
    email: {
      // 是否启用邮箱认证
      enabled: process.env.EMAIL_AUTH_ENABLED === 'true' || true,
      // 发件人信息
      sender: process.env.EMAIL_SENDER || 'Refly <notifications@refly.ai>',
      // Resend API 密钥
      resendApiKey: process.env.RESEND_API_KEY,
    },
    // GitHub 认证配置
    github: {
      // 是否启用 GitHub 认证
      enabled: process.env.GITHUB_AUTH_ENABLED === 'true' || false,
      // 客户端 ID
      clientId: process.env.GITHUB_CLIENT_ID || 'test',
      // 客户端密钥
      clientSecret: process.env.GITHUB_CLIENT_SECRET || 'test',
      // 回调 URL
      callbackUrl: process.env.GITHUB_CALLBACK_URL || 'test',
    },
    // Google 认证配置
    google: {
      // 是否启用 Google 认证
      enabled: process.env.GOOGLE_AUTH_ENABLED === 'true' || false,
      // 客户端 ID
      clientId: process.env.GOOGLE_CLIENT_ID || 'test',
      // 客户端密钥
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'test',
      // 回调 URL
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'test',
    },
  },
  // 解析器配置
  parser: {
    // PDF 解析器类型
    pdf: process.env.PARSER_PDF || 'pdfjs',
  },
  // 嵌入向量配置
  embeddings: {
    // 提供商
    provider: process.env.EMBEDDINGS_PROVIDER || 'jina',
    // 模型名称
    modelName: process.env.EMBEDDINGS_MODEL_NAME || 'jina-embeddings-v3',
    // 向量维度
    dimensions: Number.parseInt(process.env.EMBEDDINGS_DIMENSIONS) || 768,
    // 批处理大小
    batchSize: Number.parseInt(process.env.EMBEDDINGS_BATCH_SIZE) || 512,
  },
  // 重排序器配置
  reranker: {
    // 返回前 N 个结果
    topN: Number.parseInt(process.env.RERANKER_TOP_N) || 10,
    // 模型名称
    model: process.env.RERANKER_MODEL || 'jina-reranker-v2-base-multilingual',
    // 相关性阈值
    relevanceThreshold: Number.parseFloat(process.env.RERANKER_RELEVANCE_THRESHOLD) || 0.5,
  },
  // 技能配置
  skill: {
    // 空闲超时时间（1分钟）
    idleTimeout: Number.parseInt(process.env.SKILL_IDLE_TIMEOUT) || 1000 * 60,
    // 执行超时时间（3分钟）
    executionTimeout: Number.parseInt(process.env.SKILL_EXECUTION_TIMEOUT) || 1000 * 60 * 3,
  },
  // Stripe 支付配置
  stripe: {
    // API 密钥
    apiKey: process.env.STRIPE_API_KEY,
    // Webhook 密钥
    webhookSecret: {
      // 账户 Webhook 密钥
      account: process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET || 'test',
      // 测试账户 Webhook 密钥
      accountTest: process.env.STRIPE_ACCOUNT_TEST_WEBHOOK_SECRET || 'test',
    },
    // 支付成功跳转 URL
    sessionSuccessUrl: process.env.STRIPE_SESSION_SUCCESS_URL,
    // 支付取消跳转 URL
    sessionCancelUrl: process.env.STRIPE_SESSION_CANCEL_URL,
    // 客户门户返回 URL
    portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL,
  },
  // 配额配置
  quota: {
    // 令牌配额
    token: {
      // T1 级别令牌配额
      t1: Number.parseInt(process.env.QUOTA_T1_TOKEN) || -1,
      // T2 级别令牌配额
      t2: Number.parseInt(process.env.QUOTA_T2_TOKEN) || -1,
    },
    // 请求配额
    request: {
      // T1 级别请求配额
      t1: Number.parseInt(process.env.QUOTA_T1_REQUEST) || -1,
      // T2 级别请求配额
      t2: Number.parseInt(process.env.QUOTA_T2_REQUEST) || -1,
    },
    // 存储配额
    storage: {
      // 文件存储配额
      file: Number.parseInt(process.env.QUOTA_STORAGE_FILE) || -1,
      // 对象存储配额
      object: Number.parseInt(process.env.QUOTA_STORAGE_OBJECT) || -1,
      // 向量存储配额
      vector: Number.parseInt(process.env.QUOTA_STORAGE_VECTOR) || -1,
    },
    // 文件解析配额
    fileParse: {
      // 页面解析配额
      page: Number.parseInt(process.env.QUOTA_FILE_PARSE_PAGE) || -1,
    },
  },
  // API 凭证配置
  credentials: {
    // OpenAI API 密钥
    openai: process.env.OPENAI_API_KEY,
    // Jina API 密钥
    jina: process.env.JINA_API_KEY,
    // Fireworks API 密钥
    fireworks: process.env.FIREWORKS_API_KEY,
    // Serper API 密钥
    serper: process.env.SERPER_API_KEY,
    // Marker API 密钥
    marker: process.env.MARKER_API_KEY,
  },
});
