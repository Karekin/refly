// 导入图状态和上下文接口类型
import { GraphState, IContext } from '../types';
// 导入令牌计数和上下文检查相关工具函数
import { countContextTokens, countSourcesTokens, checkHasContext } from './token';
// 导入语义搜索处理函数
import {
  processSelectedContentWithSimilarity,
  processDocumentsWithSimilarity,
  processResourcesWithSimilarity,
  processMentionedContextWithSimilarity,
} from './semanticSearch';
// 导入基础技能和技能运行配置类型
import { BaseSkill, SkillRunnableConfig } from '../../base';
// 导入上下文截断工具
import { truncateContext } from './truncator';
// 导入上下文合并和字符串转换工具
import { flattenMergedContextToSources, concatMergedContextToStr } from './summarizer';
// 导入技能模板配置和源类型
import { SkillTemplateConfig, Source } from '@refly-packages/openapi-schema';
// 导入 lodash 的 uniqBy 函数用于数组去重
import { uniqBy } from 'lodash';
// 导入上下文比例常量
import { MAX_CONTEXT_RATIO, MAX_URL_SOURCES_RATIO } from './constants';
// 导入安全 JSON 字符串化工具
import { safeStringifyJSON } from '@refly-packages/utils';
// 导入多语言网络搜索函数
import { callMultiLingualWebSearch } from '../module/multiLingualSearch';
// 导入多语言库搜索函数
import { callMultiLingualLibrarySearch } from '../module/multiLingualLibrarySearch';
// 导入模型支持检查函数
import { checkIsSupportedModel, checkModelContextLenSupport } from './model';
// 导入技能上下文内容项元数据类型
import { SkillContextContentItemMetadata } from '../types';
// 导入 URL 源处理函数
import { processUrlSourcesWithSimilarity } from './semanticSearch';

// 准备上下文的异步函数
export async function prepareContext(
  // 第一个参数对象，包含查询和上下文相关信息
  {
    query,
    mentionedContext,
    maxTokens,
    enableMentionedContext,
    rewrittenQueries,
    urlSources = [],
  }: {
    query: string; // 查询字符串
    mentionedContext: IContext; // 提到的上下文
    maxTokens: number; // 最大令牌数
    enableMentionedContext: boolean; // 是否启用提到的上下文
    rewrittenQueries?: string[]; // 可选的重写查询数组
    urlSources?: Source[]; // 可选的 URL 源数组
  },
  // 第二个参数对象，包含配置和状态信息
  ctx: {
    config: SkillRunnableConfig; // 技能运行配置
    ctxThis: BaseSkill; // 技能实例
    state: GraphState; // 图状态
    tplConfig: SkillTemplateConfig; // 模板配置
  },
): Promise<{ contextStr: string; sources: Source[] }> {
  try {
    // 从模板配置中获取是否启用网络搜索和知识库搜索
    const enableWebSearch = ctx.tplConfig?.enableWebSearch?.value;
    const enableKnowledgeBaseSearch = ctx.tplConfig?.enableKnowledgeBaseSearch?.value;
    // 记录搜索设置
    ctx.ctxThis.engine.logger.log(`Enable Web Search: ${enableWebSearch}`);
    ctx.ctxThis.engine.logger.log(`Enable Knowledge Base Search: ${enableKnowledgeBaseSearch}`);
    ctx.ctxThis.engine.logger.log(`URL Sources Count: ${urlSources?.length || 0}`);

    // 计算最大上下文令牌数，使用最大令牌数乘以上下文比例
    const maxContextTokens = Math.floor(maxTokens * MAX_CONTEXT_RATIO);

    // 处理 URL 源，使用相似度搜索
    // 计算 URL 源的最大令牌数，使用最大上下文令牌数乘以 URL 源比例
    const MAX_URL_SOURCES_TOKENS = Math.floor(maxContextTokens * MAX_URL_SOURCES_RATIO);

    // 初始化处理后的 URL 源数组
    let processedUrlSources: Source[] = [];
    // 如果有 URL 源，则进行处理
    if (urlSources?.length > 0) {
      processedUrlSources = await processUrlSourcesWithSimilarity(
        query,
        urlSources,
        MAX_URL_SOURCES_TOKENS,
        ctx,
      );
    }

    // 计算处理后的 URL 源使用的令牌数
    const urlSourcesTokens = countSourcesTokens(processedUrlSources);
    // 计算剩余令牌数
    let remainingTokens = maxContextTokens - urlSourcesTokens;
    // 记录 URL 源令牌数
    ctx.ctxThis.engine.logger.log(`URL Sources Tokens: ${urlSourcesTokens}`);

    // 从配置中获取模型信息
    const { modelInfo } = ctx.config.configurable;
    // 检查是否为支持的模型
    const isSupportedModel = checkIsSupportedModel(modelInfo);

    // 1. 网络搜索上下文
    // 初始化处理后的网络搜索上下文
    let processedWebSearchContext: IContext = {
      contentList: [],
      resources: [],
      documents: [],
      webSearchSources: [],
    };
    // 如果启用了网络搜索，则准备网络搜索上下文
    if (enableWebSearch) {
      const preparedRes = await prepareWebSearchContext(
        {
          query,
          rewrittenQueries,
          enableQueryRewrite: isSupportedModel,
        },
        ctx,
      );
      processedWebSearchContext = preparedRes.processedWebSearchContext;
    }
    // 计算网络搜索上下文令牌数
    const webSearchContextTokens = countSourcesTokens(processedWebSearchContext.webSearchSources);
    // 更新剩余令牌数
    remainingTokens -= webSearchContextTokens;
    // 记录网络搜索上下文令牌数和剩余令牌数
    ctx.ctxThis.engine.logger.log(`Web Search Context Tokens: ${webSearchContextTokens}`);
    ctx.ctxThis.engine.logger.log(`Remaining Tokens after web search: ${remainingTokens}`);

    // 2. 库搜索上下文
    // 初始化处理后的库搜索上下文
    let processedLibrarySearchContext: IContext = {
      contentList: [],
      resources: [],
      documents: [],
      librarySearchSources: [],
    };
    // 如果启用了知识库搜索，则执行库搜索上下文
    if (enableKnowledgeBaseSearch) {
      const librarySearchRes = await performLibrarySearchContext(
        {
          query,
          rewrittenQueries,
          enableQueryRewrite: isSupportedModel,
          enableSearchWholeSpace: true,
        },
        ctx,
      );
      processedLibrarySearchContext = librarySearchRes.processedLibrarySearchContext;
      // 根据库搜索结果调整剩余令牌数
      const librarySearchContextTokens = countSourcesTokens(
        processedLibrarySearchContext.librarySearchSources,
      );
      // 更新剩余令牌数
      remainingTokens -= librarySearchContextTokens;
      // 记录库搜索上下文令牌数和剩余令牌数
      ctx.ctxThis.engine.logger.log(`Library Search Context Tokens: ${librarySearchContextTokens}`);
      ctx.ctxThis.engine.logger.log(`Remaining Tokens after library search: ${remainingTokens}`);
    }

    // 3. 提到的上下文
    // 初始化处理后的提到的上下文
    let processedMentionedContext: IContext = {
      contentList: [],
      resources: [],
      documents: [],
    };
    // 如果启用了提到的上下文且是支持的模型，则准备提到的上下文
    if (enableMentionedContext && isSupportedModel) {
      const mentionContextRes = await prepareMentionedContext(
        {
          query,
          mentionedContext,
          maxMentionedContextTokens: remainingTokens,
        },
        ctx,
      );

      processedMentionedContext = mentionContextRes.processedMentionedContext;
      // 更新剩余令牌数
      remainingTokens -= mentionContextRes.mentionedContextTokens || 0;
      // 记录提到的上下文令牌数和剩余令牌数
      ctx.ctxThis.engine.logger.log(
        `Mentioned Context Tokens: ${mentionContextRes.mentionedContextTokens || 0}`,
      );
      ctx.ctxThis.engine.logger.log(`Remaining Tokens after mentioned context: ${remainingTokens}`);
    }

    // 4. 用户提供内容的相关上下文（如果还有剩余令牌）
    // 初始化相关上下文
    let relevantContext: IContext = {
      contentList: [],
      resources: [],
      documents: [],
    };
    // 如果有剩余令牌且有用户提供的内容，则准备相关上下文
    if (
      remainingTokens > 0 &&
      (ctx.config.configurable.contentList?.length > 0 ||
        ctx.config.configurable.resources?.length > 0 ||
        ctx.config.configurable.documents?.length > 0)
    ) {
      // 从配置中获取内容列表、资源和文档
      const { contentList = [], resources = [], documents = [] } = ctx.config.configurable;

      // 移除与提到的上下文重叠的项
      const filteredContext = removeOverlappingContextItems(processedMentionedContext, {
        contentList,
        resources,
        documents,
      });

      // 直接获取相关上下文
      relevantContext = await prepareRelevantContext(
        {
          query,
          context: filteredContext,
        },
        ctx,
      );

      // 计算截断前的令牌数
      const relevantContextTokensBeforeTruncation = countContextTokens(relevantContext);
      // 记录截断前的相关上下文令牌数
      ctx.ctxThis.engine.logger.log(
        `Relevant Context Tokens Before Truncation: ${relevantContextTokensBeforeTruncation}`,
      );

      // 截断以适应令牌限制
      if (relevantContextTokensBeforeTruncation > remainingTokens) {
        relevantContext = truncateContext(relevantContext, remainingTokens);
        // 计算截断后的令牌数
        const relevantContextTokensAfterTruncation = countContextTokens(relevantContext);
        // 记录截断后的相关上下文令牌数
        ctx.ctxThis.engine.logger.log(
          `Relevant Context Tokens After Truncation: ${relevantContextTokensAfterTruncation}`,
        );
        // 更新剩余令牌数
        remainingTokens -= relevantContextTokensAfterTruncation;
      } else {
        // 更新剩余令牌数
        remainingTokens -= relevantContextTokensBeforeTruncation;
      }

      // 记录相关上下文后的剩余令牌数
      ctx.ctxThis.engine.logger.log(`Remaining Tokens after relevant context: ${remainingTokens}`);
    }

    // 记录准备好的相关上下文
    ctx.ctxThis.engine.logger.log(
      `Prepared Relevant Context: ${safeStringifyJSON(relevantContext)}`,
    );

    // 合并所有上下文，并进行适当的去重
    // 对相关上下文进行去重
    const deduplicatedRelevantContext = deduplicateContexts(relevantContext);
    // 合并上下文
    const mergedContext = {
      urlSources: processedUrlSources,
      mentionedContext: processedMentionedContext,
      relevantContext: deduplicatedRelevantContext,
      webSearchSources: processedWebSearchContext.webSearchSources,
      librarySearchSources: removeOverlappingLibrarySearchSources(
        processedLibrarySearchContext.librarySearchSources,
        processedMentionedContext,
        deduplicatedRelevantContext,
        ctx.ctxThis.engine.logger,
      ),
    };

    // 记录合并后的上下文
    ctx.ctxThis.engine.logger.log(`Merged Context: ${safeStringifyJSON(mergedContext)}`);

    // 检查是否有提到的上下文和相关上下文
    const hasMentionedContext = checkHasContext(processedMentionedContext);
    const hasRelevantContext = checkHasContext(relevantContext);

    // 当我们有其他上下文时，限制搜索源的数量
    const LIMIT_SEARCH_SOURCES_COUNT = 10;
    if (hasMentionedContext || hasRelevantContext) {
      // 限制网络搜索源和库搜索源的数量
      mergedContext.webSearchSources = mergedContext.webSearchSources.slice(
        0,
        LIMIT_SEARCH_SOURCES_COUNT,
      );
      mergedContext.librarySearchSources = mergedContext.librarySearchSources.slice(
        0,
        LIMIT_SEARCH_SOURCES_COUNT,
      );
    }

    // 生成最终上下文字符串和源
    const contextStr = concatMergedContextToStr(mergedContext);
    const sources = flattenMergedContextToSources(mergedContext);

    // 返回上下文字符串和源
    return { contextStr, sources };
  } catch (error) {
    // 如果在顶层发生任何意外错误，记录并返回空结果
    ctx.ctxThis.engine.logger.error(`Unexpected error in prepareContext: ${error}`);
    return { contextStr: '', sources: [] };
  }
}

// 准备网络搜索上下文的异步函数
export async function prepareWebSearchContext(
  // 第一个参数对象，包含查询和搜索相关选项
  {
    query,
    rewrittenQueries,
    enableQueryRewrite = true,
    enableTranslateQuery = false,
    enableTranslateResult = false,
  }: {
    query: string; // 查询字符串
    rewrittenQueries?: string[]; // 可选的重写查询数组
    enableQueryRewrite?: boolean; // 是否启用查询重写
    enableTranslateQuery?: boolean; // 是否启用查询翻译
    enableTranslateResult?: boolean; // 是否启用结果翻译
  },
  // 第二个参数对象，包含配置和状态信息
  ctx: {
    config: SkillRunnableConfig; // 技能运行配置
    ctxThis: BaseSkill; // 技能实例
    state: GraphState; // 图状态
    tplConfig: SkillTemplateConfig; // 模板配置
  },
): Promise<{
  processedWebSearchContext: IContext; // 返回处理后的网络搜索上下文
}> {
  // 记录准备网络搜索上下文的开始
  ctx.ctxThis.engine.logger.log('Prepare Web Search Context...');

  // 两种搜索模式
  // 从模板配置中获取是否启用深度推理网络搜索
  const enableDeepReasonWebSearch =
    (ctx.tplConfig?.enableDeepReasonWebSearch?.value as boolean) || false;
  // 从配置中获取区域设置，默认为英语
  const { locale = 'en' } = ctx?.config?.configurable || {};

  // 设置搜索限制和参数
  let searchLimit = 10;
  const enableRerank = true;
  const searchLocaleList: string[] = ['en'];
  let rerankRelevanceThreshold = 0.2;

  // 如果启用了深度推理网络搜索，调整搜索参数
  if (enableDeepReasonWebSearch) {
    searchLimit = 20;
    enableTranslateQuery = true;
    rerankRelevanceThreshold = 0.4;
  }

  // 初始化处理后的网络搜索上下文
  const processedWebSearchContext: IContext = {
    contentList: [],
    resources: [],
    documents: [],
    webSearchSources: [],
  };

  // 调用多语言网络搜索，而不是普通网络搜索
  const searchResult = await callMultiLingualWebSearch(
    {
      rewrittenQueries,
      searchLimit,
      searchLocaleList,
      resultDisplayLocale: locale || 'auto',
      enableRerank,
      enableTranslateQuery,
      enableTranslateResult,
      rerankRelevanceThreshold,
      translateConcurrencyLimit: 10,
      webSearchConcurrencyLimit: 3,
      batchSize: 5,
      enableDeepReasonWebSearch,
      enableQueryRewrite,
    },
    {
      config: ctx.config,
      ctxThis: ctx.ctxThis,
      state: { ...ctx.state, query },
    },
  );

  // 仅获取前 10 个源
  // 检查模型是否支持长上下文
  const isModelContextLenSupport = checkModelContextLenSupport(
    ctx?.config?.configurable?.modelInfo,
  );
  // 获取网络搜索源
  let webSearchSources = searchResult.sources || [];
  // 如果模型不支持长上下文，则只取前 10 个源
  if (!isModelContextLenSupport) {
    webSearchSources = webSearchSources.slice(0, 10);
  }

  // 设置处理后的网络搜索上下文的网络搜索源
  processedWebSearchContext.webSearchSources = webSearchSources;

  // 记录网络搜索上下文准备成功
  ctx.ctxThis.engine.logger.log(
    `Prepared Web Search Context successfully! ${safeStringifyJSON(processedWebSearchContext)}`,
  );

  // 返回处理后的网络搜索上下文
  return {
    processedWebSearchContext,
  };
}

// 准备提到的上下文的异步函数
export async function prepareMentionedContext(
  // 第一个参数对象，包含查询和上下文相关信息
  {
    query,
    mentionedContext,
    maxMentionedContextTokens,
  }: {
    query: string; // 查询字符串
    mentionedContext: IContext; // 提到的上下文
    maxMentionedContextTokens: number; // 提到的上下文的最大令牌数
  },
  // 第二个参数对象，包含配置和状态信息
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<{
  mentionedContextTokens: number; // 返回提到的上下文令牌数
  processedMentionedContext: IContext; // 返回处理后的提到的上下文
}> {
  // 记录准备提到的上下文的开始
  ctx.ctxThis.engine.logger.log('Prepare Mentioned Context...');

  // 初始化处理后的提到的上下文
  let processedMentionedContext: IContext = {
    contentList: [],
    resources: [],
    documents: [],
    ...mentionedContext,
  };

  // 计算所有提到的上下文令牌数
  const allMentionedContextTokens = countContextTokens(mentionedContext);
  // 记录所有提到的上下文令牌数
  ctx.ctxThis.engine.logger.log(`All Mentioned Context Tokens: ${allMentionedContextTokens}`);

  // 如果没有提到的上下文，直接返回
  if (allMentionedContextTokens === 0) {
    return {
      mentionedContextTokens: 0,
      processedMentionedContext: mentionedContext,
    };
  }
  // 如果提到的上下文不为空，我们需要修改提到的上下文的元数据
  // 从配置中获取内容列表、资源和文档
  const { contentList = [], resources = [], documents = [] } = ctx.config.configurable;
  // 创建上下文对象
  const context: IContext = {
    contentList,
    resources,
    documents,
  };

  // 记录修改上下文元数据的开始
  ctx.ctxThis.engine.logger.log('Mutate Context Metadata...');
  // 修改上下文元数据
  mutateContextMetadata(mentionedContext, context);

  // 设置提到的上下文令牌数
  let mentionedContextTokens = allMentionedContextTokens;

  // 如果提到的上下文令牌数超过最大限制，进行处理
  if (allMentionedContextTokens > maxMentionedContextTokens) {
    // 记录使用相似度处理提到的上下文的开始
    ctx.ctxThis.engine.logger.log('Process Mentioned Context With Similarity...');
    // 使用相似度处理提到的上下文
    processedMentionedContext = await processMentionedContextWithSimilarity(
      query,
      mentionedContext,
      maxMentionedContextTokens,
      ctx,
    );
    // 计算处理后的提到的上下文令牌数
    mentionedContextTokens = countContextTokens(processedMentionedContext);

    // 如果处理后的提到的上下文令牌数仍然超过最大限制，进行截断
    if (mentionedContextTokens > maxMentionedContextTokens) {
      processedMentionedContext = truncateContext(
        processedMentionedContext,
        maxMentionedContextTokens,
      );
      // 计算截断后的提到的上下文令牌数
      mentionedContextTokens = countContextTokens(processedMentionedContext);
    }
  }

  // 记录提到的上下文准备成功
  ctx.ctxThis.engine.logger.log(
    `Prepared Mentioned Context successfully! ${safeStringifyJSON(processedMentionedContext)}`,
  );

  // 返回提到的上下文令牌数和处理后的提到的上下文
  return {
    mentionedContextTokens,
    processedMentionedContext,
  };
}

// 准备相关上下文的异步函数
export async function prepareRelevantContext(
  // 第一个参数对象，包含查询和上下文
  {
    query,
    context,
  }: {
    query: string; // 查询字符串
    context: IContext; // 上下文
  },
  // 第二个参数对象，包含配置和状态信息
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<IContext> {
  // 从上下文中获取内容列表、资源和文档
  const { contentList = [], resources = [], documents = [] } = context;
  // 初始化相关上下文
  const relevantContexts: IContext = {
    contentList: [],
    resources: [],
    documents: [],
  };

  // 记录准备相关上下文的开始
  ctx.ctxThis.engine.logger.log(`Prepare Relevant Context..., ${safeStringifyJSON(context)}`);

  // 1. 处理选定的内容上下文
  relevantContexts.contentList =
    contentList.length > 0
      ? await processSelectedContentWithSimilarity(
          query,
          contentList,
          Number.POSITIVE_INFINITY,
          ctx,
        )
      : [];

  // 2. 处理文档上下文
  relevantContexts.documents =
    documents.length > 0
      ? await processDocumentsWithSimilarity(query, documents, Number.POSITIVE_INFINITY, ctx)
      : [];

  // 3. 处理资源上下文
  relevantContexts.resources =
    resources.length > 0
      ? await processResourcesWithSimilarity(query, resources, Number.POSITIVE_INFINITY, ctx)
      : [];

  // 记录相关上下文准备成功
  ctx.ctxThis.engine.logger.log(
    `Prepared Relevant Context successfully! ${safeStringifyJSON(relevantContexts)}`,
  );

  // 返回相关上下文
  return relevantContexts;
}

// 去重上下文的函数
export function deduplicateContexts(context: IContext): IContext {
  return {
    // 使用 uniqBy 函数对内容列表进行去重，基于内容字段
    contentList: uniqBy(context.contentList || [], 'content'),
    // 使用 uniqBy 函数对资源进行去重，基于资源内容
    resources: uniqBy(context.resources || [], (item) => item.resource?.content),
    // 使用 uniqBy 函数对文档进行去重，基于文档内容
    documents: uniqBy(context.documents || [], (item) => item.document?.content),
    // 使用 uniqBy 函数对网络搜索源进行去重，基于页面内容
    webSearchSources: uniqBy(context.webSearchSources || [], (item) => item?.pageContent),
    // 使用 uniqBy 函数对库搜索源进行去重，基于页面内容
    librarySearchSources: uniqBy(context.librarySearchSources || [], (item) => item?.pageContent),
  };
}

// 移除重叠上下文项的函数
export function removeOverlappingContextItems(
  // 上下文
  context: IContext,
  // 原始上下文
  originalContext: IContext,
): IContext {
  // 初始化去重后的上下文
  const deduplicatedContext: IContext = {
    contentList: [],
    resources: [],
    documents: [],
  };

  // 辅助函数，检查项是否存在于上下文中
  const itemExistsInContext = (item: any, contextArray: any[], idField: string) => {
    return contextArray.some((contextItem) => contextItem[idField] === item[idField]);
  };

  // 去重内容列表
  deduplicatedContext.contentList = (originalContext?.contentList || []).filter(
    (item) => !itemExistsInContext(item, context?.contentList || [], 'metadata.entityId'),
  );

  // 去重资源
  deduplicatedContext.resources = (originalContext?.resources || []).filter(
    (item) =>
      !itemExistsInContext(
        item.resource,
        (context?.resources || []).map((r) => r.resource),
        'resourceId',
      ),
  );

  // 去重文档
  deduplicatedContext.documents = (originalContext?.documents || []).filter(
    (item) =>
      !itemExistsInContext(
        item.document,
        (context?.documents || []).map((n) => n.document),
        'docId',
      ),
  );

  // 返回去重后的上下文
  return deduplicatedContext;
}

// 修改上下文元数据的函数
export const mutateContextMetadata = (
  // 提到的上下文
  mentionedContext: IContext,
  // 原始上下文
  originalContext: IContext,
): IContext => {
  // Process documents
  for (const mentionedDocument of mentionedContext.documents) {
    // 查找匹配的文档索引
    const index = originalContext.documents.findIndex(
      (n) => n.document.docId === mentionedDocument.document.docId,
    );
    // 如果找到匹配的文档，更新其元数据
    if (index !== -1) {
      originalContext.documents[index] = {
        ...originalContext.documents[index],
        metadata: {
          ...originalContext.documents[index].metadata,
          useWholeContent: mentionedDocument.metadata?.useWholeContent,
        },
      };
    }
  }

  // 处理资源
  for (const mentionedResource of mentionedContext.resources) {
    // 查找匹配的资源索引
    const index = originalContext.resources.findIndex(
      (r) => r.resource.resourceId === mentionedResource.resource.resourceId,
    );
    // 如果找到匹配的资源，更新其元数据
    if (index !== -1) {
      originalContext.resources[index] = {
        ...originalContext.resources[index],
        metadata: {
          ...originalContext.resources[index].metadata,
          useWholeContent: mentionedResource.metadata?.useWholeContent,
        },
      };
    }
  }

  // 处理内容列表
  for (const mentionedContent of mentionedContext.contentList) {
    // 查找匹配的内容索引
    const index = originalContext.contentList.findIndex(
      (c) => c.metadata.entityId === mentionedContent.metadata.entityId,
    );
    // 如果找到匹配的内容，更新其元数据
    if (index !== -1) {
      originalContext.contentList[index] = {
        ...originalContext.contentList[index],
        metadata: {
          ...originalContext.contentList[index].metadata,
          useWholeContent: mentionedContent.metadata?.useWholeContent,
        },
      };
    }
  }

  // 返回更新后的原始上下文
  return originalContext;
};

// 执行库搜索上下文的异步函数
export async function performLibrarySearchContext(
  // 第一个参数对象，包含查询和搜索相关选项
  {
    query,
    rewrittenQueries,
    enableQueryRewrite = true,
    enableTranslateQuery = false,
    enableTranslateResult = false,
    enableSearchWholeSpace = false,
  }: {
    query: string; // 查询字符串
    rewrittenQueries?: string[]; // 可选的重写查询数组
    enableQueryRewrite?: boolean; // 是否启用查询重写
    enableTranslateQuery?: boolean; // 是否启用查询翻译
    enableTranslateResult?: boolean; // 是否启用结果翻译
    enableSearchWholeSpace?: boolean; // 是否启用搜索整个空间
  },
  // 第二个参数对象，包含配置和状态信息
  ctx: {
    config: SkillRunnableConfig; // 技能运行配置
    ctxThis: BaseSkill; // 技能实例
    state: GraphState; // 图状态
    tplConfig: SkillTemplateConfig; // 模板配置
  },
): Promise<{
  processedLibrarySearchContext: IContext; // 返回处理后的库搜索上下文
}> {
  // 记录准备库搜索上下文的开始
  ctx.ctxThis.engine.logger.log('Prepare Library Search Context...');

  // 配置搜索参数
  // 从模板配置中获取是否启用深度搜索
  const enableDeepSearch = (ctx.tplConfig?.enableDeepSearch?.value as boolean) || false;
  // 从配置中获取区域设置，默认为英语
  const { locale = 'en' } = ctx?.config?.configurable || {};

  // 设置搜索限制和参数
  let searchLimit = 10;
  const enableRerank = true;
  const searchLocaleList: string[] = ['en'];
  let rerankRelevanceThreshold = 0.2;

  // 如果启用了深度搜索，调整搜索参数
  if (enableDeepSearch) {
    searchLimit = 20;
    enableTranslateQuery = true;
    rerankRelevanceThreshold = 0.4;
  }

  // 初始化处理后的库搜索上下文
  const processedLibrarySearchContext: IContext = {
    contentList: [],
    resources: [],
    documents: [],
    librarySearchSources: [],
  };

  // 调用多语言库搜索
  const searchResult = await callMultiLingualLibrarySearch(
    {
      rewrittenQueries,
      searchLimit,
      searchLocaleList,
      resultDisplayLocale: locale || 'auto',
      enableRerank,
      enableTranslateQuery,
      enableTranslateResult,
      rerankRelevanceThreshold,
      translateConcurrencyLimit: 10,
      libraryConcurrencyLimit: 3,
      batchSize: 5,
      enableDeepSearch,
      enableQueryRewrite,
      enableSearchWholeSpace,
    },
    {
      config: ctx.config,
      ctxThis: ctx.ctxThis,
      state: { ...ctx.state, query },
    },
  );

  // 对于上下文长度有限的模型，只取前 10 个源
  // 检查模型是否支持长上下文
  const isModelContextLenSupport = checkModelContextLenSupport(
    ctx?.config?.configurable?.modelInfo,
  );
  // 获取库搜索源
  let librarySearchSources = searchResult.sources || [];
  // 如果模型不支持长上下文，则只取前 10 个源
  if (!isModelContextLenSupport) {
    librarySearchSources = librarySearchSources.slice(0, 10);
  }

  // 将源存储在上下文中
  processedLibrarySearchContext.librarySearchSources = librarySearchSources;

  // 根据元数据将源处理为文档和资源
  // 创建唯一资源 ID 集合
  const uniqueResourceIds = new Set<string>();
  // 创建唯一文档 ID 集合
  const uniqueDocIds = new Set<string>();

  // 遍历库搜索源
  for (const source of librarySearchSources) {
    // 获取元数据
    const metadata = source.metadata || {};
    // 获取实体类型
    const entityType = metadata.entityType;
    // 获取实体 ID
    const entityId = metadata.entityId;

    // 如果是资源类型且有实体 ID 且不在唯一资源 ID 集合中
    if (entityType === 'resource' && entityId && !uniqueResourceIds.has(entityId)) {
      // 添加到唯一资源 ID 集合
      uniqueResourceIds.add(entityId);
      // 添加到处理后的库搜索上下文的资源中
      processedLibrarySearchContext.resources.push({
        resource: {
          resourceId: entityId,
          content: source.pageContent || '',
          title: source.title || '',
          resourceType: 'text',
          data: {
            url: source.url || '',
          },
        },
      });
    }
    // 如果是文档类型且有实体 ID 且不在唯一文档 ID 集合中
    else if (entityType === 'document' && entityId && !uniqueDocIds.has(entityId)) {
      // 添加到唯一文档 ID 集合
      uniqueDocIds.add(entityId);
      // 添加到处理后的库搜索上下文的文档中
      processedLibrarySearchContext.documents.push({
        document: {
          docId: entityId,
          content: source.pageContent || '',
          title: source.title || '',
        },
      });
    }
  }

  // 记录库搜索上下文准备成功
  ctx.ctxThis.engine.logger.log(
    `Prepared Library Search Context successfully! ${safeStringifyJSON(processedLibrarySearchContext)}`,
  );

  // 返回处理后的库搜索上下文
  return {
    processedLibrarySearchContext,
  };
}

/**
 * 移除与提到的或相关上下文重叠的库搜索源
 * 库搜索具有最低优先级，因此我们应该根据其他上下文对其进行去重
 */
export function removeOverlappingLibrarySearchSources(
  // 库搜索源
  librarySearchSources: Source[],
  // 提到的上下文
  mentionedContext: IContext | null,
  // 相关上下文
  relevantContext: IContext | null,
  // 日志记录器
  logger?: any,
): Source[] {
  // 如果没有库搜索源，直接返回空数组
  if (!librarySearchSources?.length) {
    return [];
  }

  // 如果没有提到的上下文和相关上下文，直接返回库搜索源
  if (!mentionedContext && !relevantContext) {
    return librarySearchSources;
  }

  // 从提到的和相关上下文中提取所有实体 ID
  const existingEntityIds = new Set<string>();

  // 辅助函数，从上下文中收集实体 ID
  const collectEntityIds = (context: IContext | null) => {
    // 如果上下文为空，直接返回
    if (!context) return;

    // 从资源中收集
    for (const item of context.resources || []) {
      if (item.resource?.resourceId) {
        // 添加资源 ID
        existingEntityIds.add(`resource-${item.resource.resourceId}`);
      }
    }

    // 从文档中收集
    for (const item of context.documents || []) {
      if (item.document?.docId) {
        // 添加文档 ID
        existingEntityIds.add(`document-${item.document.docId}`);
      }
    }

    // 从内容列表中收集
    for (const item of context.contentList || []) {
      // 获取元数据
      const metadata = item.metadata as any as SkillContextContentItemMetadata;
      if (metadata?.entityId && metadata?.domain) {
        // 添加域和实体 ID
        existingEntityIds.add(`${metadata.domain}-${metadata.entityId}`);
      }
    }
  };

  // 从两个上下文中收集实体 ID
  collectEntityIds(mentionedContext);
  collectEntityIds(relevantContext);

  // 过滤掉通过实体 ID 匹配或具有相同内容的库搜索源
  const uniqueLibrarySearchSources = librarySearchSources.filter((source) => {
    // 获取元数据
    const metadata = source.metadata || {};
    // 获取实体类型
    const entityType = metadata.entityType;
    // 获取实体 ID
    const entityId = metadata.entityId;

    // 检查此源是否在提到的或相关上下文中具有匹配的实体 ID
    if (entityType && entityId) {
      // 构建键
      const key = `${entityType}-${entityId}`;
      if (existingEntityIds.has(key)) {
        // 跳过此源，因为它已存在于更高优先级的上下文中
        return false;
      }
    }

    // 检查提到的上下文中是否有重复内容
    if (mentionedContext) {
      // 检查资源中
      if (
        mentionedContext.resources?.some(
          (resource) => resource.resource?.content === source.pageContent,
        )
      ) {
        return false;
      }

      // 检查文档中
      if (
        mentionedContext.documents?.some(
          (document) => document.document?.content === source.pageContent,
        )
      ) {
        return false;
      }

      // 检查内容列表中
      if (mentionedContext.contentList?.some((content) => content.content === source.pageContent)) {
        return false;
      }
    }

    // 检查相关上下文中是否有重复内容
    if (relevantContext) {
      // 检查资源中
      if (
        relevantContext.resources?.some(
          (resource) => resource.resource?.content === source.pageContent,
        )
      ) {
        return false;
      }

      // 检查文档中
      if (
        relevantContext.documents?.some(
          (document) => document.document?.content === source.pageContent,
        )
      ) {
        return false;
      }

      // 检查内容列表中
      if (relevantContext.contentList?.some((content) => content.content === source.pageContent)) {
        return false;
      }
    }

    // 保留此源
    return true;
  });

  // 记录移除了多少项
  const removedCount = librarySearchSources.length - uniqueLibrarySearchSources.length;
  if (removedCount > 0 && logger) {
    logger.log(
      `Removed ${removedCount} duplicate library search sources that already exist in mentioned or relevant context`,
    );
  }

  // 返回唯一的库搜索源
  return uniqueLibrarySearchSources;
}
