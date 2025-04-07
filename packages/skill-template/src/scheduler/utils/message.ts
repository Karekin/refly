// 导入 LangChain 核心消息类型
import {
  HumanMessage,
  SystemMessage,
  BaseMessage,
  BaseMessageFields,
} from '@langchain/core/messages';
// 导入模型信息类型
import { ModelInfo } from '@refly-packages/openapi-schema';

// 定义技能提示模块接口，包含构建各种提示的方法
export interface SkillPromptModule {
  // 构建系统提示的方法，接收区域设置和是否需要准备上下文参数
  buildSystemPrompt: (locale: string, needPrepareContext: boolean) => string;
  // 构建上下文用户提示的方法，接收上下文和是否需要准备上下文参数
  buildContextUserPrompt: (context: string, needPrepareContext: boolean) => string;
  // 构建用户提示的方法，接收原始查询、优化查询、重写查询和区域设置参数
  buildUserPrompt: ({
    originalQuery,
    optimizedQuery,
    rewrittenQueries,
    locale,
  }: {
    originalQuery: string;
    optimizedQuery: string;
    rewrittenQueries: string[];
    locale: string;
  }) => string;
}

// 定义内容类型接口
// 定义文本内容接口
interface TextContent {
  // 类型为文本
  type: 'text';
  // 文本内容
  text: string;
  // 可选的缓存控制，类型为临时
  cache_control?: { type: 'ephemeral' };
}

// 定义图片URL内容接口
interface ImageUrlContent {
  // 类型为图片URL
  type: 'image_url';
  // 图片URL对象，包含URL属性
  image_url: { url: string };
  // 注意：根据Anthropic文档，我们不为图片内容添加缓存控制
  // 图片作为前缀的一部分被缓存，但没有自己的缓存控制参数
}

// 定义内容项类型，可以是文本内容或图片URL内容
type ContentItem = TextContent | ImageUrlContent;

// 关于最小令牌阈值的注释：
// 不同的Claude模型对缓存有最低要求：
// - 1024个令牌：Claude 3.7 Sonnet、Claude 3.5 Sonnet、Claude 3 Opus
// - 2048个令牌：Claude 3.5 Haiku、Claude 3 Haiku

// 构建最终请求消息的函数
export const buildFinalRequestMessages = ({
  // 提示模块
  module,
  // 区域设置
  locale,
  // 聊天历史
  chatHistory,
  // 消息
  messages,
  // 是否需要准备上下文
  needPrepareContext,
  // 上下文
  context,
  // 图片
  images,
  // 原始查询
  originalQuery,
  // 优化查询
  optimizedQuery,
  // 重写查询
  rewrittenQueries,
  // 模型信息
  modelInfo,
}: {
  module: SkillPromptModule;
  locale: string;
  chatHistory: BaseMessage[];
  messages: BaseMessage[];
  needPrepareContext: boolean;
  context: string;
  images: string[];
  originalQuery: string;
  optimizedQuery: string;
  rewrittenQueries?: string[];
  modelInfo?: ModelInfo;
}) => {
  // 构建系统提示
  const systemPrompt = module.buildSystemPrompt(locale, needPrepareContext);
  // 构建上下文用户提示，如果方法不存在则返回空字符串
  const contextUserPrompt = module.buildContextUserPrompt?.(context, needPrepareContext) || '';
  // 构建用户提示
  const userPrompt = module.buildUserPrompt({
    originalQuery,
    optimizedQuery,
    rewrittenQueries,
    locale,
  });

  // 创建上下文消息
  const contextMessages = contextUserPrompt ? [new HumanMessage(contextUserPrompt)] : [];

  // 准备最终用户消息（有或没有图片）
  const finalUserMessage = images?.length
    ? createHumanMessageWithContent([
        // 创建文本内容
        {
          type: 'text',
          text: userPrompt,
        } as TextContent,
        // 映射图片数组创建图片URL内容
        ...images.map(
          (image) =>
            ({
              type: 'image_url',
              image_url: { url: image },
            }) as ImageUrlContent,
        ),
      ])
    : new HumanMessage(userPrompt);

  // 组装所有消息 - 遵循Anthropic的缓存顺序：工具 -> 系统 -> 消息
  const requestMessages = [
    new SystemMessage(systemPrompt), // 系统消息在我们的实现中排在第一位
    ...chatHistory, // 历史对话
    ...messages, // 附加消息
    ...contextMessages, // 上下文消息
    finalUserMessage, // 实际需要响应的查询（不应被缓存）
  ];

  // 检查是否应启用上下文缓存以及模型是否支持
  const shouldEnableContextCaching = !!modelInfo?.capabilities?.contextCaching;
  if (shouldEnableContextCaching) {
    // 注意：在生产系统中，你可能想要：
    // 1. 根据模型名称估计令牌数
    // 2. 检查是否达到最小令牌阈值
    // 3. 如果低于阈值则跳过缓存

    // 应用上下文缓存
    return applyContextCaching(requestMessages);
  }

  // 返回请求消息
  return requestMessages;
};

/**
 * 应用上下文缓存到消息 - 将除最后一条消息外的所有消息标记为临时
 *
 * 根据Anthropic文档：
 * - 除最后一条消息外的所有消息都应标记为cache_control
 * - 图片包含在缓存中，但没有自己的cache_control参数
 * - 更改提示中是否有图片将破坏缓存
 */
const applyContextCaching = (messages: BaseMessage[]): BaseMessage[] => {
  // 如果消息数量小于等于1，直接返回消息
  if (messages.length <= 1) return messages;

  // 映射消息数组
  return messages.map((message, index) => {
    // 不缓存最后一条消息（最终用户查询）
    if (index === messages.length - 1) return message;

    // 为所有其他消息应用缓存
    if (message instanceof SystemMessage) {
      // 处理系统消息
      return new SystemMessage({
        content: [
          {
            type: 'text',
            // 如果内容是字符串则直接使用，否则转换为JSON字符串
            text:
              typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content),
            // 添加临时缓存控制
            cache_control: { type: 'ephemeral' },
          },
        ],
      } as BaseMessageFields);
    }

    if (message instanceof HumanMessage) {
      // 处理人类消息
      if (typeof message.content === 'string') {
        // 如果内容是字符串
        return new HumanMessage({
          content: [
            {
              type: 'text',
              text: message.content,
              // 添加临时缓存控制
              cache_control: { type: 'ephemeral' },
            },
          ],
        } as BaseMessageFields);
      }

      if (Array.isArray(message.content)) {
        // 处理数组内容（如混合了图片和文本）
        // 根据Anthropic文档，我们只为文本块应用cache_control，
        // 但图片仍包含在缓存内容中
        const updatedContent = message.content.map((item: any) => {
          if (item.type === 'text') {
            // 为文本内容添加临时缓存控制
            return {
              ...item,
              cache_control: { type: 'ephemeral' },
            };
          }
          // 对于图片内容，我们不添加cache_control
          return item;
        });

        // 创建新的人类消息
        return new HumanMessage({
          content: updatedContent,
        } as BaseMessageFields);
      }
    }

    // 如果无法应用缓存，返回原始消息
    return message;
  });
};

/**
 * 创建带有数组内容的人类消息
 */
const createHumanMessageWithContent = (contentItems: ContentItem[]): HumanMessage => {
  // 创建并返回新的人类消息
  return new HumanMessage({ content: contentItems } as BaseMessageFields);
};
