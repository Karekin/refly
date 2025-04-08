// 导入 NestJS 的依赖注入装饰器和日志类
import { Injectable, Logger } from '@nestjs/common';
// 导入 Prisma 服务，用于数据库操作
import { PrismaService } from '@/common/prisma.service';
// 导入用户相关的接口和类型定义
import {
  CheckSettingsFieldData,
  FileVisibility,
  UpdateUserSettingsRequest,
  User,
} from '@refly-packages/openapi-schema';
// 导入 Prisma 生成的订阅模型类型
import { Subscription } from '@prisma/client';
// 导入工具函数，用于从对象中选择特定属性
import { pick } from '@refly-packages/utils';
// 导入订阅服务
import { SubscriptionService } from '@/subscription/subscription.service';
// 导入 Redis 服务，用于处理分布式锁
import { RedisService } from '@/common/redis.service';
// 导入自定义错误类型
import { OperationTooFrequent, ParamsError } from '@refly-packages/errors';
// 导入杂项服务，用于处理文件等功能
import { MiscService } from '@/misc/misc.service';

// 标记为可注入的服务类
@Injectable()
export class UserService {
  // 创建日志记录器实例
  private logger = new Logger(UserService.name);

  // 构造函数，注入所需的服务
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private miscService: MiscService,
    private subscriptionService: SubscriptionService,
  ) {}

  // 获取用户设置的方法
  async getUserSettings(user: User) {
    // 从数据库中查询用户信息
    const userPo = await this.prisma.user.findUnique({
      where: { uid: user.uid },
    });

    // 初始化订阅信息变量
    let subscription: Subscription | null = null;
    // 如果用户有订阅ID，则获取订阅信息
    if (userPo.subscriptionId) {
      subscription = await this.subscriptionService.getSubscription(userPo.subscriptionId);
    }

    // 返回用户信息和订阅信息
    return {
      ...userPo,
      subscription,
    };
  }

  // 更新用户设置的方法
  async updateSettings(user: User, data: UpdateUserSettingsRequest) {
    // 获取分布式锁，防止并发更新
    const lock = await this.redis.acquireLock(`update-user-settings:${user.uid}`);
    // 如果无法获取锁，说明操作太频繁
    if (!lock) {
      throw new OperationTooFrequent('Update user settings too frequent');
    }

    // 获取当前用户数据
    const currentUser = await this.prisma.user.findUnique({
      where: { uid: user.uid },
      select: {
        preferences: true,
        onboarding: true,
      },
    });

    // 处理头像上传
    if (data.avatarStorageKey) {
      // 查找并绑定头像文件
      const avatarFile = await this.miscService.findFileAndBindEntity(data.avatarStorageKey, {
        entityId: user.uid,
        entityType: 'user',
      });
      // 如果文件不存在，抛出错误
      if (!avatarFile) {
        throw new ParamsError('Avatar file not found');
      }
      // 生成头像文件URL
      data.avatar = this.miscService.generateFileURL({
        storageKey: avatarFile.storageKey,
        visibility: avatarFile.visibility as FileVisibility,
      });
    }

    // 解析现有数据，如果不存在则使用空对象作为默认值
    const existingPreferences = currentUser?.preferences ? JSON.parse(currentUser.preferences) : {};
    const existingOnboarding = currentUser?.onboarding ? JSON.parse(currentUser.onboarding) : {};

    // 合并新旧偏好设置数据
    const mergedPreferences = {
      ...existingPreferences,
      ...data.preferences,
    };

    // 合并新旧引导状态数据
    const mergedOnboarding = {
      ...existingOnboarding,
      ...data.onboarding,
    };

    // 更新用户信息
    const updatedUser = await this.prisma.user.update({
      where: { uid: user.uid },
      data: {
        // 更新基本信息字段
        ...pick(data, ['name', 'nickname', 'avatar', 'uiLocale', 'outputLocale']),
        // 更新合并后的偏好设置
        preferences: JSON.stringify(mergedPreferences),
        // 更新合并后的引导状态
        onboarding: JSON.stringify(mergedOnboarding),
      },
    });

    // 返回更新后的用户信息
    return updatedUser;
  }

  // 检查设置字段是否可用的方法
  async checkSettingsField(user: User, param: CheckSettingsFieldData['query']) {
    // 解构参数获取字段名和值
    const { field, value } = param;
    // 查找是否存在其他用户使用相同的字段值
    const otherUser = await this.prisma.user.findFirst({
      where: { [field]: value, uid: { not: user.uid } },
    });
    // 返回检查结果
    return {
      field,
      value,
      // 如果没有其他用户使用该值，则表示可用
      available: !otherUser,
    };
  }
}
