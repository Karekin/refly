// 导入 LangChain 核心可运行对象接口
import { Runnable } from '@langchain/core/runnables';
// 导入工具参数接口
import { ToolParams } from '@langchain/core/tools';
// 导入基础消息类型
import { BaseMessage } from '@langchain/core/messages';
// 导入技能引擎
import { SkillEngine } from './engine';
// 导入结构化工具类
import { StructuredTool } from '@langchain/core/tools';
// 导入状态图参数类型
import { StateGraphArgs } from '@langchain/langgraph';
// 导入可运行配置类型
import { RunnableConfig } from '@langchain/core/runnables';
// 导入工具运行回调管理器
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager';
// 导入各种技能相关的接口和类型
import {
  SkillContext,
  SkillInput,
  SkillTemplateConfigDefinition,
  SkillInvocationConfig,
  SkillMeta,
  User,
  SkillEvent,
  SkillRuntimeConfig,
  SkillTemplateConfig,
  Icon,
  Artifact,
  ActionStepMeta,
  ModelInfo,
} from '@refly-packages/openapi-schema';
// 导入事件发射器
import { EventEmitter } from 'node:stream';

// 定义基础技能抽象类，继承自结构化工具
export abstract class BaseSkill extends StructuredTool {
  /**
   * 技能模板图标
   */
  icon: Icon = { type: 'emoji', value: '🔧' };
  /**
   * 技能占位符
   */
  placeholder = '🔧';
  /**
   * 技能模板配置模式
   */
  abstract configSchema: SkillTemplateConfigDefinition;
  /**
   * 技能调用配置
   */
  abstract invocationConfig: SkillInvocationConfig;
  /**
   * LangGraph 状态定义
   */
  abstract graphState: StateGraphArgs<BaseSkillState>['channels'];

  // 构造函数
  constructor(
    // 技能引擎实例
    public engine: SkillEngine,
    // 受保护的基础工具参数
    protected params?: BaseToolParams,
  ) {
    // 调用父类构造函数
    super(params);
  }

  /**
   * 将此技能转换为 LangChain 可运行对象
   */
  abstract toRunnable(): Runnable;

  /**
   * 发送技能事件
   */
  emitEvent(data: Partial<SkillEvent>, config: SkillRunnableConfig) {
    // 从配置中获取事件发射器
    const { emitter } = config?.configurable || {};

    // 如果没有事件发射器，则直接返回
    if (!emitter) {
      return;
    }

    // 创建事件数据对象
    const eventData: SkillEvent = {
      event: data.event,
      step: config.metadata?.step,
      ...data,
    };

    // 如果没有指定事件类型，则根据数据内容自动确定
    if (!eventData.event) {
      if (eventData.log) {
        eventData.event = 'log';
      } else if (eventData.tokenUsage) {
        eventData.event = 'token_usage';
      } else if (eventData.structuredData) {
        eventData.event = 'structured_data';
      } else if (eventData.artifact) {
        eventData.event = 'artifact';
      }
    }

    // 发送事件
    emitter.emit(eventData.event, eventData);
  }

  /**
   * 分块发送大量数据事件，避免事件系统过载
   * @param data 要发送的数据
   * @param config 技能可运行配置
   * @param options 分块和延迟选项
   */
  async emitLargeDataEvent<T>(
    data: {
      // 事件类型
      event?: string;
      // 数据数组
      data: T[];
      // 构建事件数据的函数
      buildEventData: (
        chunk: T[],
        meta: { isPartial: boolean; chunkIndex: number; totalChunks: number },
      ) => Partial<SkillEvent>;
    },
    config: SkillRunnableConfig,
    options: {
      // 最大分块大小
      maxChunkSize?: number;
      // 分块之间的延迟时间（毫秒）
      delayBetweenChunks?: number;
    } = {},
  ): Promise<void> {
    // 设置默认选项值
    const { maxChunkSize = 500, delayBetweenChunks = 10 } = options;

    // 如果没有数据或事件发射器，则提前返回
    if (!data.data?.length || !config?.configurable?.emitter) {
      return;
    }

    // 根据大小将数据分割成块
    const chunks: T[][] = [];
    let currentChunk: T[] = [];
    let currentSize = 0;

    // 遍历数据项
    for (const item of data.data) {
      // 计算项目大小
      const itemSize = JSON.stringify(item).length;

      // 如果当前块加上新项目会超过最大大小，则开始新块
      if (currentSize + itemSize > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      // 将项目添加到当前块
      currentChunk.push(item);
      currentSize += itemSize;
    }

    // 如果最后一个块不为空，则添加它
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    // 带延迟地发送块
    const emitPromises = chunks.map(
      (chunk, i) =>
        new Promise<void>((resolve) => {
          // 设置延迟发送
          setTimeout(() => {
            // 构建事件数据
            const eventData = data.buildEventData(chunk, {
              isPartial: i < chunks.length - 1,
              chunkIndex: i,
              totalChunks: chunks.length,
            });
            // 发送事件
            this.emitEvent(eventData, config);
            // 解析 Promise
            resolve();
          }, i * delayBetweenChunks);
        }),
    );

    // 等待所有发送完成
    await Promise.all(emitPromises);
  }

  // 工具调用方法
  async _call(
    // 输入数据
    input: typeof this.graphState,
    // 运行管理器
    _runManager?: CallbackManagerForToolRun,
    // 配置选项
    config?: SkillRunnableConfig,
  ): Promise<string> {
    // 检查配置是否存在
    if (!config) {
      throw new Error('skill config is required');
    }

    // 使用当前技能配置配置引擎
    this.engine.configure(config);

    // 确保 currentSkill 不为空
    config.configurable.currentSkill ??= {
      name: this.name,
      icon: this.icon,
    };

    // 调用可运行对象并获取响应
    const response = await this.toRunnable().invoke(input, {
      ...config,
      metadata: {
        ...config.metadata,
        ...config.configurable.currentSkill,
        resultId: config.configurable.resultId,
      },
    });

    // 返回响应
    return response;
  }
}

// 定义基础工具参数接口，扩展自工具参数
export interface BaseToolParams extends ToolParams {
  // 技能引擎
  engine: SkillEngine;
}

// 定义基础技能状态接口，扩展自技能输入
export interface BaseSkillState extends SkillInput {
  // 消息列表
  messages: BaseMessage[];
}

// 定义基础状态图参数
export const baseStateGraphArgs = {
  // 消息通道
  messages: {
    // 消息合并函数
    reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
    // 默认值函数
    default: () => [],
  },
  // 查询通道
  query: {
    // 查询合并函数
    reducer: (left: string, right: string) => (right ? right : left || ''),
    // 默认值函数
    default: () => '',
  },
  // 图片通道
  images: {
    // 图片合并函数
    reducer: (x: string[], y: string[]) => x.concat(y),
    // 默认值函数
    default: () => [],
  },
  // 语言环境通道
  locale: {
    // 语言环境合并函数
    reducer: (left?: string, right?: string) => (right ? right : left || 'en'),
    // 默认值函数
    default: () => 'en',
  },
};

// 定义技能事件映射接口
export interface SkillEventMap {
  // 开始事件
  start: [data: SkillEvent];
  // 结束事件
  end: [data: SkillEvent];
  // 日志事件
  log: [data: SkillEvent];
  // 流事件
  stream: [data: SkillEvent];
  // 创建节点事件
  create_node: [data: SkillEvent];
  // 工件事件
  artifact: [data: SkillEvent];
  // 结构化数据事件
  structured_data: [data: SkillEvent];
  // 令牌使用事件
  token_usage: [data: SkillEvent];
  // 错误事件
  error: [data: SkillEvent];
}

// 定义技能可运行元数据接口，扩展自记录和技能元数据
export interface SkillRunnableMeta extends Record<string, unknown>, SkillMeta {
  // 步骤元数据
  step?: ActionStepMeta;
  // 工件
  artifact?: Artifact;
  // 是否抑制输出
  suppressOutput?: boolean;
}

// 定义技能可运行配置接口，扩展自可运行配置
export interface SkillRunnableConfig extends RunnableConfig {
  // 可配置项
  configurable?: SkillContext & {
    // 用户
    user: User;
    // 结果 ID
    resultId?: string;
    // 画布 ID
    canvasId?: string;
    // 语言环境
    locale?: string;
    // UI 语言环境
    uiLocale?: string;
    // 模型信息
    modelInfo?: ModelInfo;
    // 当前技能
    currentSkill?: SkillMeta;
    // 当前步骤
    currentStep?: ActionStepMeta;
    // 聊天历史
    chatHistory?: BaseMessage[];
    // 模板配置
    tplConfig?: SkillTemplateConfig;
    // 运行时配置
    runtimeConfig?: SkillRuntimeConfig;
    // 事件发射器
    emitter?: EventEmitter<SkillEventMap>;
  };
  // 元数据
  metadata?: SkillRunnableMeta;
}
