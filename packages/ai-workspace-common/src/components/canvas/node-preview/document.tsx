import { lazy, useEffect, useState } from 'react';
import ResourceDeck from '@refly-packages/ai-workspace-common/components/resource-view/resource-deck';
import { useReferencesStoreShallow } from '@refly-packages/ai-workspace-common/stores/references';
import { CanvasNode } from '@refly-packages/ai-workspace-common/components/canvas/nodes';

const DocumentEditor = lazy(() => import('@refly-packages/ai-workspace-common/components/document'));

interface DocumentNodePreviewProps {
  nodeData?: {
    entityId?: string;
    entityType?: 'document' | 'resource';
    node: CanvasNode<any>;
  };
}

export const DocumentNodePreview = ({ nodeData }: DocumentNodePreviewProps) => {
  // Get deck size from references store
  const [deckSize, setDeckSize] = useState<number>(0);

  // Early return if no node data
  if (!nodeData?.entityId || !nodeData?.entityType) {
    return <div className="h-full flex items-center justify-center text-gray-500">No document data available</div>;
  }

  const { entityId, entityType, node } = nodeData;

  return (
    <div className="h-full overflow-hidden">
      <DocumentEditor docId={entityId} deckSize={deckSize} setDeckSize={setDeckSize} node={node} />
      {/* <Splitter
        layout="vertical"
        onResize={(sizes) => {
          setDeckSize(sizes[1]);
        }}
      > */}
      {/* <Splitter.Panel>
          <DocumentEditor docId={entityId} deckSize={deckSize} setDeckSize={setDeckSize} />
        </Splitter.Panel> */}

      {/* Only render deck panel if we have valid entity */}
      {/* {entityId && (
          <Splitter.Panel size={deckSize} max={'80%'} collapsible>
            <ResourceDeck domain={entityType} id={entityId} />
          </Splitter.Panel>
        )} */}
      {/* </Splitter> */}
    </div>
  );
};
