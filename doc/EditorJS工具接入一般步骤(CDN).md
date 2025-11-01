## Editor.js 工具接入一般步骤（CDN 方式）

本文档总结了在 QNotes 中以 CDN 方式接入任一 Editor.js 工具的一般流程，并以 Table 工具为示例。参考资料： [Editor.js Table 官方仓库](https://github.com/editor-js/table)。

### 1. 引入工具的 CDN 脚本

- 已有：项目在 `public/index.html` 中通过 CDN 引入了 Editor.js 核心与常用工具。
- 做法：为待接入的工具追加对应的 CDN `<script>` 引用（通常放在其它 Editor.js 插件之后）。以 Table 为例：

```html
<script src="https://cdn.jsdelivr.net/npm/@editorjs/table@latest"></script>
```

如需兼容 CSP，可参考工具文档提供的 nonce 传递方式（见工具 README）。

### 2. 在初始化前做运行时可用性检查

在 `public/app.js` 的编辑器初始化逻辑（`setupEditor()`）中，为新工具添加可用性检查，避免因网络或脚本加载失败导致的静默错误。例如接入 Table：

```js
if (typeof window.Table === 'undefined') {
  throw new Error('Table 插件未加载');
}
```

将该检查与其它已存在的插件检查放在一起，便于统一排查。

### 3. 在 Editor.js 的 tools 中注册工具

在创建 Editor.js 实例时，将工具加入 `tools` 配置。以 Table 为例：

```js
const tools = {
  // ... 其它工具
  table: {
    class: window.Table,
    inlineToolbar: true,
    config: {
      rows: 2,
      cols: 3,
      maxRows: 5,
      maxCols: 5
    }
  }
};

const editor = new window.EditorJS({
  holder: 'editorjs',
  tools
});
```

工具的可选配置项与输出数据结构以各自 README 为准。以 Table 的输出为例（简化）：

```json
{
  "type": "table",
  "data": {
    "withHeadings": true,
    "stretched": false,
    "content": [["A", "B"], ["1", "2"]]
  }
}
```

### 4.（如有）更新内容白名单/过滤逻辑

若项目对可渲染的块类型有白名单过滤（QNotes 在 `public/app.js` 的 `loadNote()` 中按 `block.type` 过滤），需要将新工具的类型加入允许列表。例如添加 `table`：

```js
data.blocks = data.blocks.filter(block =>
  block.type === 'header' ||
  block.type === 'paragraph' ||
  block.type === 'checklist' ||
  block.type === 'quote' ||
  block.type === 'delimiter' ||
  block.type === 'image' ||
  block.type === 'table' ||
  block.type === 'code' ||
  block.type === 'mermaid' ||
  block.type === 'attaches' ||
  block.type === 'warehouse'
);
```

### 5. 端点/上传（若该工具需要）

部分工具（例如图片、附件）需要后端上传/拉取接口配合。请在 `tools.<name>.config` 中设置 `endpoint` 或 `uploader` 等参数，并确保服务端已实现对应 API。

### 6. 本地验证与故障排查

- 打开浏览器控制台确认：新工具的构造函数在 `window` 上是否存在（例如 `window.Table`）。
- 若报“插件未加载”，检查：
  - `public/index.html` 是否已正确追加 CDN `<script>`；
  - 脚本引入顺序是否晚于 Editor.js 核心脚本；
  - 网络是否可达 CDN。
- 进行一次“创建块 → 保存 → 重新加载”的回归测试，确认数据可正确保存与渲染。

### 7. 参考与扩展

- Table 工具的安装、配置与输出说明参见其 README： [editor-js/table](https://github.com/editor-js/table)
- 若使用严格 CSP，请根据工具 README 使用 `nonce` 方案。

—— 完 ——


