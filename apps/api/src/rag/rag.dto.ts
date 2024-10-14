import { ResourceType } from '@refly-packages/openapi-schema';

export type ContentNodeType = 'resource' | 'note';

export interface NodeMeta {
  title: string;
  nodeType: ContentNodeType;
  url?: string;
  noteId?: string;
  resourceId?: string;
  resourceType?: ResourceType;
  [key: string]: any; // any other fields
}

export interface ContentPayload extends NodeMeta {
  seq: number;
  content: string;
}

export interface ContentNode {
  id: string;
  vector: number[];
  payload: ContentPayload;
}

export interface RetrieveFilter {
  nodeTypes?: ContentNodeType[];
  urls?: string[];
  noteIds?: string[];
  resourceIds?: string[];
  collectionIds?: string[];
}

export interface HybridSearchParam {
  query: string;
  vector?: number[];
  filter?: RetrieveFilter;
  limit?: number;
}

export interface ReaderResult {
  code: number;
  status: number;
  data: {
    title: string;
    url: string;
    content: string;
    publishedTime?: string;
  };
}
