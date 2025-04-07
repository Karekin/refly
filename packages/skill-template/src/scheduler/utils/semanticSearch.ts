import {
  SkillContextContentItem,
  SkillContextResourceItem,
  SkillContextDocumentItem,
  SearchDomain,
  Entity,
} from '@refly-packages/openapi-schema';
import { BaseSkill, SkillRunnableConfig } from '../../base';
import { IContext, GraphState, SkillContextContentItemMetadata } from '../types';
import { countToken } from './token';
import {
  MAX_NEED_RECALL_CONTENT_TOKEN,
  MAX_NEED_RECALL_TOKEN,
  SHORT_CONTENT_THRESHOLD,
} from './constants';
import { DocumentInterface, Document } from '@langchain/core/documents';
import { ContentNodeType, NodeMeta } from '../../engine';
import { truncateTextWithToken } from './truncator';
import {
  MAX_RAG_RELEVANT_CONTENT_RATIO,
  MAX_SHORT_CONTENT_RATIO,
  MAX_RAG_RELEVANT_DOCUMENTS_RATIO,
  MAX_SHORT_DOCUMENTS_RATIO,
  MAX_RAG_RELEVANT_RESOURCES_RATIO,
  MAX_SHORT_RESOURCES_RATIO,
  MAX_URL_SOURCES_TOKENS,
} from './constants';
import { Source } from '@refly-packages/openapi-schema';

// TODO: 替换成实际的 Chunk 定义，然后进行拼接，拼接时包含元数据和分隔符
// 拼接内容片段，按元数据中的 start 属性排序（如果有）
export function assembleChunks(chunks: DocumentInterface[] = []): string {
  // 如果片段有元数据中的 start 属性，按 start 属性排序
  if (chunks?.[0]?.metadata?.start) {
    chunks.sort((a, b) => a.metadata.start - b.metadata.start);
  }

  // 拼接所有片段的内容，用 '\n [...] \n' 作为分隔符
  return chunks.map((chunk) => chunk.pageContent).join('\n [...] \n');
}

// 根据查询和内容片段的相似度对内容片段进行排序
export async function sortContentBySimilarity(
  query: string,
  contentList: SkillContextContentItem[],
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<SkillContextContentItem[]> {
  // 1. 构造文档对象，用于相似度计算
  const documents: Document<NodeMeta>[] = contentList.map((item) => {
    return {
      pageContent: truncateTextWithToken(item.content, MAX_NEED_RECALL_CONTENT_TOKEN),
      metadata: {
        ...item.metadata,
        title: item.metadata?.title as string,
        nodeType: item.metadata?.entityType as ContentNodeType,
      },
    };
  });

  // 2. 使用内存搜索服务对文档进行索引和排序
  const res = await ctx.ctxThis.engine.service.inMemorySearchWithIndexing(
    ctx.config.configurable.user,
    {
      content: documents,
      query,
      k: documents.length,
      filter: undefined,
    },
  );
  const sortedContent = res.data;

  // 4. 返回排序后的内容片段
  return sortedContent.map((item) => ({
    content: item.pageContent,
    metadata: {
      ...item.metadata,
    },
  }));
}

// 根据查询和文档的相似度对文档进行排序
export async function sortDocumentsBySimilarity(
  query: string,
  comingDocuments: SkillContextDocumentItem[],
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<SkillContextDocumentItem[]> {
  // 1. 构造文档对象，用于相似度计算
  const documents: Document<NodeMeta>[] = comingDocuments.map((item) => {
    return {
      pageContent: truncateTextWithToken(item.document?.content || '', MAX_NEED_RECALL_TOKEN),
      metadata: {
        ...item.metadata,
        title: item.document?.title as string,
        nodeType: 'document' as ContentNodeType,
        docId: item.document?.docId,
      },
    };
  });

  // 2. 使用内存搜索服务对文档进行索引和排序
  const res = await ctx.ctxThis.engine.service.inMemorySearchWithIndexing(
    ctx.config.configurable.user,
    {
      content: documents,
      query,
      k: documents.length,
      filter: undefined,
    },
  );
  const sortedDocuments = res.data;

  // 4. 返回排序后的文档
  return sortedDocuments
    .map((item) =>
      comingDocuments.find((document) => document.document?.docId === item.metadata.docId),
    )
    .filter((document): document is SkillContextDocumentItem => document !== undefined);
}

// 根据查询和资源的相似度对资源进行排序
export async function sortResourcesBySimilarity(
  query: string,
  resources: SkillContextResourceItem[],
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<SkillContextResourceItem[]> {
  // 1. 构造文档对象，用于相似度计算
  const documents: Document<NodeMeta>[] = resources.map((item) => {
    return {
      pageContent: truncateTextWithToken(item.resource?.content || '', MAX_NEED_RECALL_TOKEN),
      metadata: {
        ...item.metadata,
        title: item.resource?.title as string,
        nodeType: 'resource' as ContentNodeType,
        resourceId: item.resource?.resourceId,
      },
    };
  });

  // 2. 使用内存搜索服务对文档进行索引和排序
  const res = await ctx.ctxThis.engine.service.inMemorySearchWithIndexing(
    ctx.config.configurable.user,
    {
      content: documents,
      query,
      k: documents.length,
      filter: undefined,
    },
  );
  const sortedResources = res.data;

  // 4. 返回排序后的资源
  return sortedResources
    .map((item) =>
      resources.find((resource) => resource.resource?.resourceId === item.metadata.resourceId),
    )
    .filter((resource): resource is SkillContextResourceItem => resource !== undefined);
}

// 根据相似度处理选定的内容片段，控制 token 数量
export async function processSelectedContentWithSimilarity(
  query: string,
  contentList: SkillContextContentItem[],
  maxTokens: number,
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<SkillContextContentItem[]> {
  // 计算用于相关内容的最大 token 数量
  const MAX_RAG_RELEVANT_CONTENT_MAX_TOKENS = Math.floor(
    maxTokens * MAX_RAG_RELEVANT_CONTENT_RATIO,
  );
  // 计算用于短内容的最大 token 数量
  const _MAX_SHORT_CONTENT_MAX_TOKENS = Math.floor(maxTokens * MAX_SHORT_CONTENT_RATIO);

  if (contentList.length === 0) {
    return [];
  }

  // 1. 计算相似度并排序
  const sortedContent: SkillContextContentItem[] = contentList;

  const result: SkillContextContentItem[] = [];
  let usedTokens = 0;

  // 2. 按相关度顺序处理内容片段
  for (const content of sortedContent) {
    const contentTokens = countToken(content.content);

    if (contentTokens > MAX_NEED_RECALL_CONTENT_TOKEN) {
      // 2.1 大内容，直接走召回
      const contentMeta = content?.metadata as any as SkillContextContentItemMetadata;
      const relevantChunks = await inMemoryGetRelevantChunks(
        query,
        content.content,
        {
          entityId: contentMeta?.entityId,
          title: contentMeta?.title,
          entityType: contentMeta?.domain,
        },
        ctx,
      );
      const relevantContent = assembleChunks(relevantChunks);
      result.push({ ...content, content: relevantContent });
      usedTokens += countToken(relevantContent);
    } else if (usedTokens + contentTokens <= MAX_RAG_RELEVANT_CONTENT_MAX_TOKENS) {
      // 2.2 小内容，直接添加
      result.push(content);
      usedTokens += contentTokens;
    } else {
      // 2.3 达到 MAX_RAG_RELEVANT_CONTENT_MAX_TOKENS，处理剩余内容
      break;
    }

    if (usedTokens >= MAX_RAG_RELEVANT_CONTENT_MAX_TOKENS) break;
  }

  // 3. 处理剩余的内容片段
  for (let i = result.length; i < sortedContent.length; i++) {
    const remainingContent = sortedContent[i];
    const contentTokens = countToken(remainingContent.content);

    // 所有的短内容直接添加
    if (contentTokens < SHORT_CONTENT_THRESHOLD) {
      result.push(remainingContent);
      usedTokens += contentTokens;
    } else {
      // 剩下的长内容走召回
      const remainingTokens = maxTokens - usedTokens;
      const contentMeta = remainingContent?.metadata as any as SkillContextContentItemMetadata;
      let relevantChunks = await inMemoryGetRelevantChunks(
        query,
        remainingContent.content,
        {
          entityId: contentMeta?.entityId,
          title: contentMeta?.title,
          entityType: contentMeta?.domain,
        },
        ctx,
      );
      relevantChunks = truncateChunks(relevantChunks, remainingTokens);
      const relevantContent = assembleChunks(relevantChunks);
      result.push({ ...remainingContent, content: relevantContent });
      usedTokens += countToken(relevantContent);
    }

    if (usedTokens >= maxTokens) break;
  }

  return result;
}

// 根据相似度处理文档，控制 token 数量
export async function processDocumentsWithSimilarity(
  query: string,
  comingDocuments: SkillContextDocumentItem[],
  maxTokens: number,
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<SkillContextDocumentItem[]> {
  // 计算用于相关文档的最大 token 数量
  const MAX_RAG_RELEVANT_DOCUMENTS_MAX_TOKENS = Math.floor(
    maxTokens * MAX_RAG_RELEVANT_DOCUMENTS_RATIO,
  );
  // 计算用于短文档的最大 token 数量
  const _MAX_SHORT_DOCUMENTS_MAX_TOKENS = Math.floor(maxTokens * MAX_SHORT_DOCUMENTS_RATIO);

  if (comingDocuments.length === 0) {
    return [];
  }

  // 1. 计算相似度并排序
  let sortedDocuments: SkillContextDocumentItem[] = [];
  if (comingDocuments.length > 1) {
    sortedDocuments = await sortDocumentsBySimilarity(query, comingDocuments, ctx);
  } else {
    sortedDocuments = comingDocuments;
  }

  const result: SkillContextDocumentItem[] = [];
  let usedTokens = 0;

  // 2. 按相关度顺序处理文档
  for (const document of sortedDocuments) {
    const documentTokens = countToken(document?.document?.content || '');

    if (
      documentTokens > MAX_NEED_RECALL_TOKEN ||
      (typeof document?.metadata?.useWholeContent === 'boolean' &&
        !document.metadata?.useWholeContent)
    ) {
      // 1.1 大内容，直接走召回
      let relevantChunks = await knowledgeBaseSearchGetRelevantChunks(
        query,
        {
          entities: [
            {
              entityId: document?.document?.docId,
              entityType: 'document',
            },
          ],
          domains: ['document'],
          limit: 10,
        },
        ctx,
      );

      // 如果知识库搜索返回空结果，回退到内存搜索
      if (!relevantChunks || relevantChunks.length === 0) {
        relevantChunks = await inMemoryGetRelevantChunks(
          query,
          document?.document?.content || '',
          {
            entityId: document?.document?.docId,
            title: document?.document?.title || '',
            entityType: 'document',
          },
          ctx,
        );
      }

      const relevantContent = assembleChunks(relevantChunks);
      result.push({ ...document, document: { ...document.document, content: relevantContent } });
      usedTokens += countToken(relevantContent);
    } else if (usedTokens + documentTokens <= MAX_RAG_RELEVANT_DOCUMENTS_MAX_TOKENS) {
      // 1.2 小内容，直接添加
      result.push(document);
      usedTokens += documentTokens;
    } else {
      // 1.3 达到 MAX_RAG_RELEVANT_DOCUMENTS_MAX_TOKENS，处理剩余内容
      break;
    }

    if (usedTokens >= MAX_RAG_RELEVANT_DOCUMENTS_MAX_TOKENS) break;
  }

  // 3. 处理剩余的文档
  for (let i = result.length; i < sortedDocuments.length; i++) {
    const remainingDocument = sortedDocuments[i];
    const documentTokens = countToken(remainingDocument?.document?.content || '');

    // 所有的短内容直接添加
    if (documentTokens < SHORT_CONTENT_THRESHOLD) {
      result.push(remainingDocument);
      usedTokens += documentTokens;
    } else {
      // 剩下的长内容走召回
      const remainingTokens = maxTokens - usedTokens;
      let relevantChunks = await knowledgeBaseSearchGetRelevantChunks(
        query,
        {
          entities: [
            {
              entityId: remainingDocument?.document?.docId,
              entityType: 'document',
            },
          ],
          domains: ['document'],
          limit: 10,
        },
        ctx,
      );

      // 如果知识库搜索返回空结果，回退到内存搜索
      if (!relevantChunks || relevantChunks.length === 0) {
        relevantChunks = await inMemoryGetRelevantChunks(
          query,
          remainingDocument?.document?.content || '',
          {
            entityId: remainingDocument?.document?.docId,
            title: remainingDocument?.document?.title || '',
            entityType: 'document',
          },
          ctx,
        );
      }

      relevantChunks = truncateChunks(relevantChunks, remainingTokens);
      const relevantContent = assembleChunks(relevantChunks);
      result.push({
        ...remainingDocument,
        document: { ...remainingDocument.document, content: relevantContent },
      });
      usedTokens += countToken(relevantContent);
    }
  }

  return result;
}

// 根据相似度处理资源，控制 token 数量
export async function processResourcesWithSimilarity(
  query: string,
  resources: SkillContextResourceItem[],
  maxTokens: number,
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<SkillContextResourceItem[]> {
  // 计算用于相关资源的最大 token 数量
  const MAX_RAG_RELEVANT_RESOURCES_MAX_TOKENS = Math.floor(
    maxTokens * MAX_RAG_RELEVANT_RESOURCES_RATIO,
  );
  // 计算用于短资源的最大 token 数量
  const _MAX_SHORT_RESOURCES_MAX_TOKENS = Math.floor(maxTokens * MAX_SHORT_RESOURCES_RATIO);

  if (resources.length === 0) {
    return [];
  }

  // 1. 计算相似度并排序
  let sortedResources: SkillContextResourceItem[] = [];
  if (resources.length > 1) {
    sortedResources = await sortResourcesBySimilarity(query, resources, ctx);
  } else {
    sortedResources = resources;
  }

  const result: SkillContextResourceItem[] = [];
  let usedTokens = 0;

  // 2. 按相关度顺序处理资源
  for (const resource of sortedResources) {
    const resourceTokens = countToken(resource?.resource?.content || '');

    if (resourceTokens > MAX_NEED_RECALL_TOKEN || !resource.metadata?.useWholeContent) {
      // 2.1 大内容，直接走召回
      let relevantChunks = await knowledgeBaseSearchGetRelevantChunks(
        query,
        {
          entities: [
            {
              entityId: resource?.resource?.resourceId,
              entityType: 'resource',
            },
          ],
          domains: ['resource'],
          limit: 10,
        },
        ctx,
      );

      // 如果知识库搜索返回空结果，回退到内存搜索
      if (!relevantChunks || relevantChunks.length === 0) {
        relevantChunks = await inMemoryGetRelevantChunks(
          query,
          resource?.resource?.content || '',
          {
            entityId: resource?.resource?.resourceId,
            title: resource?.resource?.title || '',
            entityType: 'resource',
          },
          ctx,
        );
      }

      const relevantContent = assembleChunks(relevantChunks);
      result.push({ ...resource, resource: { ...resource.resource, content: relevantContent } });
      usedTokens += countToken(relevantContent);
    } else if (usedTokens + resourceTokens <= MAX_RAG_RELEVANT_RESOURCES_MAX_TOKENS) {
      // 2.2 小内容，直接添加
      result.push(resource);
      usedTokens += resourceTokens;
    } else {
      // 2.3 达到 MAX_RAG_RELEVANT_RESOURCES_MAX_TOKENS，处理剩余内容
      break;
    }

    if (usedTokens >= MAX_RAG_RELEVANT_RESOURCES_MAX_TOKENS) break;
  }

  // 3. 处理剩余的资源
  for (let i = result.length; i < sortedResources.length; i++) {
    const remainingResource = sortedResources[i];
    const resourceTokens = countToken(remainingResource?.resource?.content || '');

    // 所有的短内容直接添加
    if (resourceTokens < SHORT_CONTENT_THRESHOLD) {
      result.push(remainingResource);
      usedTokens += resourceTokens;
    } else {
      // 长内容走召回
      const remainingTokens = maxTokens - usedTokens;
      let relevantChunks = await knowledgeBaseSearchGetRelevantChunks(
        query,
        {
          entities: [
            {
              entityId: remainingResource?.resource?.resourceId,
              entityType: 'resource',
            },
          ],
          domains: ['resource'],
          limit: 10,
        },
        ctx,
      );

      // 如果知识库搜索返回空结果，回退到内存搜索
      if (!relevantChunks || relevantChunks.length === 0) {
        relevantChunks = await inMemoryGetRelevantChunks(
          query,
          remainingResource?.resource?.content || '',
          {
            entityId: remainingResource?.resource?.resourceId,
            title: remainingResource?.resource?.title || '',
            entityType: 'resource',
          },
          ctx,
        );
      }

      relevantChunks = truncateChunks(relevantChunks, remainingTokens);
      const relevantContent = assembleChunks(relevantChunks);
      result.push({
        ...remainingResource,
        resource: { ...remainingResource.resource, content: relevantContent },
      });
      usedTokens += countToken(relevantContent);
    }
  }

  return result;
}

// 根据相似度处理提到的上下文，控制 token 数量
export async function processMentionedContextWithSimilarity(
  query: string,
  mentionedContext: IContext,
  maxTokens: number,
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<IContext> {
  // 设置内容、资源和文档的最大 token 比例
  const MAX_CONTENT_RAG_RELEVANT_RATIO = 0.4;
  const MAX_RESOURCE_RAG_RELEVANT_RATIO = 0.3;
  const MAX_DOCUMENT_RAG_RELEVANT_RATIO = 0.3;

  // 计算每种类型的最大 token 数量
  const MAX_CONTENT_RAG_RELEVANT_MAX_TOKENS = Math.floor(
    maxTokens * MAX_CONTENT_RAG_RELEVANT_RATIO,
  );
  const MAX_RESOURCE_RAG_RELEVANT_MAX_TOKENS = Math.floor(
    maxTokens * MAX_RESOURCE_RAG_RELEVANT_RATIO,
  );
  const MAX_DOCUMENT_RAG_RELEVANT_MAX_TOKENS = Math.floor(
    maxTokens * MAX_DOCUMENT_RAG_RELEVANT_RATIO,
  );

  // 处理 contentList
  const processedContentList = await processSelectedContentWithSimilarity(
    query,
    mentionedContext.contentList,
    MAX_CONTENT_RAG_RELEVANT_MAX_TOKENS,
    ctx,
  );

  // 处理 resources
  const processedResources = await processResourcesWithSimilarity(
    query,
    mentionedContext.resources,
    MAX_RESOURCE_RAG_RELEVANT_MAX_TOKENS,
    ctx,
  );

  // 处理 documents
  const processedDocuments = await processDocumentsWithSimilarity(
    query,
    mentionedContext.documents,
    MAX_DOCUMENT_RAG_RELEVANT_MAX_TOKENS,
    ctx,
  );

  // 返回处理后的上下文
  return {
    ...mentionedContext,
    contentList: processedContentList,
    resources: processedResources,
    documents: processedDocuments,
  };
}

// 从知识库中检索相关的片段
export async function knowledgeBaseSearchGetRelevantChunks(
  query: string,
  metadata: { entities: Entity[]; domains: SearchDomain[]; limit: number },
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<DocumentInterface[]> {
  try {
    // 1. 搜索功能，检索相关的片段
    const res = await ctx.ctxThis.engine.service.search(
      ctx.config.configurable.user,
      {
        query,
        entities: metadata.entities,
        mode: 'vector',
        limit: metadata.limit,
        domains: metadata.domains,
      },
      { enableReranker: false },
    );
    const relevantChunks = res?.data?.map((item) => ({
      id: item.id,
      pageContent: item?.snippets?.map((s) => s.text).join('\n\n') || '',
      metadata: {
        ...item.metadata,
        title: item.title,
        domain: item.domain,
      },
    }));

    return relevantChunks || [];
  } catch (error) {
    // 如果检索失败，记录错误并返回空数组
    ctx.ctxThis.engine.logger.error(`Error in knowledgeBaseSearchGetRelevantChunks: ${error}`);
    return [];
  }
}

// TODO: 召回有问题，需要优化
// 从内存中检索相关的片段
export async function inMemoryGetRelevantChunks(
  query: string,
  content: string,
  metadata: { entityId: string; title: string; entityType: ContentNodeType },
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<DocumentInterface[]> {
  try {
    // 1. 获取相关的片段
    const doc: Document<NodeMeta> = {
      pageContent: content,
      metadata: {
        nodeType: metadata.entityType,
        entityType: metadata.entityType,
        title: metadata.title,
        entityId: metadata.entityId,
        tenantId: ctx.config.configurable.user.uid,
      },
    };
    const res = await ctx.ctxThis.engine.service.inMemorySearchWithIndexing(
      ctx.config.configurable.user,
      {
        content: doc,
        query,
        k: 10,
        filter: undefined,
        needChunk: true,
        additionalMetadata: {},
      },
    );
    const relevantChunks = res.data as DocumentInterface[];

    return relevantChunks;
  } catch (error) {
    // 如果向量处理失败，返回截断后的内容
    ctx.ctxThis.engine.logger.error(`Error in inMemoryGetRelevantChunks: ${error}`);

    // 提供截断后的内容作为回退
    const truncatedContent = truncateTextWithToken(content, MAX_NEED_RECALL_TOKEN);
    return [
      {
        pageContent: truncatedContent,
        metadata: {
          nodeType: metadata.entityType,
          entityType: metadata.entityType,
          title: metadata.title,
          entityId: metadata.entityId,
        },
      } as DocumentInterface,
    ];
  }
}

// 截断片段，使其不超过指定的 token 数量
export function truncateChunks(
  chunks: DocumentInterface[],
  maxTokens: number,
): DocumentInterface[] {
  const result: DocumentInterface[] = [];
  let usedTokens = 0;

  for (const chunk of chunks) {
    const chunkTokens = countToken(chunk.pageContent);
    if (usedTokens + chunkTokens <= maxTokens) {
      result.push(chunk as DocumentInterface);
      usedTokens += chunkTokens;
    } else {
      break;
    }
  }

  return result;
}

// 根据相似度处理 URL 来源，控制 token 数量
export async function processUrlSourcesWithSimilarity(
  query: string,
  urlSources: Source[],
  maxTokens: number,
  ctx: { config: SkillRunnableConfig; ctxThis: BaseSkill; state: GraphState },
): Promise<Source[]> {
  // 设置 URL 来源的最大 token 比例
  const MAX_RAG_RELEVANT_URLS_RATIO = 0.7; // 70% 的 token 用于高相关的内容
  const MAX_RAG_RELEVANT_URLS_MAX_TOKENS = Math.floor(maxTokens * MAX_RAG_RELEVANT_URLS_RATIO);

  if (urlSources.length === 0) {
    return [];
  }

  const result: Source[] = [];
  let usedTokens = 0;
  const sortedSources = urlSources;

  // 2. 按相关度顺序处理 URL 来源
  for (const source of sortedSources) {
    const sourceTokens = countToken(source.pageContent || '');

    if (sourceTokens > MAX_NEED_RECALL_TOKEN) {
      // 2.1 大内容，使用内存召回
      const relevantChunks = await inMemoryGetRelevantChunks(
        query,
        source?.pageContent?.slice(0, MAX_URL_SOURCES_TOKENS) || '',
        {
          entityId: source.url || '',
          title: source.title || '',
          entityType: 'urlSource' as ContentNodeType,
        },
        ctx,
      );
      const relevantContent = assembleChunks(relevantChunks);
      result.push({
        ...source,
        pageContent: relevantContent,
      });
      usedTokens += countToken(relevantContent);
    } else if (usedTokens + sourceTokens <= MAX_RAG_RELEVANT_URLS_MAX_TOKENS) {
      // 2.2 小内容，直接添加
      result.push(source);
      usedTokens += sourceTokens;
    } else {
      // 2.3 达到 MAX_RAG_RELEVANT_URLS_MAX_TOKENS，处理剩余内容
      break;
    }

    if (usedTokens >= MAX_RAG_RELEVANT_URLS_MAX_TOKENS) break;
  }

  // 3. 处理剩余的 URL 来源
  for (let i = result.length; i < sortedSources.length; i++) {
    const remainingSource = sortedSources[i];
    const sourceTokens = countToken(remainingSource.pageContent || '');

    // 所有的短内容直接添加
    if (sourceTokens < SHORT_CONTENT_THRESHOLD) {
      result.push(remainingSource);
      usedTokens += sourceTokens;
    } else {
      // 剩下的长内容使用内存召回
      const remainingTokens = maxTokens - usedTokens;
      let relevantChunks = await inMemoryGetRelevantChunks(
        query,
        remainingSource?.pageContent?.slice(0, MAX_URL_SOURCES_TOKENS) || '',
        {
          entityId: remainingSource.url || '',
          title: remainingSource.title || '',
          entityType: 'urlSource' as ContentNodeType,
        },
        ctx,
      );
      relevantChunks = truncateChunks(relevantChunks, remainingTokens);
      const relevantContent = assembleChunks(relevantChunks);
      result.push({
        ...remainingSource,
        pageContent: relevantContent,
      });
      usedTokens += countToken(relevantContent);
    }

    if (usedTokens >= maxTokens) break;
  }

  // 记录处理的 URL 来源数量
  ctx.ctxThis.engine.logger.log(`Processed URL sources: ${result.length} of ${urlSources.length}`);
  return result;
}
