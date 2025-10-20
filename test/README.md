# Editor.js 功能测试

基于 [Vue+HTML5+Editor.js 富文本编辑器全攻略](https://www.oryoy.com/news/jie-mi-vue-html5-editor-js-da-zao-gao-xiao-fu-wen-ben-bian-ji-qi-quan-gong-lve.html) 创建的 Editor.js 基本功能测试文件。

## 文件说明

- `editor-test.html` - 测试页面主文件
- `editor-test.js` - 测试功能实现脚本
- `editor-test.css` - 测试页面样式文件
- `README.md` - 说明文档

## 功能特性

### 基本功能测试
- ✅ Editor.js 初始化
- ✅ 标题编辑 (Header)
- ✅ 段落编辑 (Paragraph)
- ✅ 列表编辑 (List)
- ✅ 内容保存和加载
- ✅ 编辑器清空
- ✅ 图片块插入

### 测试功能
1. **初始化编辑器** - 创建 Editor.js 实例并加载默认内容
2. **保存内容** - 将编辑器内容转换为 JSON 格式并显示
3. **加载内容** - 重新加载之前保存的内容
4. **清空编辑器** - 清除所有编辑器内容
5. **添加图片块** - 测试媒体插入功能

## 使用方法

1. 在浏览器中打开 `editor-test.html` 文件
2. 点击"初始化编辑器"按钮创建编辑器实例
3. 在编辑器中输入和编辑内容
4. 使用各种测试按钮验证功能

## 技术实现

### Editor.js 配置
```javascript
const editorConfig = {
    holder: 'editorjs',
    tools: {
        header: {
            class: Header,
            config: {
                placeholder: '输入标题',
                levels: [1, 2, 3, 4, 5, 6],
                defaultLevel: 2
            }
        },
        paragraph: {
            class: Paragraph,
            inlineToolbar: true,
            config: {
                placeholder: '输入段落内容...'
            }
        },
        list: {
            class: List,
            inlineToolbar: true,
            config: {
                defaultStyle: 'unordered'
            }
        }
    }
};
```

### 核心功能
- **EditorTest 类** - 封装所有测试功能
- **事件绑定** - 处理用户交互
- **错误处理** - 完善的错误捕获和提示
- **消息提示** - 用户友好的操作反馈

## 样式特性

- 现代化的 UI 设计
- 响应式布局支持
- 渐变背景和阴影效果
- 动画过渡效果
- 移动端适配

## 故障排除

### "List not defined" 错误
如果遇到 "List not defined" 或类似错误，说明 Editor.js 插件加载失败：

1. **检查网络连接** - 确保能访问 CDN
2. **使用本地版本** - 打开 `editor-test-local.html` 使用本地文件
3. **查看控制台** - 检查具体的加载错误信息
4. **刷新页面** - 重新加载页面

### 解决方案
- **方案1**: 使用 `editor-test-simple.html` (推荐) - 只使用Header和Paragraph插件
- **方案2**: 使用 `editor-test-local.html` - 使用本地node_modules文件
- **方案3**: 检查防火墙设置，确保能访问 jsdelivr.net
- **方案4**: 使用 VPN 或更换网络环境

## 注意事项

1. 需要网络连接加载 Editor.js CDN 资源
2. 建议使用现代浏览器以获得最佳体验
3. 测试文件为独立运行，不依赖项目其他部分
4. 如果CDN加载失败，请使用本地版本

## 扩展建议

- 添加更多 Editor.js 插件测试
- 集成图片上传功能
- 添加协作编辑测试
- 实现内容导出功能
