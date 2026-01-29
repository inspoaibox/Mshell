# MShell 宣传页面

这是 MShell 项目的官方宣传页面，用于产品推广、功能展示和软件下载。

## 📁 文件结构

```
landing-page/
├── index.html          # 主页面
├── styles.css          # 样式文件
├── script.js           # 交互脚本
├── README.md           # 说明文档
├── logo.png            # Logo 图片（需要添加）
├── favicon.png         # 网站图标（需要添加）
├── screenshots/        # 产品截图目录（需要添加）
│   ├── main.png
│   ├── terminal.png
│   ├── sftp.png
│   └── monitor.png
└── releases/           # 软件发布包目录（需要添加）
    └── MShell-Setup-0.1.5.exe
```

## 🎨 页面特性

### 1. 响应式设计
- 完美适配桌面、平板和移动设备
- 流畅的动画效果
- 优雅的交互体验

### 2. 核心模块
- **导航栏**：固定顶部，滚动时背景变化
- **英雄区域**：大气的标题和动态终端演示
- **功能特性**：12 个核心功能卡片展示
- **产品截图**：4 张精美截图展示
- **下载区域**：Windows 版本和源代码下载
- **快速开始**：4 步上手指南
- **页脚**：完整的导航和社交链接

### 3. 动画效果
- 滚动触发的淡入动画
- 终端打字效果
- 悬停交互效果
- 平滑滚动

### 4. 性能优化
- 图片懒加载
- CSS 动画硬件加速
- 最小化重绘和回流
- 性能监控

## 🚀 快速开始

### 1. 准备资源文件

#### Logo 和图标
将以下文件放入 `landing-page/` 目录：
- `logo.png` - 应用 Logo（建议尺寸：200x200px）
- `favicon.png` - 网站图标（建议尺寸：32x32px）

#### 产品截图
在 `landing-page/screenshots/` 目录中添加：
- `main.png` - 主界面截图
- `terminal.png` - 终端界面截图
- `sftp.png` - SFTP 文件传输截图
- `monitor.png` - 服务器监控截图

建议截图尺寸：1920x1080px 或 16:9 比例

#### 软件发布包
将编译好的安装包放入 `landing-page/releases/` 目录：
- `MShell-Setup-0.1.5.exe`

### 2. 本地预览

使用任何 HTTP 服务器预览页面：

**方法 1：使用 Python**
```bash
cd landing-page
python -m http.server 8000
```

**方法 2：使用 Node.js**
```bash
cd landing-page
npx serve
```

**方法 3：使用 VS Code**
安装 "Live Server" 扩展，右键点击 `index.html` 选择 "Open with Live Server"

然后在浏览器中访问 `http://localhost:8000`

### 3. 自定义内容

#### 修改文本内容
编辑 `index.html`，找到对应的文本并修改：
- 标题和副标题
- 功能描述
- 下载链接
- 联系方式

#### 修改样式
编辑 `styles.css`，可以自定义：
- 颜色主题（`:root` 变量）
- 字体大小
- 间距和布局
- 动画效果

#### 修改交互
编辑 `script.js`，可以添加：
- 自定义动画
- 数据统计
- 表单处理
- 第三方集成

### 4. 更新链接

在 `index.html` 中更新以下链接：

```html
<!-- GitHub 链接 -->
<a href="https://github.com/yourusername/mshell">

<!-- 下载链接 -->
<a href="releases/MShell-Setup-0.1.5.exe">

<!-- 社交媒体链接 -->
<a href="https://twitter.com/mshell">

<!-- 邮箱 -->
<a href="mailto:support@mshell.com">
```

## 🌐 部署

### GitHub Pages

1. 将 `landing-page` 目录内容推送到 GitHub 仓库的 `gh-pages` 分支
2. 在仓库设置中启用 GitHub Pages
3. 选择 `gh-pages` 分支作为源
4. 访问 `https://yourusername.github.io/mshell`

### Netlify

1. 注册 Netlify 账号
2. 连接 GitHub 仓库
3. 设置构建目录为 `landing-page`
4. 部署

### Vercel

1. 注册 Vercel 账号
2. 导入 GitHub 仓库
3. 设置根目录为 `landing-page`
4. 部署

### 自托管

将 `landing-page` 目录上传到任何支持静态网站的服务器：
- Apache
- Nginx
- IIS
- 云存储（OSS、S3 等）

## 📊 SEO 优化

页面已包含基础 SEO 优化：
- 语义化 HTML 标签
- Meta 描述和关键词
- Open Graph 标签（可添加）
- 结构化数据（可添加）

### 建议添加

在 `<head>` 中添加 Open Graph 标签：

```html
<meta property="og:title" content="MShell - 专业的 Windows SSH 客户端">
<meta property="og:description" content="为开发者和运维人员打造的现代化终端工具">
<meta property="og:image" content="https://yourdomain.com/og-image.png">
<meta property="og:url" content="https://yourdomain.com">
<meta name="twitter:card" content="summary_large_image">
```

## 📈 分析集成

### Google Analytics

在 `</head>` 前添加：

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

### 百度统计

在 `</head>` 前添加：

```html
<!-- 百度统计 -->
<script>
var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?YOUR_SITE_ID";
  var s = document.getElementsByTagName("script")[0]; 
  s.parentNode.insertBefore(hm, s);
})();
</script>
```

## 🎯 营销建议

### 1. 社交媒体推广
- 在 Twitter、微博等平台分享
- 制作产品演示视频
- 参与相关技术社区讨论

### 2. 内容营销
- 撰写技术博客文章
- 制作使用教程
- 分享最佳实践

### 3. SEO 优化
- 提交到搜索引擎
- 建立外部链接
- 定期更新内容

### 4. 用户反馈
- 收集用户评价
- 展示使用案例
- 建立社区论坛

## 📝 维护清单

定期更新以下内容：
- [ ] 版本号和下载链接
- [ ] 产品截图
- [ ] 功能列表
- [ ] 系统要求
- [ ] 文档链接
- [ ] 社交媒体链接

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个宣传页面！

## 📄 许可证

MIT License - 与 MShell 项目保持一致

---

**需要帮助？** 请访问 [GitHub Issues](https://github.com/yourusername/mshell/issues)
