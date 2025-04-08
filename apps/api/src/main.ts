// 导入别名注册文件，用于设置路径别名
import './register-aliases';

// 导入NestFactory，用于创建Nest应用实例
import { NestFactory } from '@nestjs/core';
// 导入NestExpressApplication接口，用于Express特定功能
import { NestExpressApplication } from '@nestjs/platform-express';
// 导入path模块的join方法，用于处理文件路径
import { join } from 'node:path';
// 导入cookie-parser中间件，用于解析cookie
import cookieParser from 'cookie-parser';
// 导入helmet中间件，用于增强应用安全性
import helmet from 'helmet';

// 导入Sentry模块，用于错误监控和性能追踪
import * as Sentry from '@sentry/node';
// 导入Sentry性能分析集成
import { nodeProfilingIntegration } from '@sentry/profiling-node';
// 导入Nest日志记录器
import { Logger } from 'nestjs-pino';

// 导入应用主模块
import { AppModule } from './app.module';
// 导入配置服务，用于获取应用配置
import { ConfigService } from '@nestjs/config';

// 导入追踪器
import tracer from './tracer';
// 导入设置追踪ID的中间件
import { setTraceID } from './utils/middleware/set-trace-id';
// 导入全局异常过滤器
import { GlobalExceptionFilter } from './utils/filters/global-exception.filter';
// 导入自定义WebSocket适配器
import { CustomWsAdapter } from '@/utils/adapters/ws-adapter';

// 初始化Sentry配置
Sentry.init({
  // 设置Sentry数据源名称
  dsn: process.env.SENTRY_DSN,
  // 集成节点性能分析
  integrations: [nodeProfilingIntegration()],
  // 设置环境变量
  environment: process.env.NODE_ENV,
  // 设置追踪采样率为100%
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  // 设置性能分析采样率为100%
  profilesSampleRate: 1.0,
});

// 应用启动函数
async function bootstrap() {
  // 创建NestJS应用实例，指定为Express应用
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // 启用原始请求体
    rawBody: true,
    // 禁用缓冲日志
    bufferLogs: false,
  });
  // 使用Nest-Pino日志记录器
  app.useLogger(app.get(Logger));

  // 获取配置服务实例
  const configService = app.get(ConfigService);

  // 监听未捕获的异常，并发送到Sentry
  process.on('uncaughtException', (err) => {
    Sentry.captureException(err);
  });

  // 监听未处理的Promise拒绝，并发送到Sentry
  process.on('unhandledRejection', (err) => {
    Sentry.captureException(err);
  });

  // 配置JSON请求体解析器，限制大小为10MB
  app.useBodyParser('json', { limit: '10mb' });
  // 配置URL编码请求体解析器，限制大小为10MB
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  // 设置静态资源目录
  app.useStaticAssets(join(__dirname, '..', 'public'));
  // 设置视图基础目录
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  // 设置视图引擎为handlebars
  app.setViewEngine('hbs');
  // 设置信任代理，用于获取正确的客户端IP
  app.set('trust proxy', true);

  // 使用追踪ID中间件
  app.use(setTraceID);
  // 使用Helmet中间件增强安全性
  app.use(helmet());
  // 启用跨域资源共享(CORS)
  app.enableCors({
    // 设置允许的源，从配置中获取并按逗号分割
    origin: configService.get('origin').split(','),
    // 允许发送凭证
    credentials: true,
  });
  // 使用Cookie解析中间件
  app.use(cookieParser());
  // 使用自定义WebSocket适配器
  app.useWebSocketAdapter(new CustomWsAdapter(app, configService.get<number>('wsPort')));
  // 使用全局异常过滤器
  app.useGlobalFilters(new GlobalExceptionFilter(configService));

  // 启动追踪器
  tracer.start();

  // 启动应用监听，端口从配置中获取
  await app.listen(configService.get('port'));
}
// 调用启动函数
bootstrap();
