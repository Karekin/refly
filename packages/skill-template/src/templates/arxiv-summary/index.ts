// 导入文档处理相关的类
import { Document } from '@langchain/core/documents';
// 导入消息类型，用于AI对话
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

// 导入状态图相关的类，用于构建工作流
import { START, END, StateGraphArgs, StateGraph } from '@langchain/langgraph';
// 导入基础技能类和相关类型
import { BaseSkill, BaseSkillState, SkillRunnableConfig, baseStateGraphArgs } from '../../base';
// 导入schema验证库
import { z } from 'zod';
import {
  Icon,
  SkillInvocationConfig,
  SkillTemplateConfigDefinition,
} from '@refly-packages/openapi-schema';
// 导入文本分割器，用于处理大型文档
import { TokenTextSplitter } from 'langchain/text_splitter';
// 导入LLM链，用于构建处理流程
import { LLMChain } from 'langchain/chains';
// 导入提示模板，用于构建提示词
import { PromptTemplate } from '@langchain/core/prompts';

/**
 * 图状态接口，继承基础技能状态
 * 包含文档和消息列表
 */
interface GraphState extends BaseSkillState {
  documents: Document[]; // 存储处理的文档
  messages: BaseMessage[]; // 存储对话消息
}

// Jina AI的PDF阅读器URL
const READER_URL = 'https://r.jina.ai/';

/**
 * Arxiv论文总结技能类
 * 用于获取和总结Arxiv上的学术论文
 */
export class ArxivSummarySkill extends BaseSkill {
  // 技能名称，用于内部标识
  name = 'arxiv_summary';
  // 显示名称，支持多语言
  displayName = {
    en: 'Arxiv Summary',
    'zh-CN': 'Arxiv 总结',
  };

  // 技能图标
  icon: Icon = { type: 'emoji', value: '📚' };

  // 技能配置模式，定义可配置项
  configSchema: SkillTemplateConfigDefinition = {
    items: [],
  };

  // 调用配置，定义上下文规则
  invocationConfig: SkillInvocationConfig = {
    context: {
      rules: [{ key: 'contentList' }],
    },
  };

  // 技能描述
  description = 'Give a summary of the arxiv content';

  // 输入模式定义，使用zod验证
  schema = z.object({
    query: z.string().describe('The user query'),
  });

  // 图状态定义，包含状态通道和默认值
  graphState: StateGraphArgs<GraphState>['channels'] = {
    ...baseStateGraphArgs,
    documents: {
      reducer: (left?: Document[], right?: Document[]) => (right ? right : left || []),
      default: () => [],
    },
    messages: {
      reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
      default: () => [],
    },
  };

  /**
   * 当URL不是有效的Arxiv链接时的处理函数
   * @param state 当前状态
   * @param config 配置选项
   * @returns 包含消息的对象
   */
  async passThroughGenerate(state: GraphState, config?: SkillRunnableConfig) {
    this.engine.logger.log('---GENERATE---');

    const { query = '' } = state;
    const { locale = 'en', urls = [] } = config?.configurable || {};

    // 获取URL，优先使用查询，否则使用配置中的最后一个URL
    const url = query || urls[urls.length - 1];

    // 创建LLM模型实例
    const llm = this.engine.chatModel({
      temperature: 0.1,
    });

    // 构建系统提示，通知用户URL不是Arxiv链接
    const systemPrompt = `Please directly notify user the url: **${url}** is not an arxiv url in ${locale} language`;
    const response = await llm.invoke([new SystemMessage(systemPrompt)]);

    return { messages: [new AIMessage(response)] };
  }

  /**
   * 检查URL是否为有效的Arxiv链接
   * @param state 当前状态
   * @param config 配置选项
   * @returns 下一步操作的名称
   */
  async checkUrl(state: GraphState, config?: SkillRunnableConfig) {
    this.engine.logger.log('---GENERATE---');

    const { query = '' } = state;
    const { urls = [] } = config?.configurable || {};

    // 检查URL是否有效
    const url = query || urls[urls.length - 1]?.url;
    const isDetailUrl = url.includes('abs') || url.includes('pdf');
    if (!url || !url.startsWith('https://arxiv.org') || !isDetailUrl) {
      return 'passThroughGenerate';
    }

    return 'generate';
  }

  /**
   * 主要生成函数，获取并总结Arxiv论文
   * @param state 当前状态
   * @param config 配置选项
   * @returns 包含总结消息的对象
   */
  async generate(state: GraphState, config?: SkillRunnableConfig) {
    this.engine.logger.log('---GENERATE---');

    const { query = '' } = state;
    const { locale = 'en', urls = [] } = config?.configurable || {};

    const url = query || urls[urls.length - 1]?.url;

    // 检查URL格式并转换为PDF URL
    const pdfUrl = url.includes('abs') ? url.replace('abs', 'pdf') : url;

    // 发送事件通知用户正在获取PDF内容
    this.emitEvent({ event: 'log', content: '获取 pdf 内容中' }, config);

    // 调用远程PDF阅读器API获取内容
    const response = await fetch(READER_URL + pdfUrl, {
      method: 'GET',
      headers: {
        // Authorization: this.config.get('rag.jinaToken')
        //   ? `Bearer ${this.config.get('rag.jinaToken')}`
        //   : undefined,
        Accept: 'application/json',
      },
    });
    if (response.status !== 200) {
      this.emitEvent({ event: 'log', content: '获取 pdf 内容失败' }, config);
      throw new Error(
        `call remote reader failed: ${response.status} ${response.statusText} ${response.text}`,
      );
    }

    // 解析响应数据
    const data = (await response.json()) as {
      data: { title: string; content: string; url: string };
      code: number;
    };
    if (!data) {
      this.emitEvent({ event: 'log', content: '获取 pdf 内容失败' }, config);
      throw new Error(`invalid data from remote reader: ${response.text}`);
    }

    this.emitEvent({ event: 'log', content: '获取 pdf 内容成功' }, config);
    // 将内容添加到知识库中
    if (data?.data?.content?.length > 0) {
      const { user } = config.configurable;
      const websiteUrl = url.includes('abs') ? url : url.replace('pdf', 'abs');

      // 添加到知识库
      try {
        this.emitEvent({ event: 'log', content: '保存到知识库中...' }, config);
        await this.engine.service.createResource(user, {
          resourceType: 'text',
          content: data?.data?.content,
          data: {
            url: websiteUrl,
            title: data?.data?.title,
          },
          title: data?.data?.title,
        });
        this.emitEvent({ event: 'log', content: '保存到知识库成功' }, config);
      } catch (error) {
        this.emitEvent({ event: 'log', content: '保存到知识库失败' }, config);
        this.engine.logger.error('create resource failed', error);
      }
    }

    // 创建LLM模型实例用于总结
    const llm = this.engine.chatModel({
      temperature: 0.5,
    });

    // 创建映射提示模板，用于初步总结每个文档块
    const mapPrompt = new PromptTemplate({
      template: `请用 ${locale} 语言简要总结以下文本的主要内容：
    
    {text}
    
    总结：`,
      inputVariables: ['text'],
    });

    // 创建组合提示模板，用于最终总结
    const combinePrompt = new PromptTemplate({
      template: `You are an AI assistant specializing in summarizing academic papers for first-year university students. Your goal is to provide a clear, concise, and easy-to-understand summary of research papers. Please use the following format to provide a summary in ${locale} language:

# {text}

## Key Points

### Research Question
[What is the main problem or question the paper addresses?]

### Background
[Briefly explain the context and importance of this research]

### Methodology
[Describe the main methods or approaches used in simple terms]

### Key Findings
[What are the most important results or discoveries?]

### Significance
[Explain why these findings are important and their potential impact]

## Simplified Explanation
[Imagine you're explaining this paper to a first-year student. Use analogies or everyday examples to make complex concepts more accessible if possible.]

## Key Terms
[List and briefly define 3-5 important technical terms or concepts from the paper. Keep these terms in their original language.]

Guidelines:
- Summarize in ${locale} language, but keep technical terms, proper nouns, and paper titles in their original language.
- Explain complex ideas in simple terms, avoiding jargon whenever possible.
- If numerical results are mentioned, present them clearly and explain their significance.
- Keep the summary between 300-400 words to ensure readability.

Remember, the goal is to help a first-year student quickly grasp the core ideas and importance of the paper.

Input text:
"""
{text}
"""

Please provide a summary that meets the above requirements with ${locale} language, include summary title`,
      inputVariables: ['text'],
    });

    // 创建结构化输出模型
    const model = this.engine.chatModel({ temperature: 0.1, maxTokens: 100 });

    // 配置模型以生成结构化输出
    const runnable = model.withStructuredOutput(
      z
        .object({
          summary: z.string(),
        })
        .describe(
          'Generate the summary based on these requirements and offer suggestions for the next steps.',
        ),
    );

    // 发送事件通知用户正在处理PDF
    this.emitEvent({ event: 'log', content: '语义处理 pdf 中...' }, config);

    // 创建文本分割器，将大文档分割成小块
    const splitter = new TokenTextSplitter({
      chunkSize: 10000,
      chunkOverlap: 250,
    });
    const splittedDocs = await splitter.createDocuments([data?.data?.content]);

    // 发送事件通知用户正在总结
    this.emitEvent({ event: 'log', content: '总结中...' }, config);

    // 并行处理每个文档块，生成中间总结
    const intermediateResults = await Promise.all(
      splittedDocs.map(async (doc) => {
        const prompt = await mapPrompt.format({ text: doc.pageContent });
        const summaryModelRes = await runnable.invoke([new HumanMessage(prompt)]);
        return summaryModelRes?.summary || '';
      }),
    );
    const combinedText = intermediateResults.join('\n\n');

    // 创建组合链，用于最终总结
    const combineChain = new LLMChain({ llm, prompt: combinePrompt });

    // 执行组合步骤（流式输出）
    const summary = (await combineChain.stream({ text: combinedText })) as any as string;
    console.log('summary', summary);

    // 发送事件通知用户总结成功
    this.emitEvent({ event: 'log', content: '总结成功' }, config);

    // 返回总结消息
    return { messages: [new AIMessage({ content: summary })] };
  }

  /**
   * 将技能转换为可运行对象
   * @returns 编译后的工作流
   */
  toRunnable() {
    // 创建状态图工作流
    const workflow = new StateGraph<GraphState>({
      channels: this.graphState,
    })
      .addNode('generate', this.generate.bind(this))
      .addEdge(START, 'generate')
      .addEdge('generate', END);

    // 编译并返回工作流
    return workflow.compile();
  }
}
