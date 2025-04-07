// 导入基础语言模型输入类型
import { BaseLanguageModelInput } from '@langchain/core/language_models/base';
// 导入基础消息类型
import { BaseMessage } from '@langchain/core/messages';
// 导入可运行接口
import { Runnable } from '@langchain/core/runnables';
// 导入获取环境变量的工具函数
import { getEnvironmentVariable } from '@langchain/core/utils/env';
// 导入 OpenAI 相关类型和类
import {
  ChatOpenAI,
  ChatOpenAICallOptions,
  ChatOpenAIFields,
  ChatOpenAIStructuredOutputMethodOptions,
  OpenAIClient,
} from '@langchain/openai';
// 导入 zod 库用于类型验证
import { z } from 'zod';
// 导入最大输出令牌数常量
import { MAX_OUTPUT_TOKENS_LEVEL0 } from '../scheduler/utils/constants';

// 定义 ChatDeepSeek 调用选项接口，继承自 ChatOpenAI 调用选项
export interface ChatDeepSeekCallOptions extends ChatOpenAICallOptions {
  // 可选的请求头
  headers?: Record<string, string>;
}

// 定义 ChatDeepSeek 输入接口，继承自 ChatOpenAI 字段
export interface ChatDeepSeekInput extends ChatOpenAIFields {
  /**
   * The Deepseek API key to use for requests.
   * @default process.env.DEEPSEEK_API_KEY
   */
  // Deepseek API 密钥，用于请求
  apiKey?: string;
  /**
   * The name of the model to use.
   */
  // 要使用的模型名称
  model?: string;
  /**
   * Up to 4 sequences where the API will stop generating further tokens. The
   * returned text will not contain the stop sequence.
   * Alias for `stopSequences`
   */
  // 最多 4 个序列，API 将在这些序列处停止生成更多的令牌
  // 返回的文本不会包含停止序列
  // 是 `stopSequences` 的别名
  stop?: Array<string>;
  /**
   * Up to 4 sequences where the API will stop generating further tokens. The
   * returned text will not contain the stop sequence.
   */
  // 最多 4 个序列，API 将在这些序列处停止生成更多的令牌
  // 返回的文本不会包含停止序列
  stopSequences?: Array<string>;
  /**
   * Whether or not to stream responses.
   */
  // 是否流式传输响应
  streaming?: boolean;
  /**
   * The temperature to use for sampling.
   */
  // 用于采样的温度参数
  temperature?: number;
  /**
   * The maximum number of tokens that the model can process in a single response.
   * This limits ensures computational efficiency and resource management.
   */
  // 模型在单个响应中可以处理的最大令牌数
  // 此限制确保计算效率和资源管理
  maxTokens?: number;
  /**
   * Whether to include reasoning content in the response.
   */
  // 是否在响应中包含推理内容
  include_reasoning?: boolean;
}

/**
 * Deepseek chat model integration.
 *
 * The Deepseek API is compatible to the OpenAI API with some limitations.
 *
 * Setup:
 * Install `@langchain/deepseek` and set an environment variable named `DEEPSEEK_API_KEY`.
 *
 * ```bash
 * npm install @langchain/deepseek
 * export DEEPSEEK_API_KEY="your-api-key"
 * ```
 *
 * ## [Constructor args](https://api.js.langchain.com/classes/_langchain_deepseek.ChatDeepSeek.html#constructor)
 *
 * ## [Runtime args](https://api.js.langchain.com/interfaces/_langchain_deepseek.ChatDeepSeekCallOptions.html)
 *
 * Runtime args can be passed as the second argument to any of the base runnable methods `.invoke`. `.stream`, `.batch`, etc.
 * They can also be passed via `.bind`, or the second arg in `.bindTools`, like shown in the examples below:
 *
 * ```typescript
 * // When calling `.bind`, call options should be passed via the first argument
 * const llmWithArgsBound = llm.bind({
 *   stop: ["\n"],
 *   tools: [...],
 * });
 *
 * // When calling `.bindTools`, call options should be passed via the second argument
 * const llmWithTools = llm.bindTools(
 *   [...],
 *   {
 *     tool_choice: "auto",
 *   }
 * );
 * ```
 *
 * ## Examples
 *
 * <details open>
 * <summary><strong>Instantiate</strong></summary>
 *
 * ```typescript
 * import { ChatDeepSeek } from '@langchain/deepseek';
 *
 * const llm = new ChatDeepSeek({
 *   model: "deepseek-reasoner",
 *   temperature: 0,
 *   // other params...
 * });
 * ```
 * </details>
 *
 * <br />
 *
 * <details>
 * <summary><strong>Invoking</strong></summary>
 *
 * ```typescript
 * const input = `Translate "I love programming" into French.`;
 *
 * // Models also accept a list of chat messages or a formatted prompt
 * const result = await llm.invoke(input);
 * console.log(result);
 * ```
 *
 * ```txt
 * AIMessage {
 *   "content": "The French translation of \"I love programming\" is \"J'aime programmer\". In this sentence, \"J'aime\" is the first person singular conjugation of the French verb \"aimer\" which means \"to love\", and \"programmer\" is the French infinitive for \"to program\". I hope this helps! Let me know if you have any other questions.",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "tokenUsage": {
 *       "completionTokens": 82,
 *       "promptTokens": 20,
 *       "totalTokens": 102
 *     },
 *     "finish_reason": "stop"
 *   },
 *   "tool_calls": [],
 *   "invalid_tool_calls": []
 * }
 * ```
 * </details>
 *
 * <br />
 *
 * <details>
 * <summary><strong>Streaming Chunks</strong></summary>
 *
 * ```typescript
 * for await (const chunk of await llm.stream(input)) {
 *   console.log(chunk);
 * }
 * ```
 *
 * ```txt
 * AIMessageChunk {
 *   "content": "",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * AIMessageChunk {
 *   "content": "The",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * AIMessageChunk {
 *   "content": " French",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * AIMessageChunk {
 *   "content": " translation",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * AIMessageChunk {
 *   "content": " of",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * AIMessageChunk {
 *   "content": " \"",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * AIMessageChunk {
 *   "content": "I",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * AIMessageChunk {
 *   "content": " love",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * ...
 * AIMessageChunk {
 *   "content": ".",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": null
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * AIMessageChunk {
 *   "content": "",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": "stop"
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * ```
 * </details>
 *
 * <br />
 *
 * <details>
 * <summary><strong>Aggregate Streamed Chunks</strong></summary>
 *
 * ```typescript
 * import { AIMessageChunk } from '@langchain/core/messages';
 * import { concat } from '@langchain/core/utils/stream';
 *
 * const stream = await llm.stream(input);
 * let full: AIMessageChunk | undefined;
 * for await (const chunk of stream) {
 *   full = !full ? chunk : concat(full, chunk);
 * }
 * console.log(full);
 * ```
 *
 * ```txt
 * AIMessageChunk {
 *   "content": "The French translation of \"I love programming\" is \"J'aime programmer\". In this sentence, \"J'aime\" is the first person singular conjugation of the French verb \"aimer\" which means \"to love\", and \"programmer\" is the French infinitive for \"to program\". I hope this helps! Let me know if you have any other questions.",
 *   "additional_kwargs": {
 *     "reasoning_content": "...",
 *   },
 *   "response_metadata": {
 *     "finishReason": "stop"
 *   },
 *   "tool_calls": [],
 *   "tool_call_chunks": [],
 *   "invalid_tool_calls": []
 * }
 * ```
 * </details>
 *
 * <br />
 *
 * <details>
 * <summary><strong>Bind tools</strong></summary>
 *
 * ```typescript
 * import { z } from 'zod';
 *
 * const llmForToolCalling = new ChatDeepSeek({
 *   model: "deepseek-chat",
 *   temperature: 0,
 *   // other params...
 * });
 *
 * const GetWeather = {
 *   name: "GetWeather",
 *   description: "Get the current weather in a given location",
 *   schema: z.object({
 *     location: z.string().describe("The city and state, e.g. San Francisco, CA")
 *   }),
 * }
 *
 * const GetPopulation = {
 *   name: "GetPopulation",
 *   description: "Get the current population in a given location",
 *   schema: z.object({
 *     location: z.string().describe("The city and state, e.g. San Francisco, CA")
 *   }),
 * }
 *
 * const llmWithTools = llmForToolCalling.bindTools([GetWeather, GetPopulation]);
 * const aiMsg = await llmWithTools.invoke(
 *   "Which city is hotter today and which is bigger: LA or NY?"
 * );
 * console.log(aiMsg.tool_calls);
 * ```
 *
 * ```txt
 * [
 *   {
 *     name: 'GetWeather',
 *     args: { location: 'Los Angeles, CA' },
 *     type: 'tool_call',
 *     id: 'call_cd34'
 *   },
 *   {
 *     name: 'GetWeather',
 *     args: { location: 'New York, NY' },
 *     type: 'tool_call',
 *     id: 'call_68rf'
 *   },
 *   {
 *     name: 'GetPopulation',
 *     args: { location: 'Los Angeles, CA' },
 *     type: 'tool_call',
 *     id: 'call_f81z'
 *   },
 *   {
 *     name: 'GetPopulation',
 *     args: { location: 'New York, NY' },
 *     type: 'tool_call',
 *     id: 'call_8byt'
 *   }
 * ]
 * ```
 * </details>
 *
 * <br />
 *
 * <details>
 * <summary><strong>Structured Output</strong></summary>
 *
 * ```typescript
 * import { z } from 'zod';
 *
 * const Joke = z.object({
 *   setup: z.string().describe("The setup of the joke"),
 *   punchline: z.string().describe("The punchline to the joke"),
 *   rating: z.number().optional().describe("How funny the joke is, from 1 to 10")
 * }).describe('Joke to tell user.');
 *
 * const structuredLlm = llmForToolCalling.withStructuredOutput(Joke, { name: "Joke" });
 * const jokeResult = await structuredLlm.invoke("Tell me a joke about cats");
 * console.log(jokeResult);
 * ```
 *
 * ```txt
 * {
 *   setup: "Why don't cats play poker in the wild?",
 *   punchline: 'Because there are too many cheetahs.'
 * }
 * ```
 * </details>
 *
 * <br />
 */
// 定义 ChatDeepSeek 类，继承自 ChatOpenAI 类，使用 ChatDeepSeekCallOptions 作为泛型参数
export class ChatDeepSeek extends ChatOpenAI<ChatDeepSeekCallOptions> {
  // 定义静态方法，返回类名
  static lc_name() {
    return 'ChatDeepSeek';
  }

  // 定义 LLM 类型方法，返回 'deepseek'
  _llmType() {
    return 'deepseek';
  }

  // 定义 lc_secrets getter，返回 API 密钥环境变量映射
  get lc_secrets(): { [key: string]: string } | undefined {
    return {
      apiKey: 'DEEPSEEK_API_KEY',
    };
  }

  // 标记该类可序列化
  lc_serializable = true;

  // 定义命名空间
  lc_namespace = ['langchain', 'chat_models', 'deepseek'];

  // 构造函数，接受部分 ChatDeepSeekInput 作为参数
  constructor(fields?: Partial<ChatDeepSeekInput>) {
    // 获取 API 密钥，优先使用传入的密钥，其次使用环境变量
    const apiKey = fields?.apiKey || getEnvironmentVariable('DEEPSEEK_API_KEY');
    // 如果没有 API 密钥，抛出错误
    if (!apiKey) {
      throw new Error(
        `Deepseek API key not found. Please set the DEEPSEEK_API_KEY environment variable or pass the key into "apiKey" field.`,
      );
    }

    // 调用父类构造函数
    super({
      // 展开传入的字段
      ...fields,
      // 设置 API 密钥
      apiKey,
      // 设置配置
      configuration: {
        // 设置基础 URL
        baseURL: 'https://api.deepseek.com',
        // 合并传入的配置
        ...fields?.configuration,
      },
      // 设置模型参数
      modelKwargs: {
        // 设置是否包含推理
        include_reasoning: fields?.include_reasoning || undefined,
        // 如果包含推理，设置推理的最大令牌数
        reasoning: fields?.include_reasoning ? { max_tokens: MAX_OUTPUT_TOKENS_LEVEL0 } : undefined,
      },
    });
  }

  // 重写 _convertOpenAIDeltaToBaseMessageChunk 方法，用于将 OpenAI 增量转换为基础消息块
  protected override _convertOpenAIDeltaToBaseMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // delta 参数，类型为任意键值对的记录
    delta: Record<string, any>,
    // 原始响应参数，类型为 OpenAIClient.ChatCompletionChunk
    rawResponse: OpenAIClient.ChatCompletionChunk,
    // 默认角色参数，可选
    defaultRole?: 'function' | 'user' | 'system' | 'developer' | 'assistant' | 'tool',
  ) {
    // 调用父类方法获取消息块
    const messageChunk = super._convertOpenAIDeltaToBaseMessageChunk(
      delta,
      rawResponse,
      defaultRole,
    );
    // 设置消息块的额外参数中的推理内容
    messageChunk.additional_kwargs.reasoning_content = delta.reasoning;
    // 返回消息块
    return messageChunk;
  }

  // 重写 _convertOpenAIChatCompletionMessageToBaseMessage 方法，用于将 OpenAI 聊天完成消息转换为基础消息
  protected override _convertOpenAIChatCompletionMessageToBaseMessage(
    // 消息参数，类型为 OpenAIClient.ChatCompletionMessage
    message: OpenAIClient.ChatCompletionMessage,
    // 原始响应参数，类型为 OpenAIClient.ChatCompletion
    rawResponse: OpenAIClient.ChatCompletion,
  ) {
    // 调用父类方法获取 LangChain 消息
    const langChainMessage = super._convertOpenAIChatCompletionMessageToBaseMessage(
      message,
      rawResponse,
    );
    // 设置 LangChain 消息的额外参数中的推理内容
    langChainMessage.additional_kwargs.reasoning_content =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // 将消息转换为 any 类型以访问 reasoning_content 属性
      (message as any).reasoning_content;
    // 返回 LangChain 消息
    return langChainMessage;
  }

  // 定义 withStructuredOutput 方法的第一个重载，返回类型为 Runnable<BaseLanguageModelInput, RunOutput>
  withStructuredOutput<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // RunOutput 泛型参数，默认为任意键值对的记录
    RunOutput extends Record<string, any> = Record<string, any>,
  >(
    // outputSchema 参数，类型为 ZodType<RunOutput> 或任意键值对的记录
    outputSchema:
      | z.ZodType<RunOutput>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | Record<string, any>,
    // config 参数，可选，类型为 ChatOpenAIStructuredOutputMethodOptions<false>
    config?: ChatOpenAIStructuredOutputMethodOptions<false>,
  ): Runnable<BaseLanguageModelInput, RunOutput>;

  // 定义 withStructuredOutput 方法的第二个重载，返回类型为 Runnable<BaseLanguageModelInput, { raw: BaseMessage; parsed: RunOutput }>
  withStructuredOutput<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // RunOutput 泛型参数，默认为任意键值对的记录
    RunOutput extends Record<string, any> = Record<string, any>,
  >(
    // outputSchema 参数，类型为 ZodType<RunOutput> 或任意键值对的记录
    outputSchema:
      | z.ZodType<RunOutput>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | Record<string, any>,
    // config 参数，可选，类型为 ChatOpenAIStructuredOutputMethodOptions<true>
    config?: ChatOpenAIStructuredOutputMethodOptions<true>,
  ): Runnable<BaseLanguageModelInput, { raw: BaseMessage; parsed: RunOutput }>;

  // 定义 withStructuredOutput 方法的第三个重载，返回类型为 Runnable<BaseLanguageModelInput, RunOutput> 或 Runnable<BaseLanguageModelInput, { raw: BaseMessage; parsed: RunOutput }>
  withStructuredOutput<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // RunOutput 泛型参数，默认为任意键值对的记录
    RunOutput extends Record<string, any> = Record<string, any>,
  >(
    // outputSchema 参数，类型为 ZodType<RunOutput> 或任意键值对的记录
    outputSchema:
      | z.ZodType<RunOutput>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | Record<string, any>,
    // config 参数，可选，类型为 ChatOpenAIStructuredOutputMethodOptions<boolean>
    config?: ChatOpenAIStructuredOutputMethodOptions<boolean>,
  ):
    | Runnable<BaseLanguageModelInput, RunOutput>
    | Runnable<BaseLanguageModelInput, { raw: BaseMessage; parsed: RunOutput }>;

  // 实现 withStructuredOutput 方法
  withStructuredOutput<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // RunOutput 泛型参数，默认为任意键值对的记录
    RunOutput extends Record<string, any> = Record<string, any>,
  >(
    // outputSchema 参数，类型为 ZodType<RunOutput> 或任意键值对的记录
    outputSchema:
      | z.ZodType<RunOutput>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | Record<string, any>,
    // config 参数，可选，类型为 ChatOpenAIStructuredOutputMethodOptions<boolean>
    config?: ChatOpenAIStructuredOutputMethodOptions<boolean>,
  ):
    | Runnable<BaseLanguageModelInput, RunOutput>
    | Runnable<BaseLanguageModelInput, { raw: BaseMessage; parsed: RunOutput }> {
    // 创建确保的配置，复制传入的配置
    const ensuredConfig = { ...config };
    // Deepseek 尚不支持 json schema
    if (ensuredConfig?.method === undefined) {
      // 如果未指定方法，默认使用 functionCalling
      ensuredConfig.method = 'functionCalling';
    }
    // 调用父类的 withStructuredOutput 方法
    return super.withStructuredOutput<RunOutput>(outputSchema, ensuredConfig);
  }
}
