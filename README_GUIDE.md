# Refly 项目后端工程分析

根据代码库结构，Refly 项目的后端主要集中在以下几个目录：

## 1. 核心后端模块

### `/Volumes/karekinSSD1/project/refly/packages/skill-template`

这是项目的核心技能模板模块，包含了大量的后端逻辑：

- **技能实现**：
  - 各种技能模板如 `ArxivSummarySkill`、`WebsiteSummarySkill`、`BasicSummarySkill` 等
  - 通用问答技能 `CommonQnA`
  - 代码生成技能 `CodeArtifacts`
  - 文档生成技能 `GenerateDoc`
  - 网页搜索技能 `WebSearch`
  - 自定义提示词技能 `CustomPrompt`

- **调度器**：
  - 查询处理 (`queryProcessor`)
  - 上下文准备 (`context`)
  - 消息构建 (`message`)
  - 多语言搜索 (`multiLingualSearch`)
  - 后续问题处理 (`followup`)

- **工具**：
  - 网页搜索工具 `SerperSearch`
  - URL 处理工具 (`url-processing`)
  - CDN 过滤器 (`cdn-filter`)

### `/Volumes/karekinSSD1/project/refly/packages/skill-template/src/engine`

引擎模块，提供了与各种服务交互的接口：

- 画布管理
- 文档管理
- 资源管理
- 标签管理
- 搜索功能
- 网页爬取功能

### `/Volumes/karekinSSD1/project/refly/apps/api`

API 服务应用，虽然没有直接展示代码，但从项目结构可以看出这是一个独立的后端 API 服务。

## 2. 辅助后端模块

### `/Volumes/karekinSSD1/project/refly/packages/openapi-schema`

OpenAPI 模式定义，包含了 API 接口的类型定义和服务生成。

### `/Volumes/karekinSSD1/project/refly/packages/utils`

工具库，包含各种后端使用的工具函数。

### `/Volumes/karekinSSD1/project/refly/packages/wxt`

扩展开发工具，提供了存储、配置等功能。

## 3. 后端功能特点

1. **AI 技能系统**：
   - 基于 LangChain 构建的技能系统
   - 支持状态图（StateGraph）进行复杂的工作流程管理
   - 提供各种专业领域的技能模板

2. **多语言支持**：
   - 查询翻译
   - 结果翻译
   - 多语言搜索优化

3. **内容处理**：
   - 网页爬取和内容提取
   - PDF 处理（特别是 Arxiv 论文）
   - 上下文准备和截断

4. **搜索系统**：
   - 网页搜索
   - 知识库搜索
   - 结果重排序

5. **资源管理**：
   - 文档创建和管理
   - 资源创建和更新
   - 画布管理

## 4. 技术栈

后端主要使用了以下技术：

- **TypeScript/Node.js**：主要开发语言
- **LangChain**：AI 工作流框架
- **Zod**：类型验证
- **REST API**：服务间通信

这个后端架构设计围绕 AI 能力构建，专注于内容处理、知识管理和智能技能实现，形成了一个完整的 AI 内容创建引擎的后端系统。