import { Button, Input, Space, Alert } from "@arco-design/web-react"
import type { RefTextAreaType } from "@arco-design/web-react/es/Input/textarea"
import {
  IconMinusCircle,
  IconUpload,
  IconSend,
} from "@arco-design/web-react/icon"
import React, { useEffect, useRef } from "react"

import { TASK_TYPE, type Source } from "~/types"

// 自定义方法
import { scrollToBottom } from "~utils/ui"

// 自定义组件
import WeblinkList from "../weblink-list"
import { ChatHeader } from "./header"
import { SelectedWeblink } from "../selected-weblink/index"
import { QuickAction } from "./quick-action"
// stores
import { useQuickActionStore } from "../../stores/quick-action"
import { useChatStore } from "../../stores/chat"
import { useMessageStateStore } from "~stores/message-state"
import { useSiderStore } from "~stores/sider"
import { useWeblinkStore } from "~stores/weblink"
import { SearchTarget, useSearchStateStore } from "~stores/search-state"
// hooks
import { useBuildTask } from "~hooks/use-build-task"
import { useBuildThreadAndRun } from "~hooks/use-build-thread-and-run"
import { useStoreWeblink } from "~hooks/use-store-weblink"
// 组件
import { IconTip } from "./icon-tip"
import { SearchTargetSelector } from "./home-search-target-selector"
import type { WebLinkItem } from "~components/weblink-list/types"
import { mapSourceFromWeblinkList } from "~utils/weblink"
import { sendToBackground } from "@plasmohq/messaging"
import { useContentSelectorStore } from "~stores/content-selector"

const TextArea = Input.TextArea

type ChatProps = {}

// 用于快速选择
export const quickActionList = ["summary"]

const Home = (props: ChatProps) => {
  const inputRef = useRef<RefTextAreaType>()
  const weblinkListRef = useRef(null)

  // stores
  const quickActionStore = useQuickActionStore()
  const chatStore = useChatStore()
  const messageStateStore = useMessageStateStore()
  const siderStore = useSiderStore()
  const webLinkStore = useWeblinkStore()
  const { searchTarget } = useSearchStateStore()
  const contentSelectorStore = useContentSelectorStore()

  // hooks
  const { runTask, runQuickActionTask } = useBuildThreadAndRun()
  const { isWebLinkIndexed, uploadingStatus, handleUploadWebsite } =
    useStoreWeblink()

  const { buildShutdownTaskAndGenResponse } = useBuildTask()
  const isIntentActive = !!quickActionStore.selectedText
  console.log("selectedText", quickActionStore.selectedText)

  const handleSendMessage = async () => {
    // 如果是当前网页的快捷操作，那么先上传 Website
    // TODO: 这里后续需要处理去重
    if (searchTarget === SearchTarget.CurrentPage) {
      await handleUploadWebsite(window.location.href)
    }

    // 对当前网页进行快速操作
    runQuickActionTask({
      filter: {
        weblinkList: [
          {
            pageContent: "",
            metadata: {
              title: document?.title || "",
              source: location.href,
            },
            score: -1,
          } as Source,
        ],
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()

    if (e.keyCode === 13) {
      handleSendMessage()
    }
  }

  // 自动聚焦输入框
  useEffect(() => {
    if (inputRef.current && siderStore.showSider) inputRef?.current?.focus?.()
  }, [siderStore.showSider])
  // 如果有展示意图，那么也需要滚动到底部
  useEffect(() => {
    scrollToBottom()
  }, [isIntentActive])

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}>
      <ChatHeader />
      <div className="footer input-panel">
        {isWebLinkIndexed ? (
          <Alert
            type="success"
            content="此网页已经被索引，可以直接提问！"
            closable
          />
        ) : (
          <Alert
            type="warning"
            content="此网页未索引，点击下方「阅读」可索引！"
            closable
          />
        )}
        <div className="refly-slogan">The answer engine for your work</div>
        <div className="actions">
          {messageStateStore.taskType === TASK_TYPE.CHAT &&
            messageStateStore?.pending && (
              <div className="stop-reponse">
                <Button
                  type="outline"
                  className="btn"
                  icon={<IconMinusCircle />}
                  onClick={buildShutdownTaskAndGenResponse}>
                  停止响应
                </Button>
              </div>
            )}
        </div>

        <div className="input-box">
          <TextArea
            ref={inputRef}
            className="message-input"
            autoFocus
            value={chatStore?.newQAText}
            onChange={(value) => {
              chatStore.setNewQAText(value)
            }}
            placeholder="Search For Refly..."
            onKeyDownCapture={(e) => handleKeyDown(e)}
            autoSize={{ minRows: 4, maxRows: 4 }}
            onCompositionStart={(e) => console.log("composition start")}
            onCompositionUpdate={(e) => console.log("composition update")}
            onCompositionEnd={(e) => console.log("composition end")}
            style={{
              borderRadius: 8,
              resize: "none",
              minHeight: 98,
              height: 98,
            }}></TextArea>
          <div>
            <div className="toolbar">
              <Space>
                {/* <Button
                  onClick={() => {
                    handleCreateNewConversation()
                  }}
                  icon={<IconPlus />}
                  type="text"
                  shape="round">
                  新会话
                </Button> */}

                <IconTip text="处理当前网页用于问答">
                  <Button
                    onClick={async () => {
                      handleSendMessage()
                    }}
                    icon={<IconUpload />}
                    loading={uploadingStatus === "loading" ? true : false}
                    type="text"
                    style={{ marginRight: 0 }}
                    shape="round">
                    {uploadingStatus === "loading" ? "阅读中" : "阅读"}
                  </Button>
                </IconTip>

                <SearchTargetSelector showText />
              </Space>
              <Button
                shape="circle"
                icon={<IconSend />}
                style={{ color: "#FFF", background: "#00968F" }}
                onClick={() => runTask()}></Button>
            </div>
          </div>
        </div>
        {webLinkStore?.selectedRow?.length > 0 ? (
          <SelectedWeblink
            closable={true}
            selectedWeblinkList={mapSourceFromWeblinkList(
              webLinkStore.selectedRow || [],
            )}
          />
        ) : null}
        {webLinkStore?.selectedRow?.length > 0 ? <QuickAction /> : null}
        <Button
          style={{ color: "#FFF", background: "#00968F" }}
          onClick={() => {
            if (!contentSelectorStore?.isInjectStyles) {
              sendToBackground({
                name: "injectContentSelectorCSS",
              })

              contentSelectorStore?.setIsInjectStyles(true)
            }

            contentSelectorStore.setShowContentSelector(
              !contentSelectorStore.showContentSelector,
            )

            window.postMessage({
              name: "setShowContentSelector",
              payload: {
                showContentSelector: !contentSelectorStore.showContentSelector,
              },
            })
          }}>
          {contentSelectorStore?.showContentSelector ? "取消选择" : "选择元素"}
        </Button>
      </div>

      <WeblinkList
        ref={weblinkListRef}
        getPopupContainer={() => {
          const elem = document
            .querySelector("#refly-main-app")
            ?.shadowRoot?.querySelector(".main")

          return elem as HTMLElement
        }}
      />
    </div>
  )
}

export default Home
