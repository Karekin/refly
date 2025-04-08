// 导入 NestJS 的依赖注入装饰器、日志记录器和未授权异常
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
// 导入 Node.js 加密模块的随机字节生成函数
import { randomBytes } from 'node:crypto';
// 导入 argon2 密码哈希库
import argon2 from 'argon2';
// 导入时间字符串解析库
import ms from 'ms';
// 导入 Passport 的用户配置文件类型
import { Profile } from 'passport';
// 导入 Express 的 Cookie 选项和响应类型
import { CookieOptions, Response } from 'express';
// 导入 JWT 服务
import { JwtService } from '@nestjs/jwt';
// 导入配置服务
import { ConfigService } from '@nestjs/config';
// 导入 Prisma 生成的用户模型和验证会话类型
import { User as UserModel, VerificationSession } from '@prisma/client';
// 导入令牌数据接口
import { TokenData } from './auth.dto';
// 导入工具函数和常量
import {
  ACCESS_TOKEN_COOKIE,
  genUID,
  genVerificationSessionID,
  omit,
  pick,
  REFRESH_TOKEN_COOKIE,
  UID_COOKIE,
} from '@refly-packages/utils';
// 导入 Prisma 服务
import { PrismaService } from '@/common/prisma.service';
// 导入杂项服务
import { MiscService } from '@/misc/misc.service';
// 导入 Resend 邮件发送库
import { Resend } from 'resend';
// 导入 API 接口定义
import {
  User,
  AuthConfigItem,
  CheckVerificationRequest,
  CreateVerificationRequest,
} from '@refly-packages/openapi-schema';
// 导入自定义错误类型
import {
  AccountNotFoundError,
  EmailAlreadyRegistered,
  IncorrectVerificationCode,
  InvalidVerificationSession,
  OAuthError,
  ParamsError,
  PasswordIncorrect,
} from '@refly-packages/errors';
// 导入 BullMQ 队列类型
import { Queue } from 'bullmq';
// 导入 BullMQ 队列注入装饰器
import { InjectQueue } from '@nestjs/bullmq';
// 导入验证邮件队列常量
import { QUEUE_SEND_VERIFICATION_EMAIL } from '@/utils/const';

// 标记为可注入的服务类
@Injectable()
export class AuthService {
  // 创建日志记录器实例
  private logger = new Logger(AuthService.name);
  // 声明 Resend 邮件服务实例
  private resend: Resend;

  // 构造函数，注入所需的服务
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private jwtService: JwtService,
    private miscService: MiscService,
    // 注入验证邮件队列
    @InjectQueue(QUEUE_SEND_VERIFICATION_EMAIL) private emailQueue: Queue,
  ) {
    // 初始化 Resend 邮件服务
    this.resend = new Resend(this.configService.get('auth.email.resendApiKey'));
  }

  // 获取认证配置信息
  getAuthConfig(): AuthConfigItem[] {
    // 创建配置项数组
    const items: AuthConfigItem[] = [];
    // 如果启用了邮箱认证，添加邮箱提供商
    if (this.configService.get('auth.email.enabled')) {
      items.push({ provider: 'email' });
    }
    // 如果启用了 Google 认证，添加 Google 提供商
    if (this.configService.get('auth.google.enabled')) {
      items.push({ provider: 'google' });
    }
    // 如果启用了 GitHub 认证，添加 GitHub 提供商
    if (this.configService.get('auth.github.enabled')) {
      items.push({ provider: 'github' });
    }
    // 返回配置项数组
    return items;
  }

  // 用户登录方法，生成访问令牌和刷新令牌
  async login(user: User): Promise<TokenData> {
    // 从用户对象中选择 uid 和 email 作为 JWT 载荷
    const payload: User = pick(user, ['uid', 'email']);
    // 使用 JWT 服务签发访问令牌
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('auth.jwt.secret'),
      expiresIn: this.configService.get('auth.jwt.expiresIn'),
    });

    // 生成刷新令牌
    const refreshToken = await this.generateRefreshToken(user.uid);

    // 返回令牌数据
    return {
      uid: user.uid,
      accessToken,
      refreshToken,
    };
  }

  // 生成刷新令牌的私有方法
  private async generateRefreshToken(uid: string): Promise<string> {
    // 生成 JWT ID
    const jti = randomBytes(32).toString('hex');
    // 生成令牌
    const token = randomBytes(64).toString('hex');
    // 对令牌进行哈希处理
    const hashedToken = await argon2.hash(token);

    // 将哈希后的刷新令牌存储到数据库
    await this.prisma.refreshToken.create({
      data: {
        jti,
        uid,
        hashedToken,
        // 设置过期时间
        expiresAt: new Date(Date.now() + ms(this.configService.get('auth.jwt.refreshExpiresIn'))),
      },
    });

    // 返回 JWT ID 和令牌的组合
    return `${jti}.${token}`;
  }

  // 刷新访问令牌的方法
  async refreshAccessToken(refreshToken: string) {
    // 分割刷新令牌，获取 JWT ID 和令牌
    const [jti, token] = refreshToken.split('.');

    // 如果 JWT ID 或令牌不存在，抛出未授权异常
    if (!jti || !token) {
      throw new UnauthorizedException();
    }

    // 在数据库中查找刷新令牌
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { jti },
    });

    // 如果令牌不存在、已撤销或已过期，抛出未授权异常
    if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException();
    }

    // 验证令牌
    const isValid = await argon2.verify(storedToken.hashedToken, token);
    // 如果令牌无效，抛出未授权异常
    if (!isValid) {
      throw new UnauthorizedException();
    }

    // 撤销当前刷新令牌（一次性使用）
    await this.prisma.refreshToken.update({
      where: { jti },
      data: { revoked: true },
    });

    // 获取用户信息
    const user = await this.prisma.user.findUnique({
      where: { uid: storedToken.uid },
    });

    // 如果用户不存在，抛出账户未找到错误
    if (!user) {
      throw new AccountNotFoundError();
    }

    // 生成新的令牌
    return this.login(user);
  }

  // 撤销用户的所有刷新令牌
  async revokeAllRefreshTokens(uid: string) {
    // 更新用户的所有刷新令牌为已撤销状态
    await this.prisma.refreshToken.updateMany({
      where: { uid },
      data: { revoked: true },
    });
  }

  // 获取 Cookie 选项
  cookieOptions(key: string): CookieOptions {
    // 基本 Cookie 选项
    const baseOptions: CookieOptions = {
      domain: this.configService.get('auth.cookie.domain'),
      secure: Boolean(this.configService.get('auth.cookie.secure')),
      sameSite: this.configService.get('auth.cookie.sameSite'),
      path: '/',
    };

    // 根据 Cookie 类型返回不同的选项
    switch (key) {
      // 用户 ID Cookie
      case UID_COOKIE:
        return {
          ...baseOptions,
          // 设置过期时间为刷新令牌的过期时间
          expires: new Date(Date.now() + ms(this.configService.get('auth.jwt.refreshExpiresIn'))),
        };
      // 访问令牌 Cookie
      case ACCESS_TOKEN_COOKIE:
        return {
          ...baseOptions,
          // 设置为 HTTP Only，防止客户端 JavaScript 访问
          httpOnly: true,
          // 设置过期时间为访问令牌的过期时间
          expires: new Date(Date.now() + ms(this.configService.get('auth.jwt.expiresIn'))),
        };
      // 刷新令牌 Cookie
      case REFRESH_TOKEN_COOKIE:
        return {
          ...baseOptions,
          // 设置为 HTTP Only，防止客户端 JavaScript 访问
          httpOnly: true,
          // 设置过期时间为刷新令牌的过期时间
          expires: new Date(Date.now() + ms(this.configService.get('auth.jwt.refreshExpiresIn'))),
        };
      // 默认返回基本选项
      default:
        return baseOptions;
    }
  }

  // 设置认证 Cookie
  setAuthCookie(res: Response, { uid, accessToken, refreshToken }: TokenData) {
    // 链式调用设置多个 Cookie
    return res
      .cookie(UID_COOKIE, uid, this.cookieOptions(UID_COOKIE))
      .cookie(ACCESS_TOKEN_COOKIE, accessToken, this.cookieOptions(ACCESS_TOKEN_COOKIE))
      .cookie(REFRESH_TOKEN_COOKIE, refreshToken, this.cookieOptions(REFRESH_TOKEN_COOKIE));
  }

  // 清除认证 Cookie
  clearAuthCookie(res: Response) {
    // 创建清除 Cookie 的选项，移除过期时间
    const clearOptions = omit(this.cookieOptions(UID_COOKIE), ['expires']);

    // 链式调用清除多个 Cookie
    return res
      .clearCookie(UID_COOKIE, clearOptions)
      .clearCookie(ACCESS_TOKEN_COOKIE, clearOptions)
      .clearCookie(REFRESH_TOKEN_COOKIE, clearOptions);
  }

  // 生成唯一的用户名
  async genUniqueUsername(candidate: string) {
    // 初始化用户名为候选名
    let name = candidate;
    // 检查用户名是否已存在
    let userExists = await this.prisma.user.findUnique({ where: { name } });
    // 如果用户名已存在，添加随机后缀直到找到唯一的用户名
    while (userExists) {
      const randomSuffix = randomBytes(3).toString('hex');
      name = `${candidate}_${randomSuffix}`;
      userExists = await this.prisma.user.findUnique({ where: { name } });
    }
    // 返回唯一的用户名
    return name;
  }

  /**
   * 通用 OAuth 逻辑
   * @param accessToken OAuth 访问令牌
   * @param refreshToken OAuth 刷新令牌
   * @param profile OAuth 用户配置文件
   */
  async oauthValidate(accessToken: string, refreshToken: string, profile: Profile) {
    // 记录 OAuth 信息
    this.logger.log(
      `oauth accessToken: ${accessToken}, refreshToken: ${refreshToken}, profile: ${JSON.stringify(
        profile,
      )}`,
    );
    // 从配置文件中解构需要的信息
    const { provider, id, emails, displayName, photos } = profile;

    // 检查是否存在认证账户记录
    const account = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId: id,
        },
      },
    });

    // 如果存在认证账户记录和对应的用户，直接返回
    if (account) {
      this.logger.log(`account found for provider ${provider}, account id: ${id}`);
      const user = await this.prisma.user.findUnique({
        where: {
          uid: account.uid,
        },
      });
      if (user) {
        return user;
      }

      this.logger.log(`user ${account.uid} not found for provider ${provider} account id: ${id}`);
    }

    // OAuth 配置文件没有返回邮箱，这是无效的
    if (emails?.length === 0) {
      this.logger.warn('emails is empty, invalid oauth');
      throw new OAuthError();
    }
    // 获取第一个邮箱
    const email = emails[0].value;

    // 如果该邮箱已注册，返回对应的用户
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      this.logger.log(`user ${user.uid} already registered for email ${email}`);
      return user;
    }

    // 生成用户 ID
    const uid = genUID();
    // 生成唯一的用户名
    const name = await this.genUniqueUsername(email.split('@')[0]);

    // 如果配置文件有照片，下载头像
    let avatar: string;
    try {
      if (photos?.length > 0) {
        avatar = (
          await this.miscService.dumpFileFromURL(
            { uid },
            {
              url: photos[0].value,
              entityId: uid,
              entityType: 'user',
              visibility: 'public',
            },
          )
        ).url;
      }
    } catch (e) {
      this.logger.warn(`failed to download avatar: ${e}`);
    }

    // 创建新用户
    const newUser = await this.prisma.user.create({
      data: {
        name,
        nickname: displayName || name,
        uid,
        email,
        avatar,
        emailVerified: new Date(),
        outputLocale: 'auto',
      },
    });
    this.logger.log(`user created: ${newUser.uid}`);

    // 创建新的认证账户
    const newAccount = await this.prisma.account.create({
      data: {
        type: 'oauth',
        uid: newUser.uid,
        provider,
        providerAccountId: id,
        accessToken: accessToken,
        refreshToken: refreshToken,
      },
    });
    this.logger.log(`new account created for ${newAccount.uid}`);

    // 返回新用户
    return newUser;
  }

  // 邮箱注册方法
  async emailSignup(
    email: string,
    password: string,
  ): Promise<{ tokenData?: TokenData; sessionId?: string }> {
    // 检查邮箱是否已注册
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new EmailAlreadyRegistered();
    }

    // 检查是否跳过验证
    const skipVerification = this.configService.get('auth.skipVerification');
    if (skipVerification) {
      // 生成用户 ID
      const uid = genUID();
      // 生成唯一的用户名
      const name = await this.genUniqueUsername(email.split('@')[0]);
      // 对密码进行哈希处理
      const hashedPassword = await argon2.hash(password);

      // 使用事务创建用户和账户
      const [newUser] = await this.prisma.$transaction([
        this.prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            uid,
            name,
            nickname: name,
            emailVerified: new Date(),
            outputLocale: 'auto',
          },
        }),
        this.prisma.account.create({
          data: {
            type: 'email',
            uid,
            provider: 'email',
            providerAccountId: email,
          },
        }),
      ]);
      // 返回令牌数据
      return { tokenData: await this.login(newUser) };
    }

    // 创建验证会话
    const { sessionId } = await this.createVerification({ email, purpose: 'signup', password });
    // 返回会话 ID
    return { sessionId };
  }

  // 邮箱登录方法
  async emailLogin(email: string, password: string) {
    // 检查邮箱和密码是否为空
    if (!email?.trim() || !password?.trim()) {
      throw new ParamsError('Email and password are required');
    }

    // 查找用户
    const user = await this.prisma.user.findUnique({ where: { email } });
    // 如果用户不存在，抛出账户未找到错误
    if (!user) {
      throw new AccountNotFoundError();
    }

    try {
      // 验证密码
      const isPasswordValid = await argon2.verify(user.password, password);
      // 如果密码无效，抛出密码不正确错误
      if (!isPasswordValid) {
        throw new PasswordIncorrect();
      }
    } catch (error) {
      // 记录密码验证失败的错误
      this.logger.error(`Password verification failed: ${error.message}`);
      // 抛出密码不正确错误
      throw new PasswordIncorrect();
    }

    // 登录用户并返回令牌
    return this.login(user);
  }

  // 创建验证会话
  async createVerification({ email, purpose, password }: CreateVerificationRequest) {
    // 生成会话 ID
    const sessionId = genVerificationSessionID();

    // 生成 6 位验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 如果是重置密码，检查密码是否提供
    if (purpose === 'resetPassword' && !password) {
      throw new ParamsError('Password is required to reset password');
    }

    // 如果提供了密码，对密码进行哈希处理
    let hashedPassword: string;
    if (password) {
      hashedPassword = await argon2.hash(password);
    }

    // 创建验证会话
    const session = await this.prisma.verificationSession.create({
      data: {
        email,
        code,
        purpose,
        sessionId,
        hashedPassword,
        // 设置过期时间为 10 分钟后
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // 添加发送验证邮件的任务
    await this.addSendVerificationEmailJob(sessionId);

    // 返回会话
    return session;
  }

  // 添加发送验证邮件的任务
  async addSendVerificationEmailJob(sessionId: string) {
    // 向队列添加验证邮件任务
    await this.emailQueue.add('verifyEmail', { sessionId });
  }

  // 发送验证邮件
  async sendVerificationEmail(sessionId: string, _session?: VerificationSession) {
    // 如果没有提供会话，从数据库中获取
    let session = _session;
    if (!session) {
      session = await this.prisma.verificationSession.findUnique({ where: { sessionId } });
    }
    // 使用 Resend 发送验证邮件
    await this.resend.emails.send({
      from: this.configService.get('auth.email.sender'),
      to: session.email,
      subject: 'Email Verification Code',
      html: `Your verification code is: ${session.code}`,
    });
  }

  // 检查验证码
  async checkVerification({ sessionId, code }: CheckVerificationRequest) {
    // 查找未过期的验证会话
    const verification = await this.prisma.verificationSession.findUnique({
      where: { sessionId, expiresAt: { gt: new Date() } },
    });

    // 如果验证会话不存在，抛出无效验证会话错误
    if (!verification) {
      throw new InvalidVerificationSession();
    }

    // 如果验证码不匹配，抛出验证码不正确错误
    if (verification.code !== code) {
      throw new IncorrectVerificationCode();
    }

    // 从验证会话中解构需要的信息
    const { purpose, email, hashedPassword } = verification;

    // 声明用户变量
    let user: UserModel;
    // 根据验证目的执行不同的操作
    if (purpose === 'signup') {
      // 如果是注册，创建新用户
      const uid = genUID();
      const name = await this.genUniqueUsername(email.split('@')[0]);
      const [newUser] = await this.prisma.$transaction([
        this.prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            uid,
            name,
            nickname: name,
            emailVerified: new Date(),
            outputLocale: 'auto',
          },
        }),
        this.prisma.account.create({
          data: {
            type: 'email',
            uid,
            provider: 'email',
            providerAccountId: email,
          },
        }),
      ]);
      user = newUser;
    } else if (purpose === 'resetPassword') {
      // 如果是重置密码，更新用户密码
      user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new AccountNotFoundError();
      }
      await this.prisma.user.update({
        where: { email },
        data: { password: hashedPassword },
      });
    } else {
      // 如果验证目的无效，抛出参数错误
      throw new ParamsError(`Invalid verification purpose: ${purpose}`);
    }

    // 登录用户并返回令牌
    return this.login(user);
  }
}
