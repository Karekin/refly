// 导入 NestJS 模块装饰器
import { Module } from '@nestjs/common';
// 导入 BullMQ 模块，用于处理队列任务
import { BullModule } from '@nestjs/bullmq';
// 导入配置服务，用于获取应用配置
import { ConfigService } from '@nestjs/config';
// 导入公共模块
import { CommonModule } from '@/common/common.module';
// 导入杂项模块
import { MiscModule } from '@/misc/misc.module';
// 导入 JWT 模块，用于处理 JSON Web Token
import { JwtModule } from '@nestjs/jwt';
// 导入 Passport 模块，用于处理身份验证
import { PassportModule } from '@nestjs/passport';

// 导入认证服务
import { AuthService } from './auth.service';
// 导入认证处理器，用于处理队列任务
import { AuthProcessor } from './auth.processor';
// 导入认证控制器
import { AuthController } from './auth.controller';
// 导入 GitHub OAuth 策略
import { GithubOauthStrategy } from './strategy/github-oauth.strategy';
// 导入 Google OAuth 策略
import { GoogleOauthStrategy } from './strategy/google-oauth.strategy';

// 导入验证邮件队列常量
import { QUEUE_SEND_VERIFICATION_EMAIL } from '@/utils/const';

// 使用 @Module 装饰器定义认证模块
@Module({
  // 导入所需的其他模块
  imports: [
    // 导入公共模块
    CommonModule,
    // 导入杂项模块
    MiscModule,
    // 注册 Passport 模块，启用会话支持
    PassportModule.register({
      session: true,
    }),
    // 注册验证邮件发送队列
    BullModule.registerQueue({ name: QUEUE_SEND_VERIFICATION_EMAIL }),
    // 异步注册 JWT 模块
    JwtModule.registerAsync({
      // 设置为全局模块
      global: true,
      // 使用工厂函数配置 JWT 选项
      useFactory: async (configService: ConfigService) => ({
        // 设置 JWT 密钥
        secret: configService.get('auth.jwt.secret'),
        // 配置签名选项
        signOptions:
          // 在开发环境下不设置过期时间
          process.env.NODE_ENV === 'development'
            ? undefined // never expire in development
            : // 在生产环境使用配置的过期时间
              { expiresIn: configService.get('auth.jwt.expiresIn') },
      }),
      // 注入配置服务
      inject: [ConfigService],
    }),
  ],
  // 注册服务提供者
  providers: [AuthService, AuthProcessor, GithubOauthStrategy, GoogleOauthStrategy],
  // 导出认证服务，使其可以被其他模块使用
  exports: [AuthService],
  // 注册控制器
  controllers: [AuthController],
})
// 导出认证模块类
export class AuthModule {}
