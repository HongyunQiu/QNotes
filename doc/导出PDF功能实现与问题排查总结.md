## QNotes 导出 PDF 功能实现与问题排查总结

### 背景与目标
- 为笔记提供“导出为 PDF”的能力，仅导出编辑器正文区域（不包含侧栏与工具栏）。
- 要求导出质量可读、图片/表格/代码等常见块类型正常呈现。
- 不改动后端，优先采用纯前端方案。

### 最终实现方案（稳定版）
- 技术路径：Editor.js 数据 → 静态 HTML 渲染 → html2canvas 截图 → jsPDF 组装多页 PDF。
- 只是用于导出的“只读预览容器”在点击时动态构建并放到视口之外（left: -10000px），避免界面闪烁；导出完成后立即移除。
- 长文分页：将完整截图画布按页高切片，逐页写入 jsPDF，避免内容被裁断。

### 关键实现点
- 数据驱动渲染：调用 `editorInstance.save()` 获取 blocks 数据，前端实现 renderer 将常见块（header/paragraph/checklist/quote/delimiter/image/table/code/mermaid/attaches/warehouse）转成静态 HTML。
- 图片处理：
  - 将相对路径标准化为绝对 URL（`window.location.origin + url`）。
  - 导出前等待图片加载并尝试 `image.decode()`，确保像素解码完成，减少“PDF 中文字有、图片空白”的问题。
- 截图与 PDF：
  - html2canvas 选项：`backgroundColor: '#fff'`, `scale: 2`, `useCORS: true`, `allowTaint: false`, `foreignObjectRendering: false`, `imageTimeout: 15000`。
  - jsPDF：使用 A4、mm 单位，按页高切片写入，保持宽度等比缩放。
- 体验优化：预览容器 fixed 定位并移出视口，避免导出时闪烁。

### 遇到的问题、原因与解决办法
1) 导出为空白（早期）
   - 现象：使用 html2pdf 直接 `.from(previewEl)` 导出，得到空白 PDF。
   - 原因：
     - 预览节点被设置为 `visibility:hidden` 或 `opacity:0` 导致 html2canvas 渲染透明。
     - `html2pdf` 打包版本在当前环境中没有将依赖完整暴露到全局（jsPDF/html2canvas 获取不到）。
   - 解决：
     - 改为在视口内可渲染（后续移到视口外但保持可渲染），避免使用 `visibility:hidden`/`opacity:0`。
     - 明确引入 `jspdf.umd.min.js` 与 `html2canvas.min.js`，并切换到“html2canvas + jsPDF”的直连方案。

2) 测试链路分解定位
   - 现象：`jsPDF 直写` 和 `html2canvas 画布测试` 正常，而 `html2pdf（封装）` 仍空白。
   - 原因：`html2pdf` 封装在当前资源加载/全局导出方式下不稳定。
   - 解决：保留测试用于诊断，正式导出切换到“html2canvas + jsPDF”。

3) 图片在 PDF 中缺失
   - 现象：导出的 PDF 文字正常，图片为空白。
   - 原因：
     - 相对路径/跨域导致 html2canvas 绘制被跳过。
     - 图片未完成解码即截图。
   - 解决：
     - 将图片 URL 标准化为绝对地址；同源情况下不设置 crossOrigin，减少 CORS 干扰。
     - 在截图前等待 `onload`，若浏览器支持则调用 `image.decode()` 保证像素就绪。
     - 调整 html2canvas 选项：`useCORS: true`, `allowTaint: false`, `foreignObjectRendering: false`。

4) 导出时页面闪烁
   - 现象：点击导出时页面会出现一闪而过的导出视图。
   - 原因：导出容器在视口内短暂可见。
   - 解决：导出容器 fixed 定位并移动到视口之外（`left: -10000px`），仍参与布局与渲染，但用户不可见。

### 代码变更清单（要点）
- `public/index.html`
  - 新增：`jspdf.umd.min.js`、`html2canvas.min.js`。
  - 保留一个正式的“导出PDF”按钮，移除调试按钮与 html2pdf 脚本。
- `public/app.js`
  - 新增：
    - `renderEditorDataAsStaticHTML(data)`：将 Editor.js 输出渲染为静态 HTML。
    - `addCanvasToPdfPaged(canvas, doc, marginMm)`：将大画布按页切片写入 PDF。
  - 更新：
    - `exportPdfOfEditorArea()`：构建离屏预览 → 等待布局与图片解码 → html2canvas 截图 → jsPDF 分页导出 → 清理节点。
    - 图片处理为绝对 URL，并在导出前等待 `image.decode()`。
  - 清理：移除调试导出函数与测试按钮绑定。

### 使用说明（前端）
- 在编辑界面点击“导出PDF”即可导出当前笔记标题与正文内容。
- 导出结果包含：标题、段落、清单、引用、分隔线、图片、表格、代码块等常见块类型。

### 后续优化建议
- 版式增强：页眉/页脚、页码、目录、主题样式；为各块类型增加专用打印样式。
- 特殊块支持：Mermaid 可直接克隆已渲染的 SVG 以获得更高保真；`warehouse` 自定义渲染。
- 服务端导出（可选）：采用 Puppeteer 在服务端渲染生成 PDF，获得更一致的排版与更强的分页控制（代价是运维复杂度与资源开销）。

---
本文档总结了导出 PDF 的落地方案、问题根因与修复策略，可为后续维护与功能增强提供参考。

---
### FAQ

- 目前项目产生的PDF，是用的画布实现的，这样文字也被转换成图像了，实际PDF里面的内容是一整张图像。请分析是不是这样。


- 是的。当前导出是先用 html2canvas把预览内容渲染成一张大画布，再把画布按页切成 JPEG 图片写入 jsPDF，因此生成的 PDF 实际上是由位图图像组成，文字不可选/检索。

#### 可选建议
- 若需要可选/可检索文本，需改造为“矢量文本”方案，例如服务端 Puppeteer 渲染，或使用浏览器打印（print CSS）到 PDF 的方式。
- 你需要我把导出切换到可选文本的实现路线吗？
- 请给出路线，并且确定是否必须采用服务端处理，而无法实现在用户端处理

我先给出判断：要实现“PDF内文字可选/可检索（非整页位图）”，不必须上服务端。在纯前端就能做到，有两条实用路线；服务端方案是可选的增强。
可行路线（客户端）
印刷样式 + 浏览器打印为 PDF（推荐起步，实现最快）
做法：
复用你已有的 renderEditorDataAsStaticHTML(data)，渲染出仅含正文的“打印视图”（可放进隐藏 iframe）。
为打印视图加专用 CSS（A4 版心、字号、行距、页边距、分页控制）：
@page { size: A4; margin: 10mm }
对 h1..h6, p, table, pre, figure 添加 break-inside: avoid; page-break-inside: avoid;
图片、表格宽度 100%，避免溢出；代码块 white-space: pre-wrap。
触发 window.print()（或在隐藏 iframe 的 contentWindow.print()）。
优点：文字为矢量、可选可搜；不需要打包大字体；实现复杂度最低；跨平台。
代价：会弹系统打印对话框（用户需点“保存为 PDF”）；分页/页眉页脚可用 CSS 控制但精度有限；不同浏览器呈现略有差异。
可加：引入 Paged.js 强化分页控制（目录、页码、重复页眉/页脚等），仍是纯前端、保留可选文本。
pdfMake（或 jsPDF 文本 API）生成矢量 PDF（单击下载，无打印对话框）
做法：
选型：优先 pdfMake（声明式、表格/段落/样式友好），或 jsPDF + autotable。
将 Editor.js blocks 转换为 pdfMake 的 docDefinition（段落、标题、清单、表格、代码块、图片等）。
中文字体：为 pdfMake 注册中文字体（如 Noto Sans SC / 思源黑体）。字体需以 base64 vfs 方式按需加载，避免常驻体积过大；也可做延迟加载或拆分 Regular/Bold。
图片：将 URL 转为 DataURL（fetch → blob → FileReader）后嵌入。
调用 pdfMake.createPdf(docDefinition).download(filename).
优点：一键下载、可控版式、文本可选；不依赖系统打印；可离线。
代价：需要准备并加载较大的中文字体文件（几 MB 级）；开发工作量高于打印方案（需要写 block→docDefinition 的映射与分页细节）。
可选路线（服务端）
Puppeteer（Headless Chromium）服务端渲染 PDF
做法：服务器起一个 /api/exportPdf/:id，内部用 Puppeteer 打开笔记的只读打印页，套 @media print 样式，调用 page.pdf() 生成返回。
优点：排版一致性最好；分页/页眉页脚能力强；字体内嵌由 Chromium 处理；对客户端最轻。
代价：引入浏览器内核依赖与服务器资源消耗；运维与安全面增加。
是否必须服务端？
结论：不必须。上述两个前端方案都能产出“可选文本”的 PDF。
想要最快上线、改动最小：用“打印为 PDF”+ 打印 CSS（可配合 Paged.js 强化分页）。
想要一键下载、避免打印对话框：用 pdfMake（需解决中文字体体积与按需加载）。
推荐落地顺序
1) 先实现“打印为 PDF”方案，确保文本可选、分页可接受，工期最短。
2) 若需要无对话框的一键下载，再引入 pdfMake，并做按需加载中文字体优化。
3) 如果要求强一致、批量导出、或对分页/页眉页脚有更强需求，再考虑服务端 Puppeteer。
需要的话，我可以按你的选择给出具体实现清单（包含 CSS 规则、调用入口、字体加载策略与 block 映射示例）。