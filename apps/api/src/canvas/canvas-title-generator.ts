// 导入 LangChain 的 OpenAI 聊天模型
import { ChatOpenAI } from '@langchain/openai';
// 导入 LangChain 核心消息类型
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
// 导入 NestJS 的日志记录器
import { Logger } from '@nestjs/common';
// 导入 Zod 库用于数据验证和模式定义
import { z } from 'zod';
// 导入 JSON 修复工具
import { jsonrepair } from 'jsonrepair';
// 导入 Zod 到 JSON Schema 的转换工具
import { zodToJsonSchema } from 'zod-to-json-schema';
// 导入增强的 JSON 解析器
import parseJson from 'json-parse-even-better-errors';

// 定义更灵活的画布内容项接口，以适应不同的内容类型
export interface CanvasContentItem {
  // 问答内容
  question?: string;
  answer?: string;

  // 文档/资源内容
  title?: string;
  content?: string;
  contentPreview?: string;
}

/**
 * 定义标题生成输出的 Zod 模式
 */
// 使用 Zod 定义标题生成的输出模式
const titleSchema = z.object({
  // 标题字段：字符串类型，最少2个字符，最多100个字符
  title: z
    .string()
    .min(2)
    .max(100)
    .describe('The concise title (maximum 5 words) that represents the canvas content'),
  // 关键词字段：字符串数组
  keywords: z
    .array(z.string())
    .describe('Key terms extracted from the content that informed the title'),
  // 语言字段：枚举类型，默认为英语
  language: z.enum(['en', 'zh']).default('en').describe('The detected language of the content'),
  // 类别字段：枚举类型，包含多种技术类别
  category: z
    .enum([
      'programming',
      'data_science',
      'web_development',
      'devops',
      'ai_ml',
      'general_tech',
      'other',
    ])
    .describe('The general category of the content'),
});

// 增强的提取错误接口
interface ExtractionError {
  // 错误消息
  message: string;
  // 可选的正则表达式模式
  pattern?: string;
  // 可选的内容片段
  content?: string;
  // 可选的原始错误
  cause?: Error;
  // 可选的是否尝试修复标志
  attemptedRepair?: boolean;
}

// 辅助函数：预处理并修复常见的 JSON 问题
function preprocessJsonString(str: string): string {
  let result = str;

  // 移除可能出现在字符串开头的 BOM 字符
  result = result.replace(/^\uFEFF/, '');

  // 规范化行结束符
  result = result.replace(/\r\n/g, '\n');

  // 移除零宽空格和其他不可见字符
  result = result
    .replace(/\u200B/g, '')
    .replace(/\u200C/g, '')
    .replace(/\u200D/g, '')
    .replace(/\uFEFF/g, '');

  // 将"智能"引号替换为直引号
  result = result.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

  // 修复数组和对象中的尾随逗号（常见的 LLM 错误）
  result = result.replace(/,(\s*[\]}])/g, '$1');

  // 修复未加引号的属性名
  result = result.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

  // 修复单引号字符串（转换为双引号）
  result = fixSingleQuotedStrings(result);

  return result;
}

// 辅助函数：将单引号转换为双引号
function fixSingleQuotedStrings(str: string): string {
  // 这是一个简化的方法 - 对于复杂情况，我们依赖 jsonrepair
  let inString = false;
  let inDoubleQuoteString = false;
  let result = '';

  for (let i = 0; i < str.length; i++) {
    // 获取当前字符
    const char = str[i];
    // 获取前一个字符，如果存在的话
    const prevChar = i > 0 ? str[i - 1] : '';

    // 根据引号切换字符串状态
    if (char === '"' && prevChar !== '\\') {
      inDoubleQuoteString = !inDoubleQuoteString;
    } else if (char === "'" && prevChar !== '\\' && !inDoubleQuoteString) {
      inString = !inString;
      result += '"';
      continue;
    }

    result += char;
  }

  return result;
}

// 辅助函数：从 Markdown 代码块中提取 JSON
function extractJsonFromMarkdown(content: string): { result?: any; error?: ExtractionError } {
  // 移除任何转义的换行符并规范化行结束符
  const normalizedContent = content.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

  // 尝试不同的 JSON 提取模式
  const patterns = [
    // 模式 1：带有 json 标签的标准 Markdown 代码块
    /```(?:json)\s*\n([\s\S]*?)\n```/,
    // 模式 2：不带语言标签的标准 Markdown 代码块
    /```\s*\n([\s\S]*?)\n```/,
    // 模式 3：单行代码块
    /`(.*?)`/,
    // 模式 4：常见结构中的原始 JSON
    /({[\s\S]*}|\[[\s\S]*\])/,
    // 模式 5：原始 JSON（后备方案）
    /([\s\S]*)/,
  ];

  // 存储错误信息的数组
  const errors: ExtractionError[] = [];

  // 第一轮尝试 - 使用原始模式
  for (const pattern of patterns) {
    // 使用正则表达式匹配内容
    const match = normalizedContent.match(pattern);
    if (match?.[1]) {
      try {
        // 修剪匹配的内容
        const trimmed = match[1].trim();
        // 预处理 JSON 字符串
        const preprocessed = preprocessJsonString(trimmed);
        // 解析 JSON 并返回结果
        return { result: parseJson(preprocessed) };
      } catch (e) {
        // 如果解析失败，记录错误信息
        errors.push({
          message: `Failed to parse JSON using pattern ${pattern}`,
          pattern: pattern.toString(),
          content: match[1].substring(0, 200) + (match[1].length > 200 ? '...' : ''),
          cause: e instanceof Error ? e : new Error(String(e)),
        });
      }
    }
  }

  // 第二轮尝试 - 使用 jsonrepair
  for (const pattern of patterns) {
    // 使用正则表达式匹配内容
    const match = normalizedContent.match(pattern);
    if (match?.[1]) {
      try {
        // 修剪匹配的内容
        const trimmed = match[1].trim();
        // 首先预处理，然后尝试修复 JSON
        const preprocessed = preprocessJsonString(trimmed);
        // 使用 jsonrepair 修复 JSON
        const repaired = jsonrepair(preprocessed);
        // 解析修复后的 JSON 并返回结果
        return {
          result: parseJson(repaired),
        };
      } catch (e) {
        // 如果修复和解析失败，记录错误信息
        errors.push({
          message: `Failed to repair and parse JSON using pattern ${pattern}`,
          pattern: pattern.toString(),
          content: match[1].substring(0, 200) + (match[1].length > 200 ? '...' : ''),
          cause: e instanceof Error ? e : new Error(String(e)),
          attemptedRepair: true,
        });
      }
    }
  }

  // 最后的尝试 - 尝试修复整个内容
  try {
    // 尝试修复整个内容
    const preprocessed = preprocessJsonString(normalizedContent);
    // 使用 jsonrepair 修复 JSON
    const repaired = jsonrepair(preprocessed);
    // 解析修复后的 JSON 并返回结果
    return { result: parseJson(repaired) };
  } catch (e) {
    // 如果所有尝试都失败，返回详细的错误信息
    const finalError: ExtractionError = {
      message:
        'Failed to parse JSON from response after trying all extraction patterns and repair attempts',
      content: normalizedContent.substring(0, 200) + (normalizedContent.length > 200 ? '...' : ''),
      cause: e instanceof Error ? e : new Error(String(e)),
      attemptedRepair: true,
    };

    return { error: finalError };
  }
}

/**
 * 为 LLM 生成详细的模式指南和示例
 */
function generateSchemaInstructions(): string {
  // 将 Zod 模式转换为 JSON Schema，以获得更好的文档
  const jsonSchema = zodToJsonSchema(titleSchema, { target: 'openApi3' });

  // 根据模式生成示例
  const exampleOutput = {
    title: 'Python Data Visualization Tools',
    keywords: ['python', 'data analysis', 'visualization', 'matplotlib', 'pandas'],
    language: 'en',
    category: 'data_science',
  };

  // 返回格式化的指令字符串
  return `Please generate a structured JSON object with the following schema:

1. "title": A concise title (MAXIMUM 5 WORDS) that represents the canvas content
2. "keywords": An array of key terms extracted from the content
3. "language": The language of the content (either "en" or "zh")
4. "category": The general category of the content

Example output:
\`\`\`json
${JSON.stringify(exampleOutput, null, 2)}
\`\`\`

JSON Schema Definition:
\`\`\`json
${JSON.stringify(jsonSchema, null, 2)}
\`\`\`

IMPORTANT:
- Keep the title brief (MAXIMUM 5 WORDS)
- Use technical terminology when appropriate
- Be specific rather than generic
- Ensure your response is valid JSON and follows the schema exactly
`;
}

/**
 * 构建标题生成的少样本示例，以提高一致性
 */
function buildTitleGenerationExamples(): string {
  // 返回包含多个示例的字符串
  return `
Example 1:
Canvas Content:
Title: Python Data Analysis
Content Preview: This document contains code snippets for data analysis using pandas and matplotlib.
Title: Data Visualization Techniques
Content Preview: A review of various data visualization libraries in Python including seaborn, plotly, and bokeh.

Expected Output:
{
  "title": "Python Data Visualization Tools",
  "keywords": ["python", "data visualization", "pandas", "matplotlib", "seaborn"],
  "language": "en",
  "category": "data_science"
}

Example 2:
Canvas Content:
Question: How do I implement authentication in my Node.js API?
Answer: You can use Passport.js, which is a popular authentication middleware for Node.js.

Expected Output:
{
  "title": "Node.js API Authentication",
  "keywords": ["node.js", "api", "authentication", "passport.js", "middleware"],
  "language": "en",
  "category": "web_development"
}

Example 3:
Canvas Content:
Title: React State Management
Content Preview: Discussion of state management in React applications using hooks, context, and Redux.
Question: What are the benefits of Redux over Context API?
Answer: Redux offers more robust debugging tools, middleware support, and is better suited for complex state logic.

Expected Output:
{
  "title": "React State Management Comparison",
  "keywords": ["react", "state management", "redux", "context api", "hooks"],
  "language": "en",
  "category": "web_development"
}
`;
}

/**
 * 将画布内容项格式化为统一的字符串格式
 */
function formatCanvasContent(contentItems: CanvasContentItem[]): string {
  // 将内容项映射为格式化的字符串
  return (
    contentItems
      .map((item) => {
        // 处理问答类型的内容
        if (item.question && item.answer) {
          return `Question: ${item.question}\nAnswer: ${item.answer}`;
        }

        // 处理带有内容预览的标题
        if (item.title && item.contentPreview) {
          return `Title: ${item.title}\nContent Preview: ${item.contentPreview}`;
        }

        // 处理带有完整内容的标题
        if (item.title && item.content) {
          return `Title: ${item.title}\nContent: ${item.content}`;
        }

        return null;
      })
      // 过滤掉空值
      .filter(Boolean)
      // 用双换行符连接
      .join('\n\n')
  );
}

/**
 * 使用结构化输出为画布内容生成描述性标题
 * 返回具有适当长度约束的字符串标题
 */
export async function generateCanvasTitle(
  contentItems: CanvasContentItem[],
  modelInfo: any,
  logger: Logger,
): Promise<string> {
  // 合并所有内容项
  const combinedContent = formatCanvasContent(contentItems);

  try {
    // 如果没有内容可用，记录警告并返回空字符串
    if (!combinedContent) {
      logger.warn('No content available for title generation');
      return '';
    }

    // 创建 ChatOpenAI 模型实例
    const model = new ChatOpenAI({
      // 使用提供的模型名称
      model: modelInfo?.name,
      // 使用环境变量中的 API 密钥
      apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
      // 较低的温度值，以获得更一致的标题
      temperature: 0.2,
      // 配置选项
      configuration: {
        // 如果使用 OpenRouter API，则设置基础 URL
        baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined,
        // 设置默认请求头
        defaultHeaders: {
          'HTTP-Referer': 'https://refly.ai',
          'X-Title': 'Refly',
        },
      },
    });

    // 记录生成标题的日志
    logger.log(`Generating title from ${contentItems.length} content items`);

    // 第一次尝试：使用 LLM 结构化输出功能
    try {
      // 创建带有结构化输出的 LLM
      const structuredLLM = model.withStructuredOutput(titleSchema);

      // 结合模式指令、示例和内容
      const fullPrompt = `You are an expert at generating concise, descriptive titles for canvases.

## Your Task
Analyze this canvas content and generate a structured output that follows the specified schema.

## Guidelines
1. Keep titles concise - MAXIMUM 5 WORDS
2. Be specific rather than generic - capture the unique focus
3. Use technical terminology when appropriate
4. Detect the language of the content and use it for the title

${generateSchemaInstructions()}

Here are examples with expected outputs:
${buildTitleGenerationExamples()}

Canvas Content:
${combinedContent}`;

      // 调用 LLM 生成结构化输出
      const result = await structuredLLM.invoke(fullPrompt);

      // 记录生成的结构化输出
      logger.log(`Generated structured output: ${JSON.stringify(result)}`);

      // 验证标题字数
      const titleWords = result.title.split(/\s+/);
      if (titleWords.length > 15) {
        // 如果超过15个单词，截断标题
        result.title = titleWords.slice(0, 15).join(' ');
        logger.log(`Title truncated to 15 words: "${result.title}"`);
      }

      return result.title;
    } catch (structuredError) {
      // 如果结构化输出失败，记录警告并继续尝试后备方法
      logger.warn(`Structured output failed: ${structuredError.message}, trying fallback approach`);
      // 继续尝试后备方法
    }

    // 第二次尝试：手动 JSON 解析方法
    const schemaInstructions = generateSchemaInstructions();
    const fullPrompt = `You are an expert at generating concise, descriptive titles for canvases.

## Your Task
Analyze this canvas content and generate a structured output following the schema below.

${schemaInstructions}

Canvas Content:
${combinedContent}

Respond ONLY with a valid JSON object wrapped in \`\`\`json and \`\`\` tags.`;

    // 调用模型生成响应
    const response = await model.invoke(fullPrompt);
    // 将响应内容转换为字符串
    const responseText = response.content.toString();

    // 提取并解析 JSON
    const extraction = extractJsonFromMarkdown(responseText);

    // 如果提取失败
    if (extraction.error) {
      // 记录警告并继续尝试最终后备方法
      logger.warn(`JSON extraction failed: ${extraction.error.message}, using final fallback`);
      // 继续尝试最终后备方法
    } else if (extraction.result) {
      try {
        // 验证提取的数据是否符合模式
        const validatedData = await titleSchema.parseAsync(extraction.result);

        // 验证标题字数
        const titleWords = validatedData.title.split(/\s+/);
        if (titleWords.length > 15) {
          // 如果超过15个单词，截断标题
          validatedData.title = titleWords.slice(0, 15).join(' ');
          logger.log(`Title truncated to 15 words: "${validatedData.title}"`);
        }

        // 记录成功提取的标题
        logger.log(`Successfully extracted title: "${validatedData.title}"`);
        return validatedData.title;
      } catch (validationError) {
        // 如果验证失败，记录警告并继续尝试最终后备方法
        logger.warn(`Schema validation failed: ${validationError.message}, using final fallback`);
        // 继续尝试最终后备方法
      }
    }

    // 最终后备方法：简单的标题生成
    const fallbackResponse = await model.invoke([
      // 系统消息指示生成简洁的标题
      new SystemMessage(
        'Generate a very concise title (5 words maximum) for this content. Output only the title itself.',
      ),
      // 人类消息包含内容
      new HumanMessage(combinedContent),
    ]);

    // 获取响应内容并修剪
    let title = fallbackResponse.content.toString().trim();
    // 移除可能的引号
    title = title.replace(/^["'](.*)["']$/, '$1');

    // 强制执行最多15个单词的限制
    const words = title.split(/\s+/);
    if (words.length > 15) {
      // 如果超过15个单词，截断标题
      title = words.slice(0, 15).join(' ');
      logger.log(`Title truncated to 15 words: "${title}"`);
    }

    // 确保标题至少有2个单词
    if (words.length < 2 && words[0]?.length > 0) {
      // 如果只有一个单词，添加"Content"
      title = `${words[0]} Content`;
      logger.log(`Title expanded to ensure minimum length: "${title}"`);
    }

    // 记录生成的后备标题
    logger.log(`Generated fallback title: "${title}"`);
    return title;
  } catch (error) {
    // 如果生成过程中出现错误，记录错误并返回空字符串
    logger.error(`Error generating canvas title: ${error.message}`);
    return '';
  }
}
