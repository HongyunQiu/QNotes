// Editor.js 功能测试脚本
class EditorTest {
    constructor() {
        this.editor = null;
        this.savedData = null;
        this.init();
    }

    init() {
        // 绑定事件监听器
        this.bindEvents();
        
        // 检查Editor.js是否加载成功
        this.checkEditorJS();
    }

    checkEditorJS() {
        window.addEventListener('load', () => {
            console.log('页面加载完成');
            console.log('EditorJS:', typeof window.EditorJS);
            console.log('Header:', typeof window.Header);
            console.log('List:', typeof window.List);
            console.log('Paragraph:', typeof window.Paragraph);
            
            // 检查所有必需的插件
            const requiredPlugins = ['EditorJS', 'Header', 'List', 'Paragraph'];
            const missingPlugins = [];
            
            if (typeof window.EditorJS === 'undefined') missingPlugins.push('EditorJS');
            if (typeof window.Header === 'undefined') missingPlugins.push('Header');
            if (typeof window.List === 'undefined') missingPlugins.push('List');
            if (typeof window.Paragraph === 'undefined') missingPlugins.push('Paragraph');
            
            if (missingPlugins.length > 0) {
                console.error('以下插件加载失败:', missingPlugins);
                this.showMessage(`插件加载失败: ${missingPlugins.join(', ')}，请检查网络连接`, 'error');
            } else {
                console.log('所有插件加载成功');
                this.showMessage('所有插件加载成功，可以开始测试', 'success');
            }
        });
    }

    bindEvents() {
        document.getElementById('init-editor').addEventListener('click', () => this.initEditor());
        document.getElementById('save-content').addEventListener('click', () => this.saveContent());
        document.getElementById('load-content').addEventListener('click', () => this.loadContent());
        document.getElementById('clear-editor').addEventListener('click', () => this.clearEditor());
        document.getElementById('add-image').addEventListener('click', () => this.addImageBlock());
    }

    initEditor() {
        try {
            // 检查插件是否加载
            if (typeof window.EditorJS === 'undefined') {
                throw new Error('EditorJS 未加载');
            }
            if (typeof window.Header === 'undefined') {
                throw new Error('Header 插件未加载');
            }
            if (typeof window.Paragraph === 'undefined') {
                throw new Error('Paragraph 插件未加载');
            }
            
            // 特殊处理List插件
            if (typeof window.List === 'undefined') {
                console.warn('List插件未加载，尝试重新加载...');
                this.loadListPlugin();
                throw new Error('List 插件未加载，请稍后重试');
            }

            // 销毁现有编辑器实例
            if (this.editor) {
                this.editor.destroy();
            }

            // 创建Editor.js配置
            const editorConfig = {
                holder: 'editorjs',
                tools: {
                    header: {
                        class: window.Header,
                        config: {
                            placeholder: '输入标题',
                            levels: [1, 2, 3, 4, 5, 6],
                            defaultLevel: 2
                        }
                    },
                    paragraph: {
                        class: window.Paragraph,
                        inlineToolbar: true,
                        config: {
                            placeholder: '输入段落内容...'
                        }
                    },
                    list: {
                        class: window.List,
                        inlineToolbar: true,
                        config: {
                            defaultStyle: 'unordered'
                        }
                    }
                },
                data: {
                    time: Date.now(),
                    blocks: [
                        {
                            type: "header",
                            data: {
                                text: "欢迎使用Editor.js测试",
                                level: 1
                            }
                        },
                        {
                            type: "paragraph",
                            data: {
                                text: "这是一个基于Vue+HTML5+Editor.js的富文本编辑器测试页面。您可以在这里测试各种编辑功能。"
                            }
                        },
                        {
                            type: "list",
                            data: {
                                style: "unordered",
                                items: [
                                    "支持标题编辑",
                                    "支持段落编辑", 
                                    "支持列表编辑",
                                    "支持图片插入"
                                ]
                            }
                        }
                    ]
                },
                onChange: (api, event) => {
                    console.log('编辑器内容发生变化:', event);
                }
            };

            // 创建Editor.js实例
            this.editor = new window.EditorJS(editorConfig);
            
            this.showMessage('编辑器初始化成功', 'success');
            console.log('Editor.js实例创建成功:', this.editor);

        } catch (error) {
            console.error('编辑器初始化失败:', error);
            this.showMessage('编辑器初始化失败: ' + error.message, 'error');
        }
    }

    async saveContent() {
        if (!this.editor) {
            this.showMessage('请先初始化编辑器', 'warning');
            return;
        }

        try {
            const outputData = await this.editor.save();
            this.savedData = outputData;
            
            // 显示JSON格式的输出
            const outputElement = document.getElementById('output');
            outputElement.innerHTML = `
                <h4>保存的数据 (JSON格式):</h4>
                <pre>${JSON.stringify(outputData, null, 2)}</pre>
            `;
            
            this.showMessage('内容保存成功', 'success');
            console.log('保存的数据:', outputData);

        } catch (error) {
            console.error('保存内容失败:', error);
            this.showMessage('保存内容失败: ' + error.message, 'error');
        }
    }

    async loadContent() {
        if (!this.savedData) {
            this.showMessage('没有可加载的内容，请先保存', 'warning');
            return;
        }

        if (!this.editor) {
            this.showMessage('请先初始化编辑器', 'warning');
            return;
        }

        try {
            await this.editor.render(this.savedData);
            this.showMessage('内容加载成功', 'success');
            console.log('加载的数据:', this.savedData);

        } catch (error) {
            console.error('加载内容失败:', error);
            this.showMessage('加载内容失败: ' + error.message, 'error');
        }
    }

    clearEditor() {
        if (!this.editor) {
            this.showMessage('请先初始化编辑器', 'warning');
            return;
        }

        try {
            // 清空编辑器内容
            this.editor.clear();
            document.getElementById('output').innerHTML = '';
            this.savedData = null;
            
            this.showMessage('编辑器已清空', 'success');

        } catch (error) {
            console.error('清空编辑器失败:', error);
            this.showMessage('清空编辑器失败: ' + error.message, 'error');
        }
    }

    addImageBlock() {
        if (!this.editor) {
            this.showMessage('请先初始化编辑器', 'warning');
            return;
        }

        try {
            // 添加图片块
            this.editor.blocks.insert('paragraph', {
                text: '📷 这里可以插入图片内容'
            });
            
            this.showMessage('图片块添加成功', 'success');

        } catch (error) {
            console.error('添加图片块失败:', error);
            this.showMessage('添加图片块失败: ' + error.message, 'error');
        }
    }

    loadListPlugin() {
        // 尝试从多个CDN源加载List插件
        const cdnSources = [
            'https://unpkg.com/@editorjs/list@latest',
            'https://cdn.skypack.dev/@editorjs/list',
            'https://cdn.jsdelivr.net/npm/@editorjs/list@2.0.8/dist/bundle.js'
        ];
        
        let attemptCount = 0;
        
        const tryLoadFromCDN = () => {
            if (attemptCount >= cdnSources.length) {
                console.error('所有CDN源都无法加载List插件');
                this.showMessage('List插件加载失败，请使用本地版本', 'error');
                return;
            }
            
            const script = document.createElement('script');
            script.src = cdnSources[attemptCount];
            script.onload = () => {
                console.log(`List插件从 ${cdnSources[attemptCount]} 加载成功`);
                this.showMessage('List插件加载成功，请重新点击初始化', 'success');
            };
            script.onerror = () => {
                console.warn(`从 ${cdnSources[attemptCount]} 加载List插件失败`);
                attemptCount++;
                setTimeout(tryLoadFromCDN, 1000);
            };
            document.head.appendChild(script);
        };
        
        tryLoadFromCDN();
    }

    showMessage(message, type = 'info') {
        // 创建消息提示
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${type}`;
        messageDiv.textContent = message;
        
        // 添加到页面顶部
        document.body.insertBefore(messageDiv, document.body.firstChild);
        
        // 3秒后自动移除
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 3000);
    }
}

// 页面加载完成后初始化测试
document.addEventListener('DOMContentLoaded', () => {
    new EditorTest();
});

// 导出测试类供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EditorTest;
}
