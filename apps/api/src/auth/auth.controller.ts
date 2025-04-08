// 导入所需的 NestJS 装饰器和工具类
import {
  Controller,
  Logger,
  Get,
  Post,
  Res,
  UseGuards,
  Body,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
// 导入 Express 的请求和响应类型
import { Response, Request } from 'express';
// 导入配置服务
import { ConfigService } from '@nestjs/config';

// 导入已登录用户装饰器
import { LoginedUser } from '@/utils/decorators/user.decorator';
// 导入认证服务
import { AuthService } from './auth.service';
// 导入 GitHub OAuth 守卫
import { GithubOauthGuard } from './guard/github-oauth.guard';
// 导入 Google OAuth 守卫
import { GoogleOauthGuard } from './guard/google-oauth.guard';
// 导入 OAuth 错误类型
import { OAuthError } from '@refly-packages/errors';
// 导入认证相关的请求和响应类型定义
import {
  EmailSignupRequest,
  EmailLoginRequest,
  CreateVerificationRequest,
  CheckVerificationRequest,
  ResendVerificationRequest,
  AuthConfigResponse,
  CreateVerificationResponse,
  ResendVerificationResponse,
  User,
} from '@refly-packages/openapi-schema';
// 导入响应构建工具
import { buildSuccessResponse } from '@/utils';
// 导入请求限流相关的工具和装饰器
import { hours, minutes, seconds, Throttle } from '@nestjs/throttler';
// 导入 JWT 认证守卫
import { JwtAuthGuard } from '@/auth/guard/jwt-auth.guard';
// 导入刷新令牌 Cookie 名称常量
import { REFRESH_TOKEN_COOKIE } from '@refly-packages/utils';

// 定义认证控制器，处理 v1/auth 路径下的请求
@Controller('v1/auth')
export class AuthController {
  // 创建日志记录器实例
  private logger = new Logger(AuthController.name);

  // 构造函数，注入所需的服务
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  // 获取认证配置信息的接口
  @Get('config')
  getAuthConfig(): AuthConfigResponse {
    return buildSuccessResponse(this.authService.getAuthConfig());
  }

  // 邮箱注册接口，限制每小时最多调用5次
  @Throttle({ default: { limit: 5, ttl: hours(1) } })
  @Post('email/signup')
  async emailSignup(@Body() { email, password }: EmailSignupRequest, @Res() res: Response) {
    const { sessionId, tokenData } = await this.authService.emailSignup(email, password);
    if (tokenData) {
      return this.authService
        .setAuthCookie(res, tokenData)
        .json(buildSuccessResponse({ skipVerification: true }));
    }
    return res.status(200).json(buildSuccessResponse({ sessionId }));
  }

  // 邮箱登录接口，限制每10分钟最多调用5次
  @Throttle({ default: { limit: 5, ttl: minutes(10) } })
  @Post('email/login')
  async emailLogin(@Body() { email, password }: EmailLoginRequest, @Res() res: Response) {
    const tokens = await this.authService.emailLogin(email, password);
    return this.authService.setAuthCookie(res, tokens).json(buildSuccessResponse());
  }

  // 创建验证接口，限制每10分钟最多调用5次
  @Throttle({ default: { limit: 5, ttl: minutes(10) } })
  @Post('verification/create')
  async createVerification(
    @Body() params: CreateVerificationRequest,
  ): Promise<CreateVerificationResponse> {
    const { sessionId } = await this.authService.createVerification(params);
    return buildSuccessResponse({ sessionId });
  }

  // 重新发送验证邮件接口，限制每30秒最多调用1次
  @Throttle({ default: { limit: 1, ttl: seconds(30) } })
  @Post('verification/resend')
  async resendVerification(
    @Body() { sessionId }: ResendVerificationRequest,
  ): Promise<ResendVerificationResponse> {
    await this.authService.addSendVerificationEmailJob(sessionId);
    return buildSuccessResponse();
  }

  // 检查验证码接口，限制每10分钟最多调用5次
  @Throttle({ default: { limit: 5, ttl: minutes(10) } })
  @Post('verification/check')
  async checkVerification(@Body() params: CheckVerificationRequest, @Res() res: Response) {
    const tokens = await this.authService.checkVerification(params);
    return this.authService.setAuthCookie(res, tokens).json(buildSuccessResponse());
  }

  // GitHub OAuth 登录入口
  @UseGuards(GithubOauthGuard)
  @Get('github')
  async github() {
    // auth guard will automatically handle this
  }

  // Google OAuth 登录入口
  @UseGuards(GoogleOauthGuard)
  @Get('google')
  async google() {
    // auth guard will automatically handle this
  }

  // GitHub OAuth 回调处理接口
  @UseGuards(GithubOauthGuard)
  @Get('callback/github')
  async githubAuthCallback(@LoginedUser() user: User, @Res() res: Response) {
    try {
      // 记录 GitHub OAuth 回调成功日志
      this.logger.log(`github oauth callback success, req.user = ${user?.email}`);

      // 生成用户令牌
      const tokens = await this.authService.login(user);
      // 设置认证 Cookie 并重定向到配置的 URL
      this.authService
        .setAuthCookie(res, tokens)
        .redirect(this.configService.get('auth.redirectUrl'));
    } catch (error) {
      // 记录错误日志并抛出 OAuth 错误
      this.logger.error('GitHub OAuth callback failed:', error.stack);
      throw new OAuthError();
    }
  }

  // Google OAuth 回调处理接口
  @UseGuards(GoogleOauthGuard)
  @Get('callback/google')
  async googleAuthCallback(@LoginedUser() user: User, @Res() res: Response) {
    try {
      // 记录 Google OAuth 回调成功日志
      this.logger.log(`google oauth callback success, req.user = ${user?.email}`);

      // 生成用户令牌
      const tokens = await this.authService.login(user);
      // 设置认证 Cookie 并重定向到配置的 URL
      this.authService
        .setAuthCookie(res, tokens)
        .redirect(this.configService.get('auth.redirectUrl'));
    } catch (error) {
      // 记录错误日志并抛出 OAuth 错误
      this.logger.error('Google OAuth callback failed:', error.stack);
      throw new OAuthError();
    }
  }

  // 刷新访问令牌接口
  @Post('refreshToken')
  async refreshToken(@Req() req: Request, @Res() res: Response) {
    // 从 Cookie 中获取刷新令牌
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    // 如果没有刷新令牌，清除认证 Cookie 并抛出未授权异常
    if (!refreshToken) {
      this.authService.clearAuthCookie(res);
      throw new UnauthorizedException();
    }

    try {
      // 刷新访问令牌
      const tokens = await this.authService.refreshAccessToken(refreshToken);
      // 设置新的认证 Cookie
      this.authService.setAuthCookie(res, tokens);
      res.status(200).json(buildSuccessResponse());
    } catch (error) {
      // 如果发生未授权异常，清除认证 Cookie
      if (error instanceof UnauthorizedException) {
        this.authService.clearAuthCookie(res);
      }
      throw error;
    }
  }

  // 登出接口，需要 JWT 认证
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@LoginedUser() user: User, @Res() res: Response) {
    try {
      // 记录用户登出开始日志
      this.logger.log(`Logging out user: ${user.uid}`);

      // 撤销用户的所有刷新令牌
      await this.authService.revokeAllRefreshTokens(user.uid);

      // 清除认证 Cookie
      this.authService.clearAuthCookie(res);

      // 记录用户登出成功日志
      this.logger.log(`Successfully logged out user: ${user.uid}`);
      return res.status(200).json(buildSuccessResponse());
    } catch (error) {
      // 记录登出失败错误日志
      this.logger.error(`Logout failed for user ${user.uid}:`, error.stack);
      throw error;
    }
  }
}
