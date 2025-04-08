// 导入 BullMQ 的 WorkerHost 基类，用于处理队列任务
import { WorkerHost } from '@nestjs/bullmq';

// 导入认证服务
import { AuthService } from '@/auth/auth.service';
// 导入验证邮件队列常量
import { QUEUE_SEND_VERIFICATION_EMAIL } from '@/utils/const';
// 导入 BullMQ 处理器装饰器
import { Processor } from '@nestjs/bullmq';
// 导入 NestJS 日志记录器
import { Logger } from '@nestjs/common';
// 导入 BullMQ 任务类型
import { Job } from 'bullmq';
// 导入验证邮件任务数据接口
import { SendVerificationEmailJobData } from './auth.dto';

// 使用 Processor 装饰器标记该类为验证邮件队列的处理器
@Processor(QUEUE_SEND_VERIFICATION_EMAIL)
// 定义认证处理器类，继承自 WorkerHost
export class AuthProcessor extends WorkerHost {
  // 创建私有的日志记录器实例
  private readonly logger = new Logger(AuthProcessor.name);

  // 构造函数，注入认证服务
  constructor(private authService: AuthService) {
    // 调用父类构造函数
    super();
  }

  // 处理队列任务的方法，接收一个带有验证邮件任务数据的任务对象
  async process(job: Job<SendVerificationEmailJobData>) {
    // 从任务数据中解构出会话ID
    const { sessionId } = job.data;
    try {
      // 记录发送验证邮件的日志
      this.logger.log(`Sending verification email for session ${sessionId}`);
      // 调用认证服务发送验证邮件
      await this.authService.sendVerificationEmail(sessionId);
    } catch (error) {
      // 如果发生错误，记录错误日志
      this.logger.error(error);
    }
  }
}
