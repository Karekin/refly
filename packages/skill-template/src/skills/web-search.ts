// 导入 LangGraph 相关组件，用于构建状态图工作流
import { START, END, StateGraphArgs, StateGraph } from '@langchain/langgraph';
// 导入 zod 库，用于数据验证和类型定义
import { z } from 'zod';
// 导入 Runnable 和 RunnableConfig 类型，用于定义可运行的组件
import { Runnable, RunnableConfig } from '@langchain/core/runnables';
// 导入基础技能相关类型和组件
import { BaseSkill, BaseSkillState, SkillRunnableConfig, baseStateGraphArgs } from '../base';
// 导入 OpenAPI 架构中定义的图标、技能调用配置和技能模板配置定义
import {
  Icon,
  SkillInvocationConfig,
  SkillTemplateConfigDefinition,
} from '@refly-packages/openapi-schema';
// 导入图状态类型
import { GraphState } from '../scheduler/types';

// utils
// 导入构建最终请求消息的工具函数
import { buildFinalRequestMessages } from '../scheduler/utils/message';
// 导入准备上下文的工具函数
import { prepareContext } from '../scheduler/utils/context';
// prompts
// 导入网络搜索相关的提示模板
import * as webSearch from '../scheduler/module/webSearch/index';
// 导入截断源的工具函数
import { truncateSource } from '../scheduler/utils/truncator';
// 导入处理查询的工具函数
import { processQuery } from '../scheduler/utils/queryProcessor';
// 导入提取和爬取 URL 的工具函数
import { extractAndCrawlUrls } from '../scheduler/utils/extract-weblink';
// 导入安全 JSON 字符串化工具
import { safeStringifyJSON } from '@refly-packages/utils';
// 导入处理上下文 URL 的工具函数
import { processContextUrls } from '../utils/url-processing';

// 定义 WebSearch 类，继承自 BaseSkill
export class WebSearch extends BaseSkill {
  // 设置技能名称
  name = 'webSearch';

  // 设置技能图标，使用表情符号 🌐
  icon: Icon = { type: 'emoji', value: '🌐' };

  // 定义技能配置模式，包含深度搜索开关
  configSchema: SkillTemplateConfigDefinition = {
    items: [
      {
        // 配置项键名
        key: 'enableDeepReasonWebSearch',
        // 输入模式为开关
        inputMode: 'switch',
        // 默认值为 false
        defaultValue: false,
        // 多语言标签
        labelDict: {
          en: 'Enable Deep Search',
          'zh-CN': '启用深度搜索',
        },
        // 多语言描述
        descriptionDict: {
          en: 'Enable deep search for more comprehensive results',
          'zh-CN': '启用深度搜索以获取更全面的结果',
        },
      },
    ],
  };

  // 设置技能调用配置，这里为空对象
  invocationConfig: SkillInvocationConfig = {};

  // 设置技能描述
  description = 'Search the web and provide answers based on search results';

  // 定义输入模式，使用 zod 验证
  schema = z.object({
    // 可选的查询字符串
    query: z.string().optional().describe('The search query'),
    // 可选的图片数组
    images: z.array(z.string()).optional().describe('The images to be read by the skill'),
  });

  // 定义图状态，使用基础状态图参数
  graphState: StateGraphArgs<BaseSkillState>['channels'] = {
    ...baseStateGraphArgs,
  };

  // 定义网络搜索调用方法
  callWebSearch = async (
    // 当前状态
    state: GraphState,
    // 技能运行配置
    config: SkillRunnableConfig,
  ): Promise<Partial<GraphState>> => {
    // 从状态中解构消息和图片
    const { messages = [], images = [] } = state;
    // 从配置中解构区域设置和当前技能
    const { locale = 'en', currentSkill } = config.configurable;
    // 设置当前步骤为分析查询
    config.metadata.step = { name: 'analyzeQuery' };

    // 强制启用网络搜索并禁用知识库搜索
    config.configurable.tplConfig = {
      ...config.configurable.tplConfig,
      enableWebSearch: { value: true, label: 'Web Search', displayValue: 'true' },
      enableKnowledgeBaseSearch: {
        value: false,
        label: 'Knowledge Base Search',
        displayValue: 'false',
      },
    };

    // 使用共享查询处理器
    const {
      // 优化后的查询
      optimizedQuery,
      // 原始查询
      query,
      // 使用的聊天历史
      usedChatHistory,
      // 剩余令牌数
      remainingTokens,
      // 提到的上下文
      mentionedContext,
      // 重写的查询
      rewrittenQueries,
    } = await processQuery({
      config,
      ctxThis: this,
      state,
    });

    // 从查询中提取 URL 并使用优化的并发处理进行爬取
    const { sources: queryUrlSources, analysis } = await extractAndCrawlUrls(query, config, this, {
      concurrencyLimit: 5, // 增加并发 URL 爬取限制
      batchSize: 8, // 增加 URL 处理的批处理大小
    });

    // 记录 URL 提取分析
    this.engine.logger.log(`URL extraction analysis: ${safeStringifyJSON(analysis)}`);
    // 记录提取的查询 URL 源数量
    this.engine.logger.log(`Extracted query URL sources count: ${queryUrlSources.length}`);

    // 处理前端上下文中的 URL（如果有）
    const contextUrls = config.configurable?.urls || [];
    // 处理上下文 URL
    const contextUrlSources = await processContextUrls(contextUrls, config, this);

    // 如果有上下文 URL 源，记录日志
    if (contextUrlSources.length > 0) {
      this.engine.logger.log(`Added ${contextUrlSources.length} URL sources from context`);
    }

    // 合并来自上下文和查询提取的 URL 源
    const urlSources = [...contextUrlSources, ...(queryUrlSources || [])];
    // 记录合并后的 URL 源总数
    this.engine.logger.log(`Total combined URL sources: ${urlSources.length}`);

    // 设置当前步骤为网络搜索
    config.metadata.step = { name: 'webSearch' };

    // 准备以网络搜索为重点的上下文
    const { contextStr, sources } = await prepareContext(
      {
        // 优化后的查询
        query: optimizedQuery,
        // 提到的上下文
        mentionedContext,
        // 最大令牌数
        maxTokens: remainingTokens,
        // 启用提到的上下文
        enableMentionedContext: true,
        // 重写的查询
        rewrittenQueries,
        // 使用合并的 URL 源
        urlSources,
      },
      {
        // 配置
        config,
        // 上下文 this
        ctxThis: this,
        // 状态
        state,
        // 模板配置
        tplConfig: config.configurable.tplConfig,
      },
    );

    // 设置当前步骤为回答问题
    config.metadata.step = { name: 'answerQuestion' };

    // 为模型构建消息
    const module = {
      // 构建系统提示
      buildSystemPrompt: webSearch.buildWebSearchSystemPrompt,
      // 构建上下文用户提示
      buildContextUserPrompt: webSearch.buildWebSearchContextUserPrompt,
      // 构建用户提示
      buildUserPrompt: webSearch.buildWebSearchUserPrompt,
    };

    // 记录上下文准备成功
    this.engine.logger.log('Prepared context successfully!');

    // 如果有源，处理并发送
    if (sources?.length > 0) {
      // 根据大小将源拆分为较小的块，并单独发送
      const truncatedSources = truncateSource(sources);
      // 发送大型数据事件
      await this.emitLargeDataEvent(
        {
          // 数据
          data: truncatedSources,
          // 构建事件数据
          buildEventData: (chunk, { isPartial, chunkIndex, totalChunks }) => ({
            structuredData: {
              // 在这里构建事件数据
              sources: chunk,
              isPartial,
              chunkIndex,
              totalChunks,
            },
          }),
        },
        config,
      );
    }

    // 在所有块发送后，继续构建请求消息
    const requestMessages = buildFinalRequestMessages({
      // 模块
      module,
      // 区域设置
      locale,
      // 聊天历史
      chatHistory: usedChatHistory,
      // 消息
      messages,
      // 需要准备上下文
      needPrepareContext: true,
      // 上下文
      context: contextStr,
      // 图片
      images,
      // 原始查询
      originalQuery: query,
      // 优化后的查询
      optimizedQuery,
      // 重写的查询
      rewrittenQueries,
      // 模型信息
      modelInfo: config?.configurable?.modelInfo,
    });

    // 使用模型生成答案
    const model = this.engine.chatModel({ temperature: 0.1 });
    // 调用模型获取响应消息
    const responseMessage = await model.invoke(requestMessages, {
      ...config,
      metadata: {
        ...config.metadata,
        ...currentSkill,
      },
    });

    // this.engine.logger.log(`Response message: ${safeStringifyJSON(responseMessage)}`);

    // 返回包含响应消息的状态
    return { messages: [responseMessage] };
  };

  // 将技能转换为可运行对象
  toRunnable(): Runnable<any, any, RunnableConfig> {
    // 创建新的状态图
    const workflow = new StateGraph<BaseSkillState>({
      // 使用图状态通道
      channels: this.graphState,
      // 添加网络搜索节点
    }).addNode('webSearch', this.callWebSearch);

    // 添加从开始到网络搜索的边
    workflow.addEdge(START, 'webSearch');
    // 添加从网络搜索到结束的边
    workflow.addEdge('webSearch', END);

    // 编译并返回工作流
    return workflow.compile();
  }
}
