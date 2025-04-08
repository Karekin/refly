// 定义令牌数据接口，用于存储用户认证相关的令牌信息
export interface TokenData {
  // 用户唯一标识符
  uid: string;
  // 访问令牌，用于验证用户身份和授权访问
  accessToken: string;
  // 刷新令牌，用于获取新的访问令牌
  refreshToken: string;
}

// 定义发送验证邮件任务数据接口，用于邮件验证流程
export interface SendVerificationEmailJobData {
  // 会话ID，用于标识特定的验证邮件发送任务
  sessionId: string;
}

// 定义JWT载荷类，包含JWT令牌中需要携带的用户信息
export class JwtPayload {
  // 用户唯一标识符
  uid: string;
  // 用户邮箱地址
  email: string;
}
