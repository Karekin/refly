// 导入文档处理相关的类
import { Document } from '@langchain/core/documents';
// 导入消息类型，用于AI对话
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

// 导入状态图相关的类，用于构建工作流
import { START, END, StateGraphArgs, StateGraph } from '@langchain/langgraph';
// 导入基础技能类和相关类型
import { BaseSkill, BaseSkillState, SkillRunnableConfig, baseStateGraphArgs } from '../../base';
// 导入schema验证库
import { z } from 'zod';
// 导入技能调用配置和模板配置定义接口
import {
  SkillInvocationConfig,
  SkillTemplateConfigDefinition,
} from '@refly-packages/openapi-schema';

// 定义图状态接口，继承基础技能状态
// 包含文档和消息列表
interface GraphState extends BaseSkillState {
  // 存储处理的文档
  documents: Document[];
  // 存储对话消息
  messages: BaseMessage[];
}

// 定义一个新的图

// 基础总结技能类
// 用于对给定内容进行总结
export class BasicSummarySkill extends BaseSkill {
  // 技能名称，用于内部标识
  name = 'basic_summary';
  // 显示名称，支持多语言
  displayName = {
    en: 'Basic Summary',
    'zh-CN': '基础总结',
  };

  // 技能配置模式，定义可配置项
  configSchema: SkillTemplateConfigDefinition = {
    items: [],
  };

  // 调用配置，定义上下文规则
  // 设置互斥关系和资源限制
  invocationConfig: SkillInvocationConfig = {
    context: {
      // 设置关系为互斥，表示只能使用一种上下文来源
      relation: 'mutuallyExclusive',
      // 定义规则列表
      rules: [
        // 限制资源数量为1
        { key: 'resources', limit: 1 },
        // 限制文档数量为1
        { key: 'documents', limit: 1 },
        {
          // 内容列表限制为1
          key: 'contentList',
          limit: 1,
          // 设置首选选择键，按优先级排序
          preferredSelectionKeys: [
            'resourceSelection',
            'documentSelection',
            'extensionWeblinkSelection',
          ],
        },
      ],
    },
  };

  // 技能描述
  description = 'Give a summary of the given context';

  // 输入模式定义，使用zod验证
  schema = z.object({
    // 定义查询字段为字符串类型
    query: z.string().describe('The user query'),
  });

  // 图状态定义，包含状态通道和默认值
  graphState: StateGraphArgs<GraphState>['channels'] = {
    // 继承基础状态图参数
    ...baseStateGraphArgs,
    // 定义文档通道
    documents: {
      // 定义reducer函数，用于合并状态
      reducer: (left?: Document[], right?: Document[]) => (right ? right : left || []),
      // 设置默认值为空数组
      default: () => [],
    },
    // 定义消息通道
    messages: {
      // 定义reducer函数，用于合并消息
      reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
      // 设置默认值为空数组
      default: () => [],
    },
  };

  // 生成函数，处理总结逻辑
  // 参数_为当前状态，config为配置选项
  async generate(_: GraphState, config?: SkillRunnableConfig) {
    // 记录日志
    this.engine.logger.log('---GENERATE---');

    // 从配置中解构需要的参数，并设置默认值
    const {
      // 语言设置，默认为英语
      locale = 'en',
      // 上下文文档，默认为空数组
      documents: contextDocuments = [],
      // 资源列表，默认为空数组
      resources = [],
      // 内容列表，默认为空数组
      contentList = [],
    } = config?.configurable || {};

    // 初始化内容文本变量
    let contentListText = '';
    // 优先使用资源内容
    if (resources?.length > 0) {
      contentListText = resources[0].resource?.content;
    }
    // 其次使用文档内容
    else if (contextDocuments?.length > 0) {
      contentListText = contextDocuments[0].document?.content;
    }
    // 最后使用内容列表
    else if (contentList?.length > 0) {
      // 将内容列表格式化为编号列表
      contentListText = contentList
        .map((item, index) => `${index + 1}. ${item.content}`)
        .join('\n\n');
    }

    // 创建LLM模型实例
    const llm = this.engine.chatModel({
      // 设置温度为0.9，增加创造性
      temperature: 0.9,
      // 设置最大令牌数为1024
      maxTokens: 1024,
    });

    // 传递上下文文本给LLM
    // 定义系统提示词
    const systemPrompt = `# Role
You are a web content digester who focuses on quickly understanding and organizing the main content of web pages to provide users with streamlined and accurate summaries.

## Skill
### Skill 1: Web page summary
- Extract the topic and main ideas of the web page.
- Provide a concise, summary description that allows users to quickly understand the theme and main points of the entire web page.

### Skill 2: Web page summary
- Generate concise summaries based on extracted information.

### Skill 3: Extracting key points from web pages
- Identify the main paragraphs and key points of the web page.
- List the main ideas of each important section, providing a clear list of bullet points.

## Constraints
- Only handle issues related to web content.
- Always provide an accurate summary of web content.
- When reporting the key points of each web page, strive to be concise and clear.
- The summaries, summaries, and key points generated should help users quickly understand the web page content.
- Responding in a language that the user can understand.
- Unable to handle articles exceeding a certain length.
- Using Markdown format for returns

## Examples

with locale: zh-CN (the content include in =====\n{summary}\n=====)
> please output content in given locale language, include title, summary and key points

### 总结
AgentKit 是一个直观的大型语言模型（LLM）提示框架，用于构建多功能智能体的思考过程，以解决复杂任务。

### 摘要
AgentKit 是一个直观的大型语言模型（LLM）提示框架，用于多功能智能体，通过从简单的自然语言提示中明确构建复杂的 "思考过程"。AgentKit 的设计目标是使用简单的自然语言提示来构建复杂的思考过程，以帮助用户解决复杂的任务。AgentKit 的特点是直观易用，可以帮助用户快速构建 LLM 智能体的思考过程。

### 要点
- AgentKit 是一个用于构建 LLM 智能体的思考过程的框架。
  - 支持使用简单的自然语言提示来构建复杂的思考过程。
  - 可以帮助用户解决复杂的任务。
- AgentKit 的设计目标是直观易用。
  - 提供了一个直观的界面，使用户可以快速构建 LLM 智能体的思考过程。
  - 可以帮助用户更好地理解 LLM 智能体的工作原理。
- AgentKit 适用于解决复杂任务。
  - 可以帮助用户构建 LLM 智能体的思考过程，以解决复杂的任务。
  - 可以帮助用户更好地理解 LLM 智能体的工作原理，以更好地解决复杂的任务。
...

## CONTEXT 

The content to be summarized is as follows:(with three "---" as separator, **only include the content between the separator, not include the separator**):

---

{context}

---
`;

    // 获取上下文字符串，如果为空则使用空字符串
    const contextString = contentListText || '';

    // 替换提示词中的上下文占位符
    const prompt = systemPrompt.replace('{context}', contextString);
    // 调用LLM生成响应
    const responseMessage = await llm.invoke([
      // 传入系统提示
      new SystemMessage(prompt),
      // 传入用户提示，要求生成指定语言的总结
      new HumanMessage(`Please generate a summary based on the **CONTEXT** in ${locale} language:`),
    ]);

    // 返回包含响应消息的对象
    return { messages: [responseMessage] };
  }

  // 将技能转换为可运行对象
  toRunnable() {
    // 创建状态图工作流
    const workflow = new StateGraph<GraphState>({
      // 设置通道
      channels: this.graphState,
    })
      // 添加生成节点
      .addNode('generate', this.generate.bind(this))
      // 添加从开始到生成节点的边
      .addEdge(START, 'generate')
      // 添加从生成节点到结束的边
      .addEdge('generate', END);

    // 编译并返回工作流
    return workflow.compile();
  }
}
