// 导入用户设置接口定义
import { UserSettings } from '@refly-packages/openapi-schema';
// 导入 Prisma 生成的用户和订阅模型类型
import { User as UserModel, Subscription as SubscriptionModel } from '@prisma/client';
// 导入工具函数 pick，用于从对象中选择特定属性
import { pick } from '@refly-packages/utils';
// 导入订阅数据转换函数
import { subscriptionPO2DTO } from '@/subscription/subscription.dto';

// 定义用户持久化对象(PO)转换为用户设置(DTO)的函数
export const userPO2Settings = (
  // 参数类型为用户模型和订阅信息的联合类型
  user: UserModel & { subscription: SubscriptionModel },
  // 返回类型为 UserSettings
): UserSettings => {
  return {
    // 使用 pick 函数选择用户对象中的指定字段
    ...pick(user, [
      // 用户唯一标识符
      'uid',
      // 用户头像
      'avatar',
      // 用户名
      'name',
      // 用户昵称
      'nickname',
      // 用户邮箱
      'email',
      // 用户界面语言设置
      'uiLocale',
      // 输出语言设置
      'outputLocale',
      // 客户ID
      'customerId',
      // 是否有beta访问权限
      'hasBetaAccess',
    ]),
    // 解析用户偏好设置，如果为空则返回空对象
    preferences: JSON.parse(user.preferences ?? '{}'),
    // 解析用户引导状态，如果为空则返回空对象
    onboarding: JSON.parse(user.onboarding ?? '{}'),
    // 转换订阅信息，如果存在则转换为DTO格式，否则返回null
    subscription: user.subscription ? subscriptionPO2DTO(user.subscription) : null,
  };
};
